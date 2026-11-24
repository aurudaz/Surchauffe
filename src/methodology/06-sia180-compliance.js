/**
 * @fileoverview Étape 06 — Justificatifs normatifs SIA 180 (Méthodes 1, 2 et 3),
 * score de résilience estivale et recommandations automatiques.
 */

import { getFacadeGrossAreaForOrient } from '../standards/box3d-presets.js';
import { evaluateMinergieVariante2 } from '../standards/minergie.js';
import {
  getMethod1MaxGlazingRatio,
  getMethod2GtotLimit,
  getSIA180ToleranceHours
} from '../standards/sia180.js';

/**
 * Calcule le score de résilience estivale [0..100] calibré sur les grandeurs physiques 5R1C.
 */
export function computeResilienceScore(fr, limHours = 100, projectType = 'new') {
  const refLim = Math.max(100, limHours);
  const overVal = projectType === 'minergie' ? (fr.overMinergie265 ?? fr.overSIA) : fr.overSIA;
  const sHours =
    overVal === 0
      ? 50
      : overVal <= refLim
        ? 50 - 35 * (overVal / refLim)
        : Math.max(0, 15 - 0.05 * (overVal - refLim));

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
  const m2Rows = Object.keys(byOrient)
    .filter(o => o !== 'R')
    .map(orient => {
      const list = byOrient[orient];
      const winA = list.reduce((s, o) => s + o.width * o.height * o.qty, 0);
      const estFac = Math.max(winA, getFacadeGrossAreaForOrient(fl, orient));
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
export function buildRecommendations(fr, limHours, projectType = 'new') {
  const recos = [];
  if (projectType === 'minergie' && fr.overMinergie265 > 100) {
    recos.push(
      `<strong>Dépassement Minergie :</strong> ${fr.overMinergie265} h/an dépassent 26.5 °C (limite Minergie : 100 h/an). Renforcez les protections solaires extérieures (g_tot ≤ 0.10) et le rafraîchissement nocturne.`
    );
  }
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
      `<strong>Conception passive performante :</strong> cet étage respecte les critères de protection estivale avec une marge confortable.`
    );
  }
  return recos;
}

const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

const ORIENT_LABELS_FR = {
  N: 'Nord', NE: 'Nord-Est', E: 'Est', SE: 'Sud-Est',
  S: 'Sud', SO: 'Sud-Ouest', O: 'Ouest', NO: 'Nord-Ouest', R: 'Toiture'
};

/**
 * Évalue les besoins énergétiques de froid actif nécessaires pour maintenir 0 h de surchauffe
 * selon les seuils suisses (SIA 180, SIA 382/1, SIA 2024:2015 et MoPEC / EN-102)
 * et génère des propositions ciblées pour réduire ce besoin.
 *
 * @param {object} fr Résultat d'étage issu de `executeEngine`
 * @param {string} [projectType='new'] Exigence réglementaire active
 * @param {object|null} [optFloor=null] Même étage simulé en scénario passif optimisé (pour chiffrer le gain)
 */
export function evaluateActiveCooling(fr, projectType = 'new', optFloor = null) {
  const fl = fr.floor;
  const area = Math.max(1, fl.area);
  const coolKWh = fr.coolKWh ?? (fr.coolKWhm2 || 0) * area;
  const coolKWhm2 = fr.coolKWhm2 ?? coolKWh / area;
  const maxCoolW = fr.maxCoolW || 0;
  const maxCoolWm2 = fr.maxCoolWm2 ?? maxCoolW / area;
  const coolHours = fr.coolHours || 0;
  const monthly = Array.isArray(fr.coolMonthlyKWh) ? fr.coolMonthlyKWh : new Array(12).fill(0);

  const isResidential = fl.spaceType === 'residential';
  const needed = coolKWh >= 1.0 || maxCoolW >= 5.0;

  // Seuils suisses SIA 180 / SIA 382/1 / SIA 2024 / MoPEC EN-102
  const powerWarnWm2 = 12.0; // Seuil SIA 180 / SIA 382/1 au-delà duquel une justification EN-102 est requise
  const powerExcessiveWm2 = isResidential ? 20.0 : 25.0;
  const energyWarnKWhm2 = isResidential ? 3.0 : 10.0;
  const energyExcessiveKWhm2 = isResidential ? 10.0 : 20.0;

  let level = 'none';
  let statusLabel = 'Aucun froid actif requis';
  let statusSummary = 'Le bâtiment maintient le confort de façon 100 % passive (0 kWh/an de froid).';

  if (needed) {
    const powerExcessive = maxCoolWm2 > powerExcessiveWm2;
    const energyExcessive = coolKWhm2 > energyExcessiveKWhm2;
    const powerHigh = maxCoolWm2 > powerWarnWm2;
    const energyHigh = coolKWhm2 > energyWarnKWhm2;

    if (powerExcessive || energyExcessive) {
      level = 'excessive';
      statusLabel = 'Besoins de froid trop importants';
      const reasons = [];
      if (energyExcessive) {
        reasons.push(
          `énergie utile ${coolKWhm2.toFixed(1)} kWh/(m²·an) > seuil ${energyExcessiveKWhm2} kWh/(m²·an)`
        );
      }
      if (powerExcessive) {
        reasons.push(`puissance ${maxCoolWm2.toFixed(1)} W/m² > seuil ${powerExcessiveWm2} W/m²`);
      }
      statusSummary =
        `Charge de refroidissement actif excessive (${reasons.join(' et ')}). ` +
        `Selon SIA 382/1 & MoPEC (EN-102), des mesures passives sont impératives avant d’envisager une installation de froid.`;
    } else if (powerHigh || energyHigh) {
      level = 'high';
      statusLabel = 'Besoin de froid important (EN-102)';
      statusSummary = isResidential
        ? `Besoin de froid actif significatif pour un logement (${coolKWhm2.toFixed(1)} kWh/(m²·an), pointe ${maxCoolWm2.toFixed(1)} W/m²). Des mesures passives doivent prioritairement réduire cette charge.`
        : `Dépasse le seuil passif SIA de 12 W/m² ou 10 kWh/(m²·an) : une justification EN-102 est nécessaire, mais un fort potentiel de réduction passive existe.`;
    } else {
      level = 'low';
      statusLabel = 'Besoin de froid faible / maîtrisé';
      statusSummary = `Besoin résiduel modéré (${coolKWhm2.toFixed(1)} kWh/(m²·an), ≤ 12 W/m²), généralement éliminable par de petits ajustements passifs ou un geocooling basse consommation.`;
    }
  }

  let peakMonthIdx = 6;
  let peakMonthKWh = 0;
  monthly.forEach((v, idx) => {
    if (v > peakMonthKWh) {
      peakMonthKWh = v;
      peakMonthIdx = idx;
    }
  });

  const seerPac = 3.5;
  const seerGeo = 15.0;
  const elecPacKWh = coolKWh / seerPac;
  const elecPacKWhm2 = coolKWhm2 / seerPac;
  const elecGeoKWh = coolKWh / seerGeo;
  const estCostChf = elecPacKWh * 0.30; // Tarif électrique suisse moyen ~0.30 CHF/kWh

  // Comparaison avec le scénario passif optimisé (stores auto g_store≤0.10 + ventilation nuit active)
  let optSavings = null;
  if (needed && optFloor && typeof optFloor.coolKWhm2 === 'number') {
    const optKWhm2 = optFloor.coolKWhm2;
    const optWm2 = optFloor.maxCoolWm2 || 0;
    const savedEnergyPct =
      coolKWhm2 > 0.05 ? Math.max(0, ((coolKWhm2 - optKWhm2) / coolKWhm2) * 100) : 0;
    const savedPowerPct =
      maxCoolWm2 > 0.5 ? Math.max(0, ((maxCoolWm2 - optWm2) / maxCoolWm2) * 100) : 0;
    optSavings = {
      optCoolKWhm2: optKWhm2,
      optMaxCoolWm2: optWm2,
      savedEnergyPct,
      savedPowerPct
    };
  }

  // Propositions d'amélioration ciblées selon les causes dominantes réelles de l'étage
  const proposals = [];
  if (needed) {
    if (optSavings && optSavings.savedEnergyPct >= 15) {
      proposals.push(
        `<strong>Potentiel passif simulé (−${optSavings.savedEnergyPct.toFixed(0)} % de froid) :</strong> en combinant des stores extérieurs automatisés (g_store ≤ 0.10) et une ventilation nocturne efficace, le besoin de froid tombe de <strong>${coolKWhm2.toFixed(1)}</strong> à <strong>${optSavings.optCoolKWhm2.toFixed(1)} kWh/(m²·an)</strong> (pointe : ${maxCoolWm2.toFixed(1)} → ${optSavings.optMaxCoolWm2.toFixed(1)} W/m²).`
      );
    }

    const g = fr.gains;
    const solShare = g?.solarTransmitted?.sharePct ?? 0;
    const intShare = g?.internalTotal?.sharePct ?? 0;
    const trShare = g?.conductionIn?.sharePct ?? 0;

    // 1. Levier solaire (façade critique identifiée)
    if (solShare >= 30 || fr.avgGtot > 0.12) {
      let worstOrient = null;
      let worstOrientKWh = 0;
      for (const [k, v] of Object.entries(fr.solByOrient || {})) {
        if (v > worstOrientKWh) {
          worstOrientKWh = v;
          worstOrient = k;
        }
      }
      const orientTxt = worstOrient
        ? ` (façade la plus exposée : <strong>${ORIENT_LABELS_FR[worstOrient] || worstOrient}</strong>, ${worstOrientKWh.toFixed(0)} kWh/été)`
        : '';
      proposals.push(
        `<strong>Réduire les gains solaires (${solShare.toFixed(0)} % des apports) :</strong> renforcez les stores extérieurs automatisés (g_total ≤ 0.08–0.10, actuel ${fr.avgGtot.toFixed(2)})${orientTxt}. Sur le Sud, une casquette fixe réduit la charge sans bloquer la vue ; sur Ouest/Toiture, un vitrage contrôle solaire (g_vit ≤ 0.35) ou la réduction des surfaces vitrées diminue directement la pointe frigorifique.`
      );
    }

    // 2. Levier ventilation nocturne
    if (fr.nomNightSpec < 10.0) {
      proposals.push(
        `<strong>Augmenter le déstockage nocturne (${fr.nomNightSpec.toFixed(1)} m³/(h·m²) &lt; 10 reco.) :</strong> une surventilation nocturne automatisée (ouvrants sécurisés anti-effraction / pluie, idéalement traversante ou par effet cheminée) évacue gratuitement la chaleur accumulée la journée et évite de faire tourner le froid actif dès le matin.`
      );
    }

    // 3. Levier gains internes (identifie le sous-poste dominant)
    if (intShare >= 30 || (g?.internalTotal?.dailyWhm2d ?? 0) > 120) {
      const subLoads = [
        { name: 'les appareils électriques', kwh: g?.appliances?.summerKWh ?? 0, peakW: g?.appliances?.peakW ?? 0 },
        { name: 'l’éclairage', kwh: g?.lighting?.summerKWh ?? 0, peakW: g?.lighting?.peakW ?? 0 },
        { name: 'les occupants', kwh: g?.people?.summerKWh ?? 0, peakW: g?.people?.peakW ?? 0 }
      ].sort((a, b) => b.kwh - a.kwh);
      const topSub = subLoads[0];
      proposals.push(
        `<strong>Maîtriser les charges internes (${intShare.toFixed(0)} % des apports, ${g.internalTotal.dailyWhm2d.toFixed(0)} Wh/(m²·j)) :</strong> le premier poste est <strong>${topSub.name}</strong> (${topSub.peakW.toFixed(0)} W pointe • ${topSub.kwh.toFixed(0)} kWh/été). Passez en LED avec gradation lumière du jour, coupez les veilles nocturnes et délocalisez les équipements chauds (serveurs, imprimantes) hors zone.`
      );
    }

    // 4. Levier inertie thermique
    if (fl.cSpec < 45) {
      proposals.push(
        `<strong>Renforcer l’inertie thermique (${fl.cSpec.toFixed(0)} Wh/(m²·K) &lt; 45 reco.) :</strong> supprimer ou ajourer les faux-plafonds isolants pour exposer la dalle béton lisse et déphase le pic de chaleur, ce qui écrête fortement la puissance frigorifique de pointe [W/m²].`
      );
    }

    // 5. Levier enveloppe / toiture
    if ((fl.roofExtArea > 0 && fl.uRoofExt > 0.25) || trShare >= 12) {
      proposals.push(
        `<strong>Limiter la conduction entrante (${trShare.toFixed(0)} % des apports) :</strong> améliorez l’isolation de toiture (U ≤ 0.20 W/(m²·K)) et privilégiez une toiture végétalisée ou réfléchissante (albédo élevé) pour limiter la surchauffe sous toit.`
      );
    }

    // 6. Choix système basse énergie si un résiduel persiste
    if (level === 'excessive') {
      proposals.push(
        `<strong>Alerte dimensionnement &amp; conformité (SIA 382/1 / MoPEC EN-102) :</strong> un groupe froid dimensionné sur <strong>${maxCoolWm2.toFixed(1)} W/m²</strong> (${(maxCoolW / 1000).toFixed(2)} kW) serait surdimensionné et difficile à justifier en Suisse. Appliquez d’abord les mesures passives ci-dessus afin de descendre sous <strong>12–15 W/m²</strong>.`
      );
    } else if (maxCoolWm2 <= 20) {
      proposals.push(
        `<strong>Alternative très basse énergie (Geocooling) :</strong> la puissance de pointe (${maxCoolWm2.toFixed(1)} W/m²) est compatible avec un <strong>geocooling passif</strong> (sonde géothermique sur plancher/dalle active, SEER ≈ 15 : seulement ~<strong>${elecGeoKWh.toFixed(0)} kWh_él/an</strong> contre ${elecPacKWh.toFixed(0)} kWh_él/an pour une climatisation classique).`
      );
    }
  }

  return {
    needed,
    isResidential,
    level,
    statusLabel,
    statusSummary,
    coolKWh,
    coolKWhm2,
    maxCoolW,
    maxCoolWm2,
    coolHours,
    maxCoolHour: fr.maxCoolHour || 0,
    coolMonthlyKWh: monthly,
    peakMonthName: MONTHS_FR[peakMonthIdx],
    peakMonthKWh,
    seerPac,
    elecPacKWh,
    elecPacKWhm2,
    elecGeoKWh,
    estCostChf,
    thresholds: {
      powerWarnWm2,
      powerExcessiveWm2,
      energyWarnKWhm2,
      energyExcessiveKWhm2
    },
    optSavings,
    proposals
  };
}

/**
 * Enrichit les résultats bruts du moteur 5R1C avec les verdicts SIA 180, Minergie et l'analyse du froid actif.
 */
export function enrichWithSIA180(
  engineRes,
  projectType,
  project = null,
  sim2035Raw = null,
  optRaw = null
) {
  const limHours = getSIA180ToleranceHours(projectType, project?.customReg);

  const floorResults = engineRes.floorRaw.map(fr => {
    const score = computeResilienceScore(fr, limHours, projectType);
    const prescriptive = evaluateSIA180PrescriptiveMethods(fr);
    const recos = buildRecommendations(fr, limHours, projectType);
    const sim2035Floor = sim2035Raw
      ? sim2035Raw.floorRaw.find(x => x.floor.id === fr.floor.id)
      : null;
    const optFloor = optRaw ? optRaw.floorRaw.find(x => x.floor.id === fr.floor.id) : null;
    const minergie = project ? evaluateMinergieVariante2(fr, project, sim2035Floor) : null;
    const activeCooling = evaluateActiveCooling(fr, projectType, optFloor);
    return {
      ...fr,
      score,
      limHours,
      passSIA: fr.overSIA <= limHours,
      passMinergie265: (fr.overMinergie265 ?? 0) <= 100,
      prescriptive,
      minergie,
      activeCooling,
      recos
    };
  });

  const totalArea = Math.max(
    1,
    floorResults.reduce((s, fr) => s + fr.floor.area, 0)
  );
  const totalCoolKWh = floorResults.reduce((s, fr) => s + (fr.activeCooling?.coolKWh || 0), 0);
  const sumMaxCoolW = floorResults.reduce((s, fr) => s + (fr.activeCooling?.maxCoolW || 0), 0);
  const buildingCooling = {
    needed: totalCoolKWh >= 1.0 || sumMaxCoolW >= 5.0,
    totalCoolKWh,
    totalCoolKWhm2: totalCoolKWh / totalArea,
    sumMaxCoolW,
    sumMaxCoolWm2: sumMaxCoolW / totalArea,
    totalElecPacKWh: totalCoolKWh / 3.5
  };

  const metricKey = projectType === 'minergie' ? 'overMinergie265' : 'overSIA';
  const worstFloor = floorResults.reduce(
    (a, b) =>
      (b[metricKey] ?? 0) > (a[metricKey] ?? 0) ||
      ((b[metricKey] ?? 0) === (a[metricKey] ?? 0) && b.maxTop > a.maxTop)
        ? b
        : a,
    floorResults[0]
  );

  return {
    minTe: engineRes.minTe,
    maxTe: engineRes.maxTe,
    tropicalNights: engineRes.tropicalNights,
    buildingStackSpan: engineRes.buildingStackSpan,
    limHours,
    buildingCooling,
    floorResults,
    worstFloor
  };
}
