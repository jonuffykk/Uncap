(() => {
  'use strict';
  if (window.__uncap) return;

  const tag = '[Uncap]';
  const log = (...args) => console.info(tag, ...args);

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

  const settings = { ...defaults };
  const cfg = { ...defaults };
  const host = location.hostname;
  const path = location.pathname;

  const matchPattern = (pattern) => {
    const text = String(pattern || '').trim().toLowerCase();
    if (!text) return false;
    const escaped = text.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(`${host}${path}`.toLowerCase())
      || new RegExp(`^${escaped}$`).test(host.toLowerCase());
  };

  const builtIn = /(^|\.)(netflix\.com|youtube(-nocookie)?\.com)$/;
  const allowed = () => cfg.allowAll || builtIn.test(host) || cfg.allowList.some(matchPattern);

  const resolve = () => {
    for (const key of Object.keys(defaults)) cfg[key] = settings[key];
  };

  const on = (key) => cfg.enabled && cfg.stream && cfg[key];

  const ua = navigator.userAgent;
  const versionOf = (pattern) => {
    const found = pattern.exec(ua);
    return found ? parseInt(found[1], 10) : 0;
  };

  const browser = /Edg\//.test(ua) ? { name: 'Edge', version: versionOf(/Edg\/(\d+)/) }
    : /OPR\//.test(ua) ? { name: 'Opera', version: versionOf(/OPR\/(\d+)/) }
      : /Firefox\//.test(ua) ? { name: 'Firefox', version: versionOf(/Firefox\/(\d+)/) }
        : /Chrome\//.test(ua) ? { name: 'Chrome', version: versionOf(/Chrome\/(\d+)/) }
          : { name: 'Safari', version: versionOf(/Version\/(\d+)/) };

  const platform = /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
      : /CrOS/.test(ua) ? 'ChromeOS'
        : /Linux/.test(ua) ? 'Linux' : 'unknown';

  const state = {
    browser: browser.name,
    platform,
    version: null,
    codecs: {},
    efficiency: {},
    surveyed: false,
    hdrNative: null,
    hdrForced: false,
    spatialNative: null,
    spatialForced: false,
    guarded: false,
    tainted: false,
    playing: false,
    width: 0,
    height: 0,
    fps: 0,
    resolution: null,
    videoCodec: null,
    audioCodec: null,
    hdr: false,
    videoBitrate: 0,
    audioBitrate: 0,
    dropped: 0,
    frames: 0,
    dropRate: 0,
    buffered: 0,
    refresh: 0,
    audio: null
  };

  const familyOf = (mime) => {
    const type = String(mime || '').toLowerCase();
    if (!type) return null;
    if (type.includes('dvh') || type.includes('dva')) return 'dv';
    if (type.includes('av01')) return 'av1';
    if (type.includes('hvc') || type.includes('hev1')) return 'hevc';
    if (type.includes('avc1') || type.includes('avc3')) return 'h264';
    if (type.includes('vp09') || type.includes('vp9')) return 'vp9';
    if (type.includes('ec-3')) return 'eac3';
    if (type.includes('opus')) return 'opus';
    if (type.includes('mp4a.40.42')) return 'xheaac';
    if (type.includes('mp4a.40.5') || type.includes('mp4a.40.29')) return 'heaac';
    if (type.includes('mp4a')) return 'aac';
    return null;
  };

  const mediaSource = window.MediaSource || window.ManagedMediaSource;
  const kindOf = new WeakMap();
  const sampleLimit = 40;
  const hdrCodec = /hvc1\.2|hev1\.2|dvh|av01\.\d+\.\d+[a-z]?\.10|vp09\.02/i;

  const meters = {
    video: { pending: 0, end: null, samples: [] },
    audio: { pending: 0, end: null, samples: [] }
  };

  const noteCodec = (buffer, type) => {
    const kind = kindOf.get(buffer);
    if (!kind) return;
    const codec = /codecs="?([^";]+)"?/.exec(type)?.[1] || null;
    if (kind === 'video') {
      state.videoCodec = codec;
      state.hdr = hdrCodec.test(type);
    } else {
      state.audioCodec = codec;
    }
  };

  const settle = (buffer) => {
    const meter = meters[kindOf.get(buffer)];
    if (!meter) return;
    let end = null;
    try {
      const ranges = buffer.buffered;
      end = ranges.length ? ranges.end(ranges.length - 1) : null;
    } catch { }
    if (end !== null && meter.end !== null && meter.pending) {
      const seconds = end - meter.end;
      if (seconds > 0 && seconds < 60) {
        meter.samples.push([meter.pending, seconds]);
        if (meter.samples.length > sampleLimit) meter.samples.shift();
      }
    }
    if (end !== null) meter.end = end;
    meter.pending = 0;
  };

  if (mediaSource) {
    const addSourceBuffer = mediaSource.prototype.addSourceBuffer;
    mediaSource.prototype.addSourceBuffer = function (mime) {
      const buffer = addSourceBuffer.call(this, mime);
      const type = String(mime);
      if (type.startsWith('video/')) kindOf.set(buffer, 'video');
      else if (type.startsWith('audio/')) kindOf.set(buffer, 'audio');
      else return buffer;
      noteCodec(buffer, type);
      buffer.addEventListener('updateend', () => settle(buffer));
      return buffer;
    };

    const appendBuffer = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (data) {
      const meter = meters[kindOf.get(this)];
      if (meter && data?.byteLength) meter.pending += data.byteLength;
      return appendBuffer.call(this, data);
    };

    const changeType = SourceBuffer.prototype.changeType;
    if (changeType) {
      SourceBuffer.prototype.changeType = function (mime) {
        const result = changeType.call(this, mime);
        const meter = meters[kindOf.get(this)];
        if (meter) meter.samples.length = 0;
        noteCodec(this, String(mime));
        return result;
      };
    }
  }

  const rateOf = (kind) => {
    const { samples } = meters[kind];
    if (!samples.length) return 0;
    let bytes = 0;
    let seconds = 0;
    for (const [size, span] of samples) {
      bytes += size;
      seconds += span;
    }
    return seconds > 0.5 ? Math.round((bytes * 8) / seconds / 1000) : 0;
  };

  const reset = () => {
    for (const meter of Object.values(meters)) {
      meter.samples.length = 0;
      meter.pending = 0;
      meter.end = null;
    }
    state.videoBitrate = 0;
    state.audioBitrate = 0;
    state.resolution = null;
    state.width = 0;
    state.height = 0;
    state.fps = 0;
  };

  let video = null;
  let lastFrames = 0;
  let lastDropped = 0;
  let lastStamp = 0;
  const videoWatchers = [];

  const readPlayback = () => {
    if (!video || !video.videoWidth) {
      state.playing = false;
      return;
    }
    state.width = video.videoWidth;
    state.height = video.videoHeight;
    state.resolution = `${video.videoWidth} × ${video.videoHeight}`;
    state.playing = !video.paused && !video.ended;
    state.videoBitrate = rateOf('video');
    state.audioBitrate = rateOf('audio');
    state.guarded = !!video.mediaKeys;
    try {
      const quality = video.getVideoPlaybackQuality();
      state.dropped = quality.droppedVideoFrames;
      state.frames = quality.totalVideoFrames;
      const now = performance.now();
      if (lastStamp && state.playing) {
        const span = (now - lastStamp) / 1000;
        const grown = state.frames - lastFrames;
        if (span > 0.4 && grown >= 0) state.fps = Math.round(grown / span);
        const missed = state.dropped - lastDropped;
        if (grown > 5) state.dropRate = Math.min(1, Math.max(0, missed / grown));
      }
      lastFrames = state.frames;
      lastDropped = state.dropped;
      lastStamp = now;
    } catch { }
    try {
      const ranges = video.buffered;
      state.buffered = ranges.length ? Math.max(0, ranges.end(ranges.length - 1) - video.currentTime) : 0;
    } catch { }
  };

  const areaOf = (element) => {
    const box = element.getBoundingClientRect();
    return box.width * box.height;
  };

  const deepScan = (root, out, budget) => {
    for (const node of root.querySelectorAll('*')) {
      if (budget.left-- < 0) return;
      if (node.tagName === 'VIDEO') out.push(node);
      else if (node.shadowRoot) deepScan(node.shadowRoot, out, budget);
    }
  };

  const findVideo = () => {
    let found = Array.from(document.querySelectorAll('video'));
    if (!found.length) {
      const deep = [];
      deepScan(document, deep, { left: 6000 });
      found = deep;
    }
    found = found.filter((element) => element.isConnected);
    if (!found.length) return null;
    let best = null;
    let score = -1;
    for (const element of found) {
      const live = !element.paused && !element.ended && element.videoWidth > 0;
      const value = areaOf(element) + (live ? 1e9 : 0) + (element.videoWidth ? 1e6 : 0);
      if (value > score) {
        score = value;
        best = element;
      }
    }
    return best;
  };

  const attach = (element) => {
    if (!element || element === video) return;
    video = element;
    state.guarded = !!element.mediaKeys;
    state.tainted = false;
    for (const watcher of videoWatchers) {
      try { watcher(element); } catch { }
    }
    shapeAudio();
    if (element.__uncapBound) return;
    element.__uncapBound = true;
    for (const event of ['loadedmetadata', 'resize', 'playing', 'pause']) {
      element.addEventListener(event, readPlayback);
    }
  };

  let audioContext = null;
  let audioSource = null;
  let audioGain = null;
  let audioSqueeze = null;
  let audioFor = null;

  const audioSafe = (element) => {
    const source = element.currentSrc || element.src || '';
    if (!source) return false;
    if (source.startsWith('blob:') || source.startsWith('data:')) return true;
    try { return new URL(source, location.href).origin === location.origin; } catch { return false; }
  };

  const shapeAudio = () => {
    const element = video;
    if (!element) return;
    const lifted = cfg.volume > 1.001 || cfg.compress;
    const wanted = cfg.enabled && lifted;

    if (audioFor !== element) {
      if (!wanted) {
        state.audio = null;
        return;
      }
      if (!audioSafe(element)) {
        state.audio = 'crossOrigin';
        return;
      }
      try {
        audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
        audioSource = audioContext.createMediaElementSource(element);
        audioGain = audioContext.createGain();
        audioSqueeze = audioContext.createDynamicsCompressor();
        audioSqueeze.threshold.value = -28;
        audioSqueeze.knee.value = 24;
        audioSqueeze.ratio.value = 6;
        audioSqueeze.attack.value = 0.006;
        audioSqueeze.release.value = 0.22;
        audioFor = element;
      } catch {
        state.audio = 'blocked';
        return;
      }
    }

    try {
      audioSource.disconnect();
      audioGain.disconnect();
      audioSqueeze.disconnect();
    } catch { }

    const chain = cfg.compress ? [audioSource, audioSqueeze, audioGain] : [audioSource, audioGain];
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
    chain[chain.length - 1].connect(audioContext.destination);
    audioGain.gain.value = cfg.enabled ? Math.min(5, Math.max(0, cfg.volume)) : 1;
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => { });
    state.audio = wanted ? 'on' : 'flat';
  };

  const setMediaKeys = HTMLMediaElement.prototype.setMediaKeys;
  HTMLMediaElement.prototype.setMediaKeys = function (keys) {
    if (this.tagName === 'VIDEO') {
      attach(this);
      if (keys) state.guarded = true;
    }
    return setMediaKeys.call(this, keys);
  };

  const panelRates = [50, 60, 75, 90, 100, 120, 144, 165, 175, 200, 240, 360];

  const snap = (value, list, slack) => {
    const near = list.reduce((best, rate) => (Math.abs(rate - value) < Math.abs(best - value) ? rate : best));
    return Math.abs(near - value) < near * slack ? near : value;
  };

  let counting = false;

  const countRefresh = () => {
    if (counting || document.hidden) return;
    counting = true;
    const marks = [];
    const step = (time) => {
      marks.push(time);
      if (marks.length < 24) {
        requestAnimationFrame(step);
        return;
      }
      counting = false;
      const gaps = [];
      for (let i = 1; i < marks.length; i++) gaps.push(marks[i] - marks[i - 1]);
      gaps.sort((a, b) => a - b);
      const median = gaps[gaps.length >> 1];
      if (!(median > 1 && median < 80)) return;
      state.refresh = Math.round(snap(1000 / median, panelRates, 0.06));
    };
    requestAnimationFrame(step);
  };

  const forgetRefresh = () => { state.refresh = 0; };
  window.addEventListener('resize', forgetRefresh);
  window.addEventListener('fullscreenchange', forgetRefresh);
  document.addEventListener('visibilitychange', forgetRefresh);

  const tierOf = () => {
    if (!state.height) return null;
    if (state.height >= 2160 || state.width >= 3840) return 'UHD';
    if (state.height >= 1080) return 'FHD';
    if (state.height >= 720) return 'HD';
    return 'SD';
  };

  let reporting = true;
  let siteName = 'page';
  const ticks = [];
  const feeds = [];
  const configWatchers = [];
  const signalWatchers = [];

  const announce = () => {
    for (const watcher of configWatchers) {
      try { watcher(cfg); } catch { }
    }
  };

  const commit = (patch) => {
    Object.assign(cfg, patch);
    announce();
    shapeAudio();
    try {
      window.postMessage({ source: 'uncapPage', type: 'set', payload: patch, host }, '*');
    } catch { }
  };

  const snapshot = () => {
    const extra = {};
    for (const feed of feeds) {
      try { Object.assign(extra, feed() || {}); } catch { }
    }
    return {
      site: siteName,
      host,
      allowed: allowed(),
      enabled: cfg.enabled,
      mode: cfg.mode,
      smooth: cfg.smooth,
      compare: cfg.compare,
      target: cfg.target,
      playing: state.playing,
      tier: tierOf(),
      resolution: state.resolution,
      height: state.height,
      fps: state.fps,
      videoBitrate: state.videoBitrate,
      audioBitrate: state.audioBitrate,
      videoCodec: state.videoCodec,
      hdr: state.hdr,
      guarded: state.guarded,
      tainted: state.tainted,
      dropped: state.dropped,
      frames: state.frames,
      dropRate: Number(state.dropRate.toFixed(3)),
      buffered: state.buffered,
      refresh: state.refresh,
      volume: cfg.volume,
      compress: cfg.compress,
      audio: state.audio,
      density: Math.round((window.devicePixelRatio || 1) * 100) / 100,
      browser: state.browser,
      platform: state.platform,
      ...extra
    };
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'uncap') return;
    const { type, payload } = event.data;

    if (type === 'detach') {
      reporting = false;
      log('extension reloaded, hooks stay until this tab reloads');
      return;
    }
    if (type === 'signal') {
      for (const watcher of signalWatchers) {
        try { watcher(payload); } catch { }
      }
      return;
    }
    if (type !== 'config') return;

    const incoming = payload || {};
    if (!state.version) {
      state.version = incoming.version || 'unknown';
      log(`connected v${state.version}`);
    }
    for (const [key, value] of Object.entries(incoming)) {
      if (value !== undefined && key in defaults) settings[key] = value;
    }
    resolve();
    announce();
    shapeAudio();
  });

  const observer = new MutationObserver(() => {
    if (video && video.isConnected && video.videoWidth) return;
    const found = findVideo();
    if (found) attach(found);
  });

  const boot = () => {
    if (!document.body) {
      requestAnimationFrame(boot);
      return;
    }
    observer.observe(document.body, { childList: true, subtree: true });
    attach(findVideo());
  };
  boot();

  let idle = 0;

  const beat = () => {
    for (const fn of ticks) {
      try { fn(); } catch { }
    }
    if (!video || !video.isConnected || !video.videoWidth) {
      const found = findVideo();
      if (found) attach(found);
    }
    readPlayback();
    if (!state.refresh && state.playing) countRefresh();

    const busy = state.playing || document.visibilityState === 'visible';
    idle = busy ? 0 : Math.min(idle + 1, 10);
    if (reporting && (video || window === window.top) && (busy || idle % 5 === 0)) {
      try {
        window.postMessage({ source: 'uncapPage', type: 'telemetry', payload: snapshot() }, '*');
      } catch { }
    }
    setTimeout(beat, busy ? 1000 : 4000);
  };
  setTimeout(beat, 1000);

  resolve();

  window.__uncap = {
    cfg,
    settings,
    defaults,
    on,
    allowed,
    state,
    host,
    familyOf,
    snap,
    reset,
    log,
    snapshot,
    element: () => video,
    identify: (name) => { siteName = name; },
    tick: (fn) => ticks.push(fn),
    feed: (fn) => feeds.push(fn),
    onVideo: (fn) => { videoWatchers.push(fn); if (video) fn(video); },
    onConfig: (fn) => configWatchers.push(fn),
    onSignal: (fn) => signalWatchers.push(fn),
    set: commit
  };
})();
