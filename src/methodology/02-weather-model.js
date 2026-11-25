/**
 * @fileoverview Étape 02 — Modèle climatique suisse synthétique, récupération directe
 * (PVGIS 5.3, MétéoSuisse OGD, Open-Meteo ERA5) et parseurs météo multi-formats :
 * PVGIS (JSON/CSV), EnergyPlus/Meteonorm (.epw), SIA 2028 (.dat/.cli), MétéoSuisse OGD (.csv) et Open-Meteo JSON.
 */

import { SWISS_STATIONS, CLIMATE_SCENARIOS } from '../standards/swiss-stations.js';
import {
  erbsDiffuseFraction,
  solarPosition,
  splitGlobalToComponents
} from './01-solar-geometry.js';

export function dayOfYearFromYMD(ymd) {
  const s = String(ymd || '');
  const y = parseInt(s.slice(0, 4), 10) || 2022;
  const m = parseInt(s.slice(4, 6), 10) || 1;
  const d = parseInt(s.slice(6, 8), 10) || 1;
  return Math.max(
    1,
    Math.min(365, Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1)
  );
}

/**
 * Décale une série horaire UTC (PVGIS) vers l'heure locale suisse (CET+1 / CEST+2).
 */
export function shiftUtcToLocal(raw, lat, lon, tzMode = 'cet_cest') {
  const n = raw.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const doyBase = raw[i].doy || Math.floor(i / 24) + 1;
    const isDst = doyBase >= 85 && doyBase <= 300;
    const shiftH = tzMode === 'utc' ? 0 : tzMode === 'cet' ? 1 : isDst ? 2 : 1;
    const src = raw[(i - shiftH + n) % n];
    const d = Math.floor(i / 24) % 365;
    const hod = i % 24;
    const solarHod = tzMode === 'cet_cest' && isDst ? hod - 0.5 : hod + 0.5;
    out.push({
      h: i,
      d,
      hod,
      Te: src.Te,
      Igh: src.Igh,
      Ibn: src.Ibn,
      Idh: src.Idh,
      sun: solarPosition(d + 1, solarHod, lat, lon, tzMode === 'utc' ? 0 : 1)
    });
  }
  return out;
}

/**
 * Surcharge diurne de l'effet « Îlot de chaleur » urbain (UHI, Minergie / MétéoSuisse) :
 * +0.4 °C en journée et jusqu'à +1.8 °C en fin de nuit (~03h00), réduisant le potentiel
 * de rafraîchissement nocturne et augmentant les nuits tropicales.
 */
function uhiHourlyDelta(hod) {
  return 0.4 + 1.4 * 0.5 * (1 + Math.cos((2 * Math.PI * (hod - 3.0)) / 24));
}

/**
 * Génère 8760 heures climatiques synthétiques calibrées sur une station suisse,
 * incluant deux épisodes de canicule estivale et un cycle diurne réaliste.
 *
 * @param {string} stationKey Code station (SIO, GVE, ZRH, etc.)
 * @param {string} scenarioKey 'REF' | '2035' | '2050' | '2100'
 * @param {boolean} [urbanHeatIsland=false] Activer l'effet d'îlot de chaleur urbain (UHI)
 */
export function generateSyntheticWeather(stationKey = 'SIO', scenarioKey = 'REF', urbanHeatIsland = false) {
  const st = SWISS_STATIONS[stationKey] || SWISS_STATIONS.SIO;
  const sc = CLIMATE_SCENARIOS[scenarioKey] || CLIMATE_SCENARIOS.REF;

  let seed = 4219;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const randN = () => (rand() + rand() + rand() - 1.5) * 2.0;

  const synAmp = st.synAmp ?? 3.0;
  const clearSummer = st.clearSummer ?? st.clearness ?? 0.62;
  const clearWinter = st.clearWinter ?? Math.max(0.30, clearSummer - 0.22);
  const altFactor = st.altFactor ?? 1.0;

  const dailyWeather = [];
  let syn = 0;
  let cldNoise = 0;
  for (let d = 0; d < 365; d++) {
    // Variabilité synoptique AR(1) (τ ≈ 3.5 jours, fronts froids et dorsales anticycloniques)
    syn = 0.74 * syn + randN() * synAmp * 0.64;

    // Régime estival suisse réaliste : 3 vagues de chaleur alternant avec des passages frais
    // (moyenne proche de zéro sur JJA afin de respecter les normales mensuelles MétéoSuisse)
    const hwPos =
      st.peakHeat * 0.80 * Math.exp(-Math.pow((d - 172) / 4.8, 2)) +
      st.peakHeat * 1.00 * Math.exp(-Math.pow((d - 198) / 5.5, 2)) +
      st.peakHeat * 0.90 * Math.exp(-Math.pow((d - 224) / 5.5, 2));
    const coolTroughs =
      -st.peakHeat * 0.42 * Math.exp(-Math.pow((d - 158) / 4.5, 2)) +
      -st.peakHeat * 0.48 * Math.exp(-Math.pow((d - 185) / 4.2, 2)) +
      -st.peakHeat * 0.44 * Math.exp(-Math.pow((d - 211) / 3.8, 2)) +
      -st.peakHeat * 0.44 * Math.exp(-Math.pow((d - 240) / 5.0, 2));
    // Saturation douce empêchant une superposition irréaliste du bruit synoptique sur un pic de canicule
    const rawAnom = syn + hwPos + coolTroughs;
    const cap = st.peakHeat + 2.6;
    const anom = rawAnom > 0 ? cap * Math.tanh(rawAnom / cap) : rawAnom;
    const coldSnap = -4.2 * Math.exp(-Math.pow((d - 18) / 5.0, 2));

    // Nébulosité saisonnière (stratus hivernal sur le Plateau, ciels plus dégagés l'été)
    const seasonWave = 0.5 * (1 - Math.cos((2 * Math.PI * (d - 15)) / 365));
    const clearBase = clearWinter + (clearSummer - clearWinter) * seasonWave;
    cldNoise = 0.45 * cldNoise + (rand() - 0.5) * 0.34;
    const cloud = Math.max(
      0.14,
      Math.min(0.86, clearBase + anom * 0.032 + cldNoise)
    );
    dailyWeather.push({ anom, hwPos, coldSnap, cloud });
  }

  const hours = [];
  for (let h = 0; h < 8760; h++) {
    const d = Math.floor(h / 24);
    const hod = h % 24;
    const dw = dailyWeather[d];
    const isSummer = d >= 135 && d <= 258;
    const tBase =
      st.tMean +
      sc.annualDeltaC +
      (isSummer ? sc.summerExtraC : 0) -
      st.ampAnn * Math.cos((2 * Math.PI * (d - 18)) / 365);

    // Cycle diurne asymétrique réaliste (min ~05h00, max ~15h30, nuits plus douces par canicule)
    const phi = (2 * Math.PI * (hod - 5.0)) / 24;
    const diurnalShape = -Math.cos(phi) - 0.16 * Math.sin(2 * phi);
    const nightWarm = Math.max(0, dw.hwPos * 0.38);
    const dayScale = 0.58 + 0.62 * (dw.cloud / 0.75);
    const ampEff = st.ampDay * Math.min(1.18, dayScale);

    const Te =
      tBase +
      dw.anom +
      dw.coldSnap +
      nightWarm * (diurnalShape < 0 ? 1.0 : 0.22) +
      ampEff * diurnalShape +
      (urbanHeatIsland ? uhiHourlyDelta(hod) : 0);

    const sun = solarPosition(d + 1, hod + 0.5, st.lat, st.lon, 1);
    let Igh = 0;
    let Ibn = 0;
    let Idh = 0;
    if (sun.cosZ > 0.02) {
      const airMass = 1 / Math.max(0.08, sun.cosZ);
      const amAtten = Math.exp(-0.10 * Math.max(0, airMass - 1.15));
      const kt = Math.min(0.82 * altFactor, dw.cloud * 1.03 * amAtten * altFactor);
      const I0 = 1361 * (1 + 0.033 * Math.cos((2 * Math.PI * (d + 1)) / 365));
      Igh = Math.max(0, I0 * sun.cosZ * kt);
      Idh = Igh * erbsDiffuseFraction(kt);
      Ibn = Math.max(0, (Igh - Idh) / sun.cosZ);
    }
    hours.push({ h, d, hod, Te, Igh, Ibn, Idh, sun });
  }

  return {
    sourceLabel: `Climat suisse synthétique : ${st.name} (${scenarioKey}${urbanHeatIsland ? ' + Îlot chaleur' : ''})`,
    data: hours
  };
}

/**
 * Applique un scénario de réchauffement (ex. 2035 ou 2050) et éventuellement l'effet
 * d'îlot de chaleur urbain à n'importe quelle série horaire (y compris un fichier PVGIS/EPW importé).
 */
export function applyClimateDelta(weatherObj, scenarioKey = '2050', urbanHeatIsland = false) {
  const sc = CLIMATE_SCENARIOS[scenarioKey] || CLIMATE_SCENARIOS['2050'];
  return {
    ...weatherObj,
    sourceLabel: `${weatherObj.sourceLabel} + ${scenarioKey}${urbanHeatIsland ? ' + Îlot chaleur' : ''}`,
    data: weatherObj.data.map(hr => {
      const isSummer = hr.d >= 135 && hr.d <= 258;
      return {
        ...hr,
        Te:
          hr.Te +
          sc.annualDeltaC +
          (isSummer ? sc.summerExtraC : 0) +
          (urbanHeatIsland ? uhiHourlyDelta(hr.hod) : 0)
      };
    })
  };
}

/**
 * Génère une séquence périodique de 14 jours estivaux identiques (336 h) à partir d'une
 * journée type manuelle choisie par l'utilisateur (θ_e min, θ_e max, irradiance globale pic).
 * Permet de tester directement la tenue du bâtiment face à une journée de canicule ciblée
 * en régime périodique établi (inertie thermique 5R1C pré-amorcée).
 */
export function generateManualDesignDayWeather({
  tMin = 18,
  tMax = 34,
  peakIgh = 850,
  dayOfYear = 201,
  lat = 46.22,
  lon = 7.33,
  daysCount = 14
} = {}) {
  const lo = Math.min(Number(tMin) || 18, Number(tMax) || 34);
  const hi = Math.max(Number(tMin) || 18, Number(tMax) || 34);
  const peak = Math.max(0, Math.min(1200, Number(peakIgh) || 850));
  const doyCenter = Math.max(125, Math.min(265, Math.round(Number(dayOfYear) || 201)));
  const nDays = Math.max(7, Math.min(30, Math.round(Number(daysCount) || 14)));

  // Forme diurne réaliste normalisée sur [0, 1] (min à 05h00, max à ~15h00)
  const rawShapes = [];
  for (let hod = 0; hod < 24; hod++) {
    const phi = (2 * Math.PI * (hod - 5.0)) / 24;
    rawShapes.push(-Math.cos(phi) - 0.14 * Math.sin(2 * phi));
  }
  const sMin = Math.min(...rawShapes);
  const sMax = Math.max(...rawShapes);
  const normShapes = rawShapes.map(v => (sMax > sMin ? (v - sMin) / (sMax - sMin) : 0.5));

  // Pré-calcul du profil solaire sur le jour choisi afin que le pic d'irradiance atteigne exactement peakIgh
  const refSun = [];
  let maxCosZ = 0;
  for (let hod = 0; hod < 24; hod++) {
    const sun = solarPosition(doyCenter, hod + 0.5, lat, lon, 1);
    refSun.push(sun);
    if (sun.cosZ > maxCosZ) maxCosZ = sun.cosZ;
  }

  const startDay = Math.max(121, doyCenter - Math.floor(nDays / 2));
  const hours = [];
  for (let dayOffset = 0; dayOffset < nDays; dayOffset++) {
    const d = startDay + dayOffset;
    for (let hod = 0; hod < 24; hod++) {
      const h = dayOffset * 24 + hod;
      const Te = lo + (hi - lo) * normShapes[hod];
      const sun = refSun[hod];
      let Igh = 0;
      let Ibn = 0;
      let Idh = 0;
      if (peak > 0 && sun.cosZ > 0.02 && maxCosZ > 0.05) {
        const weight = Math.pow(sun.cosZ / maxCosZ, 1.15);
        Igh = peak * weight;
        const comp = splitGlobalToComponents(Igh, sun, doyCenter);
        Ibn = comp.Ibn;
        Idh = comp.Idh;
      }
      hours.push({ h, d, hod, Te, Igh, Ibn, Idh, sun });
    }
  }

  return {
    sourceLabel: `Journée type manuelle (${lo.toFixed(1)}..${hi.toFixed(1)} °C • ${peak.toFixed(0)} W/m²)`,
    isManualDesignDay: true,
    manualConfig: { tMin: lo, tMax: hi, peakIgh: peak, dayOfYear: doyCenter },
    data: hours
  };
}

/**
 * Calcule un résumé statistique synthétique d'une série météo pour l'affichage utilisateur.
 */
export function summarizeWeatherData(weatherObj) {
  const arr = weatherObj?.data || [];
  if (arr.length === 0) {
    return { hoursCount: 0, daysCount: 0, minTe: 0, maxTe: 0, peakIgh: 0, tropicalNights: 0 };
  }
  let minTe = Infinity;
  let maxTe = -Infinity;
  let peakIgh = 0;
  const dayMin = new Map();
  for (const hr of arr) {
    if (hr.Te < minTe) minTe = hr.Te;
    if (hr.Te > maxTe) maxTe = hr.Te;
    if ((hr.Igh || 0) > peakIgh) peakIgh = hr.Igh || 0;
    const prev = dayMin.get(hr.d);
    if (prev === undefined || hr.Te < prev) dayMin.set(hr.d, hr.Te);
  }
  let tropicalNights = 0;
  for (const v of dayMin.values()) {
    if (v >= 20.0) tropicalNights++;
  }
  return {
    hoursCount: arr.length,
    daysCount: Math.max(1, Math.round(arr.length / 24)),
    minTe,
    maxTe,
    peakIgh,
    tropicalNights
  };
}

/**
 * Parse un fichier météo : PVGIS JSON, Open-Meteo JSON, EnergyPlus/Meteonorm EPW,
 * MétéoSuisse OGD CSV (`tre200h0` / `gre000h0`), SIA 2028 (`.dat` / `.cli`) ou PVGIS CSV.
 * @param {string} text Contenu brut du fichier
 * @param {string} sourceName Nom du fichier
 * @param {{ lat?: number, lon?: number, tzMode?: string, station?: string }} [climateSettings]
 */
export function parseAnyWeatherText(text, sourceName = 'Import', climateSettings = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Fichier météo vide.');

  const tzMode = climateSettings.tzMode || 'cet_cest';
  const stDef = SWISS_STATIONS[climateSettings.station] || null;
  let lat = Number(climateSettings.lat) || stDef?.lat || 46.22;
  let lon = Number(climateSettings.lon) || stDef?.lon || 7.33;

  // 1. JSON : PVGIS 5.3 ou Open-Meteo Archive
  if (trimmed.startsWith('{')) {
    const obj = JSON.parse(trimmed);

    // 1a. Open-Meteo Archive JSON (hourly.time + temperature_2m + shortwave_radiation)
    if (obj.hourly && Array.isArray(obj.hourly.time) && Array.isArray(obj.hourly.temperature_2m)) {
      if (Number.isFinite(Number(obj.latitude))) lat = Number(obj.latitude);
      if (Number.isFinite(Number(obj.longitude))) lon = Number(obj.longitude);
      const times = obj.hourly.time;
      const temps = obj.hourly.temperature_2m;
      const sw = obj.hourly.shortwave_radiation || [];
      const dni = obj.hourly.direct_normal_irradiance || [];
      const dif = obj.hourly.diffuse_radiation || [];
      const nUse = Math.min(times.length, 8760);
      const offset = times.length > 8760 ? times.length - 8760 : 0;
      const raw = [];
      let lastTe = 10;
      for (let i = 0; i < nUse; i++) {
        const idx = offset + i;
        const ts = String(times[idx] || '');
        const ymd = ts.slice(0, 10).replaceAll('-', '');
        const doy = ymd.length === 8 ? dayOfYearFromYMD(ymd) : Math.floor(i / 24) + 1;
        const hodUtc = parseInt(ts.slice(11, 13), 10) || i % 24;
        const tVal = Number(temps[idx]);
        const Te = Number.isFinite(tVal) ? (lastTe = tVal) : lastTe;
        const Igh = Math.max(0, Number(sw[idx]) || 0);
        let Ibn = Number(dni[idx]);
        let Idh = Number(dif[idx]);
        if (!Number.isFinite(Ibn) || !Number.isFinite(Idh) || (Igh > 0 && Ibn === 0 && Idh === 0)) {
          const sun = solarPosition(doy, hodUtc + 0.5, lat, lon, 0);
          const sp = splitGlobalToComponents(Igh, sun, doy);
          Ibn = sp.Ibn;
          Idh = sp.Idh;
        }
        raw.push({ doy, Te, Igh, Ibn: Math.max(0, Ibn), Idh: Math.max(0, Idh) });
      }
      if (raw.length < 24) throw new Error('JSON Open-Meteo invalide (moins de 24 h).');
      const yearTag = String(times[offset] || '').slice(0, 4) || 'ERA5';
      return {
        sourceLabel: `Open-Meteo ERA5 (${yearTag}) ${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E`,
        data: shiftUtcToLocal(raw, lat, lon, tzMode)
      };
    }

    // 1b. PVGIS JSON
    if (obj.inputs?.location) {
      lat = parseFloat(obj.inputs.location.latitude) || lat;
      lon = parseFloat(obj.inputs.location.longitude) || lon;
    }
    const arr = obj.outputs && (obj.outputs.tmy_hourly || obj.outputs.hourly);
    if (!Array.isArray(arr) || arr.length < 24) throw new Error('JSON météo (PVGIS / Open-Meteo) non reconnu.');
    const isTmy = Boolean(obj.outputs.tmy_hourly);
    const slice = arr.length > 8760 ? arr.slice(arr.length - 8760) : arr;
    const raw = slice.map((row, idx) => {
      const [ymd, hm = '0000'] = String(row['time(UTC)'] || row['time'] || '').split(':');
      const doy = ymd.length === 8 ? dayOfYearFromYMD(ymd) : Math.floor(idx / 24) + 1;
      const hodUtc =
        (parseInt(hm.slice(0, 2), 10) || idx % 24) + (parseInt(hm.slice(2, 4), 10) || 0) / 60;
      const Te = Number(row['T2m']);
      if (isTmy || row['G(h)'] !== undefined) {
        return {
          doy,
          Te,
          Igh: Math.max(0, Number(row['G(h)']) || 0),
          Ibn: Math.max(0, Number(row['Gb(n)']) || 0),
          Idh: Math.max(0, Number(row['Gd(h)']) || 0)
        };
      }
      const gb = Math.max(0, Number(row['Gb(i)']) || 0);
      const gd = Math.max(0, Number(row['Gd(i)']) || 0);
      const gi = row['G(i)'] !== undefined ? Math.max(0, Number(row['G(i)'])) : gb + gd;
      const sun = solarPosition(doy, hodUtc, lat, lon, 0);
      if (row['Gb(i)'] !== undefined) {
        return { doy, Te, Igh: gb + gd, Ibn: sun.cosZ > 0.03 ? gb / sun.cosZ : 0, Idh: gd };
      }
      const sp = splitGlobalToComponents(gi, sun, doy);
      return { doy, Te, Igh: gi, Ibn: sp.Ibn, Idh: sp.Idh };
    });
    return {
      sourceLabel: `PVGIS JSON (${isTmy ? 'TMY' : 'Série horaire'}) ${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E`,
      data: shiftUtcToLocal(raw, lat, lon, tzMode)
    };
  }

  // 2. EnergyPlus / Meteonorm EPW
  const lines = trimmed.split(/\r?\n/);
  if (sourceName.toLowerCase().endsWith('.epw') || lines[0].startsWith('LOCATION,')) {
    const loc = lines[0].split(',');
    lat = parseFloat(loc[6]) || lat;
    lon = parseFloat(loc[7]) || lon;
    const tz = parseFloat(loc[8]) || 1;
    const hours = [];
    for (let i = 8; i < lines.length && hours.length < 8760; i++) {
      const c = lines[i].split(',');
      if (c.length < 16) continue;
      const h = hours.length;
      const d = Math.floor(h / 24);
      const hod = h % 24;
      hours.push({
        h,
        d,
        hod,
        Te: parseFloat(c[6]),
        Igh: Math.max(0, parseFloat(c[13]) || 0),
        Ibn: Math.max(0, parseFloat(c[14]) || 0),
        Idh: Math.max(0, parseFloat(c[15]) || 0),
        sun: solarPosition(d + 1, hod + 0.5, lat, lon, tz)
      });
    }
    if (hours.length < 24) throw new Error('EPW invalide (moins de 24 heures).');
    return { sourceLabel: `EPW : ${loc[1] || sourceName} (${hours.length} h)`, data: hours };
  }

  // 3. MétéoSuisse Open Data (OGD SwissMetNet CSV : tre200h0 + gre000h0)
  const firstHeaderIdx = lines.findIndex(
    l => l.includes('tre200h0') && (l.includes('reference_timestamp') || l.includes('time') || l.includes('station_abbr') || l.includes('stn'))
  );
  if (firstHeaderIdx >= 0) {
    const sep = lines[firstHeaderIdx].includes(';') ? ';' : ',';
    const cols = lines[firstHeaderIdx].split(sep).map(s => s.trim().toLowerCase());
    const iStn = cols.findIndex(c => c === 'station_abbr' || c === 'stn');
    const iTime = cols.findIndex(c => c === 'reference_timestamp' || c === 'time');
    const iTe = cols.indexOf('tre200h0');
    const iGh = cols.indexOf('gre000h0');
    const iGd = cols.indexOf('ods000h0'); // diffus si présent

    const byYear = new Map();
    let detectedStn = '';
    let lastTe = 10;

    for (let i = firstHeaderIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const p = line.split(sep);
      if (p.length <= Math.max(iTime, iTe)) continue;
      if (!detectedStn && iStn >= 0 && p[iStn]) detectedStn = p[iStn].trim().toUpperCase();

      const ts = (p[iTime] || '').trim();
      let yr = 2024;
      let mo = 1;
      let da = 1;
      let hr = 0;
      const mDMY = ts.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
      const mYMD = ts.match(/^(\d{4})(\d{2})(\d{2})(\d{2})/);
      if (mDMY) {
        da = parseInt(mDMY[1], 10);
        mo = parseInt(mDMY[2], 10);
        yr = parseInt(mDMY[3], 10);
        hr = parseInt(mDMY[4], 10);
      } else if (mYMD) {
        yr = parseInt(mYMD[1], 10);
        mo = parseInt(mYMD[2], 10);
        da = parseInt(mYMD[3], 10);
        hr = parseInt(mYMD[4], 10);
      } else {
        continue;
      }

      // Ignorer le 29 février pour obtenir 365 jours standard (8760 h)
      if (mo === 2 && da === 29) continue;

      const tParsed = parseFloat(p[iTe]);
      const Te = Number.isFinite(tParsed) ? (lastTe = tParsed) : lastTe;
      const Igh = iGh >= 0 ? Math.max(0, parseFloat(p[iGh]) || 0) : 0;
      const doy = Math.max(
        1,
        Math.min(365, Math.floor((Date.UTC(2023, mo - 1, da) - Date.UTC(2023, 0, 1)) / 86400000) + 1)
      );
      const sun = solarPosition(doy, hr + 0.5, lat, lon, 0);
      let Idh;
      let Ibn;
      if (iGd >= 0 && Number.isFinite(parseFloat(p[iGd]))) {
        Idh = Math.max(0, parseFloat(p[iGd]));
        Ibn = sun.cosZ > 0.03 ? Math.max(0, (Igh - Idh) / sun.cosZ) : 0;
      } else {
        const sp = splitGlobalToComponents(Igh, sun, doy);
        Ibn = sp.Ibn;
        Idh = sp.Idh;
      }

      if (!byYear.has(yr)) byYear.set(yr, []);
      byYear.get(yr).push({ doy, Te, Igh, Ibn, Idh });
    }

    // Choisir l'année complète la plus récente (≥ 8500 h), sinon les 8760 dernières heures
    const yearsDesc = [...byYear.keys()].sort((a, b) => b - a);
    let chosenYear = yearsDesc[0] || '';
    let raw = [];
    for (const yr of yearsDesc) {
      if (byYear.get(yr).length >= 8500) {
        chosenYear = yr;
        raw = byYear.get(yr).slice(0, 8760);
        break;
      }
    }
    if (raw.length === 0) {
      const allRows = [...byYear.keys()].sort((a, b) => a - b).flatMap(y => byYear.get(y));
      raw = allRows.length > 8760 ? allRows.slice(allRows.length - 8760) : allRows;
    }
    if (raw.length < 24) throw new Error('CSV MétéoSuisse OGD invalide (moins de 24 h exploitables).');

    // Trouver coordonnées de la station si reconnue
    const stFound = Object.values(SWISS_STATIONS).find(
      s => s.smnCode.toUpperCase() === detectedStn
    );
    if (stFound) {
      lat = stFound.lat;
      lon = stFound.lon;
    }

    return {
      sourceLabel: `MétéoSuisse OGD : ${stFound?.name || detectedStn || sourceName} (${chosenYear || 'récent'}, ${raw.length} h)`,
      data: shiftUtcToLocal(raw, lat, lon, tzMode)
    };
  }

  // 4. PVGIS CSV
  let hIdx = -1;
  let sep = ',';
  for (let i = 0; i < Math.min(40, lines.length); i++) {
    if (lines[i].toLowerCase().includes('latitude')) {
      const m = lines[i].match(/[-+]?\d+(\.\d+)?/);
      if (m) lat = parseFloat(m[0]);
    }
    if (lines[i].toLowerCase().includes('longitude')) {
      const m = lines[i].match(/[-+]?\d+(\.\d+)?/);
      if (m) lon = parseFloat(m[0]);
    }
    if (lines[i].includes('T2m') && (lines[i].includes('time') || lines[i].includes('Date'))) {
      hIdx = i;
      sep = lines[i].includes(';') ? ';' : lines[i].includes('\t') ? '\t' : ',';
      break;
    }
  }

  if (hIdx >= 0) {
    const cols = lines[hIdx].split(sep).map(s => s.trim());
    const iT = cols.findIndex(c => c.toLowerCase().includes('time') || c.toLowerCase().includes('date'));
    const iT2m = cols.indexOf('T2m');
    const iGh = cols.indexOf('G(h)');
    const iGbn = cols.indexOf('Gb(n)');
    const iGdh = cols.indexOf('Gd(h)');
    const iGi = cols.indexOf('G(i)');
    const iGbi = cols.indexOf('Gb(i)');
    const iGdi = cols.indexOf('Gd(i)');
    const raw = [];

    for (let i = hIdx + 1; i < lines.length; i++) {
      const p = lines[i].split(sep).map(s => s.trim());
      if (p.length <= iT2m) continue;
      const Te = parseFloat(p[iT2m]);
      if (Number.isNaN(Te)) continue;
      const [ymd, hm = '0000'] = (iT >= 0 ? p[iT] : '').split(':');
      const doy = ymd.length === 8 ? dayOfYearFromYMD(ymd) : Math.floor(raw.length / 24) + 1;
      const hodUtc =
        (parseInt(hm.slice(0, 2), 10) || raw.length % 24) + (parseInt(hm.slice(2, 4), 10) || 0) / 60;

      if (iGh >= 0) {
        raw.push({
          doy,
          Te,
          Igh: Math.max(0, parseFloat(p[iGh]) || 0),
          Ibn: iGbn >= 0 ? Math.max(0, parseFloat(p[iGbn]) || 0) : 0,
          Idh: iGdh >= 0 ? Math.max(0, parseFloat(p[iGdh]) || 0) : 0
        });
      } else if (iGbi >= 0 && iGdi >= 0) {
        const gb = Math.max(0, parseFloat(p[iGbi]) || 0);
        const gd = Math.max(0, parseFloat(p[iGdi]) || 0);
        const sun = solarPosition(doy, hodUtc, lat, lon, 0);
        raw.push({ doy, Te, Igh: gb + gd, Ibn: sun.cosZ > 0.03 ? gb / sun.cosZ : 0, Idh: gd });
      } else if (iGi >= 0) {
        const gi = Math.max(0, parseFloat(p[iGi]) || 0);
        const sp = splitGlobalToComponents(gi, solarPosition(doy, hodUtc, lat, lon, 0), doy);
        raw.push({ doy, Te, Igh: gi, Ibn: sp.Ibn, Idh: sp.Idh });
      }
    }

    if (raw.length < 24) throw new Error('CSV PVGIS invalide.');
    const slice = raw.length > 8760 ? raw.slice(raw.length - 8760) : raw;
    return {
      sourceLabel: `PVGIS CSV : ${sourceName} (${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E)`,
      data: shiftUtcToLocal(slice, lat, lon, tzMode)
    };
  }

  // 5. SIA 2028 / Meteonorm (.dat / .cli / .csv / .txt — heure locale CET+1, colonnes flexibles)
  const lowerName = sourceName.toLowerCase();
  const isSiaDat =
    lowerName.endsWith('.dat') ||
    lowerName.endsWith('.cli') ||
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.csv') ||
    lines
      .slice(0, 30)
      .some(l => /\b(g_sum|gls|str\.diffus|rad_global|g_gh|g_dh|g_bn|g_bh|ta|time\.hh)\b/i.test(l));

  if (isSiaDat) {
    let hdrIdx = -1;
    let colNames = [];
    for (let i = 0; i < Math.min(35, lines.length); i++) {
      const rawLine = lines[i].trim();
      const latM = rawLine.match(/\b(?:lat|latitude)\b\s*[:=]?\s*([-+]?\d+(?:\.\d+)?)/i);
      if (latM) lat = parseFloat(latM[1]) || lat;
      const lonM = rawLine.match(/\b(?:lon|longitude)\b\s*[:=]?\s*([-+]?\d+(?:\.\d+)?)/i);
      if (lonM) lon = parseFloat(lonM[1]) || lon;

      if (!rawLine || rawLine.startsWith('#') || rawLine.startsWith('!')) continue;
      const toks = rawLine.split(/[;\t, ]+/).filter(Boolean);
      if (
        toks.length >= 3 &&
        /[a-zA-Z]/.test(rawLine) &&
        toks.some(t =>
          /^(ta|t_a|t|temp|t_air|t_dry|t2m|tamb|air_temp|tt|g_gh|gh|gls|g_sum|g_h|glob|global|rad_global|ghi)$/i.test(t)
        )
      ) {
        hdrIdx = i;
        colNames = toks.map(t => t.toLowerCase());
        break;
      }
    }

    const findCol = patterns => colNames.findIndex(c => patterns.some(rx => rx.test(c)));
    const iTe = hdrIdx >= 0 ? findCol([/^ta$/, /^t_a$/, /^t$/, /^temp/, /^t_air$/, /^t_dry$/, /^t2m$/, /^tamb$/, /^air_temp$/, /^tt$/]) : 4;
    const iGh = hdrIdx >= 0 ? findCol([/^g_gh$/, /^gh$/, /^g_sum$/, /^gls$/, /^g_h$/, /^glob$/, /^global$/, /^rad_global/, /^g_glob/, /^ig$/, /^ghi$/]) : 5;
    const iGd = hdrIdx >= 0 ? findCol([/^g_dh$/, /^dh$/, /^g_diff$/, /^str\.diffus$/, /^rad_diffuse/, /^diff$/, /^diffuse$/, /^gd$/, /^idh$/, /^dhi$/]) : 6;
    const iGbNorm = hdrIdx >= 0 ? findCol([/^g_bn$/, /^bn$/, /^dni$/, /^ibn$/, /^str\.direkt$/, /^g_dir$/, /^gb$/]) : -1;
    const iGbHor = hdrIdx >= 0 ? findCol([/^g_bh$/, /^bh$/, /^dir_hor$/, /^g_dir_h$/, /^gbh$/]) : -1;
    const iMonth = hdrIdx >= 0 ? findCol([/^m$/, /^mo$/, /^month$/, /^time\.mm$/]) : -1;
    const iDay = hdrIdx >= 0 ? findCol([/^d$/, /^dm$/, /^day$/, /^time\.dd$/]) : -1;

    if (iTe >= 0 && iGh >= 0) {
      const hours = [];
      const startLine = hdrIdx >= 0 ? hdrIdx + 1 : 0;
      for (let i = startLine; i < lines.length && hours.length < 8760; i++) {
        const l = lines[i].trim();
        if (!l || l.startsWith('#') || l.startsWith('!')) continue;
        const p = l.split(/[;\t, ]+/).filter(Boolean);
        if (p.length <= Math.max(iTe, iGh)) continue;
        const Te = parseFloat(p[iTe]);
        const IghRaw = parseFloat(p[iGh]);
        if (!Number.isFinite(Te) || !Number.isFinite(IghRaw)) continue;

        if (iMonth >= 0 && iDay >= 0) {
          const mo = parseInt(p[iMonth], 10);
          const da = parseInt(p[iDay], 10);
          if (mo === 2 && da === 29) continue;
        }

        const h = hours.length;
        const d = Math.floor(h / 24);
        const hod = h % 24;
        const Igh = Math.max(0, IghRaw);
        const sun = solarPosition(d + 1, hod + 0.5, lat, lon, 1);

        let Idh;
        let Ibn;
        const hasDiff = iGd >= 0 && p[iGd] !== undefined && Number.isFinite(parseFloat(p[iGd]));
        const hasDni = iGbNorm >= 0 && p[iGbNorm] !== undefined && Number.isFinite(parseFloat(p[iGbNorm]));
        const hasBh = iGbHor >= 0 && p[iGbHor] !== undefined && Number.isFinite(parseFloat(p[iGbHor]));

        if (hasDiff) {
          Idh = Math.max(0, parseFloat(p[iGd]));
          if (hasDni) {
            Ibn = Math.max(0, parseFloat(p[iGbNorm]));
          } else if (hasBh) {
            Ibn = sun.cosZ > 0.03 ? Math.max(0, parseFloat(p[iGbHor]) / sun.cosZ) : 0;
          } else {
            Ibn = sun.cosZ > 0.03 ? Math.max(0, (Igh - Idh) / sun.cosZ) : 0;
          }
        } else if (hasDni) {
          Ibn = Math.max(0, parseFloat(p[iGbNorm]));
          Idh = Math.max(0, Igh - Ibn * Math.max(0, sun.cosZ));
        } else {
          const sp = splitGlobalToComponents(Igh, sun, d + 1);
          Ibn = sp.Ibn;
          Idh = sp.Idh;
        }
        hours.push({ h, d, hod, Te, Igh, Ibn, Idh, sun });
      }
      if (hours.length >= 24) {
        return {
          sourceLabel: `Meteonorm / SIA 2028 : ${sourceName} (${hours.length} h)`,
          data: hours
        };
      }
    }
  }

  throw new Error('Format météo non reconnu (.json PVGIS/Open-Meteo, .csv PVGIS/MétéoSuisse, .epw ou .dat/.cli SIA 2028).');
}

/**
 * Construit l'URL directe (CORS ouvert) de l'API Open-Meteo ERA5 Archive pour une année complète.
 */
export function buildOpenMeteoArchiveUrl(lat, lon, year = 2023) {
  const y = Math.max(1980, Math.min(2025, Math.round(Number(year) || 2023)));
  return (
    `https://archive-api.open-meteo.com/v1/archive?latitude=${Number(lat).toFixed(4)}` +
    `&longitude=${Number(lon).toFixed(4)}` +
    `&start_date=${y}-01-01&end_date=${y}-12-31` +
    `&hourly=temperature_2m,shortwave_radiation,direct_normal_irradiance,diffuse_radiation&timezone=UTC`
  );
}

/**
 * Récupère en 1 clic des données météo réelles depuis Open-Meteo (direct navigateur),
 * MétéoSuisse OGD (STAC `data.geo.admin.ch` direct ou proxy `/api/meteoswiss`)
 * ou PVGIS 5.3 (via proxy local `/api/pvgis` de `dev-server.mjs`).
 *
 * @param {'openmeteo'|'meteoswiss'|'pvgis'} provider
 * @param {{ station?: string, lat: number, lon: number, tzMode?: string }} climateSettings
 * @param {{ year?: string|number }} [opts]
 */
export async function fetchLiveWeatherData(provider, climateSettings, opts = {}) {
  const lat = Number(climateSettings.lat) || 46.22;
  const lon = Number(climateSettings.lon) || 7.33;

  if (provider === 'openmeteo') {
    const year = opts.year && opts.year !== 'tmy' ? opts.year : 2023;
    const url = buildOpenMeteoArchiveUrl(lat, lon, year);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
    const text = await resp.text();
    return parseAnyWeatherText(text, `openmeteo_${year}.json`, climateSettings);
  }

  if (provider === 'meteoswiss') {
    const st = SWISS_STATIONS[climateSettings.station] || SWISS_STATIONS.SIO;
    const stn = (st.smnCode || 'sio').toLowerCase();
    // 1. Essayer directement data.geo.admin.ch (Open Government Data avec CORS)
    const directCandidates = [
      `https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/${stn}/ogd-smn_${stn}_h_historical_2020-2029.csv`,
      `https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/${stn}/ogd-smn_${stn}_h_recent.csv`
    ];
    for (const url of directCandidates) {
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const text = await resp.text();
          return parseAnyWeatherText(text, `ogd-smn_${stn}_h.csv`, {
            ...climateSettings,
            lat: st.lat,
            lon: st.lon
          });
        }
      } catch {
        // Fallback vers le proxy local ci-dessous
      }
    }
    // 2. Fallback via proxy local `dev-server.mjs`
    const proxyResp = await fetch(`/api/meteoswiss?stn=${encodeURIComponent(stn)}`);
    if (!proxyResp.ok) {
      throw new Error(
        `Impossible de joindre MétéoSuisse OGD (HTTP ${proxyResp.status}). Vérifiez votre connexion ou utilisez Open-Meteo / import CSV.`
      );
    }
    const text = await proxyResp.text();
    return parseAnyWeatherText(text, `ogd-smn_${stn}_h.csv`, {
      ...climateSettings,
      lat: st.lat,
      lon: st.lon
    });
  }

  if (provider === 'pvgis') {
    const pvType = String(opts.year || 'tmy');
    const proxyUrl = `/api/pvgis?type=${encodeURIComponent(pvType)}&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const resp = await fetch(proxyUrl);
    if (!resp.ok) {
      throw new Error(
        `Le téléchargement direct PVGIS requiert le serveur local (npm start) pour contourner CORS. Sinon cliquez sur « Télécharger JSON PVGIS » et glissez le fichier.`
      );
    }
    const text = await resp.text();
    return parseAnyWeatherText(text, `pvgis_${pvType}.json`, climateSettings);
  }

  throw new Error(`Fournisseur météo inconnu : ${provider}`);
}
