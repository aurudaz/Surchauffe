/**
 * @fileoverview Norme SIA 180:2014 — Protection thermique, protection contre l'humidité
 * et climat intérieur dans les bâtiments (protection thermique estivale).
 */

/**
 * Seuils de tolérance annuelle d'heures de dépassement (SIA 180:2014 & Minergie).
 * Note : les clés 'new' et 'reno' sont conservées pour compatibilité rétroactive JSON.
 */
export const SIA180_TOLERANCE_PROFILES = {
  minergie:        { hours: 100, tempLimitC: 26.5, label: 'Minergie — Confort estival (≤ 100 h/an > 26.5 °C)' },
  new:             { hours: 100, label: 'Bureau / École / SIA 180 stricte (≤ 100 h/an)' },
  strict_100:      { hours: 100, label: 'Bureau / École / SIA 180 stricte (≤ 100 h/an)' },
  residential_400: { hours: 400, label: 'Habitation SIA 180 standard (≤ 400 h/an)' },
  reno:            { hours: 400, label: 'Transformation / Rénovation / Habitation SIA 180 (≤ 400 h/an)' },
  zero:            { hours: 0,   label: 'Exigence zéro surchauffe / Froid fictif (0 h/an)' }
};

export function getSIA180ToleranceHours(projectType) {
  return (SIA180_TOLERANCE_PROFILES[projectType] || SIA180_TOLERANCE_PROFILES.new).hours;
}

/**
 * Calcule les limites inférieure et supérieure de température opérative admissible
 * selon SIA 180:2014 en fonction de la température extérieure glissante sur 48 h (θ_rm,48h).
 *
 * - Mode 'fig3' (Fig. 3 — locaux à ventilation naturelle, ni chauffés ni refroidis) :
 *     θ_op,max = max(25.0, 0.33 · θ_rm,48h + 21.8)
 *     θ_op,min = min(22.0, max(20.5, 0.33 · θ_rm,48h + 14.3))
 * - Mode 'fig4' (Fig. 4 — locaux chauffés / refroidis / ventilation mécanique) :
 *     θ_op,max = 24.5 °C (θ_rm,48 ≤ 12 °C) → rampe linéaire jusqu'à 26.5 °C (θ_rm,48 ≥ 17.5 °C)
 *
 * @param {number} tRm48 Moyenne glissante sur 48 h de la température extérieure [°C]
 * @param {'fig3'|'fig4'} mode
 * @returns {{ upper: number, lower: number }}
 */
export function getSIA180Limits(tRm48, mode = 'fig3') {
  const lower = Math.min(22.0, Math.max(20.5, 0.33 * tRm48 + 14.3));
  if (mode === 'fig3') {
    return {
      upper: Math.max(25.0, 0.33 * tRm48 + 21.8),
      lower
    };
  }
  let upper = 24.5;
  if (tRm48 > 12.0 && tRm48 < 17.5) {
    upper = 24.5 + (2.0 / 5.5) * (tRm48 - 12.0);
  } else if (tRm48 >= 17.5) {
    upper = 26.5;
  }
  return { upper, lower };
}

/**
 * Méthode 2 (SIA 180 Fig. 12) : limite de facteur solaire total g_tot selon l'orientation
 * et le taux de surface vitrée sur façade f_g = A_vit / A_facade.
 * @param {string} orient Orientation ('N','NE','NO','E','SE','S','SO','O')
 * @param {number} fg Fraction vitrée de la façade [-]
 * @returns {number}
 */
export function getMethod2GtotLimit(orient, fg) {
  if (fg <= 0) return 1.0;
  if (orient === 'N') return Math.min(1.0, 0.20 / fg);
  if (orient === 'NE' || orient === 'NO') return Math.min(0.28, 0.13 / fg);
  return Math.min(0.15, 0.07 / fg);
}

/**
 * Méthode 1 (SIA 180 Tableau 8) : part vitrée maximale admissible sur façade f_g,max
 * selon l'affectation, l'inertie thermique C_spec, le nombre d'orientations et la commande des stores.
 * @param {'office'|'residential'} spaceType
 * @param {number} cSpec Capacité thermique spécifique [Wh/(m²·K)]
 * @param {boolean} multiFacade Plus d'une façade vitrée
 * @param {boolean} allAutoBlinds Stores automatiques résistants au vent sur toutes les fenêtres
 * @returns {number} Fraction vitrée max [-]
 */
export function getMethod1MaxGlazingRatio(spaceType, cSpec, multiFacade, allAutoBlinds) {
  if (spaceType === 'office') {
    if (!allAutoBlinds) return 0;
    if (cSpec >= 65 && !multiFacade) return 0.40;
    if (cSpec >= 30) return 0.30;
    return 0;
  }
  if (cSpec >= 65) {
    return multiFacade ? (allAutoBlinds ? 0.50 : 0.30) : (allAutoBlinds ? 0.70 : 0.50);
  }
  if (cSpec >= 30) {
    return multiFacade ? (allAutoBlinds ? 0.40 : 0.30) : (allAutoBlinds ? 0.60 : 0.40);
  }
  return 0;
}
