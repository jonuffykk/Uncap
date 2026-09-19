const defaults = {
  enabled: true,
  mode: 'balanced',
  smooth: 'off',
  compare: false,
  target: 'auto',
  sharpen: 0.4,
  deblur: 0,
  darken: 0,
  thin: 0,
  denoise: 0,
  deband: 0,
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

const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;
const $ = (id) => document.getElementById(id);

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const modeOptions = [['off', 'modeOff'], ['balanced', 'modeBalanced'], ['sharp', 'modeSharp'],
  ['anime', 'modeAnime'], ['custom', 'modeCustom']];
const smoothOptions = [['off', 'smoothOff'], ['auto', 'smoothAuto'], ['2x', '2×'], ['3x', '3×'], ['4x', '4×']];
const targetOptions = [['auto', 'targetAuto'], ['native', 'targetNative'], ['1080', '1080p'], ['1440', '1440p'], ['2160', '4K']];
const themeOptions = [['auto', 'themeAuto'], ['dark', 'themeDark'], ['light', 'themeLight']];

const sliders = ['sharpen', 'deblur', 'darken', 'thin', 'denoise', 'deband'];
const streamToggles = ['stream', 'efficient', 'display', 'codecs', 'audio', 'tracks', 'peak', 'drm', 'hdr'];
const chromeToggles = ['compare', 'hud', 'badge'];
const actions = ['power', 'hud', 'mode', 'compare'];

const decoderNames = {
  h264: 'h264', hevc: 'hevc', av1: 'av1', dv: 'dolby vision', vp9: 'vp9',
  eac3: 'dd+', heaac: 'he-aac', xheaac: 'xhe-aac', opus: 'opus'
};

const drmNames = [
  ['com.microsoft.playready.recommendation.3000', 'playready sl3000'],
  ['com.microsoft.playready.recommendation', 'playready sl'],
  ['com.microsoft.playready', 'playready'],
  ['com.widevine.alpha', 'widevine'],
  ['com.apple.fps', 'fairplay']
];

const families = ['h264', 'hevc', 'av1', 'vp9'];
const claimed = '3840 × 2160';
const staleAfter = 6000;

let config = { ...defaults };
let tab = null;
let host = null;
let siteKind = null;
let writing = false;

const mbps = (kbps) => `${(kbps / 1000).toFixed(2)} Mb/s`;

const save = async (patch) => {
  Object.assign(config, patch);
  writing = true;
  await chrome.storage.local.set(patch);
  setTimeout(() => { writing = false; }, 60);
};

const applyTheme = () => {
  const root = document.documentElement;
  if (config.theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', config.theme);
};

const kindOf = (url) => {
  if (!url) return null;
  if (url.includes('netflix.com')) return 'netflix';
  if (url.includes('youtube.com')) return 'youtube';
  return /^https?:/.test(url) ? 'page' : null;
};

const originOf = (url) => {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? `${parsed.origin}/*` : null;
  } catch { return null; }
};

const drmLine = (data) => {
  if (!data?.keySystem) return '';
  const named = drmNames.find(([id]) => data.keySystem === id || data.keySystem.startsWith(id));
  const parts = [data.hardwareDrm ? 'hardware' : 'software', named ? named[1] : data.keySystem];
  if (data.drmPromoted) parts.push(t('drmPromoted'));
  return parts.join(' · ');
};

const rangeLine = (data) => {
  if (!data?.videoCodec) return '';
  if (data.hdr) return data.hdrForced ? 'HDR · forced' : 'HDR';
  if (data.hdrNative === true) return 'SDR · HDR available';
  if (data.hdrNative === false) return data.hdrForced ? 'SDR · HDR forced' : 'SDR · display says no';
  return 'SDR';
};

const dolbyLine = (data) => {
  if (!data || (!data.playing && !data.keySystem)) return '';
  if (data.audioLabel === 'Dolby Atmos') return 'atmos playing';
  if (data.audioLabel?.startsWith('Dolby')) return data.spatialForced ? 'dd+ · atmos asked for' : 'dd+ playing';
  if (!data.codecs?.eac3) return t('noDecoder');
  if (data.keySystem && !data.keySystem.startsWith('com.microsoft.playready')) return t('needsPlayReady');
  return t('notOffered');
};

const audioLine = (data) => {
  if (!data?.audioLabel) return '';
  const parts = [data.audioLabel];
  if (data.audioBitrate) parts.push(`${data.audioBitrate} kb/s`);
  if (data.volume > 1.001) parts.push(`${data.volume.toFixed(1)}×`);
  if (data.compress) parts.push(t('levelled'));
  return parts.join(' · ');
};

const boostLine = (data) => {
  if (data?.audio === 'crossOrigin') return t('boostCrossOrigin');
  if (data?.audio === 'blocked') return t('boostBlocked');
  if (data?.audio === 'on') return t('boostOn', (data.volume || 1).toFixed(1));
  return '';
};

const struggling = (data) => !!data?.frames && data.frames > 300 && data.dropped / data.frames > 0.01;

const decoderLine = (data) => (data?.codecs
  ? Object.entries(decoderNames).filter(([key]) => data.codecs[key]).map(([, label]) => label).join(' · ')
  : '');

const hardwareLine = (data) => {
  if (!data?.surveyed) return '';
  const fast = families.filter((name) => data.efficiency?.[name] === true);
  const slow = families.filter((name) => data.efficiency?.[name] === false);
  if (!fast.length && !slow.length) return '';
  const parts = [];
  if (fast.length) parts.push(t('inHardware', fast.join(' · ')));
  if (slow.length) parts.push(t('inSoftware', slow.join(' · ')));
  return parts.join(' · ');
};

const flowLine = (data) => {
  const shot = data?.enhance;
  if (!shot?.detail) return '';
  return shot.smoothing ? `${shot.detail} · ${t('inUse')}` : shot.detail;
};

const costLine = (data) => {
  const shot = data?.enhance;
  if (!shot?.tier || !shot.cost) {
    return config.bench
      ? `${config.bench.cost} ms of ${config.bench.budget} ms · ${config.bench.tier}`
      : '';
  }
  return `${shot.cost.toFixed(1)} ms of ${(1000 / (data.refresh || 60)).toFixed(1)} ms · ${shot.tier}`;
};

const monitorLine = (data) => {
  if (!data?.display) return '';
  const parts = [data.display];
  if (data.refresh) parts.push(`${data.refresh} Hz`);
  if (data.density && data.density !== 1) parts.push(`${data.density}×`);
  return parts.join(' · ');
};

const droppedRow = (data) =>
  ['dropped', data?.frames ? `${data.dropped} / ${data.frames}` : '', struggling(data) ? 'bad' : ''];

const sharedRows = (data) => [
  ['codec', data?.videoCodec || ''],
  ['range', rangeLine(data), data?.hdr ? (data.hdrForced && data.hdrNative !== true ? 'warn' : 'up') : ''],
  ['decode', data?.efficient === true ? t('hardware') : data?.efficient === false ? t('software') : '',
    data?.efficient === false ? 'warn' : ''],
  ['decoders', decoderLine(data), 'dim'],
  [t('thisMachine'), hardwareLine(data), 'dim'],
  [t('pictureCost'), costLine(data), 'dim'],
  [t('motionField'), flowLine(data), data?.enhance?.smoothing ? 'up' : 'dim'],
  [t('boost'), boostLine(data), data?.audio === 'on' ? 'up' : 'warn'],
  ['reported', data?.reported || '', data?.reported === claimed ? 'up' : 'warn'],
  [t('yourDisplay'), monitorLine(data), 'dim']
];

const mainRows = {
  netflix: (data, playing) => [
    ['video', data?.videoBitrate ? mbps(data.videoBitrate) : ''],
    ['audio', audioLine(data), data?.audioLabel?.startsWith('Dolby') ? 'up' : ''],
    [t('topRung'), data?.peak || (playing ? t('standby') : ''), data?.peak === 'pinned' ? 'up' : ''],
    droppedRow(data)
  ],
  youtube: (data, playing) => [
    ['video', data?.videoBitrate ? mbps(data.videoBitrate) : ''],
    ['quality', data?.quality ? `${data.quality}${data.premium ? ' premium' : ''}` : '',
      data?.quality && data.quality === data.best ? 'up' : data?.quality ? 'warn' : ''],
    [t('available'), data?.best && data.best !== data.quality ? data.best : ''],
    ['fps', data?.fps ? `${data.fps} fps` : ''],
    droppedRow(data)
  ],
  page: (data) => [
    ['video', data?.videoBitrate ? mbps(data.videoBitrate) : ''],
    ['fps', data?.fps ? `${data.fps} fps` : ''],
    droppedRow(data)
  ]
};

const extraRows = {
  netflix: (data, playing) => [
    ['dolby', dolbyLine(data), data?.audioLabel?.startsWith('Dolby') ? 'up' : 'dim'],
    ['profiles', data?.added?.length ? `+${data.added.length}` : playing ? t('noneNeeded') : ''],
    ['drm', drmLine(data), data?.hardwareDrm ? 'up' : data?.keySystem ? 'warn' : ''],
    ...sharedRows(data)
  ],
  youtube: (data, playing) => [
    [t('topRung'), data?.pinned ? t(`pin_${data.pinned}`) : (playing ? t('standby') : ''),
      data?.pinned === 'refused' || data?.pinned === 'eased' ? 'warn' : data?.pinned ? 'up' : ''],
    ['audio', audioLine(data)],
    ...sharedRows(data)
  ],
  page: (data) => [
    ['audio', audioLine(data)],
    ['drm', drmLine(data), data?.hardwareDrm ? 'up' : data?.keySystem ? 'warn' : ''],
    ...sharedRows(data)
  ]
};

const verdict = (data) => {
  if (data.enabled === false) return ['', t('vResting')];
  if (data.allowed === false) return ['warn', t('vOffsite')];
  if (!data.playing) return ['', t('vReady')];
  if (struggling(data)) {
    if (data.efficient === false) return ['bad', t('vSoftDecode')];
    if (data.enhance?.active && data.enhance.strain > 0) return ['bad', t('vEasing')];
    return ['bad', t('vDropping', data.dropped, data.frames)];
  }
  if (data.tier === 'UHD') return ['up', t('vUhd')];
  if (!data.spoofed) return ['warn', t('vNoSpoof')];
  if (siteKind === 'youtube') {
    if (data.pinned === 'refused') return ['warn', t('vRefused', data.best || '')];
    if (data.best && data.best !== data.quality) return ['warn', t('vHigherExists', data.best)];
    if (data.best) return ['up', t('vBestAvailable', data.best)];
  }
  if (siteKind === 'netflix' && !data.hardwareDrm) return ['warn', t('vSoftDrm', data.height)];
  if (data.enhance?.active) return ['up', t('vEnhanced', data.height, data.enhance.to)];
  return ['', t('vPlaying', data.height)];
};

const motionLine = (data, shot) => {
  if (config.smooth === 'off') return '';
  if (shot.smoothing && shot.shown) return t('mBoosted', shot.source, shot.shown);
  if (shot.strain > 0) return t('mLeftAlone');
  if (shot.source && shot.headroom < 1.5) {
    return data.refresh ? t('mFills', shot.source, data.refresh) : t('mNoRoom');
  }
  return '';
};

const scaleLine = (data) => {
  if (config.mode === 'off') return config.compare ? t('sOffSplit') : t('sOff');
  const shot = data?.enhance;
  if (!shot) return '';
  if (!shot.active) {
    const why = shot.reason ? t(`why_${shot.reason}`) : '';
    return config.compare && why ? `${why} ${t('sNothingToSplit')}` : why;
  }
  const parts = shot.factor >= 1.05
    ? [`${shot.from} → ${shot.to}`, t('sLarger', shot.factor)]
    : shot.shrinking
      ? [`${shot.from} → ${shot.to}`, t('sDown', shot.factor)]
      : [shot.to, t('sSharpenOnly')];
  parts.push(motionLine(data, shot));
  if (shot.strain >= 2) parts.push(t('sSharpenDropped'));
  if (config.compare) parts.push(t('sSplit'));
  parts.push(t('sPerFrame', shot.cost.toFixed(1)));
  return parts.filter(Boolean).join(' · ');
};

const empties = new Set(['', undefined, null]);

const renderRows = (node, entries) => {
  node.replaceChildren(...entries
    .filter(([, value]) => !empties.has(value))
    .flatMap(([label, value, tone]) => [el('dt', null, label), el('dd', tone || null, String(value))]));
};

const renderSegments = (id, options, key, after) => {
  $(id).replaceChildren(...options.map(([value, name]) => {
    const button = el('button', 'segment', t(name));
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(config[key] === value));
    button.addEventListener('click', async () => {
      await save({ [key]: value });
      renderSegments(id, options, key, after);
      if (after) after();
    });
    return button;
  }));
};

const toggleRow = (key) => {
  const row = el('label', 'control');
  const text = el('span');
  text.append(document.createTextNode(t(`toggle_${key}`)));
  const hint = t(`hint_${key}`);
  if (hint !== `hint_${key}`) text.append(el('small', null, hint));
  const toggle = el('button', 'switch');
  toggle.type = 'button';
  toggle.role = 'switch';
  toggle.setAttribute('aria-label', t(`toggle_${key}`));
  toggle.setAttribute('aria-checked', String(!!config[key]));
  toggle.addEventListener('click', async () => {
    const next = toggle.getAttribute('aria-checked') !== 'true';
    toggle.setAttribute('aria-checked', String(next));
    await save({ [key]: next });
  });
  row.append(text, toggle);
  return row;
};

const sliderRow = (key, low, high, step, format) => {
  const row = el('div', 'slider');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(low);
  input.max = String(high);
  input.step = String(step);
  input.value = String(config[key] ?? low);
  const value = el('b', null, format(Number(input.value)));
  input.addEventListener('input', () => { value.textContent = format(Number(input.value)); });
  input.addEventListener('change', () => save({ [key]: Number(input.value) }));
  row.append(el('span', null, t(`slider_${key}`)), input, value);
  return row;
};

const renderCustom = () => {
  const node = $('custom');
  if (config.mode !== 'custom') {
    node.replaceChildren();
    return;
  }
  node.replaceChildren(...sliders.map((key) => sliderRow(key, 0, 1, 0.05, (v) => v.toFixed(2))));
};

const renderAllowList = () => {
  const node = $('allowList');
  if (!config.allowList.length) {
    node.replaceChildren(el('p', 'empty', t('noPatterns')));
    return;
  }
  node.replaceChildren(...config.allowList.map((pattern) => {
    const row = el('div', 'pill');
    row.append(el('code', null, pattern));
    const remove = el('button', null, t('remove'));
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      await save({ allowList: config.allowList.filter((entry) => entry !== pattern) });
      renderAllowList();
    });
    row.append(remove);
    return row;
  }));
};

let listening = null;

const renderShortcuts = () => {
  $('shortcuts').replaceChildren(...actions.map((action) => {
    const row = el('div', 'keyRow');
    const button = el('button', null, `ctrl alt ${String(config.keys[action]).replace('Key', '')}`);
    button.type = 'button';
    button.addEventListener('click', () => {
      if (listening) listening.classList.remove('listening');
      listening = button;
      button.classList.add('listening');
      button.textContent = t('pressKey');
    });
    row.append(el('span', null, t(`action_${action}`)), button);
    row.dataset.action = action;
    return row;
  }));
};

window.addEventListener('keydown', async (event) => {
  if (!listening) return;
  event.preventDefault();
  if (event.key === 'Escape' || !/^(Key[A-Z]|Digit[0-9])$/.test(event.code)) {
    listening.classList.remove('listening');
    listening = null;
    renderShortcuts();
    return;
  }
  const action = listening.closest('.keyRow').dataset.action;
  const keys = { ...config.keys };
  for (const [name, code] of Object.entries(keys)) {
    if (code === event.code && name !== action) keys[name] = config.keys[action];
  }
  keys[action] = event.code;
  listening.classList.remove('listening');
  listening = null;
  await save({ keys });
  renderShortcuts();
});

const refreshGrant = async () => {
  const held = await chrome.permissions.contains({ origins: ['*://*/*'] }).catch(() => false);
  $('grantAll').textContent = held ? t('grantAllHeld') : t('grantAll');
  $('grantAll').disabled = held;
};

const paintSettings = () => {
  applyTheme();
  renderSegments('mode', modeOptions, 'mode', renderCustom);
  renderSegments('smooth', smoothOptions, 'smooth');
  renderSegments('target', targetOptions, 'target');
  renderSegments('theme', themeOptions, 'theme', applyTheme);
  renderCustom();
  $('soundRows').replaceChildren(
    sliderRow('volume', 1, 5, 0.1, (v) => `${v.toFixed(1)}×`),
    toggleRow('compress')
  );
  $('streamRows').replaceChildren(...streamToggles.map(toggleRow));
  $('siteRows').replaceChildren(toggleRow('allowAll'));
  $('chromeRows').replaceChildren(...chromeToggles.map(toggleRow));
  renderAllowList();
  renderShortcuts();
};

const setQuiet = (title, note) => {
  document.body.classList.add('blank');
  $('quietTitle').textContent = title;
  $('quietNote').textContent = note;
};

const setPower = (running) => {
  $('power').setAttribute('aria-checked', String(running));
  document.body.classList.toggle('paused', !running);
};

const renderLive = (data) => {
  document.body.classList.remove('blank');
  const playing = data.playing;
  $('tier').textContent = playing ? data.tier : t('ready');
  $('tier').className = `tier${playing ? (data.tier === 'UHD' ? ' peak' : '') : ' idle'}`;
  $('resolution').textContent = playing ? data.resolution : t('pressPlay');
  const [tone, text] = verdict(data);
  $('statusDot').className = tone ? `dot ${tone}` : 'dot';
  $('statusText').textContent = text;
  $('scaleLine').textContent = scaleLine(data);
  renderRows($('mainRows'), (mainRows[siteKind] || mainRows.page)(data, playing));
  renderRows($('extraRows'), (extraRows[siteKind] || extraRows.page)(data, playing));
};

const tick = async () => {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  tab = active || null;
  host = (() => {
    try { return new URL(tab.url).hostname; } catch { return null; }
  })();
  siteKind = kindOf(tab?.url);

  const origin = originOf(tab?.url);
  const builtIn = siteKind === 'netflix' || siteKind === 'youtube';
  const granted = builtIn || !origin
    ? true
    : await chrome.permissions.contains({ origins: [origin] }).catch(() => true);
  $('grant').hidden = granted || !origin;
  if (!$('grant').hidden) $('grant').textContent = t('turnOnFor', host || '');

  if (!siteKind) {
    $('reload').hidden = true;
    setQuiet(t('qNothing'), t('qOpenSite'));
    return;
  }

  const data = await chrome.runtime.sendMessage({ type: 'read', tabId: tab.id }).catch(() => null);
  const live = !!data && Date.now() - data.at < staleAfter;

  if (!live || (data.spoofed && data.reported !== claimed)) {
    $('reload').hidden = !granted;
    if (!granted) setQuiet(t('qNotOn'), t('qNotOnNote', host || ''));
    else setQuiet(t('qReload'), t('qReloadNote'));
    return;
  }

  $('reload').hidden = true;
  setPower(data.enabled !== false);

  if (!data.resolution) {
    setQuiet(data.enabled === false ? t('qResting') : t('qNothing'),
      data.enabled === false ? t('qRestingNote') : t('qPressPlay'));
    return;
  }
  renderLive(data);
};

const init = async () => {
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  $('version').textContent = chrome.runtime.getManifest().version;

  config = { ...defaults, ...await chrome.storage.local.get(Object.keys(defaults)) };
  setPower(config.enabled !== false);
  paintSettings();
  refreshGrant();

  $('power').addEventListener('click', async () => {
    const next = $('power').getAttribute('aria-checked') !== 'true';
    setPower(next);
    await save({ enabled: next });
  });

  $('reload').textContent = t('reloadTab');
  $('reload').addEventListener('click', async () => {
    if (tab?.id == null) return;
    await chrome.tabs.reload(tab.id).catch(() => { });
    window.close();
  });

  $('grant').addEventListener('click', async () => {
    const origin = originOf(tab?.url);
    if (!origin) return;
    if (!await chrome.permissions.request({ origins: [origin] }).catch(() => false)) return;
    await chrome.runtime.sendMessage({ type: 'syncExtras' }).catch(() => { });
    if (tab?.id != null) await chrome.tabs.reload(tab.id).catch(() => { });
    window.close();
  });

  $('grantAll').addEventListener('click', async () => {
    if (!await chrome.permissions.request({ origins: ['*://*/*'] }).catch(() => false)) return;
    await chrome.runtime.sendMessage({ type: 'syncExtras' }).catch(() => { });
    refreshGrant();
  });

  const addPattern = async () => {
    const value = $('patternInput').value.trim().toLowerCase();
    if (!value || config.allowList.includes(value)) return;
    await save({ allowList: [...config.allowList, value] });
    $('patternInput').value = '';
    renderAllowList();
  };
  $('patternAdd').addEventListener('click', addPattern);
  $('patternInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addPattern();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || writing) return;
    let touched = false;
    for (const [key, change] of Object.entries(changes)) {
      if (key in defaults) {
        config[key] = change.newValue;
        touched = true;
      }
    }
    if (touched) paintSettings();
  });

  await tick();
  setInterval(tick, 1000);
};

init();
