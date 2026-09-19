(() => {
  'use strict';
  const uncap = window.__uncap;
  if (!uncap || window.__uncapDrm) return;

  const { on } = uncap;

  const playready = 'com.microsoft.playready';
  const widevine = 'com.widevine.alpha';
  const certKey = 'uncap.cert.';
  const certWait = 3000;

  const info = {
    keySystem: null,
    robustness: null,
    hardwareDrm: false,
    promoted: false,
    certificate: false,
    isPlayReady: (keySystem) => typeof keySystem === 'string' && keySystem.startsWith(playready)
  };
  window.__uncapDrm = info;

  const keySystemOf = new WeakMap();
  const certReady = new WeakMap();
  const certWaiters = new WeakMap();
  const sessionOwner = new WeakMap();
  const certCache = new Map();

  const waiterFor = (keys) => {
    let waiter = certWaiters.get(keys);
    if (!waiter) {
      let settle;
      waiter = { promise: new Promise((resolve) => { settle = resolve; }) };
      waiter.settle = settle;
      certWaiters.set(keys, waiter);
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
      localStorage.setItem(certKey + keySystem, btoa(binary));
    } catch { }
  };

  const forgetCert = (keySystem) => {
    certCache.delete(keySystem);
    try { localStorage.removeItem(certKey + keySystem); } catch { }
  };

  const recallCert = (keySystem) => {
    if (certCache.has(keySystem)) return certCache.get(keySystem);
    try {
      const stored = localStorage.getItem(certKey + keySystem);
      if (!stored) return null;
      const binary = atob(stored);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      certCache.set(keySystem, bytes);
      return bytes;
    } catch { return null; }
  };

  const setServerCertificate = window.MediaKeys && MediaKeys.prototype.setServerCertificate;

  const provision = (keys, keySystem) => {
    const bytes = recallCert(keySystem);
    if (!bytes || !setServerCertificate) return null;
    const pending = setServerCertificate.call(keys, bytes).then(
      () => { info.certificate = true; return true; },
      () => { forgetCert(keySystem); return false; }
    );
    certReady.set(keys, pending);
    return pending;
  };

  if (setServerCertificate) {
    MediaKeys.prototype.setServerCertificate = function (certificate) {
      const pending = setServerCertificate.call(this, certificate);
      const keySystem = keySystemOf.get(this);
      certReady.set(this, pending.then(() => true, () => false));
      pending.then(() => {
        info.certificate = true;
        waiterFor(this).settle(true);
        const bytes = toBytes(certificate);
        if (on('drm') && keySystem && bytes?.length) keepCert(keySystem, bytes);
      }, () => { });
      return pending;
    };

    const createSession = MediaKeys.prototype.createSession;
    MediaKeys.prototype.createSession = function (...args) {
      const session = createSession.apply(this, args);
      sessionOwner.set(session, this);
      return session;
    };
  }

  const record = (keySystem, access) => {
    info.keySystem = keySystem;
    let robustness = '';
    try { robustness = access.getConfiguration().videoCapabilities?.[0]?.robustness || ''; } catch { }
    info.robustness = robustness;
    info.hardwareDrm = keySystem === `${playready}.recommendation.3000`
      || robustness === '3000'
      || robustness === 'HW_SECURE_ALL'
      || robustness === 'HW_SECURE_DECODE';
  };

  if (window.MediaKeySystemAccess) {
    const createMediaKeys = MediaKeySystemAccess.prototype.createMediaKeys;
    MediaKeySystemAccess.prototype.createMediaKeys = function (...args) {
      const keySystem = this.keySystem;
      record(keySystem, this);
      return createMediaKeys.apply(this, args).then((keys) => {
        keySystemOf.set(keys, keySystem);
        if (on('drm') && info.isPlayReady(keySystem)) provision(keys, keySystem);
        return keys;
      });
    };
  }

  if (window.MediaKeySession) {
    const generateRequest = MediaKeySession.prototype.generateRequest;
    MediaKeySession.prototype.generateRequest = async function (initDataType, initData) {
      const keys = sessionOwner.get(this);
      const keySystem = keys ? keySystemOf.get(keys) : null;
      const guarded = on('drm') && !!keys && info.isPlayReady(keySystem);

      if (guarded) {
        const pending = certReady.get(keys) || provision(keys, keySystem);
        if (pending) await pending;
      }

      try {
        return await generateRequest.call(this, initDataType, initData);
      } catch (error) {
        if (!guarded || error?.name !== 'InvalidStateError') throw error;

        if (!certReady.has(keys)) {
          const restored = provision(keys, keySystem);
          if (restored && await restored) return generateRequest.call(this, initDataType, initData);
        }
        const provisioned = await Promise.race([
          waiterFor(keys).promise,
          new Promise((resolve) => setTimeout(() => resolve(false), certWait))
        ]);
        if (provisioned) return generateRequest.call(this, initDataType, initData);
        throw error;
      }
    };
  }

  if (navigator.requestMediaKeySystemAccess) {
    const requestAccess = navigator.requestMediaKeySystemAccess.bind(navigator);
    const accessCache = new Map();

    const withRobustness = (configs, robustness) => configs.map((config) => {
      const clone = JSON.parse(JSON.stringify(config));
      if (Array.isArray(clone.videoCapabilities)) {
        clone.videoCapabilities = clone.videoCapabilities.map((capability) => ({ ...capability, robustness }));
      }
      return clone;
    });

    const hardwarePlayReady = `${playready}.recommendation.3000`;

    const ladder = (keySystem, configs) => {
      const hasVideo = configs.some((config) => config.videoCapabilities?.length);
      if (!hasVideo) return [[keySystem, configs]];
      if (keySystem === widevine) {
        return [
          [keySystem, withRobustness(configs, 'HW_SECURE_ALL')],
          [keySystem, withRobustness(configs, 'HW_SECURE_DECODE')],
          [keySystem, configs]
        ];
      }
      if (keySystem.startsWith(playready) && keySystem !== hardwarePlayReady) {
        return [
          [hardwarePlayReady, withRobustness(configs, '3000')],
          [hardwarePlayReady, configs],
          [keySystem, withRobustness(configs, '3000')],
          [keySystem, configs]
        ];
      }
      return [[keySystem, withRobustness(configs, '3000')], [keySystem, configs]];
    };

    navigator.requestMediaKeySystemAccess = function (keySystem, configs) {
      if (!on('drm') || !Array.isArray(configs)) return requestAccess(keySystem, configs);

      let signature = null;
      try { signature = `${keySystem}|${JSON.stringify(configs)}`; } catch { signature = null; }
      if (signature && accessCache.has(signature)) return accessCache.get(signature);

      const negotiation = (async () => {
        let lastError;
        const rungs = ladder(keySystem, configs);
        for (let index = 0; index < rungs.length; index++) {
          const [system, variant] = rungs[index];
          try {
            const access = await requestAccess(system, variant);
            info.promoted = index < rungs.length - 1;
            return access;
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

  uncap.feed(() => ({
    keySystem: info.keySystem,
    robustness: info.robustness,
    hardwareDrm: info.hardwareDrm,
    drmPromoted: info.promoted,
    certificate: info.certificate
  }));
})();

(() => {
  'use strict';
  const uncap = window.__uncap;
  if (!uncap || window.__uncapMask) return;
  window.__uncapMask = true;

  const { cfg, on, state, familyOf } = uncap;

  const mediaSource = window.MediaSource || window.ManagedMediaSource;
  const nativeIsTypeSupported = mediaSource ? mediaSource.isTypeSupported.bind(mediaSource) : () => false;
  const decodes = (type) => {
    try { return nativeIsTypeSupported(type); } catch { return false; }
  };

  const probes = {
    h264: ['video/mp4; codecs="avc1.640028"'],
    hevc: ['video/mp4; codecs="hvc1.2.4.L153.B0"', 'video/mp4; codecs="hev1.2.4.L153.B0"'],
    av1: ['video/mp4; codecs="av01.0.13M.08"'],
    dv: ['video/mp4; codecs="dvh1.05.07"', 'video/mp4; codecs="dvhe.05.07"'],
    vp9: ['video/mp4; codecs="vp09.00.51.08"', 'video/webm; codecs="vp9"'],
    aac: ['audio/mp4; codecs="mp4a.40.2"'],
    heaac: ['audio/mp4; codecs="mp4a.40.5"'],
    xheaac: ['audio/mp4; codecs="mp4a.40.42"'],
    eac3: ['audio/mp4; codecs="ec-3"'],
    opus: ['audio/webm; codecs="opus"']
  };
  for (const [family, types] of Object.entries(probes)) state.codecs[family] = types.some(decodes);

  const nativeDecodingInfo = navigator.mediaCapabilities?.decodingInfo
    ? navigator.mediaCapabilities.decodingInfo.bind(navigator.mediaCapabilities)
    : null;

  const videoFamilies = ['h264', 'hevc', 'av1', 'vp9'];
  const surveyTypes = {
    h264: 'video/mp4; codecs="avc1.640033"',
    hevc: 'video/mp4; codecs="hvc1.1.6.L153.B0"',
    av1: 'video/mp4; codecs="av01.0.13M.08"',
    vp9: 'video/webm; codecs="vp09.00.51.08"'
  };
  const surveyFrame = { width: 3840, height: 2160, bitrate: 20000000, framerate: 60 };

  const survey = async () => {
    if (!nativeDecodingInfo) return;
    for (const [family, contentType] of Object.entries(surveyTypes)) {
      if (!state.codecs[family]) continue;
      try {
        const answer = await nativeDecodingInfo({ type: 'media-source', video: { contentType, ...surveyFrame } });
        if (answer?.supported) state.efficiency[family] = !!answer.powerEfficient;
      } catch { }
    }
  };

  survey().finally(() => {
    state.surveyed = true;
    const soft = videoFamilies.filter((family) => state.efficiency[family] === false);
    if (soft.length) uncap.log(`${soft.join(' and ')} decode in software on this machine`);
  });

  const clumsy = (family) => cfg.enabled && cfg.stream && cfg.efficient && state.surveyed
    && state.efficiency[family] === false
    && videoFamilies.some((other) => other !== family && state.efficiency[other] === true);

  if (mediaSource) {
    mediaSource.isTypeSupported = function (mime) {
      const family = familyOf(mime);
      if (family && clumsy(family)) return false;
      const real = decodes(mime);
      if (real || !on('codecs')) return real;
      return family ? !!state.codecs[family] : real;
    };
  }

  const nativeCanPlayType = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (mime) {
    const family = familyOf(mime);
    if (family && clumsy(family)) return '';
    const real = nativeCanPlayType.call(this, mime);
    if (real === 'probably' || !on('codecs')) return real;
    return family && state.codecs[family] ? 'probably' : real;
  };

  const positive = (value) =>
    value === true || (typeof value === 'string' && /probably|maybe/i.test(value) && !/^not/i.test(value));

  if (mediaSource && typeof mediaSource.isTypeSupportedWithFeatures === 'function') {
    const withFeatures = mediaSource.isTypeSupportedWithFeatures.bind(mediaSource);
    const askNative = (type, features) => {
      try { return withFeatures(type, features); } catch { return null; }
    };
    const baseline = 'decode-res-x=1280,decode-res-y=720,decode-bpc=8,display-res-x=1280,display-res-y=720,display-bpc=8';
    let yesToken = null;

    mediaSource.isTypeSupportedWithFeatures = function (type, features) {
      const real = askNative(type, features);
      if (!cfg.enabled || !cfg.stream) return real;

      const text = String(features || '').toLowerCase();
      const deep = /bpc=(1[0-9]|[2-9][0-9])/.test(text) || text.includes('hdr') || text.includes('pq') || text.includes('smpte');
      if (deep && !positive(real)) state.hdrNative = false;
      if (!(deep ? on('hdr') : on('display'))) return real;
      if (positive(real)) return real;

      if (yesToken === null) yesToken = askNative(type, baseline);
      if (deep) state.hdrForced = true;
      return positive(yesToken) ? yesToken : (typeof real === 'string' ? 'probably' : true);
    };
  }

  const asksAboutHdr = (track) =>
    (track.transferFunction && track.transferFunction !== 'srgb')
    || (track.colorGamut && track.colorGamut !== 'srgb')
    || track.hdrMetadataType !== undefined;

  const asksAboutSpatial = (track) =>
    track.spatialRendering === true || Number(track.channels) > 8;

  if (nativeDecodingInfo) {
    navigator.mediaCapabilities.decodingInfo = async function (config) {
      const result = await nativeDecodingInfo(config);
      const track = config?.video || config?.audio;
      if (!track) return result;

      const isVideo = !!config.video;
      const family = familyOf(track.contentType);
      if (isVideo && family && clumsy(family)) {
        return { ...result, supported: false, smooth: false, powerEfficient: false };
      }
      const widening = (isVideo ? on('codecs') : on('audio')) && !!family && !!state.codecs[family];
      const yes = {
        supported: true,
        smooth: true,
        powerEfficient: true,
        keySystemAccess: result.keySystemAccess,
        configuration: result.configuration
      };

      if (isVideo && family) state.efficiency[family] = !!result.powerEfficient;

      if (isVideo && asksAboutHdr(track)) {
        state.hdrNative = !!result.supported;
        if (!on('hdr')) return result;
        state.hdrForced = true;
        return yes;
      }

      if (!isVideo && asksAboutSpatial(track)) {
        state.spatialNative = !!result.supported;
        if (widening && !result.supported) state.spatialForced = true;
      }

      return widening ? yes : result;
    };
  }

  const real = { width: screen.width, height: screen.height, depth: screen.colorDepth };
  const claim = { width: 3840, height: 2160, depth: 30 };

  const mask = (target, property, forced, actual) => {
    try {
      Object.defineProperty(target, property, {
        get: () => (on('display') ? forced : actual),
        configurable: true
      });
    } catch { }
  };

  mask(screen, 'width', claim.width, real.width);
  mask(screen, 'height', claim.height, real.height);
  mask(screen, 'availWidth', claim.width, screen.availWidth);
  mask(screen, 'availHeight', claim.height, screen.availHeight);
  mask(screen, 'colorDepth', claim.depth, real.depth);
  mask(screen, 'pixelDepth', claim.depth, real.depth);
  mask(window, 'outerWidth', claim.width, window.outerWidth);
  mask(window, 'outerHeight', claim.height, window.outerHeight);

  const hdrQueries = [
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
    if (!hdrQueries.some(([feature, value]) => text.includes(feature) && text.includes(value))) return list;
    return new Proxy(list, {
      get(target, property) {
        if (property === 'matches') return true;
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  };

  uncap.feed(() => ({
    codecs: state.codecs,
    efficiency: state.efficiency,
    surveyed: state.surveyed,
    refused: videoFamilies.filter(clumsy),
    efficient: state.efficiency[familyOf(state.videoCodec)] ?? null,
    hdrNative: state.hdrNative,
    hdrForced: state.hdrForced,
    spatialForced: state.spatialForced,
    reported: `${screen.width} × ${screen.height}`,
    display: `${real.width} × ${real.height}`,
    spoofed: on('display')
  }));
})();
