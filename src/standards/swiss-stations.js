/**
 * @fileoverview Paramètres climatiques des stations suisses calibrés sur les normales
 * MétéoSuisse 1991–2020 et les données SIA 2028 / Meteonorm (REF, 2035, 2050, 2100).
 */

export const SWISS_STATIONS = {
  SIO: { name: 'Sion',             smnCode: 'sio', lat: 46.22, lon: 7.33, tMean: 10.4, ampAnn: 10.6, ampDay: 6.4, peakHeat: 6.4, synAmp: 3.1, clearSummer: 0.66, clearWinter: 0.44, altFactor: 1.03, uhiCity: false },
  GVE: { name: 'Genève',           smnCode: 'gve', lat: 46.25, lon: 6.13, tMean: 10.8, ampAnn: 10.0, ampDay: 5.8, peakHeat: 5.8, synAmp: 3.0, clearSummer: 0.60, clearWinter: 0.34, altFactor: 1.01, uhiCity: true },
  LSN: { name: 'Lausanne',         smnCode: 'puy', lat: 46.52, lon: 6.63, tMean: 10.3, ampAnn: 9.6,  ampDay: 5.2, peakHeat: 5.4, synAmp: 2.9, clearSummer: 0.59, clearWinter: 0.35, altFactor: 1.01, uhiCity: true },
  BER: { name: 'Berne',            smnCode: 'ber', lat: 46.99, lon: 7.46, tMean: 9.2,  ampAnn: 9.8,  ampDay: 5.6, peakHeat: 5.3, synAmp: 3.0, clearSummer: 0.56, clearWinter: 0.33, altFactor: 1.01, uhiCity: true },
  BAS: { name: 'Bâle',             smnCode: 'bas', lat: 47.54, lon: 7.58, tMean: 10.7, ampAnn: 9.7,  ampDay: 5.5, peakHeat: 5.6, synAmp: 3.0, clearSummer: 0.56, clearWinter: 0.32, altFactor: 1.00, uhiCity: true },
  ZRH: { name: 'Zurich',           smnCode: 'sma', lat: 47.38, lon: 8.57, tMean: 9.4,  ampAnn: 9.7,  ampDay: 5.3, peakHeat: 5.2, synAmp: 2.9, clearSummer: 0.55, clearWinter: 0.31, altFactor: 1.01, uhiCity: true },
  LUG: { name: 'Lugano',           smnCode: 'lug', lat: 46.00, lon: 8.96, tMean: 12.6, ampAnn: 10.0, ampDay: 5.1, peakHeat: 5.0, synAmp: 2.7, clearSummer: 0.62, clearWinter: 0.48, altFactor: 1.01, uhiCity: false },
  MVE: { name: 'Montana',          smnCode: 'mve', lat: 46.30, lon: 7.46, tMean: 6.0,  ampAnn: 8.9,  ampDay: 5.1, peakHeat: 6.9, synAmp: 3.3, clearSummer: 0.65, clearWinter: 0.51, altFactor: 1.07, uhiCity: false },
  ZER: { name: 'Zermatt',          smnCode: 'zer', lat: 46.02, lon: 7.75, tMean: 4.5,  ampAnn: 9.1,  ampDay: 5.6, peakHeat: 6.7, synAmp: 3.2, clearSummer: 0.64, clearWinter: 0.50, altFactor: 1.07, uhiCity: false },
  GSB: { name: 'Grand-St-Bernard', smnCode: 'gsb', lat: 45.87, lon: 7.17, tMean: -0.3, ampAnn: 7.6,  ampDay: 3.4, peakHeat: 6.2, synAmp: 3.1, clearSummer: 0.57, clearWinter: 0.47, altFactor: 1.10, uhiCity: false }
};

export const CLIMATE_SCENARIOS = {
  REF:    { label: 'Climat de référence (2010 / SIA 2028)',           annualDeltaC: 0.0, summerExtraC: 0.0 },
  '2035': { label: 'Projection Minergie 2035 (+1.1 °C / +1.5 °C été)', annualDeltaC: 1.1, summerExtraC: 0.4 },
  '2050': { label: 'Projection 2050 (+1.5 °C / +2.0 °C été)',         annualDeltaC: 1.5, summerExtraC: 0.5 },
  '2100': { label: 'Projection 2100 (+4.2 °C / +5.8 °C été, CH2018)', annualDeltaC: 4.2, summerExtraC: 1.6 }
};
