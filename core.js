(() => {
  'use strict';
  if (window.__nitrate) return;
  window.__nitrate = true;

  const TAG = '[Nitrate]';
  const log = (...args) => console.info(TAG, ...args);

  const cfg = {
    enabled: true,
    video: true,
    audio: true,
    tracks: true,
    display: true,
    drm: true,
    bitrate: true,
    hdr: false
  };
  const on = (key) => cfg.enabled && cfg[key];

  const UA = navigator.userAgent;
  const major = (pattern) => {
    const match = pattern.exec(UA);
    return match ? parseInt(match[1], 10) : 0;
  };

  const browser = /Edg\//.test(UA) ? { name: 'Edge', version: major(/Edg\/(\d+)/) }
    : /OPR\//.test(UA) ? { name: 'Opera', version: major(/OPR\/(\d+)/) }
      : /Firefox\//.test(UA) ? { name: 'Firefox', version: major(/Firefox\/(\d+)/) }
        : /Chrome\//.test(UA) ? { name: 'Chrome', version: major(/Chrome\/(\d+)/) }
          : { name: 'Safari', version: major(/Version\/(\d+)/) };

  const platform = /Windows/.test(UA) ? 'Windows'
    : /Mac OS X/.test(UA) ? 'macOS'
      : /CrOS/.test(UA) ? 'ChromeOS'
        : /Linux/.test(UA) ? 'Linux' : 'unknown';

  const state = {
    browser: browser.name,
    platform,
    version: null,
    codecs: {},
    efficiency: {},
    keySystem: null,
    robustness: null,
    hardwareDrm: false,
    certificate: false,
    hdrNative: null,
    hdrForced: false,
    spatialNative: null,
    spatialForced: false,
    added: [],
    peak: null,
    resolution: null,
    width: 0,
    height: 0,
    videoCodec: null,
    audioCodec: null,
    hdr: false,
    videoBitrate: 0,
    audioBitrate: 0,
    dropped: 0,
    frames: 0,
    buffered: 0,
    playing: false,
    titleId: null
  };

  const MSE = window.MediaSource || window.ManagedMediaSource;
  const nativeIsTypeSupported = MSE ? MSE.isTypeSupported.bind(MSE) : () => false;
  const decodes = (type) => {
    try { return nativeIsTypeSupported(type); } catch { return false; }
  };

  const PROBES = {
    h264: ['video/mp4; codecs="avc1.640028"'],
    hevc: ['video/mp4; codecs="hvc1.2.4.L153.B0"', 'video/mp4; codecs="hev1.2.4.L153.B0"'],
    av1: ['video/mp4; codecs="av01.0.13M.08"'],
    dv: ['video/mp4; codecs="dvh1.05.07"', 'video/mp4; codecs="dvhe.05.07"'],
    vp9: ['video/mp4; codecs="vp09.00.51.08"', 'video/mp4; codecs="vp09.02.51.10"'],
    aac: ['audio/mp4; codecs="mp4a.40.2"'],
    heaac: ['audio/mp4; codecs="mp4a.40.5"'],
    xheaac: ['audio/mp4; codecs="mp4a.40.42"'],
    eac3: ['audio/mp4; codecs="ec-3"']
  };
  for (const [family, types] of Object.entries(PROBES)) state.codecs[family] = types.some(decodes);

  const familyOf = (mime) => {
    const type = String(mime || '').toLowerCase();
    if (!type) return null;
    if (type.includes('dvh') || type.includes('dva')) return 'dv';
    if (type.includes('av01')) return 'av1';
    if (type.includes('hvc') || type.includes('hev1')) return 'hevc';
    if (type.includes('avc1') || type.includes('avc3')) return 'h264';
    if (type.includes('vp09') || type.includes('vp9')) return 'vp9';
    if (type.includes('ec-3')) return 'eac3';
    if (type.includes('mp4a.40.42')) return 'xheaac';
    if (type.includes('mp4a.40.5') || type.includes('mp4a.40.29')) return 'heaac';
    if (type.includes('mp4a')) return 'aac';
    return null;
  };

  if (MSE) {
    MSE.isTypeSupported = function (mime) {
      const real = decodes(mime);
      if (real || !on('video')) return real;
      const family = familyOf(mime);
      return family ? !!state.codecs[family] : real;
    };
  }

  const nativeCanPlayType = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (mime) {
    const real = nativeCanPlayType.call(this, mime);
    if (real === 'probably' || !on('video')) return real;
    const family = familyOf(mime);
    return family && state.codecs[family] ? 'probably' : real;
  };

  const asksAboutHdr = (track) =>
    (track.transferFunction && track.transferFunction !== 'srgb')
    || (track.colorGamut && track.colorGamut !== 'srgb')
    || track.hdrMetadataType !== undefined;

  const asksAboutSpatial = (track) =>
    track.spatialRendering === true || Number(track.channels) > 8;

  if (navigator.mediaCapabilities?.decodingInfo) {
    const nativeDecodingInfo = navigator.mediaCapabilities.decodingInfo.bind(navigator.mediaCapabilities);
    navigator.mediaCapabilities.decodingInfo = async function (config) {
      const result = await nativeDecodingInfo(config);
      const track = config?.video || config?.audio;
      if (!track) return result;

      const isVideo = !!config.video;
      const family = familyOf(track.contentType);
      const widening = (isVideo ? on('video') : on('audio')) && !!family && !!state.codecs[family];

      if (isVideo && family) state.efficiency[family] = !!result.powerEfficient;

      if (isVideo && asksAboutHdr(track)) {
        state.hdrNative = !!result.supported;
        if (!on('hdr')) return result;
        state.hdrForced = true;
      }

      if (!isVideo && asksAboutSpatial(track)) {
        state.spatialNative = !!result.supported;
        if (widening && !result.supported) state.spatialForced = true;
      }

      if (!widening) return result;
      return {
        supported: true,
        smooth: true,
        powerEfficient: true,
        keySystemAccess: result.keySystemAccess,
        configuration: result.configuration
      };
    };
  }

  const PANEL = { width: screen.width, height: screen.height, depth: screen.colorDepth };
  const TARGET = { width: 3840, height: 2160, depth: 30 };

  const mask = (target, prop, forced, real) => {
    try {
      Object.defineProperty(target, prop, {
        get: () => (on('display') ? forced : real),
        configurable: true
      });
    } catch { }
  };

  mask(screen, 'width', TARGET.width, PANEL.width);
  mask(screen, 'height', TARGET.height, PANEL.height);
  mask(screen, 'availWidth', TARGET.width, screen.availWidth);
  mask(screen, 'availHeight', TARGET.height, screen.availHeight);
  mask(screen, 'colorDepth', TARGET.depth, PANEL.depth);
  mask(screen, 'pixelDepth', TARGET.depth, PANEL.depth);
  mask(window, 'outerWidth', TARGET.width, window.outerWidth);
  mask(window, 'outerHeight', TARGET.height, window.outerHeight);

  const HDR_QUERIES = [
    ['dynamic-range', 'high'],
    ['video-dynamic-range', 'high'],
    ['color-gamut', 'p3'],
    ['color-gamut', 'rec2020']
  ];

  const nativeMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = function (query) {
    const list = nativeMatchMedia(query);
    if (!on('hdr') || list.matches) return list;
    const text = String(query).toLowerCase();
    if (!HDR_QUERIES.some(([feature, value]) => text.includes(feature) && text.includes(value))) return list;
    return new Proxy(list, {
      get(target, prop) {
        if (prop === 'matches') return true;
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  };

  const PLAYREADY = 'com.microsoft.playready';
  const WIDEVINE = 'com.widevine.alpha';
  const isPlayReady = (keySystem) => typeof keySystem === 'string' && keySystem.startsWith(PLAYREADY);

  const CERT_KEY = 'nitrate.cert.';
  const CERT_WAIT = 3000;

  const keySystemOf = new WeakMap();
  const certReady = new WeakMap();
  const certWaiters = new WeakMap();
  const sessionOwner = new WeakMap();
  const certCache = new Map();

  const waiterFor = (mediaKeys) => {
    let waiter = certWaiters.get(mediaKeys);
    if (!waiter) {
      let settle;
      waiter = { promise: new Promise((resolve) => { settle = resolve; }) };
      waiter.settle = settle;
      certWaiters.set(mediaKeys, waiter);
    }
    return waiter;
  };

  const toBytes = (data) => {
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    }
    if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
    return null;
  };

  const keepCert = (keySystem, bytes) => {
    certCache.set(keySystem, bytes);
    try {
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      localStorage.setItem(CERT_KEY + keySystem, btoa(binary));
    } catch { }
  };

  const forgetCert = (keySystem) => {
    certCache.delete(keySystem);
    try { localStorage.removeItem(CERT_KEY + keySystem); } catch { }
  };

  const recallCert = (keySystem) => {
    if (certCache.has(keySystem)) return certCache.get(keySystem);
    try {
      const stored = localStorage.getItem(CERT_KEY + keySystem);
      if (!stored) return null;
      const binary = atob(stored);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      certCache.set(keySystem, bytes);
      return bytes;
    } catch { return null; }
  };

  const nativeSetServerCertificate = window.MediaKeys && MediaKeys.prototype.setServerCertificate;

  const provision = (mediaKeys, keySystem) => {
    const bytes = recallCert(keySystem);
    if (!bytes || !nativeSetServerCertificate) return null;
    const pending = nativeSetServerCertificate.call(mediaKeys, bytes).then(
      () => { state.certificate = true; return true; },
      () => { forgetCert(keySystem); return false; }
    );
    certReady.set(mediaKeys, pending);
    return pending;
  };

  if (nativeSetServerCertificate) {
    MediaKeys.prototype.setServerCertificate = function (certificate) {
      const pending = nativeSetServerCertificate.call(this, certificate);
      const keySystem = keySystemOf.get(this);
      certReady.set(this, pending.then(() => true, () => false));
      pending.then(() => {
        state.certificate = true;
        waiterFor(this).settle(true);
        const bytes = toBytes(certificate);
        if (keySystem && bytes?.length) keepCert(keySystem, bytes);
      }, () => { });
      return pending;
    };

    const nativeCreateSession = MediaKeys.prototype.createSession;
    MediaKeys.prototype.createSession = function (...args) {
      const session = nativeCreateSession.apply(this, args);
      sessionOwner.set(session, this);
      return session;
    };
  }

  const record = (keySystem, access) => {
    state.keySystem = keySystem;
    let robustness = '';
    try { robustness = access.getConfiguration().videoCapabilities?.[0]?.robustness || ''; } catch { }
    state.robustness = robustness;
    state.hardwareDrm = keySystem === PLAYREADY + '.recommendation.3000'
      || robustness === '3000'
      || robustness === 'HW_SECURE_ALL'
      || robustness === 'HW_SECURE_DECODE';
  };

  if (window.MediaKeySystemAccess) {
    const nativeCreateMediaKeys = MediaKeySystemAccess.prototype.createMediaKeys;
    MediaKeySystemAccess.prototype.createMediaKeys = function (...args) {
      const keySystem = this.keySystem;
      record(keySystem, this);
      return nativeCreateMediaKeys.apply(this, args).then((mediaKeys) => {
        keySystemOf.set(mediaKeys, keySystem);
        if (on('drm') && isPlayReady(keySystem)) provision(mediaKeys, keySystem);
        return mediaKeys;
      });
    };
  }

  if (window.MediaKeySession) {
    const nativeGenerateRequest = MediaKeySession.prototype.generateRequest;
    MediaKeySession.prototype.generateRequest = async function (initDataType, initData) {
      const mediaKeys = sessionOwner.get(this);
      const keySystem = mediaKeys ? keySystemOf.get(mediaKeys) : null;
      const guarded = on('drm') && !!mediaKeys && isPlayReady(keySystem);

      if (guarded) {
        const pending = certReady.get(mediaKeys) || provision(mediaKeys, keySystem);
        if (pending) await pending;
      }

      try {
        return await nativeGenerateRequest.call(this, initDataType, initData);
      } catch (error) {
        if (!guarded || error?.name !== 'InvalidStateError') throw error;

        if (!certReady.has(mediaKeys)) {
          const restored = provision(mediaKeys, keySystem);
          if (restored && await restored) return nativeGenerateRequest.call(this, initDataType, initData);
        }
        const provisioned = await Promise.race([
          waiterFor(mediaKeys).promise,
          new Promise((resolve) => setTimeout(() => resolve(false), CERT_WAIT))
        ]);
        if (provisioned) return nativeGenerateRequest.call(this, initDataType, initData);
        throw error;
      }
    };
  }

  if (navigator.requestMediaKeySystemAccess) {
    const nativeRequestAccess = navigator.requestMediaKeySystemAccess.bind(navigator);
    const accessCache = new Map();

    const withRobustness = (configs, robustness) => configs.map((config) => {
      const clone = JSON.parse(JSON.stringify(config));
      if (Array.isArray(clone.videoCapabilities)) {
        clone.videoCapabilities = clone.videoCapabilities.map((capability) => ({ ...capability, robustness }));
      }
      return clone;
    });

    const ladder = (keySystem, configs) => {
      const hasVideo = configs.some((config) => config.videoCapabilities?.length);
      if (!hasVideo) return [configs];
      if (keySystem === WIDEVINE) {
        return [withRobustness(configs, 'HW_SECURE_ALL'), withRobustness(configs, 'HW_SECURE_DECODE'), configs];
      }
      if (keySystem === PLAYREADY + '.recommendation') return [withRobustness(configs, '3000'), configs];
      return [configs];
    };

    navigator.requestMediaKeySystemAccess = function (keySystem, configs) {
      if (!on('drm') || !Array.isArray(configs)) return nativeRequestAccess(keySystem, configs);

      let signature = null;
      try { signature = keySystem + '|' + JSON.stringify(configs); } catch { signature = null; }
      if (signature && accessCache.has(signature)) return accessCache.get(signature);

      const negotiation = (async () => {
        let lastError;
        for (const variant of ladder(keySystem, configs)) {
          try {
            return await nativeRequestAccess(keySystem, variant);
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError;
      })();

      if (signature) {
        accessCache.set(signature, negotiation);
        negotiation.catch(() => accessCache.delete(signature));
      }
      return negotiation;
    };
  }

  const LEVELLED = /^(.+)-L(\d{2})(-.+)$/;
  const H264 = /^(.*h264)(?:mpl|hpl)(\d{2})(-.+)$/;
  const AUDIO_PROFILE = /^(heaac|xheaac|ddplus|aac)/;
  const TARGET_LEVELS = [40, 41, 50, 51];
  const TARGET_H264 = ['hpl40', 'mpl40'];

  const familyDecodes = (profile) => {
    if (profile.startsWith('hevc-dv5')) return state.codecs.dv;
    if (profile.startsWith('hevc')) return state.codecs.hevc;
    if (profile.startsWith('av1')) return state.codecs.av1;
    if (profile.startsWith('vp9')) return state.codecs.vp9;
    return false;
  };

  const isManifest = (node) =>
    !!node && typeof node === 'object'
    && Array.isArray(node.profiles)
    && (node.viewableId !== undefined
      || node.viewableIds !== undefined
      || node.manifestVersion !== undefined
      || node.drmType !== undefined);

  const upgrade = (request) => {
    const known = new Set(request.profiles);
    const added = [];
    const add = (profile) => {
      if (known.has(profile)) return;
      known.add(profile);
      request.profiles.push(profile);
      added.push(profile);
    };

    if (on('video')) {
      for (const profile of [...request.profiles]) {
        const levelled = LEVELLED.exec(profile);
        if (levelled && familyDecodes(profile)) {
          const [, head, level, tail] = levelled;
          const current = parseInt(level, 10);
          for (const target of TARGET_LEVELS) if (target > current) add(`${head}-L${target}${tail}`);
          continue;
        }
        const h264 = H264.exec(profile);
        if (h264) {
          const [, head, level, tail] = h264;
          if (parseInt(level, 10) < 40) for (const target of TARGET_H264) add(`${head}${target}${tail}`);
        }
      }
    }

    if (on('audio') && request.profiles.some((profile) => AUDIO_PROFILE.test(profile))) {
      if (state.codecs.heaac) {
        add('heaac-2hq-dash');
        add('heaac-5.1-dash');
      }
      if (state.codecs.eac3 && (request.drmType === 'playready' || isPlayReady(state.keySystem))) {
        add('ddplus-2.0-dash');
        add('ddplus-5.1-dash');
        add('ddplus-5.1hq-dash');
        add('ddplus-atmos-dash');
      }
    }

    let touched = added.length > 0;

    if (on('tracks') && request.showAllSubDubTracks !== 1) {
      request.showAllSubDubTracks = 1;
      touched = true;
    }

    if (added.length) {
      state.added = added;
      log(`manifest upgraded · +${added.join(', +')}`);
    }
    return touched;
  };

  const patch = (value) => {
    if (!value || typeof value !== 'object') return false;
    if (isManifest(value)) return upgrade(value);
    if (Array.isArray(value)) {
      if (value.length > 16) return false;
      let touched = false;
      for (const entry of value) if (isManifest(entry)) touched = upgrade(entry) || touched;
      return touched;
    }
    return isManifest(value.params) ? upgrade(value.params) : false;
  };

  const nativeStringify = JSON.stringify;
  JSON.stringify = function (value, replacer, space) {
    if (cfg.enabled && value && typeof value === 'object') {
      try { patch(value); } catch { }
    }
    return nativeStringify.call(this, value, replacer, space);
  };

  const MSL_LIMIT = 1 << 19;
  const BRACE = 123;

  const nativeEncode = TextEncoder.prototype.encode;
  TextEncoder.prototype.encode = function (input) {
    if (cfg.enabled
      && typeof input === 'string'
      && input.length > 200
      && input.length < MSL_LIMIT
      && input.charCodeAt(0) === BRACE) {
      try {
        if (input.includes('"profiles"')) {
          const payload = JSON.parse(input);
          if (patch(payload)) input = nativeStringify.call(JSON, payload);
        } else if (input.includes('"data"') && (input.includes('"messageid"') || input.includes('"sequencenumber"'))) {
          const envelope = JSON.parse(input);
          if (typeof envelope?.data === 'string' && envelope.data.length < MSL_LIMIT) {
            const inner = atob(envelope.data);
            if (inner.charCodeAt(0) === BRACE && inner.includes('"profiles"')) {
              const payload = JSON.parse(inner);
              if (patch(payload)) {
                envelope.data = btoa(nativeStringify.call(JSON, payload));
                input = nativeStringify.call(JSON, envelope);
              }
            }
          }
        }
      } catch { }
    }
    return nativeEncode.call(this, input);
  };

  const kindOf = new WeakMap();
  const WINDOW = 40;
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
      state.hdr = /hvc1\.2|hev1\.2|dvh|av01\.\d+\.\d+[a-z]?\.10/i.test(type);
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
        if (meter.samples.length > WINDOW) meter.samples.shift();
      }
    }
    if (end !== null) meter.end = end;
    meter.pending = 0;
  };

  if (MSE) {
    const nativeAddSourceBuffer = MSE.prototype.addSourceBuffer;
    MSE.prototype.addSourceBuffer = function (mime) {
      const buffer = nativeAddSourceBuffer.call(this, mime);
      const type = String(mime);
      if (type.startsWith('video/')) kindOf.set(buffer, 'video');
      else if (type.startsWith('audio/')) kindOf.set(buffer, 'audio');
      else return buffer;
      noteCodec(buffer, type);
      buffer.addEventListener('updateend', () => settle(buffer));
      return buffer;
    };

    const nativeAppendBuffer = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (data) {
      const meter = meters[kindOf.get(this)];
      if (meter && data?.byteLength) meter.pending += data.byteLength;
      return nativeAppendBuffer.call(this, data);
    };

    const nativeChangeType = SourceBuffer.prototype.changeType;
    if (nativeChangeType) {
      SourceBuffer.prototype.changeType = function (mime) {
        const result = nativeChangeType.call(this, mime);
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

  let video = null;

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
    try {
      const quality = video.getVideoPlaybackQuality();
      state.dropped = quality.droppedVideoFrames;
      state.frames = quality.totalVideoFrames;
    } catch { }
    try {
      const ranges = video.buffered;
      state.buffered = ranges.length ? Math.max(0, ranges.end(ranges.length - 1) - video.currentTime) : 0;
    } catch { }
  };

  const attach = (element) => {
    if (!element) return;
    video = element;
    if (element.__nitrate) return;
    element.__nitrate = true;
    for (const event of ['loadedmetadata', 'resize', 'playing', 'pause']) {
      element.addEventListener(event, readPlayback);
    }
  };

  const nativeSetMediaKeys = HTMLMediaElement.prototype.setMediaKeys;
  HTMLMediaElement.prototype.setMediaKeys = function (mediaKeys) {
    if (this.tagName === 'VIDEO') attach(this);
    return nativeSetMediaKeys.call(this, mediaKeys);
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const PANEL_KEY = {
    key: 'B', code: 'KeyB', keyCode: 66, which: 66,
    ctrlKey: true, altKey: true, shiftKey: true, bubbles: true
  };

  const togglePanel = () => {
    for (const target of [document, window]) {
      try { target.dispatchEvent(new KeyboardEvent('keydown', PANEL_KEY)); } catch { }
    }
  };

  const selectFor = (label) => {
    for (const node of document.querySelectorAll('div,span,label')) {
      if (node.childElementCount || !node.textContent.trim().startsWith(label)) continue;
      let scope = node.parentElement;
      for (let depth = 0; scope && depth < 4; depth++, scope = scope.parentElement) {
        const select = scope.querySelector('select');
        if (select) return select;
      }
    }
    return null;
  };

  const pickHighest = (select) => {
    const options = Array.from(select.options).filter((option) => option.textContent.trim());
    if (!options.length) return;
    const score = (option) => {
      const match = /(\d[\d.]*)/.exec(option.textContent.replace(/[,\s]/g, ''));
      return match ? parseFloat(match[1]) : -1;
    };
    const best = options.reduce((winner, option) => (score(option) > score(winner) ? option : winner), options[0]);
    const target = score(best) < 0 ? options[options.length - 1] : best;
    if (select.value === target.value) return;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, target.value);
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  let overrideDone = null;
  let overrideTries = 0;
  let overrideBusy = false;

  const forcePeakBitrate = async () => {
    if (!on('bitrate') || overrideBusy || !state.playing || !state.titleId) return;
    if (overrideDone === state.titleId || overrideTries > 2) return;

    overrideBusy = true;
    let panel = null;
    let visibility = '';
    try {
      togglePanel();
      let videoSelect = null;
      for (let tick = 0; tick < 15 && !videoSelect; tick++) {
        await wait(200);
        videoSelect = selectFor('Video Bitrate');
      }
      const audioSelect = selectFor('Audio Bitrate');
      const confirm = Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent.trim().toLowerCase() === 'override');

      if (!videoSelect || !confirm) {
        overrideTries++;
        if (overrideTries > 2) state.peak = 'unavailable';
        togglePanel();
        return;
      }

      panel = confirm.parentElement;
      for (let depth = 0; panel && depth < 8 && !panel.contains(videoSelect); depth++) panel = panel.parentElement;
      if (panel === document.body || panel === document.documentElement || !panel?.contains(videoSelect)) panel = null;
      if (panel) {
        visibility = panel.style.visibility;
        panel.style.visibility = 'hidden';
      }

      pickHighest(videoSelect);
      if (audioSelect) pickHighest(audioSelect);
      await wait(80);
      confirm.click();
      await wait(80);
      togglePanel();

      overrideDone = state.titleId;
      state.peak = 'pinned';
      log('video and audio pinned to the highest available stream');
    } catch {
      overrideTries++;
    } finally {
      if (panel) panel.style.visibility = visibility;
      overrideBusy = false;
    }
  };

  const tierOf = () => {
    if (!state.height) return null;
    if (state.height >= 2160 || state.width >= 3840) return 'UHD';
    if (state.height >= 1080) return 'FHD';
    if (state.height >= 720) return 'HD';
    return 'SD';
  };

  const audioLabel = () => {
    const family = familyOf(state.audioCodec);
    const rate = state.audioBitrate;
    if (family === 'eac3') {
      if (rate >= 700) return 'Dolby Atmos';
      if (rate >= 500) return 'Dolby Digital+ 5.1 HQ';
      if (rate >= 300) return 'Dolby Digital+ 5.1';
      return 'Dolby Digital+';
    }
    if (family === 'xheaac') return 'xHE-AAC';
    if (family === 'heaac') return rate >= 160 ? 'HE-AAC 5.1' : 'HE-AAC';
    if (family === 'aac') return 'AAC-LC';
    return state.audioCodec || null;
  };

  let reporting = true;

  const publish = () => {
    readPlayback();
    if (!reporting || (!video && window !== window.top)) return;
    window.postMessage({
      source: 'nitrate-page',
      type: 'telemetry',
      payload: {
        playing: state.playing,
        tier: tierOf(),
        resolution: state.resolution,
        height: state.height,
        videoBitrate: state.videoBitrate,
        audioBitrate: state.audioBitrate,
        videoCodec: state.videoCodec,
        audioLabel: audioLabel(),
        efficient: state.efficiency[familyOf(state.videoCodec)] ?? null,
        hdr: state.hdr,
        hdrNative: state.hdrNative,
        hdrForced: state.hdrForced,
        spatialNative: state.spatialNative,
        spatialForced: state.spatialForced,
        keySystem: state.keySystem,
        robustness: state.robustness,
        hardwareDrm: state.hardwareDrm,
        certificate: state.certificate,
        added: state.added,
        peak: state.peak,
        dropped: state.dropped,
        frames: state.frames,
        buffered: state.buffered,
        codecs: state.codecs,
        browser: state.browser,
        platform: state.platform,
        screen: `${screen.width} × ${screen.height}`,
        panel: `${PANEL.width} × ${PANEL.height}`,
        spoofed: on('display'),
        enabled: cfg.enabled
      }
    }, '*');
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'nitrate') return;

    if (event.data.type === 'detach') {
      reporting = false;
      log('extension reloaded · hooks stay active until this tab reloads');
      return;
    }
    if (event.data.type !== 'config') return;

    const payload = event.data.payload || {};
    if (!state.version) {
      state.version = payload.version || 'unknown';
      log(`bridge connected · v${state.version}`);
    }
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined && key in cfg) cfg[key] = value;
    }
  });

  const trackTitle = () => {
    const id = /\/watch\/(\d+)/.exec(location.pathname)?.[1] || null;
    if (id === state.titleId) return;
    state.titleId = id;
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
    state.peak = null;
    overrideTries = 0;
  };

  const observer = new MutationObserver(() => {
    if (video && video.isConnected) return;
    const element = document.querySelector('video');
    if (element && element !== video) attach(element);
  });

  const boot = () => {
    if (!document.body) {
      requestAnimationFrame(boot);
      return;
    }
    observer.observe(document.body, { childList: true, subtree: true });
    attach(document.querySelector('video'));
  };
  boot();

  setInterval(() => {
    trackTitle();
    publish();
    forcePeakBitrate();
  }, 1000);

  const decoders = Object.entries(state.codecs).filter(([, ok]) => ok).map(([name]) => name).join(' ');
  log(`${browser.name} ${browser.version} on ${platform} · reporting ${TARGET.width}×${TARGET.height} · decodes ${decoders || 'nothing'}`);
})();
