/**
 * @fileoverview Paramètres climatiques des stations suisses (données synthétiques calibrées)
 * et scénarios de réchauffement (REF/2010, 2035 Minergie, 2050, 2100).
 */

export const SWISS_STATIONS = {
  SIO: { name: 'Sion',             lat: 46.22, lon: 7.33, tMean: 10.6, ampAnn: 10.2, ampDay: 6.4, peakHeat: 5.5, clearness: 0.68, uhiCity: false },
  GVE: { name: 'Genève',           lat: 46.25, lon: 6.13, tMean: 10.5, ampAnn: 9.5,  ampDay: 5.4, peakHeat: 4.8, clearness: 0.61, uhiCity: true },
  LSN: { name: 'Lausanne',         lat: 46.52, lon: 6.63, tMean: 10.2, ampAnn: 9.3,  ampDay: 4.9, peakHeat: 4.7, clearness: 0.60, uhiCity: true },
  BER: { name: 'Berne',            lat: 46.99, lon: 7.46, tMean: 9.2,  ampAnn: 9.6,  ampDay: 5.2, peakHeat: 4.6, clearness: 0.57, uhiCity: true },
  BAS: { name: 'Bâle',             lat: 47.54, lon: 7.58, tMean: 10.7, ampAnn: 9.4,  ampDay: 5.1, peakHeat: 4.8, clearness: 0.57, uhiCity: true },
  ZRH: { name: 'Zurich',           lat: 47.38, lon: 8.57, tMean: 9.4,  ampAnn: 9.5,  ampDay: 5.0, peakHeat: 4.5, clearness: 0.56, uhiCity: true },
  LUG: { name: 'Lugano',           lat: 46.00, lon: 8.96, tMean: 12.6, ampAnn: 9.6,  ampDay: 5.0, peakHeat: 4.6, clearness: 0.63, uhiCity: false },
  MVE: { name: 'Montana',          lat: 46.30, lon: 7.46, tMean: 6.1,  ampAnn: 9.0,  ampDay: 4.8, peakHeat: 5.6, clearness: 0.66, uhiCity: false },
  ZER: { name: 'Zermatt',          lat: 46.02, lon: 7.75, tMean: 4.5,  ampAnn: 9.2,  ampDay: 5.4, peakHeat: 5.0, clearness: 0.65, uhiCity: false },
  GSB: { name: 'Grand-St-Bernard', lat: 45.87, lon: 7.17, tMean: -0.2, ampAnn: 7.6,  ampDay: 3.1, peakHeat: 4.4, clearness: 0.60, uhiCity: false }
};

export const CLIMATE_SCENARIOS = {
  REF:    { label: 'Climat de référence (2010 / SIA 2028)',          annualDeltaC: 0.0, summerExtraC: 0.0 },
  '2035': { label: 'Projection Minergie 2035 (+1.1 °C / +1.5 °C été)', annualDeltaC: 1.1, summerExtraC: 0.4 },
  '2050': { label: 'Projection 2050 (+1.5 °C / +2.0 °C été)',        annualDeltaC: 1.5, summerExtraC: 0.5 },
  '2100': { label: 'Projection 2100 (+4.2 °C / +5.2 °C été)',        annualDeltaC: 4.2, summerExtraC: 1.0 }
};
