/* HearthFrame Legacy ES5 Client
 * Strict ES5 syntax (var, function, XMLHttpRequest, safe DOM nodes)
 * Compatible with Chrome 25+ / Android 4.4+ tablets without polyfills.
 */
(function () {
  'use strict';

  var INTERVAL_PRESETS = [3, 5, 8, 10, 15, 30, 60];

  var DEVICE_PRESETS = {
    tablet_legacy: {
      label: 'Android Tablet (Legacy)',
      deviceType: 'Android Tablet',
      intervalSeconds: 10,
      autoRotate: true,
      transition: 'none',
      fitMode: 'contain',
      showCaption: true,
      showClock: true,
      r2DeliveryMode: 'direct'
    },
    ipad: {
      label: 'iPad / Modern Tablet',
      deviceType: 'iPad',
      intervalSeconds: 8,
      autoRotate: true,
      transition: 'fade',
      fitMode: 'contain',
      showCaption: true,
      showClock: true,
      r2DeliveryMode: 'direct'
    },
    tv: {
      label: 'Living Room TV',
      deviceType: 'TV',
      intervalSeconds: 15,
      autoRotate: true,
      transition: 'fade',
      fitMode: 'cover',
      showCaption: false,
      showClock: true,
      r2DeliveryMode: 'direct'
    },
    custom: {
      label: 'Custom Screen',
      deviceType: 'Custom Screen',
      intervalSeconds: 8,
      autoRotate: true,
      transition: 'fade',
      fitMode: 'contain',
      showCaption: true,
      showClock: true,
      r2DeliveryMode: 'direct'
    }
  };

  var state = {
    initialized: true,
    ownerConfigured: true,
    signupEnabled: true,
    inviteRequired: false,
    hasEnvAdmin: false,
    hasEnvVisitor: false,
    frameTitle: 'Family Photo Frame',
    authenticated: false,
    token: null,
    role: null,
    username: null,
    workspaceId: null,
    isOwner: false,
    view: 'portal', // 'portal' | 'chooser' | 'visitor' | 'admin'
    adminTab: 'gallery', // 'gallery' | 'profiles' | 'settings' | 'access' | 'accounts'
    adminPortalMode: 'login', // 'login' | 'signup'
    visitorPortalMode: 'pair', // 'pair' | 'login'
    profiles: [],
    selectedProfileId: null,
    selectedProfile: null,
    galleryFilterProfileId: 'all',
    confirmDeleteProfileId: null,
    newProfilePreset: 'tv',
    slides: [],
    updatedAt: '',
    quota: {
      used: 0,
      limit: null
    },
    limits: {
      maxAccounts: 20,
      photoLimit: 100,
      signupRatePerHour: 3
    },
    signupShowFullTerms: false,
    hasVisitorLogin: true,
    settings: {
      frameTitle: 'Family Photo Frame',
      intervalSeconds: 8,
      autoRotate: true,
      transition: 'fade',
      fitMode: 'contain',
      showCaption: true,
      showClock: true,
      bandwidthMode: 'balanced',
      r2DeliveryMode: 'direct'
    },
    storage: {
      configured: false,
      bucketName: null
    },
    r2TestMessage: '',
    r2TestOk: false,
    r2Testing: false,
    accessInfo: {
      adminUsername: '',
      visitorUsername: null,
      hasVisitorLogin: false,
      envAdminLocked: false,
      envVisitorLocked: false,
      isOwner: false
    },
    ownerAccounts: [],
    ownerMaxAccounts: 100,
    ownerInviteRequired: false,
    ownerAccountsLoading: false,
    confirmDeleteAccountId: null,
    // Slideshow runtime state
    currentIndex: 0,
    playing: true,
    isFullscreen: false,
    fsControlsVisible: false,
    localInterval: 8,
    localAutoRotate: true,
    localFitMode: 'contain',
    keepAwakeEnabled: true,
    keepAwakeActive: false,
    keepAwakeMode: '',
    // UI state
    loading: true,
    portalErrorAdmin: '',
    portalSignupError: '',
    portalErrorVisitor: '',
    setupError: '',
    setupSuccess: '',
    adminNotice: '',
    adminError: '',
    uploadStatus: '',
    uploading: false,
    uploadCurrentIndex: 0,
    uploadTotalCount: 0,
    uploadTitleInput: '',
    uploadCaptionInput: '',
    uploadDropWarning: '',
    uploadSelectedProfileIds: null,
    pendingUploadFiles: [],
    editingSlideId: null,
    confirmDeleteId: null,
    // TV / Tablet QR + 6-Char PIN Pairing state
    pairLoading: false,
    pairCode: '',
    pairDisplayCode: '',
    pairPollToken: '',
    pairQrUrl: '',
    pairExpiresAt: 0,
    pairStatus: 'idle', // 'idle' | 'pending' | 'expired' | 'error'
    pairError: '',
    pendingPairCodeFromUrl: '',
    pairApproveInput: '',
    pairApproveProfileId: '',
    pairApproving: false,
    pairApproveError: '',
    pairApproveNotice: '',
    confirmRevokeScreens: false,
    revokingScreens: false
  };

  var slideTimer = null;
  var progressTimer = null;
  var progressStartedAt = 0;
  var fsHideTimer = null;
  var clockTimer = null;
  var syncTimer = null;
  var pairPollTimer = null;
  var pairCountdownTimer = null;
  var wakeLockSentinel = null;
  var keepAwakeVideo = null;
  var preloadedImage = null;
  var touchStartX = 0;
  var touchStartY = 0;
  var suppressNextStageClick = false;
  var lastSlidesSyncAt = 0;

  // =========================================================================
  // Safe ES5 DOM Helpers (Zero innerHTML with dynamic data)
  // =========================================================================

  function el(tag, className, textContent) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (textContent !== undefined && textContent !== null) {
      node.appendChild(document.createTextNode(String(textContent)));
    }
    return node;
  }

  function svgEl(tag, attrs) {
    var ns = 'http://www.w3.org/2000/svg';
    var node = document.createElementNS(ns, tag);
    if (attrs) {
      for (var k in attrs) {
        if (attrs.hasOwnProperty(k)) {
          node.setAttribute(k, String(attrs[k]));
        }
      }
    }
    return node;
  }

  function buildBrandLogo() {
    var wrap = el('span', 'hf-brand');

    // Geometric framed-photo emblem (pure inline SVG, works on Android 4.4+ / Chrome 25+)
    if (document.createElementNS) {
      var mark = el('span', 'hf-brand-mark');
      var svg = svgEl('svg', {
        width: '28',
        height: '28',
        viewBox: '0 0 28 28',
        'aria-hidden': 'true',
        focusable: 'false'
      });
      // Outer warm terracotta frame
      svg.appendChild(
        svgEl('rect', {
          x: '1.5',
          y: '3',
          width: '25',
          height: '22',
          rx: '4.5',
          fill: '#c2591a'
        })
      );
      // Inner cream gallery mat
      svg.appendChild(
        svgEl('rect', {
          x: '4.5',
          y: '6',
          width: '19',
          height: '16',
          rx: '2',
          fill: '#fff8ef'
        })
      );
      // Warm glowing sun
      svg.appendChild(
        svgEl('circle', {
          cx: '10',
          cy: '11',
          r: '2.2',
          fill: '#e88b3a'
        })
      );
      // Foreground hills silhouette inside the frame
      svg.appendChild(
        svgEl('path', {
          d: 'M4.5 19.5 L10.8 14 L15.2 17.6 L18.8 13.4 L23.5 19.5 L23.5 22 L4.5 22 Z',
          fill: '#2b241d'
        })
      );
      mark.appendChild(svg);
      wrap.appendChild(mark);
    }

    var wordmark = el('span', 'hf-brand-wordmark');
    wordmark.appendChild(el('span', 'hf-brand-hearth', 'Hearth'));
    wordmark.appendChild(el('span', 'hf-brand-frame', 'Frame'));
    wrap.appendChild(wordmark);
    return wrap;
  }

  function clearNode(node) {
    while (node && node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function addClass(node, cls) {
    if (!node) return;
    var current = ' ' + (node.className || '') + ' ';
    if (current.indexOf(' ' + cls + ' ') === -1) {
      node.className = (node.className ? node.className + ' ' : '') + cls;
    }
  }

  function removeClass(node, cls) {
    if (!node) return;
    var parts = (node.className || '').split(/\s+/);
    var kept = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] && parts[i] !== cls) {
        kept.push(parts[i]);
      }
    }
    node.className = kept.join(' ');
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return 'Optimized';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (Math.round((bytes / (1024 * 1024)) * 10) / 10) + ' MB';
  }

  function formatClockTime() {
    var d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    var hh = h < 10 ? '0' + h : String(h);
    var mm = m < 10 ? '0' + m : String(m);
    return hh + ':' + mm;
  }

  // =========================================================================
  // Non-Sensitive Browser Preference: Last Chosen Display Profile ID Only
  // (Never stores any auth tokens, passwords, or usernames)
  // =========================================================================

  var PROFILE_PREF_KEY = 'hf_last_profile_id';

  function isValidProfileIdFormat(val) {
    return typeof val === 'string' && /^[A-Za-z0-9_-]{2,64}$/.test(val);
  }

  function getScopedProfilePrefKey() {
    if (state.workspaceId && /^[A-Za-z0-9_-]{2,40}$/.test(state.workspaceId)) {
      return 'hf_last_profile_' + state.workspaceId;
    }
    return PROFILE_PREF_KEY;
  }

  function readPrefKey(key) {
    try {
      if (window.localStorage) {
        var stored = window.localStorage.getItem(key);
        if (isValidProfileIdFormat(stored)) {
          return stored;
        }
      }
    } catch (e) {}
    try {
      var raw = document.cookie || '';
      var prefix = key + '=';
      var parts = raw.split(';');
      for (var i = 0; i < parts.length; i++) {
        var trimmed = parts[i].replace(/^\s+|\s+$/g, '');
        if (trimmed.indexOf(prefix) === 0) {
          var decoded = decodeURIComponent(trimmed.slice(prefix.length));
          if (isValidProfileIdFormat(decoded)) {
            return decoded;
          }
        }
      }
    } catch (e) {}
    return null;
  }

  function saveRememberedProfileId(profileId) {
    if (!isValidProfileIdFormat(profileId)) return;
    var key = getScopedProfilePrefKey();
    try {
      if (window.localStorage) {
        window.localStorage.setItem(key, profileId);
      }
    } catch (e) {}
    try {
      var maxAge = 60 * 60 * 24 * 365;
      document.cookie =
        key +
        '=' +
        encodeURIComponent(profileId) +
        '; Path=/; Max-Age=' +
        maxAge +
        '; SameSite=Lax';
    } catch (e) {}
  }

  function getRememberedProfileId() {
    var scopedKey = getScopedProfilePrefKey();
    var val = readPrefKey(scopedKey);
    if (val) return val;
    if (scopedKey !== PROFILE_PREF_KEY && state.workspaceId === 'owner') {
      return readPrefKey(PROFILE_PREF_KEY);
    }
    return null;
  }

  // =========================================================================
  // Legacy XMLHttpRequest Network Layer (Zero fetch / Zero Promise)
  // =========================================================================

  function apiRequest(method, url, body, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.withCredentials = true;
    xhr.timeout = 25000;
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    if (state.token) {
      xhr.setRequestHeader('Authorization', 'Bearer ' + state.token);
    }
    if (body !== null && body !== undefined) {
      xhr.setRequestHeader('Content-Type', 'application/json');
    }

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var parsed = null;
      if (xhr.responseText) {
        try {
          parsed = JSON.parse(xhr.responseText);
        } catch (e) {
          parsed = null;
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        callback(null, parsed);
      } else if (
        xhr.status === 401 &&
        (state.authenticated || state.token) &&
        url !== '/api/auth/login'
      ) {
        handleSessionExpired();
        callback((parsed && parsed.error) || 'Session expired. Please sign in again.', null);
      } else {
        var msg =
          (parsed && parsed.error) ||
          (xhr.status === 0
            ? 'Network unreachable. Check your Wi-Fi connection and try again.'
            : 'Request failed (' + xhr.status + ').');
        callback(msg, parsed);
      }
    };

    xhr.ontimeout = function () {
      callback('Connection timed out on slow network. Please try again.', null);
    };

    xhr.onerror = function () {
      callback('Network connection error. Please check your Wi-Fi.', null);
    };

    try {
      xhr.send(body !== null && body !== undefined ? JSON.stringify(body) : null);
    } catch (err) {
      callback('Unable to send network request.', null);
    }
  }

  function handleSessionExpired() {
    stopAllTimers();
    disableKeepScreenAwake();
    exitFullscreenMode(true);
    state.authenticated = false;
    state.token = null;
    state.role = null;
    state.username = null;
    state.workspaceId = null;
    state.isOwner = false;
    state.view = 'portal';
    state.slides = [];
    state.profiles = [];
    state.selectedProfileId = null;
    state.selectedProfile = null;
    state.ownerAccounts = [];
    render();
  }

  // =========================================================================
  // Client-Side Image Optimization for Slow Networks (Legacy Canvas + FileReader)
  // =========================================================================

  function getBandwidthProfile() {
    if (state.settings.bandwidthMode === 'low') {
      return { maxDim: 800, quality: 0.7 };
    }
    if (state.settings.bandwidthMode === 'high') {
      return { maxDim: 1600, quality: 0.84 };
    }
    return { maxDim: 1280, quality: 0.78 };
  }

  function resizeDataUrl(dataUrl, maxDim, quality, callback) {
    var img = new Image();
    img.onload = function () {
      try {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (!w || !h) {
          callback(dataUrl);
          return;
        }
        var scale = 1;
        if (w > maxDim || h > maxDim) {
          scale = Math.min(maxDim / w, maxDim / h);
        }
        var targetW = Math.max(1, Math.round(w * scale));
        var targetH = Math.max(1, Math.round(h * scale));
        var canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        var ctx = canvas.getContext('2d');
        if (!ctx) {
          callback(dataUrl);
          return;
        }
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);
        var out = canvas.toDataURL('image/jpeg', quality);
        if (out && out.indexOf('data:image/') === 0) {
          callback(out);
        } else {
          callback(dataUrl);
        }
      } catch (e) {
        callback(dataUrl);
      }
    };
    img.onerror = function () {
      callback(dataUrl);
    };
    img.src = dataUrl;
  }

  function prepareImageFile(file, callback) {
    if (typeof FileReader === 'undefined') {
      callback('Your browser does not support file uploads.', null);
      return;
    }
    var reader = new FileReader();
    reader.onload = function (ev) {
      var rawDataUrl = ev.target && ev.target.result;
      if (!rawDataUrl || typeof rawDataUrl !== 'string') {
        callback('Could not read file.', null);
        return;
      }
      var profile = getBandwidthProfile();
      resizeDataUrl(rawDataUrl, profile.maxDim, profile.quality, function (displayData) {
        resizeDataUrl(rawDataUrl, 360, 0.72, function (thumbData) {
          callback(null, {
            displayData: displayData,
            thumbData: thumbData,
            originalBytes: file.size || 0,
            optimizedBytes: Math.round((displayData.length * 3) / 4)
          });
        });
      });
    };
    reader.onerror = function () {
      callback('Failed to read selected file.', null);
    };
    reader.readAsDataURL(file);
  }

  // =========================================================================
  // Fullscreen Management (Native Vendor-Prefixed + CSS Viewport Fallback)
  // =========================================================================

  function getNativeFullscreenElement() {
    return (
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement ||
      null
    );
  }

  function requestNativeFullscreen(target) {
    try {
      var fn =
        target.requestFullscreen ||
        target.webkitRequestFullscreen ||
        target.webkitRequestFullScreen ||
        target.mozRequestFullScreen ||
        target.msRequestFullscreen;
      if (fn) {
        var res = fn.call(target);
        if (res && typeof res.catch === 'function') {
          res.catch(function () {
            // Pseudo-fullscreen CSS class remains active as seamless fallback
          });
        }
      }
    } catch (e) {
      // Fallback handled by CSS class
    }
  }

  function exitNativeFullscreen() {
    try {
      if (!getNativeFullscreenElement()) return;
      var fn =
        document.exitFullscreen ||
        document.webkitExitFullscreen ||
        document.webkitCancelFullScreen ||
        document.mozCancelFullScreen ||
        document.msExitFullscreen;
      if (fn) {
        var res = fn.call(document);
        if (res && typeof res.catch === 'function') {
          res.catch(function () {});
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  // =========================================================================
  // 2-Layer Keep Screen Awake (Native Wake Lock + Legacy Silent Video Loop)
  // =========================================================================

  function ensureKeepAwakeVideo() {
    if (keepAwakeVideo) {
      return keepAwakeVideo;
    }
    try {
      var video = document.createElement('video');
      video.id = 'hf-keepawake-video';
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.playsInline = true;
      video.setAttribute('muted', '');
      video.setAttribute('loop', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.setAttribute('preload', 'none');
      video.setAttribute('aria-hidden', 'true');
      video.style.position = 'fixed';
      video.style.width = '2px';
      video.style.height = '2px';
      video.style.right = '0';
      video.style.bottom = '0';
      video.style.opacity = '0.001';
      video.style.pointerEvents = 'none';
      video.style.zIndex = '-1';

      var srcMp4 = document.createElement('source');
      srcMp4.src = '/keepawake.mp4';
      srcMp4.type = 'video/mp4';
      video.appendChild(srcMp4);

      var srcWebm = document.createElement('source');
      srcWebm.src = '/keepawake.webm';
      srcWebm.type = 'video/webm';
      video.appendChild(srcWebm);

      // Guard against legacy Chrome loop stalls on short videos
      video.addEventListener(
        'timeupdate',
        function () {
          try {
            if (video.currentTime && video.currentTime > 8.5) {
              video.currentTime = 0.2;
            }
          } catch (e) {}
        },
        false
      );

      video.addEventListener(
        'pause',
        function () {
          if (state.keepAwakeMode === 'video') {
            state.keepAwakeActive = false;
            refreshPlaybackButtons();
          }
        },
        false
      );

      video.addEventListener(
        'playing',
        function () {
          state.keepAwakeActive = true;
          state.keepAwakeMode = 'video';
          refreshPlaybackButtons();
        },
        false
      );

      if (document.body) {
        document.body.appendChild(video);
      }
      keepAwakeVideo = video;
      return video;
    } catch (e) {
      return null;
    }
  }

  function startLegacyVideoKeepAwake() {
    try {
      var video = ensureKeepAwakeVideo();
      if (!video) return;
      video.muted = true;
      if (!video.paused) {
        state.keepAwakeActive = true;
        state.keepAwakeMode = 'video';
        refreshPlaybackButtons();
        return;
      }
      var res = video.play();
      if (res && typeof res.then === 'function') {
        res.then(
          function () {
            state.keepAwakeActive = true;
            state.keepAwakeMode = 'video';
            refreshPlaybackButtons();
          },
          function () {
            // Autoplay blocked until next user tap; fail silently without disrupting slideshow
          }
        );
      } else {
        // Legacy Chrome (<50) play() returns undefined synchronously
        state.keepAwakeActive = true;
        state.keepAwakeMode = 'video';
        refreshPlaybackButtons();
      }
    } catch (e) {
      // Never break slideshow if video playback is unsupported
    }
  }

  function stopLegacyVideoKeepAwake() {
    try {
      if (keepAwakeVideo && !keepAwakeVideo.paused) {
        keepAwakeVideo.pause();
      }
    } catch (e) {}
  }

  function enableKeepScreenAwake(fromUserGesture) {
    if (!state.keepAwakeEnabled) {
      disableKeepScreenAwake();
      return;
    }
    if (state.view !== 'visitor') {
      return;
    }

    // Layer 1: Modern Native Screen Wake Lock API (Chrome 84+, iPadOS 16.4+)
    try {
      if (navigator.wakeLock && typeof navigator.wakeLock.request === 'function') {
        if (wakeLockSentinel) {
          state.keepAwakeActive = true;
          state.keepAwakeMode = 'native';
          refreshPlaybackButtons();
          return;
        }
        var req = navigator.wakeLock.request('screen');
        if (req && typeof req.then === 'function') {
          req.then(
            function (sentinel) {
              wakeLockSentinel = sentinel;
              state.keepAwakeActive = true;
              state.keepAwakeMode = 'native';
              stopLegacyVideoKeepAwake();
              try {
                if (sentinel && sentinel.addEventListener) {
                  sentinel.addEventListener(
                    'release',
                    function () {
                      wakeLockSentinel = null;
                      if (state.keepAwakeMode === 'native') {
                        state.keepAwakeActive = false;
                        refreshPlaybackButtons();
                      }
                    },
                    false
                  );
                }
              } catch (e) {}
              refreshPlaybackButtons();
            },
            function () {
              // Native Wake Lock rejected (e.g. iframe policy or older WebView) -> Layer 2
              if (fromUserGesture) {
                startLegacyVideoKeepAwake();
              }
            }
          );
          return;
        }
      }
    } catch (e) {
      // Fall through to Layer 2
    }

    // Layer 2: Legacy Old Android Chrome Silent Video Fallback
    startLegacyVideoKeepAwake();
  }

  function disableKeepScreenAwake() {
    try {
      if (wakeLockSentinel && typeof wakeLockSentinel.release === 'function') {
        var rel = wakeLockSentinel.release();
        if (rel && typeof rel.then === 'function') {
          rel.then(function () {}, function () {});
        }
        wakeLockSentinel = null;
      }
    } catch (e) {
      wakeLockSentinel = null;
    }
    stopLegacyVideoKeepAwake();
    state.keepAwakeActive = false;
    state.keepAwakeMode = '';
    refreshPlaybackButtons();
  }

  function toggleKeepScreenAwake() {
    state.keepAwakeEnabled = !state.keepAwakeEnabled;
    if (state.keepAwakeEnabled) {
      enableKeepScreenAwake(true);
    } else {
      disableKeepScreenAwake();
    }
    refreshPlaybackButtons();
  }

  function enterFullscreenMode() {
    state.isFullscreen = true;
    state.fsControlsVisible = true;
    addClass(document.body, 'hf-is-fullscreen');
    var stageShell = document.getElementById('hf-stage-shell');
    if (stageShell) {
      requestNativeFullscreen(stageShell);
    }
    if (state.keepAwakeEnabled) {
      enableKeepScreenAwake(true);
    }
    updateFullscreenOverlayUI();
    scheduleFsControlsHide(3500);
  }

  function exitFullscreenMode(skipNative) {
    state.isFullscreen = false;
    state.fsControlsVisible = false;
    clearFsHideTimer();
    removeClass(document.body, 'hf-is-fullscreen');
    if (!skipNative) {
      exitNativeFullscreen();
    }
    if (state.view !== 'visitor') {
      disableKeepScreenAwake();
    }
    updateFullscreenOverlayUI();
  }

  function toggleFsControls(forceVisible) {
    if (!state.isFullscreen) return;
    if (typeof forceVisible === 'boolean') {
      state.fsControlsVisible = forceVisible;
    } else {
      state.fsControlsVisible = !state.fsControlsVisible;
    }
    updateFullscreenOverlayUI();
    if (state.fsControlsVisible) {
      scheduleFsControlsHide(5000);
    } else {
      clearFsHideTimer();
    }
  }

  function clearFsHideTimer() {
    if (fsHideTimer) {
      clearTimeout(fsHideTimer);
      fsHideTimer = null;
    }
  }

  function scheduleFsControlsHide(delayMs) {
    clearFsHideTimer();
    if (state.isFullscreen && state.fsControlsVisible && state.playing) {
      fsHideTimer = setTimeout(function () {
        state.fsControlsVisible = false;
        updateFullscreenOverlayUI();
      }, delayMs || 5000);
    }
  }

  function updateFullscreenOverlayUI() {
    var fsBar = document.getElementById('hf-fs-controls');
    if (fsBar) {
      if (state.isFullscreen && state.fsControlsVisible) {
        addClass(fsBar, 'hf-fs-controls-visible');
      } else {
        removeClass(fsBar, 'hf-fs-controls-visible');
      }
    }
    var passive = document.getElementById('hf-passive-overlay');
    if (passive) {
      if (state.isFullscreen && state.fsControlsVisible) {
        passive.style.display = 'none';
      } else {
        passive.style.display =
          state.settings.showCaption || state.settings.showClock ? 'block' : 'none';
      }
    }
  }

  function handleNativeFullscreenChange() {
    if (!getNativeFullscreenElement() && state.isFullscreen) {
      // User pressed hardware Back or Esc out of native fullscreen
      exitFullscreenMode(true);
    }
  }

  // =========================================================================
  // Slideshow Engine (Lightweight, Single-Next Preloader, Low RAM)
  // =========================================================================

  function stopSlideTimers() {
    if (slideTimer) {
      clearTimeout(slideTimer);
      slideTimer = null;
    }
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  }

  function stopPairingTimers() {
    if (pairPollTimer) {
      clearInterval(pairPollTimer);
      pairPollTimer = null;
    }
    if (pairCountdownTimer) {
      clearInterval(pairCountdownTimer);
      pairCountdownTimer = null;
    }
  }

  function stopAllTimers() {
    stopSlideTimers();
    clearFsHideTimer();
    stopPairingTimers();
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
  }

  function formatPairCodeText(raw) {
    if (!raw || typeof raw !== 'string') return '';
    var cleaned = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (cleaned.length > 6) {
      cleaned = cleaned.slice(0, 6);
    }
    if (cleaned.length > 3) {
      return cleaned.slice(0, 3) + '-' + cleaned.slice(3);
    }
    return cleaned;
  }

  function formatCountdown(msRemaining) {
    var secs = Math.max(0, Math.ceil(msRemaining / 1000));
    var mins = Math.floor(secs / 60);
    var rem = secs % 60;
    return mins + ':' + (rem < 10 ? '0' + rem : String(rem));
  }

  function extractPairCodeFromUrl() {
    try {
      var search = window.location.search || '';
      if (!search || search.indexOf('pair=') === -1) return;
      var query = search.charAt(0) === '?' ? search.slice(1) : search;
      var parts = query.split('&');
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split('=');
        if (kv[0] === 'pair' && kv.length > 1) {
          var decoded = decodeURIComponent(kv[1]).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
          if (/^[A-Z0-9]{6}$/.test(decoded)) {
            state.pendingPairCodeFromUrl = formatPairCodeText(decoded);
            state.pairApproveInput = state.pendingPairCodeFromUrl;
          }
          break;
        }
      }
      if (state.pendingPairCodeFromUrl && window.history && window.history.replaceState) {
        window.history.replaceState(null, document.title, window.location.pathname || '/');
      }
    } catch (e) {
      // Ignore on very old browsers
    }
  }

  function updatePairCountdownDOM() {
    var node = document.getElementById('hf-pair-countdown');
    if (!node || state.pairStatus !== 'pending') return;
    var rem = state.pairExpiresAt - new Date().getTime();
    if (rem <= 0) {
      stopPairingTimers();
      state.pairStatus = 'expired';
      render();
      return;
    }
    clearNode(node);
    node.appendChild(document.createTextNode('Expires in ' + formatCountdown(rem)));
  }

  function pollTvPairingStatus() {
    if (!state.pairPollToken || state.pairStatus !== 'pending' || state.visitorPortalMode !== 'pair') {
      stopPairingTimers();
      return;
    }
    var tokenNow = state.pairPollToken;
    apiRequest(
      'GET',
      '/api/auth/pair/status?t=' + encodeURIComponent(tokenNow),
      null,
      function (err, data) {
        if (tokenNow !== state.pairPollToken || state.visitorPortalMode !== 'pair') {
          return;
        }
        if (err || !data) {
          return;
        }
        if (data.status === 'expired') {
          stopPairingTimers();
          state.pairStatus = 'expired';
          render();
          return;
        }
        if (data.status === 'approved' && data.token) {
          stopPairingTimers();
          state.pairStatus = 'idle';
          state.pairPollToken = '';
          state.pairCode = '';
          state.pairDisplayCode = '';
          state.pairQrUrl = '';
          state.visitorPortalMode = 'login';
          state.authenticated = true;
          state.token = data.token;
          state.role = data.role || 'visitor';
          state.username = data.username || '';
          state.workspaceId = data.workspaceId || null;
          state.isOwner = Boolean(data.isOwner);
          state.setupSuccess = '';
          loadVisitorProfilesAndStart(data.profileId || null, false);
        }
      }
    );
  }

  function startTvPairing() {
    stopPairingTimers();
    state.pairLoading = true;
    state.pairError = '';
    state.pairStatus = 'idle';
    state.pairCode = '';
    state.pairDisplayCode = '';
    state.pairPollToken = '';
    state.pairQrUrl = '';
    render();

    apiRequest('POST', '/api/auth/pair/start', {}, function (err, data) {
      state.pairLoading = false;
      if (err || !data || !data.pollToken || !data.displayCode) {
        state.pairStatus = 'error';
        state.pairError = err || 'Could not generate pairing code. Please try again.';
        render();
        return;
      }
      state.pairCode = data.code || '';
      state.pairDisplayCode = data.displayCode;
      state.pairPollToken = data.pollToken;
      state.pairQrUrl = data.qrUrl || ('/api/auth/pair/qr?t=' + encodeURIComponent(data.pollToken));
      state.pairExpiresAt = new Date().getTime() + (data.expiresInSeconds || 300) * 1000;
      state.pairStatus = 'pending';
      render();

      pairCountdownTimer = setInterval(updatePairCountdownDOM, 1000);
      pairPollTimer = setInterval(pollTvPairingStatus, 3000);
    });
  }

  function preloadNextSlide() {
    if (state.slides.length < 2) return;
    var nextIdx = (state.currentIndex + 1) % state.slides.length;
    var nextSlide = state.slides[nextIdx];
    if (!nextSlide || !nextSlide.displayUrl) return;
    preloadedImage = new Image();
    preloadedImage.src = nextSlide.displayUrl;
  }

  function startSlideCycle() {
    stopSlideTimers();
    var fillEl = document.getElementById('hf-progress-fill');
    if (fillEl) {
      fillEl.style.width = '0%';
    }
    if (!state.playing || !state.localAutoRotate || state.slides.length < 2) {
      return;
    }
    var durationMs = Math.max(2, state.localInterval) * 1000;
    progressStartedAt = new Date().getTime();

    slideTimer = setTimeout(function () {
      goToSlide(state.currentIndex + 1);
    }, durationMs);

    // Lightweight 250ms tick for low-CPU legacy tablets
    progressTimer = setInterval(function () {
      var bar = document.getElementById('hf-progress-fill');
      if (!bar) return;
      var elapsed = new Date().getTime() - progressStartedAt;
      var pct = Math.min(100, Math.round((elapsed / durationMs) * 100));
      bar.style.width = pct + '%';
    }, 250);
  }

  function goToSlide(targetIndex) {
    if (!state.slides.length) return;
    var total = state.slides.length;
    var normalized = ((targetIndex % total) + total) % total;
    state.currentIndex = normalized;
    updateActiveSlideDOM();
    startSlideCycle();
  }

  function updateActiveSlideDOM() {
    var slide = state.slides[state.currentIndex];
    if (!slide) return;

    var imgEl = document.getElementById('hf-stage-img');
    var fallbackEl = document.getElementById('hf-stage-fallback');
    var fallbackTitle = document.getElementById('hf-stage-fallback-title');

    if (imgEl) {
      var useFade = state.settings.transition === 'fade';
      if (useFade) {
        addClass(imgEl, 'hf-stage-img-fading');
      }
      imgEl.className =
        'hf-stage-img ' +
        (state.localFitMode === 'cover'
          ? 'hf-stage-img-cover'
          : 'hf-stage-img-contain') +
        (useFade ? ' hf-stage-img-fading' : '');

      var applySrc = function () {
        if (fallbackEl) fallbackEl.style.display = 'none';
        imgEl.style.display = 'block';
        imgEl.alt = slide.title || 'Household photo';
        imgEl.onload = function () {
          removeClass(imgEl, 'hf-stage-img-fading');
          preloadNextSlide();
        };
        imgEl.onerror = function () {
          imgEl.style.display = 'none';
          if (fallbackTitle) {
            clearNode(fallbackTitle);
            fallbackTitle.appendChild(
              document.createTextNode(slide.title || 'Photo unavailable')
            );
          }
          if (fallbackEl) fallbackEl.style.display = 'block';
        };
        imgEl.src = slide.displayUrl;
      };

      if (useFade) {
        setTimeout(applySrc, 120);
      } else {
        applySrc();
      }
    }

    var counterText = (state.currentIndex + 1) + ' / ' + state.slides.length;

    var passiveTitle = document.getElementById('hf-passive-title');
    if (passiveTitle) {
      clearNode(passiveTitle);
      passiveTitle.appendChild(document.createTextNode(slide.title || ''));
    }
    var passiveCaption = document.getElementById('hf-passive-caption');
    if (passiveCaption) {
      clearNode(passiveCaption);
      passiveCaption.appendChild(document.createTextNode(slide.caption || ''));
    }
    var passiveCounter = document.getElementById('hf-passive-counter');
    if (passiveCounter) {
      clearNode(passiveCounter);
      passiveCounter.appendChild(document.createTextNode(counterText));
    }

    var fsTitle = document.getElementById('hf-fs-title');
    if (fsTitle) {
      clearNode(fsTitle);
      fsTitle.appendChild(document.createTextNode(slide.title || 'Untitled Photo'));
    }
    var fsMeta = document.getElementById('hf-fs-meta');
    if (fsMeta) {
      clearNode(fsMeta);
      var metaParts = [counterText];
      if (slide.caption) metaParts.push(slide.caption);
      if (state.settings.showClock) metaParts.push(formatClockTime());
      fsMeta.appendChild(document.createTextNode(metaParts.join('  \u00B7  ')));
    }

    // Highlight active thumbnail in filmstrip
    var strip = document.getElementById('hf-filmstrip');
    if (strip) {
      var buttons = strip.getElementsByTagName('button');
      for (var i = 0; i < buttons.length; i++) {
        if (i === state.currentIndex) {
          addClass(buttons[i], 'hf-thumb-item-active');
        } else {
          removeClass(buttons[i], 'hf-thumb-item-active');
        }
      }
    }
  }

  function updateClockDOM() {
    var nowStr = formatClockTime();
    var passiveClock = document.getElementById('hf-passive-clock');
    if (passiveClock) {
      clearNode(passiveClock);
      passiveClock.appendChild(document.createTextNode(nowStr));
    }
  }

  function startVisitorBackgroundTasks() {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(updateClockDOM, 15000);

    // Gently sync new slides/settings from server every 2 minutes to minimize Cloud Run requests
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(function () {
      if (state.view !== 'visitor' || !(state.authenticated || state.token)) return;
      var syncUrl = '/api/slides';
      if (state.selectedProfileId) {
        syncUrl += '?profileId=' + encodeURIComponent(state.selectedProfileId);
      }
      apiRequest('GET', syncUrl, null, function (err, data) {
        if (err || !data) return;
        var nowMs = new Date().getTime();
        var urlsStale = nowMs - lastSlidesSyncAt > 6 * 60 * 60 * 1000;
        if (data.profiles) {
          state.profiles = data.profiles;
        }
        if (data.updatedAt && data.updatedAt !== state.updatedAt) {
          var wasFs = state.isFullscreen;
          lastSlidesSyncAt = nowMs;
          state.updatedAt = data.updatedAt;
          state.slides = data.slides || [];
          state.selectedProfile = data.selectedProfile || state.selectedProfile;
          if (state.selectedProfile && state.selectedProfile.id) {
            state.selectedProfileId = state.selectedProfile.id;
          }
          state.settings = data.settings || state.settings;
          state.frameTitle = state.settings.frameTitle || state.frameTitle;
          state.localInterval = state.settings.intervalSeconds || 8;
          state.localAutoRotate = state.settings.autoRotate !== false;
          state.localFitMode = state.settings.fitMode || 'contain';
          if (state.currentIndex >= state.slides.length) {
            state.currentIndex = 0;
          }
          render();
          if (wasFs) {
            addClass(document.body, 'hf-is-fullscreen');
            state.isFullscreen = true;
            updateFullscreenOverlayUI();
          }
        } else if (urlsStale && data.slides) {
          // Silently swap in fresh signed URLs every 6h for 24/7 tablets
          lastSlidesSyncAt = nowMs;
          state.slides = data.slides;
        }
      });
    }, 120000);
  }

  // =========================================================================
  // Data Loading & Actions
  // =========================================================================

  function loadAuthStatus() {
    state.loading = true;
    render();
    apiRequest('GET', '/api/auth/status', null, function (err, data) {
      state.loading = false;
      if (!err && data) {
        state.initialized = Boolean(data.initialized);
        state.ownerConfigured =
          data.ownerConfigured !== undefined
            ? Boolean(data.ownerConfigured)
            : Boolean(data.initialized);
        state.signupEnabled = data.signupEnabled !== false;
        state.inviteRequired = Boolean(data.inviteRequired);
        state.hasEnvAdmin = Boolean(data.hasEnvAdmin);
        state.hasEnvVisitor = Boolean(data.hasEnvVisitor);
        if (data.frameTitle) {
          state.frameTitle = data.frameTitle;
        }
        if (data.limits) {
          if (typeof data.limits.maxAccounts === 'number') {
            state.limits.maxAccounts = data.limits.maxAccounts;
          }
          if (typeof data.limits.photoLimit === 'number') {
            state.limits.photoLimit = data.limits.photoLimit;
          }
          if (typeof data.limits.signupRatePerHour === 'number') {
            state.limits.signupRatePerHour = data.limits.signupRatePerHour;
          }
        }
        if (data.session && data.session.role) {
          state.authenticated = true;
          state.role = data.session.role;
          state.username = data.session.username || '';
          state.workspaceId = data.session.workspaceId || null;
          state.isOwner = Boolean(data.session.isOwner);
          if (data.session.role === 'admin') {
            state.view = 'admin';
            state.adminTab = state.pendingPairCodeFromUrl ? 'access' : 'gallery';
            loadAdminData();
            return;
          }
          if (data.session.role === 'visitor') {
            if (state.pendingPairCodeFromUrl) {
              // Phone opened a QR pairing link while logged into Frontend view — show portal so Admin can sign in to approve
              state.visitorPortalMode = 'login';
              state.view = 'portal';
              render();
              return;
            }
            loadVisitorProfilesAndStart(null, true);
            return;
          }
        }
      }
      if (state.pendingPairCodeFromUrl) {
        state.visitorPortalMode = 'login';
        render();
        return;
      }
      if (state.visitorPortalMode === 'pair' && state.pairStatus === 'idle' && !state.pairLoading) {
        startTvPairing();
        return;
      }
      render();
    });
  }

  function applyVisitorSlidesResponse(data) {
    lastSlidesSyncAt = new Date().getTime();
    state.updatedAt = data.updatedAt || '';
    state.profiles = data.profiles || [];
    state.selectedProfile = data.selectedProfile || null;
    state.selectedProfileId = state.selectedProfile ? state.selectedProfile.id : null;
    if (state.selectedProfileId && state.role === 'visitor') {
      saveRememberedProfileId(state.selectedProfileId);
    }
    state.slides = data.slides || [];
    state.settings = data.settings || state.settings;
    state.frameTitle = state.settings.frameTitle || state.frameTitle;
    state.localInterval = state.settings.intervalSeconds || 8;
    state.localAutoRotate = state.settings.autoRotate !== false;
    state.localFitMode = state.settings.fitMode || 'contain';
    state.playing = true;
    state.currentIndex = 0;
    state.view = 'visitor';
    render();
    startSlideCycle();
    startVisitorBackgroundTasks();
    if (state.keepAwakeEnabled) {
      enableKeepScreenAwake(false);
    }
  }

  function openVisitorProfile(profileId) {
    stopAllTimers();
    disableKeepScreenAwake();
    exitFullscreenMode(false);
    if (profileId && state.role === 'visitor') {
      saveRememberedProfileId(profileId);
    }
    state.loading = true;
    render();
    var url = '/api/slides';
    if (profileId) {
      url += '?profileId=' + encodeURIComponent(profileId);
    }
    apiRequest('GET', url, null, function (err, data) {
      state.loading = false;
      if (err || !data) {
        state.portalErrorVisitor = err || 'Could not load slideshow.';
        render();
        return;
      }
      applyVisitorSlidesResponse(data);
    });
  }

  function loadVisitorProfilesAndStart(preferredProfileId, useRemembered) {
    if (preferredProfileId) {
      openVisitorProfile(preferredProfileId);
      return;
    }
    stopAllTimers();
    disableKeepScreenAwake();
    exitFullscreenMode(false);
    state.loading = true;
    render();
    apiRequest('GET', '/api/slides', null, function (err, data) {
      state.loading = false;
      if (err || !data) {
        state.portalErrorVisitor = err || 'Could not load slideshow.';
        render();
        return;
      }
      state.profiles = data.profiles || [];
      state.settings = data.settings || state.settings;
      state.frameTitle = state.settings.frameTitle || state.frameTitle;

      if (useRemembered && state.profiles.length > 0) {
        var rememberedId = getRememberedProfileId();
        if (rememberedId) {
          var matched = false;
          for (var i = 0; i < state.profiles.length; i++) {
            if (state.profiles[i].id === rememberedId) {
              matched = true;
              break;
            }
          }
          if (matched) {
            if (data.selectedProfile && data.selectedProfile.id === rememberedId) {
              applyVisitorSlidesResponse(data);
            } else {
              openVisitorProfile(rememberedId);
            }
            return;
          }
        }
      }

      if (state.profiles.length > 1) {
        state.view = 'chooser';
        render();
      } else {
        applyVisitorSlidesResponse(data);
      }
    });
  }

  function loadAdminData(callback) {
    apiRequest('GET', '/api/slides?includeDisabled=1&allProfiles=1', null, function (err, data) {
      if (err || !data) {
        state.adminError = err || 'Could not load gallery data.';
        if (callback) callback();
        render();
        return;
      }
      state.updatedAt = data.updatedAt || '';
      if (data.workspaceId) {
        state.workspaceId = data.workspaceId;
      }
      if (data.isOwner !== undefined) {
        state.isOwner = Boolean(data.isOwner);
      }
      state.profiles = data.profiles || [];
      state.slides = data.slides || [];
      state.settings = data.settings || state.settings;
      state.frameTitle = state.settings.frameTitle || state.frameTitle;
      if (data.quota) {
        state.quota = data.quota;
      } else {
        state.quota = { used: state.slides.length, limit: null };
      }
      if (data.hasVisitorLogin !== undefined) {
        state.hasVisitorLogin = Boolean(data.hasVisitorLogin);
      }
      if (data.storage) {
        state.storage = data.storage;
      }
      if (state.galleryFilterProfileId !== 'all') {
        var foundFilter = false;
        for (var i = 0; i < state.profiles.length; i++) {
          if (state.profiles[i].id === state.galleryFilterProfileId) {
            foundFilter = true;
            break;
          }
        }
        if (!foundFilter) {
          state.galleryFilterProfileId = 'all';
        }
      }
      apiRequest('GET', '/api/admin/access-info', null, function (accErr, accData) {
        if (!accErr && accData) {
          state.accessInfo = accData;
          state.hasVisitorLogin = Boolean(accData.hasVisitorLogin);
          if (accData.isOwner !== undefined) {
            state.isOwner = Boolean(accData.isOwner);
          }
        }
        if (state.isOwner && state.adminTab === 'accounts') {
          loadOwnerAccounts(callback);
          return;
        }
        if (callback) callback();
        render();
      });
    });
  }

  function loadOwnerAccounts(callback) {
    if (!state.isOwner) {
      if (callback) callback();
      return;
    }
    state.ownerAccountsLoading = true;
    render();
    apiRequest('GET', '/api/owner/accounts', null, function (err, data) {
      state.ownerAccountsLoading = false;
      if (err || !data) {
        state.adminError = err || 'Could not load registered accounts.';
      } else {
        state.ownerAccounts = data.accounts || [];
        state.ownerMaxAccounts = data.maxAccounts || 100;
        state.ownerInviteRequired = Boolean(data.inviteRequired);
      }
      if (callback) callback();
      render();
    });
  }

  function signOut() {
    stopAllTimers();
    disableKeepScreenAwake();
    exitFullscreenMode(false);
    if (state.authenticated || state.token) {
      apiRequest('POST', '/api/auth/logout', {}, function () {});
    }
    state.authenticated = false;
    state.token = null;
    state.role = null;
    state.username = null;
    state.workspaceId = null;
    state.isOwner = false;
    state.view = 'portal';
    state.adminTab = 'gallery';
    state.adminPortalMode = 'login';
    state.visitorPortalMode = 'pair';
    state.pairStatus = 'idle';
    state.pairCode = '';
    state.pairDisplayCode = '';
    state.pairPollToken = '';
    state.pairQrUrl = '';
    state.slides = [];
    state.profiles = [];
    state.selectedProfileId = null;
    state.selectedProfile = null;
    state.galleryFilterProfileId = 'all';
    state.ownerAccounts = [];
    state.confirmDeleteAccountId = null;
    state.portalErrorAdmin = '';
    state.portalSignupError = '';
    state.portalErrorVisitor = '';
    clearPendingUploadFiles();
    state.uploadTitleInput = '';
    state.uploadCaptionInput = '';
    state.uploadSelectedProfileIds = null;
    state.uploadCurrentIndex = 0;
    state.uploadTotalCount = 0;
    state.adminNotice = '';
    state.adminError = '';
    state.pairError = '';
    state.pairApproveError = '';
    state.pairApproveNotice = '';
    state.confirmRevokeScreens = false;
    loadAuthStatus();
  }

  // =========================================================================
  // View 1: Front Entry Portal (Admin Login + Frontend Login on Same URL)
  // =========================================================================

  function renderPortalView(root) {
    var header = el('header', 'hf-header hf-header-minimal');
    var headerInner = el('div', 'hf-header-inner hf-portal-header-inner');
    var zoneBrand = el('div', 'hf-header-zone hf-zone-brand');
    zoneBrand.appendChild(buildBrandLogo());

    var zoneAction = el('div', 'hf-header-zone hf-zone-action');
    if (!state.initialized) {
      zoneAction.appendChild(el('span', 'hf-header-meta', 'First-Time Setup'));
    }

    headerInner.appendChild(zoneBrand);
    headerInner.appendChild(zoneAction);
    header.appendChild(headerInner);
    root.appendChild(header);

    var main = el('main', 'hf-portal-container');

    var pageHead = el('div', 'hf-portal-head');
    pageHead.appendChild(el('h1', 'hf-heading', state.frameTitle));
    pageHead.appendChild(
      el(
        'p',
        'hf-portal-lead',
        'Turn your old Android, iOS device, tablet, or TV into a private digital photo frame.'
      )
    );
    main.appendChild(pageHead);

    if (state.pendingPairCodeFromUrl) {
      var pairBanner = el(
        'div',
        'hf-alert hf-alert-info hf-pair-portal-banner',
        'Pairing code ' +
          state.pendingPairCodeFromUrl +
          ' detected. Sign in to your Admin Account below to approve your TV or tablet.'
      );
      main.appendChild(pairBanner);
    }

    // Inline First-Run Household Setup Panel (shown only when owner isn't set up yet and no accounts exist)
    if (!state.initialized && !state.ownerConfigured) {
      main.appendChild(buildFirstRunSetupPanel());
    } else if (state.setupSuccess) {
      main.appendChild(el('div', 'hf-alert hf-alert-success', state.setupSuccess));
    }

    // Single-column stack: Frontend Login (Pair TV / QR) on top, Admin Account below
    // (When a phone scans a QR link with ?pair=..., put Admin Account on top for instant approval)
    var stack = el('div', 'hf-portal-stack');

    var frontendWrap = el('div', 'hf-portal-stack-item');
    frontendWrap.appendChild(buildFrontendPortalBox());

    var adminWrap = el('div', 'hf-portal-stack-item');
    adminWrap.appendChild(buildAdminPortalBox());

    if (state.pendingPairCodeFromUrl) {
      stack.appendChild(adminWrap);
      stack.appendChild(frontendWrap);
    } else {
      stack.appendChild(frontendWrap);
      stack.appendChild(adminWrap);
    }

    main.appendChild(stack);

    root.appendChild(main);
  }

  function buildFirstRunSetupPanel() {
    var panel = el('section', 'hf-setup-panel');
    panel.appendChild(
      el('h2', 'hf-subheading', 'First-Time Household Setup')
    );
    panel.appendChild(
      el(
        'p',
        'hf-meta-line',
        'Create your Admin password and optional Frame Display password once to secure this home display.'
      )
    );

    if (state.setupError) {
      var errEl = el('div', 'hf-alert hf-alert-error', state.setupError);
      errEl.style.marginTop = '16px';
      panel.appendChild(errEl);
    }

    var form = el('form');
    form.style.marginTop = '18px';

    var row = el('div', 'hf-two-col hf-clearfix');

    // Admin setup column
    var left = el('div', 'hf-col-half');
    left.style.marginBottom = '8px';
    var fAdminUser = el('div', 'hf-field');
    fAdminUser.appendChild(el('label', 'hf-label', 'Admin Username'));
    var inAdminUser = el('input', 'hf-input');
    inAdminUser.type = 'text';
    inAdminUser.value = 'admin';
    inAdminUser.disabled = state.hasEnvAdmin;
    inAdminUser.setAttribute('autocomplete', 'username');
    fAdminUser.appendChild(inAdminUser);
    left.appendChild(fAdminUser);

    var fAdminPass = el('div', 'hf-field');
    fAdminPass.appendChild(el('label', 'hf-label', 'Admin Password (min 4 characters)'));
    var inAdminPass = el('input', 'hf-input');
    inAdminPass.type = 'password';
    inAdminPass.placeholder = state.hasEnvAdmin
      ? 'Configured via server secret'
      : 'Choose admin password';
    inAdminPass.disabled = state.hasEnvAdmin;
    inAdminPass.setAttribute('autocomplete', 'new-password');
    fAdminPass.appendChild(inAdminPass);
    left.appendChild(fAdminPass);
    row.appendChild(left);

    // Frame Display setup column
    var right = el('div', 'hf-col-half');
    right.style.marginBottom = '8px';
    var fVisUser = el('div', 'hf-field');
    fVisUser.appendChild(el('label', 'hf-label', 'Frame Display Username'));
    var inVisUser = el('input', 'hf-input');
    inVisUser.type = 'text';
    inVisUser.value = 'family';
    inVisUser.disabled = state.hasEnvVisitor;
    inVisUser.setAttribute('autocomplete', 'username');
    fVisUser.appendChild(inVisUser);
    right.appendChild(fVisUser);

    var fVisPass = el('div', 'hf-field');
    fVisPass.appendChild(el('label', 'hf-label', 'Frame Display Password (min 4 characters)'));
    var inVisPass = el('input', 'hf-input');
    inVisPass.type = 'password';
    inVisPass.placeholder = state.hasEnvVisitor
      ? 'Configured via server secret'
      : 'Choose display password';
    inVisPass.disabled = state.hasEnvVisitor;
    inVisPass.setAttribute('autocomplete', 'new-password');
    fVisPass.appendChild(inVisPass);
    right.appendChild(fVisPass);
    row.appendChild(right);

    form.appendChild(row);

    var submitBtn = el('button', 'hf-btn hf-btn-accent', 'Save Household Credentials');
    submitBtn.type = 'submit';
    form.appendChild(submitBtn);

    form.onsubmit = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      state.setupError = '';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';
      apiRequest(
        'POST',
        '/api/auth/setup',
        {
          adminUsername: inAdminUser.value,
          adminPassword: inAdminPass.value,
          visitorUsername: inVisUser.value,
          visitorPassword: inVisPass.value
        },
        function (err) {
          if (err) {
            state.setupError = err;
            render();
            return;
          }
          state.initialized = true;
          state.setupSuccess =
            'Credentials saved. You can now pair a screen under Frame Display or sign in as Admin below.';
          render();
        }
      );
      return false;
    };

    panel.appendChild(form);
    return panel;
  }

  function buildAdminPortalBox() {
    var box = el('section', 'hf-portal-box');

    var boxHead = el('div', 'hf-portal-box-header');
    boxHead.appendChild(el('h2', 'hf-portal-title', 'Admin Account'));
    boxHead.appendChild(
      el(
        'p',
        'hf-portal-subtitle',
        state.adminPortalMode === 'signup'
          ? 'Create your own private photo frame'
          : 'Manage photos & settings'
      )
    );
    box.appendChild(boxHead);

    // Clean segmented toggle: Sign In | Create Account
    if (state.signupEnabled) {
      var seg = el('div', 'hf-segmented hf-clearfix');
      var btnSignIn = el(
        'button',
        'hf-seg-btn' + (state.adminPortalMode === 'login' ? ' hf-seg-btn-active' : ''),
        'Sign In'
      );
      btnSignIn.type = 'button';
      btnSignIn.onclick = function () {
        state.adminPortalMode = 'login';
        state.portalErrorAdmin = '';
        state.portalSignupError = '';
        render();
      };
      seg.appendChild(btnSignIn);

      var btnSignUp = el(
        'button',
        'hf-seg-btn' + (state.adminPortalMode === 'signup' ? ' hf-seg-btn-active' : ''),
        'Create Account'
      );
      btnSignUp.type = 'button';
      btnSignUp.onclick = function () {
        state.adminPortalMode = 'signup';
        state.portalErrorAdmin = '';
        state.portalSignupError = '';
        render();
      };
      seg.appendChild(btnSignUp);
      box.appendChild(seg);
    }

    if (state.adminPortalMode === 'signup' && state.signupEnabled) {
      if (state.portalSignupError) {
        box.appendChild(el('div', 'hf-alert hf-alert-error', state.portalSignupError));
      }

      var regForm = el('form');

      var fTitle = el('div', 'hf-field');
      var titleLabel = el('label', 'hf-label', 'Frame Name (Optional)');
      titleLabel.setAttribute('for', 'hf-reg-title');
      var titleInput = el('input', 'hf-input');
      titleInput.id = 'hf-reg-title';
      titleInput.type = 'text';
      titleInput.maxLength = 60;
      titleInput.placeholder = 'e.g. Our Family Frame';
      fTitle.appendChild(titleLabel);
      fTitle.appendChild(titleInput);
      regForm.appendChild(fTitle);

      var fUser = el('div', 'hf-field');
      var userLabel = el('label', 'hf-label', 'Admin Username');
      userLabel.setAttribute('for', 'hf-reg-user');
      var userInput = el('input', 'hf-input');
      userInput.id = 'hf-reg-user';
      userInput.type = 'text';
      userInput.value = '';
      userInput.maxLength = 32;
      userInput.placeholder = 'Choose a username';
      userInput.setAttribute('autocomplete', 'username');
      userInput.setAttribute('autocapitalize', 'off');
      userInput.setAttribute('autocorrect', 'off');
      fUser.appendChild(userLabel);
      fUser.appendChild(userInput);
      regForm.appendChild(fUser);

      var fPass = el('div', 'hf-field');
      var passLabel = el('label', 'hf-label', 'Password');
      passLabel.setAttribute('for', 'hf-reg-pass');
      var passInput = el('input', 'hf-input');
      passInput.id = 'hf-reg-pass';
      passInput.type = 'password';
      passInput.placeholder = 'At least 6 characters';
      passInput.setAttribute('autocomplete', 'new-password');
      fPass.appendChild(passLabel);
      fPass.appendChild(passInput);
      regForm.appendChild(fPass);

      var fPass2 = el('div', 'hf-field');
      var pass2Label = el('label', 'hf-label', 'Confirm Password');
      pass2Label.setAttribute('for', 'hf-reg-pass2');
      var pass2Input = el('input', 'hf-input');
      pass2Input.id = 'hf-reg-pass2';
      pass2Input.type = 'password';
      pass2Input.placeholder = 'Re-enter password';
      pass2Input.setAttribute('autocomplete', 'new-password');
      fPass2.appendChild(pass2Label);
      fPass2.appendChild(pass2Input);
      regForm.appendChild(fPass2);

      var inviteInput = null;
      if (state.inviteRequired) {
        var fInv = el('div', 'hf-field');
        var invLabel = el('label', 'hf-label', 'Invite Code');
        invLabel.setAttribute('for', 'hf-reg-invite');
        inviteInput = el('input', 'hf-input');
        inviteInput.id = 'hf-reg-invite';
        inviteInput.type = 'text';
        inviteInput.placeholder = 'Enter invite code';
        inviteInput.setAttribute('autocapitalize', 'off');
        inviteInput.setAttribute('autocorrect', 'off');
        fInv.appendChild(invLabel);
        fInv.appendChild(inviteInput);
        regForm.appendChild(fInv);
      }

      // Account Guidelines & Terms of Service box (dynamic limits from server)
      var maxAcc = (state.limits && state.limits.maxAccounts) || 20;
      var maxPhotos = (state.limits && state.limits.photoLimit) || 100;
      var maxRate = (state.limits && state.limits.signupRatePerHour) || 3;

      var guideBox = el('div', 'hf-guidelines-box');
      var guideHead = el('div', 'hf-guidelines-head hf-clearfix');
      guideHead.appendChild(
        el('div', 'hf-guidelines-title', 'Account Guidelines & Terms of Service')
      );
      var toggleFullBtn = el(
        'button',
        'hf-guidelines-toggle',
        state.signupShowFullTerms ? 'Hide details' : 'Read full terms'
      );
      toggleFullBtn.type = 'button';
      toggleFullBtn.onclick = function () {
        state.signupShowFullTerms = !state.signupShowFullTerms;
        var extraNode = document.getElementById('hf-guidelines-extra');
        if (extraNode) {
          extraNode.style.display = state.signupShowFullTerms ? 'block' : 'none';
        }
        toggleFullBtn.textContent = state.signupShowFullTerms
          ? 'Hide details'
          : 'Read full terms';
      };
      guideHead.appendChild(toggleFullBtn);
      guideBox.appendChild(guideHead);

      var guideList = el('ul', 'hf-guidelines-list');
      guideList.appendChild(
        el(
          'li',
          '',
          'Server Capacity (' +
            maxAcc +
            '-Account Cap): This shared server supports up to ' +
            maxAcc +
            ' total accounts. Please create one account per household.'
        )
      );
      guideList.appendChild(
        el(
          'li',
          '',
          'Storage Limit (' +
            maxPhotos +
            ' Photos / Account): Each user account can store up to ' +
            maxPhotos +
            ' photos. Delete older photos anytime to free up space.'
        )
      );
      guideList.appendChild(
        el(
          'li',
          '',
          'Private Workspace & Backups: Your photos stay private to your own paired screens. HearthFrame is a live photo display — always keep your own original backups.'
        )
      );
      guideBox.appendChild(guideList);

      var extraWrap = el('ul', 'hf-guidelines-list hf-guidelines-extra');
      extraWrap.id = 'hf-guidelines-extra';
      extraWrap.style.display = state.signupShowFullTerms ? 'block' : 'none';
      extraWrap.appendChild(
        el(
          'li',
          '',
          'Fair-Use Signup Rate: Up to ' +
            maxRate +
            ' new signups per network per hour to prevent spam.'
        )
      );
      extraWrap.appendChild(
        el(
          'li',
          '',
          'Acceptable Use & Moderation: Personal family/household photos only. The server host does not browse private photos, but may remove abusive or long-inactive accounts to keep space open for others.'
        )
      );
      guideBox.appendChild(extraWrap);

      var termsLabel = el('label', 'hf-check-row hf-terms-check');
      var termsCheck = document.createElement('input');
      termsCheck.type = 'checkbox';
      termsCheck.id = 'hf-reg-terms';
      termsLabel.appendChild(termsCheck);
      termsLabel.appendChild(
        el(
          'span',
          'hf-check-label',
          'I understand the ' +
            maxAcc +
            '-account cap, ' +
            maxPhotos +
            '-photo limit, and agree to the Account Guidelines & Terms of Service.'
        )
      );
      guideBox.appendChild(termsLabel);

      regForm.appendChild(guideBox);

      var regBtn = el(
        'button',
        'hf-btn hf-btn-primary hf-btn-block hf-portal-submit',
        'Create Admin Account'
      );
      regBtn.type = 'submit';
      regForm.appendChild(regBtn);

      regForm.onsubmit = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        state.portalSignupError = '';
        if (passInput.value !== pass2Input.value) {
          state.portalSignupError = 'Passwords do not match.';
          render();
          return false;
        }
        if (!termsCheck.checked) {
          state.portalSignupError =
            'Please check the box confirming you agree to the Account Guidelines & Terms of Service.';
          render();
          return false;
        }
        regBtn.disabled = true;
        regBtn.textContent = 'Creating account...';

        var payload = {
          frameTitle: titleInput.value,
          username: userInput.value,
          password: passInput.value,
          acceptedTerms: true
        };
        if (inviteInput) {
          payload.inviteCode = inviteInput.value;
        }

        apiRequest('POST', '/api/auth/register', payload, function (err, data) {
          if (err || !data || !data.token) {
            state.portalSignupError = err || 'Could not create account.';
            render();
            return;
          }
          state.authenticated = true;
          state.token = data.token;
          state.role = data.role;
          state.username = data.username;
          state.workspaceId = data.workspaceId || null;
          state.isOwner = Boolean(data.isOwner);
          state.setupSuccess = '';
          state.signupShowFullTerms = false;
          stopPairingTimers();
          state.view = 'admin';
          state.adminTab = state.pendingPairCodeFromUrl ? 'access' : 'gallery';
          state.adminNotice =
            'Account created! Upload your photos, then open Pair & Access to connect a TV or tablet.';
          loadAdminData();
        });
        return false;
      };

      box.appendChild(regForm);
      return box;
    }

    // Standard Admin Sign In form
    if (state.portalErrorAdmin) {
      box.appendChild(el('div', 'hf-alert hf-alert-error', state.portalErrorAdmin));
    }

    var form = el('form');

    var userField = el('div', 'hf-field');
    var userLabel = el('label', 'hf-label', 'Username');
    userLabel.setAttribute('for', 'hf-login-user-admin');
    var userInput = el('input', 'hf-input');
    userInput.id = 'hf-login-user-admin';
    userInput.type = 'text';
    userInput.value = '';
    userInput.placeholder = 'Enter username';
    userInput.setAttribute('autocomplete', 'username');
    userInput.setAttribute('autocapitalize', 'off');
    userInput.setAttribute('autocorrect', 'off');
    userField.appendChild(userLabel);
    userField.appendChild(userInput);
    form.appendChild(userField);

    var passField = el('div', 'hf-field');
    var passLabel = el('label', 'hf-label', 'Password');
    passLabel.setAttribute('for', 'hf-login-pass-admin');
    var passInput = el('input', 'hf-input');
    passInput.id = 'hf-login-pass-admin';
    passInput.type = 'password';
    passInput.placeholder = 'Enter password';
    passInput.setAttribute('autocomplete', 'current-password');
    passField.appendChild(passLabel);
    passField.appendChild(passInput);
    form.appendChild(passField);

    var btn = el('button', 'hf-btn hf-btn-primary hf-btn-block hf-portal-submit', 'Sign In');
    btn.type = 'submit';
    form.appendChild(btn);

    form.onsubmit = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      state.portalErrorAdmin = '';
      btn.disabled = true;
      btn.textContent = 'Signing in...';

      apiRequest(
        'POST',
        '/api/auth/login',
        {
          role: 'admin',
          username: userInput.value,
          password: passInput.value
        },
        function (err, data) {
          if (err || !data || !data.token) {
            state.portalErrorAdmin = err || 'Sign-in failed.';
            render();
            return;
          }
          state.authenticated = true;
          state.token = data.token;
          state.role = data.role;
          state.username = data.username;
          state.workspaceId = data.workspaceId || null;
          state.isOwner = Boolean(data.isOwner);
          state.setupSuccess = '';
          stopPairingTimers();
          state.view = 'admin';
          state.adminTab = state.pendingPairCodeFromUrl ? 'access' : 'gallery';
          loadAdminData();
        }
      );
      return false;
    };

    box.appendChild(form);
    return box;
  }

  function buildFrontendPortalBox() {
    var box = el('section', 'hf-portal-box');
    var isPairMode = state.visitorPortalMode === 'pair';

    var boxHead = el('div', 'hf-portal-box-header');
    boxHead.appendChild(el('h2', 'hf-portal-title', 'Frame Display'));
    boxHead.appendChild(
      el(
        'p',
        'hf-portal-subtitle',
        isPairMode
          ? 'Scan the QR code or enter the code from your phone'
          : 'Sign in on a TV, tablet, or old phone to show photos'
      )
    );
    box.appendChild(boxHead);

    var seg = el('div', 'hf-segmented hf-clearfix');
    var btnPair = el(
      'button',
      'hf-seg-btn' + (isPairMode ? ' hf-seg-btn-active' : ''),
      'Pair TV / QR'
    );
    btnPair.type = 'button';
    btnPair.onclick = function () {
      if (state.visitorPortalMode !== 'pair') {
        state.visitorPortalMode = 'pair';
        state.portalErrorVisitor = '';
        if (state.pairStatus !== 'pending' || !state.pairPollToken) {
          startTvPairing();
        } else {
          render();
        }
      }
    };
    seg.appendChild(btnPair);

    var btnSign = el(
      'button',
      'hf-seg-btn' + (!isPairMode ? ' hf-seg-btn-active' : ''),
      'Sign In'
    );
    btnSign.type = 'button';
    btnSign.onclick = function () {
      if (state.visitorPortalMode !== 'login') {
        stopPairingTimers();
        state.visitorPortalMode = 'login';
        state.portalErrorVisitor = '';
        render();
      }
    };
    seg.appendChild(btnSign);
    box.appendChild(seg);

    if (isPairMode) {
      if (state.pairError) {
        box.appendChild(el('div', 'hf-alert hf-alert-error', state.pairError));
      }

      var pairWrap = el('div', 'hf-pair-box');

      if (state.pairLoading) {
        pairWrap.appendChild(el('p', 'hf-meta-line', 'Generating pairing code...'));
      } else if (state.pairStatus === 'pending' && state.pairDisplayCode) {
        var qrFrame = el('div', 'hf-pair-qr-frame');
        var qrImg = document.createElement('img');
        qrImg.className = 'hf-pair-qr';
        qrImg.src = state.pairQrUrl;
        qrImg.alt = 'Scan QR code with your phone to pair this screen';
        qrImg.width = 180;
        qrImg.height = 180;
        qrFrame.appendChild(qrImg);
        pairWrap.appendChild(qrFrame);

        pairWrap.appendChild(el('div', 'hf-pair-pin-label', 'OR ENTER 6-CHARACTER CODE'));
        pairWrap.appendChild(el('div', 'hf-pair-pin', state.pairDisplayCode));

        var cdNode = el(
          'div',
          'hf-pair-countdown',
          'Expires in ' + formatCountdown(state.pairExpiresAt - new Date().getTime())
        );
        cdNode.id = 'hf-pair-countdown';
        pairWrap.appendChild(cdNode);

        pairWrap.appendChild(
          el(
            'p',
            'hf-pair-hint',
            'Scan the QR with your phone, or open Admin \u2192 Pair & Access and enter this code.'
          )
        );

        var refreshBtn = el('button', 'hf-btn hf-btn-sm', 'Generate New Code');
        refreshBtn.type = 'button';
        refreshBtn.onclick = function () {
          startTvPairing();
        };
        pairWrap.appendChild(refreshBtn);
      } else {
        pairWrap.appendChild(
          el(
            'div',
            'hf-alert hf-alert-info',
            state.pairStatus === 'expired'
              ? 'Pairing code expired. Generate a fresh code to pair this screen.'
              : 'Tap below to show a QR code and 6-character PIN.'
          )
        );
        var retryBtn = el(
          'button',
          'hf-btn hf-btn-accent hf-btn-block',
          'Generate New Code'
        );
        retryBtn.type = 'button';
        retryBtn.onclick = function () {
          startTvPairing();
        };
        pairWrap.appendChild(retryBtn);
      }

      box.appendChild(pairWrap);
      return box;
    }

    // Standard Frontend Username + Password Sign In
    if (state.portalErrorVisitor) {
      box.appendChild(el('div', 'hf-alert hf-alert-error', state.portalErrorVisitor));
    }

    var form = el('form');

    var userField = el('div', 'hf-field');
    var userLabel = el('label', 'hf-label', 'Username');
    userLabel.setAttribute('for', 'hf-login-user-visitor');
    var userInput = el('input', 'hf-input');
    userInput.id = 'hf-login-user-visitor';
    userInput.type = 'text';
    userInput.value = '';
    userInput.placeholder = 'Enter username';
    userInput.setAttribute('autocomplete', 'username');
    userInput.setAttribute('autocapitalize', 'off');
    userInput.setAttribute('autocorrect', 'off');
    userField.appendChild(userLabel);
    userField.appendChild(userInput);
    form.appendChild(userField);

    var passField = el('div', 'hf-field');
    var passLabel = el('label', 'hf-label', 'Password');
    passLabel.setAttribute('for', 'hf-login-pass-visitor');
    var passInput = el('input', 'hf-input');
    passInput.id = 'hf-login-pass-visitor';
    passInput.type = 'password';
    passInput.placeholder = 'Enter password';
    passInput.setAttribute('autocomplete', 'current-password');
    passField.appendChild(passLabel);
    passField.appendChild(passInput);
    form.appendChild(passField);

    var btn = el(
      'button',
      'hf-btn hf-btn-accent hf-btn-block hf-portal-submit',
      'Open Slideshow'
    );
    btn.type = 'submit';
    form.appendChild(btn);

    form.onsubmit = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      state.portalErrorVisitor = '';
      btn.disabled = true;
      btn.textContent = 'Signing in...';

      apiRequest(
        'POST',
        '/api/auth/login',
        {
          role: 'visitor',
          username: userInput.value,
          password: passInput.value
        },
        function (err, data) {
          if (err || !data || !data.token) {
            state.portalErrorVisitor = err || 'Sign-in failed.';
            render();
            return;
          }
          stopPairingTimers();
          state.authenticated = true;
          state.token = data.token;
          state.role = data.role;
          state.username = data.username;
          state.workspaceId = data.workspaceId || null;
          state.isOwner = Boolean(data.isOwner);
          state.setupSuccess = '';
          loadVisitorProfilesAndStart(null, true);
        }
      );
      return false;
    };

    box.appendChild(form);
    return box;
  }

  function buildLoginBox(opts) {
    var box = el('section', 'hf-portal-box');

    var boxHead = el('div', 'hf-portal-box-header');
    boxHead.appendChild(el('h2', 'hf-portal-title', opts.title));
    if (opts.subtitle) {
      boxHead.appendChild(el('p', 'hf-portal-subtitle', opts.subtitle));
    }
    box.appendChild(boxHead);

    if (opts.errorText) {
      box.appendChild(el('div', 'hf-alert hf-alert-error', opts.errorText));
    }

    var form = el('form');

    var userField = el('div', 'hf-field');
    var userId = 'hf-login-user-' + opts.role;
    var userLabel = el('label', 'hf-label', 'Username');
    userLabel.setAttribute('for', userId);
    var userInput = el('input', 'hf-input');
    userInput.id = userId;
    userInput.type = 'text';
    userInput.value = '';
    userInput.placeholder = 'Enter username';
    userInput.setAttribute('autocomplete', 'username');
    userInput.setAttribute('autocapitalize', 'off');
    userInput.setAttribute('autocorrect', 'off');
    userField.appendChild(userLabel);
    userField.appendChild(userInput);
    form.appendChild(userField);

    var passField = el('div', 'hf-field');
    var passId = 'hf-login-pass-' + opts.role;
    var passLabel = el('label', 'hf-label', 'Password');
    passLabel.setAttribute('for', passId);
    var passInput = el('input', 'hf-input');
    passInput.id = passId;
    passInput.type = 'password';
    passInput.placeholder = 'Enter password';
    passInput.setAttribute('autocomplete', 'current-password');
    passField.appendChild(passLabel);
    passField.appendChild(passInput);
    form.appendChild(passField);

    var btn = el('button', opts.buttonClass + ' hf-portal-submit', opts.buttonText);
    btn.type = 'submit';
    form.appendChild(btn);

    form.onsubmit = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (opts.role === 'admin') {
        state.portalErrorAdmin = '';
      } else {
        state.portalErrorVisitor = '';
      }
      btn.disabled = true;
      btn.textContent = 'Signing in...';

      apiRequest(
        'POST',
        '/api/auth/login',
        {
          role: opts.role,
          username: userInput.value,
          password: passInput.value
        },
        function (err, data) {
          if (err || !data || !data.token) {
            if (opts.role === 'admin') {
              state.portalErrorAdmin = err || 'Sign-in failed.';
            } else {
              state.portalErrorVisitor = err || 'Sign-in failed.';
            }
            render();
            return;
          }
          state.authenticated = true;
          state.token = data.token;
          state.role = data.role;
          state.username = data.username;
          state.workspaceId = data.workspaceId || null;
          state.isOwner = Boolean(data.isOwner);
          state.setupSuccess = '';
          if (data.role === 'admin') {
            state.view = 'admin';
            state.adminTab = 'gallery';
            loadAdminData();
          } else {
            loadVisitorProfilesAndStart(null, false);
          }
        }
      );
      return false;
    };

    box.appendChild(form);
    return box;
  }

  // =========================================================================
  // View 2A: Display Profile Chooser (Shown When Multiple Profiles Exist)
  // =========================================================================

  function renderProfileChooserView(root) {
    var header = el('header', 'hf-header');
    var headerInner = el('div', 'hf-header-inner');

    var zoneBrand = el('div', 'hf-header-zone hf-zone-brand');
    zoneBrand.appendChild(buildBrandLogo());

    var zoneNav = el('div', 'hf-header-zone hf-zone-nav');
    if (state.role === 'admin') {
      var backAdmin = el('button', 'hf-nav-link', 'Back to Admin Dashboard');
      backAdmin.type = 'button';
      backAdmin.onclick = function () {
        state.view = 'admin';
        loadAdminData();
      };
      zoneNav.appendChild(backAdmin);
    }
    var signOutLink = el('button', 'hf-nav-link', 'Sign Out');
    signOutLink.type = 'button';
    signOutLink.onclick = signOut;
    zoneNav.appendChild(signOutLink);

    var zoneAction = el('div', 'hf-header-zone hf-zone-action');
    zoneAction.appendChild(el('span', 'hf-header-meta', 'Select Screen'));

    headerInner.appendChild(zoneBrand);
    headerInner.appendChild(zoneNav);
    headerInner.appendChild(zoneAction);
    header.appendChild(headerInner);
    root.appendChild(header);

    var main = el('main', 'hf-container-narrow');

    var pageHead = el('div', 'hf-page-head');
    pageHead.appendChild(el('h1', 'hf-heading', 'Choose Display Profile'));
    pageHead.appendChild(
      el(
        'p',
        'hf-lead',
        'Select which display profile to run on this screen. Each profile uses its own photos, rotation interval, and scaling.'
      )
    );
    main.appendChild(pageHead);

    var grid = el('div', 'hf-profile-grid hf-clearfix');
    for (var i = 0; i < state.profiles.length; i++) {
      (function (prof) {
        var col = el('div', 'hf-profile-col');
        var card = el('section', 'hf-profile-card');
        card.appendChild(el('div', 'hf-profile-kicker', prof.deviceType || 'Display'));
        card.appendChild(el('h2', 'hf-profile-title', prof.name || 'Display Profile'));

        var ps = prof.settings || {};
        var count = typeof prof.slideCount === 'number' ? prof.slideCount : 0;
        var metaText =
          count +
          (count === 1 ? ' photo' : ' photos') +
          '  \u00B7  Every ' +
          (ps.intervalSeconds || 8) +
          's  \u00B7  ' +
          (ps.autoRotate === false ? 'Manual advance' : 'Auto-rotate') +
          '  \u00B7  ' +
          (ps.fitMode === 'cover' ? 'Fill screen' : 'Fit photo');
        card.appendChild(el('p', 'hf-profile-meta', metaText));

        var openBtn = el('button', 'hf-btn hf-btn-accent hf-btn-block', 'Open Slideshow');
        openBtn.type = 'button';
        openBtn.onclick = function () {
          openVisitorProfile(prof.id);
        };
        card.appendChild(openBtn);

        col.appendChild(card);
        grid.appendChild(col);
      })(state.profiles[i]);
    }
    main.appendChild(grid);
    root.appendChild(main);
  }

  // =========================================================================
  // View 2B: Visitor Dashboard & Fullscreen Slideshow
  // =========================================================================

  function renderVisitorView(root) {
    // 3-Zone Header
    var header = el('header', 'hf-header');
    var headerInner = el('div', 'hf-header-inner');

    var zoneBrand = el('div', 'hf-header-zone hf-zone-brand');
    zoneBrand.appendChild(buildBrandLogo());

    var zoneNav = el('div', 'hf-header-zone hf-zone-nav');
    if (state.profiles.length > 1) {
      var switchBtn = el('button', 'hf-nav-link', 'Switch Profile');
      switchBtn.type = 'button';
      switchBtn.onclick = function () {
        stopAllTimers();
        disableKeepScreenAwake();
        exitFullscreenMode(false);
        state.view = 'chooser';
        render();
      };
      zoneNav.appendChild(switchBtn);
    }
    if (state.role === 'admin') {
      var backAdmin = el('button', 'hf-nav-link', 'Back to Admin Dashboard');
      backAdmin.type = 'button';
      backAdmin.onclick = function () {
        stopAllTimers();
        disableKeepScreenAwake();
        exitFullscreenMode(false);
        state.view = 'admin';
        loadAdminData();
      };
      zoneNav.appendChild(backAdmin);
    }
    var signOutLink = el('button', 'hf-nav-link', 'Sign Out');
    signOutLink.type = 'button';
    signOutLink.onclick = signOut;
    zoneNav.appendChild(signOutLink);

    var zoneAction = el('div', 'hf-header-zone hf-zone-action');
    var topFsBtn = el('button', 'hf-btn hf-btn-accent', 'Enter Fullscreen');
    topFsBtn.type = 'button';
    topFsBtn.disabled = state.slides.length === 0;
    topFsBtn.onclick = function () {
      enterFullscreenMode();
    };
    zoneAction.appendChild(topFsBtn);

    headerInner.appendChild(zoneBrand);
    headerInner.appendChild(zoneNav);
    headerInner.appendChild(zoneAction);
    header.appendChild(headerInner);
    root.appendChild(header);

    var main = el('main', 'hf-container');

    var pageHead = el('div', 'hf-page-head');
    var displayHeading =
      state.selectedProfile && state.selectedProfile.name
        ? state.selectedProfile.name
        : state.settings.frameTitle || 'Home Photo Frame';
    pageHead.appendChild(el('h1', 'hf-heading', displayHeading));

    var statusParts = [];
    if (state.selectedProfile && state.selectedProfile.deviceType) {
      statusParts.push(state.selectedProfile.deviceType);
    }
    statusParts.push(
      state.slides.length + (state.slides.length === 1 ? ' photo' : ' photos')
    );
    statusParts.push(
      state.localAutoRotate
        ? 'Auto-rotate every ' + state.localInterval + 's'
        : 'Auto-rotate off'
    );
    statusParts.push('Tap photo in fullscreen for controls');
    pageHead.appendChild(el('p', 'hf-meta-line', statusParts.join('  \u00B7  ')));
    main.appendChild(pageHead);

    if (state.slides.length === 0) {
      var empty = el('div', 'hf-empty-state');
      empty.appendChild(el('h2', 'hf-empty-title', 'No photos in this display yet'));
      empty.appendChild(
        el(
          'p',
          'hf-empty-desc',
          'Open Admin \u2192 Photos to upload photos or assign existing photos to this profile.'
        )
      );
      if (state.profiles.length > 1) {
        var chooseOther = el('button', 'hf-btn hf-btn-accent', 'Choose Another Profile');
        chooseOther.type = 'button';
        chooseOther.style.marginTop = '16px';
        chooseOther.onclick = function () {
          stopAllTimers();
          state.view = 'chooser';
          render();
        };
        empty.appendChild(chooseOther);
      }
      main.appendChild(empty);
      root.appendChild(main);
      return;
    }

    // Obsidian Slideshow Stage
    var stageShell = el(
      'section',
      'hf-stage-shell' + (state.settings.transition === 'none' ? ' hf-no-transition' : '')
    );
    stageShell.id = 'hf-stage-shell';

    var viewport = el('div', 'hf-stage-viewport');
    var canvas = el('div', 'hf-stage-canvas');

    var img = el('img', 'hf-stage-img ' + (state.localFitMode === 'cover' ? 'hf-stage-img-cover' : 'hf-stage-img-contain'));
    img.id = 'hf-stage-img';
    img.setAttribute('referrerpolicy', 'no-referrer');
    canvas.appendChild(img);

    var fallback = el('div', 'hf-stage-fallback');
    fallback.id = 'hf-stage-fallback';
    fallback.style.display = 'none';
    var fbInner = el('div', 'hf-stage-fallback-inner');
    var fbTitle = el('div', 'hf-stage-fallback-title', 'Photo unavailable');
    fbTitle.id = 'hf-stage-fallback-title';
    fbInner.appendChild(fbTitle);
    fbInner.appendChild(
      el('div', 'hf-stage-fallback-sub', 'Tap next or wait for the next rotation.')
    );
    fallback.appendChild(fbInner);
    canvas.appendChild(fallback);

    viewport.appendChild(canvas);

    // Passive Caption & Clock Overlay
    var passive = el('div', 'hf-passive-overlay hf-clearfix');
    passive.id = 'hf-passive-overlay';
    if (!state.settings.showCaption && !state.settings.showClock) {
      passive.style.display = 'none';
    }
    var pLeft = el('div', 'hf-passive-left');
    if (state.settings.showCaption) {
      var pTitle = el('div', 'hf-passive-title');
      pTitle.id = 'hf-passive-title';
      var pCap = el('div', 'hf-passive-caption');
      pCap.id = 'hf-passive-caption';
      pLeft.appendChild(pTitle);
      pLeft.appendChild(pCap);
    }
    var pRight = el('div', 'hf-passive-right');
    if (state.settings.showClock) {
      var pClock = el('div', 'hf-passive-clock', formatClockTime());
      pClock.id = 'hf-passive-clock';
      pRight.appendChild(pClock);
    }
    var pCounter = el('div', 'hf-passive-counter');
    pCounter.id = 'hf-passive-counter';
    pRight.appendChild(pCounter);
    passive.appendChild(pLeft);
    passive.appendChild(pRight);
    viewport.appendChild(passive);

    // Progress Bar
    var progTrack = el('div', 'hf-progress-track');
    var progFill = el('div', 'hf-progress-fill');
    progFill.id = 'hf-progress-fill';
    progTrack.appendChild(progFill);
    viewport.appendChild(progTrack);

    // Fullscreen Tap-to-Reveal Controls Overlay
    var fsControls = buildFullscreenControlsOverlay();
    viewport.appendChild(fsControls);

    // Image tap / click handler:
    // - In fullscreen: toggles the fullscreen control options (including Exit Fullscreen)
    // - In dashboard mode: enters fullscreen directly
    viewport.onclick = function () {
      if (suppressNextStageClick) {
        suppressNextStageClick = false;
        return;
      }
      if (state.isFullscreen) {
        toggleFsControls();
      } else {
        enterFullscreenMode();
      }
    };

    // Touch swipe left/right for Android tablets
    viewport.addEventListener(
      'touchstart',
      function (ev) {
        if (!ev.touches || !ev.touches.length) return;
        touchStartX = ev.touches[0].clientX;
        touchStartY = ev.touches[0].clientY;
      },
      false
    );

    viewport.addEventListener(
      'touchend',
      function (ev) {
        if (!ev.changedTouches || !ev.changedTouches.length) return;
        var dx = ev.changedTouches[0].clientX - touchStartX;
        var dy = ev.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
          suppressNextStageClick = true;
          if (dx < 0) {
            goToSlide(state.currentIndex + 1);
          } else {
            goToSlide(state.currentIndex - 1);
          }
        }
      },
      false
    );

    stageShell.appendChild(viewport);
    main.appendChild(stageShell);

    // Visitor Control Toolbar
    main.appendChild(buildVisitorToolbar());

    // Thumbnail Filmstrip
    main.appendChild(buildFilmstrip());

    root.appendChild(main);

    // Render active slide into stage DOM
    updateActiveSlideDOM();
    updateFullscreenOverlayUI();
  }

  function stopOverlayPropagation(ev) {
    if (ev && ev.stopPropagation) {
      ev.stopPropagation();
    }
  }

  function buildFullscreenControlsOverlay() {
    var wrap = el(
      'div',
      'hf-fs-controls' + (state.fsControlsVisible ? ' hf-fs-controls-visible' : '')
    );
    wrap.id = 'hf-fs-controls';

    // Top bar with slide title & Exit Fullscreen button
    var topBar = el('div', 'hf-fs-top-bar hf-clearfix');
    topBar.onclick = stopOverlayPropagation;

    var topLeft = el('div', 'hf-fs-top-left');
    var fsTitle = el('div', 'hf-fs-title');
    fsTitle.id = 'hf-fs-title';
    var fsMeta = el('div', 'hf-fs-meta');
    fsMeta.id = 'hf-fs-meta';
    topLeft.appendChild(fsTitle);
    topLeft.appendChild(fsMeta);

    var topRight = el('div', 'hf-fs-top-right');
    var exitBtn = el('button', 'hf-fs-btn hf-fs-btn-exit', '\u2715 Exit Fullscreen');
    exitBtn.type = 'button';
    exitBtn.onclick = function (ev) {
      stopOverlayPropagation(ev);
      exitFullscreenMode(false);
    };
    topRight.appendChild(exitBtn);

    topBar.appendChild(topLeft);
    topBar.appendChild(topRight);
    wrap.appendChild(topBar);

    // Bottom dock with Playback, Auto-Rotate, Interval, Fit, Hide
    var bottomBar = el('div', 'hf-fs-bottom-bar');
    bottomBar.onclick = stopOverlayPropagation;

    var prevBtn = el('button', 'hf-fs-btn', '\u2190 Prev');
    prevBtn.type = 'button';
    prevBtn.onclick = function (ev) {
      stopOverlayPropagation(ev);
      goToSlide(state.currentIndex - 1);
      scheduleFsControlsHide();
    };
    bottomBar.appendChild(prevBtn);

    var playBtn = el(
      'button',
      'hf-fs-btn' + (state.playing ? '' : ' hf-fs-btn-active'),
      state.playing ? 'Pause' : 'Play'
    );
    playBtn.id = 'hf-fs-play-btn';
    playBtn.type = 'button';
    playBtn.onclick = function (ev) {
      stopOverlayPropagation(ev);
      togglePlayback();
      scheduleFsControlsHide();
    };
    bottomBar.appendChild(playBtn);

    var nextBtn = el('button', 'hf-fs-btn', 'Next \u2192');
    nextBtn.type = 'button';
    nextBtn.onclick = function (ev) {
      stopOverlayPropagation(ev);
      goToSlide(state.currentIndex + 1);
      scheduleFsControlsHide();
    };
    bottomBar.appendChild(nextBtn);

    var rotBtn = el(
      'button',
      'hf-fs-btn' + (state.localAutoRotate ? ' hf-fs-btn-active' : ''),
      state.localAutoRotate ? 'Auto-Rotate: On' : 'Auto-Rotate: Off'
    );
    rotBtn.id = 'hf-fs-rot-btn';
    rotBtn.type = 'button';
    rotBtn.onclick = function (ev) {
      stopOverlayPropagation(ev);
      state.localAutoRotate = !state.localAutoRotate;
      startSlideCycle();
      refreshPlaybackButtons();
      scheduleFsControlsHide();
    };
    bottomBar.appendChild(rotBtn);

    var slowerBtn = el('button', 'hf-fs-btn', 'Interval -');
    slowerBtn.type = 'button';
    slowerBtn.onclick = function (ev) {
      stopOverlayPropagation(ev);
      adjustLocalInterval(-1);
      scheduleFsControlsHide();
    };
    bottomBar.appendChild(slowerBtn);

    var intReadout = el('span', 'hf-fs-interval-readout', state.localInterval + 's');
    intReadout.id = 'hf-fs-interval-readout';
    bottomBar.appendChild(intReadout);

    var fasterBtn = el('button', 'hf-fs-btn', 'Interval +');
    fasterBtn.type = 'button';
    fasterBtn.onclick = function (ev) {
      stopOverlayPropagation(ev);
      adjustLocalInterval(1);
      scheduleFsControlsHide();
    };
    bottomBar.appendChild(fasterBtn);

    var fitBtn = el(
      'button',
      'hf-fs-btn',
      state.localFitMode === 'cover' ? 'Mode: Fill' : 'Mode: Fit'
    );
    fitBtn.id = 'hf-fs-fit-btn';
    fitBtn.type = 'button';
    fitBtn.onclick = function (ev) {
      stopOverlayPropagation(ev);
      toggleFitMode();
      scheduleFsControlsHide();
    };
    bottomBar.appendChild(fitBtn);

    var awakeBtn = el(
      'button',
      'hf-fs-btn' + (state.keepAwakeEnabled ? ' hf-fs-btn-active' : ''),
      state.keepAwakeEnabled ? 'Keep Awake: On' : 'Keep Awake: Off'
    );
    awakeBtn.id = 'hf-fs-awake-btn';
    awakeBtn.type = 'button';
    awakeBtn.onclick = function (ev) {
      stopOverlayPropagation(ev);
      toggleKeepScreenAwake();
      scheduleFsControlsHide();
    };
    bottomBar.appendChild(awakeBtn);

    var hideBtn = el('button', 'hf-fs-btn', 'Hide Controls');
    hideBtn.type = 'button';
    hideBtn.onclick = function (ev) {
      stopOverlayPropagation(ev);
      toggleFsControls(false);
    };
    bottomBar.appendChild(hideBtn);

    wrap.appendChild(bottomBar);
    return wrap;
  }

  function buildVisitorToolbar() {
    var bar = el('div', 'hf-stage-toolbar hf-clearfix');

    // Playback group
    var gPlay = el('div', 'hf-toolbar-group');

    var btnPrev = el('button', 'hf-btn hf-inline-btn', '\u2190 Previous');
    btnPrev.type = 'button';
    btnPrev.onclick = function () {
      goToSlide(state.currentIndex - 1);
    };
    gPlay.appendChild(btnPrev);

    var btnPlay = el(
      'button',
      'hf-btn hf-btn-primary hf-inline-btn',
      state.playing ? 'Pause' : 'Play'
    );
    btnPlay.id = 'hf-tb-play-btn';
    btnPlay.type = 'button';
    btnPlay.onclick = togglePlayback;
    gPlay.appendChild(btnPlay);

    var btnNext = el('button', 'hf-btn', 'Next \u2192');
    btnNext.type = 'button';
    btnNext.onclick = function () {
      goToSlide(state.currentIndex + 1);
    };
    gPlay.appendChild(btnNext);
    bar.appendChild(gPlay);

    // Interval selector group
    var gInt = el('div', 'hf-toolbar-group');
    gInt.appendChild(el('span', 'hf-toolbar-label', 'Slide Speed'));
    var sel = el('select', 'hf-toolbar-select');
    sel.id = 'hf-tb-interval-select';

    var optionsList = INTERVAL_PRESETS.slice(0);
    var hasCurrent = false;
    for (var i = 0; i < optionsList.length; i++) {
      if (optionsList[i] === state.localInterval) hasCurrent = true;
    }
    if (!hasCurrent) {
      optionsList.push(state.localInterval);
      optionsList.sort(function (a, b) {
        return a - b;
      });
    }
    for (var j = 0; j < optionsList.length; j++) {
      var sec = optionsList[j];
      var opt = el('option', '', sec + ' seconds');
      opt.value = String(sec);
      if (sec === state.localInterval) {
        opt.selected = true;
      }
      sel.appendChild(opt);
    }
    sel.onchange = function () {
      var val = parseInt(sel.value, 10);
      if (val >= 2 && val <= 3600) {
        state.localInterval = val;
        startSlideCycle();
        refreshPlaybackButtons();
      }
    };
    gInt.appendChild(sel);
    bar.appendChild(gInt);

    // Auto-Rotate & Fit toggles
    var gOpts = el('div', 'hf-toolbar-group');
    var btnRot = el(
      'button',
      'hf-btn hf-inline-btn',
      state.localAutoRotate ? 'Auto-Rotate: On' : 'Auto-Rotate: Off'
    );
    btnRot.id = 'hf-tb-rot-btn';
    btnRot.type = 'button';
    btnRot.onclick = function () {
      state.localAutoRotate = !state.localAutoRotate;
      startSlideCycle();
      refreshPlaybackButtons();
    };
    gOpts.appendChild(btnRot);

    var btnFit = el(
      'button',
      'hf-btn hf-inline-btn',
      state.localFitMode === 'cover' ? 'Fill Screen' : 'Fit Whole Photo'
    );
    btnFit.id = 'hf-tb-fit-btn';
    btnFit.type = 'button';
    btnFit.onclick = toggleFitMode;
    gOpts.appendChild(btnFit);

    var btnAwake = el(
      'button',
      'hf-btn',
      state.keepAwakeEnabled ? 'Keep Awake: On' : 'Keep Awake: Off'
    );
    btnAwake.id = 'hf-tb-awake-btn';
    btnAwake.type = 'button';
    btnAwake.title = 'Prevent tablet screen from sleeping during slideshow';
    btnAwake.onclick = toggleKeepScreenAwake;
    gOpts.appendChild(btnAwake);
    bar.appendChild(gOpts);

    // Right side primary Fullscreen CTA
    var gRight = el('div', 'hf-toolbar-right');
    var btnFs = el('button', 'hf-btn hf-btn-accent', 'Full Screen Mode');
    btnFs.type = 'button';
    btnFs.onclick = function () {
      enterFullscreenMode();
    };
    gRight.appendChild(btnFs);
    bar.appendChild(gRight);

    return bar;
  }

  function buildFilmstrip() {
    var sec = el('section', 'hf-filmstrip-section');
    sec.appendChild(
      el(
        'div',
        'hf-filmstrip-header',
        'Gallery Sequence  \u00B7  Tap any photo to jump directly'
      )
    );
    var strip = el('div', 'hf-filmstrip');
    strip.id = 'hf-filmstrip';

    for (var i = 0; i < state.slides.length; i++) {
      (function (idx, slide) {
        var item = el(
          'button',
          'hf-thumb-item' + (idx === state.currentIndex ? ' hf-thumb-item-active' : '')
        );
        item.type = 'button';
        item.onclick = function () {
          goToSlide(idx);
        };

        var frame = el('div', 'hf-thumb-frame');
        var img = el('img', 'hf-thumb-img');
        img.src = slide.thumbUrl;
        img.alt = slide.title || 'Photo ' + (idx + 1);
        img.setAttribute('referrerpolicy', 'no-referrer');
        img.onerror = function () {
          img.style.display = 'none';
        };
        frame.appendChild(img);
        item.appendChild(frame);

        item.appendChild(
          el('div', 'hf-thumb-label', (idx + 1) + '. ' + (slide.title || 'Untitled'))
        );
        strip.appendChild(item);
      })(i, state.slides[i]);
    }

    sec.appendChild(strip);
    return sec;
  }

  function togglePlayback() {
    state.playing = !state.playing;
    if (state.playing) {
      startSlideCycle();
    } else {
      stopSlideTimers();
    }
    refreshPlaybackButtons();
  }

  function adjustLocalInterval(direction) {
    var idx = -1;
    for (var i = 0; i < INTERVAL_PRESETS.length; i++) {
      if (INTERVAL_PRESETS[i] >= state.localInterval) {
        idx = i;
        break;
      }
    }
    if (idx === -1) idx = INTERVAL_PRESETS.length - 1;
    var nextIdx = idx + direction;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= INTERVAL_PRESETS.length) nextIdx = INTERVAL_PRESETS.length - 1;
    state.localInterval = INTERVAL_PRESETS[nextIdx];
    startSlideCycle();
    refreshPlaybackButtons();
  }

  function toggleFitMode() {
    state.localFitMode = state.localFitMode === 'cover' ? 'contain' : 'cover';
    var imgEl = document.getElementById('hf-stage-img');
    if (imgEl) {
      imgEl.className =
        'hf-stage-img ' +
        (state.localFitMode === 'cover' ? 'hf-stage-img-cover' : 'hf-stage-img-contain');
    }
    refreshPlaybackButtons();
  }

  function refreshPlaybackButtons() {
    var tbPlay = document.getElementById('hf-tb-play-btn');
    if (tbPlay) tbPlay.textContent = state.playing ? 'Pause' : 'Play';

    var fsPlay = document.getElementById('hf-fs-play-btn');
    if (fsPlay) {
      fsPlay.textContent = state.playing ? 'Pause' : 'Play';
      if (state.playing) removeClass(fsPlay, 'hf-fs-btn-active');
      else addClass(fsPlay, 'hf-fs-btn-active');
    }

    var tbRot = document.getElementById('hf-tb-rot-btn');
    if (tbRot) {
      tbRot.textContent = state.localAutoRotate ? 'Auto-Rotate: On' : 'Auto-Rotate: Off';
    }

    var fsRot = document.getElementById('hf-fs-rot-btn');
    if (fsRot) {
      fsRot.textContent = state.localAutoRotate ? 'Auto-Rotate: On' : 'Auto-Rotate: Off';
      if (state.localAutoRotate) addClass(fsRot, 'hf-fs-btn-active');
      else removeClass(fsRot, 'hf-fs-btn-active');
    }

    var fsReadout = document.getElementById('hf-fs-interval-readout');
    if (fsReadout) {
      fsReadout.textContent = state.localInterval + 's';
    }

    var sel = document.getElementById('hf-tb-interval-select');
    if (sel) {
      sel.value = String(state.localInterval);
    }

    var tbFit = document.getElementById('hf-tb-fit-btn');
    if (tbFit) {
      tbFit.textContent =
        state.localFitMode === 'cover' ? 'Fill Screen' : 'Fit Whole Photo';
    }

    var fsFit = document.getElementById('hf-fs-fit-btn');
    if (fsFit) {
      fsFit.textContent =
        state.localFitMode === 'cover' ? 'Mode: Fill' : 'Mode: Fit';
    }

    var tbAwake = document.getElementById('hf-tb-awake-btn');
    if (tbAwake) {
      tbAwake.textContent = state.keepAwakeEnabled
        ? 'Keep Awake: On'
        : 'Keep Awake: Off';
    }

    var fsAwake = document.getElementById('hf-fs-awake-btn');
    if (fsAwake) {
      fsAwake.textContent = state.keepAwakeEnabled
        ? 'Keep Awake: On'
        : 'Keep Awake: Off';
      if (state.keepAwakeEnabled) addClass(fsAwake, 'hf-fs-btn-active');
      else removeClass(fsAwake, 'hf-fs-btn-active');
    }
  }

  // =========================================================================
  // View 3: Admin Dashboard (Gallery, Display Profiles, System Settings, Access)
  // =========================================================================

  function renderAdminView(root) {
    // 3-Zone Top Bar
    var header = el('header', 'hf-header');
    var headerInner = el('div', 'hf-header-inner');

    var zoneBrand = el('div', 'hf-header-zone hf-zone-brand');
    zoneBrand.appendChild(buildBrandLogo());

    var zoneNav = el('div', 'hf-header-zone hf-zone-nav');
    var navItems = [
      { id: 'gallery', label: 'Photos' },
      { id: 'profiles', label: 'Display Profiles' },
      { id: 'access', label: 'Pair & Access' },
      { id: 'settings', label: 'Settings' }
    ];
    if (state.isOwner) {
      navItems.push({ id: 'accounts', label: 'Accounts' });
    }
    navItems.push({ id: 'preview', label: 'Slideshow' });

    for (var i = 0; i < navItems.length; i++) {
      (function (item) {
        var link = el(
          'button',
          'hf-nav-link' + (state.adminTab === item.id ? ' hf-nav-link-active' : ''),
          item.label
        );
        link.type = 'button';
        link.onclick = function () {
          state.adminNotice = '';
          state.adminError = '';
          if (item.id === 'preview') {
            loadVisitorProfilesAndStart(null, false);
            return;
          }
          state.adminTab = item.id;
          if (item.id === 'accounts' && state.isOwner) {
            loadOwnerAccounts();
            return;
          }
          render();
        };
        zoneNav.appendChild(link);
      })(navItems[i]);
    }

    var zoneAction = el('div', 'hf-header-zone hf-zone-action');
    var logoutBtn = el('button', 'hf-btn', 'Sign Out');
    logoutBtn.type = 'button';
    logoutBtn.onclick = signOut;
    zoneAction.appendChild(logoutBtn);

    headerInner.appendChild(zoneBrand);
    headerInner.appendChild(zoneNav);
    headerInner.appendChild(zoneAction);
    header.appendChild(headerInner);
    root.appendChild(header);

    var main = el('main', 'hf-container');

    if (state.adminNotice) {
      main.appendChild(el('div', 'hf-alert hf-alert-success', state.adminNotice));
    }
    if (state.adminError) {
      main.appendChild(el('div', 'hf-alert hf-alert-error', state.adminError));
    }

    // Gentle inline reminder when Admin hasn't created their Frontend tablet login yet
    if (
      !state.hasVisitorLogin &&
      !state.accessInfo.hasVisitorLogin &&
      state.adminTab !== 'access'
    ) {
      var visReminder = el('div', 'hf-alert hf-alert-info hf-reminder-bar hf-clearfix');
      var visText = el(
        'span',
        'hf-reminder-text',
        'Ready to connect a TV or tablet? Pair it in seconds with a QR code, or set an optional Frame Display password.'
      );
      var visGoBtn = el('button', 'hf-btn hf-btn-accent hf-btn-sm hf-reminder-btn', 'Pair a Screen');
      visGoBtn.type = 'button';
      visGoBtn.onclick = function () {
        state.adminNotice = '';
        state.adminError = '';
        state.adminTab = 'access';
        render();
      };
      visReminder.appendChild(visText);
      visReminder.appendChild(visGoBtn);
      main.appendChild(visReminder);
    }

    if (state.adminTab === 'gallery') {
      renderAdminGalleryTab(main);
    } else if (state.adminTab === 'profiles') {
      renderAdminProfilesTab(main);
    } else if (state.adminTab === 'settings') {
      renderAdminSettingsTab(main);
    } else if (state.adminTab === 'access') {
      renderAdminAccessTab(main);
    } else if (state.adminTab === 'accounts' && state.isOwner) {
      renderOwnerAccountsTab(main);
    }

    root.appendChild(main);
  }

  function slideHasProfile(slide, profileId) {
    if (!slide || !slide.profileIds || !slide.profileIds.length) return false;
    for (var i = 0; i < slide.profileIds.length; i++) {
      if (slide.profileIds[i] === profileId) return true;
    }
    return false;
  }

  function countSlidesForProfile(profileId) {
    var count = 0;
    for (var i = 0; i < state.slides.length; i++) {
      if (slideHasProfile(state.slides[i], profileId)) {
        count++;
      }
    }
    return count;
  }

  function renderAdminGalleryTab(main) {
    var activeCount = 0;
    for (var k = 0; k < state.slides.length; k++) {
      if (state.slides[k].enabled) activeCount++;
    }
    var photoLimit = state.quota && state.quota.limit ? state.quota.limit : null;
    var atPhotoLimit = photoLimit !== null && state.slides.length >= photoLimit;

    var head = el('div', 'hf-page-head');
    head.appendChild(el('h1', 'hf-heading', 'Image Gallery'));
    var countLabel = photoLimit !== null
      ? state.slides.length + ' / ' + photoLimit + ' photos'
      : state.slides.length + ' shared photos';
    head.appendChild(
      el(
        'p',
        'hf-meta-line',
        countLabel +
          '  \u00B7  ' +
          activeCount +
          ' active  \u00B7  ' +
          state.profiles.length +
          (state.profiles.length === 1 ? ' display profile' : ' display profiles')
      )
    );
    main.appendChild(head);

    // Upload Panel
    var uploadPanel = el('section', 'hf-upload-panel');
    uploadPanel.appendChild(el('h2', 'hf-subheading', 'Add Photos to Shared Gallery'));
    uploadPanel.appendChild(
      el(
        'p',
        'hf-meta-line',
        'Photos are stored once and can be shown on any combination of Display Profiles (iPad, TV, Android Tablet).'
      )
    );

    if (atPhotoLimit) {
      var capAlert = el(
        'div',
        'hf-alert hf-alert-error',
        'Photo limit reached (' +
          state.slides.length +
          ' / ' +
          photoLimit +
          '). Delete older photos below to upload new ones.'
      );
      capAlert.style.marginTop = '14px';
      uploadPanel.appendChild(capAlert);
    }

    if (state.uploadDropWarning) {
      var warnMsg = el('div', 'hf-alert hf-alert-info', state.uploadDropWarning);
      warnMsg.style.marginTop = '14px';
      uploadPanel.appendChild(warnMsg);
    }

    if (state.uploading && state.uploadStatus) {
      var progBox = el('div', 'hf-upload-progress');
      progBox.appendChild(el('div', 'hf-upload-progress-text', state.uploadStatus));
      var progTrack = el('div', 'hf-upload-progress-track');
      var progFill = el('div', 'hf-upload-progress-fill');
      var pct = 0;
      if (state.uploadTotalCount > 0) {
        pct = Math.round((state.uploadCurrentIndex / state.uploadTotalCount) * 100);
        if (pct < 4) pct = 4;
        if (pct > 100) pct = 100;
      }
      progFill.style.width = pct + '%';
      progTrack.appendChild(progFill);
      progBox.appendChild(progTrack);
      uploadPanel.appendChild(progBox);
    } else if (state.uploadStatus) {
      var upMsg = el('div', 'hf-alert hf-alert-info', state.uploadStatus);
      upMsg.style.marginTop = '14px';
      uploadPanel.appendChild(upMsg);
    }

    var uploadForm = el('form');
    uploadForm.style.marginTop = '16px';

    // Hidden native file input (multi-select fallback + click target for dropzone)
    var fileInput = el('input', 'hf-file-input-hidden');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.disabled = state.uploading || atPhotoLimit;
    fileInput.onchange = function () {
      if (fileInput.files && fileInput.files.length) {
        addFilesToUploadQueue(fileInput.files);
      }
      try {
        fileInput.value = '';
      } catch (resetErr) {
        // Ignore on legacy browsers that disallow resetting file input value
      }
    };
    uploadForm.appendChild(fileInput);

    // Drag & Drop Zone (with full click + keyboard fallback for legacy tablets/mobile)
    var dropDisabled = state.uploading || atPhotoLimit;
    var dropzone = el(
      'div',
      'hf-dropzone' + (dropDisabled ? ' hf-dropzone-disabled' : '')
    );
    dropzone.setAttribute('role', 'button');
    dropzone.setAttribute('tabindex', dropDisabled ? '-1' : '0');
    dropzone.setAttribute(
      'aria-label',
      'Drag and drop multiple photos here or click to browse files'
    );

    if (document.createElementNS) {
      var iconWrap = el('div', 'hf-dropzone-icon');
      var dzSvg = svgEl('svg', {
        width: '40',
        height: '40',
        viewBox: '0 0 40 40',
        'aria-hidden': 'true',
        focusable: 'false'
      });
      dzSvg.appendChild(
        svgEl('rect', {
          x: '4',
          y: '10',
          width: '26',
          height: '20',
          rx: '3',
          fill: '#fff8ef',
          stroke: '#c2591a',
          'stroke-width': '2'
        })
      );
      dzSvg.appendChild(
        svgEl('path', {
          d: 'M10 10V7a2 2 0 0 1 2-2h22a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-4',
          fill: 'none',
          stroke: '#d6a478',
          'stroke-width': '2',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round'
        })
      );
      dzSvg.appendChild(
        svgEl('circle', {
          cx: '12',
          cy: '17',
          r: '2.2',
          fill: '#e88b3a'
        })
      );
      dzSvg.appendChild(
        svgEl('path', {
          d: 'M6 27l6-6 5 4.5 4.5-4.5 6.5 6',
          fill: 'none',
          stroke: '#c2591a',
          'stroke-width': '2',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round'
        })
      );
      iconWrap.appendChild(dzSvg);
      dropzone.appendChild(iconWrap);
    }

    var dzTitle = el(
      'div',
      'hf-dropzone-title',
      atPhotoLimit
        ? 'Photo library limit reached'
        : state.uploading
          ? 'Uploading photos...'
          : 'Drag & drop multiple photos here'
    );
    dropzone.appendChild(dzTitle);

    var remainingSlots =
      photoLimit !== null
        ? Math.max(0, photoLimit - state.slides.length - state.pendingUploadFiles.length)
        : null;
    var dzSubText = 'JPG, PNG, GIF, or WebP  \u00B7  Automatically resized before upload';
    if (remainingSlots !== null && !atPhotoLimit) {
      dzSubText +=
        '  \u00B7  ' +
        remainingSlots +
        (remainingSlots === 1 ? ' slot remaining' : ' slots remaining');
    }
    dropzone.appendChild(el('div', 'hf-dropzone-sub', dzSubText));

    var browseBtn = el(
      'button',
      'hf-btn hf-btn-secondary hf-dropzone-btn',
      state.pendingUploadFiles.length > 0 ? 'Add More Photos' : 'Browse Photos'
    );
    browseBtn.type = 'button';
    browseBtn.disabled = dropDisabled;
    browseBtn.onclick = function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      if (!dropDisabled) {
        fileInput.click();
      }
    };
    dropzone.appendChild(browseBtn);

    if (!dropDisabled) {
      var dropDragDepth = 0;

      dropzone.onclick = function () {
        fileInput.click();
      };

      dropzone.onkeydown = function (ev) {
        var key = ev ? ev.keyCode || ev.which : 0;
        if (key === 13 || key === 32) {
          if (ev && ev.preventDefault) ev.preventDefault();
          fileInput.click();
        }
      };

      dropzone.ondragenter = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (ev && ev.stopPropagation) ev.stopPropagation();
        dropDragDepth++;
        if (dropzone.className.indexOf('hf-dropzone-active') === -1) {
          dropzone.className = 'hf-dropzone hf-dropzone-active';
        }
        dzTitle.textContent = 'Drop photos to add them to the queue';
      };

      dropzone.ondragover = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (ev && ev.stopPropagation) ev.stopPropagation();
        if (ev && ev.dataTransfer) {
          try {
            ev.dataTransfer.dropEffect = 'copy';
          } catch (deErr) {
            // Ignore on older browsers
          }
        }
      };

      dropzone.ondragleave = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (ev && ev.stopPropagation) ev.stopPropagation();
        dropDragDepth--;
        if (dropDragDepth <= 0) {
          dropDragDepth = 0;
          dropzone.className = 'hf-dropzone';
          dzTitle.textContent = 'Drag & drop multiple photos here';
        }
      };

      dropzone.ondrop = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (ev && ev.stopPropagation) ev.stopPropagation();
        dropDragDepth = 0;
        dropzone.className = 'hf-dropzone';
        dzTitle.textContent = 'Drag & drop multiple photos here';
        var dt = ev ? ev.dataTransfer : null;
        if (dt && dt.files && dt.files.length) {
          addFilesToUploadQueue(dt.files);
        }
      };

      // Guard the surrounding upload panel so slightly missed drops don't navigate away
      uploadPanel.ondragover = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
      };
      uploadPanel.ondrop = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        var dt = ev ? ev.dataTransfer : null;
        if (dt && dt.files && dt.files.length && !state.uploading && !atPhotoLimit) {
          addFilesToUploadQueue(dt.files);
        }
      };
    }

    uploadForm.appendChild(dropzone);

    // Queued Photos Preview List
    if (state.pendingUploadFiles.length > 0) {
      var totalQueueBytes = 0;
      for (var qb = 0; qb < state.pendingUploadFiles.length; qb++) {
        totalQueueBytes += state.pendingUploadFiles[qb].file.size || 0;
      }

      var queueBox = el('div', 'hf-upload-queue');
      var queueHead = el('div', 'hf-queue-head hf-clearfix');
      queueHead.appendChild(
        el(
          'span',
          'hf-queue-summary',
          state.pendingUploadFiles.length +
            (state.pendingUploadFiles.length === 1
              ? ' photo ready to upload'
              : ' photos ready to upload') +
            '  \u00B7  ' +
            formatBytes(totalQueueBytes)
        )
      );

      var clearQueueBtn = el('button', 'hf-queue-clear', 'Clear All');
      clearQueueBtn.type = 'button';
      clearQueueBtn.disabled = state.uploading;
      clearQueueBtn.onclick = function () {
        clearPendingUploadFiles();
        render();
      };
      queueHead.appendChild(clearQueueBtn);
      queueBox.appendChild(queueHead);

      var queueList = el('div', 'hf-queue-list');
      for (var qi = 0; qi < state.pendingUploadFiles.length; qi++) {
        (function (qItem) {
          var row = el('div', 'hf-queue-item hf-clearfix');

          var thumbWrap = el('div', 'hf-queue-thumb');
          if (qItem.previewUrl) {
            var qImg = el('img');
            qImg.src = qItem.previewUrl;
            qImg.alt = qItem.file.name;
            thumbWrap.appendChild(qImg);
          } else {
            thumbWrap.appendChild(el('span', 'hf-queue-thumb-fallback', 'IMG'));
          }
          row.appendChild(thumbWrap);

          var remBtn = el('button', 'hf-queue-remove', 'Remove');
          remBtn.type = 'button';
          remBtn.disabled = state.uploading;
          remBtn.setAttribute('aria-label', 'Remove ' + qItem.file.name);
          remBtn.onclick = function () {
            removePendingUploadFile(qItem.id);
          };
          row.appendChild(remBtn);

          var infoWrap = el('div', 'hf-queue-info');
          infoWrap.appendChild(el('div', 'hf-queue-name', qItem.file.name));
          infoWrap.appendChild(
            el('div', 'hf-queue-size', formatBytes(qItem.file.size || 0))
          );
          row.appendChild(infoWrap);

          queueList.appendChild(row);
        })(state.pendingUploadFiles[qi]);
      }
      queueBox.appendChild(queueList);
      uploadForm.appendChild(queueBox);
    }

    // Optional Title & Caption row (2 columns)
    var upRow = el('div', 'hf-upload-meta-row hf-clearfix');

    var colTitle = el('div', 'hf-upload-meta-col');
    colTitle.appendChild(el('label', 'hf-label', 'Title (Optional)'));
    var titleInput = el('input', 'hf-input');
    titleInput.type = 'text';
    titleInput.maxLength = 80;
    titleInput.placeholder = 'Defaults to each photo file name';
    titleInput.value = state.uploadTitleInput || '';
    titleInput.disabled = state.uploading || atPhotoLimit;
    titleInput.oninput = function () {
      state.uploadTitleInput = titleInput.value;
    };
    colTitle.appendChild(titleInput);
    upRow.appendChild(colTitle);

    var colCap = el('div', 'hf-upload-meta-col');
    colCap.appendChild(el('label', 'hf-label', 'Caption (Optional)'));
    var capInput = el('input', 'hf-input');
    capInput.type = 'text';
    capInput.maxLength = 160;
    capInput.placeholder = 'Short memory or location (applied to batch)';
    capInput.value = state.uploadCaptionInput || '';
    capInput.disabled = state.uploading || atPhotoLimit;
    capInput.oninput = function () {
      state.uploadCaptionInput = capInput.value;
    };
    colCap.appendChild(capInput);
    upRow.appendChild(colCap);

    uploadForm.appendChild(upRow);

    // Profile assignment checkboxes for uploaded photos
    var uploadProfileCheckboxes = [];
    if (state.profiles.length > 0) {
      var assignBox = el('div', 'hf-assign-box');
      assignBox.appendChild(el('div', 'hf-assign-title', 'Show Uploaded Photos On'));
      for (var p = 0; p < state.profiles.length; p++) {
        (function (profItem) {
          var lbl = el('label', 'hf-assign-item');
          var chk = el('input');
          chk.type = 'checkbox';
          chk.value = profItem.id;
          if (state.uploadSelectedProfileIds !== null) {
            var matchedSel = false;
            for (var sp = 0; sp < state.uploadSelectedProfileIds.length; sp++) {
              if (state.uploadSelectedProfileIds[sp] === profItem.id) {
                matchedSel = true;
                break;
              }
            }
            chk.checked = matchedSel;
          } else {
            chk.checked =
              state.galleryFilterProfileId === 'all' ||
              state.galleryFilterProfileId === profItem.id;
          }
          chk.disabled = state.uploading || atPhotoLimit;
          chk.onchange = function () {
            var nextIds = [];
            for (var ci = 0; ci < uploadProfileCheckboxes.length; ci++) {
              if (uploadProfileCheckboxes[ci].checked) {
                nextIds.push(uploadProfileCheckboxes[ci].value);
              }
            }
            state.uploadSelectedProfileIds = nextIds;
          };
          lbl.appendChild(chk);
          lbl.appendChild(document.createTextNode(profItem.name));
          assignBox.appendChild(lbl);
          uploadProfileCheckboxes.push(chk);
        })(state.profiles[p]);
      }
      uploadForm.appendChild(assignBox);
    }

    var queuedCount = state.pendingUploadFiles.length;
    var uploadBtnLabel = state.uploading
      ? 'Optimizing & Uploading...'
      : atPhotoLimit
        ? 'Photo Limit Reached'
        : queuedCount > 0
          ? 'Upload ' + queuedCount + (queuedCount === 1 ? ' Photo' : ' Photos')
          : 'Upload Selected Photos';

    var uploadBtn = el('button', 'hf-btn hf-btn-accent', uploadBtnLabel);
    uploadBtn.type = 'submit';
    uploadBtn.disabled = state.uploading || atPhotoLimit;
    uploadForm.appendChild(uploadBtn);

    uploadForm.onsubmit = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (!state.pendingUploadFiles.length) {
        state.adminError = 'Drag and drop photos above or click Browse Photos first.';
        render();
        return false;
      }
      var list = [];
      for (var i = 0; i < state.pendingUploadFiles.length; i++) {
        list.push(state.pendingUploadFiles[i].file);
      }
      var chosenProfileIds = [];
      for (var c = 0; c < uploadProfileCheckboxes.length; c++) {
        if (uploadProfileCheckboxes[c].checked) {
          chosenProfileIds.push(uploadProfileCheckboxes[c].value);
        }
      }
      state.uploadDropWarning = '';
      uploadBatchSequential(
        list,
        0,
        titleInput.value,
        capInput.value,
        chosenProfileIds,
        0,
        0,
        0,
        0,
        ''
      );
      return false;
    };

    uploadPanel.appendChild(uploadForm);
    main.appendChild(uploadPanel);

    // Profile Filter Bar
    if (state.profiles.length > 1) {
      var filterBar = el('div', 'hf-filter-bar');
      var allBtn = el(
        'button',
        'hf-filter-btn' +
          (state.galleryFilterProfileId === 'all' ? ' hf-filter-btn-active' : ''),
        'All Photos (' + state.slides.length + ')'
      );
      allBtn.type = 'button';
      allBtn.onclick = function () {
        state.galleryFilterProfileId = 'all';
        render();
      };
      filterBar.appendChild(allBtn);

      for (var fp = 0; fp < state.profiles.length; fp++) {
        (function (prof) {
          var count = countSlidesForProfile(prof.id);
          var fBtn = el(
            'button',
            'hf-filter-btn' +
              (state.galleryFilterProfileId === prof.id ? ' hf-filter-btn-active' : ''),
            prof.name + ' (' + count + ')'
          );
          fBtn.type = 'button';
          fBtn.onclick = function () {
            state.galleryFilterProfileId = prof.id;
            render();
          };
          filterBar.appendChild(fBtn);
        })(state.profiles[fp]);
      }
      main.appendChild(filterBar);
    }

    // Filter slides by selected profile tab
    var visibleSlides = [];
    for (var s = 0; s < state.slides.length; s++) {
      if (
        state.galleryFilterProfileId === 'all' ||
        slideHasProfile(state.slides[s], state.galleryFilterProfileId)
      ) {
        visibleSlides.push({ slide: state.slides[s], fullIndex: s });
      }
    }

    if (visibleSlides.length === 0) {
      var empty = el('div', 'hf-empty-state');
      empty.appendChild(
        el(
          'h2',
          'hf-empty-title',
          state.galleryFilterProfileId === 'all'
            ? 'Your gallery is empty'
            : 'No photos assigned to this profile yet'
        )
      );
      empty.appendChild(
        el(
          'p',
          'hf-empty-desc',
          state.galleryFilterProfileId === 'all'
            ? 'Upload photos above to start your household slideshow.'
            : 'Upload new photos above or switch to "All Photos" to check this profile on existing photos.'
        )
      );
      main.appendChild(empty);
      return;
    }

    var canReorder = state.galleryFilterProfileId === 'all';
    var grid = el('div', 'hf-gallery-grid hf-clearfix');
    for (var i = 0; i < visibleSlides.length; i++) {
      grid.appendChild(
        buildAdminSlideCard(
          visibleSlides[i].slide,
          visibleSlides[i].fullIndex,
          canReorder
        )
      );
    }
    main.appendChild(grid);
  }

  function isSupportedImageFile(file) {
    if (!file) return false;
    if (file.type && file.type.indexOf('image/') === 0) {
      return true;
    }
    var name = file.name ? file.name.toLowerCase() : '';
    return /\.(jpe?g|png|gif|webp|bmp)$/.test(name);
  }

  function createUploadPreviewUrl(file) {
    var urlApi = window.URL || window.webkitURL;
    if (!urlApi || !urlApi.createObjectURL) return null;
    try {
      return urlApi.createObjectURL(file);
    } catch (e) {
      return null;
    }
  }

  function revokeUploadPreviewUrl(url) {
    if (!url) return;
    var urlApi = window.URL || window.webkitURL;
    if (urlApi && urlApi.revokeObjectURL) {
      try {
        urlApi.revokeObjectURL(url);
      } catch (e) {
        // Ignore cleanup error
      }
    }
  }

  function clearPendingUploadFiles() {
    for (var i = 0; i < state.pendingUploadFiles.length; i++) {
      revokeUploadPreviewUrl(state.pendingUploadFiles[i].previewUrl);
    }
    state.pendingUploadFiles = [];
    state.uploadDropWarning = '';
  }

  function removePendingUploadFile(itemId) {
    var next = [];
    for (var i = 0; i < state.pendingUploadFiles.length; i++) {
      if (state.pendingUploadFiles[i].id === itemId) {
        revokeUploadPreviewUrl(state.pendingUploadFiles[i].previewUrl);
      } else {
        next.push(state.pendingUploadFiles[i]);
      }
    }
    state.pendingUploadFiles = next;
    if (next.length === 0) {
      state.uploadDropWarning = '';
    }
    render();
  }

  function addFilesToUploadQueue(fileList) {
    if (!fileList || !fileList.length) return;
    var photoLimit = state.quota && state.quota.limit ? state.quota.limit : null;
    var maxAddable =
      photoLimit !== null
        ? Math.max(0, photoLimit - state.slides.length - state.pendingUploadFiles.length)
        : 1000;

    var skippedNonImage = 0;
    var skippedDuplicate = 0;
    var skippedLimit = 0;
    var addedCount = 0;

    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      if (!isSupportedImageFile(f)) {
        skippedNonImage++;
        continue;
      }
      var isDup = false;
      for (var j = 0; j < state.pendingUploadFiles.length; j++) {
        var existing = state.pendingUploadFiles[j].file;
        if (
          existing.name === f.name &&
          existing.size === f.size &&
          existing.lastModified === f.lastModified
        ) {
          isDup = true;
          break;
        }
      }
      if (isDup) {
        skippedDuplicate++;
        continue;
      }
      if (addedCount >= maxAddable) {
        skippedLimit++;
        continue;
      }
      state.pendingUploadFiles.push({
        id: 'q_' + Date.now() + '_' + Math.floor(Math.random() * 100000) + '_' + i,
        file: f,
        previewUrl: createUploadPreviewUrl(f)
      });
      addedCount++;
    }

    var notes = [];
    if (skippedNonImage > 0) {
      notes.push(
        skippedNonImage +
          (skippedNonImage === 1
            ? ' non-image file skipped'
            : ' non-image files skipped')
      );
    }
    if (skippedDuplicate > 0) {
      notes.push(
        skippedDuplicate +
          (skippedDuplicate === 1
            ? ' duplicate skipped'
            : ' duplicates skipped')
      );
    }
    if (skippedLimit > 0 && photoLimit !== null) {
      notes.push(
        skippedLimit +
          (skippedLimit === 1
            ? ' photo skipped (reached ' + photoLimit + '-photo limit)'
            : ' photos skipped (reached ' + photoLimit + '-photo limit)')
      );
    }

    state.adminError = '';
    state.uploadDropWarning = notes.length > 0 ? notes.join('  \u00B7  ') + '.' : '';
    render();
  }

  function uploadBatchSequential(
    files,
    index,
    customTitle,
    customCaption,
    selectedProfileIds,
    totalOrig,
    totalOpt,
    succeededCount,
    skippedCount,
    lastErrMsg
  ) {
    if (index === 0) {
      state.uploading = true;
      state.uploadTotalCount = files.length;
      state.uploadCurrentIndex = 0;
      state.adminError = '';
      state.adminNotice = '';
    }
    if (index >= files.length) {
      state.uploading = false;
      state.uploadStatus = '';
      state.uploadCurrentIndex = 0;
      state.uploadTotalCount = 0;
      clearPendingUploadFiles();
      state.uploadTitleInput = '';
      state.uploadCaptionInput = '';

      if (succeededCount > 0) {
        var savings =
          totalOrig > 0 && totalOpt > 0
            ? ' (' + formatBytes(totalOrig) + ' \u2192 ' + formatBytes(totalOpt) + ' optimized)'
            : '';
        state.adminNotice =
          'Uploaded ' +
          succeededCount +
          (succeededCount === 1 ? ' photo' : ' photos') +
          savings +
          (skippedCount > 0
            ? '. ' + skippedCount + (skippedCount === 1 ? ' photo skipped.' : ' photos skipped.')
            : '.');
        if (skippedCount > 0 && lastErrMsg) {
          state.adminError = lastErrMsg;
        }
        loadAdminData();
      } else {
        state.adminError = lastErrMsg || 'No photos could be uploaded.';
        render();
      }
      return;
    }

    var file = files[index];
    state.uploadCurrentIndex = index + 1;
    state.uploadStatus =
      'Optimizing & uploading photo ' +
      (index + 1) +
      ' of ' +
      files.length +
      '  \u00B7  ' +
      file.name;
    render();

    prepareImageFile(file, function (prepErr, result) {
      if (prepErr || !result) {
        uploadBatchSequential(
          files,
          index + 1,
          customTitle,
          customCaption,
          selectedProfileIds,
          totalOrig,
          totalOpt,
          succeededCount,
          skippedCount + 1,
          prepErr || 'Could not process ' + file.name
        );
        return;
      }

      var baseName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      var slideTitle =
        customTitle && files.length === 1
          ? customTitle
          : customTitle
            ? customTitle + ' (' + (index + 1) + ')'
            : baseName || 'Photo ' + (index + 1);

      apiRequest(
        'POST',
        '/api/admin/slides',
        {
          title: slideTitle,
          caption: customCaption || '',
          profileIds: selectedProfileIds,
          displayData: result.displayData,
          thumbData: result.thumbData
        },
        function (apiErr) {
          if (apiErr) {
            // Stop immediately if photo limit or authentication error occurred
            if (
              apiErr.toLowerCase().indexOf('limit') !== -1 ||
              apiErr.toLowerCase().indexOf('auth') !== -1
            ) {
              uploadBatchSequential(
                files,
                files.length,
                customTitle,
                customCaption,
                selectedProfileIds,
                totalOrig,
                totalOpt,
                succeededCount,
                skippedCount + (files.length - index),
                apiErr
              );
              return;
            }
            uploadBatchSequential(
              files,
              index + 1,
              customTitle,
              customCaption,
              selectedProfileIds,
              totalOrig,
              totalOpt,
              succeededCount,
              skippedCount + 1,
              apiErr
            );
            return;
          }
          uploadBatchSequential(
            files,
            index + 1,
            customTitle,
            customCaption,
            selectedProfileIds,
            totalOrig + result.originalBytes,
            totalOpt + result.optimizedBytes,
            succeededCount + 1,
            skippedCount,
            lastErrMsg
          );
        }
      );
    });
  }

  function toggleSlideProfileAssignment(slide, profileId, isChecked) {
    var current = slide.profileIds ? slide.profileIds.slice(0) : [];
    var next = [];
    for (var i = 0; i < current.length; i++) {
      if (current[i] !== profileId) {
        next.push(current[i]);
      }
    }
    if (isChecked) {
      next.push(profileId);
    }

    apiRequest(
      'PUT',
      '/api/admin/slides/' + encodeURIComponent(slide.id),
      { profileIds: next },
      function (err) {
        if (err) {
          state.adminError = err;
          render();
          return;
        }
        loadAdminData();
      }
    );
  }

  function buildAdminSlideCard(slide, index, canReorder) {
    var col = el('div', 'hf-gallery-col');
    var card = el(
      'article',
      'hf-slide-card' + (slide.enabled ? '' : ' hf-slide-card-hidden')
    );

    var media = el('div', 'hf-slide-media');
    var img = el('img');
    img.src = slide.thumbUrl;
    img.alt = slide.title || 'Gallery photo';
    img.setAttribute('referrerpolicy', 'no-referrer');
    var fb = el('div', 'hf-slide-media-fallback', slide.title || 'Photo preview');
    fb.style.display = 'none';
    img.onerror = function () {
      img.style.display = 'none';
      fb.style.display = 'block';
    };
    media.appendChild(img);
    media.appendChild(fb);
    card.appendChild(media);

    var body = el('div', 'hf-slide-body');

    if (state.editingSlideId === slide.id) {
      var editForm = el('form');
      var f1 = el('div', 'hf-field');
      f1.style.marginBottom = '10px';
      f1.appendChild(el('label', 'hf-label', 'Title'));
      var inT = el('input', 'hf-input');
      inT.type = 'text';
      inT.maxLength = 80;
      inT.value = slide.title || '';
      f1.appendChild(inT);
      editForm.appendChild(f1);

      var f2 = el('div', 'hf-field');
      f2.style.marginBottom = '12px';
      f2.appendChild(el('label', 'hf-label', 'Caption'));
      var inC = el('input', 'hf-input');
      inC.type = 'text';
      inC.maxLength = 160;
      inC.value = slide.caption || '';
      f2.appendChild(inC);
      editForm.appendChild(f2);

      var saveEdit = el('button', 'hf-btn hf-btn-primary hf-btn-sm hf-inline-btn', 'Save');
      saveEdit.type = 'submit';
      editForm.appendChild(saveEdit);

      var cancelEdit = el('button', 'hf-btn hf-btn-sm', 'Cancel');
      cancelEdit.type = 'button';
      cancelEdit.onclick = function () {
        state.editingSlideId = null;
        render();
      };
      editForm.appendChild(cancelEdit);

      editForm.onsubmit = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        apiRequest(
          'PUT',
          '/api/admin/slides/' + encodeURIComponent(slide.id),
          {
            title: inT.value,
            caption: inC.value
          },
          function (err) {
            if (err) {
              state.adminError = err;
              render();
              return;
            }
            state.editingSlideId = null;
            state.adminNotice = 'Photo details updated.';
            loadAdminData();
          }
        );
        return false;
      };
      body.appendChild(editForm);
    } else {
      body.appendChild(el('h3', 'hf-slide-title', slide.title || 'Untitled Photo'));
      body.appendChild(el('p', 'hf-slide-caption', slide.caption || 'No caption'));

      var metaLine =
        'Slide ' +
        (index + 1) +
        '  \u00B7  ' +
        (slide.enabled ? 'Shown' : 'Hidden') +
        '  \u00B7  ' +
        formatBytes(slide.sizeBytes);
      body.appendChild(el('div', 'hf-slide-meta hf-mono', metaLine));

      // Per-photo Display Profile checkboxes
      if (state.profiles.length > 0) {
        var assignWrap = el('div', 'hf-assign-box');
        assignWrap.appendChild(el('div', 'hf-assign-title', 'Show on Profiles'));
        for (var p = 0; p < state.profiles.length; p++) {
          (function (prof) {
            var lbl = el('label', 'hf-assign-item');
            var chk = el('input');
            chk.type = 'checkbox';
            chk.checked = slideHasProfile(slide, prof.id);
            chk.onchange = function () {
              toggleSlideProfileAssignment(slide, prof.id, chk.checked);
            };
            lbl.appendChild(chk);
            lbl.appendChild(document.createTextNode(prof.name));
            assignWrap.appendChild(lbl);
          })(state.profiles[p]);
        }
        body.appendChild(assignWrap);
      }

      var actions = el('div', 'hf-slide-actions');

      var btnLeft = el('button', 'hf-btn hf-btn-sm', '\u2190');
      btnLeft.type = 'button';
      btnLeft.title = canReorder ? 'Move earlier' : 'Switch to All Photos to reorder';
      btnLeft.disabled = !canReorder || index === 0;
      btnLeft.onclick = function () {
        reorderSlide(index, index - 1);
      };
      actions.appendChild(btnLeft);

      var btnRight = el('button', 'hf-btn hf-btn-sm', '\u2192');
      btnRight.type = 'button';
      btnRight.title = canReorder ? 'Move later' : 'Switch to All Photos to reorder';
      btnRight.disabled = !canReorder || index === state.slides.length - 1;
      btnRight.onclick = function () {
        reorderSlide(index, index + 1);
      };
      actions.appendChild(btnRight);

      var btnToggle = el(
        'button',
        'hf-btn hf-btn-sm',
        slide.enabled ? 'Hide' : 'Show'
      );
      btnToggle.type = 'button';
      btnToggle.onclick = function () {
        apiRequest(
          'PUT',
          '/api/admin/slides/' + encodeURIComponent(slide.id),
          { enabled: !slide.enabled },
          function (err) {
            if (err) {
              state.adminError = err;
              render();
              return;
            }
            loadAdminData();
          }
        );
      };
      actions.appendChild(btnToggle);

      var btnEdit = el('button', 'hf-btn hf-btn-sm', 'Edit');
      btnEdit.type = 'button';
      btnEdit.onclick = function () {
        state.editingSlideId = slide.id;
        state.confirmDeleteId = null;
        render();
      };
      actions.appendChild(btnEdit);

      if (state.confirmDeleteId === slide.id) {
        var btnConfirm = el('button', 'hf-btn hf-btn-danger-solid hf-btn-sm', 'Confirm Delete');
        btnConfirm.type = 'button';
        btnConfirm.onclick = function () {
          apiRequest(
            'DELETE',
            '/api/admin/slides/' + encodeURIComponent(slide.id),
            null,
            function (err) {
              state.confirmDeleteId = null;
              if (err) {
                state.adminError = err;
                render();
                return;
              }
              state.adminNotice = 'Photo removed from gallery.';
              loadAdminData();
            }
          );
        };
        actions.appendChild(btnConfirm);

        var btnCancelDel = el('button', 'hf-btn hf-btn-sm', 'Keep');
        btnCancelDel.type = 'button';
        btnCancelDel.onclick = function () {
          state.confirmDeleteId = null;
          render();
        };
        actions.appendChild(btnCancelDel);
      } else {
        var btnDel = el('button', 'hf-btn hf-btn-danger hf-btn-sm', 'Delete');
        btnDel.type = 'button';
        btnDel.onclick = function () {
          state.confirmDeleteId = slide.id;
          render();
        };
        actions.appendChild(btnDel);
      }

      body.appendChild(actions);
    }

    card.appendChild(body);
    col.appendChild(card);
    return col;
  }

  function reorderSlide(fromIdx, toIdx) {
    if (toIdx < 0 || toIdx >= state.slides.length) return;
    var ids = [];
    for (var i = 0; i < state.slides.length; i++) {
      ids.push(state.slides[i].id);
    }
    var moved = ids.splice(fromIdx, 1)[0];
    ids.splice(toIdx, 0, moved);

    apiRequest(
      'POST',
      '/api/admin/slides/reorder',
      { orderedIds: ids },
      function (err) {
        if (err) {
          state.adminError = err;
          render();
          return;
        }
        loadAdminData();
      }
    );
  }

  // =========================================================================
  // Admin Tab: Display Profiles (Create, Edit, Preview, Delete)
  // =========================================================================

  function renderAdminProfilesTab(main) {
    var head = el('div', 'hf-page-head');
    head.appendChild(el('h1', 'hf-heading', 'Display Profiles'));
    head.appendChild(
      el(
        'p',
        'hf-meta-line',
        state.profiles.length +
          (state.profiles.length === 1 ? ' display profile' : ' display profiles') +
          '  \u00B7  Create tailored screens for your iPad, Living Room TV, or Old Android Tablet'
      )
    );
    main.appendChild(head);

    // Create New Profile Panel
    var createCard = el('section', 'hf-card');
    createCard.style.marginBottom = '24px';
    createCard.appendChild(el('h2', 'hf-subheading', 'Create New Display Profile'));
    createCard.appendChild(
      el(
        'p',
        'hf-meta-line',
        'Each profile has its own slide interval, scaling, transition, clock, R2 delivery mode, and photo selection.'
      )
    );

    var createForm = el('form');
    createForm.style.marginTop = '16px';

    var cRow = el('div', 'hf-two-col hf-clearfix');

    var cCol1 = el('div', 'hf-col-half');
    cCol1.style.marginBottom = '0';
    var fNewName = el('div', 'hf-field');
    fNewName.appendChild(el('label', 'hf-label', 'Profile Name'));
    var inNewName = el('input', 'hf-input');
    inNewName.type = 'text';
    inNewName.maxLength = 50;
    inNewName.placeholder = 'e.g., Living Room TV or Kitchen iPad';
    fNewName.appendChild(inNewName);
    cCol1.appendChild(fNewName);
    cRow.appendChild(cCol1);

    var cCol2 = el('div', 'hf-col-half');
    cCol2.style.marginBottom = '0';
    var fPreset = el('div', 'hf-field');
    fPreset.appendChild(el('label', 'hf-label', 'Device Preset'));
    var selPreset = el('select', 'hf-select');
    var presetKeys = ['tv', 'ipad', 'tablet_legacy', 'custom'];
    for (var pk = 0; pk < presetKeys.length; pk++) {
      var key = presetKeys[pk];
      var optP = el('option', '', DEVICE_PRESETS[key].label);
      optP.value = key;
      if (state.newProfilePreset === key) {
        optP.selected = true;
      }
      selPreset.appendChild(optP);
    }
    selPreset.onchange = function () {
      state.newProfilePreset = selPreset.value;
    };
    fPreset.appendChild(selPreset);
    cCol2.appendChild(fPreset);
    cRow.appendChild(cCol2);

    createForm.appendChild(cRow);

    var chkAssignRow = el('label', 'hf-check-row');
    var chkAssignAll = el('input');
    chkAssignAll.type = 'checkbox';
    chkAssignAll.checked = true;
    chkAssignRow.appendChild(chkAssignAll);
    chkAssignRow.appendChild(
      el('span', 'hf-check-label', 'Assign all existing gallery photos to this profile')
    );
    createForm.appendChild(chkAssignRow);

    var createBtn = el('button', 'hf-btn hf-btn-accent', 'Create Display Profile');
    createBtn.type = 'submit';
    createBtn.style.marginTop = '12px';
    createForm.appendChild(createBtn);

    createForm.onsubmit = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      state.adminError = '';
      state.adminNotice = '';
      var preset = DEVICE_PRESETS[selPreset.value] || DEVICE_PRESETS.custom;
      var trimmedName = (inNewName.value || '').replace(/^\s+|\s+$/g, '');
      if (trimmedName.length < 2) {
        state.adminError = 'Please enter a profile name (at least 2 characters).';
        render();
        return false;
      }
      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';

      apiRequest(
        'POST',
        '/api/admin/profiles',
        {
          name: trimmedName,
          deviceType: preset.deviceType,
          assignAllExistingSlides: chkAssignAll.checked,
          settings: {
            intervalSeconds: preset.intervalSeconds,
            autoRotate: preset.autoRotate,
            transition: preset.transition,
            fitMode: preset.fitMode,
            showCaption: preset.showCaption,
            showClock: preset.showClock,
            r2DeliveryMode: preset.r2DeliveryMode
          }
        },
        function (err) {
          if (err) {
            state.adminError = err;
            render();
            return;
          }
          state.adminNotice =
            'Display profile "' +
            trimmedName +
            '" created. You can now pick it when pairing a TV or signing into Frame Display.';
          loadAdminData();
        }
      );
      return false;
    };

    createCard.appendChild(createForm);
    main.appendChild(createCard);

    // Existing Profiles List
    for (var i = 0; i < state.profiles.length; i++) {
      main.appendChild(buildProfileEditorCard(state.profiles[i]));
    }
  }

  function buildProfileEditorCard(profile) {
    var ps = profile.settings || {};
    var card = el('section', 'hf-profile-editor-card');

    // Card header with profile name, photo count, and Preview CTA
    var head = el('div', 'hf-profile-editor-head hf-clearfix');
    var hLeft = el('div', 'hf-profile-editor-left');
    hLeft.appendChild(el('h2', 'hf-subheading', profile.name || 'Display Profile'));
    var count = typeof profile.slideCount === 'number' ? profile.slideCount : 0;
    hLeft.appendChild(
      el(
        'p',
        'hf-meta-line',
        (profile.deviceType || 'Custom Screen') +
          '  \u00B7  ' +
          count +
          (count === 1 ? ' active photo' : ' active photos') +
          '  \u00B7  Every ' +
          (ps.intervalSeconds || 8) +
          's'
      )
    );

    var hRight = el('div', 'hf-profile-editor-right');
    var previewBtn = el('button', 'hf-btn hf-btn-sm', 'Preview Slideshow');
    previewBtn.type = 'button';
    previewBtn.onclick = function () {
      openVisitorProfile(profile.id);
    };
    hRight.appendChild(previewBtn);

    head.appendChild(hLeft);
    head.appendChild(hRight);
    card.appendChild(head);

    var form = el('form');

    // Name + Device Type row
    var nameRow = el('div', 'hf-two-col hf-clearfix');
    var nCol1 = el('div', 'hf-col-half');
    nCol1.style.marginBottom = '0';
    var fName = el('div', 'hf-field');
    fName.appendChild(el('label', 'hf-label', 'Profile Name'));
    var inName = el('input', 'hf-input');
    inName.type = 'text';
    inName.maxLength = 50;
    inName.value = profile.name || '';
    fName.appendChild(inName);
    nCol1.appendChild(fName);
    nameRow.appendChild(nCol1);

    var nCol2 = el('div', 'hf-col-half');
    nCol2.style.marginBottom = '0';
    var fType = el('div', 'hf-field');
    fType.appendChild(el('label', 'hf-label', 'Device Type'));
    var inType = el('input', 'hf-input');
    inType.type = 'text';
    inType.maxLength = 32;
    inType.value = profile.deviceType || '';
    inType.placeholder = 'e.g., iPad, TV, Android Tablet';
    fType.appendChild(inType);
    nCol2.appendChild(fType);
    nameRow.appendChild(nCol2);
    form.appendChild(nameRow);

    // Display Interval Presets + Custom
    var fInterval = el('div', 'hf-field');
    fInterval.appendChild(el('label', 'hf-label', 'Display Interval (Seconds per Photo)'));
    var inInterval = el('input', 'hf-input hf-mono');
    inInterval.type = 'number';
    inInterval.min = 2;
    inInterval.max = 3600;
    inInterval.value = String(ps.intervalSeconds || 8);
    inInterval.style.maxWidth = '180px';

    var presetGroup = el('div', 'hf-preset-group');
    var presetBtns = [];
    for (var i = 0; i < INTERVAL_PRESETS.length; i++) {
      (function (sec) {
        var pb = el(
          'button',
          'hf-preset-btn' +
            (sec === ps.intervalSeconds ? ' hf-preset-btn-active' : ''),
          sec + 's'
        );
        pb.type = 'button';
        pb.onclick = function () {
          inInterval.value = String(sec);
          for (var j = 0; j < presetBtns.length; j++) {
            removeClass(presetBtns[j], 'hf-preset-btn-active');
          }
          addClass(pb, 'hf-preset-btn-active');
        };
        presetBtns.push(pb);
        presetGroup.appendChild(pb);
      })(INTERVAL_PRESETS[i]);
    }
    fInterval.appendChild(presetGroup);
    fInterval.appendChild(inInterval);
    form.appendChild(fInterval);

    // Settings 2-column row
    var sRow = el('div', 'hf-two-col hf-clearfix');

    var sCol1 = el('div', 'hf-col-half');
    sCol1.style.marginBottom = '0';

    var fTrans = el('div', 'hf-field');
    fTrans.appendChild(el('label', 'hf-label', 'Slide Transition'));
    var selTrans = el('select', 'hf-select');
    var oFade = el('option', '', 'Smooth Fade');
    oFade.value = 'fade';
    if (ps.transition !== 'none') oFade.selected = true;
    var oNone = el('option', '', 'Instant Cut (Fastest for Old Tablets)');
    oNone.value = 'none';
    if (ps.transition === 'none') oNone.selected = true;
    selTrans.appendChild(oFade);
    selTrans.appendChild(oNone);
    fTrans.appendChild(selTrans);
    sCol1.appendChild(fTrans);

    var fFit = el('div', 'hf-field');
    fFit.appendChild(el('label', 'hf-label', 'Photo Scaling Mode'));
    var selFit = el('select', 'hf-select');
    var oContain = el('option', '', 'Fit Whole Photo (No Cropping)');
    oContain.value = 'contain';
    if (ps.fitMode !== 'cover') oContain.selected = true;
    var oCover = el('option', '', 'Fill Entire Screen (Edge-to-Edge)');
    oCover.value = 'cover';
    if (ps.fitMode === 'cover') oCover.selected = true;
    selFit.appendChild(oContain);
    selFit.appendChild(oCover);
    fFit.appendChild(selFit);
    sCol1.appendChild(fFit);

    sRow.appendChild(sCol1);

    var sCol2 = el('div', 'hf-col-half');
    sCol2.style.marginBottom = '0';

    var fR2 = el('div', 'hf-field');
    fR2.appendChild(el('label', 'hf-label', 'Photo Loading Mode'));
    var selR2 = el('select', 'hf-select');
    var oDirect = el(
      'option',
      '',
      'Fast Direct Loading (Recommended)'
    );
    oDirect.value = 'direct';
    if (ps.r2DeliveryMode !== 'proxy') oDirect.selected = true;
    var oProxy = el(
      'option',
      '',
      'Compatibility Mode (Very Old Android 4.4 Tablets)'
    );
    oProxy.value = 'proxy';
    if (ps.r2DeliveryMode === 'proxy') oProxy.selected = true;
    selR2.appendChild(oDirect);
    selR2.appendChild(oProxy);
    fR2.appendChild(selR2);
    sCol2.appendChild(fR2);

    var chkAutoRow = el('label', 'hf-check-row');
    var chkAuto = el('input');
    chkAuto.type = 'checkbox';
    chkAuto.checked = ps.autoRotate !== false;
    chkAutoRow.appendChild(chkAuto);
    chkAutoRow.appendChild(el('span', 'hf-check-label', 'Enable automatic slide rotation'));
    sCol2.appendChild(chkAutoRow);

    var chkCapRow = el('label', 'hf-check-row');
    var chkCap = el('input');
    chkCap.type = 'checkbox';
    chkCap.checked = ps.showCaption !== false;
    chkCapRow.appendChild(chkCap);
    chkCapRow.appendChild(el('span', 'hf-check-label', 'Show photo title and caption'));
    sCol2.appendChild(chkCapRow);

    var chkClkRow = el('label', 'hf-check-row');
    var chkClk = el('input');
    chkClk.type = 'checkbox';
    chkClk.checked = ps.showClock !== false;
    chkClkRow.appendChild(chkClk);
    chkClkRow.appendChild(el('span', 'hf-check-label', 'Show wall clock in corner'));
    sCol2.appendChild(chkClkRow);

    sRow.appendChild(sCol2);
    form.appendChild(sRow);

    form.appendChild(el('hr', 'hf-divider'));

    // Footer Save + Delete actions
    var footer = el('div', 'hf-profile-footer-actions hf-clearfix');
    var fLeft = el('div', 'hf-profile-footer-left');
    var saveBtn = el('button', 'hf-btn hf-btn-primary', 'Save Profile');
    saveBtn.type = 'submit';
    fLeft.appendChild(saveBtn);
    footer.appendChild(fLeft);

    var fRight = el('div', 'hf-profile-footer-right');
    if (state.profiles.length > 1) {
      if (state.confirmDeleteProfileId === profile.id) {
        var btnConfirmDel = el(
          'button',
          'hf-btn hf-btn-danger-solid hf-inline-btn',
          'Confirm Delete'
        );
        btnConfirmDel.type = 'button';
        btnConfirmDel.onclick = function () {
          apiRequest(
            'DELETE',
            '/api/admin/profiles/' + encodeURIComponent(profile.id),
            null,
            function (err) {
              state.confirmDeleteProfileId = null;
              if (err) {
                state.adminError = err;
                render();
                return;
              }
              state.adminNotice =
                'Display profile removed. Your gallery photos remain untouched.';
              loadAdminData();
            }
          );
        };
        fRight.appendChild(btnConfirmDel);

        var btnKeep = el('button', 'hf-btn', 'Keep');
        btnKeep.type = 'button';
        btnKeep.onclick = function () {
          state.confirmDeleteProfileId = null;
          render();
        };
        fRight.appendChild(btnKeep);
      } else {
        var btnDelProf = el('button', 'hf-btn hf-btn-danger', 'Delete Profile');
        btnDelProf.type = 'button';
        btnDelProf.onclick = function () {
          state.confirmDeleteProfileId = profile.id;
          render();
        };
        fRight.appendChild(btnDelProf);
      }
    }
    footer.appendChild(fRight);
    form.appendChild(footer);

    form.onsubmit = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      state.adminError = '';
      state.adminNotice = '';
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      apiRequest(
        'PUT',
        '/api/admin/profiles/' + encodeURIComponent(profile.id),
        {
          name: inName.value,
          deviceType: inType.value,
          settings: {
            intervalSeconds: parseInt(inInterval.value, 10),
            autoRotate: chkAuto.checked,
            transition: selTrans.value,
            fitMode: selFit.value,
            showCaption: chkCap.checked,
            showClock: chkClk.checked,
            r2DeliveryMode: selR2.value
          }
        },
        function (err) {
          if (err) {
            state.adminError = err;
            render();
            return;
          }
          state.adminNotice = 'Saved profile "' + inName.value + '".';
          loadAdminData();
        }
      );
      return false;
    };

    card.appendChild(form);
    return card;
  }

  function renderAdminSettingsTab(main) {
    var head = el('div', 'hf-page-head');
    head.appendChild(el('h1', 'hf-heading', 'Frame Settings'));
    head.appendChild(
      el(
        'p',
        'hf-meta-line',
        'Name your frame and choose default upload quality. Changes sync to connected screens within 2 minutes.'
      )
    );
    main.appendChild(head);

    var card = el('section', 'hf-card');
    var form = el('form');

    var row = el('div', 'hf-two-col hf-clearfix');

    var col1 = el('div', 'hf-col-half');
    col1.style.marginBottom = '0';
    var fTitle = el('div', 'hf-field');
    fTitle.appendChild(el('label', 'hf-label', 'Frame Name'));
    var inTitle = el('input', 'hf-input');
    inTitle.type = 'text';
    inTitle.maxLength = 60;
    inTitle.value = state.settings.frameTitle || 'Family Photo Frame';
    fTitle.appendChild(inTitle);
    fTitle.appendChild(
      el('span', 'hf-help', 'Shown at the top of your slideshow and dashboard.')
    );
    col1.appendChild(fTitle);
    row.appendChild(col1);

    var col2 = el('div', 'hf-col-half');
    col2.style.marginBottom = '0';
    var fBw = el('div', 'hf-field');
    fBw.appendChild(el('label', 'hf-label', 'Photo Upload Quality'));
    var selBw = el('select', 'hf-select');
    var bwChoices = [
      { v: 'low', label: 'Data Saver (800px \u00B7 fastest on slow Wi-Fi)' },
      { v: 'balanced', label: 'Balanced (1280px \u00B7 recommended for tablets & TVs)' },
      { v: 'high', label: 'High Detail (1600px \u00B7 sharpest photos)' }
    ];
    for (var b = 0; b < bwChoices.length; b++) {
      var optBw = el('option', '', bwChoices[b].label);
      optBw.value = bwChoices[b].v;
      if (state.settings.bandwidthMode === bwChoices[b].v) {
        optBw.selected = true;
      }
      selBw.appendChild(optBw);
    }
    fBw.appendChild(selBw);
    fBw.appendChild(
      el('span', 'hf-help', 'Applies automatically when uploading new photos.')
    );
    col2.appendChild(fBw);
    row.appendChild(col2);

    form.appendChild(row);

    var profileHint = el(
      'div',
      'hf-alert hf-alert-info',
      'Per-screen settings (slide speed, auto-play, photo fit, clock, and old-tablet compatibility) are customized separately for each TV or tablet under Display Profiles.'
    );
    form.appendChild(profileHint);

    var btnRow = el('div');
    var saveBtn = el('button', 'hf-btn hf-btn-primary hf-inline-btn', 'Save Settings');
    saveBtn.type = 'submit';
    btnRow.appendChild(saveBtn);

    var goProfilesBtn = el('button', 'hf-btn', 'Manage Display Profiles');
    goProfilesBtn.type = 'button';
    goProfilesBtn.onclick = function () {
      state.adminNotice = '';
      state.adminError = '';
      state.adminTab = 'profiles';
      render();
    };
    btnRow.appendChild(goProfilesBtn);
    form.appendChild(btnRow);

    form.onsubmit = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      state.adminError = '';
      state.adminNotice = '';
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      apiRequest(
        'PUT',
        '/api/admin/settings',
        {
          frameTitle: inTitle.value,
          bandwidthMode: selBw.value
        },
        function (err, data) {
          if (err) {
            state.adminError = err;
            render();
            return;
          }
          if (data && data.settings) {
            state.settings = data.settings;
            state.frameTitle = data.settings.frameTitle;
          }
          state.adminNotice = 'System settings saved.';
          render();
        }
      );
      return false;
    };

    card.appendChild(form);
    main.appendChild(card);

    // Cloudflare R2 Storage Status Panel (Owner Only)
    if (state.isOwner) {
      var storageCard = el('section', 'hf-card');
      storageCard.style.marginTop = '24px';
      storageCard.appendChild(el('h2', 'hf-subheading', 'Cloudflare R2 Storage'));

      var storageLine = state.storage && state.storage.configured
        ? 'Connected  \u00B7  Bucket: ' + state.storage.bucketName + '  \u00B7  Photos, profiles, and accounts persist in R2'
        : 'Local Storage Mode  \u00B7  Add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME in Settings -> Secrets to enable persistent R2 storage';
      storageCard.appendChild(el('p', 'hf-meta-line', storageLine));

      if (state.r2TestMessage) {
        var testAlert = el(
          'div',
          'hf-alert ' + (state.r2TestOk ? 'hf-alert-success' : 'hf-alert-error'),
          state.r2TestMessage
        );
        testAlert.style.marginTop = '16px';
        storageCard.appendChild(testAlert);
      }

      var testWrap = el('div');
      testWrap.style.marginTop = '16px';
      var testBtn = el(
        'button',
        'hf-btn',
        state.r2Testing ? 'Testing R2 Connection...' : 'Test R2 Connection'
      );
      testBtn.type = 'button';
      testBtn.disabled = state.r2Testing;
      testBtn.onclick = function () {
        state.r2Testing = true;
        state.r2TestMessage = '';
        render();
        apiRequest('POST', '/api/admin/r2/test', {}, function (err, data) {
          state.r2Testing = false;
          if (data && data.storage) {
            state.storage = data.storage;
          }
          if (err || !data || !data.ok) {
            state.r2TestOk = false;
            state.r2TestMessage = (data && data.message) || err || 'R2 connection test failed.';
          } else {
            state.r2TestOk = true;
            state.r2TestMessage = data.message || 'Cloudflare R2 connection verified.';
          }
          render();
        });
      };
      testWrap.appendChild(testBtn);
      storageCard.appendChild(testWrap);

      main.appendChild(storageCard);
    }
  }

  function renderAdminAccessTab(main) {
    var head = el('div', 'hf-page-head');
    head.appendChild(el('h1', 'hf-heading', 'Pair & Access'));
    head.appendChild(
      el(
        'p',
        'hf-meta-line',
        'Pair a TV or tablet with a 6-character code, or manage your Frame Display and Admin passwords.'
      )
    );
    main.appendChild(head);

    // Top Card: Pair a TV or Tablet (QR / 6-Character PIN Approval)
    var pairCard = el('section', 'hf-card hf-pair-approve-card');
    pairCard.appendChild(el('h2', 'hf-subheading', 'Pair a TV or Tablet'));
    pairCard.appendChild(
      el(
        'p',
        'hf-meta-line',
        'Open the home page on your TV or old tablet under Frame Display \u2192 Pair TV / QR, then scan the QR code or enter the 6-character code below.'
      )
    );

    if (state.pairApproveError) {
      var pe = el('div', 'hf-alert hf-alert-error', state.pairApproveError);
      pe.style.marginTop = '14px';
      pairCard.appendChild(pe);
    }
    if (state.pairApproveNotice) {
      var pn = el('div', 'hf-alert hf-alert-success', state.pairApproveNotice);
      pn.style.marginTop = '14px';
      pairCard.appendChild(pn);
    }

    var pairForm = el('form', 'hf-pair-approve-form');
    var pairCols = el('div', 'hf-two-col hf-clearfix');

    var codeCol = el('div', 'hf-col-half');
    var codeField = el('div', 'hf-field');
    codeField.appendChild(el('label', 'hf-label', '6-Character Pairing Code'));
    var codeInput = el('input', 'hf-input hf-pair-code-input');
    codeInput.type = 'text';
    codeInput.maxLength = 7;
    codeInput.value = state.pairApproveInput || state.pendingPairCodeFromUrl || '';
    codeInput.placeholder = 'e.g. K7M-9P2';
    codeInput.setAttribute('autocapitalize', 'characters');
    codeInput.setAttribute('autocorrect', 'off');
    codeInput.setAttribute('autocomplete', 'off');
    codeInput.oninput = function () {
      state.pairApproveInput = codeInput.value;
    };
    codeField.appendChild(codeInput);
    codeCol.appendChild(codeField);
    pairCols.appendChild(codeCol);

    var profileCol = el('div', 'hf-col-half');
    var profileSelect = null;
    if (state.profiles && state.profiles.length > 1) {
      var profField = el('div', 'hf-field');
      profField.appendChild(el('label', 'hf-label', 'Display Profile to Open on Screen'));
      profileSelect = el('select', 'hf-select');
      for (var pIdx = 0; pIdx < state.profiles.length; pIdx++) {
        var prof = state.profiles[pIdx];
        var opt = document.createElement('option');
        opt.value = prof.id;
        opt.appendChild(
          document.createTextNode(
            prof.name + (prof.deviceType ? ' (' + prof.deviceType + ')' : '')
          )
        );
        profileSelect.appendChild(opt);
      }
      var chooseOpt = document.createElement('option');
      chooseOpt.value = 'choose';
      chooseOpt.appendChild(document.createTextNode('Let the screen choose on startup'));
      profileSelect.appendChild(chooseOpt);

      if (state.pairApproveProfileId) {
        profileSelect.value = state.pairApproveProfileId;
      } else {
        profileSelect.value = state.profiles[0].id;
      }
      profileSelect.onchange = function () {
        state.pairApproveProfileId = profileSelect.value;
      };
      profField.appendChild(profileSelect);
      profileCol.appendChild(profField);
    } else if (state.profiles && state.profiles.length === 1) {
      var singleNote = el(
        'div',
        'hf-pair-single-profile',
        'Your TV or tablet will open directly into "' +
          state.profiles[0].name +
          '" as soon as you approve.'
      );
      profileCol.appendChild(singleNote);
    }
    pairCols.appendChild(profileCol);
    pairForm.appendChild(pairCols);

    var pairActions = el('div', 'hf-pair-approve-actions hf-clearfix');
    var approveBtn = el(
      'button',
      'hf-btn hf-btn-accent hf-inline-btn',
      state.pairApproving ? 'Approving...' : 'Approve TV / Tablet'
    );
    approveBtn.type = 'submit';
    approveBtn.disabled = Boolean(state.pairApproving);
    pairActions.appendChild(approveBtn);

    if (state.confirmRevokeScreens) {
      var revConfirm = el(
        'button',
        'hf-btn hf-btn-danger-solid hf-btn-sm hf-inline-btn',
        state.revokingScreens ? 'Signing out...' : 'Confirm Sign Out All Screens'
      );
      revConfirm.type = 'button';
      revConfirm.disabled = Boolean(state.revokingScreens);
      revConfirm.onclick = function () {
        state.revokingScreens = true;
        state.pairApproveError = '';
        state.pairApproveNotice = '';
        render();
        apiRequest('POST', '/api/admin/pair/revoke-all', {}, function (err) {
          state.revokingScreens = false;
          state.confirmRevokeScreens = false;
          if (err) {
            state.pairApproveError = err;
          } else {
            state.pairApproveNotice =
              'All paired TVs and active Frame Display screens have been signed out.';
          }
          render();
        });
      };
      pairActions.appendChild(revConfirm);

      var revCancel = el('button', 'hf-btn hf-btn-sm', 'Cancel');
      revCancel.type = 'button';
      revCancel.onclick = function () {
        state.confirmRevokeScreens = false;
        render();
      };
      pairActions.appendChild(revCancel);
    } else {
      var revBtn = el('button', 'hf-btn hf-btn-sm', 'Sign Out All Paired Screens');
      revBtn.type = 'button';
      revBtn.onclick = function () {
        state.confirmRevokeScreens = true;
        state.pairApproveError = '';
        state.pairApproveNotice = '';
        render();
      };
      pairActions.appendChild(revBtn);
    }

    pairForm.appendChild(pairActions);

    pairForm.onsubmit = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      state.pairApproveError = '';
      state.pairApproveNotice = '';
      state.pairApproving = true;
      var payload = {
        code: codeInput.value
      };
      if (profileSelect) {
        payload.profileId = profileSelect.value;
      }
      render();

      apiRequest('POST', '/api/admin/pair/approve', payload, function (err, data) {
        state.pairApproving = false;
        if (err) {
          state.pairApproveError = err;
          render();
          return;
        }
        state.pendingPairCodeFromUrl = '';
        state.pairApproveInput = '';
        var profLabel =
          data && data.profileName
            ? ' and will open "' + data.profileName + '"'
            : '';
        state.pairApproveNotice =
          'Approved screen ' +
          ((data && data.displayCode) || '') +
          '! Your TV or tablet will sign in automatically within 3 seconds' +
          profLabel +
          '.';
        render();
      });
      return false;
    };

    pairCard.appendChild(pairForm);
    main.appendChild(pairCard);

    var row = el('div', 'hf-two-col hf-clearfix');

    // Left: Frame Display Account (Optional manual username/password per Admin)
    var colVisitor = el('div', 'hf-col-half');
    var vCard = el('section', 'hf-card');
    var hasVisitor = Boolean(state.accessInfo.hasVisitorLogin && state.accessInfo.visitorUsername);
    vCard.appendChild(
      el(
        'h2',
        'hf-subheading',
        hasVisitor ? 'Frame Display Login' : 'Create Frame Display Login (Optional)'
      )
    );
    vCard.appendChild(
      el(
        'p',
        'hf-meta-line',
        hasVisitor
          ? 'Optional username & password for signing into Frame Display manually. Updating this signs out active screens.'
          : 'You can pair TVs with QR / PIN above right away, or create a manual username and password for Frame Display here.'
      )
    );

    if (state.accessInfo.envVisitorLocked) {
      var vLock = el(
        'div',
        'hf-alert hf-alert-info',
        'Frame Display login is controlled by server environment secrets (VISITOR_PASSWORD).'
      );
      vLock.style.marginTop = '16px';
      vCard.appendChild(vLock);
    } else {
      var vForm = el('form');
      vForm.style.marginTop = '18px';

      var vf1 = el('div', 'hf-field');
      vf1.appendChild(el('label', 'hf-label', 'Frame Display Username'));
      var vInUser = el('input', 'hf-input');
      vInUser.type = 'text';
      vInUser.maxLength = 32;
      vInUser.value = hasVisitor ? state.accessInfo.visitorUsername : '';
      vInUser.placeholder = 'Choose a unique display username';
      vInUser.setAttribute('autocapitalize', 'off');
      vInUser.setAttribute('autocorrect', 'off');
      vf1.appendChild(vInUser);
      vForm.appendChild(vf1);

      var vf2 = el('div', 'hf-field');
      vf2.appendChild(
        el('label', 'hf-label', hasVisitor ? 'New Frame Display Password' : 'Frame Display Password')
      );
      var vInPass = el('input', 'hf-input');
      vInPass.type = 'password';
      vInPass.placeholder = hasVisitor
        ? 'Enter new display password'
        : 'At least 4 characters';
      vf2.appendChild(vInPass);
      vForm.appendChild(vf2);

      var vBtn = el(
        'button',
        'hf-btn hf-btn-accent',
        hasVisitor ? 'Update Frame Display Login' : 'Create Frame Display Login'
      );
      vBtn.type = 'submit';
      vForm.appendChild(vBtn);

      vForm.onsubmit = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        state.adminError = '';
        state.adminNotice = '';
        vBtn.disabled = true;
        vBtn.textContent = 'Saving...';
        apiRequest(
          'PUT',
          '/api/admin/credentials',
          {
            target: 'visitor',
            username: vInUser.value,
            password: vInPass.value
          },
          function (err, data) {
            if (err) {
              state.adminError = err;
              render();
              return;
            }
            var savedUser = (data && data.username) || vInUser.value;
            state.accessInfo.visitorUsername = savedUser;
            state.accessInfo.hasVisitorLogin = true;
            state.hasVisitorLogin = true;
            state.adminNotice = hasVisitor
              ? 'Frame Display login updated.'
              : 'Frame Display login "' + savedUser + '" created. You can now sign in manually on any device from the home page.';
            render();
          }
        );
        return false;
      };
      vCard.appendChild(vForm);
    }
    colVisitor.appendChild(vCard);
    row.appendChild(colVisitor);

    // Right: Admin Account
    var colAdmin = el('div', 'hf-col-half');
    var aCard = el('section', 'hf-card');
    aCard.appendChild(el('h2', 'hf-subheading', 'Your Admin Account'));
    aCard.appendChild(
      el(
        'p',
        'hf-meta-line',
        'Controls photo uploads, Display Profiles, and settings for your private workspace.'
      )
    );

    if (state.accessInfo.envAdminLocked) {
      var aLock = el(
        'div',
        'hf-alert hf-alert-info',
        'Admin login is controlled by server environment secrets (ADMIN_PASSWORD).'
      );
      aLock.style.marginTop = '16px';
      aCard.appendChild(aLock);
    } else {
      var aForm = el('form');
      aForm.style.marginTop = '18px';

      var af0 = el('div', 'hf-field');
      af0.appendChild(el('label', 'hf-label', 'Current Admin Password'));
      var aInCur = el('input', 'hf-input');
      aInCur.type = 'password';
      aInCur.placeholder = 'Verify current password';
      af0.appendChild(aInCur);
      aForm.appendChild(af0);

      var af1 = el('div', 'hf-field');
      af1.appendChild(el('label', 'hf-label', 'Admin Username'));
      var aInUser = el('input', 'hf-input');
      aInUser.type = 'text';
      aInUser.maxLength = 32;
      aInUser.value = state.accessInfo.adminUsername || state.username || '';
      aInUser.setAttribute('autocapitalize', 'off');
      aInUser.setAttribute('autocorrect', 'off');
      af1.appendChild(aInUser);
      aForm.appendChild(af1);

      var af2 = el('div', 'hf-field');
      af2.appendChild(el('label', 'hf-label', 'New Admin Password'));
      var aInPass = el('input', 'hf-input');
      aInPass.type = 'password';
      aInPass.placeholder = 'Enter new admin password';
      af2.appendChild(aInPass);
      aForm.appendChild(af2);

      var aBtn = el('button', 'hf-btn hf-btn-primary', 'Update Admin Credentials');
      aBtn.type = 'submit';
      aForm.appendChild(aBtn);

      aForm.onsubmit = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        state.adminError = '';
        state.adminNotice = '';
        aBtn.disabled = true;
        aBtn.textContent = 'Saving...';
        apiRequest(
          'PUT',
          '/api/admin/credentials',
          {
            target: 'admin',
            currentPassword: aInCur.value,
            username: aInUser.value,
            password: aInPass.value
          },
          function (err, data) {
            if (err) {
              state.adminError = err;
              render();
              return;
            }
            var savedAdmin = (data && data.username) || aInUser.value;
            state.accessInfo.adminUsername = savedAdmin;
            state.username = savedAdmin;
            if (data && data.token) {
              state.token = data.token;
            }
            state.adminNotice = 'Admin credentials updated.';
            render();
          }
        );
        return false;
      };
      aCard.appendChild(aForm);
    }
    colAdmin.appendChild(aCard);
    row.appendChild(colAdmin);

    main.appendChild(row);
  }

  function formatShortDate(isoStr) {
    if (!isoStr || typeof isoStr !== 'string') return '';
    return isoStr.slice(0, 10);
  }

  function renderOwnerAccountsTab(main) {
    var head = el('div', 'hf-page-head');
    head.appendChild(el('h1', 'hf-heading', 'Registered Accounts'));
    head.appendChild(
      el(
        'p',
        'hf-meta-line',
        state.ownerAccounts.length +
          ' / ' +
          state.ownerMaxAccounts +
          ' workspaces  \u00B7  ' +
          (state.ownerInviteRequired ? 'Invite Code Enabled' : 'Open Signup Active') +
          '  \u00B7  Private photos are never exposed here'
      )
    );
    main.appendChild(head);

    if (state.ownerAccountsLoading) {
      main.appendChild(el('div', 'hf-card', 'Loading registered accounts...'));
      return;
    }

    if (!state.ownerAccounts || state.ownerAccounts.length === 0) {
      main.appendChild(el('div', 'hf-card', 'No workspaces found.'));
      return;
    }

    var listWrap = el('div', 'hf-accounts-list');
    for (var i = 0; i < state.ownerAccounts.length; i++) {
      (function (acc) {
        var rowCard = el('section', 'hf-card hf-account-row hf-clearfix');

        var left = el('div', 'hf-account-info');
        var titleLine = acc.frameTitle + (acc.isOwner ? '  \u00B7  Owner' : '');
        left.appendChild(el('h2', 'hf-account-title', titleLine));

        var quotaStr = acc.photoLimit !== null
          ? acc.slideCount + ' / ' + acc.photoLimit + ' photos'
          : acc.slideCount + ' photos (Unlimited)';
        var frontStr = acc.hasVisitorLogin && acc.visitorUsername
          ? acc.visitorUsername
          : 'Not created yet';
        var metaStr =
          'Admin: ' +
          acc.adminUsername +
          '  \u00B7  Frame Display: ' +
          frontStr +
          '  \u00B7  ' +
          quotaStr +
          (acc.createdAt ? '  \u00B7  Created ' + formatShortDate(acc.createdAt) : '');
        left.appendChild(el('p', 'hf-meta-line', metaStr));
        rowCard.appendChild(left);

        if (!acc.isOwner) {
          var right = el('div', 'hf-account-actions');
          if (state.confirmDeleteAccountId === acc.id) {
            var confirmBtn = el('button', 'hf-btn hf-btn-danger-solid hf-btn-sm hf-inline-btn', 'Confirm Delete');
            confirmBtn.type = 'button';
            confirmBtn.onclick = function () {
              confirmBtn.disabled = true;
              confirmBtn.textContent = 'Deleting...';
              apiRequest(
                'DELETE',
                '/api/owner/accounts/' + encodeURIComponent(acc.id),
                null,
                function (err) {
                  state.confirmDeleteAccountId = null;
                  if (err) {
                    state.adminError = err;
                    render();
                    return;
                  }
                  state.adminNotice = 'Deleted workspace "' + acc.adminUsername + '" and cleaned up its photos.';
                  loadOwnerAccounts();
                }
              );
            };
            right.appendChild(confirmBtn);

            var cancelBtn = el('button', 'hf-btn hf-btn-sm', 'Cancel');
            cancelBtn.type = 'button';
            cancelBtn.onclick = function () {
              state.confirmDeleteAccountId = null;
              render();
            };
            right.appendChild(cancelBtn);
          } else {
            var delBtn = el('button', 'hf-btn hf-btn-danger hf-btn-sm', 'Delete Account');
            delBtn.type = 'button';
            delBtn.onclick = function () {
              state.confirmDeleteAccountId = acc.id;
              render();
            };
            right.appendChild(delBtn);
          }
          rowCard.appendChild(right);
        }

        listWrap.appendChild(rowCard);
      })(state.ownerAccounts[i]);
    }
    main.appendChild(listWrap);
  }

  // =========================================================================
  // Master Render & Global Listeners
  // =========================================================================

  function render() {
    var root = document.getElementById('hf-app');
    if (!root) return;
    clearNode(root);

    var isAuthed = Boolean(state.authenticated || state.token);

    if (state.loading && state.view === 'portal' && !isAuthed) {
      var boot = el('div', 'hf-boot');
      boot.appendChild(el('div', 'hf-boot-brand', 'HearthFrame'));
      boot.appendChild(el('div', 'hf-boot-note', 'Connecting to household server...'));
      root.appendChild(boot);
      return;
    }

    if (state.view === 'chooser' && isAuthed) {
      renderProfileChooserView(root);
    } else if (state.view === 'visitor' && isAuthed) {
      renderVisitorView(root);
    } else if (state.view === 'admin' && isAuthed && state.role === 'admin') {
      renderAdminView(root);
    } else {
      renderPortalView(root);
    }
  }

  function initGlobalEvents() {
    document.addEventListener('fullscreenchange', handleNativeFullscreenChange, false);
    document.addEventListener('webkitfullscreenchange', handleNativeFullscreenChange, false);
    document.addEventListener('mozfullscreenchange', handleNativeFullscreenChange, false);
    document.addEventListener('MSFullscreenChange', handleNativeFullscreenChange, false);

    // Re-acquire Wake Lock automatically when tablet wakes or returns to this tab
    document.addEventListener(
      'visibilitychange',
      function () {
        if (!document.hidden && state.view === 'visitor' && state.keepAwakeEnabled) {
          enableKeepScreenAwake(false);
        }
      },
      false
    );

    // On old Android Chrome, engage Layer 2 silent video on the first tap inside Visitor view
    function handleVisitorGestureForWakeLock() {
      if (state.view === 'visitor' && state.keepAwakeEnabled && !state.keepAwakeActive) {
        enableKeepScreenAwake(true);
      }
    }
    document.addEventListener('click', handleVisitorGestureForWakeLock, false);
    document.addEventListener('touchstart', handleVisitorGestureForWakeLock, false);

    document.addEventListener(
      'keydown',
      function (ev) {
        if (state.view !== 'visitor') return;
        var key = ev.keyCode || ev.which;
        if (key === 27 && state.isFullscreen) {
          // Escape
          exitFullscreenMode(false);
        } else if (key === 37) {
          // Left arrow
          goToSlide(state.currentIndex - 1);
        } else if (key === 39) {
          // Right arrow
          goToSlide(state.currentIndex + 1);
        } else if (key === 32) {
          // Space
          if (ev.preventDefault) ev.preventDefault();
          togglePlayback();
        } else if (key === 70) {
          // F key
          if (state.isFullscreen) exitFullscreenMode(false);
          else enterFullscreenMode();
        }
      },
      false
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      function () {
        extractPairCodeFromUrl();
        initGlobalEvents();
        loadAuthStatus();
      },
      false
    );
  } else {
    extractPairCodeFromUrl();
    initGlobalEvents();
    loadAuthStatus();
  }
})();
