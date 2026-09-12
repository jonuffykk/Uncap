(() => {
  'use strict';

  const KEYS = ['enabled', 'video', 'audio', 'tracks', 'display', 'drm', 'bitrate', 'hud'];
  let live = true;

  const post = (type, payload) => {
    try {
      window.postMessage({ source: 'nitrate', type, payload }, '*');
    } catch { /* the page is tearing down */ }
  };

  const stop = () => {
    if (!live) return;
    live = false;
    window.removeEventListener('message', relay);
    post('detach');
  };

  // Reloading or updating the extension orphans this script while the page keeps running, and
  // every chrome.* call then throws synchronously — something a .catch() never sees. So each
  // one goes through here, and the first failure retires the bridge for good rather than
  // throwing once per telemetry tick. Nothing outside this function touches chrome.
  const call = (fn) => {
    if (!live) return;
    try {
      const result = fn();
      if (typeof result?.then === 'function') result.then(undefined, stop);
    } catch {
      stop();
    }
  };

  function relay(event) {
    if (!live || event.source !== window || event.data?.source !== 'nitrate-page') return;
    const { type, payload } = event.data;
    if (type === 'telemetry') call(() => chrome.runtime.sendMessage({ type: 'telemetry', telemetry: payload }));
    else if (type === 'hud') call(() => chrome.storage.local.set({ hud: payload }));
  }

  window.addEventListener('message', relay);

  call(() => chrome.storage.local.get(KEYS)
    .then((config) => post('config', { ...config, version: chrome.runtime.getManifest().version })));

  call(() => chrome.storage.onChanged.addListener((changes, area) => {
    if (!live || area !== 'local') return;
    const patch = {};
    let changed = false;
    for (const key of KEYS) {
      if (key in changes) {
        patch[key] = changes[key].newValue;
        changed = true;
      }
    }
    if (changed) post('config', patch);
  }));
})();
