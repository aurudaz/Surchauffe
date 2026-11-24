/**
 * @fileoverview Étape 05 — Solveur horaire dynamique 5R1C (ISO 13790:2008 Annexe C / SIA 2044)
 * avec sous-pas de 15 minutes (4 sous-pas/h), couplage thermique des dalles inter-étages
 * et calcul de la puissance/besoin de refroidissement fictif pour 0 h de surchauffe.
 */

import { getSIA180Limits } from '../standards/sia180.js';
import { SIA380_CATEGORIES } from '../standards/sia380-1.js';
import {
  buildFloorThermalParams,
  computeHourlyInternalGainsBreakdown,
  computeHourlySolarGains
} from './03-envelope-and-gains.js';
import {
  computeBuildingStackSpan,
  computeFloorNightFlowM3h
} from './04-natural-ventilation.js';

/**
 * Un pas de temps Crank-Nicolson du réseau 5R1C (ISO 13790 Annexe C).
 *
 * Nœuds :
 *  - θ_m   : masse thermique (capacité C_m)
 *  - θ_s   : surfaces intérieures (couplage convectif/radiatif H_is, H_ms et vitrage H_tr,w)
 *  - θ_air : air intérieur (ventilation H_ve + apports convectifs Φ_ia)
 *  - θ_op  = 0.30 · θ_air + 0.70 · θ_s
 *
 * @param {object} fp Paramètres thermiques d'étage issus de `buildFloorThermalParams`
 * @param {number} TmVal Température du nœud masse au début du sous-pas [°C]
 * @param {number} P_int Apports internes totaux [W]
 * @param {number} P_sol Apports solaires transmis totaux [W]
 * @param {number} H_ve Conductance de ventilation totale [W/K]
 * @param {number} Te Température extérieure [°C]
 * @param {number} slabQ Flux échangé avec les dalles adjacentes [W]
 * @param {number} dt Durée du sous-pas [s] (900 s pour 4 sous-pas/h)
 * @param {number} [coolW=0] Puissance de refroidissement convectif fictive [W]
 */
export function step5R1C(fp, TmVal, P_int, P_sol, H_ve, Te, slabQ, dt, coolW = 0) {
  const Phi_ia = 0.5 * P_int - coolW;
  const Phi_m = (fp.A_m / fp.A_tot) * (0.5 * P_int + P_sol) + slabQ;
  const Phi_st =
    Math.max(0, 1 - fp.A_m / fp.A_tot - fp.H_tr_w / (9.1 * fp.A_tot)) * (0.5 * P_int + P_sol);

  const H_tr_1 = H_ve > 1e-6 ? 1 / (1 / H_ve + 1 / fp.H_is) : 0;
  const H_tr_2 = H_tr_1 + fp.H_tr_w;
  const H_tr_3 = H_tr_2 > 1e-9 ? 1 / (1 / H_tr_2 + 1 / fp.H_ms) : 0;
  const ratio32 = H_tr_2 > 1e-9 ? H_tr_3 / H_tr_2 : 0;

  const convTerm = (fp.H_is / (H_ve + fp.H_is)) * Phi_ia + H_tr_1 * Te;
  const Phi_mtot =
    Phi_m + fp.H_tr_em * Te + ratio32 * (Phi_st + fp.H_tr_w * Te + convTerm);
  const H_tot = H_tr_3 + fp.H_tr_em;

  const capOverDt = fp.C_m / dt;
  const TmNext = (TmVal * (capOverDt - 0.5 * H_tot) + Phi_mtot) / (capOverDt + 0.5 * H_tot);
  const TmAvg = 0.5 * (TmVal + TmNext);

  const denomTs = fp.H_ms + fp.H_tr_w + H_tr_1;
  const Ts = denomTs > 1e-9 ? (fp.H_ms * TmAvg + Phi_st + fp.H_tr_w * Te + convTerm) / denomTs : TmAvg;

  const denomAir = fp.H_is + H_ve;
  const Tair = denomAir > 1e-9 ? (fp.H_is * Ts + H_ve * Te + Phi_ia) / denomAir : Ts;

  return {
    TmNext,
    TmAvg,
    Ts,
    Tair,
    Top: 0.3 * Tair + 0.7 * Ts
  };
}

/**
 * Calcule la série de moyennes glissantes extérieures journalières :
 *  - EN 16798-1 : moyenne pondérée exponentiellement θ_rm (α = 0.8) sur les jours précédents
 *  - ASHRAE 55  : moyenne glissante sur 7 jours θ_pma
 */
export function computeDailyRunningMeans(weatherData) {
  const numDays = Math.max(1, Math.ceil(weatherData.length / 24));
  const dailyMeans = [];
  for (let d = 0; d < numDays; d++) {
    const start = d * 24;
    const end = Math.min(weatherData.length, start + 24);
    let sum = 0;
    for (let i = start; i < end; i++) sum += weatherData[i].Te;
    dailyMeans.push(sum / Math.max(1, end - start));
  }

  // Initialisation cyclique sur les derniers jours pour éviter tout transitoire au jour 1
  const alpha = 0.8;
  let tRmExp = dailyMeans[numDays - 1];
  for (let d = Math.max(0, numDays - 14); d < numDays; d++) {
    tRmExp = (1 - alpha) * dailyMeans[d] + alpha * tRmExp;
  }

  const en16798TrmByDay = new Array(numDays);
  const ashraePmaByDay = new Array(numDays);

  for (let d = 0; d < numDays; d++) {
    const prevDay = dailyMeans[(d - 1 + numDays) % numDays];
    tRmExp = (1 - alpha) * prevDay + alpha * tRmExp;
    en16798TrmByDay[d] = tRmExp;

    let sum7 = 0;
    for (let k = 1; k <= 7; k++) {
      sum7 += dailyMeans[(d - k + numDays) % numDays];
    }
    ashraePmaByDay[d] = sum7 / 7;
  }

  return { dailyMeans, en16798TrmByDay, ashraePmaByDay };
}

/**
 * Exécute la simulation annuelle 5R1C complète sur tous les étages du projet.
 *
 * @param {object} projObj Objet projet complet
 * @param {Array<object>} weatherData Série horaire météo (générée ou importée)
 * @param {boolean} [recordSeries=true] Enregistrer les séries 8760h (false pour variantes rapides)
 * @param {boolean} [withCoolingPass=true] Calculer la passe parallèle de froid fictif
 */
export function executeEngine(projObj, weatherData, recordSeries = true, withCoolingPass = true) {
  const N = weatherData.length;
  const subSteps = 4;
  const dt = 3600 / subSteps;

  const sortedFloors = [...projObj.floors].sort((a, b) => a.elevationZ - b.elevationZ);
  const F = sortedFloors.length;
  const buildingStackSpan = computeBuildingStackSpan(projObj);

  const floorParams = sortedFloors.map(fl =>
    buildFloorThermalParams(
      fl,
      projObj.openings.filter(o => o.floorId === fl.id)
    )
  );

  const slabCond = new Array(Math.max(0, F - 1)).fill(0);
  if (projObj.stackCoupling) {
    for (let k = 0; k < F - 1; k++) {
      slabCond[k] =
        Math.min(sortedFloors[k].area, sortedFloors[k + 1].area) *
        ((sortedFloors[k].uSlabInter + sortedFloors[k + 1].uSlabInter) * 0.5);
    }
  }

  const { en16798TrmByDay, ashraePmaByDay } = computeDailyRunningMeans(weatherData);

  let Tm = sortedFloors.map(() => 21.0);
  let TairPrev = sortedFloors.map(() => 21.0);
  let TmCool = sortedFloors.map(() => 21.0);
  let TairCoolPrev = sortedFloors.map(() => 21.0);

  const runPass = (hoursArr, record) => {
    const series = record && recordSeries ? sortedFloors.map(() => []) : null;
    const stats = sortedFloors.map(() => ({
      minTop: 999,
      minTopHour: 0,
      maxTop: -999,
      maxTopHour: 0,
      summerMinTop: 999,
      summerMaxTop: -999,
      overSIA: 0,
      dhSIA: 0,
      over26: 0,
      overMinergie265: 0,
      over265All: 0,
      dhMinergie265: 0,
      over28: 0,
      occH: 0,
      summerHours: 0,
      totalHours: 0,
      maxCoolW: 0,
      maxCoolHour: 0,
      coolKWh: 0,
      coolHours: 0,
      coolMonthlyKWh: new Array(12).fill(0),
      bal: {
        sol: 0,
        solUnshaded: 0,
        solSavedByBlinds: 0,
        int: 0,
        intPeople: 0,
        intLight: 0,
        intEquip: 0,
        trIn: 0,
        trOut: 0,
        slabIn: 0,
        slabOut: 0,
        slabNet: 0,
        veDayOut: 0,
        veNightOut: 0
      },
      annInt: { peopleKWh: 0, lightKWh: 0, equipKWh: 0, totalKWh: 0 },
      peakW: {
        people: 0,
        light: 0,
        equip: 0,
        int: 0,
        sol: 0,
        solUnshaded: 0,
        solSaved: 0,
        trIn: 0,
        trOut: 0,
        slabIn: 0,
        veDayOut: 0,
        veNightOut: 0,
        totalGain: 0
      },
      solIrrBelow200KWh: 0,
      solIrrAbove200KWh: 0,
      solByOrient: { N: 0, NE: 0, E: 0, SE: 0, S: 0, SO: 0, O: 0, NO: 0, R: 0 },
      solOrientStats: {}
    }));

    // Pré-amorçage circulaire sur les dernières 48 heures pour θ_rm,48h sans transitoire
    const buf48 = [];
    let sum48 = 0;
    const seedLen = Math.min(48, weatherData.length);
    for (let j = weatherData.length - seedLen; j < weatherData.length; j++) {
      const te = weatherData[j].Te;
      buf48.push(te);
      sum48 += te;
    }

    for (let i = 0; i < hoursArr.length; i++) {
      const hr = hoursArr[i];
      buf48.push(hr.Te);
      sum48 += hr.Te;
      if (buf48.length > 48) sum48 -= buf48.shift();

      const tRm48 = sum48 / buf48.length;
      const lim = getSIA180Limits(tRm48, projObj.siaCurveMode);
      const dow = Math.floor(hr.h / 24) % 7;
      const dayIdx = Math.min(en16798TrmByDay.length - 1, Math.floor(hr.h / 24));
      const isSummer = hr.d >= 120 && hr.d <= 273; // 1er mai – 30 septembre

      const acc = sortedFloors.map(() => ({
        op: 0,
        air: 0,
        ts: 0,
        sol: 0,
        solUnshaded: 0,
        solBelow200: 0,
        solAbove200: 0,
        int: 0,
        people: 0,
        light: 0,
        equip: 0,
        tr: 0,
        slab: 0,
        veDay: 0,
        veNight: 0,
        cool: 0,
        isOcc: false
      }));

      for (let s = 0; s < subSteps; s++) {
        const slabFlux = new Array(F).fill(0);
        const slabFluxC = new Array(F).fill(0);
        for (let k = 0; k < F - 1; k++) {
          const q = slabCond[k] * (Tm[k + 1] - Tm[k]);
          slabFlux[k] += q;
          slabFlux[k + 1] -= q;
          if (withCoolingPass) {
            const qc = slabCond[k] * (TmCool[k + 1] - TmCool[k]);
            slabFluxC[k] += qc;
            slabFluxC[k + 1] -= qc;
          }
        }

        for (let k = 0; k < F; k++) {
          const fp = floorParams[k];
          const fl = fp.fl;
          const isOccDay = dow < fl.occDays;
          const isOcc = isOccDay && hr.hod >= fl.occStart && hr.hod < fl.occEnd;
          const isNight =
            fl.nightStart === fl.nightEnd || (fl.nightStart === 0 && fl.nightEnd === 24)
              ? true
              : fl.nightStart > fl.nightEnd
                ? hr.hod >= fl.nightStart || hr.hod < fl.nightEnd
                : hr.hod >= fl.nightStart && hr.hod < fl.nightEnd;
          if (s === 0) acc[k].isOcc = isOcc;

          const intBreakdown = computeHourlyInternalGainsBreakdown(fl, isOcc, hr.hod, isOccDay);
          const P_int = intBreakdown.total;
          const solRes = computeHourlySolarGains(
            fp.ops,
            hr,
            TairPrev[k],
            tRm48,
            isOcc,
            projObj.albedo ?? 0.20,
            projObj.horizonDeg ?? 0,
            projObj.useFresnelIncidence !== false
          );
          const P_sol = solRes.totalW;

          if (record && isSummer) {
            for (const [orient, valW] of Object.entries(solRes.byOrientW)) {
              stats[k].solByOrient[orient] =
                (stats[k].solByOrient[orient] || 0) + valW / subSteps / 1000;
              if (!stats[k].solOrientStats[orient]) {
                stats[k].solOrientStats[orient] = {
                  energyKWh: 0,
                  unshadedKWh: 0,
                  peakW: 0,
                  peakIrrWm2: 0,
                  hoursOver200: 0
                };
              }
              const os = stats[k].solOrientStats[orient];
              os.energyKWh += valW / subSteps / 1000;
              os.unshadedKWh += (solRes.byOrientUnshadedW[orient] || 0) / subSteps / 1000;
              if (valW > os.peakW) os.peakW = valW;
              const irrVal = solRes.byOrientIrrWm2[orient] || 0;
              if (irrVal > os.peakIrrWm2) os.peakIrrWm2 = irrVal;
              if (s === 0 && irrVal >= 200) os.hoursOver200++;
            }
          }

          // Ventilation hygiénique (avec bypass estival automatique du récupérateur si θ_i > 22 °C et θ_e < θ_i)
          // + infiltration d'enveloppe (jamais soumise à récupération de chaleur)
          const qHyg_m3h = isOcc ? fl.qHygSpec * fl.area : 0;
          const qInf_m3h = fl.achInfil * fp.vol;
          const etaEff = TairPrev[k] > 22.0 && hr.Te < TairPrev[k] ? 0 : (fl.etaWRG || 0);
          const H_ve_day = 0.335 * (qHyg_m3h * (1 - etaEff) + qInf_m3h);

          const canNightCool =
            isNight &&
            TairPrev[k] > fl.nightTargetTi &&
            TairPrev[k] - hr.Te >= fl.nightMinDT;
          const qNight_m3h = canNightCool
            ? computeFloorNightFlowM3h(
                fp,
                TairPrev[k],
                hr.Te,
                buildingStackSpan,
                projObj.stackCoupling
              )
            : 0;
          const H_ve_night = 0.335 * qNight_m3h;
          const H_ve = H_ve_day + H_ve_night;

          // Maintien hivernal SIA 380/1 / SIA 2044 (par défaut θ_i de la catégorie SIA, ex. 20 °C)
          const heatSetpoint =
            fl.heatSetpoint ?? SIA380_CATEGORIES[fl.siaCategory]?.ti ?? 20.0;
          let out = step5R1C(fp, Tm[k], P_int, P_sol, H_ve, hr.Te, slabFlux[k], dt, 0);
          if (out.Top < heatSetpoint) {
            const h1 = step5R1C(fp, Tm[k], P_int, P_sol, H_ve, hr.Te, slabFlux[k], dt, -1000);
            const sensH = h1.Top - out.Top;
            if (sensH > 1e-6) {
              const heatW = 1000 * ((heatSetpoint - out.Top) / sensH);
              out = step5R1C(fp, Tm[k], P_int, P_sol, H_ve, hr.Te, slabFlux[k], dt, -heatW);
            }
          }
          Tm[k] = out.TmNext;
          TairPrev[k] = out.Tair;

          acc[k].op += out.Top;
          acc[k].air += out.Tair;
          acc[k].ts += out.Ts;
          acc[k].sol += P_sol;
          acc[k].solUnshaded += solRes.unshadedW;
          acc[k].solBelow200 += solRes.irrBelow200SolW;
          acc[k].solAbove200 += solRes.irrAbove200SolW;
          acc[k].int += P_int;
          acc[k].people += intBreakdown.people;
          acc[k].light += intBreakdown.lighting;
          acc[k].equip += intBreakdown.appliances;
          acc[k].tr += fp.H_tr_w * (hr.Te - out.Ts) + fp.H_tr_em * (hr.Te - out.TmAvg);
          acc[k].slab += slabFlux[k];
          acc[k].veDay += H_ve_day * (hr.Te - out.Tair);
          acc[k].veNight += H_ve_night * (hr.Te - out.Tair);

          if (withCoolingPass) {
            const coolSetpoint =
              projObj.projectType === 'minergie' ? Math.min(lim.upper, 26.5) : lim.upper;
            const canNightC =
              isNight &&
              TairCoolPrev[k] > fl.nightTargetTi &&
              TairCoolPrev[k] - hr.Te >= fl.nightMinDT;
            const qNC = canNightC
              ? computeFloorNightFlowM3h(
                  fp,
                  TairCoolPrev[k],
                  hr.Te,
                  buildingStackSpan,
                  projObj.stackCoupling
                )
              : 0;
            const H_veC = H_ve_day + 0.335 * qNC;
            const c0 = step5R1C(fp, TmCool[k], P_int, P_sol, H_veC, hr.Te, slabFluxC[k], dt, 0);
            if (isOcc && c0.Top > coolSetpoint) {
              const c1 = step5R1C(
                fp,
                TmCool[k],
                P_int,
                P_sol,
                H_veC,
                hr.Te,
                slabFluxC[k],
                dt,
                1000
              );
              const sens = c0.Top - c1.Top;
              const coolW = sens > 1e-6 ? 1000 * ((c0.Top - coolSetpoint) / sens) : 0;
              const cFin = step5R1C(
                fp,
                TmCool[k],
                P_int,
                P_sol,
                H_veC,
                hr.Te,
                slabFluxC[k],
                dt,
                coolW
              );
              TmCool[k] = cFin.TmNext;
              TairCoolPrev[k] = cFin.Tair;
              acc[k].cool += coolW;
              if (record) {
                if (coolW > stats[k].maxCoolW) {
                  stats[k].maxCoolW = coolW;
                  stats[k].maxCoolHour = hr.h;
                }
                const stepKWh = coolW / subSteps / 1000;
                stats[k].coolKWh += stepKWh;
                const mIdx = Math.min(11, Math.max(0, Math.floor((hr.d * 12) / 365)));
                stats[k].coolMonthlyKWh[mIdx] += stepKWh;
              }
            } else if (c0.Top < heatSetpoint) {
              const h1C = step5R1C(fp, TmCool[k], P_int, P_sol, H_veC, hr.Te, slabFluxC[k], dt, -1000);
              const sensHC = h1C.Top - c0.Top;
              const heatWC = sensHC > 1e-6 ? 1000 * ((heatSetpoint - c0.Top) / sensHC) : 0;
              const hFinC = step5R1C(fp, TmCool[k], P_int, P_sol, H_veC, hr.Te, slabFluxC[k], dt, -heatWC);
              TmCool[k] = hFinC.TmNext;
              TairCoolPrev[k] = hFinC.Tair;
            } else {
              TmCool[k] = c0.TmNext;
              TairCoolPrev[k] = c0.Tair;
            }
          }
        }
      }

      if (record) {
        for (let k = 0; k < F; k++) {
          const Top = acc[k].op / subSteps;
          const Tair = acc[k].air / subSteps;
          const Ts = acc[k].ts / subSteps;
          const st = stats[k];
          const isOver = acc[k].isOcc && Top > lim.upper;

          st.totalHours++;
          if (Top < st.minTop) {
            st.minTop = Top;
            st.minTopHour = hr.h;
          }
          if (Top > st.maxTop) {
            st.maxTop = Top;
            st.maxTopHour = hr.h;
          }
          if (isSummer) {
            st.summerHours++;
            if (Top < st.summerMinTop) st.summerMinTop = Top;
            if (Top > st.summerMaxTop) st.summerMaxTop = Top;
          }
          if (acc[k].isOcc) {
            st.occH++;
            if (Top > 26.5) {
              st.overMinergie265++;
              st.dhMinergie265 += Top - 26.5;
            }
            if (Top > 28.0) st.over28++;
          }
          if (Top > 26.5) st.over265All++;
          if (isOver) {
            st.overSIA++;
            st.dhSIA += Top - lim.upper;
          }
          if (Top > 26.0) st.over26++;

          const qSol = acc[k].sol / subSteps;
          const qSolUnshaded = acc[k].solUnshaded / subSteps;
          const qSolSaved = Math.max(0, qSolUnshaded - qSol);
          const qSolBelow200 = acc[k].solBelow200 / subSteps;
          const qSolAbove200 = acc[k].solAbove200 / subSteps;
          const qInt = acc[k].int / subSteps;
          const qPeople = acc[k].people / subSteps;
          const qLight = acc[k].light / subSteps;
          const qEquip = acc[k].equip / subSteps;
          const qTr = acc[k].tr / subSteps;
          const qSlab = acc[k].slab / subSteps;
          const qVD = acc[k].veDay / subSteps;
          const qVN = acc[k].veNight / subSteps;
          const qCool = acc[k].cool / subSteps;
          if (qCool > 1.0) st.coolHours++;

          st.annInt.peopleKWh += qPeople / 1000;
          st.annInt.lightKWh += qLight / 1000;
          st.annInt.equipKWh += qEquip / 1000;
          st.annInt.totalKWh += qInt / 1000;

          if (isSummer) {
            if (qPeople > st.peakW.people) st.peakW.people = qPeople;
            if (qLight > st.peakW.light) st.peakW.light = qLight;
            if (qEquip > st.peakW.equip) st.peakW.equip = qEquip;
            if (qInt > st.peakW.int) st.peakW.int = qInt;
            if (qSol > st.peakW.sol) st.peakW.sol = qSol;
            if (qSolUnshaded > st.peakW.solUnshaded) st.peakW.solUnshaded = qSolUnshaded;
            if (qSolSaved > st.peakW.solSaved) st.peakW.solSaved = qSolSaved;
            if (qTr > st.peakW.trIn) st.peakW.trIn = qTr;
            if (-qTr > st.peakW.trOut) st.peakW.trOut = -qTr;
            if (qSlab > st.peakW.slabIn) st.peakW.slabIn = qSlab;
            if (-qVD > st.peakW.veDayOut) st.peakW.veDayOut = -qVD;
            if (-qVN > st.peakW.veNightOut) st.peakW.veNightOut = -qVN;
            const instTotalGain = qInt + qSol + Math.max(0, qTr) + Math.max(0, qSlab);
            if (instTotalGain > st.peakW.totalGain) st.peakW.totalGain = instTotalGain;

            st.bal.sol += qSol / 1000;
            st.bal.solUnshaded += qSolUnshaded / 1000;
            st.bal.solSavedByBlinds += qSolSaved / 1000;
            st.solIrrBelow200KWh += qSolBelow200 / 1000;
            st.solIrrAbove200KWh += qSolAbove200 / 1000;
            st.bal.int += qInt / 1000;
            st.bal.intPeople += qPeople / 1000;
            st.bal.intLight += qLight / 1000;
            st.bal.intEquip += qEquip / 1000;
            if (qTr >= 0) st.bal.trIn += qTr / 1000;
            else st.bal.trOut += -qTr / 1000;
            if (qSlab >= 0) st.bal.slabIn += qSlab / 1000;
            else st.bal.slabOut += -qSlab / 1000;
            st.bal.slabNet += qSlab / 1000;
            st.bal.veDayOut += -qVD / 1000;
            st.bal.veNightOut += -qVN / 1000;
          }

          if (series) {
            series[k].push({
              h: hr.h,
              d: hr.d,
              hod: hr.hod,
              Te: hr.Te,
              tRm48,
              tRmEN: en16798TrmByDay[dayIdx],
              tPmaASHRAE: ashraePmaByDay[dayIdx],
              limUpper: lim.upper,
              limLower: lim.lower,
              Top,
              Tair,
              Ts,
              isOccHour: acc[k].isOcc,
              isOverSIA: isOver,
              isSummer,
              qSol,
              qSolUnshaded,
              qInt,
              qPeople,
              qLight,
              qEquip,
              qTr,
              qSlab,
              qVeDay: qVD,
              qVeNight: qVN,
              qCool
            });
          }
        }
      }
    }
    return { series, stats };
  };

  // Pré-chauffe de 15 jours (360 h) pour stabiliser les masses thermiques
  runPass(weatherData.slice(0, Math.min(360, N)), false);
  const resPass = runPass(weatherData, true);

  let minTe = 999;
  let maxTe = -999;
  let tropicalNights = 0;
  for (let d = 0; d < Math.floor(N / 24); d++) {
    let minT = 999;
    for (let hh = 0; hh < 24; hh++) {
      minT = Math.min(minT, weatherData[d * 24 + hh].Te);
    }
    if (minT >= 20) tropicalNights++;
  }
  for (const hr of weatherData) {
    if (hr.Te < minTe) minTe = hr.Te;
    if (hr.Te > maxTe) maxTe = hr.Te;
  }

  const floorRaw = floorParams.map((fp, k) => {
    const fl = fp.fl;
    const st = resPass.stats[k];
    const nomNightM3h = computeFloorNightFlowM3h(
      fp,
      26,
      18,
      buildingStackSpan,
      projObj.stackCoupling
    );
    const nomNightSpec = nomNightM3h / Math.max(1, fl.area);

    const avgGtot =
      fp.winArea > 0
        ? fp.ops.reduce((s, o) => {
            const g =
              o.blindMode === 'always_up'
                ? o.gVit
                : o.gtotMode === 'product'
                  ? o.gVit * o.gStore
                  : o.gStore;
            return s + g * o.width * o.height * o.qty;
          }, 0) / fp.winArea
        : 0.1;

    const area = Math.max(1, fl.area);
    const numDays = Math.max(1, st.totalHours / 24);
    const summerH = Math.max(1, st.summerHours);
    const summerDays = Math.max(1, summerH / 24);
    const totalSummerGainsKWh = Math.max(
      0.001,
      st.bal.sol + st.bal.int + st.bal.trIn + st.bal.slabIn
    );

    const mkGain = (peakW, summerKWh, annKWh = null) => ({
      peakW,
      peakWm2: peakW / area,
      summerMeanW: (summerKWh * 1000) / summerH,
      dailyWhm2d: annKWh !== null ? (annKWh * 1000) / (numDays * area) : (summerKWh * 1000) / (summerDays * area),
      summerKWh,
      summerKWhm2: summerKWh / area,
      sharePct: (summerKWh / totalSummerGainsKWh) * 100
    });

    const gains = {
      people: mkGain(st.peakW.people, st.bal.intPeople, st.annInt.peopleKWh),
      lighting: mkGain(st.peakW.light, st.bal.intLight, st.annInt.lightKWh),
      appliances: mkGain(st.peakW.equip, st.bal.intEquip, st.annInt.equipKWh),
      internalTotal: mkGain(st.peakW.int, st.bal.int, st.annInt.totalKWh),
      solarTransmitted: mkGain(st.peakW.sol, st.bal.sol),
      solarUnshaded: mkGain(st.peakW.solUnshaded, st.bal.solUnshaded),
      solarBlockedByBlinds: mkGain(st.peakW.solSaved, st.bal.solSavedByBlinds),
      conductionIn: mkGain(st.peakW.trIn, st.bal.trIn),
      conductionOut: mkGain(st.peakW.trOut, st.bal.trOut),
      slabIn: mkGain(st.peakW.slabIn, st.bal.slabIn),
      ventDayOut: mkGain(st.peakW.veDayOut, st.bal.veDayOut),
      ventNightOut: mkGain(st.peakW.veNightOut, st.bal.veNightOut),
      totalGainPeakW: st.peakW.totalGain,
      totalGainPeakWm2: st.peakW.totalGain / area,
      totalGainSummerKWh: totalSummerGainsKWh,
      totalGainSummerKWhm2: totalSummerGainsKWh / area,
      totalGainSummerMeanW: (totalSummerGainsKWh * 1000) / summerH
    };

    return {
      floor: fl,
      fp,
      series: resPass.series ? resPass.series[k] : null,
      minTop: st.minTop,
      minTopHour: st.minTopHour,
      maxTop: st.maxTop,
      maxTopHour: st.maxTopHour,
      summerMinTop: st.summerMinTop < 900 ? st.summerMinTop : st.minTop,
      summerMaxTop: st.summerMaxTop > -900 ? st.summerMaxTop : st.maxTop,
      overSIA: st.overSIA,
      dhSIA: st.dhSIA,
      over26: st.over26,
      overMinergie265: st.overMinergie265,
      over265All: st.over265All,
      dhMinergie265: st.dhMinergie265,
      over28: st.over28,
      occH: st.occH,
      maxCoolW: st.maxCoolW,
      maxCoolWm2: st.maxCoolW / area,
      maxCoolHour: st.maxCoolHour,
      coolKWh: st.coolKWh,
      coolKWhm2: st.coolKWh / area,
      coolHours: st.coolHours,
      coolMonthlyKWh: st.coolMonthlyKWh,
      summerBal: st.bal,
      gains,
      solIrrBelow200KWh: st.solIrrBelow200KWh,
      solIrrAbove200KWh: st.solIrrAbove200KWh,
      solByOrient: st.solByOrient,
      solOrientStats: st.solOrientStats,
      nomNightM3h,
      nomNightSpec,
      avgGtot,
      buildingStackSpan
    };
  });

  return { minTe, maxTe, tropicalNights, buildingStackSpan, floorRaw };
}
