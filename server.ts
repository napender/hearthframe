import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import {
  getR2PublicStatus,
  isR2Configured,
  r2DeleteObject,
  r2GetObject,
  r2PresignGetUrl,
  r2PutObject,
  r2TestConnection,
} from './r2Client.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(__dirname, 'data');
const UPLOADS_DIR = path.resolve(DATA_DIR, 'uploads');
const STORE_PATH = path.resolve(DATA_DIR, 'store.json');
const ACCOUNTS_PATH = path.resolve(DATA_DIR, 'accounts.json');
const WORKSPACES_DIR = path.resolve(DATA_DIR, 'workspaces');

const OWNER_WORKSPACE_ID = 'owner';
const FRIEND_PHOTO_LIMIT = 100;
const MAX_ACCOUNTS = Math.max(
  2,
  Math.min(5000, Number(process.env.MAX_ACCOUNTS) || 20)
);
const SIGNUP_INVITE_CODE = (process.env.SIGNUP_INVITE_CODE || '').trim();

const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16
    ? process.env.SESSION_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

const SESSION_COOKIE_NAME = 'hf_session';
const VISITOR_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days for wall-mounted screens
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours max (+ browser-session cookie)

const R2_ACCOUNTS_KEY = 'hearthframe/accounts.json';
const R2_OWNER_STORE_KEY = 'hearthframe/store.json';
const R2_OWNER_SLIDES_PREFIX = 'hearthframe/slides/';

const VALID_WORKSPACE_ID_RE = /^(owner|ws_[a-f0-9]{12,24})$/;

interface CredentialRecord {
  username: string;
  salt: string;
  hash: string;
}

interface ProfileSettings {
  intervalSeconds: number;
  autoRotate: boolean;
  transition: 'fade' | 'none';
  fitMode: 'contain' | 'cover';
  showCaption: boolean;
  showClock: boolean;
  r2DeliveryMode: 'direct' | 'proxy';
}

interface DisplayProfile {
  id: string;
  name: string;
  deviceType: string;
  settings: ProfileSettings;
  createdAt: string;
}

interface SlideItem {
  id: string;
  title: string;
  caption: string;
  enabled: boolean;
  order: number;
  createdAt: string;
  source: 'starter' | 'upload' | 'r2';
  fileName: string;
  thumbFileName: string;
  mimeType: string;
  sizeBytes: number;
  profileIds: string[];
}

interface FrameSettings {
  frameTitle: string;
  intervalSeconds: number;
  autoRotate: boolean;
  transition: 'fade' | 'none';
  fitMode: 'contain' | 'cover';
  showCaption: boolean;
  showClock: boolean;
  bandwidthMode: 'low' | 'balanced' | 'high';
  r2DeliveryMode: 'direct' | 'proxy';
}

interface StoreData {
  version: number;
  updatedAt: string;
  credentials: {
    admin: CredentialRecord | null;
    visitor: CredentialRecord | null;
  };
  sessionVersions: {
    admin: string;
    visitor: string;
  };
  settings: FrameSettings;
  profiles: DisplayProfile[];
  slides: SlideItem[];
}

interface WorkspaceAccount {
  id: string;
  isOwner: boolean;
  frameTitle: string;
  photoLimit: number | null;
  admin: CredentialRecord | null;
  visitor: CredentialRecord | null;
  sessionVersions: {
    admin: string;
    visitor: string;
  };
  slideCount: number;
  createdAt: string;
  updatedAt: string;
}

interface AccountsDirectory {
  version: number;
  updatedAt: string;
  workspaces: WorkspaceAccount[];
}

interface SessionInfo {
  token: string;
  workspaceId: string;
  isOwner: boolean;
  role: 'admin' | 'visitor';
  username: string;
  createdAt: number;
  expiresAt: number;
}

interface AuthedRequest extends Request {
  session?: SessionInfo;
}

const STARTER_SLIDES: Array<{
  id: string;
  title: string;
  caption: string;
  fileName: string;
}> = [
  {
    id: 'starter-alpine-morning',
    title: 'Alpine Lake at Dawn',
    caption: 'First light across still mountain water',
    fileName: 'frame_alpine_morning_1795373685003.jpg',
  },
  {
    id: 'starter-botanical-sunlight',
    title: 'Olive Branches by the Window',
    caption: 'Late afternoon shadows on travertine stone',
    fileName: 'frame_botanical_sunlight_1795373671154.jpg',
  },
  {
    id: 'starter-coastal-dusk',
    title: 'Limestone Headland at Dusk',
    caption: 'Calm twilight tide along the coast',
    fileName: 'frame_coastal_dusk_1795373670419.jpg',
  },
  {
    id: 'starter-autumn-courtyard',
    title: 'Maple Courtyard Morning',
    caption: 'Stepping stones under crimson autumn leaves',
    fileName: 'frame_autumn_courtyard_1795373671205.jpg',
  },
];

const DEFAULT_PROFILE_ID = 'profile-tablet-default';

const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  intervalSeconds: 8,
  autoRotate: true,
  transition: 'fade',
  fitMode: 'contain',
  showCaption: true,
  showClock: true,
  r2DeliveryMode: 'direct',
};

const DEFAULT_SETTINGS: FrameSettings = {
  frameTitle: 'Family Photo Frame',
  intervalSeconds: 8,
  autoRotate: true,
  transition: 'fade',
  fitMode: 'contain',
  showCaption: true,
  showClock: true,
  bandwidthMode: 'balanced',
  r2DeliveryMode: 'direct',
};

// --- Filesystem & Path Confinement Helpers ---

function isValidWorkspaceId(wid: string): boolean {
  return typeof wid === 'string' && VALID_WORKSPACE_ID_RE.test(wid);
}

function ensureDirectories(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  if (!fs.existsSync(WORKSPACES_DIR)) {
    fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
  }
}

function getWorkspaceLocalDir(workspaceId: string): string | null {
  if (!isValidWorkspaceId(workspaceId)) return null;
  if (workspaceId === OWNER_WORKSPACE_ID) {
    return DATA_DIR;
  }
  const resolved = path.resolve(WORKSPACES_DIR, workspaceId);
  if (!resolved.startsWith(WORKSPACES_DIR + path.sep)) {
    return null;
  }
  return resolved;
}

function getWorkspaceStorePath(workspaceId: string): string | null {
  if (!isValidWorkspaceId(workspaceId)) return null;
  if (workspaceId === OWNER_WORKSPACE_ID) {
    return STORE_PATH;
  }
  const dir = getWorkspaceLocalDir(workspaceId);
  if (!dir) return null;
  return path.resolve(dir, 'store.json');
}

function getWorkspaceUploadsDir(workspaceId: string): string | null {
  if (!isValidWorkspaceId(workspaceId)) return null;
  if (workspaceId === OWNER_WORKSPACE_ID) {
    return UPLOADS_DIR;
  }
  const dir = getWorkspaceLocalDir(workspaceId);
  if (!dir) return null;
  return path.resolve(dir, 'uploads');
}

function getConfinedUploadPath(
  workspaceId: string,
  fileName: string
): string | null {
  const uploadsDir = getWorkspaceUploadsDir(workspaceId);
  if (!uploadsDir) return null;
  const baseName = path.basename(fileName);
  if (!baseName || baseName !== fileName) return null;
  const resolved = path.resolve(uploadsDir, baseName);
  if (!resolved.startsWith(uploadsDir + path.sep)) {
    return null;
  }
  return resolved;
}

function getWorkspaceR2StoreKey(workspaceId: string): string {
  if (workspaceId === OWNER_WORKSPACE_ID) {
    return R2_OWNER_STORE_KEY;
  }
  return 'hearthframe/workspaces/' + workspaceId + '/store.json';
}

function getWorkspaceR2SlidesPrefix(workspaceId: string): string {
  if (workspaceId === OWNER_WORKSPACE_ID) {
    return R2_OWNER_SLIDES_PREFIX;
  }
  return 'hearthframe/workspaces/' + workspaceId + '/slides/';
}

function resolveStarterAssetPath(fileName: string): string | null {
  const safeName = path.basename(fileName);
  const candidates = [
    path.resolve(__dirname, 'src', 'assets', 'images', safeName),
    path.resolve(__dirname, 'dist', 'src', 'assets', 'images', safeName),
  ];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const baseDir = path.dirname(candidate);
    if (
      candidate.startsWith(baseDir + path.sep) &&
      fs.existsSync(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

// --- Sanitization & Validation Helpers ---

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength);
}

function validateUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  if (cleaned.length < 3 || cleaned.length > 32) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(cleaned)) return null;
  return cleaned;
}

function validateLegacyUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  if (cleaned.length < 2 || cleaned.length > 32) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(cleaned)) return null;
  return cleaned;
}

function validatePassword(value: unknown, minLen: number = 4): string | null {
  if (typeof value !== 'string') return null;
  if (value.length < minLen || value.length > 128) return null;
  return value;
}

// --- Store Factory & Migration ---

function extractProfileSettings(
  source?: Partial<ProfileSettings> | Partial<FrameSettings> | null
): ProfileSettings {
  const s = source || {};
  const interval =
    typeof s.intervalSeconds === 'number' &&
    Number.isFinite(s.intervalSeconds) &&
    s.intervalSeconds >= 2 &&
    s.intervalSeconds <= 3600
      ? Math.round(s.intervalSeconds)
      : DEFAULT_PROFILE_SETTINGS.intervalSeconds;
  return {
    intervalSeconds: interval,
    autoRotate:
      typeof s.autoRotate === 'boolean'
        ? s.autoRotate
        : DEFAULT_PROFILE_SETTINGS.autoRotate,
    transition: s.transition === 'none' ? 'none' : 'fade',
    fitMode: s.fitMode === 'cover' ? 'cover' : 'contain',
    showCaption:
      typeof s.showCaption === 'boolean'
        ? s.showCaption
        : DEFAULT_PROFILE_SETTINGS.showCaption,
    showClock:
      typeof s.showClock === 'boolean'
        ? s.showClock
        : DEFAULT_PROFILE_SETTINGS.showClock,
    r2DeliveryMode: s.r2DeliveryMode === 'proxy' ? 'proxy' : 'direct',
  };
}

function createInitialStore(includeStarterSlides: boolean, frameTitle?: string): StoreData {
  const now = new Date().toISOString();
  const defaultProfile: DisplayProfile = {
    id: DEFAULT_PROFILE_ID,
    name: 'Android Tablet',
    deviceType: 'Android Tablet',
    settings: { ...DEFAULT_PROFILE_SETTINGS },
    createdAt: now,
  };
  const slides: SlideItem[] = includeStarterSlides
    ? STARTER_SLIDES.map((item, idx) => {
        const assetPath = resolveStarterAssetPath(item.fileName);
        let sizeBytes = 0;
        if (assetPath) {
          try {
            sizeBytes = fs.statSync(assetPath).size;
          } catch {
            sizeBytes = 0;
          }
        }
        return {
          id: item.id,
          title: item.title,
          caption: item.caption,
          enabled: true,
          order: idx,
          createdAt: now,
          source: 'starter',
          fileName: item.fileName,
          thumbFileName: item.fileName,
          mimeType: 'image/jpeg',
          sizeBytes,
          profileIds: [defaultProfile.id],
        };
      })
    : [];

  return {
    version: 2,
    updatedAt: now,
    credentials: {
      admin: null,
      visitor: null,
    },
    sessionVersions: {
      admin: 'v1',
      visitor: 'v1',
    },
    settings: {
      ...DEFAULT_SETTINGS,
      frameTitle: frameTitle || DEFAULT_SETTINGS.frameTitle,
    },
    profiles: [defaultProfile],
    slides,
  };
}

function mergeParsedStore(parsed: Partial<StoreData>): StoreData {
  const updatedAt =
    typeof parsed.updatedAt === 'string'
      ? parsed.updatedAt
      : new Date().toISOString();
  const mergedSettings: FrameSettings = {
    ...DEFAULT_SETTINGS,
    ...(parsed.settings || {}),
  };
  if (
    !mergedSettings.frameTitle ||
    mergedSettings.frameTitle.trim() === 'Living Room Frame'
  ) {
    mergedSettings.frameTitle = DEFAULT_SETTINGS.frameTitle;
  }

  let profiles: DisplayProfile[] = [];
  if (Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
    const seenIds = new Set<string>();
    for (let i = 0; i < parsed.profiles.length; i++) {
      const raw = parsed.profiles[i];
      if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) continue;
      const pid = raw.id.trim();
      if (seenIds.has(pid)) continue;
      seenIds.add(pid);
      profiles.push({
        id: pid,
        name: sanitizeText(raw.name, 50) || 'Display ' + (profiles.length + 1),
        deviceType: sanitizeText(raw.deviceType, 32) || 'Custom Screen',
        settings: extractProfileSettings(raw.settings),
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : updatedAt,
      });
    }
  }

  if (profiles.length === 0) {
    profiles = [
      {
        id: DEFAULT_PROFILE_ID,
        name: 'Android Tablet',
        deviceType: 'Android Tablet',
        settings: extractProfileSettings(mergedSettings),
        createdAt: updatedAt,
      },
    ];
  }

  const validProfileIds = new Set<string>(profiles.map((p) => p.id));
  const allProfileIds = profiles.map((p) => p.id);

  const rawSlides = Array.isArray(parsed.slides) ? parsed.slides : [];
  const slides: SlideItem[] = rawSlides.map((slide) => {
    let assigned: string[];
    if (Array.isArray(slide.profileIds)) {
      const unique = new Set<string>();
      for (let i = 0; i < slide.profileIds.length; i++) {
        const pid = slide.profileIds[i];
        if (typeof pid === 'string' && validProfileIds.has(pid)) {
          unique.add(pid);
        }
      }
      assigned = Array.from(unique);
    } else {
      assigned = allProfileIds.slice();
    }
    return {
      ...slide,
      profileIds: assigned,
    };
  });

  return {
    version: 2,
    updatedAt,
    credentials: {
      admin: parsed.credentials?.admin ?? null,
      visitor: parsed.credentials?.visitor ?? null,
    },
    sessionVersions: {
      admin:
        typeof parsed.sessionVersions?.admin === 'string' &&
        parsed.sessionVersions.admin.trim().length > 0
          ? parsed.sessionVersions.admin.trim()
          : 'v1',
      visitor:
        typeof parsed.sessionVersions?.visitor === 'string' &&
        parsed.sessionVersions.visitor.trim().length > 0
          ? parsed.sessionVersions.visitor.trim()
          : 'v1',
    },
    settings: mergedSettings,
    profiles,
    slides,
  };
}

// --- Multi-Tenant Workspace Store Cache & Persistence ---

interface CachedWorkspace {
  store: StoreData;
  syncedAt: number;
}

const workspaceCache = new Map<string, CachedWorkspace>();
const MAX_CACHED_WORKSPACES = 40;
let accountsDirectory: AccountsDirectory = {
  version: 1,
  updatedAt: new Date().toISOString(),
  workspaces: [],
};
let lastAccountsSyncAt = 0;

function putWorkspaceInCache(workspaceId: string, data: StoreData): void {
  if (workspaceCache.size >= MAX_CACHED_WORKSPACES && !workspaceCache.has(workspaceId)) {
    for (const key of workspaceCache.keys()) {
      if (key !== OWNER_WORKSPACE_ID) {
        workspaceCache.delete(key);
        break;
      }
    }
  }
  workspaceCache.set(workspaceId, {
    store: data,
    syncedAt: Date.now(),
  });
}

function saveLocalWorkspaceStore(workspaceId: string, target: StoreData): void {
  ensureDirectories();
  const storePath = getWorkspaceStorePath(workspaceId);
  if (!storePath) {
    throw new Error('Invalid workspace path.');
  }
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = storePath + '.tmp.' + process.pid + '.' + Date.now();
  fs.writeFileSync(tempPath, JSON.stringify(target, null, 2), 'utf8');
  fs.renameSync(tempPath, storePath);
}

function loadLocalWorkspaceStore(
  workspaceId: string,
  createIfMissing: boolean
): StoreData | null {
  ensureDirectories();
  const storePath = getWorkspaceStorePath(workspaceId);
  if (!storePath) return null;
  if (!fs.existsSync(storePath)) {
    if (!createIfMissing) return null;
    const initial = createInitialStore(workspaceId === OWNER_WORKSPACE_ID);
    saveLocalWorkspaceStore(workspaceId, initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    return mergeParsedStore(parsed);
  } catch {
    if (!createIfMissing) return null;
    const initial = createInitialStore(workspaceId === OWNER_WORKSPACE_ID);
    saveLocalWorkspaceStore(workspaceId, initial);
    return initial;
  }
}

async function persistWorkspaceStore(
  workspaceId: string,
  target: StoreData
): Promise<void> {
  target.updatedAt = new Date().toISOString();
  saveLocalWorkspaceStore(workspaceId, target);
  putWorkspaceInCache(workspaceId, target);
  if (isR2Configured()) {
    const jsonBuf = Buffer.from(JSON.stringify(target, null, 2), 'utf8');
    await r2PutObject(
      getWorkspaceR2StoreKey(workspaceId),
      jsonBuf,
      'application/json; charset=utf-8',
      'no-store'
    );
  }
}

async function getWorkspaceStore(
  workspaceId: string,
  forceRefresh: boolean = false
): Promise<StoreData | null> {
  if (!isValidWorkspaceId(workspaceId)) return null;
  const cached = workspaceCache.get(workspaceId);
  const now = Date.now();

  if (isR2Configured()) {
    const stale = !cached || forceRefresh || now - cached.syncedAt >= 30000;
    if (stale) {
      try {
        const remote = await r2GetObject(getWorkspaceR2StoreKey(workspaceId));
        if (remote) {
          const parsed = JSON.parse(
            remote.body.toString('utf8')
          ) as Partial<StoreData>;
          const merged = mergeParsedStore(parsed);
          saveLocalWorkspaceStore(workspaceId, merged);
          putWorkspaceInCache(workspaceId, merged);
          return merged;
        }
        if (workspaceId === OWNER_WORKSPACE_ID) {
          const local =
            cached?.store || loadLocalWorkspaceStore(OWNER_WORKSPACE_ID, true)!;
          await persistWorkspaceStore(OWNER_WORKSPACE_ID, local);
          return local;
        }
      } catch (err) {
        console.error(
          'R2 workspace sync warning (' + workspaceId + '):',
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  if (cached) {
    return cached.store;
  }

  const local = loadLocalWorkspaceStore(
    workspaceId,
    workspaceId === OWNER_WORKSPACE_ID
  );
  if (local) {
    putWorkspaceInCache(workspaceId, local);
  }
  return local;
}

// --- Global Accounts Directory Persistence ---

function normalizeAccountRecord(raw: Partial<WorkspaceAccount>): WorkspaceAccount | null {
  if (!raw || typeof raw.id !== 'string' || !isValidWorkspaceId(raw.id)) {
    return null;
  }
  const isOwner = raw.id === OWNER_WORKSPACE_ID;
  const now = new Date().toISOString();
  const title =
    typeof raw.frameTitle === 'string' && raw.frameTitle.trim().length > 0
      ? raw.frameTitle.trim() === 'Living Room Frame'
        ? DEFAULT_SETTINGS.frameTitle
        : sanitizeText(raw.frameTitle, 60)
      : DEFAULT_SETTINGS.frameTitle;

  const photoLimit = isOwner
    ? null
    : typeof raw.photoLimit === 'number' && Number.isFinite(raw.photoLimit) && raw.photoLimit > 0
      ? Math.min(Math.round(raw.photoLimit), FRIEND_PHOTO_LIMIT)
      : FRIEND_PHOTO_LIMIT;

  return {
    id: raw.id,
    isOwner,
    frameTitle: title,
    photoLimit,
    admin:
      raw.admin &&
      typeof raw.admin.username === 'string' &&
      typeof raw.admin.salt === 'string' &&
      typeof raw.admin.hash === 'string'
        ? {
            username: raw.admin.username,
            salt: raw.admin.salt,
            hash: raw.admin.hash,
          }
        : null,
    visitor:
      raw.visitor &&
      typeof raw.visitor.username === 'string' &&
      typeof raw.visitor.salt === 'string' &&
      typeof raw.visitor.hash === 'string'
        ? {
            username: raw.visitor.username,
            salt: raw.visitor.salt,
            hash: raw.visitor.hash,
          }
        : null,
    sessionVersions: {
      admin:
        typeof raw.sessionVersions?.admin === 'string' &&
        raw.sessionVersions.admin.trim().length > 0
          ? raw.sessionVersions.admin.trim()
          : 'v1',
      visitor:
        typeof raw.sessionVersions?.visitor === 'string' &&
        raw.sessionVersions.visitor.trim().length > 0
          ? raw.sessionVersions.visitor.trim()
          : 'v1',
    },
    slideCount:
      typeof raw.slideCount === 'number' && Number.isFinite(raw.slideCount) && raw.slideCount >= 0
        ? Math.round(raw.slideCount)
        : 0,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
}

function mergeParsedAccounts(
  parsed: Partial<AccountsDirectory>,
  ownerStore: StoreData
): AccountsDirectory {
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const list: WorkspaceAccount[] = [];

  if (Array.isArray(parsed.workspaces)) {
    for (let i = 0; i < parsed.workspaces.length; i++) {
      const norm = normalizeAccountRecord(parsed.workspaces[i]);
      if (norm && !seen.has(norm.id)) {
        seen.add(norm.id);
        list.push(norm);
      }
    }
  }

  let ownerAcc = list.find((w) => w.id === OWNER_WORKSPACE_ID);
  if (!ownerAcc) {
    ownerAcc = {
      id: OWNER_WORKSPACE_ID,
      isOwner: true,
      frameTitle: ownerStore.settings.frameTitle || DEFAULT_SETTINGS.frameTitle,
      photoLimit: null,
      admin: ownerStore.credentials.admin,
      visitor: ownerStore.credentials.visitor,
      sessionVersions: {
        admin: ownerStore.sessionVersions.admin || 'v1',
        visitor: ownerStore.sessionVersions.visitor || 'v1',
      },
      slideCount: ownerStore.slides.length,
      createdAt: ownerStore.updatedAt || now,
      updatedAt: ownerStore.updatedAt || now,
    };
    list.unshift(ownerAcc);
  } else {
    // Keep owner credentials/versions synced with legacy ownerStore if missing
    if (!ownerAcc.admin && ownerStore.credentials.admin) {
      ownerAcc.admin = ownerStore.credentials.admin;
    }
    if (!ownerAcc.visitor && ownerStore.credentials.visitor) {
      ownerAcc.visitor = ownerStore.credentials.visitor;
    }
    ownerAcc.isOwner = true;
    ownerAcc.photoLimit = null;
  }

  return {
    version: 1,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : now,
    workspaces: list,
  };
}

function saveLocalAccounts(dir: AccountsDirectory): void {
  ensureDirectories();
  const tempPath = ACCOUNTS_PATH + '.tmp.' + process.pid + '.' + Date.now();
  fs.writeFileSync(tempPath, JSON.stringify(dir, null, 2), 'utf8');
  fs.renameSync(tempPath, ACCOUNTS_PATH);
}

async function persistAccounts(dir: AccountsDirectory): Promise<void> {
  dir.updatedAt = new Date().toISOString();
  accountsDirectory = dir;
  saveLocalAccounts(dir);
  if (isR2Configured()) {
    const jsonBuf = Buffer.from(JSON.stringify(dir, null, 2), 'utf8');
    await r2PutObject(
      R2_ACCOUNTS_KEY,
      jsonBuf,
      'application/json; charset=utf-8',
      'no-store'
    );
    lastAccountsSyncAt = Date.now();
  }
}

async function refreshAccountsIfStale(force: boolean): Promise<void> {
  const now = Date.now();
  if (!force && lastAccountsSyncAt > 0 && now - lastAccountsSyncAt < 20000) {
    return;
  }

  const ownerStore =
    (await getWorkspaceStore(OWNER_WORKSPACE_ID, force)) ||
    createInitialStore(true);

  if (isR2Configured()) {
    try {
      const remote = await r2GetObject(R2_ACCOUNTS_KEY);
      lastAccountsSyncAt = Date.now();
      if (remote) {
        const parsed = JSON.parse(
          remote.body.toString('utf8')
        ) as Partial<AccountsDirectory>;
        accountsDirectory = mergeParsedAccounts(parsed, ownerStore);
        saveLocalAccounts(accountsDirectory);
        return;
      }
      // First-time migration to multi-tenant R2: seed accounts.json with Owner workspace
      accountsDirectory = mergeParsedAccounts({ workspaces: [] }, ownerStore);
      await persistAccounts(accountsDirectory);
      return;
    } catch (err) {
      console.error(
        'R2 accounts sync warning:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (fs.existsSync(ACCOUNTS_PATH)) {
    try {
      const raw = fs.readFileSync(ACCOUNTS_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AccountsDirectory>;
      accountsDirectory = mergeParsedAccounts(parsed, ownerStore);
      lastAccountsSyncAt = Date.now();
      return;
    } catch {
      // Fall through to rebuild
    }
  }

  accountsDirectory = mergeParsedAccounts({ workspaces: [] }, ownerStore);
  saveLocalAccounts(accountsDirectory);
  lastAccountsSyncAt = Date.now();
}

function getWorkspaceAccount(workspaceId: string): WorkspaceAccount | null {
  for (let i = 0; i < accountsDirectory.workspaces.length; i++) {
    if (accountsDirectory.workspaces[i].id === workspaceId) {
      return accountsDirectory.workspaces[i];
    }
  }
  return null;
}

// --- Security, Hashing, Rate Limiting & Sessions ---

const sessions = new Map<string, SessionInfo>();
const revokedTokens = new Set<string>();

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 1000 * 60 * 10;
const RATE_LIMIT_MAX = 20;

const signupAttempts = new Map<string, { count: number; resetAt: number }>();
const SIGNUP_LIMIT_WINDOW_MS = 1000 * 60 * 60; // 1 hour
const SIGNUP_LIMIT_MAX = 3; // max 3 signups per IP per hour

interface PairingRequest {
  code: string;
  pollToken: string;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved';
  workspaceId?: string;
  profileId?: string | null;
  approvedBy?: string;
}

const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 unambiguous chars (no 0/O/1/I/L)
const PAIR_CODE_LENGTH = 6;
const PAIR_TTL_MS = 1000 * 60 * 5; // 5 minutes
const PAIR_CLAIM_GRACE_MS = 1000 * 45; // 45s for TV poll to claim after approval
const MAX_PENDING_PAIRINGS = 500;

const pairingsByToken = new Map<string, PairingRequest>();
const pairingsByCode = new Map<string, PairingRequest>();

const pairStartAttempts = new Map<string, { count: number; resetAt: number }>();
const PAIR_START_WINDOW_MS = 1000 * 60 * 10;
const PAIR_START_MAX = 15;

const pairApproveAttempts = new Map<string, { count: number; resetAt: number }>();
const PAIR_APPROVE_WINDOW_MS = 1000 * 60 * 10;
const PAIR_APPROVE_MAX = 15;

function purgeExpiredPairings(): void {
  const now = Date.now();
  for (const [token, entry] of pairingsByToken.entries()) {
    if (now > entry.expiresAt) {
      pairingsByToken.delete(token);
      if (pairingsByCode.get(entry.code) === entry) {
        pairingsByCode.delete(entry.code);
      }
    }
  }
  while (pairingsByToken.size >= MAX_PENDING_PAIRINGS) {
    const oldestKey = pairingsByToken.keys().next().value;
    if (!oldestKey) break;
    const oldest = pairingsByToken.get(oldestKey);
    pairingsByToken.delete(oldestKey);
    if (oldest && pairingsByCode.get(oldest.code) === oldest) {
      pairingsByCode.delete(oldest.code);
    }
  }
}

function generatePairCode(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < PAIR_CODE_LENGTH; i++) {
      code += PAIR_ALPHABET[crypto.randomInt(0, PAIR_ALPHABET.length)];
    }
    if (!pairingsByCode.has(code)) {
      return code;
    }
  }
  return crypto.randomBytes(4).toString('hex').slice(0, PAIR_CODE_LENGTH).toUpperCase();
}

function normalizePairCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\s-]+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(cleaned)) return null;
  return cleaned;
}

function formatPairCode(code: string): string {
  return code.slice(0, 3) + '-' + code.slice(3);
}

function isValidPollToken(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[a-f0-9]{64}$/.test(raw);
}

function resolvePublicOrigin(req: Request): string {
  const rawProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const proto = rawProto === 'http' ? 'http' : 'https';
  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
  const safeHost = /^[A-Za-z0-9.\-:]+$/.test(rawHost) ? rawHost : `localhost:${PORT}`;
  return `${proto}://${safeHost}`;
}

function checkRateLimit(
  bucket: Map<string, { count: number; resetAt: number }>,
  ip: string,
  windowMs: number,
  maxAttempts: number
): boolean {
  const now = Date.now();
  const entry = bucket.get(ip);
  if (!entry || now > entry.resetAt) {
    bucket.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxAttempts) {
    return false;
  }
  entry.count += 1;
  return true;
}

function resetRateLimit(ip: string): void {
  loginAttempts.delete(ip);
}

function hashPassword(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPasswordHash(
  password: string,
  salt: string,
  expectedHex: string
): boolean {
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) {
      return false;
    }
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function safeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function getEnvCredentials(role: 'admin' | 'visitor'): {
  username: string;
  password: string;
} | null {
  if (role === 'admin') {
    const pwd = (process.env.ADMIN_PASSWORD || '').trim();
    if (!pwd) return null;
    const usr = (process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';
    return { username: usr, password: pwd };
  }
  const pwd = (process.env.VISITOR_PASSWORD || '').trim();
  if (!pwd) return null;
  const usr = (process.env.VISITOR_USERNAME || 'family').trim() || 'family';
  return { username: usr, password: pwd };
}

function isOwnerAdminConfigured(): boolean {
  const owner = getWorkspaceAccount(OWNER_WORKSPACE_ID);
  return Boolean(getEnvCredentials('admin')) || Boolean(owner?.admin);
}

function getEffectiveAccountUsername(
  account: WorkspaceAccount,
  role: 'admin' | 'visitor'
): string | null {
  if (account.isOwner) {
    const envCred = getEnvCredentials(role);
    if (envCred) return envCred.username;
  }
  const rec = role === 'admin' ? account.admin : account.visitor;
  return rec ? rec.username : null;
}

function isUsernameTaken(
  candidate: string,
  excludeWorkspaceId?: string,
  excludeRole?: 'admin' | 'visitor'
): boolean {
  const lower = candidate.trim().toLowerCase();
  if (!lower) return true;

  for (let i = 0; i < accountsDirectory.workspaces.length; i++) {
    const acc = accountsDirectory.workspaces[i];
    const roles: Array<'admin' | 'visitor'> = ['admin', 'visitor'];
    for (let r = 0; r < roles.length; r++) {
      const role = roles[r];
      if (acc.id === excludeWorkspaceId && role === excludeRole) {
        continue;
      }
      const existing = getEffectiveAccountUsername(acc, role);
      if (existing && existing.toLowerCase() === lower) {
        return true;
      }
    }
  }
  return false;
}

function authenticateCredentials(
  role: 'admin' | 'visitor',
  username: string,
  password: string
): { account: WorkspaceAccount; canonicalUsername: string } | null {
  const lowerInput = username.trim().toLowerCase();
  if (!lowerInput || !password) return null;

  for (let i = 0; i < accountsDirectory.workspaces.length; i++) {
    const acc = accountsDirectory.workspaces[i];

    // Owner env credentials take precedence for the owner workspace
    if (acc.isOwner) {
      const envCred = getEnvCredentials(role);
      if (envCred) {
        if (
          safeStringEqual(lowerInput, envCred.username.toLowerCase()) &&
          safeStringEqual(password, envCred.password)
        ) {
          return { account: acc, canonicalUsername: envCred.username };
        }
        continue;
      }
    }

    const stored = role === 'admin' ? acc.admin : acc.visitor;
    if (!stored) continue;
    if (
      safeStringEqual(lowerInput, stored.username.toLowerCase()) &&
      verifyPasswordHash(password, stored.salt, stored.hash)
    ) {
      return { account: acc, canonicalUsername: stored.username };
    }
  }

  return null;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecodeToString(input: string): string | null {
  try {
    let padded = input.replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4 !== 0) {
      padded += '=';
    }
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function createSignedSession(
  account: WorkspaceAccount,
  role: 'admin' | 'visitor',
  username: string
): SessionInfo {
  const now = Date.now();
  const ttl = role === 'visitor' ? VISITOR_SESSION_TTL_MS : ADMIN_SESSION_TTL_MS;
  const expiresAt = now + ttl;
  const payloadObj = {
    wid: account.id,
    r: role,
    u: username,
    v: account.sessionVersions[role] || 'v1',
    exp: expiresAt,
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payloadObj));
  const sigB64 = base64UrlEncode(
    crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest()
  );
  const token = payloadB64 + '.' + sigB64;

  const info: SessionInfo = {
    token,
    workspaceId: account.id,
    isOwner: account.isOwner,
    role,
    username,
    createdAt: now,
    expiresAt,
  };
  sessions.set(token, info);
  return info;
}

function verifySignedSessionToken(token: string): SessionInfo | null {
  if (!token || revokedTokens.has(token)) {
    return null;
  }
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0 || dotIdx !== token.lastIndexOf('.')) {
    return null;
  }
  const payloadB64 = token.slice(0, dotIdx);
  const sigB64 = token.slice(dotIdx + 1);
  if (!payloadB64 || !sigB64) {
    return null;
  }

  const expectedSig = base64UrlEncode(
    crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest()
  );
  if (!safeStringEqual(sigB64, expectedSig)) {
    return null;
  }

  const jsonStr = base64UrlDecodeToString(payloadB64);
  if (!jsonStr) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonStr) as {
      wid?: unknown;
      r?: unknown;
      u?: unknown;
      v?: unknown;
      exp?: unknown;
    };
    const role: 'admin' | 'visitor' | null =
      parsed.r === 'admin'
        ? 'admin'
        : parsed.r === 'visitor'
          ? 'visitor'
          : null;
    if (!role || typeof parsed.u !== 'string' || typeof parsed.v !== 'string') {
      return null;
    }
    if (typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp)) {
      return null;
    }
    if (Date.now() > parsed.exp) {
      return null;
    }

    // Legacy tokens without `wid` seamlessly map to the owner workspace
    const wid =
      typeof parsed.wid === 'string' && isValidWorkspaceId(parsed.wid)
        ? parsed.wid
        : OWNER_WORKSPACE_ID;

    const account = getWorkspaceAccount(wid);
    if (!account) {
      return null;
    }
    const currentVersion = account.sessionVersions[role] || 'v1';
    if (!safeStringEqual(parsed.v, currentVersion)) {
      return null;
    }
    return {
      token,
      workspaceId: account.id,
      isOwner: account.isOwner,
      role,
      username: parsed.u,
      createdAt: 0,
      expiresAt: parsed.exp,
    };
  } catch {
    return null;
  }
}

function revokeWorkspaceSessions(
  workspaceId: string,
  role?: 'admin' | 'visitor'
): void {
  for (const [token, info] of sessions.entries()) {
    if (info.workspaceId === workspaceId && (!role || info.role === role)) {
      sessions.delete(token);
      revokedTokens.add(token);
    }
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') {
    return null;
  }
  if (!header.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

function parseCookieHeader(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  const prefix = name + '=';
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i++) {
    const trimmed = parts[i].trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const forwarded = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return forwarded === 'https';
}

function setSessionCookie(
  req: Request,
  res: Response,
  role: 'admin' | 'visitor',
  token: string
): void {
  const attrs = [
    SESSION_COOKIE_NAME + '=' + token,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isHttpsRequest(req)) {
    attrs.push('Secure');
  }
  if (role === 'visitor') {
    attrs.push('Max-Age=' + Math.floor(VISITOR_SESSION_TTL_MS / 1000));
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(req: Request, res: Response): void {
  const attrs = [
    SESSION_COOKIE_NAME + '=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (isHttpsRequest(req)) {
    attrs.push('Secure');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function verifySameOriginForCookieMutation(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return true;
  }
  // Custom header set by XHR cannot be forged cross-origin without CORS preflight
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    return true;
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      const expectedHost = String(
        req.headers['x-forwarded-host'] || req.headers.host || ''
      )
        .split(',')[0]
        .trim()
        .toLowerCase();
      return Boolean(expectedHost) && originHost === expectedHost;
    } catch {
      return false;
    }
  }
  return false;
}

function resolveRequestSession(req: Request): SessionInfo | null {
  const bearer = extractBearerToken(req);
  if (bearer) {
    const mem = sessions.get(bearer);
    if (mem && Date.now() <= mem.expiresAt && !revokedTokens.has(bearer)) {
      const account = getWorkspaceAccount(mem.workspaceId);
      if (account) {
        return mem;
      }
      sessions.delete(bearer);
      return null;
    }
    const verifiedBearer = verifySignedSessionToken(bearer);
    if (verifiedBearer) {
      return verifiedBearer;
    }
  }

  const cookieToken = parseCookieHeader(req, SESSION_COOKIE_NAME);
  if (cookieToken) {
    return verifySignedSessionToken(cookieToken);
  }
  return null;
}

function requireAuth(
  allowedRoles?: Array<'admin' | 'visitor'>,
  ownerOnly: boolean = false
) {
  return async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    await refreshAccountsIfStale(false);

    const hasBearer = Boolean(extractBearerToken(req));
    const hasCookie = Boolean(parseCookieHeader(req, SESSION_COOKIE_NAME));
    if (!hasBearer && hasCookie && !verifySameOriginForCookieMutation(req)) {
      res.status(403).json({ error: 'Cross-site request blocked.' });
      return;
    }

    const info = resolveRequestSession(req);
    if (!info) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (allowedRoles && allowedRoles.indexOf(info.role) === -1) {
      res.status(403).json({ error: 'Admin privileges required.' });
      return;
    }
    if (ownerOnly && !info.isOwner) {
      res.status(403).json({ error: 'Owner privileges required.' });
      return;
    }
    req.session = info;
    next();
  };
}

// --- Workspace-Bound Signed Media URLs ---

function getWorkspaceMediaNonce(workspaceId: string): string {
  const acc = getWorkspaceAccount(workspaceId);
  return acc?.sessionVersions.visitor || 'v1';
}

function signMediaUrl(
  workspaceId: string,
  slideId: string,
  kind: 'display' | 'thumb'
): string {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12; // 12h
  const payload =
    workspaceId +
    '|' +
    slideId +
    '|' +
    kind +
    '|' +
    String(exp) +
    '|' +
    getWorkspaceMediaNonce(workspaceId);
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('hex');
  return (
    '/api/media/' +
    encodeURIComponent(slideId) +
    '?wid=' +
    encodeURIComponent(workspaceId) +
    '&kind=' +
    kind +
    '&exp=' +
    String(exp) +
    '&sig=' +
    sig
  );
}

function verifyMediaSignature(
  workspaceId: string,
  slideId: string,
  kind: string,
  expStr: string,
  sig: string
): boolean {
  if (!isValidWorkspaceId(workspaceId)) {
    return false;
  }
  if (kind !== 'display' && kind !== 'thumb') {
    return false;
  }
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const payload =
    workspaceId +
    '|' +
    slideId +
    '|' +
    kind +
    '|' +
    String(exp) +
    '|' +
    getWorkspaceMediaNonce(workspaceId);
  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('hex');
  return safeStringEqual(sig, expected);
}

// --- Workspace Domain Helpers ---

function normalizeProfileIds(
  wsStore: StoreData,
  input: unknown,
  fallbackToAll: boolean
): string[] {
  const validIds = new Set<string>(wsStore.profiles.map((p) => p.id));
  if (input === undefined || input === null || !Array.isArray(input)) {
    return fallbackToAll ? wsStore.profiles.map((p) => p.id) : [];
  }
  const unique = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const pid = input[i];
    if (typeof pid === 'string' && validIds.has(pid)) {
      unique.add(pid);
    }
  }
  return Array.from(unique);
}

function validateProfileSettingsInput(
  input: Record<string, unknown>,
  base: ProfileSettings
): { ok: true; settings: ProfileSettings } | { ok: false; error: string } {
  const next: ProfileSettings = { ...base };
  if (input.intervalSeconds !== undefined) {
    const parsed = Number(input.intervalSeconds);
    if (!Number.isFinite(parsed) || parsed < 2 || parsed > 3600) {
      return {
        ok: false,
        error: 'Display interval must be between 2 and 3600 seconds.',
      };
    }
    next.intervalSeconds = Math.round(parsed);
  }
  if (typeof input.autoRotate === 'boolean') {
    next.autoRotate = input.autoRotate;
  }
  if (input.transition === 'fade' || input.transition === 'none') {
    next.transition = input.transition;
  }
  if (input.fitMode === 'contain' || input.fitMode === 'cover') {
    next.fitMode = input.fitMode;
  }
  if (typeof input.showCaption === 'boolean') {
    next.showCaption = input.showCaption;
  }
  if (typeof input.showClock === 'boolean') {
    next.showClock = input.showClock;
  }
  if (input.r2DeliveryMode === 'direct' || input.r2DeliveryMode === 'proxy') {
    next.r2DeliveryMode = input.r2DeliveryMode;
  }
  return { ok: true, settings: next };
}

function buildProfilesSummary(wsStore: StoreData) {
  return wsStore.profiles.map((profile) => {
    let slideCount = 0;
    for (let i = 0; i < wsStore.slides.length; i++) {
      const s = wsStore.slides[i];
      if (
        s.enabled &&
        Array.isArray(s.profileIds) &&
        s.profileIds.indexOf(profile.id) !== -1
      ) {
        slideCount += 1;
      }
    }
    return {
      id: profile.id,
      name: profile.name,
      deviceType: profile.deviceType,
      settings: profile.settings,
      createdAt: profile.createdAt,
      slideCount,
    };
  });
}

function serializeSlide(
  workspaceId: string,
  wsStore: StoreData,
  slide: SlideItem,
  activeProfile?: DisplayProfile
) {
  let displayUrl = signMediaUrl(workspaceId, slide.id, 'display');
  let thumbUrl = signMediaUrl(workspaceId, slide.id, 'thumb');

  const deliveryMode =
    activeProfile?.settings.r2DeliveryMode ?? wsStore.settings.r2DeliveryMode;

  if (
    slide.source === 'r2' &&
    isR2Configured() &&
    deliveryMode !== 'proxy'
  ) {
    const prefix = getWorkspaceR2SlidesPrefix(workspaceId);
    const displayKey = prefix + path.basename(slide.fileName);
    const thumbKey =
      prefix + path.basename(slide.thumbFileName || slide.fileName);
    const signedDisplay = r2PresignGetUrl(displayKey, 86400);
    const signedThumb = r2PresignGetUrl(thumbKey, 86400);
    if (signedDisplay && signedThumb) {
      displayUrl = signedDisplay;
      thumbUrl = signedThumb;
    }
  }

  return {
    id: slide.id,
    title: slide.title,
    caption: slide.caption,
    enabled: slide.enabled,
    order: slide.order,
    createdAt: slide.createdAt,
    sizeBytes: slide.sizeBytes,
    source: slide.source,
    profileIds: Array.isArray(slide.profileIds) ? slide.profileIds : [],
    displayUrl,
    thumbUrl,
  };
}

function detectImageType(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38
  ) {
    return { mime: 'image/gif', ext: 'gif' };
  }
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

function decodeBase64DataUrl(input: string): Buffer | null {
  if (typeof input !== 'string') return null;
  const match = /^data:image\/(?:jpeg|jpg|png|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
    input.trim()
  );
  if (!match) return null;
  try {
    return Buffer.from(match[1], 'base64');
  } catch {
    return null;
  }
}

function getFileVersion(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return String(Math.floor(stat.mtimeMs));
  } catch {
    return '0';
  }
}

function sendCompressedBuffer(
  req: Request,
  res: Response,
  content: Buffer,
  contentType: string,
  cacheControl: string,
  etag?: string
): void {
  if (etag) {
    res.setHeader('ETag', etag);
    const ifNoneMatch = String(req.headers['if-none-match'] || '').trim();
    if (ifNoneMatch && ifNoneMatch === etag) {
      res.setHeader('Cache-Control', cacheControl);
      res.status(304).end();
      return;
    }
  }
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', cacheControl);
  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  if (acceptEncoding.indexOf('gzip') !== -1 && content.length > 512) {
    const gzipped = zlib.gzipSync(content, { level: 6 });
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.send(gzipped);
    return;
  }
  res.send(content);
}

function sendCompressedAsset(
  req: Request,
  res: Response,
  filePath: string,
  contentType: string,
  cacheControl: string
): void {
  if (!fs.existsSync(filePath)) {
    res.status(404).send('Not found');
    return;
  }
  const stat = fs.statSync(filePath);
  const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
  const content = fs.readFileSync(filePath);
  sendCompressedBuffer(req, res, content, contentType, cacheControl, etag);
}

// --- Express App ---

const app = express();
app.set('trust proxy', 1);

// Basic security headers (no X-Frame-Options to remain compatible with preview iframe)
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.json({ limit: '16mb' }));

// --- Auth & Account Registration Endpoints ---

app.get('/api/auth/status', async (req: Request, res: Response) => {
  const hasAuthToken = Boolean(
    parseCookieHeader(req, SESSION_COOKIE_NAME) || extractBearerToken(req)
  );
  await refreshAccountsIfStale(false);
  const activeSession = hasAuthToken ? resolveRequestSession(req) : null;
  const ownerAccount = getWorkspaceAccount(OWNER_WORKSPACE_ID);
  const activeAccount = activeSession
    ? getWorkspaceAccount(activeSession.workspaceId)
    : null;

  const hasEnvAdmin = Boolean(getEnvCredentials('admin'));
  const hasEnvVisitor = Boolean(getEnvCredentials('visitor'));

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    initialized: isOwnerAdminConfigured() || accountsDirectory.workspaces.length > 1,
    ownerConfigured: isOwnerAdminConfigured(),
    signupEnabled: true,
    inviteRequired: Boolean(SIGNUP_INVITE_CODE),
    hasEnvAdmin,
    hasEnvVisitor,
    frameTitle:
      activeAccount?.frameTitle ||
      ownerAccount?.frameTitle ||
      DEFAULT_SETTINGS.frameTitle,
    limits: {
      maxAccounts: MAX_ACCOUNTS,
      photoLimit: FRIEND_PHOTO_LIMIT,
      signupRatePerHour: SIGNUP_LIMIT_MAX,
    },
    session: activeSession
      ? {
          role: activeSession.role,
          username: activeSession.username,
          workspaceId: activeSession.workspaceId,
          isOwner: activeSession.isOwner,
        }
      : null,
  });
});

// First-time Owner setup (only active when no owner credentials exist yet)
app.post('/api/auth/setup', async (req: Request, res: Response) => {
  await refreshAccountsIfStale(true);
  const ownerAccount = getWorkspaceAccount(OWNER_WORKSPACE_ID);
  if (!ownerAccount || isOwnerAdminConfigured()) {
    res.status(403).json({
      error:
        'Primary household credentials are already configured. Sign in or create a new Admin account.',
    });
    return;
  }

  const hasEnvAdmin = Boolean(getEnvCredentials('admin'));
  const hasEnvVisitor = Boolean(getEnvCredentials('visitor'));

  const adminUsername = validateLegacyUsername(req.body?.adminUsername || 'admin');
  const adminPassword = validatePassword(req.body?.adminPassword, 4);
  const visitorUsername = validateLegacyUsername(
    req.body?.visitorUsername || 'family'
  );
  const visitorPassword = validatePassword(req.body?.visitorPassword, 4);

  if (!hasEnvAdmin && (!adminUsername || !adminPassword)) {
    res.status(400).json({
      error:
        'Admin username (2–32 letters/numbers) and password (at least 4 characters) are required.',
    });
    return;
  }
  if (!hasEnvVisitor && (!visitorUsername || !visitorPassword)) {
    res.status(400).json({
      error:
        'Frame Display username (2–32 letters/numbers) and password (at least 4 characters) are required.',
    });
    return;
  }

  const ownerStore =
    (await getWorkspaceStore(OWNER_WORKSPACE_ID, true)) ||
    createInitialStore(true);

  if (!hasEnvAdmin && adminUsername && adminPassword) {
    if (isUsernameTaken(adminUsername, OWNER_WORKSPACE_ID, 'admin')) {
      res.status(409).json({ error: 'That Admin username is already taken.' });
      return;
    }
    const hashed = hashPassword(adminPassword);
    const rec: CredentialRecord = {
      username: adminUsername,
      salt: hashed.salt,
      hash: hashed.hash,
    };
    ownerAccount.admin = rec;
    ownerStore.credentials.admin = rec;
  }

  if (!hasEnvVisitor && visitorUsername && visitorPassword) {
    if (
      adminUsername &&
      visitorUsername.toLowerCase() === adminUsername.toLowerCase()
    ) {
      res.status(400).json({
        error: 'Frame Display username must be different from Admin username.',
      });
      return;
    }
    if (isUsernameTaken(visitorUsername, OWNER_WORKSPACE_ID, 'visitor')) {
      res.status(409).json({ error: 'That Frame Display username is already taken.' });
      return;
    }
    const hashed = hashPassword(visitorPassword);
    const rec: CredentialRecord = {
      username: visitorUsername,
      salt: hashed.salt,
      hash: hashed.hash,
    };
    ownerAccount.visitor = rec;
    ownerStore.credentials.visitor = rec;
  }

  try {
    await persistWorkspaceStore(OWNER_WORKSPACE_ID, ownerStore);
    await persistAccounts(accountsDirectory);
  } catch (err) {
    res.status(500).json({
      error:
        'Failed to save credentials to storage: ' +
        (err instanceof Error ? err.message : 'Storage error'),
    });
    return;
  }

  res.status(201).json({
    ok: true,
    initialized: true,
  });
});

// Self-Service Admin Account Registration (Multi-User)
app.post('/api/auth/register', async (req: Request, res: Response) => {
  const ip = req.ip || 'unknown';
  if (
    !checkRateLimit(
      signupAttempts,
      ip,
      SIGNUP_LIMIT_WINDOW_MS,
      SIGNUP_LIMIT_MAX
    )
  ) {
    res.status(429).json({
      error:
        'Too many account signups from this network. Please wait an hour and try again.',
    });
    return;
  }

  if (SIGNUP_INVITE_CODE) {
    const providedCode =
      typeof req.body?.inviteCode === 'string'
        ? req.body.inviteCode.trim()
        : '';
    if (!providedCode || !safeStringEqual(providedCode, SIGNUP_INVITE_CODE)) {
      res.status(403).json({
        error: 'Valid invite code is required to create a new Admin account.',
      });
      return;
    }
  }

  const username = validateUsername(req.body?.username);
  const password = validatePassword(req.body?.password, 6);
  const frameTitle =
    sanitizeText(req.body?.frameTitle, 60) || DEFAULT_SETTINGS.frameTitle;

  if (req.body?.acceptedTerms !== true) {
    res.status(400).json({
      error:
        'Please confirm that you understand and agree to the Account Guidelines & Terms of Service.',
    });
    return;
  }

  if (!username) {
    res.status(400).json({
      error:
        'Username must be 3–32 characters using letters, numbers, dots, underscores, or hyphens.',
    });
    return;
  }
  if (!password) {
    res.status(400).json({
      error: 'Password must be at least 6 characters long.',
    });
    return;
  }

  // Sync fresh directory before uniqueness and cap checks
  await refreshAccountsIfStale(true);

  if (accountsDirectory.workspaces.length >= MAX_ACCOUNTS) {
    res.status(403).json({
      error:
        'Account limit reached on this server. Please contact the host.',
    });
    return;
  }

  if (isUsernameTaken(username)) {
    res.status(409).json({
      error: 'That username is already taken. Please choose another one.',
    });
    return;
  }

  const workspaceId = 'ws_' + crypto.randomBytes(8).toString('hex');
  const now = new Date().toISOString();
  const hashed = hashPassword(password);
  const adminCred: CredentialRecord = {
    username,
    salt: hashed.salt,
    hash: hashed.hash,
  };

  const newStore = createInitialStore(false, frameTitle);
  newStore.credentials.admin = adminCred;
  newStore.credentials.visitor = null;

  const newAccount: WorkspaceAccount = {
    id: workspaceId,
    isOwner: false,
    frameTitle,
    photoLimit: FRIEND_PHOTO_LIMIT,
    admin: adminCred,
    visitor: null,
    sessionVersions: {
      admin: 'v1',
      visitor: 'v1',
    },
    slideCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  accountsDirectory.workspaces.push(newAccount);

  try {
    await persistWorkspaceStore(workspaceId, newStore);
    await persistAccounts(accountsDirectory);
  } catch (err) {
    accountsDirectory.workspaces = accountsDirectory.workspaces.filter(
      (w) => w.id !== workspaceId
    );
    workspaceCache.delete(workspaceId);
    res.status(502).json({
      error:
        'Could not create account in storage: ' +
        (err instanceof Error ? err.message : 'Storage error'),
    });
    return;
  }

  const session = createSignedSession(newAccount, 'admin', username);
  setSessionCookie(req, res, 'admin', session.token);
  res.status(201).json({
    token: session.token,
    role: session.role,
    username: session.username,
    workspaceId: session.workspaceId,
    isOwner: session.isOwner,
  });
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const ip = req.ip || 'unknown';
  if (
    !checkRateLimit(loginAttempts, ip, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX)
  ) {
    res.status(429).json({
      error:
        'Too many sign-in attempts. Please wait a few minutes and try again.',
    });
    return;
  }

  const role =
    req.body?.role === 'admin'
      ? 'admin'
      : req.body?.role === 'visitor'
        ? 'visitor'
        : null;
  const username =
    typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password =
    typeof req.body?.password === 'string' ? req.body.password : '';

  if (!role || !username || !password) {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }

  await refreshAccountsIfStale(false);
  let matched = authenticateCredentials(role, username, password);
  if (!matched && isR2Configured()) {
    // Refresh once from R2 on miss in case another Cloud Run instance created the account
    await refreshAccountsIfStale(true);
    matched = authenticateCredentials(role, username, password);
  }

  if (!matched) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  resetRateLimit(ip);
  const session = createSignedSession(
    matched.account,
    role,
    matched.canonicalUsername
  );
  setSessionCookie(req, res, role, session.token);
  res.json({
    token: session.token,
    role: session.role,
    username: session.username,
    workspaceId: session.workspaceId,
    isOwner: session.isOwner,
  });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const info = resolveRequestSession(req);
  if (info && info.token) {
    sessions.delete(info.token);
    revokedTokens.add(info.token);
  }
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.get(
  '/api/auth/me',
  requireAuth(['admin', 'visitor']),
  (req: AuthedRequest, res: Response) => {
    res.json({
      role: req.session?.role,
      username: req.session?.username,
      workspaceId: req.session?.workspaceId,
      isOwner: Boolean(req.session?.isOwner),
    });
  }
);

// --- Device Pairing (QR Code + 6-Character PIN for TVs & Legacy Tablets) ---

app.post('/api/auth/pair/start', (req: Request, res: Response) => {
  const ip = req.ip || 'unknown';
  if (
    !checkRateLimit(
      pairStartAttempts,
      ip,
      PAIR_START_WINDOW_MS,
      PAIR_START_MAX
    )
  ) {
    res.status(429).json({
      error: 'Too many pairing codes requested. Please wait a few minutes and try again.',
    });
    return;
  }

  purgeExpiredPairings();

  const code = generatePairCode();
  const pollToken = crypto.randomBytes(32).toString('hex');
  const now = Date.now();

  const entry: PairingRequest = {
    code,
    pollToken,
    createdAt: now,
    expiresAt: now + PAIR_TTL_MS,
    status: 'pending',
  };

  pairingsByToken.set(pollToken, entry);
  pairingsByCode.set(code, entry);

  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json({
    code,
    displayCode: formatPairCode(code),
    pollToken,
    expiresInSeconds: Math.floor(PAIR_TTL_MS / 1000),
    qrUrl: '/api/auth/pair/qr?t=' + pollToken,
  });
});

app.get('/api/auth/pair/qr', async (req: Request, res: Response) => {
  purgeExpiredPairings();
  const pollToken = req.query.t;
  if (!isValidPollToken(pollToken)) {
    res.status(400).send('Invalid pairing token');
    return;
  }
  const entry = pairingsByToken.get(pollToken);
  if (!entry || entry.status !== 'pending' || Date.now() > entry.expiresAt) {
    res.status(404).send('Pairing code expired');
    return;
  }

  try {
    const pairLink = `${resolvePublicOrigin(req)}/?pair=${encodeURIComponent(entry.code)}`;
    const pngBuffer = await QRCode.toBuffer(pairLink, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 220,
      color: {
        dark: '#171614',
        light: '#ffffff',
      },
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(pngBuffer);
  } catch (err) {
    res.status(500).send('Could not generate QR code');
  }
});

app.get('/api/auth/pair/status', async (req: Request, res: Response) => {
  purgeExpiredPairings();
  res.setHeader('Cache-Control', 'no-store');

  const pollToken = req.query.t;
  if (!isValidPollToken(pollToken)) {
    res.status(400).json({ status: 'expired' });
    return;
  }

  const entry = pairingsByToken.get(pollToken);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) {
      pairingsByToken.delete(pollToken);
      if (pairingsByCode.get(entry.code) === entry) {
        pairingsByCode.delete(entry.code);
      }
    }
    res.json({ status: 'expired' });
    return;
  }

  if (entry.status !== 'approved' || !entry.workspaceId) {
    res.json({
      status: 'pending',
      expiresInSeconds: Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000)),
    });
    return;
  }

  // Consume atomically so this pairing can never be claimed twice
  pairingsByToken.delete(pollToken);
  if (pairingsByCode.get(entry.code) === entry) {
    pairingsByCode.delete(entry.code);
  }

  await refreshAccountsIfStale(false);
  const account = getWorkspaceAccount(entry.workspaceId);
  if (!account) {
    res.json({ status: 'expired' });
    return;
  }

  const visitorLabel =
    getEffectiveAccountUsername(account, 'visitor') ||
    (getEffectiveAccountUsername(account, 'admin') || 'frame') + ' (paired)';

  // Pairing ONLY ever issues a Frontend ('visitor') session — never Admin
  const session = createSignedSession(account, 'visitor', visitorLabel);
  setSessionCookie(req, res, 'visitor', session.token);

  res.json({
    status: 'approved',
    token: session.token,
    role: session.role,
    username: session.username,
    workspaceId: session.workspaceId,
    isOwner: session.isOwner,
    profileId: entry.profileId || null,
  });
});

app.post(
  '/api/admin/pair/approve',
  requireAuth(['admin']),
  async (req: AuthedRequest, res: Response) => {
    const ip = req.ip || 'unknown';
    if (
      !checkRateLimit(
        pairApproveAttempts,
        ip,
        PAIR_APPROVE_WINDOW_MS,
        PAIR_APPROVE_MAX
      )
    ) {
      res.status(429).json({
        error: 'Too many pairing attempts. Please wait a few minutes and try again.',
      });
      return;
    }

    purgeExpiredPairings();

    const code = normalizePairCode(req.body?.code);
    if (!code) {
      res.status(400).json({
        error: 'Please enter the 6-character pairing code shown on your TV or tablet.',
      });
      return;
    }

    const entry = pairingsByCode.get(code);
    if (!entry || entry.status !== 'pending' || Date.now() > entry.expiresAt) {
      res.status(404).json({
        error: 'Pairing code not found or expired. Generate a fresh code on your TV or tablet.',
      });
      return;
    }

    const workspaceId = req.session!.workspaceId;
    const wsStore = await getWorkspaceStore(workspaceId, false);
    if (!wsStore) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }

    let chosenProfileId: string | null = null;
    let chosenProfileName: string | null = null;

    if (wsStore.profiles.length === 1) {
      // Single profile configured: launch straight into it on the TV
      chosenProfileId = wsStore.profiles[0].id;
      chosenProfileName = wsStore.profiles[0].name;
    } else if (wsStore.profiles.length > 1) {
      const requestedProfileId =
        typeof req.body?.profileId === 'string' ? req.body.profileId.trim() : '';
      if (requestedProfileId && requestedProfileId !== 'choose') {
        const matchedProfile = wsStore.profiles.find(
          (p) => p.id === requestedProfileId
        );
        if (!matchedProfile) {
          res.status(400).json({ error: 'Selected Display Profile was not found.' });
          return;
        }
        chosenProfileId = matchedProfile.id;
        chosenProfileName = matchedProfile.name;
      }
    }

    entry.status = 'approved';
    entry.workspaceId = workspaceId;
    entry.profileId = chosenProfileId;
    entry.approvedBy = req.session!.username;
    entry.expiresAt = Date.now() + PAIR_CLAIM_GRACE_MS;

    // Remove from code lookup immediately once approved
    pairingsByCode.delete(code);

    res.json({
      ok: true,
      displayCode: formatPairCode(code),
      profileId: chosenProfileId,
      profileName: chosenProfileName,
    });
  }
);

app.post(
  '/api/admin/pair/revoke-all',
  requireAuth(['admin']),
  async (req: AuthedRequest, res: Response) => {
    const workspaceId = req.session!.workspaceId;
    await refreshAccountsIfStale(true);
    const account = getWorkspaceAccount(workspaceId);
    const wsStore = await getWorkspaceStore(workspaceId, false);
    if (!account || !wsStore) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }

    const nextVersion = crypto.randomBytes(8).toString('hex');
    account.sessionVersions.visitor = nextVersion;
    account.updatedAt = new Date().toISOString();
    wsStore.sessionVersions.visitor = nextVersion;

    try {
      await persistWorkspaceStore(workspaceId, wsStore);
      await persistAccounts(accountsDirectory);
    } catch (err) {
      res.status(502).json({
        error:
          'Failed to save session update: ' +
          (err instanceof Error ? err.message : 'Storage error'),
      });
      return;
    }

    revokeWorkspaceSessions(workspaceId, 'visitor');
    res.json({ ok: true });
  }
);

// --- Slideshow & Gallery Endpoints (Workspace-Scoped) ---

app.get(
  '/api/slides',
  requireAuth(['admin', 'visitor']),
  async (req: AuthedRequest, res: Response) => {
    const workspaceId = req.session!.workspaceId;
    const account = getWorkspaceAccount(workspaceId);
    const wsStore = await getWorkspaceStore(workspaceId, false);
    if (!account || !wsStore) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }

    const includeDisabled =
      req.query.includeDisabled === '1' && req.session?.role === 'admin';
    const allProfiles =
      req.query.allProfiles === '1' && req.session?.role === 'admin';
    const requestedProfileId =
      typeof req.query.profileId === 'string' ? req.query.profileId.trim() : '';

    const selectedProfile =
      wsStore.profiles.find((p) => p.id === requestedProfileId) ||
      wsStore.profiles[0] ||
      undefined;

    const sorted = wsStore.slides
      .slice()
      .sort((a, b) => a.order - b.order)
      .filter((s) => includeDisabled || s.enabled)
      .filter((s) => {
        if (allProfiles || !selectedProfile) return true;
        return (
          Array.isArray(s.profileIds) &&
          s.profileIds.indexOf(selectedProfile.id) !== -1
        );
      });

    const effectiveSettings: FrameSettings = selectedProfile
      ? {
          ...wsStore.settings,
          ...selectedProfile.settings,
        }
      : { ...wsStore.settings };

    const hasVisitorLogin = Boolean(
      account.visitor || (account.isOwner && getEnvCredentials('visitor'))
    );

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      workspaceId,
      isOwner: account.isOwner,
      updatedAt: wsStore.updatedAt,
      profiles: buildProfilesSummary(wsStore),
      selectedProfile: selectedProfile || null,
      settings: effectiveSettings,
      slides: sorted.map((s) =>
        serializeSlide(
          workspaceId,
          wsStore,
          s,
          allProfiles ? undefined : selectedProfile
        )
      ),
      quota:
        req.session?.role === 'admin'
          ? {
              used: wsStore.slides.length,
              limit: account.photoLimit,
            }
          : undefined,
      hasVisitorLogin: req.session?.role === 'admin' ? hasVisitorLogin : undefined,
      storage:
        req.session?.role === 'admin' && req.session?.isOwner
          ? getR2PublicStatus()
          : undefined,
    });
  }
);

app.get('/api/media/:id', async (req: Request, res: Response) => {
  const slideId = String(req.params.id || '');
  const wid = String(req.query.wid || OWNER_WORKSPACE_ID);
  const kind = String(req.query.kind || 'display');
  const exp = String(req.query.exp || '');
  const sig = String(req.query.sig || '');

  await refreshAccountsIfStale(false);
  if (!verifyMediaSignature(wid, slideId, kind, exp, sig)) {
    res.status(403).send('Forbidden');
    return;
  }

  const wsStore = await getWorkspaceStore(wid, false);
  if (!wsStore) {
    res.status(404).send('Not found');
    return;
  }

  const slide = wsStore.slides.find((s) => s.id === slideId);
  if (!slide) {
    res.status(404).send('Not found');
    return;
  }

  if (slide.source === 'r2') {
    if (!isR2Configured()) {
      res.status(503).send('R2 storage is not configured');
      return;
    }
    const targetName =
      kind === 'thumb' && slide.thumbFileName
        ? slide.thumbFileName
        : slide.fileName;
    const key = getWorkspaceR2SlidesPrefix(wid) + path.basename(targetName);
    try {
      const obj = await r2GetObject(key);
      if (!obj) {
        res.status(404).send('Image file unavailable in R2');
        return;
      }
      res.setHeader(
        'Content-Type',
        slide.mimeType || obj.contentType || 'image/jpeg'
      );
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.send(obj.body);
      return;
    } catch {
      res.status(502).send('Could not fetch image from R2');
      return;
    }
  }

  let filePath: string | null = null;
  if (slide.source === 'starter') {
    filePath = resolveStarterAssetPath(slide.fileName);
  } else {
    const targetName =
      kind === 'thumb' && slide.thumbFileName
        ? slide.thumbFileName
        : slide.fileName;
    filePath = getConfinedUploadPath(wid, targetName);
  }

  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).send('Image file unavailable');
    return;
  }

  res.setHeader('Content-Type', slide.mimeType || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(filePath);
});

// --- Admin Management Endpoints (Workspace-Scoped) ---

app.post(
  '/api/admin/r2/test',
  requireAuth(['admin'], true),
  async (_req: AuthedRequest, res: Response) => {
    const result = await r2TestConnection();
    res.status(result.ok ? 200 : 400).json({
      ok: result.ok,
      message: result.message,
      storage: getR2PublicStatus(),
    });
  }
);

app.post(
  '/api/admin/slides',
  requireAuth(['admin']),
  async (req: AuthedRequest, res: Response) => {
    const workspaceId = req.session!.workspaceId;
    const account = getWorkspaceAccount(workspaceId);
    const wsStore = await getWorkspaceStore(workspaceId, false);
    if (!account || !wsStore) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }

    // Enforce per-account photo cap (unlimited for Owner)
    if (
      account.photoLimit !== null &&
      wsStore.slides.length >= account.photoLimit
    ) {
      res.status(403).json({
        error:
          'Photo limit reached (' +
          account.photoLimit +
          ' photos max per account). Delete older photos to upload more.',
      });
      return;
    }

    const displayBuffer = decodeBase64DataUrl(req.body?.displayData);
    if (!displayBuffer) {
      res.status(400).json({ error: 'Invalid image data format.' });
      return;
    }
    if (displayBuffer.length > 8 * 1024 * 1024) {
      res.status(413).json({
        error: 'Image exceeds 8 MB limit. Please try a smaller file.',
      });
      return;
    }

    const detected = detectImageType(displayBuffer);
    if (!detected) {
      res.status(400).json({
        error:
          'Unsupported image format. Please upload JPEG, PNG, GIF, or WebP.',
      });
      return;
    }

    let thumbBuffer: Buffer | null = null;
    if (typeof req.body?.thumbData === 'string' && req.body.thumbData.length > 0) {
      const parsedThumb = decodeBase64DataUrl(req.body.thumbData);
      if (
        parsedThumb &&
        parsedThumb.length <= 1024 * 1024 &&
        detectImageType(parsedThumb)
      ) {
        thumbBuffer = parsedThumb;
      }
    }

    const id = 'slide-' + crypto.randomBytes(8).toString('hex');
    const fileName = id + '.' + detected.ext;
    const thumbFileName = thumbBuffer ? id + '-thumb.jpg' : fileName;
    let source: 'r2' | 'upload' = 'upload';

    if (isR2Configured()) {
      const prefix = getWorkspaceR2SlidesPrefix(workspaceId);
      try {
        await r2PutObject(
          prefix + fileName,
          displayBuffer,
          detected.mime,
          'public, max-age=31536000, immutable'
        );
        if (thumbBuffer) {
          await r2PutObject(
            prefix + thumbFileName,
            thumbBuffer,
            'image/jpeg',
            'public, max-age=31536000, immutable'
          );
        }
        source = 'r2';
      } catch (err) {
        res.status(502).json({
          error:
            'Cloudflare R2 upload failed: ' +
            (err instanceof Error ? err.message : 'Check R2 credentials'),
        });
        return;
      }
    } else {
      const uploadsDir = getWorkspaceUploadsDir(workspaceId);
      if (!uploadsDir) {
        res.status(500).json({ error: 'Invalid workspace directory.' });
        return;
      }
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const fullPath = getConfinedUploadPath(workspaceId, fileName);
      const thumbPath = getConfinedUploadPath(workspaceId, thumbFileName);
      if (!fullPath || !thumbPath) {
        res.status(500).json({ error: 'Failed to store uploaded file.' });
        return;
      }
      fs.writeFileSync(fullPath, displayBuffer);
      if (thumbBuffer) {
        fs.writeFileSync(thumbPath, thumbBuffer);
      }
    }

    const title = sanitizeText(req.body?.title, 80) || 'Untitled Photo';
    const caption = sanitizeText(req.body?.caption, 160);
    const maxOrder = wsStore.slides.reduce(
      (max, item) => (item.order > max ? item.order : max),
      -1
    );

    const profileIds = normalizeProfileIds(wsStore, req.body?.profileIds, true);

    const newSlide: SlideItem = {
      id,
      title,
      caption,
      enabled: true,
      order: maxOrder + 1,
      createdAt: new Date().toISOString(),
      source,
      fileName,
      thumbFileName,
      mimeType: detected.mime,
      sizeBytes: displayBuffer.length,
      profileIds,
    };

    wsStore.slides.push(newSlide);
    try {
      await persistWorkspaceStore(workspaceId, wsStore);
      account.slideCount = wsStore.slides.length;
      account.updatedAt = wsStore.updatedAt;
      await persistAccounts(accountsDirectory);
    } catch (err) {
      wsStore.slides.pop();
      res.status(502).json({
        error:
          'Photo uploaded but saving gallery metadata failed: ' +
          (err instanceof Error ? err.message : 'Storage error'),
      });
      return;
    }

    res.status(201).json({
      slide: serializeSlide(workspaceId, wsStore, newSlide),
      quota: {
        used: wsStore.slides.length,
        limit: account.photoLimit,
      },
    });
  }
);

app.put(
  '/api/admin/slides/:id',
  requireAuth(['admin']),
  async (req: AuthedRequest, res: Response) => {
    const workspaceId = req.session!.workspaceId;
    const wsStore = await getWorkspaceStore(workspaceId, false);
    if (!wsStore) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }

    const id = String(req.params.id || '');
    const slide = wsStore.slides.find((s) => s.id === id);
    if (!slide) {
      res.status(404).json({ error: 'Slide not found.' });
      return;
    }

    if (typeof req.body?.title === 'string') {
      slide.title = sanitizeText(req.body.title, 80) || 'Untitled Photo';
    }
    if (typeof req.body?.caption === 'string') {
      slide.caption = sanitizeText(req.body.caption, 160);
    }
    if (typeof req.body?.enabled === 'boolean') {
      slide.enabled = req.body.enabled;
    }
    if (Array.isArray(req.body?.profileIds)) {
      slide.profileIds = normalizeProfileIds(wsStore, req.body.profileIds, false);
    }

    try {
      await persistWorkspaceStore(workspaceId, wsStore);
    } catch (err) {
      res.status(502).json({
        error:
          'Could not persist changes: ' +
          (err instanceof Error ? err.message : 'Storage error'),
      });
      return;
    }
    res.json({ slide: serializeSlide(workspaceId, wsStore, slide) });
  }
);

app.post(
  '/api/admin/slides/reorder',
  requireAuth(['admin']),
  async (req: AuthedRequest, res: Response) => {
    const workspaceId = req.session!.workspaceId;
    const wsStore = await getWorkspaceStore(workspaceId, false);
    if (!wsStore) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }

    const orderedIds = req.body?.orderedIds;
    if (!Array.isArray(orderedIds)) {
      res.status(400).json({ error: 'orderedIds array is required.' });
      return;
    }

    const orderMap = new Map<string, number>();
    for (let i = 0; i < orderedIds.length; i++) {
      if (typeof orderedIds[i] === 'string') {
        orderMap.set(orderedIds[i], i);
      }
    }

    let nextFallback = orderedIds.length;
    for (let i = 0; i < wsStore.slides.length; i++) {
      const slide = wsStore.slides[i];
      const assigned = orderMap.get(slide.id);
      if (typeof assigned === 'number') {
        slide.order = assigned;
      } else {
        slide.order = nextFallback;
        nextFallback += 1;
      }
    }

    wsStore.slides.sort((a, b) => a.order - b.order);
    try {
      await persistWorkspaceStore(workspaceId, wsStore);
    } catch (err) {
      res.status(502).json({
        error:
          'Could not save slide order: ' +
          (err instanceof Error ? err.message : 'Storage error'),
      });
      return;
    }

    res.json({
      slides: wsStore.slides.map((s) => serializeSlide(workspaceId, wsStore, s)),
    });
  }
);

app.delete(
  '/api/admin/slides/:id',
  requireAuth(['admin']),
  async (req: AuthedRequest, res: Response) => {
    const workspaceId = req.session!.workspaceId;
    const account = getWorkspaceAccount(workspaceId);
    const wsStore = await getWorkspaceStore(workspaceId, false);
    if (!account || !wsStore) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }

    const id = String(req.params.id || '');
    const idx = wsStore.slides.findIndex((s) => s.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Slide not found.' });
      return;
    }

    const removed = wsStore.slides[idx];
    wsStore.slides.splice(idx, 1);

    wsStore.slides.sort((a, b) => a.order - b.order);
    for (let i = 0; i < wsStore.slides.length; i++) {
      wsStore.slides[i].order = i;
    }

    if (removed.source === 'r2' && isR2Configured()) {
      const prefix = getWorkspaceR2SlidesPrefix(workspaceId);
      const keysToDelete = [prefix + path.basename(removed.fileName)];
      if (
        removed.thumbFileName &&
        removed.thumbFileName !== removed.fileName
      ) {
        keysToDelete.push(prefix + path.basename(removed.thumbFileName));
      }
      for (let i = 0; i < keysToDelete.length; i++) {
        try {
          await r2DeleteObject(keysToDelete[i]);
        } catch {
          // Ignore individual object cleanup failure
        }
      }
    } else if (removed.source === 'upload') {
      const filesToDelete = [removed.fileName];
      if (
        removed.thumbFileName &&
        removed.thumbFileName !== removed.fileName
      ) {
        filesToDelete.push(removed.thumbFileName);
      }
      for (let i = 0; i < filesToDelete.length; i++) {
        const p = getConfinedUploadPath(workspaceId, filesToDelete[i]);
        if (p && fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
          } catch {
            // Ignore cleanup failure
          }
        }
      }
    }

    try {
      await persistWorkspaceStore(workspaceId, wsStore);
      account.slideCount = wsStore.slides.length;
      account.updatedAt = wsStore.updatedAt;
      await persistAccounts(accountsDirectory);
    } catch (err) {
      res.status(502).json({
        error:
          'Could not save gallery after deletion: ' +
          (err instanceof Error ? err.message : 'Storage error'),
      });
      return;
    }
    res.json({
      ok: true,
      quota: {
        used: wsStore.slides.length,
        limit: account.photoLimit,
      },
    });
  }
);

// --- Display Profile CRUD Endpoints (Workspace-Scoped) ---

app.post(
  '/api/admin/profiles',
  requireAuth(['admin']),
  async (req: AuthedRequest, res: Response) => {
    const workspaceId = req.session!.workspaceId;
    const wsStore = await getWorkspaceStore(workspaceId, false);
    if (!wsStore) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }

    if (wsStore.profiles.length >= 24) {
      res.status(400).json({
        error: 'Maximum of 24 display profiles reached.',
      });
      return;
    }

    const name = sanitizeText(req.body?.name, 50);
    if (name.length < 2) {
      res.status(400).json({
        error: 'Profile name must be at least 2 characters.',
      });
      return;
    }

    const deviceType = sanitizeText(req.body?.deviceType, 32) || 'Custom Screen';
    const rawSettings =
      req.body?.settings && typeof req.body.settings === 'object'
        ? (req.body.settings as Record<string, unknown>)
        : {};
    const validated = validateProfileSettingsInput(
      rawSettings,
      DEFAULT_PROFILE_SETTINGS
    );
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }

    const newProfile: DisplayProfile = {
      id: 'profile-' + crypto.randomBytes(6).toString('hex'),
      name,
      deviceType,
      settings: validated.settings,
      createdAt: new Date().toISOString(),
    };

    wsStore.profiles.push(newProfile);

    if (req.body?.assignAllExistingSlides === true) {
      for (let i = 0; i < wsStore.slides.length; i++) {
        const s = wsStore.slides[i];
        if (!Array.isArray(s.profileIds)) {
          s.profileIds = [];
        }
        if (s.profileIds.indexOf(newProfile.id) === -1) {
          s.profileIds.push(newProfile.id);
        }
      }
    }

    try {
      await persistWorkspaceStore(workspaceId, wsStore);
    } catch (err) {
      wsStore.profiles.pop();
      res.status(502).json({
        error:
          'Could not save display profile: ' +
          (err instanceof Error ? err.message : 'Storage error'),
      });
      return;
    }

    res.status(201).json({
      profile: newProfile,
      profiles: buildProfilesSummary(wsStore),
    });
  }
);

app.put(
  '/api/admin/profiles/:id',
  requireAuth(['admin']),
  async (req: AuthedRequest, res: Response) => {
    const workspaceId = req.session!.workspaceId;
    const wsStore = await getWorkspaceStore(workspaceId, false);
    if (!wsStore) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }

    const id = String(req.params.id || '');
    const profile = wsStore.profiles.find((p) => p.id === id);
    if (!profile) {
      res.status(404).json({ error: 'Display profile not found.' });
      return;
    }

    if (typeof req.body?.name === 'string') {
      const cleaned = sanitizeText(req.body.name, 50);
      if (cleaned.length < 2) {
        res.status(400).json({
          error: 'Profile name must be at least 2 characters.',
        });
        return;
      }
      profile.name = cleaned;
    }

    if (typeof req.body?.deviceType === 'string') {
      profile.deviceType =
        sanitizeText(req.body.deviceType, 32) || 'Custom Screen';
    }

    if (req.body?.settings && typeof req.body.settings === 'object') {
      const validated = validateProfileSettingsInput(
        req.body.settings as Record<string, unknown>,
        profile.settings
      );
      if (!validated.ok) {
        res.status(400).json({ error: validated.error });
        return;
      }
      profile.settings = validated.settings;
    }

    if (wsStore.profiles[0] && wsStore.profiles[0].id === profile.id) {
      wsStore.settings = {
        ...wsStore.settings,
        ...profile.settings,
      };
    }

    try {
      await persistWorkspaceStore(workspaceId, wsStore);
    } catch (err) {
      res.status(502).json({
        error:
          'Could not update display profile: ' +
          (err instanceof Error ? err.message : 'Storage error'),
      });
      return;
    }

    res.json({
      profile,
      profiles: buildProfilesSummary(wsStore),
    });
  }
);

app.delete(
  '/api/admin/profiles/:id',
  requireAuth(['admin']),
  async (req: AuthedRequest, res: Response) => {
    const workspaceId = req.session!.workspaceId;
    const wsStore = await getWorkspaceStore(workspaceId, false);
    if (!wsStore) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }

    const id = String(req.params.id || '');
    const idx = wsStore.profiles.findIndex((p) => p.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Display profile not found.' });
      return;
    }
    if (wsStore.profiles.length <= 1) {
      res.status(400).json({
        error: 'At least one display profile is required.',
      });
      return;
    }

    wsStore.profiles.splice(idx, 1);

    for (let i = 0; i < wsStore.slides.length; i++) {
      const s = wsStore.slides[i];
      if (Array.isArray(s.profileIds)) {
        s.profileIds = s.profileIds.filter((pid) => pid !== id);
      }
    }

    try {
      await persistWorkspaceStore(workspaceId, wsStore);
    } catch (err) {
      res.status(502).json({
        error:
          'Could not delete display profile: ' +
          (err instanceof Error ? err.message : 'Storage error'),
      });
      return;
    }

    res.json({
      ok: true,
      profiles: buildProfilesSummary(wsStore),
    });
  }
);

// --- Workspace Settings & Access Credentials ---

app.put(
  '/api/admin/settings',
  requireAuth(['admin']),
  async (req: AuthedRequest, res: Response) => {
    const workspaceId = req.session!.workspaceId;
    const account = getWorkspaceAccount(workspaceId);
    const wsStore = await getWorkspaceStore(workspaceId, false);
    if (!account || !wsStore) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }

    const body = req.body || {};
    const next: FrameSettings = { ...wsStore.settings };

    if (typeof body.frameTitle === 'string') {
      next.frameTitle =
        sanitizeText(body.frameTitle, 60) || DEFAULT_SETTINGS.frameTitle;
    }
    if (body.intervalSeconds !== undefined) {
      const parsed = Number(body.intervalSeconds);
      if (!Number.isFinite(parsed) || parsed < 2 || parsed > 3600) {
        res.status(400).json({
          error: 'Display interval must be between 2 and 3600 seconds.',
        });
        return;
      }
      next.intervalSeconds = Math.round(parsed);
    }
    if (typeof body.autoRotate === 'boolean') {
      next.autoRotate = body.autoRotate;
    }
    if (body.transition === 'fade' || body.transition === 'none') {
      next.transition = body.transition;
    }
    if (body.fitMode === 'contain' || body.fitMode === 'cover') {
      next.fitMode = body.fitMode;
    }
    if (typeof body.showCaption === 'boolean') {
      next.showCaption = body.showCaption;
    }
    if (typeof body.showClock === 'boolean') {
      next.showClock = body.showClock;
    }
    if (
      body.bandwidthMode === 'low' ||
      body.bandwidthMode === 'balanced' ||
      body.bandwidthMode === 'high'
    ) {
      next.bandwidthMode = body.bandwidthMode;
    }
    if (body.r2DeliveryMode === 'direct' || body.r2DeliveryMode === 'proxy') {
      next.r2DeliveryMode = body.r2DeliveryMode;
    }

    wsStore.settings = next;
    try {
      await persistWorkspaceStore(workspaceId, wsStore);
      if (account.frameTitle !== next.frameTitle) {
        account.frameTitle = next.frameTitle;
        account.updatedAt = wsStore.updatedAt;
        await persistAccounts(accountsDirectory);
      }
    } catch (err) {
      res.status(502).json({
        error:
          'Could not save system settings: ' +
          (err instanceof Error ? err.message : 'Storage error'),
      });
      return;
    }

    res.json({
      settings: wsStore.settings,
      updatedAt: wsStore.updatedAt,
    });
  }
);

app.get(
  '/api/admin/access-info',
  requireAuth(['admin']),
  (req: AuthedRequest, res: Response) => {
    const account = getWorkspaceAccount(req.session!.workspaceId);
    if (!account) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }
    const envAdmin = account.isOwner ? getEnvCredentials('admin') : null;
    const envVisitor = account.isOwner ? getEnvCredentials('visitor') : null;
    const adminUsername = envAdmin
      ? envAdmin.username
      : account.admin?.username || req.session!.username;
    const visitorUsername = envVisitor
      ? envVisitor.username
      : account.visitor?.username || null;

    res.json({
      adminUsername,
      visitorUsername,
      hasVisitorLogin: Boolean(visitorUsername),
      envAdminLocked: Boolean(envAdmin),
      envVisitorLocked: Boolean(envVisitor),
      isOwner: account.isOwner,
    });
  }
);

app.put(
  '/api/admin/credentials',
  requireAuth(['admin']),
  async (req: AuthedRequest, res: Response) => {
    const workspaceId = req.session!.workspaceId;
    await refreshAccountsIfStale(true);
    const account = getWorkspaceAccount(workspaceId);
    const wsStore = await getWorkspaceStore(workspaceId, false);
    if (!account || !wsStore) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }

    const target: 'admin' | 'visitor' | null =
      req.body?.target === 'admin'
        ? 'admin'
        : req.body?.target === 'visitor'
          ? 'visitor'
          : null;
    if (!target) {
      res.status(400).json({ error: 'Target account must be admin or visitor.' });
      return;
    }

    if (account.isOwner && target === 'admin' && getEnvCredentials('admin')) {
      res.status(400).json({
        error:
          'Owner Admin login is locked by server environment secrets (ADMIN_PASSWORD).',
      });
      return;
    }
    if (account.isOwner && target === 'visitor' && getEnvCredentials('visitor')) {
      res.status(400).json({
        error:
          'Owner Frame Display login is locked by server environment secrets (VISITOR_PASSWORD).',
      });
      return;
    }

    const newUsername = validateUsername(req.body?.username);
    const newPassword = validatePassword(req.body?.password, 4);
    if (!newUsername) {
      res.status(400).json({
        error:
          'Username must be 3–32 characters using letters, numbers, dots, underscores, or hyphens.',
      });
      return;
    }
    if (!newPassword) {
      res.status(400).json({
        error: 'Password must be at least 4 characters long.',
      });
      return;
    }

    if (isUsernameTaken(newUsername, workspaceId, target)) {
      res.status(409).json({
        error: 'That username is already in use. Please choose a different username.',
      });
      return;
    }

    if (target === 'admin') {
      const currentPassword =
        typeof req.body?.currentPassword === 'string'
          ? req.body.currentPassword
          : '';
      if (
        !account.admin ||
        !verifyPasswordHash(currentPassword, account.admin.salt, account.admin.hash)
      ) {
        res.status(401).json({ error: 'Current admin password is incorrect.' });
        return;
      }
    }

    const hashed = hashPassword(newPassword);
    const updatedCred: CredentialRecord = {
      username: newUsername,
      salt: hashed.salt,
      hash: hashed.hash,
    };
    const nextVersion = crypto.randomBytes(8).toString('hex');

    account[target] = updatedCred;
    account.sessionVersions[target] = nextVersion;
    account.updatedAt = new Date().toISOString();

    wsStore.credentials[target] = updatedCred;
    wsStore.sessionVersions[target] = nextVersion;

    try {
      await persistWorkspaceStore(workspaceId, wsStore);
      await persistAccounts(accountsDirectory);
    } catch (err) {
      res.status(502).json({
        error:
          'Could not save updated credentials: ' +
          (err instanceof Error ? err.message : 'Storage error'),
      });
      return;
    }

    // Revoke existing sessions for this workspace & role
    revokeWorkspaceSessions(workspaceId, target);

    // If Admin updated their own password, immediately issue a fresh session so they stay signed in
    let refreshedToken: string | undefined;
    if (target === 'admin') {
      const freshSession = createSignedSession(account, 'admin', newUsername);
      setSessionCookie(req, res, 'admin', freshSession.token);
      refreshedToken = freshSession.token;
    }

    res.json({
      ok: true,
      target,
      username: newUsername,
      token: refreshedToken,
    });
  }
);

// --- Owner-Only Accounts Overview & Cleanup (Strictly No Photo Content Exposed) ---

app.get(
  '/api/owner/accounts',
  requireAuth(['admin'], true),
  async (_req: AuthedRequest, res: Response) => {
    await refreshAccountsIfStale(true);
    const accounts = accountsDirectory.workspaces.map((acc) => {
      const adminUsername = getEffectiveAccountUsername(acc, 'admin') || '(unset)';
      const visitorUsername = getEffectiveAccountUsername(acc, 'visitor');
      return {
        id: acc.id,
        isOwner: acc.isOwner,
        frameTitle: acc.frameTitle,
        adminUsername,
        visitorUsername,
        hasVisitorLogin: Boolean(visitorUsername),
        slideCount: acc.slideCount,
        photoLimit: acc.photoLimit,
        createdAt: acc.createdAt,
        updatedAt: acc.updatedAt,
      };
    });

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      accounts,
      maxAccounts: MAX_ACCOUNTS,
      inviteRequired: Boolean(SIGNUP_INVITE_CODE),
    });
  }
);

app.delete(
  '/api/owner/accounts/:id',
  requireAuth(['admin'], true),
  async (req: AuthedRequest, res: Response) => {
    const targetId = String(req.params.id || '');
    if (!isValidWorkspaceId(targetId) || targetId === OWNER_WORKSPACE_ID) {
      res.status(400).json({
        error: 'The primary owner account cannot be deleted.',
      });
      return;
    }

    await refreshAccountsIfStale(true);
    const idx = accountsDirectory.workspaces.findIndex((w) => w.id === targetId);
    if (idx === -1) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }

    // Best-effort cleanup of all slide media & workspace store in R2 and on local disk
    const targetStore = await getWorkspaceStore(targetId, true);
    if (targetStore && isR2Configured()) {
      const prefix = getWorkspaceR2SlidesPrefix(targetId);
      for (let i = 0; i < targetStore.slides.length; i++) {
        const slide = targetStore.slides[i];
        if (slide.source !== 'r2') continue;
        const keys = [prefix + path.basename(slide.fileName)];
        if (slide.thumbFileName && slide.thumbFileName !== slide.fileName) {
          keys.push(prefix + path.basename(slide.thumbFileName));
        }
        for (let k = 0; k < keys.length; k++) {
          try {
            await r2DeleteObject(keys[k]);
          } catch {
            // Ignore individual object cleanup errors
          }
        }
      }
      try {
        await r2DeleteObject(getWorkspaceR2StoreKey(targetId));
      } catch {
        // Ignore store delete errors
      }
    }

    const localDir = getWorkspaceLocalDir(targetId);
    if (
      localDir &&
      localDir !== DATA_DIR &&
      localDir.startsWith(WORKSPACES_DIR + path.sep) &&
      fs.existsSync(localDir)
    ) {
      try {
        fs.rmSync(localDir, { recursive: true, force: true });
      } catch {
        // Ignore local cleanup errors
      }
    }

    accountsDirectory.workspaces.splice(idx, 1);
    workspaceCache.delete(targetId);
    revokeWorkspaceSessions(targetId);

    try {
      await persistAccounts(accountsDirectory);
    } catch (err) {
      res.status(502).json({
        error:
          'Failed to update account directory after deletion: ' +
          (err instanceof Error ? err.message : 'Storage error'),
      });
      return;
    }

    res.json({ ok: true });
  }
);

// --- Legacy Static Frontend Serving (Zero ES Modules, Gzipped for Slow Networks) ---

const publicDir = path.resolve(__dirname, 'public');
const indexFilePath = fs.existsSync(path.resolve(__dirname, 'dist', 'index.html'))
  ? path.resolve(__dirname, 'dist', 'index.html')
  : path.resolve(__dirname, 'index.html');

function sendIndexHtml(req: Request, res: Response): void {
  if (!fs.existsSync(indexFilePath)) {
    res.status(404).send('Not found');
    return;
  }
  const cssVer = getFileVersion(path.resolve(publicDir, 'styles.css'));
  const jsVer = getFileVersion(path.resolve(publicDir, 'app.js'));
  const rawHtml = fs.readFileSync(indexFilePath, 'utf8');
  const html = rawHtml
    .replace('href="/styles.css"', `href="/styles.css?v=${cssVer}"`)
    .replace('src="/app.js"', `src="/app.js?v=${jsVer}"`);
  sendCompressedBuffer(
    req,
    res,
    Buffer.from(html, 'utf8'),
    'text/html; charset=utf-8',
    'no-cache, no-store, must-revalidate'
  );
}

app.get('/', (req: Request, res: Response) => {
  sendIndexHtml(req, res);
});

app.get('/styles.css', (req: Request, res: Response) => {
  const cssPath = path.resolve(publicDir, 'styles.css');
  sendCompressedAsset(
    req,
    res,
    cssPath,
    'text/css; charset=utf-8',
    'no-cache'
  );
});

app.get('/app.js', (req: Request, res: Response) => {
  const jsPath = path.resolve(publicDir, 'app.js');
  sendCompressedAsset(
    req,
    res,
    jsPath,
    'application/javascript; charset=utf-8',
    'no-cache'
  );
});

app.get('/keepawake.mp4', (_req: Request, res: Response) => {
  const mp4Path = path.resolve(publicDir, 'keepawake.mp4');
  if (!fs.existsSync(mp4Path)) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(mp4Path);
});

app.get('/keepawake.webm', (_req: Request, res: Response) => {
  const webmPath = path.resolve(publicDir, 'keepawake.webm');
  if (!fs.existsSync(webmPath)) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', 'video/webm');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(webmPath);
});

app.get('/favicon.ico', (_req: Request, res: Response) => {
  const favCandidates = [
    path.resolve(publicDir, 'favicon.ico'),
    path.resolve(__dirname, 'favicon.ico'),
  ];
  for (let i = 0; i < favCandidates.length; i++) {
    if (fs.existsSync(favCandidates[i])) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.sendFile(favCandidates[i]);
      return;
    }
  }
  res.status(404).end();
});

app.use((req: Request, res: Response) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'API route not found.' });
    return;
  }
  sendIndexHtml(req, res);
});

async function startServer(): Promise<void> {
  await refreshAccountsIfStale(true);
  app.listen(PORT, '0.0.0.0', () => {
    const r2Status = getR2PublicStatus();
    console.log(
      'HearthFrame server listening on http://0.0.0.0:' +
        PORT +
        (r2Status.configured
          ? ' (Storage: Cloudflare R2 bucket ' + r2Status.bucketName + ')'
          : ' (Storage: Local disk)') +
        ' · Workspaces: ' +
        accountsDirectory.workspaces.length
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start HearthFrame server:', err);
  process.exit(1);
});
