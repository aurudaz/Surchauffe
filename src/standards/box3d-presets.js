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
  wall_sia_heavy:  { label: 'Mur isolé ext. U=0.17 (22cm isol. + 20cm béton, lourd)', u: 0.17, mass: 12 },
  wall_sia_med:    { label: 'Mur brique isolé U=0.20 (18cm isol. + 15cm brique)',      u: 0.20, mass: 8 },
  wall_wood_light: { label: 'Mur ossature bois U=0.18 (léger)',                      u: 0.18, mass: 3 },
  wall_old_heavy:  { label: 'Mur ancien non isolé U=1.10 (lourd)',                   u: 1.10, mass: 12 },
  slab_heavy_ext:  { label: 'Dalle/Toiture béton isolée U=0.18 (lourd)',             u: 0.18, mass: 28 },
  slab_heavy_int:  { label: 'Immeuble : dalle lourde intérieure (lourd)',            u: 1.40, mass: 28 },
  roof_sia_light:  { label: 'Toiture isolée légère / combles U=0.20',                u: 0.20, mass: 4 },
  floor_ground:    { label: 'Plancher lourd sur sol U=0.20',                         u: 0.20, mass: 28 },
  custom:          { label: 'Valeur U personnalisée',                                u: 0.20, mass: 8 }
};

export const BOX3D_WINDOW_PRESETS = {
  none:        { label: 'Aucune ouverture',                               w: 0,   h: 0,   qty: 0, uWin: 1.0, gVit: 0.55, gStore: 0.12 },
  triple_2x19: { label: 'Triple-vitrage 2×1.9 m² (U=1.0, g=0.55)',        w: 1.9, h: 1.0, qty: 2, uWin: 1.0, gVit: 0.55, gStore: 0.10 },
  win_std:     { label: 'Fenêtre standard 1.4×1.4 m (U=1.0, g=0.55)',     w: 1.4, h: 1.4, qty: 1, uWin: 1.0, gVit: 0.55, gStore: 0.12 },
  bay_3x22:    { label: 'Baie vitrée 3.0×2.2 m (U=0.8, g=0.55)',          w: 3.0, h: 2.2, qty: 1, uWin: 0.8, gVit: 0.55, gStore: 0.10 },
  velux:       { label: 'Fenêtre de toit 1.0×1.2 m (U=1.1, g=0.55)',      w: 1.0, h: 1.2, qty: 1, uWin: 1.1, gVit: 0.55, gStore: 0.15 },
  custom:      { label: 'Personnalisé (L × H × Qté)',                     w: 1.6, h: 1.5, qty: 1, uWin: 1.0, gVit: 0.55, gStore: 0.12 }
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
