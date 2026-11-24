/**
 * @fileoverview Étape 04 — Ventilation hygiénique diurne, infiltration et aéraulique nocturne
 * (Modèle physique ouvrants EN 16798-7 / BS 5925 & Méthode simple en % de surface).
 */

/**
 * Facteur de réduction aéraulique d'un ouvrant en imposte / soufflet (EN 16798-7).
 *   C_k(α) = 2.60e-7 · α³ − 1.19e-4 · α² + 1.86e-2 · α
 *
 * @param {number} alphaDeg Angle d'ouverture [°]
 * @returns {number} Coefficient C_k ∈ [0, 1]
 */
export function ckImposte(alphaDeg) {
  const a = Math.max(0, Math.min(180, alphaDeg));
  return Math.max(0, Math.min(1.0, 2.60e-7 * a * a * a - 1.19e-4 * a * a + 1.86e-2 * a));
}

/**
 * Hauteur de tirage thermique globale du bâtiment [m] lorsque le couplage multi-étages est actif.
 * @param {object} projObj
 * @returns {number}
 */
export function computeBuildingStackSpan(projObj) {
  if (!projObj.stackCoupling) return 3.0;
  const zs = [];
  for (const op of projObj.openings) {
    if (!op.operable) continue;
    const fl = projObj.floors.find(f => f.id === op.floorId);
    if (fl) {
      zs.push(fl.elevationZ + (op.sillHeight ?? 0.9) + 0.5 * (op.openHeight ?? op.height));
    }
  }
  if (zs.length >= 2) {
    return Math.max(1.5, Math.max(...zs) - Math.min(...zs));
  }
  if (projObj.floors.length >= 2) {
    const minZ = Math.min(...projObj.floors.map(f => f.elevationZ));
    const maxZ = Math.max(...projObj.floors.map(f => f.elevationZ + f.height * 0.7));
    return Math.max(1.5, maxZ - minZ);
  }
  return 3.0;
}

/**
 * Multiplicateur calibré d'aération traversante / tirage cheminée par rapport au mono-face :
 *   En mono-face, l'air entrant et sortant passe par la même ouverture (facteur 1/3).
 *   En traversant sur un même niveau (Δz ≈ 0), le balayage entre 2 façades + brise nocturne
 *   donne ~1.5× le débit mono-face. En tirage cheminée multi-étages (Δz = stackSpan), la mise
 *   en série (A_eff = A/(2√2)) avec pertes de charge internes (portes/cages d'escalier) donne
 *   1.15 · √(Δz / H_ouv), plafonné à 2.2× (cohérent avec SIA 2023 / BS 5925 / TB Léa Tab. 5).
 */
function crossVentMultiplier(stackSpan, openHeight, multiFloorStack = false) {
  if (!multiFloorStack) return 1.50;
  return Math.min(2.2, 1.15 * Math.sqrt(Math.max(openHeight, stackSpan) / Math.max(0.5, openHeight)));
}

/**
 * Débit volumique nocturne [m³/s] pour une fenêtre ouvrante en Mode Avancé.
 * Formule de base mono-face (EN 16798-7 / Warren & Parkins) :
 *   Q = (1/3) · n · C_d · A_ouv · √(g · H_ouv · ΔT / T_e,K)
 *
 * @param {object} op Ouverture
 * @param {number} TiC Température d'air intérieure [°C]
 * @param {number} TeC Température extérieure [°C]
 * @param {number} stackSpan Hauteur de tirage [m]
 * @param {boolean} [multiFloorStack=false] Couplage multi-étages actif
 * @returns {number} Débit [m³/s]
 */
export function calcOpeningFlowM3s(op, TiC, TeC, stackSpan, multiFloorStack = false) {
  if (!op.operable || TiC <= TeC) return 0;
  const areaOuv = op.qty * (op.openHeight ?? op.height) * (op.openWidth ?? op.width);
  const hOuv = Math.max(0.2, op.openHeight ?? op.height);
  const VE =
    (op.cd ?? 0.6) *
    areaOuv *
    (1 / 3) *
    Math.sqrt((9.81 * hOuv * (TiC - TeC)) / (TeC + 273.15));

  const ck = ckImposte(op.alphaDeg ?? 20);
  if (op.openType === 'imposte') return VE * ck;
  if (op.openType === 'cross_rect') return VE * crossVentMultiplier(stackSpan, hOuv, multiFloorStack);
  if (op.openType === 'cross_imposte') return VE * ck * crossVentMultiplier(stackSpan, hOuv, multiFloorStack);
  return VE;
}

/**
 * Débit volumique nocturne [m³/s] en Méthode Simple (pourcentage de surface de pièce ou de vitrage).
 *
 * @param {object} fl Étage
 * @param {number} winAreaFloor Surface vitrée totale de l'étage [m²]
 * @param {number} TiC Température d'air intérieure [°C]
 * @param {number} TeC Température extérieure [°C]
 * @param {number} stackSpan Hauteur de tirage [m]
 * @param {boolean} [multiFloorStack=false] Couplage multi-étages actif
 * @returns {{ m3s: number, openArea: number }}
 */
export function calcSimplePctNightFlowM3s(fl, winAreaFloor, TiC, TeC, stackSpan, multiFloorStack = false) {
  if (fl.nightSimpleBasis === 'none' || (fl.nightSimplePct ?? 0) <= 0) {
    return { m3s: 0, openArea: 0 };
  }
  const openArea =
    fl.nightSimpleBasis === 'window_pct'
      ? (fl.nightSimplePct / 100) * winAreaFloor
      : (fl.nightSimplePct / 100) * fl.area;

  if (openArea <= 0 || TiC <= TeC) return { m3s: 0, openArea };

  const H_eff = Math.min(1.6, Math.max(1.0, fl.height * 0.55));
  const VE =
    0.60 *
    openArea *
    (1 / 3) *
    Math.sqrt((9.81 * H_eff * (TiC - TeC)) / (TeC + 273.15));

  let flow = VE * (fl.nightSimpleEff || 1.0);
  if (fl.nightSimpleCross) {
    flow *= crossVentMultiplier(stackSpan, H_eff, multiFloorStack);
  }
  return { m3s: flow, openArea };
}

/**
 * Calcule le débit nocturne instantané [m³/h] d'un étage selon le mode choisi.
 */
export function computeFloorNightFlowM3h(fp, TairC, TeC, buildingStackSpan, stackCoupling) {
  const fl = fp.fl;
  if (fl.nightVentMode === 'none') return 0;
  if (fl.nightVentMode === 'fixed_m3hm2') return Math.max(0, fl.nightVentFixedVal) * fl.area;
  if (fl.nightVentMode === 'fixed_ach') return Math.max(0, fl.nightVentFixedVal) * fp.vol;

  const isMultiStack = Boolean(stackCoupling) && buildingStackSpan > fl.height + 0.5;
  const span = isMultiStack ? buildingStackSpan : fl.height;
  if (fl.nightVentMode === 'simple_pct') {
    return calcSimplePctNightFlowM3s(fl, fp.winArea, TairC, TeC, span, isMultiStack).m3s * 3600;
  }

  let sum = 0;
  for (const op of fp.ops) {
    sum += calcOpeningFlowM3s(op, TairC, TeC, span, isMultiStack) * 3600;
  }
  return sum;
}

/**
 * Calcule le débit d'aération naturelle par les fenêtres en journée (pendant l'occupation
 * lorsque θ_i > θ_e), en utilisant le même modèle physique d'ouvrants que la ventilation nocturne.
 * Permet de simuler les stratégies Minergie « fenêtres le jour », « jour & nuit » et « traversante ».
 */
export function computeFloorDayWindowFlowM3h(fp, TairC, TeC, buildingStackSpan, stackCoupling) {
  const fl = fp.fl;
  if (fl.dayVentMode !== 'window_occ' || TairC <= TeC) return 0;

  const isMultiStack = Boolean(stackCoupling) && buildingStackSpan > fl.height + 0.5;
  const span = isMultiStack ? buildingStackSpan : fl.height;

  // Si l'étage a des ouvrants détaillés configurés (ou mode physique), utilise directement ces ouvrants
  if (fl.nightVentMode === 'physical') {
    let sum = 0;
    for (const op of fp.ops) {
      sum += calcOpeningFlowM3s(op, TairC, TeC, span, isMultiStack) * 3600;
    }
    return sum;
  }

  // Si mode simple_pct actif, utilise la même proportion ouvrante (fenêtres ouvertes par les occupants)
  if (fl.nightVentMode === 'simple_pct' && (fl.nightSimplePct ?? 0) > 0) {
    return calcSimplePctNightFlowM3s(fl, fp.winArea, TairC, TeC, span, isMultiStack).m3s * 3600;
  }

  // Sinon (ex. stratégie « fenêtres le jour uniquement », nightVentMode === 'none' ou débit fixe),
  // calcule via les ouvrants physiques si présents, sinon repli normatif 3 % surface plancher en oscillo-battant
  let physSum = 0;
  for (const op of fp.ops) {
    if (op.operable) {
      physSum += calcOpeningFlowM3s(op, TairC, TeC, span, isMultiStack) * 3600;
    }
  }
  if (physSum > 0) return physSum;

  const fallbackFl = {
    ...fl,
    nightSimpleBasis: 'floor_pct',
    nightSimplePct: 3.0,
    nightSimpleEff: 0.60,
    nightSimpleCross: Boolean(fl.nightSimpleCross)
  };
  return calcSimplePctNightFlowM3s(fallbackFl, fp.winArea, TairC, TeC, span, isMultiStack).m3s * 3600;
}
