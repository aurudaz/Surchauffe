/**
 * @fileoverview Tables normatives SIA 380/1:2016 (conditions d'utilisation standard)
 * et préréglages d'enveloppe / vitrages / protections solaires.
 */

export const SIA380_CATEGORIES = {
  I:   { name: 'Habitat collectif',     ti: 20, Ap: 40,  Qp: 70,  tp: 12, Efel: 28, fel: 0.7, qth: 0.7, spaceType: 'residential', occStart: 0,  occEnd: 24, occDays: 7, standby: 25 },
  II:  { name: 'Habitat individuel',    ti: 20, Ap: 60,  Qp: 70,  tp: 12, Efel: 22, fel: 0.7, qth: 0.7, spaceType: 'residential', occStart: 0,  occEnd: 24, occDays: 7, standby: 25 },
  III: { name: 'Administration',        ti: 20, Ap: 20,  Qp: 80,  tp: 6,  Efel: 22, fel: 0.9, qth: 0.7, spaceType: 'office',      occStart: 8,  occEnd: 18, occDays: 5, standby: 10 },
  IV:  { name: 'École',                 ti: 20, Ap: 10,  Qp: 70,  tp: 4,  Efel: 11, fel: 0.9, qth: 0.7, spaceType: 'office',      occStart: 8,  occEnd: 17, occDays: 5, standby: 10 },
  V:   { name: 'Commerce',              ti: 20, Ap: 10,  Qp: 90,  tp: 4,  Efel: 33, fel: 0.8, qth: 0.7, spaceType: 'office',      occStart: 9,  occEnd: 19, occDays: 6, standby: 15 },
  VI:  { name: 'Restauration',          ti: 20, Ap: 5,   Qp: 100, tp: 3,  Efel: 33, fel: 0.7, qth: 1.2, spaceType: 'office',      occStart: 11, occEnd: 23, occDays: 7, standby: 15 },
  VII: { name: 'Lieu de rassemblement', ti: 20, Ap: 5,   Qp: 80,  tp: 3,  Efel: 17, fel: 0.8, qth: 1.0, spaceType: 'office',      occStart: 9,  occEnd: 22, occDays: 7, standby: 10 },
  VIII:{ name: 'Hôpital',               ti: 22, Ap: 30,  Qp: 80,  tp: 16, Efel: 28, fel: 0.7, qth: 1.0, spaceType: 'residential', occStart: 0,  occEnd: 24, occDays: 7, standby: 40 },
  IX:  { name: 'Industrie',             ti: 18, Ap: 20,  Qp: 100, tp: 6,  Efel: 17, fel: 0.9, qth: 0.7, spaceType: 'office',      occStart: 7,  occEnd: 18, occDays: 5, standby: 15 },
  X:   { name: 'Dépôt',                 ti: 18, Ap: 100, Qp: 100, tp: 6,  Efel: 6,  fel: 0.9, qth: 0.3, spaceType: 'office',      occStart: 8,  occEnd: 17, occDays: 5, standby: 20 },
  XI:  { name: 'Installation sportive', ti: 18, Ap: 20,  Qp: 100, tp: 6,  Efel: 6,  fel: 0.9, qth: 0.7, spaceType: 'office',      occStart: 8,  occEnd: 22, occDays: 7, standby: 15 },
  XII: { name: 'Piscine couverte',      ti: 28, Ap: 20,  Qp: 60,  tp: 4,  Efel: 56, fel: 0.7, qth: 0.7, spaceType: 'office',      occStart: 8,  occEnd: 21, occDays: 7, standby: 30 }
};

/**
 * Types de locaux selon SIA 2024:2015 (charges internes journalières [Wh/(m²·j)],
 * débit d'air neuf standard [m³/(h·m²)] et recommandation d'automatisation des stores).
 */
export const SIA2024_ROOM_TYPES = {
  hab_collectif:   { siaCat: 'I',    label: '1.1 Habitat collectif (logement)',          dailyLoadWhm2d: 84,  qHygSpec: 0.7, autoBlindsRec: false, spaceType: 'residential' },
  hab_individuel:  { siaCat: 'II',   label: '1.2 Habitat individuel (maison)',           dailyLoadWhm2d: 71,  qHygSpec: 0.7, autoBlindsRec: false, spaceType: 'residential' },
  hotel_chambre:   { siaCat: 'I',    label: '2.1 Chambre d’hôtel',                       dailyLoadWhm2d: 97,  qHygSpec: 1.0, autoBlindsRec: false, spaceType: 'residential' },
  bureau_indiv:    { siaCat: 'III',  label: '3.1 Bureau individuel / collectif',         dailyLoadWhm2d: 107, qHygSpec: 1.0, autoBlindsRec: true,  spaceType: 'office' },
  bureau_paysage:  { siaCat: 'III',  label: '3.2 Bureau paysagé (open-space)',           dailyLoadWhm2d: 235, qHygSpec: 1.5, autoBlindsRec: true,  spaceType: 'office' },
  salle_reunion:   { siaCat: 'III',  label: '3.3 Salle de réunion / conférence',         dailyLoadWhm2d: 113, qHygSpec: 3.0, autoBlindsRec: true,  spaceType: 'office' },
  accueil_guichet: { siaCat: 'III',  label: '3.4 Réception / guichet',                   dailyLoadWhm2d: 82,  qHygSpec: 1.2, autoBlindsRec: false, spaceType: 'office' },
  salle_classe:    { siaCat: 'IV',   label: '4.1 Salle de classe (école)',               dailyLoadWhm2d: 120, qHygSpec: 3.0, autoBlindsRec: true,  spaceType: 'office' },
  salle_maitres:   { siaCat: 'IV',   label: '4.2 Salle des maîtres / bibliothèque',      dailyLoadWhm2d: 89,  qHygSpec: 1.5, autoBlindsRec: true,  spaceType: 'office' },
  commerce_alim:   { siaCat: 'V',    label: '5.1 Commerce alimentaire',                  dailyLoadWhm2d: 235, qHygSpec: 1.5, autoBlindsRec: true,  spaceType: 'office' },
  commerce_std:    { siaCat: 'V',    label: '5.2 Commerce / boutique standard',          dailyLoadWhm2d: 152, qHygSpec: 1.5, autoBlindsRec: true,  spaceType: 'office' },
  restaurant:      { siaCat: 'VI',   label: '6.1 Restaurant / salle à manger',           dailyLoadWhm2d: 240, qHygSpec: 3.0, autoBlindsRec: true,  spaceType: 'office' },
  cafeteria:       { siaCat: 'VI',   label: '6.2 Cafétéria / libre-service',             dailyLoadWhm2d: 195, qHygSpec: 2.5, autoBlindsRec: true,  spaceType: 'office' },
  salle_spectacle: { siaCat: 'VII',  label: '7.1 Salle polyvalente / conférence',        dailyLoadWhm2d: 125, qHygSpec: 3.0, autoBlindsRec: true,  spaceType: 'office' },
  musee_expo:      { siaCat: 'VII',  label: '7.2 Musée / exposition',                    dailyLoadWhm2d: 95,  qHygSpec: 1.5, autoBlindsRec: true,  spaceType: 'office' },
  hopital_chambre: { siaCat: 'VIII', label: '8.1 Chambre d’hôpital / EMS',               dailyLoadWhm2d: 130, qHygSpec: 1.5, autoBlindsRec: true,  spaceType: 'residential' },
  cabinet_medical: { siaCat: 'VIII', label: '8.2 Cabinet médical / traitement',          dailyLoadWhm2d: 145, qHygSpec: 2.0, autoBlindsRec: true,  spaceType: 'office' },
  atelier_prod:    { siaCat: 'IX',   label: '9.1 Atelier / production légère',           dailyLoadWhm2d: 135, qHygSpec: 1.5, autoBlindsRec: false, spaceType: 'office' },
  laboratoire:     { siaCat: 'IX',   label: '9.2 Laboratoire',                           dailyLoadWhm2d: 210, qHygSpec: 2.5, autoBlindsRec: true,  spaceType: 'office' },
  depot_archive:   { siaCat: 'X',    label: '10.1 Dépôt / archives',                     dailyLoadWhm2d: 35,  qHygSpec: 0.3, autoBlindsRec: false, spaceType: 'office' },
  salle_sport:     { siaCat: 'XI',   label: '11.1 Salle de sport',                       dailyLoadWhm2d: 75,  qHygSpec: 2.0, autoBlindsRec: false, spaceType: 'office' },
  piscine:         { siaCat: 'XII',  label: '12.1 Piscine couverte',                     dailyLoadWhm2d: 165, qHygSpec: 2.0, autoBlindsRec: false, spaceType: 'office' }
};

export function getDefaultRoomTypeForSiaCat(catKey) {
  const map = {
    I: 'hab_collectif',
    II: 'hab_individuel',
    III: 'bureau_indiv',
    IV: 'salle_classe',
    V: 'commerce_std',
    VI: 'restaurant',
    VII: 'salle_spectacle',
    VIII: 'hopital_chambre',
    IX: 'atelier_prod',
    X: 'depot_archive',
    XI: 'salle_sport',
    XII: 'piscine'
  };
  return map[catKey] || 'hab_collectif';
}

export const ORIENTATIONS = {
  N:  { az: 0,   tilt: 90, label: 'Nord' },
  NE: { az: 45,  tilt: 90, label: 'Nord-Est' },
  E:  { az: 90,  tilt: 90, label: 'Est' },
  SE: { az: 135, tilt: 90, label: 'Sud-Est' },
  S:  { az: 180, tilt: 90, label: 'Sud' },
  SO: { az: 225, tilt: 90, label: 'Sud-Ouest' },
  O:  { az: 270, tilt: 90, label: 'Ouest' },
  NO: { az: 315, tilt: 90, label: 'Nord-Ouest' },
  R:  { az: 180, tilt: 0,  label: 'Toiture (horizontal)' }
};

export const GLAZING_PRESETS = {
  triple_std: { label: 'Triple vitrage isolant (U = 0.75, g = 0.55)', uWin: 0.75, gVit: 0.55 },
  triple_sol: { label: 'Triple vitrage contrôle solaire (U = 0.75, g = 0.35)', uWin: 0.75, gVit: 0.35 },
  double_mod: { label: 'Double vitrage moderne (U = 1.10, g = 0.60)', uWin: 1.10, gVit: 0.60 },
  double_old: { label: 'Double vitrage ancien (U = 2.60, g = 0.72)', uWin: 2.60, gVit: 0.72 }
};

export const STORE_PRESETS = {
  lamelles_10: { label: 'Store lamelles ext. performant (g_store = 0.10)', gStore: 0.10, gtotMode: 'product' },
  lamelles_15: { label: 'Store lamelles ext. standard (g_store = 0.15)', gStore: 0.15, gtotMode: 'product' },
  ext_pastel:  { label: 'Store / volet ext. pastel (g_tot = 0.09)', gStore: 0.09, gtotMode: 'direct' },
  toile_sombre:{ label: 'Toile extérieure sombre (g_store = 0.15)', gStore: 0.15, gtotMode: 'product' },
  toile_claire:{ label: 'Toile extérieure claire (g_store = 0.35)', gStore: 0.35, gtotMode: 'product' },
  int_claire:  { label: 'Store intérieur clair (g_tot = 0.36)', gStore: 0.36, gtotMode: 'direct' },
  none:        { label: 'Aucun store (g_store = 1.00)', gStore: 1.00, gtotMode: 'product' }
};

export const SHADING_PRESETS = {
  triple_lamelles:   { label: 'Triple vitrage (g=0.55) + Store lamelles ext. (g_store=0.10)', gVit: 0.55, gStore: 0.10, gtotMode: 'product', uWin: 0.75 },
  triple_ext_15:     { label: 'Triple vitrage (g=0.60) + Store ext. standard (g_store=0.15)', gVit: 0.60, gStore: 0.15, gtotMode: 'product', uWin: 1.00 },
  double_ext_pastel: { label: 'Double vitrage + Protection ext. pastel (g_tot=0.09)',        gVit: 0.60, gStore: 0.09, gtotMode: 'direct',  uWin: 1.10 },
  toile_sombre:      { label: 'Toile extérieure sombre (g_vit=0.55, g_store=0.15)',           gVit: 0.55, gStore: 0.15, gtotMode: 'product', uWin: 0.90 },
  toile_claire:      { label: 'Toile extérieure claire (g_vit=0.55, g_store=0.35)',           gVit: 0.55, gStore: 0.35, gtotMode: 'product', uWin: 0.90 },
  int_claire:        { label: 'Protection intérieure claire (g_tot=0.36)',                    gVit: 0.55, gStore: 0.36, gtotMode: 'direct',  uWin: 0.90 },
  none:              { label: 'Aucune protection solaire (g_store=1.00)',                     gVit: 0.60, gStore: 1.00, gtotMode: 'product', uWin: 1.00 }
};

export const ENVELOPE_STANDARDS = {
  sia_new:  { label: 'SIA 380/1 Neuf (U=0.20)',      uWall: 0.20, uRoof: 0.20, uFloor: 0.20 },
  sia_reno: { label: 'Rénovation (U=0.25)',          uWall: 0.25, uRoof: 0.25, uFloor: 0.25 },
  minergie: { label: 'Minergie (U=0.15)',            uWall: 0.15, uRoof: 0.14, uFloor: 0.18 },
  old:      { label: 'Ancien non isolé (U=1.10)',    uWall: 1.10, uRoof: 0.80, uFloor: 0.90 }
};

/**
 * Calcule la puissance interne moyenne horaire pendant la plage d'occupation selon SIA 380/1:2016.
 * Tient compte du rapport tp / durée d'occupation et de la consommation électrique E_F,el * f_el.
 * @param {string} catKey
 * @param {number} area
 */
export function deriveSiaInternalDefaults(catKey, area) {
  const c = SIA380_CATEGORIES[catKey];
  if (!c) return null;

  const occCount = Math.max(1, Math.round((area / c.Ap) * 10) / 10);
  const occHoursPerDay = Math.max(1, c.occEnd - c.occStart);
  const daysPerYear = c.occDays === 7 ? 365 : Math.round((c.occDays / 7) * 365);

  // Facteur de présence effectif dans la plage d'occupation (évite de compter 24h pleines si tp = 12h)
  const presenceFactor = Math.min(1.0, Math.max(0.1, c.tp / occHoursPerDay));

  // Énergie électrique dissipée annuellement : E_F,el * f_el [Wh/m².an]
  // Répartie entre heures occupées (100%) et hors occupation (standby%)
  const occAnnH = occHoursPerDay * daysPerYear;
  const unoccAnnH = Math.max(0, 8760 - occAnnH);
  const effEquivHours = occAnnH + unoccAnnH * (c.standby / 100);
  const elWm2 = (c.Efel * 1000 * c.fel) / Math.max(1, effEquivHours);

  const lightWm2 = Math.round(Math.min(elWm2 * 0.4, 6) * 10) / 10;
  const equipWatt = Math.round(Math.max(0, (elWm2 - lightWm2) * area));

  return {
    spaceType: c.spaceType,
    occCount,
    occWatt: c.Qp,
    tp: c.tp,
    presenceFactor: Math.round(presenceFactor * 1000) / 1000,
    lightWm2,
    equipWatt,
    occStart: c.occStart,
    occEnd: c.occEnd,
    occDays: c.occDays,
    standbyPct: c.standby,
    qHygSpec: c.qth
  };
}
