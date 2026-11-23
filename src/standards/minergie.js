/**
 * @fileoverview Critères et validation Minergie pour la protection thermique estivale
 * (Publication Minergie & Justificatif SoWS Variante 2, Version 2023.2 / SIA 342 / SIA 2024).
 */

import { getFacadeGrossAreaForOrient } from './box3d-presets.js';
import { getMethod2GtotLimit } from './sia180.js';

export const MINERGIE_THRESHOLDS = {
  maxHoursOver265: 100,          // Max 100 h/an > 26.5 °C (confort estival Minergie 2023)
  tempLimitC: 26.5,              // Seuil de température opérative Minergie [°C]
  solarTriggerWm2: 200,          // Seuil d'activation des stores (SIA 380/2 §3.2.3.1 & 7.1.2) [W/m²]
  minThermalMassWhm2K: 30,       // C_R / A_SNP minimal Minergie / SIA 382/1 [Wh/(m²·K)]
  recommendedThermalMassWhm2K: 45, // Capacité thermique de référence EN-102 / SIA 180 [Wh/(m²·K)]
  maxRoomDepthRatio: 2.5,        // Profondeur max admissible A_SNP = 2.5 × h_libre
  minNightVentM3hm2: 10.0,       // Débit nocturne efficace de référence [m³/(h·m²)]
  defaultHorizonDeg: 20          // Angle d'horizon standard Minergie SoWS [°]
};

/**
 * Charges thermiques internes journalières indicatives [Wh/(m²·j)] selon SIA 2024 / SoWS.
 */
export const SIA2024_INTERNAL_LOAD_REF = {
  I: 113,   // Habitat collectif (Wohnen MFH)
  II: 113,  // Habitat individuel (Wohnen EFH)
  III: 145, // Administration / Bureau
  IV: 120,  // École
  V: 190,   // Commerce
  VI: 250,  // Restauration
  VII: 160, // Lieu de rassemblement
  VIII: 150,// Hôpital
  IX: 140,  // Industrie
  X: 50,    // Dépôt
  XI: 100,  // Installation sportive
  XII: 220  // Piscine couverte
};

/**
 * Détermine la classe minimale de résistance au vent recommandée (SIA 342 / Minergie SoWS)
 * en fonction de la hauteur du bâtiment, de la catégorie (I–II vs III–XI) et de l'exposition au föhn.
 *
 * @param {number} buildingHeightM Hauteur de construction [m] (min 2.5 m)
 * @param {'residential'|'office'} spaceType
 * @param {boolean} foehnExposed Exposition au föhn
 * @returns {{ minClass: number, windSpeedKmh: number, label: string }}
 */
export function getMinergieRecommendedWindClass(buildingHeightM = 6.0, spaceType = 'residential', foehnExposed = false) {
  const h = Math.max(2.5, Number(buildingHeightM) || 2.5);
  let minClass = 5; // Exigence de base Minergie : classe 5 (75 km/h)
  if (foehnExposed || h > 15.0 || (spaceType === 'office' && h > 10.0)) {
    minClass = 6; // 92 km/h pour sites exposés au föhn ou bâtiments élevés
  }
  const windSpeedKmh = minClass >= 6 ? 92 : 75;
  return {
    minClass,
    windSpeedKmh,
    label: `Classe ${minClass} (SIA 342, ≥ ${windSpeedKmh} km/h)`
  };
}

/**
 * Évalue la conformité Minergie Variante 2 d'un étage/local sur les deux volets du justificatif :
 *  1) Exigences constructives de base (Z_g, g_tot autorisé vs effectif, capacité C_R/A_SNP, bilan 0–120 %, vent SIA 342)
 *  2) Question sur le confort estival (≤ 100 h/an > 26.5 °C sous climat 2035, charges internes, stratégie été, automatisation)
 *
 * @param {object} fr Résultat brut d'étage issu de `executeEngine`
 * @param {object} project Projet complet
 * @param {object|null} [sim2035FloorResult=null] Résultat du même étage sous climat 2035 (+ UHI si actif)
 */
export function evaluateMinergieVariante2(fr, project, sim2035FloorResult = null) {
  const fl = fr.floor;
  const ops = fr.fp.ops;
  const area = Math.max(1, fl.area);
  const winArea = fr.fp.winArea;
  const glazingIndexZg = winArea / area; // Indice de vitrage A_G / A_SNP

  // g_total autorisé moyen pondéré selon SIA 180 Fig. 12 par orientation
  const byOrient = {};
  for (const op of ops) {
    if (!byOrient[op.orient]) byOrient[op.orient] = [];
    byOrient[op.orient].push(op);
  }

  let sumAuthWeight = 0;
  let sumEffWeight = 0;
  let sumWinOrientArea = 0;

  for (const [orient, list] of Object.entries(byOrient)) {
    const orientWinA = list.reduce((s, o) => s + o.width * o.height * o.qty, 0);
    const estFac = Math.max(orientWinA, getFacadeGrossAreaForOrient(fl, orient));
    const fg = Math.min(1.0, orientWinA / estFac);
    const limG = orient === 'R' ? 0.12 : getMethod2GtotLimit(orient, fg);
    for (const o of list) {
      const a = o.width * o.height * o.qty;
      const gEff =
        o.blindMode === 'always_up'
          ? o.gVit
          : o.gtotMode === 'product'
            ? o.gVit * o.gStore
            : o.gStore;
      sumAuthWeight += limG * a;
      sumEffWeight += gEff * a;
      sumWinOrientArea += a;
    }
  }

  const gTotAuthorized = sumWinOrientArea > 0 ? sumAuthWeight / sumWinOrientArea : 0.15;
  const gTotEffective = sumWinOrientArea > 0 ? sumEffWeight / sumWinOrientArea : 0.0;
  const gTotOk = sumWinOrientArea === 0 || gTotEffective <= gTotAuthorized + 0.005;

  // Bilan constructif (barre 0 % - 100 % - 120 % du justificatif Minergie)
  // Réserve/déficit d'accumulation thermique autour de la référence 45 Wh/(m²·K)
  const thermalMassWhm2K = fl.cSpec;
  const massThresholdPct = Math.round(
    Math.max(60, Math.min(120, 78 + 22 * (thermalMassWhm2K / MINERGIE_THRESHOLDS.recommendedThermalMassWhm2K)))
  );
  const massReservePct = massThresholdPct - 100; // > 0 = réserve, < 0 = déficit
  const massMinOk = thermalMassWhm2K >= MINERGIE_THRESHOLDS.minThermalMassWhm2K;

  // Ratio solaire constructif par rapport au g_tot autorisé (modulé par l'ombrage proche et la fraction sous/sur 200 W/m²)
  const baseLoadRatio =
    sumWinOrientArea > 0 && gTotAuthorized > 0 ? (gTotEffective / gTotAuthorized) * 100 : 0;
  // Prise en compte du gain d'ombrage géométrique (casquette / écrans / horizon)
  const unshadedKWh = fr.gains?.solarUnshaded?.summerKWh || 0;
  const transKWh = fr.gains?.solarTransmitted?.summerKWh || 0;
  const below200KWh = fr.solIrrBelow200KWh || 0;
  const above200KWh = fr.solIrrAbove200KWh || 0;
  const totalSolForSplit = below200KWh + above200KWh;

  const rawExternalPct = Math.min(140, Math.max(0, baseLoadRatio));
  const below200Share = totalSolForSplit > 0 ? below200KWh / totalSolForSplit : 0.35;
  const solarLow200Pct = Math.round(rawExternalPct * below200Share * 10) / 10;
  const solarHigh200Pct = Math.round(rawExternalPct * (1 - below200Share) * 10) / 10;
  const externalLoadPct = Math.round((solarLow200Pct + solarHigh200Pct) * 10) / 10;

  // Résistance au vent (SIA 342)
  const maxFloorTopM = project.floors.reduce(
    (mx, f) => Math.max(mx, (f.elevationZ || 0) + (f.height || 2.5)),
    2.5
  );
  const buildingHeightM = Math.max(2.5, project.buildingHeightM || maxFloorTopM);
  const windRec = getMinergieRecommendedWindClass(
    buildingHeightM,
    fl.spaceType || 'residential',
    Boolean(project.foehnExposed)
  );
  const allWindSafe = ops.every(o => o.windSafe !== false && o.blindMode !== 'always_up');
  const shadingAutomated = ops.length === 0 || ops.every(o => o.blindMode === 'auto' || o.blindMode === 'always_down');

  const constructivePass =
    externalLoadPct <= massThresholdPct && gTotOk && massMinOk && allWindSafe;

  // Volet 2 : Confort estival (données climatiques 2035)
  const eval2035 = sim2035FloorResult || fr;
  const hoursOver265 = eval2035.overMinergie265 ?? fr.overMinergie265 ?? 0;
  const hoursOver265Current = fr.overMinergie265 ?? 0;
  const comfortPass = hoursOver265 <= MINERGIE_THRESHOLDS.maxHoursOver265;

  const internalLoadWhm2d = fr.gains?.internalTotal?.dailyWhm2d ?? 0;
  const internalLoadRefWhm2d = SIA2024_INTERNAL_LOAD_REF[fl.siaCategory] || 113;
  const depthRatio = fl.depthBehindWin / Math.max(1.8, fl.height);
  const depthWarning = depthRatio > MINERGIE_THRESHOLDS.maxRoomDepthRatio;

  let summerStrategyLabel = 'Ventilation naturelle nocturne (fenêtres)';
  if (fl.nightVentMode === 'none') {
    summerStrategyLabel = 'Aucune ventilation nocturne';
  } else if (fl.nightVentMode === 'fixed_m3hm2' || fl.nightVentMode === 'fixed_ach') {
    summerStrategyLabel = `Débit nocturne imposé (${fr.nomNightSpec.toFixed(1)} m³/(h·m²))`;
  } else if (fl.nightSimpleCross || ops.some(o => String(o.openType || '').startsWith('cross'))) {
    summerStrategyLabel = `Aération nocturne traversante (${fr.nomNightSpec.toFixed(1)} m³/(h·m²))`;
  } else {
    summerStrategyLabel = `Aération nocturne simple face (${fr.nomNightSpec.toFixed(1)} m³/(h·m²))`;
  }

  return {
    glazingIndexZg,
    winArea,
    area,
    gTotAuthorized,
    gTotEffective,
    gTotOk,
    thermalMassWhm2K,
    massMinOk,
    massThresholdPct,
    massReservePct,
    solarLow200Pct,
    solarHigh200Pct,
    externalLoadPct,
    unshadedKWh,
    transKWh,
    buildingHeightM,
    windRec,
    allWindSafe,
    shadingAutomated,
    constructivePass,
    hoursOver265,
    hoursOver265Current,
    comfortPass,
    globalPass: constructivePass && comfortPass,
    internalLoadWhm2d,
    internalLoadRefWhm2d,
    nightSpecM3hm2: fr.nomNightSpec,
    summerStrategyLabel,
    depthRatio,
    depthWarning
  };
}
