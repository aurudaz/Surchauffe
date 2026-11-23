/**
 * @fileoverview Étape 03 — Enveloppe thermique 5R1C (ISO 13790 §7.2.2 / Annex C),
 * apports internes (SIA 380/1) et apports solaires avec régulation automatique des stores.
 */

import { ENVELOPE_STANDARDS, ORIENTATIONS } from '../standards/sia380-1.js';
import { getSia2024HourlyMultipliers } from '../standards/sia2024-profiles.js';
import {
  BOX3D_CONTACTS,
  BOX3D_WALL_PRESETS,
  BOX3D_WINDOW_PRESETS,
  getWallOrientations
} from '../standards/box3d-presets.js';
import { glazingIncidenceModifier, incidentIrradiance } from './01-solar-geometry.js';

/**
 * Calcule automatiquement les surfaces opaques et valeurs U d'un étage en Mode Simple.
 */
export function computeAutoEnvelopeFromFloor(fl) {
  const ep = ENVELOPE_STANDARDS[fl.envelopeStd] || ENVELOPE_STANDARDS.sia_new;
  const sideWallGross = 4 * Math.sqrt(Math.max(4, fl.area)) * fl.height;
  fl.uWallExt = ep.uWall;
  fl.uRoofExt = ep.uRoof;
  fl.uFloorGround = ep.uFloor;

  if (fl.simplePos === 'ground') {
    fl.wallExtArea = Math.round(sideWallGross * 0.85 * 10) / 10;
    fl.roofExtArea = 0;
    fl.floorGroundArea = fl.area;
    fl.bFloorGround = 0.3;
  } else if (fl.simplePos === 'mid') {
    fl.wallExtArea = Math.round(sideWallGross * 0.85 * 10) / 10;
    fl.roofExtArea = 0;
    fl.floorGroundArea = 0;
    fl.bFloorGround = 0.0;
  } else if (fl.simplePos === 'top' || fl.simplePos === 'attic') {
    fl.wallExtArea = Math.round(sideWallGross * (fl.simplePos === 'attic' ? 0.45 : 0.85) * 10) / 10;
    fl.roofExtArea = fl.area;
    fl.floorGroundArea = 0;
    fl.bFloorGround = 0.0;
  } else {
    fl.wallExtArea = Math.round(sideWallGross * 0.85 * 10) / 10;
    fl.roofExtArea = fl.area;
    fl.floorGroundArea = fl.area;
    fl.bFloorGround = 0.3;
  }
}

/**
 * Initialise la structure 3D « Paroi par paroi » (6 faces) d'un étage à partir de ses
 * dimensions et ouvertures existantes si `fl.box3d` n'est pas encore défini.
 */
export function ensureBox3dDefaults(fl, floorOpenings = []) {
  if (fl.box3d && fl.box3d.walls) return fl.box3d;

  const side = Math.round(Math.sqrt(Math.max(4, fl.area)) * 10) / 10;
  const dimX = side;
  const dimY = Math.max(1.5, Math.round((fl.area / side) * 10) / 10);
  const frontOrient = 'S';
  const orients = getWallOrientations(frontOrient);

  const matchOp = orientList => {
    const found = floorOpenings.find(o => orientList.includes(o.orient));
    if (!found) {
      return {
        winPreset: 'none',
        winW: 1.4,
        winH: 1.4,
        winQty: 0,
        uWin: 1.0,
        gVit: 0.55,
        gStore: 0.12,
        blindMode: 'auto',
        overhang: 0
      };
    }
    return {
      winPreset: 'custom',
      winW: found.width,
      winH: found.height,
      winQty: found.qty,
      uWin: found.uWin,
      gVit: found.gVit,
      gStore: found.gStore,
      blindMode: found.blindMode || 'auto',
      overhang: found.overhangDepth || 0
    };
  };

  const mkWall = (contact, preset, opObj) => {
    const wp = BOX3D_WALL_PRESETS[preset] || BOX3D_WALL_PRESETS.wall_sia_heavy;
    return {
      contact,
      preset,
      u: wp.u,
      ...opObj
    };
  };

  const pos = fl.simplePos || 'standalone';
  const ceilContact = pos === 'top' || pos === 'attic' || pos === 'standalone' ? 'ext_sun' : 'adiabatic';
  const ceilPreset = ceilContact === 'adiabatic' ? 'slab_heavy_int' : pos === 'attic' ? 'roof_sia_light' : 'slab_heavy_ext';
  const floorContact = pos === 'ground' || pos === 'standalone' ? 'ground' : 'adiabatic';
  const floorPreset = floorContact === 'adiabatic' ? 'slab_heavy_int' : 'floor_ground';

  fl.box3d = {
    dimX,
    dimY,
    frontOrient,
    walls: {
      front: mkWall('ext_sun', 'wall_sia_heavy', matchOp([orients.front, 'SE', 'SO'])),
      back: mkWall('ext_sun', 'wall_sia_heavy', matchOp([orients.back, 'NE', 'NO'])),
      right: mkWall('ext_sun', 'wall_sia_heavy', matchOp([orients.right])),
      left: mkWall('ext_sun', 'wall_sia_heavy', matchOp([orients.left])),
      ceiling: mkWall(ceilContact, ceilPreset, matchOp(['R'])),
      floor: mkWall(floorContact, floorPreset, { winPreset: 'none', winW: 0, winH: 0, winQty: 0 })
    }
  };
  return fl.box3d;
}

/**
 * Convertit la configuration 3D « Paroi par paroi » (6 faces) d'un étage en
 * paramètres thermiques 5R1C (`wallExtArea`, `uWallExt`, `cSpec`, etc.) et
 * met à jour les ouvertures correspondantes dans `project.openings`.
 */
export function applyBox3dToFloor(fl, project) {
  const b3 = ensureBox3dDefaults(fl, project.openings.filter(o => o.floorId === fl.id));
  const dx = Math.max(1.0, Number(b3.dimX) || 4.0);
  const dy = Math.max(1.0, Number(b3.dimY) || 5.0);
  const dz = Math.max(1.8, Number(fl.height) || 2.5);

  fl.area = Math.round(dx * dy * 100) / 100;
  fl.depthBehindWin = Math.round(dy * 100) / 100;

  const orients = getWallOrientations(b3.frontOrient || 'S');
  const grossAreas = {
    front: dx * dz,
    back: dx * dz,
    right: dy * dz,
    left: dy * dz,
    ceiling: dx * dy,
    floor: dx * dy
  };

  let sumVertAreaEff = 0;
  let sumVertUA = 0;
  let roofArea = 0;
  let roofUA = 0;
  let groundArea = 0;
  let groundUA = 0;
  let groundB = 0.3;
  // Capacité thermique effective ISO 13786 : Σ (A_paroi · κ_paroi) + mobilier (~8 Wh/(m²·K))
  let totalCapWhK = 8.0 * fl.area;

  const prevOps = project.openings.filter(o => o.floorId === fl.id);
  const defaultBlindThreshI = b3.blindThreshI ?? prevOps[0]?.blindThreshI ?? 200;
  const defaultBlindThreshT = b3.blindThreshT ?? prevOps[0]?.blindThreshT ?? 22.0;
  const defaultBlindRule = b3.blindRule ?? prevOps[0]?.blindRule ?? 'irr_and_temp';
  const defaultFrameFactor = b3.frameFactor ?? prevOps[0]?.frameFactor ?? 0.78;
  const defaultShadingFactor = b3.shadingFactor ?? prevOps[0]?.shadingFactor ?? 1.0;

  const newOpenings = [];

  for (const [faceKey, w] of Object.entries(b3.walls)) {
    const contact = BOX3D_CONTACTS[w.contact] || BOX3D_CONTACTS.ext_sun;
    const preset = BOX3D_WALL_PRESETS[w.preset] || BOX3D_WALL_PRESETS.wall_sia_heavy;
    const uVal = w.preset === 'custom' ? Math.max(0.05, Number(w.u) || 0.2) : preset.u;

    let winArea = 0;
    if (faceKey !== 'floor' && w.winPreset && w.winPreset !== 'none') {
      const wp = BOX3D_WINDOW_PRESETS[w.winPreset];
      const ww = w.winPreset === 'custom' ? Math.max(0.2, Number(w.winW) || 1.4) : wp.w;
      const wh = w.winPreset === 'custom' ? Math.max(0.2, Number(w.winH) || 1.4) : wp.h;
      const wq = w.winPreset === 'custom' ? Math.max(0, Math.round(Number(w.winQty) || 0)) : wp.qty;

      if (wq > 0 && ww > 0 && wh > 0) {
        winArea = Math.min(grossAreas[faceKey] * 0.95, ww * wh * wq);
        const orient = orients[faceKey] || 'S';
        const faceLabel = {
          front: 'Mur Devant',
          back: 'Mur Fond',
          right: 'Mur Droit',
          left: 'Mur Gauche',
          ceiling: 'Plafond (Toit)'
        }[faceKey];

        newOpenings.push({
          id: `b3_${fl.id}_${faceKey}`,
          floorId: fl.id,
          name: `${faceLabel} (${orient})`,
          orient,
          width: Math.round(ww * 100) / 100,
          height: Math.round(wh * 100) / 100,
          qty: wq,
          uWin: Number(w.uWin) || wp.uWin || 1.0,
          gVit: Number(w.gVit) || wp.gVit || 0.55,
          gStore: Number(w.gStore) ?? wp.gStore ?? 0.12,
          gtotMode: 'product',
          overhangDepth: faceKey === 'ceiling' ? 0 : Math.max(0, Number(w.overhang) || 0),
          frameFactor: w.frameFactor ?? defaultFrameFactor,
          shadingFactor: w.shadingFactor ?? defaultShadingFactor,
          blindMode: w.blindMode || 'auto',
          blindThreshI: w.blindThreshI ?? defaultBlindThreshI,
          blindThreshT: w.blindThreshT ?? defaultBlindThreshT,
          blindRule: w.blindRule ?? defaultBlindRule,
          windSafe: true,
          operable: true,
          openWidth: Math.min(ww, 1.0),
          openHeight: Math.min(wh, 1.4),
          openType: 'imposte',
          alphaDeg: 20,
          cd: 0.6,
          sillHeight: faceKey === 'ceiling' ? 1.4 : wh > 1.8 ? 0.05 : 0.9
        });
      }
    }

    const netOpaque = Math.max(0, grossAreas[faceKey] - winArea);
    // Contribution physique ISO 13786 : surface opaque interne × capacité surfacique périodique κ [Wh/(m²·K)]
    const kappa = preset.kappa ?? preset.mass ?? 30;
    totalCapWhK += netOpaque * kappa;

    if (contact.b > 0 && netOpaque > 0) {
      if (faceKey === 'ceiling') {
        roofArea += netOpaque * contact.b;
        roofUA += netOpaque * uVal * contact.b;
      } else if (faceKey === 'floor') {
        groundArea += netOpaque;
        groundUA += netOpaque * uVal;
        groundB = contact.b;
      } else {
        sumVertAreaEff += netOpaque * contact.b;
        sumVertUA += netOpaque * uVal * contact.b;
      }
    }
  }

  fl.wallExtArea = Math.round(sumVertAreaEff * 10) / 10;
  fl.uWallExt = sumVertAreaEff > 0.01 ? Math.round((sumVertUA / sumVertAreaEff) * 1000) / 1000 : 0.2;
  fl.roofExtArea = Math.round(roofArea * 10) / 10;
  fl.uRoofExt = roofArea > 0.01 ? Math.round((roofUA / roofArea) * 1000) / 1000 : 0.2;
  fl.floorGroundArea = Math.round(groundArea * 10) / 10;
  fl.bFloorGround = groundArea > 0.01 ? groundB : 0.0;
  fl.uFloorGround = groundArea > 0.01 ? Math.round((groundUA / groundArea) * 1000) / 1000 : 0.2;

  const autoCSpec = Math.round(Math.max(15, Math.min(220, totalCapWhK / Math.max(1, fl.area))));
  b3.autoCSpec = autoCSpec;
  if (!b3.manualCSpec) {
    fl.cSpec = autoCSpec;
  }
  fl.inertiaClass = 'custom';

  project.openings = project.openings.filter(o => o.floorId !== fl.id).concat(newOpenings);
}

/**
 * Prépare les conductances et la capacité thermique 5R1C d'un étage (ISO 13790:2008 Annexe C).
 *
 *   H_tr,w  = Σ (A_win · U_win)                          [W/K]
 *   H_tr,op = A_mur·U_mur + A_toit·U_toit + A_sol·U_sol·b + Ψ  [W/K]
 *   A_tot   = max(4.5·A_f, 2·A_f + A_mur + A_toit + A_win)      [m²]
 *   A_m     = min(0.85·A_tot, f_m · A_f)                        [m²]  (f_m ∈ {2.5, 3.0, 3.5})
 *   H_is    = 3.45 · A_tot                                      [W/K]
 *   H_ms    = 9.10 · A_m                                        [W/K]
 *   H_tr,em = 1 / max(1e-4, 1/H_tr,op − 1/H_ms)                 [W/K]
 *   C_m     = C_spec · A_f · 3600                               [J/K]
 *
 * @param {object} fl Données d'étage
 * @param {Array<object>} ops Ouvertures appartenant à cet étage
 */
export function buildFloorThermalParams(fl, ops) {
  const winArea = ops.reduce((s, o) => s + o.width * o.height * o.qty, 0);
  const H_tr_w = ops.reduce((s, o) => s + o.width * o.height * o.qty * o.uWin, 0);
  const H_tr_op =
    fl.wallExtArea * fl.uWallExt +
    fl.roofExtArea * fl.uRoofExt +
    fl.floorGroundArea * fl.uFloorGround * fl.bFloorGround +
    (fl.psiTotal || 0);

  const A_tot = Math.max(4.5 * fl.area, 2 * fl.area + fl.wallExtArea + fl.roofExtArea + winArea);
  const f_m = fl.cSpec <= 55 ? 2.5 : fl.cSpec <= 85 ? 3.0 : 3.5;
  const A_m = Math.min(0.85 * A_tot, f_m * fl.area);

  const H_is = 3.45 * A_tot;
  const H_ms = 9.1 * A_m;
  const H_tr_em = H_tr_op <= 1e-4 ? 0 : 1 / Math.max(1e-4, 1 / H_tr_op - 1 / H_ms);
  const C_m = Math.max(5, fl.cSpec) * fl.area * 3600;
  const vol = fl.area * fl.height;
  const tauHours = C_m / (3600 * Math.max(1e-3, H_tr_op + H_tr_w));

  return {
    fl,
    ops,
    winArea,
    H_tr_w,
    H_tr_op,
    A_tot,
    A_m,
    H_is,
    H_ms,
    H_tr_em,
    C_m,
    vol,
    tauHours
  };
}

/**
 * Calcule le détail horaire des gains internes [W] d'un étage pour une heure donnée :
 *  - people : chaleur métabolique des occupants (avec facteur de présence effectif tp / plage)
 *  - lighting : éclairage / lampes
 *  - appliances : appareils & équipements
 *
 * Supporte deux modes :
 *  - 'sia2024' : modulation horaire 24 h SIA 2024:2015 conservatrice d'énergie journalière
 *  - 'constant' (ou hod === null) : palier constant sur la plage [occStart, occEnd]
 */
export function computeHourlyInternalGainsBreakdown(fl, isOcc, hod = null, isOccDay = true) {
  const gf = (fl.gainFactorPct ?? 100) / 100;
  const presenceFactor = fl.occPresenceFactor ?? 1.0;
  const standbyFrac = (fl.standbyPct ?? 0) / 100;

  const peopleBase = fl.occCount * fl.occWatt * presenceFactor * gf;
  const lightBase = fl.lightWm2 * fl.area * gf;
  const equipBase = fl.equipWatt * gf;

  if (fl.internalProfileMode === 'sia2024' && hod !== null) {
    const occHoursPerDay = Math.max(1, (fl.occEnd ?? 24) - (fl.occStart ?? 0));
    const mult = getSia2024HourlyMultipliers(
      fl.siaCategory,
      fl.spaceType || 'residential',
      hod,
      isOccDay,
      occHoursPerDay,
      standbyFrac
    );
    const people = peopleBase * mult.people;
    const lighting = lightBase * mult.lighting;
    const appliances = equipBase * mult.appliances;
    return {
      people,
      lighting,
      appliances,
      total: people + lighting + appliances
    };
  }

  const people = isOcc ? peopleBase : 0;
  const lighting = isOcc ? lightBase : lightBase * standbyFrac;
  const appliances = isOcc ? equipBase : equipBase * standbyFrac;

  return {
    people,
    lighting,
    appliances,
    total: people + lighting + appliances
  };
}

/**
 * Calcule les gains internes instantanés P_int [W] d'un étage pour une heure donnée.
 * Intègre le facteur de présence effectif (tp / durée d'occupation) afin de respecter
 * la charge journalière SIA 380/1 lorsque la plage horaire est 0h–24h (logement).
 */
export function computeHourlyInternalGains(fl, isOcc, hod = null, isOccDay = true) {
  return computeHourlyInternalGainsBreakdown(fl, isOcc, hod, isOccDay).total;
}

/**
 * Calcule les apports solaires transmis P_sol [W], les apports hors stores (bruts) et
 * les apports ventilés par orientation. Intègre la correction d'angle d'incidence Fresnel /
 * Karlsson-Roos sur le rayonnement direct et diffus (ISO 52016 / bSol Pro).
 */
export function computeHourlySolarGains(
  ops,
  hourWeather,
  tAirPrev,
  tRm48,
  isOcc,
  albedo = 0.20,
  horizonDeg = 0,
  useFresnel = true
) {
  let totalW = 0;
  let unshadedW = 0;
  let irrBelow200SolW = 0;
  let irrAbove200SolW = 0;
  const byOrientW = {};
  const byOrientUnshadedW = {};
  const byOrientIrrWm2 = {};

  for (const op of ops) {
    const g = ORIENTATIONS[op.orient] || ORIENTATIONS.S;
    const irrObj = incidentIrradiance(
      hourWeather.Igh,
      hourWeather.Ibn,
      hourWeather.Idh,
      hourWeather.sun,
      g.az,
      g.tilt,
      op.overhangDepth || 0,
      op.height,
      albedo,
      {
        horizonDeg: op.horizonDeg ?? horizonDeg,
        leftFinDepth: op.leftFinDepth || 0,
        leftFinDist: op.leftFinDist || 0,
        rightFinDepth: op.rightFinDepth || 0,
        rightFinDist: op.rightFinDist || 0,
        winWidth: op.width
      }
    );
    const irr = irrObj.total;
    // Capteur solaire en façade (non masqué par la casquette locale de la fenêtre, conforme SIA 380/2 / IDA ICE / bSol)
    const irrSensor = irrObj.totalUnshaded ?? irr;

    const threshI = op.blindThreshI ?? 200;
    const threshT = op.blindThreshT ?? 22.0;
    const blindRule = op.blindRule || 'irr_and_temp';

    let trig = false;
    if (blindRule === 'irr_or_temp') {
      // Mode bSol Pro : baisse si I ≥ seuil (hors chauffage) OU θ_i ≥ seuil (avec soleil > 50 W/m²)
      trig = (irrSensor >= threshI && (tAirPrev >= 21.0 || tRm48 >= 12.0)) || (tAirPrev >= threshT && irrSensor > 50);
    } else if (blindRule === 'irr_only') {
      // Capteur pyranomètre seul (avec garde hivernale θ_i ≥ 21.5 °C ou θ_rm,48 ≥ 12 °C)
      trig = irrSensor >= threshI && (tAirPrev >= 21.5 || tRm48 >= 12.0);
    } else {
      // Standard SIA 380/2 / Lesosai / IDA ICE : baisse si I ≥ seuil ET θ_i ≥ seuil
      trig = irrSensor >= threshI && tAirPrev >= threshT;
    }

    let closed = false;
    if (op.blindMode === 'always_down') closed = true;
    else if (op.blindMode === 'auto') closed = trig;
    else if (op.blindMode === 'manual_day') closed = isOcc && trig;

    const gVitEff = op.gVit * op.frameFactor * op.shadingFactor;
    const gEff = closed
      ? op.gtotMode === 'product'
        ? gVitEff * op.gStore
        : op.gStore * op.frameFactor * op.shadingFactor
      : gVitEff;

    const winArea = op.width * op.height * op.qty;
    let opSol;
    let opSolUnshaded;
    if (useFresnel) {
      const { kDir, kDiff } = glazingIncidenceModifier(irrObj.cosTheta ?? 0, op.uWin ?? 1.0);
      // Vitrage nu : direct corrigé par Fresnel K_dir(θ_i), diffus/réfléchi corrigé par K_diff
      const irrEffOpen = irrObj.direct * kDir + irrObj.diffRefl * kDiff;
      // Store extérieur baissé : le store diffuse partiellement le rayonnement incident avant le vitrage
      const irrEffClosed = closed ? irrObj.total * kDiff : irrEffOpen;
      opSol = winArea * gEff * irrEffClosed;
      opSolUnshaded = winArea * gVitEff * irrEffOpen;
    } else {
      opSol = winArea * gEff * irr;
      opSolUnshaded = winArea * gVitEff * irr;
    }

    totalW += opSol;
    unshadedW += opSolUnshaded;
    if (irrSensor >= 200) irrAbove200SolW += opSol;
    else irrBelow200SolW += opSol;

    byOrientW[op.orient] = (byOrientW[op.orient] || 0) + opSol;
    byOrientUnshadedW[op.orient] = (byOrientUnshadedW[op.orient] || 0) + opSolUnshaded;
    if (irrSensor > (byOrientIrrWm2[op.orient] || 0)) byOrientIrrWm2[op.orient] = irrSensor;
  }

  return {
    totalW,
    unshadedW,
    shadedSavedW: Math.max(0, unshadedW - totalW),
    irrBelow200SolW,
    irrAbove200SolW,
    byOrientW,
    byOrientUnshadedW,
    byOrientIrrWm2
  };
}
