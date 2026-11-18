/**
 * @fileoverview Moteur graphique Canvas haute résolution (DPI-aware) pour :
 *  - Évolution horaire θ_op(t), θ_e(t), limite SIA 180
 *  - Domaine adaptatif SIA 180 (θ_op vs θ_rm,48h)
 *  - Bilan thermique estival (gains & déperditions)
 *  - Apports solaires par orientation
 *  - Comparatif des normes de confort adaptatif (EN 16798-1, ASHRAE 55, SIA 180)
 */

import { EN16798_LIMITS } from '../standards/comfort-references.js';
import { getSIA180Limits } from '../standards/sia180.js';

function prepCanvas(id) {
  const c = document.getElementById(id);
  if (!c || !c.parentElement) return null;
  const rect = c.parentElement.getBoundingClientRect();
  const w = Math.max(320, Math.floor(rect.width));
  const h = Math.max(170, Math.floor(rect.height));
  const dpr = window.devicePixelRatio || 1;
  c.width = w * dpr;
  c.height = h * dpr;
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { c, ctx, w, h };
}

function cssVar(n) {
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
}

function fillRoundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
  ctx.fill();
}

export function drawTimeChart(res, activeFR, winMode, compareFloors) {
  const prep = prepCanvas('chartTime');
  if (!prep || !activeFR.series || activeFR.series.length < 2) return null;
  const { c, ctx, w, h } = prep;
  const pad = { l: 46, r: 16, t: 26, b: 26 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  const S = activeFR.series;

  let i0 = 0;
  let i1 = S.length - 1;
  if (winMode === 'hottest14') {
    i0 = Math.max(0, activeFR.maxTopHour - 7 * 24);
    i1 = Math.min(S.length - 1, i0 + 14 * 24);
    if (i1 - i0 < 24) {
      i0 = Math.max(0, S.length - 14 * 24);
      i1 = S.length - 1;
    }
  } else if (winMode === 'summer') {
    if (S.length > 151 * 24 + 2) {
      i0 = 151 * 24;
      i1 = Math.min(S.length - 1, 243 * 24);
    }
  }

  const len = i1 - i0 + 1;
  if (len < 2) return null;

  const cmp = compareFloors && res.floorResults.length > 1;
  let yMin = 100;
  let yMax = -100;
  for (let i = i0; i <= i1; i++) {
    yMin = Math.min(yMin, S[i].Te, S[i].Top);
    yMax = Math.max(yMax, S[i].Te, S[i].Top, S[i].limUpper);
    if (cmp) {
      for (const fr of res.floorResults) {
        if (fr.series && fr.series[i]) {
          yMin = Math.min(yMin, fr.series[i].Top);
          yMax = Math.max(yMax, fr.series[i].Top);
        }
      }
    }
  }
  yMin = Math.floor((yMin - 1) / 5) * 5;
  yMax = Math.ceil((yMax + 1) / 5) * 5;
  if (yMax <= yMin) yMax = yMin + 10;

  const xOf = r => pad.l + (r / (len - 1)) * pw;
  const yOf = v => pad.t + ph - ((v - yMin) / (yMax - yMin)) * ph;

  ctx.font = '11px Inter, sans-serif';
  const gridCol = cssVar('--grid-line');
  const txtCol = cssVar('--text-muted');

  for (let y = yMin; y <= yMax; y += 5) {
    const py = yOf(y);
    ctx.strokeStyle = gridCol;
    ctx.beginPath();
    ctx.moveTo(pad.l, py);
    ctx.lineTo(w - pad.r, py);
    ctx.stroke();
    ctx.fillStyle = txtCol;
    ctx.textAlign = 'right';
    ctx.fillText(`${y}°C`, pad.l - 6, py + 4);
  }

  const totalD = Math.max(1, Math.round(len / 24));
  const stepD = totalD <= 20 ? 2 : totalD <= 100 ? 10 : 30;
  for (let d = 0; d <= totalD; d += stepD) {
    const rel = Math.min(len - 1, d * 24);
    ctx.fillStyle = txtCol;
    ctx.textAlign = 'center';
    ctx.fillText(`J${S[i0 + rel].d + 1}`, xOf(rel), h - 7);
  }

  const plot = (arr, getter, col, lw, dash = []) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.setLineDash(dash);
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const px = xOf(i - i0);
      const py = yOf(getter(arr[i]));
      if (i === i0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  plot(S, p => p.Te, '#9aa0a6', 1.2);
  plot(S, p => p.limUpper, '#81c995', 1.6, [5, 4]);

  const pal = ['#a8c7fa', '#f28b82', '#fdd663', '#c58af9', '#78d9ec'];
  const leg = [
    ['θ_e Ext.', '#9aa0a6'],
    ['Limite SIA', '#81c995']
  ];
  if (cmp) {
    res.floorResults.forEach((fr, k) => {
      const cCol = pal[k % pal.length];
      plot(fr.series, p => p.Top, cCol, fr === activeFR ? 2.2 : 1.4);
      leg.push([fr.floor.name.slice(0, 14), cCol]);
    });
  } else {
    plot(S, p => p.Top, '#a8c7fa', 2.0);
    leg.push(['θ_op Int.', '#a8c7fa']);
  }

  let lx = pad.l + 4;
  ctx.font = '11px Inter, sans-serif';
  for (const [lbl, col] of leg) {
    const itemW = ctx.measureText(lbl).width + 28;
    if (lx + itemW > w - pad.r) break;
    ctx.fillStyle = col;
    ctx.fillRect(lx, 7, 13, 3);
    ctx.fillStyle = cssVar('--text');
    ctx.textAlign = 'left';
    ctx.fillText(lbl, lx + 17, 12);
    lx += itemW + 8;
  }

  return { c, i0, i1, pad, pw, activeFR };
}

export function drawSIAChart(activeFR, siaCurveMode) {
  const prep = prepCanvas('chartSIA');
  if (!prep || !activeFR.series) return;
  const { ctx, w, h } = prep;
  const pad = { l: 46, r: 16, t: 22, b: 30 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;

  const xMin = 5;
  const xMax = 28;
  const yMin = 19;
  const yMax = Math.max(32, Math.ceil(activeFR.maxTop + 1));

  const xOf = x => pad.l + ((x - xMin) / (xMax - xMin)) * pw;
  const yOf = y => pad.t + ph - ((y - yMin) / (yMax - yMin)) * ph;

  ctx.fillStyle = cssVar('--chart-band');
  ctx.beginPath();
  for (let x = xMin; x <= xMax; x += 0.25) {
    const l = getSIA180Limits(x, siaCurveMode);
    if (x === xMin) ctx.moveTo(xOf(x), yOf(l.upper));
    else ctx.lineTo(xOf(x), yOf(l.upper));
  }
  for (let x = xMax; x >= xMin; x -= 0.25) {
    ctx.lineTo(xOf(x), yOf(getSIA180Limits(x, siaCurveMode).lower));
  }
  ctx.closePath();
  ctx.fill();

  const gridCol = cssVar('--grid-line');
  const txtCol = cssVar('--text-muted');
  ctx.font = '11px Inter, sans-serif';

  for (let x = xMin; x <= xMax; x += 3) {
    ctx.strokeStyle = gridCol;
    ctx.beginPath();
    ctx.moveTo(xOf(x), pad.t);
    ctx.lineTo(xOf(x), h - pad.b);
    ctx.stroke();
    ctx.fillStyle = txtCol;
    ctx.textAlign = 'center';
    ctx.fillText(`${x}°`, xOf(x), h - pad.b + 14);
  }
  for (let y = yMin; y <= yMax; y += 2) {
    ctx.strokeStyle = gridCol;
    ctx.beginPath();
    ctx.moveTo(pad.l, yOf(y));
    ctx.lineTo(w - pad.r, yOf(y));
    ctx.stroke();
    ctx.fillStyle = txtCol;
    ctx.textAlign = 'right';
    ctx.fillText(`${y}°C`, pad.l - 6, yOf(y) + 4);
  }

  ctx.strokeStyle = '#81c995';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let x = xMin; x <= xMax; x += 0.25) {
    const l = getSIA180Limits(x, siaCurveMode);
    if (x === xMin) ctx.moveTo(xOf(x), yOf(l.upper));
    else ctx.lineTo(xOf(x), yOf(l.upper));
  }
  ctx.stroke();

  for (const pt of activeFR.series) {
    if (!pt.isOccHour || pt.tRm48 < xMin || pt.tRm48 > xMax) continue;
    ctx.fillStyle = pt.isOverSIA ? 'rgba(242, 139, 130, 0.78)' : 'rgba(168, 199, 250, 0.35)';
    ctx.beginPath();
    ctx.arc(
      xOf(pt.tRm48),
      yOf(Math.max(yMin, Math.min(yMax, pt.Top))),
      pt.isOverSIA ? 2.5 : 1.7,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  ctx.fillStyle = txtCol;
  ctx.textAlign = 'left';
  ctx.fillText('θ_rm,48h [°C]  •  Rouge = surchauffe SIA 180', pad.l, 14);
}

export function drawBalanceChart(activeFR) {
  const prep = prepCanvas('chartBalance');
  if (!prep) return;
  const { ctx, w, h } = prep;
  const b = activeFR.summerBal;
  const items = [
    ['Apports solaires (+)', b.sol, '#fdd663'],
    ['Gains internes (+)', b.int, '#f28b82'],
    ['Conduction entrante (+)', b.trIn, '#ffab70'],
    ['Conduction sortante (-)', b.trOut, '#a8c7fa'],
    ['Ventilation diurne (-)', b.veDayOut, '#78d9ec'],
    ['Déstockage nuit (-)', b.veNightOut, '#81c995']
  ];
  if (Math.abs(b.slabNet) >= 1) {
    items.push([
      b.slabNet >= 0 ? 'Échange dalles (+)' : 'Échange dalles (-)',
      Math.abs(b.slabNet),
      '#c58af9'
    ]);
  }

  const maxVal = Math.max(10, ...items.map(x => x[1]));
  const padL = 160;
  const padR = 72;
  const padT = 10;
  const padB = 10;
  const rowH = (h - padT - padB) / items.length;
  const barMaxW = Math.max(40, w - padL - padR);

  ctx.font = '11.5px Inter, sans-serif';
  items.forEach(([lbl, val, col], i) => {
    const y = padT + i * rowH;
    const bw = (Math.max(0, val) / maxVal) * barMaxW;
    ctx.fillStyle = cssVar('--text-muted');
    ctx.textAlign = 'right';
    ctx.fillText(lbl, padL - 10, y + rowH * 0.62);
    ctx.fillStyle = col;
    if (bw > 0) fillRoundedRect(ctx, padL, y + 5, bw, Math.max(8, rowH - 12), 4);
    ctx.fillStyle = cssVar('--text');
    ctx.textAlign = 'left';
    ctx.fillText(`${val.toFixed(0)} kWh`, padL + bw + 8, y + rowH * 0.62);
  });
}

export function drawOrientChart(activeFR) {
  const prep = prepCanvas('chartOrient');
  if (!prep) return;
  const { ctx, w, h } = prep;
  const keys = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO', 'R'];
  const vals = keys.map(k => activeFR.solByOrient[k] || 0);
  const maxV = Math.max(10, ...vals);
  const pad = { l: 46, r: 16, t: 20, b: 28 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  const colW = pw / keys.length;
  const bw = Math.min(44, colW * 0.56);

  ctx.font = '11px Inter, sans-serif';
  for (let i = 0; i <= 4; i++) {
    const v = (maxV * i) / 4;
    const py = pad.t + ph - (i / 4) * ph;
    ctx.strokeStyle = cssVar('--grid-line');
    ctx.beginPath();
    ctx.moveTo(pad.l, py);
    ctx.lineTo(w - pad.r, py);
    ctx.stroke();
    ctx.fillStyle = cssVar('--text-muted');
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(v)}`, pad.l - 6, py + 4);
  }

  keys.forEach((k, i) => {
    const bh = (vals[i] / maxV) * ph;
    const x = pad.l + i * colW + (colW - bw) / 2;
    const y = pad.t + ph - bh;
    ctx.fillStyle =
      k === 'R' ? '#f28b82' : ['S', 'SO', 'O', 'E', 'SE'].includes(k) ? '#fdd663' : '#a8c7fa';
    if (bh > 0) fillRoundedRect(ctx, x, y, bw, bh, 4);
    ctx.fillStyle = cssVar('--text');
    ctx.textAlign = 'center';
    ctx.fillText(k === 'R' ? 'Toit' : k, pad.l + i * colW + colW / 2, h - 8);
    if (vals[i] > 0) {
      ctx.fillStyle = cssVar('--text-muted');
      ctx.fillText(`${vals[i].toFixed(0)}`, pad.l + i * colW + colW / 2, Math.max(12, y - 5));
    }
  });
}

/**
 * Graphique comparatif du confort adaptatif : EN 16798-1 (Cat I/II/III),
 * ASHRAE 55 (80 %) et SIA 180 superposés aux heures occupées estivales.
 */
export function drawAdaptiveComparisonChart(activeFR, siaCurveMode) {
  const prep = prepCanvas('chartComfortAdaptive');
  if (!prep || !activeFR.series) return;
  const { ctx, w, h } = prep;
  const pad = { l: 46, r: 16, t: 26, b: 30 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;

  const xMin = 10;
  const xMax = 28;
  const yMin = 19;
  const yMax = Math.max(32, Math.ceil(activeFR.maxTop + 1));

  const xOf = x => pad.l + ((x - xMin) / (xMax - xMin)) * pw;
  const yOf = y => pad.t + ph - ((y - yMin) / (yMax - yMin)) * ph;

  // Bande EN 16798-1 Cat II
  ctx.fillStyle = cssVar('--chart-band-2');
  ctx.beginPath();
  for (let x = xMin; x <= xMax; x += 0.5) {
    const tc = EN16798_LIMITS.slope * x + EN16798_LIMITS.intercept;
    const yu = tc + EN16798_LIMITS.categories.II.upperOffset;
    if (x === xMin) ctx.moveTo(xOf(x), yOf(yu));
    else ctx.lineTo(xOf(x), yOf(yu));
  }
  for (let x = xMax; x >= xMin; x -= 0.5) {
    const tc = EN16798_LIMITS.slope * x + EN16798_LIMITS.intercept;
    ctx.lineTo(xOf(x), yOf(tc + EN16798_LIMITS.categories.II.lowerOffset));
  }
  ctx.closePath();
  ctx.fill();

  const gridCol = cssVar('--grid-line');
  const txtCol = cssVar('--text-muted');
  ctx.font = '11px Inter, sans-serif';

  for (let x = xMin; x <= xMax; x += 3) {
    ctx.strokeStyle = gridCol;
    ctx.beginPath();
    ctx.moveTo(xOf(x), pad.t);
    ctx.lineTo(xOf(x), h - pad.b);
    ctx.stroke();
    ctx.fillStyle = txtCol;
    ctx.textAlign = 'center';
    ctx.fillText(`${x}°`, xOf(x), h - pad.b + 14);
  }
  for (let y = yMin; y <= yMax; y += 2) {
    ctx.strokeStyle = gridCol;
    ctx.beginPath();
    ctx.moveTo(pad.l, yOf(y));
    ctx.lineTo(w - pad.r, yOf(y));
    ctx.stroke();
    ctx.fillStyle = txtCol;
    ctx.textAlign = 'right';
    ctx.fillText(`${y}°C`, pad.l - 6, yOf(y) + 4);
  }

  const drawCurve = (fn, col, dash = []) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.6;
    ctx.setLineDash(dash);
    ctx.beginPath();
    for (let x = xMin; x <= xMax; x += 0.5) {
      const y = fn(x);
      if (x === xMin) ctx.moveTo(xOf(x), yOf(y));
      else ctx.lineTo(xOf(x), yOf(y));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  drawCurve(x => EN16798_LIMITS.slope * x + EN16798_LIMITS.intercept + 2, '#78d9ec', [4, 3]);
  drawCurve(x => EN16798_LIMITS.slope * x + EN16798_LIMITS.intercept + 3, '#81c995');
  drawCurve(x => EN16798_LIMITS.slope * x + EN16798_LIMITS.intercept + 4, '#fdd663', [2, 3]);
  drawCurve(() => 26.0, '#c58af9', [6, 4]);
  drawCurve(x => getSIA180Limits(x, siaCurveMode).upper, '#f28b82', [5, 2]);

  for (const pt of activeFR.series) {
    if (!pt.isOccHour || pt.tRmEN < xMin || pt.tRmEN > xMax) continue;
    const cat2Up = EN16798_LIMITS.slope * pt.tRmEN + EN16798_LIMITS.intercept + 3;
    ctx.fillStyle = pt.Top > cat2Up ? 'rgba(242, 139, 130, 0.72)' : 'rgba(168, 199, 250, 0.35)';
    ctx.beginPath();
    ctx.arc(xOf(pt.tRmEN), yOf(Math.max(yMin, Math.min(yMax, pt.Top))), 1.7, 0, Math.PI * 2);
    ctx.fill();
  }

  const leg = [
    ['EN Cat I', '#78d9ec'],
    ['EN Cat II', '#81c995'],
    ['EN Cat III', '#fdd663'],
    ['SECO 26°C', '#c58af9'],
    ['SIA 180', '#f28b82']
  ];
  let lx = pad.l;
  ctx.font = '11px Inter, sans-serif';
  for (const [lbl, col] of leg) {
    const itemW = ctx.measureText(lbl).width + 22;
    if (lx + itemW > w - pad.r) break;
    ctx.fillStyle = col;
    ctx.fillRect(lx, 8, 11, 3);
    ctx.fillStyle = cssVar('--text');
    ctx.textAlign = 'left';
    ctx.fillText(lbl, lx + 14, 13);
    lx += itemW + 6;
  }
}

/**
 * Graphique simplifié (Vue Rapport Minergie) :
 * Évolution de la température intérieure vs extérieure sur les 14 jours les plus chauds,
 * avec seuil de confort fixe (26.5 °C) et mise en évidence visuelle des zones de surchauffe.
 */
export function drawSimpleHeatwaveChart(activeFR, thresholdC = 26.5) {
  const prep = prepCanvas('chartSimpleHeatwave');
  if (!prep || !activeFR.series || activeFR.series.length < 2) return null;
  const { c, ctx, w, h } = prep;
  const pad = { l: 46, r: 16, t: 28, b: 28 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  const S = activeFR.series;

  let i0 = Math.max(0, activeFR.maxTopHour - 7 * 24);
  let i1 = Math.min(S.length - 1, i0 + 14 * 24);
  if (i1 - i0 < 24) {
    i0 = Math.max(0, S.length - 14 * 24);
    i1 = S.length - 1;
  }
  const len = i1 - i0 + 1;
  if (len < 2) return null;

  let yMin = 100;
  let yMax = -100;
  for (let i = i0; i <= i1; i++) {
    yMin = Math.min(yMin, S[i].Te, S[i].Top);
    yMax = Math.max(yMax, S[i].Te, S[i].Top, thresholdC + 1);
  }
  yMin = Math.floor((yMin - 1) / 5) * 5;
  yMax = Math.ceil((yMax + 1) / 5) * 5;
  if (yMax <= yMin) yMax = yMin + 10;

  const xOf = r => pad.l + (r / (len - 1)) * pw;
  const yOf = v => pad.t + ph - ((v - yMin) / (yMax - yMin)) * ph;

  ctx.font = '11px Inter, sans-serif';
  const gridCol = cssVar('--grid-line');
  const txtCol = cssVar('--text-muted');

  for (let y = yMin; y <= yMax; y += 5) {
    const py = yOf(y);
    ctx.strokeStyle = gridCol;
    ctx.beginPath();
    ctx.moveTo(pad.l, py);
    ctx.lineTo(w - pad.r, py);
    ctx.stroke();
    ctx.fillStyle = txtCol;
    ctx.textAlign = 'right';
    ctx.fillText(`${y}°C`, pad.l - 6, py + 4);
  }

  const totalD = Math.max(1, Math.round(len / 24));
  for (let d = 0; d <= totalD; d += 2) {
    const rel = Math.min(len - 1, d * 24);
    ctx.fillStyle = txtCol;
    ctx.textAlign = 'center';
    ctx.fillText(`J${S[i0 + rel].d + 1}`, xOf(rel), h - 8);
  }

  // Remplissage rouge là où θ_op dépasse le seuil de confort
  const yThresh = yOf(thresholdC);
  ctx.fillStyle = 'rgba(242, 139, 130, 0.28)';
  ctx.beginPath();
  let inHot = false;
  for (let i = i0; i <= i1; i++) {
    const px = xOf(i - i0);
    const val = S[i].Top;
    if (val > thresholdC) {
      if (!inHot) {
        ctx.moveTo(px, yThresh);
        inHot = true;
      }
      ctx.lineTo(px, yOf(val));
    } else if (inHot) {
      ctx.lineTo(px, yThresh);
      ctx.closePath();
      inHot = false;
    }
  }
  if (inHot) {
    ctx.lineTo(xOf(len - 1), yThresh);
    ctx.closePath();
  }
  ctx.fill();

  // Température extérieure
  ctx.strokeStyle = '#9aa0a6';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (let i = i0; i <= i1; i++) {
    const px = xOf(i - i0);
    const py = yOf(S[i].Te);
    if (i === i0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Ligne seuil 26.5 °C
  ctx.strokeStyle = '#81c995';
  ctx.lineWidth = 1.8;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.l, yThresh);
  ctx.lineTo(w - pad.r, yThresh);
  ctx.stroke();
  ctx.setLineDash([]);

  // Température intérieure
  ctx.strokeStyle = '#4285f4';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (let i = i0; i <= i1; i++) {
    const px = xOf(i - i0);
    const py = yOf(S[i].Top);
    if (i === i0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  const leg = [
    ['Temp. intérieure', '#4285f4'],
    ['Temp. extérieure', '#9aa0a6'],
    [`Seuil confort (${thresholdC.toFixed(1)} °C)`, '#81c995'],
    ['Dépassement', '#f28b82']
  ];
  let lx = pad.l + 4;
  for (const [lbl, col] of leg) {
    const itemW = ctx.measureText(lbl).width + 26;
    if (lx + itemW > w - pad.r) break;
    ctx.fillStyle = col;
    ctx.fillRect(lx, 8, 12, 4);
    ctx.fillStyle = cssVar('--text');
    ctx.textAlign = 'left';
    ctx.fillText(lbl, lx + 16, 13);
    lx += itemW + 10;
  }

  return { c, i0, i1, pad, pw, activeFR, thresholdC };
}

/**
 * Graphique détaillé des puissances de pointe [W] et apports estivaux [kWh] par source de gain
 * (Personnes, Lampes, Appareils, Solaire transmis vs brut hors stores, Conduction entrante).
 */
export function drawGainsDetailChart(activeFR) {
  const prep = prepCanvas('chartGainsDetail');
  if (!prep || !activeFR.gains) return;
  const { ctx, w, h } = prep;
  const g = activeFR.gains;

  const items = [
    { lbl: 'Personnes (occupants)', peakW: g.people.peakW, kwh: g.people.summerKWh, col: '#c58af9' },
    { lbl: 'Lampes (éclairage)', peakW: g.lighting.peakW, kwh: g.lighting.summerKWh, col: '#fdd663' },
    { lbl: 'Appareils (appliances)', peakW: g.appliances.peakW, kwh: g.appliances.summerKWh, col: '#ffab70' },
    {
      lbl: 'Solaire transmis (avec stores)',
      peakW: g.solarTransmitted.peakW,
      kwh: g.solarTransmitted.summerKWh,
      col: '#f28b82',
      ghostW: g.solarUnshaded.peakW
    },
    { lbl: 'Conduction entrante', peakW: g.conductionIn.peakW, kwh: g.conductionIn.summerKWh, col: '#78d9ec' }
  ];

  const maxW = Math.max(50, ...items.map(x => Math.max(x.peakW, x.ghostW || 0)));
  const padL = 190;
  const padR = 175;
  const padT = 22;
  const padB = 10;
  const rowH = (h - padT - padB) / items.length;
  const barMaxW = Math.max(40, w - padL - padR);

  ctx.font = '11px Inter, sans-serif';
  ctx.fillStyle = cssVar('--text-muted');
  ctx.textAlign = 'left';
  ctx.fillText('Puissance de pointe [W] (contour = solaire brut sans stores)', padL, 13);

  items.forEach((it, i) => {
    const y = padT + i * rowH;
    const bh = Math.max(10, rowH - 13);
    const by = y + 4;

    ctx.fillStyle = cssVar('--text-muted');
    ctx.textAlign = 'right';
    ctx.fillText(it.lbl, padL - 10, by + bh * 0.72);

    if (it.ghostW && it.ghostW > it.peakW) {
      const gw = (it.ghostW / maxW) * barMaxW;
      ctx.strokeStyle = 'rgba(129, 201, 149, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(padL, by, gw, bh);
      ctx.setLineDash([]);
    }

    const bw = (Math.max(0, it.peakW) / maxW) * barMaxW;
    ctx.fillStyle = it.col;
    if (bw > 0) fillRoundedRect(ctx, padL, by, bw, bh, 4);

    const endX = padL + Math.max(bw, (it.ghostW || 0) > it.peakW ? (it.ghostW / maxW) * barMaxW : 0) + 8;
    ctx.fillStyle = cssVar('--text');
    ctx.textAlign = 'left';
    const labelTxt = it.ghostW && it.ghostW > it.peakW
      ? `${it.peakW.toFixed(0)} W (brut ${it.ghostW.toFixed(0)} W) • ${it.kwh.toFixed(0)} kWh`
      : `${it.peakW.toFixed(0)} W • ${it.kwh.toFixed(0)} kWh`;
    ctx.fillText(labelTxt, endX, by + bh * 0.72);
  });
}
