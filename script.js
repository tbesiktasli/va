import WaveSurfer from 'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js';
window.WaveSurfer ??= WaveSurfer;   // make it available as a global, if not already
import { Grid, getObjectTooltipLabel } from './grid.js';

// BASIC CONSTANTS AND VARIABLES

// ===== DATA SOURCE MODE =====
// 'dummy'  → only current dummy data
// 'mixed'  → dummy data + all groups from Strapi
// 'strapi' → only all groups from Strapi 
const DATA_MODE = 'strapi'; // change to 'mixed' or 'strapi' as needed
const SHOULD_USE_STRAPI = (DATA_MODE === 'strapi' || DATA_MODE === 'mixed');

// ===== RUNTIME FEATURE FLAGS / UA HINTS =====
const UA = navigator.userAgent || '';
// crude but effective Safari detection (excludes Chrome/Edge on macOS + iOS Chrome)
const IS_SAFARI = /safari/i.test(UA) && !/chrome|chromium|android/i.test(UA);

if (IS_SAFARI) {
  document.documentElement.classList.add('is-safari');
} else {
  document.documentElement.classList.add('is-not-safari');
}

// Enable “vertical wheel → horizontal pan” inside the horizontal group gallery
const ENABLE_GALLERY_WHEEL_HORIZONTAL_SCROLL = true;
// Direction: -1 = scroll down moves right, +1 = scroll down moves left
const GALLERY_WHEEL_HORIZONTAL_DIRECTION = +1;

// ===== VIEW STATE / HISTORY =====
const VIEW = {
  PREPAGE: 'prepage',
  HOME: 'home',
  GALLERY: 'gallery',
  DETAIL: 'detail',
  RESEARCH: 'research',
  SUBPAGE: 'subpage',
};

// ================= Loading Screen (progress -> fade to prepage) =================
// ================= Loading Screen (background progress; show only on Explore) =================
const LOADING = (() => {
  const weights = { groups: 0.15, objects: 0.45, media: 0.25, init: 0.15 };
  const phase = { groups: 0, objects: 0, media: 0, init: 0 };

  let ui = null;

  // NEW: completion tracking + callbacks (so Explore can wait for "done")
  let completed = false;
  const doneListeners = new Set();

  const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

  function ensureUI() {
    if (ui) return ui;

    const root = document.getElementById('preload');
    const fill = document.getElementById('preload-bar-fill');
    const pct  = document.getElementById('preload-percent');

    // If markup is missing, use a no-op controller (won't crash loaders)
    if (!root || !fill || !pct) {
      ui = {
        setTarget() {},
        hardSet() {},
        fadeOut(after) { after?.(); },
      };
      return ui;
    }

    let target = 0;
    let shown  = 0;
    let raf = 0;

    const paint = (v) => {
      const p = Math.max(0, Math.min(100, v));
      fill.style.width = `${p}%`;
      pct.textContent = `${Math.round(p)}%`;
      root.querySelector('.preload-bar')?.setAttribute('aria-valuenow', String(Math.round(p)));
    };

    const tick = () => {
      // Smoothly approach target, never overshoot.
      const delta = target - shown;
      if (Math.abs(delta) < 0.05) {
        shown = target;
        paint(shown);
        raf = 0;
        return;
      }
      // easing with a minimum step so it doesn't stall near the end
      const step = Math.sign(delta) * Math.max(0.25, Math.abs(delta) * 0.12);
      shown = Math.min(target, shown + step);
      paint(shown);
      raf = requestAnimationFrame(tick);
    };

    ui = {
      setTarget(p) {
        const next = Math.max(target, Math.min(100, Number(p) || 0)); // monotonic
        target = next;
        if (!raf) raf = requestAnimationFrame(tick);
      },
      hardSet(p) {
        target = shown = Math.max(0, Math.min(100, Number(p) || 0));
        paint(shown);
      },
      fadeOut(after) {
        // Reuse the exact fade pattern you already use for #prepage
        root.classList.add('is-fading');

        const finish = () => {
          root.classList.add('is-hidden');
          // important: allow future show() calls
          root.classList.remove('is-fading');
          after?.();
        };

        const to = setTimeout(finish, 450);
        root.addEventListener('transitionend', () => {
          clearTimeout(to);
          finish();
        }, { once: true });
      }
    };

    // Ensure initial paint
    paint(0);
    return ui;
  }

  function totalPercent() {
    const t =
      clamp01(phase.groups)  * weights.groups +
      clamp01(phase.objects) * weights.objects +
      clamp01(phase.media)   * weights.media +
      clamp01(phase.init)    * weights.init;
    return Math.max(0, Math.min(100, t * 100));
  }

  function isPreloadVisible() {
    const root = document.getElementById('preload');
    return !!root && !root.classList.contains('is-hidden');
  }

  function show() {
    const root = document.getElementById('preload');
    if (!root) return;
    root.classList.remove('is-hidden');
    root.classList.remove('is-fading');
    document.body.classList.add('has-preload');
    maybeEnableBgParallax(root, window.PRELOAD_BG_MOTION_CONFIG || window.PREPAGE_BG_MOTION_CONFIG || null);
  }

  function hide(after) {
    ensureUI().fadeOut(() => {

      const root = document.getElementById('preload');
      if (root && typeof root._bgParallaxCleanup === 'function') {
        root._bgParallaxCleanup();
        root._bgParallaxCleanup = null;
      }  

      document.body.classList.remove('has-preload');
  
      // ✅ Signal that the loading overlay is truly gone
      document.dispatchEvent(new CustomEvent('app:preloadhidden'));
  
      after?.();
    });
  }  

  function onComplete(fn) {
    if (typeof fn !== 'function') return () => {};
    if (completed) {
      queueMicrotask(fn);
      return () => {};
    }
    doneListeners.add(fn);
    return () => doneListeners.delete(fn);
  }

  function flushDone() {
    doneListeners.forEach(fn => {
      try { fn(); } catch (err) { console.warn('[loading] onComplete handler failed', err); }
    });
    doneListeners.clear();
  }

  // If the preload UI is currently visible, ensure it visually reaches 100% before firing onComplete.
  function waitForVisual100ThenFlush() {
    if (!isPreloadVisible()) {
      flushDone();
      return;
    }

    const fill = document.getElementById('preload-bar-fill');
    const start = performance.now();
    const maxMs = 1400;

    const check = () => {
      const w = parseFloat(fill?.style?.width || '0');
      if (w >= 99.5) {
        flushDone();
        return;
      }
      if ((performance.now() - start) > maxMs) {
        // guarantee a clean finish even if smoothing would take longer
        ensureUI().hardSet(100);
        flushDone();
        return;
      }
      requestAnimationFrame(check);
    };

    requestAnimationFrame(check);
  }

  function markComplete() {
    if (completed) return;
    completed = true;

    const u = ensureUI();
    u.setTarget(100);

    waitForVisual100ThenFlush();
  }

  return {
    start() {
      // reset phases + completion
      completed = false;
      doneListeners.clear();
      phase.groups = phase.objects = phase.media = phase.init = 0;
      ensureUI().hardSet(0);
    },
    setPhase(name, frac01) {
      if (!(name in phase)) return;
      phase[name] = clamp01(frac01);
      ensureUI().setTarget(totalPercent());
    },
    setPhaseFromPage(name, info) {
      const page = Number(info?.page) || 1;
      const pageCount = Number(info?.pageCount) || 0;

      if (pageCount > 0) {
        this.setPhase(name, Math.min(0.98, page / pageCount));
      } else {
        // soft ramp: 1/3, 2/4, 3/5 ... approaching 1
        this.setPhase(name, Math.min(0.9, page / (page + 2)));
      }
    },

    // NEW API used by the prepage Explore button
    isComplete() { return completed; },
    onComplete,
    show,
    hide,
    markComplete,

    // Legacy name kept so nothing else breaks if it still exists somewhere.
    // (Not used anymore in the new flow.)
    finishToPrepage() {
      // old behavior: mark complete and fade out if visible
      this.onComplete(() => this.hide());
      markComplete();
    }
  };
})();
// ===============================================================================

function getAppBase() {
  // Prefer the <base> tag (it’s the source of truth for this app)
  const href = document.querySelector('base')?.getAttribute('href')
    || window.__APP_BASE__
    || '/';

  // Normalize to "/something/" form
  let base = href;
  // If someone sets a full URL in base href, reduce to pathname
  try { base = new URL(base, location.origin).pathname; } catch {}
  if (!base.startsWith('/')) base = '/' + base;
  if (!base.endsWith('/')) base += '/';
  return base;
}

function appUrl(pathOrHash = '') {
  const base = getAppBase(); // "/va/" or "/"
  if (!pathOrHash) return base + location.search;

  // Hash-only navigation: appUrl('#home') => "/va/?...#home"
  if (pathOrHash.startsWith('#')) return base + location.search + pathOrHash;

  // Path navigation: appUrl('objects/123') => "/va/objects/123"
  let p = pathOrHash;
  if (p.startsWith('/')) p = p.slice(1);
  return base + p;
}

/**
 * Push a new logical view into browser history.
 * `payload` can carry extra info (e.g. sectionId, objectId, gid).
 */
function pushViewState(view, payload = {}, hash) {
  try {
    const next = { view, ...payload };
    const current = history.state;

    // Very simple dedupe by view type; you can refine later if needed
    if (!current || current.view !== view) {
      // Always anchor "normal" views to app base so we don't keep /objects/... around
      const url = hash ? appUrl(hash) : appUrl('');
      history.pushState(next, '', url);
    }
  } catch (err) {
    console.warn('[view] pushViewState failed', err);
  }
}

// === URL routing for object details (/objects/<slug|id>) ===
const OBJECT_DETAIL_PREFIX = appUrl('objects/'); // becomes "/objects/" or "/va/objects/"

function getStrapiNumericIdFromAppObject(obj) {
  if (!obj) return null;
  if (obj.strapiId != null && obj.strapiId !== '') return Number(obj.strapiId);

  // fallback: parse from app id like "sobj_123"
  const m = String(obj.id || '').match(/^sobj_(\d+)$/);
  if (m) return Number(m[1]);

  // fallback: if obj.id itself is numeric-ish
  if (/^\d+$/.test(String(obj.id || ''))) return Number(obj.id);

  return null;
}

function getObjectUrlToken(obj) {
  const slug = (obj?.slug ?? obj?.Slug ?? '').toString().trim();
  if (slug) return slug;

  const sid = getStrapiNumericIdFromAppObject(obj);
  return sid != null ? String(sid) : '';
}

function buildObjectDetailPath(obj) {
  const token = getObjectUrlToken(obj);
  // If for some reason we can’t build a token, fall back to home
  if (!token) return appUrl('#home');
  return `${OBJECT_DETAIL_PREFIX}${encodeURIComponent(token)}`;
}

function parseObjectTokenFromPathname(pathname = location.pathname) {
  if (!pathname || !pathname.startsWith(OBJECT_DETAIL_PREFIX)) return null;
  const token = pathname.slice(OBJECT_DETAIL_PREFIX.length);
  if (!token) return null;

  try {
    return decodeURIComponent(token);
  } catch {
    return token; // if malformed encoding, still try
  }
}

function isObjectDetailPath(pathname = location.pathname) {
  return !!parseObjectTokenFromPathname(pathname);
}

function resolveObjectByToken(token, allObjects) {
  if (!token || !Array.isArray(allObjects)) return null;

  const t = String(token).trim();
  if (!t) return null;

  // 1) slug match (case-insensitive)
  const bySlug = allObjects.find(o => String(o.slug || o.Slug || '').trim().toLowerCase() === t.toLowerCase());
  if (bySlug) return bySlug;

  // 2) numeric Strapi id match
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    const byStrapiId = allObjects.find(o => getStrapiNumericIdFromAppObject(o) === n);
    if (byStrapiId) return byStrapiId;
  }

  return null;
}

// Called once after data init; it retries until grid + openObjectDetail exist.
function handleInitialObjectRoute() {
  const token = parseObjectTokenFromPathname(location.pathname);
  if (!token) return;

  const MAX_TRIES = 180; // ~3 seconds at 60fps
  let tries = 0;

  const tick = () => {
    const allObjects = (window.gridObject?.objects || window.objects || []);
    const opener = window.openObjectDetail;

    if (!allObjects.length || typeof opener !== 'function') {
      if (++tries < MAX_TRIES) return requestAnimationFrame(tick);
      console.warn('[route] /objects/... detected but app not ready');
      return;
    }

    const obj = resolveObjectByToken(token, allObjects);
    if (!obj) {
      console.warn('[route] object not found for token:', token);
      return;
    }

    // Open detail without creating an in-app "back" entry (direct URL load)
    opener({
      objectId: obj.id,
      from: 'url',
      gid: obj.groupId ?? null,
      historyMode: 'replace',
      detailStacked: false,
    });
  };

  tick();
}

/**
 * Apply a view state to the UI.
 * For now we only handle HOME, SUBPAGE, RESEARCH here.
 * Gallery / Detail still use their existing listeners.
 */
function applyViewFromState(state) {
  const view = state?.view;

  // --- Special case: coming BACK from a text subpage into a detail state ---
  if (state?.detail) {
    const detailEl    = document.getElementById('detail-content');
    const gridShellEl = document.getElementById('grid-shell');

    const inDetail =
      document.body.classList.contains('in-detail-page') ||
      !!detailEl?.classList.contains('active');

    // Are we currently on a text subpage?
    const onTextSubpage = !!document.querySelector('.text-subpage.active');

    // If history says "detail", but the DOM shows a text subpage,
    // restore the existing detail view instead of doing nothing.
    if (!inDetail && onTextSubpage && detailEl) {
      // Hide all text pages
      if (typeof hideAllTextSubpages === 'function') {
        hideAllTextSubpages();
      } else {
        document.querySelectorAll('.text-subpage').forEach((s) => {
          s.hidden = true;
          s.classList.remove('active');
        });
      }

      // Re-show the detail view we previously hid
      detailEl.classList.add('active');
      document.body.classList.add('in-detail-page');
      if (gridShellEl) {
        gridShellEl.style.display = 'none';
      }

      // Let header + sidebars recompute their state
      window.__dispatchViewChange?.();
      if (typeof refreshSlideInsVisibility === 'function') {
        refreshSlideInsVisibility();
      }
    }

    // Hand any other detail transitions (e.g. detail → grid) over
    // to the existing detail popstate handler.
    return;
  }

  // --- Special case: coming BACK from a text subpage into a gallery state ---
  if (state && state.gallery) {
    const gridShellEl    = document.getElementById('grid-shell');
    const groupGalleryEl = document.getElementById('group-gallery');

    const inGallery =
      document.body.classList.contains('in-group-gallery') ||
      document.body.classList.contains('in-gallery') ||
      !!groupGalleryEl?.classList.contains('active');

    // Are we currently on a text subpage?
    const onTextSubpage = !!document.querySelector('.text-subpage.active');

    // If history says "gallery", but the DOM shows a text subpage,
    // restore the existing gallery view instead of doing nothing.
    if (!inGallery && onTextSubpage && groupGalleryEl) {
      // Hide all text pages
      if (typeof hideAllTextSubpages === 'function') {
        hideAllTextSubpages();
      } else {
        document.querySelectorAll('.text-subpage').forEach((s) => {
          s.hidden = true;
          s.classList.remove('active');
        });
      }

      // Re-show the gallery we previously hid
      groupGalleryEl.classList.add('active');

      // Mark correct gallery mode on <body>
      if (state.adhoc) {
        // ad-hoc (tag) gallery
        document.body.classList.add('in-gallery', 'in-adhoc-gallery');
        document.body.classList.remove('in-group-gallery');
      } else {
        // normal group gallery
        document.body.classList.add('in-group-gallery');
        document.body.classList.remove('in-gallery', 'in-adhoc-gallery');
      }

      // Hide grid when gallery is active
      if (gridShellEl) {
        gridShellEl.style.display = 'none';
      }

      // Let header + sidebars / slide-ins recompute their state
      window.__dispatchViewChange?.();
      if (typeof refreshSlideInsVisibility === 'function') {
        refreshSlideInsVisibility();
      }
    }

    // Hand any other gallery transitions (e.g. gallery → grid) over
    // to the existing gallery popstate handler.
    return;
  }

  if (view === VIEW.SUBPAGE) {
    const sectionId = state.sectionId;
    const headerText = state.headerText || '';
    if (sectionId && typeof openTextSubpage === 'function') {
      // prevent re-pushing history from inside
      openTextSubpage(sectionId, headerText, { skipHistory: true });
    } else if (typeof goHome === 'function') {
      goHome({ skipHistory: true });
    }
    return;
  }

  if (view === VIEW.RESEARCH) {
    if (typeof window.openResearchPage === 'function') {
      window.openResearchPage({ skipHistory: true });
    }
    return;
  }

  if (view === VIEW.HOME || view === VIEW.PREPAGE || !view) {
    // If we are currently on the full-page detail view, let the
    // detail popstate handler handle this transition so that the
    // previous grid mode (clustered/ungrouped) is preserved.
    const detailEl = document.getElementById('detail-content');
    const inDetail =
      document.body.classList.contains('in-detail-page') ||
      !!detailEl?.classList.contains('active');

    if (inDetail) {
      // Do NOT call goHome() here; closeObjectDetail({ viaPopstate: true })
      // will run next and will restore the grid state via restoreGridStateFromDetail().
      return;
    }

    if (typeof goHome === 'function') {
      goHome({ skipHistory: true });
    }
    return;
  }

  // Other view types (GALLERY, DETAIL, PREPAGE with separate behavior) can be added here later.
}

// Central popstate: delegates to applyViewFromState
window.addEventListener('popstate', (e) => {
  applyViewFromState(e.state || null);
});

// ===== STRAPI SETUP =====
const STRAPI = {
  base: 'https://va-cms.mpgs.de/api', // e.g. http://localhost:1337/api
  token: 'Bearer 94b9db053fd8114aaa4fc125aaa584d3958c3ac9c24b480f206d132a45a6c14a44f286c4f754e775e1f6680a636bcd00f0632a1206da31c74914148f74f468ae95ccec1f913bec4170ef7c34d06de270a4b4569816d76e977c569e02951dc9a342c0ee70263822ee23953829549c560913d31c1dc43ea4cec78e1d17b8924130',                         // optional: 'Bearer xxx'
  pageSize: 1000                     // safety for pagination
};

// === STRAPI LOGGING ===
const slog = (kind, ...args) => console.log(`[strapi:${kind}]`, ...args);

// --- WaveSurfer defaults (single source of truth) ---
const WS_DEFAULTS = {
  waveColor: '#666',
  progressColor: '#aaa',
  cursorColor: '#ccc',
  height: 50,        // grid + gallery waves are 50px tall
  barWidth: 1,
  barGap: 1,
  normalize: true,
  responsive: true,
  interact: true,
  cursorWidth: 1,
};

// --- Media IO defaults (single source of truth for lazy-loading + KB init) ---
// You can override these without touching code by adding a tiny inline script BEFORE script.js:
//
//   <script>
//     window.MEDIA_IO_CONFIG = { rootMargin: '600px', threshold: 0.2 };
//   </script>
//   <script type="module" src="script.js"></script>
//
const MEDIA_IO = {
  threshold: 0.25,
  root: null,
  rootMargin: '400px',
  unloadOnExit: false,
  ...(typeof window !== 'undefined' && window.MEDIA_IO_CONFIG && typeof window.MEDIA_IO_CONFIG === 'object'
    ? window.MEDIA_IO_CONFIG
    : {})
};

// Small helper so creation looks the same everywhere
function createWave(container, src, overrides = {}) {
  const ws = WaveSurfer.create({ ...WS_DEFAULTS, ...overrides, container });
  if (src) ws.load(src);
  return ws;
}

// Expose the shared WaveSurfer defaults/helper for other modules (e.g., grid.js)
window.WS_DEFAULTS ??= WS_DEFAULTS;
window.createWave  ??= createWave;

// === Audio waveform rendering mode ===
// 'placeholder' (default): show an icon until MP3 is actually loaded on interaction
// 'peaks': fetch *.peaks.json and draw waveform immediately (no MP3 fetch)
window.AUDIO_WAVE_RENDER_MODE ??= 'placeholder';

// Inline SVG (Bootstrap Icons: music-note)
window.AUDIO_PLACEHOLDER_SVG ??= `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
  <path d="M9 13c0 1.105-1.12 2-2.5 2S4 14.105 4 13s1.12-2 2.5-2 2.5.895 2.5 2"/>
  <path fill-rule="evenodd" d="M9 3v10H8V3z"/>
  <path d="M8 2.82a1 1 0 0 1 .804-.98l3-.6A1 1 0 0 1 13 2.22V4L8 5z"/>
</svg>
`.trim();

function addAudioPlaceholder(container) {
  if (!container) return;
  if (container.querySelector(':scope > .audio-placeholder-icon')) return;

  const wrap = document.createElement('div');
  wrap.className = 'audio-placeholder-icon';
  wrap.innerHTML = window.AUDIO_PLACEHOLDER_SVG;

  container.appendChild(wrap);
}

function removeAudioPlaceholder(container) {
  container?.querySelector(':scope > .audio-placeholder-icon')?.remove();
}

window.addAudioPlaceholder ??= addAudioPlaceholder;
window.removeAudioPlaceholder ??= removeAudioPlaceholder;

// Audio lazy-loading: render waveform from peaks first; fetch MP3 only on interaction.
window.AUDIO_HOVER_PREVIEW_DELAY_MS ??= 180;   // ms before hover-preview triggers a network fetch
window.AUDIO_HOVER_PREVIEW_ENABLED  ??= true;  // set false to disable hover preview

const __WS_AUDIO_STATE = new WeakMap();

function __getWsAudioState(ws) {
  let s = __WS_AUDIO_STATE.get(ws);
  if (!s) {
    s = { loaded: false, loading: false, src: null, peaks: null, duration: null, promise: null };
    __WS_AUDIO_STATE.set(ws, s);
  }
  return s;
}

// Inline SVG for videos (simple "play" inside a rectangle)
window.VIDEO_PLACEHOLDER_SVG ??= `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect x="6" y="14" width="52" height="36" rx="6" ry="6" fill="currentColor" opacity="0.18"/>
  <polygon points="28,24 28,40 42,32" fill="currentColor" opacity="0.55"/>
</svg>
`.trim();

// Turn SVG into a data-poster URL (no network request)
function getVideoPlaceholderPoster() {
  const svg = String(window.VIDEO_PLACEHOLDER_SVG || '').trim();
  if (!svg) return '';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

window.getVideoPlaceholderPoster ??= getVideoPlaceholderPoster;

// Optional: if true, we unload the video src on mouseleave (like freeing memory)
window.VIDEO_UNLOAD_ON_LEAVE ??= false;

/**
 * Ensure the MP3 is loaded for a WaveSurfer instance (once), optionally reusing already-fetched peaks/duration.
 * Resolves when WaveSurfer fires 'ready'.
 */
function ensureWaveAudio(ws, src, meta = {}) {
  if (!ws || !src) return Promise.resolve(false);

  const s = __getWsAudioState(ws);

  if (meta.peaks?.length) s.peaks = meta.peaks;
  if (meta.duration) s.duration = meta.duration;

  if (s.loaded && s.src === src) return Promise.resolve(true);
  if (s.loading && s.promise) return s.promise;

  s.loading = true;
  s.src = src;

  const peaks = meta.peaks?.length ? meta.peaks : s.peaks;
  const duration = meta.duration || s.duration;

  // MP3 is requested: prevent any late peaks-only load from clobbering playback.
  try { ws.__mp3Requested = true; } catch {}

  s.promise = new Promise((resolve, reject) => {
    const onReady = () => { s.loaded = true; s.loading = false; resolve(true); };
    const onError = (e) => { s.loaded = false; s.loading = false; reject(e); };

    try {
      ws.once?.('ready', onReady);
      ws.once?.('error', onError);
      ws.load(src, peaks, duration);
    } catch (err) {
      s.loading = false;
      reject(err);
    }
  }).finally(() => { s.promise = null; });

  return s.promise;
}

window.ensureWaveAudio ??= ensureWaveAudio;

function closePrepage(afterFn) {
  const prepage = document.getElementById('prepage');
  if (!prepage) return;

  // start fade
  prepage.classList.add('is-fading');

  const finish = () => {
    if (typeof prepage._bgParallaxCleanup === 'function') {
      prepage._bgParallaxCleanup();
      prepage._bgParallaxCleanup = null;
    }

    prepage.classList.add('is-hidden');
    document.body.classList.remove('has-prepage');
    document.dispatchEvent(new CustomEvent('app:prepageclosed'));
    if (typeof afterFn === 'function') afterFn();
  };

  const to = setTimeout(finish, 450);
  prepage.addEventListener('transitionend', () => {
    clearTimeout(to);
    finish();
  }, { once: true });
}

// ================= Prepage / Splash Screen =================

const PREPAGE_BG_MOTION_DEFAULTS = {
  maxTranslatePx: 14,  // element drift
  maxBgPosPx: 8,       // background drift inside the element
  maxRotateDeg: 1.2,   // tiny rotation
  scale: 1.02,         // slightly > 1 avoids visible edges while moving
  ease: 0.12,          // smoothing (0..1)
  maxTiltDeg: 6,        // 3D tilt strength
  perspectivePx: 900,   // matches --prepage-bg-perspective default
};

function maybeEnableBgParallax(el, cfgOverride = null) {
  if (!el) return;

  // Prevent double-install
  if (typeof el._bgParallaxCleanup === 'function') return;

  const prefersReducedMotion =
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const finePointer =
    window.matchMedia?.('(pointer: fine)')?.matches;

  if (prefersReducedMotion || !finePointer) return;

  const cfg = {
    ...PREPAGE_BG_MOTION_DEFAULTS,
    ...(cfgOverride && typeof cfgOverride === 'object' ? cfgOverride : {}),
  };

  // Reuse the existing implementation (it stores el._bgParallaxCleanup for us)
  enablePrepageBgParallax(el, cfg);
}

// Option 1: subtle parallax using CSS vars (works with the existing .prepage::before background)
function enablePrepageBgParallax(prepage, cfg) {
  let rafId = null;
  let currentX = 0, currentY = 0;
  let targetX = 0, targetY = 0;

  const setVars = (nx, ny) => {
    const tx = nx * cfg.maxTranslatePx;
    const ty = ny * cfg.maxTranslatePx;
    const px = nx * cfg.maxBgPosPx;
    const py = ny * cfg.maxBgPosPx;
    const rot = nx * cfg.maxRotateDeg;
    const tiltX = -ny * cfg.maxTiltDeg; // invert so moving mouse up tilts "towards you"
    const tiltY = nx * cfg.maxTiltDeg;

    prepage.style.setProperty('--prepage-bg-translate-x', `${tx.toFixed(2)}px`);
    prepage.style.setProperty('--prepage-bg-translate-y', `${ty.toFixed(2)}px`);
    prepage.style.setProperty('--prepage-bg-pos-x', `${px.toFixed(2)}px`);
    prepage.style.setProperty('--prepage-bg-pos-y', `${py.toFixed(2)}px`);
    prepage.style.setProperty('--prepage-bg-rotate', `${rot.toFixed(3)}deg`);
    prepage.style.setProperty('--prepage-bg-scale', String(cfg.scale));
    prepage.style.setProperty('--prepage-bg-tilt-x', `${tiltX.toFixed(3)}deg`);
    prepage.style.setProperty('--prepage-bg-tilt-y', `${tiltY.toFixed(3)}deg`);
    prepage.style.setProperty('--prepage-bg-perspective', `${cfg.perspectivePx}px`);
  };

  const tick = () => {
    currentX += (targetX - currentX) * cfg.ease;
    currentY += (targetY - currentY) * cfg.ease;

    setVars(currentX, currentY);

    const done =
      Math.abs(targetX - currentX) < 0.002 &&
      Math.abs(targetY - currentY) < 0.002;

    if (done) {
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  const onMove = (e) => {
    const rect = prepage.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;  // -1..1
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;  // -1..1
    targetX = Math.max(-1, Math.min(1, nx));
    targetY = Math.max(-1, Math.min(1, ny));

    if (rafId == null) rafId = requestAnimationFrame(tick);
  };

  const onLeave = () => {
    targetX = 0;
    targetY = 0;
    if (rafId == null) rafId = requestAnimationFrame(tick);
  };

  prepage.addEventListener('pointermove', onMove, { passive: true });
  prepage.addEventListener('pointerleave', onLeave, { passive: true });

  const cleanup = () => {
    prepage.removeEventListener('pointermove', onMove);
    prepage.removeEventListener('pointerleave', onLeave);
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;

    // Reset vars
    prepage.style.removeProperty('--prepage-bg-translate-x');
    prepage.style.removeProperty('--prepage-bg-translate-y');
    prepage.style.removeProperty('--prepage-bg-pos-x');
    prepage.style.removeProperty('--prepage-bg-pos-y');
    prepage.style.removeProperty('--prepage-bg-rotate');
    prepage.style.removeProperty('--prepage-bg-scale');
    prepage.style.removeProperty('--prepage-bg-tilt-x');
    prepage.style.removeProperty('--prepage-bg-tilt-y');
    prepage.style.removeProperty('--prepage-bg-perspective');
  };

  // store cleanup on the element so closePrepage can stop it cleanly
  prepage._bgParallaxCleanup = cleanup;

  // initialize at rest
  setVars(0, 0);

  return cleanup;
}

function initPrepage() {
  const prepage = document.getElementById('prepage');
  if (!prepage) return;

  document.body.classList.add('has-prepage');

  maybeEnableBgParallax(
    prepage,
    window.PREPAGE_BG_MOTION_CONFIG || null
  );  

  const exploreBtn = document.getElementById('prepage-explore');
  if (exploreBtn) {
    exploreBtn.addEventListener('click', (e) => {
      e.preventDefault();
    
      // If loading is already finished, skip preload entirely.
      if (typeof LOADING?.isComplete === 'function' && LOADING.isComplete()) {
        closePrepage();
        return;
      }
    
      // Otherwise: show the loading screen, keep loading in the background,
      // and only hide it once we truly completed (visually reaches 100%).
      if (typeof LOADING?.show === 'function') {
        LOADING.show();
      }
      if (typeof LOADING?.onComplete === 'function') {
        LOADING.onComplete(() => {
          if (typeof LOADING?.hide === 'function') LOADING.hide();
        });
      }
    
      // Fade out the prepage behind the preload overlay
      closePrepage();
    });
  }

  const learnMoreBtn = document.getElementById('prepage-learn-more');
  if (learnMoreBtn) {
    learnMoreBtn.addEventListener('click', (e) => {
      e.preventDefault();
      // Learn more: close prepage, then open the About text subpage
      closePrepage(() => {
        if (typeof openTextSubpage === 'function') {
          openTextSubpage('subpage-about', 'About');
        }
      });
    });
  }

  // Auto-skip the intro when landing directly on an object deep link (/objects/<slug|id>)
  if (isObjectDetailPath(location.pathname)) {
    // Mirror the "Explore" behavior so users see progress while Strapi data loads
    if (typeof LOADING?.show === 'function') {
      LOADING.show();
    }
    if (typeof LOADING?.onComplete === 'function') {
      LOADING.onComplete(() => {
        if (typeof LOADING?.hide === 'function') LOADING.hide();
      });
    }

    closePrepage();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPrepage);
} else {
  initPrepage();
}
// ============================================================

function isGrouped() {
  return window.gridObject?.currentState === 'grouped';
}

// ============================================================
// Cursor Label (central, reusable)
// Usage:
//  - data-cursor-label="Any text"                  -> always active on hover
//  - data-cursor-label-grouped="Group title"       -> only active when inside #grid[data-view="grouped"]
// Style via CSS (#cursor-label, .cursor-label__text, CSS vars)
// ============================================================
function initCursorLabel() {
  if (window.__cursorLabelInit) return;
  window.__cursorLabelInit = true;

  // Only enable for mouse/trackpad; avoids odd behavior on touch.
  const finePointer = window.matchMedia?.('(pointer: fine)')?.matches;
  if (!finePointer) return;

  // Create the single floating label element
  const el = document.createElement('div');
  el.id = 'cursor-label';
  el.className = 'cursor-label';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<span class="cursor-label__text"></span>`;
  document.body.appendChild(el);

  const textEl = el.querySelector('.cursor-label__text');

  let activeTarget = null;
  let activeGroupedKey = '';
  let activeDefaultKey = ''; // NEW: dedupe for non-grouped tooltips (same text => no reanimation)

  const findCandidate = (node) => {
    if (!node?.closest) return null;
    return node.closest('[data-cursor-label], [data-cursor-label-grouped], [data-cursor-label-single]');
  };

  const computeLabel = (target) => {
    if (!target) return '';

    // If user is dragging the grid, don't show cursor labels.
    if (target.closest('#grid.dragging, #grid.panning')) return '';

    // Highest priority: always-on label
    const direct = target.getAttribute('data-cursor-label');
    if (direct && direct.trim()) return direct.trim();

    // Grouped-only label (only when actually in grouped view)
    const grouped = target.getAttribute('data-cursor-label-grouped');
    if (grouped && grouped.trim() && target.closest('#grid[data-view="grouped"]')) {
      const grid = target.closest('#grid');
      const prefix = grid?.getAttribute('data-cursor-label-grouped-prefix') || '';
      return `${prefix}${grouped.trim()}`;
    }

    // Single-object label (clustered / ungrouped grid, and gallery)
    const single = target.getAttribute('data-cursor-label-single');
    if (single && single.trim()) {
      const grid = target.closest('#grid');
    
      // Grid item tooltip (clustered / ungrouped): show a consistent action hint
      if (grid) {
        const view = grid.dataset.view;
        if (view === 'clustered' || view === 'ungrouped') {
          return ''; // ✅ no tooltip on objects
        }
        // In grouped (and any other) grid modes, single labels should not show.
        return '';
      }

      // ✅ Gallery items: always show "View" (no prefix, no per-object label)
      const gallery = target.closest('#group-gallery');
      if (gallery && target.classList.contains('item') && gallery.classList.contains('active')) {
        return ''; // ✅ no tooltip on objects
      }

      const prefix =
        target.closest('[data-cursor-label-single-prefix]')?.getAttribute('data-cursor-label-single-prefix') ||
        document.body?.getAttribute('data-cursor-label-single-prefix') ||
        '';

      return `${prefix}${single.trim()}`;

    }    

    return '';
  };

  const gridEl = document.getElementById('grid');

  const isGridPanning = () =>
    !!gridEl && (gridEl.classList.contains('dragging') || gridEl.classList.contains('panning'));  

  const computeGridEmptyLabel = (ev) => {
    if (!gridEl) return '';
    if (isGridPanning()) return '';
    if (!ev.target?.closest?.('#grid')) return '';
    if (ev.target.closest('.object')) return ''; // not empty space
    const label = gridEl.getAttribute('data-cursor-label-grid-empty');
    return label ? label.trim() : '';
  };

  const galleryEl = document.getElementById('group-gallery');

  const computeGalleryEmptyLabel = (ev) => {
    if (!galleryEl) return '';
    if (!galleryEl.classList.contains('active')) return '';      // only when gallery is shown
    if (!ev.target?.closest?.('#group-gallery')) return '';
    if (ev.target.closest('.item')) return '';                   // not empty space (gallery item)
    if (ev.target.closest('.fab')) return '';                    // don't override FABs in the gallery
  
    // Only show if there is actually horizontal overflow
    const maxScrollLeft = galleryEl.scrollWidth - galleryEl.clientWidth;
    if (maxScrollLeft <= 1) return '';
  
    const label = galleryEl.getAttribute('data-cursor-label-gallery-empty') || '';
    return label.trim();
  };  

  const wrapTooltip = (label, maxLen = 30) => {
    const raw = String(label ?? '');
    if (raw.length <= maxLen) return raw;
  
    const wrapOneLine = (line) => {
      const words = String(line ?? '').trim().split(/\s+/).filter(Boolean);
      const out = [];
      let cur = '';
  
      const pushCur = () => {
        if (cur) out.push(cur);
        cur = '';
      };
  
      for (let w of words) {
        // If a "word" itself is longer than maxLen, split it.
        if (w.length > maxLen) {
          pushCur();
          for (let i = 0; i < w.length; i += maxLen) {
            out.push(w.slice(i, i + maxLen));
          }
          continue;
        }
  
        if (!cur) {
          cur = w;
        } else if ((cur.length + 1 + w.length) <= maxLen) {
          cur += ' ' + w;
        } else {
          pushCur();
          cur = w;
        }
      }
  
      pushCur();
      return out.join('\n');
    };
  
    // Respect existing newlines (wrap each line separately)
    return raw
      .split(/\r?\n/)
      .map(wrapOneLine)
      .join('\n');
  };  

  const renderGroupedLabel = (prefixLine, groupTitle) => {
    const prefix = String(prefixLine ?? '').trim() || 'explore episode:';
    const wrapped = wrapTooltip(String(groupTitle ?? ''), 42);

    const lines = wrapped
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);

    // Build line elements so we can indent + add spacing via CSS
    textEl.textContent = '';

    const addLine = (text, className) => {
      const span = document.createElement('span');
      span.className = className;
      span.textContent = text;
      textEl.appendChild(span);
    };

    addLine(prefix, 'cursor-label__line cursor-label__line--prefix is-reveal');
    for (const ln of lines) {
      addLine(ln, 'cursor-label__line cursor-label__line--indented is-reveal');
    }    
  };

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  const getRevealElsForCurrent = () => {
    // Grouped tooltip: each .cursor-label__line is animated
    if (el.dataset.kind === 'grouped') {
      return Array.from(textEl.querySelectorAll('.cursor-label__line.is-reveal'));
    }
  
    // Default tooltip: animate the whole .cursor-label__text span
    return textEl.classList.contains('is-reveal') ? [textEl] : [];
  };
  
  const applyRevealDurations = (revealEls) => {
    const rootStyles = getComputedStyle(document.documentElement);
  
    const speedPxPerSec =
      parseFloat(rootStyles.getPropertyValue('--cursor-label-reveal-speed')) || 550;
  
    const minMs =
      parseFloat(rootStyles.getPropertyValue('--cursor-label-reveal-min-ms')) || 120;
  
    let maxMs = 0;
  
    revealEls.forEach((node) => {
      const w = node.getBoundingClientRect().width; // clip-path doesn't affect layout size
      const ms = Math.max(minMs, Math.round((w / Math.max(1, speedPxPerSec)) * 1000));
      node.style.setProperty('--cursor-label-reveal-duration', `${ms}ms`);
      if (ms > maxMs) maxMs = ms;
    });
  
    return maxMs;
  };

  const applyConcealDurations = (revealEls) => {
    const rootStyles = getComputedStyle(document.documentElement);
  
    const speedPxPerSec =
      parseFloat(rootStyles.getPropertyValue('--cursor-label-conceal-speed')) || 1200;
  
    const minMs =
      parseFloat(rootStyles.getPropertyValue('--cursor-label-conceal-min-ms')) || 70;
  
    let maxMs = 0;
  
    revealEls.forEach((node) => {
      const w = node.getBoundingClientRect().width;
      const ms = Math.max(minMs, Math.round((w / Math.max(1, speedPxPerSec)) * 1000));
      node.style.setProperty('--cursor-label-reveal-duration', `${ms}ms`);
      if (ms > maxMs) maxMs = ms;
    });
  
    return maxMs;
  };  
  
  const animateReveal = (revealEls) => {
    if (!revealEls.length) return;
  
    applyRevealDurations(revealEls);
    revealEls.forEach((n) => n.classList.remove('is-revealed'));
  
    // Force the browser to register the initial clip-path before revealing
    void el.offsetWidth;
  
    requestAnimationFrame(() => {
      revealEls.forEach((n) => n.classList.add('is-revealed'));
    });
  };
  
  const animateConceal = (revealEls) => {
    if (!revealEls.length) return Promise.resolve();
  
    // Reduced motion: no need to "wait"
    if (prefersReducedMotion) {
      revealEls.forEach((n) => n.classList.remove('is-revealed'));
      return Promise.resolve();
    }
  
    const maxMs = applyConcealDurations(revealEls);
    revealEls.forEach((n) => n.classList.remove('is-revealed'));
  
    // Pure timeout is robust (no transitionend edge cases)
    return new Promise((resolve) => setTimeout(resolve, maxMs + 30));
  };
  
  // ---- Transition queue: always "close current" then "open next" ----
  let __tooltipTransitionBusy = false;
  let __tooltipPending = null;       // function or null
  let __tooltipHasPending = false;
  let __tooltipReqId = 0;
  let __tooltipClearTimer = null; // NEW: avoids "empty pill" flash during fade-out

  const scheduleTooltipClear = (reqId) => {
    if (__tooltipClearTimer) clearTimeout(__tooltipClearTimer);
  
    const fadeMs = 140; // CSS is 120ms; small buffer
    __tooltipClearTimer = setTimeout(() => {
      // Only clear if still hidden and no newer tooltip request happened
      if (!el.classList.contains('is-visible') && reqId === __tooltipReqId) {
        textEl.classList.remove('is-reveal', 'is-revealed');
        textEl.textContent = '';
      }
    }, fadeMs);
  };  
  
  const requestTooltipTransition = (openFnOrNull) => {
    __tooltipPending = openFnOrNull; // function or null
    __tooltipHasPending = true;
    __tooltipReqId++;
  
    if (__tooltipTransitionBusy) return;
    __tooltipTransitionBusy = true;
  
    const pump = () => {
      if (!__tooltipHasPending) {
        __tooltipTransitionBusy = false;
        return;
      }
  
      const myId = __tooltipReqId;
      const next = __tooltipPending;
      __tooltipHasPending = false;
  
      const wasVisible = el.classList.contains('is-visible');
      const revealEls = getRevealElsForCurrent();
  
      const closePromise = wasVisible
        ? animateConceal(revealEls).then(() => {
            // If a newer request arrived mid-close, stop; the next pump will handle it
            if (myId !== __tooltipReqId) return;
  
            el.classList.remove('is-visible');
            delete el.dataset.kind;

            scheduleTooltipClear(myId);
  
            activeGroupedKey = '';
            activeDefaultKey = ''; // NEW
            activeTarget = null;
          })
        : Promise.resolve();
  
      closePromise
        .then(() => {
          if (myId !== __tooltipReqId) {
            // newer request arrived; keep pumping
            return;
          }
          if (typeof next === 'function') next();
        })
        .finally(() => {
          if (__tooltipHasPending) pump();
          else __tooltipTransitionBusy = false;
        });
    };
  
    pump();
  };  

  const showGrouped = (prefixLine, groupTitle, target, key) => {
    const wasVisible = el.classList.contains('is-visible');
  
    // same pile/content → no re-render and no re-animation
    if (wasVisible && el.dataset.kind === 'grouped' && activeGroupedKey === key) {
      activeTarget = target; // keep pointerout logic happy
      return;
    }
  
    activeTarget = target;
    activeGroupedKey = key;
  
    el.dataset.kind = 'grouped';
    // Ensure default tooltip classes don't leak into grouped mode
    textEl.classList.remove('is-reveal', 'is-revealed');

    renderGroupedLabel(prefixLine, groupTitle);

    el.classList.add('is-visible');
    animateReveal(getRevealElsForCurrent());

  };  

  const show = (label, target, kind = '') => {
    const shown = wrapTooltip(label, 30);
    const k = kind || '';
    const nextKey = `${k}||${shown}`;
    const wasVisible = el.classList.contains('is-visible');
    const curKind = (el.dataset.kind || '');

    // Same label already visible (same kind) → don't re-render / re-animate
    if (wasVisible && curKind === k && activeDefaultKey === nextKey) {
      activeTarget = target; // keep pointerout logic correct
      return;
    }

    activeTarget = target;
    activeDefaultKey = nextKey;

    if (k) el.dataset.kind = k;
    else delete el.dataset.kind;

    // Ensure we start from a clean animation state only when content actually changed
    textEl.classList.remove('is-reveal', 'is-revealed');
    textEl.classList.add('is-reveal');
    textEl.textContent = shown;

    el.classList.add('is-visible');
    animateReveal(getRevealElsForCurrent());
  }; 

  const hide = () => {
    // Do NOT instantly hide — reverse animate first
    requestTooltipTransition(null);
  };  

  const hideInstant = () => {
    // Cancel any in-flight / queued transitions
    __tooltipReqId++;
    __tooltipHasPending = false;
    __tooltipPending = null;
    __tooltipTransitionBusy = false;

    if (__tooltipClearTimer) {
      clearTimeout(__tooltipClearTimer);
      __tooltipClearTimer = null;
    }
  
    // Hard hide + reset
    el.classList.remove('is-visible');
    delete el.dataset.kind;

    // Keep content during fade-out; clear right after (prevents the tiny empty box flash)
    textEl.classList.remove('is-reveal', 'is-revealed');
    scheduleTooltipClear(__tooltipReqId);

    activeGroupedKey = '';
    activeDefaultKey = ''; // NEW
    activeTarget = null;
  };  

  document.addEventListener('pointerover', (ev) => {
    
    if (isGridPanning()) {
      // Safari fires pointerover/out while the grid moves under the cursor.
      // Do NOT hide here, just ignore the spurious event to prevent re-animation loops.
      return;
    }

    const candidate = findCandidate(ev.target);

    // ✅ Special formatting: grouped grid tooltip
    if (
      candidate &&
      candidate.closest('#grid[data-view="grouped"]') &&
      candidate.getAttribute('data-cursor-label-grouped')?.trim()
    ) {
      const grid = candidate.closest('#grid');
      const prefixLine = (grid?.getAttribute('data-cursor-label-grouped-prefix') || 'explore episode:').trim();
      const groupTitle = candidate.getAttribute('data-cursor-label-grouped').trim();

      const gid = candidate.dataset.groupId || '';
      const nextKey = `${prefixLine}||${groupTitle}||${gid}`;      

      // Same pile → keep open, don't retrigger, and don't schedule a close/open cycle
      if (el.classList.contains('is-visible') && el.dataset.kind === 'grouped' && activeGroupedKey === nextKey) {
        activeTarget = candidate;
        return;
      }

      requestTooltipTransition(() => showGrouped(prefixLine, groupTitle, candidate, nextKey));
      return;
    }

    const label = computeLabel(candidate);

    if (label) {
      const shown = wrapTooltip(label, 30);
      const k = ''; // default kind
      const nextKey = `${k}||${shown}`;
      const curKind = (el.dataset.kind || '');

      // ✅ Same visible label → do nothing (prevents reanimation when hovering sibling elements)
      if (el.classList.contains('is-visible') && curKind === k && activeDefaultKey === nextKey) {
        activeTarget = candidate;
        return;
      }

      requestTooltipTransition(() => show(shown, candidate, k));
      return;
    }

    // If the element *qualifies* for cursor labels (candidate exists) but the computed label is empty,
    // it means we intentionally disabled tooltips for this case → hide immediately (no "line pop").
    if (candidate) {
      hideInstant();
      return;
    }

    const emptyLabel = computeGridEmptyLabel(ev);
    if (emptyLabel) {
      requestTooltipTransition(() => show(emptyLabel, gridEl));
      return;      
    }

    const galleryEmptyLabel = computeGalleryEmptyLabel(ev);
    if (galleryEmptyLabel) {
      requestTooltipTransition(() => show(galleryEmptyLabel, galleryEl, 'hscroll'));
      return;      
    }

    hide();
  }, true);

  document.addEventListener('pointerout', (ev) => {
    if (isGridPanning()) return;
    if (!activeTarget) return;
  
    const nextCandidate = findCandidate(ev.relatedTarget);
  
    // In grouped view: moving within the same pile should NOT hide the tooltip
    if (el.dataset.kind === 'grouped' && nextCandidate) {
      const grid = nextCandidate.closest('#grid');
      if (grid?.dataset.view === 'grouped') {
        const prefixLine = (grid.getAttribute('data-cursor-label-grouped-prefix') || '').trim();
        const groupTitle = nextCandidate.getAttribute('data-cursor-label-grouped')?.trim() || '';
        const gid = nextCandidate.dataset.groupId || '';
        const nextKey = `${prefixLine}||${groupTitle}||${gid}`;
  
        if (nextKey === activeGroupedKey) {
          activeTarget = nextCandidate; // switch active target within pile
          return;
        }
      }
    }
  
    if (nextCandidate !== activeTarget) requestTooltipTransition(null);
  }, true);  

  document.addEventListener('pointermove', (ev) => {
    if (!activeTarget) return;

    const ox = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cursor-label-offset-x')) || 12;
    const oy = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cursor-label-offset-y')) || 12;

    const pad =
    parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cursor-label-viewport-pad')) || 8;

    // width/height are what we need (independent of translate position)
    const r = el.getBoundingClientRect();
    const w = r.width;
    const h = r.height;

    let x = ev.clientX + ox;
    let y = ev.clientY + oy;

    // Flip horizontally if we'd overflow right
    if (x + w + pad > window.innerWidth) {
      x = ev.clientX - ox - w;
    }

    // Flip vertically if we'd overflow bottom
    if (y + h + pad > window.innerHeight) {
      y = ev.clientY - oy - h;
    }

    // Clamp to viewport padding (handles extreme corners)
    x = Math.max(pad, Math.min(window.innerWidth - w - pad, x));
    y = Math.max(pad, Math.min(window.innerHeight - h - pad, y));

    el.style.transform = `translate(${x}px, ${y}px)`;

  }, { passive: true });

  // Optional: hide on scroll to avoid “stuck” labels during scroll gestures
  window.addEventListener('scroll', () => {
    if (activeTarget) requestTooltipTransition(null);
  }, true);
}

initCursorLabel();

function _bindHoverPlay(el, ws, opts = {}) {
  const { guardGrouped = false, src = null, peaks = null, duration = null } = opts;
  let hoverToken = 0;

  const ensure = () => {
    if (!src || typeof window.ensureWaveAudio !== 'function') return Promise.resolve(true);
    const meta = {
      peaks: peaks ?? ws?.__lazyPeaks,
      duration: duration ?? ws?.__lazyDuration,
    };
    return window.ensureWaveAudio(ws, src, meta).then(() => true).catch(() => false);
  };

  el.addEventListener('mouseenter', () => {
    if (guardGrouped && isGrouped()) return;
    const t = ++hoverToken;
    ensure().then((ok) => {
      if (!ok) return;
      if (t !== hoverToken) return;
      try { ws.play(); } catch {}
    });
  }, { passive: true });

  el.addEventListener('mouseleave', () => {
    if (guardGrouped && isGrouped()) return;
    hoverToken++;
    try { ws.pause(); } catch {}
  }, { passive: true });
}

// Hover play/pause, but disabled when the grid is grouped
function hoverPlayGuarded(el, ws, src = null, meta = {}) {
  _bindHoverPlay(el, ws, { guardGrouped: true, src, peaks: meta.peaks, duration: meta.duration });
}

// Always play/pause on hover, regardless of grid grouping
function hoverPlay(el, ws, src = null, meta = {}) {
  _bindHoverPlay(el, ws, { guardGrouped: false, src, peaks: meta.peaks, duration: meta.duration });
}

// === MEDIA DEBUG ===
window.DEBUG_MEDIA = true; // flip to false to mute
window.DEBUG_GRID_TEASER = true; // flip to false to mute grid switcher teaser logs
function dlog(...a){ if(window.DEBUG_MEDIA) console.log(...a); }
function dgrp(label){ if(window.DEBUG_MEDIA) console.groupCollapsed(label); }
function dgrpEnd(){ if(window.DEBUG_MEDIA) console.groupEnd(); }

// Optional helper to inspect one filename by substring in the cache:
window.showFormats = (substr) => {
  if (!substr) return console.warn('showFormats("part-of-filename")');
  for (const [name, arr] of (__uploadCache || new Map()).entries()) {
    if (name.toLowerCase().includes(substr.toLowerCase())) {
      console.group(`[lookup] ${name}`);
      arr.forEach(c => {
        console.log('master', `${c.width||'?'}×${c.height||'?'}`, c.url, 'folder=', c.folderPath);
        if (c.formats) {
          console.table(Object.entries(c.formats).map(([k,v]) => ({
            key: k, w: v?.width, h: v?.height, url: v?.url
          })));
        }
      });
      console.groupEnd();
    }
  }
};

// EMD BASIC CONSTANTS AND VARIABLES

// START TAGS DEFINITIONS

// =====================
// TAG GROUPS (10 groups, ≥20 tags each)
// =====================
const TAG_GROUPS = [
  {
    id: 'filetype',
    label: 'Filetype',
    tags: [
      'text','picture','video','sound'
    ]
  },
  {
    id: 'agency_response',
    label: 'Agency & Response',
    tags: [
      'agency','creativity','dissent & contestation','diverging perceptions','endurance',
      'navigating pandemic regulations','possibilities','responsibility','risk management',
      'sacrifice','self-reflection','stigma','pandemic narratives','pandemic practices','care'
    ]
  },
  {
    id: 'emotions_affective',
    label: 'Emotions & Affective Atmospheres',
    tags: [
      'anger','atmosphere of neglect','atmosphere of risk','atmosphere of suspicion','atmosphere of togetherness',
      'being forgotten','depression','experience of (un)acceptance','experience of urgency',
      'fear & anxiety','feeling of abandonment','feeling of connection','feeling of helplessness',
      'frustration','grief','loneliness','(experience of) isolation','experience of deprivation'
    ]
  },
  {
    id: 'economic_labor',
    label: 'Economic impacts & Labor',
    tags: [
      'mobile labor','impacted labor','essential work','economic impacts','loss of livelihood'
    ]
  },
  {
    id: 'governance_health',
    label: 'Governance, Virus & Health',
    tags: [
      'government','hospitalization','infection','lockdown','masks','quarantine',
      'pandemic regulations','pandemic adaptations','state control','(state) carelessness','viral risk'
    ]
  },
  {
    id: 'social_inequality',
    label: 'Social Fabric & Inequality',
    tags: [
      'care','essential needs','family','lack','loss of vitality','marginality','precarity',
      'scarcity','social cohesion','social exclusion','social impacts','social inequalities',
      'social policing','support (networks)','vulnerability'
    ]
  },
  {
    id: 'spatial_mobility',
    label: 'Spatialities & Mobility',
    tags: [
      'being stuck','border','border crossing','digital space','essential mobility',
      'felt space','immobility','infrastructure','mobility','one-room','periphery',
      'public space','spatial separation','urban space','unsafe environments'
    ]
  },
  {
    id: 'temporalities',
    label: 'Temporalities',
    tags: [
      '(altered) continuities','disruption','early phase','lingering','pre-existing grievances',
      'slow recovery','transformation','unfilled time'
    ]
  }
];

// Fast lookup: tag → groupId
const tagToGroup = new Map();
TAG_GROUPS.forEach(g => g.tags.forEach(t => tagToGroup.set(t, g.id)));

// Colors for ALL tags (stable per label)
const ALL_TAGS = TAG_GROUPS.flatMap(g => g.tags);

// === Tag color assignment (avoid similar colors) ============================
// Configurable knobs (kept together on purpose)
const TAG_COLOR_CONFIG = {
  sat: 80,            // %
  lightA: 45,         // %
  lightB: 58,         // % alternate lightness to improve separability
  candidateTries: 14  // more = better spacing, slightly more CPU at startup
};

// Deterministic string -> uint32 (FNV-1a)
function hashInt(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function circDist(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

// Pick hue that maximizes distance to already-used hues (best-effort)
function pickHue(seedHue, usedHues, tries) {
  if (!usedHues.length) return seedHue;
  const GOLDEN = 137.50776405003785; // degrees
  let bestHue = seedHue;
  let bestScore = -1;

  for (let k = 0; k < tries; k++) {
    const h = (seedHue + k * GOLDEN) % 360;
    const score = usedHues.reduce((min, u) => Math.min(min, circDist(h, u)), Infinity);
    if (score > bestScore) {
      bestScore = score;
      bestHue = h;
    }
  }
  return bestHue;
}

// Build/update tagColors in-place so existing references keep working
const tagColors = {};
window.tagColors = tagColors;

function syncTagColorsFromTags(tags) {
  const uniq = Array.from(new Set(tags)).filter(Boolean);

  // stable order: hash-based (so adding tags later doesn't reshuffle everything)
  uniq.sort((a, b) => hashInt(a) - hashInt(b));

  // collect already-used hues (from current tagColors)
  const used = [];
  const hueRe = /hsl\(\s*([0-9.]+)/i;

  for (const t of uniq) {
    const c = tagColors[t];
    if (!c) continue;
    const m = String(c).match(hueRe);
    if (m) used.push(((Number(m[1]) % 360) + 360) % 360);
  }

  // assign missing ones with maximin hue choice
  uniq.forEach((t, i) => {
    if (tagColors[t]) return;

    const base = hashInt(t) % 360;
    const hue = pickHue(base, used, TAG_COLOR_CONFIG.candidateTries);
    used.push(hue);

    const light = (i % 2 === 0) ? TAG_COLOR_CONFIG.lightA : TAG_COLOR_CONFIG.lightB;
    tagColors[t] = `hsl(${hue.toFixed(2)} ${TAG_COLOR_CONFIG.sat}% ${light}%)`;
  });

  // drop colors for tags that no longer exist
  Object.keys(tagColors).forEach(k => {
    if (!uniq.includes(k)) delete tagColors[k];
  });
}

// Initial build
syncTagColorsFromTags(ALL_TAGS);

// Helper: extract tag names from a Strapi relation (v4/v5, populated or not)
function extractTagNamesFromRelation(rel) {
  if (!rel) return [];

  const pickLabel = (node) => {
    const a = (node && (node.attributes || node)) || {};
    return (
      a.Name ||
      a.name ||
      a.Label ||
      a.label ||
      a.Title ||
      a.title ||
      ''
    ).toString().trim();
  };

  // v4/v5: { data: [...] }
  if (Array.isArray(rel?.data)) {
    return rel.data.map(pickLabel).filter(Boolean);
  }
  if (rel?.data) {
    return [pickLabel(rel.data)].filter(Boolean);
  }

  // already-populated arrays or single objects
  if (Array.isArray(rel)) {
    return rel.map(pickLabel).filter(Boolean);
  }

  const single = pickLabel(rel);
  return single ? [single] : [];
}

// === DYNAMIC CONNECTING TAGS (Strapi) ===================================
// First step: we only have a single hardcoded group "All"
// Later: replace this to build 1 group per Strapi group.
// First step used to flatten all ConnectingTag entries into a single "All" group.
// Now we fetch ConnectingTagGroup and build one TAG_GROUPS entry per Strapi group.
async function fetchStrapiConnectingTags() {
  // reuse existing Strapi fetcher
  if (typeof strapiFetchAll !== 'function') {
    console.warn('[tags] strapiFetchAll not available yet – skipping dynamic tag groups');
    return [];
  }

  // Strapi v5: collection name from model "ConnectingTagGroup" → /api/connecting-tag-groups
  // If your API path differs, change 'connecting-tag-groups' here.
  const rows = await strapiFetchAll('connecting-tag-groups', {
    populate: '*',
    publicationState: 'preview'
  });

  const groups = rows
    .map(row => {
      const attrs = (row && (row.attributes || row)) || {};

      // Use Strapi id as stable group id; fall back to slug/name if needed
      const rawId =
        row?.id ??
        attrs.slug ??
        attrs.Slug ??
        attrs.name ??
        attrs.Name ??
        '';
      const id = String(rawId || '').trim();

      // Human label shown in the UI
      const label = (
        attrs.Name ||
        attrs.name ||
        attrs.Label ||
        attrs.label ||
        attrs.Title ||
        attrs.title ||
        id
      ).toString().trim();

      // Relation field from group → ConnectingTag entries
      // Adjust the field name here if your schema uses something different.
      const rel =
        attrs.connecting_tags ||
        attrs['connecting-tags'] ||
        attrs.connectingTags ||
        attrs.ConnectingTags;

      const tags = Array.from(
        new Set(extractTagNamesFromRelation(rel))
      );

      return {
        id: id || label,  // ensure we always have a non-empty id
        label,
        tags
      };
    })
    // drop empty groups to keep the UI clean
    .filter(g => g.id && g.label && g.tags && g.tags.length > 0);

  return groups;
}

// we need to rebuild all lookup structures because TAG_GROUPS was originally static
function rebuildTagCachesFromCurrentGroups() {
  // 1) tag → group
  tagToGroup.clear();
  TAG_GROUPS.forEach(g => {
    (g.tags || []).forEach(t => tagToGroup.set(t, g.id));
  });

  // 2) ALL_TAGS (the const array defined above)
  ALL_TAGS.length = 0;
  TAG_GROUPS.forEach(g => {
    (g.tags || []).forEach(t => ALL_TAGS.push(t));
  });

  // 3) colors (same strategy as initial boot)
  syncTagColorsFromTags(ALL_TAGS);

}

// main entry for dynamic tags
async function seedConnectingTagsFromStrapi() {
  try {
    const groups = await fetchStrapiConnectingTags();
    if (!groups.length) {
      console.warn('[tags] no ConnectingTagGroup data in Strapi – keeping hardcoded TAG_GROUPS');
      return;
    }

    // Sort dynamic (Strapi) groups by numeric Strapi id ascending
    groups.sort((a, b) => {
      const na = Number(a.id);
      const nb = Number(b.id);

      // If both are numeric ids, sort numerically
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;

      // If only one is numeric, put numeric ones first
      if (Number.isFinite(na)) return -1;
      if (Number.isFinite(nb)) return 1;

      // Fallback: stable string sort
      return String(a.id).localeCompare(String(b.id));
    });

    // Replace current groups with the dynamic ones from Strapi
    TAG_GROUPS.length = 0;
    groups.forEach(g => TAG_GROUPS.push(g));

    // Reset any existing group lock: "no group selected" means effectively "All"
    if (typeof currentTagViewGroupId !== 'undefined') {
      currentTagViewGroupId = null;
    }
    if (typeof activeTagGroupId !== 'undefined') {
      activeTagGroupId = null;
    }

    // Rebuild dependent caches (tag → group, ALL_TAGS, colors)
    rebuildTagCachesFromCurrentGroups();

    // If the UI was already built, repaint it
    if (typeof renderTagsForCurrentGroup === 'function') renderTagsForCurrentGroup();
    if (typeof markActiveGroupButton === 'function') markActiveGroupButton();
    if (typeof updateTagAvailability === 'function') updateTagAvailability();
    if (typeof updateObjectGlowsWithGradient === 'function') updateObjectGlowsWithGradient();
    if (typeof scheduleOffgridUpdate === 'function') scheduleOffgridUpdate();
    if (typeof renderSelectionBar === 'function') renderSelectionBar();
    if (typeof syncDetailTagHighlights === 'function') syncDetailTagHighlights();
  } catch (err) {
    console.warn('[tags] failed to load ConnectingTagGroup from Strapi', err);
  }
}

// === DYNAMIC THEMES (Strapi) ===============================================
async function fetchStrapiThemes() {
  if (typeof strapiFetchAll !== 'function') {
    console.warn('[themes] strapiFetchAll not available – skipping dynamic themes');
    return [];
  }

  // Strapi v5 collection name assumed: "themes" -> /api/themes
  const rows = await strapiFetchAll('themes', {
    populate: '*',
    publicationState: 'preview'
  });

  // Normalize: Name -> title, Description -> paragraphs[]
  return rows.map(r => {
    const a = (r && (r.attributes || r)) || {};
    const name = a.Name || a.name || a.Title || a.title || '';
    const desc = a.Description || a.description || '';

    // split Description into paragraphs (supports CRLF/LF and blank-line breaks)
    const paragraphs = Array.isArray(desc)
      ? desc.filter(Boolean)
      : String(desc || '')
          .split(/\r?\n\r?\n|\r?\n/)
          .map(s => s.trim())
          .filter(Boolean);

    // id: prefer Strapi id; fallback to slugified name
    const id = String(r?.id ?? name.toLowerCase().replace(/\s+/g, '-'));

    return { id, title: name || 'Untitled', paragraphs };
  }).filter(t => t.title);
}

async function seedThemesFromStrapi() {
  try {
    const data = await fetchStrapiThemes();
    if (!data.length) {
      console.warn('[themes] no Themes in Strapi – keeping hardcoded list');
      return;
    }
    // Store for UI
    window.__themesFromStrapi = data;

    // If UI already exists (hot re-render), repaint it
    if (document.getElementById('themes-section')?.firstChild) {
      renderThemesUI();
    }
  } catch (err) {
    console.warn('[themes] failed to load from Strapi', err);
  }
}

// The group whose tags are currently displayed at the top
//let currentTagViewGroupId = TAG_GROUPS[0]?.id || null;

// No group selected by default: all tags clickable, default mode = All
let currentTagViewGroupId = null;

// Utility: did the user select ANY tags?
const hasSelection = () => activeTags.size > 0;

// Ensure a stable color for any label you show on the group button (optional)
function groupLabelById(id) {
  const g = TAG_GROUPS.find(x => x.id === id);
  return g ? g.label : id;
}

const activeTags = new Set();
window.activeTags = activeTags;

// Theme filter: mutually exclusive with tag filters
window.activeThemeFilter = null;

// Always refresh the selection bar when tags change
(function patchActiveTagsForSelectionBar() {
  const s = window.activeTags;
  const _add = s.add.bind(s);
  const _del = s.delete.bind(s);
  const _clr = s.clear.bind(s);
  s.add    = (...a) => { const r = _add(...a);    window.renderSelectionBar?.(); return r; };
  s.delete = (...a) => { const r = _del(...a);    window.renderSelectionBar?.(); return r; };
  s.clear  = (...a) => { const r = _clr(...a);    window.renderSelectionBar?.(); return r; };
})();

// Central helper: remove one tag from the global selection and keep all tag-based UI in sync.
// If closeGalleryWhenEmpty is true and this was the last tag, an open ad-hoc gallery is closed.
function deselectTagGlobally(tag, options = {}) {
  if (!window.activeTags || !activeTags.has(tag)) return;

  const { closeGalleryWhenEmpty = false } = options;

  // 1) Update global selection state
  activeTags.delete(tag);

  // 2) Refresh all tag-based UI
  if (typeof renderTagsForCurrentGroup === 'function') renderTagsForCurrentGroup();
  if (typeof updateTagAvailability === 'function')     updateTagAvailability();
  if (typeof updateObjectGlowsWithGradient === 'function') updateObjectGlowsWithGradient();
  if (typeof scheduleOffgridUpdate === 'function')     scheduleOffgridUpdate();
  if (typeof renderSelectionBar === 'function')        renderSelectionBar();
  if (typeof syncDetailTagHighlights === 'function')   syncDetailTagHighlights();

  // 3) If we’re in an ad-hoc gallery, refresh its title + items from the *current* activeTags
  if (typeof window.refreshAdhocGalleryFromTags === 'function') {
    window.refreshAdhocGalleryFromTags();
  }

  // 4) If no tags remain and caller requested it, close any open gallery
  if (!activeTags.size && closeGalleryWhenEmpty && typeof window.closeGallery === 'function') {
    window.closeGallery();
  }
}
window.deselectTagGlobally = deselectTagGlobally;

function getRandomTags() {
  const pool = ALL_TAGS;
  const tagCount = Math.floor(Math.random() * 3) + 1; // 1..3
  const s = new Set();
  while (s.size < tagCount) s.add(pool[Math.floor(Math.random() * pool.length)]);
  return [...s];
}

// END TAG DEFINITIONS

// START CREATE DUMMY OBJECTS

const videoPool = [
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  "https://samplelib.com/lib/preview/mp4/sample-5s.mp4"
];
/*
const audioPool = [
  "https://samplelib.com/lib/preview/mp3/sample-3s.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
];
*/
const audioPool = [
  "mp3/gorila-315977.mp3",
  "mp3/vlog-music-beat-trailer-showreel-promo-background-intro-theme-274290.mp3"
];

window.audioPool = audioPool;

let objectTypes = ['image', 'text', 'video', 'audio'];

const dummyObjects = [];
const groupCount = 5;

// Structured dummy meta per group (title, subtitle, location)
const groupMetaPool = [
  { title: "Covid-19 in Diepsloot",
    subtitle: "Paradoxies of State (Un-)Care in Diepsloot, South Africa",
    location: "Gauteng, South Africa" },
  { title: "Housing Strain in Khayelitsha",
    subtitle: "Paradoxies of State (Un-)Care in Cape Town’s Periphery, South Africa",
    location: "Western Cape, South Africa" },
  { title: "Water Access in Kibera",
    subtitle: "Paradoxies of State (Un-)Care in Nairobi’s Informal Settlements",
    location: "Nairobi County, Kenya" },
  { title: "Public Space in Mathare",
    subtitle: "Paradoxies of State (Un-)Care in Nairobi, Kenya",
    location: "Nairobi County, Kenya" },
  { title: "Street Vending in Fordsburg",
    subtitle: "Paradoxies of State (Un-)Care in Johannesburg’s Inner City",
    location: "Gauteng, South Africa" },
  { title: "Migration at Beitbridge",
    subtitle: "Paradoxies of State (Un-)Care at the Limpopo Border",
    location: "Limpopo, South Africa" },
  { title: "Load Shedding in Soweto",
    subtitle: "Paradoxies of State (Un-)Care in Everyday Electricity Cuts",
    location: "Gauteng, South Africa" },
  { title: "Work and Care in Umlazi",
    subtitle: "Paradoxies of State (Un-)Care in Durban’s Townships",
    location: "KwaZulu-Natal, South Africa" },
  { title: "Transit Lines in Kayole",
    subtitle: "Paradoxies of State (Un-)Care in Eastlands, Nairobi",
    location: "Nairobi County, Kenya" },
  { title: "Clinic Queues in Mitchells Plain",
    subtitle: "Paradoxies of State (Un-)Care in Cape Flats Clinics",
    location: "Western Cape, South Africa" },
];

const groupMetaById = {};
for (let gid = 1; gid <= groupCount; gid++) {
  groupMetaById[gid] = groupMetaPool[(gid - 1) % groupMetaPool.length];
}
// Expose for other modules (e.g., Grid UI if needed)
window.groupMetaById = groupMetaById;

const dummyGroupMetaById = { ...groupMetaById }; // snapshot for dummy/mixed


function randomDateString(startYear = 2018, endYear = 2025) {
  const start = new Date(startYear, 0, 1);
  const end   = new Date(endYear, 11, 31);
  const d = new Date(start.getTime() + Math.random() * (end - start));
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm} / ${dd} / ${yyyy}`;
}

// ---- Global THEMES (not tags) ----
const THEMES = [
  {
    id: 'theme-1',
    title: 'Mobility',
    paragraphs: [
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere, elit quis cursus finibus, tortor lorem gravida nibh.',
      'Suspendisse potenti. Donec at ornare ipsum. Curabitur feugiat, arcu sed aliquet fermentum, erat lorem rutrum ex, vitae luctus arcu nisl sit amet justo.',
      'Proin varius, quam non semper malesuada, nibh tortor finibus felis, ac tristique velit lorem vel sapien.'
    ]
  },
  {
    id: 'theme-2',
    title: 'Essential Work',
    paragraphs: [
      'Morbi iaculis, nunc in condimentum lobortis, lorem massa lacinia lorem, vitae consequat sem ante vitae mauris.',
      'Nulla facilisi. In viverra, purus id tempor lacinia, dolor sapien commodo velit, a volutpat dui risus a nibh.',
      'Maecenas sit amet pharetra justo. Pellentesque habitant morbi tristique senectus et netus.'
    ]
  },
  {
    id: 'theme-3',
    title: 'Public Space',
    paragraphs: [
      'Etiam pharetra, sem sit amet bibendum iaculis, neque nisl auctor ipsum, sed feugiat nunc ex sed leo.',
      'Vestibulum eget leo at est fermentum dictum. Curabitur posuere, justo id facilisis consequat, augue nibh mattis ligula.',
      'Aliquam erat volutpat. Vivamus sagittis dui ut ultricies bibendum.'
    ]
  },
  {
    id: 'theme-4',
    title: 'Housing',
    paragraphs: [
      'Sed tristique, nibh at fermentum tincidunt, enim risus dignissim lectus, id gravida risus arcu vitae eros.',
      'Mauris varius, arcu at viverra consequat, ante leo efficitur est, sed condimentum sem massa vel urna.',
      'Donec feugiat, libero a consequat rutrum, augue quam tincidunt lacus, vitae sollicitudin turpis lorem nec nibh.'
    ]
  },
  {
    id: 'theme-5',
    title: 'Health & Care',
    paragraphs: [
      'Fusce faucibus, ante at blandit luctus, neque lorem convallis quam, a tempus lacus arcu sit amet nisl.',
      'Integer viverra pulvinar lorem, in fermentum sapien placerat non.',
      'Quisque et dapibus arcu. Cras efficitur porta risus, vitae pharetra ipsum cursus at.'
    ]
  },
  {
    id: 'theme-6',
    title: 'Education',
    paragraphs: [
      'Nunc tristique aliquam nunc, eu rutrum ipsum posuere quis.',
      'Integer sit amet sagittis leo. Duis nec luctus arcu, vitae malesuada arcu.',
      'Praesent venenatis, velit in ultrices laoreet, lacus lorem fringilla arcu, at sagittis magna felis nec ipsum.'
    ]
  },
  {
    id: 'theme-7',
    title: 'Memory',
    paragraphs: [
      'Curabitur nec varius nunc. Pellentesque ac sem non lorem bibendum posuere.',
      'Suspendisse hendrerit, arcu at varius tempor, sem diam ultrices metus, non dictum mi nisi non arcu.',
      'Phasellus aliquet gravida diam, ut mattis justo euismod at.'
    ]
  }
];

for(let i=0; i<100; i++) {

  let objectType = objectTypes[Math.floor(Math.random() * objectTypes.length)];
  let randomObjectWidth = Math.floor(Math.random() * (110 - 60 + 1)) + 60;
  let randomObjectHeight = Math.floor(Math.random() * (150 - 60 + 1)) + 60;
  const randomGroupId = Math.floor(Math.random() * groupCount + 1);

  //let angle = Math.random() * 2 * Math.PI;
  //let distance = Math.random() * 100;

  let newObject = {};

  if(objectType == 'image') {

    newObject = {
      id: `object_${i+1}`,
      type: 'image',
      groupId: randomGroupId,
      //groupName: groupNameById[randomGroupId],
      groupLocation: groupMetaById[randomGroupId].location,
      date: randomDateString(),
      grid_x: 0,
      grid_y: 0,
      width: randomObjectWidth,
      height: randomObjectHeight,
      image: `https://picsum.photos/${randomObjectWidth}/${randomObjectHeight}`,
      text: '',
    }

  } else if (objectType == 'text') {

    newObject = {
      id: `object_${i+1}`,
      type: 'text',
      groupId: randomGroupId,
      //groupName: groupNameById[randomGroupId],
      groupLocation: groupMetaById[randomGroupId].location,
      date: randomDateString(),
      grid_x: 0,
      grid_y: 0,
      width: randomObjectWidth,
      height: randomObjectHeight,
      image: '',
      text: 'hello world! This is some text. I am too long by the way',
    }
  } else if (objectType === 'video') {
    const w = Math.floor(Math.random() * (180 - 120 + 1)) + 120;
    const h = Math.floor(Math.random() * (160 - 90 + 1)) + 90;
    newObject = {
      id: `object_${i+1}`,
      type: 'video',
      groupId: randomGroupId,
      //groupName: groupNameById[randomGroupId],
      groupLocation: groupMetaById[randomGroupId].location,
      date: randomDateString(),
      grid_x: 0, grid_y: 0,
      width: w, height: h,
      video: videoPool[Math.floor(Math.random() * videoPool.length)],
      image: "", text: ""
    };
  
  } else if (objectType === 'audio') {
    const w = Math.floor(Math.random() * (220 - 160 + 1)) + 160;
    const h = Math.floor(Math.random() * (80 - 48 + 1)) + 48;
    newObject = {
      id: `object_${i+1}`,
      type: 'audio',
      groupId: randomGroupId,
      //groupName: groupNameById[randomGroupId],
      groupLocation: groupMetaById[randomGroupId].location,
      date: randomDateString(),
      grid_x: 0, grid_y: 0,
      width: w, height: h,
      audio: audioPool[Math.floor(Math.random() * audioPool.length)],
      image: "", text: ""
    };
  }

  newObject.tags = getRandomTags();
  newObject.references = ''; // keep schema aligned with Strapi mode

  // keep dummy schema aligned with app schema
  newObject.connectingTags = newObject.tags;
  
  dummyObjects.push(newObject);
  
  //console.log(newObject);
}

// END CREATE DUMMY OBJECTS

// Active dataset starts as dummy; Strapi/mixed will overwrite later.
let objects = dummyObjects;

// START GROUP CALCULATION AND ADD TO OBJECTS

// END GROUP CALCULATION

// === Group labels (prefer whatever you already stored on objects) ===
const GROUP_IDS = [...new Set(dummyObjects.map(o => o.groupId))];
const GROUP_LABELS = {};
for (const gid of GROUP_IDS) {
  const any = dummyObjects.find(o => o.groupId === gid);
  GROUP_LABELS[gid] = dummyGroupMetaById[gid]?.location || `Province ${gid}, Country`;
}

// === Dummy theme content per group (≥5 themes each) ===
const BASE_THEME_TITLES = [
  'Mobility', 'Essential Work', 'Public Space', 'Housing', 'Health & Care',
  'Education', 'Memory'
];
function lorem(n=3) {
  const p = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere, elit quis cursus finibus, tortor lorem gravida nibh, vitae luctus arcu nisl sit amet justo. Donec at ornare ipsum. Suspendisse potenti.";
  return Array.from({length:n}, ()=>p);
}
export const THEMES_BY_GROUP = {};
for (const gid of GROUP_IDS) {
  THEMES_BY_GROUP[gid] = BASE_THEME_TITLES.slice(0,5).map((title, idx) => ({
    id: `g${gid}-theme-${idx+1}`,
    title,
    paragraphs: lorem(3)
  }));
}


// ==============================
// STRAPI LOADER (all groups + objects)
// ==============================

async function strapiFetch(path, params = {}) {
  // Ensure we always hit /api/<path> and never lose the prefix
  let base = String(STRAPI.base || '').replace(/\/+$/, '');
  if (!/\/api$/i.test(base)) base += '/api';
  const cleanPath = String(path || '').replace(/^\/+/, ''); // remove leading '/'

  const url = new URL(`${base}/${cleanPath}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const headers = { 'Content-Type': 'application/json' };
  if (STRAPI.token) headers['Authorization'] = STRAPI.token;

  slog('GET', url.toString());
  const res = await fetch(url.toString(), { headers });
  slog('RES', res.status, url.pathname + url.search);

  if (!res.ok) {
    const t = await res.text().catch(()=>'');
    throw new Error(`Strapi fetch failed ${res.status}: ${url}\n${t}`);
  }
  const json = await res.json();
  // after res.json()
  const len = Array.isArray(json) ? json.length
    : Array.isArray(json?.data) ? json.data.length
    : (json?.data ? 1 : 0);
  slog('DATA', `items=${len}`, json?.meta ? json.meta : '');
  return json;
}

// Fetch ALL pages for a collection endpoint (logs each page)
// Fetch ALL pages for a collection endpoint (robust against maxLimit/pageCount issues)
// Fetch ALL pages robustly, using the server-reported effective page size
// Fetch ALL pages robustly: keep paging until the API returns an empty page.
// Also break if a page doesn't add anything new (safety against servers that ignore page).
async function strapiFetchAll(path, baseParams = {}, opts = {}) {
  let page = 1;
  const acc = [];
  const seenIds = new Set();   // dedupe and detect no-progress pages

  while (true) {
    slog('PAGE', path, { page, pageSize: STRAPI.pageSize });
    const data = await strapiFetch(path, {
      ...baseParams,
      'pagination[page]': page,
      'pagination[pageSize]': STRAPI.pageSize,
      'pagination[withCount]': true
    });

    const arr = (data && data.data) || [];

    // Optional progress hook (page-by-page)
    try {
      const pg = data?.meta?.pagination || {};
      if (typeof opts.onPage === 'function') {
        opts.onPage({
          page,
          pageCount: pg.pageCount,
          total: pg.total,
          pageSize: pg.pageSize
        });
      }
    } catch {}
  

    slog('PAGE:items', arr.length);

    // Append only new items (by Strapi entity id)
    let added = 0;
    for (const it of arr) {
      if (!it || seenIds.has(it.id)) continue;
      seenIds.add(it.id);
      acc.push(it);
      added++;
    }

    // Stop conditions (any one is enough):
    // 1) Empty page => no more data
    // 2) Page added nothing new => backend ignored page param or we reached the end
    // 3) Safety upper bound on pages
    if (arr.length === 0 || added === 0 || page > 2000) break;

    page++;
  }

  slog('TOTAL', path, acc.length);
  return acc;
}

// ==============================
// STRAPI LOADER (all groups + objects) — with media URL resolution
// ==============================
async function loadStrapiAllGroupsAndObjects() {
  // 1) Groups
  const groups = await strapiFetchAll('groups', {
    // NEW: deep-populate the three sidebar relations so media/relations appear
    'populate[about_the_fieldsite][populate]': '*',
    'populate[about_the_research_project][populate]': '*',
    'populate[about_viral_atmosphere][populate]': '*',
    'populate[authors][fields][0]': 'Name',
    'populate[contributors][fields][0]': 'Name',
    // ✅ ADD THIS (so we actually receive menuImage.url / formats / etc.)
    'populate[menuImage]': true,
  }, {
    onPage: (info) => LOADING.setPhaseFromPage('groups', info)
  });
  LOADING.setPhase('groups', 1);
  
  slog('groups.count', groups.length);
  slog('groups.sample', groups.slice(0, 5).map(g => ({
    id: g.id,
    title: (getAttrs(g).Title || getAttrs(g).title || '')
  })));

  if (!groups.length) {
    slog('groups.empty', 'No groups found in Strapi.');
    return { objects: [], groupMeta: {} };
  }

  const groupIds = groups.map(g => g.id);

  // 2) Objects for those groups — robust fetch (avoids $in bug on relation ids)
  let objects = [];
  try {
    // Try 1: OR of equality checks (very stable in v5)
    const qp = { publicationState: 'preview', populate: '*' };
    groupIds.forEach((id, i) => { qp[`filters[$or][${i}][group][id][$eq]`] = String(id); });
    //objects = await strapiFetchAll('objects', qp);
    objects = await strapiFetchAll('live', qp, {
      onPage: (info) => LOADING.setPhaseFromPage('objects', info)
    });
    LOADING.setPhase('objects', 1);
  } catch (err1) {
    console.warn('[strapi:objects] $or[$eq] failed, falling back per-group', err1);
    // Try 2: Query per group id, then de-duplicate
    const seen = new Set();
    for (let i = 0; i < groupIds.length; i++) {
      const gid = groupIds[i];
      try {
        const part = await strapiFetchAll('objects', {
          'filters[group][id][$eq]': String(gid),
          'publicationState': 'live',
          'populate': '*'
        });
        part.forEach(o => { if (!seen.has(o.id)) { seen.add(o.id); objects.push(o); } });
        // fallback progress: per-group fetch
        LOADING.setPhase('objects', Math.min(0.98, (i + 1) / groupIds.length));
      } catch (err2) {
        console.error('[strapi:objects] per-group fetch failed for', gid, err2);
      }
    }
    LOADING.setPhase('objects', 1);
  }
  slog('objects.count', objects.length);


  // 3) Normalize to app schema
  const normalized = normalizeStrapiToAppSchema(groups, objects);
  slog('normalize.objects', { in: objects.length, out: normalized.objects.length });

  // 4) Resolve media URLs from ImagePath/VideoPath/AudioPath (batched, cached)
  await resolveUploadUrlsForObjects(normalized.objects);
  slog('resolved.media',
    normalized.objects.reduce((acc, o) => {
      if (o.image) acc.image++;
      if (o.video) acc.video++;
      if (o.audio) acc.audio++;
      return acc;
    }, { image: 0, video: 0, audio: 0 })
  );

  return normalized;
}

// Resolve best URL for each object from its stored hint (filename + folder-ish path)
async function resolveUploadUrlsForObjects(objs) {
  // 1) collect unique filenames we need
  const needed = [];
  const hints = new Map(); // obj -> { name, dir , fields present }
  for (const o of objs) {
    const ph = o._pathHints;
    if (!ph) continue;
    const want = {};
    // IMAGE: prefer explicit ImagePath; else derive from existing o.image url
    if (ph.image) {
      want.image = splitPathHint(ph.image);
      needed.push(want.image.name);
    } else if (o.image) {
      const base = String(o.image).split('/').pop().split('?')[0];
      want.image = { name: base, dir: '' };
      needed.push(base);
    }
    if (ph.video && !o.video) { want.video = splitPathHint(ph.video); needed.push(want.video.name); }
    if (ph.audio && !o.audio) { want.audio = splitPathHint(ph.audio); needed.push(want.audio.name); }
    hints.set(o, want);
  }

  // 2) batch fetch all filenames once (report chunk progress)
  await batchFetchUploadFilesByNames([...new Set(needed)], {
    onChunk: ({ done, total }) => {
      const frac = total ? (done / total) : 1;
      LOADING.setPhase('media', frac);
    }
  });
  LOADING.setPhase('media', 1);

  // 3) choose best match per object+field (prefer folderPath that contains the hint dir)
  const pickBest = (name, dir) => {
    const candidates = __uploadCache.get(name) || [];
    if (!candidates.length) { dlog('[match] no candidates for', name); return undefined; }
  
    if (window.DEBUG_MEDIA) {
      dgrp(`[match] ${name} dir='${dir||'(none)'}' candidates=${candidates.length}`);
      candidates.forEach((c,i) => console.log(`#${i}`, {folderPath: c.folderPath, url: c.url, formats: Object.keys(c.formats||{})}));
    }
  
    if (!dir) { 
      window.DEBUG_MEDIA && console.log('→ pick[no-dir]', candidates[0].url);
      dgrpEnd();
      return candidates[0]; 
    }
  
    let best = candidates[0], bestScore = 0;
    for (const c of candidates) {
      const fp = c.folderPath || '';
      const score = fp.includes(dir) ? dir.length : (fp.split('/').pop() === dir.split('/').pop() ? 1 : 0);
      window.DEBUG_MEDIA && console.log('score', score, 'fp=', fp);
      if (score > bestScore) { best = c; bestScore = score; }
    }
    window.DEBUG_MEDIA && console.log('→ pick', best.url, 'score=', bestScore);
    dgrpEnd();
    return best;
  };  

  // 4) write resolved URLs back into objects
  for (const o of objs) {
    const want = hints.get(o);
    if (!want) continue;
  
    if (!o.image && want.image) {
      const cand = pickBest(want.image.name, want.image.dir);
      if (cand) {
        // keep meta for gallery/detail; default grid URL chosen for current width
        o._imageMeta = { url: cand.url, width: cand.width, height: cand.height, formats: cand.formats };
  
        // recompute height from aspect for current tile width
        if (o.width && cand.width && cand.height) {
          o.height = Math.max(1, Math.round(o.width * (cand.height / cand.width)));
        }
  
        // const dpr = window.devicePixelRatio || 1;
        const dpr = 1;
        //const best = pickImageVariant(o._imageMeta, o.width || 200, dpr);
        const best = pickImageVariant(o._imageMeta, o.width || 200, { dpr, headroom: 1.0 });
        o.image = best.url || cand.url;
        if (window.DEBUG_MEDIA) {
          console.log('[assign]',
            { objId: o.id, tileCssW: o.width, dpr, picked: best?.width, url: best?.url, master: o._imageMeta?.url,
              have: Object.keys(o._imageMeta?.formats || {}) });
        }
      }
    }
  
    if (!o.video && want.video) {
      const url = pickBest(want.video.name, want.video.dir)?.url;
      if (url) o.video = url;
    }
    if (!o.audio && want.audio) {
      const url = pickBest(want.audio.name, want.audio.dir)?.url;
      if (url) o.audio = url;
    }
  }  
}

// Turn Strapi paths ("/uploads/…") into absolute URLs; pass through http(s) as-is
function strapiAssetUrl(p) {
  if (!p) return undefined;
  if (/^https?:\/\//i.test(p)) return p;
  let root = String(STRAPI.base || '').replace(/\/+$/,'');
  root = root.replace(/\/api$/i, ''); // strip trailing /api
  if (p[0] !== '/') p = '/' + p;
  return root + p;
}

// Unwrap Strapi media field into a plain { url, formats, width, height }-ish object.
// Supports v4 ({ data: { attributes: ... } }) and v5 (direct object).
function unwrapUploadMeta(mediaField) {
  if (!mediaField) return null;

  // Sometimes you may store just a string url
  if (typeof mediaField === 'string') return { url: mediaField };

  // v4/v5: { data: ... }
  const d = mediaField.data;
  if (d) {
    const node = Array.isArray(d)
      ? (d[0]?.attributes || d[0])
      : (d?.attributes || d);
    return node || null;
  }

  // v5-ish: already looks like the file object
  if (mediaField.url || mediaField.formats) return mediaField;

  // fallback
  return mediaField.attributes || null;
}

// Ensure url + format urls are absolute (so <img src="..."> always works)
function toAbsoluteUploadMeta(meta) {
  if (!meta) return null;
  const abs = (u) => (u ? strapiAssetUrl(u) : u);

  const out = { ...meta };
  if (out.url) out.url = abs(out.url);

  if (out.formats && typeof out.formats === 'object') {
    const fm = {};
    Object.entries(out.formats).forEach(([k, v]) => {
      fm[k] = v ? { ...v, url: abs(v.url) } : v;
    });
    out.formats = fm;
  }

  return out;
}

// === AUTHORS (Team subpage) =====================================

// If your collection is named differently in Strapi, change this one value.
const AUTHOR_ENDPOINT = 'authors';

// tiny HTML escaper to avoid injection in dynamic templates
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Render Strapi-style rich text blocks (with basic inline formatting)
function renderStrapiInline(node) {
  if (!node) return '';

  // Some editors may nest marks/children recursively
  if (Array.isArray(node.children)) {
    return node.children.map(renderStrapiInline).join('');
  }

  const rawText = (typeof node.text === 'string') ? node.text : '';
  if (!rawText) return '';

  let text = escapeHtml(rawText).replace(/\n/g, '<br>');

  // basic inline marks: bold / italic / underline
  if (node.bold || node.strong)    text = `<strong>${text}</strong>`;
  if (node.italic || node.em || node.emphasis) text = `<em>${text}</em>`;
  if (node.underline || node.underlined)       text = `<u>${text}</u>`;

  return text;
}

function renderStrapiBlocks(blocks) {
  if (!Array.isArray(blocks)) return '';
  const out = [];

  blocks.forEach(block => {
    if (!block) return;

    const children = Array.isArray(block.children) ? block.children : [];
    const type = (block.type || '').toLowerCase();

    // --- NEW: list support (unordered / ordered) ---
    if (type === 'list') {
      // Strapi v5: format is 'unordered' or 'ordered'
      const format = (block.format || '').toLowerCase();
      const listTag = (format === 'ordered' || format === 'numbered') ? 'ol' : 'ul';

      const items = children
        .map(item => {
          if (!item) return '';

          // list-item usually has its own children array
          const itemChildren = Array.isArray(item.children) ? item.children : [];
          const itemInner = itemChildren.length
            ? itemChildren.map(renderStrapiInline).join('')
            : renderStrapiInline(item);

          return itemInner ? `<li>${itemInner}</li>` : '';
        })
        .filter(Boolean);

      if (items.length) {
        out.push(`<${listTag}>${items.join('')}</${listTag}>`);
      }

      // List handled, skip the generic block handling below
      return;
    }

    // Shared inline content for non-list blocks
    const inner = children.map(renderStrapiInline).join('');
    if (!inner) return;

    if (type === 'heading' || type === 'heading1' || type === 'h1') {
      out.push(`<h1>${inner}</h1>`);
    } else if (type === 'heading2' || type === 'h2') {
      out.push(`<h2>${inner}</h2>`);
    } else if (type === 'heading3' || type === 'h3') {
      out.push(`<h3>${inner}</h3>`);
    }
    // --- NEW: blockquote / quote support ---
    else if (type === 'quote' || type === 'blockquote') {
      out.push(`<blockquote>${inner}</blockquote>`);
    } else {
      // default: paragraph block
      out.push(`<p>${inner}</p>`);
    }
  });

  return out.join('');
}

// Convert Strapi rich-text-ish values into <p>...</p> blocks
function toParagraphHtml(val) {
  if (!val) return '';

  // if Strapi rich text blocks array
  if (Array.isArray(val)) {
    const htmlFromBlocks = renderStrapiBlocks(val);
    if (htmlFromBlocks) return htmlFromBlocks;

    // Fallback: previous behaviour – plain text only
    const text = val.map(b =>
      (b?.children || []).map(c => c?.text || '').join('')
    ).join('\n\n');
    val = text;
  }

  const paras = String(val)
    .split(/\n\s*\n+/)
    .map(s => s.trim())
    .filter(Boolean);

  return paras
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

async function seedAuthorsFromStrapi() {
  try {
    const json = await strapiFetchAll(AUTHOR_ENDPOINT, {
      populate: '*',
      sort: 'Name:asc',
      'pagination[pageSize]': 1000
    });

    const items = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
    window.__authorsFromStrapi = items.map(it => {
      const a = getAttrs(it);

      // optional image field (future-proof)
      const rawImgUrl =
        tryUploadUrl(a.Image || a.image || a.Photo || a.photo || a.Picture || a.picture);
      const imageUrl = rawImgUrl ? strapiAssetUrl(rawImgUrl) : '';

      return {
        id: String(it.id),
        name: a.Name || a.name || '',
        position: a.Position || a.position || '',
        department: a.Department || a.department || '',
        institution: a.Institution || a.institution || '',
        biography: a.Biography || a.biography || '',
        publication: a.Publication || a.publication || '',
        imageUrl
      };
    }).filter(x => x.name);

    console.log('[team] authors loaded:', window.__authorsFromStrapi.length);
  } catch (e) {
    console.warn('[team] authors load failed:', e);
    window.__authorsFromStrapi = [];
  }
}

// Lazily load + render authors to avoid downloading Team images before the Team page is opened.
function ensureAuthorsLoaded() {
  // Share a single in-flight request across callers.
  if (window.__authorsLoadPromise) return window.__authorsLoadPromise;

  // If we've already completed a load attempt, don't repeat it (keeps navigation cheap).
  if (window.__authorsLoadedOnce) return Promise.resolve();

  // In non-Strapi mode, treat as "loaded" (render will show placeholders / nothing).
  if (!SHOULD_USE_STRAPI) {
    window.__authorsLoadedOnce = true;
    return Promise.resolve();
  }

  window.__authorsLoadPromise = (async () => {
    await seedAuthorsFromStrapi();
    window.__authorsLoadedOnce = true;
  })().finally(() => {
    window.__authorsLoadPromise = null;
  });

  return window.__authorsLoadPromise;
}

function ensureAuthorsRendered() {
  if (window.__authorsRenderedOnce) return Promise.resolve();
  return (async () => {
    await ensureAuthorsLoaded();
    renderAuthorsSubpage();
    window.__authorsRenderedOnce = true;
  })();
}

function renderAuthorsSubpage() {
  const host = document.getElementById('authors-accordion');
  if (!host) return;

  const authors = window.__authorsFromStrapi || [];
  if (!authors.length) {
    host.innerHTML = `<p>No authors found.</p>`;
    return;
  }

  host.innerHTML = authors.map(a => {
    const bioHtml = toParagraphHtml(a.biography);
    const pubHtml = toParagraphHtml(a.publication);

    const pos  = (a.position    || '').trim();
    const dept = (a.department  || '').trim();
    const inst = (a.institution || '').trim();

    // Position + department block (optional)
    let posDeptHtml = '';
    if (pos || dept) {
      const parts = [];
      if (pos) {
        parts.push(`<span class="author-position">${escapeHtml(pos)}</span>`);
      }
      if (dept) {
        parts.push(`<span class="author-department">${escapeHtml(dept)}</span>`);
      }
      posDeptHtml = `
                  <div class="position-dept">
                    ${parts.join('<span class="sep"> | </span>')}
                  </div>`;
    }

    // Institution block (optional)
    let instHtml = '';
    if (inst) {
      instHtml = `
                  <div class="institution">
                    <img class="location-icon" src="img/icons/location_16x11.svg" alt="" aria-hidden="true">
                    <span class="author-institution">${escapeHtml(inst)}</span>
                  </div>`;
    }

    // Do we have ANY meta at all?
    const hasMeta = !!(posDeptHtml || instHtml);

    return `
    <div class="content-section collapsible author-section" data-author-id="${a.id}">
      <div class="section-header">
        <h3 class="author-name">${escapeHtml(a.name)}</h3>
      </div>
  
      <div class="section-content">
        <div class="two-col-table">
  
          ${hasMeta ? `
          <!-- Row 1: Biography heading + meta -->
          <div class="two-col-row">
            <div class="left"><h3>Biography</h3></div>
            <div class="right">
              <div class="author-meta">
                ${posDeptHtml}
                ${instHtml}
              </div>
            </div>
          </div>
          ` : ''}
  
          <!-- Row 2: Photo + biography text -->
          <div class="two-col-row">
            <div class="left">
              ${!hasMeta ? '<h3>Biography</h3>' : ''}
              <div class="author-photo-wrap">
                ${a.imageUrl
                  ? `<img class="author-photo" src="${a.imageUrl}" alt="${escapeHtml(a.name)}" loading="lazy" decoding="async">`
                  : `<div class="author-photo placeholder"></div>`
                }
              </div>
            </div>
            <div class="right">
              ${bioHtml}
            </div>
          </div>
  
          ${pubHtml ? `
          <!-- Row 3: Publications (only if present) -->
          <div class="two-col-row">
            <div class="left"><h3>Publications</h3></div>
            <div class="right">
              ${pubHtml}
            </div>
          </div>
          ` : ''}
  
        </div>
      </div>
    </div>
    `;
  }).join('');  
}

// Open the Team subpage and expand a specific author section by name
function openAuthorSubpageForName(name) {
  if (!name) return;
  const targetName = String(name).trim().toLowerCase();

  // 1) Close full-page detail if open
  window.closeObjectDetail?.();

  // 2) Open the Team/Authors text subpage
  const openTeam = window.openTextSubpage || (typeof openTextSubpage === 'function' ? openTextSubpage : null);
  if (openTeam) {
    openTeam('subpage-team', 'Meet our Team');
  }

  // 3) Wait until Team is fully initialized (authors rendered + accordion wired), then open the right section
  const tryExpand = () => {
    const root = document.getElementById('subpage-team');
    if (!root) {
      requestAnimationFrame(tryExpand);
      return;
    }

    // Ensure Team init runs (openTextSubpage triggers it, but this makes it robust)
    const initPromise =
      root.__initPromise ||
      (typeof initTeamSubpage === 'function' ? initTeamSubpage(root) : Promise.resolve());

    Promise.resolve(initPromise).then(() => {
      const acc = root._accordion;
      if (!acc) return;

      const authors = window.__authorsFromStrapi || [];
      const found = authors.find(a => String(a.name).trim().toLowerCase() === targetName);
      const foundId = found?.id;

      let section = null;

      if (foundId) {
        section = root.querySelector(`.author-section[data-author-id="${CSS.escape(foundId)}"]`);
      }

      if (!section) {
        section = Array.from(root.querySelectorAll('.author-section'))
          .find(sec => sec.querySelector('.author-name')?.textContent?.trim().toLowerCase() === targetName);
      }

      if (section) acc.openSection(section);
    });
  };

  requestAnimationFrame(tryExpand);
}

// expose for other modules (detail, future links)
window.openAuthorSubpageForName = openAuthorSubpageForName;

function handleAuthorLinkClick(ev, anchor) {
  if (!anchor) return;

  if (ev) {
    ev.preventDefault();
    ev.stopPropagation?.();
  }

  const authorName =
    anchor.dataset.authorName ||
    (anchor.textContent || '').trim();

  if (authorName && window.openAuthorSubpageForName) {
    window.openAuthorSubpageForName(authorName);
  }
}

function initAuthorBylineLinks() {
  // Delegate clicks for any author byline inside .subpage-author
  document.addEventListener('click', (ev) => {
    const anchor = ev.target.closest(
      '.subpage-author a, #group-gallery .gallery-authors a, #group-gallery .gallery-contributors a'
    );
    if (!anchor) return;

    // If someone else already fully handled this event, don't double-trigger
    if (ev.defaultPrevented) return;

    handleAuthorLinkClick(ev, anchor);
  });
}

function openGroupGalleryFromDetail(gid) {
  if (gid == null || gid === '') return;
  window.closeObjectDetail?.();
  window.openGroupGallery?.(gid);
}

function pickImageVariant(meta, targetCssWidth, dpr=1) {
  if (!meta) return { url: undefined };
  const need = Math.ceil((targetCssWidth || 200) * Math.max(1, dpr) * 1.25); // headroom
  const pool = [];

  // gather [width,url,height]
  if (meta.formats) {
    Object.values(meta.formats).forEach(f => { if (f?.width && f?.url) pool.push([f.width, f.url, f.height]); });
  }
  if (meta.width && meta.url) pool.push([meta.width, meta.url, meta.height]);

  // smallest >= need, else largest available
  pool.sort((a,b)=>a[0]-b[0]);
  let choice = pool[0];
  for (const p of pool) { if (p[0] >= need) { choice = p; break; } }

  if (window.DEBUG_MEDIA) {
    dgrp(`[variant] need≈${need}px (css=${targetCssWidth}, dpr=${dpr}) options=${pool.length}`);
    pool.forEach(p => console.log('option', p[0], '→', p[1]));
    console.log('→ chosen', choice[0], choice[1]);
    dgrpEnd();
  }

  return { url: choice[1], width: choice[0], height: choice[2] };
}

// Convert Strapi entities into your current in-memory schema
function normalizeStrapiToAppSchema(groups, objectsArr) {
  const MAX_OBJECTS_PER_GROUP = 999;         // <<— your cap

  // feature switches
  const ENABLE_IMAGES = true;
  const ENABLE_VIDEOS = true;
  const ENABLE_AUDIO  = true;

  const perGroupCounts = new Map();         // appGroupId -> count
  const groupMeta = {};
  const groupIdMap = new Map();
  groups.forEach(g => {
    const a = getAttrs(g);
    const appGroupId = `s${g.id}`;
    groupIdMap.set(g.id, appGroupId);

    // Strapi relations for the 3 content sidebars
    const aboutFieldsiteRel =
      a.about_the_fieldsite ||
      a.aboutTheFieldsite ||
      a.About_the_fieldsite;

    const aboutResearchRel =
      a.about_the_research_project ||
      a.aboutTheResearchProject ||
      a.About_the_research_project;

    const aboutViralRel =
      a.about_viral_atmosphere ||
      a.aboutViralAtmosphere ||
      a.About_viral_atmosphere;

    const authors = unwrapRelList(a.authors || a.Authors)
    .map(x => (x?.Name || x?.name || '').toString().trim())
    .filter(Boolean);    

    const contributors = unwrapRelList(a.contributors || a.Contributors)
    .map(x => (x?.Name || x?.name || '').toString().trim())
    .filter(Boolean);  

    groupMeta[appGroupId] = {
      title: a.Title || a.title || `Group ${g.id}`,
      subtitle: a.Subtitle || a.subtitle || '',
      location: a.Location || a.location || '',

      // ✅ ADD THIS (store raw Strapi media field; we’ll unwrap it later)
      menuImage: a.menuImage || a.MenuImage || a.menu_image || null,

      // NEW: gallery byline
      authors,

      contributors,

      // new: 3 optional “About …” sections
      aboutFieldsite:        extractAboutSection(aboutFieldsiteRel),
      aboutResearchProject:  extractAboutSection(aboutResearchRel),
      aboutViralAtmosphere:  extractAboutSection(aboutViralRel),
    };
  });

  slog('normalize.groups', Object.keys(groupMeta).length);

  function extractAboutSection(rel) {
    console.log("rel: ")
    console.log(rel)
    if (!rel) return null;
    const list = unwrapRelList(rel);
    if (!list.length) return null;
  
    const a = getAttrs(list[0]) || {};

    console.log("rel list (keys):", Object.keys(a));
    console.log("Inline candidates:",
      a.InlineContentImage,
      a.inlineContentImage,
      a.inline_content_image,
      a.inline_image
    );
  
    // Canonical field names we expect on the sidebar models
    const title   = a.Title   || a.title   || '';
    const content = a.Content || a.content || '';
  
    // NEW fields for richer layout
    const content2 = a.Content2 || a.content2 || a.Content_2 || a['Content 2'] || '';
    const footNotes =
      a.FootNotes ||
      a.footNotes ||
      a.footnotes ||
      a.foot_notes ||
      '';
    const references =
      a.References ||
      a.references ||
      a.Reference ||
      a.reference ||
      '';
    const inlineContentImage =
      a.InlineContentImage ||
      a.inlineContentImage ||
      a.inline_image ||
      a.inline_content_image ||   // <-- NEW: snake_case API field
      a.Inline_image ||
      a.Image ||
      a.image ||
      null;

    // Optional author relation (shown under the H1 if present)
    const authorRel =
      a.author ||
      a.Author ||
      a.authors ||
      a.Authors ||
      null;

    const author = unwrapRelList(authorRel)
      .map(x => (x?.Name || x?.name || '').toString().trim())
      .filter(Boolean)
      .join(', ');
  
    // If everything is empty, treat this as "no section"
    if (
      !title &&
      !content &&
      !content2 &&
      !footNotes &&
      !references &&
      !inlineContentImage
    ) {
      return null;
    }
  
    // Shape stored into groupMeta[appGroupId].aboutFieldsite / aboutResearchProject / aboutViralAtmosphere
    return {
      title,
      content,
      content2,
      footNotes,
      references,
      inlineContentImage,
      author,
    };
  }  

  
  // helpers

  // Unwrap Strapi relation to a flat list of plain objects (v4/v5-safe)
  function unwrapRelList(rel) {
    if (!rel) return [];
    const take = (n) => (n && (n.attributes || n)) || {};
    if (Array.isArray(rel?.data)) return rel.data.map(take);
    if (rel?.data) return [take(rel.data)];
    if (Array.isArray(rel)) return rel.map(take);
    return [take(rel)];
  }

  const pick = (obj, ...keys) => {
    if (!obj) return undefined;
    for (const k of keys) if (obj[k] != null && obj[k] !== '') return obj[k];
    const lower = Object.create(null);
    Object.keys(obj).forEach(k => { lower[k.toLowerCase()] = k; });
    for (const k of keys) { const real = lower[k.toLowerCase()]; if (real && obj[real] != null && obj[real] !== '') return obj[real]; }
    return undefined;
  };
  const relNames = (rel) => {
    if (!rel) return [];
    // v4: { data: [{ attributes: { Name } }]}
    if (Array.isArray(rel?.data)) {
      return rel.data.map(it => (getAttrs(it)?.Name || getAttrs(it)?.name || '')).filter(Boolean);
    }
    // v5: [{ id, Name }] or [{ id, name }]
    if (Array.isArray(rel)) {
      return rel.map(it => (it?.Name || it?.name || '')).filter(Boolean);
    }
    return [];
  };
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  // Extract Name(s) from an Author relation (v4/v5; single or many)
  const relNamesFromAuthor = (rel) => {
    if (!rel) return [];
    const pickName = (node) => {
      const a = (node && (node.attributes || node)) || {};
      return (a.Name || a.name || '').toString().trim();
    };
    // v4: { data: {...} } or { data: [...] }
    if (Array.isArray(rel?.data)) return rel.data.map(pickName).filter(Boolean);
    if (rel?.data) return [pickName(rel.data)].filter(Boolean);
    // v5 or already populated
    if (Array.isArray(rel)) return rel.map(pickName).filter(Boolean);
    return [pickName(rel)].filter(Boolean);
  };


  // If only one group was loaded, we can safely default missing group to it
  const singleGroupId = groupIdMap.size === 1 ? [...groupIdMap.keys()][0] : null;

  const out = [];
  let skippedNoGroup = 0;
  const skippedSamples = [];

  for (const entry of objectsArr) {
    const a = getAttrs(entry);

    // ---- robust group id extraction (v4/v5)
    let sGroup;
    const gRel = a.group ?? a.Group;
    if (gRel) {
      if (typeof gRel === 'number') sGroup = gRel;                       // numeric id
      else if (gRel.id) sGroup = gRel.id;                                 // v5 populated object
      else if (gRel.data) sGroup = Array.isArray(gRel.data) ? gRel.data[0]?.id : gRel.data?.id; // v4 populated
    }
    if ((!sGroup || !groupIdMap.has(sGroup)) && singleGroupId != null) {
      sGroup = singleGroupId;
      slog('normalize.fallback.group', { obj: entry.id, assigned: sGroup });
    }
    if (!sGroup || !groupIdMap.has(sGroup)) {
      skippedNoGroup++;
      if (skippedSamples.length < 5) skippedSamples.push({ id: entry.id, groupRel: gRel });
      continue;
    }
    const appGroupId = groupIdMap.get(sGroup);

    // ---- media fields (v4/v5 + your custom path fields)
    const imgStr = a.ImagePath || a.imagePath || a.image_path || null;
    const vidStr = a.VideoPath || a.videoPath || a.video_path || null;
    const audStr = a.AudioPath || a.audioPath || a.audio_path || null;


    // Text-to-speech (string field or upload relation)
    const ttsStr =
      a.TextToSpeech || a.textToSpeech || a.text_to_speech || null;

    // If Strapi field is an Upload relation, try to get its URL
    const ttsUploadUrl =
      tryUploadUrl(a.textToSpeech) || tryUploadUrl(a.TextToSpeech);

    const rawTts = ttsUploadUrl || ttsStr;

    // Resolve relative Strapi upload paths -> absolute URL.
    // Gate it so we don’t accidentally prefix plain text.
    const textToSpeech =
      rawTts && /^(https?:\/\/|\/|uploads\/)/i.test(rawTts)
        ? strapiAssetUrl(rawTts)
        : rawTts;

    // InlineContentImage (single media or string path) → absolute URL
    const rawInlineImg = tryUploadUrl(
      a.InlineContentImage ||
      a.inlineContentImage ||
      a.inline_content_image
    );
    const inlineContentImage = rawInlineImg ? strapiAssetUrl(rawInlineImg) : '';

    // Second rich text field (same semantics as Content)
    const content2 =
      a.Content2 ||
      a.content2 ||
      a.content_2 ||
      '';

    // Upload plugin shapes (v5: field.url; v4: field.data.attributes.url)
    const im = a.image, vi = a.video, au = a.audio;
    const imUrl = im?.url || (im?.data ? (Array.isArray(im.data) ? im.data[0]?.attributes?.url : im.data?.attributes?.url) : undefined);
    const viUrl = vi?.url || (vi?.data ? (Array.isArray(vi.data) ? vi.data[0]?.attributes?.url : vi.data?.attributes?.url) : undefined);
    const auUrl = au?.url || (au?.data ? (Array.isArray(au.data) ? au.data[0]?.attributes?.url : au.data?.attributes?.url) : undefined);

    // === exact type rules (priority) =========================================
    // 1) ImagePath (or upload image url) → image
    // 2) else VideoPath (or upload video url) → video
    // 3) else AudioPath (or upload audio url) → audio
    // 4) else → text showing Name
    let type = 'text';
    let image, video, audio, text;

    if (imgStr || imUrl) {
      type  = 'image';
      image = imUrl ? strapiAssetUrl(imUrl) : undefined;   // keep undefined if only a path; will be resolved later
    } else if (vidStr || viUrl) {
      type  = 'video';
      video = viUrl ? strapiAssetUrl(viUrl) : undefined;
    } else if (audStr || auUrl) {
      type  = 'audio';
      audio = auUrl ? strapiAssetUrl(auUrl) : undefined;
    } else {
      type  = 'text';
      text  = a.Name || a.name || `Object ${entry.id}`;
    }

    // --- apply feature toggles ---
    if (type === 'image' && !ENABLE_IMAGES) continue;
    if (type === 'video' && !ENABLE_VIDEOS) continue;
    if (type === 'audio' && !ENABLE_AUDIO)  continue;
    // ------------------------------

    // Keep original path strings so the batched resolver can translate them to upload URLs
    const pathHints = {
      image: imgStr || null,
      video: vidStr || null,
      audio: audStr || null
    };

    // ---- tags (split: connecting vs regular)
    const connectingTags = relNames(a.connecting_tags || a['connecting-tags']);
    const regularTags    = relNames(a.tags);
    // ---- author (relation → Author.Name)
    const authorNames = relNamesFromAuthor(a.author || a.Author);
    const author = authorNames.join(', ');
    // ---- themes (relation → { id, name, description })
    const themes = unwrapRelList(a.themes || a.Themes).map(v => ({
      id: v.id ?? v.ID ?? v.Id ?? null,
      name: (v.Name || v.name || '').toString().trim(),
      description: (v.Description || v.description || '').toString().trim(),
    }));

    // union stays for backwards-compat (grid, filters, etc.)
    const tags = Array.from(new Set([
      ...connectingTags,
      ...regularTags
    ]));

    // ---- dimensions (same as before)
    let width, height;
    if (type === 'image') { width = rand(120, 200); height = rand(120, 160); }
    if (type === 'video') { width = rand(120, 180); height = rand(90, 160); }
    if (type === 'audio') { width = rand(140, 200); height = 60; }
    if (type === 'text')  { width = rand(120, 180); height = rand(120, 160); }

    // enforce per-group cap
    const prev = perGroupCounts.get(appGroupId) || 0;
    if (prev >= MAX_OBJECTS_PER_GROUP) {
      // optionally: collect skipped for debugging
      // skippedSamples.push(entry.id);
      continue;
    }
    perGroupCounts.set(appGroupId, prev + 1);

    // ---- push normalized object
    const objTitle = (a.Name || a.name || a.Title || a.title || '').toString().trim();

    out.push({
      id: `sobj_${entry.id}`,
      strapiId: entry.id,                 // NEW: numeric Strapi id for URLs
      slug: pick(a, 'slug', 'Slug') || '', // NEW: future-friendly (empty => fallback to strapiId)
      type,
      groupId: appGroupId,
      groupLocation: groupMeta[appGroupId]?.location || '',
      groupTitle:   groupMeta[appGroupId]?.title || '',
      date: a.Date || a.date || a.createdAt || a.updatedAt || '',
      author,
      name: objTitle,
      title: objTitle,
      description: a.Description || a.description || a.Caption || a.caption || '',
      references : a.References || a.references || '',
      footNotes : a.FootNotes || a.footNotes || a.footnotes || a.foot_notes || '',
      content: a.Content || a.content || '',
      grid_x: 0, grid_y: 0,
      width, height,
      image, video, audio,
      textToSpeech,
      text,
      tags: regularTags,
      connectingTags,           // ← new: what the sidebar should match
      themes,
      _pathHints: pathHints,
      inlineContentImage,
      content2
    });
  }

  if (skippedNoGroup) slog('normalize.skipped.no-group', { count: skippedNoGroup, samples: skippedSamples });
  slog('normalize.objects', { in: objectsArr.length, out: out.length });
  slog('normalize.sample', out.slice(0, 5).map(x => ({
    id: x.id, type: x.type, groupId: x.groupId,
    media: x.image || x.video || x.audio || null,
    text: x.text ? (String(x.text).slice(0, 60) + (String(x.text).length > 60 ? '…' : '')) : null
  })));

  return { objects: out, groupMeta };
}

// Extract "filename.ext" and "dir part" from a hint like "Folder/Sub/images/file.jpg"
function splitPathHint(pathStr) {
  if (!pathStr) return { name: '', dir: '' };
  try { pathStr = decodeURIComponent(pathStr); } catch {}
  const parts = String(pathStr).split('/');
  const name = parts.pop() || '';
  const dir  = parts.join('/').toLowerCase(); // for fuzzy matching duplicates
  return { name, dir };
}

const __uploadCache = new Map();

// Fetch many upload files by name using $in (with a safe fallback syntax)
async function batchFetchUploadFilesByNames(names, opts = {}) {
  if (!names.length) return;
  const want = names.filter(n => !__uploadCache.has(n));
  if (!want.length) return;

  const CHUNK = 40;

  const totalChunks = Math.ceil(want.length / CHUNK);
  let doneChunks = 0;

  const report = () => {
    if (typeof opts.onChunk === 'function') {
      opts.onChunk({ done: doneChunks, total: totalChunks });
    }
  };

  report(); // initial

  for (let i = 0; i < want.length; i += CHUNK) {
    const chunk = want.slice(i, i + CHUNK);

    // First try: array syntax that ALWAYS works in v5
    const qpEqOr = { 'pagination[page]': 1, 'pagination[pageSize]': 1000 };
    // filters[$or][0][name][$eq]=fileA, filters[$or][1][name][$eq]=fileB, ...
    chunk.forEach((n, idx) => { qpEqOr[`filters[$or][${idx}][name][$eq]`] = n; });
    let json = await strapiFetch('upload/files', qpEqOr);

    // Fallback 1: $in with indexed array
    const noResults = (Array.isArray(json) && json.length === 0) ||
                      (Array.isArray(json?.data) && json.data.length === 0);
    if (noResults) {
      const qpIn = { 'pagination[page]': 1, 'pagination[pageSize]': 1000 };
      chunk.forEach((n, idx) => { qpIn[`filters[name][$in][${idx}]`] = n; });
      json = await strapiFetch('upload/files', qpIn);
    }

    // Fallback 2: a loose search on URL (covers providers that rename files)
    const stillNone = (Array.isArray(json) && json.length === 0) ||
                      (Array.isArray(json?.data) && json.data.length === 0);
    if (stillNone) {
      const qpUrl = { 'pagination[page]': 1, 'pagination[pageSize]': 1000 };
      chunk.forEach((n, idx) => { qpUrl[`filters[$or][${idx}][url][$containsi]`] = n; });
      json = await strapiFetch('upload/files', qpUrl);
    }

    // Normalize both response shapes
    const items = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
    items.forEach(it => {
      const a = getAttrs(it);
      const key = a?.name;
      const abs = (u) => u ? strapiAssetUrl(u) : undefined;
      const url = abs(a?.url);
      const folderPath = (a?.folderPath || a?.folder?.path || a?.folder?.name || '').toLowerCase();
      if (!key || !url) return;
    
      // normalize formats with absolute urls
      const formats = {};
      Object.entries(a?.formats || {}).forEach(([k, v]) => {
        formats[k] = { ...v, url: abs(v?.url) };
      });
    
      const arr = __uploadCache.get(key) || [];
      arr.push({
        url,
        folderPath,
        width: a?.width,
        height: a?.height,
        formats
      });
      __uploadCache.set(key, arr);

      // DEBUG: show the formats Strapi has for this file
      if (window.DEBUG_MEDIA) {
        dgrp(`[media] cache: ${key}`);
        console.log('folderPath=', folderPath);
        console.log('original:', { width: a?.width, height: a?.height, url });
        if (formats && Object.keys(formats).length) {
          console.table(Object.entries(formats).map(([k,v]) => ({
            key: k, w: v?.width, h: v?.height, url: v?.url
          })));
        } else {
          console.log('formats: <none>');
        }
        dgrpEnd();
      }

    });  
    
    doneChunks++;
    report();

  }
}

// Unified loader that returns {objects, groupMeta} based on DATA_MODE
// Unified loader that returns {objects, groupMeta} based on DATA_MODE
async function loadData(DATA_MODE) {
  if (DATA_MODE === 'dummy') {
    return { objects: dummyObjects, groupMeta: dummyGroupMetaById };
  }

  const s = await loadStrapiAllGroupsAndObjects();

  if (DATA_MODE === 'strapi') {
    return { objects: s.objects, groupMeta: s.groupMeta };
  }

  // mixed = dummy + strapi
  const mergedMeta = { ...dummyGroupMetaById, ...s.groupMeta };
  return { objects: [...dummyObjects, ...s.objects], groupMeta: mergedMeta };
}


// START GRID OBJECT

//const gridObject = new Grid('grid', objects, {});
//window.gridObject = gridObject; // expose globally so the gallery click handler can read currentState & groups

// START GRID OBJECT (data-aware)
let gridObject;
window.gridObject = null;

(async () => {
  try {
    LOADING.start();
    LOADING.setPhase('init', 0);

    // Deep link (/objects/...) should skip intro and show preload until data/grid init completes.
    if (typeof isObjectDetailPath === 'function' && isObjectDetailPath(location.pathname)) {
      // Close intro immediately
      closePrepage();

      // Show preload and auto-hide when the loader completes
      LOADING.show?.();
      LOADING.onComplete?.(() => LOADING.hide?.());
    }

    const loaded = await loadData(DATA_MODE);
    // Use the chosen data source
    objects = loaded.objects;

    // Reset groupMetaById so we don't keep dummy meta when in 'strapi' mode
    Object.keys(groupMetaById).forEach((key) => delete groupMetaById[key]);
    Object.assign(groupMetaById, loaded.groupMeta);

    // NEW: rebuild tag/object compatibility from the active dataset
    buildTagIndex(objects);
    updateTagAvailability?.();
    updateObjectGlowsWithGradient?.();
    scheduleOffgridUpdate?.();
    renderSelectionBar?.();
    syncDetailTagHighlights?.();

    console.log('[data] mode=', DATA_MODE, 'groups=', Object.keys(loaded.groupMeta).length, 'objects=', loaded.objects.length);
    gridObject = new Grid('grid', objects, {});
    window.gridObject = gridObject;
    syncVisitedDotScaleFromZoom(gridObject.zoomLevel ?? 1);
    window.applyVisitedMarkers?.();
    LOADING.setPhase('init', 1);
    LOADING.markComplete();
    // wire header + set initial copy
    window.__wireHeaderToGrid?.();

    // ✅ restore persisted grid mode + update active icon
    restoreGridModeFromStorage();

    window.__dispatchViewChange?.();
    // sidebar "Project" list → now that we have groupMetaById
    if (typeof renderDiscoverProjectsFromGroups === 'function') {
      renderDiscoverProjectsFromGroups();
    }

    // NEW: if user loaded /objects/<slug|id> directly, open that detail now
    handleInitialObjectRoute();

  } catch (err) {
    console.error('Failed to load data / init grid:', err);
    alert('Strapi load failed. Check the console for details (network/permissions).');
  }
})();

// Pretty logging for Strapi objects
function dumpStrapiObjects(objects) {
  const unionKeys = new Set();
  let imgPath = 0, vidPath = 0, audPath = 0;
  let imgUpload = 0, vidUpload = 0, audUpload = 0;

  const firstN = objects.slice(0, 5);
  console.group('[strapi:objects.dump]');
  console.log('total', objects.length);

  objects.forEach(o => {
    const a = getAttrs(o);
    Object.keys(a || {}).forEach(k => unionKeys.add(k));
    if (a?.ImagePath || a?.imagePath || a?.image_path) imgPath++;
    if (a?.VideoPath || a?.videoPath || a?.video_path) vidPath++;
    if (a?.AudioPath || a?.audioPath || a?.audio_path) audPath++;
    // Upload media common shapes (v4: image.data.attributes.url; v5: image.url)
    const im = a?.image; const vi = a?.video; const au = a?.audio;
    const imUrl = (im?.data ? (Array.isArray(im.data) ? im.data[0]?.attributes?.url : im.data?.attributes?.url) : im?.url);
    const viUrl = (vi?.data ? (Array.isArray(vi.data) ? vi.data[0]?.attributes?.url : vi.data?.attributes?.url) : vi?.url);
    const auUrl = (au?.data ? (Array.isArray(au.data) ? au.data[0]?.attributes?.url : au.data?.attributes?.url) : au?.url);
    if (imUrl) imgUpload++;
    if (viUrl) vidUpload++;
    if (auUrl) audUpload++;
  });

  console.log('attribute keys (union):', Array.from(unionKeys).sort());
  console.log('counts: ImagePath=%d, VideoPath=%d, AudioPath=%d', imgPath, vidPath, audPath);
  console.log('upload-shape counts: image.url=%d, video.url=%d, audio.url=%d', imgUpload, vidUpload, audUpload);

  firstN.forEach((o, i) => {
    const a = getAttrs(o);
    console.group(`#${i} id=${o.id}`);
    console.log('attributes:', a);
    console.log('group relation:', a?.group || a?.Group);
    console.log('raw object:', o);
    console.groupEnd();
  });

  console.groupEnd();
}

// small helper to extract a URL if fields use Strapi Upload media (object/array with .data[].attributes.url)
// small helper to extract a URL if fields use Strapi Upload media (v4/v5-safe)
function tryUploadUrl(mediaField) {
  if (!mediaField) return undefined;

  // If it's already a string URL/path
  if (typeof mediaField === 'string') return mediaField;

  // Strapi v5 sometimes returns media with url at top-level
  if (mediaField.url) return mediaField.url;

  // Strapi v4/v5 relational media shape
  const d = mediaField.data;
  if (!d) return undefined;

  if (Array.isArray(d)) {
    return d[0]?.attributes?.url || d[0]?.url;
  }
  return d.attributes?.url || d.url;
}

// Strapi v5 returns fields on the top level; v4 used entry.attributes
function getAttrs(entry) {
  if (!entry) return {};
  return entry.attributes ? entry.attributes : entry;
}

// END GRID OBJECT

function isTextPageActive() {
  return document.body.classList.contains('in-text-subpage')
    || !!document.querySelector('.text-subpage.active')
    || document.getElementById('research-page')?.classList.contains('active');
}

// Mapping between content slide-ins and their groupMeta keys
const CONTENT_SIDEBAR_CONFIG = [
  { id: 'about-the-fieldsite',       key: 'aboutFieldsite' },
  { id: 'about-the-research-project', key: 'aboutResearchProject' },
  { id: 'viral-atmospheres',          key: 'aboutViralAtmosphere' },
];

// Render any of the 3 content sidebars (fieldsite, research project, viral atmospheres)
// using the shared 3-row two-col-table layout.
function renderContentSidebar(sidebar, data) {
  const titleH1      = sidebar.querySelector('.content-sidebar-title');
  const contextBody  = sidebar.querySelector('.content-sidebar-context-body');
  const notesBody    = sidebar.querySelector('.content-sidebar-notes-body');
  const refsBody     = sidebar.querySelector('.content-sidebar-references-body');

  // NEW: row containers so we can hide them
  const notesRow = sidebar.querySelector('.content-sidebar-notes-row');
  const refsRow  = sidebar.querySelector('.content-sidebar-references-row');

  if (!titleH1 || !contextBody || !notesBody || !refsBody) return;

  const rich = (val) =>
    (val != null && typeof toParagraphHtml === 'function')
      ? toParagraphHtml(val)
      : '';

  if (!data) {
    // Clear and hide notes + references if no data at all
    titleH1.textContent   = '';
    contextBody.innerHTML = '';
    notesBody.innerHTML   = '';
    refsBody.innerHTML    = '';

    if (notesRow) notesRow.style.display = 'none';
    if (refsRow)  refsRow.style.display  = 'none';

    const byline = sidebar.querySelector('.content-sidebar-author');
    if (byline) { byline.innerHTML = ''; byline.hidden = true; }

    return;
  }

  // 1) Title (normalized in extractAboutSection from the main model's Title field)
  const title = data.title || '';
  titleH1.textContent = title || '';

  // 1b) Optional author byline under the H1 (links to Team subpage)
  let byline = sidebar.querySelector('.content-sidebar-author');
  if (!byline) {
    byline = document.createElement('span');
    byline.className = 'subpage-author content-sidebar-author';
    titleH1.insertAdjacentElement('afterend', byline);
  }

  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const escAttr = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const authorStr = (data.author || '').trim();

  if (!authorStr) {
    byline.innerHTML = '';
    byline.hidden = true;
  } else {
    const names = authorStr
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const links = names
      .map(n => `<a href="#subpage-team" data-author-name="${escAttr(n)}">${esc(n)}</a>`)
      .join(', ');

    byline.innerHTML = `Written by ${links}`;
    byline.hidden = false;
  }

  // 2) Row 1 right: Content → (optional) InlineContentImage → Content2
  const parts = [];

  const contentHtml = rich(data.content);
  if (contentHtml) parts.push(contentHtml);

  if (data.inlineContentImage && typeof tryUploadUrl === 'function' && typeof strapiAssetUrl === 'function') {
    const raw = tryUploadUrl(data.inlineContentImage);
    const url = raw ? strapiAssetUrl(raw) : '';
    if (url) {
      parts.push(
        `<figure class="detail-inline-image content-inline-image">
           <img src="${url}" alt="">
         </figure>`
      );
    }
  }

  const content2Html = rich(data.content2);
  if (content2Html) parts.push(content2Html);

  contextBody.innerHTML = parts.join('\n');

  // 3) Row 2 right: Notes (FootNotes) – hide row if empty
  const notesHtml = rich(data.footNotes);
  notesBody.innerHTML = notesHtml || '';
  if (notesRow) {
    notesRow.style.display = notesHtml ? '' : 'none';
  }

  // 4) Row 3 right: References – hide row if empty
  const refsHtml = rich(data.references);
  refsBody.innerHTML = refsHtml || '';
  if (refsRow) {
    refsRow.style.display = refsHtml ? '' : 'none';
  }
}

// Fill the 3 content slide-ins from the current group's meta
function updateContentSidebarsForGroup(groupId) {
  if (!groupId || !window.groupMetaById) return;

  const meta = window.groupMetaById[groupId];
  if (!meta) return;

  CONTENT_SIDEBAR_CONFIG.forEach(({ id, key }) => {
    const sidebar = document.getElementById(id);
    if (!sidebar) return;

    const data = meta[key];

    // NEW: if this sidebar uses the new 3-row layout, use the shared renderer
    if (sidebar.querySelector('.content-sidebar-title')) {
      renderContentSidebar(sidebar, data);
      return;
    }

    // Fallback: legacy simple layout (only used if a sidebar still has .text-page-body)
    const titleEl = sidebar.querySelector('.text-page h2');
    const bodyEl  = sidebar.querySelector('.text-page-body');

    if (!titleEl || !bodyEl) return;

    if (data && (data.title || data.content)) {
      if (data.title) {
        titleEl.textContent = data.title;
      }

      if (data.content != null && typeof toParagraphHtml === 'function') {
        const html = toParagraphHtml(data.content);
        bodyEl.innerHTML = html || '';
      } else if (typeof data.content === 'string') {
        bodyEl.textContent = data.content;
      } else {
        bodyEl.innerHTML = '';
      }
    }
  });
}

function refreshSlideInsVisibility() {
  const slideIns = document.getElementById('slide-ins');
  if (!slideIns) return;

  const galleryActive = document.getElementById('group-gallery')?.classList.contains('active');
  const state         = window.gridObject?.currentState;
  const detailActive  = document.getElementById('detail-content')?.classList.contains('active');

  // Detect ad-hoc gallery via history.state or a body class
  const isAdhoc = !!history.state?.adhoc || document.body.classList.contains('in-adhoc-gallery');
  const isThemeGallery = document.body.classList.contains('in-theme-gallery');

  // If we are in a detail view, check how many objects this group's nav has
  // We only want content sidebars when there is more than one object in the group
  let detailGroupHasMultiple = true;
  if (detailActive && window.__detailNav && Array.isArray(window.__detailNav.order)) {
    detailGroupHasMultiple = window.__detailNav.order.length > 1;
  }

  // NEW: mark when we are in a single-object detail view
  const isSingleDetail = detailActive && !detailGroupHasMultiple;
  document.body.classList.toggle('detail-single-object-group', isSingleDetail);

  // Grid states where menu sidebar is normally allowed
  const baseAllowedStates = (state === 'ungrouped' || state === 'clustered' || state === 'pre-cluster');

  // 1) MENU slide-ins (Discover Connections)
  // Keep existing behavior: visible in grid + adhoc tag gallery, hidden in detail and real group gallery
  const textActive = (typeof isTextPageActive === 'function' && isTextPageActive());

  const shouldShowMenu =
    !textActive &&
    !isThemeGallery &&
    (baseAllowedStates || isAdhoc) &&
    (!galleryActive || isAdhoc) &&
    !detailActive;

  // 2) CONTENT slide-ins (the 3 new ones)
  const shouldShowContent =
    !isThemeGallery &&
    ((detailActive && detailGroupHasMultiple) || (galleryActive && !isAdhoc));

  let anyAllowed = false;

  slideIns.querySelectorAll('.slide-in').forEach(el => {
    const mode = el.dataset.mode || 'content'; // default all non-menu to content
    const allowed = (mode === 'menu') ? shouldShowMenu : shouldShowContent;
    anyAllowed = anyAllowed || allowed;

    el.classList.toggle('is-hidden', !allowed);

    // If a sidebar becomes disallowed, collapse & clean it
    if (!allowed) {
      el.classList.remove('expanded', 'secondary-open');
      el.querySelector('.vertical-content')?.classList.remove('visible');

      const panel = el.querySelector('.secondary-pane');
      if (panel) {
        panel.setAttribute('aria-hidden', 'true');
        panel.innerHTML = '';
      }
    }
  });

  // Container visible if any child is allowed
  slideIns.classList.toggle('visible', anyAllowed);

  if (!anyAllowed) {
    // Safety: collapse everything if container is hidden
    slideIns.querySelectorAll('.slide-in').forEach(el => {
      el.classList.remove('expanded', 'secondary-open');
      el.querySelector('.vertical-content')?.classList.remove('visible');
    });
  }

  // Decide which "open" icon the mobile expand button should use
  const expandEl = document.getElementById('mobile-slideins-expand');
  if (expandEl) {
    // reset both variants first
    expandEl.classList.remove('is-menu', 'is-content');

    // In your current layout, these two should be mutually exclusive,
    // but we keep the checks explicit for clarity.
    if (shouldShowMenu && !shouldShowContent) {
      // Discover Connections (menu sidebar)
      expandEl.classList.add('is-menu');
    } else if (shouldShowContent && !shouldShowMenu) {
      // Group of 3 content sidebars (detail/gallery)
      expandEl.classList.add('is-content');
    }
    // If neither is true (no sidebars), we leave it without a variant class.
    // The button itself will be hidden by updateMobileSlideInsToggle().
  }

  // Keep the mobile collapse / expand UI in sync whenever visibility changes
  if (typeof updateMobileSlideInsToggle === 'function') {
    updateMobileSlideInsToggle();
  }

  if (typeof updateRightCounterOffset === 'function') updateRightCounterOffset();
}

// Collapse all Discover Connections panels (keep the container visible)
function collapseDiscoverSidebar() {
  const wrap = document.getElementById('slide-ins');
  if (!wrap) return;

  wrap.querySelectorAll('.slide-in').forEach(el => {
    el.classList.remove('expanded', 'secondary-open');
    el.querySelector('.vertical-content')?.classList.remove('visible');
  });

  // keep layout math in sync with the new (collapsed) width
  if (typeof updateRightCounterOffset === 'function') {
    updateRightCounterOffset();
  }
}

// (optional) expose for debugging / future reuse
window.collapseDiscoverSidebar = collapseDiscoverSidebar;

function collapseSlideInsStrip() {
  const slideIns = document.getElementById('slide-ins');
  if (!slideIns) return;

  // Push whole strip off-screen (now for all breakpoints; CSS change below)
  slideIns.classList.add('is-collapsed');

  // Also collapse individual panels so width math stays compact
  if (typeof collapseDiscoverSidebar === 'function') {
    collapseDiscoverSidebar();
  }

  if (typeof updateMobileSlideInsToggle === 'function') {
    updateMobileSlideInsToggle();
  }
}

// --- Mobile-only: hide/show the slide-in strip as a group ---

function isMobileViewportForSlideIns() {
  if (window.matchMedia) {
    try {
      return window.matchMedia('(max-width: 768px)').matches;
    } catch {
      // ignore
    }
  }
  return window.innerWidth <= 768;
}

function updateMobileSlideInsToggle() {
  const slideIns    = document.getElementById('slide-ins');
  const collapseEl  = document.getElementById('mobile-slideins-collapse');
  const expandEl    = document.getElementById('mobile-slideins-expand');
  const workspaceOverlay = document.getElementById('workspace-overlay');

  if (!slideIns || !collapseEl || !expandEl) return;

  const isMobile = isMobileViewportForSlideIns();

  // ✅ Default on mobile: start with the strip collapsed (minimized) once per page load
  if (isMobile && slideIns.dataset.mobileDefaultCollapsed !== '1') {
    slideIns.classList.add('is-collapsed');

    // Also collapse individual panels so width math stays compact
    if (typeof collapseDiscoverSidebar === 'function') {
      collapseDiscoverSidebar();
    }

    slideIns.dataset.mobileDefaultCollapsed = '1';
  }

  const anyVisibleChild =
    slideIns.classList.contains('visible') &&
    !!slideIns.querySelector('.slide-in:not(.is-hidden)');

  if (!anyVisibleChild) {
    collapseEl.hidden = true;
    expandEl.hidden   = true;
  
    if (workspaceOverlay) {
      workspaceOverlay.classList.remove('is-visible');
    }
    return;
  }    

  const collapsed = slideIns.classList.contains('is-collapsed');
  collapseEl.hidden = collapsed;
  expandEl.hidden   = !collapsed;

  // Show overlay only on mobile when the strip is expanded (not collapsed)
  if (workspaceOverlay) {
    const shouldShowOverlay = isMobile && !collapsed;
    workspaceOverlay.classList.toggle('is-visible', shouldShowOverlay);    
  }
}

function initMobileSlideInsToggle() {
  const slideIns    = document.getElementById('slide-ins');
  const collapseEl  = document.getElementById('mobile-slideins-collapse');
  const expandEl    = document.getElementById('mobile-slideins-expand');

  if (!slideIns || !collapseEl || !expandEl) return;

  // Clicking the X: push the whole strip off-screen
  collapseEl.addEventListener('click', (e) => {
    e.preventDefault();
    if (!isMobileViewportForSlideIns()) return;

    slideIns.classList.add('is-collapsed');

    // Also collapse all individual panels so layout stays compact
    if (typeof collapseDiscoverSidebar === 'function') {
      collapseDiscoverSidebar();
    }

    updateMobileSlideInsToggle();
  });

  // Clicking the floating icon: bring the strip back
  expandEl.addEventListener('click', (e) => {
    e.preventDefault();
    slideIns.classList.remove('is-collapsed');
    updateMobileSlideInsToggle();
  });

  // Keep in sync with viewport changes
  const mq = window.matchMedia && window.matchMedia('(max-width: 768px)');
  if (mq) {
    if (mq.addEventListener) {
      mq.addEventListener('change', updateMobileSlideInsToggle);
    } else if (mq.addListener) {
      mq.addListener(updateMobileSlideInsToggle);
    }
  }

  window.addEventListener('resize', updateMobileSlideInsToggle);

  // Initial sync
  updateMobileSlideInsToggle();
}

// === GROUPED MODE: click any object -> open gallery; other modes unaffected ===
// DEBUG: log clicks on the grid; when grouped, log the object clicked
{
  const gridEl = document.getElementById('grid');
  const gridShellEl = document.getElementById('grid-shell');
  const groupGalleryEl = document.getElementById('group-gallery');
  const backBtnEl = document.getElementById('content-back-button');
  const detailEl = document.getElementById('detail-content'); // NEW

  // Keep group gallery scroll (the .scroll-container-horizontal) easy to reset from anywhere
  function resetGalleryScrollPositions() {
    try {
      // Outer horizontal scroller: #group-gallery.scroll-container-horizontal
      groupGalleryEl?.scrollTo({ left: 0, top: 0, behavior: 'auto' });

      // Inner box, just in case it ever becomes scrollable
      groupGalleryEl
        ?.querySelector('.gallery-box')
        ?.scrollTo?.({ left: 0, top: 0, behavior: 'auto' });
    } catch {}
  }

  function setGalleryPeopleLine(elId, names, { prefix = '' } = {}) {
    const el = document.getElementById(elId);
    if (!el) return;
  
    const list = Array.isArray(names)
      ? names
      : String(names || '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
  
    if (!list.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
  
    el.innerHTML =
      escapeHtml(prefix) +
      list
        .map(n => `<a href="#subpage-team" data-author-name="${escapeHtml(n)}">${escapeHtml(n)}</a>`)
        .join(', ');
  
    el.hidden = false;
  }
  
  function setGalleryAuthorsLine(names) {
    setGalleryPeopleLine('gallery-authors', names);
  }
  
  function setGalleryContributorsLine(names) {
    setGalleryPeopleLine('gallery-contributors', names, { prefix: 'with contributions of ' });
  }  

  // Optional: expose for other modules (detail re-entry)
  window.resetGroupGalleryScroll = resetGalleryScrollPositions;

  // Render the ad-hoc gallery title: one removable chip per tag (each with an "X").
  function renderAdhocGalleryTitle(tagsMaybe) {
    const tEl = document.querySelector('#group-gallery .title-box h2');
    const sEl = document.querySelector('#group-gallery .title-box h3');
    if (!tEl) return;

    // Normalize: accept array or Set
    const raw = (typeof tagsMaybe !== 'undefined') ? tagsMaybe : (window.activeTags || []);
    const tags = Array.isArray(raw) ? raw : (raw instanceof Set ? [...raw] : []);

    // Reset content
    tEl.innerHTML = '';

    tags.forEach((tag, index) => {
      const span = document.createElement('span');
      span.className = 'adhoc-title-tag';
      span.dataset.tag = tag;

      const label = document.createElement('span');
      label.className = 'adhoc-title-tag-label';
      label.textContent = tag;

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'adhoc-title-tag-close';
      close.setAttribute('aria-label', `Remove tag ${tag}`);
      close.textContent = '×';

      span.appendChild(label);
      span.appendChild(close);
      tEl.appendChild(span);

      // Line-break between tags
      if (index < tags.length - 1) {
        tEl.appendChild(document.createElement('br'));
      }
    });

    // No subtitle in ad-hoc gallery
    if (sEl) sEl.textContent = '';

    // NEW: shrink-to-fit when many tags would overflow the title box
    scheduleFitAdhocGalleryTitle();
  }

  // --- Ad-hoc title: auto shrink-to-fit (desktop + mobile) ---
  const ADHOC_TITLE_FIT = {
    minPx: 14,        // don’t go smaller than this (tweak if needed)
    precisionPx: 0.5, // font-size step precision
    maxIter: 18,
    safetyPx: 12      // breathing room so we don’t “just barely” fit
  };

  let __adhocFitInit = false;
  let __adhocFitRaf = 0;

  function scheduleFitAdhocGalleryTitle() {
    initAdhocTitleFitObservers();
    cancelAnimationFrame(__adhocFitRaf);
    __adhocFitRaf = requestAnimationFrame(fitAdhocGalleryTitleNow);
  }

  function initAdhocTitleFitObservers() {
    if (__adhocFitInit) return;
    __adhocFitInit = true;

    const titleBox = document.querySelector('#group-gallery .title-box');
    if (titleBox && 'ResizeObserver' in window) {
      const ro = new ResizeObserver(() => scheduleFitAdhocGalleryTitle());
      ro.observe(titleBox);
    }

    window.addEventListener('resize', scheduleFitAdhocGalleryTitle, { passive: true });
    window.addEventListener('orientationchange', scheduleFitAdhocGalleryTitle, { passive: true });

    // If the fixed selection bar slides in/out, the *visible* title area changes
    // even though .title-box keeps its full height. Re-fit when that happens.
    const sb = document.getElementById('selection-bar');
    if (sb && 'MutationObserver' in window) {
      const mo = new MutationObserver(() => scheduleFitAdhocGalleryTitle());
      mo.observe(sb, { attributes: true, attributeFilter: ['class', 'style'] });
    }
  }

  function fitAdhocGalleryTitleNow() {
    __adhocFitRaf = 0;

    // Only in the ad-hoc tags gallery
    if (!document.body.classList.contains('in-adhoc-gallery')) return;

    const gg = document.getElementById('group-gallery');
    if (!gg || !gg.classList.contains('active')) return;

    const tEl = gg.querySelector('.title-box h2');
    const titleBox = tEl?.closest('.title-box');
    if (!tEl || !titleBox) return;

    // Not visible? Don’t measure.
    if (titleBox.offsetParent === null) return;

    applyAdhocTitleBoxBottomInset(titleBox);

    // Reset first so it can also scale UP again when space becomes available
    tEl.style.fontSize = '';

    const basePx = parseFloat(getComputedStyle(tEl).fontSize) || 32;
    const minPx = Math.min(ADHOC_TITLE_FIT.minPx, basePx);

    const availablePx = computeAvailableTitleHeightPx(titleBox, tEl) - ADHOC_TITLE_FIT.safetyPx;
    if (availablePx <= 0) return;

    // If it already fits at base size, keep it
    if (tEl.scrollHeight <= availablePx) return;

    // If even min doesn’t fit, clamp to min
    tEl.style.fontSize = `${minPx}px`;
    if (tEl.scrollHeight > availablePx) return;

    // Binary search: find the largest font-size that still fits
    let lo = minPx;
    let hi = basePx;

    for (let i = 0; i < ADHOC_TITLE_FIT.maxIter && (hi - lo) > ADHOC_TITLE_FIT.precisionPx; i++) {
      const mid = (lo + hi) / 2;
      tEl.style.fontSize = `${mid}px`;

      if (tEl.scrollHeight <= availablePx) lo = mid;
      else hi = mid;
    }

    // Round to configured precision (e.g. 0.5px)
    const p = ADHOC_TITLE_FIT.precisionPx;
    const finalPx = Math.floor(lo / p) * p;
    tEl.style.fontSize = `${finalPx}px`;
  }

  function computeAvailableTitleHeightPx(titleBoxEl, titleEl) {
    const cs = getComputedStyle(titleBoxEl);
    const pt = parseFloat(cs.paddingTop) || 0;
    const pb = parseFloat(cs.paddingBottom) || 0;
  
    // Height available for content INSIDE padding
    const contentBoxH = titleBoxEl.clientHeight - pt - pb;
  
    // Reserve vertical space taken by other title-box children (e.g. Explore button, subtitle)
    let reserved = 0;
    for (const child of titleBoxEl.children) {
      if (child === titleEl) continue;
      if (child.offsetParent === null) continue;
      if (child.tagName === 'H3' && !child.textContent.trim()) continue;
      reserved += outerHeightPx(child);
    }
  
    return contentBoxH - reserved;
  }  

  function applyAdhocTitleBoxBottomInset(titleBoxEl) {
    // Default: no inset
    let inset = 0;
  
    const bar = document.getElementById('selection-bar');
    const barShown = bar && bar.classList.contains('show');
  
    if (barShown) {
      const barH = Math.ceil(bar.getBoundingClientRect().height || 0);
  
      // You asked to also account for the 60px "top margin" spacing.
      // Make it robust: try to read it from the Explore button’s computed margin-top.
      const exploreBtn = titleBoxEl.querySelector('#scroll-on.button');
      const extraGap =
        exploreBtn ? (parseFloat(getComputedStyle(exploreBtn).marginTop) || 60) : 60;
  
      inset = barH + Math.ceil(extraGap);
    }
  
    titleBoxEl.style.setProperty('--titlebox-bottom-inset', `${inset}px`);
  }  

  function outerHeightPx(el) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const mt = parseFloat(s.marginTop) || 0;
    const mb = parseFloat(s.marginBottom) || 0;
    return r.height + mt + mb;
  }

  // DRAG-TO-CLICK GUARD (grouped mode)
  // Tracks pointer movement; if movement > 6px when releasing, we mark the last interaction as a drag.
  // The click handler will ignore the very next click in grouped mode.
  let __down = null;
  let __lastDragAt = 0;
  const __SLOP2 = 6 * 6; // squared px threshold

  gridEl.addEventListener('pointerdown', (e) => {
    __down = { x: e.clientX, y: e.clientY, moved: false };
  }, true);

  gridEl.addEventListener('pointermove', (e) => {
    if (!__down) return;
    const dx = e.clientX - __down.x;
    const dy = e.clientY - __down.y;
    if ((dx * dx + dy * dy) > __SLOP2) __down.moved = true;
  }, true);

  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => {
    gridEl.addEventListener(type, () => {
      if (__down?.moved) __lastDragAt = performance.now();
      __down = null;
    }, true);
  });

  function openGallery(gid) {
    if (!groupGalleryEl) {
      console.warn('[gallery] #group-gallery not found');
      return;
    }
  
    // Hide the grid shell, then show gallery
    if (gridShellEl) gridShellEl.style.display = 'none';
    groupGalleryEl.classList.add('active');

    resetGalleryScrollPositions();
  
    // 1) Title + subtitle for this group
    if (gid && window.groupMetaById) {
      const meta = window.groupMetaById[gid];
      if (meta) {
        const tEl = document.querySelector('#group-gallery .title-box h2');
        const sEl = document.querySelector('#group-gallery .title-box h3');
        if (tEl) {
          tEl.style.fontSize = '';     // NEW: reset shrink-to-fit
          tEl.textContent = meta.title;
        }
        if (sEl) sEl.textContent = meta.subtitle;
        setGalleryAuthorsLine(meta.authors);
        setGalleryContributorsLine(meta.contributors);

        // Location chip (top-right, like detail page)
        const locChip = document.getElementById('gallery-location-chip');
        if (locChip) {
          const loc = meta.location || '';
          locChip.textContent = loc;
          locChip.hidden = !loc;
        }

      }      
    }

    // Keep the 3 content sidebars in sync with this group
    if (typeof updateContentSidebarsForGroup === 'function') {
      updateContentSidebarsForGroup(gid);
    }
  
    // 2) Build the gallery items (columns + mixed .item nodes for this group)
    if (typeof window.renderGroupGallery === 'function') {
      window.renderGroupGallery(gid);  // creates columns and appends items
    }
  
    // 3) Bind fade-ins, counters, WaveSurfer (IO attaches to what's in the DOM now)
    window.__galleryIO__?.onOpen?.();
    window.__galleryVideos__?.onOpen?.();
    //window.__galleryImages__?.onOpen?.();
  
    // 4) Push a history state so browser Back closes the gallery
    try {
      if (!history.state || !history.state.gallery) {
        history.pushState({ gallery: true, gid: String(gid ?? '') }, '', appUrl('#group-gallery'));
      }
    } catch {}
  
    refreshSlideInsVisibility();

    document.body.classList.add('in-group-gallery');      // was: in-gallery
    document.body.dataset.currentGroupId = String(gid);
    window.__dispatchViewChange();

    console.log('[gallery] opened', { gid });
  }

  window.openGroupGallery = openGallery;

  // Open group gallery unless the group only contains 1 object → open that object's detail directly.
  window.openGroupEntry = function (gid, { from = 'menu' } = {}) {
    if (gid == null) return false;

    const allObjects = (window.gridObject?.objects || window.objects || []);
    // If data is not ready, fall back to gallery
    if (!Array.isArray(allObjects) || allObjects.length === 0) {
      window.openGroupGallery?.(gid);
      return true;
    }

    const members = allObjects.filter(o => String(o.groupId) === String(gid));

    if (members.length === 1 && typeof window.openObjectDetail === 'function') {
      const only = members[0];
      window.openObjectDetail({ objectId: only.id, from, gid });
      return true;
    }

    window.openGroupGallery?.(gid);
    return true;
  };

  // === Simple text page (Research Project) ===
  (function simpleTextPage() {
    const gridShellEl    = document.getElementById('grid-shell');
    const groupGalleryEl = document.getElementById('group-gallery');
    const detailEl       = document.getElementById('detail-content');
    const pageEl         = document.getElementById('research-page');

    function hideAllMainViews() {
      if (gridShellEl) gridShellEl.style.display = 'none';
      groupGalleryEl?.classList.remove('active');
      detailEl?.classList.remove('active');
    }
    function showGrid() {
      if (gridShellEl) gridShellEl.style.display = '';
    }

    window.openResearchPage = function() {
      if (!pageEl) return;
      hideAllMainViews();
      pageEl.classList.add('active');
      try {
        if (!history.state || !history.state.research) {
          history.pushState({ research: true }, '', appUrl('#research'));
        }
      } catch {}
      window.__dispatchViewChange?.();
    };

    window.closeResearchPage = function() {
      pageEl?.classList.remove('active');
      showGrid();
      window.__dispatchViewChange?.();
    };

    // If user hits BACK after we pushed #research, close the page
    window.addEventListener('popstate', () => {
      const isResearchActive = pageEl?.classList.contains('active');
      const stillOnResearch  = !!history.state?.research;

      // Only when we were actually on the research page and left its state
      if (isResearchActive && !stillOnResearch) {
        pageEl?.classList.remove('active');
        showGrid();
        window.__dispatchViewChange?.();
      }
    });
  })();

  // Open gallery for a custom set of objects (e.g., current tag filter)
  window.openTagsGallery = function(objs = [], titleLines = []) {
    if (!groupGalleryEl) return;

    // Hide the grid shell, show gallery
    if (gridShellEl) gridShellEl.style.display = 'none';
    groupGalleryEl.classList.add('active');

    resetGalleryScrollPositions();

    // Title: one removable chip per tag; no group subtitle
    if (typeof renderAdhocGalleryTitle === 'function') {
      renderAdhocGalleryTitle(titleLines);
    }

    // Fresh content
    const box = groupGalleryEl.querySelector('.gallery-box');
    if (box) box.innerHTML = '';

    // Build items/columns from the provided list
    if (typeof window.renderAdhocGallery === 'function') {
      window.renderAdhocGallery(objs);
    }

    // Attach observers and push a gallery history state
    window.__galleryIO__?.onOpen?.();
    window.__galleryVideos__?.onOpen?.();
    //window.__galleryImages__?.onOpen?.();
    try {
      if (!history.state || !history.state.gallery) {
        history.pushState({ gallery: true, adhoc: true }, '', appUrl('#group-gallery'));
      }
    } catch {}

    refreshSlideInsVisibility();
    collapseDiscoverSidebar?.();

    document.body.classList.add('in-gallery', 'in-adhoc-gallery');   // mark ad-hoc mode
    window.__dispatchViewChange();
    if (typeof window.renderSelectionBar === 'function') {
      window.renderSelectionBar();                     // keep the bar visible, but no button
    }
  
    const bar = document.getElementById('selection-bar');      // NEW
    const ws  = document.getElementById('workspace');          // NEW

    console.log('[gallery] opened (adhoc)', { count: objs.length, titleLines });
  };

  // Open gallery for a single theme (objects linked to that theme)
  window.openThemeGallery = function(themeOrId, options = {}) {
    if (!groupGalleryEl) return;

    // Resolve the theme object
    let theme = themeOrId;
    if (!theme || typeof theme !== 'object') {
      if (typeof window.findThemeById === 'function') {
        theme = window.findThemeById(themeOrId);
      }
    }
    if (!theme) {
      console.warn('[theme-gallery] no theme found for', themeOrId);
      return;
    }

    // Determine where we are coming from: detail page vs grid
    const detailEl = document.getElementById('detail-content');
    const cameFromDetail =
      document.body.classList.contains('in-detail-page') ||
      !!detailEl?.classList.contains('active');

    document.body.dataset.themeGalleryOrigin = cameFromDetail ? 'detail' : 'grid';

    // Get objects for this theme (allow override via options.objects)
    let objs = options.objects;
    if (!Array.isArray(objs) && typeof window.objectsMatchingTheme === 'function') {
      objs = window.objectsMatchingTheme(theme);
    }
    objs = Array.isArray(objs) ? objs : [];

    // Hide the grid shell, show gallery
    if (gridShellEl) gridShellEl.style.display = 'none';
    groupGalleryEl.classList.add('active');

    resetGalleryScrollPositions();

    // Title: theme name (no subtitle)
    const tEl = document.querySelector('#group-gallery .title-box h2');
    const sEl = document.querySelector('#group-gallery .title-box h3');
    if (tEl) tEl.textContent = theme.title || theme.name || '';
    if (sEl) sEl.textContent = '';
    setGalleryAuthorsLine([]);
    setGalleryContributorsLine([]);

    // Fresh content
    const box = groupGalleryEl.querySelector('.gallery-box');
    if (box) box.innerHTML = '';

    // Reuse same renderer as for the tag-based ad-hoc gallery
    if (typeof window.renderAdhocGallery === 'function') {
      window.renderAdhocGallery(objs);
    }

    // Attach observers and push a gallery history state
    window.__galleryIO__?.onOpen?.();
    window.__galleryVideos__?.onOpen?.();
    window.__galleryImages__?.onOpen?.();
    try {
      if (!history.state || !history.state.gallery) {
        history.pushState(
          { gallery: true, themeId: String(theme.id ?? ''), themeGallery: true },
          '',
          '#group-gallery'
        );
      }
    } catch {}

    // Mark body so selection bar + slide-ins can adapt
    document.body.classList.add('in-group-gallery', 'in-theme-gallery');

    // Sync header / other view-dependent UI
    window.__dispatchViewChange?.();
    if (typeof window.renderSelectionBar === 'function') {
      window.renderSelectionBar();
    }

    refreshSlideInsVisibility();

    console.log('[gallery] opened (theme)', {
      themeId: theme.id,
      count: objs.length
    });
  };

  // Refresh the current ad-hoc gallery from the *current* tag selection
  window.refreshAdhocGalleryFromTags = function(tagsMaybe) {
    const gg = document.getElementById('group-gallery');
    const isActive = gg?.classList.contains('active');
    // Treat as ad-hoc if we either set a body class or pushed adhoc state
    const isAdhoc = !!(history.state && history.state.adhoc) || document.body.classList.contains('in-adhoc-gallery');
    if (!isActive || !isAdhoc) return;

    // Normalize tags to an array
    const raw = (typeof tagsMaybe !== 'undefined') ? tagsMaybe : (window.activeTags || []);
    const tags = Array.isArray(raw) ? raw : (raw instanceof Set ? [...raw] : []);

    // 1) Update the title chips from the current tags (no subtitle)
    if (typeof renderAdhocGalleryTitle === 'function') {
      renderAdhocGalleryTitle(tags);
    }

    // 2) Recompute which objects match the current filter and re-render
    const objs = objectsMatchingCurrentFilter();          // you already have this helper
    const box = gg.querySelector('.gallery-box');
    if (box) box.innerHTML = '';
    if (typeof window.renderAdhocGallery === 'function') {
      window.renderAdhocGallery(objs);                    // reuse your gallery item builder
    }

    // 3) Re-attach observers (same as openTagsGallery did)
    window.__galleryIO__?.onOpen?.();
    window.__galleryVideos__?.onOpen?.();
    //window.__galleryImages__?.onOpen?.();
  };

  // Allow removing tags directly from the ad-hoc gallery title (X on each tag).
  const adhocTitleEl = document.querySelector('#group-gallery .title-box h2');
  if (adhocTitleEl) {
    adhocTitleEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.adhoc-title-tag');
      if (!chip) return;

      const tag = chip.dataset.tag;
      if (!tag) return;

      // Remove this tag from global selection and, if it was the last one, close the gallery
      if (typeof window.deselectTagGlobally === 'function') {
        window.deselectTagGlobally(tag, { closeGalleryWhenEmpty: true });
      }
    });
  }
  
  function closeGallery(options = {}) {
    const viaPopstate = !!options.viaPopstate;
  
    // Reset scroll positions (shared with detail re-entry)
    resetGalleryScrollPositions();

    // NEW: clear any ad-hoc title resizing when leaving the gallery
    const tEl = groupGalleryEl?.querySelector('.title-box h2');
    if (tEl) tEl.style.fontSize = '';
  
    // Detach gallery observers / media behaviors
    window.__galleryIO__?.onClose?.();
    window.__galleryVideos__?.onClose?.();
    //window.__galleryImages__?.onClose?.();
  
    // Clear gallery DOM
    const box = groupGalleryEl?.querySelector('.gallery-box');
    if (box) box.innerHTML = '';
  
    // Hide gallery, show grid again
    groupGalleryEl?.classList.remove('active');
    if (gridShellEl) gridShellEl.style.display = '';
  
    // Remove all gallery-mode markers in one go
    document.body.classList.remove(
      'in-group-gallery',
      'in-adhoc-gallery',
      'in-gallery',
      'in-theme-gallery'
    );
    delete document.body.dataset.currentGroupId;

    // NEW: if this gallery was opened from a detail page,
    // keep us in detail and make sure the grid stays hidden.
    const origin = document.body.dataset.themeGalleryOrigin || null;
    delete document.body.dataset.themeGalleryOrigin;

    if (origin === 'detail') {
      // Ensure grid shell is NOT shown
      if (gridShellEl) {
        gridShellEl.style.display = 'none';
      }
      // Ensure detail page stays fully active
      if (detailEl) {
        detailEl.classList.add('active');
      }
      document.body.classList.add('in-detail-page');
    }
  
    // If we are closing WITHOUT browser back, clear gallery/adhoc history flags
    if (!viaPopstate && history.state?.gallery) {
      try {
        const nextState = { ...(history.state || {}) };
        delete nextState.gallery;
        delete nextState.adhoc;
        delete nextState.gid;
  
        let newHash = location.hash;
        if (newHash === '#group-gallery' || newHash === '#gallery') newHash = '';
  
        history.replaceState(nextState, '', appUrl(newHash || ''));
      } catch {}
    }
  
    // Update global view + selection bar once, after state is clean
    requestAnimationFrame(() => {
      window.applyVisitedMarkers?.();        // ✅ repaint visited dots immediately
      window.gridObject?._refitAllText?.();  // keep text sizing correct after re-show
      window.__dispatchViewChange?.();
      window.renderSelectionBar?.();
    });
  
    refreshSlideInsVisibility();
  
    console.log('[gallery] closed');
  }  
  
  window.closeGallery = closeGallery;

  // === Object Detail screen (full page) ===
  (function detailScreen() {
    const gridShellEl    = document.getElementById('grid-shell');
    const groupGalleryEl = document.getElementById('group-gallery');
    const detailEl       = document.getElementById('detail-content');

    function isInDetailView() {
      return document.body.classList.contains('in-detail-page') ||
             !!detailEl?.classList.contains('active');
    }
  
    function resetDetailScroll() {
      if (!detailEl) return;

      // Prefer the inner vertical-content (actual scrolling area in detail page)
      const vc = detailEl.querySelector('.vertical-content');
      if (vc) {
        try {
          vc.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        } catch {
          vc.scrollTop = 0;
          vc.scrollLeft = 0;
        }
      }

      // Also reset the outer container just in case
      try {
        detailEl.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      } catch {
        detailEl.scrollTop = 0;
        detailEl.scrollLeft = 0;
      }
    }

    // --- detail-page prev/next UI (inside vertical-content) ---
    function attachDetailNavUI() {
      const vc = detailEl?.querySelector('.vertical-content');
      if (!vc || vc.querySelector('.detail-nav-arrows')) return; // already added

      const wrap = document.createElement('div');
      wrap.className = 'detail-nav-arrows';
      wrap.innerHTML = `
      <div class="detail-nav-arrow prev" role="button" tabindex="0" aria-label="Previous object" data-cursor-label="previous item"></div>
      <div class="detail-nav-arrow next" role="button" tabindex="0" aria-label="Next object" data-cursor-label="next item"></div>
    `;    
      // put arrows at the top *inside* vertical-content
      vc.prepend(wrap);

      // wire the buttons
      wrap.querySelector('.detail-nav-arrow.prev')
          ?.addEventListener('click', () => { if (typeof window.stepDetail === 'function') window.stepDetail(-1); });
      wrap.querySelector('.detail-nav-arrow.next')
          ?.addEventListener('click', () => { if (typeof window.stepDetail === 'function') window.stepDetail(+1); });
    }

    // Ensure the arrows exist as soon as the detail module initializes
    attachDetailNavUI();


    let __detailWave = null;
    function destroyDetailWave() {
      try { __detailWave?.destroy(); } catch {}
      __detailWave = null;
    }

    // Decide orientation and add a class to the figure: 'landscape' | 'portrait'
    function setMediaOrientation(figureEl, kind, el) {
      function apply(w, h) {
        if (!figureEl) return;
        figureEl.classList.remove('landscape', 'portrait');
        figureEl.classList.add((w >= h) ? 'landscape' : 'portrait');
      }
      if (kind === 'image') {
        const img = el;
        if (img.naturalWidth && img.naturalHeight) {
          apply(img.naturalWidth, img.naturalHeight);
        } else {
          img.addEventListener('load', () => apply(img.naturalWidth, img.naturalHeight), { once: true });
        }
      } else if (kind === 'video') {
        const vid = el;
        if (vid.videoWidth && vid.videoHeight) {
          apply(vid.videoWidth, vid.videoHeight);
        } else {
          vid.addEventListener('loadedmetadata', () => apply(vid.videoWidth, vid.videoHeight), { once: true });
        }
      }
    }

    // Move topics + table between columns; #detail-primary always stays LEFT
    function setDetailBlocksColumn(type) {
      if (!detailEl) return;

      const section = detailEl.querySelector('.content-section.multi-column .section-content');
      if (!section) return;

      const left  = section.querySelector(':scope > .left');
      const right = section.querySelector(':scope > .right');
      if (!left || !right) return;

      const primary = section.querySelector('#detail-primary');   // stays in LEFT
      const topics  = section.querySelector('ul.topics');
      const table   = section.querySelector('.flex-table');

      const nodes = [topics, table].filter(Boolean);
      if (!nodes.length) return;

      const insertAtTop = (parent, items) => {
        const frag = document.createDocumentFragment();
        items.forEach(n => frag.appendChild(n));
        parent.insertBefore(frag, parent.firstChild || null);
      };

      const insertAfter = (ref, parent, items) => {
        const frag = document.createDocumentFragment();
        items.forEach(n => frag.appendChild(n));
        if (ref && ref.parentNode === parent) {
          parent.insertBefore(frag, ref.nextSibling);
        } else {
          parent.insertBefore(frag, parent.firstChild || null);
        }
      };

      const isMedia = ['image', 'video', 'audio'].includes(String(type));

      if (isMedia) {
        // MEDIA: topics + table go to TOP of RIGHT
        insertAtTop(right, nodes);
      } else {
        // NON-MEDIA: topics + table go back to LEFT, right after #detail-primary
        insertAfter(primary, left, nodes);
      }
    }

    function updateTtsControl(obj) {
      const btn = document.getElementById('content-tts-button');
      if (!btn) return;
    
      // stop any previous TTS when switching objects
      stopTtsAudio();
    
      const hasTts = obj?.type === 'text' && obj.textToSpeech;
      if (hasTts) {
        btn.hidden = false;
        btn.dataset.src = obj.textToSpeech;
      } else {
        btn.hidden = true;
        btn.dataset.src = '';
      }
    }    

    // Detail-page hero image: prefer a specific Strapi format.
    // Keep grid/inline detail thumbnails unchanged (those use obj.image elsewhere).
    const DETAIL_HERO_IMAGE_FORMAT = 'medium';

    function getDetailHeroImageUrl(obj) {
      // 1) Prefer resolved upload meta (available when ImagePath was used)
      const formats = obj?._imageMeta?.formats || null;

      const preferred =
        formats?.[DETAIL_HERO_IMAGE_FORMAT]?.url ||
        null;

      if (preferred) return preferred;

      // 2) Fallback order (still from formats if present)
      const fallback =
        formats?.small?.url ||
        formats?.thumbnail?.url ||
        obj?._imageMeta?.url ||
        obj?.image || // last resort (often thumbnail today)
        '';

      return fallback;
    }

    // Render ONLY the primary slot (title or hero media) in the detail view
    function renderDetailPrimary(obj) {
      if (!detailEl || !obj) return;

      // Update location in the header (safe to do each time)
      const locEl = detailEl.querySelector('.content-header .location');
      if (locEl) locEl.textContent = obj.groupLocation || '';

      // Work only inside the primary slot
      const slot = detailEl.querySelector('#detail-primary');
      if (!slot) return;

      // basic escape
      const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

      // Replace the slot content according to object type
      updateTtsControl(obj);

      // Replace the slot content according to object type
      switch (obj.type) {
        case 'image': {
          const heroUrl = getDetailHeroImageUrl(obj);
        
          slot.innerHTML = heroUrl
            ? `<figure class="detail-media image">
                 <img class="hero-media" src="${esc(heroUrl)}" alt="${esc(obj.text || 'Image')}">
               </figure>`
            : `<h1>${esc(obj.text || 'Untitled image')}</h1>`;
        
          const fig = slot.querySelector('figure.detail-media.image');
          const img = fig?.querySelector('img.hero-media');
          if (fig && img) setMediaOrientation(fig, 'image', img);
          break;
        }        

        case 'video': {
          slot.innerHTML = obj.video
            ? `<figure class="detail-media video">
                 <video class="hero-media" controls playsinline preload="metadata">
                   <source src="${esc(obj.video)}">
                 </video>
               </figure>`
            : `<h1>${esc(obj.text || 'Untitled video')}</h1>`;
          const fig = slot.querySelector('figure.detail-media.video');
          const vid = fig?.querySelector('video.hero-media');
          if (fig && vid) setMediaOrientation(fig, 'video', vid);
          break;
        }

        case 'audio': {
          const src = obj.audio;
          if (!src) {
            slot.innerHTML = `<h1>${esc(obj.text || 'Untitled audio')}</h1>`;
            break;
          }
        
          // ensure previous detail waveform is gone
          destroyDetailWave();
        
          // render just a container for WaveSurfer (no native controls)
          const id = `detail-wave-${obj.id || 'x'}`;
          slot.innerHTML = `
            <figure class="detail-media audio">
              <div id="${id}" class="wave" aria-label="Waveform"></div>
            </figure>
          `;
        
          // create the waveform
          __detailWave = createWave(`#${id}`, src, { height: 70 });
        
          // same behavior as gallery: click toggles, hover plays, leave pauses
          const container = slot.querySelector(`#${id}`);
          container?.addEventListener('click', () => __detailWave?.playPause());
          container?.addEventListener('mouseenter', () => { try { __detailWave?.play(); } catch {} }, { passive: true });
          container?.addEventListener('mouseleave', () => { try { __detailWave?.pause(); } catch {} }, { passive: true });
        
          break;
        }          

        case 'text':
        default: {
          slot.innerHTML = `<h1>${esc(obj.text || 'Untitled')}</h1>`;
          break;
        }
      }

      // After rendering the primary slot, position the blocks as requested
      setDetailBlocksColumn(obj.type);

      // --- Update Topics & Lower Tags (topics = regular tags, lower = connecting tags)
      try {
        const esc = s => String(s ?? '')
          .replace(/&/g,'&amp;')
          .replace(/</g,'&lt;')
          .replace(/>/g,'&gt;');

        // Small helper so we don’t duplicate the mapping logic
        const renderTagList = (selector, source) => {
          const host = detailEl.querySelector(selector);
          if (!host) return;
          const list = Array.isArray(source) ? source : [];
          const uniq = Array.from(new Set(list));
          host.innerHTML = uniq.map(t => `<li>${esc(t)}</li>`).join('');
        };

        // Topics (top row) still use regular tags
        renderTagList('#topics-list', obj.tags);

        // Content-section tags now use CONNECTING TAGS
        renderTagList('#detail-tags-lower', obj.connectingTags);

        // Make lower connecting tags clickable to jump back into clustered view + open adhoc panel
        const lowerHost = detailEl.querySelector('#detail-tags-lower');
        if (lowerHost && !lowerHost.dataset.clickWired) {
          lowerHost.dataset.clickWired = '1';

          lowerHost.addEventListener('click', (e) => {
            const li = e.target.closest('li');
            if (!li) return;

            e.preventDefault();
            e.stopPropagation();

            const tag = li.textContent.trim();
            if (!tag) return;

            // 1) Update active tags using existing "detail tag" semantics
            if (typeof window.reseedTagsFromDetail === 'function') {
              window.reseedTagsFromDetail(tag);
            } else if (typeof reseedTagsFromDetail === 'function') {
              reseedTagsFromDetail(tag);
            } else if (typeof window.toggleTagFromDetail === 'function') {
              window.toggleTagFromDetail(tag);
            }

            // 2) If a gallery is open, close it AND prevent detail-close from restoring it
            const galleryActive =
              document.body.classList.contains('in-group-gallery') ||
              document.body.classList.contains('in-adhoc-gallery') ||
              document.body.classList.contains('in-gallery') ||
              document.getElementById('group-gallery')?.classList.contains('active');

            if (galleryActive && typeof window.closeGallery === 'function') {
              try { window.closeGallery(); } catch {}
            }

            // closeObjectDetail() will re-open gallery if __detailCtx.from === 'gallery'
            // so force it to behave like a grid return for this flow.
            if (window.__detailCtx && window.__detailCtx.from === 'gallery') {
              window.__detailCtx.from = 'grid';
            }

            // 3) Close the full-page detail now
            // (so restoreGridStateFromDetail doesn't override our next step)
            window.closeObjectDetail?.();

            // 4) Force clustered view on the grid (use the real method)
            const grid = window.gridObject;
            if (grid) {
              if (typeof grid.exitDetail === 'function') {
                try { grid.exitDetail(); } catch {}
              }

              if (grid.currentState !== 'clustered' && typeof grid.clusterGroupedObjects === 'function') {
                grid.clusterGroupedObjects();
              }

              if (typeof markActive === 'function') markActive('cluster');
              if (typeof refreshSlideInsVisibility === 'function') refreshSlideInsVisibility();

              // Re-open inline clustered detail for the CURRENT detail object
              let focusId = window.__detailCtx?.objectId || null;

              // Fallback: use current detail nav state if available
              if (!focusId && window.__detailNav && Array.isArray(window.__detailNav.order)) {
                const idx = (typeof window.__detailNav.index === 'number')
                  ? window.__detailNav.index
                  : 0;
                focusId = window.__detailNav.order[idx] || window.__detailNav.order[0] || null;
              }

              if (focusId && typeof grid.enterClusterDetail === 'function') {
                setTimeout(() => {
                  try { grid.enterClusterDetail(String(focusId)); } catch {}
                }, 560);
              }
            }
          });
        }

      } catch {}


      // --- Update the flex-table (Research / Researcher / Date)
      try {
        const table = detailEl.querySelector('.flex-table');
        if (!table) return;

        // Normalize visible labels and attach stable keys so JS does not depend on wording
        // Visible label for the "researcher" row depends on object type
        const getResearcherLabel = (type) => {
          switch (String(type)) {
            case 'text':  return 'Author';
            case 'audio':
            case 'video': return 'Creator';
            case 'image': return 'Photographer';
            default:      return 'Author';
          }
        };

        const LABEL_RENAMES = {
          'research':   { key: 'research',   text: 'Project' },
          'researcher': { key: 'researcher', text: getResearcherLabel(obj.type) },
        };

        Array.from(table.querySelectorAll('.row')).forEach(row => {
          const labelEl = row.querySelector('.label');
          if (!labelEl) return;
          const current = labelEl.textContent?.trim().toLowerCase();
          const stableKey = (labelEl.dataset.labelKey || current || '').toLowerCase();
          const cfg = LABEL_RENAMES[stableKey];          
          if (!cfg) return;

          // Change what the user sees
          labelEl.textContent = cfg.text;

          // Attach a stable key for JS lookups
          if (!labelEl.dataset.labelKey) {
            labelEl.dataset.labelKey = cfg.key;
          }
        });

        // supports either plain text OR html for a row; returns the value element
        const setRow = (label, value, opts = {}) => {
          const labelKey = String(label || '').toLowerCase();

          const row = Array.from(table.querySelectorAll('.row')).find(r => {
            const labelEl = r.querySelector('.label');
            if (!labelEl) return false;

            // Prefer the explicit key if present
            const keyAttr = labelEl.dataset.labelKey?.trim().toLowerCase();
            if (keyAttr) {
              return keyAttr === labelKey;
            }

            // Fallback: match by visible text (for 'date' etc.)
            const txt = labelEl.textContent?.trim().toLowerCase();
            return txt === labelKey;
          });

          if (!row) return null;

          const valEl = row.querySelector('.value');
          if (!valEl) return null;

          if (opts.html != null) {
            valEl.innerHTML = opts.html;
          } else {
            valEl.textContent = value || '';
          }

          return valEl;
        };

        // Research ← group's Title (link to group gallery if group has >1 object)
        if (obj.groupTitle && obj.groupId != null && obj.groupId !== '') {
          const groupCount = getGroupObjects(obj.groupId).length;
          const shouldLink = groupCount > 1;

          if (shouldLink) {
            const html = `<a href="#" class="research-link" data-gid="${esc(obj.groupId)}">${esc(obj.groupTitle)}</a>`;
            const researchEl = setRow('research', obj.groupTitle, { html });

            if (researchEl) {
              // overwrite any previous handler to avoid stacking
              researchEl.onclick = (ev) => {
                const a = ev.target.closest('.research-link');
                if (!a) return;
                ev.preventDefault();
                ev.stopPropagation();

                const gid = a.dataset.gid;
                openGroupGalleryFromDetail(gid);
              };
            }
          } else {
            // Single-object group: show plain text, no click
            const researchEl = setRow('research', obj.groupTitle || '');
            if (researchEl) researchEl.onclick = null;
          }
        } else {
          const researchEl = setRow('research', obj.groupTitle || '');
          if (researchEl) researchEl.onclick = null;
        }

        // Researcher ← Author relation's Name(s) as clickable link(s)
        let authorStr = obj.author || '';

        // QUICK ONE-OFF: add a second author for a specific object
        // Replace '123' with your actual object id from Strapi
        // and 'Second Author Name' with the real name you want to add.
        if (String(obj.id) === 'sobj_3951') {
          const extraAuthor = 'Julia Hornberger';
          authorStr = authorStr
            ? `${authorStr}, ${extraAuthor}`
            : extraAuthor;
        }

        const names = authorStr.split(',').map(s => s.trim()).filter(Boolean);

        if (names.length) {
          const html = names
            .map(n => `<a href="#" class="researcher-link" data-author-name="${esc(n)}">${esc(n)}</a>`)
            .join(', ');

          const researcherEl = setRow('researcher', authorStr, { html });

          if (researcherEl) {
            // overwrite any previous handler to avoid stacking
            researcherEl.onclick = (ev) => {
              const a = ev.target.closest('.researcher-link');
              if (!a) return;
              handleAuthorLinkClick(ev, a);
            };
          }        
        } else {
          setRow('researcher', authorStr);
        }


        // Date ← object's Date (pretty DD/MM/YYYY when parseable)
        const fmtDate = (s) => {
          if (!s) return '';
          const d = new Date(s);
          if (isNaN(d)) return String(s);
          const dd = String(d.getDate()).padStart(2, '0');
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const yy = d.getFullYear();
          return `${dd}/${mm}/${yy}`;
        };
        setRow('date', fmtDate(obj.date));
      } catch {}

      // --- Right column dynamic content (Text → Content, Media → Description as H1)
      try {
        const section = detailEl.querySelector('.content-section.multi-column .section-content');
        const right   = section?.querySelector(':scope > .right');
        if (!right) return;

        // Always remove any previous media Description block;
        // we only show it for media objects.
        right.querySelector('.detail-description-block')?.remove();

        // Ensure a dedicated wrapper so content is fully replaced per object
        let dyn = right.querySelector('#detail-right');
        if (!dyn) {
          dyn = document.createElement('div');
          dyn.id = 'detail-right';
          right.insertBefore(dyn, right.firstChild || null);
        }

        // Wipe previous dynamic content
        dyn.innerHTML = '';

        // Helpers
        const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const isHTMLString = (s) => (typeof s === 'string') && /<\/?[a-z][\s\S]*>/i.test(s);

        function extractText(val) {
          if (val == null) return '';
          if (typeof val === 'string') return val;
          if (Array.isArray(val)) return val.map(extractText).filter(Boolean).join('\n\n');
          if (typeof val === 'object') {
            if (typeof val.text === 'string') return val.text;
            if (Array.isArray(val.children)) return val.children.map(extractText).join('');
            if (Array.isArray(val.content))  return val.content.map(extractText).join('');
            if (val.title) return extractText(val.title);
            if (val.name)  return extractText(val.name);
            return Object.values(val).map(extractText).filter(Boolean).join(' ');
          }
          return String(val);
        }

        function richToHTML(val) {
          // 1) If it's already an HTML string, keep it as-is
          if (typeof val === 'string' && isHTMLString(val)) {
            return val;
          }
          // 2) Otherwise, reuse the global helper that also understands Strapi blocks
          return toParagraphHtml(val);
        }        

        if (obj.type === 'text') {
          // TEXT → Content + InlineContentImage + Content2 (+ FootNotes)
          const parts = [];

          // 1) Main Content (existing)
          const contentHtml = richToHTML(obj.content);
          if (contentHtml) parts.push(contentHtml);

          // 2) Inline content image (optional)
          if (obj.inlineContentImage) {
            const imgUrl = esc(obj.inlineContentImage);
            parts.push(
              `<figure class="detail-inline-image">
                 <img src="${imgUrl}" alt="">
               </figure>`
            );
          }

          // 3) Second rich text field
          const content2Html = richToHTML(obj.content2);
          if (content2Html) parts.push(content2Html);

          // 4) FootNotes (optional, rendered last in .detail-content)
          const footNotesHtml = richToHTML(
            obj.footNotes ?? obj.footnotes ?? obj.foot_notes
          );
          if (footNotesHtml) {
            parts.push(
              `<div class="detail-footnotes">
                 ${footNotesHtml}
               </div>`
            );
          }

          const html = parts.join('\n');

          if (html) {
            const wrap = document.createElement('div');
            wrap.className = 'detail-content';
            wrap.innerHTML = html;
            dyn.appendChild(wrap);
          }
        } else {
          // MEDIA → Add a Description section BELOW the flex-table
          const section = detailEl.querySelector('.content-section.multi-column .section-content');
          const right   = section?.querySelector(':scope > .right');
          if (!right) return;
        
          // Clean any previous media description block
          right.querySelector('.detail-description-block')?.remove();
        
          // Serialize description safely
          const extractText = (val) => {
            if (val == null) return '';
            if (typeof val === 'string') return val;
            if (Array.isArray(val)) return val.map(extractText).filter(Boolean).join('\n\n');
            if (typeof val === 'object') {
              if (typeof val.text === 'string') return val.text;
              if (Array.isArray(val.children)) return val.children.map(extractText).join('');
              if (Array.isArray(val.content))  return val.content.map(extractText).join('');
              if (val.title) return extractText(val.title);
              if (val.name)  return extractText(val.name);
              return Object.values(val).map(extractText).filter(Boolean).join(' ');
            }
            return String(val);
          };
          const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        
          const descText = extractText(obj.description).trim();
          if (!descText) {
            // Nothing to render
            return;
          }
        
          // Build the new block: <section><h3>Description</h3><p>…</p></section>
          const block = document.createElement('section');
          block.className = 'detail-description-block';
          block.innerHTML = `
            <h3>Description</h3>
            <p>${esc(descText).replace(/\n/g, '<br>')}</p>
          `;
        
          // Insert AFTER the flex-table (if it lives in the right column)
          const table = right.querySelector('.flex-table') || section.querySelector('.flex-table');
          if (table && table.parentNode === right) {
            right.insertBefore(block, table.nextSibling);
          } else {
            // Fallback: append at the end of the right column
            right.appendChild(block);
          }
        }
      } catch {}

    }

    function renderReferencesSection(obj) {
      const host = document.getElementById('detail-references');
      if (!host || !obj) return;
    
      // Use the shared Strapi → <p>…</p> helper so References behaves
      // like Content and other rich text fields.
      const html = toParagraphHtml(obj.references);
    
      if (html && html.trim()) {
        host.innerHTML = html;
      } else {
        host.innerHTML = '<p>No references.</p>';
      }
    } 

    function renderRelatedThemes(obj) {
      const host = document.getElementById('related-themes');
      if (!host) return;
    
      const esc = s => String(s ?? '').replace(/&/g, '&amp;')
                                      .replace(/</g, '&lt;')
                                      .replace(/>/g, '&gt;');
    
      const escAttr = s => String(s ?? '').replace(/"/g, '&quot;');
    
      const list = Array.isArray(obj?.themes) ? obj.themes : [];
    
      host.innerHTML = list.map(t => {
        const rawName = t.name ?? '';
        const name    = esc(rawName);
        const desc    = esc(t.description);
        const idAttr  = escAttr(t.id ?? t.Id ?? t.ID ?? '');
        const nameAttr = escAttr(rawName);
    
        if (!name && !desc) return '';
    
        return `
          <div class="related-theme-item">
            ${name ? `<h4>${name}</h4>` : ''}
            ${desc ? `<p>${desc}</p>` : ''}
            <a href="#"
               class="button related-theme-explore"
               data-theme-id="${idAttr}"
               data-theme-name="${nameAttr}">
              <span class="text">Explore Theme</span>
              <span class="icon">&rarr;</span>
            </a>
          </div>
        `;
      }).join('');
    
      // One delegated click handler per host
      if (!host._themeExploreBound) {
        host._themeExploreBound = true;
    
        host.addEventListener('click', (e) => {
          const btn = e.target.closest('.related-theme-explore');
          if (!btn) return;
          e.preventDefault();
    
          const theme = {
            id:   btn.dataset.themeId || null,
            name: btn.dataset.themeName || ''
          };
    
          if (typeof window.openThemeGallery === 'function') {
            window.openThemeGallery(theme);
          }
        });
      }
    }    

    // Helper: get all objects in a group (single source of truth)
    function getGroupObjects(groupId) {
      const all = (window.gridObject?.objects || window.objects || []);
      const gid = String(groupId ?? '');
      return all.filter(o => String(o.groupId) === gid);
    }
    
    function renderRelatedObjects(obj) {
      const host = document.getElementById('related-objects');
      if (!host || !obj) return;
    
      // Related = same group, excluding current object
      const inGroup = getGroupObjects(obj.groupId)
        .filter(o => String(o.id) !== String(obj.id));
    
      // Keep consistent ordering with your gallery
      const ordered = inGroup.slice().sort(window.galleryComparator);
    
      // Render
      host.innerHTML = '';
      ordered.forEach(o => {
        // Reuse your existing gallery visuals
        const el = window.__ui.makeGalleryItem(o);
    
        // Jump straight to detail on click
        el.addEventListener('click', () => {
          window.openObjectDetail?.({
            objectId: o.id,
            from: 'related',          // context tag; nav still works
            gid: obj.groupId
          });
        });
    
        el.classList.add('visible');

        host.appendChild(el);
      });

      window.__relatedStripAudio?.init();
    }    

    let __detailWS = null;
    let __detailWS_RO = null;
    // ===== Text-to-speech hover playback ==================================
    let __ttsAudio = null;

    function stopTtsAudio() {
      if (!__ttsAudio) return;

      try { __ttsAudio.pause(); } catch {}
      try { __ttsAudio.currentTime = 0; } catch {}

      // Also reset the visual state of the TTS button (icon back to speaker)
      const btn = document.getElementById('content-tts-button');
      if (btn) {
        btn.classList.remove('is-playing');
      }
    }

    (function bindTtsButtonOnce() {
      const btn = document.getElementById('content-tts-button');
      if (!btn || btn._ttsBound) return;
      btn._ttsBound = true;

      function ensureAudio() {
        if (!__ttsAudio) {
          __ttsAudio = new Audio();
          __ttsAudio.preload = 'none';

          // When audio finishes naturally, reset the button icon
          __ttsAudio.addEventListener('ended', () => {
            const b = document.getElementById('content-tts-button');
            if (b) {
              b.classList.remove('is-playing');
            }
          });
        }
        return __ttsAudio;
      }

      // Click toggles play / stop
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const src = btn.dataset.src;
        if (!src) {
          // Nothing to play
          return;
        }

        const a = ensureAudio();

        // If we're currently not playing, start playback
        if (!btn.classList.contains('is-playing')) {
          if (a.src !== src) {
            a.src = src;
          }
          try {
            a.currentTime = 0;
          } catch {}
          a.play()
            .then(() => {
              btn.classList.add('is-playing');
            })
            .catch(() => {
              // If play fails (autoplay restrictions, etc.), keep state clean
              btn.classList.remove('is-playing');
            });
        } else {
          // Already playing -> stop
          stopTtsAudio();
        }
      });
    })();
    
    function initDetailWave() {
      const waveDiv = document.getElementById('detail-wave');
      if (!waveDiv || !waveDiv.dataset.src) return;
    
      // Clean up any previous instance
      try { __detailWS_RO?.disconnect(); } catch {}
      try { __detailWS?.destroy(); } catch {}
      __detailWS = null; __detailWS_RO = null;
    
      // Create WaveSurfer
      __detailWS = WaveSurfer.create({
        container: waveDiv,
        height: 64,          // should match CSS height
        responsive: true,    // let it resize
        normalize: true
        // waveColor / progressColor optional – reuse your prefs if you have them
      });
    
      __detailWS.load(waveDiv.dataset.src);
    
      // Keep it in sync with layout changes
      __detailWS_RO = new ResizeObserver(() => {
        try { __detailWS?.resize(); } catch {}
      });
      __detailWS_RO.observe(waveDiv);
    }    

    // Holds return context so Back knows where to go
    window.__detailCtx = { from: null, gid: null, objectId: null };

    // Holds current nav state across clicks
    window.__detailNav = null; // { order: [id1,id2,...], index: 0, gid: '...' }

    // Compute ordered ID list for the current object's group
    function buildDetailNavFor(obj) {
      const groupId = String(obj.groupId);
      const inGroup = getGroupObjects(groupId);
      const ordered = inGroup.slice().sort(window.galleryComparator);
      
      return {
        order: ordered.map(o => String(o.id)),
        index: ordered.findIndex(o => String(o.id) === String(obj.id)),
        gid: groupId
      };
    }

    // Create or reuse nav for this object's group
    function ensureDetailNav(obj) {
      const g = String(obj.groupId);
      if (!window.__detailNav || window.__detailNav.gid !== g) {
        window.__detailNav = buildDetailNavFor(obj);
      } else {
        // If we jumped here via direct open, ensure index matches the currently opened id
        const i = window.__detailNav.order.indexOf(String(obj.id));
        if (i >= 0) window.__detailNav.index = i;
      }
      updateDetailNavUI();
    }

    // Enable/disable arrows at the ends
    function updateDetailNavUI() {
      const nav = window.__detailNav;
      if (!nav) return;
      const prevBtn = document.querySelector('#detail-content .vertical-content .detail-nav-arrow.prev');
      const nextBtn = document.querySelector('#detail-content .vertical-content .detail-nav-arrow.next');
      const total = nav.order.length;
      const i = nav.index; // 0-based
      if (prevBtn) {
        if (i <= 0) {
          prevBtn.hidden = true;
          prevBtn.textContent = '';
          prevBtn.setAttribute('aria-disabled', 'true');
        } else {
          prevBtn.hidden = false;
          prevBtn.textContent = `${i} / ${total}`; // previous item number (1-based)
          prevBtn.removeAttribute('aria-disabled');
          prevBtn.setAttribute('aria-label', `Go to item ${i} of ${total}`);
        }
      }
      if (nextBtn) {
        if (i >= total - 1) {
          nextBtn.hidden = true;
          nextBtn.textContent = '';
          nextBtn.setAttribute('aria-disabled', 'true');
        } else {
          nextBtn.hidden = false;
          nextBtn.textContent = `${i + 2} / ${total}`; // next item number (1-based)
          nextBtn.removeAttribute('aria-disabled');
          nextBtn.setAttribute('aria-label', `Go to item ${i + 2} of ${total}`);
        }
      }
    }

    // Go -1 / +1 within the cached order (no wrap)
    function stepDetail(delta) {
      const nav = window.__detailNav;
      if (!nav) return;
      let nextIndex = nav.index + delta;
      if (nextIndex < 0 || nextIndex >= nav.order.length) return; // stop at ends

      nav.index = nextIndex;
      const nextId = nav.order[nextIndex];

      // Keep same context, but swap objectId
      const ctx = window.__detailCtx || {};
      window.openObjectDetail({ objectId: nextId, from: ctx.from || null, gid: ctx.gid || null });
    }
    // after the closing brace of function stepDetail(delta) { ... }
    window.stepDetail = stepDetail;

    // --- keyboard navigation for detail view (← prev, → next) ---
    (function addDetailKeyboardNav() {
      const detailEl = document.getElementById('detail-content');

      // Ignore key presses while typing in inputs/textareas/contentEditable
      function isTypingTarget(el) {
        if (!el) return false;
        const tag = el.tagName;
        const editable = el.isContentEditable;
        return editable ||
              tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      }

      document.addEventListener('keydown', (e) => {
        // Only when the detail page is open/visible
        if (!detailEl || !detailEl.classList.contains('active')) return;
        if (isTypingTarget(e.target)) return;

        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          window.stepDetail?.(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          window.stepDetail?.(+1);
        }
      });
    })();

    window.openObjectDetail = function ({ objectId, from, gid, historyMode, detailStacked } = {}) {
      console.log('[detail] openObjectDetail (NEW ROUTER VERSION)', { objectId, from, gid });

      if (!detailEl) return;

      //window.markObjectVisited?.(objectId);

      // pause any grid waves so we don't hear two audios at once
      window.__gridWaves?.pauseAll?.();
      // make sure previous detail waveform is gone before rendering a new one
      destroyDetailWave();

      stopTtsAudio(); // ADD THIS

      // also clear any previous related-strip waves
      window.__relatedStripAudio?.destroy?.();

      // Remember where we came from
      window.__detailCtx = { from: from || null, gid: gid || null, objectId: objectId || null };

      // Look up the object from in-memory data and render the primary slot
      const allObjects = (window.gridObject?.objects || window.objects || []);
      const obj =
        allObjects.find(o => String(o.id) === String(objectId)) ||
        (typeof resolveObjectByToken === 'function' ? resolveObjectByToken(objectId, allObjects) : null);

      // ✅ Mark visited once, using the grid’s internal id when available
      window.markObjectVisited?.(obj ? obj.id : objectId);
      
      if (obj) {      
        // Sync the 3 content sidebars with this object's group
        const contentGroupId = gid || obj.groupId || null;
        if (contentGroupId && typeof updateContentSidebarsForGroup === 'function') {
          updateContentSidebarsForGroup(contentGroupId);
        }
        renderDetailPrimary(obj);
        renderReferencesSection(obj); // NEW
        renderRelatedThemes(obj);
        renderRelatedObjects(obj);
        ensureDetailNav(obj);

        // Enhance rich text inside this detail view (URLs → links, YouTube → embeds)
        if (typeof window.enhanceContentSections === 'function') {
          window.enhanceContentSections(detailEl);
        }
      } else {
        console.warn('[detail] object not found for id:', objectId);
      }

      // If we came from gallery: hide it (and detach observers) so nothing interferes
      if (from === 'gallery' && groupGalleryEl?.classList.contains('active')) {
        groupGalleryEl.classList.remove('active');
        window.__galleryIO__?.onClose?.();
      }

      // Hide grid shell (we'll come back to it on close)
      if (gridShellEl) gridShellEl.style.display = 'none';

      // Reset scroll so every detail opens at the top
      resetDetailScroll();

      // Show the detail screen
      detailEl.classList.add('active');

      // Defer WaveSurfer init until after #detail-content is visible and laid out
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          initDetailWave();
        });
      });

      // Mark: we are in the full-page detail view
      document.body.classList.add('in-detail-page');
      window.renderSelectionBar?.();

      // (Optional but useful) remember which object is open — used for the "Research project in …" text
      try {
        const all = window.gridObject?.objects || window.objects || [];
        const obj = all.find(o => String(o.id) === String(objectId));
        window._lastDetailObject = obj || null;
      } catch {
        window._lastDetailObject = null;
      }

      // Notify the header updater
      window.__dispatchViewChange?.();

      // Push/replace a state so browser Back closes detail, and URL is /objects/<slug|id>
      try {
        const detailPath = buildObjectDetailPath(obj);
        const current = history.state || {};
        const alreadyDetailState = !!current.detail;

        // default behavior:
        // - first open from grid/gallery => push (so back returns)
        // - switching object while already in detail => replace (no history spam)
        const mode = historyMode || (alreadyDetailState ? 'replace' : 'push');

        // whether there is an in-app back entry behind this detail
        const stacked =
          (typeof detailStacked === 'boolean')
            ? detailStacked
            : (mode === 'push' ? true : (current.detailStacked ?? false));

        const nextState = {
          ...current,
          detail: true,
          detailStacked: stacked,
          from: String(from || ''),
          gid: String((gid ?? obj.groupId ?? '') || ''),
          objectId: String(obj.id || objectId || ''),
        };

        if (mode === 'push') history.pushState(nextState, '', detailPath);
        else history.replaceState(nextState, '', detailPath);
      } catch {}

      refreshSlideInsVisibility();
      console.log('[detail] opened', window.__detailCtx);
    };

    window.closeObjectDetail = function ({ viaPopstate = false } = {}) {
      console.log("entered back button of object detail")
      if (!isInDetailView()) return;

      try { __detailWS_RO?.disconnect(); } catch {}
      try { __detailWS?.destroy(); } catch {}
      __detailWS = null; __detailWS_RO = null;

      destroyDetailWave();
      stopTtsAudio(); // ADD THIS

      // Reset scroll so the next opened detail starts at the top
      resetDetailScroll();

      // NEW: stop any native media (video/audio) that might be playing in the detail view
      detailEl.querySelectorAll('video, audio').forEach((media) => {
        try {
          media.pause();
          media.currentTime = 0;
        } catch {}
      });

      detailEl.classList.remove('active');

      // Unmark: we left the full-page detail
      document.body.classList.remove('in-detail-page');
      restoreGridStateFromDetail();
      window.renderSelectionBar?.();
      window._lastDetailObject = null;

      // Notify the header updater
      window.__dispatchViewChange?.();

      const { from, gid } = window.__detailCtx || {};

      // Determine where we landed after this close (for back/forward navigation).
      const currentView = history.state?.view;
      const landedInSubpage =
        viaPopstate && currentView === VIEW.SUBPAGE;
   
      if (from === 'gallery') {
        // Return to the same gallery without flicker
        if (groupGalleryEl) {
          groupGalleryEl.classList.add('active');
          // Re-attach observers/counters
          window.__galleryIO__?.onOpen?.();
        }
        if (gridShellEl) gridShellEl.style.display = 'none';
        console.log('[detail] back → gallery');
      } else if (landedInSubpage) {
        // We navigated back to a text subpage (e.g. Introduction or another info page).
        // applyViewFromState/openTextSubpage has already:
        //   - activated the correct text subpage, and
        //   - hidden the grid shell.
        // So we intentionally do NOT touch gridShellEl here,
        // to avoid bringing the grid back on top of the text page.
        console.log('[detail] back → text subpage, keep grid hidden');
      } else {
        console.log('[detail] back → grid');
        // Return to the grid (clustered/ungrouped card stays as it was)
        if (gridShellEl) gridShellEl.style.display = '';
        // Re-check view + tags after the grid shell is visible
        requestAnimationFrame(() => {
          window.applyVisitedMarkers?.();   // ✅ ADD THIS (repaint visited dots now)
          window.gridObject?._refitAllText?.();
          window.__dispatchViewChange?.();
          window.renderSelectionBar?.();
        });
      }
   
      refreshSlideInsVisibility();
      console.log('[detail] closed', { viaPopstate, from, gid, currentView, landedInSubpage });
    };   

    // Back button: if detail is active, intercept before gallery handler
    document.addEventListener('click', (e) => {
      const back = e.target.closest('#content-back-button');
      if (!back) return;

      const isDetailActive  = detailEl?.classList.contains('active');
      const isGalleryActive = groupGalleryEl?.classList.contains('active');

      // If a gallery is currently visible, let the gallery handler own this button.
      if (!isDetailActive || isGalleryActive) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      if (history.state?.detail && history.state.detailStacked) {
        // Opened from inside the app (grid/gallery) => normal back
        history.back();
      } else {
        // Direct URL entry or "replace" detail => close to grid and move URL to home
        window.closeObjectDetail();
        if (isObjectDetailPath(location.pathname)) {
          try { history.pushState({ view: VIEW.HOME }, '', appUrl('#home')); } catch {}
        }
      }
      
    }, true); // capture, so we run before the gallery back handler

    // Popstate: close detail when leaving; open the right object when entering
    window.addEventListener('popstate', () => {
      const wasInDetail = isInDetailView();
      const isDetailState =
        !!history.state?.detail || isObjectDetailPath(location.pathname);

      if (wasInDetail && !isDetailState) {
        window.closeObjectDetail({ viaPopstate: true });
        return;
      }

      // Navigated INTO a detail state (forward/back) -> open the right object
      if (!wasInDetail && isDetailState) {
        const allObjects = (window.gridObject?.objects || window.objects || []);
        const stateObjId = history.state?.objectId;
        let targetId = stateObjId;

        if (!targetId) {
          const token = parseObjectTokenFromPathname(location.pathname);
          const obj = token ? resolveObjectByToken(token, allObjects) : null;
          targetId = obj?.id;
        }

        if (targetId && typeof window.openObjectDetail === 'function') {
          window.openObjectDetail({
            objectId: targetId,
            from: history.state?.from || 'history',
            gid: history.state?.gid || null,
            historyMode: 'replace',
            detailStacked: history.state?.detailStacked ?? true,
          });
        }
      }
    });
  })();

  (function galleryTextFit(){
    const gg = document.getElementById('group-gallery');
    if (!gg) return;
 
    let textObs = null;
    let mo = null;
    let resizeRaf = 0;
    let scrollRaf = 0;
 
    function fitScalingText(span) {
      const item = span.closest('.item.text');
      if (!item) return;
 
      // measure available box (subtract padding)
      const csItem = getComputedStyle(item);
      const padX = parseFloat(csItem.paddingLeft) + parseFloat(csItem.paddingRight);
      const padY = parseFloat(csItem.paddingTop)  + parseFloat(csItem.paddingBottom);
      const maxW = Math.max(0, item.clientWidth  - padX);
      const maxH = Math.max(0, item.clientHeight - padY);
 
      // early exit if nothing to do
      if (maxW <= 0 || maxH <= 0) return;
 
      // start from a sensible font size (computed)
      const csSpan = getComputedStyle(span);
      let fs = parseFloat(csSpan.fontSize) || 16;
 
      span.style.whiteSpace = 'normal';
      span.style.display = 'block';
      span.style.lineHeight = '1.1';
      span.style.maxWidth = maxW + 'px';
 
      // helper: does the span overflow the target box?
      const overflows = () => (span.scrollWidth > maxW + 0.5) || (span.scrollHeight > maxH + 0.5);
 
      // coarse downscale until it fits or we hit a floor
      let attempts = 0;
      while (attempts++ < 30 && overflows() && fs > 6) {
        fs *= 0.9;
        span.style.fontSize = fs + 'px';
      }
 
      // gentle upscale to approach the limit (optional)
      while (attempts++ < 60 && !overflows() && fs < 200) {
        fs *= 1.03;
        span.style.fontSize = fs + 'px';
        if (overflows()) {
          fs /= 1.03;
          span.style.fontSize = fs + 'px';
          break;
        }
      }
    }
 
    function fitAllVisibleTexts() {
      const spans = gg.querySelectorAll('.gallery-box .item.text .scaling-text');
      spans.forEach(s => fitScalingText(s));
    }
 
    function onResize() {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(fitAllVisibleTexts);
    }
 
   function onScroll() {
     cancelAnimationFrame(scrollRaf);
     scrollRaf = requestAnimationFrame(fitAllVisibleTexts);
   }
 
    function attachTextIO() {
      if (textObs) textObs.disconnect();
 
      const options = { root: gg, threshold: 0.15 };
      textObs = new IntersectionObserver((entries) => {
        entries.forEach(en => {
          if (!en.isIntersecting) return;
          const span = en.target;
          fitScalingText(span);
          textObs.unobserve(span); // one-shot per item; will re-fit on scroll/resize
        });
      }, options);
 
      // observe existing
      gg.querySelectorAll('.gallery-box .item.text .scaling-text').forEach(s => textObs.observe(s));
 
      // observe future nodes as the gallery is (re)rendered
      if (mo) mo.disconnect();
      mo = new MutationObserver(() => {
        gg.querySelectorAll('.gallery-box .item.text .scaling-text').forEach(s => {
          if (!s._observed) {
            s._observed = true;
            textObs.observe(s);
          }
        });
      });
      mo.observe(gg.querySelector('.gallery-box'), { childList: true, subtree: true });
    }
 
    // Optional external hook to force a pass
    window.__galleryTextFit = { refresh: fitAllVisibleTexts };
 
    (window.__galleryIO__ ||= { onOpen() {}, onClose() {} });
    const prevOpen = window.__galleryIO__.onOpen;
    const prevClose = window.__galleryIO__.onClose;
 
    window.__galleryIO__.onOpen = function () {
      prevOpen?.();
      attachTextIO();
      requestAnimationFrame(fitAllVisibleTexts);
      document.fonts?.ready.then(() => requestAnimationFrame(fitAllVisibleTexts));
      window.addEventListener('resize', onResize);
      gg.addEventListener('scroll', onScroll, { passive: true });
    };
 
    window.__galleryIO__.onClose = function () {
      prevClose?.();
      if (textObs) { textObs.disconnect(); textObs = null; }
      if (mo) { mo.disconnect(); mo = null; }
      window.removeEventListener('resize', onResize);
      gg.removeEventListener('scroll', onScroll);
    };
  })();
 

  //backBtnEl?.addEventListener('click', (e) => { e.preventDefault(); closeGallery(); });

  if (!gridEl) {
    console.log('[debug] #grid element not found at script load');
  } else {
    gridEl.addEventListener('click', (e) => {
      const go = window.gridObject;
      const isGrouped = go?.currentState === 'grouped';

      // Robust object detection under the cursor:
      let objEl = null;

      // 1) composedPath (handles retargeting/shadow-ish cases)
      if (e.composedPath) {
        const path = e.composedPath();
        objEl = path.find(n => n && n.classList && n.classList.contains('object')) || null;
      }

      // 2) elementsFromPoint fallback (topmost element under pointer)
      if (!objEl && document.elementsFromPoint) {
        const stack = document.elementsFromPoint(e.clientX, e.clientY);
        objEl = stack.find(n => n && n.classList && n.classList.contains('object')) || null;
      }

      // 3) classic closest as a last resort
      if (!objEl && e.target && e.target.closest) {
        objEl = e.target.closest('.object');
      }

      // SWALLOW clicks that immediately follow a drag in grouped mode
      if (isGrouped && (performance.now() - __lastDragAt) < 200) {
        return;
      }

      // Debug what we actually found
      console.log('[debug] resolve objEl', {
        target: e.target.tagName,
        targetCls: e.target.className,
        found: !!objEl,
        objId: objEl && objEl.id
      });

      console.log('[click]', {
        target: e.target.tagName,
        isGrouped,
        hasObjectAncestor: !!objEl,
        objId: objEl?.id
      });

      // Only in grouped mode: object click either opens gallery or (for 1-object groups) goes straight to detail
      if (isGrouped && objEl) {
        e.preventDefault();
        e.stopPropagation();

        const allObjects = (window.gridObject?.objects || objects || []);
        const obj = allObjects.find(o => String(o.id) === String(objEl.id));
        const gid = obj?.groupId;

        if (gid != null) {
          window.openGroupEntry?.(gid, { from: 'grouped' });
        }
        return;        
      }
    }, true); // capture so we log/handle even if child elements have handlers
  }
}

// === IntersectionObserver for #group-gallery (title + item-by-item) ===
(function galleryIntersectionObservers() {
  const gg = document.getElementById('group-gallery');
  if (!gg) return;

  function setupGalleryIO() {
    // 1) Title fade-in: create the observer only once per open
    const title = gg.querySelector('.title-box');
    if (title && !gg._titleObs) {
      const titleObs = new IntersectionObserver((entries, obs) => {
        entries.forEach(en => {
          if (en.isIntersecting) {
            en.target.classList.add('visible');   // put .visible on the title itself
            obs.unobserve(en.target);             // one-shot
          }
        });
      }, { root: null, threshold: 0.35, rootMargin: '0px 0px -10% 0px' });
      titleObs.observe(title);
      gg._titleObs = titleObs;
    }

    // 2) Items fade in individually as you horizontally scroll the gallery box
    const box = gg.querySelector('.gallery-box');
    if (!box) return; // require the horizontal scroller as the IO root
    const scroller = gg; // #group-gallery is the scroll container (has overflow-x: scroll)

    // Reuse existing IntersectionObserver if present, otherwise create it once
    let itemObs = gg._itemObs;
    if (!itemObs) {
      itemObs = new IntersectionObserver((entries, obs) => {
        entries.forEach(en => {
          if (!en.isIntersecting) return;
          // if the observed node is an <img> that got wrapped later,
          // add .visible to the nearest .item wrapper:
          const item = en.target.classList.contains('item')
            ? en.target
            : en.target.closest('.item');
          if (item) item.classList.add('visible');
          obs.unobserve(en.target);   // one-shot
        });
      }, {
        root: scroller,
        threshold: 0.15,
        rootMargin: '0px'
      });
      gg._itemObs = itemObs;
    }

    // 3) For the current gallery contents, (re)observe all items
    let idx = 0;
    box.querySelectorAll('.column > .item, .column img.item').forEach(el => {
      // Set delay on the actual flex item (wrapper if present)
      const item = el.classList.contains('item') ? el : el.closest('.item') || el;
      item.style.transitionDelay = `${(idx++ % 6) * 40}ms`;
      // Observe the original node; the callback will add .visible to the wrapper
      itemObs.observe(el);
    });
  }

  // Expose tiny helpers so your existing open/close can call them
  window.__galleryIO__ = {
    onOpen() {
      // (Re)bind observers after the gallery becomes visible in the layout
      requestAnimationFrame(() => {
        setupGalleryIO();
      });
    },
    onClose() {
      if (gg._itemObs) { gg._itemObs.disconnect(); gg._itemObs = null; }
      if (gg._titleObs) { gg._titleObs.disconnect(); gg._titleObs = null; }
      gg._ioBound = false;
      // Reset visibility so next open fades again
      gg.querySelector('.title-box')?.classList.remove('visible');
      gg.querySelectorAll('.gallery-box .item').forEach(el => { 
        el.style.transitionDelay = ''; 
        el.classList.remove('visible');
      });
    }
  };
})();

// === Wrap gallery side counters so only the inner rotates ===
(() => {
  const gg = document.getElementById('group-gallery');
  if (!gg) return;

  function ensureRot(node) {
    if (!node) return;
    if (!node.querySelector('.rot')) {
      const span = document.createElement('span');
      span.className = 'rot';
      span.innerHTML = node.innerHTML;
      node.innerHTML = '';
      node.appendChild(span);
    }
  }

  (window.__galleryIO__ ||= { onOpen() {}, onClose() {} });
  const prevOpen  = window.__galleryIO__.onOpen;
  const prevClose = window.__galleryIO__.onClose;

  window.__galleryIO__.onOpen = function () {
    prevOpen?.();
    gg.querySelectorAll('.count-invisible-objects.left, .count-invisible-objects.right')
      .forEach(ensureRot);
  };

  window.__galleryIO__.onClose = function () {
    prevClose?.();
    // nothing special to undo; gallery DOM is rebuilt on next open
  };
})();

// === Gallery audio waveforms (WaveSurfer) ===
// Builds one waveform per entry in audioPool, lazy-creates on intersection, destroys on close.
(() => {
  const gg = document.getElementById('group-gallery');
  if (!gg) return;

  // Registry of WaveSurfer instances for this gallery session
  let wsRegistry = new Map();
  let audioObserver = null;

  // Lazy-create waves when items enter the visible gallery viewport
  function attachAudioIO() {
    // Ensure previous observer is gone
    if (audioObserver) {
      audioObserver.disconnect();
      audioObserver = null;
    }

    const scroller = gg; // #group-gallery is the horizontal scroller (your viewport)
    //const options = { root: scroller, threshold: 0.15, rootMargin: '0px' };
    // TEMP: consider all items "in view"
    const options = { root: scroller, threshold: 0.01, rootMargin: '600px 0px 600px 0px' };

    audioObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;

        const item = en.target;
        const wave = item.querySelector('.wave');
        const src  = item.dataset.audioSrc;
        if (!wave || !src) return;
        
        // Create WaveSurfer once per container (no audio loaded yet)
        if (!wsRegistry.has(wave.id)) {
          const ws = createWave(`#${wave.id}`, null);
          window.addAudioPlaceholder?.(wave);
          ws.once?.('ready', () => window.removeAudioPlaceholder?.(wave));

        
        // try to draw peaks first (non-blocking)
        let peaks, duration;
        if (window.AUDIO_WAVE_RENDER_MODE === 'peaks') {
          const peaksUrl = src.replace(/\.[^/.]+$/, '.peaks.json');
          (async () => {
            try {
              const r = await fetch(peaksUrl, { cache: 'force-cache' });
              if (!r.ok) return;
              const j = await r.json();
              peaks = Array.isArray(j) ? j : (j.data || j.peaks);
              duration = j.duration || j.length;
              ws.__lazyPeaks = peaks;
              ws.__lazyDuration = duration;
              if (peaks?.length && !ws.__mp3Requested) ws.load('', peaks, duration);
            } catch {}
          })();
        }
        // hover plays/pauses (first hover will trigger MP3 fetch)
        hoverPlay(item, ws, src);

        // click toggles play/pause (first click will trigger MP3 fetch)
        item.addEventListener('click', () => {
          const meta = { peaks: peaks ?? ws.__lazyPeaks, duration: duration ?? ws.__lazyDuration };
          window.ensureWaveAudio(ws, src, meta).then(() => {
            try { ws.playPause(); } catch {}
          }).catch(() => {});
        });

        wsRegistry.set(wave.id, ws);
        }
        
        // Stop observing after first creation
        obs.unobserve(item);
      });
    }, options);

    // Observe any audio items currently in DOM
    gg.querySelectorAll('.gallery-box .item.audio').forEach(el => audioObserver.observe(el));
  }

  // Destroy all WaveSurfer instances and clear the column
  function destroyAllAudio() {
    if (audioObserver) { audioObserver.disconnect(); audioObserver = null; }
    wsRegistry.forEach(ws => { try { ws.destroy?.(); } catch(_){} });
    wsRegistry.clear();
  }

  // Hook into gallery lifecycle (fade-in/counters already use these hooks)
  (window.__galleryIO__ ||= { onOpen(){}, onClose(){} });
  const prevOpen  = window.__galleryIO__.onOpen;
  const prevClose = window.__galleryIO__.onClose;

  window.__galleryIO__.onOpen = function() {
    prevOpen?.();
    attachAudioIO();      // lazy-create for any .item.audio present
  };

  window.__galleryIO__.onClose = function() {
    prevClose?.();
    destroyAllAudio();    // clean up for a fresh reopen
  };
})();

// === Related strip audio waveforms (WaveSurfer) ===
// Creates WaveSurfer for each .item.audio inside #related-objects (detail page)
(() => {
  const hostSel = '#related-objects';
  const wsMap = new Map();            // key = wave element, val = ws instance

  function destroyAll() {
    wsMap.forEach(ws => { try { ws.destroy(); } catch {} });
    wsMap.clear();
  }

  function init() {
    const host = document.querySelector(hostSel);
    if (!host) return;

    // Start clean each render
    destroyAll();

    host.querySelectorAll('.item.audio').forEach(item => {
      const wave = item.querySelector('.wave');
      const src  = item.dataset.audioSrc;
      if (!wave || !src) return;

      // Create WS directly on the element (avoids id collisions)
      const ws = createWave(wave, null);
      window.addAudioPlaceholder?.(wave);
      ws.once?.('ready', () => window.removeAudioPlaceholder?.(wave));

      // Optional: try peaks first to draw without fetching audio
      let peaks, duration;
      if (window.AUDIO_WAVE_RENDER_MODE === 'peaks') {
        (async () => {
          try {
            const peaksUrl = src.replace(/\.[^/.]+$/, '.peaks.json');
            const r = await fetch(peaksUrl, { cache: 'force-cache' });
            if (r.ok) {
              const j = await r.json();
              peaks = Array.isArray(j) ? j : (j.data || j.peaks);
              duration = j.duration || j.length;
              ws.__lazyPeaks = peaks;
              ws.__lazyDuration = duration;
              if (peaks?.length && !ws.__mp3Requested) ws.load('', peaks, duration);
            }
          } catch {}
        })();
      }

      // Hover play/pause (first hover will trigger MP3 fetch)
      hoverPlay(item, ws, src);

      // Click toggles play/pause (first click will trigger MP3 fetch)
      item.addEventListener('click', () => {
        const meta = { peaks: peaks ?? ws.__lazyPeaks, duration: duration ?? ws.__lazyDuration };
        window.ensureWaveAudio(ws, src, meta).then(() => {
          try { ws.playPause(); } catch {}
        }).catch(() => {});
      });

      wsMap.set(wave, ws);
    });
  }

  // Expose a tiny API so detail open/close can manage these instances
  window.__relatedStripAudio = { init, destroy: destroyAll };
})();

// === Dynamic gallery renderer (fixed 3 items per column; random item widths 100–200px) ===
(function galleryRenderer() {
  const gg  = document.getElementById('group-gallery');
  const box = gg?.querySelector('.gallery-box');
  if (!gg || !box) return;

  // random width between 100–200 px
  function randItemWidth() {
    return 100 + Math.floor(Math.random() * 101); // 100..200
  }

  function uid() {
    return (crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
  }

  // --- Gallery horizontal jitter (left/right offset per item within a column) ---
  // Override from index.html BEFORE script.js if you want:
  // window.GALLERY_X_JITTER_CONFIG = { enabled: true, edgeGap: 8, maxFractionOfSlack: 0.95 };

  const GALLERY_X_JITTER = {
    enabled: true,
    edgeGap: 6,             // keep a tiny safety margin from the column edges
    maxFractionOfSlack: 0.9, // use up to 90% of available “slack” space
    ...(typeof window !== 'undefined' && window.GALLERY_X_JITTER_CONFIG && typeof window.GALLERY_X_JITTER_CONFIG === 'object'
      ? window.GALLERY_X_JITTER_CONFIG
      : {})
  };

  function applyGalleryXJitter(el, colEl) {
    if (!GALLERY_X_JITTER.enabled || !el) return;

    // Column width (fallback to your CSS column width if it’s not measurable yet)
    const colW = colEl?.clientWidth || 300;

    // Item width is set inline for all your gallery items (img/video/text/audio/fallback)
    const itemW = parseFloat(el.style.width) || 150;

    // If items are centered, the max safe translateX is roughly half the remaining space
    const slack = Math.max(0, colW - itemW);
    const maxShift =
      Math.max(0, (slack / 2) * (GALLERY_X_JITTER.maxFractionOfSlack ?? 1) - (GALLERY_X_JITTER.edgeGap ?? 0));

    if (maxShift <= 0) return;

    const dx = (Math.random() * 2 - 1) * maxShift;

    // Preserve any existing transform (unlikely here), and append our translateX
    const prev = (el.style.transform || '').trim();
    const cleaned = prev.replace(/translateX\([^)]+\)/g, '').trim();
    el.style.transform = `${cleaned ? cleaned + ' ' : ''}translateX(${dx.toFixed(1)}px)`;
  }

  function createGalleryItem(o) {
    const tooltip = getObjectTooltipLabel(o);
    // IMAGE (allow up to 1.5x intrinsic CSS width, DPR-aware)
    // REPLACE the whole image case with this:
    if (o.type === 'image') {
      const img = document.createElement('img');
      img.className = 'item image';
      img.alt = o.alt || '';
      img.loading = 'lazy';

      // Desired CSS width for this gallery item (same logic as before)
      const desiredCss = randItemWidth(); // 100..200 px
      const dpr = window.devicePixelRatio || 1;
      const needPx = Math.round(desiredCss * dpr * 1.5); // small headroom for zoom/hover

      // Look up Strapi file meta (added in step 2). Keyed by the original/master URL.
      // Falls back gracefully if meta isn't present yet.
      const meta = (window.__mediaMeta__ && window.__mediaMeta__.get(o.image)) || o._mediaMeta || null;

      let chosenUrl = o.image || o.src || o.url || '';
      let chosenW, chosenH;

      if (meta && meta.formats) {
        // Use the helper from step 2
        const best = pickImageVariant(meta.formats, needPx);
        if (best && best.url) {
          chosenUrl = best.url;
          chosenW = best.width;
          chosenH = best.height;
        }

        // Optional: give the browser choices
        const candidates = Object.values(meta.formats)
          .filter(v => v && v.url && v.width)
          .sort((a, b) => a.width - b.width)
          .map(v => `${v.url} ${v.width}w`)
          .join(', ');
        if (candidates) {
          img.srcset = candidates;
          img.sizes = `${desiredCss}px`;
        }
      }

      img.src = chosenUrl;

      // Size the box in CSS (keeps your layout)
      img.style.width = `${desiredCss}px`;
      img.style.height = 'auto';
      img.style.display = 'block';

      // Optional: width/height attributes help reduce CLS if we know them
      if (chosenW && chosenH) {
        img.width = chosenW;
        img.height = chosenH;
      }

      img.dataset.oid = o.id || '';
      if (tooltip) img.dataset.cursorLabelSingle = tooltip;
      return img;
    }

    // VIDEO
    if (o.type === 'video') {
      const vid = document.createElement('video');
      vid.className = 'item';
      vid.setAttribute('playsinline', '');
      vid.setAttribute('muted', '');
      vid.setAttribute('loop', '');
      vid.dataset.src = o.video || o.src || o.url || '';
      vid.preload = 'none';
      vid.poster = window.getVideoPlaceholderPoster?.() || '';
      vid.style.width  = `${randItemWidth()}px`;   // ← random width
      vid.style.height = 'auto';                   // ← auto height
      vid.style.display = 'block';
      //vid.addEventListener('mouseover', () => { try { vid.play(); } catch {} });
      //vid.addEventListener('mouseout',  () => { try { vid.pause(); } catch {} });

      vid.dataset.oid = o.id || '';
      if (tooltip) vid.dataset.cursorLabelSingle = tooltip;
      return vid;
    }

    // TEXT
    if (o.type === 'text') {
      const d = document.createElement('div');
      d.className = 'item text';
      d.style.width = `${randItemWidth()}px`;      // ← random width
      const span = document.createElement('span');
      span.className = 'scaling-text';
      span.textContent = o.text || o.caption || o.title || '';
      d.appendChild(span);

      d.dataset.oid = o.id || '';
      if (tooltip) d.dataset.cursorLabelSingle = tooltip;
      return d;
    }

    // AUDIO (WaveSurfer picks these up via IO)
    if (o.type === 'audio') {
      const item = document.createElement('div');
      item.className = 'item audio';
      item.style.width = `${randItemWidth()}px`;   // ← random width for the whole item
      item.style.display = 'block';

      const wave = document.createElement('div');
      wave.className = 'wave';
      wave.id = `wave_${o.id || uid()}_g`;
      wave.style.width = '100%';                   // fill the item’s random width
      wave.style.height = '50px';
      item.dataset.audioSrc = o.audio || o.src || o.url || '';
      if (window.addAudioPlaceholder) window.addAudioPlaceholder(wave);
      item.appendChild(wave);

      item.dataset.oid = o.id || '';
      if (tooltip) item.dataset.cursorLabelSingle = tooltip;
      return item;
    }

    // Fallback
    const d = document.createElement('div');
    d.className = 'item text';
    d.style.width = `${randItemWidth()}px`;        // ← random width
    const span = document.createElement('span');
    span.className = 'scaling-text';
    span.textContent = o.title || '[unknown]';
    d.appendChild(span);

    d.dataset.oid = o.id || '';
    if (tooltip) d.dataset.cursorLabelSingle = tooltip;
    return d;
  }

  // Make the gallery item builder reusable outside the gallery IIFE
  window.__ui = window.__ui || {};
  window.__ui.makeGalleryItem = createGalleryItem;

    // ---- Deterministic gallery order (detail-page-only for now) ----
  function galleryComparator(a, b) {
    // Primary: by a stable timestamp if available (earlier first)
    const ta = a.date ? new Date(a.date).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.date ? new Date(b.date).getTime() : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;

    // Secondary: by type (consistent grouping of media kinds)
    const w = { image: 1, text: 2, video: 3, audio: 4 };
    const da = (w[a.type] || 999) - (w[b.type] || 999);
    if (da) return da;

    // Tertiary: by human text if present
    const sa = (a.text || a.title || '').localeCompare(b.text || b.title || '');
    if (sa) return sa;

    // Fallback: by id to be fully deterministic
    return String(a.id).localeCompare(String(b.id));
  }
  window.galleryComparator = window.galleryComparator || galleryComparator;

  function groupObjects(gid) {
    const all = (window.gridObject?.objects || window.objects || []);
    return all.filter(o => String(o.groupId) === String(gid));
  }

  // Fisher–Yates shuffle (returns a new array)
  function shuffleArray(src) {
    const a = src.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // --- Gallery layout config (override via window.GALLERY_LAYOUT_CONFIG before script.js) ---
  const GALLERY_LAYOUT = {
    itemsPerCol: 3,              // keeps your old "3 items per column" rule as the baseline
    maxCols: 28,                 // safety: avoid absurdly many columns
    heightBudgetRatio: 0.92,     // how much of the visible gallery height we consider "usable"
    weightUnitPx: 100,           // 1.0 "weight" ≈ 100px (makes viewport budgeting easy)
    mediaWidthEstimatePx: 200,   // be defensive: assume gallery media might be at the upper random width
    galleryMediaMaxPx: 320,      // should match the CSS cap we add below
    ...(window.GALLERY_LAYOUT_CONFIG && typeof window.GALLERY_LAYOUT_CONFIG === 'object'
      ? window.GALLERY_LAYOUT_CONFIG
      : {})
  };

  // Defensive "weight" estimation (in units of ~100px)
  function estimateGalleryWeight(o) {
    const U = GALLERY_LAYOUT.weightUnitPx;

    // TEXT: CSS says 100px fixed height in gallery
    if (o?.type === 'text' || o?.text) return 100 / U;

    // AUDIO: CSS says 50px wave height
    if (o?.type === 'audio' || o?.audio) return 60 / U;

    // IMAGE: use aspect ratio if we have it; otherwise assume slightly portrait (defensive)
    if (o?.type === 'image' || o?.image) {
      const meta =
        o?._imageMeta ||
        (window.__mediaMeta__ && window.__mediaMeta__.get(o.image)) ||
        o?._mediaMeta ||
        null;

      const w = meta?.width;
      const h = meta?.height;
      const ratio = (w && h) ? (h / w) : 1.25; // unknown → assume portrait-ish

      // estimate height at the "upper" random width (more defensive)
      const est = GALLERY_LAYOUT.mediaWidthEstimatePx * ratio;

      // don’t let crazy portraits dominate: cap to the CSS max-height we enforce
      const capped = Math.min(est, GALLERY_LAYOUT.galleryMediaMaxPx);

      // also make sure images never count as "tiny"
      return Math.max(110, capped) / U;
    }

    // VIDEO: no meta right now → treat as heavier than image
    if (o?.type === 'video' || o?.video) return 240 / U;

    // fallback
    return 120 / U;
  }

  // Return index of the smallest value in an array
  function pickLightestIndex(arr) {
    let idx = 0, min = arr[0] ?? 0;
    for (let i = 1; i < arr.length; i++) {
      const v = arr[i] ?? 0;
      if (v < min) { min = v; idx = i; }
    }
    return idx;
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function getMaxColWeight() {
    // Use the actual visible gallery height if possible
    const h = gg?.clientHeight || gg?.getBoundingClientRect?.().height || window.innerHeight || 800;
    const usablePx = h * GALLERY_LAYOUT.heightBudgetRatio;
    return usablePx / GALLERY_LAYOUT.weightUnitPx;
  }

  function computeInitialColCount(list) {
    const N = Array.isArray(list) ? list.length : 0;
    if (!N) return 1;

    // Old rule baseline: ceil(N/3)
    const baseByCount = Math.ceil(N / (GALLERY_LAYOUT.itemsPerCol || 3));

    // New rule: add columns when estimated total height exceeds the per-column budget
    const maxColW = getMaxColWeight();
    const totalW = list.reduce((sum, o) => sum + estimateGalleryWeight(o), 0);
    const byHeight = Math.ceil(totalW / Math.max(0.1, maxColW));

    return clamp(Math.max(baseByCount, byHeight), 1, GALLERY_LAYOUT.maxCols);
  }

  function makeColumns(colCount) {
    box.innerHTML = '';
    const cols = [];
    for (let i = 0; i < colCount; i++) {
      const c = document.createElement('div');
      c.className = 'column';
      cols.push(c);
      box.appendChild(c);
    }
    return cols;
  }

  function renderGalleryFromList(list) {
    const objs = Array.isArray(list) ? list : [];
    if (!objs.length) {
      box.innerHTML = '';
      return;
    }

    const maxColW = getMaxColWeight();
    const initialCols = computeInitialColCount(objs);

    const cols = makeColumns(initialCols);
    const colWeights = new Array(cols.length).fill(0);

    objs.forEach((o) => {
      const w = estimateGalleryWeight(o);
      let idx = pickLightestIndex(colWeights);

      // Safety net: if even the lightest column would exceed the budget, add a new column
      if ((colWeights[idx] + w) > maxColW && cols.length < GALLERY_LAYOUT.maxCols) {
        const c = document.createElement('div');
        c.className = 'column';
        cols.push(c);
        box.appendChild(c);
        colWeights.push(0);
        idx = cols.length - 1;
      }

      const el = createGalleryItem(o);

      applyGalleryXJitter(el, cols[idx]); // NEW: restore left/right shift

      cols[idx].appendChild(el);
      colWeights[idx] += w;

    });

    requestAnimationFrame(() => {
      window.__galleryIO__?._updateCounts?.();
      window.__galleryTextFit?.refresh?.();
    });
  }

  // Public: build the gallery for a given group id
  window.renderGroupGallery = function (gid) {
    if (!gid) return;
    const objs = shuffleArray(groupObjects(gid));
    renderGalleryFromList(objs);
  };

  // Public: build the gallery for an explicit object list (tags selection)
  window.renderAdhocGallery = function (objs = []) {
    const list = Array.isArray(objs) ? [...objs] : [];
    const shuffled = (typeof shuffleArray === 'function') ? shuffleArray(list) : list;
    renderGalleryFromList(shuffled);
  };
})();

// === Invisible item counters (left/right) scoped to #group-gallery ===
(function galleryCounters() {
  const gg = document.getElementById('group-gallery');
  if (!gg) return;

  function attachCountersOnce() {
    if (gg._countsBound) return;
    gg._countsBound = true;

    const scroller   = gg; // #group-gallery IS the horizontal scroller (overflow-x)
    const leftBadge  = gg.querySelector('.count-invisible-objects.left .value');
    const rightBadge = gg.querySelector('.count-invisible-objects.right .value');
    const leftWrap  = gg.querySelector('.count-invisible-objects.left');
    const rightWrap = gg.querySelector('.count-invisible-objects.right');
    const items      = () => gg.querySelectorAll('.gallery-box .item');

    if (!leftBadge || !rightBadge) return;

    function updateCounts() {
      // Compare each item rect to the scroller's visible window
      const viewport = scroller.getBoundingClientRect();
      let left = 0, right = 0;

      items().forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.right <= viewport.left)  left++;       // fully left of view
        else if (r.left >= viewport.right) right++;  // fully right of view
      });

      leftBadge.textContent  = String(left);
      rightBadge.textContent = String(right);

      // hide when zero, like the grid counters
      if (leftWrap) {
        if (left === 0) leftWrap.setAttribute('aria-hidden', 'true');
        else leftWrap.removeAttribute('aria-hidden');
      }
      if (rightWrap) {
        if (right === 0) rightWrap.setAttribute('aria-hidden', 'true');
        else rightWrap.removeAttribute('aria-hidden');
      }
    }

    // Update on horizontal scroll of the scroller, and on resize
    scroller.addEventListener('scroll', updateCounts, { passive: true });
    window.addEventListener('resize', updateCounts);

    // Recalculate when images load (sizes change after load)
    gg.querySelectorAll('img').forEach(img => {
      if (!img.complete) img.addEventListener('load', updateCounts, { once: true });
    });

    // Initial calculate once the gallery is visible in layout
    requestAnimationFrame(updateCounts);

    // keep references for cleanup on close (optional)
    gg._updateCounts = updateCounts;
  }

  // hook into the same open/close lifecycle used for the fade-ins
  (window.__galleryIO__ ||= { onOpen(){}, onClose(){} });
  const prevOpen  = window.__galleryIO__.onOpen;
  const prevClose = window.__galleryIO__.onClose;

  window.__galleryIO__.onOpen = function() {
    prevOpen?.();
    attachCountersOnce();
    // ensure the counts reflect current scroll after opening
    gg._updateCounts?.();
  };

  window.__galleryIO__.onClose = function() {
    prevClose?.();
    // optional: nothing to detach (listeners can persist); if you want full cleanup:
    // window.removeEventListener('resize', gg._updateCounts);
    // gg._countsBound = false;
  };
})();


// --- Smooth "Explore" scroll (bind once on open) ---
(function bindExploreScroll(){
  const gg = document.getElementById('group-gallery');
  if (!gg || gg._exploreBound) return;
  gg._exploreBound = true;

  const btn     = gg.querySelector('#scroll-on');
  const target  = gg.querySelector('#gallery-scroll') || gg.querySelector('.gallery-box');

  if (!btn || !target) return;

  btn.addEventListener('click', (e) => {
    e.preventDefault(); // stop the page from jumping to the hash

    // Prefer element-based scroll; it uses the nearest scrollable ancestor (#group-gallery)
    if (target.scrollIntoView) {
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
      return;
    }

    // Fallback: manual horizontal scroll on the scroller
    const scroller = gg;
    const x = target.offsetLeft - scroller.offsetLeft;
    scroller.scrollTo({ left: x, top: 0, behavior: 'smooth' });
  });
})();

// --- Wheel → horizontal scroll in group/adhoc gallery ---
(function bindGalleryWheelHorizontalScroll() {
  if (!ENABLE_GALLERY_WHEEL_HORIZONTAL_SCROLL) return;

  const gg = document.getElementById('group-gallery');
  if (!gg || gg._wheelHorizBound) return;
  gg._wheelHorizBound = true;

  gg.addEventListener('wheel', (e) => {
    // If someone else already handled this event, do nothing
    if (e.defaultPrevented) return;

    // Keep OS/page zoom shortcuts working
    if (e.ctrlKey || e.metaKey) return;

    // Respect nested scrollable areas (other data-allow-scroll / .allow-scroll)
    const nestedScroller = e.target?.closest?.('[data-allow-scroll], .allow-scroll');
    if (nestedScroller && nestedScroller !== gg) {
      return; // let the nested scroller handle the wheel normally
    }

    const body = document.body;

    // Only when the gallery is actually active (real group or ad-hoc gallery)
    const galleryActive =
      gg.classList.contains('active') &&
      (body.classList.contains('in-group-gallery') ||
       body.classList.contains('in-adhoc-gallery'));

    if (!galleryActive) return;

    const maxScrollLeft = gg.scrollWidth - gg.clientWidth;
    if (maxScrollLeft <= 0) return; // nothing to scroll horizontally

    const { deltaX, deltaY } = e;

    // If the gesture is already mostly horizontal, let the browser handle it
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      return;
    }

    if (!deltaY) return;

    e.preventDefault();
    e.stopPropagation();

    // Map vertical wheel to horizontal scroll using the configured direction
    const horizontalDelta = deltaY * GALLERY_WHEEL_HORIZONTAL_DIRECTION;

    const nextLeft = Math.max(
      0,
      Math.min(gg.scrollLeft + horizontalDelta, maxScrollLeft)
    );
    gg.scrollLeft = nextLeft;
  }, { passive: false });
})();

// === Gallery back-button + history integration ===
{
  const gridShellEl    = document.getElementById('grid-shell');
  const groupGalleryEl = document.getElementById('group-gallery');

  // Ensure we only bind once
  if (!window.__galleryHistoryBound) {
    window.__galleryHistoryBound = true;

    // 1) Delegate click for the back button: go back in navigation if we created a gallery state;
    //    otherwise just close the gallery.
    document.addEventListener('click', (e) => {
      const back = e.target.closest('#content-back-button');
      if (!back) return;
      e.preventDefault();

      // If we pushed a gallery state, let browser back close it via popstate:
      if (history.state && history.state.gallery) {
        history.back();
      } else {
        // Fallback: close directly if no history state
        window.closeGallery?.();
      }
    }, true);

    // 2) Listen for back/forward to restore the grid when leaving the gallery state
    window.addEventListener('popstate', () => {
      const active = groupGalleryEl?.classList.contains('active');
      const stillInGallery = !!history.state?.gallery || location.hash === '#gallery' || location.hash === '#group-gallery';
      if (active && !stillInGallery) {
        window.closeGallery?.({ viaPopstate: true });
      }
    });
  }
}

// === Gallery videos: autoplay muted, sound on hover, pause when off-screen ===
(() => {
  const gg = document.getElementById('group-gallery');
  if (!gg) return;

  let io = null;
  let videos = [];

  function bindVideo(v) {
    // Attributes needed for autoplay on all browsers
    v.muted = true;
    v.loop = true;
    v.autoplay = true;                 // attribute; we'll still call play() via IO
    v.playsInline = true;              // iOS Safari
    v.controls = false;
    v.preload = 'metadata';

    // Sound on hover
    v.addEventListener('mouseenter', () => { v.muted = false; }, { passive: true });
    v.addEventListener('mouseleave', () => { v.muted = true;  }, { passive: true });
  }

  function onIO(entries){
    for(const en of entries){
      const v = en.target;
      if(en.isIntersecting){
  
        // ✅ Lazy-load: only set src when the video becomes visible
        if (v.dataset.loaded !== '1' && v.dataset.src) {
          v.src = v.dataset.src;
          v.preload = 'metadata';
          v.dataset.loaded = '1';
          try { v.load(); } catch {}
        }
  
        // existing behavior
        v.play().catch(()=>{});
      } else {
        v.pause();
        v.currentTime = 0;
      }
    }
  }  

  window.__galleryVideos__ = {
    onOpen() {
      // find all <video> elements inside the gallery
      videos = Array.from(gg.querySelectorAll('video'));
      videos.forEach(bindVideo);

      // Observe visibility (prefer the scroller if present)
      const root = gg.querySelector('.gallery-box') || gg;
      io = new IntersectionObserver(onIO, { root, threshold: 0.5 });
      videos.forEach(v => io.observe(v));
    },
    onClose() {
      if (io) { io.disconnect(); io = null; }
      videos.forEach(v => { try { v.pause(); } catch {} v.muted = true; });
      videos = [];
    }
  };
})();

// === Grid images: Ken Burns (only while visible; works in clustered/ungrouped) ===
(() => {
  // Grid media loader: lazy-load images when visible (Ken Burns is optional)
  const ENABLE_GRID_MEDIA_IO = true;
  const ENABLE_GRID_KEN_BURNS = false; // keep false unless you want the animation

  if (!ENABLE_GRID_MEDIA_IO) return;

  const grid = document.getElementById('grid');
  if (!grid) return;

  function randomKBVars() {
    const dirs = [
      { x0: '-4%', y0: '-3%', x1: ' 4%', y1: ' 3%' },
      { x0: ' 4%', y0: ' 3%', x1: '-4%', y1: '-3%' },
      { x0: ' 0%', y0: '-4%', x1: ' 0%', y1: ' 4%' },
      { x0: ' 0%', y0: ' 4%', x1: ' 0%', y1: '-4%' },
      { x0: '-4%', y0: ' 0%', x1: ' 4%', y1: ' 0%' },
      { x0: ' 4%', y0: ' 0%', x1: '-4%', y1: ' 0%' },
    ];
    const d = dirs[Math.floor(Math.random() * dirs.length)];
    const s0 = 1.05 + Math.random() * 0.02;
    const s1 = s0 + 0.05;
    const base = 10 + Math.random() * 3;          // was ~10–13s
    return { ...d, s0, s1, duration: (base / 2).toFixed(2) + 's' }; // now ~5–6.5s
  }

  function ensureKB(img) {
    if (!img) return null;
    if (img.closest('.kb-wrap')) return img;
    const wrap = document.createElement('div');
    wrap.className = 'kb-wrap';
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);
    img.classList.add('kb-img');
    return img;
  }

  // Lazy-load <img data-src="..."> only when it becomes visible.
  // (Grid tiles now set data-src and rely on this to avoid an eager request storm.)
  function ensureLazyLoad(img) {
    if (!img) return;
    const url = img.dataset && img.dataset.src;
    if (!url) return;
    if (img.dataset.loaded === '1') return;
  
    img.decoding = 'async';
    img.loading = 'lazy';
    img.src = url;
    img.dataset.loaded = '1';
  
    window.DEBUG_MEDIA && console.debug('[grid:lazyload]', url);
  }  

  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      const img = en.target;
  
      // ✅ Always lazy-load when visible
      if (en.isIntersecting) {
        ensureLazyLoad(img);
      }
  
      // Keep your KB logic (only useful once the image has a src / is loading)
      const kbImg = ensureKB(img);
      if (!kbImg) return;
  
      if (en.isIntersecting) {
        if (!kbImg.__kbInit) {
          const v = randomKBVars();
          const wrap = kbImg.closest('.kb-wrap');
          if (wrap) {
            wrap.style.setProperty('--kb-x0', v.x0);
            wrap.style.setProperty('--kb-y0', v.y0);
            wrap.style.setProperty('--kb-x1', v.x1);
            wrap.style.setProperty('--kb-y1', v.y1);
            wrap.style.setProperty('--kb-s0', String(v.s0));
            wrap.style.setProperty('--kb-s1', String(v.s1));
            wrap.style.setProperty('--kb-duration', v.duration);
          }
  
          // PRE-SEED so hover doesn't jump
          kbImg.style.transform = `translate(${v.x0}, ${v.y0}) scale(${v.s0})`;
  
          kbImg.__kbInit = true;
        }
  
        // ✅ We only need to observe until it becomes visible once
        if (!MEDIA_IO.unloadOnExit) {
          io.unobserve(img);
        }
      } else if (MEDIA_IO.unloadOnExit) {
        // Optional: free memory/network (only if you enable unloadOnExit)
        if (img.dataset && img.dataset.loaded === '1') {
          img.removeAttribute('src');
          img.dataset.loaded = '0';
        }
      }
    });
  }, { root: MEDIA_IO.root, threshold: MEDIA_IO.threshold, rootMargin: MEDIA_IO.rootMargin });  

  function observeAll() {
    // Images inside grid objects marked as image
    grid.querySelectorAll('.object.image img, .object[data-type="image"] img').forEach(img => io.observe(img));
  }

  // Initial pass
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeAll, { once: true });
  } else {
    observeAll();
  }

  // Watch for new/changed tiles (e.g., after Strapi loads or state switches)
  const mo = new MutationObserver((muts) => {
    muts.forEach(m => {
      m.addedNodes?.forEach(node => {
        if (node.nodeType !== 1) return;
        // ✅ Apply visited marker to newly inserted tiles
        if (node.matches?.('.object') && window.isObjectVisited?.(node.id)) {
          node.classList.add('is-visited');
        }
        node.querySelectorAll?.('.object').forEach(el => {
          if (window.isObjectVisited?.(el.id)) el.classList.add('is-visited');
        });
        node.querySelectorAll?.('.object.image img, .object[data-type="image"] img').forEach(img => io.observe(img));
        if (node.matches?.('.object.image img, .object[data-type="image"] img')) io.observe(node);
      });
    });
  });
  mo.observe(grid, { childList: true, subtree: true });
})();

// === Clicking a single item in the gallery opens the object detail ===
(function galleryItemToDetail() {
  const gg = document.getElementById('group-gallery');
  if (!gg) return;

  const box = gg.querySelector('.gallery-box');
  if (!box || box._detailBound) return;
  box._detailBound = true;

  box.addEventListener('click', (e) => {
    const item = e.target.closest('.item');
    if (!item) return;

    const oid = item.dataset.oid;
    if (!oid) return;

    const gid = (history.state && history.state.gid) ? history.state.gid : null;
    window.openObjectDetail?.({ objectId: oid, from: 'gallery', gid });
  });
})();

// START DEFINE CONTROLS

// FAB bindings
const fabGroup   = document.getElementById('fab-group');
const fabCluster = document.getElementById('fab-cluster');
const fabUngroup = document.getElementById('fab-ungroup');
const fabZoomIn  = document.getElementById('fab-zoom-in');
const fabZoomOut = document.getElementById('fab-zoom-out');
const fabFitAll  = document.getElementById('fab-fit-all');

// --- Grid mode persistence + unified switching ---
// --- Grid mode persistence + unified switching ---
// Optional override without touching code:
//   window.GRID_MODE_CONFIG = { persistToLocalStorage: true, storageKey: 'app:gridMode' };
const GRID_MODE_CONFIG = {
  persistToLocalStorage: false,      // ✅ disabled for now
  storageKey: 'app:gridMode',
  clearStorageWhenDisabled: true,    // remove old stored value so it never “comes back”
  ...(typeof window !== 'undefined' && window.GRID_MODE_CONFIG && typeof window.GRID_MODE_CONFIG === 'object'
    ? window.GRID_MODE_CONFIG
    : {}),
};

const GRID_MODE_STORAGE_KEY = String(GRID_MODE_CONFIG.storageKey || 'app:gridMode');

// If persistence is disabled, optionally clear any previously stored mode
if (!GRID_MODE_CONFIG.persistToLocalStorage && GRID_MODE_CONFIG.clearStorageWhenDisabled) {
  try { localStorage.removeItem(GRID_MODE_STORAGE_KEY); } catch (_) {}
}

const GRID_MODES = Object.freeze({
  GROUP: 'group',
  CLUSTER: 'cluster',
  UNGROUP: 'ungroup',
});

// --- Visited objects persistence (for grid dot indicator) ---
// Optional override without touching code:
//   window.VISITED_CONFIG = { storageKey: 'app:visitedObjects:v1', max: 2000 };
const VISITED_CONFIG = {
  storageKey: 'app:visitedObjects:v1',
  max: 2000,
  ...(typeof window !== 'undefined' && window.VISITED_CONFIG && typeof window.VISITED_CONFIG === 'object'
    ? window.VISITED_CONFIG
    : {}),
};

const VISITED = (() => {
  const key = String(VISITED_CONFIG.storageKey || 'app:visitedObjects:v1');
  const max = Math.max(1, Number(VISITED_CONFIG.max) || 2000);

  const load = () => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return new Set();
      return new Set(arr.map(v => String(v)));
    } catch {
      return new Set();
    }
  };

  const save = (set) => {
    try {
      localStorage.setItem(key, JSON.stringify([...set]));
    } catch {}
  };

  const ids = load();

  const cap = () => {
    while (ids.size > max) {
      const oldest = ids.values().next().value; // Set preserves insertion order
      ids.delete(oldest);
    }
  };

  const findGridTile = (id) => {
    const sid = String(id);
  
    // Prefer the grid tile to avoid accidental id collisions elsewhere
    const grid = document.getElementById('grid');
    if (grid && window.CSS?.escape) {
      const inGrid = grid.querySelector(`.object#${CSS.escape(sid)}`);
      if (inGrid) return inGrid;
    }
  
    // Fallback (older browsers / no grid yet)
    return document.getElementById(sid);
  };
  
  const applyToDom = (id) => {
    const el = findGridTile(id);
    if (el) el.classList.add('is-visited');
    return !!el;
  };
  
  // Retry a few frames in case tiles are re-mounted right after view transitions
  const applyToDomEventually = (id, maxFrames = 20) => {
    let frames = 0;
    const tick = () => {
      if (applyToDom(id)) return;
      if (++frames >= maxFrames) return;
      requestAnimationFrame(tick);
    };
    tick();
  };  

  return {
    has(id) {
      return ids.has(String(id));
    },
    mark(id) {
      const sid = String(id ?? '').trim();
      if (!sid) return;
    
      if (!ids.has(sid)) {
        ids.add(sid);
        cap();
        save(ids);
      }
    
      applyToDomEventually(sid);
    
      // ✅ Retry once on next frame in case the grid tile is re-created / re-mounted
      // (e.g., state switches, closing overlays, etc.)
      requestAnimationFrame(() => applyToDom(sid));
    },    
    applyAllToDom() {
      for (const id of ids) applyToDomEventually(id);
    }
  };
})();

// small global API for other modules (grid.js) + click paths
window.isObjectVisited = (id) => VISITED.has(id);
window.markObjectVisited = (id) => VISITED.mark(id);
window.applyVisitedMarkers = () => VISITED.applyAllToDom();

// Map Grid.currentState -> our UI modes
function gridStateToMode(state) {
  if (state === 'grouped') return GRID_MODES.GROUP;
  if (state === 'clustered' || state === 'pre-cluster') return GRID_MODES.CLUSTER;
  if (state === 'ungrouped') return GRID_MODES.UNGROUP;
  return null;
}

function getStoredGridMode() {
  if (!GRID_MODE_CONFIG.persistToLocalStorage) return null;
  try {
    const v = localStorage.getItem(GRID_MODE_STORAGE_KEY);
    return (v === GRID_MODES.GROUP || v === GRID_MODES.CLUSTER || v === GRID_MODES.UNGROUP) ? v : null;
  } catch (_) {
    return null;
  }
}

function setStoredGridMode(mode) {
  if (!GRID_MODE_CONFIG.persistToLocalStorage) return;
  try { localStorage.setItem(GRID_MODE_STORAGE_KEY, mode); } catch (_) {}
}

// Single entry point for changing modes (used by FAB clicks + restore)
function applyGridMode(mode, { persist = GRID_MODE_CONFIG.persistToLocalStorage } = {}) {
  if (!window.gridObject) return;

  const m =
    (mode === 'grouped') ? GRID_MODES.GROUP :
    (mode === 'clustered' || mode === 'pre-cluster') ? GRID_MODES.CLUSTER :
    (mode === 'ungrouped') ? GRID_MODES.UNGROUP :
    mode;

  if (m === GRID_MODES.GROUP)   window.gridObject.groupObjects();
  if (m === GRID_MODES.CLUSTER) window.gridObject.clusterGroupedObjects();
  if (m === GRID_MODES.UNGROUP) window.gridObject.ungroupObjects();

  // Keep all UI in sync
  markActive(m);

  // Mode switches should behave like FAB clicks (keep existing UX consistent)
  if (typeof setFitAllIconDone === 'function') setFitAllIconDone(false);
  if (typeof refreshSlideInsVisibility === 'function') refreshSlideInsVisibility();
  if (typeof scheduleOffgridUpdate === 'function') scheduleOffgridUpdate();

  if (persist) setStoredGridMode(m);
}

function restoreGridModeFromStorage() {
  const stored = getStoredGridMode();
  if (stored) {
    applyGridMode(stored, { persist: true });
    return;
  }
  // No stored mode: reflect whatever grid is currently in (default is grouped)
  const current = gridStateToMode(window.gridObject?.currentState) || GRID_MODES.GROUP;
  markActive(current);
  if (GRID_MODE_CONFIG.persistToLocalStorage) setStoredGridMode(current);  
}

fabGroup?.addEventListener('click',  (e) => { e.preventDefault(); applyGridMode(GRID_MODES.GROUP);   });
fabCluster?.addEventListener('click',(e) => { e.preventDefault(); applyGridMode(GRID_MODES.CLUSTER); });
fabUngroup?.addEventListener('click',(e) => { e.preventDefault(); applyGridMode(GRID_MODES.UNGROUP); });
fabZoomIn?.addEventListener('click', (e) => { e.preventDefault(); gridObject.zoomIn(); });
fabZoomOut?.addEventListener('click',(e) => { e.preventDefault(); gridObject.zoomOut(); });

function runGridViewSwitcherTeaserOnceWhenVisible(switcher) {
  const DEBUG_TEASER = !!window.DEBUG_GRID_TEASER;
  const tlog = (...a) => { if (DEBUG_TEASER) console.log('[grid teaser]', ...a); };

  if (!switcher) {
    tlog('init: switcher not found (null/undefined) -> teaser cannot arm');
    return;
  }

  // Allow teaser again on future page loads (no localStorage "seen" gating)
  // Still run only once per page load.
  let hasRunThisLoad = false;
  tlog('init');

  // Respect reduced-motion
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;

  // avoid double-arm in one page load
  if (switcher.dataset.teaserArmed === '1') return;
  switcher.dataset.teaserArmed = '1';

  const isUserInteracting = () =>
    switcher.matches(':hover') || switcher.contains(document.activeElement);

  const isLoadingComplete = () =>
    (typeof LOADING?.isComplete === 'function')
      ? LOADING.isComplete()
      : isPreloadGone(); // fallback if LOADING isn't present
  
  const isPrepageGone = () => {
    const prepage = document.getElementById('prepage');
    return !document.body.classList.contains('has-prepage') &&
           (!prepage || prepage.classList.contains('is-hidden'));
  };  

  const isPreloadGone = () => {
    const preload = document.getElementById('preload');
    // LOADING.fadeOut() adds .is-hidden and removes body.has-preload after fade
    return (!preload || preload.classList.contains('is-hidden')) &&
           !document.body.classList.contains('has-preload');
  };

  const isSwitcherVisible = () => {
    const st = getComputedStyle(switcher);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    if (switcher.offsetParent === null) return false;
    return switcher.getClientRects().length > 0;
  };

  const isInGridState = () => {
    const gs = window.gridObject?.currentState || null;
    return ['grouped', 'clustered', 'ungrouped', 'pre-cluster'].includes(gs);
  };

  const openThenClose = () => {
    tlog('OPEN');
  
    hasRunThisLoad = true;
    switcher.classList.add('is-demo-open');    
  
    setTimeout(() => {
      if (isUserInteracting()) return;
      switcher.classList.remove('is-demo-open');
      tlog('CLOSE');
    }, 1600);
  };  

  const tryRun = () => {
    const status = {
      hasRunThisLoad,
      loadingComplete: isLoadingComplete(),
      preloadGone: isPreloadGone(),
      prepageGone: isPrepageGone(),
      inGridState: isInGridState(),
      switcherVisible: isSwitcherVisible(),
      userInteracting: isUserInteracting(),
    };
    
    tlog('tryRun()', status);
    
    if (hasRunThisLoad) return;    
    if (!status.loadingComplete) return;
    if (!status.preloadGone) return;
    if (!status.prepageGone) return;
    if (!status.inGridState) return;
    if (!status.switcherVisible) return;
    if (status.userInteracting) return;
  
    tlog('✅ TRIGGERING teaser now (openThenClose)');
    openThenClose();
  };  

  // Run AFTER the DOM/CSS state has actually painted (prevents false "not visible" checks)
  const afterPaint = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

  // Run when the app changes view/state
  const onViewChange = () => afterPaint(tryRun);
  document.addEventListener('app:viewchange', onViewChange);

  // Run right after the prepage is fully closed (grid is actually visible)
  const onPrepageClosed = () => afterPaint(tryRun);
  document.addEventListener('app:prepageclosed', onPrepageClosed);

  // Run right after the preload overlay is truly gone
  const onPreloadHidden = () => afterPaint(tryRun);
  document.addEventListener('app:preloadhidden', onPreloadHidden);

  // Run right after loading completes
  let unsubLoading = null;
  if (typeof LOADING?.onComplete === 'function') {
    unsubLoading = LOADING.onComplete(() => afterPaint(tryRun));
  }

  // One immediate attempt (covers "no prepage" / already-ready cases)
  afterPaint(tryRun);

}

// Cache so we fetch/parse the same SVG only once per page load
const __INLINE_SVG_CACHE = new Map();

async function inlineSvgImgToCurrentColor(img) {
  if (!img || img.tagName?.toLowerCase() !== 'img') return;

  const src = img.getAttribute('src');
  if (!src || !src.toLowerCase().endsWith('.svg')) return;

  // Use cached parsed SVG if available
  const cached = __INLINE_SVG_CACHE.get(src);
  if (cached) {
    img.replaceWith(cached.cloneNode(true));
    return;
  }

  try {
    const res = await fetch(src, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return;

    // Make the SVG inherit theme color like your other inline icons
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('stroke', 'currentColor');

    // Normalize child attributes (preserve "none")
    svg.querySelectorAll('[fill]').forEach(el => {
      const v = (el.getAttribute('fill') || '').trim().toLowerCase();
      if (v && v !== 'none') el.setAttribute('fill', 'currentColor');
    });
    svg.querySelectorAll('[stroke]').forEach(el => {
      const v = (el.getAttribute('stroke') || '').trim().toLowerCase();
      if (v && v !== 'none') el.setAttribute('stroke', 'currentColor');
    });

    // Let CSS control size (same as your option-icon cloning logic)
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('focusable', 'false');

    // Replace <img> and cache
    __INLINE_SVG_CACHE.set(src, svg.cloneNode(true));
    img.replaceWith(svg);
  } catch (err) {
    console.warn('[view-switcher] failed to inline svg', src, err);
    // If it fails, we keep the <img> as-is (no breakage)
  }
}

function initViewSwitcher(switcherId, bindings, { onActivate, enableTeaser = false } = {}) {
  const switcher = document.getElementById(switcherId);
  if (!switcher) return;

  let closeOnLeaveAfterSelection = false;

  bindings.forEach(({ targetId }) => {
    const targetFab = document.getElementById(targetId);
    const btn = switcher.querySelector(`.view-switcher-btn[data-target-fab="${targetId}"]`);
    if (!targetFab || !btn) return;

    // Reuse the existing icon by cloning it (avoids duplicating SVG markup)
    const iconSource = targetFab.querySelector('svg, img');
    if (iconSource) {
      const clone = iconSource.cloneNode(true);

      // Let CSS control sizing
      if (clone.tagName?.toLowerCase() === 'svg' || clone.tagName?.toLowerCase() === 'img') {
        clone.removeAttribute('width');
        clone.removeAttribute('height');
      }

      btn.replaceChildren(clone);
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      closeOnLeaveAfterSelection = true;
      onActivate?.(targetFab, targetId);
    });
  });

  // Click main icon again to close the switcher (even if still hovered/focused)
  const toggleBtn = switcher.querySelector('.view-switcher-toggle');
  if (toggleBtn) {
    inlineSvgImgToCurrentColor(toggleBtn.querySelector('img'));

    const isExpanded = () =>
      switcher.classList.contains('is-demo-open') ||
      switcher.matches(':hover') ||
      switcher.contains(document.activeElement);

    toggleBtn.addEventListener('click', (e) => {
      const forced = switcher.classList.contains('is-force-collapsed');

      if (!forced && isExpanded()) {
        e.preventDefault();
        e.stopPropagation();

        switcher.classList.remove('is-demo-open');
        switcher.classList.add('is-force-collapsed');

        // remove focus so :focus-within won't keep it open
        toggleBtn.blur();
        if (switcher.contains(document.activeElement)) {
          document.activeElement?.blur?.();
        }
        return;
      }

      if (forced) {
        switcher.classList.remove('is-force-collapsed');
      }
    });

    // Close after a selection once the mouse leaves (fixes :focus-within “sticky open”)
    switcher.addEventListener('mouseleave', () => {
      switcher.classList.remove('is-force-collapsed');

      if (!closeOnLeaveAfterSelection) return;
      closeOnLeaveAfterSelection = false;

      switcher.classList.remove('is-demo-open');
      if (switcher.contains(document.activeElement)) {
        document.activeElement?.blur?.();
      }
    });
  }

  if (enableTeaser) {
    if (window.DEBUG_GRID_TEASER) console.log('[grid teaser] initViewSwitcher() calling teaser with switcher=', switcher);
    runGridViewSwitcherTeaserOnceWhenVisible(switcher);
  }
}

function initGridViewSwitcher() {
  initViewSwitcher(
    'grid-view-switcher',
    [
      { targetId: 'fab-group' },
      { targetId: 'fab-cluster' },
      { targetId: 'fab-ungroup' },
    ],
    {
      enableTeaser: true,
      onActivate: (targetFab) => targetFab.click(),
    }
  );
}

function initGalleryViewSwitcher() {
  initViewSwitcher(
    'gallery-view-switcher',
    [
      { targetId: 'fab-group' },
      { targetId: 'fab-cluster' },
      { targetId: 'fab-ungroup' },
    ],
    {
      onActivate: (targetFab) => {
        const body = document.body;
        const isGroupGallery =
          body.classList.contains('in-group-gallery') &&
          !body.classList.contains('in-adhoc-gallery');

        // Only act in the real group gallery, never in the ad-hoc "tags" gallery
        if (!isGroupGallery) return;

        // 1) Close the gallery
        window.closeGallery?.();

        // 2) Switch the main grid mode (after gallery closes/restores)
        setTimeout(() => targetFab.click(), 0);
      },
    }
  );
}

initGridViewSwitcher();
initGalleryViewSwitcher();

function setFitAllIconDone(done, reason = '') {
  if (!fabFitAll) return;

  fabFitAll.classList.toggle('is-fit-done', !!done);
  fabFitAll.dataset.fitStateReason = done ? (reason || 'manual') : '';

  // Make the second-click behavior discoverable
  const label = done ? 'Reset Zoom' : 'Fit All';
  //fabFitAll.title = label;
  fabFitAll.setAttribute('aria-label', label);
}

function syncVisitedDotScaleFromZoom(z) {
  const zoom = Number(z);
  const scale = Number.isFinite(zoom) ? Math.min(1, Math.max(0, zoom)) : 1;

  // scale is unitless (e.g. 1, 0.75, 0.5)
  document.documentElement.style.setProperty('--visited-dot-scale', String(scale));
}

function syncFabFitAllOnZoom(e) {
  const go = window.gridObject;
  const detail = e?.detail || {};

  const z = detail.zoom ?? go?.zoomLevel ?? 1;
  syncVisitedDotScaleFromZoom(z);

  if (!fabFitAll || !go) return;

  const minZ = detail.minZoom ?? go.display?.minZoom ?? 0.25;
  const source = detail.source || '';
  const eps = 1e-3;

  const atMin = z <= (minZ + eps);
  const reason = fabFitAll.dataset.fitStateReason || '';

  // If user changes zoom after Fit All (wheel/pinch/button), revert icon back to Fit All
  const isUserZoom = (source === 'wheel' || source === 'pinch' || source === 'button');

  if (reason === 'fitall' && isUserZoom) {
    if (atMin) {
      setFitAllIconDone(true, 'minZoom');
    } else {
      setFitAllIconDone(false);
    }
  }

  // Your existing min-zoom behavior
  if (atMin) {
    if (!fabFitAll.classList.contains('is-fit-done')) {
      setFitAllIconDone(true, 'minZoom');
    }
  } else {
    if (reason === 'minZoom') {
      setFitAllIconDone(false);
    }
  }
}

// Listen to zoom changes from Grid.zoom(...)
document.getElementById('grid')?.addEventListener('grid:zoom', syncFabFitAllOnZoom);


fabFitAll?.addEventListener('click', (e) => {
  e.preventDefault();
  if (!gridObject) return;

  const isDone = fabFitAll.classList.contains('is-fit-done');

  if (!isDone) {
    // 1st click: fit everything into view
    gridObject.fitAll(120);
    setFitAllIconDone(true, 'fitall');
  } else {
    // 2nd click: return to your configured base zoom (Grid.display.baseZoom)
    if (typeof gridObject.resetZoomToBase === 'function') {
      gridObject.resetZoomToBase(true);
    } else {
      // Fallback (shouldn't happen): snap to 1x
      gridObject.setZoomAbsolute?.(1, { center: true, animate: true });
    }
    setFitAllIconDone(false);
  }

  // Keep counters/offsets in sync with the new camera state
  scheduleOffgridUpdate?.();
});

// Recalculate counters after any camera/state change
;[fabGroup, fabCluster, fabUngroup, fabZoomIn, fabZoomOut].forEach(btn => btn?.addEventListener('click', scheduleOffgridUpdate));

// Mode switches always reset the FitAll/ResetZoom affordance
;[fabGroup, fabCluster, fabUngroup].forEach(btn =>
  btn?.addEventListener('click', () => setFitAllIconDone(false))
);

// Zoom buttons should only clear the "done" icon if it was set by Fit All,
// not if it was set automatically because we hit min zoom.
;[fabZoomIn, fabZoomOut].forEach(btn =>
  btn?.addEventListener('click', () => {
    if (fabFitAll?.dataset.fitStateReason === 'fitall') {
      setFitAllIconDone(false);
    }
  })
);

// Optional: highlight active mode button (purely visual)
function markActive(which) {
  // FABs
  [fabGroup, fabCluster, fabUngroup].forEach(btn => btn?.classList.remove('is-active'));
  if (which === GRID_MODES.GROUP)   fabGroup?.classList.add('is-active');
  if (which === GRID_MODES.CLUSTER) fabCluster?.classList.add('is-active');
  if (which === GRID_MODES.UNGROUP) fabUngroup?.classList.add('is-active');

  // View switcher icons (data-target-fab comes from index.html)
  const switcher = document.getElementById('grid-view-switcher');
  const btns = switcher?.querySelectorAll?.('.view-switcher-btn') || [];
  btns.forEach((btn) => {
    const targetId = btn.getAttribute('data-target-fab');
    const mode =
      (targetId === 'fab-group') ? GRID_MODES.GROUP :
      (targetId === 'fab-cluster') ? GRID_MODES.CLUSTER :
      (targetId === 'fab-ungroup') ? GRID_MODES.UNGROUP :
      null;

    const on = (mode && mode === which);
    btn.classList.toggle('is-active', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

document.getElementById('reset-grid')?.addEventListener('click', (e) => {
  e.preventDefault();
  gridObject.resetGrid();
});

// END DEFINE CONTROLS

// ===== Off-grid Debug Harness =====
window.OFFGRID = window.OFFGRID || {};
const OFFGRID = window.OFFGRID;
OFFGRID.debug = OFFGRID.debug || new URLSearchParams(location.search).has('debug');
OFFGRID.log = (...args) => { if (OFFGRID.debug) console.debug('[offgrid]', ...args); };
OFFGRID.table = (rows) => { if (OFFGRID.debug && rows?.length) console.table(rows); };
OFFGRID.version = 'offgrid-debug-2025-09-16-01';

OFFGRID.flash = (el, color = 'magenta') => {
  if (!el) return;
  el.classList.add('offgrid-highlight');
  el.style.setProperty('--offgrid-highlight-color', color);
  setTimeout(() => el.classList.remove('offgrid-highlight'), 900);
};

// quick helpers you can call from console
window.testOffgrid = (dir, tag=null) => flyToNearest?.(dir, tag);
window.scanOffgrid = (dir=null, tag=null) => {
  const out = __collectOffscreenCandidates({tag});
  OFFGRID.table(out.map(x => ({
    id: x.id, side: x.side, sep: Math.round(x.sep),
    dCenter: Math.round(x.dCenter),
    dxL: Math.round(x.dxL), dxR: Math.round(x.dxR), dyT: Math.round(x.dyT), dyB: Math.round(x.dyB)
  })));
  if (dir) OFFGRID.log('filtered', dir, out.filter(x => x.side === dir).map(x => x.id));
  return out;
};

// --- Off-grid counters (Top/Bottom/Left/Right) ---
const workspaceEl = document.getElementById('workspace');
const gridEl = document.getElementById('grid');
// === Off-grid counters (performance toggle) ===
// TEMP: set to false to disable counters and all their observers (useful for performance debugging)
const OFFGRID_COUNTERS_ENABLED = true;
const counters = {
  top:    document.getElementById('offgrid-top'),
  bottom: document.getElementById('offgrid-bottom'),
  left:   document.getElementById('offgrid-left'),
  right:  document.getElementById('offgrid-right'),
};

if (!OFFGRID_COUNTERS_ENABLED) {
  Object.values(counters).forEach(n => n?.setAttribute('aria-hidden', 'true'));
}

function scheduleOffgridUpdate() {
  if (!OFFGRID_COUNTERS_ENABLED) return;
  if (scheduleOffgridUpdate._raf) return;
  scheduleOffgridUpdate._raf = requestAnimationFrame(() => {
    scheduleOffgridUpdate._raf = null;
    updateOffgridCounters();
    // Keep offset in sync in case layout changed during pan/zoom flows
    updateRightCounterOffset();
  });
}

function updateOffgridCounters() {
  if (!OFFGRID_COUNTERS_ENABLED) return;
  if (!workspaceEl || !gridEl) return;

  // NEW: hide counters in grouped grid view
  const state = window.gridObject?.currentState;
  if (state === 'grouped') {
    Object.values(counters).forEach(n => n?.setAttribute('aria-hidden', 'true'));
    return; // skip measuring/rendering while grouped
  }

  const vp = workspaceEl.getBoundingClientRect();
  const items = Array.from(gridEl.querySelectorAll('.object'));

  const themeFilter = window.activeThemeFilter || null;
  let themeMatchesById = null;
  if (themeFilter && typeof window.objectsMatchingTheme === 'function') {
    const objs = window.objectsMatchingTheme(themeFilter) || [];
    themeMatchesById = new Set(objs.map(o => String(o.id)));
  }

  const data = {
    top: { total: 0, perTag: {} },
    bottom: { total: 0, perTag: {} },
    left: { total: 0, perTag: {} },
    right: { total: 0, perTag: {} },
  };
  //const selectedTags = Array.from((typeof activeTags !== 'undefined' ? activeTags : new Set()));
  let selectedTags = Array.from((typeof activeTags !== 'undefined' ? activeTags : new Set()));
  // Ignore tags currently disabled in the UI (defensive; clicks are already blocked)
  const disabledNow = new Set(
    Array.from(document.querySelectorAll('#tags-visible li.disabled,[aria-disabled="true"]'))
         .map(li => li.dataset.tag)
  );
  selectedTags = selectedTags.filter(t => !disabledNow.has(t));

  for (const el of items) {
    const r = el.getBoundingClientRect();
    // Skip if any overlap with viewport (i.e., at least partly visible)
    const overlaps = !(r.right <= vp.left || r.left >= vp.right || r.bottom <= vp.top || r.top >= vp.bottom);
    if (overlaps) continue;

    // If we are in theme-filter mode, only count objects that match the theme
    if (themeFilter && themeMatchesById && !themeMatchesById.has(el.id)) {
      continue;
    }

    // Measure "how far outside" ...
    const dTop    = Math.max(vp.top    - r.bottom, 0);
    const dBottom = Math.max(r.top     - vp.bottom, 0);
    const dLeft   = Math.max(vp.left   - r.right, 0);
    const dRight  = Math.max(r.left    - vp.right, 0);
    let dir = 'top', maxD = dTop;
    if (dBottom > maxD) { dir = 'bottom'; maxD = dBottom; }
    if (dLeft   > maxD) { dir = 'left';   maxD = dLeft; }
    if (dRight  > maxD) { dir = 'right';  maxD = dRight; }

    data[dir].total++;
    if (selectedTags.length) {
      const tags = (el.dataset.tags || '').split(',').filter(Boolean);
      for (const t of selectedTags) {
        if (tags.includes(t)) data[dir].perTag[t] = (data[dir].perTag[t] || 0) + 1;
      }
    }
  }

  const render = (dir) => {
    const node = counters[dir];
    if (!node) return;
    const { total, perTag } = data[dir];
    const valueEl = node.querySelector('.value');
    if (valueEl) valueEl.textContent = String(total);

    // Clear previous breakdown (inside rot if present)
    const host = node.querySelector('.rot') || node;
    host.querySelector('.breakdown')?.remove();
    if (total === 0) {
      node.setAttribute('aria-hidden', 'true');
      return;
    }
    node.removeAttribute('aria-hidden');

    // Default: no breakdown → ensure class is off
    host.classList.remove('has-breakdown');

    if (selectedTags.length) {
      host.classList.add('has-breakdown');
      const wrap = document.createElement('span');
      wrap.className = 'breakdown';
    
      for (const t of selectedTags) {
        const n = perTag[t] || 0;
    
        // separator
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = ' / ';
        wrap.appendChild(sep);
    
        // ONE CLICKABLE SEGMENT per tag
        const seg = document.createElement('span');
        seg.className = 'offgrid-seg';
        seg.setAttribute('role', 'button');
        seg.tabIndex = 0;
        seg.dataset.dir = dir;
        seg.dataset.tag = t;
        seg.title = n > 0
          ? `Show nearest ${dir} item with tag “${t}”`
          : `No ${dir} items with tag “${t}”`;
        seg.dataset.cursorLabel = 'scroll to nearest item';
        if (!n) seg.classList.add('is-zero');
    
        // number
        const cnt = document.createElement('span');
        cnt.className = 'tag-count';
        cnt.textContent = String(n);
        if (typeof tagColors !== 'undefined' && tagColors[t]) {
          cnt.style.color = tagColors[t];
        }
        seg.appendChild(cnt);
    
        // dot
        const dot = document.createElement('span');
        dot.className = 'tag-dot';
        dot.textContent = ' •';
        if (typeof tagColors !== 'undefined' && tagColors[t]) {
          dot.style.color = tagColors[t];
        }
        seg.appendChild(dot);
    
        wrap.appendChild(seg);
      }
      host.appendChild(wrap);

      const valueEl = node.querySelector('.value');
      if (valueEl) {
        valueEl.textContent = String(total);
        // make totals clickable
        valueEl.classList.add('offgrid-total');
        valueEl.dataset.dir = dir;
        valueEl.title = total > 0
          ? `Show nearest ${dir} item`
          : `No ${dir} items`;
        valueEl.dataset.cursorLabel = 'scroll to nearest item';
      }
    }    
  };

  // right before render('top'), render('bottom'), ...
  OFFGRID.lastCounters = JSON.parse(JSON.stringify(data));
  OFFGRID.log('counters snapshot', OFFGRID.lastCounters);

  render('top'); render('bottom'); render('left'); render('right');

  // after render(...) calls
  // Attach once, outside of any render cycle
  (function bindOffgridDelegates(){
    const root = document.getElementById('workspace');
    if (!root || root._offgridDelegatesBound) return;
    root._offgridDelegatesBound = true;

    root.addEventListener('click', (e) => {
      const hit = e.target.closest('.offgrid-seg, .offgrid-total');
      if (!hit) return;
    
      const container = hit.closest('.count-invisible-objects');
      const dir = hit.dataset.dir || (container ? container.id.replace('offgrid-','') : null);
      const tag = hit.classList.contains('offgrid-seg') ? (hit.dataset.tag || null) : null;
    
      OFFGRID.log('CLICK', { dir, tag, el: hit });
    
      // show what counters think for that dir/tag
      const perDir = OFFGRID.lastCounters?.[dir];
      if (perDir) {
        const n = tag ? (perDir.perTag?.[tag] || 0) : perDir.total;
        OFFGRID.log('counters say', { dir, tag, count: n });
      } else {
        OFFGRID.log('no counter snapshot for', dir);
      }
    
      flyToNearest(dir, tag);
    });    

    // keyboard: Enter/Space on focused segments
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const hit = e.target.closest('.offgrid-seg, .offgrid-total');
      if (!hit) return;
      e.preventDefault();
      const container = hit.closest('.count-invisible-objects');
      const dir = hit.dataset.dir || (container ? container.id.replace('offgrid-','') : null);
      const tag = hit.classList.contains('offgrid-seg') ? hit.dataset.tag || null : null;
      if (dir) flyToNearest(dir, tag);
    });
  })();

}

// === Off-grid navigation helpers ===

function worldCenterForObject(obj) {
  const state = window.gridObject?.currentState || 'ungrouped';
  if (state === 'clustered' && obj.cluster_x != null && obj.cluster_y != null) {
    return { x: obj.cluster_x + obj.width / 2, y: obj.cluster_y + obj.height / 2 };
  }
  if ((state === 'grouped' || state === 'pre-cluster') && obj.group_x != null && obj.group_y != null) {
    return { x: obj.group_x + obj.width / 2, y: obj.group_y + obj.height / 2 };
  }

  // compute, then (optionally) log
  const x = obj.grid_x + obj.width / 2;
  const y = obj.grid_y + obj.height / 2;
  OFFGRID.log('world center for', obj.id, 'state=', window.gridObject?.currentState, { x, y });
  return { x, y };
}

function __collectOffscreenCandidates({ tag = null } = {}) {
  const workspaceEl = document.getElementById('workspace');
  const gridEl = document.getElementById('grid');
  if (!workspaceEl || !gridEl) return [];

  const vp = workspaceEl.getBoundingClientRect();
  const eps = 0.5;

  const vcx = (vp.left + vp.right) / 2;
  const vcy = (vp.top  + vp.bottom) / 2;

  const out = [];
  for (const el of gridEl.querySelectorAll('.object')) {
    const r = el.getBoundingClientRect();

    // fully outside?
    const fullyOff =
      (r.right <= vp.left + eps)  || // left
      (r.left  >= vp.right - eps) || // right
      (r.bottom<= vp.top  + eps)  || // top
      (r.top   >= vp.bottom - eps);  // bottom
    if (!fullyOff) continue;

    if (tag) {
      const tags = (el.dataset.tags || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!tags.includes(tag)) continue;
    }

    const dxL = vp.left - r.right;
    const dxR = r.left - vp.right;
    const dyT = vp.top  - r.bottom;
    const dyB = r.top  - vp.bottom;

    let side = 'left', sep = dxL;
    if (dxR > sep) { side = 'right'; sep = dxR; }
    if (dyT > sep) { side = 'top';   sep = dyT; }
    if (dyB > sep) { side = 'bottom'; sep = dyB; }

    const cx = (r.left + r.right) / 2;
    const cy = (r.top  + r.bottom) / 2;
    const dCenter = Math.hypot(cx - vcx, cy - vcy);

    out.push({ el, id: el.id, side, sep, dCenter, dxL, dxR, dyT, dyB, rect: r });
  }
  return out;
}

function findNearestOffscreen({ dir, tag = null }) {
  const workspaceEl = document.getElementById('workspace');
  const gridEl = document.getElementById('grid');
  if (!workspaceEl || !gridEl) return null;

  const vp = workspaceEl.getBoundingClientRect();
  let best = { el: null, d: Infinity };

  const items = Array.from(gridEl.querySelectorAll('.object'));
  for (const el of items) {
    const r = el.getBoundingClientRect();

    // must be fully off-screen
    const overlaps = !(r.right <= vp.left || r.left >= vp.right || r.bottom <= vp.top || r.top >= vp.bottom);
    if (overlaps) continue;

    // classify side exactly like the counters do
    const dTop    = Math.max(vp.top    - r.bottom, 0);
    const dBottom = Math.max(r.top     - vp.bottom, 0);
    const dLeft   = Math.max(vp.left   - r.right, 0);
    const dRight  = Math.max(r.left    - vp.right, 0);

    let side = 'top', maxD = dTop;
    if (dBottom > maxD) { side = 'bottom'; maxD = dBottom; }
    if (dLeft   > maxD) { side = 'left';   maxD = dLeft;   }
    if (dRight  > maxD) { side = 'right';  maxD = dRight;  }

    if (side !== dir) continue;

    if (tag) {
      const tags = (el.dataset.tags || '').split(',').map(s=>s.trim()).filter(Boolean);
      if (!tags.includes(tag)) continue;
    }

    // “nearest” = smallest distance to viewport center
    const cx = (r.left + r.right) / 2;
    const cy = (r.top  + r.bottom) / 2;
    const vcx = (vp.left + vp.right) / 2;
    const vcy = (vp.top  + vp.bottom) / 2;
    const d = Math.hypot(cx - vcx, cy - vcy);

    if (d < best.d) best = { el, d };
  }

  return best.el; // ← IMPORTANT: return the element (not id)
}

function flyToNearest(dir, tag = null) {
  // 0) sanity + debug
  const el = findNearestOffscreen({ dir, tag });
  if (!el) { console.debug('[offgrid] no target element', { dir, tag }); return; }

  const grid = document.getElementById('grid');
  const zoom = window.gridObject?.zoomLevel || 1;
  const left = parseFloat(grid?.style.left) || 0;
  const top  = parseFloat(grid?.style.top)  || 0;

  // 1) try to resolve the object from the data model
  const id  = el.id;
  const obj = window.gridObject?.objects?.find(o => o.id === id);

  let world;
  if (obj) {
    world = worldCenterForObject(obj);  // uses state-aware world coords
    console.debug('[offgrid] target via model', { id, state: window.gridObject?.currentState, world });
  } else {
    // 2) fallback: infer world coords from the DOM rect
    const r  = el.getBoundingClientRect();
    const cx = (r.left + r.right) / 2;
    const cy = (r.top  + r.bottom) / 2;
    world = { x: (cx - left) / zoom, y: (cy - top) / zoom };
    console.debug('[offgrid] model miss → using DOM fallback', { id, zoom, left, top, world });
  }

  // 3) center + clamp using Grid’s camera helpers (animated)
  const before = { x: left, y: top, zoom };
  window.gridObject.centerViewportOnWorldPoint(world.x, world.y, true);
  //window.gridObject.clampCameraToBounds(true);
  setTimeout(() => window.gridObject.clampCameraToBounds?.(true, 'offgrid-after-center'), 650);
  console.debug('[offgrid] camera', { before, after: { left: grid.style.left, top: grid.style.top, zoom } });

  // 4) optional: quick visual pulse on the target
  el.classList.add('focus-pulse');
  setTimeout(() => el.classList.remove('focus-pulse'), 600);
}

function summarizeRect(r) {
  return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
}

// Observe grid pan/zoom (style changes), viewport resize, and object visibility
if (OFFGRID_COUNTERS_ENABLED) {
  const mo = new MutationObserver(scheduleOffgridUpdate);
  if (gridEl) mo.observe(gridEl, { attributes: true, attributeFilter: ['style', 'class'] });
  window.addEventListener('resize', scheduleOffgridUpdate);

  // IntersectionObserver to react when items enter/leave
  const io = new IntersectionObserver(() => scheduleOffgridUpdate(), { root: workspaceEl, threshold: 0 });
  Array.from(gridEl.querySelectorAll('.object')).forEach(el => io.observe(el));

  // Kick an initial paint
  requestAnimationFrame(updateOffgridCounters);
}

// Keep the right badge offset aligned with the current slide-ins width
const slideInsEl = document.getElementById('slide-ins');

// Visible width of the slide-in (in px) → used by the grid's RIGHT counter only
function updateRightCounterOffset() {
  const ws = document.getElementById('workspace') || document.documentElement;
  const slideIns = document.getElementById('slide-ins');
  let visible = 0;

  if (slideIns) {
    const r = slideIns.getBoundingClientRect();
    // How much of the slide-in is currently on-screen (it sits on the right)
    visible = Math.max(0, Math.min(r.width, window.innerWidth - r.left));
  }

  // Expose as a CSS var the RIGHT counter can read
  ws.style.setProperty('--slideins-visible', `${Math.round(visible)}px`);

  // NEW: for pinned UI (like gallery location chip):
  // Only reserve space when ALL sidebars are collapsed.
  const anyExpanded = !!slideIns?.querySelector('.slide-in.expanded');
  const collapsedVisible = anyExpanded ? 0 : visible;
  ws.style.setProperty('--slideins-collapsed-visible', `${Math.round(collapsedVisible)}px`);
}

// On init and whenever #slide-ins resizes (open/close), update the CSS var
if (slideInsEl && 'ResizeObserver' in window) {
  const ro = new ResizeObserver(() => updateRightCounterOffset());
  ro.observe(slideInsEl);
  // initial set
  updateRightCounterOffset();
} else {
  // Fallback: update on window resize
  window.addEventListener('resize', updateRightCounterOffset);
  updateRightCounterOffset();
}


// START DRAG AND DROP
// END DRAG AND DROP

// START DOM LOADED

window.addEventListener('DOMContentLoaded', async () => {
  setTagGroupPolicy('GLOBAL');       // 'GLOBAL' or 'SCOPED'
  setTagMode('AND');                 // 'AND' or 'OR'

  // 1) pull ConnectingTag only when using Strapi data
  if (SHOULD_USE_STRAPI) {
    await seedConnectingTagsFromStrapi();
  }

  initSlideInTags();
  
  initSlideInAccordion('#discover-connections', {
    mode: 'accordion',
    dynamicHeight: true
  });

  attachSecondaryAutoClose('#discover-connections');

  // Close secondary when any section is opened in this slide-in
  const dc = document.getElementById('discover-connections');
  dc?.addEventListener('slidein:sectionOpened', () => {
    closeMenuSecondary('#discover-connections');
  });

  if (SHOULD_USE_STRAPI) {
    await seedThemesFromStrapi();
    // NOTE: authors are loaded + rendered lazily when the Team subpage opens.
  }
  renderThemesUI();  

  // Remove active underline when the Themes section is closed
  const themesSection = document.querySelector('#discover-connections #themes-section')?.closest('.content-section');
  if (themesSection) {
    const ro = new MutationObserver(() => {
      if (!themesSection.classList.contains('is-open')) {
        clearThemesActiveState();
      }
    });
    ro.observe(themesSection, { attributes: true, attributeFilter: ['class'] });
  }
});

// END DOM LOADED

// START INIT WHEN DOM LOADED


// END INIT WHEN DOM LOADED

// START TAG SETUP

// ---- CONFIG: tag matching mode ----
// 'OR' (default) or 'AND'
// Mode config (defaults to OR). You can change at runtime via setTagMode('AND'|'OR').
// Tag mode config
const TAG_MODES = { OR: 'OR', AND: 'AND' };
let TAG_MODE = TAG_MODES.OR;   // default

const TAG_GROUP_POLICIES = { GLOBAL: 'GLOBAL', SCOPED: 'SCOPED' };
let TAG_GROUP_POLICY = TAG_GROUP_POLICIES.GLOBAL; // or 'SCOPED'
let activeTagGroupId = null; // used only in SCOPED policy

function setTagMode(mode) {
  TAG_MODE = (mode === TAG_MODES.AND) ? TAG_MODES.AND : TAG_MODES.OR;
  updateTagAvailability?.();
  updateObjectGlowsWithGradient?.();
  syncTagModeToggleUI?.();
}

function setTagGroupPolicy(policy) {
  TAG_GROUP_POLICY = (policy === TAG_GROUP_POLICIES.SCOPED) ? TAG_GROUP_POLICIES.SCOPED : TAG_GROUP_POLICIES.GLOBAL;
  updateTagAvailability?.();
}

function renderTagModeToggle(container) {
  if (!container || renderTagModeToggle._rendered) return;

  const wrap = document.createElement('div');
  wrap.className = 'tag-match-toggle';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Tag match mode');

  // ANY
  const btnAny = document.createElement('button');
  btnAny.type = 'button';
  btnAny.className = 'tag-mode-btn any';
  btnAny.dataset.mode = 'OR';
  btnAny.innerHTML = `
    <!-- BEGIN filter_additive.svg (inline) -->
    <svg fill="currentColor" stroke="currentColor"
         viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet"
         aria-hidden="true" focusable="false">
        <path d="M17.6,12.8c.2.2.4.2.6,0l2.5-2.5v11.3c0,.2.2.4.4.4s.4-.2.4-.4v-11.3l2.5,2.5c.2.2.4.2.6,0,0,0,.1-.2.1-.3s0-.2-.1-.3l-3-3h0l-.2-.2c0,0-.2-.1-.3-.1h0c-.1,0-.2,0-.3.1l-3.2,3.2c-.2.2-.2.4,0,.6Z"/>
        <path d="M1.5.6h18.3c.4,0,.6.5.4.8l-6.9,9.9c-.2.3-.4.7-.4,1.1v6.2c0,.6-.4,1.2-1,1.4l-3,1.2c-.3.1-.7-.1-.7-.5v-8c0-.4-.1-.8-.3-1.1L1.1,1.4c-.2-.3,0-.8.4-.8Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <!-- END filter_additive.svg -->
  `;

  // separator
  const sep = document.createElement('span');
  sep.className = 'tag-mode-separator';

  // ALL
  const btnAll = document.createElement('button');
  btnAll.type = 'button';
  btnAll.className = 'tag-mode-btn all';
  btnAll.dataset.mode = 'AND';
  btnAll.innerHTML = `
    <!-- BEGIN filter_subtractive.svg (inline) -->
    <svg fill="currentColor" stroke="currentColor"
         viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet"
         aria-hidden="true" focusable="false">
        <path d="M24.6,18c-.2-.2-.4-.2-.6,0l-2.5,2.5v-11.3c0-.2-.2-.4-.4-.4s-.4.2-.4.4v11.3l-2.5-2.5c-.2-.2-.4-.2-.6,0,0,0-.1.2-.1.3s0,.2.1.3l3,3h0l.2.2c0,0,.2.1.3.1h0c.1,0,.2,0,.3-.1l3.2-3.2c.2-.2.2-.4,0-.6Z"/>
        <path d="M1.5.6h18.3c.4,0,.6.5.4.8l-6.9,9.9c-.2.3-.4.7-.4,1.1v6.2c0,.6-.4,1.2-1,1.4l-3,1.2c-.3.1-.7-.1-.7-.5v-8c0-.4-.1-.8-.3-1.1L1.1,1.4c-.2-.3,0-.8.4-.8Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <!-- END filter_subtractive.svg -->
  `;

  wrap.appendChild(btnAny);
  wrap.appendChild(sep);
  wrap.appendChild(btnAll);

  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('.tag-mode-btn');
    if (!b) return;
    setTagMode(b.dataset.mode);
  });

  container.appendChild(wrap);
  renderTagModeToggle._rendered = true;
  renderTagModeToggle._els = { btnAny, btnAll };
}

function syncTagModeToggleUI() {
  const els = renderTagModeToggle._els;
  if (!els) return;
  const isAnd = TAG_MODE === TAG_MODES.AND;
  els.btnAny.classList.toggle('is-selected', !isAnd);
  els.btnAll.classList.toggle('is-selected', isAnd);
  els.btnAny.setAttribute('aria-pressed', !isAnd);
  els.btnAll.setAttribute('aria-pressed', isAnd);
}

// === THEME (Dark | Light) TOGGLE ==========================
// use a different name to avoid clashing with existing THEMES
const COLOR_THEMES = { DARK: 'dark', LIGHT: 'light' };

function setTheme(theme) {
  const mode = (theme === COLOR_THEMES.DARK) ? COLOR_THEMES.DARK : COLOR_THEMES.LIGHT;
  document.documentElement.dataset.theme = mode;
  syncThemeToggleUI?.();
}

function renderThemeToggle(container) {
  if (!container) return;

  // avoid duplicate mount in the same container
  if (container.querySelector('.theme-toggle')) return;

  const wrap = document.createElement('div');
  wrap.className = 'theme-toggle';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Color theme');

  const btnDark = document.createElement('button');
  btnDark.type = 'button';
  btnDark.className = 'tag-mode-btn dark';
  btnDark.dataset.theme = 'dark';
  btnDark.innerHTML = `<span class="txt">Dark</span>`;

  const sep = document.createElement('span');
  sep.className = 'tag-mode-separator';

  const btnLight = document.createElement('button');
  btnLight.type = 'button';
  btnLight.className = 'tag-mode-btn light';
  btnLight.dataset.theme = 'light';
  btnLight.innerHTML = `<span class="txt">Light</span>`;

  wrap.append(btnLight, sep, btnDark);

  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('.tag-mode-btn');
    if (!b) return;
    setTheme(b.dataset.theme);
  });

  // Insert to the LEFT of the burger (header), otherwise append (footer)
  const before = container.querySelector('#menu-button');
  if (before) container.insertBefore(wrap, before);
  else container.appendChild(wrap);

  // track all instances so syncThemeToggleUI can update all
  renderThemeToggle._instances = renderThemeToggle._instances || [];
  renderThemeToggle._instances.push({ btnDark, btnLight });
}

function syncThemeToggleUI() {
  const instances = renderThemeToggle._instances;
  if (!instances || !instances.length) return;

  const isDark = document.documentElement.dataset.theme === 'dark';

  for (const els of instances) {
    els.btnDark.classList.toggle('is-selected', isDark);
    els.btnLight.classList.toggle('is-selected', !isDark);
    els.btnDark.setAttribute('aria-pressed', isDark);
    els.btnLight.setAttribute('aria-pressed', !isDark);
  }
}
// ==========================================================

  // Build a fast lookup: tag -> objects that have it
  const tagToObjects = new Map();

  // Single source of truth: which tags are used for filtering?
  // From now on: ONLY connectingTags are used for all tag-based filtering.
  function getObjectFilterTags(o) {
    return Array.isArray(o?.connectingTags) ? o.connectingTags : [];
  }

  function buildTagIndex(objects) {
    tagToObjects.clear();
    for (const o of objects) {
      const src = getObjectFilterTags(o);
      for (const t of src) {
        if (!tagToObjects.has(t)) tagToObjects.set(t, []);
        tagToObjects.get(t).push(o);
      }
    }
  }

  // Helper: does this object have all required tags (using connectingTags only)?
  function objectHasAllTags(o, requiredSet) {
    const objTags = getObjectFilterTags(o);
    for (const t of requiredSet) {
      if (!objTags.includes(t)) return false;
    }
    return true;
  }


function updateTagAvailability() {
  const ul = document.getElementById('tags-visible');
  if (!ul) return;

  const lis = [...ul.querySelectorAll('li')];

  const activeGroup = currentTagViewGroupId; // null = no group selected
  
  // 0) Group gating: if a group is selected, disable chips from other groups
  if (activeGroup) {
    lis.forEach(li => {
      const inGroup = (li.dataset.group === activeGroup);
      if (!inGroup) {
        li.classList.add('disabled');
        li.setAttribute('aria-disabled', 'true');
      } else {
        li.classList.remove('disabled');
        li.setAttribute('aria-disabled', 'false');
      }
    });
  }
  
  // 1) OR mode or no tag selection -> availability only depends on group gating (if any)
  if (TAG_MODE === TAG_MODES.OR || activeTags.size === 0) {
    if (!activeGroup) {
      // no gating: make sure everything is enabled
      lis.forEach(li => { li.classList.remove('disabled'); li.setAttribute('aria-disabled','false'); });
    }
    return;
  }

  // AND mode: grey out a candidate if no object contains (selected + candidate)
  const required = [...activeTags];
  lis.forEach(li => {
    // if already disabled by group gating, skip the expensive check

    // Only skip tags disabled by *group gating*, not tags disabled by AND filtering
    if (activeGroup && li.dataset.group !== activeGroup) return;

    const tag = li.dataset.tag;
    const isActive = li.classList.contains('active');
    if (isActive) { li.classList.remove('disabled'); li.setAttribute('aria-disabled','false'); return; }

    // If SCOPED is locked to a different group, visible list is always the locked group anyway.
    const pool = tagToObjects.get(tag) || [];
    const ok = pool.some(o => objectHasAllTags(o, new Set([...required, tag])));
    li.classList.toggle('disabled', !ok);
    li.setAttribute('aria-disabled', (!ok).toString());

  });
}

// Reseed selection from a detail-panel tag and keep UI in sync
function reseedTagsFromDetail(tag) {
  if (!tag) return;

  // Toggle semantics from detail views:
  // - If the clicked tag is the ONLY active tag, clear selection (unselect).
  // - Otherwise, replace selection with the clicked tag.
  const wasSoleActive = activeTags.size === 1 && activeTags.has(tag);
  if (wasSoleActive) {
    activeTags.clear();
    // clear SCOPED lock if present
    if (typeof activeTagGroupId !== 'undefined') activeTagGroupId = null;
  } else {
    activeTags.clear();
    activeTags.add(tag);
    const gid = tagToGroup.get(tag);
    // keep SCOPED lock consistent with the clicked tag's group
    if (typeof activeTagGroupId !== 'undefined') activeTagGroupId = gid || null;
    // If your policy scopes the visible group, switch the menu to this tag's group
    if (typeof TAG_GROUP_POLICIES !== 'undefined' && typeof TAG_GROUP_POLICY !== 'undefined') {
      if (TAG_GROUP_POLICY === TAG_GROUP_POLICIES.SCOPED && gid) {
        currentTagViewGroupId = gid;
      }
    }
  }

  // 3) Re-render the visible tag row and active group button
  if (typeof renderTagsForCurrentGroup === 'function') renderTagsForCurrentGroup();
  if (typeof markActiveGroupButton === 'function') markActiveGroupButton();

  // 4) Availability, glows, and counters
  if (typeof updateTagAvailability === 'function') updateTagAvailability();
  if (typeof updateObjectGlowsWithGradient === 'function') updateObjectGlowsWithGradient();
  if (typeof scheduleOffgridUpdate === 'function') scheduleOffgridUpdate();
  if (typeof renderSelectionBar === 'function') renderSelectionBar();
  syncDetailTagHighlights();
}
// expose for grid.js
window.reseedTagsFromDetail = reseedTagsFromDetail;

// NEW: detail panels can toggle multiple tags without nuking existing selection
function toggleTagFromDetail(tag) {
  if (!tag) return;

  const s = window.activeTags;
  const already = s.has(tag);

  if (already) {
    // remove it
    s.delete(tag);
    // if nothing left, also clear the scoped group
    if (typeof activeTagGroupId !== 'undefined' && s.size === 0) {
      activeTagGroupId = null;
    }
  } else {
    // add it
    s.add(tag);

    // keep SCOPED logic in sync, same as in reseedTagsFromDetail
    const gid = tagToGroup.get(tag);
    if (typeof activeTagGroupId !== 'undefined' && gid) {
      activeTagGroupId = gid;
    }
    if (typeof TAG_GROUP_POLICIES !== 'undefined' && typeof TAG_GROUP_POLICY !== 'undefined') {
      if (TAG_GROUP_POLICY === TAG_GROUP_POLICIES.SCOPED && gid) {
        currentTagViewGroupId = gid;
      }
    }
  }

  // repaint everything that depends on activeTags
  if (typeof renderTagsForCurrentGroup === 'function') renderTagsForCurrentGroup();
  if (typeof markActiveGroupButton === 'function') markActiveGroupButton();
  if (typeof updateTagAvailability === 'function') updateTagAvailability();
  if (typeof updateObjectGlowsWithGradient === 'function') updateObjectGlowsWithGradient();
  if (typeof scheduleOffgridUpdate === 'function') scheduleOffgridUpdate();
  if (typeof renderSelectionBar === 'function') renderSelectionBar();
  syncDetailTagHighlights();
}
window.toggleTagFromDetail = toggleTagFromDetail;

function updateObjectGlowsWithGradient() {
  const selected = [...activeTags];
  const themeFilter = window.activeThemeFilter || null;
  let themedIds = null;

  const gridEl = document.getElementById('grid');
  const anyGlowActive = (themeFilter != null) || (selected.length > 0);
  gridEl?.setAttribute('data-glow', anyGlowActive ? 'on' : 'off');  

  // Pre-compute which objects match the theme (if any)
  if (themeFilter && typeof window.objectsMatchingTheme === 'function') {
    const objs = window.objectsMatchingTheme(themeFilter) || [];
    themedIds = new Set(objs.map(o => String(o.id)));
  }

  document.querySelectorAll(".object").forEach(div => {
    const tags = (div.dataset.tags || '').split(",").filter(Boolean);
    const glow = div.querySelector(".object-glow");
    if (!glow) return;

    // === THEME FILTER ===
    if (themeFilter && themedIds) {
      if (!themedIds.has(div.id)) {
        // not in the theme → no glow
        glow.style.setProperty('--glow', 'transparent');
        glow.style.setProperty('--glow-color', 'transparent');
      } else {
        // matched theme → single-color glow
        const color = getComputedStyle(document.documentElement)
          .getPropertyValue('--main-button-outline-color') || '#000';
        glow.style.setProperty('--glow', color.trim());
        glow.style.setProperty('--glow-color', color.trim());
      }
      return; // theme mode wins over tag mode
    }

    // === TAG FILTER (existing behavior) ===

    // nothing selected → no glow
    if (selected.length === 0) {
      glow.style.setProperty('--glow', 'transparent');
      glow.style.setProperty('--glow-color', 'transparent'); // added
      return;
    }

    if (TAG_MODE === TAG_MODES.OR) {
      // existing OR behavior
      const matchesAny = tags.some(t => activeTags.has(t));
      if (!matchesAny) {
        glow.style.setProperty('--glow', 'transparent');
        glow.style.setProperty('--glow-color', 'transparent'); // added
        return;
      }

      const colors = tags
        .filter(t => activeTags.has(t))
        .map(t => tagColors[t]);

      const n = Math.max(1, colors.length);
      const stops = colors.map((c, i) => {
        const start = (i * 100 / n).toFixed(2);
        const end   = ((i + 1) * 100 / n).toFixed(2);
        return `${c} ${start}% ${end}%`;
      });
      const conic = `conic-gradient(from 0deg at 50% 50%, ${stops.join(", ")})`;
      glow.style.setProperty('--glow', conic);
      // use the first tag color as a simple flat color for Safari
      glow.style.setProperty('--glow-color', colors[0] || 'transparent');
      return;
    }

    // === AND mode (your change) ===
    const matchesAll  = selected.every(t => tags.includes(t));          // strict intersection
    const matchesSome = tags.some(t => activeTags.has(t));              // partial / 1-of-N

    if (!matchesSome) {
      // no overlap at all → no glow
      glow.style.setProperty('--glow', 'transparent');
      glow.style.setProperty('--glow-color', 'transparent'); // added
      return;
    }

    // decide which colors to show
    const colors = matchesAll
      // for full intersection: keep your old behavior → use ALL selected tag colors
      ? selected.map(t => tagColors[t])
      // for partial match: highlight only the tags that this object actually has
      : tags.filter(t => activeTags.has(t)).map(t => tagColors[t]);

    const n = Math.max(1, colors.length);
    const stops = colors.map((c, i) => {
      const start = (i * 100 / n).toFixed(2);
      const end   = ((i + 1) * 100 / n).toFixed(2);
      return `${c} ${start}% ${end}%`;
    });
    const conic = `conic-gradient(from 0deg at 50% 50%, ${stops.join(", ")})`;
    glow.style.setProperty('--glow', conic);
    glow.style.setProperty('--glow-color', colors[0] || 'transparent');
  });
}

function initSlideInTags() {
  const section = document.querySelector('#discover-connections .section-content');
  if (!section) return;

  section.innerHTML = '';

  // 2) Group switcher (buttons shown under the tags) – now as an inline list
  const switcher = document.createElement('ul');
  switcher.className = 'tag-group-switch';

  TAG_GROUPS.forEach(g => {
    const li = document.createElement('li');

    const link = document.createElement('a');
    link.className = 'group-btn';
    link.dataset.groupId = g.id;
    link.textContent = g.label;

    li.appendChild(link);
    switcher.appendChild(li);
  });

  section.appendChild(switcher);

  // Switcher clicks (toggle): click a group to restrict to that group; click again to clear.
  // Any change of group must reset prior tag selections.
  switcher.addEventListener('click', (e) => {
    const btn = e.target.closest('.group-btn');
    if (!btn) return;
    const gid = btn.dataset.groupId;
    if (!gid) return;

    const wasSelected = currentTagViewGroupId === gid;

    if (wasSelected) {
      // Clear group: all tags clickable; default match = All
      currentTagViewGroupId = null;
      setTagMode('AND');
    } else {
      // Select this group: non-member tags disabled; default match = Any
      currentTagViewGroupId = gid;
      setTagMode('OR');
    }

    // Any group change resets tag selections completely
    activeTags.clear();
    if (TAG_GROUP_POLICY === TAG_GROUP_POLICIES.SCOPED) {
      activeTagGroupId = null;
    }

    // Refresh UI
    renderTagsForCurrentGroup();   // renders with no active tags now
    markActiveGroupButton();       // highlight selected group (or none)
    updateObjectGlowsWithGradient();
    scheduleOffgridUpdate?.();
    renderSelectionBar?.();
    syncDetailTagHighlights();
  });

  // 1) Visible tags (single group at a time)
  const ul = document.createElement('ul');
  ul.className = 'tags';
  ul.id = 'tags-visible';
  section.appendChild(ul);

  // Tag clicks (delegated)
  ul.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li || !li.dataset.tag) return;
    // If this chip is disabled, ignore the click entirely
    if (li.classList.contains('disabled') || li.getAttribute('aria-disabled') === 'true') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const tag = li.dataset.tag;
    const color = tagColors[tag];

    // If a theme filter is active, clear it (tags and themes are exclusive)
    if (window.activeThemeFilter) {
      window.activeThemeFilter = null;
      if (typeof clearThemesActiveState === 'function') {
        clearThemesActiveState();
      }
      if (typeof closeMenuSecondary === 'function') {
        closeMenuSecondary('#discover-connections');
      }
      // The tag toggle below plus the existing update* calls will refresh
      // glows, off-grid counters and the selection bar.
    }

    // In SCOPED policy: lock to the group of the first selection
    if (TAG_GROUP_POLICY === TAG_GROUP_POLICIES.SCOPED) {
      const tagGroup = li.dataset.group;
      if (!li.classList.contains('active')) {
        // if switching to a different group than the locked one → reset
        if (activeTagGroupId && tagGroup !== activeTagGroupId) {
          clearAllTagSelectionsUI();
          activeTags.clear();
          activeTagGroupId = null;
        }
      }
    }

    // Toggle selection
    if (activeTags.has(tag)) {
      activeTags.delete(tag);
      li.classList.remove('active');
      li.style.borderColor = '#000';
      li.style.color = '';
      li.style.boxShadow = '';
    } else {
      activeTags.add(tag);
      li.classList.add('active');
      li.style.borderColor = color;
      li.style.color = color;
      li.style.boxShadow = `${color}66 0 0 8px`;
      // Set lock on first selection in SCOPED
      if (TAG_GROUP_POLICY === TAG_GROUP_POLICIES.SCOPED) {
        activeTagGroupId = li.dataset.group;
      }
    }

    // Update off-grid counters for any tag change
    scheduleOffgridUpdate();
    updateTagAvailability();
    updateObjectGlowsWithGradient();
    renderSelectionBar();

    // If we are in ad-hoc gallery, live-refresh the items
    if (typeof window.refreshAdhocGalleryFromTags === 'function') {
      window.refreshAdhocGalleryFromTags();
    }

    syncDetailTagHighlights();
  });

  // 3) Match toggle (last)
  renderTagModeToggle(section);
  syncTagModeToggleUI();

  // Initial paint
  renderTagsForCurrentGroup();
  markActiveGroupButton();
  updateTagAvailability();
}

// Sync .active styling of tag pills inside detail cards with global activeTags
function syncDetailTagHighlights() {
  const active = window.activeTags || new Set();
  const colors = window.tagColors || {};

  // Select any tag chip rendered in detail cards (works whether they use data-tag or innerText)
  const candidates = document.querySelectorAll(
    '.detail-card [data-tag], .detail-tags [data-tag], .detail-card .tag, .detail-tags .tag'
  );

  candidates.forEach(el => {
    // prefer data-tag; fallback to text
    const tag = (el.dataset?.tag || el.textContent || '').trim();
    if (!tag) return;

    const isActive = active.has(tag);
    el.classList.toggle('active', isActive);

    // Apply the same color treatment you use elsewhere
    const c = colors[tag];
    if (isActive && c) {
      el.style.borderColor = c;
      el.style.color = c;
      el.style.boxShadow = `${c}66 0 0 8px`;
    } else {
      el.style.removeProperty('border-color');
      el.style.removeProperty('color');
      el.style.removeProperty('box-shadow');
    }
  });
}

function openMenuSecondary(slideInSelector, { title, paragraphs, showSelectButton = false } = {}) {
  const host  = document.querySelector(slideInSelector);
  const panel = document.querySelector(`${slideInSelector} .secondary-pane`);
  if (!host || !panel) return;

  host.classList.add('expanded');        // ensure the slide-in is open
  host.classList.add('secondary-open');  // widen to include secondary

  panel.setAttribute('aria-hidden', 'false');

  const contentHtml = `
    <div class="secondary-pane-content">
      <h3>${title}</h3>
      ${paragraphs.map(p => `<p>${p}</p>`).join('')}
    </div>
  `;

  const footerHtml = showSelectButton ? `
    <div class="secondary-pane-footer">
      <a href="#" class="button theme-back-button">
        <span class="icon">&larr;</span>
        <span class="text">Back</span>
      </a>
      <a href="#" class="button theme-select-button">
        <span class="text">Select</span>
        <span class="icon">&rarr;</span>
      </a>
    </div>
  ` : '';

  panel.innerHTML = contentHtml + footerHtml;

  // Theme "Select" / "Back" handlers
  if (showSelectButton) {
    // Back → close secondary pane, return to themes list (esp. on mobile)
    const backBtn = panel.querySelector('.theme-back-button');
    if (backBtn) {
      backBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        closeMenuSecondary(slideInSelector);
      });
    }

    // Select → activate theme-based filtering on the grid
    const btn = panel.querySelector('.theme-select-button');
    if (btn) {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();

        const host = document.getElementById('themes-section');
        const activeLi = host?.querySelector('.theme-item.active');
        const tid = activeLi?.dataset.tid;
        if (!tid) return;

        const theme = (typeof window.findThemeById === 'function')
          ? window.findThemeById(tid)
          : null;
        if (!theme) return;

        // 1) Clear any tag selection (mutually exclusive)
        if (window.activeTags) {
          window.activeTags.clear();
        }
        if (typeof clearAllTagSelectionsUI === 'function') {
          clearAllTagSelectionsUI();
        }
        if (typeof updateTagAvailability === 'function') {
          updateTagAvailability();
        }

        // Reset tag group lock (if you use it)
        if (typeof window.activeTagGroupId !== 'undefined') {
          window.activeTagGroupId = null;
        }

        // 2) Set the active theme filter
        window.activeThemeFilter = theme;

        // 3) Update highlights, counters, and selection bar
        if (typeof updateObjectGlowsWithGradient === 'function') {
          updateObjectGlowsWithGradient();
        }
        if (typeof scheduleOffgridUpdate === 'function') {
          scheduleOffgridUpdate();
        }
        if (typeof renderSelectionBar === 'function') {
          renderSelectionBar();
        }

        // 4) Close the secondary pane
        closeMenuSecondary(slideInSelector);

        // 5) After selecting a theme:
        // - mobile: collapse the whole slide-ins strip (removes overlay, shows minimized icon)
        // - desktop: just close the secondary pane (keep sidebar visible)
        const isMobile =
          (typeof isMobileViewportForSlideIns === 'function' && isMobileViewportForSlideIns()) ||
          (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 768px)').matches);

        if (isMobile && typeof collapseSlideInsStrip === 'function') {
          collapseSlideInsStrip();
        } else {
          const wrap = document.querySelector(slideInSelector);
          if (wrap) {
            wrap.classList.remove('expanded', 'secondary-open');
            wrap.querySelector('.vertical-content')?.classList.remove('visible');
          }

          // keep layout math / toggles in sync
          if (typeof updateRightCounterOffset === 'function') updateRightCounterOffset();
          if (typeof updateMobileSlideInsToggle === 'function') updateMobileSlideInsToggle();
        }

      }, { once: true });
    }
  }
}

function closeMenuSecondary(slideInSelector) {
  const host  = document.querySelector(slideInSelector);
  const panel = document.querySelector(`${slideInSelector} .secondary-pane`);
  if (!host || !panel) return;

  host.classList.remove('secondary-open');
  panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML = '';
}

function attachSecondaryAutoClose(slideInSelector) {
  const host = document.querySelector(slideInSelector);
  if (!host) return;

  const mo = new MutationObserver((mutations, obs) => {
    const removedExpanded =
      !host.classList.contains('expanded') &&
      mutations.some(m => m.attributeName === 'class' &&
                          m.oldValue && m.oldValue.includes('expanded'));

    if (removedExpanded) {
      // Prevent re-entrancy while we mutate classes/attributes
      obs.disconnect();
      closeMenuSecondary(slideInSelector);
      // Re-arm after the current frame
      requestAnimationFrame(() => {
        obs.observe(host, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
      });
    }
  });

  mo.observe(host, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
}

function initSlideInAccordion(slideInSelector, opts = {}) {
  const root = document.querySelector(slideInSelector);
  if (!root) return;

  const mode = (root.dataset.sectionMode || opts.mode || 'static').toLowerCase();
  if (mode === 'static') return;

  const singleOpen = (mode === 'accordion');
  // only the real sidebar sections, skip the big multi-column block at the top
  const sections = Array
    .from(root.querySelectorAll('.content-section'))
    .filter(sec => !sec.classList.contains('multi-column'));
  if (!sections.length) return;

  const observers = new WeakMap();
  const dynamicHeight = opts.dynamicHeight ?? true;

  // NEW: optional scroll-to-top on open (off by default)
  const scrollOnOpen = opts.scrollOnOpen ?? false;
  const scrollBehavior = opts.scrollBehavior || 'smooth';
  let initialising = true;

  // choose the real scroll column, not the whole slide-in
  const container = root.querySelector('.vertical-content') || root;

  function scrollSectionToTop(sec) {
    if (!scrollOnOpen) return;

    // reuse existing scroll-locator used by scroll-up buttons
    const scroller =
      (typeof nearestScroller === 'function')
        ? nearestScroller(sec)
        : container;

    if (!scroller) return;

    const secTop = sec.getBoundingClientRect().top;
    const scrollerTop = scroller.getBoundingClientRect().top;
    const targetTop = secTop - scrollerTop + scroller.scrollTop;

    scroller.scrollTo({ top: targetTop, behavior: scrollBehavior });
  }

  function scheduleScrollToTop(sec, closingSecs = []) {
    if (!scrollOnOpen) return;
  
    const doScroll = () =>
      requestAnimationFrame(() => scrollSectionToTop(sec));
  
    // Nothing collapsing → scroll next frame like before
    if (!closingSecs.length) {
      doScroll();
      return;
    }
  
    let pending = 0;
    let finishedAll = false;
  
    const doneOne = () => {
      pending--;
      if (pending <= 0 && !finishedAll) {
        finishedAll = true;
        // one extra frame so layout is final
        doScroll();
      }
    };
  
    closingSecs.forEach(s => {
      const content = s.querySelector('.section-content');
      if (!content) return;
  
      pending++;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        doneOne();
      };
  
      // Wait for the max-height collapse to finish
      content.addEventListener('transitionend', (e) => {
        if (!e || e.propertyName === 'max-height') finish();
      }, { once: true });
  
      // Fallback slightly > 0.35s max-height transition
      setTimeout(finish, 400);
    });
  
    // Safety: if nothing registered as pending
    if (pending === 0) doScroll();
  }  

  function measureOpenHeight(sec) {
    const content = sec.querySelector('.section-content');
    if (!content) return;

    if (!dynamicHeight) {
      content.style.maxHeight = content.scrollHeight + 'px';
      return;
    }

    // total vertical space for sections
    const cRect = container.getBoundingClientRect();
    const cStyles = getComputedStyle(container);
    const padY =
      parseFloat(cStyles.paddingTop || '0') +
      parseFloat(cStyles.paddingBottom || '0');
    const total = cRect.height - padY;

    // sum ALL collapsed footprints (header + section paddings + margins)
    let headersTotal = 0;
    sections.forEach(s => {
      const header = s.querySelector('.section-header, h3');
      const hRect = header ? header.getBoundingClientRect() : { height: 0 };
      const sStyles = getComputedStyle(s);

      const paddings =
        parseFloat(sStyles.paddingTop || '0') +
        parseFloat(sStyles.paddingBottom || '0');

      const margins =
        parseFloat(sStyles.marginTop || '0') +
        parseFloat(sStyles.marginBottom || '0');

      headersTotal += hRect.height + paddings + margins;
    });

    // after you've built headersTotal for all sections...
    const openSecStyles = getComputedStyle(sec);
    const openExtra =
      parseFloat(openSecStyles.paddingTop || '0') +
      parseFloat(openSecStyles.paddingBottom || '0') +
      parseFloat(openSecStyles.borderTopWidth || '0') +
      parseFloat(openSecStyles.borderBottomWidth || '0');

    // leave a tiny gap
    const GAP = 8;
    const available = Math.max(
      80,
      total - headersTotal - openExtra - GAP
    );

    const wanted = content.scrollHeight;
    const target = Math.min(wanted, available);
    content.style.maxHeight = target + 'px';
  }

  function openSection(sec, focusHeader = false) {
    if (sec.classList.contains('is-open')) return;

    const closingSecs = singleOpen
    ? sections.filter(s => s !== sec && s.classList.contains('is-open'))
    : [];  

    if (singleOpen) {
      sections.forEach(s => { if (s !== sec) closeSection(s); });
    }
    sec.classList.add('is-open');

    root.dispatchEvent(new CustomEvent('slidein:sectionOpened', { detail: { section: sec } }));

    const header = sec.querySelector('.section-header, h3');
    const content = sec.querySelector('.section-content');
    header?.setAttribute('aria-expanded', 'true');

    // compute height from remaining space
    measureOpenHeight(sec);

    // keep in sync
    if (content && !observers.get(content) && 'ResizeObserver' in window) {
      const ro = new ResizeObserver(() => {
        if (sec.classList.contains('is-open')) {
          measureOpenHeight(sec);
        }
      });
      ro.observe(content);
      observers.set(content, ro);
    }

    // When a user opens a section, bring it to the top of the scroll container.
    // If others were open, wait for their collapse transition so we don't overshoot.
    if (!initialising) {
      scheduleScrollToTop(sec, closingSecs);
    }

    if (focusHeader && header) header.focus();
  }

  function closeSection(sec) {
    if (!sec.classList.contains('is-open')) return;
    const header = sec.querySelector('.section-header, h3');
    const content = sec.querySelector('.section-content');
    header?.setAttribute('aria-expanded', 'false');

    if (content) {
      content.style.maxHeight = content.scrollHeight + 'px';
      requestAnimationFrame(() => { content.style.maxHeight = '0px'; });
    }
    sec.classList.remove('is-open');
  }

  function toggleSection(sec) {
    if (sec.classList.contains('is-open')) closeSection(sec);
    else openSection(sec);
  }

  sections.forEach((sec, idx) => {
    sec.classList.add('collapsible');
    const header = sec.querySelector('.section-header, h3');
    if (!header) return;
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'false');

    header.addEventListener('click', () => toggleSection(sec));
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection(sec); }
      if (e.key === 'ArrowDown') { e.preventDefault(); const s = sections[idx+1]; if (s) openSection(s, true); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); const s = sections[idx-1]; if (s) openSection(s, true); }
    });
  });

  // initial open behavior
  // default stays the same: open first section (index 0)
  // set opts.initialOpen to -1 (or null/false) to start fully collapsed
  const initialOpen = (opts.initialOpen ?? 0);

  if (initialOpen === -1 || initialOpen === null || initialOpen === false) {
    // all closed
    sections.forEach(closeSection);
  } else {
    const idxToOpen =
      Math.max(0, Math.min(sections.length - 1, Number(initialOpen) || 0));

    openSection(sections[idxToOpen]);
    sections.forEach((s, i) => { if (i !== idxToOpen) closeSection(s); });
  }

  // NEW: prevent scroll on the initial auto-open
  initialising = false;

  root._accordion = { openSection, closeSection, toggleSection };
}

function getThemesData() {
  // Prefer Strapi data if loaded, otherwise fall back to hardcoded THEMES
  return (window.__themesFromStrapi && window.__themesFromStrapi.length)
    ? window.__themesFromStrapi
    : THEMES;
}

// Helper: find a single theme by id (string/number)
function findThemeById(themeId) {
  if (!themeId) return null;
  const list = getThemesData();
  const wanted = String(themeId);
  return list.find(t => String(t.id) === wanted) || null;
}

window.getThemesData = getThemesData;   // optional, useful for reuse
window.findThemeById = findThemeById;   // used by theme gallery + sidebar

function renderThemesUI() {
  const host = document.getElementById('themes-section');
  if (!host) return;

  const THEMES_DATA = getThemesData();

  host.innerHTML = `
    <ul class="themes-list">
      ${THEMES_DATA.map(t => `
        <li class="theme-item" data-tid="${t.id}">
          <button type="button" class="theme-link">
            <span class="theme-icon" aria-hidden="true">?</span>
            <span class="theme-label">${t.title}</span>
          </button>
        </li>
      `).join('')}
    </ul>
  `;

  // Bind click handler only once per host
  if (!host._themesClickBound) {
    host._themesClickBound = true;

    host.addEventListener('click', (e) => {
      const btn = e.target.closest('.theme-link');
      if (!btn) return;

      const li  = btn.closest('.theme-item');
      const tid = li?.dataset.tid;
      if (!tid) return;

      const theme = (typeof window.findThemeById === 'function')
        ? window.findThemeById(tid)
        : null;
      if (!theme) return;

      // Switch active row
      host.querySelectorAll('.theme-item.active')
        .forEach(n => n.classList.remove('active'));
      li.classList.add('active');

      // Open secondary pane with theme description + Select button
      openMenuSecondary('#discover-connections', {
        title: theme.title,
        paragraphs: theme.paragraphs,
        showSelectButton: true
      });
    });
  }
}

function clearThemesActiveState() {
  const list = document.querySelector('#themes-section .themes-list');
  if (!list) return;
  list.querySelectorAll('.theme-item.active').forEach(n => n.classList.remove('active'));
}

function renderDiscoverProjectsFromGroups() {
  const projectSection = Array
    .from(document.querySelectorAll('#discover-connections .content-section'))
    .find(sec => {
      const h = sec.querySelector('h3');
      return h && h.textContent.trim().toLowerCase() === 'project';
    });

  if (!projectSection) return;

  const content = projectSection.querySelector('.section-content');
  if (!content) return;

  const groups = window.groupMetaById || {};
  const entries = Object.entries(groups);

  content.innerHTML = '';

  if (!entries.length) {
    return;
  }

  entries.sort((a, b) => {
    const ta = (a[1]?.title || a[1]?.Title || '').toLowerCase();
    const tb = (b[1]?.title || b[1]?.Title || '').toLowerCase();
    return ta.localeCompare(tb);
  });

  const ul = document.createElement('ul');
  ul.className = 'dc-projects-list';

  const esc = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  entries.forEach(([gid, meta]) => {
    const title = meta?.title || meta?.Title || 'Untitled';
    const subtitle =
      meta?.subtitle ||
      meta?.Subtitle ||
      meta?.description ||
      meta?.Description ||
      '';

    const li = document.createElement('li');
    li.className = 'dc-project-item';
    li.dataset.gid = gid;
    li.innerHTML = `
      <span class="dc-project-radio" aria-hidden="true"></span>
      <div class="dc-project-text">
        <strong>${esc(title)}</strong>
        ${subtitle ? `<div class="dc-project-subtitle">${esc(subtitle)}</div>` : ''}
      </div>
    `;
    ul.appendChild(li);
  });

  content.appendChild(ul);

  // click handling: select + open gallery
  ul.addEventListener('click', (e) => {
    const li = e.target.closest('.dc-project-item');
    if (!li) return;
    const gid = li.dataset.gid;

    // set selected (radio-like)
    ul.querySelectorAll('.dc-project-item.is-selected')
      .forEach(n => n.classList.remove('is-selected'));
    li.classList.add('is-selected');

    // open gallery
    if (typeof window.openGroupGallery === 'function') {
      window.openGroupGallery(gid);
    }
  });
}

function renderTagsForCurrentGroup() {
  // Renders ALL tags from ALL groups as one globally sorted list.
  // Group selection is enforced via disabled state in updateTagAvailability().
  const ul = document.getElementById('tags-visible');
  if (!ul) return;
  ul.innerHTML = '';

  // 1) Build a unique, globally sorted list of tags across all groups
  //    ALL_TAGS is maintained by rebuildTagCachesFromCurrentGroups()
  const sortedTags = Array.from(new Set(ALL_TAGS))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  // 2) Render each tag once, but keep its group via tagToGroup for gating
  sortedTags.forEach(tag => {
    const li = document.createElement('li');
    li.dataset.tag = tag;
    li.dataset.group = tagToGroup.get(tag) || '';
    li.textContent = tag;

    if (activeTags.has(tag)) {
      const color = tagColors[tag];
      li.classList.add('active');
      if (color) {
        li.style.borderColor = color;
        li.style.color = color;
        li.style.boxShadow = `${color}66 0 0 8px`;
      }
    }

    ul.appendChild(li);
  });

  // After (re)render, enforce availability rules (AND logic + group gating)
  updateTagAvailability();
}

function markActiveGroupButton() {
  document
    .querySelectorAll('.tag-group-switch .group-btn')
    .forEach(b => b.classList.toggle('is-active', b.dataset.groupId === currentTagViewGroupId));
}

function clearAllTagSelectionsUI() {
  document.querySelectorAll('#discover-connections .tags li.active').forEach(n => {
    n.classList.remove('active');
    n.style.borderColor = '#000';
    n.style.color = '';
    n.style.boxShadow = '';
  });
}


// --- Slide-ins: expand/collapse ---
function initSlideIns() {
  const container = document.getElementById('slide-ins');
  if (!container) return;
  if (container.dataset.inited === '1') return;
  container.dataset.inited = '1';

  // Cursor tooltip labels for slide-in handles
  container.querySelectorAll('.slide-in').forEach((wrap) => {
    const handle = wrap.querySelector('.slide-in-handle');
    if (!handle) return;

    // Respect any label already set in HTML
    if (handle.dataset.cursorLabel) return;

    // "3-group" content sidebars -> episode context
    if (wrap.dataset.mode === 'content') {
      handle.dataset.cursorLabel = 'episode context';
      return;
    }

    // Optional: keep this as a fallback in case the HTML label is removed later
    if (wrap.id === 'discover-connections') {
      handle.dataset.cursorLabel = 'discover connections';
    }
  });

  container.addEventListener('click', (e) => {
    const wrap = e.target.closest('.slide-in');
    if (!wrap) return;
  
    const isExpanded = wrap.classList.contains('expanded');
  
    // 1) vertical text → always open this, close others
    if (e.target.matches('.vertical-text')) {
      document.querySelectorAll('#slide-ins .slide-in').forEach(el => {
        if (el === wrap) {
          el.classList.add('expanded');
          el.querySelector('.vertical-content')?.classList.add('visible');
        } else {
          el.classList.remove('expanded', 'secondary-open');
          el.querySelector('.vertical-content')?.classList.remove('visible');
        }
      });
      return;
    }
  
    // 2) close button → if open -> close; if closed -> open (like vertical text)
    const closeBtn = e.target.closest('.close-btn');
    if (closeBtn) {
      e.stopPropagation();
  
      if (isExpanded) {
        // CLOSE this one
        wrap.classList.remove('expanded', 'secondary-open');
        wrap.querySelector('.vertical-content')?.classList.remove('visible');
        const panel = wrap.querySelector('.secondary-pane');
        if (panel) {
          panel.setAttribute('aria-hidden', 'true');
          panel.innerHTML = '';
        }
        if (typeof clearThemesActiveState === 'function') {
          clearThemesActiveState();
        }
      } else {
        // OPEN this one (same as vertical-text)
        document.querySelectorAll('#slide-ins .slide-in').forEach(el => {
          if (el === wrap) {
            el.classList.add('expanded');
            el.querySelector('.vertical-content')?.classList.add('visible');
          } else {
            el.classList.remove('expanded', 'secondary-open');
            el.querySelector('.vertical-content')?.classList.remove('visible');
          }
        });
      }
    }
  });  
}

// END TAG SETUP

// --- Full-screen overlay menu (burger) ---
function initOverlayMenu() {
  const trigger =
    document.getElementById('menu-button') ||
    document.querySelector('.menu-trigger') ||
    document.getElementById('burger-btn');

  const overlay  = document.getElementById('overlay-menu');
  const headerClose = document.getElementById('header-close-button');
  if (!overlay) return;

  let previousFocus = null;

  const mainItems = overlay.querySelectorAll('.menu-item');
  const subMenu   = document.getElementById('sub-menu');

  const overlayContent = overlay.querySelector('.overlay-content');
  const mainMenuEl     = overlay.querySelector('.main-menu');
  const mobileMq       = window.matchMedia?.('(max-width: 768px)');  

  function setSubMenuOpen(isOpen) {
    if (!subMenu) return;
  
    subMenu.classList.toggle('is-open', !!isOpen);
    subMenu.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  
    // Prevent keyboard focus + interactions when collapsed (supported in modern browsers)
    try { subMenu.inert = !isOpen; } catch (_) {}
  }

  function openSubMenuAnimated() {
    if (!subMenu) return;
  
    // rAF runs BEFORE paint. We want to open AFTER one paint of the closed state,
    // so we use a 2nd rAF (next frame).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSubMenuOpen(!!subMenu.children.length);
      });
    });
  }  

  const SUBMENU_ANIM_MS = 280; // keep in sync with CSS (~260ms)

  function resetSubMenu({ animate = false } = {}) {
    if (!subMenu) return;
  
    const clear = () => {
      subMenu.innerHTML = '';
      // Put sub-menu back to default placement after close
      placeSubMenuForViewport(null);
    };
  
    if (!animate) {
      setSubMenuOpen(false);
      clear();
      return;
    }
  
    // Animate close: keep content until transition finishes
    setSubMenuOpen(false);
  
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      subMenu.removeEventListener('transitionend', onEnd);
      clear();
    };
  
    const onEnd = (ev) => {
      if (ev.target !== subMenu) return;
      // max-height is the “main” close animation; opacity/transform also run
      if (ev.propertyName !== 'max-height') return;
      finish();
    };
  
    subMenu.addEventListener('transitionend', onEnd);
    // Fallback in case transitionend doesn't fire (rare, but happens)
    window.setTimeout(finish, SUBMENU_ANIM_MS + 80);
  }  
  
  // start collapsed
  setSubMenuOpen(false);  

  // 1) Submenu entries
  const subItemsMap = {
    // Viral Atmospheres has three subpages: About (placeholder), Introduction, Archive’s Architecture
    viralatmospheres: ['About', 'Introduction', 'The Archive’s Architecture'],
  
    // Map Modes: same 3 modes as the grid view switcher (see aria-labels in index.html)
    map: ['Episode Overview', 'Episode Overview & Thematic Discovery', 'Thematic Discovery'],
  };


  // 2) Label → subpage id + header-left copy
  const SUBPAGE_ROUTES = {
    // Viral Atmospheres → About + Introduction pages
    'About':        { id: 'subpage-about',        header: 'About' },
    'Introduction': { id: 'subpage-introduction', header: 'Introduction' },
    'The Archive’s Architecture': { id: 'subpage-archive-architecture',  header: 'The Archive’s Architecture' },

    // Other existing text pages
    'References':   { id: 'subpage-references',   header: 'References' },
    'Team':         { id: 'subpage-team',         header: 'Meet our Team' },
  };

  // 2b) Submenu labels that should trigger grid mode changes (instead of opening subpages)
  const GRID_MODE_MENU_ACTIONS = {
    'Group view':   () => document.getElementById('fab-group')?.click(),
    'Cluster view': () => document.getElementById('fab-cluster')?.click(),
    'Ungroup view': () => document.getElementById('fab-ungroup')?.click(),
  };

  function goToGridThen(fn) {
    // goHome() already closes the overlay + returns to grid in your app
    if (typeof goHome === 'function') {
      goHome();
    } else {
      // fallback: at least close the overlay if goHome is unavailable
      closeOverlay?.();
    }
    fn?.();
  }

  function applyEpisodeThumbScale(listEl) {
    const imgs = Array.from(listEl.querySelectorAll('.episode-thumb-img'));
    if (!imgs.length) return;
  
    // Prefer Strapi intrinsic widths (data-intrinsic-w). Fallback to naturalWidth after load.
    const readW = (img) => Number(img.dataset.intrinsicW) || img.naturalWidth || 0;
  
    const waitLoads = imgs.map(img =>
      img.complete ? Promise.resolve() : new Promise(res => img.addEventListener('load', res, { once: true }))
    );
  
    Promise.allSettled(waitLoads).then(() => {
      let maxW = 0;
      for (const img of imgs) maxW = Math.max(maxW, readW(img));

      const threshold = maxW * 0.7; // 30% smaller than the largest

      for (const img of imgs) {
        const w = readW(img);
      
        // Mark as smaller only if width is <= 70% of the largest width
        img.classList.toggle('is-smaller', maxW > 0 && w > 0 && w <= threshold);
      }
    });
  }  

  function renderEpisodesMenu() {
    subMenu.innerHTML = '';
    
    const entries = Object.entries(groupMetaById || {})
    .filter(([gid, meta]) => meta && (meta.title || meta.subtitle));   

    if (!entries.length) {
      subMenu.innerHTML = `<div class="episodes-empty">No episodes found.</div>`;
      return;
    }

    const esc = (s) => escapeHtml(String(s ?? ''));

    const normalizeNames = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val.map(v => String(v).trim()).filter(Boolean);
      return String(val).split(',').map(s => s.trim()).filter(Boolean);
    };

    const numericGroupKey = (gid) => {
      const m = /^s(\d+)$/.exec(String(gid));
      if (m) return Number(m[1]);
      const n = Number(gid);
      return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
    };

    // Alphabetical order by Title (ascending). Ties fall back to gid for stability.
    entries.sort((a, b) => {
      const [gidA, metaA] = a;
      const [gidB, metaB] = b;

      const titleA = String(metaA?.title || `Group ${gidA}`).trim();
      const titleB = String(metaB?.title || `Group ${gidB}`).trim();

      const cmp = titleA.localeCompare(titleB, undefined, { sensitivity: 'base' });
      if (cmp !== 0) return cmp;

      return String(gidA).localeCompare(String(gidB), undefined, { numeric: true });
    });

    const list = document.createElement('div');
    list.className = 'episodes-list';

    for (const [gid, meta] of entries) {
      const title = meta?.title || `Group ${gid}`;
      const subtitle = meta?.subtitle || '';

      const authors = normalizeNames(meta?.authors);
      const contributors = normalizeNames(meta?.contributors);

      const authorsHtml = authors.length
        ? `<div class="episode-authors">${
            authors
              .map(n => `<a href="#subpage-team" data-author-name="${esc(n)}">${esc(n)}</a>`)
              .join(', ')
          }</div>`
        : '';

      const contributorsHtml = contributors.length
        ? `<div class="episode-contributors">with contributions by ${
            contributors
              .map(n => `<a href="#subpage-team" data-author-name="${esc(n)}">${esc(n)}</a>`)
              .join(', ')
          }</div>`
        : '';

      const row = document.createElement('div');
      row.className = 'episode-entry';
      row.dataset.groupId = gid;

      const THUMB_SIZE = 100; // keep in sync with CSS (.episode-thumb width/height)

      const uploadMeta = toAbsoluteUploadMeta(
        unwrapUploadMeta(meta?.menuImage || meta?.menu_image || meta?.MenuImage)
      );
      
      const best = uploadMeta ? pickImageVariant(uploadMeta, THUMB_SIZE, 1) : { url: undefined };
      const menuImgUrl = (best?.url || uploadMeta?.url || '').trim();
      
      const intrinsicW = Number(uploadMeta?.width) || 0;

      const thumbInner = menuImgUrl
        ? `<img class="episode-thumb-img" data-intrinsic-w="${intrinsicW}" src="${esc(menuImgUrl)}" alt="" loading="lazy" decoding="async">`
        : '';      
      
      const thumbClass = menuImgUrl ? 'has-image' : '';
      
      row.innerHTML = `
        <a href="#"
           class="episode-thumb ${thumbClass} episode-go-gallery"
           data-group-id="${esc(gid)}"
           aria-label="Open ${esc(title)}">${thumbInner}</a>
      
        <div class="episode-text">
          <div class="episode-link-block">
            <a href="#" class="episode-title episode-go-gallery" data-group-id="${esc(gid)}">${esc(title)}</a>
            ${subtitle ? `<a href="#" class="episode-subtitle episode-go-gallery" data-group-id="${esc(gid)}">${esc(subtitle)}</a>` : ''}
          </div>
          ${authorsHtml}
          ${contributorsHtml}
        </div>
      `;      

      list.appendChild(row);
    }

    // One delegated handler for the whole Episodes list
    list.addEventListener('click', (ev) => {
      // Author / contributor name → Team page (close menu first)
      const authorLink = ev.target.closest('a[data-author-name]');
      if (authorLink) {
        ev.preventDefault();
        ev.stopPropagation();

        const name = authorLink.dataset.authorName || (authorLink.textContent || '').trim();
        closeOverlay(ev);
        window.openAuthorSubpageForName?.(name);
        return;
      }

      // Image / title / subtitle → Group gallery (close menu first)
      const go = ev.target.closest('.episode-go-gallery');
      if (!go) return;

      ev.preventDefault();
      const gid = go.dataset.groupId || go.closest('.episode-entry')?.dataset.groupId;
      if (!gid) return;

      closeOverlay(ev);
      window.openGroupEntry?.(gid, { from: 'menu' });      
    });

    subMenu.appendChild(list);
    applyEpisodeThumbScale(list);
  }

  function placeSubMenuForViewport(target) {
    if (!subMenu || !overlayContent || !mainMenuEl) return;
  
    const isMobile = mobileMq?.matches ?? (window.innerWidth <= 768);
  
    if (isMobile && target) {
      const activeItem = mainMenuEl.querySelector(`.menu-item[data-target="${target}"]`);
      if (activeItem) {
        activeItem.insertAdjacentElement('afterend', subMenu);
        return;
      }
    }
  
    // Desktop (or no target): keep it as the 2nd column (original placement)
    overlayContent.appendChild(subMenu);
  }  

  function setActiveMenu(target){
    mainItems.forEach(i => i.classList.remove('active'));
    overlay.querySelector(`.menu-item[data-target="${target}"]`)?.classList.add('active');
  
    // Move the sub-menu directly under the active item on mobile
    placeSubMenuForViewport(target);

    // NEW: allow mobile CSS to special-case Episodes submenu sizing
    subMenu.classList.toggle('is-episodes', target === 'episodes');
  
    subMenu.innerHTML = '';
    setSubMenuOpen(false); // keep collapsed while we fill it       

    if (target === 'episodes') {
      renderEpisodesMenu();
      openSubMenuAnimated();
      return;         
    }    

    (subItemsMap[target] || []).forEach(text => {
      const div = document.createElement('div');
      div.className = 'sub-item';
      div.textContent = text;
      div.addEventListener('click', () => {
        subMenu.querySelectorAll('.sub-item').forEach(i => i.classList.remove('active'));
        div.classList.add('active');
      
        // 1) route to subpage if mapped
        const route = SUBPAGE_ROUTES[text];
        if (route) {
          closeOverlay();
          openTextSubpage(route.id, route.header);
          return;
        }
      
        // 2) otherwise: run a custom action (Map Modes -> grid mode switch)
        const action = GRID_MODE_MENU_ACTIONS[text];
        if (action) {
          goToGridThen(action);
        }
      });      
      subMenu.appendChild(div);
    });

    openSubMenuAnimated();
  }

  const openOverlay = (e) => {
    e?.preventDefault();
    previousFocus = document.activeElement;
    overlay.classList.add('active');
    document.body.classList.add('menu-open');           // <-- mode class for header

    // Reset menu state: no active main item, no sub-items visible
    mainItems.forEach((i) => i.classList.remove('active'));

    resetSubMenu({ animate: false });

    headerClose?.focus?.();
  };
  
  const closeOverlay = (e) => {
    e?.preventDefault();
    overlay.classList.remove('active');
    document.body.classList.remove('menu-open');        // <-- remove mode class
    previousFocus?.focus?.();
  };  

  trigger?.addEventListener('click', openOverlay);
  trigger?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openOverlay(e); });
  headerClose?.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(e); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOverlay(e); });
  mainItems.forEach(i => i.addEventListener('click', () => {
    const target = i.dataset.target;

    // Mobile toggle: clicking an already-open item closes its sub-items
    const isMobile = mobileMq?.matches;
    const hasSubItems =
      target === 'episodes' || (subItemsMap[target] || []).length > 0;

      if (isMobile && hasSubItems && i.classList.contains('active')) {
        // collapse (animated)
        i.classList.remove('active');
        resetSubMenu({ animate: true });
        return;
      }      

    // Team: open Team subpage directly (no sub-menu)
    if (target === 'team') {
      const route = SUBPAGE_ROUTES['Team'];
      if (route && typeof openTextSubpage === 'function') {
        closeOverlay();
        openTextSubpage(route.id, route.header);
      }
      return;
    }

    // Default behavior (if new menu items are added later)
    setActiveMenu(target);
  }));

  mobileMq?.addEventListener?.('change', () => {
    if (!overlay.classList.contains('active')) return;
  
    const activeTarget = overlay.querySelector('.main-menu .menu-item.active')?.dataset?.target;
    placeSubMenuForViewport(activeTarget || null);
  });  
}

// === Subpage initializers (run when a subpage is opened) ===
const SUBPAGE_INITS = {
  'subpage-references': initReferencesSubpage,
  'subpage-team': initTeamSubpage,
};

function runSubpageInit(el, id) {
  // Re-run safe; if you want "once", set el.__initRan = true and guard here.
  const fn = SUBPAGE_INITS[id];
  if (typeof fn === 'function') fn(el);
}

// Config for References page (easy to tweak later)
const REFERENCES_PAGE = {
  collection: 'literature-references',   // Strapi path for LiteratureReference
  field: 'Name',                         // field to render
  sort: 'Name:asc',
  publicationState: 'preview'
};

// Loader for #subpage-references
async function initReferencesSubpage(root) {
  const right = root.querySelector('.two-col-row .right');
  if (!right) return;

  right.innerHTML = '<p>Loading…</p>';

  try {
    const rows = await strapiFetchAll(REFERENCES_PAGE.collection, {
      'publicationState': REFERENCES_PAGE.publicationState,
      'populate': '*',
      'sort': REFERENCES_PAGE.sort
      // optionally: 'fields[0]': REFERENCES_PAGE.field
    });

    right.innerHTML = '';

    const htmlPieces = [];
    rows.forEach(it => {
      const a = (it && (it.attributes || it)) || {};
      const name = a[REFERENCES_PAGE.field] ?? a[REFERENCES_PAGE.field.toLowerCase()];
      if (!name) return;
    
      const html = toParagraphHtml(name); // returns <p>...</p><p>...</p>...
      if (html) htmlPieces.push(html);
    });
    
    right.innerHTML = htmlPieces.join('');
    
    if (!right.children.length) {
      right.innerHTML = '<p>No references yet.</p>';
    }

  } catch (err) {
    console.error('[references] load failed', err);
    right.innerHTML = '<p>Failed to load references.</p>';
  }
}

function initTeamSubpage(root) {
  // Don’t start a second async init while the first is in flight
  if (root.__initPromise) return root.__initPromise;

  root.__initPromise = ensureAuthorsRendered()
    .catch(e => console.warn('[team] ensureAuthorsRendered failed:', e))
    .then(() => new Promise(resolve => {
      requestAnimationFrame(() => {
        initSlideInAccordion('#subpage-team', {
          mode: 'accordion',
          dynamicHeight: false,
          scrollOnOpen: true,
          initialOpen: -1 // keep Team collapsed by default
        });
        resolve();
      });
    }));

  return root.__initPromise;
}

function hideAllTextSubpages() {
  document.querySelectorAll('.text-subpage').forEach((s) => {
    s.hidden = true;
    s.classList.remove('active');
  });
}

// Show a text sub-page (by id), hide others, and set header-left
function openTextSubpage(sectionId, headerText, options = {}) {
  // 0) Hide grid + any other main views (gallery/detail/research)
  const gridShell = document.getElementById('grid-shell');
  if (gridShell) gridShell.style.display = 'none';
  document.querySelectorAll('.scroll-container-horizontal.active, .scroll-container-vertical.active')
    .forEach(n => n.classList.remove('active'));

  // When entering a text subpage, we are no longer in any full-page main view
  document.body.classList.remove(
    'in-detail-page',
    'in-group-gallery',
    'in-gallery',
    'in-adhoc-gallery'
  );

  // 1) Hide all text sub-pages and clear their state
  document.querySelectorAll('.text-subpage').forEach(s => {
    s.hidden = true;
    s.classList.remove('active');
  });

  // 2) Show the requested one (attribute + class so CSS displays it)
  const el = document.getElementById(sectionId);
  if (el) {
    el.hidden = false;
    el.classList.add('active');
    runSubpageInit(el, sectionId);
  }

  // 3) Header & layout adjustments
  setHeaderLeft('custom', { text: headerText });
  if (typeof applyHeaderOffset === 'function') applyHeaderOffset();

  // 4) Focus for a11y
  el?.focus?.();

  // NEW: re-evaluate sidebars + selection bar on text pages
  refreshSlideInsVisibility();
  window.__dispatchViewChange?.();

  // Register this subpage as a distinct view in history
  if (!options.skipHistory && typeof pushViewState === 'function') {
    pushViewState(
      VIEW.SUBPAGE,
      { sectionId, headerText },
      `#${sectionId}`
    );
  }
}

window.openTextSubpage = openTextSubpage;

// Generic handler: any element with data-subpage-id will open that text subpage
function initSubpageLinkShortcuts() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-subpage-id]');
    if (!link) return;

    const sectionId = link.getAttribute('data-subpage-id');
    if (!sectionId) return;

    const headerText =
      link.getAttribute('data-subpage-header') ||
      (link.textContent || '').trim() ||
      'Information';

    if (typeof openTextSubpage !== 'function') return;

    event.preventDefault();
    openTextSubpage(sectionId, headerText);
  });
}

/**
 * Back buttons on text subpages.
 * - If history.state.view === VIEW.SUBPAGE, use history.back()
 *   so the user returns to the previous view (grid, research, detail, etc.).
 * - Otherwise, fall back to goHome().
 */
function initSubpageBackButtons() {
  document.addEventListener('click', (event) => {
    const back = event.target.closest('.text-subpage-back');
    if (!back) return;

    const activeSubpage = document.querySelector('.text-subpage.active');
    if (!activeSubpage) {
      // Not currently in a text subpage; let other handlers handle it.
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const state = history.state || {};
    if (state.view === VIEW.SUBPAGE) {
      // Use browser history so we return exactly to the previous view
      try {
        history.back();
      } catch (err) {
        console.warn('[subpage] history.back() failed, falling back to goHome()', err);
        if (typeof goHome === 'function') goHome();
      }
    } else if (typeof goHome === 'function') {
      // No subpage state: just go back to the home grid
      goHome();
    }
  });
}

function initIntroObjectLinks() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a.intro-object-link[data-object-id]');
    if (!link) return;

    const rawId = (link.dataset.objectId || link.getAttribute('data-object-id') || '').trim();
    if (!rawId) return;

    event.preventDefault();
    event.stopPropagation?.();

    // Resolve to the actual app-level object ID used in gridObject.objects
    const allObjects = window.gridObject?.objects || window.objects || [];
    let objectId = rawId;

    // If there is no object with this exact id, but there *is* one with "sobj_<rawId>",
    // assume rawId is a Strapi entry id and use the prefixed one.
    if (!allObjects.some(o => String(o.id) === String(objectId))) {
      const prefixed = `sobj_${rawId}`;
      if (allObjects.some(o => String(o.id) === String(prefixed))) {
        objectId = prefixed;
      }
    }

    if (typeof window.openObjectDetail === 'function') {
      // Close any active text subpage (e.g. Introduction) before jumping to detail
      if (typeof hideAllTextSubpages === 'function') {
        hideAllTextSubpages();
      }

      window.openObjectDetail({
        objectId,
        from: 'intro'
      });
    } else {
      console.warn('[intro-links] openObjectDetail is not available yet');
    }
  });
}

function initArrowListScrolling() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('.arrow-list a[href^="#"]');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href || !href.startsWith('#')) return;

    const targetId = href.slice(1).trim();
    if (!targetId) return;

    const target = document.getElementById(targetId);
    if (!target) return;

    // We fully override default behavior
    event.preventDefault();
    event.stopPropagation?.();

    // Use the same scroll-locator as scroll-up buttons
    const scroller = (typeof nearestScroller === 'function')
      ? nearestScroller(target)
      : target.closest('.scroll-container-vertical') ||
        document.scrollingElement ||
        document.documentElement;

    if (!scroller) return;

    const targetRect   = target.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const targetTop    = targetRect.top - scrollerRect.top + scroller.scrollTop;

    scroller.scrollTo({
      top: targetTop,
      behavior: 'smooth'
    });
  });
}

// Run once DOM is ready (keep your existing DOMContentLoaded handlers)
document.addEventListener('DOMContentLoaded', () => {
  initSlideIns();
  initOverlayMenu();
  initSubpageLinkShortcuts();
  initSubpageBackButtons();
  initIntroObjectLinks();
  initArrowListScrolling();   // ← add this line
  initAuthorBylineLinks();
  // Theme toggle: header + overlay footer
  renderThemeToggle(document.querySelector('.header-right'));
  renderThemeToggle(document.getElementById('overlay-footer-theme'));
  syncThemeToggleUI();
  refreshSlideInsVisibility();
  initScrollUpButtons();
  updateRightCounterOffset();

  //  Header title → "Home" (grouped grid) navigation
  const headerCenter = document.getElementById('header-center');
  if (headerCenter) {
    const activateHome = (evt) => {
      evt?.preventDefault();
      if (typeof goHome === 'function') {
        goHome();
      } else if (typeof window.goHome === 'function') {
        window.goHome();
      }
    };

    headerCenter.addEventListener('click', activateHome);
    headerCenter.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        activateHome(e);
      }
    });
  }

  const slideIns = document.getElementById('slide-ins');
  if (slideIns) {
    ['transitionrun','transitionstart','transitionend'].forEach(evt => {
      slideIns.addEventListener(evt, (e) => {
        if (e.propertyName === 'transform' || !e.propertyName) {
          requestAnimationFrame(updateRightCounterOffset);
        }
      });
    });
  }
  window.addEventListener('resize', updateRightCounterOffset);
});

// === Rich text enhancement: linkify URLs and embed YouTube ===

// Try to extract a YouTube video ID from a URL string
function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '');
    let id = null;

    if (host === 'youtu.be') {
      id = u.pathname.slice(1);
    } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      if (u.pathname === '/watch') {
        id = u.searchParams.get('v');
      } else if (u.pathname.startsWith('/embed/')) {
        id = u.pathname.split('/')[2] || null;
      } else if (u.pathname.startsWith('/shorts/')) {
        id = u.pathname.split('/')[2] || null;
      }
    }

    if (!id) return null;
    return id.replace(/[^-\w]/g, '');
  } catch {
    return null;
  }
}

// Create a YouTube embed wrapper for a given video id
function createYouTubeEmbed(url, videoId) {
  const wrapper = document.createElement('div');
  wrapper.className = 'yt-embed';

  const iframe = document.createElement('iframe');
  iframe.src = 'https://www.youtube-nocookie.com/embed/' + videoId;
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.allowFullscreen = true;
  iframe.loading = 'lazy';
  iframe.title = 'YouTube video';

  wrapper.appendChild(iframe);
  return wrapper;
}

// Replace URLs inside a single text node by <a> or YouTube embeds
// and also turn superscript digits (¹²³ etc.) into clickable footnote links
function wireFootnoteRef(el) {
  if (!el) return;

  // Avoid double-binding on the same element
  if (el.dataset && el.dataset.footnoteLinked === '1') return;
  if (el.dataset) {
    el.dataset.footnoteLinked = '1';
  }

  // Always make it look clickable
  el.classList.add('detail-footnote-ref');

  el.addEventListener('click', (ev) => {
    const root =
      el.closest('#detail-content') ||
      el.closest('.scroll-container-vertical') ||
      document;

    const footnotes = root.querySelector('.detail-footnotes');
    if (!footnotes) {
      // No footnotes in this view → do nothing special
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();
    footnotes.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function linkifyTextNode(textNode) {
  const text = textNode.nodeValue;
  if (!text) return;

  // Quick check: if there's no URL and no superscript digits, skip
  const hasUrl = /https?:\/\/[^\s<]+/i.test(text);
  const hasSupDigit = /[⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(text); // ¹²³, ⁴…⁹, ⁰
  if (!hasUrl && !hasSupDigit) return;

  const parent = textNode.parentNode;
  if (!parent) return;

  const frag = document.createDocumentFragment();

  // Match either URLs or runs of superscript digits
  const tokenRegex = /https?:\/\/[^\s<]+|[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gi;
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(text)) !== null) {
    const token = match[0];
    const index = match.index;

    // Text before this token
    if (index > lastIndex) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex, index)));
    }

    if (/^https?:\/\//i.test(token)) {
      // URL → YouTube embed or normal link (existing behavior)
      const url = token;
      const ytId = extractYouTubeId(url);
      if (ytId) {
        frag.appendChild(createYouTubeEmbed(url, ytId));
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.textContent = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        frag.appendChild(a);
      }
    } else {
      // Superscript footnote marker(s) like "²" or "¹²"
      const span = document.createElement('span');
      span.textContent = token;
      wireFootnoteRef(span);
      frag.appendChild(span);
    }

    lastIndex = index + token.length;
  }

  // Remaining text after the last token
  if (lastIndex < text.length) {
    frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  parent.replaceChild(frag, textNode);
}

function attachFootnoteLink(supEl) {
  if (!supEl || supEl.dataset.footnoteLink === '1') return;

  const text = (supEl.textContent || '').trim();
  if (!text) return;

  // Accept normal digits and superscript digits (¹²³ and ⁰–⁹)
  const isFootnoteNumber = /^[0-9\u00B9\u00B2\u00B3\u2070-\u2079]+$/.test(text);
  if (!isFootnoteNumber) return;

  // Find the relevant container for this detail block
  const container =
    supEl.closest('.content-section .section-content') ||
    supEl.closest('.detail-content') ||
    supEl.closest('.content-section');

  if (!container) return;

  const footnotes = container.querySelector('.detail-footnotes');
  if (!footnotes) return;

  // Mark so we don't re-wire the same node twice
  supEl.dataset.footnoteLink = '1';
  supEl.classList.add('detail-footnote-ref');

  supEl.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    footnotes.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// Walk a subtree and enhance text nodes (skip anchors, scripts, etc.)
function walkEnhancer(node) {
  if (!node) return;

  // Text node
  if (node.nodeType === 3) { // Node.TEXT_NODE
    linkifyTextNode(node);
    return;
  }

  // Only traverse elements
  if (node.nodeType !== 1) return; // Node.ELEMENT_NODE

  const tag = node.tagName;
  if (!tag) return;

  // Superscripts → link to FootNotes (if present in this detail block)
  if (tag === 'SUP') {
    attachFootnoteLink(node);
  }

  // Do NOT walk into these elements (already links or code-like)
  const skip = ['A', 'IFRAME', 'SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'BUTTON'];
  if (skip.includes(tag)) return;

  // Iterate children carefully because linkifyTextNode can replace nodes
  let child = node.firstChild;
  while (child) {
    const next = child.nextSibling;
    walkEnhancer(child);
    child = next;
  }
}

// Public helper: enhance all .content-section .section-content under a root
function enhanceContentSections(root) {
  const base = (root && root.querySelectorAll) ? root : document;
  const containers = base.querySelectorAll('.content-section .section-content');
  containers.forEach(container => {
    walkEnhancer(container);
  });
}

window.enhanceContentSections = enhanceContentSections;

function applyHeaderOffset() {
  const header = document.querySelector('header');
  if (!header) return;
  const h = Math.ceil(header.getBoundingClientRect().height); // includes borders
  document.documentElement.style.setProperty('--header-h', `${h}px`);

  // If the grid is already mounted, make sure the camera is still in legal bounds
  if (window.gridObject?.clampCameraToBounds) {
    window.gridObject.clampCameraToBounds(true, 'header-resize');
  }
}

// Inline an external SVG file into a target element and force currentColor
async function inlineSvgInto(el, url) {
  try {
    const txt = await fetch(url, { cache: 'force-cache' }).then(r => r.text());
    // ensure the root <svg> inherits currentColor if not already set
    const patched = txt
      .replace(/<svg\b/i, (m) => `${m} fill="currentColor" stroke="currentColor"`);
    el.innerHTML = patched;
  } catch (err) {
    console.warn('[scroll-up] failed to inline SVG:', url, err);
  }
}

// Find the nearest vertical scroller (your .scroll-container-vertical/.text-subpage)
function nearestScroller(from) {
  let n = from;
  while (n && n !== document.body) {
    const cs = getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowY)) return n;
    n = n.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function initScrollUpButtons() {
  document.querySelectorAll('.scroll-up').forEach(btn => {
    // 1) Inline the icon
    //const src = btn.getAttribute('data-icon-src') || 'img/icons/arrow_counter_10x12px.svg';
    //const holder = btn.querySelector('.icon');
    //if (holder) inlineSvgInto(holder, src);

    // 2) Click & keyboard to scroll to top of the nearest scroller
    const goUp = () => {
      const scroller = nearestScroller(btn);
      scroller?.scrollTo({ top: 0, behavior: 'smooth' });
    };
    btn.addEventListener('click', goUp);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goUp(); }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyHeaderOffset();

  // Enhance any static content sections (if present on initial load)
  try {
    window.enhanceContentSections?.(document);
  } catch {}

  // Update on window resize
  window.addEventListener('resize', applyHeaderOffset);

  // Update when the header’s size changes (fonts, dynamic content, etc.)
  const header = document.querySelector('header');
  if (header && 'ResizeObserver' in window) {
    const ro = new ResizeObserver(applyHeaderOffset);
    ro.observe(header);
  }
});

function objectsMatchingCurrentFilter() {
  const all = window.gridObject?.objects || [];
  const tags = [...(window.activeTags || [])];
  const mode = (window.TAG_MODE || 'OR').toUpperCase();
  const themeFilter = window.activeThemeFilter || null;

  // Respect tag scoping if enabled
  let candidates = all;
  // 🔧 FIX: normalize group ids so "s42" and 42 match
  if (window.TAG_GROUP_POLICY === 'SCOPED' && window.activeTagGroupId != null) {
    const normalize = v => String(v).replace(/^s/i, ''); // strip leading 's'
    const gid = normalize(window.activeTagGroupId);
    candidates = candidates.filter(o => normalize(o.groupId) === gid);
  }

  // Theme-only filter (no tags selected)
  if (tags.length === 0 && themeFilter) {
    return candidates.filter(o => objectMatchesTheme(o, themeFilter));
  }

  // No tags and no theme → everything passes
  if (tags.length === 0) return candidates;

  // Tag-based filter (existing behavior)
  return candidates.filter(o => {
    const own = new Set(getObjectFilterTags(o));  // connectingTags only
    return (mode === 'AND')
      ? tags.every(t => own.has(t))
      : tags.some(t => own.has(t));
  });
}

function objectMatchesTheme(obj, themeOrId) {
  if (!obj || !themeOrId) return false;

  let theme = themeOrId;
  if (typeof theme !== 'object') {
    if (typeof window.findThemeById === 'function') {
      theme = window.findThemeById(themeOrId);
    } else {
      return false;
    }
  }

  const wantedId = theme.id != null ? String(theme.id) : null;
  const wantedName = (theme.title || theme.name || '')
    .toString()
    .trim()
    .toLowerCase();

  const list = Array.isArray(obj.themes) ? obj.themes : [];
  return list.some(t => {
    const tid   = t.id != null ? String(t.id) : null;
    const tName = (t.name || '').toString().trim().toLowerCase();
    return (wantedId && tid === wantedId) ||
           (wantedName && tName === wantedName);
  });
}

function objectsMatchingTheme(themeOrId) {
  const all = window.gridObject?.objects || [];
  if (!themeOrId) return all;
  return all.filter(o => objectMatchesTheme(o, themeOrId));
}

window.objectsMatchingTheme = objectsMatchingTheme;

// ==== Header-left dynamic copy (centralised) ====
const HEADER_COPY = {
  home: 'Home',
  connections: 'Make new connections',
  research: (loc) => `Research project in ${loc || '—'}`,
  themes: 'Explore by themes'
};

function resolveGroupTitle(gid, obj = null) {
  // 1) Prefer what came with the object (Strapi payload)
  const fromObj = obj?.groupTitle;
  if (fromObj) return fromObj;

  if (!gid) return '';

  // 2) If group meta exists (dummy or Strapi-provided)
  const fromMeta = window.groupMetaById?.[gid]?.title;
  if (fromMeta) return fromMeta;

  // 3) Fallback: find any loaded object from that group carrying a title
  const all = window.gridObject?.objects || window.objects || [];
  const any = all.find(o => String(o.groupId) === String(gid) && o.groupTitle);
  return any?.groupTitle || '';
}

// Expose the setter in case you want to call it directly
function setHeaderLeft(mode, ctx = {}) {
  const el = document.getElementById('header-left');
  if (!el) return;

  let text = '';
  switch (mode) {
    case 'home':
      text = HEADER_COPY.home;
      break;
    case 'connections':
      text = HEADER_COPY.connections;
      break;
    case 'research':
      text = HEADER_COPY.research(ctx.location);
      break;
    case 'themes':
      text = HEADER_COPY.themes;
      break;
    case 'custom':
      text = ctx.text || '';
      break;
    default:
      text = '';
      break;
  }

  HeaderTyper.type(el, text, {
    // tweak if you want a slower/faster feel
    minDelay: 14,
    maxDelay: 32,
    punctPause: 160,
    caret: true
  });
}
window.setHeaderLeft = setHeaderLeft;

window.setHeaderLeftText = (t) => setHeaderLeft('custom', { text: t });

// Single place that decides what the header should show right now
function refreshHeaderLeftFromState() {
  const body = document.body;
  const grid = window.gridObject; 

  // If a text subpage (About, References, Team, etc.) is active,
  // keep whatever header openTextSubpage() already set.
  if (document.querySelector('.text-subpage.active')) {
    return;
  }

  // Theme gallery → "Explore by themes"
  if (body.classList.contains('in-theme-gallery')) {
    return setHeaderLeft('themes');
  }

  // Group Gallery → show Group Title (top-left header)
  if (body.classList.contains('in-group-gallery')) {
    const gid = body.dataset.currentGroupId;
    const title =
      resolveGroupTitle(gid) ||
      window.groupMetaById?.[gid]?.title || // (extra-safe)
      '';
    return setHeaderLeft('custom', { text: title });
  }

  // Object Detail → show Group Title (top-left header)
  if (body.classList.contains('in-detail-page')) {
    const obj = window._lastDetailObject || null;
    const gid = obj?.groupId || window.__detailCtx?.gid || null;

    const title =
      resolveGroupTitle(gid, obj) ||
      window.groupMetaById?.[gid]?.title || // (extra-safe)
      obj?.groupLocation ||                 // last fallback (avoid blank)
      '';

    return setHeaderLeft('custom', { text: title });
  }

  // Adhoc (custom) gallery → “Make new connections”
  if (body.classList.contains('in-adhoc-gallery')) {
    return setHeaderLeft('connections');
  }

  // Grid states
  const state = grid?.currentState; // 'grouped' | 'clustered' | 'ungrouped' | 'pre-cluster'
  if (state === 'grouped')      return setHeaderLeft('home');
  if (state === 'clustered' || state === 'ungrouped' || state === 'pre-cluster') {
    return setHeaderLeft('connections');
  }

  // Fallback
  setHeaderLeft('home');
}
window.refreshHeaderLeftFromState = refreshHeaderLeftFromState;

function restoreGridStateFromDetail() {
  const g = window.gridObject;
  if (!g) return;
  if (g.currentState === 'detail' && g.prevState) {
    g.currentState = g.prevState;
    g.prevState = null;
  }
}
window.restoreGridStateFromDetail = restoreGridStateFromDetail;

function isAdhocGalleryActive() {
  const gg = document.getElementById('group-gallery');
  return !!(gg?.classList.contains('active') && document.body.classList.contains('in-adhoc-gallery'));
}

// Where the bottom selection bar is allowed (no galleries)
function selectionBarIsAllowed() {
  const b = document.body;
  let state = window.gridObject?.currentState; // 'grouped' | 'clustered' | 'ungrouped' | ...

  // If grid thinks it's still 'detail' but we're not on detail page, fall back to previous state
  if (state === 'detail' && !b.classList.contains('in-detail-page')) {
    state = window.gridObject?.prevState || state;
  }

  // NEW: never show the selection bar on text pages / research page
  if (typeof isTextPageActive === 'function' && isTextPageActive()) return false;

  // Never in galleries
  if (b.classList.contains('in-group-gallery'))  return false;
  if (isAdhocGalleryActive()) return true;

  // Allowed grid states (instant show during clustering)
  return state === 'clustered' || state === 'ungrouped' || state === 'pre-cluster';
}
window.selectionBarIsAllowed = selectionBarIsAllowed;

// Fire a single custom event whenever the view changes.
// We hook header updates to this event.
function dispatchViewChange() {
  document.dispatchEvent(new CustomEvent('app:viewchange', {
    detail: {
      bodyClasses: [...document.body.classList],
      gridState: window.gridObject?.currentState || null,
      currentGroupId: document.body.dataset.currentGroupId || null
    }
  }));
}
document.addEventListener('app:viewchange', refreshHeaderLeftFromState);
document.addEventListener('app:viewchange', () => window.renderSelectionBar?.());
document.addEventListener('app:viewchange', (e) => {
  if (e.detail?.gridState === 'grouped') {
    window.__gridWaves?.pauseAll?.();
  }
});

document.addEventListener('app:viewchange', (e) => {
  const mode = gridStateToMode(e?.detail?.gridState);
  if (!mode) return;
  markActive(mode);
  setStoredGridMode(mode);
});

// Patch grid mode-switch so the header updates automatically
function wireHeaderToGrid() {
  const g = window.gridObject;
  if (!g || g.__headerWired) return;
  g.__headerWired = true;

  const _group   = g.groupObjects?.bind(g);
  const _cluster = g.clusterGroupedObjects?.bind(g);
  const _ungroup = g.ungroupObjects?.bind(g);

  if (_group) {
    g.groupObjects = function(...args) {
      const out = _group(...args);
      setTimeout(dispatchViewChange, 0);
      return out;
    };
  }
  if (_cluster) {
    g.clusterGroupedObjects = function(...args) {
      const out = _cluster(...args);
      setTimeout(dispatchViewChange, 0);
      return out;
    };
  }
  if (_ungroup) {
    g.ungroupObjects = function(...args) {
      const out = _ungroup(...args);
      setTimeout(dispatchViewChange, 0);
      return out;
    };
  }
}

// Call this *once* after grid is created (see next step)
window.__wireHeaderToGrid = wireHeaderToGrid;
window.__dispatchViewChange = dispatchViewChange;

// Centralised "Home" navigation: reset to grouped grid view
function goHome(options = {}) {
  const gridShell   = document.getElementById('grid-shell');
  const overlayMenu = document.getElementById('overlay-menu');

  // 1) Close overlay menu if it is open
  if (overlayMenu && overlayMenu.classList.contains('active')) {
    overlayMenu.classList.remove('active');
    document.body.classList.remove('menu-open');
  }

  // 2) Hide all text subpages
  document.querySelectorAll('.text-subpage').forEach((s) => {
    s.hidden = true;
    s.classList.remove('active');
  });

  // 3) Close detail view if active (uses existing helper)
  if (typeof window.closeObjectDetail === 'function') {
    try { window.closeObjectDetail(); } catch (err) { console.warn(err); }
  }

  // 4) Close the long research page if active
  if (typeof window.closeResearchPage === 'function') {
    try { window.closeResearchPage(); } catch (err) { console.warn(err); }
  }

  // 5) Close any open gallery (group or ad-hoc)
  if (typeof window.closeGallery === 'function') {
    try { window.closeGallery(); } catch (err) { console.warn(err); }
  }

  // 6) Make sure the grid shell is visible
  if (gridShell) {
    gridShell.style.display = '';
    requestAnimationFrame(() => window.applyVisitedMarkers?.()); // ✅ ADD
  }

  // 7) Force the grid into grouped state
  const g = window.gridObject;
  if (g && typeof g.groupObjects === 'function') {
    g.groupObjects();
  }

  // NEW: re-evaluate slide-ins now that we are grouped
  refreshSlideInsVisibility();

  // 8) Let header + selection bar recompute their state
  if (typeof window.__dispatchViewChange === 'function') {
    window.__dispatchViewChange();
  }

  // Record this in history unless we’re being called from a popstate handler
  if (!options.skipHistory && typeof pushViewState === 'function') {
    pushViewState(VIEW.HOME, {}, '#home');
  }
}
window.goHome = goHome;

// ==== Header-left typewriter (cancelable) ====
const HeaderTyper = (() => {
  let token = 0;

  const defaults = {
    minDelay: 12,     // ms between chars
    maxDelay: 30,
    punctPause: 180,  // extra pause after , . ; : ! ?
    caret: true
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand  = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

  async function type(el, text, opts = {}) {
    if (!el) return;
    const o = { ...defaults, ...opts };

    // Cancel any previous typing
    const my = ++token;

    // Respect reduced-motion
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduced) {
      el.classList.remove('typing');
      el.textContent = text;
      return;
    }

    el.classList.toggle('typing', !!o.caret);

    // If text is identical, avoid retyping
    if (el.textContent === text) {
      el.classList.remove('typing');
      return;
    }

    el.textContent = '';
    const letters = Array.from(String(text)); // handles emoji / surrogate pairs

    for (let i = 0; i < letters.length; i++) {
      if (my !== token) return; // canceled by a newer call
      el.textContent += letters[i];

      let d = rand(o.minDelay, o.maxDelay);
      if (/[.,;:!?]/.test(letters[i])) d += o.punctPause;
      await sleep(d);
    }

    if (my !== token) return;
    el.classList.remove('typing');
  }

  function cancel() { token++; }

  return { type, cancel };
})();

function syncSelectionBarOverflow() {
  const bar = document.getElementById('selection-bar');
  if (!bar) return;

  const scroller = bar.querySelector('.sb-tags-scroll');
  const list = document.getElementById('selected-tags-list');
  if (!scroller || !list) return;

  // If total chip width exceeds visible width => overflow
  const overflow = list.scrollWidth > scroller.clientWidth + 1;

  bar.classList.toggle('sb-overflow', overflow);

  // When overflowing, force the scroll start to be at the beginning (left)
  // When not overflowing, keep it at 0 as well (centering is handled by flex)
  scroller.scrollLeft = 0;
}

// === Selected Tags Bottom Bar ===
function renderSelectionBar() {
  console.log("renderSelectionBar called")
  const bar  = document.getElementById('selection-bar');
  const list = document.getElementById('selected-tags-list');
  const ws   = document.getElementById('workspace');
  if (!bar || !list || !ws) return;

  // View gate: clustered / ungrouped / pre-cluster only; never in galleries
  if (typeof window.selectionBarIsAllowed === 'function' && !selectionBarIsAllowed()) {
    bar.classList.remove('show');
    ws.classList.remove('has-selection-bar');
    ws.classList.remove('selection-bar--compact');
    list.innerHTML = '';
    bar.classList.remove('sb-overflow');
    return;
  }  

  // Are we inside the ad-hoc (tag) gallery?
  const isAdhoc = isAdhocGalleryActive();
  ws.classList.toggle('selection-bar--compact', isAdhoc);

  // Current selection
  const raw  = window.activeTags;
  const tags = Array.isArray(raw) ? raw : (raw instanceof Set ? [...raw] : []);
  const theme = window.activeThemeFilter || null;

  // No tags and no theme → hide immediately (prevents “sticky” bar)
  if (tags.length === 0 && !theme) {
    bar.classList.remove('show');
    ws.classList.remove('has-selection-bar');
    ws.classList.remove('selection-bar--compact');
    list.innerHTML = '';
    const a = bar.querySelector('.sb-actions');
    if (a) a.remove();
    bar.classList.remove('sb-overflow');
    return;
  }  

  // Build pills (either theme OR tags)
  list.innerHTML = '';

  if (theme && tags.length === 0) {
    const li = document.createElement('li');
    li.dataset.themeId = theme.id != null ? String(theme.id) : '';
    li.className = 'theme-pill';
    const name = theme.title || theme.name || 'Untitled theme';
    li.innerHTML = `${name} <span class="x" aria-hidden="true">X</span>`;
    list.appendChild(li);
  } else {
    for (const tag of tags) {
      const li = document.createElement('li');
      li.dataset.tag = tag;
      li.innerHTML = `${tag} <span class="x" aria-hidden="true">X</span>`;
      const color = window.tagColors?.[tag];
      if (color) {
        li.classList.add('active');
        li.style.borderColor = color;
        li.style.color = color;
        li.style.boxShadow = `${color}66 0 0 8px`;
      }
      list.appendChild(li);
    }
  }

  // Bottom-row actions (Create gallery) — NOT in ad-hoc tag gallery
  const bottomRow = bar.querySelector('.sb-bottom');
  const host = bottomRow || bar;

  let actions = host.querySelector('.sb-actions') || bar.querySelector('.sb-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'sb-actions';
    host.appendChild(actions);
  }

  if (isAdhoc) {
    // In tag gallery, the bar is useful but this button isn't
    actions.innerHTML = '';
    actions.hidden = true;
    if (bottomRow) bottomRow.hidden = true;
  } else {
    actions.hidden = false;
    if (bottomRow) bottomRow.hidden = false;
    actions.innerHTML = '';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button btn-create-gallery';
    btn.innerHTML = '<span class="text">Create gallery</span><span class="icon">→</span>';
    btn.addEventListener('click', () => {
      const theme = window.activeThemeFilter || null;
      if (theme && tags.length === 0) {
        if (typeof window.openThemeGallery === 'function') window.openThemeGallery(theme);
      } else {
        const objs = objectsMatchingCurrentFilter();
        if (typeof window.openTagsGallery === 'function') window.openTagsGallery(objs, tags);
      }
    });

    actions.appendChild(btn);
  }

  // Show
  bar.classList.add('show');
  ws.classList.add('has-selection-bar');
  requestAnimationFrame(syncSelectionBarOverflow);
}
window.renderSelectionBar = renderSelectionBar;

function initSelectionBar() {
  const bar = document.getElementById('selection-bar');
  if (!bar || bar.dataset.inited === '1') return;
  bar.dataset.inited = '1';

  const scroller = bar.querySelector('.sb-tags-scroll');
  if (scroller && 'ResizeObserver' in window) {
    const ro = new ResizeObserver(() => syncSelectionBarOverflow());
    ro.observe(scroller);
  }

  bar.addEventListener('click', (e) => {
    // 1) Theme pill
    const themeLi = e.target.closest('li[data-theme-id]');
    if (themeLi) {
      // Clear theme filter and refresh UI
      window.activeThemeFilter = null;
      if (typeof updateObjectGlowsWithGradient === 'function') {
        updateObjectGlowsWithGradient();
      }
      if (typeof scheduleOffgridUpdate === 'function') {
        scheduleOffgridUpdate();
      }
      if (typeof renderSelectionBar === 'function') {
        renderSelectionBar();
      }
      return;
    }

    // 2) Tag pill
    const li = e.target.closest('li[data-tag]');
    if (!li) return;
    const tag = li.dataset.tag;

    // Are we inside the ad-hoc (tag) gallery?
    const isAdhoc = isAdhocGalleryActive();

    if (window.activeTags?.has(tag) && typeof window.deselectTagGlobally === 'function') {
      window.deselectTagGlobally(tag, { closeGalleryWhenEmpty: isAdhoc });
    }
  });

  // First paint
  renderSelectionBar();
}
document.addEventListener('DOMContentLoaded', initSelectionBar);
document.addEventListener('DOMContentLoaded', initMobileSlideInsToggle);


document.addEventListener('DOMContentLoaded', () => {
  // Initial sync (in case something is preselected)
  syncDetailTagHighlights();

  // Keep detail pills in sync when panels/cards are re-rendered
  const detailRoot =
    document.getElementById('right-side') ||
    document.getElementById('detail') ||
    document.body;

  const mo = new MutationObserver(() => {
    syncDetailTagHighlights();
  });
  mo.observe(detailRoot, { childList: true, subtree: true });
});


// TODO: content type video
// TODO: integrate offsetX again
// TODO: dynamic random placement of groups within viewport
// TODO: fix problem with transition from ungrouped to group (viewport)
// TODO: reverse group ungroup logic
// TODO: add grid debug mode

// TODO: non repeating image placing (to be done)

// TODO: content type text (done)
// TODO: set boundaries for dragging (done)
// TODO: calculate amount of rows and cols without waste of space (done)
// TODO: dynamic random placement of group items (done)
// TODO: get back grid margins (done)
// TODO: canvas dragging (done)
// TODO: center grid view (done)
// TODO: animation from pile to unklinked, unlinked to pile (done)
// TODO: dynamic cell sizes (not for now)
// TODO: cell margins (done)
// TODO: add video, text, image (to be done)
