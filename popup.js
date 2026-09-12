const ICONS = {
  check: '<circle cx="12" cy="12" r="10"/><path d="m16 9-5.5 5.5L8 12"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  signal: '<path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 4v16"/>',
  off: '<path d="M18.36 6.64A9 9 0 0 1 20.77 15"/><path d="M6.16 6.16a9 9 0 1 0 12.68 12.68"/><path d="M12 2v4"/><path d="m2 2 20 20"/>',
  keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>'
};

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

const CONTROLS = [
  ['enabled', 'Engine'],
  ['video', 'Video profiles'],
  ['audio', 'Surround audio'],
  ['bitrate', 'Peak bitrate'],
  ['tracks', 'Every track'],
  ['display', 'Display report'],
  ['drm', 'DRM negotiation'],
  ['hud', 'Overlay']
];

const $ = (id) => document.getElementById(id);

const icon = (name, size = 13) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = ICONS[name];
  return svg;
};

const setStatus = (name, text, tone) => {
  const host = $('statusIcon');
  host.className = 'mt-[3px] shrink-0 ' + (tone === 'up' ? 'text-up' : tone === 'warn' ? 'text-flare' : 'text-mute');
  host.replaceChildren(icon(name));
  $('statusText').textContent = text;
};

const renderReadout = (rows) => {
  $('readout').replaceChildren(...rows.map(([label, value, tone]) => {
    const line = document.createElement('div');
    line.className = 'flex items-baseline justify-between gap-5 py-[3px]';
    const key = document.createElement('dt');
    key.className = 'text-mute';
    key.textContent = label;
    const data = document.createElement('dd');
    data.className = 'truncate tabular-nums ' + (tone === 'up' ? 'text-up' : 'text-ink');
    data.textContent = value;
    line.append(key, data);
    return line;
  }));
};

const renderControls = (config) => {
  $('controls').replaceChildren(...CONTROLS.map(([key, label]) => {
    const line = document.createElement('label');
    line.className = 'flex cursor-pointer items-center justify-between gap-4 py-[7px]';

    const title = document.createElement('span');
    title.className = 'text-[12px] text-ink';
    title.textContent = label;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.role = 'switch';
    toggle.dataset.key = key;
    toggle.setAttribute('aria-label', label);
    toggle.className = 'group relative h-[15px] w-[27px] shrink-0 rounded-xs border border-line transition-colors aria-checked:border-flare/70';
    const knob = document.createElement('span');
    knob.className = 'absolute left-[2px] top-[2px] h-[9px] w-[9px] rounded-xs bg-mute transition-[transform,background-color] duration-200 group-aria-checked:translate-x-[12px] group-aria-checked:bg-flare';
    toggle.append(knob);

    const value = config[key] === undefined ? DEFAULTS[key] : config[key];
    toggle.setAttribute('aria-checked', String(!!value));
    toggle.addEventListener('click', async () => {
      const next = toggle.getAttribute('aria-checked') !== 'true';
      toggle.setAttribute('aria-checked', String(next));
      await chrome.storage.local.set({ [key]: next });
      if (key === 'enabled') document.body.classList.toggle('opacity-50', !next);
    });

    line.append(title, toggle);
    return line;
  }));
};

const drmName = (data) => {
  if (!data?.keySystem) return '—';
  const label = data.keySystem
    .replace('com.microsoft.playready.recommendation.3000', 'playready sl3000')
    .replace('com.microsoft.playready.recommendation', 'playready sl')
    .replace('com.microsoft.playready', 'playready')
    .replace('com.widevine.alpha', 'widevine')
    .replace('com.apple.fps', 'fairplay');
  return `${data.hardwareDrm ? 'hardware' : 'software'} · ${label}`;
};

const decoderLine = (codecs) => {
  if (!codecs) return '—';
  const names = { h264: 'h264', hevc: 'hevc', av1: 'av1', dv: 'dolby vision', eac3: 'dd+', heaac: 'he-aac' };
  const list = Object.entries(names).filter(([key]) => codecs[key]).map(([, label]) => label);
  return list.length ? list.join(' · ') : 'none';
};

const blank = (name, text, tone) => {
  $('tier').textContent = '—';
  $('resolution').textContent = 'no signal';
  setStatus(name, text, tone);
};

const render = (data) => {
  const live = data && Date.now() - data.at < 6000;
  const audio = data?.audioLabel
    ? data.audioBitrate ? `${data.audioLabel} · ${data.audioBitrate} kb/s` : data.audioLabel
    : '—';

  renderReadout([
    ['video', live && data.videoBitrate ? `${(data.videoBitrate / 1000).toFixed(2)} Mb/s` : '—'],
    ['audio', audio, data?.audioLabel?.startsWith('Dolby') ? 'up' : ''],
    ['codec', data?.videoCodec || '—'],
    ['drm', drmName(data), data?.hardwareDrm ? 'up' : ''],
    ['upgrades', data?.added?.length ? `+${data.added.length} profiles` : live ? 'none needed' : '—'],
    ['peak', data?.peak || (live && data.playing ? 'standby' : '—'), data?.peak === 'pinned' ? 'up' : ''],
    ['decoders', decoderLine(data?.codecs)],
    ['display', data?.display || '—']
  ]);

  if (!live) {
    blank('signal', 'Waiting for the Netflix player to report in.', 'idle');
    return;
  }

  if (!data.playing) {
    $('tier').textContent = 'Armed';
    $('resolution').textContent = 'press play';
    setStatus('signal', 'Hooks are live on this tab.', 'idle');
    return;
  }

  $('tier').textContent = data.tier;
  $('resolution').textContent = data.resolution || '—';

  if (data.tier === 'UHD') setStatus('check', 'Ultra HD confirmed from the decoder.', 'up');
  else if (!data.hardwareDrm) setStatus('alert', `Software DRM caps this session at ${data.height}p.`, 'warn');
  else setStatus('alert', `Playing at ${data.height}p — this title may not ship a higher track yet.`, 'warn');
};

const tick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('netflix.com')) {
    render(null);
    blank('off', 'Open netflix.com in this tab to arm the engine.', 'idle');
    return;
  }
  const data = await chrome.runtime.sendMessage({ type: 'read', tabId: tab.id }).catch(() => null);
  if (!data) {
    render(null);
    blank('alert', 'Reload this tab — it loaded before the engine did.', 'warn');
    return;
  }
  render(data);
};

const init = async () => {
  $('version').textContent = chrome.runtime.getManifest().version;
  $('footIcon').replaceChildren(icon('keyboard', 12));
  const config = await chrome.storage.local.get(Object.keys(DEFAULTS));
  renderControls(config);
  if (config.enabled === false) document.body.classList.add('opacity-50');
  await tick();
  setInterval(tick, 1000);
};

init();
