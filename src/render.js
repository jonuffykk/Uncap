(() => {
  'use strict';
  const uncap = window.__uncap;
  const gpu = window.__uncapGpu;
  if (!uncap || !gpu || window.__uncapMotion) return;

  const span = 0.15;
  const trust = 0.16;
  const still = 0.015;
  const rungs = [
    { shift: 3, lod: 3, reach: 2, steps: 3 },
    { shift: 2, lod: 2, reach: 2, steps: 3 },
    { shift: 1, lod: 1, reach: 2, steps: 4 }
  ];

  let kit = null;
  let lumaPass = null;
  let restPass = null;
  let searchPass = null;
  let blendPass = null;
  let lumaPast = null;
  let lumaNow = null;
  let restTexture = null;
  let blendTexture = null;
  let back = [];
  let forth = [];
  let sizes = [];
  let sized = '';

  const face = { detail: null };

  const scale = (width, height, shift) => ({
    width: Math.max(2, width >> shift),
    height: Math.max(2, height >> shift)
  });

  const luma = (source, into, size) => {
    const { gl, bind, target, draw, mipmap } = kit;
    const { program, at } = lumaPass;
    target(into, size.width, size.height);
    gl.useProgram(program);
    gl.uniform1i(at.src, 0);
    bind(0, source);
    draw();
    mipmap(into);
  };

  const sweep = (from, to, field) => {
    const { gl, bind, target, draw } = kit;
    const { program, at } = searchPass;
    gl.useProgram(program);
    gl.uniform1i(at.lumaPast, 0);
    gl.uniform1i(at.lumaNow, 1);
    gl.uniform1i(at.coarse, 2);
    gl.uniform1f(at.span, span);
    bind(0, from);
    bind(1, to);

    for (let index = 0; index < rungs.length; index++) {
      const rung = rungs[index];
      const size = sizes[index];
      target(field[index], size.width, size.height);
      gl.uniform2f(at.stride, 1 / size.width, 1 / size.height);
      gl.uniform1f(at.level, rung.lod);
      gl.uniform1f(at.reach, rung.reach);
      gl.uniform1f(at.steps, rung.steps);
      gl.uniform1f(at.seeded, index === 0 ? 0 : 1);
      if (index > 0) bind(2, field[index - 1]);
      draw();
    }
  };

  window.__uncapMotion = Object.assign(face, {
    open(surface) {
      kit = surface;
      lumaPass = kit.link(gpu.lumaSource, ['src']);
      restPass = kit.link(gpu.restSource, ['lumaPast', 'lumaNow']);
      searchPass = kit.link(gpu.searchSource, [
        'lumaPast', 'lumaNow', 'coarse', 'stride', 'level', 'span', 'reach', 'steps', 'seeded'
      ]);
      blendPass = kit.link(gpu.blendSource, [
        'past', 'now', 'flowBack', 'flowForth', 'rest', 'fine', 'span', 'phase', 'trust', 'still'
      ]);

      lumaPast = kit.texture('mip');
      lumaNow = kit.texture('mip');
      restTexture = kit.texture('mip');
      blendTexture = kit.texture('linear');
      back = rungs.map(() => kit.texture('nearest'));
      forth = rungs.map(() => kit.texture('nearest'));
      sizes = [];
      sized = '';
    },

    fit(width, height) {
      const key = `${width}x${height}`;
      if (key === sized) return;
      sized = key;

      const half = scale(width, height, 1);
      kit.sized(blendTexture, width, height);
      for (const texture of [lumaPast, lumaNow, restTexture]) {
        kit.sized(texture, half.width, half.height);
        kit.mipmap(texture);
      }

      sizes = rungs.map((rung) => scale(half.width, half.height, rung.shift));
      for (let index = 0; index < rungs.length; index++) {
        kit.sized(back[index], sizes[index].width, sizes[index].height);
        kit.sized(forth[index], sizes[index].width, sizes[index].height);
      }
      const finest = sizes[sizes.length - 1];
      face.detail = `${finest.width} × ${finest.height}`;
    },

    pair(past, now, width, height) {
      const { gl, bind, target, draw, mipmap } = kit;
      const half = scale(width, height, 1);

      luma(past, lumaPast, half);
      luma(now, lumaNow, half);

      const rest = restPass;
      target(restTexture, half.width, half.height);
      gl.useProgram(rest.program);
      gl.uniform1i(rest.at.lumaPast, 0);
      gl.uniform1i(rest.at.lumaNow, 1);
      bind(0, lumaPast);
      bind(1, lumaNow);
      draw();
      mipmap(restTexture);

      sweep(lumaPast, lumaNow, back);
      sweep(lumaNow, lumaPast, forth);
    },

    mid(past, now, width, height, phase) {
      const { gl, bind, target, draw } = kit;
      const { program, at } = blendPass;
      const finest = sizes[sizes.length - 1];
      target(blendTexture, width, height);
      gl.useProgram(program);
      gl.uniform1i(at.past, 0);
      gl.uniform1i(at.now, 1);
      gl.uniform1i(at.flowBack, 2);
      gl.uniform1i(at.flowForth, 3);
      gl.uniform1i(at.rest, 4);
      gl.uniform2f(at.fine, 1 / finest.width, 1 / finest.height);
      gl.uniform1f(at.span, span);
      gl.uniform1f(at.phase, phase);
      gl.uniform1f(at.trust, trust);
      gl.uniform1f(at.still, still);
      bind(0, past);
      bind(1, now);
      bind(2, back[back.length - 1]);
      bind(3, forth[forth.length - 1]);
      bind(4, restTexture);
      draw();
      return blendTexture;
    },

    close() {
      kit = null;
      lumaPass = null;
      restPass = null;
      searchPass = null;
      blendPass = null;
      lumaPast = null;
      lumaNow = null;
      restTexture = null;
      blendTexture = null;
      back = [];
      forth = [];
      sizes = [];
      sized = '';
      face.detail = null;
    }
  });
})();

(() => {
  'use strict';
  const uncap = window.__uncap;
  const gpu = window.__uncapGpu;
  if (!uncap || !gpu || window.__uncapRender) return;

  const { cfg, state, log } = uncap;

  const presets = {
    balanced: { sharpen: 0.4, darken: 0, thin: 0, denoise: 0, deband: 0, deblur: 0 },
    sharp: { sharpen: 0.8, darken: 0, thin: 0, denoise: 0, deband: 0, deblur: 0.25 },
    anime: { sharpen: 0.6, darken: 0.55, thin: 0.35, denoise: 0.15, deband: 0.2, deblur: 0.55 }
  };

  const steps = { auto: 0, '2x': 2, '3x': 3, '4x': 4 };
  const floor = 0.3;
  const sourceMax = 90;
  const headroomNeeded = 1.5;
  const crowded = 0.5;
  const nominal = [24000 / 1001, 24, 25, 30000 / 1001, 30, 48, 50, 60000 / 1001, 60, 72, 75, 90, 100, 120];
  const stageNames = ['smooth', 'scale', 'restore', 'sharpen'];
  const warmup = 2;
  const window8 = 8;

  const recipe = () => (cfg.mode === 'custom'
    ? {
      sharpen: cfg.sharpen,
      darken: cfg.darken,
      thin: cfg.thin,
      denoise: cfg.denoise,
      deband: cfg.deband,
      deblur: cfg.deblur
    }
    : presets[cfg.mode] || presets.balanced);

  const report = {
    active: false, reason: null, cost: 0, budget: 0, from: null, to: null, factor: 0,
    taps: 0, smoothing: false, source: 0, shown: 0, expected: 0,
    strain: 0, share: 0, tier: null, refining: false, detail: null
  };

  let kit = null;
  let canvas = null;
  let passes = null;
  let frames = [null, null];
  let stageTexture = null;
  let refineTexture = null;

  let handle = 0;
  let raf = 0;
  let running = false;
  let observer = null;
  let dirty = true;

  let fresh = 0;
  let arrival = 0;
  let interval = 0;
  let lastMedia = 0;
  let pairSize = '';
  let pairReady = false;
  let painted = 0;
  let paintedAt = 0;
  let steady = 0;
  let lastPhase = -1;
  let lastClip = null;
  let retryAt = 0;
  let backoff = 1000;
  let probeAt = 0;
  let timed = 0;
  let samples = [];
  let seamHost = null;
  let grip = null;
  let dragging = false;
  let seam = 0.5;

  const block = () => window.__uncapMotion;
  const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));
  const panel = () => state.refresh || 60;
  const budget = () => 1000 / panel();
  const headroom = () => (report.source ? panel() / report.source : 0);
  const sharpening = () => report.strain < 2;

  const learn = (spent) => {
    if (!report.active || !report.to) return;
    if (++timed > warmup) samples.push(spent);
    if (samples.length > window8) samples.shift();
    if (samples.length < 3) return;
    report.budget = Number(budget().toFixed(1));
    report.share = Number((Math.max(...samples) / budget()).toFixed(2));
    report.tier = report.share < 0.25 ? 'ample' : report.share < 0.55 ? 'tight' : 'strained';
  };

  const boost = () => {
    const asked = steps[cfg.smooth];
    if (asked === undefined || report.strain > 0) return -1;
    if (!report.source || report.source > sourceMax) return -1;
    if (headroom() < headroomNeeded) return -1;
    if (!report.smoothing && report.share > crowded) return -1;
    return asked;
  };

  const expected = () => {
    const count = boost();
    if (count < 0) return report.source;
    return count ? Math.min(panel(), report.source * count) : panel();
  };

  const teardown = (reason) => {
    running = false;
    Object.assign(report, {
      active: false, reason, cost: 0, to: null, factor: 0, taps: 0,
      smoothing: false, refining: false, shown: 0, detail: null,
      expected: 0, share: 0, tier: null
    });
    timed = 0;
    samples = [];

    if (handle) {
      try { uncap.element()?.cancelVideoFrameCallback?.(handle); } catch { }
      handle = 0;
    }
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    dropSeam();
    if (canvas) {
      canvas.remove();
      canvas = null;
    }
    block()?.close();
    kit = null;
    passes = null;
    frames = [null, null];
    stageTexture = null;
    refineTexture = null;
    interval = 0;
    lastMedia = 0;
    pairSize = '';
    pairReady = false;
    lastPhase = -1;
    lastClip = null;
  };

  const build = () => {
    kit = gpu.surface(floor, () => fail(new Error('context lost')));
    canvas = kit.canvas;
    passes = {
      scale: kit.link(gpu.upscaleSource, ['src', 'size', 'spread', 'taps']),
      restore: kit.link(gpu.restoreSource, ['src', 'texel', 'denoise', 'thin', 'deblur']),
      finish: kit.link(gpu.finishSource, ['src', 'texel', 'amount', 'darken', 'deband', 'split'])
    };

    frames = [kit.texture(), kit.texture()];
    stageTexture = kit.texture();
    refineTexture = kit.texture();
    block()?.open(kit);
  };

  const dropSeam = () => {
    if (!seamHost) return;
    seamHost.remove();
    seamHost = null;
    grip = null;
    dragging = false;
  };

  const onGrab = (event) => {
    dragging = true;
    try { grip.setPointerCapture(event.pointerId); } catch { }
    event.preventDefault();
    event.stopPropagation();
  };

  const onDrag = (event) => {
    if (!dragging || !seamHost) return;
    const box = seamHost.getBoundingClientRect();
    if (box.width < 4) return;
    seam = clamp01((event.clientX - box.left) / box.width);
    grip.style.left = `${(seam * 100).toFixed(3)}%`;
    event.preventDefault();
    event.stopPropagation();
    redraw();
  };

  const onDrop = (event) => {
    if (!dragging) return;
    dragging = false;
    try { grip.releasePointerCapture(event.pointerId); } catch { }
    uncap.set({ split: Number(seam.toFixed(4)) });
  };

  const holdSeam = () => {
    if (!canvas || !cfg.compare || !cfg.enabled) {
      dropSeam();
      return;
    }
    if (!dragging) seam = clamp01(cfg.split);
    if (!seamHost) {
      seamHost = document.createElement('div');
      seamHost.style.cssText = 'position:absolute;pointer-events:none;z-index:2';
      grip = document.createElement('div');
      grip.style.cssText = 'position:absolute;top:0;height:100%;width:26px;margin-left:-13px;'
        + 'cursor:ew-resize;pointer-events:auto;touch-action:none;'
        + 'background:radial-gradient(circle at 50% 50%,'
        + ' rgba(255,255,255,.95) 0 8px, rgba(0,0,0,.35) 8px 10px, transparent 10px)';
      seamHost.appendChild(grip);
      grip.addEventListener('pointerdown', onGrab);
      grip.addEventListener('pointermove', onDrag);
      grip.addEventListener('pointerup', onDrop);
      grip.addEventListener('pointercancel', onDrop);
    }
    const parent = canvas.parentElement;
    if (parent && seamHost.parentElement !== parent) parent.appendChild(seamHost);
    seamHost.style.left = canvas.style.left;
    seamHost.style.top = canvas.style.top;
    seamHost.style.width = canvas.style.width;
    seamHost.style.height = canvas.style.height;
    grip.style.left = `${(seam * 100).toFixed(3)}%`;
  };

  const place = (element) => {
    const fit = kit.place(element, cfg.target);
    if (!fit || fit === 'tiny') return fit;
    if (fit.resized) {
      kit.sized(stageTexture, fit.width, fit.height);
      kit.sized(refineTexture, fit.width, fit.height);
    }
    report.from = fit.from;
    report.to = fit.to;
    report.factor = fit.factor;
    report.taps = fit.taps;
    holdSeam();
    dirty = false;
    return true;
  };

  const intake = (element, media) => {
    const { gl, bind } = kit;
    const key = `${element.videoWidth}x${element.videoHeight}`;
    if (key !== pairSize) {
      pairSize = key;
      pairReady = false;
      block()?.fit(element.videoWidth, element.videoHeight);
    }

    fresh = 1 - fresh;
    bind(0, frames[fresh]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, element);

    if (typeof media === 'number') {
      const gap = media - lastMedia;
      if (lastMedia && gap > 0.005 && gap < 0.2) {
        interval = interval ? interval * 0.8 + gap * 0.2 : gap;
        report.source = Math.round(uncap.snap(1 / interval, nominal, 0.02));
      }
      lastMedia = media;
    }
    arrival = performance.now();
    lastPhase = -1;

    if (!pairReady) {
      pairReady = true;
      return;
    }
    if (boost() < 0) return;
    block()?.pair(frames[1 - fresh], frames[fresh], element.videoWidth, element.videoHeight);
    kit.screen(canvas.width, canvas.height);
  };

  const grade = () => {
    const want = expected();
    report.expected = want;
    if (!want || !report.shown) return;

    if (report.shown < want * 0.75) {
      steady = 0;
      if (report.strain < 3) {
        report.strain++;
        if (report.strain === 3) teardown('slow');
        else log(`easing off, the picture is running at ${report.shown} of ${want}`);
      }
      return;
    }
    if (report.shown >= want * 0.95 && report.strain > 0 && ++steady >= 5) {
      steady = 0;
      report.strain--;
    }
  };

  const draw = (element, phase) => {
    const { gl, bind, target, screen, draw: fire } = kit;
    const probe = performance.now() - probeAt > 1000;
    if (probe) gl.finish();
    const started = performance.now();
    const look = recipe();
    const width = canvas.width;
    const height = canvas.height;
    const smoothing = phase !== null && pairReady && boost() >= 0;

    let feed = frames[fresh];
    const feedWidth = element.videoWidth;
    const feedHeight = element.videoHeight;

    if (smoothing) {
      feed = block()?.mid(
        frames[1 - fresh], frames[fresh],
        element.videoWidth, element.videoHeight, phase
      ) || feed;
    }

    const scale = passes.scale;
    target(stageTexture, width, height);
    gl.useProgram(scale.program);
    gl.uniform1i(scale.at.src, 0);
    gl.uniform2f(scale.at.size, feedWidth, feedHeight);
    gl.uniform2f(scale.at.spread, 1 / width, 1 / height);
    const ratio = width / feedWidth;
    gl.uniform1f(scale.at.taps, ratio >= 0.98 ? 0 : Math.min(4, Math.max(2, Math.ceil(0.5 / ratio))));
    bind(0, feed);
    fire();

    const keen = sharpening();
    const restoring = keen && (look.denoise > 0.001 || look.thin > 0.001 || look.deblur > 0.001);
    let source = stageTexture;

    if (restoring) {
      const restore = passes.restore;
      target(refineTexture, width, height);
      gl.useProgram(restore.program);
      gl.uniform1i(restore.at.src, 0);
      gl.uniform2f(restore.at.texel, 1 / width, 1 / height);
      gl.uniform1f(restore.at.denoise, look.denoise);
      gl.uniform1f(restore.at.thin, look.thin);
      gl.uniform1f(restore.at.deblur, look.deblur);
      bind(0, stageTexture);
      fire();
      source = refineTexture;
    }
    report.refining = restoring;

    const clip = cfg.compare ? `inset(0 0 0 ${(seam * 100).toFixed(3)}%)` : 'none';
    if (clip !== lastClip) {
      lastClip = clip;
      canvas.style.clipPath = clip;
    }

    const finish = passes.finish;
    screen(width, height);
    gl.useProgram(finish.program);
    gl.uniform1i(finish.at.src, 0);
    gl.uniform2f(finish.at.texel, 1 / width, 1 / height);
    gl.uniform1f(finish.at.amount, keen ? look.sharpen : 0);
    gl.uniform1f(finish.at.darken, keen ? look.darken : 0);
    gl.uniform1f(finish.at.deband, keen ? look.deband : 0);
    gl.uniform1f(finish.at.split, cfg.compare ? seam : 0);
    bind(0, source);
    fire();

    report.smoothing = smoothing;
    report.detail = block()?.detail || null;
    if (probe) {
      gl.finish();
      probeAt = performance.now();
      const spent = probeAt - started;
      report.cost = report.cost ? report.cost * 0.7 + spent * 0.3 : spent;
      learn(spent);
    }

    const now = performance.now();
    painted++;
    if (!paintedAt) {
      paintedAt = now;
    } else if (now - paintedAt > 1000) {
      report.shown = Math.round((painted * 1000) / (now - paintedAt));
      painted = 0;
      paintedAt = now;
      grade();
    }
  };

  const fail = (error) => {
    const secure = /secur/i.test(String(error?.name || error));
    const element = uncap.element();
    if (secure) {
      const guarded = !!element?.mediaKeys || state.guarded;
      state.tainted = !guarded;
      teardown(guarded ? 'guarded' : 'tainted');
    } else {
      teardown('gpu');
      retryAt = performance.now() + backoff;
      backoff = Math.min(backoff * 2, 30000);
    }
    log('enhancer stopped,', error?.message || error);
  };

  const ready = (element) => {
    if (!element.isConnected) {
      teardown(null);
      return false;
    }
    if (document.hidden || !element.videoWidth) return false;
    if (!dirty) return true;
    const fit = place(element);
    if (fit === 'tiny') {
      teardown('tiny');
      return false;
    }
    return fit === true;
  };

  const schedule = (element) => {
    const onFrame = (time, metadata) => {
      handle = 0;
      if (!running) return;
      try {
        if (ready(element)) {
          intake(element, metadata?.mediaTime);
          if (boost() < 0 || !interval) draw(element, null);
        }
      } catch (error) {
        fail(error);
        return;
      }
      if (running) handle = element.requestVideoFrameCallback(onFrame);
    };

    const onPaint = () => {
      raf = 0;
      if (!running) return;
      try {
        if (ready(element)) {
          const count = boost();
          if (count >= 0 && interval > 0 && !element.paused) {
            const span = Math.min(1, Math.max(0, (performance.now() - arrival) / 1000 / interval));
            const phase = count ? Math.min(1, Math.floor(span * count) / count) : span;
            if (phase !== lastPhase) {
              lastPhase = phase;
              draw(element, phase);
            }
          } else if (report.smoothing || !element.requestVideoFrameCallback) {
            draw(element, null);
          }
        }
      } catch (error) {
        fail(error);
        return;
      }
      if (running) raf = requestAnimationFrame(onPaint);
    };

    if (element.requestVideoFrameCallback) handle = element.requestVideoFrameCallback(onFrame);
    raf = requestAnimationFrame(onPaint);
  };

  const blocker = (element) => {
    if (!uncap.allowed()) return 'offsite';
    if (!element || !element.videoWidth) return 'waiting';
    if (element.mediaKeys || state.guarded) return 'guarded';
    if (state.tainted) return 'tainted';
    if (state.hdr) return 'hdr';
    const size = gpu.measure(element, cfg.target);
    if (!size) return 'waiting';
    if (size.width < element.videoWidth * floor) return 'tiny';
    return null;
  };

  const start = () => {
    const element = uncap.element();
    let fit = null;
    try {
      build();
      dirty = true;
      fit = place(element);
      if (fit !== true) throw new Error(fit === 'tiny' ? 'tiny' : 'no box');
      intake(element, null);
      draw(element, null);
    } catch (error) {
      if (fit === 'tiny') teardown('tiny');
      else fail(error);
      return;
    }

    running = true;
    report.active = true;
    report.reason = null;
    painted = 0;
    paintedAt = 0;
    steady = 0;
    backoff = 1000;
    retryAt = 0;

    observer = new ResizeObserver(() => { dirty = true; });
    observer.observe(element);

    schedule(element);
    log(`enhancing ${report.from} to ${report.to}`);
  };

  const wanted = () => cfg.enabled && cfg.mode !== 'off';

  const sync = () => {
    if (!wanted()) {
      if (running) teardown(null);
      else report.reason = null;
      return;
    }
    if (running) return;

    const stop = blocker(uncap.element());
    if (stop) {
      report.reason = stop;
      return;
    }
    if (performance.now() < retryAt) return;
    start();
  };

  function redraw() {
    const element = uncap.element();
    if (!running || !element || !element.videoWidth) return;
    lastPhase = -1;
    try {
      if (ready(element)) draw(element, null);
    } catch (error) {
      fail(error);
    }
  }

  uncap.onConfig(() => {
    dirty = true;
    sync();
    holdSeam();
    redraw();
  });

  uncap.onVideo(() => {
    if (running) teardown(null);
    report.reason = null;
    report.source = 0;
    report.strain = 0;
    state.tainted = false;
    retryAt = 0;
    backoff = 1000;
    sync();
  });

  uncap.tick(() => {
    if (running) dirty = true;
    else if (wanted()) sync();
  });

  const remeasure = () => { dirty = true; };
  window.addEventListener('fullscreenchange', remeasure);
  window.addEventListener('resize', remeasure);
  document.addEventListener('visibilitychange', remeasure);

  const activeStage = (name) => {
    if (name === 'smooth') return report.smoothing;
    if (name === 'restore') return report.refining;
    if (name === 'scale') return true;
    return sharpening();
  };

  window.__uncapRender = report;

  uncap.feed(() => ({
    enhance: {
      ...report,
      cost: Number(report.cost.toFixed(2)),
      shrinking: report.taps > 0,
      headroom: Number(headroom().toFixed(2)),
      stages: report.active ? stageNames.filter(activeStage) : []
    }
  }));
})();
