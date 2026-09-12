const DEFAULTS = {
  enabled: true,
  video: true,
  audio: true,
  tracks: true,
  display: true,
  drm: true,
  bitrate: true,
  hud: false
};

const BADGE = { UHD: '#7fd18a', FHD: '#f2b441', HD: '#c98a2e', SD: '#d05a3c' };

const slot = (tabId) => `telemetry:${tabId}`;
const rank = (data) => (data?.playing ? 2 : data?.resolution ? 1 : 0);

const paintBadge = (tabId, data) => {
  const text = data.playing && data.tier ? data.tier : '';
  chrome.action.setBadgeText({ tabId, text }).catch(() => { });
  if (!text) return;
  chrome.action.setBadgeTextColor({ tabId, color: '#0b0b0c' }).catch(() => { });
  chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE[text] || '#6f6d67' }).catch(() => { });
};

const store = async (tabId, frameId, telemetry) => {
  const key = slot(tabId);
  const incoming = { ...telemetry, at: Date.now(), frameId };
  const current = (await chrome.storage.session.get(key))[key];
  if (current && current.frameId !== frameId && Date.now() - current.at < 3000 && rank(current) > rank(incoming)) return;
  await chrome.storage.session.set({ [key]: incoming });
  paintBadge(tabId, incoming);
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const missing = {};
  for (const [name, value] of Object.entries(DEFAULTS)) if (current[name] === undefined) missing[name] = value;
  if (Object.keys(missing).length) await chrome.storage.local.set(missing);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'telemetry' && sender.tab?.id != null) {
    store(sender.tab.id, sender.frameId ?? 0, message.telemetry).catch(() => { });
    return false;
  }
  if (message?.type === 'read') {
    const key = slot(message.tabId);
    chrome.storage.session.get(key).then((data) => sendResponse(data[key] || null)).catch(() => sendResponse(null));
    return true;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(slot(tabId)).catch(() => { });
});
