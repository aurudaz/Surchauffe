/**
 * @fileoverview Préréglages constructifs pour le Constructeur 3D "Paroi par paroi"
 * (inspiré des outils de thermique du bâtiment suisses type KoZiBox / SIA).
 */

export const BOX3D_CONTACTS = {
  ext_sun:   { label: 'Extérieur (avec soleil & vent)', b: 1.0, exposed: true },
  ext_nosun: { label: 'Extérieur sans flux solaires',    b: 1.0, exposed: true },
  adiabatic: { label: 'Intérieur / Adiabatique (aucun flux)', b: 0.0, exposed: false },
  ground:    { label: 'Sur sol (b = 0.30)',              b: 0.3, exposed: false },
  unheated:  { label: 'Sur local non chauffé (b = 0.50)', b: 0.5, exposed: false }
};

export const BOX3D_WALL_PRESETS = {
  wall_sia_heavy:  { label: 'Mur béton isolé ext. U=0.17 (20cm béton, lourd)',          u: 0.17, kappa: 55 },
  wall_min_heavy:  { label: 'Mur Minergie-P béton U=0.10 (20cm béton + 20cm PUR)',      u: 0.10, kappa: 55 },
  wall_sia_med:    { label: 'Mur brique isolé U=0.20 (15cm brique + isol. ext.)',       u: 0.20, kappa: 35 },
  wall_plaster_int:{ label: 'Cloison intérieure plâtre 5–10 cm (masse modérée)',        u: 1.80, kappa: 14 },
  wall_wood_light: { label: 'Mur ossature bois U=0.18 (léger)',                         u: 0.18, kappa: 10 },
  wall_old_heavy:  { label: 'Mur ancien non isolé U=1.10 (pierre / béton lourd)',       u: 1.10, kappa: 55 },
  slab_heavy_ext:  { label: 'Dalle/Toiture béton nu isolée ext. U=0.18 (lourd)',        u: 0.18, kappa: 60 },
  slab_heavy_int:  { label: 'Dalle béton nu apparente / chape minérale (lourd)',        u: 1.40, kappa: 58 },
  slab_acoustic:   { label: 'Dalle béton + faux-plafond acoustique (masse réduite)',    u: 1.10, kappa: 12 },
  floor_parquet:   { label: 'Chape + parquet / moquette (inertie sol réduite)',         u: 1.20, kappa: 22 },
  roof_sia_light:  { label: 'Toiture isolée légère / combles bois U=0.20',              u: 0.20, kappa: 10 },
  floor_ground:    { label: 'Plancher lourd sur sol U=0.20 (chape minérale)',           u: 0.20, kappa: 52 },
  custom:          { label: 'Valeur U personnalisée (inertie moyenne)',                 u: 0.20, kappa: 30 }
};

export const BOX3D_WINDOW_PRESETS = {
  none:        { label: 'Aucune ouverture',                               w: 0,    h: 0,    qty: 0, uWin: 1.0, gVit: 0.55, gStore: 0.12 },
  triple_2x19: { label: 'Triple-vitrage 2×1.9 m² (U=1.0, g=0.55)',        w: 1.9,  h: 1.0,  qty: 2, uWin: 1.0, gVit: 0.55, gStore: 0.10 },
  triple_lea38:{ label: 'Fenêtre TB 3.8 m² (1.95×1.95 m, U=0.80, g=0.60)',w: 1.95, h: 1.95, qty: 1, uWin: 0.8, gVit: 0.60, gStore: 0.20 },
  win_std:     { label: 'Fenêtre standard 1.4×1.4 m (U=1.0, g=0.55)',     w: 1.4,  h: 1.4,  qty: 1, uWin: 1.0, gVit: 0.55, gStore: 0.12 },
  bay_3x22:    { label: 'Baie vitrée 3.0×2.2 m (U=0.8, g=0.55)',          w: 3.0,  h: 2.2,  qty: 1, uWin: 0.8, gVit: 0.55, gStore: 0.10 },
  velux:       { label: 'Fenêtre de toit 1.0×1.2 m (U=1.1, g=0.55)',      w: 1.0,  h: 1.2,  qty: 1, uWin: 1.1, gVit: 0.55, gStore: 0.15 },
  custom:      { label: 'Personnalisé (L × H × Qté)',                     w: 1.6,  h: 1.5,  qty: 1, uWin: 1.0, gVit: 0.55, gStore: 0.12 }
};

const ORIENT_RING = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

export function rotateOrient(baseOrient, steps90) {
  const idx = ORIENT_RING.indexOf(baseOrient);
  const start = idx >= 0 ? idx : 4; // S par défaut
  return ORIENT_RING[(start + steps90 * 2 + 8) % 8];
}

export function getWallOrientations(frontOrient = 'S') {
  return {
    front: frontOrient,
    back: rotateOrient(frontOrient, 2),
    right: rotateOrient(frontOrient, 1),
    left: rotateOrient(frontOrient, -1),
    ceiling: 'R'
  };
}

/**
 * Retourne la surface brute de la façade d'un étage pour une orientation donnée [m²].
 * Utilise les dimensions exactes (dimX × height ou dimY × height) si le Constructeur 3D est actif.
 */
export function getFacadeGrossAreaForOrient(fl, orient) {
  if (fl.box3d && fl.box3d.dimX && fl.box3d.dimY) {
    const orients = getWallOrientations(fl.box3d.frontOrient || 'S');
    const h = Math.max(1.8, Number(fl.height) || 2.5);
    if (orient === orients.front || orient === orients.back) {
      return Math.max(2, Number(fl.box3d.dimX) * h);
    }
    if (orient === orients.left || orient === orients.right) {
      return Math.max(2, Number(fl.box3d.dimY) * h);
    }
  }
  return Math.max(4, Math.sqrt(Math.max(4, fl.area)) * fl.height);
}
