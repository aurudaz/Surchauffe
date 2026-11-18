/**
 * @fileoverview Étape 02 — Modèle climatique suisse synthétique et parseurs météo
 * compatibles PVGIS 5.3 (JSON/CSV TMY & seriescalc) et EnergyPlus / Meteonorm (.epw).
 */

import { SWISS_STATIONS, CLIMATE_SCENARIOS } from '../standards/swiss-stations.js';
import { solarPosition, splitGlobalToComponents } from './01-solar-geometry.js';

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
 * Génère 8760 heures climatiques synthétiques calibrées sur une station suisse,
 * incluant deux épisodes de canicule estivale et un cycle diurne réaliste.
 *
 * @param {string} stationKey Code station (SIO, GVE, ZRH, etc.)
 * @param {string} scenarioKey 'REF' | '2050' | '2100'
 */
export function generateSyntheticWeather(stationKey = 'SIO', scenarioKey = 'REF') {
  const st = SWISS_STATIONS[stationKey] || SWISS_STATIONS.SIO;
  const sc = CLIMATE_SCENARIOS[scenarioKey] || CLIMATE_SCENARIOS.REF;

  let seed = 4219;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const dailyWeather = [];
  let syn = 0;
  for (let d = 0; d < 365; d++) {
    syn = 0.72 * syn + (rand() - 0.5) * 3.8;
    const heatwave =
      st.peakHeat * 0.75 * Math.exp(-Math.pow((d - 178) / 4.5, 2)) +
      st.peakHeat * Math.exp(-Math.pow((d - 208) / 5.5, 2));
    const cloud = Math.max(
      0.18,
      Math.min(1.0, st.clearness + (syn + heatwave * 0.4) * 0.035 + (rand() - 0.5) * 0.25)
    );
    dailyWeather.push({ syn, heatwave, cloud });
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
      st.ampAnn * Math.cos((2 * Math.PI * (d - 25)) / 365);

    const Te =
      tBase +
      dw.syn +
      dw.heatwave -
      st.ampDay * Math.cos((2 * Math.PI * (hod - 4.5)) / 24) * (0.65 + 0.55 * dw.cloud);

    const sun = solarPosition(d + 1, hod + 0.5, st.lat, st.lon, 1);
    let Igh = 0;
    let Ibn = 0;
    let Idh = 0;
    if (sun.cosZ > 0.02) {
      const kt = dw.cloud * (0.85 + 0.15 * sun.cosZ);
      Igh = Math.max(
        0,
        1361 * (1 + 0.033 * Math.cos((2 * Math.PI * (d + 1)) / 365)) * sun.cosZ * kt
      );
      Idh = Igh * Math.min(1, Math.max(0.15, 1.15 - 1.15 * kt));
      Ibn = Math.max(0, (Igh - Idh) / sun.cosZ);
    }
    hours.push({ h, d, hod, Te, Igh, Ibn, Idh, sun });
  }

  return {
    sourceLabel: `Climat suisse synthétique : ${st.name} (${scenarioKey})`,
    data: hours
  };
}

/**
 * Applique un scénario de réchauffement (ex. +1.5 °C / +0.5 °C été pour 2050)
 * à n'importe quelle série horaire (y compris un fichier PVGIS/EPW importé).
 */
export function applyClimateDelta(weatherObj, scenarioKey = '2050') {
  const sc = CLIMATE_SCENARIOS[scenarioKey] || CLIMATE_SCENARIOS['2050'];
  return {
    sourceLabel: `${weatherObj.sourceLabel} + ${scenarioKey}`,
    data: weatherObj.data.map(hr => {
      const isSummer = hr.d >= 135 && hr.d <= 258;
      return {
        ...hr,
        Te: hr.Te + sc.annualDeltaC + (isSummer ? sc.summerExtraC : 0)
      };
    })
  };
}

/**
 * Parse un fichier météo PVGIS JSON, PVGIS CSV ou EnergyPlus EPW.
 * @param {string} text Contenu brut du fichier
 * @param {string} sourceName Nom du fichier
 * @param {{ lat?: number, lon?: number, tzMode?: string }} [climateSettings]
 */
export function parseAnyWeatherText(text, sourceName = 'Import', climateSettings = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Fichier météo vide.');

  const tzMode = climateSettings.tzMode || 'cet_cest';
  let lat = Number(climateSettings.lat) || 46.22;
  let lon = Number(climateSettings.lon) || 7.33;

  // 1. PVGIS JSON
  if (trimmed.startsWith('{')) {
    const obj = JSON.parse(trimmed);
    if (obj.inputs?.location) {
      lat = parseFloat(obj.inputs.location.latitude) || lat;
      lon = parseFloat(obj.inputs.location.longitude) || lon;
    }
    const arr = obj.outputs && (obj.outputs.tmy_hourly || obj.outputs.hourly);
    if (!Array.isArray(arr) || arr.length < 24) throw new Error('JSON PVGIS non reconnu.');
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

  // 3. PVGIS CSV
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

  throw new Error('Format météo non reconnu (.json PVGIS, .csv PVGIS ou .epw).');
}
