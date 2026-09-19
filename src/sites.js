(() => {
  'use strict';
  const uncap = window.__uncap;
  if (!uncap || window.__uncapSites) return;
  window.__uncapSites = true;

  const { cfg, on, state, familyOf, log } = uncap;
  const drm = window.__uncapDrm;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const netflix = () => {
    uncap.identify('netflix');

    const site = { added: [], peak: null, titleId: null };

    const levelled = /^(.+)-L(\d{2})(-.+)$/;
    const h264Profile = /^(.*h264)(?:mpl|hpl)(\d{2})(-.+)$/;
    const audioProfile = /^(heaac|xheaac|ddplus|aac)/;
    const targetLevels = [40, 41, 50, 51];
    const targetH264 = ['hpl40', 'mpl40'];

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

      if (on('codecs')) {
        for (const profile of [...request.profiles]) {
          const tiered = levelled.exec(profile);
          if (tiered && familyDecodes(profile)) {
            const [, head, level, tail] = tiered;
            const current = parseInt(level, 10);
            for (const target of targetLevels) if (target > current) add(`${head}-L${target}${tail}`);
            continue;
          }
          const legacy = h264Profile.exec(profile);
          if (legacy) {
            const [, head, level, tail] = legacy;
            if (parseInt(level, 10) < 40) for (const target of targetH264) add(`${head}${target}${tail}`);
          }
        }
      }

      if (on('audio') && request.profiles.some((profile) => audioProfile.test(profile))) {
        if (state.codecs.heaac) {
          add('heaac-2hq-dash');
          add('heaac-5.1-dash');
        }
        const isPlayReady = request.drmType === 'playready' || drm?.isPlayReady(drm.keySystem);
        if (state.codecs.eac3 && isPlayReady) {
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
        site.added = added;
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

    const stringify = JSON.stringify;
    JSON.stringify = function (value, replacer, space) {
      if (cfg.enabled && cfg.stream && value && typeof value === 'object') {
        try { patch(value); } catch { }
      }
      return stringify.call(this, value, replacer, space);
    };

    const mslLimit = 1 << 19;
    const brace = 123;

    const encode = TextEncoder.prototype.encode;
    TextEncoder.prototype.encode = function (input) {
      if (cfg.enabled
        && cfg.stream
        && typeof input === 'string'
        && input.length > 200
        && input.length < mslLimit
        && input.charCodeAt(0) === brace) {
        try {
          if (input.includes('"profiles"')) {
            const payload = JSON.parse(input);
            if (patch(payload)) input = stringify.call(JSON, payload);
          } else if (input.includes('"data"') && (input.includes('"messageid"') || input.includes('"sequencenumber"'))) {
            const envelope = JSON.parse(input);
            if (typeof envelope?.data === 'string' && envelope.data.length < mslLimit) {
              const inner = atob(envelope.data);
              if (inner.charCodeAt(0) === brace && inner.includes('"profiles"')) {
                const payload = JSON.parse(inner);
                if (patch(payload)) {
                  envelope.data = btoa(stringify.call(JSON, payload));
                  input = stringify.call(JSON, envelope);
                }
              }
            }
          }
        } catch { }
      }
      return encode.call(this, input);
    };

    const panelKey = {
      key: 'B', code: 'KeyB', keyCode: 66, which: 66,
      ctrlKey: true, altKey: true, shiftKey: true, bubbles: true
    };

    const togglePanel = () => {
      for (const target of [document, window]) {
        try { target.dispatchEvent(new KeyboardEvent('keydown', panelKey)); } catch { }
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
        const found = /(\d[\d.]*)/.exec(option.textContent.replace(/[,\s]/g, ''));
        return found ? parseFloat(found[1]) : -1;
      };
      const best = options.reduce((winner, option) => (score(option) > score(winner) ? option : winner), options[0]);
      const target = score(best) < 0 ? options[options.length - 1] : best;
      if (select.value === target.value) return;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, target.value);
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };

    let pinnedFor = null;
    let tries = 0;
    let busy = false;

    const forcePeak = async () => {
      if (!on('peak') || busy || !state.playing || !site.titleId) return;
      if (pinnedFor === site.titleId || tries > 2) return;

      busy = true;
      let panel = null;
      let visibility = '';
      try {
        togglePanel();
        let videoSelect = null;
        for (let step = 0; step < 15 && !videoSelect; step++) {
          await wait(200);
          videoSelect = selectFor('Video Bitrate');
        }
        const audioSelect = selectFor('Audio Bitrate');
        const confirm = Array.from(document.querySelectorAll('button'))
          .find((button) => button.textContent.trim().toLowerCase() === 'override');

        if (!videoSelect || !confirm) {
          tries++;
          if (tries > 2) site.peak = 'unavailable';
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

        pinnedFor = site.titleId;
        site.peak = 'pinned';
        log('video and audio pinned to the highest available stream');
      } catch {
        tries++;
      } finally {
        if (panel) panel.style.visibility = visibility;
        busy = false;
      }
    };

    const audioNames = [
      [700, 'Dolby Atmos'],
      [500, 'Dolby Digital+ 5.1 HQ'],
      [300, 'Dolby Digital+ 5.1'],
      [0, 'Dolby Digital+']
    ];

    const audioLabel = () => {
      const family = familyOf(state.audioCodec);
      const kbps = state.audioBitrate;
      if (family === 'eac3') return audioNames.find(([bound]) => kbps >= bound)[1];
      if (family === 'xheaac') return 'xHE-AAC';
      if (family === 'heaac') return kbps >= 160 ? 'HE-AAC 5.1' : 'HE-AAC';
      if (family === 'aac') return 'AAC-LC';
      return state.audioCodec || null;
    };

    uncap.tick(() => {
      const id = /\/watch\/(\d+)/.exec(location.pathname)?.[1] || null;
      if (id !== site.titleId) {
        site.titleId = id;
        uncap.reset();
        site.peak = null;
        tries = 0;
      }
      forcePeak();
    });

    uncap.feed(() => ({
      audioLabel: audioLabel(),
      added: site.added,
      peak: site.peak
    }));
  };

  const youtube = () => {
    uncap.identify('youtube');

    const rungs = ['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
    const labels = {
      highres: '4320p', hd2880: '2880p', hd2160: '2160p', hd1440: '1440p', hd1080: '1080p',
      hd720: '720p', large: '480p', medium: '360p', small: '240p', tiny: '144p'
    };
    const resolution = /(\d{3,4})p/;
    const premium = /premium|enhanced/i;

    const easeLimit = 3;
    const rough = 0.05;
    const site = {
      videoKey: null, quality: null, top: null, pinned: null, premium: false,
      tries: 0, menuTries: 0, busy: false, ease: 0, rough: 0
    };

    const playerOf = () => document.getElementById('movie_player')
      || document.querySelector('.html5-video-player');

    const levelsOf = (player) => {
      try {
        return (player.getAvailableQualityLevels?.() || []).filter((level) => rungs.includes(level));
      } catch {
        return [];
      }
    };

    const bestOf = (levels) => {
      const ladder = levels.slice().sort((a, b) => rungs.indexOf(a) - rungs.indexOf(b));
      return ladder[Math.min(site.ease, ladder.length - 1)] || null;
    };

    const steady = () => {
      if (!on('peak') || !state.playing || site.busy) return;
      if (state.dropRate > rough) site.rough++;
      else if (state.dropRate < 0.01) site.rough = Math.max(0, site.rough - 1);
      if (site.rough < 4 || site.ease >= easeLimit) return;

      site.rough = 0;
      site.ease++;
      site.tries = 0;
      site.menuTries = 0;
      site.pinned = null;
      log(`easing down a rung, the player dropped ${Math.round(state.dropRate * 100)} percent of its frames`);
    };

    const currentOf = (player) => {
      try { return player.getPlaybackQuality?.() || null; } catch { return null; }
    };

    const apply = (player, target) => {
      try { player.setPlaybackQualityRange?.(target, target); } catch { }
      try { player.setPlaybackQuality?.(target); } catch { }
    };

    const driveMenu = async () => {
      const button = document.querySelector('.ytp-settings-button');
      if (!button) return false;

      const hidden = new Map();
      const conceal = (node) => {
        if (!node || hidden.has(node)) return;
        hidden.set(node, node.style.visibility);
        node.style.visibility = 'hidden';
      };

      let taken = false;
      conceal(document.querySelector('.ytp-popup.ytp-settings-menu'));

      try {
        button.click();
        await wait(160);

        const menu = document.querySelector('.ytp-popup.ytp-settings-menu');
        conceal(menu);
        const scope = menu || document;
        const text = (node) => (node?.textContent || '').trim();

        const row = Array.from(scope.querySelectorAll('.ytp-menuitem'))
          .find((item) => resolution.test(text(item.querySelector('.ytp-menuitem-content') || item)));
        if (!row) return false;

        row.click();
        await wait(160);

        let choice = null;
        let height = 0;
        let enhanced = false;
        for (const item of scope.querySelectorAll('.ytp-menuitem')) {
          const label = text(item.querySelector('.ytp-menuitem-label') || item);
          if (!resolution.test(label) || /auto/i.test(label)) continue;
          const value = parseInt(resolution.exec(label)[1], 10);
          const better = premium.test(label);
          if (value > height || (value === height && better && !enhanced)) {
            height = value;
            enhanced = better;
            choice = item;
          }
        }
        if (!choice) return false;

        choice.click();
        taken = true;
        site.premium = enhanced;
        await wait(120);
        log(`quality menu pinned to ${height}p${enhanced ? ' premium' : ''}`);
        return true;
      } catch {
        return false;
      } finally {
        if (!taken) {
          try { button.click(); } catch { }
          await wait(160);
        }
        for (const [node, visibility] of hidden) node.style.visibility = visibility;
      }
    };

    const pin = async () => {
      if (!on('peak') || site.busy) return;
      const player = playerOf();
      if (!player || typeof player.getPlaybackQuality !== 'function') return;

      const levels = levelsOf(player);
      if (!levels.length) return;

      const best = bestOf(levels);
      site.top = levels.slice().sort((a, b) => rungs.indexOf(a) - rungs.indexOf(b))[0] || null;
      site.quality = currentOf(player);
      if (!best) return;

      if (site.quality === best) {
        site.pinned = site.ease ? 'eased' : site.pinned === 'menu' ? 'menu' : 'api';
        site.tries = 0;
        return;
      }
      if (site.tries > 3 && site.menuTries > 1) {
        site.pinned = 'refused';
        return;
      }

      site.busy = true;
      try {
        if (site.tries <= 3) {
          apply(player, best);
          site.tries++;
          await wait(250);
          site.quality = currentOf(player);
          if (site.quality === best) {
            site.pinned = 'api';
            return;
          }
        }
        site.menuTries++;
        if (await driveMenu()) {
          await wait(250);
          site.quality = currentOf(player);
          site.pinned = 'menu';
        }
      } finally {
        site.busy = false;
      }
    };

    const track = () => {
      const key = new URLSearchParams(location.search).get('v')
        || /\/(?:shorts|embed|live)\/([\w-]+)/.exec(location.pathname)?.[1]
        || null;
      if (key === site.videoKey) return;
      site.videoKey = key;
      uncap.reset();
      site.quality = null;
      site.top = null;
      site.pinned = null;
      site.premium = false;
      site.tries = 0;
      site.menuTries = 0;
      site.ease = 0;
      site.rough = 0;
    };

    window.addEventListener('yt-navigate-finish', track, true);

    uncap.tick(() => {
      track();
      steady();
      pin();
    });

    uncap.feed(() => ({
      quality: site.quality ? labels[site.quality] || site.quality : null,
      best: site.top ? labels[site.top] || site.top : null,
      pinned: site.pinned,
      premium: site.premium,
      eased: site.ease,
      audioLabel: state.audioCodec ? (familyOf(state.audioCodec) === 'opus' ? 'Opus' : 'AAC') : null
    }));
  };

  const generic = () => {
    uncap.identify('page');
    uncap.feed(() => ({
      audioLabel: state.audioCodec ? familyOf(state.audioCodec)?.toUpperCase() || null : null
    }));
  };

  const adapters = [
    [/(^|\.)netflix\.com$/, netflix],
    [/(^|\.)youtube(-nocookie)?\.com$/, youtube]
  ];

  const match = adapters.find(([pattern]) => pattern.test(location.hostname));
  (match ? match[1] : generic)();
})();
