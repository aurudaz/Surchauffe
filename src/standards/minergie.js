/**
 * @fileoverview Critères et validation Minergie pour la protection thermique estivale
 * (Justificatif Minergie v2023.2 / CALC_1, SIA 180, SIA 261, SIA 342 et SIA 2024:2015).
 *
 * Implémente fidèlement :
 *  1) Vérification constructive journalière [Wh/j] :
 *       Q_max  = (q_vent + C_R/A · ΔT − 120) · A_SNP + q_verre · A_G + q_cadre · A_cadre
 *       Q_in   = Σ g_vitrage · Q<200 + Σ g_tot · Q≥200
 *       bilan  = Q_in / Q_max ≤ 100 %
 *       g_tot,adm = clamp((Q_max − Σ g_vitrage · Q<200) / Σ Q≥200, 0.05, g_vitrage)
 *     avec surface nette de verre A_G (cadre déduit), ensoleillement avr.–oct. calculé
 *     par géométrie solaire pure (latitude 46.75°, albédo 20 %, modèle ciel clair Hottel + ombrages).
 *  2) Capacité thermique C_R / A_SNP séparée du modèle 5R1C, plafonnée à 75 Wh/(m²·K) (v2023).
 *  3) Charges internes SIA 2024:2015 par type de local.
 *  4) Classe de résistance au vent SIA 342 calculée par profil de rafale SIA 261.
 *  5) Confort estival analytique (rapport gains/pertes, seuils 0.70 / 0.97 / 1.05) + simulation dynamique (16 avr.–15 oct.).
 *  6) Règles d'automatisation des stores et de nécessité de refroidissement actif selon la stratégie.
 */

import { incidentIrradiance, solarPosition } from '../methodology/01-solar-geometry.js';
import {
  ORIENTATIONS,
  SIA2024_ROOM_TYPES,
  getDefaultRoomTypeForSiaCat
} from './sia380-1.js';
import {
  SWISS_STATIONS,
  getMinergieStationConstants
} from './swiss-stations.js';

export const MINERGIE_THRESHOLDS = {
  maxHoursOver265: 100,              // Max 100 h/an > 26.5 °C (16 avril – 15 octobre)
  tempLimitC: 26.5,                  // Seuil opératif Minergie [°C]
  solarTriggerWm2: 200,              // Seuil de déclenchement des stores [W/m²]
  fixedConstructiveLoadWhm2d: 120,   // Charges internes fixes pour la vérification constructive [Wh/(m²·j)]
  minThermalMassWhm2K: 30,           // C_R / A_SNP minimal [Wh/(m²·K)]
  recommendedThermalMassWhm2K: 45,   // Capacité de référence SIA 180 [Wh/(m²·K)]
  maxThermalMassCapWhm2K: 75,        // Plafond Minergie v2023 pour C_R / A_SNP [Wh/(m²·K)]
  maxRoomDepthRatio: 2.5,            // Profondeur max admissible = 2.5 × h_libre
  minNightVentM3hm2: 10.0,           // Débit nocturne de référence [m³/(h·m²)]
  defaultHorizonDeg: 20              // Horizon standard Minergie [°]
};

/**
 * Charges internes journalières SIA 2024:2015 par catégorie SIA [Wh/(m²·j)].
 */
export const SIA2024_INTERNAL_LOAD_REF = {
  I: 84,    // Habitat collectif
  II: 71,   // Habitat individuel
  III: 107, // Bureau individuel / collectif
  IV: 120,  // Salle de classe / École
  V: 152,   // Commerce standard
  VI: 240,  // Restauration
  VII: 125, // Lieu de rassemblement
  VIII: 130,// Hôpital / chambre
  IX: 135,  // Industrie / atelier
  X: 35,    // Dépôt / archives
  XI: 75,   // Installation sportive
  XII: 165  // Piscine couverte
};

/**
 * Catégories de terrain SIA 261 pour le calcul du profil vertical de rafale au store.
 */
export const SIA261_TERRAIN_CATS = {
  II:  { label: 'Cat. II — Rase campagne / Aéroport', zg: 300, alpha: 0.16 },
  IIa: { label: 'Cat. IIa — Périurbain / Village',    zg: 380, alpha: 0.19 },
  III: { label: 'Cat. III — Urbain / Agglomération',  zg: 450, alpha: 0.23 },
  IV:  { label: 'Cat. IV — Centre-ville dense',       zg: 526, alpha: 0.30 }
};

/**
 * Seuils d'automatisation des stores et de nécessité de refroidissement actif
 * selon la stratégie d'aération estivale [Wh/(m²·j)] (Minergie v2023.2).
 */
export const MINERGIE_STRATEGY_RULES = {
  day:       { label: 'Ventilation par les fenêtres le jour',            autoReq: 100, coolReq: 140 },
  day_night: { label: 'Ventilation par les fenêtres jour & nuit',        autoReq: 140, coolReq: 200 },
  cross:     { label: 'Ventilation traversante / cheminée jour & nuit',  autoReq: 140, coolReq: 200 },
  mech:      { label: 'Ventilation mécanique uniquement',                autoReq: 80,  coolReq: 120 },
  none:      { label: 'Aucune aération naturelle active',                autoReq: 80,  coolReq: 120 }
};

const SIA342_CLASS_SPEEDS = [32.5, 38.5, 46.0, 60.0, 76.0, 92.0];

/**
 * Calcule la classe minimale de résistance au vent des stores (SIA 342) selon le profil
 * de rafale SIA 261 à la hauteur h du store :
 *   v = v_rafale,station · ((h / z_g)^α + 0.375) / ((h_station / z_g,station)^α_station + 0.375)
 *
 * Seuils SIA 342 : 32.5 / 38.5 / 46 / 60 / 76 / 92 km/h → Classes 1 à 6.
 * Règles Minergie :
 *  - Habitat : au moins Classe 3 (+1 en cas de föhn → Classe 4 min).
 *  - Föhn : +1 classe (plafonné à 6).
 *
 * @param {number} [buildingHeightM=5.0] Hauteur du store / bâtiment [m]
 * @param {'residential'|'office'} [spaceType='residential'] Affectation
 * @param {boolean} [foehnExposed=false] Exposition au föhn
 * @param {'II'|'IIa'|'III'|'IV'} [terrainCat='III'] Catégorie de terrain SIA 261
 * @param {string} [stationKey='SIO'] Station climatique de référence
 */
export function getMinergieRecommendedWindClass(
  buildingHeightM = 5.0,
  spaceType = 'residential',
  foehnExposed = false,
  terrainCat = 'III',
  stationKey = 'SIO'
) {
  const h = Math.max(2.5, Number(buildingHeightM) || 2.5);
  const st = SWISS_STATIONS[stationKey] || SWISS_STATIONS.SIO;
  const vStat = st.vGustStationKmh ?? 54.3;
  const hStat = st.hStationM ?? 10.0;
  const tStat = SIA261_TERRAIN_CATS[st.terrainStation || 'II'] || SIA261_TERRAIN_CATS.II;
  const tSite = SIA261_TERRAIN_CATS[terrainCat] || SIA261_TERRAIN_CATS.III;

  const num = Math.pow(h / tSite.zg, tSite.alpha) + 0.375;
  const den = Math.pow(hStat / tStat.zg, tStat.alpha) + 0.375;
  const gustKmh = Math.round(vStat * (num / den) * 10) / 10;

  let baseClass = 6;
  for (let i = 0; i < SIA342_CLASS_SPEEDS.length; i++) {
    if (gustKmh <= SIA342_CLASS_SPEEDS[i]) {
      baseClass = i + 1;
      break;
    }
  }

  let minClass = spaceType === 'residential' ? Math.max(3, baseClass) : baseClass;
  if (foehnExposed) {
    minClass = Math.min(6, minClass + 1);
  }
  const windSpeedKmh = SIA342_CLASS_SPEEDS[Math.min(5, Math.max(0, minClass - 1))];

  return {
    minClass,
    baseClass,
    gustKmh,
    windSpeedKmh,
    terrainCat,
    label: `Classe ${minClass} (SIA 342, v=${gustKmh.toFixed(1)} km/h → ≤ ${windSpeedKmh} km/h)`
  };
}

/**
 * Modèle physique de ciel clair d'Hottel (Duffie & Beckman) pour une journée type estivale
 * à 500 m d'altitude, utilisé pour calculer l'ensoleillement horaire avr.–oct. à lat 46.75°.
 */
function hottelClearSky(cosZ, doy, altKm = 0.5) {
  if (cosZ <= 0.02) return { Igh: 0, Ibn: 0, Idh: 0 };
  const I0 = 1361 * (1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365));
  const a0 = 0.95 * (0.4237 - 0.00821 * Math.pow(6 - altKm, 2));
  const a1 = 0.98 * (0.5055 + 0.00595 * Math.pow(6.5 - altKm, 2));
  const k = 1.02 * (0.2711 + 0.01858 * Math.pow(2.5 - altKm, 2));
  const tauB = a0 + a1 * Math.exp(-k / cosZ);
  const tauD = 0.271 - 0.2939 * tauB;
  const Ibn = I0 * tauB;
  const Idh = I0 * cosZ * tauD;
  return { Igh: Ibn * cosZ + Idh, Ibn, Idh };
}

/**
 * Calcule les énergies solaires journalières pondérées Q<200 et Q≥200 [Wh/j] pour une fenêtre
 * selon la méthode Minergie (journées types avril–octobre, latitude 46.75°, albédo 20 %,
 * ombrages géométriques + réflexion façade opposée, facteur 1.37 au-dessus de 200 W/m²,
 * facteur d'orientation 0.70 Sud → 1.00 Nord en dessous de 200 W/m², multiplié par A_G).
 */
export function computeMinergieWindowSolarSplit(op, project, stationConstants) {
  const orInfo = ORIENTATIONS[op.orient] || ORIENTATIONS.S;
  const grossArea = Math.max(0, (op.width || 0) * (op.height || 0) * (op.qty || 1));
  const frameFactor = Math.max(0.4, Math.min(1.0, Number(op.frameFactor ?? 0.78)));
  const glassArea = grossArea * frameFactor;
  const frameArea = Math.max(0, grossArea - glassArea);

  if (glassArea <= 0) {
    return { grossArea, glassArea: 0, frameArea: 0, qLowWhDay: 0, qHighWhDay: 0 };
  }

  const horizonDeg = Math.max(0, Math.min(60, Number(op.horizonDeg ?? project.horizonDeg ?? 0)));
  const monthMids = [105, 135, 166, 196, 227, 258, 288]; // 15 avr. .. 15 oct.
  const weights = stationConstants?.monthSolarWeights || [1, 1, 1, 1, 1, 1, 1];
  const oppAz = (orInfo.az + 180) % 360;
  const horRad = (horizonDeg * Math.PI) / 180;
  const oppViewFactor = orInfo.tilt > 45 && horizonDeg > 0 ? 0.25 * ((1 - Math.cos(horRad)) / 2) : 0;

  let sumLow = 0;
  let sumHigh = 0;

  for (let m = 0; m < 7; m++) {
    const doy = monthMids[m];
    const wt = weights[m] ?? 1.0;
    let dayLow = 0;
    let dayHigh = 0;

    for (let h = 0; h < 24; h++) {
      const sun = solarPosition(doy, h + 0.5, 46.75, 15.0, 1);
      if (sun.cosZ <= 0.02) continue;
      const cs = hottelClearSky(sun.cosZ, doy, 0.5);
      const irrRes = incidentIrradiance(
        cs.Igh,
        cs.Ibn,
        cs.Idh,
        sun,
        orInfo.az,
        orInfo.tilt,
        op.overhangDepth || 0,
        op.height || 1.5,
        0.20,
        {
          horizonDeg,
          winWidth: op.width || 1.4,
          leftFinDepth: op.leftFinDepth || 0,
          leftFinDist: op.leftFinDist || 0,
          rightFinDepth: op.rightFinDepth || 0,
          rightFinDist: op.rightFinDist || 0
        }
      );

      let irr = irrRes.total * (op.shadingFactor ?? 1.0);
      // Réflexion diffuse de la façade d'en face lorsque l'horizon est obstrué
      if (oppViewFactor > 0) {
        const oppIrr = incidentIrradiance(cs.Igh, cs.Ibn, cs.Idh, sun, oppAz, 90, 0, 1.5, 0.20).total;
        irr += oppIrr * oppViewFactor;
      }

      if (irr >= MINERGIE_THRESHOLDS.solarTriggerWm2) {
        dayHigh += irr;
      } else {
        dayLow += irr;
      }
    }

    sumLow += dayLow * wt;
    sumHigh += dayHigh * wt;
  }

  // Facteur d'orientation pour Q<200 : 0.70 au Sud (180°) → 1.00 au Nord (0°)
  const devFromSouth = Math.abs(((orInfo.az - 180 + 540) % 360) - 180);
  const orientFactor = orInfo.tilt < 45 ? 0.70 : 0.70 + 0.30 * (devFromSouth / 180);

  const qLowPerM2 = (sumLow / 7) * orientFactor;
  const qHighPerM2 = (sumHigh / 7) * 1.37;

  return {
    grossArea,
    glassArea,
    frameArea,
    qLowWhDay: qLowPerM2 * glassArea,
    qHighWhDay: qHighPerM2 * glassArea
  };
}

function resolveSummerStrategyKey(fl, ops) {
  if (fl.minergieStrategy && MINERGIE_STRATEGY_RULES[fl.minergieStrategy]) {
    return fl.minergieStrategy;
  }
  const hasNight = fl.nightVentMode && fl.nightVentMode !== 'none';
  const hasCross =
    hasNight &&
    (Boolean(fl.nightSimpleCross) ||
      (fl.nightVentMode === 'physical' && ops.some(o => o.operable && String(o.openType || '').startsWith('cross'))));
  const hasDayWin = fl.dayVentMode === 'window_occ';

  if (hasCross) return 'cross';
  if (hasNight) return 'day_night';
  if (hasDayWin) return 'day';
  if (fl.hasMechVent) return 'mech';
  return 'none';
}

/**
 * Évalue la conformité Minergie d'un étage/local sur les deux volets officiels (v2023.2) :
 *  1) Vérification constructive journalière (Q_max, Q_in, bilan ≤ 100 %, g_tot admissible, C_R/A_SNP ≤ 75, vent SIA 261/342)
 *  2) Confort estival :
 *     - Méthode analytique Variante 2 (rapport gains/pertes, seuils 0.70 / 0.97 / 1.05, auto-échec si constructif échoue)
 *     - Justificatif par simulation dynamique (heures > 26.5 °C du 16 avril au 15 octobre sous climat 2035)
 *     - Règles d'automatisation des stores et de refroidissement actif selon la stratégie et les charges internes
 *
 * @param {object} fr Résultat brut d'étage issu de `executeEngine`
 * @param {object} project Projet complet
 * @param {object|null} [sim2035FloorResult=null] Résultat du même étage sous climat 2035 (+ UHI si actif)
 */
export function evaluateMinergieVariante2(fr, project, sim2035FloorResult = null) {
  const fl = fr.floor;
  const ops = fr.fp.ops;
  const area = Math.max(1, fl.area);

  const stationKey = project.climate?.station || 'SIO';
  const scenarioKey = project.climate?.scenario || '2035';
  const uhi = Boolean(project.climate?.urbanHeatIsland);
  const stConst = getMinergieStationConstants(stationKey, scenarioKey, uhi);

  // 1. Surfaces vitrées nettes (verre A_G vs cadre A_cadre) et bilan solaire journalier Q<200 / Q≥200
  let winAreaGross = 0;
  let glassArea = 0;
  let frameArea = 0;
  let qLowSum = 0;
  let qHighSum = 0;
  let qLowGvitSum = 0;
  let qHighGtotSum = 0;
  let sumGvitGlass = 0;
  let sumGtotGlass = 0;

  for (const op of ops) {
    const split = computeMinergieWindowSolarSplit(op, project, stConst);
    const gVit = Number(op.gVit ?? 0.55);
    const gEff =
      op.blindMode === 'always_up'
        ? gVit
        : op.gtotMode === 'direct'
          ? Number(op.gStore ?? 0.15)
          : gVit * Number(op.gStore ?? 0.15);

    winAreaGross += split.grossArea;
    glassArea += split.glassArea;
    frameArea += split.frameArea;
    qLowSum += split.qLowWhDay;
    qHighSum += split.qHighWhDay;
    qLowGvitSum += gVit * split.qLowWhDay;
    qHighGtotSum += gEff * split.qHighWhDay;
    sumGvitGlass += gVit * split.glassArea;
    sumGtotGlass += gEff * split.glassArea;
  }

  const glazingIndexZg = glassArea / area; // Indice de vitrage net A_G / A_SNP (cadre déduit)
  const avgGVit = glassArea > 0 ? sumGvitGlass / glassArea : 0.55;
  const gTotEffective = glassArea > 0 ? sumGtotGlass / glassArea : 0.0;

  // 2. Capacité thermique spécifique C_R / A_SNP (Bauteile Minergie, plafonnée à 75 Wh/(m²·K))
  const rawCMin = fl.cSpecMinergie ?? fl.cSpec ?? 45;
  const thermalMassWhm2K = Math.round(Math.min(MINERGIE_THRESHOLDS.maxThermalMassCapWhm2K, Math.max(5, Number(rawCMin))) * 10) / 10;
  const massMinOk = thermalMassWhm2K >= MINERGIE_THRESHOLDS.minThermalMassWhm2K;

  // 3. Bilan d'énergie constructif journalier [Wh/j] (charges internes fixes = 120 Wh/(m²·j))
  const qMaxWhDay =
    (stConst.qVent + thermalMassWhm2K * stConst.dT - MINERGIE_THRESHOLDS.fixedConstructiveLoadWhm2d) * area +
    stConst.qVerre * glassArea +
    stConst.qCadre * frameArea;
  const qInWhDay = qLowGvitSum + qHighGtotSum;

  const bilanPct = qMaxWhDay > 0 ? (qInWhDay / qMaxWhDay) * 100 : glassArea > 0 ? 999 : 0;
  const gTotAuthorized =
    qHighSum > 1e-6
      ? Math.max(0.05, Math.min(avgGVit, (qMaxWhDay - qLowGvitSum) / qHighSum))
      : 0.15;
  const gTotOk = glassArea === 0 || gTotEffective <= gTotAuthorized + 0.0015;

  const solarLow200Pct = qMaxWhDay > 0 ? Math.round((qLowGvitSum / qMaxWhDay) * 1000) / 10 : 0;
  const solarHigh200Pct = qMaxWhDay > 0 ? Math.round((qHighGtotSum / qMaxWhDay) * 1000) / 10 : 0;
  const externalLoadPct = Math.round(bilanPct * 10) / 10;

  // 4. Résistance au vent SIA 261 / SIA 342
  const maxFloorTopM = project.floors.reduce(
    (mx, f) => Math.max(mx, (f.elevationZ || 0) + (f.height || 2.5)),
    2.5
  );
  const buildingHeightM = Math.max(2.5, project.buildingHeightM || maxFloorTopM);
  const terrainCat = project.terrainCat || 'III';
  const windRec = getMinergieRecommendedWindClass(
    buildingHeightM,
    fl.spaceType || 'residential',
    Boolean(project.foehnExposed),
    terrainCat,
    stationKey
  );
  const allWindSafe = ops.every(o => o.windSafe !== false && o.blindMode !== 'always_up');
  const shadingAutomated = ops.length === 0 || ops.every(o => o.blindMode === 'auto' || o.blindMode === 'always_down');

  const constructivePass = bilanPct <= 100.05 && massMinOk && allWindSafe;

  // 5. Type de local SIA 2024:2015 & stratégie estivale
  const roomTypeKey = fl.roomType2024 || getDefaultRoomTypeForSiaCat(fl.siaCategory || 'I');
  const roomType2024 = SIA2024_ROOM_TYPES[roomTypeKey] || SIA2024_ROOM_TYPES.hab_collectif;
  const internalLoadRefWhm2d = roomType2024.dailyLoadWhm2d || SIA2024_INTERNAL_LOAD_REF[fl.siaCategory] || 84;
  const internalLoadWhm2d = fr.gains?.internalTotal?.dailyWhm2d ?? internalLoadRefWhm2d;
  const internalLoadForAnalytical =
    fl.minergieInternalLoadWhm2d !== undefined && fl.minergieInternalLoadWhm2d !== null
      ? Number(fl.minergieInternalLoadWhm2d)
      : internalLoadWhm2d;

  const strategyKey = resolveSummerStrategyKey(fl, ops);
  const strategyRule = MINERGIE_STRATEGY_RULES[strategyKey] || MINERGIE_STRATEGY_RULES.day_night;
  const stratLossMap = {
    day: stConst.stratDay,
    day_night: stConst.stratDayNight,
    cross: stConst.stratCross,
    mech: stConst.stratMech,
    none: 0
  };
  const stratLossWhm2d = stratLossMap[strategyKey] ?? stConst.stratDay;

  // 6. Confort estival analytique Variante 2 (rapport gains / pertes)
  const pertesWhm2d =
    stratLossWhm2d +
    thermalMassWhm2K * stConst.dT * ((thermalMassWhm2K + 360) / 405) +
    stConst.qCadre * (frameArea / area) * ((frameArea + 1.5) / 1.5) +
    stConst.qVerre * (glassArea / area) * ((glazingIndexZg + 1.5) / 1.8);
  const gainsWhm2d = internalLoadForAnalytical + qInWhDay / area;
  const gainsLossesRatio = pertesWhm2d > 0 ? gainsWhm2d / pertesWhm2d : 9.99;

  let analyticalBandLabel = '> 130 h/an';
  if (gainsLossesRatio <= 0.70) analyticalBandLabel = '≤ 70 h/an';
  else if (gainsLossesRatio <= 0.97) analyticalBandLabel = '≤ 100 h/an';
  else if (gainsLossesRatio <= 1.05) analyticalBandLabel = '> 100 h/an';

  // Résultat analytique Variante 2 : non respecté d'office si la vérification constructive échoue
  const analyticalComfortPass = constructivePass && gainsLossesRatio <= 0.97;

  // 7. Justificatif par simulation dynamique (16 avril – 15 octobre, seuil 26.5 °C)
  const eval2035 = sim2035FloorResult || fr;
  const hoursOver265 = eval2035.overMinergie265 ?? fr.overMinergie265 ?? 0;
  const hoursOver265Current = fr.overMinergie265 ?? 0;
  const simComfortPass = hoursOver265 <= MINERGIE_THRESHOLDS.maxHoursOver265;

  // 8. Règles d'automatisation des stores & nécessité de refroidissement actif
  const automationRequired = internalLoadForAnalytical > strategyRule.autoReq;
  const automationRecommended =
    automationRequired ||
    internalLoadForAnalytical >= 100 ||
    Boolean(roomType2024.autoBlindsRec);
  const automationRuleOk = !automationRequired || shadingAutomated;
  const coolingRequiredByRule = internalLoadForAnalytical > strategyRule.coolReq;

  const depthRatio = fl.depthBehindWin / Math.max(1.8, fl.height);
  const depthWarning = depthRatio > MINERGIE_THRESHOLDS.maxRoomDepthRatio;

  const summerStrategyLabel =
    strategyKey === 'day'
      ? 'Fenêtres ouvertes le jour (occupation)'
      : strategyKey === 'cross'
        ? `Traversante jour & nuit (${fr.nomNightSpec.toFixed(1)} m³/(h·m²))`
        : strategyKey === 'day_night'
          ? `Fenêtres jour & nuit (${fr.nomNightSpec.toFixed(1)} m³/(h·m²))`
          : strategyKey === 'mech'
            ? `Ventilation mécanique (${fl.qHygSpec.toFixed(1)} m³/(h·m²))`
            : 'Aucune stratégie naturelle';

  return {
    glazingIndexZg,
    winArea: glassArea,
    winAreaGross,
    glassArea,
    frameArea,
    area,
    gTotAuthorized,
    gTotEffective,
    gTotOk,
    thermalMassWhm2K,
    massMinOk,
    massThresholdPct: 100,
    massReservePct: Math.round((100 - bilanPct) * 10) / 10,
    qMaxWhDay,
    qInWhDay,
    qLowWhDay: qLowSum,
    qHighWhDay: qHighSum,
    bilanPct,
    solarLow200Pct,
    solarHigh200Pct,
    externalLoadPct,
    unshadedKWh: fr.gains?.solarUnshaded?.summerKWh || 0,
    transKWh: fr.gains?.solarTransmitted?.summerKWh || 0,
    buildingHeightM,
    terrainCat,
    windRec,
    allWindSafe,
    shadingAutomated,
    constructivePass,
    // Volet 2 analytique (Variante 2)
    pertesWhm2d,
    gainsWhm2d,
    gainsLossesRatio,
    analyticalBandLabel,
    analyticalComfortPass,
    // Volet 2 simulation dynamique (16 avr.–15 oct.)
    hoursOver265,
    hoursOver265Current,
    simComfortPass,
    comfortPass: simComfortPass,
    globalPass: constructivePass && simComfortPass,
    analyticalGlobalPass: constructivePass && analyticalComfortPass && automationRuleOk && !coolingRequiredByRule,
    // Charges internes, stratégie & règles automatisation/froid
    roomType2024,
    internalLoadWhm2d,
    internalLoadRefWhm2d,
    internalLoadForAnalytical,
    strategyKey,
    strategyThresholds: strategyRule,
    stratLossWhm2d,
    automationRequired,
    automationRecommended,
    automationRuleOk,
    coolingRequiredByRule,
    stationClimateConstants: stConst,
    climateScenarioUsed: scenarioKey,
    nightSpecM3hm2: fr.nomNightSpec,
    summerStrategyLabel,
    depthRatio,
    depthWarning
  };
}
