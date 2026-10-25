/* 制图工序 — 几何与图纸构建引擎（无依赖） */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var UID = 0;
  var PAGE_W = 1120;
  var PAGE_H = 720;

  var STYLES = {
    visible: { color: '#24303c', width: 2.15, dash: '', cls: 'visible' },
    hidden:  { color: '#66788a', width: 1.35, dash: '7 5', cls: 'hidden' },
    center:  { color: '#0e7490', width: 1.15, dash: '18 4 3 4', cls: 'center' },
    dim:     { color: '#b45309', width: 1.05, dash: '', cls: 'dim' },
    hatch:   { color: '#a16207', width: 0.85, dash: '', cls: 'hatch' },
    thin:    { color: '#64748b', width: 0.95, dash: '', cls: 'thin' },
    border:  { color: '#334155', width: 1.55, dash: '', cls: 'border' },
    text:    { color: '#1f2937', width: 0, dash: '', cls: 'text' }
  };

  function uid(prefix) {
    UID += 1;
    return (prefix || 'id') + '-' + UID;
  }

  function num(v) {
    var n = Number(v);
    if (!isFinite(n)) return '0';
    return String(Math.round(n * 100) / 100);
  }

  function deg2rad(d) { return d * Math.PI / 180; }

  function pointAt(cx, cy, r, angleDeg) {
    var a = deg2rad(angleDeg);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  function circlePath(cx, cy, r) {
    return (
      'M ' + num(cx) + ' ' + num(cy - r) +
      ' A ' + num(r) + ' ' + num(r) + ' 0 1 1 ' + num(cx) + ' ' + num(cy + r) +
      ' A ' + num(r) + ' ' + num(r) + ' 0 1 1 ' + num(cx) + ' ' + num(cy - r) + ' Z'
    );
  }

  /* 屏幕坐标角度：0°向右，90°向下，角度增大为顺时针 */
  function arcPath(cx, cy, r, a0, a1) {
    var delta = ((a1 - a0) % 360 + 360) % 360;
    if (delta < 0.01) delta = 360;
    if (delta >= 359.99) return circlePath(cx, cy, r);
    var p0 = pointAt(cx, cy, r, a0);
    var p1 = pointAt(cx, cy, r, a1);
    var large = delta > 180 ? 1 : 0;
    return 'M ' + num(p0.x) + ' ' + num(p0.y) +
      ' A ' + num(r) + ' ' + num(r) + ' 0 ' + large + ' 1 ' + num(p1.x) + ' ' + num(p1.y);
  }

  function linePath(x1, y1, x2, y2) {
    return 'M ' + num(x1) + ' ' + num(y1) + ' L ' + num(x2) + ' ' + num(y2);
  }

  function polylinePath(points, closed) {
    if (!points || !points.length) return '';
    var d = 'M ' + num(points[0].x) + ' ' + num(points[0].y);
    for (var i = 1; i < points.length; i++) {
      d += ' L ' + num(points[i].x) + ' ' + num(points[i].y);
    }
    if (closed) d += ' Z';
    return d;
  }

  function roundedRectPath(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    if (!r) {
      return 'M ' + num(x) + ' ' + num(y) + ' H ' + num(x + w) +
        ' V ' + num(y + h) + ' H ' + num(x) + ' Z';
    }
    return (
      'M ' + num(x + r) + ' ' + num(y) +
      ' H ' + num(x + w - r) +
      ' A ' + num(r) + ' ' + num(r) + ' 0 0 1 ' + num(x + w) + ' ' + num(y + r) +
      ' V ' + num(y + h - r) +
      ' A ' + num(r) + ' ' + num(r) + ' 0 0 1 ' + num(x + w - r) + ' ' + num(y + h) +
      ' H ' + num(x + r) +
      ' A ' + num(r) + ' ' + num(r) + ' 0 0 1 ' + num(x) + ' ' + num(y + h - r) +
      ' V ' + num(y + r) +
      ' A ' + num(r) + ' ' + num(r) + ' 0 0 1 ' + num(x + r) + ' ' + num(y) + ' Z'
    );
  }

  function polygonBBox(points) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function polyLength(points, closed) {
    var len = 0;
    for (var i = 1; i < points.length; i++) {
      len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    if (closed && points.length > 2) {
      len += Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y);
    }
    return len;
  }

  function estimateTextWidth(text, size) {
    var w = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (/[\u2e80-\u9fff\uff00-\uffef]/.test(ch)) w += size * 1.0;
      else if (/[iIl1.,:;'|]/.test(ch)) w += size * 0.32;
      else if (/[MW@%#]/.test(ch)) w += size * 0.82;
      else if (/\s/.test(ch)) w += size * 0.28;
      else w += size * 0.57;
    }
    return w;
  }

  function normaliseStyle(opts) {
    if (!opts) return { style: 'visible', layer: '', opacity: 1 };
    if (typeof opts === 'string') return { style: opts, layer: '', opacity: 1 };
    return {
      style: opts.style || 'visible',
      layer: opts.layer || '',
      opacity: opts.opacity == null ? 1 : opts.opacity,
      width: opts.width,
      color: opts.color
    };
  }

  function styleInfo(name) {
    return STYLES[name] || STYLES.visible;
  }

  function Builder(meta) {
    this.meta = meta || {};
    this.width = this.meta.width || PAGE_W;
    this.height = this.meta.height || PAGE_H;
    this.steps = [];
    this.current = null;
  }

  Builder.prototype.step = function (a, b, c, d) {
    var opts;
    if (typeof a === 'string') {
      opts = {
        title: a,
        note: b || '',
        phase: c || 'visible',
        holdIn: typeof d === 'number' ? d : undefined
      };
    } else {
      opts = a || {};
    }
    var step = {
      id: 'step-' + (this.steps.length + 1),
      index: this.steps.length,
      title: opts.title || ('工序 ' + (this.steps.length + 1)),
      note: opts.note || '',
      phase: opts.phase || 'visible',
      holdIn: opts.holdIn == null ? 0.55 : opts.holdIn,
      holdOut: opts.holdOut == null ? 0.3 : opts.holdOut,
      primitives: []
    };
    this.steps.push(step);
    this.current = step;
    if (typeof c === 'function') c(this);
    else if (typeof b === 'function') b(this);
    else if (typeof d === 'function') d(this);
    this.current = null;
    return this;
  };

  Builder.prototype._add = function (prim) {
    if (!this.current) {
      this.step('绘制', '', 'visible');
    }
    prim.id = uid('p');
    this.current.primitives.push(prim);
    return prim;
  };

  Builder.prototype._base = function (type, o) {
    var st = normaliseStyle(o);
    return {
      type: type,
      style: st.style,
      layer: st.layer,
      layerOpacity: st.opacity,
      width: st.width,
      color: st.color
    };
  };

  Builder.prototype.line = function (x1, y1, x2, y2, opts) {
    var p = this._base('path', opts);
    p.d = linePath(x1, y1, x2, y2);
    p.length = Math.hypot(x2 - x1, y2 - y1);
    p.start = { x: x1, y: y1 };
    p.end = { x: x2, y: y2 };
    p.bbox = polygonBBox([{ x: x1, y: y1 }, { x: x2, y: y2 }]);
    return this._add(p);
  };

  Builder.prototype.polyline = function (points, opts, closed) {
    var p = this._base('path', opts);
    p.d = polylinePath(points, !!closed);
    p.length = polyLength(points, !!closed);
    p.start = points.length ? { x: points[0].x, y: points[0].y } : { x: 0, y: 0 };
    p.end = points.length ? { x: points[points.length - 1].x, y: points[points.length - 1].y } : { x: 0, y: 0 };
    p.bbox = polygonBBox(points);
    if (closed) p.closed = true;
    return this._add(p);
  };

  Builder.prototype.circle = function (cx, cy, r, opts) {
    var p = this._base('path', opts);
    p.d = circlePath(cx, cy, r);
    p.length = 2 * Math.PI * r;
    p.start = { x: cx, y: cy - r };
    p.end = { x: cx, y: cy - r };
    p.bbox = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
    p.circle = { cx: cx, cy: cy, r: r };
    return this._add(p);
  };

  Builder.prototype.arc = function (cx, cy, r, a0, a1, opts) {
    var p = this._base('path', opts);
    var delta = ((a1 - a0) % 360 + 360) % 360;
    if (delta < 0.01) delta = 360;
    p.d = arcPath(cx, cy, r, a0, a1);
    p.length = deg2rad(delta) * r;
    p.start = pointAt(cx, cy, r, a0);
    p.end = pointAt(cx, cy, r, a1);
    if (delta >= 359.99) {
      p.bbox = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
    } else {
      var pts = [];
      var steps = Math.max(4, Math.ceil(delta / 12));
      for (var i = 0; i <= steps; i++) pts.push(pointAt(cx, cy, r, a0 + delta * i / steps));
      p.bbox = polygonBBox(pts);
    }
    return this._add(p);
  };

  Builder.prototype.roundedRect = function (x, y, w, h, r, opts) {
    var p = this._base('path', opts);
    p.d = roundedRectPath(x, y, w, h, r);
    p.length = 2 * (w + h) - 8 * r + 2 * Math.PI * r;
    p.start = { x: x + r, y: y };
    p.end = p.start;
    p.bbox = { x: x, y: y, w: w, h: h };
    return this._add(p);
  };

  Builder.prototype.rawPath = function (d, info, opts) {
    var p = this._base('path', opts);
    p.d = d;
    p.length = (info && info.length) || 0;
    p.start = (info && info.start) || { x: 0, y: 0 };
    p.end = (info && info.end) || p.start;
    p.bbox = (info && info.bbox) || { x: 0, y: 0, w: 0, h: 0 };
    return this._add(p);
  };

  Builder.prototype.text = function (x, y, text, opts) {
    opts = opts || {};
    var lines = String(text).split('\n');
    var size = opts.size || 14;
    var lineHeight = opts.lineHeight || size * 1.42;
    for (var i = 0; i < lines.length; i++) {
      var p = this._base('text', opts);
      p.text = lines[i];
      p.x = x;
      p.y = y + i * lineHeight;
      p.size = size;
      p.anchor = opts.anchor || 'start';
      p.baseline = opts.baseline || 'alphabetic';
      p.rotate = opts.rotate || 0;
      p.weight = opts.weight || 400;
      p.family = opts.family || '';
      p.italic = !!opts.italic;
      p.length = 0;
      var w = estimateTextWidth(lines[i], size);
      var left = p.anchor === 'middle' ? x - w / 2 : (p.anchor === 'end' ? x - w : x);
      p.bbox = { x: left, y: y - size * 1.12, w: w, h: size * 1.36 };
      p.start = { x: x, y: y - size * 0.35 };
      p.end = p.start;
      this._add(p);
    }
    return this;
  };

  Builder.prototype.solid = function (points, opts) {
    var p = this._base('solid', opts);
    p.d = polylinePath(points, true);
    p.length = 0;
    p.start = { x: (polygonBBox(points).x + polygonBBox(points).w / 2), y: polygonBBox(points).y + polygonBBox(points).h / 2 };
    p.end = p.start;
    p.bbox = polygonBBox(points);
    return this._add(p);
  };

  /* 将多边形以 angle 方向的等距平行线填充 */
  Builder.prototype.hatch = function (points, opts) {
    opts = opts || {};
    var spacing = opts.spacing || 8;
    var angle = opts.angle == null ? 45 : opts.angle;
    var segments = hatchSegments(points, spacing, angle);
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var p = this._base('path', { style: opts.style || 'hatch', layer: opts.layer || '剖面线' });
      p.d = linePath(seg[0].x, seg[0].y, seg[1].x, seg[1].y);
      p.length = Math.hypot(seg[1].x - seg[0].x, seg[1].y - seg[0].y);
      p.start = seg[0];
      p.end = seg[1];
      p.bbox = polygonBBox(seg);
      p.hatchLine = true;
      this._add(p);
    }
    return segments.length;
  };

  function hatchSegments(points, spacing, angle) {
    if (!points || points.length < 3) return [];
    var a = deg2rad(angle);
    var cos = Math.cos(a), sin = Math.sin(a);
    var rotated = points.map(function (p) {
      return { x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos };
    });
    var bb = polygonBBox(rotated);
    var segments = [];
    var startY = Math.ceil(bb.y / spacing) * spacing;
    for (var y = startY; y <= bb.y + bb.h; y += spacing) {
      var xs = [];
      for (var i = 0; i < rotated.length; i++) {
        var p1 = rotated[i];
        var p2 = rotated[(i + 1) % rotated.length];
        if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
          var t = (y - p1.y) / (p2.y - p1.y);
          xs.push(p1.x + t * (p2.x - p1.x));
        }
      }
      xs.sort(function (u, v) { return u - v; });
      for (var k = 0; k + 1 < xs.length; k += 2) {
        if (xs[k + 1] - xs[k] < 0.6) continue;
        segments.push([
          { x: xs[k] * cos - y * sin, y: xs[k] * sin + y * cos },
          { x: xs[k + 1] * cos - y * sin, y: xs[k + 1] * sin + y * cos }
        ]);
      }
    }
    return segments;
  }

  Builder.prototype._arrow = function (tip, dirX, dirY, size) {
    var len = Math.hypot(dirX, dirY) || 1;
    var ux = dirX / len, uy = dirY / len;
    var px = -uy, py = ux;
    var s = size || 9;
    var base = { x: tip.x - ux * s, y: tip.y - uy * s };
    var w = s * 0.36;
    this.solid([
      { x: tip.x, y: tip.y },
      { x: base.x + px * w, y: base.y + py * w },
      { x: base.x - px * w, y: base.y - py * w }
    ], { style: 'dim' });
  };

  Builder.prototype.dimLinear = function (a, b, offset, label, opts) {
    opts = opts || {};
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    var ux = dx / len, uy = dy / len;
    var nx = -uy, ny = ux;
    var off = offset == null ? 45 : offset;
    var sign = off >= 0 ? 1 : -1;
    if (Math.abs(off) < 1) off = 45 * sign;
    var q1 = { x: a.x + nx * off, y: a.y + ny * off };
    var q2 = { x: b.x + nx * off, y: b.y + ny * off };
    var dimOpts = { style: 'dim', layer: opts.layer || '尺寸标注' };

    this.line(a.x + nx * sign * 2.5, a.y + ny * sign * 2.5,
      q1.x + nx * sign * 5, q1.y + ny * sign * 5, dimOpts);
    this.line(b.x + nx * sign * 2.5, b.y + ny * sign * 2.5,
      q2.x + nx * sign * 5, q2.y + ny * sign * 5, dimOpts);
    this.line(q1.x, q1.y, q2.x, q2.y, dimOpts);

    this._arrow(q1, -ux, -uy, 8.5);
    this._arrow(q2, ux, uy, 8.5);

    var text = label == null ? formatNumber(len) : label;
    var angle = Math.atan2(dy, dx) * 180 / Math.PI;
    if (angle > 90 || angle < -90) angle += 180;
    var tx = (q1.x + q2.x) / 2 + nx * (off > 0 ? -6.5 : 6.5);
    var ty = (q1.y + q2.y) / 2 + ny * (off > 0 ? -6.5 : 6.5);
    this.text(tx, ty, text, {
      size: opts.size || 14.5,
      anchor: 'middle',
      baseline: 'middle',
      rotate: angle,
      style: 'dim',
      weight: 600
    });
  };

  Builder.prototype.dimDiameter = function (cx, cy, r, angleDeg, label, opts) {
    opts = opts || {};
    var a = deg2rad(angleDeg);
    var p = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    var ox = Math.cos(a), oy = Math.sin(a);
    var dist = opts.distance || 52;
    var end = { x: p.x + ox * dist, y: p.y + oy * dist };
    var dimOpts = { style: 'dim', layer: opts.layer || '尺寸标注' };
    this.line(p.x, p.y, end.x, end.y, dimOpts);
    this._arrow(p, -ox, -oy, 8.5);
    var tailDir = ox >= 0 ? 1 : -1;
    var tail = { x: end.x + tailDir * 16, y: end.y };
    this.line(end.x, end.y, tail.x, tail.y, dimOpts);
    this.text(tail.x + tailDir * 4, tail.y - 5, label, {
      size: opts.size || 14.5,
      anchor: tailDir > 0 ? 'start' : 'end',
      style: 'dim',
      weight: 600
    });
  };

  /* 引线：pts[0] 指向被标注对象，文字放在最后一点 */
  Builder.prototype.leader = function (pts, label, opts) {
    opts = opts || {};
    if (!pts || pts.length < 2) return;
    var dimOpts = { style: opts.style || 'dim', layer: opts.layer || '尺寸标注' };
    this.polyline(pts, dimOpts);
    var first = pts[0], second = pts[1];
    var dx = first.x - second.x, dy = first.y - second.y;
    this._arrow(first, dx, dy, 8);
    var last = pts[pts.length - 1];
    var prev = pts[pts.length - 2];
    var dir = last.x >= prev.x ? 1 : -1;
    var anchor = opts.anchor || (dir > 0 ? 'start' : 'end');
    this.text(last.x + dir * 6, last.y - 5, label, {
      size: opts.size || 14.5,
      anchor: anchor,
      style: 'dim',
      weight: 600
    });
  };

  Builder.prototype.note = function (x, y, text, opts) {
    opts = opts || {};
    this.text(x, y, text, {
      size: opts.size || 13,
      anchor: opts.anchor || 'start',
      style: opts.style || 'text',
      weight: opts.weight || 400,
      family: opts.family || ''
    });
  };

  Builder.prototype.build = function (extra) {
    var drawing = {
      width: this.width,
      height: this.height,
      title: this.meta.title || '机械制图',
      subtitle: this.meta.subtitle || '',
      source: this.meta.source || '',
      notes: this.meta.notes || [],
      steps: this.steps.filter(function (s) { return s.primitives.length > 0; }),
      bbox: { x: Infinity, y: Infinity, w: 0, h: 0 },
      strokeCount: 0
    };
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    drawing.steps.forEach(function (s, si) {
      s.index = si;
      s.count = s.primitives.length;
      s.phaseInfo = styleInfo(s.phase);
      s.primitives.forEach(function (p) {
        p.stepIndex = si;
        p.stepId = s.id;
        if (p.bbox) {
          minX = Math.min(minX, p.bbox.x);
          minY = Math.min(minY, p.bbox.y);
          maxX = Math.max(maxX, p.bbox.x + p.bbox.w);
          maxY = Math.max(maxY, p.bbox.y + p.bbox.h);
        }
        if (p.type === 'path') drawing.strokeCount += 1;
      });
    });
    if (isFinite(minX)) {
      drawing.bbox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) drawing[k] = extra[k];
      }
    }
    drawing.stepCount = drawing.steps.length;
    drawing.primitiveCount = drawing.steps.reduce(function (n, s) { return n + s.primitives.length; }, 0);
    return drawing;
  };

  function formatNumber(n) {
    var v = Math.round(n * 100) / 100;
    if (Math.abs(v - Math.round(v)) < 0.005) return String(Math.round(v));
    return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  global.MD = global.MD || {};
  global.MD.Geom = {
    NS: NS,
    PAGE_W: PAGE_W,
    PAGE_H: PAGE_H,
    STYLES: STYLES,
    Builder: Builder,
    uid: uid,
    num: num,
    pointAt: pointAt,
    circlePath: circlePath,
    arcPath: arcPath,
    linePath: linePath,
    polylinePath: polylinePath,
    roundedRectPath: roundedRectPath,
    polygonBBox: polygonBBox,
    polyLength: polyLength,
    estimateTextWidth: estimateTextWidth,
    hatchSegments: hatchSegments,
    styleInfo: styleInfo,
    formatNumber: formatNumber
  };
})(typeof window !== 'undefined' ? window : globalThis);
