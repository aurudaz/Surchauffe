/**
 * @fileoverview Gestion de l'interface Résultats unifiée :
 *  - Rapport de synthèse affiché par défaut (lisible en 2 min : verdict, KPIs, courbe interactive 14j/été/année,
 *    paramètres clés, scénarios d'oubli, recommandations)
 *  - 4 tiroirs dépliables à la demande (individuellement ou via « Tout déplier ») :
 *      1. Diagnostic normatif, Scénarios détaillés & Méthodologie
 *      2. Graphiques d'analyse (Évolution SIA 180 avec zones rouges, Domaine adaptatif, Bilan)
 *      3. Apports solaires estivaux par orientation & Puissance détaillée des gains
 *      4. Confort thermique multi-normes (SIA / SECO, OMS, EN 16798-1, ISO 7730 PMV/PPD)
 */

import { applyClimateDelta, generateSyntheticWeather } from '../methodology/02-weather-model.js';
import { executeEngine } from '../methodology/05-thermal-5r1c-engine.js';
import { enrichWithSIA180 } from '../methodology/06-sia180-compliance.js';
import { evaluateThermalComfort } from '../methodology/07-thermal-comfort.js';
import { getSIA180Profile } from '../standards/sia180.js';
import {
  appState,
  escapeHtml,
  getActiveVariant,
  saveWorkspaceToStorage,
  switchVariant,
  syncActiveVariantSnapshot
} from '../state/project-store.js';
import {
  drawAdaptiveComparisonChart,
  drawBalanceChart,
  drawOrientChart,
  drawSIAChart,
  drawSimpleHeatwaveChart,
  drawTimeChart,
  drawVariantsComparisonChart,
  formatDayOfYearFR,
  getChartPalette
} from './charts.js';
import { renderMethodologyPanel } from './methodology-view.js';

let timeChartMeta = null;
let simpleChartMeta = null;
let variantsChartMeta = null;
let lastRenderCtx = null;
const variantSimCache = new Map();
let notifyResultsVariantChange = () => {};

function badge(ok, yesLabel = 'Conforme', noLabel = 'Non conforme', warnMode = false, tip = '') {
  const tipAttr = tip ? ` data-tip="${escapeHtml(tip)}"` : '';
  return `<span class="pill ${ok ? 'ok' : warnMode ? 'warn' : 'ko'}"${tipAttr}>${ok ? yesLabel : noLabel}</span>`;
}

function renderActiveCoolingCard(res, activeFR, project) {
  const ac = activeFR.activeCooling;
  if (!ac) return '';
  if (!ac.needed && project.siaCurveMode !== 'fig4') return '';

  if (!ac.needed) {
    return `
      <div class="card">
        <h3 class="card-title">
          <span data-tip="Énergie frigorifique qui serait nécessaire pour maintenir 0 heure de surchauffe.">Besoins énergétiques de froid actif</span>
          <span class="pill ok">0 kWh/an — 100 % passif</span>
        </h3>
        <div class="cool-alert ok" style="margin-bottom:0;">
          Aucun refroidissement actif requis : le local respecte la limite de confort toute l'année par conception passive uniquement.
        </div>
      </div>
    `;
  }

  const sevCls = ac.level === 'excessive' ? 'ko' : ac.level === 'high' ? 'warn' : 'ok';
  const th = ac.thresholds;
  const eScaleMax = Math.max(th.energyExcessiveKWhm2 * 1.5, ac.coolKWhm2 * 1.12, 15);
  const pScaleMax = Math.max(th.powerExcessiveWm2 * 1.4, ac.maxCoolWm2 * 1.12, 30);

  const eFillPct = Math.min(100, (ac.coolKWhm2 / eScaleMax) * 100);
  const pFillPct = Math.min(100, (ac.maxCoolWm2 / pScaleMax) * 100);
  const eWarnPos = Math.min(95, (th.energyWarnKWhm2 / eScaleMax) * 100);
  const eExcPos = Math.min(95, (th.energyExcessiveKWhm2 / eScaleMax) * 100);
  const pWarnPos = Math.min(95, (th.powerWarnWm2 / pScaleMax) * 100);
  const pExcPos = Math.min(95, (th.powerExcessiveWm2 / pScaleMax) * 100);

  const eCol =
    ac.coolKWhm2 > th.energyExcessiveKWhm2
      ? 'var(--ko)'
      : ac.coolKWhm2 > th.energyWarnKWhm2
        ? 'var(--warn)'
        : 'var(--ok)';
  const pCol =
    ac.maxCoolWm2 > th.powerExcessiveWm2
      ? 'var(--ko)'
      : ac.maxCoolWm2 > th.powerWarnWm2
        ? 'var(--warn)'
        : 'var(--ok)';

  const multiFloor = res.floorResults.length > 1 && res.buildingCooling;
  const buildingSub = multiFloor
    ? `Total bâtiment : ${res.buildingCooling.totalCoolKWh.toFixed(0)} kWh/an (${res.buildingCooling.totalCoolKWhm2.toFixed(1)} kWh/m²)`
    : `${ac.coolKWh.toFixed(0)} kWh utiles/an sur ${activeFR.floor.area.toFixed(0)} m²`;

  const proposalsHtml = ac.proposals.length
    ? `
      <div style="margin-top:4px;">
        <div class="section-eyebrow">Propositions ciblées pour réduire les besoins de froid actif</div>
        <div class="reco-list">
          ${ac.proposals.map(p => `<div class="reco-item">${p}</div>`).join('')}
        </div>
      </div>
    `
    : '';

  return `
    <div class="card" style="${ac.level === 'excessive' ? 'border-color:rgba(242,139,130,0.55);' : ''}">
      <h3 class="card-title">
        <span data-tip="Énergie et puissance frigorifiques nécessaires pour maintenir 0 heure de surchauffe dans le local, comparées aux seuils suisses SIA 180, SIA 382/1, SIA 2024 et MoPEC (EN-102).">Besoins énergétiques de froid actif</span>
        <span class="pill ${sevCls}">${escapeHtml(ac.statusLabel)}</span>
      </h3>

      <div class="cool-alert ${sevCls}">
        <strong>${ac.level === 'excessive' ? '⚠ Alerte surconsommation de froid actif : ' : ac.level === 'high' ? 'Vigilance froid actif : ' : 'Diagnostic froid actif : '}</strong>
        ${escapeHtml(ac.statusSummary)}
      </div>

      <div class="cool-kpi-grid">
        <div class="cool-kpi" data-tip="Besoin annuel d'énergie utile de refroidissement Q_C nécessaire pour supprimer toutes les heures de surchauffe.">
          <div class="cool-kpi-label">Besoin énergétique utile</div>
          <div class="cool-kpi-val" style="color:${eCol}">${ac.coolKWhm2.toFixed(1)} kWh/(m²·an)</div>
          <div class="cool-kpi-sub">${buildingSub}</div>
        </div>
        <div class="cool-kpi" data-tip="Puissance frigorifique maximale instantanée requise lors du pic estival (seuil passif SIA 180 / 382/1 : ≤ 12 W/m²).">
          <div class="cool-kpi-label">Puissance de pointe</div>
          <div class="cool-kpi-val" style="color:${pCol}">${ac.maxCoolWm2.toFixed(1)} W/m²</div>
          <div class="cool-kpi-sub">${(ac.maxCoolW / 1000).toFixed(2)} kW (${ac.maxCoolW.toFixed(0)} W) • Seuil SIA ≤ 12 W/m²</div>
        </div>
        <div class="cool-kpi" data-tip="Nombre d'heures annuelles durant lesquelles le système de refroidissement actif devrait fonctionner, et mois le plus chargé.">
          <div class="cool-kpi-label">Fonctionnement actif</div>
          <div class="cool-kpi-val" style="color:var(--primary)">${ac.coolHours} h/an</div>
          <div class="cool-kpi-sub">Mois pic : ${escapeHtml(ac.peakMonthName)} (${ac.peakMonthKWh.toFixed(0)} kWh)</div>
        </div>
        <div class="cool-kpi" data-tip="Consommation électrique estimée avec une climatisation / PAC froid standard (SEER = 3.5, tarif indicatif 0.30 CHF/kWh), comparée au geocooling passif (SEER ≈ 15).">
          <div class="cool-kpi-label">Électricité estimée (SEER 3.5)</div>
          <div class="cool-kpi-val">${ac.elecPacKWh.toFixed(0)} kWh/an</div>
          <div class="cool-kpi-sub">~${ac.estCostChf.toFixed(0)} CHF/an • Geocooling : ~${ac.elecGeoKWh.toFixed(0)} kWh/an</div>
        </div>
      </div>

      <div class="cool-meters">
        <div class="cool-meter-box" data-tip="Position de votre besoin annuel de froid par rapport aux seuils de référence suisses (${ac.isResidential ? 'logement : vigilance > 3, excessif > 10 kWh/m²·an' : 'tertiaire SIA 2024 : vigilance > 10, excessif > 20 kWh/m²·an'}).">
          <div class="cool-meter-head">
            <strong>Besoin annuel [kWh/(m²·an)]</strong>
            <span style="color:${eCol};font-weight:700;">${ac.coolKWhm2.toFixed(1)} / max ${th.energyExcessiveKWhm2}</span>
          </div>
          <div class="cool-meter-track">
            <div class="cool-meter-fill" style="width:${Math.max(2, eFillPct).toFixed(1)}%;background:${eCol};"></div>
            <div class="cool-meter-tick" style="left:${eWarnPos.toFixed(1)}%;"><span class="cool-meter-tick-lbl">${th.energyWarnKWhm2}</span></div>
            <div class="cool-meter-tick" style="left:${eExcPos.toFixed(1)}%;background:var(--ko);"><span class="cool-meter-tick-lbl" style="color:var(--ko);">Exc. ${th.energyExcessiveKWhm2}</span></div>
          </div>
        </div>
        <div class="cool-meter-box" data-tip="Position de votre puissance frigorifique de pointe par rapport au seuil SIA 180 / 382/1 (12 W/m²) et au seuil excessif (${th.powerExcessiveWm2} W/m²).">
          <div class="cool-meter-head">
            <strong>Puissance de pointe [W/m²]</strong>
            <span style="color:${pCol};font-weight:700;">${ac.maxCoolWm2.toFixed(1)} / seuil SIA 12</span>
          </div>
          <div class="cool-meter-track">
            <div class="cool-meter-fill" style="width:${Math.max(2, pFillPct).toFixed(1)}%;background:${pCol};"></div>
            <div class="cool-meter-tick" style="left:${pWarnPos.toFixed(1)}%;background:var(--ok);"><span class="cool-meter-tick-lbl" style="color:var(--ok);">SIA 12</span></div>
            <div class="cool-meter-tick" style="left:${pExcPos.toFixed(1)}%;background:var(--ko);"><span class="cool-meter-tick-lbl" style="color:var(--ko);">Exc. ${th.powerExcessiveWm2}</span></div>
          </div>
        </div>
      </div>

      ${proposalsHtml}
    </div>
  `;
}

function renderSimpleReport(res, activeFR, project) {
  const m = activeFR.minergie;
  const g = activeFR.gains;
  const prof = getSIA180Profile(project.projectType, project.customReg);
  const isMinergie = project.projectType === 'minergie';
  const isCustom = project.projectType === 'custom';
  const isManual = Boolean(res.isManualDesignDay);
  const d24 = activeFR.day24 || {
    overSIA: activeFR.overSIA,
    overMinergie265: activeFR.overMinergie265,
    minTop: activeFR.minTop,
    minTopHod: 5,
    maxTop: activeFR.summerMaxTop,
    maxTopHod: 16,
    nightOver26H: 0
  };
  const mainHours = isManual
    ? isMinergie
      ? d24.overMinergie265
      : d24.overSIA
    : isMinergie
      ? activeFR.overMinergie265
      : activeFR.overSIA;
  const mainLimit = isMinergie ? 100 : res.limHours;
  const mainPass = isManual ? mainHours === 0 : mainHours <= mainLimit;
  const nightPass = activeFR.nomNightSpec >= 10;
  const peakTempVal = isManual ? d24.maxTop : activeFR.summerMaxTop;

  const verdictStatus = mainPass && (!m || !isMinergie || isManual || m.constructivePass) ? 'ok' : mainPass ? 'warn' : 'ko';
  const verdictTitle = isManual
    ? mainHours === 0
      ? 'Journée type : aucune surchauffe détectée (0 h / 24 h)'
      : `Journée type : surchauffe détectée (${mainHours} h / 24 h)`
    : verdictStatus === 'ok'
      ? 'Protection thermique estivale conforme'
      : verdictStatus === 'warn'
        ? 'Simulation conforme, mais vigilance constructive requise'
        : 'Risque de surchauffe estivale — Mesures nécessaires';

  const floorDisplay = activeFR.floor.name.includes('m²')
    ? escapeHtml(activeFR.floor.name)
    : `${escapeHtml(activeFR.floor.name)} (${activeFR.floor.area.toFixed(0)} m²)`;

  const mainCriterionTxt = isManual
    ? `<strong>${mainHours} h / 24 h</strong> au-dessus du seuil (pic à <strong>${String(d24.maxTopHod).padStart(2, '0')}h00</strong>, min ${d24.minTop.toFixed(1)} °C à ${String(d24.minTopHod).padStart(2, '0')}h00)`
    : isMinergie
      ? `<strong>${activeFR.overMinergie265} h/an &gt; 26.5 °C</strong> (16 avr.–15 oct. • seuil ${escapeHtml(prof.label)} : ≤ 100 h)`
      : isCustom
        ? `<strong>${activeFR.overSIA} h/an</strong> au-dessus de la limite personnalisée (${escapeHtml(prof.shortLabel)})`
        : `<strong>${activeFR.overSIA} h/an</strong> au-dessus de la limite SIA 180 (${project.siaCurveMode === 'fig4' ? 'Fig. 4 VMC' : 'Fig. 3 nat.'} • seuil : ≤ ${mainLimit} h)`;

  document.getElementById('simpleReportTop').innerHTML = `
    <div class="verdict-banner ${verdictStatus}" data-tip="Verdict global de surchauffe pour l'étage analysé selon l'exigence réglementaire sélectionnée (${escapeHtml(prof.label)}).">
      <div>
        <h3 class="verdict-title">${verdictTitle}</h3>
        <p class="verdict-sub">
          ${floorDisplay} : ${mainCriterionTxt} •
          Température maximale : <strong>${peakTempVal.toFixed(1)} °C</strong>.
        </p>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${!isManual && m ? badge(m.constructivePass, `Constructif OK (${m.bilanPct.toFixed(0)} %)`, `Constructif ${m.bilanPct.toFixed(0)} %`, false, 'Bilan journalier constructif Minergie Q_in / Q_max ≤ 100 % (stores, masse thermique C_R/A_SNP et vent SIA 342).') : ''}
        ${!isManual && m && isMinergie ? badge(m.analyticalComfortPass, `Analytique ${m.analyticalBandLabel}`, `Analytique ${m.analyticalBandLabel} (r=${m.gainsLossesRatio.toFixed(2)})`, false, 'Méthode analytique Minergie (rapport gains/pertes journalier, seuils 0.70 / 0.97 / 1.05).') : ''}
        ${!isManual && m ? badge(m.comfortPass, `Sim. 2035 OK (${m.hoursOver265} h)`, `Sim. 2035 : ${m.hoursOver265} h`, false, 'Simulation dynamique horaire 5R1C : heures > 26.5 °C du 16 avril au 15 octobre sous climat projeté 2035 (max 100 h/an).') : ''}
        ${isManual ? badge(mainHours === 0, 'Journée type OK (0 h/j)', `Journée type : ${mainHours} h/j`, false, 'Heures de dépassement sur la journée type (24 h, régime périodique établi).') : !isMinergie ? badge(activeFR.passSIA, `${isCustom ? 'Custom' : 'SIA 180'} OK (${activeFR.overSIA} h)`, `${isCustom ? 'Custom' : 'SIA 180'} : ${activeFR.overSIA} h`, false, 'Nombre d\'heures dépassant la limite active.') : ''}
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi-box" data-tip="Nombre d'heures dépassant le seuil de confort actif (${isManual ? 'sur 1 journée type de 24 h en régime établi' : isMinergie ? '26.5 °C fixe du 16 avr. au 15 oct. — Minergie' : isCustom ? escapeHtml(prof.shortLabel) : project.siaCurveMode === 'fig4' ? 'SIA 180 Fig. 4 (VMC)' : 'SIA 180 Fig. 3 (naturelle)'}).">
        <div class="kpi-label">${isManual ? 'Surchauffe (journée type 24 h)' : isMinergie ? 'Simulation > 26.5 °C (16 avr.–15 oct.)' : isCustom ? 'Heures de surchauffe (Custom)' : 'Heures de surchauffe (SIA 180)'}</div>
        <div class="kpi-val" style="color:${mainPass ? 'var(--ok)' : 'var(--ko)'}">${isManual ? `${mainHours} h / 24 h` : `${mainHours} h/an`}</div>
        <div class="kpi-sub">${isManual ? 'Régime périodique établi (1 jour)' : `Limite autorisée : ≤ ${mainLimit} h/an`}</div>
      </div>
      <div class="kpi-box" data-tip="Pic de température opérative atteint à l'intérieur${isManual ? ' sur la journée type (et minimum nocturne).' : ' pendant la saison estivale (mai–septembre), et nombre d\'heures de nuit (22h–07h) au-dessus de 26 °C gênant le sommeil.'}">
        <div class="kpi-label">${isManual ? 'Température max (journée type)' : 'Température maximale en été'}</div>
        <div class="kpi-val" style="color:${peakTempVal > 28 ? 'var(--ko)' : 'var(--primary)'}">${peakTempVal.toFixed(1)} °C</div>
        <div class="kpi-sub">${isManual ? `Pic à ${String(d24.maxTopHod).padStart(2, '0')}h00 • Min ${d24.minTop.toFixed(1)} °C à ${String(d24.minTopHod).padStart(2, '0')}h00` : `Nuits chaudes (&gt; 26 °C) : ${activeFR.comfort.healthSleep.nightOver26H} h`}</div>
      </div>
      <div class="kpi-box" data-tip="Note globale sur 100 évaluant la résistance du bâtiment aux vagues de chaleur (50 pts sur les heures de surchauffe, 20 pts sur le pic de température, 15 pts sur les stores, 15 pts sur l'inertie et la ventilation nocturne).">
        <div class="kpi-label">Score de protection estivale</div>
        <div class="kpi-val" style="color:${activeFR.score >= 75 ? 'var(--ok)' : activeFR.score >= 45 ? 'var(--warn)' : 'var(--ko)'}">${activeFR.score} / 100</div>
        <div class="kpi-sub">${activeFR.score >= 75 ? 'Très bonne résilience' : activeFR.score >= 45 ? 'Marge d\'amélioration' : 'Vulnérable aux canicules'}</div>
      </div>
      <div class="kpi-box" data-tip="Débit d'air frais nocturne par m² de plancher (sous un écart type ΔT = 8 K). Un débit ≥ 10 m³/(h·m²) est nécessaire pour décharger efficacement la chaleur stockée dans les murs et dalles.">
        <div class="kpi-label">Aération nocturne</div>
        <div class="kpi-val" style="color:${nightPass ? 'var(--ok)' : 'var(--warn)'}">${activeFR.nomNightSpec.toFixed(1)} m³/(h·m²)</div>
        <div class="kpi-sub">Objectif recommandé : ≥ 10 m³/(h·m²)</div>
      </div>
    </div>
  `;

  const scenarios = res.behavioralScenarios || [];
  const allowedScenarioIds = isManual
    ? ['current', 'no_blinds', 'no_night', 'both_bad', 'optimal']
    : ['current', 'no_blinds', 'no_night', 'both_bad', 'optimal', 'climate_2035', 'climate_2050'];
  const getScenHrs = wf =>
    isManual
      ? isMinergie
        ? wf.day24?.overMinergie265 ?? 0
        : wf.day24?.overSIA ?? 0
      : isMinergie
        ? wf.overMinergie265
        : wf.overSIA;
  const maxScenarioHours = isManual
    ? 24
    : Math.max(120, ...scenarios.map(s => getScenHrs(s.wf)));

  const scenarioTips = {
    current: 'Résultat avec vos paramètres actuels (stores et aération tels que configurés).',
    no_blinds: 'Simule ce qui se passe si les occupants oublient de fermer les stores pendant la journée (la ventilation nocturne reste active).',
    no_night: 'Simule ce qui se passe si les fenêtres restent fermées toute la nuit (les stores restent actifs le jour).',
    both_bad: 'Pire cas comportemental : les stores restent levés le jour ET les fenêtres restent fermées la nuit.',
    optimal: 'Potentiel passif maximal : stores extérieurs automatisés très performants (g_store ≤ 0.10) + aération nocturne large.',
    climate_2035: 'Comportement du même bâtiment sous le climat réchauffé à l’horizon 2035 (+1.5 °C en été).',
    climate_2050: 'Comportement du même bâtiment sous le climat projeté à l’horizon 2050 (+2.0 °C en été).'
  };

  const scenariosHtml = scenarios
    .filter(s => allowedScenarioIds.includes(s.id))
    .map(s => {
      const hrs = getScenHrs(s.wf);
      const barPct = Math.min(100, (hrs / maxScenarioHours) * 100);
      const ok = isManual ? hrs === 0 : hrs <= mainLimit;
      const barCol = ok ? 'var(--ok)' : isManual ? (hrs <= 4 ? 'var(--warn)' : 'var(--ko)') : hrs <= mainLimit * 2 ? 'var(--warn)' : 'var(--ko)';
      const isCurr = s.id === 'current';
      const tip = scenarioTips[s.id] || s.note;
      const scPeak = isManual ? (s.wf.day24?.maxTop ?? s.wf.maxTop) : s.wf.maxTop;
      const hrsLbl = isManual ? `${hrs} h / 24 h` : `${hrs} h/an`;
      const failLbl = isManual ? `${hrs} h/j` : hrs - mainLimit > 0 ? `+${hrs - mainLimit} h` : 'Dépassé';
      return `
        <div class="scenario-row ${isCurr ? 'highlight' : ''}" data-tip="${escapeHtml(tip)}">
          <div>
            <strong>${escapeHtml(s.label)}</strong>
            <div style="font-size:11.5px;color:var(--text-muted);">${escapeHtml(s.note)}</div>
          </div>
          <div>
            <div class="scenario-bar-bg">
              <div class="scenario-bar-fill" style="width:${Math.max(2, barPct).toFixed(1)}%;background:${barCol};"></div>
            </div>
          </div>
          <div style="text-align:right;font-family:'Roboto Mono',ui-monospace,monospace;font-size:12.5px;">
            <strong>${hrsLbl}</strong>
            <div style="font-size:11px;color:var(--text-muted);">pic ${scPeak.toFixed(1)} °C</div>
          </div>
          <div>
            ${badge(ok, 'Conforme', failLbl, !ok && (isManual ? hrs <= 4 : hrs <= mainLimit * 1.5))}
          </div>
        </div>
      `;
    })
    .join('');

  const hourlyDayCardHtml =
    isManual && activeFR.series && activeFR.series.length >= 24
      ? (() => {
          const daySlice = activeFR.series.slice(-24);
          return `<div class="card">
            <h3 class="card-title">
              <span data-tip="Résultats heure par heure (00h à 23h) sur la journée type en régime périodique établi.">Détail horaire de la journée type (00h–23h)</span>
              <span class="pill ${mainPass ? 'ok' : 'ko'}">${mainHours} h / 24 h en dépassement</span>
            </h3>
            <div class="table-wrap"><table>
              <thead><tr>
                <th>Heure</th>
                <th class="num">θ_ext [°C]</th>
                <th class="num">θ_op int. [°C]</th>
                <th class="num">θ_air [°C]</th>
                <th class="num">Seuil [°C]</th>
                <th class="num">Solaire [W]</th>
                <th class="num">Ventil. [W]</th>
                <th>Statut</th>
              </tr></thead>
              <tbody>${daySlice
                .map(pt => {
                  const over = isMinergie ? pt.isOccHour && pt.Top > 26.5 : pt.isOverSIA;
                  const ventW = (pt.qVeDay || 0) + (pt.qVeNight || 0);
                  return `<tr style="${over ? 'background:var(--ko-bg);' : ''}">
                    <td><strong>${String(pt.hod).padStart(2, '0')}h00</strong></td>
                    <td class="num">${pt.Te.toFixed(1)} °C</td>
                    <td class="num"><strong>${pt.Top.toFixed(1)} °C</strong></td>
                    <td class="num">${pt.Tair.toFixed(1)} °C</td>
                    <td class="num">${pt.limUpper.toFixed(1)} °C</td>
                    <td class="num">${pt.qSol.toFixed(0)} W</td>
                    <td class="num">${ventW.toFixed(0)} W</td>
                    <td>${over ? badge(false, '', `+${(pt.Top - pt.limUpper).toFixed(1)} K`) : badge(true, 'OK', '')}</td>
                  </tr>`;
                })
                .join('')}</tbody>
            </table></div>
          </div>`;
        })()
      : '';

  document.getElementById('simpleReportBottom').innerHTML = `
    ${hourlyDayCardHtml}

    <div class="card">
      <h3 class="card-title">
        <span data-tip="Résumé des 6 quantités physiques qui déterminent si le local accumule ou évacue la chaleur en été.">Synthèse constructive &amp; paramètres clés</span>
      </h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th data-tip="Grandeur physique vérifiée.">Paramètre</th>
              <th class="num" data-tip="Valeur calculée pour l'étage sélectionné.">Valeur du projet</th>
              <th class="num" data-tip="Valeur cible recommandée pour éviter la surchauffe.">Référence / Seuil</th>
              <th data-tip="Évaluation directe du paramètre.">Statut</th>
            </tr>
          </thead>
          <tbody>
            <tr data-tip="Rapport entre la surface nette de verre A_G (cadre déduit) et la surface de plancher A_SNP.">
              <td>Surface de verre nette &amp; indice Z_g (A_G / A_SNP)</td>
              <td class="num">${m ? m.glassArea.toFixed(2) : activeFR.fp.winArea.toFixed(1)} m² verre (${activeFR.fp.winArea.toFixed(1)} m² brut) / ${activeFR.floor.area.toFixed(0)} m² (<strong>Z_g = ${m ? m.glazingIndexZg.toFixed(3) : '0.000'}</strong>)</td>
              <td class="num">Cadre déduit (f_F)</td>
              <td><span class="pill neutral">Quantité</span></td>
            </tr>
            <tr data-tip="Facteur solaire effectif g_tot comparé au g_tot admissible issu du bilan journalier constructif Minergie (Q_in / Q_max ≤ 100 %).">
              <td>Protection solaire (g_tot effectif vs admis)</td>
              <td class="num"><strong>${m ? m.gTotEffective.toFixed(3) : activeFR.avgGtot.toFixed(3)}</strong> (bilan ${m ? m.bilanPct.toFixed(0) : 0} %)</td>
              <td class="num">≤ ${m ? m.gTotAuthorized.toFixed(3) : '0.150'} (≤ 100 %)</td>
              <td>${m ? badge(m.constructivePass, 'Constructif OK', 'Bilan > 100 %') : ''}</td>
            </tr>
            <tr data-tip="Classe minimale de résistance au vent SIA 342 calculée via le profil de rafale SIA 261 à hauteur du store (terrain Cat. ${project.terrainCat || 'III'}, Föhn ${project.foehnExposed ? '+1 classe' : 'non'}).">
              <td>Résistance au vent des stores (SIA 261 / 342)</td>
              <td class="num">v = ${m ? m.windRec.gustKmh.toFixed(1) : '—'} km/h (h=${m ? m.buildingHeightM.toFixed(1) : '5'} m, Cat. ${project.terrainCat || 'III'}${project.foehnExposed ? ', Föhn' : ''})</td>
              <td class="num">${m ? `Classe ${m.windRec.minClass} (≤ ${m.windRec.windSpeedKmh} km/h)` : 'Classe 3'}</td>
              <td>${m ? badge(m.allWindSafe, `Classe ${m.windRec.minClass} OK`, 'Non protégé') : ''}</td>
            </tr>
            <tr data-tip="Capacité thermique spécifique C_R/A_SNP selon SIA 180 / Bauteile Minergie (plafonnée à 75 Wh/(m²·K)), distincte de la masse 5R1C (${activeFR.floor.cSpec.toFixed(0)} Wh/(m²·K)).">
              <td>Inertie thermique C_R / A_SNP (Minergie / 5R1C)</td>
              <td class="num"><strong>${m ? m.thermalMassWhm2K.toFixed(1) : Math.min(75, activeFR.floor.cSpec).toFixed(1)} Wh/(m²·K)</strong> <span style="color:var(--text-muted);font-size:11px;">(5R1C : ${activeFR.floor.cSpec.toFixed(0)})</span></td>
              <td class="num">≥ 30 min. (plafond 75)</td>
              <td>${badge((m ? m.thermalMassWhm2K : activeFR.floor.cSpec) >= 45, 'Forte', (m ? m.thermalMassWhm2K : activeFR.floor.cSpec) >= 30 ? 'Moyenne' : 'Faible', (m ? m.thermalMassWhm2K : activeFR.floor.cSpec) >= 30)}</td>
            </tr>
            <tr data-tip="Quantité de chaleur dégagée chaque jour par m² à l'intérieur, comparée à la référence SIA 2024:2015 du type de local (${escapeHtml(m?.roomType2024?.label || 'Local')}).">
              <td>Charges internes (${escapeHtml(m?.roomType2024?.label || 'SIA 2024')})</td>
              <td class="num"><strong>${g.internalTotal.dailyWhm2d.toFixed(0)} Wh/(m²·j)</strong> (${g.internalTotal.peakW.toFixed(0)} W max)</td>
              <td class="num">Réf. SIA 2024 : ${m ? m.internalLoadRefWhm2d : 84} Wh/(m²·j)</td>
              <td>${badge(g.internalTotal.dailyWhm2d <= (m ? m.internalLoadRefWhm2d * 1.15 : 100), 'Maîtrisées', 'Élevées', true)}</td>
            </tr>
            <tr data-tip="Capacité de renouvellement d'air nocturne par les fenêtres ouvertes pour évacuer la chaleur accumulée la journée (≥ 10 m³/(h·m²) recommandé).">
              <td>Ventilation nocturne (rafraîchissement)</td>
              <td class="num"><strong>${activeFR.nomNightSpec.toFixed(1)} m³/(h·m²)</strong> (${(activeFR.nomNightM3h / Math.max(1, activeFR.fp.vol)).toFixed(1)} vol/h)</td>
              <td class="num">≥ 10.0 m³/(h·m²)</td>
              <td>${badge(nightPass, 'Efficace', activeFR.nomNightSpec > 0 ? 'Modérée' : 'Absente', activeFR.nomNightSpec > 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" id="simpleScenariosCard">
      <h3 class="card-title">
        <span data-tip="Compare votre configuration aux cas où les occupants oublient de fermer les stores le jour ou d'ouvrir les fenêtres la nuit.">Impact des gestes quotidiens &amp; scénarios (« Et si on oublie... ? »)</span>
        <span class="pill neutral">${isManual ? 'Journée type (h / 24 h)' : isMinergie ? 'Heures > 26.5 °C' : 'Heures SIA 180'}</span>
      </h3>
      <p class="subtitle">
        Montre l'effet concret d'un oubli de fermeture des stores ou d'ouverture nocturne des fenêtres sur la surchauffe.
      </p>
      <div class="scenario-list">${scenariosHtml}</div>
    </div>

    ${
      res.floorResults.length > 1
        ? `<div class="card">
            <h3 class="card-title" data-tip="Comparaison rapide de la surchauffe entre tous les étages du bâtiment.">Résumé par étage</h3>
            <div class="table-wrap"><table>
              <thead><tr>
                <th data-tip="Nom de l'étage.">Local / Étage</th>
                <th class="num" data-tip="Surface nette de plancher [m²].">Surface</th>
                <th class="num" data-tip="Température maximale atteinte [°C].">${isManual ? 'Pic 24 h' : 'Temp. max été'}</th>
                <th class="num" data-tip="Heures au-dessus de 26.5 °C.">&gt; 26.5 °C</th>
                <th class="num" data-tip="Heures de dépassement de la limite active.">Surchauffe</th>
                <th class="num" data-tip="Score global de protection estivale sur 100.">Score</th>
                <th data-tip="Conformité de l'étage au seuil choisi.">Statut</th>
              </tr></thead>
              <tbody>${res.floorResults
                .map(fr => {
                  const fd = fr.day24 || fr;
                  const fHrs = isManual
                    ? isMinergie
                      ? fd.overMinergie265
                      : fd.overSIA
                    : isMinergie
                      ? fr.overMinergie265
                      : fr.overSIA;
                  const fOk = isManual ? fHrs === 0 : fHrs <= mainLimit;
                  const unit = isManual ? 'h/j' : 'h';
                  return `<tr>
                    <td><strong>${escapeHtml(fr.floor.name)}</strong></td>
                    <td class="num">${fr.floor.area.toFixed(0)} m²</td>
                    <td class="num">${(isManual ? fd.maxTop : fr.summerMaxTop).toFixed(1)} °C</td>
                    <td class="num">${isManual ? fd.overMinergie265 : fr.overMinergie265} ${unit}</td>
                    <td class="num">${isManual ? fd.overSIA : fr.overSIA} ${unit}</td>
                    <td class="num">${fr.score}/100</td>
                    <td>${badge(fOk, 'Conforme', 'Dépassé')}</td>
                  </tr>`;
                })
                .join('')}</tbody>
            </table></div>
          </div>`
        : ''
    }

    <div class="card">
      <h3 class="card-title" data-tip="Actions concrètes identifiées automatiquement pour réduire la température intérieure d'été.">Recommandations prioritaires</h3>
      <div class="reco-list">${activeFR.recos.map(r => `<div class="reco-item">${r}</div>`).join('')}</div>
    </div>
  `;

  const coolEndWrap = document.getElementById('activeCoolingEndWrap');
  if (coolEndWrap) {
    coolEndWrap.innerHTML = renderActiveCoolingCard(res, activeFR, project);
  }
}

function renderDetailedGainsSection(activeFR) {
  const g = activeFR.gains;
  if (!g) return;
  const fl = activeFR.floor;
  const area = Math.max(1, fl.area);

  document.getElementById('advGainsSummaryBadge').textContent =
    `Pointe totale : ${g.totalGainPeakW.toFixed(0)} W (${g.totalGainPeakWm2.toFixed(1)} W/m²) • Économie stores : ${g.solarBlockedByBlinds.summerKWh.toFixed(0)} kWh`;

  const fmtRow = (label, item, cls = '', tip = '') => `
    <tr class="${cls}"${tip ? ` data-tip="${escapeHtml(tip)}"` : ''}>
      <td>${label}</td>
      <td class="num">${item.peakW.toFixed(0)} W</td>
      <td class="num">${item.peakWm2.toFixed(1)} W/m²</td>
      <td class="num">${item.summerMeanW.toFixed(0)} W</td>
      <td class="num">${item.dailyWhm2d.toFixed(1)} Wh/(m²·j)</td>
      <td class="num"><strong>${item.summerKWh.toFixed(0)} kWh</strong></td>
      <td class="num">${item.summerKWhm2.toFixed(1)} kWh/m²</td>
      <td class="num">${item.sharePct.toFixed(1)} %</td>
    </tr>
  `;

  const blindReductionPct =
    g.solarUnshaded.summerKWh > 0
      ? (g.solarBlockedByBlinds.summerKWh / g.solarUnshaded.summerKWh) * 100
      : 0;

  document.getElementById('advGainsBody').innerHTML = `
    <div class="gains-summary-chips">
      <span class="pill neutral" data-tip="Charge thermique interne cumulée par jour et par m² de plancher (personnes + éclairage + appareils).">Gains internes : <strong>${g.internalTotal.dailyWhm2d.toFixed(1)} Wh/(m²·j)</strong> (${g.internalTotal.peakW.toFixed(0)} W pointe)</span>
      <span class="pill neutral" data-tip="Répartition de la puissance interne de pointe entre occupants, éclairage et appareils.">Personnes : ${g.people.peakW.toFixed(0)} W • Lampes : ${g.lighting.peakW.toFixed(0)} W • Appareils : ${g.appliances.peakW.toFixed(0)} W</span>
      <span class="pill ok" data-tip="Quantité d'énergie solaire estivale arrêtée par les stores mobiles par rapport au vitrage nu.">Solaire bloqué par les stores : <strong>${g.solarBlockedByBlinds.summerKWh.toFixed(0)} kWh</strong> (−${blindReductionPct.toFixed(0)} %)</span>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th data-tip="Source d'apport de chaleur (+) ou voie d'évacuation (−) évaluée sur la saison estivale (1er mai – 30 septembre).">Type de gain / flux thermique (Mai–Sept)</th>
            <th class="num" data-tip="Puissance maximale instantanée [W] atteinte par ce flux pendant l'été.">Puissance pointe</th>
            <th class="num" data-tip="Puissance de pointe ramenée au m² de plancher [W/m²].">Spécifique</th>
            <th class="num" data-tip="Puissance moyenne continue sur les 3696 heures de la période mai–septembre [W].">Moy. été</th>
            <th class="num" data-tip="Énergie moyenne apportée chaque jour par m² de plancher [Wh/(m²·j)].">Charge jour</th>
            <th class="num" data-tip="Énergie totale cumulée sur l'été (mai–septembre) [kWh].">Énergie été</th>
            <th class="num" data-tip="Énergie estivale ramenée au m² de plancher [kWh/m²].">Par m²</th>
            <th class="num" data-tip="Pourcentage du total des apports de chaleur estivaux.">Part gains</th>
          </tr>
        </thead>
        <tbody>
          <tr data-tip="Somme de toutes les chaleurs dégagées à l'intérieur du local (occupants + éclairage + appareils).">
            <td><strong>1. Gains internes (Total : gens + lampes + appareils)</strong></td>
            <td class="num"><strong>${g.internalTotal.peakW.toFixed(0)} W</strong></td>
            <td class="num"><strong>${g.internalTotal.peakWm2.toFixed(1)} W/m²</strong></td>
            <td class="num">${g.internalTotal.summerMeanW.toFixed(0)} W</td>
            <td class="num"><strong>${g.internalTotal.dailyWhm2d.toFixed(1)} Wh/(m²·j)</strong></td>
            <td class="num"><strong>${g.internalTotal.summerKWh.toFixed(0)} kWh</strong></td>
            <td class="num">${g.internalTotal.summerKWhm2.toFixed(1)} kWh/m²</td>
            <td class="num"><strong>${g.internalTotal.sharePct.toFixed(1)} %</strong></td>
          </tr>
          ${fmtRow(`↳ Personnes / Occupants (${fl.occCount} p. × ${fl.occWatt} W × ${((fl.occPresenceFactor ?? 1) * 100).toFixed(0)} %)`, g.people, 'gains-row-sub', 'Chaleur métabolique dégagée par les personnes présentes dans le local.')}
          ${fmtRow(`↳ Lampes / Éclairage (${fl.lightWm2.toFixed(1)} W/m²)`, g.lighting, 'gains-row-sub', 'Chaleur dissipée par les luminaires et lampes.')}
          ${fmtRow(`↳ Appareils / Appliances (${fl.equipWatt.toFixed(0)} W inst., veille ${fl.standbyPct} %)`, g.appliances, 'gains-row-sub', 'Chaleur dégagée par les équipements informatiques, électroménagers et appareils en veille.')}

          <tr data-tip="Rayonnement solaire entrant effectivement par les fenêtres après réduction par les casquettes, écrans latéraux et stores.">
            <td><strong>2. Gains solaires transmis (avec stores &amp; ombrages)</strong></td>
            <td class="num"><strong>${g.solarTransmitted.peakW.toFixed(0)} W</strong></td>
            <td class="num"><strong>${g.solarTransmitted.peakWm2.toFixed(1)} W/m²</strong></td>
            <td class="num">${g.solarTransmitted.summerMeanW.toFixed(0)} W</td>
            <td class="num">${g.solarTransmitted.dailyWhm2d.toFixed(1)} Wh/(m²·j)</td>
            <td class="num"><strong>${g.solarTransmitted.summerKWh.toFixed(0)} kWh</strong></td>
            <td class="num">${g.solarTransmitted.summerKWhm2.toFixed(1)} kWh/m²</td>
            <td class="num"><strong>${g.solarTransmitted.sharePct.toFixed(1)} %</strong></td>
          </tr>
          <tr class="gains-row-sub" data-tip="Apport solaire qui serait entré à travers le vitrage nu si aucun store mobile n'avait été baissé, et réduction permise par les stores.">
            <td>↳ Référence vitrage nu (sans stores) / Économie stores</td>
            <td class="num">${g.solarUnshaded.peakW.toFixed(0)} W</td>
            <td class="num">${g.solarUnshaded.peakWm2.toFixed(1)} W/m²</td>
            <td class="num">${g.solarUnshaded.summerMeanW.toFixed(0)} W</td>
            <td class="num">−${g.solarBlockedByBlinds.dailyWhm2d.toFixed(1)} Wh/(m²·j)</td>
            <td class="num">${g.solarUnshaded.summerKWh.toFixed(0)} kWh</td>
            <td class="num">−${g.solarBlockedByBlinds.summerKWhm2.toFixed(1)} kWh/m²</td>
            <td class="num">−${blindReductionPct.toFixed(0)} %</td>
          </tr>

          ${fmtRow('3. Conduction entrante par enveloppe (θ_e &gt; θ_op)', g.conductionIn, '', 'Chaleur entrant par conduction à travers les murs, le toit et les vitrages aux heures chaudes où il fait plus chaud dehors que dedans.')}
          ${g.slabIn.summerKWh >= 1 ? fmtRow('4. Apport thermique via dalles inter-étages (+)', g.slabIn, '', 'Chaleur transmise par conduction depuis un étage voisin plus chaud.') : ''}

          <tr class="gains-row-total" data-tip="Total de tous les apports de chaleur reçus par le local (la puissance de pointe correspond au maximum simultané observé sur une même heure).">
            <td>TOTAL DES GAINS DE CHALEUR (pointe simultanée)</td>
            <td class="num">${g.totalGainPeakW.toFixed(0)} W</td>
            <td class="num">${g.totalGainPeakWm2.toFixed(1)} W/m²</td>
            <td class="num">${g.totalGainSummerMeanW.toFixed(0)} W</td>
            <td class="num">${((g.totalGainSummerKWh * 1000) / (154 * area)).toFixed(1)} Wh/(m²·j)</td>
            <td class="num">${g.totalGainSummerKWh.toFixed(0)} kWh</td>
            <td class="num">${g.totalGainSummerKWhm2.toFixed(1)} kWh/m²</td>
            <td class="num">100.0 %</td>
          </tr>

          <tr data-tip="Chaleur ressortant par conduction à travers les parois et vitrages lorsque l'extérieur est plus frais que l'intérieur.">
            <td style="color:var(--ok);">Évacuation : Conduction sortante (−)</td>
            <td class="num">${g.conductionOut.peakW.toFixed(0)} W</td>
            <td class="num">${g.conductionOut.peakWm2.toFixed(1)} W/m²</td>
            <td class="num">${g.conductionOut.summerMeanW.toFixed(0)} W</td>
            <td class="num">—</td>
            <td class="num">−${g.conductionOut.summerKWh.toFixed(0)} kWh</td>
            <td class="num">−${g.conductionOut.summerKWhm2.toFixed(1)} kWh/m²</td>
            <td class="num">—</td>
          </tr>
          <tr data-tip="Chaleur évacuée par le renouvellement d'air hygiénique diurne et les infiltrations.">
            <td style="color:var(--ok);">Évacuation : Ventilation diurne &amp; infiltration (−)</td>
            <td class="num">${g.ventDayOut.peakW.toFixed(0)} W</td>
            <td class="num">${g.ventDayOut.peakWm2.toFixed(1)} W/m²</td>
            <td class="num">${g.ventDayOut.summerMeanW.toFixed(0)} W</td>
            <td class="num">—</td>
            <td class="num">−${g.ventDayOut.summerKWh.toFixed(0)} kWh</td>
            <td class="num">−${g.ventDayOut.summerKWhm2.toFixed(1)} kWh/m²</td>
            <td class="num">—</td>
          </tr>
          <tr data-tip="Chaleur extraite la nuit par l'ouverture des fenêtres (déstockage de la masse thermique).">
            <td style="color:var(--ok);">Évacuation : Surventilation nocturne (−)</td>
            <td class="num">${g.ventNightOut.peakW.toFixed(0)} W</td>
            <td class="num">${g.ventNightOut.peakWm2.toFixed(1)} W/m²</td>
            <td class="num">${g.ventNightOut.summerMeanW.toFixed(0)} W</td>
            <td class="num">—</td>
            <td class="num">−${g.ventNightOut.summerKWh.toFixed(0)} kWh</td>
            <td class="num">−${g.ventNightOut.summerKWhm2.toFixed(1)} kWh/m²</td>
            <td class="num">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderConstructiveTab(activeFR, project) {
  const m = activeFR.minergie;
  if (!m) {
    document.getElementById('sub-minergie').innerHTML = '<p class="subtitle">Données indisponibles.</p>';
    return;
  }
  const stC = m.stationClimateConstants || {};
  const autoStatusHtml = m.automationRequired
    ? badge(m.shadingAutomated, 'Auto requise : OK', 'Automatisation requise !')
    : m.automationRecommended
      ? badge(m.shadingAutomated, 'Auto recommandée : OK', 'Auto recommandée', true)
      : badge(true, 'Non exigée');

  document.getElementById('sub-minergie').innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center;">
      <span>Volet 1 Constructif (bilan Wh/j) : ${badge(m.constructivePass, `Rempli (${m.bilanPct.toFixed(0)} %)`, `Non rempli (${m.bilanPct.toFixed(0)} %)`)}</span>
      <span>Volet 2 Analytique (gains/pertes) : ${badge(m.analyticalComfortPass, `OK (${m.analyticalBandLabel})`, `Non respecté (${m.analyticalBandLabel})`)}</span>
      <span>Simulation dynamique 5R1C (16 avr.–15 oct.) : ${badge(m.simComfortPass, `≤ 100 h (${m.hoursOver265} h)`, `Dépassé (${m.hoursOver265} h)`)}</span>
    </div>

    ${
      m.coolingRequiredByRule
        ? `<div class="cool-alert ko" style="margin-bottom:10px;">
            <strong>Refroidissement actif nécessaire (règle Minergie) :</strong> les charges internes (${m.internalLoadForAnalytical.toFixed(0)} Wh/(m²·j)) dépassent le seuil de <strong>${m.strategyThresholds.coolReq} Wh/(m²·j)</strong> pour la stratégie « ${escapeHtml(m.strategyThresholds.label)} ».
          </div>`
        : ''
    }

    <div class="table-wrap">
      <table>
        <thead><tr>
          <th data-tip="Critère constructif ou de confort vérifié selon le justificatif Minergie v2023.2 (CALC_1).">Paramètre (Justificatif Minergie v2023.2)</th>
          <th class="num" data-tip="Valeur calculée pour l'étage actif.">Calculé</th>
          <th class="num" data-tip="Seuil réglementaire ou valeur de référence.">Exigence / Référence</th>
          <th data-tip="Statut de conformité.">Statut</th>
        </tr></thead>
        <tbody>
          <tr data-tip="Surface nette de plancher et vérification que la profondeur de la pièce ne dépasse pas 2.5 fois la hauteur sous plafond."><td>Surface nette de plancher (A_SNP)</td><td class="num">${m.area.toFixed(1)} m²</td><td class="num">Profondeur/h_libre = ${m.depthRatio.toFixed(1)} (max 2.5 reco.)</td><td>${badge(!m.depthWarning, 'OK', 'Profond (>2.5h)', true)}</td></tr>
          <tr data-tip="Surface de verre nette A_G (cadre déduit) et surface de cadre A_cadre. Indice de vitrage Z_g = A_G / A_SNP."><td>Surface de verre A_G / Cadre A_c &amp; Indice Z_g</td><td class="num">A_G = <strong>${m.glassArea.toFixed(2)} m²</strong> • A_c = ${m.frameArea.toFixed(2)} m² • <strong>Z_g = ${m.glazingIndexZg.toFixed(3)}</strong></td><td class="num">Brut : ${m.winAreaGross.toFixed(2)} m²</td><td><span class="pill neutral">Cadre déduit</span></td></tr>
          <tr data-tip="Capacité thermique spécifique C_R / A_SNP calculée selon Bauteile (sans mobilier, plafonnée à 75 Wh/(m²·K) en v2023). Distincte de la masse 5R1C (${activeFR.floor.cSpec.toFixed(0)} Wh/(m²·K))."><td>Capacité thermique C_R / A_SNP (Bauteile)</td><td class="num"><strong>${m.thermalMassWhm2K.toFixed(1)} Wh/(m²·K)</strong></td><td class="num">≥ 30 min. • Plafond 75 (5R1C : ${activeFR.floor.cSpec.toFixed(0)})</td><td>${badge(m.massMinOk, 'OK', 'Insuffisante')}</td></tr>
          <tr data-tip="Énergie solaire journalière maximale admissible Q_max = (q_vent + C_R/A·ΔT − 120)·A_SNP + q_verre·A_G + q_cadre·A_c (constantes ${escapeHtml(project.climate.station)} ${escapeHtml(m.climateScenarioUsed)} : q_vent=${(stC.qVent ?? 0).toFixed(2)}, ΔT=${(stC.dT ?? 0).toFixed(3)} K)."><td>Bilan constructif journalier (Q_in / Q_max)</td><td class="num">Q_in = <strong>${m.qInWhDay.toFixed(0)} Wh/j</strong> / Q_max = <strong>${m.qMaxWhDay.toFixed(1)} Wh/j</strong> (<strong>${m.bilanPct.toFixed(1)} %</strong>)</td><td class="num">≤ 100 % (charges fixes 120 Wh/m²j)</td><td>${badge(m.bilanPct <= 100.05, '≤ 100 % OK', `${m.bilanPct.toFixed(0)} % > 100 %`)}</td></tr>
          <tr data-tip="Facteur solaire total admissible g_tot,adm = (Q_max − Σ g_vit·Q<200) / Σ Q≥200 comparé au g_tot effectif des stores."><td>Facteur solaire g_tot effectif vs admis</td><td class="num"><strong>${m.gTotEffective.toFixed(3)}</strong></td><td class="num">g_tot,adm ≤ <strong>${m.gTotAuthorized.toFixed(3)}</strong></td><td>${badge(m.gTotOk, 'OK', 'Trop élevé')}</td></tr>
          <tr data-tip="Classe minimale de résistance au vent SIA 342 calculée par le profil de rafale SIA 261 à la hauteur du store."><td>Résistance au vent stores (SIA 261 / SIA 342)</td><td class="num"><strong>Classe ${m.windRec.minClass}</strong> (v = ${m.windRec.gustKmh.toFixed(1)} km/h)</td><td class="num">H=${m.buildingHeightM.toFixed(1)} m • Terrain ${escapeHtml(m.terrainCat)} • Föhn=${project.foehnExposed ? 'Oui (+1)' : 'Non'}</td><td>${badge(m.allWindSafe, `Classe ${m.windRec.minClass} OK`, 'Non protégé')}</td></tr>
          <tr data-tip="Rapport analytique gains / pertes (Variante 2) : gains = charges internes + Q_in/A_SNP ; pertes = stratégie + masse + cadre + verre. Seuils : ≤ 0.70 (≤ 70 h), ≤ 0.97 (≤ 100 h), ≤ 1.05 (> 100 h), > 1.05 (> 130 h)."><td>Confort analytique (Rapport gains / pertes)</td><td class="num"><strong>${m.gainsLossesRatio.toFixed(2)}</strong> (${m.gainsWhm2d.toFixed(1)} / ${m.pertesWhm2d.toFixed(1)} Wh/m²j) → <strong>${m.analyticalBandLabel}</strong></td><td class="num">≤ 0.97 (≤ 100 h) + constructif OK</td><td>${badge(m.analyticalComfortPass, 'Respecté', m.constructivePass ? 'Rapport > 0.97' : 'Échec constructif')}</td></tr>
          <tr data-tip="Règle d'automatisation des stores et de refroidissement actif selon la stratégie (${escapeHtml(m.strategyThresholds.label)}) : auto > ${m.strategyThresholds.autoReq}, froid > ${m.strategyThresholds.coolReq} Wh/(m²·j)."><td>Automatisation stores &amp; Stratégie (${escapeHtml(m.strategyThresholds.label)})</td><td class="num">${m.shadingAutomated ? 'Automatisés (≥ 200 W/m²)' : 'Manuels / Absents'} • Charges ${m.internalLoadForAnalytical.toFixed(0)} Wh/m²j</td><td class="num">Auto &gt; ${m.strategyThresholds.autoReq} • Froid &gt; ${m.strategyThresholds.coolReq} Wh/m²j</td><td>${autoStatusHtml}</td></tr>
          <tr data-tip="Charges internes journalières par rapport au type de local SIA 2024:2015 (${escapeHtml(m.roomType2024.label)})."><td>Charges internes (${escapeHtml(m.roomType2024.label)})</td><td class="num">${m.internalLoadWhm2d.toFixed(1)} Wh/(m²·j)</td><td class="num">SIA 2024:2015 : ${m.internalLoadRefWhm2d} Wh/(m²·j)</td><td>${badge(m.internalLoadWhm2d <= m.internalLoadRefWhm2d * 1.15, 'OK', 'Élevées', true)}</td></tr>
          <tr data-tip="Justificatif par simulation dynamique horaire 5R1C : compte uniquement les heures d'occupation > 26.5 °C entre le 16 avril et le 15 octobre. Un justificatif officiel par simulation requiert des données météorologiques DRY 2035."><td>Simulation dynamique 5R1C (&gt; 26.5 °C, 16 avr.–15 oct.)</td><td class="num">${m.hoursOver265Current} h (actif) / <strong>${m.hoursOver265} h (2035)</strong></td><td class="num">≤ 100 h/an (16 avr.–15 oct., DRY 2035)</td><td>${badge(m.simComfortPass, 'Sim. OK', 'Sim. dépassée')}</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderComfortSection(activeFR) {
  const c = activeFR.comfort;
  if (!c) return;
  const p = c.params;

  const pmvPeakVerdict = c.fanger.maxPmv <= 1.0;
  const pmvBadgeHtml =
    c.fanger.meanPmv > 0.5
      ? badge(false, '', 'Inconfort chaud', c.fanger.meanPmv <= 0.7)
      : c.fanger.meanPmv < -0.5
        ? badge(false, '', `Frais (${p.clo.toFixed(2)} clo)`, true)
        : badge(pmvPeakVerdict, 'Classe B OK', 'Pic chaud', true);

  const siaOccPct =
    activeFR.occH > 0 ? ((activeFR.occH - activeFR.overSIA) / activeFR.occH) * 100 : 100;
  const secoOk = c.secoOlt3.occOver28H === 0;

  document.getElementById('comfortSectionBody').innerHTML = `
    <div class="comfort-grid">
      <div class="comfort-card" data-tip="Norme suisse SIA 180 (courbe adaptative 48h) et recommandations SECO OLT 3 pour la protection de la santé au travail (alerte dès 26 °C, critique au-delà de 28 °C).">
        <div class="comfort-card-head">
          <strong>Normes suisses — SIA 180 &amp; SECO (OLT 3)</strong>
          ${badge(activeFR.passSIA && secoOk, 'Conforme CH', secoOk ? 'Dépassement SIA' : 'Critique > 28 °C', activeFR.passSIA && !secoOk)}
        </div>
        <div class="comfort-ref">SIA 180:2014 (courbe adaptative 48h) &amp; SECO OLT 3 (postes de travail)</div>
        <div class="comfort-metric">${siaOccPct.toFixed(1)} % <span style="font-size:12px;font-weight:500;color:var(--text-muted);">conforme SIA 180 (${activeFR.overSIA} h dép.)</span></div>
        <div style="font-size:12px;color:var(--text-muted);">
          SECO ≤ 26 °C : <strong>${c.secoOlt3.occWithin26Pct.toFixed(1)} %</strong> •
          &gt; 26 °C : <strong>${c.secoOlt3.occOver26H} h</strong> •
          Critique &gt; 28 °C : <strong>${c.secoOlt3.occOver28H} h</strong>
        </div>
      </div>

      <div class="comfort-card" data-tip="Recommandations de l'Organisation Mondiale de la Santé (OMS 2018) et critère CIBSE TM59 pour la qualité du sommeil la nuit (22h–07h) : dégradation du sommeil au-dessus de 26 °C.">
        <div class="comfort-card-head">
          <strong>OMS (WHO 2018) &amp; CIBSE TM59 — Santé &amp; Sommeil</strong>
          ${badge(c.healthSleep.nightOver26H <= 32, 'Nuit OK', 'Chaleur nocturne', c.healthSleep.nightOver26H <= 100)}
        </div>
        <div class="comfort-ref">WHO Housing &amp; Health Guidelines (24 °C / 26 °C) &amp; TM59 (nuit ≤ 1 % &gt; 26 °C)</div>
        <div class="comfort-metric">${c.healthSleep.nightOver26H} h <span style="font-size:12px;font-weight:500;color:var(--text-muted);">nocturnes &gt; 26 °C (${c.cibse.tm59NightOver26Pct.toFixed(1)} %)</span></div>
        <div style="font-size:12px;color:var(--text-muted);">
          Nuits &gt; 24 °C : <strong>${c.healthSleep.nightOver24H} h</strong> •
          Nuits chaudes ≥ 24 °C min : <strong>${c.healthSleep.indoorTropicalNights} nuits</strong> •
          TM52 : ${badge(c.cibse.tm52Pass, 'OK', `${c.cibse.failCount}/3 échecs`)}
        </div>
      </div>

      <div class="comfort-card" data-tip="Norme européenne EN 16798-1 (Catégories I, II, III autour de la température optimale adaptative θ_c = 0.33·θ_rm + 18.8 °C) et norme américaine ASHRAE 55.">
        <div class="comfort-card-head">
          <strong>EN 16798-1:2019 &amp; ASHRAE 55 (Adaptatif)</strong>
          ${badge(c.en16798.passCat2, 'Cat. II OK', 'Hors Cat. II')}
        </div>
        <div class="comfort-ref">θ_c = 0.33·θ_rm(α=0.8) + 18.8 °C (EU) • ASHRAE 80 % : ${c.ashrae55.pct80Ok.toFixed(1)} %</div>
        <div class="comfort-metric">${c.en16798.cat2OkPct.toFixed(1)} % <span style="font-size:12px;font-weight:500;color:var(--text-muted);">en Cat. II (${c.en16798.cat2HotH} h chaud)</span></div>
        <div style="font-size:12px;color:var(--text-muted);">
          Cat. I : <strong>${c.en16798.cat1OkPct.toFixed(1)} %</strong> (${c.en16798.cat1HotH} h chaud) •
          Cat. III : <strong>${c.en16798.cat3OkPct.toFixed(1)} %</strong> (${c.en16798.cat3HotH} h &gt; +4 K)
        </div>
      </div>

      <div class="comfort-card" data-tip="Indice physiologique PMV (vote moyen prévisible de −3 froid à +3 chaud, 0 = neutre) et PPD (% d'insatisfaits) selon ISO 7730, couplé à l'étude de productivité cognitive de Seppänen (2006).">
        <div class="comfort-card-head">
          <strong>ISO 7730:2005 (PMV/PPD) &amp; Seppänen 2006</strong>
          ${pmvBadgeHtml}
        </div>
        <div class="comfort-ref">Confort physiologique (Mai–Sept., 07h–22h) &amp; productivité LBNL</div>
        <div class="comfort-metric">PMV ${c.fanger.meanPmv >= 0 ? '+' : ''}${c.fanger.meanPmv.toFixed(2)} <span style="font-size:12px;font-weight:500;color:var(--text-muted);">(PPD moy. ${c.fanger.meanPpd.toFixed(1)} %)</span></div>
        <div style="font-size:12px;color:var(--text-muted);">
          Pic : <strong>PMV ${c.fanger.maxPmv >= 0 ? '+' : ''}${c.fanger.maxPmv.toFixed(2)}</strong> •
          Classe B : <strong>${c.fanger.pctClassB.toFixed(0)} %</strong> •
          Productivité été : <strong>${c.productivity.meanRelativePct.toFixed(1)} %</strong>
        </div>
      </div>
    </div>

    <div class="well" style="margin-bottom:12px;">
      <div class="g4">
        <div class="field" data-tip="Isolation vestimentaire [clo] : 0.35 = short/t-shirt, 0.50 = tenue d'été standard (pantalon léger + chemise manches courtes), 1.00 = costume/tenue d'intérieur hiver.">
          <label>Habillement [clo] : <strong id="lblComfortClo">${p.clo.toFixed(2)}</strong></label>
          <input type="range" id="inComfortClo" min="0.30" max="1.00" step="0.05" value="${p.clo}" />
        </div>
        <div class="field" data-tip="Activité métabolique [met] : 1.0 = repos assis, 1.2 = travail de bureau sédentaire, 1.6 = activité debout / commerce, 2.0 = marche / travail actif.">
          <label>Métabolisme [met] : <strong id="lblComfortMet">${p.met.toFixed(2)}</strong></label>
          <input type="range" id="inComfortMet" min="0.80" max="2.00" step="0.10" value="${p.met}" />
        </div>
        <div class="field" data-tip="Vitesse relative de l'air autour de l'occupant [m/s] : 0.10 m/s = air calme, 0.30–0.60 m/s = brise de fenêtre ou ventilateur de plafond (améliore le confort PMV en été).">
          <label>Vitesse d'air [m/s] : <strong id="lblComfortVel">${p.airSpeed.toFixed(2)}</strong></label>
          <input type="range" id="inComfortVel" min="0.05" max="0.80" step="0.05" value="${p.airSpeed}" />
        </div>
        <div class="field" data-tip="Humidité relative intérieure moyenne en été [%] utilisée dans l'équation de bilan thermique du corps humain (Fanger PMV/PPD).">
          <label>Humidité [%] : <strong id="lblComfortRh">${p.rh.toFixed(0)}</strong></label>
          <input type="range" id="inComfortRh" min="25" max="80" step="5" value="${p.rh}" />
        </div>
      </div>
    </div>

    <div>
      <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;" data-tip="Compare sur un même graphique les courbes limites supérieures de confort EN 16798-1 (Cat. I, II, III), SECO (26 °C) et SIA 180.">
        Domaines adaptatifs comparés : EN 16798-1 (Cat I/II/III), SECO (26 °C) &amp; SIA 180
      </div>
      <div class="chart-box" style="height:230px;"><canvas id="chartComfortAdaptive"></canvas></div>
    </div>
  `;

  const rebindComfort = (id, key, lblId, fmt) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      appState.comfortParams[key] = parseFloat(el.value);
      document.getElementById(lblId).textContent = fmt(appState.comfortParams[key]);
      activeFR.comfort = evaluateThermalComfort(activeFR.series, appState.comfortParams);
      const comfBadge = document.getElementById('drawerBadgeComfort');
      if (comfBadge) {
        comfBadge.textContent = `EN Cat. II : ${activeFR.comfort.en16798.cat2OkPct.toFixed(0)} % • PMV ${activeFR.comfort.fanger.meanPmv >= 0 ? '+' : ''}${activeFR.comfort.fanger.meanPmv.toFixed(2)}`;
        comfBadge.className = `pill ${activeFR.comfort.en16798.cat2OkPct >= 97 ? 'ok' : 'warn'}`;
      }
      renderComfortSection(activeFR);
      requestAnimationFrame(() => drawAdaptiveComparisonChart(activeFR, appState.project.siaCurveMode));
    });
  };
  rebindComfort('inComfortClo', 'clo', 'lblComfortClo', v => v.toFixed(2));
  rebindComfort('inComfortMet', 'met', 'lblComfortMet', v => v.toFixed(2));
  rebindComfort('inComfortVel', 'airSpeed', 'lblComfortVel', v => v.toFixed(2));
  rebindComfort('inComfortRh', 'rh', 'lblComfortRh', v => v.toFixed(0));
}

function simulateVariantFast(v) {
  if (v.id === appState.activeVariantId && appState.lastResults) {
    return appState.lastResults;
  }
  const sig = JSON.stringify({
    p: v.project,
    w: v.customWeather ? v.customWeather.sourceLabel : null
  });
  const cached = variantSimCache.get(v.id);
  if (cached && cached.sig === sig) {
    return cached.res;
  }
  const uhi = Boolean(v.project.climate?.urbanHeatIsland);
  const weatherObj = v.customWeather
    ? uhi
      ? applyClimateDelta(v.customWeather, 'REF', true)
      : v.customWeather
    : generateSyntheticWeather(v.project.climate.station, v.project.climate.scenario, uhi);
  const raw = executeEngine(v.project, weatherObj.data, true, true);
  const res = enrichWithSIA180(raw, v.project.projectType, v.project);
  variantSimCache.set(v.id, { sig, res });
  return res;
}

function fmtDeltaTag(diff, unit, lowerIsBetter = true, digits = 0) {
  if (Math.abs(diff) < (digits === 0 ? 0.5 : 0.05)) {
    return `<span class="delta-tag delta-flat">=</span>`;
  }
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  const sign = diff > 0 ? '+' : '';
  return `<span class="delta-tag ${good ? 'delta-good' : 'delta-bad'}">${sign}${diff.toFixed(digits)}${unit}</span>`;
}

function renderVariantsComparator() {
  const card = document.getElementById('variantsCompareCard');
  if (!card) return;
  syncActiveVariantSnapshot();

  if (appState.variants.length <= 1) {
    card.classList.add('hidden');
    variantsChartMeta = null;
    return;
  }

  card.classList.remove('hidden');
  const pal = getChartPalette();

  // S'assurer qu'au moins une variante est cochée
  appState.compareVariantIds = appState.compareVariantIds.filter(id =>
    appState.variants.some(v => v.id === id)
  );
  if (appState.compareVariantIds.length === 0) {
    appState.compareVariantIds = appState.variants.map(v => v.id);
  }

  const selectedEntries = [];
  appState.variants.forEach((v, idx) => {
    const color = pal.series[idx % pal.series.length];
    if (appState.compareVariantIds.includes(v.id)) {
      const vRes = simulateVariantFast(v);
      selectedEntries.push({
        id: v.id,
        name: v.name,
        project: v.project,
        color,
        res: vRes,
        wf: vRes.worstFloor
      });
    }
  });

  const ref = selectedEntries[0];
  const refIsMan = Boolean(ref?.res?.isManualDesignDay);
  const refD24 = ref?.wf?.day24 || ref?.wf;
  const isMinergieRef = ref?.project?.projectType === 'minergie';
  const refHours = ref
    ? refIsMan
      ? isMinergieRef
        ? refD24.overMinergie265
        : refD24.overSIA
      : isMinergieRef
        ? ref.wf.overMinergie265
        : ref.wf.overSIA
    : 0;
  const refMaxT = ref ? (refIsMan ? refD24.maxTop : ref.wf.summerMaxTop) : 0;
  const refScore = ref ? ref.wf.score : 0;
  const refCool = ref ? (refIsMan ? refD24.coolKWhm2 : ref.wf.coolKWhm2) : 0;

  const tableWrap = document.getElementById('variantCompareTableWrap');
  tableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Variante</th>
          <th class="num" data-tip="Heures de dépassement selon l'exigence de chaque variante (et écart Δ vs la 1ère variante cochée).">Surchauffe</th>
          <th class="num" data-tip="Heures d'occupation au-dessus de 26.5 °C.">&gt; 26.5 °C</th>
          <th class="num" data-tip="Température intérieure maximale [°C].">${refIsMan ? 'Pic (24 h)' : 'Pic été'}</th>
          <th class="num" data-tip="Facteur solaire moyen g_total / inertie [Wh/m²K] / ventilation nuit [m³/(h·m²)].">g_tot / Inertie / Nuit</th>
          <th class="num" data-tip="Besoin utile de froid actif et puissance de pointe pour 0 h de surchauffe.">Froid actif</th>
          <th class="num" data-tip="Score global de résilience sur 100.">Score</th>
          <th>Statut</th>
        </tr>
      </thead>
      <tbody>
        ${selectedEntries
          .map((e, i) => {
            const isMan = Boolean(e.res.isManualDesignDay);
            const ed24 = e.wf.day24 || e.wf;
            const isM = e.project.projectType === 'minergie';
            const hrs = isMan
              ? isM
                ? ed24.overMinergie265
                : ed24.overSIA
              : isM
                ? e.wf.overMinergie265
                : e.wf.overSIA;
            const h265 = isMan ? ed24.overMinergie265 : e.wf.overMinergie265;
            const pkT = isMan ? ed24.maxTop : e.wf.summerMaxTop;
            const coolE = isMan ? ed24.coolKWhm2 : e.wf.coolKWhm2;
            const coolW = isMan ? ed24.maxCoolWm2 : e.wf.maxCoolWm2;
            const lim = isM ? 100 : e.res.limHours;
            const ok = isMan ? hrs === 0 : hrs <= lim;
            const isRef = i === 0;
            const isAct = e.id === appState.activeVariantId;
            return `<tr style="${isAct ? 'background:rgba(168,199,250,0.08);' : ''}">
              <td>
                <div style="display:flex;align-items:center;gap:7px;">
                  <span class="variant-color-dot" style="background:${e.color};"></span>
                  <button class="btn btn-sm" data-jump-var="${escapeHtml(e.id)}" style="padding:2px 8px;font-size:11.5px;border-color:${isAct ? 'var(--primary)' : 'var(--border)'};" data-tip="Afficher le rapport détaillé de cette variante.">
                    ${escapeHtml(e.name)}${isRef ? ' (Réf.)' : ''}
                  </button>
                </div>
              </td>
              <td class="num"><strong>${hrs} ${isMan ? 'h/j' : 'h/an'}</strong>${isRef ? '' : fmtDeltaTag(hrs - refHours, ' h', true, 0)}</td>
              <td class="num">${h265} ${isMan ? 'h/j' : 'h'}</td>
              <td class="num"><strong>${pkT.toFixed(1)} °C</strong>${isRef ? '' : fmtDeltaTag(pkT - refMaxT, '°', true, 1)}</td>
              <td class="num" style="font-size:11.5px;">${e.wf.avgGtot.toFixed(2)} • ${e.wf.floor.cSpec.toFixed(0)} • ${e.wf.nomNightSpec.toFixed(1)}</td>
              <td class="num">${coolE.toFixed(isMan ? 2 : 1)} ${isMan ? 'kWh/(m²·j)' : 'kWh/m²'} <span style="color:var(--text-muted);">(${coolW.toFixed(0)} W/m²)</span>${isRef ? '' : fmtDeltaTag(coolE - refCool, '', true, isMan ? 2 : 1)}</td>
              <td class="num"><strong>${e.wf.score}/100</strong>${isRef ? '' : fmtDeltaTag(e.wf.score - refScore, '', false, 0)}</td>
              <td>${badge(ok, 'Conforme', 'Dépassé')}</td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>
  `;

  tableWrap.querySelectorAll('[data-jump-var]').forEach(btn => {
    btn.addEventListener('click', () => {
      const vid = btn.dataset.jumpVar;
      appState.compareMode = false;
      if (vid !== appState.activeVariantId) {
        switchVariant(vid);
        notifyResultsVariantChange();
      } else {
        refreshCompareView();
      }
    });
  });

  const allManualDay = selectedEntries.length > 0 && selectedEntries.every(e => Boolean(e.res?.isManualDesignDay));
  const vWinEl = document.getElementById('variantPlotWindow');
  if (vWinEl) vWinEl.classList.toggle('hidden', allManualDay);
  const winMode = allManualDay ? 'day24' : vWinEl?.value || 'hottest14';
  requestAnimationFrame(() => {
    variantsChartMeta = drawVariantsComparisonChart(selectedEntries, winMode, appState.activeVariantId);
    const noteEl = document.getElementById('variantLimitMismatchNote');
    if (noteEl) {
      if (variantsChartMeta && variantsChartMeta.limitDiffers) {
        const grpDesc = (variantsChartMeta.limitGroups || [])
          .map(
            g =>
              `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;"><span class="variant-color-dot" style="background:${g.rep.color};"></span><strong>Lim. ${escapeHtml(g.tag)}</strong> (${g.members.map(m => escapeHtml(m.name)).join(', ')})</span>`
          )
          .join('');
        noteEl.innerHTML =
          `<strong>Limites distinctes tracées sur le graphique :</strong> chaque courbe limite en pointillés est tracée dans la couleur de sa variante afin de comparer clairement les exigences (ex. ventilation naturelle Fig. 3 vs VMC Fig. 4, Minergie ou Custom).<div style="margin-top:4px;">${grpDesc}</div>`;
        noteEl.classList.remove('hidden');
      } else {
        noteEl.classList.add('hidden');
      }
    }
  });
}

export function refreshCompareView() {
  const hasMulti = appState.variants.length > 1;
  if (!hasMulti) {
    appState.compareMode = false;
  }
  const isCompare = hasMulti && Boolean(appState.compareMode);

  document.getElementById('resTabReportPane')?.classList.toggle('hidden', isCompare);
  document.getElementById('resTabComparePane')?.classList.toggle('hidden', !isCompare);

  const multiFloor = (appState.lastResults?.floorResults?.length || 0) > 1;
  document.getElementById('resFloorSelect')?.classList.toggle('hidden', isCompare || !multiFloor);

  if (isCompare) {
    renderVariantsComparator();
  } else {
    requestAnimationFrame(() => {
      redrawSimpleChart();
      redrawOpenDrawerCharts();
    });
  }
}

function redrawOpenDrawerCharts() {
  if (!lastRenderCtx) return;
  const { res, activeFR, project } = lastRenderCtx;
  const isManual = Boolean(res.isManualDesignDay);
  const pWinEl = document.getElementById('plotWindow');
  if (pWinEl) pWinEl.classList.toggle('hidden', isManual);

  if (document.getElementById('drawer-charts')?.open) {
    const winMode = isManual ? 'day24' : pWinEl?.value || 'hottest14';
    const compareFloors = Boolean(document.getElementById('plotCompareFloors')?.checked);
    timeChartMeta = drawTimeChart(res, activeFR, winMode, compareFloors);
    drawSIAChart(activeFR, project.siaCurveMode, project);
    drawBalanceChart(activeFR);
  }
  if (document.getElementById('drawer-gains')?.open) {
    drawOrientChart(activeFR);
  }
  if (document.getElementById('drawer-comfort')?.open) {
    drawAdaptiveComparisonChart(activeFR, project.siaCurveMode);
  }
}

function redrawSimpleChart() {
  if (!lastRenderCtx) return;
  const { res, activeFR, project } = lastRenderCtx;
  const isMinergie = project.projectType === 'minergie';
  const isCustom = project.projectType === 'custom';
  const isManual = Boolean(res.isManualDesignDay);
  const sWinEl = document.getElementById('simplePlotWindow');
  if (sWinEl) sWinEl.classList.toggle('hidden', isManual);

  const winMode = isManual ? 'day24' : sWinEl?.value || 'hottest14';
  const compareFloors = Boolean(document.getElementById('simpleCompareFloors')?.checked);

  const titleMap = {
    day24: 'Évolution horaire — Journée type (00h–23h, régime établi)',
    hottest14: 'Évolution des températures — 14 jours les plus chauds',
    summer: 'Évolution des températures — Été complet (juin–août)',
    year: 'Évolution des températures — Année complète (8760 h)'
  };
  const titleEl = document.getElementById('simpleChartTitle');
  if (titleEl) titleEl.textContent = titleMap[winMode] || titleMap.hottest14;

  const limitLabel = isMinergie
    ? 'Seuil Minergie (26.5 °C)'
    : isCustom
      ? 'Limite personnalisée'
      : project.siaCurveMode === 'fig4'
        ? 'SIA 180 Fig. 4 (VMC)'
        : 'SIA 180 Fig. 3 (nat.)';

  const subEl = document.getElementById('simpleChartSub');
  if (subEl) {
    subEl.textContent = isManual
      ? `Profil heure par heure (00h à 23h) sur une journée type : température intérieure (bleu), extérieure (gris) et limite « ${limitLabel} » (vert). Zone rouge = dépassement.`
      : `Compare la température intérieure (bleu) à la température extérieure (gris) et à la limite « ${limitLabel} » (vert). Zone rouge = dépassement.`;
  }

  simpleChartMeta = drawSimpleHeatwaveChart(res, activeFR, limitLabel, winMode, compareFloors);
}

function syncToggleAllDrawersBtn() {
  const btn = document.getElementById('btnToggleAllAdvDetails');
  if (!btn) return;
  const drawers = [...document.querySelectorAll('#advDrawersContainer .adv-drawer')];
  const allOpen = drawers.length > 0 && drawers.every(d => d.open);
  btn.textContent = allOpen ? '− Tout replier' : `+ Tout déplier (${drawers.length} rubriques)`;
}

export function renderResultsView(onEnsureSimulation) {
  if (!appState.lastResults) onEnsureSimulation();
  const res = appState.lastResults;
  const { project } = appState;
  const isManual = Boolean(res.isManualDesignDay);

  const multiFloor = res.floorResults.length > 1;
  const sel = document.getElementById('resFloorSelect');
  const prev = sel.value;
  const isMinergie = project.projectType === 'minergie';
  sel.innerHTML =
    `<option value="WORST">Étage critique (${escapeHtml(res.worstFloor.floor.name)})</option>` +
    res.floorResults
      .map(fr => {
        const hrsVal = isManual
          ? isMinergie
            ? fr.day24?.overMinergie265 ?? 0
            : fr.day24?.overSIA ?? 0
          : isMinergie
            ? fr.overMinergie265
            : fr.overSIA;
        return `<option value="${escapeHtml(fr.floor.id)}">${escapeHtml(fr.floor.name)} (${hrsVal} ${isManual ? 'h/j' : 'h'})</option>`;
      })
      .join('');
  sel.value =
    multiFloor && prev && (prev === 'WORST' || res.floorResults.some(fr => fr.floor.id === prev))
      ? prev
      : 'WORST';

  // Masquer les contrôles multi-étages s'il n'y a qu'un seul étage
  sel.classList.toggle('hidden', !multiFloor);
  document.getElementById('simpleCompareFloorsWrap')?.classList.toggle('hidden', !multiFloor);
  document.getElementById('plotCompareFloorsWrap')?.classList.toggle('hidden', !multiFloor);
  const flTabBtn = document.getElementById('subTabFloorsBtn');
  if (flTabBtn) {
    flTabBtn.classList.toggle('hidden', !multiFloor);
    if (!multiFloor && flTabBtn.classList.contains('active')) {
      document.querySelector('.sub-tab[data-sub="m3"]')?.click();
    }
  }

  const activeFR =
    sel.value === 'WORST' ? res.worstFloor : res.floorResults.find(fr => fr.floor.id === sel.value);
  const d24 = activeFR.day24 || activeFR;
  const limH = res.limHours;
  const mainH = isManual
    ? isMinergie
      ? d24.overMinergie265
      : d24.overSIA
    : isMinergie
      ? activeFR.overMinergie265
      : activeFR.overSIA;
  const pass = isManual ? mainH === 0 : mainH <= limH;
  const coolOk = activeFR.maxCoolWm2 <= 12.0;

  lastRenderCtx = { res, activeFR, project };

  document.getElementById('resProjectTitle').textContent = `${project.name} — ${activeFR.floor.name}`;
  document.getElementById('resSubMeta').textContent = isManual
    ? `${res.weatherLabel} • Journée type 24 h (régime établi) • θ_e : ${res.minTe.toFixed(1)}..${res.maxTe.toFixed(1)} °C`
    : `${res.weatherLabel}${project.foehnExposed ? ' • Zone föhn' : ''}  •  θ_e : ${res.minTe.toFixed(1)}..${res.maxTe.toFixed(1)} °C (${res.tropicalNights} nuits tropicales)`;

  // 1. RAPPORT SIMPLE (TOUJOURS AFFICHÉ PAR DÉFAUT)
  renderSimpleReport(res, activeFR, project);

  // Badges synthétiques sur les en-têtes des tiroirs dépliables
  const diagBadge = document.getElementById('drawerBadgeDiag');
  if (diagBadge) {
    const uStr = isManual ? 'h/j' : 'h';
    diagBadge.textContent = pass ? `Conforme (${mainH} ${uStr})` : `Dépassé (${mainH} ${uStr})`;
    diagBadge.className = `pill ${pass ? 'ok' : 'ko'}`;
  }
  const comfBadge = document.getElementById('drawerBadgeComfort');
  if (comfBadge) {
    comfBadge.textContent = `EN Cat. II : ${activeFR.comfort.en16798.cat2OkPct.toFixed(0)} % • PMV ${activeFR.comfort.fanger.meanPmv >= 0 ? '+' : ''}${activeFR.comfort.fanger.meanPmv.toFixed(2)}`;
    comfBadge.className = `pill ${activeFR.comfort.en16798.cat2OkPct >= 97 ? 'ok' : 'warn'}`;
  }

  // 2. CONTENU DES TIROIRS AVANCÉS
  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi-box" data-tip="Heures d'occupation dépassant la limite active, et heures dépassant le seuil fixe de 26.5 °C.">
      <div class="kpi-label">${isManual ? 'Surchauffe (journée type)' : 'Heures de surchauffe'}</div>
      <div class="kpi-val" style="color:${pass ? 'var(--ok)' : 'var(--ko)'}">${isManual ? `${d24.overSIA} h / 24 h` : `${activeFR.overSIA} h/an`}</div>
      <div class="kpi-sub">&gt; 26.5 °C : <strong>${isManual ? `${d24.overMinergie265} h/j` : `${activeFR.overMinergie265} h/an`}</strong>${isManual ? '' : ` (tol. ≤ ${limH} h)`}</div>
    </div>
    <div class="kpi-box" data-tip="Plage de température opérative intérieure θ_op (30 % air + 70 % surfaces), heure du pic et degrés-heures cumulés.">
      <div class="kpi-label">Température opérative (Min / Max)</div>
      <div class="kpi-val" style="color:${(isManual ? d24.maxTop : activeFR.maxTop) > 28 ? 'var(--ko)' : 'var(--primary)'}">${(isManual ? d24.minTop : activeFR.minTop).toFixed(1)} / ${(isManual ? d24.maxTop : activeFR.maxTop).toFixed(1)} °C</div>
      <div class="kpi-sub">${isManual ? `Pic à ${String(d24.maxTopHod).padStart(2, '0')}h00 • Min à ${String(d24.minTopHod).padStart(2, '0')}h00 (${d24.dhSIA.toFixed(1)} Kh/j)` : `Été : <strong>${activeFR.summerMinTop.toFixed(1)}..${activeFR.summerMaxTop.toFixed(1)} °C</strong> • Pic ${formatDayOfYearFR(Math.floor(activeFR.maxTopHour / 24))} à ${activeFR.maxTopHour % 24}h (${activeFR.dhSIA.toFixed(1)} Kh)`}</div>
    </div>
    <div class="kpi-box" data-tip="Indice synthétique sur 100 combinant heures de dépassement, température maximale, efficacité des stores (g_tot), masse thermique et ventilation nocturne.">
      <div class="kpi-label">Score de résilience estivale</div>
      <div class="kpi-val" style="color:${activeFR.score >= 75 ? 'var(--ok)' : activeFR.score >= 45 ? 'var(--warn)' : 'var(--ko)'}">${activeFR.score} / 100</div>
      <div class="kpi-sub">Synthèse physique 5R1C</div>
    </div>
    <div class="kpi-box" data-tip="Pourcentage d'heures occupées respectant la Catégorie II européenne (EN 16798-1), vote PMV moyen estival (ISO 7730) et heures nocturnes > 26 °C (OMS).">
      <div class="kpi-label">Confort EN 16798-1 / PMV été</div>
      <div class="kpi-val" style="color:${activeFR.comfort.en16798.cat2OkPct >= 97 ? 'var(--ok)' : 'var(--warn)'}">${activeFR.comfort.en16798.cat2OkPct.toFixed(0)} % Cat.II</div>
      <div class="kpi-sub">PMV moy. ${activeFR.comfort.fanger.meanPmv >= 0 ? '+' : ''}${activeFR.comfort.fanger.meanPmv.toFixed(2)} • OMS nuit &gt;26°C : ${activeFR.comfort.healthSleep.nightOver26H} h</div>
    </div>
    <div class="kpi-box" data-tip="Puissance frigorifique spécifique et besoin de froid qui seraient nécessaires pour maintenir 0 heure de surchauffe (référence SIA : ≤ 12 W/m²).">
      <div class="kpi-label">Puissance froid fictive (0 h)</div>
      <div class="kpi-val" style="color:${(isManual ? d24.maxCoolWm2 : activeFR.maxCoolWm2) <= 12.0 ? 'var(--ok)' : 'var(--warn)'}">${(isManual ? d24.maxCoolWm2 : activeFR.maxCoolWm2).toFixed(1)} W/m²</div>
      <div class="kpi-sub">${isManual ? `${d24.coolKWhm2.toFixed(2)} kWh/(m²·j)` : `${activeFR.coolKWhm2.toFixed(1)} kWh/(m²·an)`} — Seuil SIA 12 W/m²</div>
    </div>
    <div class="kpi-box" data-tip="Capacité nominale d'évacuation d'air par les ouvrants nocturnes sous un écart intérieur/extérieur de 8 K (objectif recommandé ≥ 10 m³/(h·m²)).">
      <div class="kpi-label">Déstockage nocturne (ΔT=8 K)</div>
      <div class="kpi-val">${activeFR.nomNightSpec.toFixed(1)} m³/(h·m²)</div>
      <div class="kpi-sub">${activeFR.nomNightM3h.toFixed(0)} m³/h (${(activeFR.nomNightM3h / Math.max(1, activeFR.fp.vol)).toFixed(1)} vol/h)</div>
    </div>
  `;

  renderDetailedGainsSection(activeFR);

  // Onglet Simulation & Verdict
  const occDayCount =
    activeFR.floor.occEnd >= activeFR.floor.occStart
      ? Math.max(1, activeFR.floor.occEnd - activeFR.floor.occStart)
      : Math.max(1, 24 - activeFR.floor.occStart + activeFR.floor.occEnd);
  document.getElementById('sub-m3').innerHTML = `
    <div style="margin-bottom:8px;">
      Verdict SIA 180 : ${badge(isManual ? d24.overSIA === 0 : activeFR.passSIA)}
      &nbsp; Seuil 26.5 °C : ${
        isManual
          ? badge(d24.overMinergie265 === 0, `${d24.overMinergie265} h / 24 h`, `${d24.overMinergie265} h / 24 h`)
          : badge(activeFR.overMinergie265 <= 100, `${activeFR.overMinergie265} h ≤ 100 h`, `${activeFR.overMinergie265} h > 100 h`)
      }
      &nbsp; ${badge((isManual ? d24.maxCoolWm2 : activeFR.maxCoolWm2) <= 12.0, 'Froid fictif ≤ 12 W/m²', 'Froid fictif > 12 W/m²', true)}
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Critère</th><th class="num">Valeur</th><th>Statut / Référence</th></tr></thead>
      <tbody>
        <tr data-tip="Nombre d'heures où le local est occupé selon l'horaire défini à l'étape 5."><td>Heures d'occupation analysées</td><td class="num">${isManual ? `${occDayCount} h / 24 h` : `${activeFR.occH} h/an`}</td><td>${activeFR.floor.occStart}h–${activeFR.floor.occEnd}h (${activeFR.floor.occDays} j/sem)</td></tr>
        <tr data-tip="Heures occupées où la température opérative dépasse la limite supérieure adaptative SIA 180."><td>Heures de surchauffe SIA 180 (courbe adaptative)</td><td class="num"><strong>${isManual ? `${d24.overSIA} h / 24 h` : `${activeFR.overSIA} h/an`}</strong> (${(isManual ? d24.dhSIA : activeFR.dhSIA).toFixed(1)} ${isManual ? 'Kh/j' : 'Kh'})</td><td>${badge(isManual ? d24.overSIA === 0 : activeFR.passSIA, isManual ? '0 h/j' : `≤ ${limH} h/an`, isManual ? '> 0 h/j' : `> ${limH} h/an`)}</td></tr>
        <tr data-tip="Heures où la température opérative dépasse 26.5 °C."><td>Heures θ_op &gt; 26.5 °C ${isManual ? '(journée type 24 h)' : '(occupation / 8760 h)'}</td><td class="num"><strong>${isManual ? `${d24.overMinergie265} h / 24 h` : `${activeFR.overMinergie265} h`}</strong>${isManual ? '' : ` / ${activeFR.over265All} h`}</td><td>${badge(isManual ? d24.overMinergie265 === 0 : activeFR.overMinergie265 <= 100, isManual ? '0 h/j' : '≤ 100 h/an', isManual ? '> 0 h/j' : '> 100 h/an')}</td></tr>
        <tr data-tip="Puissance de pointe et énergie de refroidissement théoriques pour éliminer tout dépassement."><td>Puissance / besoin froid actif pour 0 h de surchauffe</td><td class="num"><strong>${isManual ? `${d24.coolKWhm2.toFixed(2)} kWh/(m²·j)` : `${activeFR.coolKWhm2.toFixed(1)} kWh/(m²·an)`}</strong> (${(isManual ? d24.coolKWh : activeFR.coolKWh || 0).toFixed(isManual ? 1 : 0)} kWh) • ${(isManual ? d24.maxCoolWm2 : activeFR.maxCoolWm2).toFixed(1)} W/m²</td><td>${
          activeFR.activeCooling
            ? badge(
                activeFR.activeCooling.level === 'none' || activeFR.activeCooling.level === 'low',
                activeFR.activeCooling.statusLabel,
                activeFR.activeCooling.statusLabel,
                activeFR.activeCooling.level === 'high'
              )
            : `${(isManual ? d24.maxCoolW : activeFR.maxCoolW).toFixed(0)} W`
        }</td></tr>
        <tr data-tip="Nombre total d'heures (24h/24) où la température dépasse 26 °C."><td>Heures toutes périodes θ_op &gt; 26 °C</td><td class="num">${isManual ? `${d24.over26} h / 24 h` : `${activeFR.over26} h/an`}</td><td>${isManual ? 'Indicateur sur la journée type (24 h)' : "Indicateur d'inconfort global 8760 h"}</td></tr>
      </tbody>
    </table></div>
    <div class="reco-list">${activeFR.recos.map(r => `<div class="reco-item">${r}</div>`).join('')}</div>
  `;

  renderConstructiveTab(activeFR, project);

  // Onglet Scénarios
  const compListAll = res.behavioralScenarios || res.variants;
  const compList = isManual
    ? compListAll.filter(v => !['climate_2035', 'climate_2050'].includes(v.id))
    : compListAll;
  document.getElementById('sub-compare').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr>
        <th data-tip="Variante comportementale ou climatique simulée.">Scénario comparé</th>
        <th data-tip="Paramètres modifiés dans ce scénario.">Hypothèses</th>
        <th class="num" data-tip="Heures d'occupation au-dessus de 26.5 °C.">&gt; 26.5 °C</th>
        <th class="num" data-tip="Heures de dépassement de la courbe SIA 180.">SIA 180</th>
        <th class="num" data-tip="Intensité cumulée de la surchauffe en Kelvins-heures.">Degrés-heures</th>
        <th class="num" data-tip="Température intérieure minimale et maximale atteinte [°C].">θ_op Min / Max</th>
        <th class="num" data-tip="Note globale de résilience sur 100.">Score</th>
      </tr></thead>
      <tbody>${compList
        .map(v => {
          const vd = v.wf.day24 || v.wf;
          return `<tr>
            <td><strong>${escapeHtml(v.label)}</strong></td>
            <td><small style="color:var(--text-muted);">${escapeHtml(v.note)}</small></td>
            <td class="num"><strong>${isManual ? `${vd.overMinergie265} h/j` : `${v.wf.overMinergie265 ?? '—'} h`}</strong></td>
            <td class="num"><strong>${isManual ? `${vd.overSIA} h/j` : `${v.wf.overSIA} h/an`}</strong></td>
            <td class="num">${(isManual ? vd.dhSIA : v.wf.dhSIA).toFixed(1)} ${isManual ? 'Kh/j' : 'Kh'}</td>
            <td class="num">${(isManual ? vd.minTop : v.wf.minTop).toFixed(1)} / ${(isManual ? vd.maxTop : v.wf.maxTop).toFixed(1)} °C</td>
            <td class="num">${badge(v.wf.score >= 70, `${v.wf.score}/100`, `${v.wf.score}/100`)}</td>
          </tr>`;
        })
        .join('')}</tbody>
    </table></div>
  `;

  // Onglet SIA 180 — Fig. 12
  const m2 = activeFR.prescriptive.method2;
  document.getElementById('sub-m2').innerHTML = `
    <div style="margin-bottom:8px;">Méthode 2 (Fig. 12 SIA 180) : ${badge(m2.pass, 'Satisfaite', 'Non satisfaite → Simulation requise')}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Orientation / Critère</th><th class="num">Calculé</th><th class="num">Limite SIA</th><th>Statut</th></tr></thead>
      <tbody>
        ${m2.rows
          .map(
            r => `<tr data-tip="Vérifie que le facteur solaire g_tot sur la façade ${r.orient} ne dépasse pas la courbe limite de la Figure 12 SIA 180 pour ce taux de vitrage.">
              <td>Orientation ${r.orient} (A_vit=${r.winA.toFixed(1)} m², f_g≈${(r.fg * 100).toFixed(0)} %)</td>
              <td class="num">g_tot=${r.maxG.toFixed(3)}</td>
              <td class="num">≤ ${r.limG.toFixed(3)}</td>
              <td>${badge(r.ok, 'OK', 'Trop élevé')}</td>
            </tr>`
          )
          .join('')}
        <tr data-tip="Exigence d'inertie thermique minimale moyenne (45 Wh/(m²·K))."><td>Capacité thermique (EN-102)</td><td class="num">${activeFR.floor.cSpec.toFixed(0)} Wh/(m²·K)</td><td class="num">≥ 45</td><td>${badge(m2.capOk, 'OK', 'Insuffisante')}</td></tr>
        <tr data-tip="Coefficient U maximal de la toiture."><td>Toiture U</td><td class="num">${activeFR.floor.uRoofExt.toFixed(2)} W/(m²·K)</td><td class="num">≤ 0.20</td><td>${badge(m2.roofOk, 'OK', 'Trop élevé')}</td></tr>
        <tr data-tip="Débit minimal de refroidissement nocturne requis par la procédure simplifiée."><td>Refroidissement nocturne</td><td class="num">${activeFR.nomNightSpec.toFixed(1)} m³/(h·m²)</td><td class="num">≥ 10.0</td><td>${badge(m2.nightOk, 'OK', 'Insuffisant')}</td></tr>
      </tbody>
    </table></div>
  `;

  // Onglet SIA 180 — Tab. 8
  const m1 = activeFR.prescriptive.method1;
  document.getElementById('sub-m1').innerHTML = `
    <div style="margin-bottom:8px;">Méthode 1 (Tableau 8 SIA 180) : ${badge(m1.pass, 'Satisfaite', 'Non satisfaite → Méthode 2 ou Simulation')}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Critère simplifié SIA 180</th><th class="num">Valeur</th><th>Statut</th></tr></thead>
      <tbody>${m1.criteria
        .map(c => `<tr><td>${escapeHtml(c.label)}</td><td class="num">${escapeHtml(c.val)}</td><td>${badge(c.ok, 'OK', 'Non respecté')}</td></tr>`)
        .join('')}</tbody>
    </table></div>
  `;

  // Onglet Par étage
  document.getElementById('sub-floors').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Étage</th><th class="num">Surface</th><th class="num">${isManual ? 'θ_op Min / Max (24 h)' : 'θ_op Min / Max'}</th><th class="num">${isManual ? 'Heures > 26 °C' : 'Été Min / Max'}</th><th class="num">&gt; 26.5 °C</th><th class="num">SIA 180</th><th class="num">Froid actif</th><th class="num">Score</th><th>Statut</th></tr></thead>
      <tbody>${res.floorResults
        .map(fr => {
          const fd = fr.day24 || fr;
          const hSia = isManual ? fd.overSIA : fr.overSIA;
          const h265 = isManual ? fd.overMinergie265 : fr.overMinergie265;
          const okF = isManual ? (isMinergie ? h265 : hSia) === 0 : isMinergie ? h265 <= 100 : hSia <= limH;
          return `<tr>
            <td><strong>${escapeHtml(fr.floor.name)}</strong></td>
            <td class="num">${fr.floor.area.toFixed(0)} m²</td>
            <td class="num">${(isManual ? fd.minTop : fr.minTop).toFixed(1)} / ${(isManual ? fd.maxTop : fr.maxTop).toFixed(1)} °C</td>
            <td class="num">${isManual ? `${fd.over26} h / 24 h` : `${fr.summerMinTop.toFixed(1)} / ${fr.summerMaxTop.toFixed(1)} °C`}</td>
            <td class="num">${h265} ${isManual ? 'h/j' : 'h'}</td>
            <td class="num"><strong>${hSia} ${isManual ? 'h/j' : 'h/an'}</strong></td>
            <td class="num">${isManual ? `${fd.coolKWhm2.toFixed(2)} kWh/(m²·j) (${fd.maxCoolWm2.toFixed(1)} W/m²)` : `${fr.coolKWhm2.toFixed(1)} kWh/m² (${fr.maxCoolWm2.toFixed(1)} W/m²)`}</td>
            <td class="num">${fr.score}/100</td>
            <td>${badge(okF, 'Conforme', 'Non conforme')}</td>
          </tr>`;
        })
        .join('')}</tbody>
    </table></div>
  `;

  // Onglet Méthodologie
  document.getElementById('sub-methodology').innerHTML = renderMethodologyPanel(activeFR, project);

  renderComfortSection(activeFR);
  syncToggleAllDrawersBtn();
  refreshCompareView();
}

function buildEngineeringPrintBlocks() {
  if (!lastRenderCtx) return;
  const { res, activeFR, project } = lastRenderCtx;
  const prof = getSIA180Profile(project.projectType, project.customReg);
  const meta = appState.reportMeta || {};
  const curVar = getActiveVariant();
  const isMinergie = project.projectType === 'minergie';
  const isManual = Boolean(res.isManualDesignDay);
  const d24 = activeFR.day24 || activeFR;
  const mainHours = isManual
    ? isMinergie
      ? d24.overMinergie265
      : d24.overSIA
    : isMinergie
      ? activeFR.overMinergie265
      : activeFR.overSIA;
  const mainLimit = isMinergie ? 100 : res.limHours;
  const pass = isManual ? mainHours === 0 : mainHours <= mainLimit;
  const m = activeFR.minergie;
  const g = activeFR.gains;

  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-CH', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const timeStr = now.toLocaleTimeString('fr-CH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  // 1. Cartouche encadré supérieur style Lesosai + en-tête Projet / Vérification sur papier nu
  const hdr = document.getElementById('printReportHeader');
  if (hdr) {
    hdr.innerHTML = `
      <div class="print-lesosai-frame">
        <div class="print-lesosai-left">
          <div><strong>Logiciel :</strong> SIA Thermic Studio v2.0 (Solveur 5R1C ISO 13790 • SIA 180 / Minergie v2023.2)</div>
          <div><strong>Auteur / Bureau d’études :</strong> ${escapeHtml(meta.author || 'Non renseigné')}</div>
          <div><strong>Maître d’ouvrage / Client :</strong> ${escapeHtml(meta.client || 'Non renseigné')}</div>
          <div><strong>Référence dossier :</strong> ${escapeHtml(meta.ref || '—')}</div>
          <div><strong>Imprimé le :</strong> ${dateStr} ${timeStr}</div>
        </div>
        <div class="print-lesosai-logo">
          <span class="print-lesosai-badge">SIA</span>
          <span>Thermic Studio</span>
        </div>
      </div>

      <div class="print-lesosai-meta">
        <div class="print-lesosai-meta-row"><strong>Projet :</strong><span><strong>${escapeHtml(project.name)}</strong>${curVar && appState.variants.length > 1 ? ` — ${escapeHtml(curVar.name)}` : ''}</span></div>
        <div class="print-lesosai-meta-row"><strong>Vérification :</strong><span><strong>${escapeHtml(prof.label)}</strong>${project.projectType !== 'minergie' && project.projectType !== 'custom' ? ` (${project.siaCurveMode === 'fig4' ? 'Courbe Fig. 4 — VMC' : 'Courbe Fig. 3 — Ventilation naturelle'})` : ''}</span></div>
        <div class="print-lesosai-meta-row"><strong>Étage analysé :</strong><span>${escapeHtml(activeFR.floor.name)} (${activeFR.floor.area.toFixed(1)} m², h = ${activeFR.floor.height.toFixed(2)} m)</span></div>
        <div class="print-lesosai-meta-row"><strong>Données climatiques :</strong><span>${escapeHtml(res.weatherLabel)} (θ_e : ${res.minTe.toFixed(1)}..${res.maxTe.toFixed(1)} °C)</span></div>
        <div class="print-lesosai-meta-row"><strong>Verdict global :</strong><span>${badge(pass, 'CONFORME', 'NON CONFORME')}</span></div>
      </div>

      <p class="print-lesosai-intro">
        Justificatif de protection thermique estivale établi par simulation dynamique horaire 5R1C (ISO 13790, pas de 15 min) et contrôle constructif selon les normes suisses SIA 180:2014, SIA 2024:2015, SIA 261/342 et Minergie v2023.2.
      </p>
    `;
  }

  // 2. Remarques de l'ingénieur (si renseignées)
  const cmt = document.getElementById('printReportComments');
  if (cmt) {
    const cleanTxt = String(meta.comments || '').trim();
    cmt.innerHTML = cleanTxt
      ? `<div class="print-eng-comments"><div style="font-weight:700;margin-bottom:3pt;">Remarques &amp; conclusions de l’ingénieur</div>${escapeHtml(cleanTxt)}</div>`
      : '';
  }

  // 3. Tableau papier de synthèse des résultats (remplace les cartes KPI / bannière web en impression)
  const sumEl = document.getElementById('printReportSummary');
  if (sumEl) {
    const peakT = isManual ? d24.maxTop : activeFR.summerMaxTop;
    const rows = [
      [
        'Confort estival',
        isManual ? 'Surchauffe (journée type 24 h)' : isMinergie ? 'Simulation > 26.5 °C (16 avr.–15 oct.)' : 'Heures de surchauffe',
        isManual ? `${mainHours} h / 24 h` : `${mainHours} h/an`,
        isManual ? '0 h / 24 h' : `≤ ${mainLimit} h/an`,
        badge(pass, 'Conforme', 'Non conforme')
      ],
      [
        'Température intérieure',
        isManual ? 'θ_op maximale / minimale (24 h)' : 'θ_op maximale en été (Mai–Sept)',
        isManual
          ? `${d24.maxTop.toFixed(1)} °C (${String(d24.maxTopHod).padStart(2, '0')}h) / ${d24.minTop.toFixed(1)} °C (${String(d24.minTopHod).padStart(2, '0')}h)`
          : `${peakT.toFixed(1)} °C (nuits > 26 °C : ${activeFR.comfort.healthSleep.nightOver26H} h)`,
        '≤ 26.5–28.0 °C reco.',
        badge(peakT <= 28.0, 'OK', 'Élevée', true)
      ],
      [
        'Protection solaire',
        'Facteur g_tot effectif / Bilan Minergie',
        m ? `${m.gTotEffective.toFixed(3)} (bilan ${m.bilanPct.toFixed(1)} %)` : `${activeFR.avgGtot.toFixed(3)}`,
        m ? `g_tot,adm ≤ ${m.gTotAuthorized.toFixed(3)} (≤ 100 %)` : '≤ 0.150',
        m ? badge(m.constructivePass, 'Conforme', 'Dépassé') : '—'
      ],
      [
        'Inertie thermique',
        'Capacité C_R / A_SNP (Minergie / 5R1C)',
        m ? `${m.thermalMassWhm2K.toFixed(1)} Wh/(m²·K) (5R1C : ${activeFR.floor.cSpec.toFixed(0)})` : `${activeFR.floor.cSpec.toFixed(0)} Wh/(m²·K)`,
        '≥ 30 min. (plafond 75)',
        badge((m ? m.thermalMassWhm2K : activeFR.floor.cSpec) >= 30, 'OK', 'Faible')
      ],
      [
        'Résistance au vent',
        'Classe stores SIA 342 (profil SIA 261)',
        m ? `Classe ${m.windRec.minClass} (v = ${m.windRec.gustKmh.toFixed(1)} km/h)` : '—',
        `H = ${m ? m.buildingHeightM.toFixed(1) : '5.0'} m • Cat. ${project.terrainCat || 'III'}${project.foehnExposed ? ' • Föhn' : ''}`,
        m ? badge(m.allWindSafe, 'Respectée', 'Non protégé') : '—'
      ],
      [
        'Aération nocturne',
        'Débit nominal de déstockage (ΔT = 8 K)',
        `${activeFR.nomNightSpec.toFixed(1)} m³/(h·m²) (${(activeFR.nomNightM3h / Math.max(1, activeFR.fp.vol)).toFixed(1)} vol/h)`,
        '≥ 10.0 m³/(h·m²)',
        badge(activeFR.nomNightSpec >= 10, 'Efficace', activeFR.nomNightSpec > 0 ? 'Modérée' : 'Absente', activeFR.nomNightSpec > 0)
      ],
      [
        'Charges internes',
        `Apports journaliers (${m?.roomType2024?.label || 'SIA 2024'})`,
        `${g.internalTotal.dailyWhm2d.toFixed(1)} Wh/(m²·j) (${g.internalTotal.peakW.toFixed(0)} W pointe)`,
        `Réf. SIA 2024 : ${m ? m.internalLoadRefWhm2d : 84} Wh/(m²·j)`,
        badge(g.internalTotal.dailyWhm2d <= (m ? m.internalLoadRefWhm2d * 1.15 : 100), 'Maîtrisées', 'Élevées', true)
      ],
      [
        'Résilience globale',
        'Score synthétique & froid fictif (0 h)',
        `${activeFR.score} / 100 • Froid : ${isManual ? `${d24.coolKWhm2.toFixed(2)} kWh/(m²·j) (${d24.maxCoolWm2.toFixed(1)} W/m²)` : `${activeFR.coolKWhm2.toFixed(1)} kWh/m² (${activeFR.maxCoolWm2.toFixed(1)} W/m²)`}`,
        'Seuil SIA ≤ 12.0 W/m²',
        badge((isManual ? d24.maxCoolWm2 : activeFR.maxCoolWm2) <= 12.0, 'Passif OK', '> 12 W/m²', true)
      ]
    ];

    sumEl.innerHTML = `
      <div class="print-sec-title">1. Synthèse des résultats et conformité normative</div>
      <table>
        <thead><tr>
          <th style="width:18%;">Désignation</th>
          <th style="width:27%;">Propriété</th>
          <th style="width:23%;">Valeur calculée</th>
          <th style="width:20%;">Exigence / Référence</th>
          <th style="width:12%;">Statut</th>
        </tr></thead>
        <tbody>
          ${rows
            .map(
              r => `<tr>
                <td><strong>${r[0]}</strong></td>
                <td>${r[1]}</td>
                <td>${r[2]}</td>
                <td>${r[3]}</td>
                <td>${r[4]}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
  }

  // 4. Tableau papier des hypothèses du bâtiment
  const inp = document.getElementById('printReportInputs');
  if (inp) {
    const floorRows = project.floors
      .map(fl => {
        const ops = project.openings.filter(o => o.floorId === fl.id);
        const winGross = ops.reduce((s, o) => s + o.width * o.height * o.qty, 0);
        const winGlass = ops.reduce((s, o) => s + o.width * o.height * o.qty * (o.frameFactor ?? 0.78), 0);
        const vmcSchedLbl =
          fl.vmcSchedule === '24h'
            ? '24h/24'
            : fl.vmcSchedule === 'occ_only'
              ? 'occ.'
              : 'bypass nuit';
        const vmcTxt = fl.hasMechVent
          ? `VMC (η=${Math.round((fl.etaWRG || 0) * 100)} %, q=${fl.qHygSpec}, ${vmcSchedLbl})`
          : `Naturelle (q=${fl.qHygSpec})${fl.dayVentMode === 'window_occ' ? ' + fen. jour' : ''}`;
        return `<tr>
          <td><strong>${escapeHtml(fl.name)}</strong></td>
          <td class="num">${fl.area.toFixed(1)} m² / h=${fl.height.toFixed(2)} m</td>
          <td class="num">${(fl.cSpecMinergie ?? Math.min(75, fl.cSpec)).toFixed(1)} / ${fl.cSpec.toFixed(0)} Wh/m²K</td>
          <td class="num">U_mur=${fl.uWallExt.toFixed(2)} • U_toit=${fl.uRoofExt.toFixed(2)}</td>
          <td class="num">A_G=${winGlass.toFixed(2)} m² (${winGross.toFixed(2)} brut)</td>
          <td>${vmcTxt}</td>
        </tr>`;
      })
      .join('');
    inp.innerHTML = `
      <div class="print-sec-title">2. Hypothèses et caractéristiques du bâtiment</div>
      <table>
        <thead><tr>
          <th>Étage / Local</th>
          <th class="num">Surface / Hauteur</th>
          <th class="num">Inertie (Minergie / 5R1C)</th>
          <th class="num">Enveloppe opaque</th>
          <th class="num">Vitrages (verre net / brut)</th>
          <th>Ventilation diurne</th>
        </tr></thead>
        <tbody>${floorRows}</tbody>
      </table>
    `;
  }

  // 5. Tableau papier des scénarios comportementaux (remplace les barres web en impression)
  const scenEl = document.getElementById('printReportScenarios');
  if (scenEl) {
    const allowedIds = isManual
      ? ['current', 'no_blinds', 'no_night', 'both_bad', 'optimal']
      : ['current', 'no_blinds', 'no_night', 'both_bad', 'optimal', 'climate_2035', 'climate_2050'];
    const scList = (res.behavioralScenarios || []).filter(s => allowedIds.includes(s.id));
    scenEl.innerHTML = `
      <div class="print-sec-title">3. Sensibilité comportementale &amp; scénarios</div>
      <table>
        <thead><tr>
          <th>Scénario</th>
          <th>Hypothèses</th>
          <th class="num">${isManual ? 'Surchauffe (24 h)' : isMinergie ? '> 26.5 °C' : 'Surchauffe'}</th>
          <th class="num">Pic θ_op</th>
          <th>Statut</th>
        </tr></thead>
        <tbody>
          ${scList
            .map(s => {
              const hrs = isManual
                ? isMinergie
                  ? s.wf.day24?.overMinergie265 ?? 0
                  : s.wf.day24?.overSIA ?? 0
                : isMinergie
                  ? s.wf.overMinergie265
                  : s.wf.overSIA;
              const pk = isManual ? (s.wf.day24?.maxTop ?? s.wf.maxTop) : s.wf.maxTop;
              const ok = isManual ? hrs === 0 : hrs <= mainLimit;
              return `<tr>
                <td><strong>${escapeHtml(s.label)}</strong></td>
                <td>${escapeHtml(s.note)}</td>
                <td class="num"><strong>${isManual ? `${hrs} h / 24 h` : `${hrs} h/an`}</strong></td>
                <td class="num">${pk.toFixed(1)} °C</td>
                <td>${badge(ok, 'Conforme', 'Dépassé')}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    `;
  }
}

function openPdfReportModal() {
  const modal = document.getElementById('pdfReportModal');
  if (!modal) {
    window.print();
    return;
  }
  const m = appState.reportMeta;
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v || '';
  };
  const setChk = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(v);
  };
  setVal('pdfAuthor', m.author);
  setVal('pdfClient', m.client);
  setVal('pdfRef', m.ref);
  setVal('pdfComments', m.comments);
  setChk('pdfIncSummary', m.includeSummary !== false);
  setChk('pdfIncInputs', m.includeInputs !== false);
  setChk('pdfIncScenarios', m.includeScenarios !== false);
  setChk('pdfIncVariants', appState.variants.length > 1 ? Boolean(m.includeVariants || appState.compareMode) : false);
  setChk('pdfIncAdvanced', Boolean(m.includeAdvanced));
  setChk('pdfIncCooling', m.includeCooling !== false);
  document.getElementById('pdfIncVariantsWrap')?.classList.toggle('hidden', appState.variants.length <= 1);
  modal.classList.remove('hidden');
}

function executeEngineeringPdfPrint() {
  const m = appState.reportMeta;
  m.author = document.getElementById('pdfAuthor')?.value || '';
  m.client = document.getElementById('pdfClient')?.value || '';
  m.ref = document.getElementById('pdfRef')?.value || '';
  m.comments = document.getElementById('pdfComments')?.value || '';
  m.includeSummary = Boolean(document.getElementById('pdfIncSummary')?.checked);
  m.includeInputs = Boolean(document.getElementById('pdfIncInputs')?.checked);
  m.includeScenarios = Boolean(document.getElementById('pdfIncScenarios')?.checked);
  m.includeVariants = appState.variants.length > 1 && Boolean(document.getElementById('pdfIncVariants')?.checked);
  m.includeAdvanced = Boolean(document.getElementById('pdfIncAdvanced')?.checked);
  m.includeCooling = Boolean(document.getElementById('pdfIncCooling')?.checked);
  saveWorkspaceToStorage();

  document.getElementById('pdfReportModal')?.classList.add('hidden');
  buildEngineeringPrintBlocks();

  // Sauvegarde l'état visuel actuel pour restauration exacte après impression
  const prevTheme = document.documentElement.dataset.theme;
  const drawers = [...document.querySelectorAll('#advDrawersContainer .adv-drawer')];
  const prevDrawerStates = drawers.map(d => d.open);
  const body = document.body;

  const printClasses = [
    'print-hide-summary',
    'print-hide-inputs',
    'print-hide-scenarios',
    'print-hide-variants',
    'print-force-variants',
    'print-force-report',
    'print-hide-advanced',
    'print-hide-cooling'
  ];
  body.classList.remove(...printClasses);

  if (!m.includeSummary) body.classList.add('print-hide-summary');
  if (!m.includeInputs) body.classList.add('print-hide-inputs');
  if (!m.includeScenarios) body.classList.add('print-hide-scenarios');
  if (!m.includeCooling) body.classList.add('print-hide-cooling');

  if (m.includeSummary || m.includeAdvanced || m.includeCooling || m.includeScenarios) {
    body.classList.add('print-force-report');
  }
  if (m.includeVariants) {
    body.classList.add('print-force-variants');
  } else {
    body.classList.add('print-hide-variants');
  }
  if (!m.includeAdvanced) {
    body.classList.add('print-hide-advanced');
  } else {
    drawers.forEach(d => {
      d.open = true;
    });
  }

  // Passage temporaire en palette papier claire pour que les graphiques Canvas soient nets sur PDF
  document.documentElement.dataset.theme = 'light';
  const cmpPane = document.getElementById('resTabComparePane');
  const repPane = document.getElementById('resTabReportPane');
  const prevCmpHidden = cmpPane?.classList.contains('hidden');
  const prevRepHidden = repPane?.classList.contains('hidden');
  if (m.includeVariants && cmpPane) cmpPane.classList.remove('hidden');
  if (repPane) repPane.classList.remove('hidden');

  if (m.includeVariants) renderVariantsComparator();
  redrawSimpleChart();
  redrawOpenDrawerCharts();

  const restore = () => {
    window.removeEventListener('afterprint', restore);
    body.classList.remove(...printClasses);
    document.documentElement.dataset.theme = prevTheme;
    drawers.forEach((d, idx) => {
      d.open = prevDrawerStates[idx];
    });
    if (cmpPane && prevCmpHidden) cmpPane.classList.add('hidden');
    if (repPane && prevRepHidden) repPane.classList.add('hidden');
    syncToggleAllDrawersBtn();
    requestAnimationFrame(() => {
      if (appState.compareMode && appState.variants.length > 1) {
        renderVariantsComparator();
      } else {
        redrawSimpleChart();
        redrawOpenDrawerCharts();
      }
    });
  };

  window.addEventListener('afterprint', restore);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
    });
  });
}

export function bindResultsEvents({ onEnsureSimulation, onRenderResults, onVariantChanged }) {
  notifyResultsVariantChange = onVariantChanged || (() => {});

  document.getElementById('variantPlotWindow')?.addEventListener('change', () => {
    renderVariantsComparator();
  });

  // Modale de configuration du rapport PDF ingénieur
  const closePdfModal = () => document.getElementById('pdfReportModal')?.classList.add('hidden');
  document.getElementById('btnPrintReport')?.addEventListener('click', openPdfReportModal);
  document.getElementById('btnPdfCancel')?.addEventListener('click', closePdfModal);
  document.getElementById('btnPdfCloseX')?.addEventListener('click', closePdfModal);
  document.getElementById('pdfReportModal')?.addEventListener('click', e => {
    if (e.target.id === 'pdfReportModal') closePdfModal();
  });
  document.getElementById('btnPdfGenerate')?.addEventListener('click', executeEngineeringPdfPrint);

  document.querySelectorAll('.sub-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ['m3', 'minergie', 'compare', 'm2', 'm1', 'floors', 'methodology'].forEach(t => {
        const el = document.getElementById('sub-' + t);
        if (el) el.classList.add('hidden');
      });
      const target = document.getElementById('sub-' + btn.dataset.sub);
      if (target) target.classList.remove('hidden');
    });
  });

  // Redessin automatique des graphiques dès qu'un tiroir avancé est déplié
  document.querySelectorAll('#advDrawersContainer .adv-drawer').forEach(drawer => {
    drawer.addEventListener('toggle', () => {
      syncToggleAllDrawersBtn();
      if (drawer.open) {
        requestAnimationFrame(redrawOpenDrawerCharts);
      }
    });
  });

  document.getElementById('btnToggleAllAdvDetails')?.addEventListener('click', () => {
    const drawers = [...document.querySelectorAll('#advDrawersContainer .adv-drawer')];
    const shouldOpen = !drawers.every(d => d.open);
    drawers.forEach(d => {
      d.open = shouldOpen;
    });
    syncToggleAllDrawersBtn();
    if (shouldOpen) {
      requestAnimationFrame(redrawOpenDrawerCharts);
    }
  });

  const tooltipEl = document.getElementById('chartTooltip');
  const bindHoverTooltip = (canvasId, getMeta, fmtHtml) => {
    const el = document.getElementById(canvasId);
    if (!el) return;
    el.addEventListener('mousemove', e => {
      const meta = getMeta();
      if (!meta) return;
      const { c, i0, i1, pad, pw, activeFR } = meta;
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      if (mx < pad.l || mx > pad.l + pw) {
        tooltipEl.style.display = 'none';
        return;
      }
      const idx = Math.min(i1, Math.max(i0, Math.round(i0 + ((mx - pad.l) / pw) * (i1 - i0))));
      const pt = activeFR.series[idx];
      tooltipEl.innerHTML = fmtHtml(pt, meta);
      tooltipEl.style.display = 'block';
      tooltipEl.style.left = Math.min(window.innerWidth - 260, e.clientX + 14) + 'px';
      tooltipEl.style.top = e.clientY - 12 + 'px';
    });
    el.addEventListener('mouseleave', () => {
      tooltipEl.style.display = 'none';
    });
  };

  const fmtPtHeader = (pt, meta) =>
    meta?.isDay24
      ? `Journée type — ${String(pt.hod).padStart(2, '0')}h00`
      : `${formatDayOfYearFR(pt.d)} — ${String(pt.hod).padStart(2, '0')}h00`;

  bindHoverTooltip(
    'chartTime',
    () => timeChartMeta,
    (pt, meta) => `<strong>${fmtPtHeader(pt, meta)}</strong><br>
      θ_op : <strong>${pt.Top.toFixed(1)} °C</strong> (air ${pt.Tair.toFixed(1)} °C | rad ${pt.Ts.toFixed(1)} °C)<br>
      θ_ext : ${pt.Te.toFixed(1)} °C | Limite : ${pt.limUpper.toFixed(1)} °C<br>
      Gains : sol ${pt.qSol.toFixed(0)} W | int ${pt.qInt.toFixed(0)} W (gens ${(pt.qPeople || 0).toFixed(0)} / lampes ${(pt.qLight || 0).toFixed(0)} / app. ${(pt.qEquip || 0).toFixed(0)})`
  );

  bindHoverTooltip(
    'chartSimpleHeatwave',
    () => simpleChartMeta,
    (pt, meta) => `<strong>${fmtPtHeader(pt, meta)}</strong><br>
      Temp. intérieure : <strong>${pt.Top.toFixed(1)} °C</strong><br>
      Temp. extérieure : ${pt.Te.toFixed(1)} °C<br>
      ${escapeHtml(meta.limitLabel || 'Seuil confort')} : ${pt.limUpper.toFixed(1)} °C`
  );

  // Infobulle dédiée au graphique superposé multi-variantes (affiche la limite propre à chaque variante si elles diffèrent)
  const cmpCanvas = document.getElementById('chartVariantsCompare');
  if (cmpCanvas) {
    cmpCanvas.addEventListener('mousemove', e => {
      if (!variantsChartMeta) return;
      const { c, i0, i1, pad, pw, entries, activeEntry, limitDiffers, getEntryLim } =
        variantsChartMeta;
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      if (mx < pad.l || mx > pad.l + pw) {
        tooltipEl.style.display = 'none';
        return;
      }
      const idx = Math.min(i1, Math.max(i0, Math.round(i0 + ((mx - pad.l) / pw) * (i1 - i0))));
      const refPt = (activeEntry || entries[0]).wf.series[idx];
      const rows = entries
        .map(en => {
          const ownLim = getEntryLim ? getEntryLim(en, idx) : refPt.limUpper;
          const limHint = limitDiffers
            ? ` <span style="color:var(--text-muted);font-size:11px;">(lim. ${ownLim.toFixed(1)} °C)</span>`
            : '';
          return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${en.color};margin-right:5px;"></span>${escapeHtml(en.name)} : <strong>${en.wf.series[idx].Top.toFixed(1)} °C</strong>${limHint}`;
        })
        .join('<br>');
      tooltipEl.innerHTML =
        `<strong>${fmtPtHeader(refPt, variantsChartMeta)}</strong><br>` +
        `${rows}<br>` +
        `<span style="color:var(--text-muted);">Ext. : ${refPt.Te.toFixed(1)} °C${limitDiffers ? '' : ` • Seuil : ${refPt.limUpper.toFixed(1)} °C`}</span>`;
      tooltipEl.style.display = 'block';
      tooltipEl.style.left = Math.min(window.innerWidth - 280, e.clientX + 14) + 'px';
      tooltipEl.style.top = e.clientY - 12 + 'px';
    });
    cmpCanvas.addEventListener('mouseleave', () => {
      tooltipEl.style.display = 'none';
    });
  }

  document.getElementById('resFloorSelect').addEventListener('change', onRenderResults);
  document.getElementById('simplePlotWindow')?.addEventListener('change', () => {
    if (appState.lastResults) requestAnimationFrame(redrawSimpleChart);
  });
  document.getElementById('simpleCompareFloors')?.addEventListener('change', () => {
    if (appState.lastResults) requestAnimationFrame(redrawSimpleChart);
  });
  document.getElementById('plotWindow').addEventListener('change', () => {
    if (appState.lastResults) requestAnimationFrame(redrawOpenDrawerCharts);
  });
  document.getElementById('plotCompareFloors').addEventListener('change', () => {
    if (appState.lastResults) requestAnimationFrame(redrawOpenDrawerCharts);
  });

  document.getElementById('btnExportCSV').addEventListener('click', () => {
    if (!appState.lastResults) onEnsureSimulation();
    const sel = document.getElementById('resFloorSelect').value;
    const fr =
      sel === 'WORST'
        ? appState.lastResults.worstFloor
        : appState.lastResults.floorResults.find(x => x.floor.id === sel);
    const header =
      'Heure;Jour;HeureJour;Te_C;T_rm48_C;T_rmEN_C;Top_C;Tair_C;Ts_rad_C;Limite_Sup_SIA_C;Occupation;Surchauffe_SIA;Q_sol_W;Q_sol_brut_W;Q_int_W;Q_gens_W;Q_lampes_W;Q_appareils_W;Q_tr_W;Q_slab_W;Q_ve_jour_W;Q_ve_nuit_W;Q_froid_actif_W\n';
    const rows = fr.series
      .map(p =>
        [
          p.h,
          p.d + 1,
          p.hod,
          p.Te.toFixed(2),
          p.tRm48.toFixed(2),
          p.tRmEN.toFixed(2),
          p.Top.toFixed(2),
          p.Tair.toFixed(2),
          p.Ts.toFixed(2),
          p.limUpper.toFixed(2),
          p.isOccHour ? 1 : 0,
          p.isOverSIA ? 1 : 0,
          p.qSol.toFixed(1),
          (p.qSolUnshaded ?? p.qSol).toFixed(1),
          p.qInt.toFixed(1),
          (p.qPeople ?? 0).toFixed(1),
          (p.qLight ?? 0).toFixed(1),
          (p.qEquip ?? 0).toFixed(1),
          p.qTr.toFixed(1),
          p.qSlab.toFixed(1),
          p.qVeDay.toFixed(1),
          p.qVeNight.toFixed(1),
          (p.qCool ?? 0).toFixed(1)
        ].join(';')
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'simulation_surchauffe.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
