/* 内置示例图纸：法兰盘 / 阶梯轴 / 连接板 */
(function (global) {
  'use strict';

  var G = global.MD.Geom;
  var B = G.Builder;

  function titleBlock(b, info) {
    var x = 798, y = 594, w = 290, h = 94;
    b.polyline([
      { x: x, y: y }, { x: x + w, y: y }, { x: x + w, y: y + h },
      { x: x, y: y + h }
    ], { style: 'border', layer: '图框' }, true);
    b.line(x, y + 32, x + w, y + 32, { style: 'border', layer: '图框' });
    b.line(x, y + 64, x + w, y + 64, { style: 'border', layer: '图框' });
    b.line(x + 132, y + 32, x + 132, y + h, { style: 'border', layer: '图框' });

    b.text(x + 14, y + 19, info.title || '', { size: 18, weight: 700, style: 'text' });
    b.text(x + 14, y + 30, info.subtitle || '', { size: 7, weight: 500, style: 'text' });
    b.text(x + 146, y + 17, '比例', { size: 9, style: 'text' });
    b.text(x + 188, y + 21, info.scale || '1:1', { size: 13, weight: 600, style: 'text' });
    b.text(x + 146, y + 49, '图号', { size: 9, style: 'text' });
    b.text(x + 188, y + 54, info.code || '', { size: 12, weight: 600, style: 'text' });
    b.text(x + 14, y + 83, info.author || '制图  工序演示', { size: 10.5, style: 'text' });
    b.text(x + 146, y + 83, info.date || '日期  2026.10', { size: 10.5, style: 'text' });
  }

  function techNotes(b, x, y, lines) {
    b.text(x, y, '技术要求', { size: 13, weight: 700, style: 'text' });
    for (var i = 0; i < lines.length; i++) {
      b.text(x, y + 20 + i * 18, lines[i], { size: 11, style: 'text' });
    }
  }

  /* ============================ 法兰盘 ============================ */
  function flange() {
    var b = new B({
      width: 1120, height: 720,
      title: '法兰盘',
      subtitle: 'FLANGE  ·  工序演示',
      source: 'sample:flange'
    });

    var secTop = [
      { x: 760, y: 160 }, { x: 790, y: 160 }, { x: 790, y: 188 }, { x: 760, y: 188 }
    ];
    var secUpper = [
      { x: 760, y: 212 }, { x: 790, y: 212 }, { x: 790, y: 245 },
      { x: 720, y: 245 }, { x: 720, y: 220 }, { x: 760, y: 220 }
    ];
    var secBottom = [
      { x: 760, y: 412 }, { x: 790, y: 412 }, { x: 790, y: 440 }, { x: 760, y: 440 }
    ];
    var secLower = [
      { x: 760, y: 355 }, { x: 790, y: 355 }, { x: 790, y: 388 },
      { x: 760, y: 388 }, { x: 760, y: 380 }, { x: 720, y: 380 }, { x: 720, y: 355 }
    ];

    b.step('建立基准与中心线', '先定圆心和轴线：十字中心线、螺栓孔分度圆、剖视图轴线与孔心线。', 'center', function () {
      b.line(140, 300, 520, 300, { style: 'center', layer: '中心线' });
      b.line(330, 110, 330, 470, { style: 'center', layer: '中心线' });
      b.circle(330, 300, 100, { style: 'center', layer: '中心线' });
      b.line(670, 300, 850, 300, { style: 'center', layer: '中心线' });
      b.line(745, 200, 805, 200, { style: 'center', layer: '中心线' });
      b.line(745, 400, 805, 400, { style: 'center', layer: '中心线' });
    });

    b.step('绘制主要轮廓', '以中心为基准画外圆与内孔；右侧按剖切位置画出法兰厚度、轮毂和螺栓孔缺口。', 'visible', function () {
      b.circle(330, 300, 140, { style: 'visible', layer: '粗实线' });
      b.circle(330, 300, 55, { style: 'visible', layer: '粗实线' });
      b.polyline(secTop, { style: 'visible', layer: '粗实线' }, true);
      b.polyline(secUpper, { style: 'visible', layer: '粗实线' }, true);
      b.polyline(secBottom, { style: 'visible', layer: '粗实线' }, true);
      b.polyline(secLower, { style: 'visible', layer: '粗实线' }, true);
      b.text(755, 142, 'A—A', { size: 14, anchor: 'middle', weight: 600, style: 'text' });
    });

    b.step('布置螺栓孔', '六个孔沿 φ200 分度圆均布；先定孔心，再画孔形和孔心十字线。', 'visible', function () {
      for (var i = 0; i < 6; i++) {
        var a = -90 + i * 60;
        var cx = 330 + 100 * Math.cos(a * Math.PI / 180);
        var cy = 300 + 100 * Math.sin(a * Math.PI / 180);
        b.circle(cx, cy, 12, { style: 'visible', layer: '粗实线' });
        b.line(cx - 19, cy, cx + 19, cy, { style: 'center', layer: '中心线' });
        b.line(cx, cy - 19, cx, cy + 19, { style: 'center', layer: '中心线' });
      }
    });

    b.step('绘制剖面线', '剖视图中的实体区域画 45° 细实线；孔和轮毂内孔保持空白。', 'hatch', function () {
      var opt = { style: 'hatch', layer: '剖面线', spacing: 8.5, angle: 45 };
      b.hatch(secTop, opt);
      b.hatch(secUpper, opt);
      b.hatch(secBottom, opt);
      b.hatch(secLower, opt);
    });

    b.step('标注尺寸', '先标定位尺寸（分度圆、孔距），再标定形尺寸（外径、内孔、厚度、轮毂）。尺寸线与轮廓留出间隙。', 'dimension', function () {
      b.dimDiameter(330, 300, 55, -140, 'φ110', { distance: 72 });
      b.dimDiameter(330, 300, 100, -55, 'φ200', { distance: 58 });
      b.leader([
        { x: 426.6, y: 243.7 }, { x: 458, y: 216 }, { x: 502, y: 216 }
      ], '6×φ24', { size: 14 });
      b.dimLinear({ x: 190, y: 440 }, { x: 470, y: 440 }, 65, 'φ280');
      b.dimLinear({ x: 760, y: 160 }, { x: 790, y: 160 }, -48, '30');
      b.dimLinear({ x: 790, y: 160 }, { x: 790, y: 440 }, -42, 'φ280');
      b.leader([{ x: 720, y: 220 }, { x: 696, y: 192 }, { x: 650, y: 192 }], 'φ160');
    });

    b.step('完善图框与标题栏', '最后补齐视图名称、技术要求、图框和标题栏，一张完整的机械图样就完成了。', 'border', function () {
      b.text(330, 560, '主视图', { size: 15, anchor: 'middle', weight: 600, style: 'text' });
      b.text(760, 560, 'A—A 剖视图', { size: 15, anchor: 'middle', weight: 600, style: 'text' });
      techNotes(b, 76, 556, ['1. 未注圆角 R2。', '2. 去除毛刺，锐边倒钝。']);
      titleBlock(b, {
        title: '法兰盘', subtitle: 'FLANGE', scale: '1:1', code: 'FL-01'
      });
    });

    return b.build();
  }

  /* ============================ 阶梯轴 ============================ */
  function shaft() {
    var b = new B({
      width: 1120, height: 720,
      title: '阶梯轴',
      subtitle: 'STEPPED SHAFT  ·  工序演示',
      source: 'sample:shaft'
    });

    var cx = 980, cy = 330, rr = 68;
    var keyHalf = 10, keyDepth = 8;
    var topY = cy - Math.sqrt(rr * rr - keyHalf * keyHalf);
    var angleRight = Math.atan2(topY - cy, keyHalf) * 180 / Math.PI;
    var angleLeft = angleRight + 360 - 2 * Math.asin(keyHalf / rr) * 180 / Math.PI;
    var keyBottom = topY + keyDepth;

    var profile = [
      { x: 135, y: 288 }, { x: 260, y: 288 }, { x: 260, y: 274 },
      { x: 390, y: 274 }, { x: 390, y: 262 }, { x: 650, y: 262 },
      { x: 650, y: 282 }, { x: 690, y: 282 }, { x: 690, y: 287 },
      { x: 715, y: 287 }, { x: 715, y: 282 }, { x: 760, y: 282 },
      { x: 760, y: 300 }, { x: 840, y: 300 }, { x: 840, y: 360 },
      { x: 760, y: 360 }, { x: 760, y: 378 }, { x: 715, y: 378 },
      { x: 715, y: 373 }, { x: 690, y: 373 }, { x: 690, y: 378 },
      { x: 650, y: 378 }, { x: 650, y: 398 }, { x: 390, y: 398 },
      { x: 390, y: 386 }, { x: 260, y: 386 }, { x: 260, y: 372 },
      { x: 135, y: 372 }, { x: 130, y: 367 }, { x: 130, y: 293 }
    ];

    b.step('建立轴线与基准', '先画轴的轴线，再画断面图的中心线。轴对称图形必须先从中心线开始。', 'center', function () {
      b.line(110, 330, 900, 330, { style: 'center', layer: '中心线' });
      b.line(900, 330, 1060, 330, { style: 'center', layer: '中心线' });
      b.line(980, 240, 980, 420, { style: 'center', layer: '中心线' });
    });

    b.step('画阶梯轴外轮廓', '按直径变化依次画出各轴段，再画端面、倒角和退刀槽。轮廓一次连续画成，便于检查尺寸。', 'visible', function () {
      b.polyline(profile, { style: 'visible', layer: '粗实线' }, true);
    });

    b.step('画键槽与细部', '键槽在视图内不可见，用虚线表示；槽宽、槽深要与断面图一致。', 'hidden', function () {
      b.line(285, 274, 285, 282, { style: 'hidden', layer: '虚线' });
      b.line(355, 274, 355, 282, { style: 'hidden', layer: '虚线' });
      b.line(285, 282, 355, 282, { style: 'hidden', layer: '虚线' });
      b.line(220, 282, 390, 282, { style: 'center', layer: '中心线' });
    });

    b.step('绘制 B—B 断面', '在断面位置画出带键槽的圆断面。键槽缺口按槽宽 20、槽深 8 画出。', 'visible', function () {
      var d = 'M ' + (cx + keyHalf) + ' ' + topY.toFixed(2) +
        ' A ' + rr + ' ' + rr + ' 0 1 1 ' + (cx - keyHalf) + ' ' + topY.toFixed(2) +
        ' L ' + (cx - keyHalf) + ' ' + keyBottom.toFixed(2) +
        ' L ' + (cx + keyHalf) + ' ' + keyBottom.toFixed(2) + ' Z';
      b.rawPath(d, {
        length: rr * Math.abs(angleLeft - angleRight) * Math.PI / 180 + keyHalf * 2 + keyDepth,
        start: { x: cx + keyHalf, y: topY },
        end: { x: cx + keyHalf, y: topY },
        bbox: { x: cx - rr, y: cy - rr, w: rr * 2, h: rr * 2 }
      }, { style: 'visible', layer: '粗实线' });
      b.text(980, 226, 'B—B', { size: 14, anchor: 'middle', weight: 600, style: 'text' });
    });

    b.step('绘制断面剖面线', '断面实体区域画 45° 剖面线，键槽缺口不画。', 'hatch', function () {
      var pts = [];
      var steps = 172;
      for (var i = 0; i <= steps; i++) {
        var a = angleRight + (angleLeft - angleRight) * i / steps;
        pts.push(G.pointAt(cx, cy, rr, a));
      }
      pts.push({ x: cx - keyHalf, y: keyBottom });
      pts.push({ x: cx + keyHalf, y: keyBottom });
      b.hatch(pts, { style: 'hatch', layer: '剖面线', spacing: 7, angle: 45 });
    });

    b.step('标注尺寸', '长度尺寸从基准端面依次标注；直径尺寸用引线标注在轮廓外侧，避免与图线重叠。', 'dimension', function () {
      b.dimLinear({ x: 130, y: 330 }, { x: 840, y: 330 }, 190, '710');
      b.dimLinear({ x: 130, y: 330 }, { x: 260, y: 330 }, 140, '130');
      b.dimLinear({ x: 390, y: 330 }, { x: 650, y: 330 }, 140, '260');
      b.dimLinear({ x: 650, y: 330 }, { x: 760, y: 330 }, 140, '110');

      b.leader([{ x: 195, y: 288 }, { x: 160, y: 205 }, { x: 112, y: 205 }], 'φ84', { anchor: 'end' });
      b.leader([{ x: 325, y: 274 }, { x: 292, y: 220 }, { x: 240, y: 220 }], 'φ112', { anchor: 'end' });
      b.leader([{ x: 520, y: 262 }, { x: 520, y: 196 }, { x: 590, y: 196 }], 'φ136');
      b.leader([{ x: 800, y: 300 }, { x: 822, y: 236 }, { x: 880, y: 236 }], 'φ60');
      b.leader([{ x: 320, y: 282 }, { x: 320, y: 250 }, { x: 370, y: 250 }], '键槽 20×8', { size: 12.5 });
    });

    b.step('完善图框与标题栏', '补全视图名称、技术要求与标题栏，完成图样。', 'border', function () {
      b.text(480, 560, '主视图', { size: 15, anchor: 'middle', weight: 600, style: 'text' });
      b.text(980, 470, 'B—B 断面', { size: 14, anchor: 'middle', weight: 600, style: 'text' });
      techNotes(b, 76, 556, ['1. 未注倒角 C1。', '2. 调质处理，硬度 HB220~250。']);
      titleBlock(b, {
        title: '阶梯轴', subtitle: 'STEPPED SHAFT', scale: '1:1', code: 'SH-02'
      });
    });

    return b.build();
  }

  /* ============================ 连接板 ============================ */
  function plate() {
    var b = new B({
      width: 1120, height: 720,
      title: '连接板',
      subtitle: 'MOUNTING PLATE  ·  工序演示',
      source: 'sample:plate'
    });

    var x = 280, y = 170, w = 520, h = 300, r = 30;
    var holes = [
      { x: 340, y: 230 }, { x: 720, y: 230 },
      { x: 340, y: 410 }, { x: 720, y: 410 }
    ];

    b.step('建立中心线', '先画板的对称中心线和四个孔的中心线，确定孔位基准。', 'center', function () {
      b.line(220, 320, 860, 320, { style: 'center', layer: '中心线' });
      b.line(540, 130, 540, 510, { style: 'center', layer: '中心线' });
      for (var i = 0; i < holes.length; i++) {
        b.line(holes[i].x - 30, holes[i].y, holes[i].x + 30, holes[i].y, { style: 'center', layer: '中心线' });
        b.line(holes[i].x, holes[i].y - 30, holes[i].x, holes[i].y + 30, { style: 'center', layer: '中心线' });
      }
    });

    b.step('画外轮廓', '按 520×300 画圆角矩形外轮廓，四个圆角 R30。先画直线段，再画圆弧过渡。', 'visible', function () {
      b.roundedRect(x, y, w, h, r, { style: 'visible', layer: '粗实线' });
    });

    b.step('画孔与长圆槽', '四个 φ28 安装孔按中心线定位；中间长圆槽由两段直线和两个 R30 半圆组成。', 'visible', function () {
      for (var i = 0; i < holes.length; i++) {
        b.circle(holes[i].x, holes[i].y, 14, { style: 'visible', layer: '粗实线' });
      }
      var d = 'M 470 290 L 610 290 A 30 30 0 0 1 610 350 L 470 350 A 30 30 0 0 1 470 290 Z';
      b.rawPath(d, {
        length: 280 + 2 * Math.PI * 30,
        start: { x: 470, y: 290 },
        end: { x: 470, y: 290 },
        bbox: { x: 440, y: 290, w: 200, h: 60 }
      }, { style: 'visible', layer: '粗实线' });
    });

    b.step('标注尺寸', '先标孔位和槽位定位尺寸，再标外形尺寸、圆角与孔径。', 'dimension', function () {
      b.dimLinear({ x: 340, y: 230 }, { x: 720, y: 230 }, -110, '380');
      b.dimLinear({ x: 280, y: 470 }, { x: 800, y: 470 }, 52, '520');
      b.dimLinear({ x: 800, y: 170 }, { x: 800, y: 470 }, -82, '300');
      b.leader([{ x: 289, y: 179 }, { x: 242, y: 140 }, { x: 196, y: 140 }], 'R30', { anchor: 'end', size: 13 });
      b.leader([{ x: 349.9, y: 220.1 }, { x: 392, y: 154 }, { x: 444, y: 154 }], '4×φ28', { size: 13 });
      b.leader([{ x: 540, y: 290 }, { x: 540, y: 254 }, { x: 600, y: 254 }], '200×60', { size: 12.5 });
    });

    b.step('完善图框与标题栏', '补全视图名称、技术要求与标题栏，完成图样。', 'border', function () {
      b.text(540, 560, '主视图', { size: 15, anchor: 'middle', weight: 600, style: 'text' });
      techNotes(b, 76, 556, ['1. 孔口去毛刺。', '2. 未注圆角 R2。']);
      titleBlock(b, {
        title: '连接板', subtitle: 'MOUNTING PLATE', scale: '1:2', code: 'PL-03'
      });
    });

    return b.build();
  }

  global.MD.Samples = {
    flange: flange,
    shaft: shaft,
    plate: plate,
    list: [
      { id: 'flange', name: '法兰盘', kind: '圆盘类', steps: 6, icon: 'flange' },
      { id: 'shaft', name: '阶梯轴', kind: '轴类', steps: 7, icon: 'shaft' },
      { id: 'plate', name: '连接板', kind: '板类', steps: 5, icon: 'plate' }
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
