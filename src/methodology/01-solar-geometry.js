/**
 * @fileoverview Étape 01 — Géométrie solaire, séparation du rayonnement global (Igh → Ibn, Idh)
 * et calcul de l'irradiance incidente sur paroi avec masquage géométrique par casquette horizontale.
 *
 * Références : Duffie & Beckman (Solar Engineering of Thermal Processes), SIA 2028 / ISO 52010.
 */

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Calcule la position du soleil (angle zénithal et azimut depuis le Nord).
 * Azimut : 0° = Nord, 90° = Est, 180° = Sud, 270° = Ouest.
 *
 * @param {number} dayOfYear Jour de l'année [1..365]
 * @param {number} hourOfDay Heure solaire locale (ex: 12.5 pour le milieu de l'heure 12h–13h)
 * @param {number} latDeg Latitude [°N]
 * @param {number} lonDeg Longitude [°E]
 * @param {number} [tzHours=1] Décalage horaire standard du fuseau par rapport à UTC (CET = 1)
 * @returns {{ cosZ: number, sinZ: number, azDeg: number, altDeg: number }}
 */
export function solarPosition(dayOfYear, hourOfDay, latDeg, lonDeg, tzHours = 1) {
  const B = ((2 * Math.PI) / 365) * (dayOfYear - 81);
  const eqT = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // [min]
  const solarTimeH = hourOfDay + (4 * (lonDeg - 15 * tzHours) + eqT) / 60;
  const omega = 15 * (solarTimeH - 12) * DEG_TO_RAD;

  const decl = 23.45 * DEG_TO_RAD * Math.sin(((2 * Math.PI) / 365) * (284 + dayOfYear));
  const lat = latDeg * DEG_TO_RAD;

  const cosZ = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(omega);
  const sinZ = Math.sqrt(Math.max(0, 1 - cosZ * cosZ));
  const altDeg = Math.asin(Math.max(-1, Math.min(1, cosZ))) * RAD_TO_DEG;

  let azDeg = 180;
  if (sinZ > 1e-5) {
    const denom = Math.cos(lat) * sinZ;
    const ratio = denom > 1e-6 ? (Math.sin(decl) - Math.sin(lat) * cosZ) / denom : 0;
    let azN = Math.acos(Math.max(-1, Math.min(1, ratio))) * RAD_TO_DEG;
    if (omega > 0) azN = 360 - azN;
    azDeg = azN;
  }

  return { cosZ, sinZ, azDeg, altDeg };
}

/**
 * Calcule l'irradiance solaire incidente sur une surface inclinée [W/m²],
 * incluant l'ombre portée d'une casquette horizontale au-dessus du linteau.
 *
 * Modèle isotrope (Liu & Jordan) pour le diffus et albédo sol ρ = 0.20 :
 *   I_inc = I_bn · max(0, cos θ_i) · (1 − f_ombre) + I_dh · (1 + cos β)/2 + 0.20 · I_gh · (1 − cos β)/2
 *
 * @param {number} Igh Irradiance globale horizontale [W/m²]
 * @param {number} Ibn Irradiance directe normale [W/m²]
 * @param {number} Idh Irradiance diffuse horizontale [W/m²]
 * @param {{ cosZ: number, sinZ: number, azDeg: number }} sun Position solaire
 * @param {number} surfAzDeg Azimut de la paroi [° depuis Nord]
 * @param {number} surfTiltDeg Inclinaison de la paroi (90° = vertical, 0° = horizontal)
 * @param {number} [overhangDepth=0] Profondeur de la casquette / avant-toit [m]
 * @param {number} [winHeight=1.5] Hauteur de la fenêtre sous casquette [m]
 * @param {number} [albedo=0.20] Albédo du sol environnant [-]
 * @param {{ horizonDeg?: number, leftFinDepth?: number, leftFinDist?: number, rightFinDepth?: number, rightFinDist?: number, winWidth?: number }} [shadingOpts={}] Ombrages proches & horizon (EN 13790 / Minergie)
 * @returns {{ total: number, direct: number, diffRefl: number, shadedFrac: number }}
 */
export function incidentIrradiance(
  Igh,
  Ibn,
  Idh,
  sun,
  surfAzDeg,
  surfTiltDeg,
  overhangDepth = 0,
  winHeight = 1.5,
  albedo = 0.20,
  shadingOpts = {}
) {
  if (sun.cosZ <= 0.01) {
    return { total: 0, totalUnshaded: 0, direct: 0, diffRefl: 0, shadedFrac: 0, cosTheta: 0 };
  }

  const horizonDeg = Math.max(0, Math.min(60, Number(shadingOpts.horizonDeg) || 0));
  const beta = surfTiltDeg * DEG_TO_RAD;
  const relAzDeg = ((sun.azDeg - surfAzDeg + 540) % 360) - 180;
  const relAzRad = relAzDeg * DEG_TO_RAD;
  const cosGamma = Math.cos(relAzRad);
  const cosTheta = sun.cosZ * Math.cos(beta) + sun.sinZ * Math.sin(beta) * cosGamma;

  const altDeg = sun.altDeg ?? Math.asin(Math.max(-1, Math.min(1, sun.cosZ))) * RAD_TO_DEG;
  const directUnshaded = altDeg <= horizonDeg ? 0 : Ibn * Math.max(0, cosTheta);
  let direct = directUnshaded;
  let shadedFracH = 0;
  let shadedFracW = 0;

  // Ombre portée géométrique sur fenêtre verticale : casquette + écrans latéraux (EN 13790)
  if (surfTiltDeg > 45 && direct > 0 && cosGamma > 0.05) {
    if (overhangDepth > 0) {
      const tanAlt = sun.cosZ / Math.max(0.02, sun.sinZ);
      const shadowH = overhangDepth * (tanAlt / cosGamma);
      shadedFracH = Math.min(1.0, Math.max(0.0, shadowH / Math.max(0.3, winHeight)));
    }
    const winW = Math.max(0.3, Number(shadingOpts.winWidth) || 1.4);
    const leftD = Math.max(0, Number(shadingOpts.leftFinDepth) || 0);
    const rightD = Math.max(0, Number(shadingOpts.rightFinDepth) || 0);
    if (relAzDeg < 0 && leftD > 0) {
      const shadowW = leftD * Math.abs(Math.tan(relAzRad)) - Math.max(0, Number(shadingOpts.leftFinDist) || 0);
      shadedFracW = Math.min(1.0, Math.max(0.0, shadowW / winW));
    } else if (relAzDeg > 0 && rightD > 0) {
      const shadowW = rightD * Math.abs(Math.tan(relAzRad)) - Math.max(0, Number(shadingOpts.rightFinDist) || 0);
      shadedFracW = Math.min(1.0, Math.max(0.0, shadowW / winW));
    }
    const sunlitFrac = (1.0 - shadedFracH) * (1.0 - shadedFracW);
    direct *= sunlitFrac;
  }

  const shadedFrac = 1.0 - (1.0 - shadedFracH) * (1.0 - shadedFracW);
  const skyHorFactor = horizonDeg > 0 ? Math.max(0.5, 1.0 - 0.35 * Math.sin(horizonDeg * DEG_TO_RAD)) : 1.0;

  // Modèle anisotrope de Hay & Davies (ISO 52010 / bSol / TRNSYS) :
  // sépare le diffus en composante circumsolaire (indice d'anisotropie A_i) et dôme isotrope
  const Ai = Math.min(0.85, Math.max(0, Ibn / 1361));
  const rb = Math.max(0, cosTheta) / Math.max(0.087, sun.cosZ);
  const diffCircumsolarBase = altDeg <= horizonDeg ? 0 : Idh * Ai * rb;
  const diffCircumsolar = diffCircumsolarBase * (1.0 - shadedFrac);
  const diffIso = Idh * (1.0 - Ai) * ((1 + Math.cos(beta)) / 2) * skyHorFactor;
  const reflGround = albedo * Igh * ((1 - Math.cos(beta)) / 2);
  const diffRefl = diffCircumsolar + diffIso + reflGround;
  const totalUnshaded = Math.max(0, directUnshaded + diffCircumsolarBase + diffIso + reflGround);

  return {
    total: Math.max(0, direct + diffRefl),
    totalUnshaded,
    direct: Math.max(0, direct),
    diffRefl: Math.max(0, diffRefl),
    shadedFrac,
    cosTheta: Math.max(0, cosTheta)
  };
}

/**
 * Facteur angulaire d'incidence de Fresnel / Karlsson & Roos (2000) / ISO 52016
 * sur le facteur solaire g_vit du vitrage :
 *   K_dir(θ_i) = max(0, 1 − tan^a(θ_i / 2))
 * avec a = 3.0 (triple vitrage U ≤ 0.95), a = 3.5 (double vitrage U ≤ 2.2), a = 4.2 (simple vitrage),
 * et facteur hémisphérique diffus K_diff ∈ {0.88, 0.90, 0.92}.
 *
 * En été sur façade Sud (soleil haut θ_i ≈ 65–75°), K_dir chute à ~0.55–0.72,
 * reproduisant fidèlement la réflexion optique de Fresnel des logiciels dynamiques (bSol / IDA ICE).
 *
 * @param {number} cosTheta Cosinus de l'angle d'incidence sur la paroi [0..1]
 * @param {number} [uWin=1.0] Coefficient U de la fenêtre (identifie simple/double/triple vitrage)
 * @returns {{ kDir: number, kDiff: number, thetaDeg: number }}
 */
export function glazingIncidenceModifier(cosTheta, uWin = 1.0) {
  const isTriple = uWin <= 0.95;
  const isDouble = !isTriple && uWin <= 2.2;
  const a = isTriple ? 3.0 : isDouble ? 3.5 : 4.2;
  const kDiff = isTriple ? 0.88 : isDouble ? 0.90 : 0.92;

  const ct = Math.max(0, Math.min(1, cosTheta));
  if (ct <= 1e-4) return { kDir: 0, kDiff, thetaDeg: 90 };

  const thetaRad = Math.acos(ct);
  const tanHalf = Math.tan(thetaRad * 0.5);
  const kDir = Math.max(0, Math.min(1, 1.0 - Math.pow(tanHalf, a)));
  return { kDir, kDiff, thetaDeg: thetaRad * RAD_TO_DEG };
}

/**
 * Fraction diffuse horizontale k_d = I_dh / I_gh selon la corrélation de référence
 * d'Erbs, Klein & Duffie (1982) en fonction de l'indice de clarté k_t.
 *
 * @param {number} kt Indice de clarté [-]
 * @returns {number} Fraction diffuse k_d ∈ [0.165, 1.0]
 */
export function erbsDiffuseFraction(kt) {
  const k = Math.max(0, Math.min(1.0, kt));
  if (k <= 0.22) return 1.0 - 0.09 * k;
  if (k <= 0.80) {
    return (
      0.9511 -
      0.1604 * k +
      4.388 * k * k -
      16.638 * k * k * k +
      12.336 * k * k * k * k
    );
  }
  return 0.165;
}

/**
 * Décompose une irradiance globale horizontale Igh en composantes directe normale (Ibn)
 * et diffuse horizontale (Idh) via la corrélation d'Erbs, Klein & Duffie (1982).
 *
 * @param {number} Igh Irradiance globale horizontale [W/m²]
 * @param {{ cosZ: number }} sun Position solaire
 * @param {number} doy Jour de l'année [1..365]
 * @returns {{ Ibn: number, Idh: number }}
 */
export function splitGlobalToComponents(Igh, sun, doy) {
  if (sun.cosZ <= 0.02 || Igh <= 0) return { Ibn: 0, Idh: Math.max(0, Igh) };
  const I0 = 1361 * (1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365));
  const kt = Math.min(1.0, Igh / (I0 * sun.cosZ));
  const Idh = Igh * erbsDiffuseFraction(kt);
  return {
    Ibn: Math.max(0, (Igh - Idh) / sun.cosZ),
    Idh
  };
}
