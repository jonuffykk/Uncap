const DEFAULTS = {
  enabled: true,
  video: true,
  audio: true,
  tracks: true,
  display: true,
  drm: true,
  bitrate: true,
  hdr: false
};

const CONTROLS = [
  ['enabled', 'Engine'],
  ['video', 'Video profiles'],
  ['audio', 'Surround audio'],
  ['bitrate', 'Peak bitrate'],
  ['tracks', 'Every track'],
  ['display', '4K display report'],
  ['drm', 'DRM negotiation'],
  ['hdr', 'Force HDR']
];

const DECODERS = {
  h264: 'h264',
  hevc: 'hevc',
  av1: 'av1',
  dv: 'dolby vision',
  vp9: 'vp9',
  eac3: 'dd+',
  heaac: 'he-aac',
  xheaac: 'xhe-aac'
};

const DRM_NAMES = [
  ['com.microsoft.playready.recommendation.3000', 'playready sl3000'],
  ['com.microsoft.playready.recommendation', 'playready sl'],
  ['com.microsoft.playready', 'playready'],
  ['com.widevine.alpha', 'widevine'],
  ['com.apple.fps', 'fairplay']
];

const TARGET = '3840 × 2160';
const STALE_AFTER = 6000;

const $ = (id) => document.getElementById(id);

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const mbps = (kbps) => `${(kbps / 1000).toFixed(2)} Mb/s`;

const drmLine = (data) => {
  if (!data?.keySystem) return '';
  const named = DRM_NAMES.find(([id]) => data.keySystem === id || data.keySystem.startsWith(id));
  return `${data.hardwareDrm ? 'hardware' : 'software'} · ${named ? named[1] : data.keySystem}`;
};

const rangeLine = (data) => {
  if (!data?.videoCodec) return '';
  if (data.hdr) return data.hdrForced ? 'HDR · forced' : 'HDR';
  if (data.hdrNative === true) return 'SDR · HDR available';
  if (data.hdrNative === false) return 'SDR · panel is SDR';
  return 'SDR';
};

const dolbyLine = (data) => {
  if (!data || (!data.playing && !data.keySystem)) return '';
  if (data.audioLabel === 'Dolby Atmos') return 'atmos playing';
  if (data.audioLabel?.startsWith('Dolby')) return data.spatialForced ? 'dd+ · atmos asked for' : 'dd+ playing';
  if (!data.codecs?.eac3) return 'no decoder in this browser';
  if (data.keySystem && !data.keySystem.startsWith('com.microsoft.playready')) return 'needs playready';
  if (data.added?.some((profile) => profile.startsWith('ddplus'))) return 'requested';
  return 'not offered here';
};

const struggling = (data) => !!data?.frames && data.frames > 300 && data.dropped / data.frames > 0.01;

const verdict = (data, live) => {
  if (!data) return null;
  if (data.enabled === false) return ['', 'Engine paused. Netflix is picking on its own.'];
  if (!live) return ['', 'Waiting for the Netflix player to report in.'];
  if (data.spoofed && data.screen !== TARGET) return ['warn', 'This tab loaded before the engine. Reload it.'];
  if (!data.playing) return ['', 'Hooks are live on this tab. Press play.'];
  if (struggling(data)) return ['bad', `Dropping frames, ${data.dropped} of ${data.frames}.`];
  if (data.tier === 'UHD') return ['up', 'Ultra HD confirmed from the decoder.'];
  if (!data.spoofed) return ['warn', 'Display report is off, so Netflix caps by your real screen.'];
  if (!data.hardwareDrm) return ['warn', `Software DRM caps this session at ${data.height}p.`];
  return ['warn', `Playing at ${data.height}p. This title may not ship a higher track.`];
};

const setStatus = (result) => {
  const [tone, text] = result || ['', ''];
  $('statusDot').className = tone ? `status-dot ${tone}` : 'status-dot';
  $('statusText').textContent = text;
};

const EMPTY = new Set(['', undefined, null]);

const renderReadout = (entries) => {
  const known = entries.filter(([, value]) => !EMPTY.has(value));
  $('readout').replaceChildren(...known.flatMap(([label, value, tone]) => {
    const term = el('dt', null, label);
    const detail = el('dd', tone || null, String(value));
    return [term, detail];
  }));
};

const render = (data) => {
  const live = !!data && Date.now() - data.at < STALE_AFTER;
  const playing = live && data.playing;

  $('tier').textContent = playing ? data.tier : live ? 'Armed' : '—';
  $('tier').className = 'tier' + (playing ? (data.tier === 'UHD' ? ' peak' : '') : ' idle');
  $('resolution').textContent = playing ? data.resolution : live ? 'press play' : 'no signal';
  setStatus(verdict(data, live));

  if (data) document.body.classList.toggle('paused', data.enabled === false);

  renderReadout([
    ['video', data?.videoBitrate ? mbps(data.videoBitrate) : ''],
    ['audio', data?.audioLabel
      ? (data.audioBitrate ? `${data.audioLabel} · ${data.audioBitrate} kb/s` : data.audioLabel)
      : '', data?.audioLabel?.startsWith('Dolby') ? 'up' : ''],
    ['dolby', dolbyLine(data), data?.audioLabel?.startsWith('Dolby') ? 'up' : 'dim'],
    ['codec', data?.videoCodec || ''],
    ['range', rangeLine(data), data?.hdr ? (data.hdrForced && data.hdrNative !== true ? 'warn' : 'up') : ''],
    ['drm', drmLine(data), data?.hardwareDrm ? 'up' : data?.keySystem ? 'warn' : ''],
    ['decode', data?.efficient === true ? 'hardware' : data?.efficient === false ? 'software' : '',
      data?.efficient === false ? 'warn' : ''],
    ['dropped', data?.frames ? `${data.dropped} / ${data.frames}` : '', struggling(data) ? 'warn' : ''],
    ['upgrades', data?.added?.length ? `+${data.added.length} profiles` : playing ? 'none needed' : ''],
    ['peak', data?.peak || (playing ? 'standby' : ''), data?.peak === 'pinned' ? 'up' : ''],
    ['decoders', data?.codecs
      ? Object.entries(DECODERS).filter(([key]) => data.codecs[key]).map(([, label]) => label).join(' · ')
      : '', 'dim wrap'],
    ['screen', data?.screen || '', data?.screen === TARGET ? 'up' : 'warn'],
    ['panel', data?.panel || '', 'dim']
  ]);
};

const renderControls = (config) => {
  $('controls').replaceChildren(...CONTROLS.map(([key, label]) => {
    const row = el('label', 'control');
    const title = el('span', null, label);

    const toggle = el('button', 'switch');
    toggle.type = 'button';
    toggle.role = 'switch';
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('aria-checked', String(config[key] === undefined ? DEFAULTS[key] : !!config[key]));
    toggle.addEventListener('click', async () => {
      const next = toggle.getAttribute('aria-checked') !== 'true';
      toggle.setAttribute('aria-checked', String(next));
      if (key === 'enabled') document.body.classList.toggle('paused', !next);
      await chrome.storage.local.set({ [key]: next });
    });

    row.append(title, toggle);
    return row;
  }));
};

const tick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url?.includes('netflix.com')) {
    render(null);
    setStatus(['', 'Open netflix.com in this tab to arm the engine.']);
    return;
  }

  const data = await chrome.runtime.sendMessage({ type: 'read', tabId: tab.id }).catch(() => null);
  if (!data) {
    render(null);
    setStatus(['warn', 'Reload this tab, it loaded before the engine did.']);
    return;
  }
  render(data);
};

const init = async () => {
  $('version').textContent = chrome.runtime.getManifest().version;

  const config = await chrome.storage.local.get(Object.keys(DEFAULTS));
  renderControls(config);
  document.body.classList.toggle('paused', config.enabled === false);

  await tick();
  setInterval(tick, 1000);
};

init();
