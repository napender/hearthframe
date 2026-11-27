import crypto from 'crypto';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  host: string;
}

const REGION = 'auto';
const SERVICE = 's3';
const EMPTY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase()
  );
}

function encodeObjectKey(key: string): string {
  return key
    .replace(/^\/+/, '')
    .split('/')
    .map(rfc3986Encode)
    .join('/');
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function hmacHex(key: Buffer | string, data: string): string {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

function getAmzTimestamps(now: Date = new Date()): {
  amzDate: string;
  dateStamp: string;
} {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso, // YYYYMMDDTHHMMSSZ
    dateStamp: iso.slice(0, 8), // YYYYMMDD
  };
}

function deriveSigningKey(secretAccessKey: string, dateStamp: string): Buffer {
  const kDate = hmac('AWS4' + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, 'aws4_request');
}

export function getR2Config(): R2Config | null {
  const accountId = (process.env.R2_ACCOUNT_ID || '').trim();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucketName = (process.env.R2_BUCKET_NAME || '').trim();

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    return null;
  }

  // Strict format validation anchors requests exclusively to Cloudflare R2
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(accountId)) {
    return null;
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucketName)) {
    return null;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    host: accountId + '.r2.cloudflarestorage.com',
  };
}

export function isR2Configured(): boolean {
  return getR2Config() !== null;
}

export function getR2PublicStatus(): {
  configured: boolean;
  bucketName: string | null;
} {
  const cfg = getR2Config();
  return {
    configured: cfg !== null,
    bucketName: cfg ? cfg.bucketName : null,
  };
}

async function signedR2Request(
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD',
  key: string,
  body?: Buffer,
  extraHeaders?: Record<string, string>
): Promise<globalThis.Response> {
  const cfg = getR2Config();
  if (!cfg) {
    throw new Error('Cloudflare R2 is not configured.');
  }

  const canonicalUri =
    '/' + rfc3986Encode(cfg.bucketName) + '/' + encodeObjectKey(key);
  const { amzDate, dateStamp } = getAmzTimestamps();
  const payloadHash = body ? sha256Hex(body) : EMPTY_SHA256;

  const canonicalHeaders =
    'host:' +
    cfg.host +
    '\n' +
    'x-amz-content-sha256:' +
    payloadHash +
    '\n' +
    'x-amz-date:' +
    amzDate +
    '\n';
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = dateStamp + '/' + REGION + '/' + SERVICE + '/aws4_request';
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = deriveSigningKey(cfg.secretAccessKey, dateStamp);
  const signature = hmacHex(signingKey, stringToSign);

  const authHeader =
    'AWS4-HMAC-SHA256 Credential=' +
    cfg.accessKeyId +
    '/' +
    credentialScope +
    ', SignedHeaders=' +
    signedHeaders +
    ', Signature=' +
    signature;

  const headers: Record<string, string> = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: authHeader,
    ...(extraHeaders || {}),
  };

  const url = 'https://' + cfg.host + canonicalUri;
  return fetch(url, {
    method,
    headers,
    body: body ? new Uint8Array(body) : undefined,
  });
}

export async function r2PutObject(
  key: string,
  body: Buffer,
  contentType: string,
  cacheControl?: string
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': contentType,
  };
  if (cacheControl) {
    headers['Cache-Control'] = cacheControl;
  }
  const resp = await signedR2Request('PUT', key, body, headers);
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(
      'R2 upload failed (' + resp.status + ')' + (detail ? ': ' + detail.slice(0, 140) : '')
    );
  }
}

export async function r2GetObject(
  key: string
): Promise<{ body: Buffer; contentType: string } | null> {
  const resp = await signedR2Request('GET', key);
  if (resp.status === 404) {
    return null;
  }
  if (!resp.ok) {
    throw new Error('R2 download failed (' + resp.status + ').');
  }
  const arrayBuf = await resp.arrayBuffer();
  return {
    body: Buffer.from(arrayBuf),
    contentType: resp.headers.get('content-type') || 'application/octet-stream',
  };
}

export async function r2DeleteObject(key: string): Promise<void> {
  const resp = await signedR2Request('DELETE', key);
  if (resp.status === 404) {
    return;
  }
  if (!resp.ok) {
    throw new Error('R2 delete failed (' + resp.status + ').');
  }
}

export function r2PresignGetUrl(
  key: string,
  expiresSeconds: number = 43200
): string | null {
  const cfg = getR2Config();
  if (!cfg) return null;

  const clampedExpires = Math.max(60, Math.min(604800, Math.round(expiresSeconds)));
  const canonicalUri =
    '/' + rfc3986Encode(cfg.bucketName) + '/' + encodeObjectKey(key);
  const { amzDate, dateStamp } = getAmzTimestamps();
  const credentialScope = dateStamp + '/' + REGION + '/' + SERVICE + '/aws4_request';
  const credential = cfg.accessKeyId + '/' + credentialScope;

  const queryParams: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', credential],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(clampedExpires)],
    ['X-Amz-SignedHeaders', 'host'],
  ];

  const canonicalQuery = queryParams
    .map(([k, v]) => rfc3986Encode(k) + '=' + rfc3986Encode(v))
    .join('&');

  const canonicalHeaders = 'host:' + cfg.host + '\n';
  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = deriveSigningKey(cfg.secretAccessKey, dateStamp);
  const signature = hmacHex(signingKey, stringToSign);

  return (
    'https://' +
    cfg.host +
    canonicalUri +
    '?' +
    canonicalQuery +
    '&X-Amz-Signature=' +
    signature
  );
}

export async function r2TestConnection(): Promise<{
  ok: boolean;
  message: string;
}> {
  const cfg = getR2Config();
  if (!cfg) {
    return {
      ok: false,
      message:
        'Cloudflare R2 secrets are not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.',
    };
  }

  try {
    const resp = await signedR2Request('GET', 'hearthframe/store.json');
    if (resp.status === 200 || resp.status === 404) {
      return {
        ok: true,
        message: 'Connected to Cloudflare R2 bucket "' + cfg.bucketName + '".',
      };
    }
    if (resp.status === 403 || resp.status === 401) {
      return {
        ok: false,
        message:
          'Cloudflare R2 rejected credentials (HTTP ' +
          resp.status +
          '). Verify your R2 Access Key ID, Secret Access Key, and bucket permissions.',
      };
    }
    return {
      ok: false,
      message: 'Cloudflare R2 returned HTTP ' + resp.status + '.',
    };
  } catch (err) {
    return {
      ok: false,
      message:
        'Could not reach Cloudflare R2: ' +
        (err instanceof Error ? err.message : 'Network error'),
    };
  }
}
