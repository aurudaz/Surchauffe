/**
 * @fileoverview Références scientifiques et normatives pour le module de confort thermique.
 * Regroupe les seuils et constantes de :
 *  - EN 16798-1:2019 (ex-EN 15251) : confort adaptatif européen (Cat. I, II, III)
 *  - ASHRAE Standard 55-2020 (de Dear & Brager, 1998) : acceptabilité 90 % / 80 %
 *  - ISO 7730:2005 : indice analytique PMV / PPD de Fanger (Classes A, B, C) & asymétrie radiante
 *  - CIBSE TM52 (2013) & TM59 (2017) : sévérité de surchauffe (3 %, We ≤ 6 Kh, ΔT_max ≤ 4 K, nuit ≤ 1 %)
 *  - OMS (WHO Housing & Health Guidelines, 2018) & Lan et al. (2017) : sommeil et santé (> 24 °C / > 26 °C)
 *  - Seppänen, Fisk & Lei (2006, LBNL-60952) : performance cognitive en fonction de la température
 */

export const COMFORT_DEFAULTS = {
  clo: 0.50,      // Tenue estivale légère (chemise manches courtes + pantalon léger)
  met: 1.20,      // Activité sédentaire (bureau / séjour calme)
  airSpeed: 0.15, // Vitesse d'air intérieure typique en ventilation naturelle modérée [m/s]
  rh: 50          // Humidité relative intérieure typique [%]
};

export const EN16798_LIMITS = {
  alpha: 0.8,
  slope: 0.33,
  intercept: 18.8,
  minTrm: 10.0,
  maxTrm: 30.0,
  categories: {
    I:   { label: 'Catégorie I (Haute attente / sensibles)', upperOffset: 2.0, lowerOffset: -3.0 },
    II:  { label: 'Catégorie II (Bâtiments neufs / normal)', upperOffset: 3.0, lowerOffset: -4.0 },
    III: { label: 'Catégorie III (Existant / modéré)',       upperOffset: 4.0, lowerOffset: -5.0 }
  }
};

export const ASHRAE55_LIMITS = {
  slope: 0.31,
  intercept: 17.8,
  minTrm: 10.0,
  maxTrm: 33.5,
  band90: 2.5,
  band80: 3.5
};

export const ISO7730_CLASSES = {
  A: { maxAbsPmv: 0.2, maxPpd: 6,  label: 'Classe A (|PMV| ≤ 0.2, PPD < 6 %)' },
  B: { maxAbsPmv: 0.5, maxPpd: 10, label: 'Classe B (|PMV| ≤ 0.5, PPD < 10 %)' },
  C: { maxAbsPmv: 0.7, maxPpd: 15, label: 'Classe C (|PMV| ≤ 0.7, PPD < 15 %)' }
};

export const CIBSE_THRESHOLDS = {
  tm52MaxExceedPct: 3.0,   // Critère 1 : max 3 % des heures occupées estivales à ΔT ≥ 1 K
  tm52MaxDailyWe: 6.0,     // Critère 2 : somme journalière pondérée We ≤ 6 K·h
  tm52MaxDeltaT: 4.0,      // Critère 3 : dépassement instantané max ≤ 4 K
  tm59BedroomTemp: 26.0,   // TM59 chambres : max 1 % des heures nocturnes (22h–07h) > 26 °C
  tm59BedroomMaxPct: 1.0
};

export const HEALTH_AND_SLEEP = {
  whoGeneralMaxC: 24.0,    // OMS 2018 : seuil recommandé pour populations vulnérables
  whoSleepComfortC: 24.0,  // Confort optimal du sommeil (22h–07h)
  sleepDisruptC: 26.0      // Lan et al. (2017) / CIBSE TM59 : dégradation du sommeil > 26 °C
};

export const SEPPANEN_2006 = {
  // P(T) = a3*T^3 + a2*T^2 + a1*T + a0 (LBNL-60952, optimal ≈ 21.75 °C)
  a3: 0.0000623,
  a2: -0.0058274,
  a1: 0.1647524,
  a0: -0.4685328,
  tOpt: 21.75
};
