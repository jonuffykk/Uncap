const defaults = {
  enabled: true,
  mode: 'balanced',
  smooth: 'off',
  compare: false,
  target: 'auto',
  sharpen: 0.35,
  darken: 0,
  thin: 0,
  denoise: 0,
  deband: 0,
  deblur: 0,
  split: 0.5,
  volume: 1,
  compress: false,
  stream: true,
  display: true,
  codecs: true,
  audio: true,
  tracks: true,
  peak: true,
  drm: true,
  hdr: false,
  efficient: true,
  hud: false,
  badge: true,
  theme: 'auto',
  allowAll: true,
  allowList: [],
  keys: { power: 'KeyO', hud: 'KeyU', mode: 'KeyE', compare: 'KeyX' },
  bench: null
};

const modes = ['off', 'balanced', 'sharp', 'anime', 'custom'];

const badgeInk = { UHD: '#0b0b0c' };
const badgeTint = { UHD: '#63d68a', FHD: '#e50914', HD: '#e50914', SD: '#e50914' };

const builtIn = ['*://*.netflix.com/*', '*://*.youtube.com/*'];
const mainFiles = [
  'src/core.js', 'src/stream.js', 'src/gpu.js', 'src/render.js', 'src/hud.js', 'src/sites.js'
];
const extraId = 'uncapExtra';
const bridgeId = 'uncapExtraBridge';
const freshFor = 3000;

let badgeOn = true;
chrome.storage.local.get('badge').then(({ badge = true }) => { badgeOn = badge; }).catch(() => { });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.badge) badgeOn = changes.badge.newValue !== false;
});

const slot = (tabId) => `tab:${tabId}`;
const rank = (data) => (data?.playing ? 2 : data?.resolution ? 1 : 0);

const paintBadge = (tabId, data) => {
  const text = badgeOn && data.playing && data.tier ? data.tier : '';
  chrome.action.setBadgeText({ tabId, text }).catch(() => { });
  if (!text) return;
  chrome.action.setBadgeTextColor({ tabId, color: badgeInk[text] || '#ffffff' }).catch(() => { });
  chrome.action.setBadgeBackgroundColor({ tabId, color: badgeTint[text] || '#6b6963' }).catch(() => { });
};

const keepBench = async (shot) => {
  if (!shot?.tier || !shot.to) return;
  const { bench } = await chrome.storage.local.get('bench');
  if (bench && bench.tier === shot.tier && bench.to === shot.to) return;
  await chrome.storage.local.set({
    bench: { at: Date.now(), to: shot.to, cost: shot.cost, budget: shot.budget, tier: shot.tier }
  });
};

const store = async (tabId, frameId, telemetry) => {
  const key = slot(tabId);
  const incoming = { ...telemetry, at: Date.now(), frameId };
  const current = (await chrome.storage.session.get(key))[key];
  if (current
    && current.frameId !== frameId
    && Date.now() - current.at < freshFor
    && rank(current) > rank(incoming)) return;
  await chrome.storage.session.set({ [key]: incoming });
  paintBadge(tabId, incoming);
  await keepBench(incoming.enhance).catch(() => { });
};

const fillDefaults = async () => {
  const current = await chrome.storage.local.get(Object.keys(defaults));
  const missing = {};
  for (const [name, value] of Object.entries(defaults)) {
    if (current[name] === undefined) missing[name] = value;
  }
  if (Object.keys(missing).length) await chrome.storage.local.set(missing);
};

const extraOrigins = async () => {
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.filter((origin) => !builtIn.includes(origin));
};

const syncExtras = async () => {
  const matches = await extraOrigins();
  const ids = [extraId, bridgeId];
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids }).catch(() => []);

  if (!matches.length) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids }).catch(() => { });
    return;
  }

  const scripts = [
    {
      id: extraId,
      matches,
      js: mainFiles,
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: true,
      persistAcrossSessions: true
    },
    {
      id: bridgeId,
      matches,
      js: ['src/bridge.js'],
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: true
    }
  ];

  const action = existing.length ? 'updateContentScripts' : 'registerContentScripts';
  await chrome.scripting[action](scripts).catch(async () => {
    await chrome.scripting.unregisterContentScripts({ ids }).catch(() => { });
    await chrome.scripting.registerContentScripts(scripts).catch(() => { });
  });
};

const wake = () => {
  fillDefaults().catch(() => { });
  syncExtras().catch(() => { });
};

chrome.runtime.onInstalled.addListener(async (details) => {
  wake();
  if (details.reason !== 'install' && details.reason !== 'update') return;
  const open = await chrome.tabs.query({ url: builtIn }).catch(() => []);
  for (const tab of open) chrome.tabs.reload(tab.id).catch(() => { });
});
chrome.runtime.onStartup.addListener(wake);
chrome.permissions.onAdded.addListener(() => { syncExtras().catch(() => { }); });
chrome.permissions.onRemoved.addListener(() => { syncExtras().catch(() => { }); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'telemetry' && sender.tab?.id != null) {
    store(sender.tab.id, sender.frameId ?? 0, message.telemetry).catch(() => { });
    return false;
  }
  if (message?.type === 'read') {
    chrome.storage.session.get(slot(message.tabId))
      .then((data) => sendResponse(data[slot(message.tabId)] || null))
      .catch(() => sendResponse(null));
    return true;
  }
  if (message?.type === 'syncExtras') {
    syncExtras().then(() => sendResponse(true)).catch(() => sendResponse(false));
    return true;
  }
  return false;
});

const signal = async (name) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return;
  await chrome.tabs.sendMessage(tab.id, { type: 'signal', name }).catch(() => { });
};

chrome.commands.onCommand.addListener(async (command) => {
  const stored = await chrome.storage.local.get(['enabled', 'mode', 'compare', 'hud']);
  const valueOf = (key) => stored[key] ?? defaults[key];

  if (command === 'toggleHud') {
    await chrome.storage.local.set({ hud: !valueOf('hud') });
    await signal('hud');
  } else if (command === 'togglePower') {
    await chrome.storage.local.set({ enabled: !valueOf('enabled') });
  } else if (command === 'toggleCompare') {
    await chrome.storage.local.set({ compare: !valueOf('compare') });
  } else if (command === 'cycleMode') {
    const index = modes.indexOf(valueOf('mode'));
    await chrome.storage.local.set({ mode: modes[(index + 1) % modes.length] });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(slot(tabId)).catch(() => { });
});
