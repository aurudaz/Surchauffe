/**
 * @fileoverview Norme SIA 180:2014 — Protection thermique, protection contre l'humidité
 * et climat intérieur dans les bâtiments (protection thermique estivale).
 */

/**
 * Seuils de tolérance annuelle d'heures de dépassement selon les normes suisses officielles.
 * Note : les clés historiques ('new', 'reno', 'residential_400', 'strict_100') sont conservées
 * pour assurer une rétrocompatibilité complète avec les fichiers JSON exportés.
 */
export const SIA180_TOLERANCE_PROFILES = {
  minergie: {
    hours: 100,
    tempLimitC: 26.5,
    label: 'Minergie',
    shortLabel: 'Minergie (≤ 100 h > 26.5 °C)',
    description:
      'Label Minergie, Minergie-P et Minergie-A (exigence estivale identique pour les 3 labels) : simulation dynamique ≤ 100 h/an au-dessus de 26.5 °C (climat 2035) + contrôle constructif (g_total, inertie, vent SIA 342).'
  },
  new: {
    hours: 100,
    label: 'SIA 180:2014 — Construction neuve',
    shortLabel: 'SIA 180 — Neuf (≤ 100 h/an)',
    description:
      'Norme SIA 180:2014 pour constructions neuves : ≤ 100 h/an de dépassement pendant l’occupation (Fig. 3 auto en ventilation naturelle, Fig. 4 auto si VMC active).'
  },
  strict_100: {
    hours: 100,
    label: 'SIA 180:2014 — Construction neuve',
    shortLabel: 'SIA 180 — Neuf (≤ 100 h/an)',
    description:
      'Norme SIA 180:2014 pour constructions neuves : ≤ 100 h/an au-dessus de la courbe limite adaptative.'
  },
  reno: {
    hours: 400,
    label: 'SIA 180:2014 — Rénovation / Transformation',
    shortLabel: 'SIA 180 — Rénovation (≤ 400 h/an)',
    description:
      'Norme SIA 180:2014 pour transformations, rénovations et bâtiments existants : tolérance élargie à ≤ 400 h/an (Fig. 3 auto en ventilation naturelle, Fig. 4 auto si VMC active).'
  },
  residential_400: {
    hours: 400,
    label: 'SIA 180:2014 — Rénovation / Transformation',
    shortLabel: 'SIA 180 — Rénovation (≤ 400 h/an)',
    description:
      'Norme SIA 180:2014 (tolérance élargie ≤ 400 h/an au-dessus de la courbe limite adaptative).'
  },
  zero: {
    hours: 0,
    label: 'MoPEC / EN-102 — Sans refroidissement',
    shortLabel: 'MoPEC / EN-102 (0 h/an)',
    description:
      'Modèle de prescriptions énergétiques des cantons (MoPEC / justificatif EN-102) : exigence stricte sans installation de refroidissement (0 h/an, Fig. 3 auto si naturelle, Fig. 4 auto si VMC).'
  },
  custom: {
    hours: 100,
    label: 'Réglementation personnalisée',
    shortLabel: 'Custom (≤ 100 h > 27.0 °C)',
    description:
      'Exigence personnalisée : définissez librement le type de courbe limite, la température de plafonnement [°C], le nombre maximal d’heures tolérées et la période de comptage.'
  }
};

export const DEFAULT_CUSTOM_REG = {
  limitMode: 'fixed', // 'fixed' | 'adaptive_cap' | 'fig4'
  maxTempC: 27.0,
  maxHours: 100,
  countMode: 'occupied' // 'occupied' | 'all'
};

export function normalizeCustomReg(customReg = null) {
  const c = customReg && typeof customReg === 'object' ? customReg : {};
  const limitMode = ['fixed', 'adaptive_cap', 'fig4'].includes(c.limitMode)
    ? c.limitMode
    : DEFAULT_CUSTOM_REG.limitMode;
  const maxTempC = Math.max(20, Math.min(36, Number(c.maxTempC ?? DEFAULT_CUSTOM_REG.maxTempC) || 27.0));
  const maxHours = Math.max(0, Math.min(8760, Math.round(Number(c.maxHours ?? DEFAULT_CUSTOM_REG.maxHours) || 0)));
  const countMode = c.countMode === 'all' ? 'all' : 'occupied';
  return { limitMode, maxTempC, maxHours, countMode };
}

export function getSIA180Profile(projectType, customReg = null) {
  if (projectType === 'custom') {
    const cr = normalizeCustomReg(customReg);
    const limTxt =
      cr.limitMode === 'fixed'
        ? `> ${cr.maxTempC.toFixed(1)} °C`
        : cr.limitMode === 'adaptive_cap'
          ? `SIA plaf. ${cr.maxTempC.toFixed(1)} °C`
          : `Fig. 4 max ${cr.maxTempC.toFixed(1)} °C`;
    return {
      ...SIA180_TOLERANCE_PROFILES.custom,
      hours: cr.maxHours,
      tempLimitC: cr.maxTempC,
      shortLabel: `Custom (≤ ${cr.maxHours} h, ${limTxt})`,
      description: `Réglementation personnalisée : ≤ ${cr.maxHours} h/an (${limTxt}, ${cr.countMode === 'all' ? '24h/24' : 'heures occupées'}).`
    };
  }
  return SIA180_TOLERANCE_PROFILES[projectType] || SIA180_TOLERANCE_PROFILES.new;
}

export function getSIA180ToleranceHours(projectType, customReg = null) {
  return getSIA180Profile(projectType, customReg).hours;
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
 * Calcule la limite de confort effective pour un projet selon son exigence active :
 *  - Minergie : seuil fixe 26.5 °C (sans courbe SIA)
 *  - Custom : seuil fixe, SIA adaptatif plafonné ou rampe Fig. 4 plafonnée
 *  - SIA 180 / MoPEC : Fig. 3 (ventilation naturelle) ou Fig. 4 (VMC)
 */
export function getProjectComfortLimits(tRm48, project) {
  const pt = project?.projectType || 'new';
  const lower = Math.min(22.0, Math.max(20.5, 0.33 * tRm48 + 14.3));
  if (pt === 'minergie') {
    return { upper: 26.5, lower, label: 'Minergie (26.5 °C)' };
  }
  if (pt === 'custom') {
    const cr = normalizeCustomReg(project?.customReg);
    if (cr.limitMode === 'fixed') {
      return { upper: cr.maxTempC, lower, label: `Custom (${cr.maxTempC.toFixed(1)} °C)` };
    }
    if (cr.limitMode === 'adaptive_cap') {
      const raw = Math.max(25.0, 0.33 * tRm48 + 21.8);
      return {
        upper: Math.min(cr.maxTempC, raw),
        lower,
        label: `SIA plaf. ${cr.maxTempC.toFixed(1)} °C`
      };
    }
    let upper = Math.min(24.5, cr.maxTempC);
    if (tRm48 > 12.0 && tRm48 < 17.5) {
      upper = upper + ((cr.maxTempC - upper) / 5.5) * (tRm48 - 12.0);
    } else if (tRm48 >= 17.5) {
      upper = cr.maxTempC;
    }
    return { upper, lower, label: `Fig. 4 max ${cr.maxTempC.toFixed(1)} °C` };
  }
  const mode = project?.siaCurveMode === 'fig4' ? 'fig4' : 'fig3';
  const base = getSIA180Limits(tRm48, mode);
  return {
    ...base,
    label: mode === 'fig4' ? 'SIA Fig. 4 (VMC)' : 'SIA Fig. 3 (nat.)'
  };
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
