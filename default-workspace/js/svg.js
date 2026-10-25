/* 制图工序 — SVG 导入与自动工序规划
   将 SVG 图元沿路径采样并展平到页面坐标，既保留视觉形状，也便于逐笔动画。 */
(function (global) {
  'use strict';

  var G = global.MD.Geom;
  var B = G.Builder;
  var NS = 'http://www.w3.org/2000/svg';
  var XLINK = 'http://www.w3.org/1999/xlink';

  var DRAWABLE = { path: 1, line: 1, polyline: 1, polygon: 1, rect: 1, circle: 1, ellipse: 1, text: 1 };

  function toDrawing(svgText, opts) {
    opts = opts || {};
    if (typeof DOMParser === 'undefined') {
      throw new Error('SVG 解析需要浏览器环境。');
    }
    var doc = new DOMParser().parseFromString(String(svgText), 'image/svg+xml');
    var err = doc.querySelector('parsererror');
    if (err) throw new Error('SVG 文件格式有误，无法解析。');
    var root = doc.documentElement;
    if (!root || root.tagName.toLowerCase() !== 'svg') throw new Error('不是有效的 SVG 文件。');

    var host = document.createElementNS(NS, 'svg');
    host.setAttribute('width', '1200');
    host.setAttribute('height', '800');
    host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1200px;height:800px;overflow:visible;pointer-events:none;opacity:0;';
    var content = document.createElementNS(NS, 'g');

    var styleNodes = root.querySelectorAll('style');
    for (var si = 0; si < styleNodes.length; si++) {
      host.appendChild(styleNodes[si].cloneNode(true));
    }

    var inherited = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'font-family', 'font-size', 'font-weight', 'font-style', 'color'];
    inherited.forEach(function (name) {
      var v = root.getAttribute(name);
      if (v != null) content.setAttribute(name, v);
    });
    var rootStyle = root.getAttribute('style');
    if (rootStyle) content.setAttribute('style', rootStyle);
    var rootTransform = root.getAttribute('transform');
    if (rootTransform) content.setAttribute('transform', rootTransform);

    var children = Array.prototype.slice.call(root.childNodes);
    children.forEach(function (n) {
      if (n.nodeType === 1 && n.tagName.toLowerCase() === 'style') return;
      content.appendChild(n.cloneNode(true));
    });
    host.appendChild(content);
    document.body.appendChild(host);

    try {
      expandUses(content, doc);
      var leaves = [];
      collectLeaves(content, leaves);
      if (!leaves.length) throw new Error('SVG 中没有找到可绘制的线条或文字。');

      var bb = svgBBox(leaves);
      if (!bb || bb.w < 0.01 || bb.h < 0.01) throw new Error('SVG 图形尺寸为空，无法生成工序。');
      var mapper = makeFit(bb);

      var specs = [];
      var unsupported = {};
      leaves.forEach(function (el) {
        try {
          var made = convertLeaf(el, mapper, unsupported);
          for (var i = 0; i < made.length; i++) specs.push(made[i]);
        } catch (e) {
          unsupported[el.tagName] = true;
        }
      });

      if (!specs.length) throw new Error('SVG 中没有可转换为工序的图元。');

      var drawing = organise(specs, {
        title: opts.title || '导入图纸',
        format: 'SVG',
        notes: Object.keys(unsupported).length ? ['部分 SVG 特性（如图片、滤镜）未参与逐笔演示。'] : []
      });
      drawing.layers = collectLayers(leaves);
      return drawing;
    } finally {
      if (host.parentNode) host.parentNode.removeChild(host);
    }
  }

  /* ------------------------------ 预处理 ------------------------------ */

  function expandUses(content, doc) {
    var uses = Array.prototype.slice.call(content.querySelectorAll('use'));
    uses.forEach(function (use) {
      var href = use.getAttribute('href') || use.getAttributeNS(XLINK, 'href') || '';
      if (href.charAt(0) !== '#') return;
      var id = href.slice(1);
      var ref = doc.getElementById(id);
      if (!ref) return;
      if (ref.tagName && ref.tagName.toLowerCase() === 'symbol') return;
      var g = document.createElementNS(NS, 'g');
      var x = parseFloat(use.getAttribute('x') || '0') || 0;
      var y = parseFloat(use.getAttribute('y') || '0') || 0;
      var tf = use.getAttribute('transform');
      var parts = [];
      if (x || y) parts.push('translate(' + x + ' ' + y + ')');
      if (tf) parts.push(tf);
      if (parts.length) g.setAttribute('transform', parts.join(' '));
      ['class', 'style', 'fill', 'stroke', 'stroke-width', 'opacity'].forEach(function (name) {
        var v = use.getAttribute(name);
        if (v != null) g.setAttribute(name, v);
      });
      g.appendChild(ref.cloneNode(true));
      if (use.parentNode) use.parentNode.replaceChild(g, use);
    });
  }

  function collectLeaves(root, out) {
    var nodes = root.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse,text');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!inRenderableTree(el)) continue;
      var tag = el.tagName.toLowerCase();
      if (!DRAWABLE[tag]) continue;
      if (tag === 'text' && !el.textContent.trim()) continue;
      var st = styleOf(el);
      if (!isVisible(st)) continue;
      out.push(el);
    }
  }

  function inRenderableTree(el) {
    var p = el.parentNode;
    while (p && p.nodeType === 1) {
      var tag = p.tagName.toLowerCase();
      if (tag === 'defs' || tag === 'clippath' || tag === 'mask' || tag === 'pattern' || tag === 'marker' || tag === 'symbol') return false;
      if (p === el.ownerSVGElement) break;
      p = p.parentNode;
    }
    return true;
  }

  function svgBBox(leaves) {
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    leaves.forEach(function (el) {
      try {
        var ctm = el.getCTM();
        var bb = el.getBBox();
        if (!ctm || !bb) return;
        var pts = [
          { x: bb.x, y: bb.y }, { x: bb.x + bb.width, y: bb.y },
          { x: bb.x, y: bb.y + bb.height }, { x: bb.x + bb.width, y: bb.y + bb.height }
        ];
        pts.forEach(function (p) {
          var q = apply(ctm, p.x, p.y);
          x1 = Math.min(x1, q.x); y1 = Math.min(y1, q.y);
          x2 = Math.max(x2, q.x); y2 = Math.max(y2, q.y);
        });
      } catch (e) { /* ignore */ }
    });
    if (!isFinite(x1)) return null;
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function makeFit(bb) {
    var area = { x: 64, y: 92, w: 992, h: 558 };
    var pad = Math.max(2, Math.max(bb.w, bb.h) * 0.02);
    var x0 = bb.x - pad, y0 = bb.y - pad;
    var w = bb.w + pad * 2, h = bb.h + pad * 2;
    var s = Math.min(area.w / w, area.h / h);
    var ox = area.x + (area.w - w * s) / 2;
    var oy = area.y + (area.h - h * s) / 2;
    return {
      s: s, ox: ox, oy: oy, x0: x0, y0: y0,
      pt: function (x, y) { return { x: ox + (x - x0) * s, y: oy + (y - y0) * s }; },
      matrix: function (ctm) {
        return [s * ctm.a, s * ctm.b, s * ctm.c, s * ctm.d, ox - x0 * s + s * ctm.e, oy - y0 * s + s * ctm.f];
      }
    };
  }

  function apply(m, x, y) {
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  }

  function matrixScale(m) {
    return (Math.hypot(m.a, m.b) + Math.hypot(m.c, m.d)) / 2;
  }

  function matrixString(m) {
    return 'matrix(' + [m[0], m[1], m[2], m[3], m[4], m[5]].map(function (n) {
      return Math.round(n * 10000) / 10000;
    }).join(' ') + ')';
  }

  /* ------------------------------ 图元转换 ------------------------------ */

  function styleOf(el) {
    var cs = window.getComputedStyle(el);
    return {
      display: cs.display,
      visibility: cs.visibility,
      opacity: opacityOf(cs.opacity),
      fill: cs.fill,
      fillOpacity: opacityOf(cs.fillOpacity),
      stroke: cs.stroke,
      strokeOpacity: opacityOf(cs.strokeOpacity),
      strokeWidth: parseFloat(cs.strokeWidth) || 0,
      strokeDasharray: cs.strokeDasharray,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      textAnchor: cs.textAnchor,
      color: cs.color,
      linecap: cs.strokeLinecap,
      linejoin: cs.strokeLinejoin
    };
  }

  function opacityOf(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 1;
  }

  function isWhite(c) {
    if (!c) return false;
    var s = String(c).toLowerCase().replace(/\s+/g, '');
    return s === '#fff' || s === '#ffffff' || s === 'white' || s === 'rgb(255,255,255)' || s === 'rgba(255,255,255,1)';
  }

  function isVisible(st) {
    if (st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse') return false;
    if (st.opacity <= 0.001) return false;
    return true;
  }

  function isNoColor(c) {
    return !c || c === 'none' || c === 'transparent' || /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(c);
  }

  function dashPhase(dash) {
    if (!dash || dash === 'none') return null;
    var nums = String(dash).match(/[\d.]+/g);
    if (!nums || nums.length < 2) return null;
    var arr = nums.map(parseFloat).filter(function (n) { return n > 0.01; });
    if (arr.length >= 4) return 'center';
    if (arr.length === 3) return 'center';
    if (arr.length === 2) return 'hidden';
    return null;
  }

  function labelOf(el) {
    var labels = [];
    var p = el;
    while (p && p.nodeType === 1) {
      ['inkscape:label', 'data-name', 'data-layer', 'id', 'class'].forEach(function (name) {
        var v = p.getAttribute && p.getAttribute(name);
        if (v && labels.indexOf(v) < 0) labels.push(v);
      });
      var t = p.querySelector ? p.querySelector(':scope > title') : null;
      if (t && t.textContent && labels.indexOf(t.textContent) < 0) labels.push(t.textContent);
      if (p === el.ownerSVGElement) break;
      p = p.parentNode;
    }
    return labels.join(' ').toLowerCase();
  }

  function phaseOf(el, st, tag) {
    var labels = labelOf(el);
    if (/中心|centre|center|axis|基准|点划/.test(labels)) return 'center';
    if (/虚线|hidden|不可见/.test(labels)) return 'hidden';
    if (/剖面|hatch|填充/.test(labels)) return 'hatch';
    if (/标注|尺寸|dimension|dim/.test(labels)) return 'dimension';
    if (/文字|text|note|技术|说明/.test(labels)) return 'text';
    if (/图框|border|frame|标题|title|图签/.test(labels)) return 'border';
    if (tag === 'text') return 'text';
    var dp = dashPhase(st.strokeDasharray);
    if (dp) return dp;
    if (st.strokeWidth > 0 && st.strokeWidth < 0.75) return 'thin';
    return 'visible';
  }

  function semanticWidth(phase, pageWidth) {
    if (phase === 'center') return 1.15;
    if (phase === 'hidden') return 1.35;
    if (phase === 'dimension') return 1.05;
    if (phase === 'hatch') return 0.85;
    if (phase === 'border') return 1.55;
    if (phase === 'thin') return Math.min(1.1, Math.max(0.7, pageWidth));
    return Math.min(3.2, Math.max(1.4, pageWidth));
  }

  function convertLeaf(el, mapper, unsupported) {
    var tag = el.tagName.toLowerCase();
    var st = styleOf(el);
    if (!isVisible(st)) return [];
    var phase = phaseOf(el, st, tag);
    var ctm = el.getCTM();
    if (!ctm) return [];
    var ctmScale = matrixScale(ctm);
    var out = [];

    if (tag === 'text') {
      var node = el.cloneNode(true);
      node.removeAttribute('transform');
      node.removeAttribute('clip-path');
      node.removeAttribute('mask');
      var m = mapper.matrix(ctm);
      node.setAttribute('transform', matrixString(m));
      node.setAttribute('fill', (isNoColor(st.fill) || isWhite(st.fill)) ? '#1f2937' : st.fill);
      node.setAttribute('font-family', st.fontFamily);
      node.setAttribute('font-size', st.fontSize);
      node.setAttribute('font-weight', st.fontWeight);
      node.setAttribute('font-style', st.fontStyle);
      node.setAttribute('text-anchor', st.textAnchor);
      node.style.fontFamily = st.fontFamily;
      node.style.fontSize = st.fontSize;
      node.style.fontWeight = st.fontWeight;
      node.style.fontStyle = st.fontStyle;
      node.style.textAnchor = st.textAnchor;
      node.setAttribute('opacity', String(st.opacity));
      node.style.pointerEvents = 'none';
      if (node.querySelectorAll) {
        Array.prototype.forEach.call(node.querySelectorAll('*'), function (child) {
          child.removeAttribute('transform');
          child.removeAttribute('clip-path');
          child.removeAttribute('mask');
        });
      }
      var tb = transformedBBox(el, ctm, mapper);
      out.push({
        type: 'svgtext', node: node, text: el.textContent.trim(),
        style: phase === 'dimension' ? 'dim' : 'text', layer: phase,
        phase: phase, length: 0,
        start: { x: tb.x + tb.w / 2, y: tb.y + tb.h / 2 },
        end: { x: tb.x + tb.w / 2, y: tb.y + tb.h / 2 },
        bbox: tb
      });
      return out;
    }

    var total = 0;
    try { total = el.getTotalLength(); } catch (e) { total = 0; }
    var hasStroke = !isNoColor(st.stroke) && st.strokeOpacity > 0.001 && st.strokeWidth > 0.05;
    var hasFill = !isNoColor(st.fill) && !isWhite(st.fill) && st.fillOpacity > 0.001;

    if (hasStroke && total > 0.2) {
      var sampled = sampleStroke(el, total, ctm, mapper);
      for (var i = 0; i < sampled.length; i++) {
        var d = sampled[i];
        if (d.points.length < 2) continue;
        var pageWidth = st.strokeWidth * ctmScale * mapper.s;
        var strokeStyle = phase === 'text' ? 'visible' : phase;
        out.push({
          type: 'path', d: d.d, length: d.length,
          start: d.points[0], end: d.points[d.points.length - 1],
          bbox: G.polygonBBox(d.points),
          style: strokeStyle, layer: phase,
          phase: phase,
          width: semanticWidth(phase, pageWidth),
          dash: ''
        });
      }
    }

    if (hasFill) {
      var node2 = el.cloneNode(true);
      node2.removeAttribute('transform');
      node2.removeAttribute('clip-path');
      node2.removeAttribute('mask');
      node2.setAttribute('transform', matrixString(mapper.matrix(ctm)));
      node2.setAttribute('fill', st.fill);
      node2.setAttribute('fill-opacity', String(st.fillOpacity));
      node2.setAttribute('stroke', 'none');
      node2.setAttribute('opacity', String(st.opacity));
      node2.style.pointerEvents = 'none';
      var fb = transformedBBox(el, ctm, mapper);
      out.push({
        type: 'solid', node: node2, d: null,
        style: phase === 'dimension' ? 'dim' : 'solid',
        layer: phase, phase: phase, length: 0,
        start: { x: fb.x + fb.w / 2, y: fb.y + fb.h / 2 },
        end: { x: fb.x + fb.w / 2, y: fb.y + fb.h / 2 },
        bbox: fb, fillOpacity: st.fillOpacity * st.opacity
      });
    }

    return out;
  }

  function transformedBBox(el, ctm, mapper) {
    var bb;
    try { bb = el.getBBox(); } catch (e) { bb = { x: 0, y: 0, width: 0, height: 0 }; }
    var pts = [
      { x: bb.x, y: bb.y }, { x: bb.x + bb.width, y: bb.y },
      { x: bb.x, y: bb.y + bb.height }, { x: bb.x + bb.width, y: bb.y + bb.height }
    ].map(function (p) {
      var q = apply(ctm, p.x, p.y);
      return mapper.pt(q.x, q.y);
    });
    return G.polygonBBox(pts);
  }

  function sampleStroke(el, total, ctm, mapper) {
    var steps = Math.max(8, Math.min(1800, Math.ceil(total / 1.1)));
    var pts = [];
    for (var i = 0; i <= steps; i++) {
      try {
        var p = el.getPointAtLength(total * i / steps);
        var q = apply(ctm, p.x, p.y);
        pts.push(mapper.pt(q.x, q.y));
      } catch (e) { /* ignore */ }
    }
    if (pts.length < 2) return [];
    var runs = [];
    var run = [pts[0]];
    var jumpLimit = Math.max(3, total / steps * 6);
    for (var j = 1; j < pts.length; j++) {
      var dist = Math.hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y);
      if (dist > jumpLimit) {
        if (run.length > 1) runs.push(run);
        run = [pts[j]];
      } else {
        run.push(pts[j]);
      }
    }
    if (run.length > 1) runs.push(run);

    var results = [];
    runs.forEach(function (r) {
      var closed = Math.hypot(r[0].x - r[r.length - 1].x, r[0].y - r[r.length - 1].y) < 0.6 && r.length > 3;
      var simplified = rdp(r, closed ? 0.18 : 0.16);
      if (simplified.length < 2) return;
      if (closed && Math.hypot(simplified[0].x - simplified[simplified.length - 1].x, simplified[0].y - simplified[simplified.length - 1].y) < 0.6) {
        simplified.pop();
      }
      if (simplified.length < 2) return;
      var length = 0;
      for (var k = 1; k < simplified.length; k++) {
        length += Math.hypot(simplified[k].x - simplified[k - 1].x, simplified[k].y - simplified[k - 1].y);
      }
      if (closed) length += Math.hypot(simplified[0].x - simplified[simplified.length - 1].x, simplified[0].y - simplified[simplified.length - 1].y);
      if (length < 0.1) return;
      results.push({ points: simplified, closed: closed, length: length, d: pathOf(simplified, closed) });
    });
    return results;
  }

  function pathOf(pts, closed) {
    var d = 'M ' + round(pts[0].x) + ' ' + round(pts[0].y);
    for (var i = 1; i < pts.length; i++) d += ' L ' + round(pts[i].x) + ' ' + round(pts[i].y);
    if (closed) d += ' Z';
    return d;
  }

  function round(n) { return Math.round(n * 100) / 100; }

  function rdp(points, eps) {
    if (points.length < 3) return points.slice();
    var dmax = 0, index = 0;
    var a = points[0], b = points[points.length - 1];
    for (var i = 1; i < points.length - 1; i++) {
      var d = perpDist(points[i], a, b);
      if (d > dmax) { dmax = d; index = i; }
    }
    if (dmax > eps) {
      var left = rdp(points.slice(0, index + 1), eps);
      var right = rdp(points.slice(index), eps);
      return left.slice(0, left.length - 1).concat(right);
    }
    return [a, b];
  }

  function perpDist(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var l = Math.hypot(dx, dy);
    if (l < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
    return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / l;
  }

  /* ------------------------------ 工序编排 ------------------------------ */

  function organise(specs, meta) {
    var groups = { center: [], visible: [], hidden: [], dimension: [], text: [], border: [], hatch: [], thin: [] };
    specs.forEach(function (p) {
      var key = groups[p.phase] ? p.phase : 'visible';
      groups[key].push(p);
    });

    var builder = new B({
      width: 1120, height: 720,
      title: meta.title || '导入图纸',
      subtitle: (meta.format || 'SVG') + ' · 自动工序解析',
      source: 'svg'
    });

    if (groups.center.length) {
      addStep(builder, '建立基准与中心线',
        '按图层、分组名称和线型识别中心线、轴线与基准线。',
        'center', orderByProximity(groups.center));
    }
    if (groups.visible.length) {
      var chunks = packVisible(groups.visible, 18);
      chunks.forEach(function (chunk, ci) {
        addStep(builder, chunks.length > 1 ? ('绘制轮廓与结构 ' + (ci + 1) + '/' + chunks.length) : '绘制轮廓与结构',
          '按连通关系分组，先大轮廓、后细节，笔尖沿图线连续移动。',
          'visible', chunk);
      });
    }
    if (groups.hatch.length) {
      addStep(builder, '绘制剖面线', '按原图的剖面填充线逐笔绘制。', 'hatch', orderByProximity(groups.hatch));
    }
    if (groups.hidden.length) {
      addStep(builder, '绘制不可见轮廓', '虚线表示遮挡结构，放在可见轮廓之后绘制。', 'hidden', orderByProximity(groups.hidden));
    }
    if (groups.dimension.length) {
      for (var di = 0; di < groups.dimension.length; di += 24) {
        addStep(builder, groups.dimension.length > 24 ? ('标注尺寸 ' + (Math.floor(di / 24) + 1)) : '标注尺寸',
          '尺寸线、箭头和数字按原图顺序重新绘制。', 'dimension', groups.dimension.slice(di, di + 24));
      }
    }
    if (groups.text.length) {
      for (var ti = 0; ti < groups.text.length; ti += 22) {
        addStep(builder, groups.text.length > 22 ? ('书写文字 ' + (Math.floor(ti / 22) + 1)) : '书写文字与技术说明',
          '先写视图名称，再写技术要求与标题栏文字。', 'text', groups.text.slice(ti, ti + 22));
      }
    }
    if (groups.border.length) {
      addStep(builder, '完善图框与标题栏', '最后补上图框、标题栏和表格线。', 'border', orderByProximity(groups.border));
    }

    return builder.build({ source: 'svg', format: 'SVG', notes: meta.notes || [] });
  }

  function addStep(builder, title, note, phase, specs) {
    builder.step({ title: title, note: note, phase: phase, holdIn: 0.45, holdOut: 0.22 }, function () {
      specs.forEach(function (s) { builder._add(s); });
    });
  }

  function orderByProximity(specs) {
    if (specs.length < 3) return specs.slice();
    var remaining = specs.slice();
    var out = [];
    var best = Infinity, startIdx = 0;
    for (var i = 0; i < remaining.length; i++) {
      var p = remaining[i].start || { x: 0, y: 0 };
      var d = p.x + p.y * 0.4;
      if (d < best) { best = d; startIdx = i; }
    }
    var cur = remaining.splice(startIdx, 1)[0];
    out.push(cur);
    while (remaining.length) {
      var last = cur.end || { x: 0, y: 0 };
      var bi = 0, bd = Infinity;
      for (var j = 0; j < remaining.length; j++) {
        var q = remaining[j].start || { x: 0, y: 0 };
        var dd = Math.hypot(q.x - last.x, q.y - last.y);
        if (dd < bd) { bd = dd; bi = j; }
      }
      cur = remaining.splice(bi, 1)[0];
      out.push(cur);
    }
    return out;
  }

  function connectedComponents(specs) {
    var n = specs.length;
    var parent = [];
    for (var i = 0; i < n; i++) parent[i] = i;
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }
    for (var i2 = 0; i2 < n; i2++) {
      for (var j = i2 + 1; j < n; j++) if (near(specs[i2], specs[j])) union(i2, j);
    }
    var map = {};
    for (var k = 0; k < n; k++) {
      var r = find(k);
      if (!map[r]) map[r] = [];
      map[r].push(specs[k]);
    }
    var comps = Object.keys(map).map(function (k) { return map[k]; });
    comps.sort(function (A, B) {
      var ba = groupBBox(A), bb = groupBBox(B);
      return bb.w * bb.h - ba.w * ba.h;
    });
    return comps.map(orderByProximity);
  }

  function near(a, b) {
    var pa = [a.start, a.end].filter(Boolean);
    var pb = [b.start, b.end].filter(Boolean);
    for (var i = 0; i < pa.length; i++) {
      for (var j = 0; j < pb.length; j++) {
        if (Math.hypot(pa[i].x - pb[j].x, pa[i].y - pb[j].y) < 3.2) return true;
      }
    }
    return false;
  }

  function groupBBox(specs) {
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    specs.forEach(function (s) {
      if (!s.bbox) return;
      x1 = Math.min(x1, s.bbox.x); y1 = Math.min(y1, s.bbox.y);
      x2 = Math.max(x2, s.bbox.x + s.bbox.w); y2 = Math.max(y2, s.bbox.y + s.bbox.h);
    });
    if (!isFinite(x1)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function packVisible(specs, maxCount) {
    var comps = connectedComponents(specs);
    var chunks = [], cur = [], curLen = 0, maxLen = 7200;
    comps.forEach(function (comp) {
      var compLen = comp.reduce(function (n, s) { return n + (s.length || 0); }, 0);
      if (comp.length > maxCount) {
        if (cur.length) { chunks.push(cur); cur = []; curLen = 0; }
        for (var i = 0; i < comp.length; i += maxCount) chunks.push(comp.slice(i, i + maxCount));
        return;
      }
      if (cur.length && (cur.length + comp.length > maxCount || curLen + compLen > maxLen)) {
        chunks.push(cur); cur = []; curLen = 0;
      }
      cur = cur.concat(comp);
      curLen += compLen;
    });
    if (cur.length) chunks.push(cur);
    return chunks;
  }

  function collectLayers(leaves) {
    var names = {};
    leaves.forEach(function (el) {
      var l = labelOf(el);
      if (l) names[l] = true;
    });
    return Object.keys(names).slice(0, 12);
  }

  global.MD.Svg = {
    toDrawing: toDrawing
  };
})(typeof window !== 'undefined' ? window : globalThis);
