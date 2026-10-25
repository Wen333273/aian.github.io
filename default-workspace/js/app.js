/* 制图工序 — 播放器、渲染与交互 */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };

  var PHASES = {
    center: { label: '中心线', color: '#38bdf8' },
    visible: { label: '轮廓', color: '#e2e8f0' },
    hidden: { label: '虚线', color: '#94a3b8' },
    hatch: { label: '剖面线', color: '#fbbf24' },
    dimension: { label: '尺寸', color: '#fb923c' },
    text: { label: '文字', color: '#a78bfa' },
    border: { label: '图框', color: '#64748b' },
    thin: { label: '细线', color: '#94a3b8' }
  };

  var SAMPLE_ICONS = {
    flange: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="10.5"/><circle cx="16" cy="16" r="4.2"/><circle cx="16" cy="8" r="1.6"/><circle cx="16" cy="24" r="1.6"/><circle cx="8.5" cy="12" r="1.6"/><circle cx="23.5" cy="12" r="1.6"/><circle cx="8.5" cy="20" r="1.6"/><circle cx="23.5" cy="20" r="1.6"/><path d="M16 1.5v5M16 25.5v5M1.5 16h5M25.5 16h5" stroke-dasharray="3 2"/></svg>',
    shaft: '<svg viewBox="0 0 32 32"><path d="M3 16h26" stroke-dasharray="3 2"/><path d="M5 12h5v-2h7v-3h6v2h4v6h-4v2h-6v3h-7v-2H5z"/></svg>',
    plate: '<svg viewBox="0 0 32 32"><rect x="5" y="8" width="22" height="16" rx="3"/><circle cx="10" cy="13" r="1.5"/><circle cx="22" cy="13" r="1.5"/><circle cx="10" cy="19" r="1.5"/><circle cx="22" cy="19" r="1.5"/><rect x="12" y="14.3" width="8" height="3.4" rx="1.7"/></svg>'
  };

  var state = {
    drawing: null,
    steps: [],
    total: 0,
    t: 0,
    playing: false,
    speed: 1,
    raf: 0,
    lastTs: 0,
    activeStep: -1,
    captionKey: '',
    sample: null,
    sourceLabel: '',
    sourceKind: 'sample',
    view: { x: 0, y: 0, w: 1120, h: 720 },
    maskSeq: 0,
    flat: [],
    drag: null,
    scrubWasPlaying: false,
    wasPlayingBeforeScrub: false,
    toastTimer: 0
  };

  var el = {};
  var paperDefs;
  var paperSvg;
  var stage;
  var stageShell;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    paperSvg = $('paper');
    paperDefs = paperSvg.querySelector('defs');
    stage = $('stage');
    stageShell = $('stageShell');
    [
      'app', 'sourceName', 'sourceChip', 'stepList', 'stepCount', 'sampleList', 'dropzone', 'fileInput',
      'dropOverlay', 'paperDecor', 'ghostRoot', 'drawingRoot', 'penLayer', 'defsDynamic',
      'stepCaption', 'captionIndex', 'captionTitle', 'captionNote', 'stageBadge', 'bigPlay',
      'playBtn', 'restartBtn', 'prevBtn', 'nextBtn', 'scrubber', 'timelineFill', 'timelineTicks',
      'timeNow', 'timeTotal', 'speedSelect', 'zoomLabel', 'zoomIn', 'zoomOut', 'fitBtn',
      'ghostToggle', 'gridToggle', 'modeToggle', 'fullBtn', 'statPrims', 'statLayers',
      'statDuration', 'layerLegend', 'drawingNote', 'statusText', 'toast', 'loading',
      'loadingText', 'helpBtn', 'helpDialog', 'closeHelp', 'importBtn'
    ].forEach(function (id) { el[id] = $(id); });

    buildPaperDecor();
    buildSampleCards();
    bindEvents();
    fitView(false);

    var params;
    try { params = new URLSearchParams(location.search); } catch (e) { params = null; }
    if (params && params.get('noanim') === '1') {
      document.documentElement.classList.add('no-anim');
    }
    loadSample('flange');

    // 便于演示与截图：index.html?sample=shaft&seek=0.55
    try {
      if (params && params.get('sample') && MD.Samples[params.get('sample')]) {
        loadSample(params.get('sample'));
      }
      if (params.has('seek') && isFinite(parseFloat(params.get('seek')))) {
        var frac = clamp(parseFloat(params.get('seek')), 0, 1);
        pause();
        seek(frac * state.total);
      }
      if (params.get('mode') === 'engineering') {
        el.modeToggle.classList.add('active');
        el.app.classList.add('mode-engineering');
      }
      if (params.get('ghost') === '0') {
        el.ghostToggle.classList.remove('active');
        el.ghostRoot.classList.add('off');
      }
    } catch (e) { /* optional */ }

    window.MDApp = {
      state: state,
      seek: seek,
      play: play,
      pause: pause,
      fitView: fitView,
      loadSample: loadSample,
      importText: function (text, name) {
        var fileName = name || '内嵌图纸.svg';
        var format = /<svg[\s>]/i.test(String(text).slice(0, 4000)) ? 'svg' : 'dxf';
        var title = fileName.replace(/\.[^.]+$/, '').slice(0, 60) || '导入图纸';
        var drawing = format === 'svg'
          ? MD.Svg.toDrawing(text, { title: title })
          : MD.Dxf.toDrawing(text, { title: title, format: 'DXF' });
        setActiveSample(null);
        state.sample = null;
        applyDrawing(drawing, {
          label: '导入 · ' + fileName,
          kind: 'file',
          badge: 'IMPORT / ' + format.toUpperCase(),
          status: '已解析 · ' + drawing.primitiveCount + ' 个图元 / ' + drawing.steps.length + ' 道工序'
        });
        return drawing;
      }
    };
  }

  /* ---------------------------------------------------------------- paper */
  function buildPaperDecor() {
    el.paperDecor.innerHTML = [
      '<rect class="sheet-frame" x="32" y="32" width="1056" height="656" rx="1.5"></rect>',
      '<path class="registration" d="M46 32v-9M32 46h-9M1074 32v-9M1088 46h9M46 688v9M32 674h-9M1074 688v9M1088 674h9"></path>',
      '<path class="zone-tick" d="M560 32v8M560 688v-8M32 360h8M1088 360h-8"></path>'
    ].join('');
  }

  function buildSampleCards() {
    el.sampleList.innerHTML = '';
    MD.Samples.list.forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sample-card';
      btn.dataset.sample = item.id;
      btn.innerHTML = '<span class="sample-icon">' + (SAMPLE_ICONS[item.icon] || '') + '</span>' +
        '<span class="sample-copy"><strong>' + item.name + '</strong><span>' + item.kind + ' · ' + item.steps + ' 道工序</span></span>' +
        '<span class="sample-arrow">›</span>';
      btn.addEventListener('click', function () { loadSample(item.id); });
      el.sampleList.appendChild(btn);
    });
  }

  function setActiveSample(id) {
    Array.prototype.forEach.call(el.sampleList.querySelectorAll('.sample-card'), function (b) {
      var on = b.dataset.sample === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* ---------------------------------------------------------------- loading */
  function loadSample(id) {
    var fn = MD.Samples[id];
    if (!fn) return;
    try {
      var drawing = fn();
      state.sample = id;
      setActiveSample(id);
      applyDrawing(drawing, {
        label: '示例图纸 · ' + drawing.title,
        kind: 'sample',
        badge: 'SAMPLE / ' + id.toUpperCase(),
        status: '就绪 · 示例图纸已载入'
      });
    } catch (err) {
      console.error(err);
      showToast('示例图纸加载失败：' + err.message, 'error');
    }
  }

  function applyDrawing(drawing, meta) {
    pause();
    state.drawing = drawing;
    state.steps = drawing.steps;
    state.flat = [];
    state.activeStep = -1;
    state.captionKey = '';
    state.t = 0;
    state.sourceLabel = meta.label;
    state.sourceKind = meta.kind;
    el.sourceName.textContent = meta.label;
    el.sourceChip.title = meta.label;
    el.stageBadge.textContent = meta.badge || '';
    el.statusText.textContent = meta.status || '就绪';
    el.drawingNote.textContent = drawing.notes && drawing.notes.length
      ? drawing.notes.join(' ')
      : '自动识别的工序可以随时重播。按空格开始，或点击任意工序跳转。';

    mountDrawing(drawing);
    buildTimeline();
    buildStepList();
    buildTicks();
    updateStats();
    updateLegend();
    fitView(false);
    seek(0, true);
    updatePlayButton();
    renderStepUI(true);
  }

  /* ---------------------------------------------------------------- mount */
  function clearMount() {
    if (paperDefs) {
      Array.prototype.forEach.call(paperDefs.querySelectorAll('mask.dynamic-mask'), function (m) {
        m.parentNode.removeChild(m);
      });
    }
    el.drawingRoot.innerHTML = '';
    el.ghostRoot.innerHTML = '';
    el.penLayer.innerHTML = '';
    delete el.penLayer.dataset.ready;
    state.flat = [];
    state.maskSeq = 0;
  }

  function mountDrawing(drawing) {
    clearMount();

    drawing.steps.forEach(function (step) {
      step.primitives.forEach(function (p) {
        p._el = null;
        p._mask = null;
        p._maskPath = null;
        p._baseOpacity = 1;
        p._len = p.length || 0;
        p._prog = 0;

        if (p.type === 'path') {
          mountPath(p);
        } else if (p.type === 'text') {
          mountText(p);
        } else if (p.type === 'svgtext') {
          mountSvgText(p);
        } else if (p.type === 'solid') {
          mountSolid(p);
        }

        if (p._el) state.flat.push(p);
        mountGhost(p);
      });
    });

    // 测量实际路径长度，并据此初始化遮罩
    state.flat.forEach(function (p) {
      if (p.type !== 'path' || !p._el) return;
      try { p._len = p._el.getTotalLength(); } catch (e) { p._len = p.length || 0; }
      if (p._maskPath && p._len > 0.1) {
        p._maskPath.style.strokeDasharray = p._len + ' ' + p._len;
        p._maskPath.style.strokeDashoffset = String(p._len);
        p._maskPath.style.opacity = '0';
      }
    });
  }

  function mountPath(p) {
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', p.d);
    path.setAttribute('class', 'ink-path style-' + (p.style || 'visible'));
    if (p.width) path.style.strokeWidth = p.width + 'px';
    path.style.pointerEvents = 'none';

    var maskId = 'mask-' + (++state.maskSeq);
    var mask = document.createElementNS(NS, 'mask');
    mask.setAttribute('id', maskId);
    mask.setAttribute('class', 'dynamic-mask');
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
    mask.setAttribute('x', '-300');
    mask.setAttribute('y', '-300');
    mask.setAttribute('width', '1720');
    mask.setAttribute('height', '1320');

    var maskPath = document.createElementNS(NS, 'path');
    maskPath.setAttribute('d', p.d);
    maskPath.setAttribute('fill', 'none');
    maskPath.setAttribute('stroke', '#fff');
    maskPath.setAttribute('stroke-width', String(Math.max(18, (p.width || 2) * 9)));
    maskPath.setAttribute('stroke-linecap', 'round');
    maskPath.setAttribute('stroke-linejoin', 'round');
    maskPath.style.opacity = '0';
    mask.appendChild(maskPath);
    paperDefs.appendChild(mask);

    path.setAttribute('mask', 'url(#' + maskId + ')');
    el.drawingRoot.appendChild(path);

    p._el = path;
    p._mask = mask;
    p._maskPath = maskPath;
  }

  function mountText(p) {
    var text = document.createElementNS(NS, 'text');
    text.setAttribute('x', p.x);
    text.setAttribute('y', p.y);
    text.setAttribute('font-size', p.size || 14);
    text.setAttribute('font-weight', p.weight || 400);
    if (p.family) text.setAttribute('font-family', p.family);
    text.setAttribute('text-anchor', p.anchor || 'start');
    if (p.baseline === 'middle') text.setAttribute('dominant-baseline', 'middle');
    else if (p.baseline === 'hanging') text.setAttribute('dominant-baseline', 'hanging');
    if (p.rotate) text.setAttribute('transform', 'rotate(' + p.rotate + ' ' + p.x + ' ' + p.y + ')');
    text.setAttribute('class', 'ink-text style-' + (p.style || 'text') + (p.style === 'dim' ? ' dim-halo' : ''));
    text.textContent = p.text;
    text.style.opacity = '0';
    el.drawingRoot.appendChild(text);
    p._el = text;
    p._baseOpacity = 1;
  }

  function mountSvgText(p) {
    var node = p.node;
    node.classList.add('ink-text', 'style-' + (p.style || 'text'));
    if (p.style === 'dim') node.classList.add('dim-halo');
    node.setAttribute('opacity', '1');
    node.style.opacity = '0';
    node.style.pointerEvents = 'none';
    el.drawingRoot.appendChild(node);
    p._el = node;
    p._baseOpacity = 1;
  }

  function mountSolid(p) {
    if (p.node) {
      var node = p.node;
      node.classList.add('ink-fill', p.style === 'dim' ? 'style-dim' : 'style-solid');
      node.setAttribute('opacity', '1');
      node.style.opacity = '0';
      node.style.pointerEvents = 'none';
      el.drawingRoot.appendChild(node);
      p._el = node;
      p._baseOpacity = 1;
      return;
    }
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', p.d);
    path.setAttribute('class', 'ink-fill ' + (p.style === 'dim' ? 'style-dim' : 'style-solid'));
    path.style.opacity = '0';
    el.drawingRoot.appendChild(path);
    p._el = path;
    p._baseOpacity = 1;
  }

  function mountGhost(p) {
    try {
      if (p.type === 'path') {
        var gp = document.createElementNS(NS, 'path');
        gp.setAttribute('d', p.d);
        gp.setAttribute('class', 'ghost-path');
        el.ghostRoot.appendChild(gp);
      } else if (p.type === 'text') {
        var gt = document.createElementNS(NS, 'text');
        gt.setAttribute('x', p.x);
        gt.setAttribute('y', p.y);
        gt.setAttribute('font-size', p.size || 14);
        gt.setAttribute('font-weight', p.weight || 400);
        gt.setAttribute('text-anchor', p.anchor || 'start');
        if (p.baseline === 'middle') gt.setAttribute('dominant-baseline', 'middle');
        else if (p.baseline === 'hanging') gt.setAttribute('dominant-baseline', 'hanging');
        if (p.rotate) gt.setAttribute('transform', 'rotate(' + p.rotate + ' ' + p.x + ' ' + p.y + ')');
        gt.setAttribute('class', 'ghost-text');
        gt.textContent = p.text;
        el.ghostRoot.appendChild(gt);
      } else if (p.type === 'svgtext') {
        var gn = p.node.cloneNode(true);
        stripIds(gn);
        gn.setAttribute('class', (gn.getAttribute('class') || '') + ' ghost-text');
        gn.removeAttribute('opacity');
        gn.style.opacity = '1';
        el.ghostRoot.appendChild(gn);
      } else if (p.type === 'solid') {
        if (p.node) {
          var gs = p.node.cloneNode(true);
          stripIds(gs);
          gs.setAttribute('class', (gs.getAttribute('class') || '') + ' ghost-fill');
          gs.removeAttribute('opacity');
          gs.removeAttribute('fill');
          gs.style.opacity = '1';
          el.ghostRoot.appendChild(gs);
        } else {
          var gsp = document.createElementNS(NS, 'path');
          gsp.setAttribute('d', p.d);
          gsp.setAttribute('class', 'ghost-fill');
          el.ghostRoot.appendChild(gsp);
        }
      }
    } catch (e) { /* ghost is optional */ }
  }

  function stripIds(node) {
    if (node.removeAttribute) {
      node.removeAttribute('id');
      node.removeAttribute('clip-path');
      node.removeAttribute('mask');
    }
    if (node.querySelectorAll) {
      Array.prototype.forEach.call(node.querySelectorAll('[id]'), function (n) { n.removeAttribute('id'); });
    }
  }

  /* ---------------------------------------------------------------- timeline */
  function primitiveDuration(p) {
    if (p.type === 'text' || p.type === 'svgtext') return 0.2 + Math.min(0.22, (p.text || '').length * 0.006);
    if (p.type === 'solid') return 0.18;
    var len = p._len || p.length || 0;
    if (p.phase === 'hatch') return 0.09;
    if (p.phase === 'center') return clamp(len / 430, 0.1, 0.55);
    if (p.phase === 'dimension') return clamp(len / 340, 0.1, 0.75);
    if (p.phase === 'hidden') return clamp(len / 360, 0.1, 0.8);
    if (p.phase === 'border') return clamp(len / 380, 0.09, 0.7);
    return clamp(len / 300, 0.09, 1.45);
  }

  function buildTimeline() {
    var acc = 0;
    state.steps.forEach(function (step) {
      step.start = acc;
      var holdIn = typeof step.holdIn === 'number' ? step.holdIn : 0.45;
      var holdOut = typeof step.holdOut === 'number' ? step.holdOut : 0.25;
      step.contentStart = acc + holdIn;
      acc = step.contentStart;
      step.primitives.forEach(function (p) {
        p.start = acc;
        p.dur = primitiveDuration(p);
        if (!isFinite(p.dur) || p.dur < 0.05) p.dur = 0.12;
        p.end = acc + p.dur;
        acc = p.end;
        p._prog = 0;
      });
      step.contentEnd = acc;
      step.end = acc + holdOut;
      acc = step.end;
      step.duration = step.end - step.start;
    });
    state.total = Math.max(0.1, isFinite(acc) ? acc : 0.1);
  }

  function buildStepList() {
    el.stepList.innerHTML = '';
    state.steps.forEach(function (step, i) {
      var phase = PHASES[step.phase] || PHASES.visible;
      var li = document.createElement('li');
      li.className = 'step-item';
      li.dataset.index = i;
      li.style.setProperty('--step-color', phase.color);
      li.innerHTML =
        '<span class="step-num">' + pad2(i + 1) + '</span>' +
        '<div class="step-title"></div>' +
        '<p class="step-note"></p>' +
        '<div class="step-meta"><span class="phase-dot"></span><span>' + phase.label + '</span><span>·</span><span>' + step.primitives.length + ' 笔</span></div>' +
        '<div class="step-progress"><i></i></div>';
      li.querySelector('.step-title').textContent = step.title;
      li.querySelector('.step-note').textContent = step.note || '';
      li.addEventListener('click', function () {
        seek(step.start + 0.01, true);
        play();
      });
      el.stepList.appendChild(li);
    });
    el.stepCount.textContent = state.steps.length + ' 步';
  }

  function buildTicks() {
    el.timelineTicks.innerHTML = '';
    state.steps.forEach(function (step, i) {
      var tick = document.createElement('span');
      tick.className = 'timeline-tick';
      tick.style.left = (step.start / state.total * 100) + '%';
      tick.title = step.title;
      tick.dataset.index = i;
      el.timelineTicks.appendChild(tick);
    });
    el.timeTotal.textContent = formatTime(state.total);
    el.statDuration.textContent = formatTime(state.total);
  }

  function updateStats() {
    el.statPrims.textContent = state.drawing ? state.drawing.primitiveCount : '0';
    el.statLayers.textContent = String(state.steps.length || 0);
  }

  function updateLegend() {
    var present = {};
    state.steps.forEach(function (s) { present[s.phase] = true; });
    var html = '';
    Object.keys(PHASES).forEach(function (key) {
      if (!present[key]) return;
      var ph = PHASES[key];
      html += '<span class="legend-chip" style="--c:' + ph.color + '"><i></i>' + ph.label + '</span>';
    });
    el.layerLegend.innerHTML = html || '<span class="legend-chip"><i style="--c:#2dd4bf"></i>图元</span>';
  }

  /* ---------------------------------------------------------------- playback */
  function play() {
    if (!state.drawing) return;
    if (state.t >= state.total - 0.01) state.t = 0;
    state.playing = true;
    state.lastTs = performance.now();
    el.bigPlay.classList.add('is-hidden');
    updatePlayButton();
    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(tick);
  }

  function pause() {
    state.playing = false;
    cancelAnimationFrame(state.raf);
    state.raf = 0;
    updatePlayButton();
  }

  function togglePlay() {
    if (state.playing) pause();
    else play();
  }

  function tick(ts) {
    if (!state.playing) return;
    var dt = Math.min(0.06, (ts - state.lastTs) / 1000);
    state.lastTs = ts;
    var next = state.t + dt * state.speed;
    if (next >= state.total) {
      next = state.total;
      state.playing = false;
    }
    seek(next);
    if (state.playing) {
      state.raf = requestAnimationFrame(tick);
    } else {
      state.raf = 0;
      updatePlayButton();
      renderStepUI(true);
    }
  }

  function seek(t, silent) {
    if (!state.drawing) return;
    state.t = clamp(t, 0, state.total);

    state.flat.forEach(function (p) {
      var prog = 0;
      if (state.t >= p.end) prog = 1;
      else if (state.t > p.start) prog = (state.t - p.start) / Math.max(0.0001, p.dur);
      p._prog = prog;
      applyProgress(p, prog);
    });

    var progress = state.total > 0 ? state.t / state.total : 0;
    el.ghostRoot.style.opacity = String(0.52 - 0.47 * Math.pow(progress, 0.35));
    el.timelineFill.style.width = (progress * 100) + '%';
    el.scrubber.value = String(Math.round(progress * 1000));
    el.timeNow.textContent = formatTime(state.t);

    updatePen();
    renderStepUI(false);
    el.bigPlay.classList.toggle('is-hidden', state.playing || state.t > 0.12);
    stage.classList.toggle('t-0', state.t < 0.12);
    updatePlayButton();
    if (!silent && state.t >= state.total) {
      renderStepUI(true);
    }
  }

  function applyProgress(p, prog) {
    if (p.type === 'path') {
      if (p._maskPath && p._len > 0.1) {
        p._maskPath.style.strokeDashoffset = String(p._len * (1 - prog));
        p._maskPath.style.opacity = prog > 0.0001 ? '1' : '0';
      } else if (p._el) {
        p._el.style.opacity = String(easeOut(prog));
      }
      return;
    }
    if (!p._el) return;
    var op;
    if (p.type === 'solid') op = clamp((prog - 0.45) / 0.55, 0, 1);
    else op = prog;
    p._el.style.opacity = String((p._baseOpacity == null ? 1 : p._baseOpacity) * easeOut(op));
  }

  function ensurePen() {
    var g = el.penLayer.querySelector('.pen-group');
    if (g) return g;
    el.penLayer.innerHTML =
      '<g class="pen-group">' +
      '<circle class="pen-halo" r="10"></circle>' +
      '<path class="pen-cross" d="M-15 0H15M0 -15V15"></path>' +
      '<circle class="pen-dot" r="3.4"></circle>' +
      '</g>';
    return el.penLayer.querySelector('.pen-group');
  }

  function updatePen() {
    var g = ensurePen();
    if (state.t < 0.08 || state.t >= state.total - 0.01) {
      g.classList.remove('on');
      return;
    }
    var current = null;
    var last = null;
    for (var i = 0; i < state.flat.length; i++) {
      var p = state.flat[i];
      if (p.start <= state.t && p.end >= state.t) { current = p; break; }
      if (p.end < state.t) last = p;
    }
    if (!current) current = last;
    if (!current) {
      g.classList.remove('on');
      return;
    }

    var pt = null;
    if (current.type === 'path' && current._el && current._len > 0.1) {
      try {
        var prog = clamp((state.t - current.start) / Math.max(0.0001, current.dur), 0, 1);
        pt = current._el.getPointAtLength(current._len * prog);
      } catch (e) { pt = current.start; }
    } else {
      pt = current.start || null;
    }
    if (!pt) {
      g.classList.remove('on');
      return;
    }

    g.setAttribute('transform', 'translate(' + round(pt.x) + ' ' + round(pt.y) + ')');
    g.classList.add('on');
  }

  function updatePlayButton() {
    el.playBtn.classList.toggle('playing', state.playing);
    el.playBtn.classList.toggle('complete', !state.playing && state.t >= state.total - 0.01);
    el.playBtn.setAttribute('aria-label', state.playing ? '暂停' : (state.t >= state.total - 0.01 ? '重播' : '播放'));
  }

  function renderStepUI(force) {
    if (!state.steps.length) return;
    var idx = 0;
    for (var i = 0; i < state.steps.length; i++) {
      if (state.t >= state.steps[i].start) idx = i;
    }
    var changed = force || idx !== state.activeStep;
    state.activeStep = idx;
    var step = state.steps[idx];
    var items = el.stepList.children;

    for (var j = 0; j < items.length; j++) {
      var li = items[j];
      var s = state.steps[j];
      var prog = s.duration > 0 ? clamp((state.t - s.start) / s.duration, 0, 1) : 0;
      li.classList.toggle('active', j === idx);
      li.classList.toggle('done', state.t >= s.end - 0.01);
      li.style.setProperty('--p', String(prog));
    }

    var ticks = el.timelineTicks.children;
    for (var k = 0; k < ticks.length; k++) ticks[k].classList.toggle('active', k === idx);

    if (state.t >= state.total - 0.01) {
      if (state.captionKey !== 'end') {
        el.captionIndex.textContent = 'END';
        el.captionTitle.textContent = '绘制完成';
        el.captionNote.textContent = '全部工序已完成。按 R 重播，或导入你自己的图纸。';
        state.captionKey = 'end';
      }
    } else if (state.t < 0.12) {
      if (state.captionKey !== 'ready') {
        el.captionIndex.textContent = '00';
        el.captionTitle.textContent = '准备开始';
        el.captionNote.textContent = '一张完整的图纸，正在等待被重新画出来。';
        state.captionKey = 'ready';
      }
    } else {
      var capKey = 'step-' + idx;
      if (changed || state.captionKey !== capKey) {
        el.captionIndex.textContent = pad2(idx + 1);
        el.captionTitle.textContent = step.title;
        el.captionNote.textContent = step.note || '';
        state.captionKey = capKey;
      }
    }

    if (changed) {
      var active = items[idx];
      if (active && el.stepList.scrollHeight > el.stepList.clientHeight) {
        var listRect = el.stepList.getBoundingClientRect();
        var activeRect = active.getBoundingClientRect();
        var top = el.stepList.scrollTop + (activeRect.top - listRect.top) -
          el.stepList.clientHeight / 2 + activeRect.height / 2;
        el.stepList.scrollTop = clamp(top, 0, Math.max(0, el.stepList.scrollHeight - el.stepList.clientHeight));
      }
    }
  }

  /* ---------------------------------------------------------------- step nav */
  function gotoStep(delta) {
    if (!state.steps.length) return;
    pause();
    var idx = state.activeStep;
    if (delta < 0) {
      if (state.t > state.steps[idx].start + 0.35) {
        seek(state.steps[idx].start + 0.01);
      } else {
        seek(state.steps[Math.max(0, idx - 1)].start + 0.01);
      }
    } else {
      if (idx >= state.steps.length - 1) seek(state.total);
      else seek(state.steps[idx + 1].start + 0.01);
    }
  }

  function restart() {
    seek(0);
    play();
  }

  /* ---------------------------------------------------------------- view */
  function fitView(animate) {
    state.view = { x: 0, y: 0, w: 1120, h: 720 };
    applyView(animate);
  }

  function applyView() {
    paperSvg.setAttribute('viewBox', state.view.x + ' ' + state.view.y + ' ' + state.view.w + ' ' + state.view.h);
    el.zoomLabel.textContent = Math.round(1120 / state.view.w * 100) + '%';
  }

  function clientToSvg(clientX, clientY) {
    var pt = paperSvg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    var m = paperSvg.getScreenCTM();
    if (!m) return { x: state.view.x + state.view.w / 2, y: state.view.y + state.view.h / 2 };
    return pt.matrixTransform(m.inverse());
  }

  function zoomAt(factor, clientX, clientY) {
    var p = clientToSvg(clientX, clientY);
    var v = state.view;
    var nw = clamp(v.w * factor, 430, 1900);
    var nh = nw * 720 / 1120;
    var scale = nw / v.w;
    var nx = p.x - (p.x - v.x) * scale;
    var ny = p.y - (p.y - v.y) * scale;
    state.view = {
      x: clamp(nx, -420, 1120 + 420 - nw),
      y: clamp(ny, -300, 720 + 300 - nh),
      w: nw, h: nh
    };
    applyView();
  }

  /* ---------------------------------------------------------------- import */
  async function handleFile(file) {
    if (!file) return;
    var name = file.name || '图纸';
    var ext = (name.split('.').pop() || '').toLowerCase();
    if (['dxf', 'svg', 'txt'].indexOf(ext) < 0) {
      showToast('暂不支持 .' + ext + ' 文件，请选择 DXF 或 SVG。', 'error');
      return;
    }
    if (file.size > 24 * 1024 * 1024) {
      showToast('文件超过 24 MB，浏览器解析可能失败。', 'error');
      return;
    }
    showLoading(ext === 'svg' ? '读取 SVG 图元与分组…' : '读取 DXF 实体与图层…');
    try {
      var buf = await file.arrayBuffer();
      var text = decodeBuffer(buf);
      if (!text || !text.trim()) throw new Error('文件内容为空。');
      await nextFrame();
      var format = ext === 'svg' || /<svg[\s>]/i.test(text.slice(0, 3000)) ? 'svg' : 'dxf';
      var title = name.replace(/\.[^.]+$/, '').slice(0, 60) || '导入图纸';
      var drawing;
      if (format === 'svg') {
        drawing = MD.Svg.toDrawing(text, { title: title });
      } else {
        drawing = MD.Dxf.toDrawing(text, { title: title, format: 'DXF' });
      }
      setActiveSample(null);
      state.sample = null;
      applyDrawing(drawing, {
        label: '导入 · ' + name,
        kind: 'file',
        badge: 'IMPORT / ' + format.toUpperCase(),
        status: '已解析 · ' + drawing.primitiveCount + ' 个图元 / ' + drawing.steps.length + ' 道工序'
      });
      showToast('已解析「' + title + '」：' + drawing.steps.length + ' 道工序，' + drawing.primitiveCount + ' 个图元。', 'success');
    } catch (err) {
      console.error(err);
      showToast('导入失败：' + (err && err.message ? err.message : '未知错误'), 'error');
    } finally {
      hideLoading();
      el.fileInput.value = '';
    }
  }

  function decodeBuffer(buf) {
    var text = '';
    try { text = new TextDecoder('utf-8', { fatal: false }).decode(buf); } catch (e) { text = ''; }
    if (text.indexOf('\uFFFD') >= 0) {
      try {
        var alt = new TextDecoder('gb18030', { fatal: false }).decode(buf);
        if (alt && alt.indexOf('\uFFFD') < (text.indexOf('\uFFFD'))) text = alt;
      } catch (e2) { /* keep utf-8 */ }
    }
    return text.replace(/^\uFEFF/, '');
  }

  function nextFrame() {
    return new Promise(function (resolve) { setTimeout(resolve, 40); });
  }

  /* ---------------------------------------------------------------- UI helpers */
  function showLoading(text) {
    el.loadingText.textContent = text || '识别图元、图层与标注…';
    el.loading.hidden = false;
  }
  function hideLoading() { el.loading.hidden = true; }

  function showToast(msg, type) {
    clearTimeout(state.toastTimer);
    el.toast.textContent = msg;
    el.toast.className = 'toast show' + (type ? ' ' + type : '');
    state.toastTimer = setTimeout(function () {
      el.toast.className = 'toast';
    }, type === 'error' ? 5200 : 3600);
  }

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.round(sec);
    return pad2(Math.floor(sec / 60)) + ':' + pad2(sec % 60);
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function round(n) { return Math.round(n * 10) / 10; }

  /* ---------------------------------------------------------------- events */
  function bindEvents() {
    el.importBtn.addEventListener('click', function () { el.fileInput.click(); });
    el.dropzone.addEventListener('click', function () { el.fileInput.click(); });
    el.dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); }
    });
    el.fileInput.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) handleFile(f);
    });

    el.playBtn.addEventListener('click', togglePlay);
    el.bigPlay.addEventListener('click', play);
    el.restartBtn.addEventListener('click', restart);
    el.prevBtn.addEventListener('click', function () { gotoStep(-1); });
    el.nextBtn.addEventListener('click', function () { gotoStep(1); });

    el.scrubber.addEventListener('pointerdown', function () {
      state.wasPlayingBeforeScrub = state.playing;
      pause();
    });
    el.scrubber.addEventListener('input', function () {
      seek(Number(el.scrubber.value) / 1000 * state.total, true);
    });
    el.scrubber.addEventListener('change', function () {
      if (state.wasPlayingBeforeScrub && state.t < state.total - 0.01) play();
      state.wasPlayingBeforeScrub = false;
    });
    el.scrubber.addEventListener('pointerup', function () {
      if (state.wasPlayingBeforeScrub && state.t < state.total - 0.01) play();
      state.wasPlayingBeforeScrub = false;
    });

    el.speedSelect.addEventListener('change', function () {
      state.speed = parseFloat(el.speedSelect.value) || 1;
    });

    el.zoomIn.addEventListener('click', function () {
      var r = stage.getBoundingClientRect();
      zoomAt(0.78, r.left + r.width / 2, r.top + r.height / 2);
    });
    el.zoomOut.addEventListener('click', function () {
      var r = stage.getBoundingClientRect();
      zoomAt(1.28, r.left + r.width / 2, r.top + r.height / 2);
    });
    el.fitBtn.addEventListener('click', function () { fitView(true); });
    el.ghostToggle.addEventListener('click', function () {
      var on = el.ghostToggle.classList.toggle('active');
      el.ghostRoot.classList.toggle('off', !on);
    });
    el.gridToggle.addEventListener('click', function () {
      var on = el.gridToggle.classList.toggle('active');
      stage.classList.toggle('grid-off', !on);
    });
    el.modeToggle.addEventListener('click', function () {
      var on = el.modeToggle.classList.toggle('active');
      el.app.classList.toggle('mode-engineering', on);
    });
    el.fullBtn.addEventListener('click', function () {
      if (!document.fullscreenElement) {
        if (stageShell.requestFullscreen) stageShell.requestFullscreen().catch(function () {});
      } else {
        document.exitFullscreen();
      }
    });

    el.helpBtn.addEventListener('click', openHelp);
    el.closeHelp.addEventListener('click', function () { el.helpDialog.close(); });
    el.helpDialog.addEventListener('click', function (e) {
      if (e.target === el.helpDialog) el.helpDialog.close();
    });

    // 拖拽导入
    var dragDepth = 0;
    window.addEventListener('dragenter', function (e) {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
      e.preventDefault();
      dragDepth++;
      el.dropOverlay.classList.add('is-active');
    });
    window.addEventListener('dragover', function (e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    window.addEventListener('dragleave', function (e) {
      if (e.relatedTarget === null) {
        dragDepth = 0;
        el.dropOverlay.classList.remove('is-active');
        return;
      }
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) el.dropOverlay.classList.remove('is-active');
    });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      dragDepth = 0;
      el.dropOverlay.classList.remove('is-active');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });

    // 画布缩放与平移
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var factor = Math.exp(clamp(e.deltaY, -120, 120) * 0.0016);
      zoomAt(factor, e.clientX, e.clientY);
    }, { passive: false });

    stage.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest('button, input, select, .step-caption, .drop-overlay')) return;
      state.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: state.view.x, vy: state.view.y };
      stage.classList.add('is-panning');
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    });
    stage.addEventListener('pointermove', function (e) {
      if (!state.drag || e.pointerId !== state.drag.id) return;
      var rect = paperSvg.getBoundingClientRect();
      var scale = state.view.w / Math.max(1, rect.width);
      state.view.x = state.drag.vx - (e.clientX - state.drag.x) * scale;
      state.view.y = state.drag.vy - (e.clientY - state.drag.y) * scale;
      state.view.x = clamp(state.view.x, -420, 1120 + 420 - state.view.w);
      state.view.y = clamp(state.view.y, -300, 720 + 300 - state.view.h);
      applyView();
    });
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('dblclick', function (e) {
      if (e.target.closest && e.target.closest('button, input, select')) return;
      fitView(true);
    });

    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', function () { /* viewBox 自适应 */ });
  }

  function endDrag() {
    if (!state.drag) return;
    state.drag = null;
    stage.classList.remove('is-panning');
  }

  function onKeyDown(e) {
    if (el.helpDialog.open) {
      if (e.key === 'Escape') el.helpDialog.close();
      return;
    }
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if ((e.key === ' ' || e.code === 'Space') && (tag === 'button' || tag === 'a')) return;
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      gotoStep(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      gotoStep(1);
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      restart();
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      fitView(true);
    } else if (e.key === 'g' || e.key === 'G') {
      e.preventDefault();
      el.gridToggle.click();
    } else if (e.key === 'Home') {
      e.preventDefault();
      pause();
      seek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      pause();
      seek(state.total);
    }
  }

  function openHelp() {
    if (typeof el.helpDialog.showModal === 'function') {
      if (!el.helpDialog.open) el.helpDialog.showModal();
    } else {
      el.helpDialog.setAttribute('open', '');
    }
  }

  // 防止浏览器打开被拖入的文件
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });
})();
