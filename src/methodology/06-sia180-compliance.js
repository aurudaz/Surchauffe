/**
 * @fileoverview Étape 06 — Justificatifs normatifs SIA 180 (Méthodes 1, 2 et 3),
 * score de résilience estivale et recommandations automatiques.
 */

import {
  getMethod1MaxGlazingRatio,
  getMethod2GtotLimit,
  getSIA180ToleranceHours
} from '../standards/sia180.js';

/**
 * Calcule le score de résilience estivale [0..100] calibré sur les grandeurs physiques 5R1C.
 */
export function computeResilienceScore(fr, limHours = 100) {
  const refLim = Math.max(100, limHours);
  const sHours =
    fr.overSIA === 0
      ? 50
      : fr.overSIA <= refLim
        ? 50 - 35 * (fr.overSIA / refLim)
        : Math.max(0, 15 - 0.05 * (fr.overSIA - refLim));

  const sPeak = fr.maxTop <= 25.5 ? 20 : Math.max(0, 20 * (1 - (fr.maxTop - 25.5) / 6.0));
  const sSolar = fr.avgGtot <= 0.10 ? 15 : Math.max(0, 15 * (1 - (fr.avgGtot - 0.10) / 0.45));
  const sMass =
    Math.min(7.5, 7.5 * (fr.floor.cSpec / 45)) +
    Math.min(7.5, 7.5 * (fr.nomNightSpec / 10));

  return Math.round(Math.max(0, Math.min(100, sHours + sPeak + sSolar + sMass)));
}

/**
 * Évalue les Méthodes 1 (Tableau 8) et 2 (Figure 12) de la norme SIA 180 pour un étage.
 */
export function evaluateSIA180PrescriptiveMethods(fr) {
  const fl = fr.floor;
  const opsFloor = fr.fp.ops;
  const byOrient = {};
  for (const op of opsFloor) {
    if (!byOrient[op.orient]) byOrient[op.orient] = [];
    byOrient[op.orient].push(op);
  }

  // Méthode 2 (Fig. 12) : g_tot par orientation de façade
  const facadeSideEst = Math.max(4, Math.sqrt(Math.max(4, fl.area)) * fl.height);
  const m2Rows = Object.keys(byOrient)
    .filter(o => o !== 'R')
    .map(orient => {
      const list = byOrient[orient];
      const winA = list.reduce((s, o) => s + o.width * o.height * o.qty, 0);
      const estFac = Math.max(winA, facadeSideEst);
      const fg = Math.min(1.0, winA / estFac);
      const maxG = Math.max(
        ...list.map(o =>
          o.blindMode === 'always_up'
            ? o.gVit
            : o.gtotMode === 'product'
              ? o.gVit * o.gStore
              : o.gStore
        )
      );
      const limG = getMethod2GtotLimit(orient, fg);
      return { orient, winA, fg, maxG, limG, ok: maxG <= limG + 1e-4 };
    });

  const m2CapOk = fl.cSpec >= 45;
  const m2RoofOk = fl.roofExtArea === 0 || fl.uRoofExt <= 0.201;
  const m2NightOk = fr.nomNightSpec >= 10.0;
  const m2Pass = m2Rows.every(r => r.ok) && m2CapOk && m2RoofOk && m2NightOk;

  // Méthode 1 (Tableau 8) : part vitrée max, g_tot ≤ 0.10, U ≤ 0.20, profondeur ≥ 3.5 m, toiture ≤ 5 %, nuit ≥ 10
  const roofWinArea = (byOrient.R || []).reduce((s, o) => s + o.width * o.height * o.qty, 0);
  const roofWinPct = fl.area > 0 ? (roofWinArea / fl.area) * 100 : 0;
  const maxUop = Math.max(fl.uWallExt, fl.roofExtArea > 0 ? fl.uRoofExt : 0);
  const maxG1 = opsFloor.length
    ? Math.max(
        ...opsFloor.map(o =>
          o.blindMode === 'always_up'
            ? o.gVit
            : o.gtotMode === 'product'
              ? o.gVit * o.gStore
              : o.gStore
        )
      )
    : 0;
  const multiFac = Object.keys(byOrient).filter(o => o !== 'R').length > 1;
  const allAuto = opsFloor.every(
    o => (o.blindMode === 'auto' || o.blindMode === 'always_down') && o.windSafe !== false
  );
  const limFg1 = getMethod1MaxGlazingRatio(fl.spaceType, fl.cSpec, multiFac, allAuto);
  const maxFg1 = m2Rows.length ? Math.max(...m2Rows.map(r => r.fg)) : 0;

  const m1Criteria = [
    { label: 'Facteur solaire g_tot vitrage + store ≤ 0.10', val: maxG1.toFixed(3), ok: maxG1 <= 0.101 },
    { label: 'Parois opaques ext. U ≤ 0.20 W/(m²·K)', val: `${maxUop.toFixed(2)} W/(m²·K)`, ok: maxUop <= 0.201 },
    { label: 'Profondeur du local ≥ 3.5 m', val: `${fl.depthBehindWin.toFixed(1)} m`, ok: fl.depthBehindWin >= 3.5 },
    { label: 'Fenêtres de toiture ≤ 5 % du plancher', val: `${roofWinPct.toFixed(1)} %`, ok: roofWinPct <= 5.0 },
    {
      label: 'Part vitrée façade ≤ Tableau 8 SIA 180',
      val: `${(maxFg1 * 100).toFixed(0)} % (max ${(limFg1 * 100).toFixed(0)} %)`,
      ok: limFg1 > 0 && maxFg1 <= limFg1 + 1e-4
    },
    { label: 'Déstockage nocturne ≥ 10 m³/(h·m²)', val: `${fr.nomNightSpec.toFixed(1)} m³/(h·m²)`, ok: fr.nomNightSpec >= 10.0 }
  ];

  return {
    method1: { pass: m1Criteria.every(c => c.ok), criteria: m1Criteria },
    method2: { pass: m2Pass, rows: m2Rows, capOk: m2CapOk, roofOk: m2RoofOk, nightOk: m2NightOk }
  };
}

/**
 * Génère les recommandations techniques prioritaires pour un étage.
 */
export function buildRecommendations(fr, limHours) {
  const recos = [];
  if (fr.overSIA > limHours) {
    recos.push(
      `<strong>Dépassement SIA 180 :</strong> ${fr.overSIA} h/an dépassent la tolérance (${limHours} h/an). Combinez protections solaires extérieures performantes et surventilation nocturne.`
    );
  }
  if (fr.avgGtot > 0.14) {
    recos.push(
      `<strong>Protections solaires :</strong> le facteur g_tot moyen pondéré est de <strong>${fr.avgGtot.toFixed(2)}</strong>. Passer à des stores extérieurs automatisés (g_store ≤ 0.10–0.12) réduit fortement les pics.`
    );
  }
  if (fr.nomNightSpec < 10.0) {
    recos.push(
      `<strong>Ventilation nocturne :</strong> le débit potentiel à ΔT=8 K est de <strong>${fr.nomNightSpec.toFixed(1)} m³/(h·m²)</strong> (sous la référence SIA de 10). Augmentez la section ouvrante ou activez une aération traversante.`
    );
  }
  if (fr.floor.cSpec < 45) {
    recos.push(
      `<strong>Inertie thermique :</strong> capacité actuelle de <strong>${fr.floor.cSpec} Wh/(m²·K)</strong> (seuil EN-102 : 45). Valorisez les dalles béton et murs lourds apparents sans faux-plafond isolant.`
    );
  }
  if (recos.length === 0) {
    recos.push(
      `<strong>Conception passive performante :</strong> cet étage respecte les critères de protection estivale SIA 180 avec une marge confortable.`
    );
  }
  return recos;
}

/**
 * Enrichit les résultats bruts du moteur 5R1C avec les verdicts SIA 180 et sélectionne l'étage critique.
 */
export function enrichWithSIA180(engineRes, projectType) {
  const limHours = getSIA180ToleranceHours(projectType);

  const floorResults = engineRes.floorRaw.map(fr => {
    const score = computeResilienceScore(fr, limHours);
    const prescriptive = evaluateSIA180PrescriptiveMethods(fr);
    const recos = buildRecommendations(fr, limHours);
    return {
      ...fr,
      score,
      limHours,
      passSIA: fr.overSIA <= limHours,
      prescriptive,
      recos
    };
  });

  const worstFloor = floorResults.reduce(
    (a, b) => (b.overSIA > a.overSIA || (b.overSIA === a.overSIA && b.maxTop > a.maxTop) ? b : a),
    floorResults[0]
  );

  return {
    minTe: engineRes.minTe,
    maxTe: engineRes.maxTe,
    tropicalNights: engineRes.tropicalNights,
    buildingStackSpan: engineRes.buildingStackSpan,
    limHours,
    floorResults,
    worstFloor
  };
}
