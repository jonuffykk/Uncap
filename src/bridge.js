(() => {
  'use strict';

  const keys = [
    'enabled', 'mode', 'smooth', 'compare', 'target', 'sharpen', 'darken', 'thin',
    'denoise', 'deband', 'deblur', 'split', 'volume', 'compress', 'stream', 'display', 'codecs', 'audio', 'tracks', 'peak',
    'drm', 'hdr', 'efficient', 'hud', 'badge', 'theme', 'allowAll', 'allowList', 'keys', 'bench'
  ];

  let live = true;

  const post = (type, payload) => {
    try {
      window.postMessage({ source: 'uncap', type, payload }, '*');
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
    if (!live || event.source !== window || event.data?.source !== 'uncapPage') return;
    if (event.data.type === 'telemetry') {
      guard(() => chrome.runtime.sendMessage({ type: 'telemetry', telemetry: event.data.payload }));
      return;
    }
    if (event.data.type !== 'set') return;
    const patch = {};
    for (const key of keys) {
      if (event.data.payload && key in event.data.payload) patch[key] = event.data.payload[key];
    }
    if (Object.keys(patch).length) {
      guard(() => chrome.runtime.sendMessage({ type: 'write', patch, host: event.data.host }));
    }
  }

  window.addEventListener('message', relay);

  guard(() => chrome.runtime.onMessage.addListener((message) => {
    if (live && message?.type === 'signal') post('signal', message.name);
    return false;
  }));

  guard(() => chrome.storage.local.get(keys).then((config) => {
    post('config', { ...config, version: chrome.runtime.getManifest().version });
  }));

  guard(() => chrome.storage.onChanged.addListener((changes, area) => {
    if (!live || area !== 'local') return;
    const patch = {};
    let changed = false;
    for (const key of keys) {
      if (key in changes) {
        patch[key] = changes[key].newValue;
        changed = true;
      }
    }
    if (changed) post('config', patch);
  }));
})();
