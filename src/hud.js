(() => {
  'use strict';
  const uncap = window.__uncap;
  if (!uncap || !uncap.set || window.__uncapHud) return;
  window.__uncapHud = true;

  const { cfg, snapshot, set } = uncap;

  const skin = `
    .card {
      position: fixed;
      top: 16px;
      right: 16px;
      min-width: 158px;
      padding: 10px 13px 11px;
      border-radius: 14px;
      background: rgba(11, 11, 12, .84);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, .09), 0 10px 30px rgba(0, 0, 0, .45);
      backdrop-filter: blur(18px);
      font: 500 11px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif;
      color: #f2f0ec;
      letter-spacing: -.01em;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .top { display: flex; align-items: center; gap: 7px; margin-bottom: 3px; }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: #e50914; flex: none; }
    .dot.rest { background: #6b6963; }
    .lead { font-size: 14px; font-weight: 700; letter-spacing: -.03em; }
    .chip {
      margin-left: auto;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(255, 255, 255, .08);
      font-size: 9px;
      font-weight: 700;
      letter-spacing: .08em;
      color: #9c9a94;
    }
    .chip.peak { background: #63d68a; color: #0b0b0c; }
    .row { color: #9c9a94; }
    .row.warn { color: #ff5247; }
  `;

  const standDown = {
    guarded: 'protected picture',
    tainted: 'cross origin video',
    hdr: 'hdr picture',
    tiny: 'source far larger than the window',
    slow: 'too heavy for this machine',
    gpu: 'no gpu pipeline',
    offsite: 'not on for this site',
    waiting: 'waiting'
  };

  const rate = (kbps) => (kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mb/s` : `${kbps} kb/s`);

  const lines = (data) => {
    if (!cfg.enabled) return [['resting', false]];

    const out = [];
    const shot = data.enhance || {};

    const motion = [];
    if (data.fps) {
      motion.push(shot.smoothing && shot.shown
        ? `${shot.source || data.fps} → ${shot.shown} fps`
        : `${data.fps} fps`);
    }
    if (data.refresh) motion.push(`${data.refresh} Hz`);
    if (motion.length) out.push([motion.join(' · '), false]);

    const stream = [];
    if (data.videoBitrate) stream.push(rate(data.videoBitrate));
    if (data.videoCodec) stream.push(String(data.videoCodec).split('.')[0]);
    if (data.audioLabel) stream.push(data.audioLabel);
    if (stream.length) out.push([stream.join(' · '), false]);

    if (cfg.mode === 'off') {
      out.push([cfg.compare ? 'no filter · nothing to split' : 'no filter', false]);
    } else if (shot.active) {
      const chain = [];
      if (shot.factor >= 1.05) chain.push(`${shot.factor}×`);
      else if (shot.shrinking) chain.push(`${shot.factor}× down`);
      for (const stage of shot.stages || []) {
        chain.push(stage === 'smooth' ? `smooth ${cfg.smooth}` : stage);
      }
      if (cfg.compare) chain.push('split');
      if (shot.cost) chain.push(`${shot.cost.toFixed(1)} ms`);
      out.push([chain.join(' · '), false]);
    } else if (shot.reason) {
      const why = standDown[shot.reason] || shot.reason;
      out.push([cfg.compare ? `${why} · nothing to split` : why, shot.reason !== 'waiting']);
    }

    if (data.frames && data.dropped) {
      const share = data.dropped / data.frames;
      if (share > 0.001) out.push([`${data.dropped} dropped`, share > 0.01]);
    }
    return out;
  };

  let badge = null;
  let beat = 0;

  const stage = () => document.fullscreenElement || document.body;

  const paint = () => {
    if (!badge) return;
    const parent = stage();
    if (parent && badge.host.parentElement !== parent) parent.appendChild(badge.host);

    const data = snapshot();
    badge.dot.className = cfg.enabled ? 'dot' : 'dot rest';
    badge.lead.textContent = data.height ? `${data.height}p` : 'no video';
    badge.chip.textContent = cfg.enabled && data.playing && data.tier ? data.tier : '';
    badge.chip.className = data.tier === 'UHD' ? 'chip peak' : 'chip';

    badge.rows.replaceChildren(...lines(data).map(([text, warn]) => {
      const row = document.createElement('div');
      row.className = warn ? 'row warn' : 'row';
      row.textContent = text;
      return row;
    }));
  };

  const hide = () => {
    if (!badge) return;
    clearInterval(beat);
    beat = 0;
    badge.host.remove();
    badge = null;
  };

  const show = () => {
    if (badge) return;
    const parent = stage();
    if (!parent) return;

    const host = document.createElement('div');
    host.style.cssText = 'all:initial;display:block;position:fixed;left:0;top:0;pointer-events:none;z-index:2147483647';
    const root = host.attachShadow({ mode: 'closed' });
    const sheet = document.createElement('style');
    sheet.textContent = skin;

    const card = document.createElement('div');
    card.className = 'card';
    const top = document.createElement('div');
    top.className = 'top';
    const dot = document.createElement('span');
    dot.className = 'dot';
    const lead = document.createElement('span');
    lead.className = 'lead';
    const chip = document.createElement('span');
    chip.className = 'chip';
    const rows = document.createElement('div');
    top.append(dot, lead, chip);
    card.append(top, rows);
    root.append(sheet, card);
    parent.appendChild(host);

    badge = { host, dot, lead, chip, rows };
    paint();
    beat = setInterval(paint, 700);
  };

  const apply = () => {
    if (cfg.hud && window === window.top) show();
    else hide();
  };

  const modes = ['off', 'balanced', 'sharp', 'anime', 'custom'];

  const actions = {
    power: () => set({ enabled: !cfg.enabled }),
    hud: () => set({ hud: !cfg.hud }),
    mode: () => set({ mode: modes[(modes.indexOf(cfg.mode) + 1) % modes.length] }),
    compare: () => set({ compare: !cfg.compare })
  };

  const editing = (node) => !!node
    && (node.isContentEditable || /^(input|textarea|select)$/i.test(node.tagName || ''));

  window.addEventListener('keydown', (event) => {
    if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey || event.repeat) return;
    const entry = Object.entries(cfg.keys || {}).find(([, code]) => code === event.code);
    if (!entry) return;
    const act = actions[entry[0]];
    if (!act || editing(event.target) || editing(document.activeElement)) return;
    event.preventDefault();
    event.stopPropagation();
    act();
    paint();
  }, true);

  uncap.onSignal((name) => {
    if (name === 'hud') actions.hud();
  });

  uncap.onConfig(apply);
  apply();
})();
