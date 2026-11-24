/**
 * @fileoverview Moteur graphique Canvas haute résolution (DPI-aware, thème sombre & clair) pour :
 *  - Évolution horaire θ_op(t), θ_e(t), limite SIA 180 avec vraies dates calendaires & zone rouge
 *  - Superposition multi-variantes (comparateur style Lesosai)
 *  - Domaine adaptatif SIA 180 (θ_op vs θ_rm,48h)
 *  - Bilan thermique estival (gains & déperditions)
 *  - Apports solaires par orientation
 *  - Comparatif des normes de confort adaptatif (EN 16798-1, SECO, SIA 180)
 */

import { EN16798_LIMITS } from '../standards/comfort-references.js';
import { getProjectComfortLimits, getSIA180Limits } from '../standards/sia180.js';

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_SHORT_FR = [
  'jan.', 'fév.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'
];

/**
 * Convertit un index de jour de l'année (0..364) en date calendaire lisible (ex. "11 août").
 */
export function formatDayOfYearFR(dayIdx) {
  let rem = ((Math.floor(dayIdx) % 365) + 365) % 365;
  for (let m = 0; m < 12; m++) {
    if (rem < MONTH_DAYS[m]) {
      return `${rem + 1} ${MONTH_SHORT_FR[m]}`;
    }
    rem -= MONTH_DAYS[m];
  }
  return '31 déc.';
}

function formatAxisDateFR(dayIdx, winMode) {
  if (winMode === 'year') {
    let rem = ((Math.floor(dayIdx) % 365) + 365) % 365;
    for (let m = 0; m < 12; m++) {
      if (rem < MONTH_DAYS[m]) return MONTH_SHORT_FR[m];
      rem -= MONTH_DAYS[m];
    }
    return 'déc.';
  }
  return formatDayOfYearFR(dayIdx);
}

export function isLightTheme() {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light';
}

export function getChartPalette() {
  if (isLightTheme()) {
    return {
      primary: '#1a5bc4',
      ext: '#64748b',
      limit: '#15803d',
      danger: '#dc2626',
      dangerFill: 'rgba(220, 38, 38, 0.22)',
      amber: '#d97706',
      orange: '#ea580c',
      violet: '#7c3aed',
      cyan: '#0284c7',
      series: ['#1a5bc4', '#d97706', '#7c3aed', '#0284c7', '#dc2626', '#15803d'],
      dotOk: 'rgba(26, 91, 196, 0.42)',
      dotHot: 'rgba(220, 38, 38, 0.82)'
    };
  }
  return {
    primary: '#4285f4',
    ext: '#9aa0a6',
    limit: '#81c995',
    danger: '#f28b82',
    dangerFill: 'rgba(242, 139, 130, 0.28)',
    amber: '#fdd663',
    orange: '#ffab70',
    violet: '#c58af9',
    cyan: '#78d9ec',
    series: ['#4285f4', '#fdd663', '#c58af9', '#78d9ec', '#ffab70', '#81c995'],
    dotOk: 'rgba(168, 199, 250, 0.36)',
    dotHot: 'rgba(242, 139, 130, 0.78)'
  };
}

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

function fillOverheatZone(ctx, S, i0, i1, xOf, yOf, getThresh, fillStyle) {
  ctx.fillStyle = fillStyle;
  let segStart = -1;
  const flushSegment = (a, b) => {
    ctx.beginPath();
    ctx.moveTo(xOf(a - i0), yOf(getThresh(S[a])));
    for (let k = a; k <= b; k++) {
      ctx.lineTo(xOf(k - i0), yOf(S[k].Top));
    }
    for (let k = b; k >= a; k--) {
      ctx.lineTo(xOf(k - i0), yOf(getThresh(S[k])));
    }
    ctx.closePath();
    ctx.fill();
  };

  for (let i = i0; i <= i1; i++) {
    const isHot = S[i].Top > getThresh(S[i]);
    if (isHot) {
      if (segStart < 0) segStart = i;
    } else if (segStart >= 0) {
      flushSegment(segStart, i - 1);
      segStart = -1;
    }
  }
  if (segStart >= 0) {
    flushSegment(segStart, i1);
  }
}

function resolveWindowBounds(S, maxTopHour, winMode) {
  let i0 = 0;
  let i1 = S.length - 1;
  if (winMode === 'day24') {
    i0 = Math.max(0, S.length - 24);
    i1 = S.length - 1;
  } else if (winMode === 'hottest14') {
    i0 = Math.max(0, maxTopHour - 7 * 24);
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
  return { i0, i1 };
}

function drawDateAxisLabels(ctx, S, i0, len, xOf, h, winMode, txtCol, pad = null, ph = 0, gridCol = null) {
  ctx.fillStyle = txtCol;
  ctx.textAlign = 'center';
  if (winMode === 'day24' || len <= 25) {
    for (let rel = 0; rel < len; rel++) {
      const hod = S[i0 + rel]?.hod ?? rel;
      const showTick = hod % 2 === 0 || rel === len - 1;
      if (!showTick) continue;
      const px = xOf(rel);
      if (pad && ph > 0 && gridCol && rel > 0 && rel < len - 1) {
        ctx.strokeStyle = gridCol;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(px, pad.t);
        ctx.lineTo(px, pad.t + ph);
        ctx.stroke();
      }
      ctx.fillStyle = txtCol;
      ctx.fillText(`${String(hod).padStart(2, '0')}h`, px, h - 8);
    }
    return;
  }
  const totalD = Math.max(1, Math.round(len / 24));
  const stepD = totalD <= 20 ? 2 : totalD <= 100 ? 12 : 31;
  for (let d = 0; d <= totalD; d += stepD) {
    const rel = Math.min(len - 1, d * 24);
    ctx.fillText(formatAxisDateFR(S[i0 + rel].d, winMode), xOf(rel), h - 8);
  }
}

export function drawTimeChart(res, activeFR, winMode, compareFloors) {
  const prep = prepCanvas('chartTime');
  if (!prep || !activeFR.series || activeFR.series.length < 2) return null;
  const { c, ctx, w, h } = prep;
  const pal = getChartPalette();
  const pad = { l: 46, r: 16, t: 26, b: 28 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  const S = activeFR.series;

  const { i0, i1 } = resolveWindowBounds(S, activeFR.maxTopHour, winMode);
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

  drawDateAxisLabels(ctx, S, i0, len, xOf, h, winMode, txtCol, pad, ph, gridCol);
  fillOverheatZone(ctx, S, i0, i1, xOf, yOf, pt => pt.limUpper, pal.dangerFill);

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

  plot(S, p => p.Te, pal.ext, winMode === 'year' ? 0.9 : 1.2);
  plot(S, p => p.limUpper, pal.limit, 1.7, [5, 4]);

  const leg = [
    ['θ_e Ext.', pal.ext],
    ['Limite SIA', pal.limit],
    ['Surchauffe', pal.danger]
  ];
  if (cmp) {
    res.floorResults.forEach((fr, k) => {
      const cCol = pal.series[k % pal.series.length];
      plot(fr.series, p => p.Top, cCol, fr === activeFR ? 2.2 : 1.35);
      leg.push([fr.floor.name.slice(0, 14), cCol]);
    });
  } else {
    plot(S, p => p.Top, pal.primary, winMode === 'year' ? 1.5 : 2.2);
    if (winMode === 'day24') {
      ctx.fillStyle = pal.primary;
      for (let i = i0; i <= i1; i++) {
        ctx.beginPath();
        ctx.arc(xOf(i - i0), yOf(S[i].Top), 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    leg.push(['θ_op Int.', pal.primary]);
  }

  let lx = pad.l + 4;
  ctx.font = '11px Inter, sans-serif';
  for (const [lbl, col] of leg) {
    const itemW = ctx.measureText(lbl).width + 26;
    if (lx + itemW > w - pad.r) break;
    ctx.fillStyle = col;
    ctx.fillRect(lx, 7, 13, 3.5);
    ctx.fillStyle = cssVar('--text');
    ctx.textAlign = 'left';
    ctx.fillText(lbl, lx + 17, 12);
    lx += itemW + 8;
  }

  return { c, i0, i1, pad, pw, activeFR, isDay24: winMode === 'day24' };
}

export function drawSIAChart(activeFR, siaCurveMode, project = null) {
  const prep = prepCanvas('chartSIA');
  if (!prep || !activeFR.series) return;
  const { ctx, w, h } = prep;
  const pal = getChartPalette();
  const pad = { l: 46, r: 16, t: 22, b: 30 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;

  const limAt = x => (project ? getProjectComfortLimits(x, project) : getSIA180Limits(x, siaCurveMode));

  const xMin = 5;
  const xMax = 28;
  const yMin = 19;
  const yMax = Math.max(32, Math.ceil(activeFR.maxTop + 1));

  const xOf = x => pad.l + ((x - xMin) / (xMax - xMin)) * pw;
  const yOf = y => pad.t + ph - ((y - yMin) / (yMax - yMin)) * ph;

  ctx.fillStyle = cssVar('--chart-band');
  ctx.beginPath();
  for (let x = xMin; x <= xMax; x += 0.25) {
    const l = limAt(x);
    if (x === xMin) ctx.moveTo(xOf(x), yOf(l.upper));
    else ctx.lineTo(xOf(x), yOf(l.upper));
  }
  for (let x = xMax; x >= xMin; x -= 0.25) {
    ctx.lineTo(xOf(x), yOf(limAt(x).lower));
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

  ctx.strokeStyle = pal.limit;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let x = xMin; x <= xMax; x += 0.25) {
    const l = limAt(x);
    if (x === xMin) ctx.moveTo(xOf(x), yOf(l.upper));
    else ctx.lineTo(xOf(x), yOf(l.upper));
  }
  ctx.stroke();

  for (const pt of activeFR.series) {
    if (!pt.isOccHour || pt.tRm48 < xMin || pt.tRm48 > xMax) continue;
    ctx.fillStyle = pt.isOverSIA ? pal.dotHot : pal.dotOk;
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
  const pal = getChartPalette();
  const b = activeFR.summerBal;
  const items = [
    ['Apports solaires (+)', b.sol, pal.amber],
    ['Gains internes (+)', b.int, pal.danger],
    ['Conduction entrante (+)', b.trIn, pal.orange],
    ['Conduction sortante (-)', b.trOut, pal.primary],
    ['Ventilation diurne (-)', b.veDayOut, pal.cyan],
    ['Déstockage nuit (-)', b.veNightOut, pal.limit]
  ];
  if (Math.abs(b.slabNet) >= 1) {
    items.push([
      b.slabNet >= 0 ? 'Échange dalles (+)' : 'Échange dalles (-)',
      Math.abs(b.slabNet),
      pal.violet
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
  const pal = getChartPalette();
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
      k === 'R' ? pal.danger : ['S', 'SO', 'O', 'E', 'SE'].includes(k) ? pal.amber : pal.primary;
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

export function drawAdaptiveComparisonChart(activeFR, siaCurveMode) {
  const prep = prepCanvas('chartComfortAdaptive');
  if (!prep || !activeFR.series) return;
  const { ctx, w, h } = prep;
  const pal = getChartPalette();
  const pad = { l: 46, r: 16, t: 26, b: 30 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;

  const xMin = 10;
  const xMax = 28;
  const yMin = 19;
  const yMax = Math.max(32, Math.ceil(activeFR.maxTop + 1));

  const xOf = x => pad.l + ((x - xMin) / (xMax - xMin)) * pw;
  const yOf = y => pad.t + ph - ((y - yMin) / (yMax - yMin)) * ph;

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

  drawCurve(x => EN16798_LIMITS.slope * x + EN16798_LIMITS.intercept + 2, pal.cyan, [4, 3]);
  drawCurve(x => EN16798_LIMITS.slope * x + EN16798_LIMITS.intercept + 3, pal.limit);
  drawCurve(x => EN16798_LIMITS.slope * x + EN16798_LIMITS.intercept + 4, pal.amber, [2, 3]);
  drawCurve(() => 26.0, pal.violet, [6, 4]);
  drawCurve(x => getSIA180Limits(x, siaCurveMode).upper, pal.danger, [5, 2]);

  for (const pt of activeFR.series) {
    if (!pt.isOccHour || pt.tRmEN < xMin || pt.tRmEN > xMax) continue;
    const cat2Up = EN16798_LIMITS.slope * pt.tRmEN + EN16798_LIMITS.intercept + 3;
    ctx.fillStyle = pt.Top > cat2Up ? pal.dotHot : pal.dotOk;
    ctx.beginPath();
    ctx.arc(xOf(pt.tRmEN), yOf(Math.max(yMin, Math.min(yMax, pt.Top))), 1.7, 0, Math.PI * 2);
    ctx.fill();
  }

  const leg = [
    ['EN Cat I', pal.cyan],
    ['EN Cat II', pal.limit],
    ['EN Cat III', pal.amber],
    ['SECO 26°C', pal.violet],
    ['SIA 180', pal.danger]
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

export function drawSimpleHeatwaveChart(
  res,
  activeFR,
  limitLabel = 'Seuil SIA 180',
  winMode = 'hottest14',
  compareFloors = false
) {
  const prep = prepCanvas('chartSimpleHeatwave');
  if (!prep || !activeFR.series || activeFR.series.length < 2) return null;
  const { c, ctx, w, h } = prep;
  const pal = getChartPalette();
  const pad = { l: 46, r: 16, t: 28, b: 28 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  const S = activeFR.series;

  const { i0, i1 } = resolveWindowBounds(S, activeFR.maxTopHour, winMode);
  const len = i1 - i0 + 1;
  if (len < 2) return null;

  const cmp = compareFloors && res && res.floorResults && res.floorResults.length > 1;
  const getLim = pt => pt.limUpper;

  let yMin = 100;
  let yMax = -100;
  for (let i = i0; i <= i1; i++) {
    yMin = Math.min(yMin, S[i].Te, S[i].Top);
    yMax = Math.max(yMax, S[i].Te, S[i].Top, getLim(S[i]) + 1);
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

  drawDateAxisLabels(ctx, S, i0, len, xOf, h, winMode, txtCol, pad, ph, gridCol);
  fillOverheatZone(ctx, S, i0, i1, xOf, yOf, getLim, pal.dangerFill);

  ctx.strokeStyle = pal.ext;
  ctx.lineWidth = winMode === 'year' ? 0.9 : 1.25;
  ctx.beginPath();
  for (let i = i0; i <= i1; i++) {
    const px = xOf(i - i0);
    const py = yOf(S[i].Te);
    if (i === i0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  ctx.strokeStyle = pal.limit;
  ctx.lineWidth = 1.8;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  for (let i = i0; i <= i1; i++) {
    const px = xOf(i - i0);
    const py = yOf(getLim(S[i]));
    if (i === i0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  const leg = [
    ['Temp. extérieure', pal.ext],
    [limitLabel, pal.limit],
    ['Surchauffe', pal.danger]
  ];
  if (cmp) {
    res.floorResults.forEach((fr, k) => {
      const col = pal.series[k % pal.series.length];
      ctx.strokeStyle = col;
      ctx.lineWidth = fr === activeFR ? (winMode === 'year' ? 1.5 : 2.3) : 1.3;
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const px = xOf(i - i0);
        const py = yOf(fr.series[i].Top);
        if (i === i0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      leg.unshift([fr.floor.name.slice(0, 14), col]);
    });
  } else {
    ctx.strokeStyle = pal.primary;
    ctx.lineWidth = winMode === 'year' ? 1.5 : 2.3;
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const px = xOf(i - i0);
      const py = yOf(S[i].Top);
      if (i === i0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    if (winMode === 'day24') {
      ctx.fillStyle = pal.primary;
      for (let i = i0; i <= i1; i++) {
        ctx.beginPath();
        ctx.arc(xOf(i - i0), yOf(S[i].Top), 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    leg.unshift(['Temp. intérieure', pal.primary]);
  }

  let lx = pad.l + 4;
  for (const [lbl, col] of leg) {
    const itemW = ctx.measureText(lbl).width + 24;
    if (lx + itemW > w - pad.r) break;
    ctx.fillStyle = col;
    ctx.fillRect(lx, 8, 12, 3.5);
    ctx.fillStyle = cssVar('--text');
    ctx.textAlign = 'left';
    ctx.fillText(lbl, lx + 16, 13);
    lx += itemW + 8;
  }

  return { c, i0, i1, pad, pw, activeFR, limitLabel, isDay24: winMode === 'day24' };
}

/**
 * Superpose les températures opératives intérieures de plusieurs variantes de projet
 * sur un graphique identique au rapport principal. Si des variantes ont des limites différentes
 * (ex. ventilation naturelle Fig. 3 vs VMC Fig. 4, Minergie ou Custom), chaque limite distincte
 * est tracée clairement en pointillés dans la couleur de sa variante.
 */
export function drawVariantsComparisonChart(entries, winMode = 'hottest14', activeVariantId = null) {
  const prep = prepCanvas('chartVariantsCompare');
  if (!prep || !entries || entries.length === 0) return null;
  const valid = entries.filter(e => e.wf && e.wf.series && e.wf.series.length >= 2);
  if (valid.length === 0) return null;

  const { c, ctx, w, h } = prep;
  const pal = getChartPalette();
  const pad = { l: 46, r: 16, t: 28, b: 28 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;

  const activeEntry = valid.find(e => e.id === activeVariantId) || valid[0];
  const refS = activeEntry.wf.series;
  const minLen = Math.min(...valid.map(e => e.wf.series.length));
  const { i0, i1 } = resolveWindowBounds(
    refS.slice(0, minLen),
    Math.min(minLen - 1, activeEntry.wf.maxTopHour || 0),
    winMode
  );
  const len = i1 - i0 + 1;
  if (len < 2) return null;

  const getEntryLim = (e, idx) => e.wf.series[idx].limUpper;
  const shortLimitTag = proj => {
    const pt = proj?.projectType || 'new';
    if (pt === 'minergie') return '26.5°C';
    if (pt === 'custom') {
      const cr = proj?.customReg || {};
      const t = Number(cr.maxTempC ?? 27.0).toFixed(1);
      return cr.limitMode === 'adaptive_cap' ? `Plaf. ${t}°` : `${t}°C`;
    }
    return proj?.siaCurveMode === 'fig4' ? 'Fig. 4 (VMC)' : 'Fig. 3 (nat.)';
  };

  // Regroupe les variantes qui partagent exactement la même courbe limite (écart ≤ 0.35 °C)
  const limitGroups = [];
  const stepCheck = Math.max(1, Math.floor((i1 - i0) / 48));
  for (const e of valid) {
    let matched = null;
    for (const grp of limitGroups) {
      let same = true;
      for (let i = i0; i <= i1; i += stepCheck) {
        if (Math.abs(getEntryLim(e, i) - getEntryLim(grp.rep, i)) > 0.35) {
          same = false;
          break;
        }
      }
      if (same) {
        matched = grp;
        break;
      }
    }
    if (matched) {
      matched.members.push(e);
    } else {
      limitGroups.push({ rep: e, members: [e], tag: shortLimitTag(e.project) });
    }
  }
  const limitDiffers = limitGroups.length > 1;

  let yMin = 100;
  let yMax = -100;
  for (let i = i0; i <= i1; i++) {
    yMin = Math.min(yMin, refS[i].Te, refS[i].Top);
    yMax = Math.max(yMax, refS[i].Te, refS[i].Top);
    for (const e of valid) {
      const pt = e.wf.series[i];
      yMin = Math.min(yMin, pt.Top, pt.limUpper - 2);
      yMax = Math.max(yMax, pt.Top, pt.limUpper + 1);
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

  drawDateAxisLabels(ctx, refS, i0, len, xOf, h, winMode, txtCol, pad, ph, gridCol);
  fillOverheatZone(ctx, refS, i0, i1, xOf, yOf, pt => pt.limUpper, pal.dangerFill);

  // Température extérieure de la variante active
  ctx.strokeStyle = pal.ext;
  ctx.lineWidth = winMode === 'year' ? 0.9 : 1.2;
  ctx.beginPath();
  for (let i = i0; i <= i1; i++) {
    const px = xOf(i - i0);
    const py = yOf(refS[i].Te);
    if (i === i0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Courbe(s) limite(s) : 1 courbe verte si identique, sinon 1 courbe pointillée par limite distincte dans la couleur de sa variante
  const leg = [['Temp. extérieure', pal.ext, false]];
  if (!limitDiffers) {
    ctx.strokeStyle = pal.limit;
    ctx.lineWidth = 1.8;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const px = xOf(i - i0);
      const py = yOf(refS[i].limUpper);
      if (i === i0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    leg.push([`Seuil ${limitGroups[0].tag}`, pal.limit, true]);
  } else {
    limitGroups.forEach(grp => {
      const limCol = grp.rep.color;
      ctx.strokeStyle = limCol;
      ctx.lineWidth = 1.75;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const px = xOf(i - i0);
        const py = yOf(getEntryLim(grp.rep, i));
        if (i === i0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Étiquette directe en bout de courbe pour distinguer instantanément les 2 limites (ex. Fig. 3 vs Fig. 4)
      const endY = yOf(getEntryLim(grp.rep, i1));
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.fillStyle = limCol;
      ctx.textAlign = 'right';
      ctx.fillText(`Lim. ${grp.tag}`, w - pad.r - 4, Math.max(pad.t + 10, endY - 5));
      ctx.font = '11px Inter, sans-serif';
      leg.push([`Lim. ${grp.tag}`, limCol, true]);
    });
  }
  leg.push(['Surchauffe', pal.danger, false]);

  valid.forEach(entry => {
    const isAct = entry === activeEntry;
    ctx.strokeStyle = entry.color;
    ctx.lineWidth = isAct ? (winMode === 'year' ? 1.6 : 2.4) : (winMode === 'year' ? 1.3 : 1.9);
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const px = xOf(i - i0);
      const py = yOf(entry.wf.series[i].Top);
      if (i === i0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    leg.unshift([entry.name.slice(0, 15), entry.color, false]);
  });

  let lx = pad.l + 4;
  for (const [lbl, col, isDashed] of leg) {
    const itemW = ctx.measureText(lbl).width + 22;
    if (lx + itemW > w - pad.r) break;
    if (isDashed) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 2]);
      ctx.beginPath();
      ctx.moveTo(lx, 10);
      ctx.lineTo(lx + 12, 10);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = col;
      ctx.fillRect(lx, 8, 12, 3.5);
    }
    ctx.fillStyle = cssVar('--text');
    ctx.textAlign = 'left';
    ctx.fillText(lbl, lx + 16, 13);
    lx += itemW + 6;
  }

  return {
    c,
    i0,
    i1,
    pad,
    pw,
    entries: valid,
    activeEntry,
    limitDiffers,
    limitGroups,
    getEntryLim,
    isDay24: winMode === 'day24'
  };
}
