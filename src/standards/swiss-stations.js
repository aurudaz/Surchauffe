/**
 * @fileoverview Paramètres climatiques des stations suisses (données synthétiques calibrées)
 * et scénarios de réchauffement (REF, 2050, 2100).
 */

export const SWISS_STATIONS = {
  SIO: { name: 'Sion',             lat: 46.22, lon: 7.33, tMean: 10.6, ampAnn: 10.2, ampDay: 6.4, peakHeat: 5.5, clearness: 0.68 },
  MVE: { name: 'Montana',          lat: 46.30, lon: 7.46, tMean: 6.1,  ampAnn: 9.0,  ampDay: 4.8, peakHeat: 5.6, clearness: 0.66 },
  ZER: { name: 'Zermatt',          lat: 46.02, lon: 7.75, tMean: 4.5,  ampAnn: 9.2,  ampDay: 5.4, peakHeat: 5.0, clearness: 0.65 },
  GSB: { name: 'Grand-St-Bernard', lat: 45.87, lon: 7.17, tMean: -0.2, ampAnn: 7.6,  ampDay: 3.1, peakHeat: 4.4, clearness: 0.60 },
  GVE: { name: 'Genève',           lat: 46.25, lon: 6.13, tMean: 10.5, ampAnn: 9.5,  ampDay: 5.4, peakHeat: 4.8, clearness: 0.61 },
  LSN: { name: 'Lausanne',         lat: 46.52, lon: 6.63, tMean: 10.2, ampAnn: 9.3,  ampDay: 4.9, peakHeat: 4.7, clearness: 0.60 },
  ZRH: { name: 'Zurich',           lat: 47.38, lon: 8.57, tMean: 9.4,  ampAnn: 9.5,  ampDay: 5.0, peakHeat: 4.5, clearness: 0.56 },
  LUG: { name: 'Lugano',           lat: 46.00, lon: 8.96, tMean: 12.6, ampAnn: 9.6,  ampDay: 5.0, peakHeat: 4.6, clearness: 0.63 }
};

export const CLIMATE_SCENARIOS = {
  REF:    { label: 'Climat de référence (REF)',   annualDeltaC: 0.0, summerExtraC: 0.0 },
  '2050': { label: 'Projection 2050 (+1.5 °C)',   annualDeltaC: 1.5, summerExtraC: 0.5 },
  '2100': { label: 'Projection 2100 (+4.2 °C)',   annualDeltaC: 4.2, summerExtraC: 1.0 }
};
