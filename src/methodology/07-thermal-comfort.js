/**
 * @fileoverview Étape 07 — Évaluation complète du Confort Thermique selon différentes
 * normes et études scientifiques internationales :
 *   1. EN 16798-1:2019 (ex-EN 15251) — Confort adaptatif européen (Cat. I, II, III)
 *   2. ASHRAE 55-2020 (de Dear & Brager, 1998) — Acceptabilité adaptative 90 % / 80 %
 *   3. ISO 7730:2005 — Modèle analytique PMV / PPD de Fanger + asymétrie air-rayonnement
 *   4. CIBSE TM52 (2013) & CIBSE TM59 (2017) — Sévérité de surchauffe & chambres la nuit
 *   5. OMS (WHO Housing & Health Guidelines, 2018) & Lan et al. (2017) — Santé & sommeil
 *   6. Seppänen, Fisk & Lei (2006, LBNL-60952) — Productivité cognitive au travail
 */

import {
  ASHRAE55_LIMITS,
  CIBSE_THRESHOLDS,
  COMFORT_DEFAULTS,
  EN16798_LIMITS,
  HEALTH_AND_SLEEP,
  ISO7730_CLASSES,
  SEPPANEN_2006
} from '../standards/comfort-references.js';

/**
 * Solveur itératif exact de Fanger PMV / PPD conforme à ISO 7730:2005 Annexe D.
 *
 * @param {number} ta Température d'air intérieure [°C]
 * @param {number} tr Température radiante moyenne [°C] (dans le 5R1C : nœud Ts)
 * @param {number} vel Vitesse relative de l'air [m/s]
 * @param {number} rh Humidité relative [%]
 * @param {number} met Activité métabolique [met] (1 met = 58.15 W/m²)
 * @param {number} clo Isolation vestimentaire [clo] (1 clo = 0.155 m²·K/W)
 * @param {number} [wme=0] Travail mécanique extérieur [met]
 * @returns {{ pmv: number, ppd: number, tcl: number }}
 */
export function calculateFangerPMV(ta, tr, vel = 0.15, rh = 50, met = 1.2, clo = 0.5, wme = 0) {
  const M = met * 58.15;
  const W = wme * 58.15;
  const MW = M - W;

  // Pression partielle de vapeur d'eau [Pa]
  const pa = rh * 10 * Math.exp(16.6536 - 4030.183 / (ta + 235));

  const Icl = 0.155 * clo;
  const fcl = Icl <= 0.078 ? 1.0 + 1.29 * Icl : 1.05 + 0.645 * Icl;

  const hcf = 12.1 * Math.sqrt(Math.max(0.01, vel));
  const taa = ta + 273.15;
  const tra = tr + 273.15;

  const tcla = taa + (35.5 - ta) / (3.5 * (Icl + 0.1));
  const p1 = Icl * fcl;
  const p2 = p1 * 3.96;
  const p3 = p1 * 100;
  const p4 = p1 * taa;
  const p5 = 308.7 - 0.028 * MW + p2 * Math.pow(tra / 100, 4);

  let xn = tcla / 100;
  let xf = xn;
  let hc = hcf;
  const eps = 0.00015;

  for (let n = 0; n < 150; n++) {
    xf = 0.5 * (xf + xn);
    const hcn = 2.38 * Math.pow(Math.abs(100 * xf - taa), 0.25);
    hc = Math.max(hcf, hcn);
    xn = (p5 + p4 * hc - p2 * Math.pow(xf, 4)) / (100 + p3 * hc);
    if (Math.abs(xn - xf) <= eps) break;
  }

  const tcl = 100 * xn - 273.15;

  // Pertes thermiques physiologiques [W/m²]
  const hl1 = 3.05 * 0.001 * (5733 - 6.99 * MW - pa);
  const hl2 = MW > 58.15 ? 0.42 * (MW - 58.15) : 0;
  const hl3 = 1.7 * 0.00001 * M * (5867 - pa);
  const hl4 = 0.0014 * M * (34 - ta);
  const hl5 = 3.96 * fcl * (Math.pow(xn, 4) - Math.pow(tra / 100, 4));
  const hl6 = fcl * hc * (tcl - ta);

  const ts = 0.303 * Math.exp(-0.036 * M) + 0.028;
  const pmvRaw = ts * (MW - hl1 - hl2 - hl3 - hl4 - hl5 - hl6);
  const pmv = Math.max(-3.5, Math.min(3.5, pmvRaw));
  const ppd = 100 - 95 * Math.exp(-0.03353 * Math.pow(pmv, 4) - 0.2179 * Math.pow(pmv, 2));

  return { pmv, ppd, tcl };
}

/**
 * Productivité relative au bureau selon Seppänen, Fisk & Lei (2006, LBNL-60952).
 * Normalisée à 100 % à la température optimale (≈ 21.75 °C).
 * @param {number} tempC Température opérative [°C]
 * @returns {number} Productivité relative [%]
 */
export function calculateSeppanenProductivityPct(tempC) {
  const evalPoly = T =>
    SEPPANEN_2006.a3 * T * T * T +
    SEPPANEN_2006.a2 * T * T +
    SEPPANEN_2006.a1 * T +
    SEPPANEN_2006.a0;

  const pOpt = evalPoly(SEPPANEN_2006.tOpt);
  const tClamped = Math.max(15, Math.min(35, tempC));
  return Math.max(60, Math.min(100, (evalPoly(tClamped) / pOpt) * 100));
}

/**
 * Évalue l'ensemble des indicateurs de confort thermique sur la série horaire d'un étage.
 *
 * @param {Array<object>} series Série horaire issue de `executeEngine`
 * @param {object} [userParams] Paramètres occupant { clo, met, airSpeed, rh }
 */
export function evaluateThermalComfort(series, userParams = {}) {
  const params = { ...COMFORT_DEFAULTS, ...userParams };
  if (!Array.isArray(series) || series.length === 0) return null;

  // --- Compteurs EN 16798-1 (période d'occupation, plage 10 ≤ θ_rm ≤ 30 °C) ---
  let enOccTotal = 0;
  let enCat1Hot = 0;
  let enCat2Hot = 0;
  let enCat3Hot = 0;
  let enCat1Ok = 0;
  let enCat2Ok = 0;
  let enCat3Ok = 0;

  // --- Compteurs ASHRAE 55 (occupation, 10 ≤ θ_pma ≤ 33.5 °C) ---
  let ashOccTotal = 0;
  let ash90Ok = 0;
  let ash80Ok = 0;
  let ash80Hot = 0;

  // --- Compteurs Fanger PMV / PPD (été Mai–Septembre occupé) ---
  let pmvSummerCount = 0;
  let pmvSum = 0;
  let ppdSum = 0;
  let pmvMax = -99;
  let ppdMax = 0;
  let clsA = 0;
  let clsB = 0;
  let clsC = 0;
  let clsWarm = 0;
  let clsHot = 0;
  let maxRadiantDelta = 0;

  // --- Compteurs CIBSE TM52 (1er Mai – 30 Septembre, heures occupées) ---
  let tm52SummerOccH = 0;
  let tm52Exceed1KHours = 0;
  let tm52MaxDeltaT = -99;
  const dailyWeMap = new Map();

  // --- Compteurs CIBSE TM59 & Santé / Sommeil OMS (22h–07h) + Suisse SECO / OLT 3 ---
  let nightTotalH = 0;
  let nightOver24H = 0;
  let nightOver26H = 0;
  let occOver24H = 0;
  let occOver26H = 0;
  let occOver28H = 0;
  let occOver30H = 0;
  let occTotalH = 0;
  const nightMinMap = new Map();

  // --- Compteurs Seppänen 2006 (Productivité en heures occupées estivales) ---
  let prodSummerCount = 0;
  let prodSum = 0;
  let prodMin = 100;
  let prodLossOver2PctH = 0;

  for (const pt of series) {
    const radDelta = Math.abs(pt.Tair - pt.Ts);
    if (pt.isOccHour && radDelta > maxRadiantDelta) maxRadiantDelta = radDelta;

    // 1. Santé OMS & Sommeil (22h–07h) + seuils SECO OLT 3 (26 / 28 / 30 °C)
    if (pt.isOccHour) {
      occTotalH++;
      if (pt.Top > HEALTH_AND_SLEEP.whoGeneralMaxC) occOver24H++;
      if (pt.Top > 26.0) occOver26H++;
      if (pt.Top > 28.0) occOver28H++;
      if (pt.Top > 30.0) occOver30H++;
    }

    const isNightSleep = pt.hod >= 22 || pt.hod < 7;
    if (isNightSleep) {
      nightTotalH++;
      if (pt.Top > HEALTH_AND_SLEEP.whoSleepComfortC) nightOver24H++;
      if (pt.Top > HEALTH_AND_SLEEP.sleepDisruptC) nightOver26H++;

      const nightGroupDay = pt.hod >= 22 ? pt.d : Math.max(0, pt.d - 1);
      const prevMin = nightMinMap.get(nightGroupDay);
      if (prevMin === undefined || pt.Top < prevMin) nightMinMap.set(nightGroupDay, pt.Top);
    }

    if (!pt.isOccHour) continue;

    // 2. EN 16798-1 Adaptatif
    const tRm = pt.tRmEN;
    if (tRm >= EN16798_LIMITS.minTrm && tRm <= EN16798_LIMITS.maxTrm) {
      enOccTotal++;
      const tc = EN16798_LIMITS.slope * tRm + EN16798_LIMITS.intercept;
      const diff = pt.Top - tc;
      if (diff > EN16798_LIMITS.categories.I.upperOffset) enCat1Hot++;
      else if (diff >= EN16798_LIMITS.categories.I.lowerOffset) enCat1Ok++;

      if (diff > EN16798_LIMITS.categories.II.upperOffset) enCat2Hot++;
      else if (diff >= EN16798_LIMITS.categories.II.lowerOffset) enCat2Ok++;

      if (diff > EN16798_LIMITS.categories.III.upperOffset) enCat3Hot++;
      else if (diff >= EN16798_LIMITS.categories.III.lowerOffset) enCat3Ok++;
    }

    // 3. ASHRAE 55-2020 Adaptatif
    const tPma = pt.tPmaASHRAE;
    if (tPma >= ASHRAE55_LIMITS.minTrm && tPma <= ASHRAE55_LIMITS.maxTrm) {
      ashOccTotal++;
      const tcAsh = ASHRAE55_LIMITS.slope * tPma + ASHRAE55_LIMITS.intercept;
      const absDiff = Math.abs(pt.Top - tcAsh);
      if (absDiff <= ASHRAE55_LIMITS.band90) ash90Ok++;
      if (absDiff <= ASHRAE55_LIMITS.band80) ash80Ok++;
      if (pt.Top - tcAsh > ASHRAE55_LIMITS.band80) ash80Hot++;
    }

    // 4. CIBSE TM52 + Fanger PMV/PPD (jour 07h–22h) + Seppänen 2006 (saison estivale Mai–Sept)
    if (pt.isSummer) {
      tm52SummerOccH++;
      const tMaxTM52 = EN16798_LIMITS.slope * tRm + EN16798_LIMITS.intercept + 3.0;
      const dT = pt.Top - tMaxTM52;
      if (dT > tm52MaxDeltaT) tm52MaxDeltaT = dT;
      if (Math.round(dT) >= 1) {
        tm52Exceed1KHours++;
      }
      if (dT > 0) {
        dailyWeMap.set(pt.d, (dailyWeMap.get(pt.d) || 0) + dT);
      }

      // Fanger PMV évalué sur les heures occupées de jour (07h–22h) cohérentes avec la tenue estivale
      if (pt.hod >= 7 && pt.hod < 22) {
        const { pmv, ppd } = calculateFangerPMV(
          pt.Tair,
          pt.Ts,
          params.airSpeed,
          params.rh,
          params.met,
          params.clo
        );
        pmvSummerCount++;
        pmvSum += pmv;
        ppdSum += ppd;
        if (pmv > pmvMax) pmvMax = pmv;
        if (ppd > ppdMax) ppdMax = ppd;

        const absPmv = Math.abs(pmv);
        if (absPmv <= ISO7730_CLASSES.A.maxAbsPmv) clsA++;
        if (absPmv <= ISO7730_CLASSES.B.maxAbsPmv) clsB++;
        if (absPmv <= ISO7730_CLASSES.C.maxAbsPmv) clsC++;
        if (pmv > 0.7 && pmv <= 2.0) clsWarm++;
        else if (pmv > 2.0) clsHot++;
      }

      const prod = calculateSeppanenProductivityPct(pt.Top);
      prodSummerCount++;
      prodSum += prod;
      if (prod < prodMin) prodMin = prod;
      if (100 - prod > 2.0) prodLossOver2PctH++;
    }
  }

  let tm52MaxWe = 0;
  let tm52DaysOver6 = 0;
  for (const we of dailyWeMap.values()) {
    if (we > tm52MaxWe) tm52MaxWe = we;
    if (we > CIBSE_THRESHOLDS.tm52MaxDailyWe) tm52DaysOver6++;
  }

  const tm52ExceedPct = tm52SummerOccH > 0 ? (tm52Exceed1KHours / tm52SummerOccH) * 100 : 0;
  const tm52Crit1Fail = tm52ExceedPct > CIBSE_THRESHOLDS.tm52MaxExceedPct;
  const tm52Crit2Fail = tm52MaxWe > CIBSE_THRESHOLDS.tm52MaxDailyWe;
  const tm52Crit3Fail = tm52MaxDeltaT > CIBSE_THRESHOLDS.tm52MaxDeltaT;
  const tm52FailCount = [tm52Crit1Fail, tm52Crit2Fail, tm52Crit3Fail].filter(Boolean).length;

  const tm59NightOver26Pct = nightTotalH > 0 ? (nightOver26H / nightTotalH) * 100 : 0;
  const tm59Pass = tm59NightOver26Pct <= CIBSE_THRESHOLDS.tm59BedroomMaxPct;

  let indoorTropicalNights = 0;
  for (const minT of nightMinMap.values()) {
    if (minT >= HEALTH_AND_SLEEP.whoSleepComfortC) indoorTropicalNights++;
  }

  const meanPmv = pmvSummerCount > 0 ? pmvSum / pmvSummerCount : 0;
  const meanPpd = pmvSummerCount > 0 ? ppdSum / pmvSummerCount : 5;
  const meanProd = prodSummerCount > 0 ? prodSum / prodSummerCount : 100;

  return {
    params,
    en16798: {
      occHoursEvaluated: enOccTotal,
      cat1OkPct: enOccTotal > 0 ? (enCat1Ok / enOccTotal) * 100 : 100,
      cat2OkPct: enOccTotal > 0 ? (enCat2Ok / enOccTotal) * 100 : 100,
      cat3OkPct: enOccTotal > 0 ? (enCat3Ok / enOccTotal) * 100 : 100,
      cat1HotH: enCat1Hot,
      cat2HotH: enCat2Hot,
      cat3HotH: enCat3Hot,
      passCat2: enCat2Hot === 0 || (enOccTotal > 0 && (enCat2Hot / enOccTotal) * 100 <= 3.0)
    },
    ashrae55: {
      occHoursEvaluated: ashOccTotal,
      pct90Ok: ashOccTotal > 0 ? (ash90Ok / ashOccTotal) * 100 : 100,
      pct80Ok: ashOccTotal > 0 ? (ash80Ok / ashOccTotal) * 100 : 100,
      hot80H: ash80Hot,
      pass80: ashOccTotal === 0 || (ash80Hot / ashOccTotal) * 100 <= 5.0
    },
    fanger: {
      summerHours: pmvSummerCount,
      meanPmv,
      maxPmv: pmvMax > -90 ? pmvMax : 0,
      meanPpd,
      maxPpd: ppdMax,
      pctClassA: pmvSummerCount > 0 ? (clsA / pmvSummerCount) * 100 : 100,
      pctClassB: pmvSummerCount > 0 ? (clsB / pmvSummerCount) * 100 : 100,
      pctClassC: pmvSummerCount > 0 ? (clsC / pmvSummerCount) * 100 : 100,
      warmHours: clsWarm,
      hotHours: clsHot,
      maxRadiantDelta
    },
    cibse: {
      summerOccH: tm52SummerOccH,
      exceed1KHours: tm52Exceed1KHours,
      exceedPct: tm52ExceedPct,
      maxDailyWe: tm52MaxWe,
      daysOver6: tm52DaysOver6,
      maxDeltaT: tm52MaxDeltaT > -90 ? tm52MaxDeltaT : 0,
      crit1Fail: tm52Crit1Fail,
      crit2Fail: tm52Crit2Fail,
      crit3Fail: tm52Crit3Fail,
      failCount: tm52FailCount,
      tm52Pass: tm52FailCount < 2,
      tm59NightOver26H: nightOver26H,
      tm59NightOver26Pct,
      tm59Pass
    },
    healthSleep: {
      occOver24H,
      occOver24Pct: occTotalH > 0 ? (occOver24H / occTotalH) * 100 : 0,
      nightOver24H,
      nightOver26H,
      indoorTropicalNights
    },
    secoOlt3: {
      occTotalH,
      occWithin26Pct: occTotalH > 0 ? ((occTotalH - occOver26H) / occTotalH) * 100 : 100,
      occOver26H,
      occOver28H,
      occOver30H
    },
    productivity: {
      summerHours: prodSummerCount,
      meanRelativePct: meanProd,
      meanLossPct: Math.max(0, 100 - meanProd),
      peakLossPct: Math.max(0, 100 - prodMin),
      hoursLossOver2Pct: prodLossOver2PctH
    }
  };
}
