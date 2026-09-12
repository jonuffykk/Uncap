(() => {
  'use strict';

  const KEYS = ['enabled', 'video', 'audio', 'tracks', 'display', 'drm', 'bitrate', 'hdr'];
  let live = true;

  const post = (type, payload) => {
    try {
      window.postMessage({ source: 'nitrate', type, payload }, '*');
    } catch { }
  };

  const retire = () => {
    if (!live) return;
    live = false;
    window.removeEventListener('message', relay);
    post('detach');
  };

  const guard = (fn) => {
    if (!live) return;
    try {
      const result = fn();
      if (typeof result?.then === 'function') result.then(undefined, retire);
    } catch {
      retire();
    }
  };

  function relay(event) {
    if (!live || event.source !== window || event.data?.source !== 'nitrate-page') return;
    if (event.data.type !== 'telemetry') return;
    guard(() => chrome.runtime.sendMessage({ type: 'telemetry', telemetry: event.data.payload }));
  }

  window.addEventListener('message', relay);

  guard(() => chrome.storage.local.get(KEYS).then((config) => {
    post('config', { ...config, version: chrome.runtime.getManifest().version });
  }));

  guard(() => chrome.storage.onChanged.addListener((changes, area) => {
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
