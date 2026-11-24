/**
 * @fileoverview Paramètres climatiques des stations suisses calibrés sur les normales
 * MétéoSuisse 1991–2020, le cahier technique SIA 2028 (stations officielles vs libres),
 * les données de vent SIA 261 et les paramètres de bilan journalier Minergie (REF / 2035 / 2050 / 2100).
 *
 * Note licence : les paramètres des stations hors point de calibration public Sion 2035 sont
 * dérivés physiquement des normales publiques MétéoSuisse 1991–2020 et SIA 2028 (sans reprise
 * de tables propriétaires externes).
 */

export const SWISS_STATIONS = {
  SIO: {
    name: 'Sion',
    smnCode: 'sio',
    canton: 'VS',
    officialSIA: true,
    altM: 482,
    lat: 46.22,
    lon: 7.33,
    tMean: 10.4,
    ampAnn: 10.6,
    ampDay: 6.4,
    peakHeat: 6.4,
    synAmp: 3.1,
    clearSummer: 0.66,
    clearWinter: 0.44,
    altFactor: 1.03,
    uhiCity: false,
    vGustStationKmh: 54.3,
    hStationM: 10,
    terrainStation: 'II',
    foehnValley: true,
    // Constantes calibrées Sion 2035 (bilan journalier Wh/j) + poids solaire mensuel relatif avr.–oct.
    minergie2035: {
      qVent: 83.06,
      dT: 3.564,
      qVerre: 10.38,
      qCadre: 20.76,
      stratDay: 17.2,
      stratDayNight: 56.0,
      stratCross: 84.0,
      stratMech: 30.0
    },
    monthSolarWeights: [1.04, 1.04, 1.05, 1.08, 1.10, 1.10, 1.08]
  },
  GVE: {
    name: 'Genève',
    smnCode: 'gve',
    canton: 'GE',
    officialSIA: true,
    altM: 412,
    lat: 46.25,
    lon: 6.13,
    tMean: 10.8,
    ampAnn: 10.0,
    ampDay: 5.8,
    peakHeat: 5.8,
    synAmp: 3.0,
    clearSummer: 0.60,
    clearWinter: 0.34,
    altFactor: 1.01,
    uhiCity: true,
    vGustStationKmh: 54.0,
    hStationM: 10,
    terrainStation: 'II',
    foehnValley: false,
    monthSolarWeights: [0.97, 0.98, 0.99, 1.02, 1.02, 0.99, 0.96]
  },
  LSN: {
    name: 'Lausanne (Pully)',
    smnCode: 'puy',
    canton: 'VD',
    officialSIA: true,
    altM: 456,
    lat: 46.52,
    lon: 6.63,
    tMean: 10.3,
    ampAnn: 9.6,
    ampDay: 5.2,
    peakHeat: 5.4,
    synAmp: 2.9,
    clearSummer: 0.59,
    clearWinter: 0.35,
    altFactor: 1.01,
    uhiCity: true,
    vGustStationKmh: 52.0,
    hStationM: 10,
    terrainStation: 'II',
    foehnValley: false,
    monthSolarWeights: [0.96, 0.97, 0.98, 1.01, 1.01, 0.98, 0.95]
  },
  BER: {
    name: 'Berne',
    smnCode: 'ber',
    canton: 'BE',
    officialSIA: true,
    altM: 553,
    lat: 46.99,
    lon: 7.46,
    tMean: 9.2,
    ampAnn: 9.8,
    ampDay: 5.6,
    peakHeat: 5.3,
    synAmp: 3.0,
    clearSummer: 0.56,
    clearWinter: 0.33,
    altFactor: 1.01,
    uhiCity: true,
    vGustStationKmh: 51.0,
    hStationM: 10,
    terrainStation: 'II',
    foehnValley: false,
    monthSolarWeights: [0.92, 0.93, 0.95, 0.97, 0.97, 0.94, 0.91]
  },
  BAS: {
    name: 'Bâle (Binningen)',
    smnCode: 'bas',
    canton: 'BS',
    officialSIA: true,
    altM: 316,
    lat: 47.54,
    lon: 7.58,
    tMean: 10.7,
    ampAnn: 9.7,
    ampDay: 5.5,
    peakHeat: 5.6,
    synAmp: 3.0,
    clearSummer: 0.56,
    clearWinter: 0.32,
    altFactor: 1.00,
    uhiCity: true,
    vGustStationKmh: 52.5,
    hStationM: 10,
    terrainStation: 'II',
    foehnValley: false,
    monthSolarWeights: [0.91, 0.93, 0.94, 0.97, 0.97, 0.93, 0.90]
  },
  ZRH: {
    name: 'Zurich (SMA)',
    smnCode: 'sma',
    canton: 'ZH',
    officialSIA: true,
    altM: 556,
    lat: 47.38,
    lon: 8.57,
    tMean: 9.4,
    ampAnn: 9.7,
    ampDay: 5.3,
    peakHeat: 5.2,
    synAmp: 2.9,
    clearSummer: 0.55,
    clearWinter: 0.31,
    altFactor: 1.01,
    uhiCity: true,
    vGustStationKmh: 53.0,
    hStationM: 10,
    terrainStation: 'II',
    foehnValley: false,
    monthSolarWeights: [0.90, 0.92, 0.93, 0.96, 0.96, 0.92, 0.89]
  },
  LUG: {
    name: 'Lugano',
    smnCode: 'lug',
    canton: 'TI',
    officialSIA: true,
    altM: 273,
    lat: 46.00,
    lon: 8.96,
    tMean: 12.6,
    ampAnn: 10.0,
    ampDay: 5.1,
    peakHeat: 5.0,
    synAmp: 2.7,
    clearSummer: 0.62,
    clearWinter: 0.48,
    altFactor: 1.01,
    uhiCity: false,
    vGustStationKmh: 48.0,
    hStationM: 10,
    terrainStation: 'II',
    foehnValley: false,
    monthSolarWeights: [0.99, 1.00, 1.02, 1.05, 1.05, 1.02, 0.98]
  },
  MVE: {
    name: 'Montana',
    smnCode: 'mve',
    canton: 'VS',
    officialSIA: true,
    altM: 1427,
    lat: 46.30,
    lon: 7.46,
    tMean: 6.0,
    ampAnn: 8.9,
    ampDay: 5.1,
    peakHeat: 6.9,
    synAmp: 3.3,
    clearSummer: 0.65,
    clearWinter: 0.51,
    altFactor: 1.07,
    uhiCity: false,
    vGustStationKmh: 50.0,
    hStationM: 10,
    terrainStation: 'II',
    foehnValley: false,
    monthSolarWeights: [1.03, 1.04, 1.05, 1.07, 1.08, 1.07, 1.05]
  },
  GSB: {
    name: 'Col du Grand-St-Bernard',
    smnCode: 'gsb',
    canton: 'VS',
    officialSIA: true,
    altM: 2472,
    lat: 45.87,
    lon: 7.17,
    tMean: -0.3,
    ampAnn: 7.6,
    ampDay: 3.4,
    peakHeat: 6.2,
    synAmp: 3.1,
    clearSummer: 0.57,
    clearWinter: 0.47,
    altFactor: 1.10,
    uhiCity: false,
    vGustStationKmh: 68.0,
    hStationM: 10,
    terrainStation: 'II',
    foehnValley: true,
    monthSolarWeights: [0.96, 0.97, 0.98, 1.01, 1.01, 0.98, 0.95]
  },
  ZER: {
    name: 'Zermatt',
    smnCode: 'zer',
    canton: 'VS',
    officialSIA: false, // Hors liste officielle SIA 2028 (disponible en mode libre / custom uniquement)
    altM: 1638,
    lat: 46.02,
    lon: 7.75,
    tMean: 4.5,
    ampAnn: 9.1,
    ampDay: 5.6,
    peakHeat: 6.7,
    synAmp: 3.2,
    clearSummer: 0.64,
    clearWinter: 0.50,
    altFactor: 1.07,
    uhiCity: false,
    vGustStationKmh: 47.0,
    hStationM: 10,
    terrainStation: 'II',
    foehnValley: false,
    monthSolarWeights: [1.02, 1.03, 1.04, 1.06, 1.07, 1.05, 1.03]
  }
};

export const CLIMATE_SCENARIOS = {
  REF:    { label: 'Climat de référence (2010 / SIA 2028)',           annualDeltaC: 0.0, summerExtraC: 0.0 },
  '2035': { label: 'Projection Minergie 2035 (+1.1 °C / +1.5 °C été)', annualDeltaC: 1.1, summerExtraC: 0.4 },
  '2050': { label: 'Projection 2050 (+1.5 °C / +2.0 °C été)',         annualDeltaC: 1.5, summerExtraC: 0.5 },
  '2100': { label: 'Projection 2100 (+4.2 °C / +5.8 °C été, CH2018)', annualDeltaC: 4.2, summerExtraC: 1.6 }
};

/**
 * Localités suisses courantes pour le mode Strict SIA 2028
 * (associe automatiquement la station officielle SIA 2028 la plus proche en distance & altitude).
 */
export const SWISS_LOCALITIES = [
  { id: 'sion',         name: 'Sion',                  canton: 'VS', lat: 46.233, lon: 7.360, altM: 515 },
  { id: 'martigny',     name: 'Martigny',              canton: 'VS', lat: 46.103, lon: 7.073, altM: 471 },
  { id: 'sierre',       name: 'Sierre',                canton: 'VS', lat: 46.292, lon: 7.535, altM: 533 },
  { id: 'monthey',      name: 'Monthey',               canton: 'VS', lat: 46.256, lon: 6.954, altM: 430 },
  { id: 'brig',         name: 'Brigue / Viège',        canton: 'VS', lat: 46.316, lon: 7.988, altM: 678 },
  { id: 'crans',        name: 'Crans-Montana',         canton: 'VS', lat: 46.312, lon: 7.479, altM: 1495 },
  { id: 'verbier',      name: 'Verbier',               canton: 'VS', lat: 46.096, lon: 7.228, altM: 1500 },
  { id: 'zermatt',      name: 'Zermatt (non-SIA → Montana)', canton: 'VS', lat: 46.020, lon: 7.749, altM: 1620 },
  { id: 'bourg_st_p',   name: 'Bourg-St-Pierre / St-Bernard', canton: 'VS', lat: 45.948, lon: 7.207, altM: 2100 },
  { id: 'geneve',       name: 'Genève',                canton: 'GE', lat: 46.204, lon: 6.143, altM: 375 },
  { id: 'nyon',         name: 'Nyon / Morges',         canton: 'VD', lat: 46.383, lon: 6.239, altM: 403 },
  { id: 'lausanne',     name: 'Lausanne',              canton: 'VD', lat: 46.519, lon: 6.632, altM: 495 },
  { id: 'montreux',     name: 'Vevey / Montreux',      canton: 'VD', lat: 46.431, lon: 6.911, altM: 390 },
  { id: 'fribourg',     name: 'Fribourg',              canton: 'FR', lat: 46.806, lon: 7.162, altM: 610 },
  { id: 'neuchatel',    name: 'Neuchâtel',             canton: 'NE', lat: 46.990, lon: 6.929, altM: 430 },
  { id: 'berne',        name: 'Berne',                 canton: 'BE', lat: 46.948, lon: 7.447, altM: 540 },
  { id: 'bale',         name: 'Bâle',                  canton: 'BS', lat: 47.559, lon: 7.588, altM: 260 },
  { id: 'zurich',       name: 'Zurich',                canton: 'ZH', lat: 47.377, lon: 8.542, altM: 408 },
  { id: 'lucerne',      name: 'Lucerne',               canton: 'LU', lat: 47.050, lon: 8.309, altM: 436 },
  { id: 'lugano',       name: 'Lugano / Bellinzone',   canton: 'TI', lat: 46.004, lon: 8.951, altM: 273 }
];

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Retourne la liste des stations officielles SIA 2028.
 */
export function getOfficialSiaStations() {
  return Object.entries(SWISS_STATIONS)
    .filter(([, st]) => st.officialSIA)
    .map(([key, st]) => ({ key, ...st }));
}

/**
 * Trouve la station officielle SIA 2028 la plus représentative pour un lieu donné
 * (distance géographique Haversine + pondération altitudinale SIA pour distinguer plaine / moyenne / haute montagne).
 *
 * @param {number} lat Latitude [°N]
 * @param {number} lon Longitude [°E]
 * @param {number|null} [altM=null] Altitude du site [m]
 * @returns {{ stationKey: string, station: object, distKm: number, altDiffM: number|null }}
 */
export function findNearestOfficialSiaStation(lat, lon, altM = null) {
  const officials = getOfficialSiaStations();
  let best = null;
  for (const st of officials) {
    const distKm = haversineKm(lat, lon, st.lat, st.lon);
    const altDiffM = altM !== null && Number.isFinite(Number(altM)) ? Math.abs(Number(altM) - st.altM) : null;
    // En zone alpine (ex. Valais), 100 m d'écart d'altitude pèse ~9 km de distance horizontale
    const score = distKm + (altDiffM !== null ? altDiffM * 0.09 : 0);
    if (!best || score < best.score) {
      best = { stationKey: st.key, station: st, distKm, altDiffM, score };
    }
  }
  return {
    stationKey: best.stationKey,
    station: best.station,
    distKm: Math.round(best.distKm * 10) / 10,
    altDiffM: best.altDiffM !== null ? Math.round(best.altDiffM) : null
  };
}

/**
 * Retourne les constantes de bilan journalier estival Minergie (q_vent, ΔT, q_verre, q_cadre
 * et pertes par stratégie estivale) pour une station suisse et un scénario climatique donnés.
 *
 * Calibré exactement sur Sion 2035 (83.06 Wh/(m²·j), 3.564 K, 10.38, 20.76 Wh/(m²·j), stratégie jour 17.2)
 * et dérivé physiquement des normales climatiques MétéoSuisse pour les autres stations & horizons.
 */
export function getMinergieStationConstants(stationKey = 'SIO', scenarioKey = '2035', uhi = false) {
  const st = SWISS_STATIONS[stationKey] || SWISS_STATIONS.SIO;
  const sc = CLIMATE_SCENARIOS[scenarioKey] || CLIMATE_SCENARIOS['2035'];
  const sc2035 = CLIMATE_SCENARIOS['2035'];

  // Température moyenne estivale représentative (juil.–août) de la station vs Sion 2035
  const sion = SWISS_STATIONS.SIO;
  const tSumSion2035 = sion.tMean + sion.ampAnn + sc2035.annualDeltaC + sc2035.summerExtraC; // ~22.5 °C
  const uhiShift = uhi ? 1.0 : 0.0;
  const tSumSite = st.tMean + st.ampAnn + sc.annualDeltaC + sc.summerExtraC + uhiShift;
  const deltaSummerC = tSumSite - tSumSion2035; // >0 plus chaud, <0 plus frais

  if (st.minergie2035 && scenarioKey === '2035' && !uhi) {
    return {
      ...st.minergie2035,
      monthSolarWeights: st.monthSolarWeights || [1, 1, 1, 1, 1, 1, 1]
    };
  }

  // Modèle physique linéaire autour du point de référence Sion 2035 :
  // - Plus l'été est frais (altitude ou REF), plus le potentiel de refroidissement diurne/nocturne (qVent, ΔT, verre/cadre) augmente.
  // - Plus l'amplitude journalière ampDay est grande, plus ΔT disponible pour la masse thermique augmente.
  const base = sion.minergie2035;
  const ampRatio = Math.max(0.65, Math.min(1.15, st.ampDay / sion.ampDay));

  const qVent = Math.max(20, Math.round((base.qVent - deltaSummerC * 12.5) * 100) / 100);
  const dT = Math.max(1.5, Math.round(((base.dT - deltaSummerC * 0.24) * (0.7 + 0.3 * ampRatio)) * 1000) / 1000);
  const qVerre = Math.max(2.0, Math.round((base.qVerre - deltaSummerC * 1.65) * 100) / 100);
  const qCadre = Math.round(qVerre * 2.0 * 100) / 100;

  const stratScale = Math.max(0.35, 1 - deltaSummerC * 0.13);
  return {
    qVent,
    dT,
    qVerre,
    qCadre,
    stratDay: Math.round(base.stratDay * stratScale * 10) / 10,
    stratDayNight: Math.round(base.stratDayNight * stratScale * 10) / 10,
    stratCross: Math.round(base.stratCross * stratScale * 10) / 10,
    stratMech: Math.round(base.stratMech * stratScale * 10) / 10,
    monthSolarWeights: st.monthSolarWeights || [1, 1, 1, 1, 1, 1, 1]
  };
}
