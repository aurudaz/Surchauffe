/**
 * @fileoverview Bibliothèque de bâtiments types SIA pré-configurés et normalisation des étages.
 */

import { deriveSiaInternalDefaults } from '../standards/sia380-1.js';
import {
  applyBox3dToFloor,
  computeAutoEnvelopeFromFloor
} from '../methodology/03-envelope-and-gains.js';

/**
 * Complète les champs manquants d'un étage importé (rétrocompatibilité JSON / BIM).
 */
export function ensureFloorDefaults(fl, idx = 0, total = 1) {
  if (fl.simplePos === undefined) {
    fl.simplePos =
      total === 1 ? 'standalone' : idx === 0 ? 'ground' : idx === total - 1 ? 'top' : 'mid';
  }
  if (fl.envelopeStd === undefined) fl.envelopeStd = 'sia_new';
  if (fl.gainFactorPct === undefined) fl.gainFactorPct = 100;
  if (fl.occPresenceFactor === undefined) {
    fl.occPresenceFactor = fl.spaceType === 'residential' ? 0.5 : 1.0;
  }
  if (fl.nightSimpleBasis === undefined) fl.nightSimpleBasis = 'floor_pct';
  if (fl.nightSimplePct === undefined) fl.nightSimplePct = 5.0;
  if (fl.nightSimpleEff === undefined) fl.nightSimpleEff = 1.0;
  if (fl.nightSimpleCross === undefined) fl.nightSimpleCross = false;
  if (fl.nightVentMode === undefined) fl.nightVentMode = 'simple_pct';
  if (fl.uSlabInter === undefined) fl.uSlabInter = 1.4;
  if (fl.psiTotal === undefined) fl.psiTotal = Math.round((fl.area || 50) * 0.03 * 10) / 10;
  if (fl.depthBehindWin === undefined) {
    fl.depthBehindWin = Math.max(3.8, Math.round(Math.sqrt(fl.area || 50) * 0.55 * 10) / 10);
  }
}

function makeFloor(
  id,
  name,
  z,
  area,
  h,
  pos,
  cat,
  cSpec,
  uStd = 'sia_new',
  nightPct = 5.0,
  nightCross = false
) {
  const sia = deriveSiaInternalDefaults(cat, area);
  const fl = {
    id,
    name,
    elevationZ: z,
    area,
    height: h,
    depthBehindWin: Math.max(3.8, Math.round(Math.sqrt(area) * 0.55 * 10) / 10),
    simplePos: pos,
    envelopeStd: uStd,
    siaCategory: cat,
    spaceType: sia.spaceType,
    inertiaClass: String(cSpec),
    cSpec,
    gainFactorPct: 100,
    wallExtArea: 0,
    uWallExt: 0.2,
    roofExtArea: 0,
    uRoofExt: 0.2,
    floorGroundArea: 0,
    bFloorGround: 0.3,
    uFloorGround: 0.2,
    uSlabInter: 1.4,
    psiTotal: Math.round(area * 0.03 * 10) / 10,
    occCount: sia.occCount,
    occWatt: sia.occWatt,
    occPresenceFactor: sia.presenceFactor,
    lightWm2: sia.lightWm2,
    equipWatt: sia.equipWatt,
    occStart: sia.occStart,
    occEnd: sia.occEnd,
    occDays: sia.occDays,
    standbyPct: sia.standbyPct,
    qHygSpec: sia.qHygSpec,
    achInfil: 0.1,
    etaWRG: 0.0,
    nightVentMode: 'simple_pct',
    nightSimpleBasis: 'floor_pct',
    nightSimplePct: nightPct,
    nightSimpleEff: 1.0,
    nightSimpleCross: nightCross,
    nightVentFixedVal: 10.0,
    nightStart: 21,
    nightEnd: 7,
    nightTargetTi: 21.0,
    nightMinDT: 1.0
  };
  computeAutoEnvelopeFromFloor(fl);
  return fl;
}

export function makeOpening(
  id,
  floorId,
  name,
  orient,
  width,
  height,
  qty,
  uWin,
  gVit,
  gStore,
  overhang = 0.0,
  openType = 'imposte',
  sill = 0.9,
  operable = true
) {
  return {
    id,
    floorId,
    name,
    orient,
    width,
    height,
    qty,
    uWin,
    gVit,
    gStore,
    gtotMode: 'product',
    overhangDepth: overhang,
    frameFactor: 0.78,
    shadingFactor: 0.95,
    blindMode: 'auto',
    blindThreshI: 150,
    blindThreshT: 23.0,
    windSafe: true,
    operable,
    openWidth: Math.min(width, 1.0),
    openHeight: Math.min(height, 1.4),
    openType,
    alphaDeg: 20,
    cd: 0.6,
    sillHeight: sill
  };
}

export function createHouseLibrary() {
  return [
    {
      id: 'villa_r1',
      title: 'Villa individuelle R+1 (Minergie)',
      desc: '2 étages (130 m²), 7 ouvertures S/E/O/N, casquette Sud 1.2 m',
      build: () => ({
        name: 'Villa individuelle R+1',
        projectType: 'new',
        siaCurveMode: 'fig3',
        stackCoupling: true,
        climate: { station: 'SIO', scenario: 'REF', lat: 46.22, lon: 7.33, tzMode: 'cet_cest' },
        floors: [
          makeFloor('f1', 'Rez-de-chaussée (Séjour)', 0.0, 65, 2.6, 'ground', 'II', 75, 'minergie', 4.5, true),
          makeFloor('f2', '1er étage (Chambres)', 2.85, 65, 2.5, 'top', 'II', 75, 'minergie', 4.5, true)
        ],
        openings: [
          makeOpening('o1', 'f1', 'Baie Sud séjour', 'S', 3.4, 2.2, 1, 0.75, 0.55, 0.1, 1.2, 'rect', 0.05, true),
          makeOpening('o2', 'f1', 'Fenêtre Ouest terrasse', 'O', 2.0, 2.2, 1, 0.75, 0.55, 0.1, 0.4, 'rect', 0.05, true),
          makeOpening('o3', 'f1', 'Fenêtre Est cuisine', 'E', 1.4, 1.3, 1, 0.75, 0.55, 0.1, 0.0, 'imposte', 1.0, true),
          makeOpening('o4', 'f1', 'Fenêtre Nord entrée', 'N', 1.0, 1.3, 1, 0.75, 0.55, 0.1, 0.0, 'imposte', 1.0, false),
          makeOpening('o5', 'f2', 'Chambre Sud', 'S', 1.4, 1.4, 2, 0.75, 0.55, 0.1, 0.6, 'imposte', 0.9, true),
          makeOpening('o6', 'f2', 'Chambre Ouest', 'O', 1.2, 1.4, 1, 0.75, 0.55, 0.1, 0.0, 'imposte', 0.9, true),
          makeOpening('o7', 'f2', 'Salle de bain Nord', 'N', 0.9, 1.2, 1, 0.75, 0.55, 0.1, 0.0, 'imposte', 1.0, true)
        ]
      })
    },
    {
      id: 'mitoyenne_combles',
      title: 'Maison mitoyenne R+1+Combles',
      desc: '3 niveaux dont combles sous toiture avec fenêtres de toit',
      build: () => ({
        name: 'Maison mitoyenne R+1+Combles',
        projectType: 'residential_400',
        siaCurveMode: 'fig3',
        stackCoupling: true,
        climate: { station: 'SIO', scenario: 'REF', lat: 46.22, lon: 7.33, tzMode: 'cet_cest' },
        floors: [
          makeFloor('f1', 'Rez-de-chaussée', 0.0, 50, 2.55, 'ground', 'II', 75, 'sia_new', 4.0, true),
          makeFloor('f2', '1er étage', 2.8, 50, 2.5, 'mid', 'II', 45, 'sia_new', 4.0, true),
          makeFloor('f3', 'Combles habitables', 5.5, 42, 2.4, 'attic', 'II', 20, 'sia_new', 3.0, false)
        ],
        openings: [
          makeOpening('o1', 'f1', 'Baie Sud jardin', 'S', 3.0, 2.15, 1, 1.0, 0.6, 0.15, 0.8, 'rect', 0.05, true),
          makeOpening('o2', 'f1', 'Fenêtre Nord rue', 'N', 1.2, 1.3, 1, 1.0, 0.6, 0.15, 0.0, 'imposte', 0.95, true),
          makeOpening('o3', 'f2', 'Fenêtres Sud', 'S', 1.3, 1.4, 2, 1.0, 0.6, 0.15, 0.4, 'imposte', 0.9, true),
          makeOpening('o4', 'f2', 'Fenêtres Nord', 'N', 1.2, 1.4, 2, 1.0, 0.6, 0.15, 0.0, 'imposte', 0.9, true),
          makeOpening('o5', 'f3', 'Fenêtre pignon Sud', 'S', 1.2, 1.3, 1, 1.0, 0.6, 0.15, 0.0, 'imposte', 0.9, true),
          makeOpening('o6', 'f3', 'Fenêtres de toit (Velux)', 'R', 0.94, 1.18, 2, 1.1, 0.55, 0.15, 0.0, 'imposte', 1.4, true)
        ]
      })
    },
    {
      id: 'appart_traversant',
      title: 'Appartement traversant (Collectif)',
      desc: '1 niveau 105 m², double orientation Sud + Nord, SIA Cat. I',
      build: () => ({
        name: 'Appartement traversant 4.5 pces',
        projectType: 'residential_400',
        siaCurveMode: 'fig3',
        stackCoupling: false,
        climate: { station: 'GVE', scenario: 'REF', lat: 46.25, lon: 6.13, tzMode: 'cet_cest' },
        floors: [
          makeFloor('f1', 'Appartement (2e étage)', 5.6, 105, 2.55, 'mid', 'I', 75, 'sia_new', 4.0, true)
        ],
        openings: [
          makeOpening('o1', 'f1', 'Baies Sud séjour', 'S', 2.4, 2.2, 2, 0.9, 0.55, 0.1, 1.0, 'cross_rect', 0.05, true),
          makeOpening('o2', 'f1', 'Fenêtre SO chambre', 'SO', 1.4, 1.5, 1, 0.9, 0.55, 0.1, 0.0, 'cross_imposte', 0.9, true),
          makeOpening('o3', 'f1', 'Fenêtres Nord chambres', 'N', 1.3, 1.4, 3, 0.9, 0.55, 0.1, 0.0, 'cross_imposte', 0.9, true)
        ]
      })
    },
    {
      id: 'bureau_r1',
      title: 'Bâtiment de bureaux R+1 (SIA Cat. III)',
      desc: '2 plateaux de 80 m², vitrage Sud/Ouest, occ. jour',
      build: () => ({
        name: 'Bâtiment administratif R+1',
        projectType: 'new',
        siaCurveMode: 'fig3',
        stackCoupling: true,
        climate: { station: 'SIO', scenario: 'REF', lat: 46.22, lon: 7.33, tzMode: 'cet_cest' },
        floors: [
          makeFloor('f1', 'Rez-de-chaussée Bureaux', 0.0, 80, 2.8, 'ground', 'III', 45, 'sia_new', 5.0, false),
          makeFloor('f2', '1er étage Bureaux', 3.1, 80, 2.8, 'top', 'III', 45, 'sia_new', 5.0, false)
        ],
        openings: [
          makeOpening('o1', 'f1', 'Bandeau Sud RDC', 'S', 2.0, 1.9, 3, 1.0, 0.55, 0.12, 0.5, 'imposte', 0.85, true),
          makeOpening('o2', 'f1', 'Bandeau Ouest RDC', 'O', 1.6, 1.9, 2, 1.0, 0.55, 0.12, 0.0, 'imposte', 0.85, true),
          makeOpening('o3', 'f2', 'Bandeau Sud Étage', 'S', 2.0, 1.9, 3, 1.0, 0.55, 0.12, 0.5, 'imposte', 0.85, true),
          makeOpening('o4', 'f2', 'Bandeau Ouest Étage', 'O', 1.6, 1.9, 2, 1.0, 0.55, 0.12, 0.0, 'imposte', 0.85, true),
          makeOpening('o5', 'f2', 'Fenêtres Nord Étage', 'N', 1.5, 1.9, 2, 1.0, 0.55, 0.12, 0.0, 'imposte', 0.85, true)
        ]
      })
    },
    {
      id: 'local_bureau_box3d',
      title: 'Local bureau 4×5×2.5 m (Constructeur 3D)',
      desc: 'Modèle type paroi par paroi : 1 façade Sud vitrée, 5 parois adiabatiques',
      build: () => {
        const fl = makeFloor('f1', 'Bureau exercice 20 m²', 0.0, 20, 2.5, 'mid', 'III', 80, 'sia_new', 0, false);
        fl.occCount = 2;
        fl.occPresenceFactor = 1.0;
        fl.lightWm2 = 2.0;
        fl.equipWatt = 150;
        fl.qHygSpec = 0.75; // ~0.3 ACH sur 50 m³
        fl.nightVentMode = 'none';
        fl.box3d = {
          dimX: 4.0,
          dimY: 5.0,
          frontOrient: 'S',
          walls: {
            front: {
              contact: 'ext_sun',
              preset: 'wall_sia_heavy',
              u: 0.17,
              winPreset: 'triple_2x19',
              winW: 1.9,
              winH: 1.0,
              winQty: 2,
              uWin: 1.0,
              gVit: 0.55,
              gStore: 0.15,
              blindMode: 'auto',
              overhang: 0.0
            },
            back: { contact: 'adiabatic', preset: 'wall_sia_heavy', u: 0.17, winPreset: 'none', winW: 0, winH: 0, winQty: 0 },
            right: { contact: 'adiabatic', preset: 'wall_sia_heavy', u: 0.17, winPreset: 'none', winW: 0, winH: 0, winQty: 0 },
            left: { contact: 'adiabatic', preset: 'wall_sia_heavy', u: 0.17, winPreset: 'none', winW: 0, winH: 0, winQty: 0 },
            ceiling: { contact: 'adiabatic', preset: 'slab_heavy_int', u: 1.4, winPreset: 'none', winW: 0, winH: 0, winQty: 0 },
            floor: { contact: 'adiabatic', preset: 'slab_heavy_int', u: 1.4, winPreset: 'none', winW: 0, winH: 0, winQty: 0 }
          }
        };
        const proj = {
          name: 'Exercice surchauffe bureau (4×5×2.5 m)',
          projectType: 'new',
          siaCurveMode: 'fig3',
          stackCoupling: false,
          albedo: 0.15,
          climate: { station: 'GVE', scenario: 'REF', lat: 46.25, lon: 6.13, tzMode: 'cet_cest' },
          floors: [fl],
          openings: []
        };
        applyBox3dToFloor(fl, proj);
        return proj;
      }
    }
  ];
}
