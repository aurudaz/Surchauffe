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
  albedo = 0.20
) {
  if (sun.cosZ <= 0.01) {
    return { total: 0, direct: 0, diffRefl: 0, shadedFrac: 0 };
  }

  const beta = surfTiltDeg * DEG_TO_RAD;
  const cosGamma = Math.cos((sun.azDeg - surfAzDeg) * DEG_TO_RAD);
  const cosTheta = sun.cosZ * Math.cos(beta) + sun.sinZ * Math.sin(beta) * cosGamma;

  let direct = Ibn * Math.max(0, cosTheta);
  let shadedFrac = 0;

  // Ombre portée géométrique sur fenêtre verticale : h_ombre = D · tan(alt) / cos(γ_s − γ_p)
  if (overhangDepth > 0 && surfTiltDeg > 45 && direct > 0 && cosGamma > 0.05) {
    const tanAlt = sun.cosZ / Math.max(0.02, sun.sinZ);
    const shadowH = overhangDepth * (tanAlt / cosGamma);
    shadedFrac = Math.min(1.0, Math.max(0.0, shadowH / Math.max(0.3, winHeight)));
    direct *= 1.0 - shadedFrac;
  }

  const diffRefl =
    Idh * ((1 + Math.cos(beta)) / 2) +
    albedo * Igh * ((1 - Math.cos(beta)) / 2);

  return {
    total: Math.max(0, direct + diffRefl),
    direct: Math.max(0, direct),
    diffRefl: Math.max(0, diffRefl),
    shadedFrac
  };
}

/**
 * Décompose une irradiance globale horizontale Igh en composantes directe normale (Ibn)
 * et diffuse horizontale (Idh) via une corrélation sur l'indice de clarté k_t.
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
  const Idh = Igh * Math.min(1.0, Math.max(0.15, 1.15 - 1.15 * kt));
  return {
    Ibn: Math.max(0, (Igh - Idh) / sun.cosZ),
    Idh
  };
}
