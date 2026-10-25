/* 制图工序 — ASCII DXF 解析与自动工序规划（浏览器 / Node 均可用） */
(function (global) {
  'use strict';

  var G = global.MD.Geom;
  var B = G.Builder;

  /* ------------------------------ 基础工具 ------------------------------ */

  function readPairs(text) {
    var clean = String(text).replace(/^\uFEFF/, '');
    var lines = clean.split(/\r\n|\r|\n/);
    var pairs = [];
    for (var i = 0; i + 1 < lines.length; i += 2) {
      var code = parseInt(String(lines[i]).trim(), 10);
      if (!isFinite(code)) continue;
      pairs.push({ code: code, value: lines[i + 1] == null ? '' : lines[i + 1] });
    }
    return pairs;
  }

  function val(e, code, index) {
    var n = 0;
    for (var i = 0; i < e.pairs.length; i++) {
      if (e.pairs[i].code === code) {
        if (n === (index || 0)) return e.pairs[i].value;
        n++;
      }
    }
    return null;
  }

  function num(e, code, fallback, index) {
    var v = val(e, code, index);
    if (v == null || String(v).trim() === '') return fallback == null ? 0 : fallback;
    var n = parseFloat(v);
    return isFinite(n) ? n : (fallback == null ? 0 : fallback);
  }

  function str(e, code, index) {
    var v = val(e, code, index);
    return v == null ? '' : String(v);
  }

  function all(e, code) {
    var out = [];
    for (var i = 0; i < e.pairs.length; i++) {
      if (e.pairs[i].code === code) out.push(e.pairs[i].value);
    }
    return out;
  }

  function decodeText(s) {
    return String(s)
      .replace(/%%[cC]/g, 'φ')
      .replace(/%%[dD]/g, '°')
      .replace(/%%[pP]/g, '±')
      .replace(/%%%/g, '%')
      .replace(/\\P/gi, '\n')
      .replace(/\\[A-Za-z][^;]*;/g, '')
      .replace(/[{}]/g, '')
      .replace(/\\~/g, ' ')
      .trim();
  }

  function round(n, p) {
    var f = Math.pow(10, p == null ? 2 : p);
    return Math.round(n * f) / f;
  }

  function fmt(n) {
    return G.formatNumber(n);
  }

  /* ------------------------------ 矩阵 ------------------------------ */

  function identity() { return [1, 0, 0, 1, 0, 0]; }

  function multiply(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }

  function apply(m, x, y) {
    return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
  }

  function scaleOf(m) {
    return (Math.hypot(m[0], m[1]) + Math.hypot(m[2], m[3])) / 2;
  }

  function angleOf(m) {
    return Math.atan2(m[1], m[0]) * 180 / Math.PI;
  }

  function translate(x, y) { return [1, 0, 0, 1, x, y]; }
  function rotate(a) {
    var r = a * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [c, s, -s, c, 0, 0];
  }
  function scale(x, y) { return [x, 0, 0, y, 0, 0]; }

  /* ------------------------------ 解析 SECTION / BLOCKS ------------------------------ */

  function findSections(pairs) {
    var out = {};
    for (var i = 0; i < pairs.length - 1; i++) {
      if (pairs[i].code === 0 && pairs[i].value.trim().toUpperCase() === 'SECTION') {
        var name = pairs[i + 1].code === 2 ? pairs[i + 1].value.trim().toUpperCase() : '';
        var start = i + 2;
        var end = start;
        while (end < pairs.length && !(pairs[end].code === 0 && pairs[end].value.trim().toUpperCase() === 'ENDSEC')) end++;
        out[name] = { start: start, end: end };
        i = end;
      }
    }
    return out;
  }

  function parseRecords(pairs, start, end) {
    var records = [];
    var current = null;
    var poly = null;
    for (var i = start; i < end; i++) {
      var p = pairs[i];
      if (p.code === 0) {
        var type = p.value.trim().toUpperCase();
        if (type === 'ENDSEC' || type === 'ENDBLK' || type === 'EOF') break;
        if (type === 'VERTEX') {
          if (poly) {
            var vertex = { type: 'VERTEX', pairs: [] };
            poly.vertices.push(vertex);
            current = vertex;
          }
          continue;
        }
        if (type === 'SEQEND') {
          current = null;
          poly = null;
          continue;
        }
        if (type === 'ATTRIB') {
          current = null;
          continue;
        }
        var rec = { type: type, pairs: [], vertices: [] };
        records.push(rec);
        current = rec;
        poly = type === 'POLYLINE' ? rec : null;
      } else if (current) {
        current.pairs.push(p);
      }
    }
    return records;
  }

  function parseLayers(sections, pairs) {
    var layers = {};
    var range = sections.TABLES;
    if (!range) return layers;
    var i = range.start;
    while (i < range.end) {
      if (pairs[i].code === 0 && pairs[i].value.trim().toUpperCase() === 'LAYER') {
        var rec = { type: 'LAYER', pairs: [] };
        i++;
        while (i < range.end && pairs[i].code !== 0) {
          rec.pairs.push(pairs[i]);
          i++;
        }
        var name = str(rec, 2).trim();
        if (name) {
          layers[name] = {
            name: name,
            color: num(rec, 62, 7),
            linetype: str(rec, 6, 0).trim()
          };
        }
      } else {
        i++;
      }
    }
    return layers;
  }

  function parseBlocks(sections, pairs) {
    var blocks = {};
    var range = sections.BLOCKS;
    if (!range) return blocks;
    var i = range.start;
    while (i < range.end) {
      if (pairs[i].code === 0 && pairs[i].value.trim().toUpperCase() === 'BLOCK') {
        var header = { type: 'BLOCK', pairs: [] };
        i++;
        while (i < range.end && pairs[i].code !== 0) {
          header.pairs.push(pairs[i]);
          i++;
        }
        var name = str(header, 2).trim();
        var base = { x: num(header, 10, 0), y: num(header, 20, 0) };
        var bodyStart = i;
        var bodyEnd = bodyStart;
        while (bodyEnd < range.end) {
          if (pairs[bodyEnd].code === 0 && pairs[bodyEnd].value.trim().toUpperCase() === 'ENDBLK') break;
          bodyEnd++;
        }
        if (name) {
          blocks[name] = {
            name: name,
            base: base,
            entities: parseRecords(pairs, bodyStart, bodyEnd)
          };
        }
        i = bodyEnd + 1;
      } else {
        i++;
      }
    }
    return blocks;
  }

  /* ------------------------------ 图层语义 ------------------------------ */

  function classify(layer, linetype, type) {
    var t = String(type || '').toUpperCase();
    var s = (String(layer || '') + ' ' + String(linetype || '')).toUpperCase();
    if (t === 'DIMENSION') return 'dimension';
    if (/CENTER|CENTRE|AXIS|中心|基准|点划/.test(s)) return 'center';
    if (/HIDDEN|DASH|虚线|不可见/.test(s)) return 'hidden';
    if (/HATCH|剖面|填充|SECTION/.test(s)) return 'hatch';
    if (/DIM|标注|尺寸/.test(s)) return 'dimension';
    if (t === 'TEXT' || t === 'MTEXT' || t === 'ATTDEF') {
      return /BORDER|图框|TITLE|标题/.test(s) ? 'border' : 'text';
    }
    if (/TEXT|文字|技术|NOTE/.test(s)) return 'text';
    if (/BORDER|图框|TITLE|标题/.test(s)) return 'border';
    if (/THIN|细实线|细线/.test(s)) return 'thin';
    return 'visible';
  }

  /* ------------------------------ 几何辅助 ------------------------------ */

  function sampleArc(cx, cy, r, a0, a1) {
    var delta = ((a1 - a0) % 360 + 360) % 360;
    if (delta < 0.01) delta = 360;
    var steps = Math.max(8, Math.ceil(delta / 3));
    var pts = [];
    for (var i = 0; i <= steps; i++) {
      var a = (a0 + delta * i / steps) * Math.PI / 180;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function bulgePoints(p1, p2, bulge) {
    if (!bulge || Math.abs(bulge) < 1e-6) return [p1, p2];
    var theta = 4 * Math.atan(bulge);
    var c = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (c < 1e-6) return [p1, p2];
    var h = (c / 2) / Math.tan(theta / 2);
    var mx = (p1.x + p2.x) / 2;
    var my = (p1.y + p2.y) / 2;
    var ux = (p2.x - p1.x) / c;
    var uy = (p2.y - p1.y) / c;
    var cx = mx - uy * h;
    var cy = my + ux * h;
    var a0 = Math.atan2(p1.y - cy, p1.x - cx);
    var steps = Math.max(6, Math.ceil(Math.abs(theta) / (Math.PI / 18)));
    var out = [];
    for (var i = 0; i <= steps; i++) {
      var a = a0 + theta * i / steps;
      out.push({ x: cx + Math.cos(a) * Math.hypot(p1.x - cx, p1.y - cy), y: cy + Math.sin(a) * Math.hypot(p1.x - cx, p1.y - cy) });
    }
    return out;
  }

  function polylinePoints(verts, closed) {
    var out = [];
    if (!verts.length) return out;
    var n = verts.length;
    var count = closed ? n : n - 1;
    for (var i = 0; i < count; i++) {
      var a = verts[i];
      var b = verts[(i + 1) % n];
      var seg = a.bulge ? bulgePoints(a, b, a.bulge) : [a, b];
      for (var j = 0; j < seg.length; j++) {
        if (out.length && Math.hypot(seg[j].x - out[out.length - 1].x, seg[j].y - out[out.length - 1].y) < 1e-7) continue;
        out.push(seg[j]);
      }
    }
    return out;
  }

  function chaikin(points, iterations) {
    var pts = points;
    for (var it = 0; it < iterations; it++) {
      if (pts.length < 3) return pts;
      var next = [];
      for (var i = 0; i < pts.length - 1; i++) {
        var a = pts[i], b = pts[i + 1];
        next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
        next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
      }
      pts = next;
    }
    return pts;
  }

  /* ------------------------------ 实体转换 ------------------------------ */

  function makeLayerResolver(layers) {
    return function (name) {
      return layers[name] || { name: name || '0', color: 7, linetype: '' };
    };
  }

  function makeRaw(kind, opts) {
    opts.kind = kind;
    return opts;
  }

  function convertEntities(entities, opts) {
    var layers = opts.layers || {};
    var blocks = opts.blocks || {};
    var getLayer = makeLayerResolver(layers);
    var out = [];
    var unsupported = {};
    var depth = opts.depth || 0;
    var rootMatrix = opts.matrix || identity();

    function convert(e, matrix, inheritedLayer) {
      var type = e.type;
      var layerName = str(e, 8, 0).trim() || inheritedLayer || '0';
      var li = getLayer(layerName);
      var linetype = str(e, 6, 0).trim() || li.linetype || '';
      var phase = classify(layerName, linetype, type);
      var m = matrix || identity();
      var sc = scaleOf(m);
      var ang = angleOf(m);

      function pt(x, y) { return apply(m, x, y); }

      if (type === 'LINE') {
        var a = pt(num(e, 10), num(e, 20));
        var b = pt(num(e, 11), num(e, 21));
        out.push(makeRaw('line', { a: a, b: b, phase: phase, layer: layerName }));
        return;
      }
      if (type === 'CIRCLE') {
        var c = pt(num(e, 10), num(e, 20));
        out.push(makeRaw('circle', { c: c, r: num(e, 40) * sc, phase: phase, layer: layerName }));
        return;
      }
      if (type === 'ARC') {
        var ac = pt(num(e, 10), num(e, 20));
        out.push(makeRaw('arc', {
          c: ac, r: num(e, 40) * sc,
          a0: num(e, 50) + ang, a1: num(e, 51) + ang,
          phase: phase, layer: layerName
        }));
        return;
      }
      if (type === 'LWPOLYLINE') {
        var verts = [];
        var cur = null;
        for (var i = 0; i < e.pairs.length; i++) {
          var p = e.pairs[i];
          if (p.code === 10) {
            cur = { x: parseFloat(p.value) || 0, y: 0, bulge: 0 };
            verts.push(cur);
          } else if (p.code === 20 && cur) {
            cur.y = parseFloat(p.value) || 0;
          } else if (p.code === 42 && cur) {
            cur.bulge = parseFloat(p.value) || 0;
          }
        }
        var closed = (num(e, 70) & 1) === 1;
        var mapped = verts.map(function (v) { return pt(v.x, v.y); });
        for (var vi = 0; vi < mapped.length; vi++) mapped[vi].bulge = verts[vi].bulge;
        var pts = polylinePoints(mapped, closed);
        if (pts.length > 1) out.push(makeRaw('poly', { points: pts, closed: closed, phase: phase, layer: layerName }));
        return;
      }
      if (type === 'POLYLINE') {
        var pv = [];
        for (var k = 0; k < e.vertices.length; k++) {
          var vv = e.vertices[k];
          var mp = pt(num(vv, 10), num(vv, 20));
          mp.bulge = num(vv, 42, 0);
          pv.push(mp);
        }
        var pclosed = (num(e, 70) & 1) === 1;
        var pp = polylinePoints(pv, pclosed);
        if (pp.length > 1) out.push(makeRaw('poly', { points: pp, closed: pclosed, phase: phase, layer: layerName }));
        return;
      }
      if (type === 'ELLIPSE') {
        var ec = pt(num(e, 10), num(e, 20));
        var major = pt(num(e, 11), num(e, 21));
        var mvx = major.x - ec.x, mvy = major.y - ec.y;
        var ratio = num(e, 40, 1);
        var nvx = -mvy * ratio, nvy = mvx * ratio;
        var t0 = num(e, 41, 0);
        var t1 = num(e, 42, Math.PI * 2);
        if (t1 <= t0) t1 += Math.PI * 2;
        var ep = [];
        var esteps = Math.max(24, Math.ceil((t1 - t0) / (Math.PI / 32)));
        for (var ei = 0; ei <= esteps; ei++) {
          var tt = t0 + (t1 - t0) * ei / esteps;
          ep.push({ x: ec.x + mvx * Math.cos(tt) + nvx * Math.sin(tt), y: ec.y + mvy * Math.cos(tt) + nvy * Math.sin(tt) });
        }
        out.push(makeRaw('poly', { points: ep, closed: false, phase: phase, layer: layerName }));
        return;
      }
      if (type === 'SPLINE') {
        var fit = [];
        for (var fi = 0; fi < all(e, 11).length; fi++) {
          var fy = num(e, 21, 0, fi);
          fit.push(pt(parseFloat(all(e, 11)[fi]) || 0, fy));
        }
        var ctrl = [];
        var xs = all(e, 10), ys = all(e, 20);
        for (var ci = 0; ci < xs.length; ci++) ctrl.push(pt(parseFloat(xs[ci]) || 0, parseFloat(ys[ci]) || 0));
        var sp = fit.length > 1 ? fit : ctrl;
        sp = chaikin(sp, 2);
        var closedSp = (num(e, 70) & 1) === 1;
        if (sp.length > 1) out.push(makeRaw('poly', { points: sp, closed: closedSp, phase: phase, layer: layerName }));
        return;
      }
      if (type === 'TEXT' || type === 'MTEXT' || type === 'ATTDEF') {
        var text = '';
        if (type === 'MTEXT') {
          var chunks = e.pairs.filter(function (pp) { return pp.code === 1 || pp.code === 3; }).map(function (pp) { return pp.value; });
          text = decodeText(chunks.join(''));
        } else {
          text = decodeText(str(e, 1, 0));
        }
        if (!text) return;
        var tx = num(e, 10);
        var ty = num(e, 20);
        var hAlign = num(e, 72, 0);
        var vAlign = num(e, 73, 0);
        if ((hAlign > 0 || vAlign > 0) && val(e, 11) != null) {
          tx = num(e, 11, tx);
          ty = num(e, 21, ty);
        }
        var tp = pt(tx, ty);
        var h = num(e, 40, 2.5) * sc;
        var rot = num(e, 50, 0) + ang;
        var anchor = 'start';
        var baseline = 'alphabetic';
        if (hAlign === 1 || hAlign === 4) anchor = 'middle';
        else if (hAlign === 2) anchor = 'end';
        if (vAlign === 2) baseline = 'middle';
        else if (vAlign === 3) baseline = 'hanging';
        out.push(makeRaw('text', {
          x: tp.x, y: tp.y, text: text, height: Math.max(2, h),
          rotation: rot, anchor: anchor, baseline: baseline,
          phase: phase, layer: layerName
        }));
        return;
      }
      if (type === 'DIMENSION') {
        var dp10 = pt(num(e, 10), num(e, 20));
        var dp11 = pt(num(e, 11), num(e, 21));
        var dp13 = pt(num(e, 13), num(e, 23));
        var dp14 = pt(num(e, 14), num(e, 24));
        var dp15 = pt(num(e, 15), num(e, 25));
        var dp16 = pt(num(e, 16), num(e, 26));
        out.push(makeRaw('dim', {
          dimType: (num(e, 70, 0) | 0) & 7,
          p10: dp10, p11: dp11, p13: dp13, p14: dp14, p15: dp15, p16: dp16,
          angle: num(e, 50, 0) + ang,
          text: decodeText(str(e, 1, 0)),
          measurement: num(e, 42, null),
          has15: val(e, 15) != null,
          layer: layerName || '尺寸标注',
          phase: 'dimension',
          matrix: m
        }));
        return;
      }
      if (type === 'LEADER' || type === 'MLEADER') {
        var lp = [];
        var lx = all(e, 10), ly = all(e, 20);
        for (var li2 = 0; li2 < lx.length; li2++) lp.push(pt(parseFloat(lx[li2]) || 0, parseFloat(ly[li2]) || 0));
        if (lp.length > 1) out.push(makeRaw('poly', { points: lp, closed: false, phase: phase, layer: layerName }));
        return;
      }
      if (type === 'SOLID' || type === 'TRACE' || type === '3DFACE') {
        var sq = [
          pt(num(e, 10), num(e, 20)), pt(num(e, 11), num(e, 21)),
          pt(num(e, 12), num(e, 22)), pt(num(e, 13), num(e, 23))
        ];
        out.push(makeRaw('poly', { points: sq, closed: true, phase: phase, layer: layerName }));
        return;
      }
      if (type === 'INSERT') {
        if (depth > 6) return;
        var bn = str(e, 2, 0).trim();
        var block = blocks[bn];
        if (!block) {
          unsupported['INSERT:' + bn] = true;
          return;
        }
        var ins = { x: num(e, 10), y: num(e, 20) };
        var sx = num(e, 41, 1), sy = num(e, 42, 1);
        var rot = num(e, 50, 0);
        var local = multiply(
          multiply(translate(ins.x, ins.y), rotate(rot)),
          multiply(scale(sx || 1, sy || 1), translate(-block.base.x, -block.base.y))
        );
        var nextM = multiply(m, local);
        var sub = convertEntities(block.entities, {
          layers: layers, blocks: blocks, depth: depth + 1,
          inheritedLayer: layerName, matrix: nextM
        });
        sub.entities.forEach(function (r) { out.push(r); });
        Object.keys(sub.unsupported).forEach(function (k) { unsupported[k] = true; });
        return;
      }
      if (type === 'HATCH') {
        unsupported['HATCH'] = true;
        return;
      }
      if (type === 'POINT' || type === 'VIEWPORT' || type === 'IMAGE' || type === 'WIPEOUT') return;
      unsupported[type] = true;
    }

    for (var i = 0; i < entities.length; i++) convert(entities[i], rootMatrix, opts.inheritedLayer);
    return { entities: out, unsupported: unsupported };
  }

  /* ------------------------------ 尺寸标注重建 ------------------------------ */

  function dimLabel(raw, mapper) {
    var m = raw;
    var label = m.text || '';
    var measurement = m.measurement;
    if (measurement == null || !isFinite(measurement)) measurement = null;
    if (m.dimType === 0 || m.dimType === 1) {
      if (measurement == null) {
        var p1 = m.p13, p2 = m.p14;
        if (m.dimType === 1) {
          measurement = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        } else {
          var a = (m.angle || 0) * Math.PI / 180;
          measurement = Math.abs((p2.x - p1.x) * Math.cos(a) + (p2.y - p1.y) * Math.sin(a));
        }
      }
      var txt = label && label !== '<>' ? label : fmt(measurement);
      return txt.replace(/<>/g, fmt(measurement));
    }
    if (m.dimType === 3) {
      if (measurement == null) {
        var c = { x: (m.p10.x + m.p15.x) / 2, y: (m.p10.y + m.p15.y) / 2 };
        measurement = Math.hypot(m.p10.x - m.p15.x, m.p10.y - m.p15.y);
      }
      return (label || ('φ' + fmt(measurement))).replace(/<>/g, fmt(measurement));
    }
    if (m.dimType === 4) {
      if (measurement == null) measurement = Math.hypot(m.p10.x - m.p15.x, m.p10.y - m.p15.y);
      return (label || ('R' + fmt(measurement))).replace(/<>/g, fmt(measurement));
    }
    return label || (measurement == null ? '' : fmt(measurement));
  }

  function addDimension(tmp, raw, mapper) {
    var map = function (p) { return mapper.pt(p.x, p.y); };
    var p10 = map(raw.p10);
    var p11 = map(raw.p11);
    var p13 = map(raw.p13);
    var p14 = map(raw.p14);
    var p15 = map(raw.p15);
    var label = dimLabel(raw, mapper);
    var textSize = 14;

    if (raw.dimType === 0 || raw.dimType === 1) {
      var p1 = p13, p2 = p14;
      if (!p1 || !p2) return;
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 0.2) return;
      var dir;
      if (raw.dimType === 1) {
        dir = normalize({ x: p2.x - p1.x, y: p2.y - p1.y });
      } else {
        var pageAngle = -(raw.angle || 0) * Math.PI / 180;
        dir = { x: Math.cos(pageAngle), y: Math.sin(pageAngle) };
        if (!raw.angle) {
          dir = Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y) ? { x: 1, y: 0 } : { x: 0, y: 1 };
        }
      }
      var n = { x: -dir.y, y: dir.x };
      var dimPoint = p10;
      if (!isFinite(dimPoint.x) || !isFinite(dimPoint.y)) dimPoint = p11;
      var offset = (dimPoint.x - p1.x) * n.x + (dimPoint.y - p1.y) * n.y;
      if (Math.abs(offset) < 4) offset = 36;
      tmp.dimLinear(p1, p2, offset, label, { size: textSize });
      return;
    }

    if (raw.dimType === 3 || raw.dimType === 4) {
      if (!raw.has15) {
        if (label) tmp.leader([p10, p11], label, { size: textSize });
        return;
      }
    }

    if (raw.dimType === 3) {
      var center = { x: (p10.x + p15.x) / 2, y: (p10.y + p15.y) / 2 };
      var radius = Math.hypot(p10.x - p15.x, p10.y - p15.y) / 2;
      if (radius < 1) return;
      var angle = Math.atan2(p10.y - center.y, p10.x - center.x) * 180 / Math.PI;
      tmp.dimDiameter(center.x, center.y, radius, angle, label, { distance: Math.max(30, radius * 0.55), size: textSize });
      return;
    }

    if (raw.dimType === 4) {
      var rc = p15;
      var rr = Math.hypot(p10.x - rc.x, p10.y - rc.y);
      if (rr < 1) return;
      var ra = Math.atan2(p10.y - rc.y, p10.x - rc.x) * 180 / Math.PI;
      tmp.dimDiameter(rc.x, rc.y, rr, ra, label, { distance: Math.max(30, rr * 0.6), size: textSize });
      return;
    }

    if (label) {
      var anchor = p11.x >= p10.x ? 'start' : 'end';
      tmp.leader([p10, p11], label, { anchor: anchor, size: textSize });
    }
  }

  function normalize(v) {
    var l = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / l, y: v.y / l };
  }

  /* ------------------------------ 页面映射与图元 ------------------------------ */

  function rawBBox(allRaw) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function add(x, y) {
      if (!isFinite(x) || !isFinite(y)) return;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    allRaw.forEach(function (r) {
      if (r.kind === 'line') {
        add(r.a.x, r.a.y); add(r.b.x, r.b.y);
      } else if (r.kind === 'circle') {
        add(r.c.x - r.r, r.c.y - r.r); add(r.c.x + r.r, r.c.y + r.r);
      } else if (r.kind === 'arc') {
        var pts = sampleArc(r.c.x, r.c.y, r.r, r.a0, r.a1);
        pts.forEach(function (p) { add(p.x, p.y); });
      } else if (r.kind === 'poly') {
        r.points.forEach(function (p) { add(p.x, p.y); });
      } else if (r.kind === 'text') {
        add(r.x, r.y); add(r.x + r.height * Math.max(1, r.text.length) * 0.6, r.y - r.height);
      } else if (r.kind === 'dim') {
        [r.p10, r.p11, r.p13, r.p14, r.p15, r.p16].forEach(function (p) {
          if (p && isFinite(p.x) && isFinite(p.y)) add(p.x, p.y);
        });
      }
    });
    if (!isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 };
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }

  function makeMapper(bb) {
    var pad = Math.max(4, Math.max(bb.w, bb.h) * 0.035);
    var x0 = bb.x - pad, y0 = bb.y - pad;
    var w = bb.w + pad * 2, h = bb.h + pad * 2;
    var area = { x: 64, y: 92, w: 992, h: 558 };
    var s = Math.min(area.w / w, area.h / h);
    var left = area.x + (area.w - w * s) / 2;
    var top = area.y + (area.h - h * s) / 2;
    return {
      s: s,
      ox: left, oy: top + h * s,
      minX: x0, maxY: y0 + h,
      pt: function (x, y) { return { x: left + (x - x0) * s, y: top + (y0 + h - y) * s }; }
    };
  }

  function specFromPath(d, length, start, end, bbox, style, layer, phase) {
    return {
      type: 'path', d: d, length: length, start: start, end: end, bbox: bbox,
      style: style, layer: layer, phase: phase
    };
  }

  function convertRawToSpecs(raw, mapper) {
    var s = mapper.s;
    if (raw.kind === 'line') {
      var a = mapper.pt(raw.a.x, raw.a.y);
      var b = mapper.pt(raw.b.x, raw.b.y);
      return [specFromPath(G.linePath(a.x, a.y, b.x, b.y), Math.hypot(b.x - a.x, b.y - a.y), a, b, G.polygonBBox([a, b]), raw.phase === 'center' ? 'center' : (raw.phase === 'hidden' ? 'hidden' : (raw.phase === 'thin' ? 'thin' : 'visible')), raw.layer, raw.phase)];
    }
    if (raw.kind === 'circle') {
      var c = mapper.pt(raw.c.x, raw.c.y);
      var r = raw.r * s;
      return [specFromPath(G.circlePath(c.x, c.y, r), 2 * Math.PI * r, { x: c.x, y: c.y - r }, { x: c.x, y: c.y - r }, { x: c.x - r, y: c.y - r, w: r * 2, h: r * 2 }, raw.phase === 'center' ? 'center' : (raw.phase === 'hidden' ? 'hidden' : 'visible'), raw.layer, raw.phase)];
    }
    if (raw.kind === 'arc') {
      var ap = sampleArc(raw.c.x, raw.c.y, raw.r, raw.a0, raw.a1).map(function (p) { return mapper.pt(p.x, p.y); });
      var len = 0;
      for (var i = 1; i < ap.length; i++) len += Math.hypot(ap[i].x - ap[i - 1].x, ap[i].y - ap[i - 1].y);
      return [specFromPath(G.polylinePath(ap, false), len, ap[0], ap[ap.length - 1], G.polygonBBox(ap), raw.phase === 'center' ? 'center' : (raw.phase === 'hidden' ? 'hidden' : 'visible'), raw.layer, raw.phase)];
    }
    if (raw.kind === 'poly') {
      var pp = raw.points.map(function (p) { return mapper.pt(p.x, p.y); });
      var plen = G.polyLength(pp, raw.closed);
      var style = raw.phase === 'center' ? 'center' : (raw.phase === 'hidden' ? 'hidden' : (raw.phase === 'thin' ? 'thin' : (raw.phase === 'border' ? 'border' : 'visible')));
      return [specFromPath(G.polylinePath(pp, raw.closed), plen, pp[0], pp[pp.length - 1], G.polygonBBox(pp), style, raw.layer, raw.phase)];
    }
    if (raw.kind === 'text') {
      var tp = mapper.pt(raw.x, raw.y);
      var size = Math.max(7, Math.min(30, raw.height * s));
      var w = G.estimateTextWidth(raw.text, size);
      var left = raw.anchor === 'middle' ? tp.x - w / 2 : (raw.anchor === 'end' ? tp.x - w : tp.x);
      return [{
        type: 'text', text: raw.text, x: tp.x, y: tp.y, size: size,
        anchor: raw.anchor, baseline: raw.baseline || 'alphabetic',
        rotate: -raw.rotation, weight: 400,
        style: raw.phase === 'dimension' ? 'dim' : 'text',
        layer: raw.layer, phase: raw.phase, length: 0,
        start: { x: tp.x, y: tp.y }, end: { x: tp.x, y: tp.y },
        bbox: { x: left, y: tp.y - size * 1.15, w: w, h: size * 1.4 }
      }];
    }
    return [];
  }

  /* ------------------------------ 工序编排 ------------------------------ */

  function orderByProximity(specs) {
    if (specs.length < 3) return specs.slice();
    var remaining = specs.slice();
    var out = [];
    var cur = null;
    var startIdx = 0;
    var best = Infinity;
    for (var i = 0; i < remaining.length; i++) {
      var p = remaining[i].start || { x: 0, y: 0 };
      var d = p.x + p.y * 0.4;
      if (d < best) { best = d; startIdx = i; }
    }
    cur = remaining.splice(startIdx, 1)[0];
    out.push(cur);
    while (remaining.length) {
      var last = cur.end || cur.start || { x: 0, y: 0 };
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
      for (var j = i2 + 1; j < n; j++) {
        if (near(specs[i2], specs[j])) union(i2, j);
      }
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
    var ptsA = [a.start, a.end].filter(Boolean);
    var ptsB = [b.start, b.end].filter(Boolean);
    for (var i = 0; i < ptsA.length; i++) {
      for (var j = 0; j < ptsB.length; j++) {
        if (Math.hypot(ptsA[i].x - ptsB[j].x, ptsA[i].y - ptsB[j].y) < 3.2) return true;
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
    var chunks = [];
    var cur = [];
    var curLen = 0;
    var maxLen = 6800;
    comps.forEach(function (comp) {
      var compLen = comp.reduce(function (n, s) { return n + (s.length || 0); }, 0);
      if (comp.length > maxCount) {
        if (cur.length) { chunks.push(cur); cur = []; curLen = 0; }
        for (var i = 0; i < comp.length; i += maxCount) chunks.push(comp.slice(i, i + maxCount));
        return;
      }
      if (cur.length && (cur.length + comp.length > maxCount || curLen + compLen > maxLen)) {
        chunks.push(cur);
        cur = [];
        curLen = 0;
      }
      cur = cur.concat(comp);
      curLen += compLen;
    });
    if (cur.length) chunks.push(cur);
    return chunks;
  }

  function addStep(builder, title, note, phase, specs) {
    builder.step({ title: title, note: note, phase: phase, holdIn: 0.45, holdOut: 0.22 }, function () {
      specs.forEach(function (spec) {
        builder._add(JSON.parse(JSON.stringify(spec)));
      });
    });
  }

  /* ------------------------------ 主入口 ------------------------------ */

  function parseDxf(text) {
    var pairs = readPairs(text);
    var sections = findSections(pairs);
    var layers = parseLayers(sections, pairs);
    var blocks = parseBlocks(sections, pairs);
    var entRange = sections.ENTITIES;
    var entities = entRange ? parseRecords(pairs, entRange.start, entRange.end) : [];
    var converted = convertEntities(entities, { layers: layers, blocks: blocks });
    return {
      layers: layers,
      blocks: blocks,
      entities: converted.entities,
      unsupported: converted.unsupported
    };
  }

  function toDrawing(text, opts) {
    opts = opts || {};
    var parsed = parseDxf(text);
    if (!parsed.entities.length) {
      throw new Error('没有在 DXF 中找到可绘制实体。请确认文件为 ASCII DXF，且图形位于模型空间。');
    }
    var allRaw = parsed.entities.slice();
    var dims = allRaw.filter(function (r) { return r.kind === 'dim'; });
    var shapes = allRaw.filter(function (r) { return r.kind !== 'dim'; });
    var bb = rawBBox(allRaw);
    var mapper = makeMapper(bb);

    var specs = [];
    shapes.forEach(function (raw) {
      var ss = convertRawToSpecs(raw, mapper);
      for (var i = 0; i < ss.length; i++) {
        ss[i].phase = raw.phase;
        specs.push(ss[i]);
      }
    });

    var dimGroups = [];
    if (dims.length) {
      var tmp = new B({ width: 1120, height: 720 });
      tmp.step({ title: 'dim', phase: 'dimension' }, function () {
        dims.forEach(function (raw, di) {
          var before = tmp.current.primitives.length;
          try { addDimension(tmp, raw, mapper); } catch (err) { /* 忽略无法重建的标注 */ }
          var after = tmp.current.primitives.length;
          for (var k = before; k < after; k++) {
            tmp.current.primitives[k].dimGroup = di;
            tmp.current.primitives[k].phase = 'dimension';
          }
          if (after > before) dimGroups.push(tmp.current.primitives.slice(before, after));
        });
      });
    }

    var groups = {
      center: [], visible: [], hidden: [], dimension: [], text: [], border: [], thin: []
    };
    specs.forEach(function (p) {
      var key = groups[p.phase] ? p.phase : 'visible';
      groups[key].push(p);
    });
    dimGroups.forEach(function (g) { groups.dimension = groups.dimension.concat(g); });

    var builder = new B({
      width: 1120, height: 720,
      title: opts.title || '导入图纸',
      subtitle: (opts.format || 'DXF') + ' · 自动工序解析',
      source: 'dxf'
    });

    if (groups.center.length) {
      addStep(builder, '建立基准与中心线',
        '按图层名称和线型自动识别中心线、轴线与基准线；先画基准，再画轮廓。',
        'center', orderByProximity(groups.center));
    }
    if (groups.visible.length) {
      var chunks = packVisible(groups.visible, 16);
      chunks.forEach(function (chunk, ci) {
        addStep(builder,
          chunks.length > 1 ? ('绘制轮廓与结构 ' + (ci + 1) + '/' + chunks.length) : '绘制轮廓与结构',
          '自动按连通关系把轮廓分组，并从大到小安排绘制顺序；笔尖沿图线连续移动。',
          'visible', chunk);
      });
    }
    if (groups.hidden.length) {
      addStep(builder, '绘制不可见轮廓',
        '虚线表示被遮挡的结构，按“先可见、后不可见”的顺序补画。',
        'hidden', orderByProximity(groups.hidden));
    }
    if (groups.dimension.length) {
      var dchunks = [];
      for (var di = 0; di < dimGroups.length; di += 5) {
        dchunks.push([].concat.apply([], dimGroups.slice(di, di + 5)));
      }
      if (!dchunks.length) dchunks = [groups.dimension];
      dchunks.forEach(function (chunk, ci) {
        addStep(builder,
          dchunks.length > 1 ? ('标注尺寸 ' + (ci + 1) + '/' + dchunks.length) : '标注尺寸',
          '重建 DXF 中的线性、对齐、半径和直径标注；先定位尺寸，再定形尺寸。',
          'dimension', chunk);
      });
    }
    if (groups.text.length) {
      for (var ti = 0; ti < groups.text.length; ti += 26) {
        addStep(builder,
          groups.text.length > 26 ? ('书写文字 ' + (Math.floor(ti / 26) + 1)) : '书写文字与技术说明',
          '文字同样有先后：先写视图名称，再写技术要求，最后填写标题栏。',
          'text', groups.text.slice(ti, ti + 26));
      }
    }
    if (groups.border.length) {
      addStep(builder, '完善图框与标题栏',
        '最后绘制图框、标题栏和必要的表格线。',
        'border', orderByProximity(groups.border));
    }

    var unsupportedList = Object.keys(parsed.unsupported);
    var notes = [];
    if (unsupportedList.length) {
      notes.push('已跳过暂不支持的对象：' + unsupportedList.slice(0, 6).join('、') + (unsupportedList.length > 6 ? ' 等' : ''));
    }
    if (!dims.length) notes.push('文件中未检测到 DIMENSION 标注，尺寸标注工序可能为空。');

    var drawing = builder.build({
      source: 'dxf',
      format: 'DXF',
      layers: Object.keys(parsed.layers),
      notes: notes,
      unit: parsed.unit || ''
    });
    return drawing;
  }

  global.MD.Dxf = {
    parse: parseDxf,
    toDrawing: toDrawing,
    readPairs: readPairs
  };
})(typeof window !== 'undefined' ? window : globalThis);
