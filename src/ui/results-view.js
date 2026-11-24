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

import { evaluateThermalComfort } from '../methodology/07-thermal-comfort.js';
import { getSIA180Profile } from '../standards/sia180.js';
import { appState, escapeHtml } from '../state/project-store.js';
import {
  drawAdaptiveComparisonChart,
  drawBalanceChart,
  drawOrientChart,
  drawSIAChart,
  drawSimpleHeatwaveChart,
  drawTimeChart
} from './charts.js';
import { renderMethodologyPanel } from './methodology-view.js';

let timeChartMeta = null;
let simpleChartMeta = null;
let lastRenderCtx = null;

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
        <span data-tip="Énergie et puissance frigorifiques nécessaires pour maintenir 0 heure de surchauffe dans le local, comparées aux seuils suisses SIA 180, SIA 382/1, SIA 2024 et MoPEC (EN-102).">Besoins énergétiques de froid actif (si refroidissement pour 0 h de surchauffe)</span>
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
  const prof = getSIA180Profile(project.projectType);
  const isMinergie = project.projectType === 'minergie';
  const mainHours = isMinergie ? activeFR.overMinergie265 : activeFR.overSIA;
  const mainLimit = isMinergie ? 100 : res.limHours;
  const mainPass = mainHours <= mainLimit;
  const nightPass = activeFR.nomNightSpec >= 10;

  const verdictStatus = mainPass && (!m || m.constructivePass) ? 'ok' : mainPass ? 'warn' : 'ko';
  const verdictTitle =
    verdictStatus === 'ok'
      ? 'Protection thermique estivale conforme'
      : verdictStatus === 'warn'
        ? 'Confort atteint, mais vigilance constructive requise'
        : 'Risque de surchauffe estivale — Mesures nécessaires';

  const floorDisplay = activeFR.floor.name.includes('m²')
    ? escapeHtml(activeFR.floor.name)
    : `${escapeHtml(activeFR.floor.name)} (${activeFR.floor.area.toFixed(0)} m²)`;

  const mainCriterionTxt = isMinergie
    ? `<strong>${activeFR.overMinergie265} h/an &gt; 26.5 °C</strong> (seuil ${escapeHtml(prof.label)} : ≤ 100 h)`
    : `<strong>${activeFR.overSIA} h/an</strong> au-dessus de la limite SIA 180 (seuil ${escapeHtml(prof.label)} : ≤ ${mainLimit} h)`;

  document.getElementById('simpleReportTop').innerHTML = `
    <div class="verdict-banner ${verdictStatus}" data-tip="Verdict global de surchauffe pour l'étage analysé selon l'exigence réglementaire sélectionnée (${escapeHtml(prof.label)}).">
      <div>
        <h3 class="verdict-title">${verdictTitle}</h3>
        <p class="verdict-sub">
          ${floorDisplay} : ${mainCriterionTxt} •
          Température maximale d'été : <strong>${activeFR.summerMaxTop.toFixed(1)} °C</strong>.
        </p>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${m ? badge(m.constructivePass, 'Constructif OK', 'Constructif à revoir', false, 'Vérifie que les protections solaires, la masse thermique et la résistance au vent des stores sont suffisantes.') : ''}
        ${m ? badge(m.comfortPass, `Climat 2035 OK (${m.hoursOver265} h)`, `Climat 2035 : ${m.hoursOver265} h`, false, 'Nombre d\'heures dépassant 26.5 °C sous le climat projeté 2035 (max autorisé : 100 h/an).') : ''}
        ${badge(activeFR.passSIA, `SIA 180 OK (${activeFR.overSIA} h)`, `SIA 180 : ${activeFR.overSIA} h`, false, 'Nombre d\'heures dépassant la limite adaptative SIA 180 pendant l\'occupation.')}
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi-box" data-tip="Nombre total d'heures d'occupation par an où la température intérieure dépasse le seuil de confort (${isMinergie ? '26.5 °C fixe — Minergie' : 'courbe adaptative SIA 180'}).">
        <div class="kpi-label">${isMinergie ? 'Heures > 26.5 °C (Minergie)' : 'Heures de surchauffe (SIA 180)'}</div>
        <div class="kpi-val" style="color:${mainPass ? 'var(--ok)' : 'var(--ko)'}">${mainHours} h/an</div>
        <div class="kpi-sub">Limite autorisée : ≤ ${mainLimit} h/an</div>
      </div>
      <div class="kpi-box" data-tip="Pic de température opérative atteint à l'intérieur pendant la saison estivale (mai–septembre), et nombre d'heures de nuit (22h–07h) au-dessus de 26 °C gênant le sommeil.">
        <div class="kpi-label">Température maximale en été</div>
        <div class="kpi-val" style="color:${activeFR.summerMaxTop > 28 ? 'var(--ko)' : 'var(--primary)'}">${activeFR.summerMaxTop.toFixed(1)} °C</div>
        <div class="kpi-sub">Nuits chaudes (&gt; 26 °C) : ${activeFR.comfort.healthSleep.nightOver26H} h</div>
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
  const maxScenarioHours = Math.max(
    120,
    ...scenarios.map(s => (isMinergie ? s.wf.overMinergie265 : s.wf.overSIA))
  );

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
    .filter(s => ['current', 'no_blinds', 'no_night', 'both_bad', 'optimal', 'climate_2035', 'climate_2050'].includes(s.id))
    .map(s => {
      const hrs = isMinergie ? s.wf.overMinergie265 : s.wf.overSIA;
      const barPct = Math.min(100, (hrs / maxScenarioHours) * 100);
      const ok = hrs <= mainLimit;
      const barCol = ok ? 'var(--ok)' : hrs <= mainLimit * 2 ? 'var(--warn)' : 'var(--ko)';
      const isCurr = s.id === 'current';
      const tip = scenarioTips[s.id] || s.note;
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
            <strong>${hrs} h/an</strong>
            <div style="font-size:11px;color:var(--text-muted);">pic ${s.wf.maxTop.toFixed(1)} °C</div>
          </div>
          <div>
            ${badge(ok, 'Conforme', `${hrs - mainLimit > 0 ? `+${hrs - mainLimit} h` : 'Dépassé'}`, !ok && hrs <= mainLimit * 1.5)}
          </div>
        </div>
      `;
    })
    .join('');

  document.getElementById('simpleReportBottom').innerHTML = `
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
            <tr data-tip="Rapport entre la surface totale des fenêtres (A_G) et la surface de plancher (A_SNP). Plus la proportion vitrée est grande, plus les stores extérieurs doivent être performants.">
              <td>Surface de référence &amp; vitrages (A_G / A_SNP)</td>
              <td class="num">${activeFR.fp.winArea.toFixed(1)} m² / ${activeFR.floor.area.toFixed(0)} m² (<strong>${m ? (m.glazingIndexZg * 100).toFixed(0) : 0} %</strong>)</td>
              <td class="num">Part vitrée modérée</td>
              <td><span class="pill neutral">Quantité</span></td>
            </tr>
            <tr data-tip="Part de l'énergie solaire qui traverse l'ensemble vitrage + store fermé (ex. 0.06 = 6 % entre, 94 % est bloqué). Doit être inférieur au seuil limite SIA 180.">
              <td>Protection solaire (facteur g_total moyen)</td>
              <td class="num"><strong>${activeFR.avgGtot.toFixed(2)}</strong></td>
              <td class="num">≤ ${m ? m.gTotAuthorized.toFixed(2) : '0.15'}</td>
              <td>${m ? badge(m.gTotOk, 'Efficace', 'Trop élevé') : ''}</td>
            </tr>
            <tr data-tip="Classe de résistance au vent minimale (SIA 342) pour que les stores extérieurs puissent rester baissés par temps venteux en été (Classe 5 = 75 km/h, Classe 6 = 92 km/h en zone föhn ou bâtiment élevé).">
              <td>Résistance au vent des stores (SIA 342)</td>
              <td class="num">${project.foehnExposed ? 'Zone föhn' : 'Standard'} (h=${m ? m.buildingHeightM.toFixed(1) : '5'} m)</td>
              <td class="num">${m ? m.windRec.label : 'Classe 5'}</td>
              <td>${m ? badge(m.allWindSafe, 'Stores protégés', 'Non protégé') : ''}</td>
            </tr>
            <tr data-tip="Capacité des dalles et murs à absorber la chaleur diurne sans que la température de l'air ne grimpe trop vite (≥ 30 Wh/m²K minimum, ≥ 45 Wh/m²K recommandé).">
              <td>Inertie thermique du local (C_R / A_SNP)</td>
              <td class="num"><strong>${activeFR.floor.cSpec.toFixed(0)} Wh/(m²·K)</strong></td>
              <td class="num">≥ 30 min. (45 reco.)</td>
              <td>${badge(activeFR.floor.cSpec >= 45, 'Forte', activeFR.floor.cSpec >= 30 ? 'Moyenne' : 'Faible', activeFR.floor.cSpec >= 30)}</td>
            </tr>
            <tr data-tip="Quantité de chaleur dégagée chaque jour par m² à l'intérieur par les occupants, l'éclairage et les appareils électriques (valeur standard logement : 113 Wh/(m²·j)).">
              <td>Charges internes (personnes + lampes + appareils)</td>
              <td class="num"><strong>${g.internalTotal.dailyWhm2d.toFixed(0)} Wh/(m²·j)</strong> (${g.internalTotal.peakW.toFixed(0)} W max)</td>
              <td class="num">Réf. : ${m ? m.internalLoadRefWhm2d : 113} Wh/(m²·j)</td>
              <td>${badge(g.internalTotal.dailyWhm2d <= (m ? m.internalLoadRefWhm2d * 1.15 : 130), 'Maîtrisées', 'Élevées', true)}</td>
            </tr>
            <tr data-tip="Capacité de renouvellement d'air nocturne par les fenêtres ouvertes pour évacuer la chaleur accumulée la journée (≥ 10 m³/(h·m²) recommandé).">
              <td>Ventilation nocturne (rafraîchissement)</td>
              <td class="num"><strong>${activeFR.nomNightSpec.toFixed(1)} m³/(h·m²)</strong> (${(activeFR.nomNightM3h / Math.max(1, activeFR.fp.vol)).toFixed(1)} vol/h)</td>
              <td class="num">≥ 10.0 m³/(h·m²)</td>
              <td>${badge(nightPass, 'Efficace', activeFR.nomNightSpec > 0 ? 'Modérée' : 'Absente', activeFR.nomNightSpec > 0)}</td>
            </tr>
            <tr data-tip="Énergie et puissance frigorifiques qui seraient requises si un système de froid actif maintenait 0 h de surchauffe (seuil SIA 180 / 382/1 : ≤ 12 W/m²).">
              <td>Besoin de froid actif (pour 0 h surchauffe)</td>
              <td class="num"><strong>${activeFR.coolKWhm2.toFixed(1)} kWh/(m²·an)</strong> (${activeFR.maxCoolWm2.toFixed(1)} W/m²)</td>
              <td class="num">≤ 12 W/m² • ≤ ${activeFR.activeCooling ? activeFR.activeCooling.thresholds.energyExcessiveKWhm2 : 20} kWh/m²</td>
              <td>${
                !activeFR.activeCooling || !activeFR.activeCooling.needed
                  ? '<span class="pill ok">Passif (0 kWh)</span>'
                  : activeFR.activeCooling.level === 'excessive'
                    ? '<span class="pill ko">Trop important</span>'
                    : activeFR.activeCooling.level === 'high'
                      ? '<span class="pill warn">Important (EN-102)</span>'
                      : '<span class="pill ok">Faible</span>'
              }</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    ${renderActiveCoolingCard(res, activeFR, project)}

    <div class="card">
      <h3 class="card-title">
        <span data-tip="Compare votre configuration aux cas où les occupants oublient de fermer les stores le jour ou d'ouvrir les fenêtres la nuit.">Impact des gestes quotidiens &amp; scénarios (« Et si on oublie... ? »)</span>
        <span class="pill neutral">${isMinergie ? 'Heures > 26.5 °C' : 'Heures SIA 180'}</span>
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
                <th class="num" data-tip="Température maximale atteinte en été [°C].">Temp. max été</th>
                <th class="num" data-tip="Heures d'occupation au-dessus de 26.5 °C [h/an].">Heures &gt; 26.5 °C</th>
                <th class="num" data-tip="Heures de dépassement de la limite adaptative SIA 180 [h/an].">SIA 180</th>
                <th class="num" data-tip="Score global de protection estivale sur 100.">Score</th>
                <th data-tip="Conformité de l'étage au seuil choisi.">Statut</th>
              </tr></thead>
              <tbody>${res.floorResults
                .map(fr => {
                  const fHrs = isMinergie ? fr.overMinergie265 : fr.overSIA;
                  return `<tr>
                    <td><strong>${escapeHtml(fr.floor.name)}</strong></td>
                    <td class="num">${fr.floor.area.toFixed(0)} m²</td>
                    <td class="num">${fr.summerMaxTop.toFixed(1)} °C</td>
                    <td class="num">${fr.overMinergie265} h</td>
                    <td class="num">${fr.overSIA} h</td>
                    <td class="num">${fr.score}/100</td>
                    <td>${badge(fHrs <= mainLimit, 'Conforme', 'Dépassé')}</td>
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
  document.getElementById('sub-minergie').innerHTML = `
    <div style="margin-bottom:10px;">
      Verdict global : ${badge(m.globalPass, 'Conforme', 'Non conforme')}
      &nbsp; Volet constructif : ${badge(m.constructivePass, 'Rempli', 'Déficit')}
      &nbsp; Confort 2035 : ${badge(m.comfortPass, `≤ 100 h > 26.5 °C (${m.hoursOver265} h)`, `Dépassé (${m.hoursOver265} h)`)}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th data-tip="Critère constructif ou de confort vérifié.">Paramètre</th>
          <th class="num" data-tip="Valeur calculée pour l'étage actif.">Calculé</th>
          <th class="num" data-tip="Seuil réglementaire ou valeur de référence.">Exigence / Référence</th>
          <th data-tip="Statut de conformité.">Statut</th>
        </tr></thead>
        <tbody>
          <tr data-tip="Surface nette de plancher et vérification que la profondeur de la pièce ne dépasse pas 2.5 fois la hauteur sous plafond."><td>Surface nette de plancher (A_SNP)</td><td class="num">${m.area.toFixed(1)} m²</td><td class="num">Profondeur/h_libre = ${m.depthRatio.toFixed(1)} (max 2.5 reco.)</td><td>${badge(!m.depthWarning, 'OK', 'Profond (>2.5h)', true)}</td></tr>
          <tr data-tip="Rapport entre la surface totale des vitrages et la surface de plancher."><td>Indice de vitrage Z_g = A_G / A_SNP</td><td class="num">${m.glazingIndexZg.toFixed(2)} (${m.winArea.toFixed(1)} m²)</td><td class="num">—</td><td><span class="pill neutral">Info</span></td></tr>
          <tr data-tip="Transmission solaire globale moyenne (vitrage + store) comparée à la limite maximale autorisée selon l'orientation."><td>Facteur solaire g_total effectif moyen</td><td class="num">${m.gTotEffective.toFixed(3)}</td><td class="num">≤ ${m.gTotAuthorized.toFixed(3)} (autorisé)</td><td>${badge(m.gTotOk, 'OK', 'Trop élevé')}</td></tr>
          <tr data-tip="Capacité d'accumulation thermique rapportée au m² de plancher (minimum 30 Wh/m²K, référence 45 Wh/m²K)."><td>Capacité thermique effective (C_R / A_SNP)</td><td class="num">${m.thermalMassWhm2K.toFixed(0)} Wh/(m²·K)</td><td class="num">≥ 30 min. (45 réf.)</td><td>${badge(m.massMinOk, m.massReservePct >= 0 ? 'Réserve' : 'OK', 'Insuffisante', m.massReservePct < 0 && m.massMinOk)}</td></tr>
          <tr data-tip="Classe de résistance au vent SIA 342 recommandée en fonction de la hauteur du bâtiment et de l'exposition au föhn."><td>Résistance au vent stores (SIA 342)</td><td class="num">${m.windRec.label}</td><td class="num">H_bât=${m.buildingHeightM.toFixed(1)} m • Föhn=${project.foehnExposed ? 'Oui' : 'Non'}</td><td>${badge(m.allWindSafe, 'Respectée', 'Non protégé')}</td></tr>
          <tr data-tip="Vérifie si les stores sont dotés d'un abaissement automatique au-delà de 200 W/m² d'irradiance (SIA 380/2)."><td>Automatisation stores (SIA 380/2)</td><td class="num">${m.shadingAutomated ? 'Auto (200 W/m²)' : 'Manuelle / Absente'}</td><td class="num">Recommandée si Z_g élevé</td><td>${badge(m.shadingAutomated, 'Auto OK', 'Manuelle', true)}</td></tr>
          <tr data-tip="Apports internes journaliers (personnes + éclairage + appareils) comparés au standard SIA 2024."><td>Charges internes (SIA 2024)</td><td class="num">${m.internalLoadWhm2d.toFixed(1)} Wh/(m²·j)</td><td class="num">Réf. ${m.internalLoadRefWhm2d} Wh/(m²·j)</td><td>${badge(m.internalLoadWhm2d <= m.internalLoadRefWhm2d * 1.15, 'OK', 'Élevées', true)}</td></tr>
          <tr data-tip="Débit spécifique de ventilation nocturne sous un écart de température de 8 K."><td>Stratégie estivale (débit nocturne nominal)</td><td class="num">${m.summerStrategyLabel}</td><td class="num">≥ 10.0 m³/(h·m²)</td><td>${badge(m.nightSpecM3hm2 >= 10, 'Efficace', 'Insuffisant', m.nightSpecM3hm2 > 0)}</td></tr>
          <tr data-tip="Nombre d'heures dépassant 26.5 °C sur le climat actif et sous la projection climatique 2035 (seuil max : 100 h/an)."><td>Heures &gt; 26.5 °C (Climat actif vs 2035)</td><td class="num">${m.hoursOver265Current} h (actif) / <strong>${m.hoursOver265} h (2035)</strong></td><td class="num">≤ 100 h/an (2035)</td><td>${badge(m.comfortPass, 'Conforme 2035', 'Non conforme')}</td></tr>
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

function redrawOpenDrawerCharts() {
  if (!lastRenderCtx) return;
  const { res, activeFR, project } = lastRenderCtx;

  if (document.getElementById('drawer-charts')?.open) {
    const winMode = document.getElementById('plotWindow')?.value || 'hottest14';
    const compareFloors = Boolean(document.getElementById('plotCompareFloors')?.checked);
    timeChartMeta = drawTimeChart(res, activeFR, winMode, compareFloors);
    drawSIAChart(activeFR, project.siaCurveMode);
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
  const winMode = document.getElementById('simplePlotWindow')?.value || 'hottest14';
  const compareFloors = Boolean(document.getElementById('simpleCompareFloors')?.checked);

  const titleMap = {
    hottest14: 'Évolution des températures — 14 jours les plus chauds',
    summer: 'Évolution des températures — Été complet (juin–août)',
    year: 'Évolution des températures — Année complète (8760 h)'
  };
  const titleEl = document.getElementById('simpleChartTitle');
  if (titleEl) titleEl.textContent = titleMap[winMode] || titleMap.hottest14;

  const subEl = document.getElementById('simpleChartSub');
  if (subEl) {
    subEl.textContent = isMinergie
      ? 'Compare la température intérieure (bleu) à la température extérieure (gris) et au seuil Minergie de 26.5 °C (vert). Zone rouge = dépassement.'
      : 'Compare la température intérieure (bleu) à la température extérieure (gris) et à la courbe limite SIA 180 (vert). Zone rouge = dépassement.';
  }

  simpleChartMeta = drawSimpleHeatwaveChart(res, activeFR, 26.5, winMode, compareFloors, !isMinergie);
}

function syncToggleAllDrawersBtn() {
  const btn = document.getElementById('btnToggleAllAdvDetails');
  if (!btn) return;
  const drawers = [...document.querySelectorAll('#advDrawersContainer .adv-drawer')];
  const allOpen = drawers.length > 0 && drawers.every(d => d.open);
  btn.textContent = allOpen ? 'Tout replier' : 'Tout déplier';
}

export function renderResultsView(onEnsureSimulation) {
  if (!appState.lastResults) onEnsureSimulation();
  const res = appState.lastResults;
  const { project } = appState;

  const multiFloor = res.floorResults.length > 1;
  const sel = document.getElementById('resFloorSelect');
  const prev = sel.value;
  const isMinergie = project.projectType === 'minergie';
  sel.innerHTML =
    `<option value="WORST">Étage critique (${escapeHtml(res.worstFloor.floor.name)})</option>` +
    res.floorResults
      .map(
        fr =>
          `<option value="${escapeHtml(fr.floor.id)}">${escapeHtml(fr.floor.name)} (${isMinergie ? fr.overMinergie265 : fr.overSIA} h)</option>`
      )
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
  const limH = res.limHours;
  const pass = isMinergie ? activeFR.overMinergie265 <= 100 : activeFR.overSIA <= limH;
  const coolOk = activeFR.maxCoolWm2 <= 12.0;

  lastRenderCtx = { res, activeFR, project };

  document.getElementById('resProjectTitle').textContent = `${project.name} — ${activeFR.floor.name}`;
  document.getElementById('resSubMeta').textContent =
    `${res.weatherLabel}${project.foehnExposed ? ' • Zone föhn' : ''}  •  θ_e : ${res.minTe.toFixed(1)}..${res.maxTe.toFixed(1)} °C (${res.tropicalNights} nuits tropicales)`;

  // 1. RAPPORT SIMPLE (TOUJOURS AFFICHÉ PAR DÉFAUT)
  renderSimpleReport(res, activeFR, project);

  // Badges synthétiques sur les en-têtes des tiroirs dépliables
  const diagBadge = document.getElementById('drawerBadgeDiag');
  if (diagBadge) {
    diagBadge.textContent = pass ? `Conforme (${isMinergie ? activeFR.overMinergie265 : activeFR.overSIA} h)` : `Dépassé (${isMinergie ? activeFR.overMinergie265 : activeFR.overSIA} h)`;
    diagBadge.className = `pill ${pass ? 'ok' : 'ko'}`;
  }
  const comfBadge = document.getElementById('drawerBadgeComfort');
  if (comfBadge) {
    comfBadge.textContent = `EN Cat. II : ${activeFR.comfort.en16798.cat2OkPct.toFixed(0)} % • PMV ${activeFR.comfort.fanger.meanPmv >= 0 ? '+' : ''}${activeFR.comfort.fanger.meanPmv.toFixed(2)}`;
    comfBadge.className = `pill ${activeFR.comfort.en16798.cat2OkPct >= 97 ? 'ok' : 'warn'}`;
  }

  // 2. CONTENU DES TIROIRS AVANCÉS
  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi-box" data-tip="Heures annuelles d'occupation dépassant la courbe limite SIA 180, et heures dépassant le seuil fixe de 26.5 °C.">
      <div class="kpi-label">Heures de surchauffe</div>
      <div class="kpi-val" style="color:${pass ? 'var(--ok)' : 'var(--ko)'}">${activeFR.overSIA} h/an</div>
      <div class="kpi-sub">&gt; 26.5 °C : <strong>${activeFR.overMinergie265} h/an</strong> (tol. ≤ ${limH} h)</div>
    </div>
    <div class="kpi-box" data-tip="Plage annuelle et estivale de température opérative intérieure θ_op (30 % air + 70 % surfaces), jour/heure du pic et degrés-heures cumulés.">
      <div class="kpi-label">Température opérative (Min / Max)</div>
      <div class="kpi-val" style="color:${activeFR.maxTop > 28 ? 'var(--ko)' : 'var(--primary)'}">${activeFR.minTop.toFixed(1)} / ${activeFR.maxTop.toFixed(1)} °C</div>
      <div class="kpi-sub">Été : <strong>${activeFR.summerMinTop.toFixed(1)}..${activeFR.summerMaxTop.toFixed(1)} °C</strong> • Pic J${Math.floor(activeFR.maxTopHour / 24) + 1} à ${activeFR.maxTopHour % 24}h (${activeFR.dhSIA.toFixed(1)} Kh)</div>
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
    <div class="kpi-box" data-tip="Puissance frigorifique spécifique et besoin annuel de froid qui seraient nécessaires pour maintenir 0 heure de surchauffe (référence SIA : ≤ 12 W/m²).">
      <div class="kpi-label">Puissance froid fictive (0 h)</div>
      <div class="kpi-val" style="color:${coolOk ? 'var(--ok)' : 'var(--warn)'}">${activeFR.maxCoolWm2.toFixed(1)} W/m²</div>
      <div class="kpi-sub">${activeFR.coolKWhm2.toFixed(1)} kWh/(m²·an) — Seuil SIA 12 W/m²</div>
    </div>
    <div class="kpi-box" data-tip="Capacité nominale d'évacuation d'air par les ouvrants nocturnes sous un écart intérieur/extérieur de 8 K (objectif recommandé ≥ 10 m³/(h·m²)).">
      <div class="kpi-label">Déstockage nocturne (ΔT=8 K)</div>
      <div class="kpi-val">${activeFR.nomNightSpec.toFixed(1)} m³/(h·m²)</div>
      <div class="kpi-sub">${activeFR.nomNightM3h.toFixed(0)} m³/h (${(activeFR.nomNightM3h / Math.max(1, activeFR.fp.vol)).toFixed(1)} vol/h)</div>
    </div>
  `;

  renderDetailedGainsSection(activeFR);

  // Onglet Simulation & Verdict
  document.getElementById('sub-m3').innerHTML = `
    <div style="margin-bottom:8px;">
      Verdict SIA 180 : ${badge(activeFR.passSIA)}
      &nbsp; Seuil 26.5 °C : ${badge(activeFR.overMinergie265 <= 100, `${activeFR.overMinergie265} h ≤ 100 h`, `${activeFR.overMinergie265} h > 100 h`)}
      &nbsp; ${badge(coolOk, 'Froid fictif ≤ 12 W/m²', 'Froid fictif > 12 W/m²', true)}
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Critère</th><th class="num">Valeur</th><th>Statut / Référence</th></tr></thead>
      <tbody>
        <tr data-tip="Nombre total d'heures dans l'année où le local est occupé selon l'horaire défini à l'étape 4."><td>Heures d'occupation analysées</td><td class="num">${activeFR.occH} h/an</td><td>${activeFR.floor.occStart}h–${activeFR.floor.occEnd}h (${activeFR.floor.occDays} j/sem)</td></tr>
        <tr data-tip="Heures occupées où la température opérative dépasse la limite supérieure adaptative SIA 180."><td>Heures de surchauffe SIA 180 (courbe adaptative)</td><td class="num"><strong>${activeFR.overSIA} h/an</strong> (${activeFR.dhSIA.toFixed(1)} Kh)</td><td>${badge(activeFR.passSIA, `≤ ${limH} h/an`, `> ${limH} h/an`)}</td></tr>
        <tr data-tip="Heures où la température opérative dépasse 26.5 °C (pendant l'occupation / sur toute l'année)."><td>Heures θ_op &gt; 26.5 °C (occupation / 8760 h)</td><td class="num"><strong>${activeFR.overMinergie265} h</strong> / ${activeFR.over265All} h</td><td>${badge(activeFR.overMinergie265 <= 100, '≤ 100 h/an', '> 100 h/an')}</td></tr>
        <tr data-tip="Puissance de pointe et énergie de refroidissement théoriques pour éliminer tout dépassement."><td>Puissance / besoin froid actif pour 0 h de surchauffe</td><td class="num"><strong>${activeFR.coolKWhm2.toFixed(1)} kWh/(m²·an)</strong> (${(activeFR.coolKWh || 0).toFixed(0)} kWh) • ${activeFR.maxCoolWm2.toFixed(1)} W/m²</td><td>${
          activeFR.activeCooling
            ? badge(
                activeFR.activeCooling.level === 'none' || activeFR.activeCooling.level === 'low',
                activeFR.activeCooling.statusLabel,
                activeFR.activeCooling.statusLabel,
                activeFR.activeCooling.level === 'high'
              )
            : `${activeFR.maxCoolW.toFixed(0)} W`
        }</td></tr>
        <tr data-tip="Nombre total d'heures sur l'année entière (24h/24) où la température dépasse 26 °C."><td>Heures toutes périodes θ_op &gt; 26 °C</td><td class="num">${activeFR.over26} h/an</td><td>Indicateur d'inconfort global 8760 h</td></tr>
      </tbody>
    </table></div>
    <div class="reco-list">${activeFR.recos.map(r => `<div class="reco-item">${r}</div>`).join('')}</div>
  `;

  renderConstructiveTab(activeFR, project);

  // Onglet Scénarios
  const compList = res.behavioralScenarios || res.variants;
  document.getElementById('sub-compare').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr>
        <th data-tip="Variante comportementale ou climatique simulée.">Scénario comparé</th>
        <th data-tip="Paramètres modifiés dans ce scénario.">Hypothèses</th>
        <th class="num" data-tip="Heures d'occupation au-dessus de 26.5 °C [h/an].">&gt; 26.5 °C</th>
        <th class="num" data-tip="Heures de dépassement de la courbe SIA 180 [h/an].">SIA 180</th>
        <th class="num" data-tip="Intensité cumulée de la surchauffe en Kelvins-heures [Kh].">Degrés-heures</th>
        <th class="num" data-tip="Température intérieure minimale et maximale atteinte [°C].">θ_op Min / Max</th>
        <th class="num" data-tip="Note globale de résilience sur 100.">Score</th>
      </tr></thead>
      <tbody>${compList
        .map(
          v => `<tr>
            <td><strong>${escapeHtml(v.label)}</strong></td>
            <td><small style="color:var(--text-muted);">${escapeHtml(v.note)}</small></td>
            <td class="num"><strong>${v.wf.overMinergie265 ?? '—'} h</strong></td>
            <td class="num"><strong>${v.wf.overSIA} h/an</strong></td>
            <td class="num">${v.wf.dhSIA.toFixed(1)} Kh</td>
            <td class="num">${v.wf.minTop.toFixed(1)} / ${v.wf.maxTop.toFixed(1)} °C</td>
            <td class="num">${badge(v.wf.score >= 70, `${v.wf.score}/100`, `${v.wf.score}/100`)}</td>
          </tr>`
        )
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
      <thead><tr><th>Étage</th><th class="num">Surface</th><th class="num">θ_op Min / Max</th><th class="num">Été Min / Max</th><th class="num">&gt; 26.5 °C</th><th class="num">SIA 180</th><th class="num">Froid actif</th><th class="num">Score</th><th>Statut</th></tr></thead>
      <tbody>${res.floorResults
        .map(
          fr => `<tr>
            <td><strong>${escapeHtml(fr.floor.name)}</strong></td>
            <td class="num">${fr.floor.area.toFixed(0)} m²</td>
            <td class="num">${fr.minTop.toFixed(1)} / ${fr.maxTop.toFixed(1)} °C</td>
            <td class="num">${fr.summerMinTop.toFixed(1)} / ${fr.summerMaxTop.toFixed(1)} °C</td>
            <td class="num">${fr.overMinergie265} h</td>
            <td class="num"><strong>${fr.overSIA} h/an</strong></td>
            <td class="num">${fr.coolKWhm2.toFixed(1)} kWh/m² (${fr.maxCoolWm2.toFixed(1)} W/m²)</td>
            <td class="num">${fr.score}/100</td>
            <td>${badge(isMinergie ? fr.overMinergie265 <= 100 : fr.overSIA <= limH, 'Conforme', 'Non conforme')}</td>
          </tr>`
        )
        .join('')}</tbody>
    </table></div>
  `;

  // Onglet Méthodologie
  document.getElementById('sub-methodology').innerHTML = renderMethodologyPanel(activeFR, project);

  renderComfortSection(activeFR);
  syncToggleAllDrawersBtn();

  requestAnimationFrame(() => {
    redrawSimpleChart();
    redrawOpenDrawerCharts();
  });
}

export function bindResultsEvents({ onEnsureSimulation, onRenderResults }) {
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

  bindHoverTooltip(
    'chartTime',
    () => timeChartMeta,
    pt => `<strong>Jour ${pt.d + 1} — ${String(pt.hod).padStart(2, '0')}h00</strong><br>
      θ_op : <strong>${pt.Top.toFixed(1)} °C</strong> (air ${pt.Tair.toFixed(1)} °C | rad ${pt.Ts.toFixed(1)} °C)<br>
      θ_ext : ${pt.Te.toFixed(1)} °C | Limite SIA : ${pt.limUpper.toFixed(1)} °C<br>
      Gains : sol ${pt.qSol.toFixed(0)} W | int ${pt.qInt.toFixed(0)} W (gens ${(pt.qPeople || 0).toFixed(0)} / lampes ${(pt.qLight || 0).toFixed(0)} / app. ${(pt.qEquip || 0).toFixed(0)})`
  );

  bindHoverTooltip(
    'chartSimpleHeatwave',
    () => simpleChartMeta,
    (pt, meta) => {
      const lim = meta.useAdaptiveLimit ? pt.limUpper : meta.thresholdC;
      return `<strong>Jour ${pt.d + 1} — ${String(pt.hod).padStart(2, '0')}h00</strong><br>
      Temp. intérieure : <strong>${pt.Top.toFixed(1)} °C</strong><br>
      Temp. extérieure : ${pt.Te.toFixed(1)} °C<br>
      Seuil confort : ${lim.toFixed(1)} °C`;
    }
  );

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
  document.getElementById('btnPrintReport').addEventListener('click', () => window.print());

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
