/**
 * @fileoverview Profils horaires normalisés sur 24 h (0h..23h) selon SIA 2024:2015
 * (« Données d'utilisation des locaux pour l'énergie et les installations du bâtiment »)
 * et Figures 41–42 du Travail de bachelor Léa Bohren (HES-SO / bSol Pro).
 *
 * Chaque tableau de 24 valeurs représente le taux horaire d'utilisation [0..1]
 * pour les personnes (people), l'éclairage (lighting) et les appareils (appliances).
 */

export const SIA2024_HOURLY_PROFILES = {
  // Cat. I & II : Habitat collectif / individuel (SIA 2024 Wohnen MFH/EFH, TB Léa Fig. 41)
  // Personnes : présence nocturne/matinale, creux journée, forte présence soirée
  // Appareils : veille continue ~0.10-0.15, pics cuisine/multimédia 07h, 12h, 18h-22h
  // Éclairage : matin 06h-08h et soirée 18h-23h
  I: {
    label: 'Habitat collectif (SIA 2024)',
    people:     [0.80, 0.80, 0.80, 0.80, 0.80, 0.80, 0.60, 0.50, 0.30, 0.20, 0.20, 0.20, 0.50, 0.40, 0.20, 0.20, 0.25, 0.40, 0.70, 0.80, 0.80, 0.80, 0.80, 0.80],
    appliances: [0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.20, 0.30, 0.20, 0.15, 0.15, 0.25, 0.45, 0.25, 0.15, 0.15, 0.20, 0.40, 0.80, 1.00, 0.80, 0.65, 0.35, 0.15],
    lighting:   [0.05, 0.00, 0.00, 0.00, 0.00, 0.05, 0.30, 0.40, 0.15, 0.05, 0.05, 0.05, 0.10, 0.05, 0.05, 0.05, 0.10, 0.30, 0.65, 0.85, 0.90, 0.80, 0.50, 0.20]
  },
  II: {
    label: 'Habitat individuel (SIA 2024)',
    people:     [0.80, 0.80, 0.80, 0.80, 0.80, 0.80, 0.60, 0.50, 0.30, 0.20, 0.20, 0.20, 0.50, 0.40, 0.20, 0.20, 0.25, 0.40, 0.70, 0.80, 0.80, 0.80, 0.80, 0.80],
    appliances: [0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.20, 0.30, 0.20, 0.15, 0.15, 0.25, 0.45, 0.25, 0.15, 0.15, 0.20, 0.40, 0.80, 1.00, 0.80, 0.65, 0.35, 0.15],
    lighting:   [0.05, 0.00, 0.00, 0.00, 0.00, 0.05, 0.30, 0.40, 0.15, 0.05, 0.05, 0.05, 0.10, 0.05, 0.05, 0.05, 0.10, 0.30, 0.65, 0.85, 0.90, 0.80, 0.50, 0.20]
  },
  // Cat. III : Administration / Bureau (SIA 2024 Einzel-/Gruppenbüro, TB Léa Fig. 42)
  III: {
    label: 'Administration / Bureau (SIA 2024)',
    people:     [0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.20, 0.65, 0.80, 0.80, 0.70, 0.35, 0.65, 0.80, 0.80, 0.65, 0.35, 0.10, 0.00, 0.00, 0.00, 0.00, 0.00],
    appliances: [0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.25, 0.75, 0.90, 0.90, 0.85, 0.55, 0.80, 0.90, 0.90, 0.75, 0.45, 0.20, 0.10, 0.10, 0.10, 0.10, 0.10],
    lighting:   [0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.25, 0.75, 0.85, 0.85, 0.80, 0.50, 0.75, 0.85, 0.85, 0.70, 0.40, 0.15, 0.00, 0.00, 0.00, 0.00, 0.00]
  },
  // Cat. IV : École (salle de classe SIA 2024)
  IV: {
    label: 'École (SIA 2024)',
    people:     [0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.10, 0.85, 0.90, 0.90, 0.85, 0.15, 0.70, 0.85, 0.75, 0.30, 0.05, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00],
    appliances: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.15, 0.80, 0.90, 0.90, 0.85, 0.25, 0.70, 0.85, 0.75, 0.35, 0.10, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
    lighting:   [0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.15, 0.85, 0.90, 0.90, 0.85, 0.20, 0.75, 0.85, 0.75, 0.30, 0.05, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00]
  },
  // Cat. V : Commerce
  V: {
    label: 'Commerce (SIA 2024)',
    people:     [0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.20, 0.50, 0.75, 0.85, 0.70, 0.65, 0.75, 0.85, 0.90, 0.90, 0.60, 0.15, 0.00, 0.00, 0.00, 0.00],
    appliances: [0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.20, 0.50, 0.90, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.85, 0.35, 0.15, 0.15, 0.15, 0.15],
    lighting:   [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.10, 0.50, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 0.95, 0.30, 0.05, 0.05, 0.05, 0.05]
  },
  // Cat. VI : Restauration
  VI: {
    label: 'Restauration (SIA 2024)',
    people:     [0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.05, 0.10, 0.20, 0.65, 1.00, 0.85, 0.35, 0.20, 0.20, 0.35, 0.70, 0.95, 0.90, 0.65, 0.35, 0.10],
    appliances: [0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.20, 0.30, 0.55, 0.90, 1.00, 0.85, 0.45, 0.30, 0.35, 0.60, 0.90, 1.00, 0.90, 0.70, 0.40, 0.20],
    lighting:   [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.15, 0.25, 0.50, 0.85, 0.95, 0.90, 0.55, 0.45, 0.50, 0.75, 0.95, 1.00, 1.00, 0.95, 0.75, 0.30]
  },
  // Cat. VII : Lieu de rassemblement
  VII: {
    label: 'Lieu de rassemblement (SIA 2024)',
    people:     [0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.10, 0.25, 0.40, 0.45, 0.35, 0.45, 0.60, 0.70, 0.75, 0.80, 0.85, 0.95, 0.90, 0.70, 0.30, 0.00],
    appliances: [0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.20, 0.45, 0.60, 0.65, 0.55, 0.65, 0.75, 0.80, 0.85, 0.90, 0.95, 1.00, 0.95, 0.75, 0.35, 0.10],
    lighting:   [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.20, 0.50, 0.65, 0.70, 0.60, 0.70, 0.80, 0.85, 0.90, 0.95, 1.00, 1.00, 0.95, 0.80, 0.40, 0.05]
  },
  // Cat. VIII : Hôpital (fonctionnement 24h/24)
  VIII: {
    label: 'Hôpital (SIA 2024)',
    people:     [0.65, 0.65, 0.65, 0.65, 0.65, 0.65, 0.75, 0.85, 0.95, 1.00, 1.00, 0.95, 0.85, 0.90, 0.95, 0.95, 0.90, 0.85, 0.80, 0.75, 0.70, 0.65, 0.65, 0.65],
    appliances: [0.40, 0.40, 0.40, 0.40, 0.40, 0.45, 0.60, 0.80, 0.95, 1.00, 1.00, 0.95, 0.85, 0.90, 0.95, 0.95, 0.90, 0.80, 0.70, 0.60, 0.50, 0.45, 0.40, 0.40],
    lighting:   [0.20, 0.20, 0.20, 0.20, 0.20, 0.30, 0.55, 0.80, 0.95, 0.95, 0.95, 0.90, 0.85, 0.90, 0.95, 0.95, 0.90, 0.85, 0.80, 0.75, 0.60, 0.40, 0.25, 0.20]
  },
  // Cat. IX : Industrie / Atelier
  IX: {
    label: 'Industrie (SIA 2024)',
    people:     [0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.15, 0.75, 0.90, 0.95, 0.95, 0.85, 0.35, 0.85, 0.95, 0.90, 0.75, 0.40, 0.10, 0.00, 0.00, 0.00, 0.00, 0.00],
    appliances: [0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.25, 0.80, 0.95, 1.00, 1.00, 0.90, 0.45, 0.90, 1.00, 0.95, 0.80, 0.45, 0.20, 0.15, 0.15, 0.15, 0.15, 0.15],
    lighting:   [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.20, 0.80, 0.95, 0.95, 0.95, 0.90, 0.50, 0.90, 0.95, 0.95, 0.80, 0.45, 0.15, 0.05, 0.05, 0.05, 0.05, 0.05]
  },
  // Cat. X : Dépôt
  X: {
    label: 'Dépôt (SIA 2024)',
    people:     [0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.10, 0.60, 0.75, 0.75, 0.65, 0.25, 0.65, 0.75, 0.70, 0.50, 0.15, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00],
    appliances: [0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.30, 0.75, 0.85, 0.85, 0.80, 0.45, 0.80, 0.85, 0.80, 0.65, 0.30, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20],
    lighting:   [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.20, 0.75, 0.85, 0.85, 0.80, 0.40, 0.80, 0.85, 0.80, 0.60, 0.25, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05]
  },
  // Cat. XI : Installation sportive
  XI: {
    label: 'Installation sportive (SIA 2024)',
    people:     [0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.05, 0.35, 0.55, 0.65, 0.55, 0.35, 0.45, 0.60, 0.70, 0.80, 0.90, 1.00, 1.00, 0.85, 0.50, 0.10, 0.00],
    appliances: [0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.20, 0.50, 0.65, 0.75, 0.65, 0.50, 0.60, 0.70, 0.80, 0.85, 0.95, 1.00, 1.00, 0.90, 0.60, 0.20, 0.15],
    lighting:   [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.15, 0.50, 0.70, 0.75, 0.70, 0.55, 0.65, 0.75, 0.85, 0.90, 0.95, 1.00, 1.00, 0.95, 0.65, 0.15, 0.05]
  },
  // Cat. XII : Piscine couverte
  XII: {
    label: 'Piscine couverte (SIA 2024)',
    people:     [0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.10, 0.40, 0.65, 0.75, 0.70, 0.55, 0.65, 0.85, 0.95, 0.95, 0.90, 0.80, 0.65, 0.35, 0.05, 0.00, 0.00],
    appliances: [0.30, 0.30, 0.30, 0.30, 0.30, 0.30, 0.35, 0.50, 0.75, 0.90, 0.95, 0.90, 0.85, 0.90, 0.95, 1.00, 1.00, 0.95, 0.90, 0.80, 0.60, 0.35, 0.30, 0.30],
    lighting:   [0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.15, 0.40, 0.80, 0.95, 0.95, 0.95, 0.90, 0.95, 0.95, 1.00, 1.00, 1.00, 0.95, 0.90, 0.70, 0.20, 0.10, 0.10]
  }
};

// Pré-calcul des moyennes journalières pour la normalisation conservatrice d'énergie
const PROFILE_MEANS = {};
for (const [cat, p] of Object.entries(SIA2024_HOURLY_PROFILES)) {
  const meanOf = arr => arr.reduce((s, v) => s + v, 0) / 24;
  PROFILE_MEANS[cat] = {
    people: Math.max(0.05, meanOf(p.people)),
    appliances: Math.max(0.05, meanOf(p.appliances)),
    lighting: Math.max(0.05, meanOf(p.lighting))
  };
}

/**
 * Retourne les multiplicateurs horaires SIA 2024 conservateurs d'énergie journalière
 * pour une catégorie donnée et une heure `hod` (0..23).
 *
 * La normalisation garantit que la moyenne journalière des gains internes sur un jour
 * occupé reste strictement égale à l'énergie définie par les paramètres SIA 380/1 de l'étage,
 * tout en reproduisant fidèlement les pics horaires (après-midi en bureau, soirée en logement).
 *
 * @param {string} catKey Catégorie SIA ('I'..'XII' ou 'custom')
 * @param {'residential'|'office'} spaceType Fallback si catégorie 'custom'
 * @param {number} hod Heure du jour [0..23]
 * @param {boolean} isOccDay Jour ouvré / occupé (dow < fl.occDays)
 * @param {number} occHoursPerDay Durée d'occupation journalière configurée (occEnd - occStart)
 * @param {number} standbyFrac Fraction de veille hors occupation [0..1]
 */
export function getSia2024HourlyMultipliers(
  catKey,
  spaceType,
  hod,
  isOccDay,
  occHoursPerDay = 10,
  standbyFrac = 0.1
) {
  const key = SIA2024_HOURLY_PROFILES[catKey]
    ? catKey
    : spaceType === 'residential'
      ? 'I'
      : 'III';
  const prof = SIA2024_HOURLY_PROFILES[key];
  const means = PROFILE_MEANS[key];
  const h = Math.max(0, Math.min(23, Math.floor(hod) % 24));

  // Un jour non occupé (week-end pour bureau/école) : 0 occupant, uniquement veille appareils/éclairage
  if (!isOccDay) {
    return {
      people: 0,
      appliances: standbyFrac,
      lighting: standbyFrac
    };
  }

  // Facteur d'énergie journalière équivalente du modèle palier (pour conserver exactement les Wh/(m²·j))
  const occFracDay = Math.max(1, Math.min(24, occHoursPerDay)) / 24;
  const elEquivFrac = occFracDay + (1 - occFracDay) * standbyFrac;

  return {
    people: (prof.people[h] / means.people) * occFracDay,
    appliances: (prof.appliances[h] / means.appliances) * elEquivFrac,
    lighting: (prof.lighting[h] / means.lighting) * elEquivFrac
  };
}
