/**
 * @fileoverview Gestion de l'interface Résultats :
 *  - Vue Simple : Rapport de surchauffe style Minergie (compréhensible en 2 min, sans formules)
 *  - Vue Avancée : Détail des puissances et types de gains (gens, lampes, appareils, solaire, conduction),
 *    justificatifs Minergie Variante 2 & SIA 180 (Méthodes 1/2/3), Confort multi-normes, Méthodologie & Graphiques
 */

import { evaluateThermalComfort } from '../methodology/07-thermal-comfort.js';
import { appState, escapeHtml } from '../state/project-store.js';
import {
  drawAdaptiveComparisonChart,
  drawBalanceChart,
  drawGainsDetailChart,
  drawOrientChart,
  drawSIAChart,
  drawSimpleHeatwaveChart,
  drawTimeChart
} from './charts.js';
import { renderMethodologyPanel } from './methodology-view.js';

let timeChartMeta = null;
let simpleChartMeta = null;

function badge(ok, yesLabel = 'Conforme', noLabel = 'Non conforme', warnMode = false) {
  return `<span class="pill ${ok ? 'ok' : warnMode ? 'warn' : 'ko'}">${ok ? yesLabel : noLabel}</span>`;
}

function renderMinergieGaugeHtml(m) {
  const scaleMax = 120;
  const blueW = Math.min(100, (m.solarLow200Pct / scaleMax) * 100);
  const redW = Math.min(100 - blueW, (m.solarHigh200Pct / scaleMax) * 100);
  const limitLeft = (100 / scaleMax) * 100; // 83.33%
  const massLeft = Math.min(99, Math.max(2, (m.massThresholdPct / scaleMax) * 100));
  const reserveText =
    m.massReservePct >= 0
      ? `Capacité thermique (+${m.massReservePct}% réserve)`
      : `Capacité thermique (${m.massReservePct}% déficit)`;

  const massLabelStyle =
    massLeft > 80
      ? 'right:0;left:auto;transform:none;'
      : massLeft < 20
        ? 'left:0;transform:none;'
        : '';

  return `
    <div class="minergie-gauge-wrap">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px;">
        <strong style="font-size:13px;">Bilan constructif Minergie (apports solaires vs capacité de stockage)</strong>
        ${badge(m.constructivePass, `Exigences constructives respectées (${m.externalLoadPct.toFixed(0)} %)`, `Dépassement (${m.externalLoadPct.toFixed(0)} %)`)}
      </div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:8px;">
        Bleu : apports solaires faibles (&lt; 200 W/m²) •
        Rouge : apports solaires forts (&gt; 200 W/m², stores actifs) •
        Seuil max : 100 %
      </div>
      <div class="minergie-gauge-track">
        <div class="mg-seg-blue" style="width:${blueW.toFixed(1)}%;" title="Irradiation < 200 W/m² : ${m.solarLow200Pct.toFixed(1)} %"></div>
        <div class="mg-seg-red" style="width:${redW.toFixed(1)}%;" title="Irradiation > 200 W/m² : ${m.solarHigh200Pct.toFixed(1)} %"></div>
        <div class="mg-limit-line" style="left:${limitLeft.toFixed(1)}%;">
          <span class="mg-limit-label">Max 100 %</span>
        </div>
        <div class="mg-mass-marker" style="left:${massLeft.toFixed(1)}%;">
          <span class="mg-mass-label" style="${massLabelStyle}">${reserveText}</span>
        </div>
      </div>
      <div class="mg-scale">
        <span>0 %</span><span>20 %</span><span>40 %</span><span>60 %</span><span>80 %</span><span>100 %</span><span>120 %</span>
      </div>
    </div>
  `;
}

function renderSimpleMinergieReport(res, activeFR, project) {
  const m = activeFR.minergie;
  const g = activeFR.gains;
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

  const scenarios = res.behavioralScenarios || [];
  const maxScenarioHours = Math.max(
    120,
    ...scenarios.map(s => (isMinergie ? s.wf.overMinergie265 : s.wf.overSIA))
  );

  const scenariosHtml = scenarios
    .filter(s => ['current', 'no_blinds', 'no_night', 'both_bad', 'optimal', 'climate_2035', 'climate_2050'].includes(s.id))
    .map(s => {
      const hrs = isMinergie ? s.wf.overMinergie265 : s.wf.overSIA;
      const barPct = Math.min(100, (hrs / maxScenarioHours) * 100);
      const ok = hrs <= mainLimit;
      const barCol = ok ? 'var(--ok)' : hrs <= mainLimit * 2 ? 'var(--warn)' : 'var(--ko)';
      const isCurr = s.id === 'current';
      return `
        <div class="scenario-row ${isCurr ? 'highlight' : ''}">
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

  document.getElementById('simpleReportBody').innerHTML = `
    <div class="verdict-banner ${verdictStatus}">
      <div>
        <h3 class="verdict-title">${verdictTitle}</h3>
        <p class="verdict-sub">
          ${escapeHtml(activeFR.floor.name)} (${activeFR.floor.area.toFixed(0)} m²) :
          <strong>${activeFR.overMinergie265} h/an &gt; 26.5 °C</strong> (seuil Minergie : 100 h) •
          Température maximale d'été : <strong>${activeFR.summerMaxTop.toFixed(1)} °C</strong>.
        </p>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${m ? badge(m.constructivePass, 'Constructif OK', 'Constructif à revoir') : ''}
        ${m ? badge(m.comfortPass, `Minergie 2035 OK (${m.hoursOver265} h)`, `Minergie 2035 : ${m.hoursOver265} h`, false) : ''}
        ${badge(activeFR.passSIA, `SIA 180 OK (${activeFR.overSIA} h)`, `SIA 180 : ${activeFR.overSIA} h`)}
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi-box">
        <div class="kpi-label">${isMinergie ? 'Heures > 26.5 °C (Minergie)' : 'Heures de surchauffe (SIA 180)'}</div>
        <div class="kpi-val" style="color:${mainPass ? 'var(--ok)' : 'var(--ko)'}">${mainHours} h/an</div>
        <div class="kpi-sub">Limite autorisée : ≤ ${mainLimit} h/an</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Température maximale en été</div>
        <div class="kpi-val" style="color:${activeFR.summerMaxTop > 28 ? 'var(--ko)' : 'var(--primary)'}">${activeFR.summerMaxTop.toFixed(1)} °C</div>
        <div class="kpi-sub">Nuits chaudes (&gt; 26 °C) : ${activeFR.comfort.healthSleep.nightOver26H} h</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Score de protection estivale</div>
        <div class="kpi-val" style="color:${activeFR.score >= 75 ? 'var(--ok)' : activeFR.score >= 45 ? 'var(--warn)' : 'var(--ko)'}">${activeFR.score} / 100</div>
        <div class="kpi-sub">${activeFR.score >= 75 ? 'Très bonne résilience' : activeFR.score >= 45 ? 'Marge d\'amélioration' : 'Vulnérable aux canicules'}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Aération nocturne</div>
        <div class="kpi-val" style="color:${nightPass ? 'var(--ok)' : 'var(--warn)'}">${activeFR.nomNightSpec.toFixed(1)} m³/(h·m²)</div>
        <div class="kpi-sub">Objectif recommandé : ≥ 10 m³/(h·m²)</div>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">
        <span>Fiche de contrôle Minergie — Exigences constructives &amp; quantités</span>
        <span class="pill neutral">Style justificatif Variante 2</span>
      </h3>
      ${m ? renderMinergieGaugeHtml(m) : ''}
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Critère Minergie</th><th class="num">Valeur du projet</th><th class="num">Référence / Seuil</th><th>Statut</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Surface de référence &amp; vitrages (A_G / A_SNP)</td>
              <td class="num">${activeFR.fp.winArea.toFixed(1)} m² / ${activeFR.floor.area.toFixed(0)} m² (<strong>${m ? (m.glazingIndexZg * 100).toFixed(0) : 0} %</strong>)</td>
              <td class="num">Part vitrée modérée</td>
              <td><span class="pill neutral">Quantité</span></td>
            </tr>
            <tr>
              <td>Protection solaire (facteur g_total moyen)</td>
              <td class="num"><strong>${activeFR.avgGtot.toFixed(2)}</strong></td>
              <td class="num">≤ ${m ? m.gTotAuthorized.toFixed(2) : '0.15'}</td>
              <td>${m ? badge(m.gTotOk, 'Efficace', 'Trop élevé') : ''}</td>
            </tr>
            <tr>
              <td>Résistance au vent des stores (SIA 342)</td>
              <td class="num">${project.foehnExposed ? 'Zone föhn' : 'Standard'} (h=${m ? m.buildingHeightM.toFixed(1) : '5'} m)</td>
              <td class="num">${m ? m.windRec.label : 'Classe 5'}</td>
              <td>${m ? badge(m.allWindSafe, 'Stores protégés', 'Non protégé') : ''}</td>
            </tr>
            <tr>
              <td>Inertie thermique du local (C_R / A_SNP)</td>
              <td class="num"><strong>${activeFR.floor.cSpec.toFixed(0)} Wh/(m²·K)</strong></td>
              <td class="num">≥ 30 min. (45 reco.)</td>
              <td>${badge(activeFR.floor.cSpec >= 45, 'Forte', activeFR.floor.cSpec >= 30 ? 'Moyenne' : 'Faible', activeFR.floor.cSpec >= 30)}</td>
            </tr>
            <tr>
              <td>Charges internes (personnes + lampes + appareils)</td>
              <td class="num"><strong>${g.internalTotal.dailyWhm2d.toFixed(0)} Wh/(m²·j)</strong> (${g.internalTotal.peakW.toFixed(0)} W max)</td>
              <td class="num">Réf. SIA : ${m ? m.internalLoadRefWhm2d : 113} Wh/(m²·j)</td>
              <td>${badge(g.internalTotal.dailyWhm2d <= (m ? m.internalLoadRefWhm2d * 1.15 : 130), 'Maîtrisées', 'Élevées', true)}</td>
            </tr>
            <tr>
              <td>Stratégie estivale (ventilation nocturne)</td>
              <td class="num"><strong>${activeFR.nomNightSpec.toFixed(1)} m³/(h·m²)</strong> (${(activeFR.nomNightM3h / Math.max(1, activeFR.fp.vol)).toFixed(1)} vol/h)</td>
              <td class="num">≥ 10.0 m³/(h·m²)</td>
              <td>${badge(nightPass, 'Efficace', activeFR.nomNightSpec > 0 ? 'Modérée' : 'Absente', activeFR.nomNightSpec > 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">
        <span>Impact des gestes quotidiens &amp; scénarios (« Et si on oublie... ? »)</span>
        <span class="pill neutral">${isMinergie ? 'Heures > 26.5 °C' : 'Heures SIA 180'}</span>
      </h3>
      <p class="subtitle">
        Permet de voir en un coup d'œil ce qui se passe si les occupants ne baissent pas les stores ou n'ouvrent pas les fenêtres la nuit.
      </p>
      <div class="scenario-list">${scenariosHtml}</div>
    </div>

    ${
      res.floorResults.length > 1
        ? `<div class="card">
            <h3 class="card-title">Résumé de tous les étages / locaux</h3>
            <div class="table-wrap"><table>
              <thead><tr><th>Local / Étage</th><th class="num">Surface</th><th class="num">Temp. max été</th><th class="num">Heures &gt; 26.5 °C</th><th class="num">SIA 180</th><th class="num">Score</th><th>Statut</th></tr></thead>
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
      <h3 class="card-title">Recommandations prioritaires</h3>
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

  const fmtRow = (label, item, cls = '', customDaily = null) => `
    <tr class="${cls}">
      <td>${label}</td>
      <td class="num">${item.peakW.toFixed(0)} W</td>
      <td class="num">${item.peakWm2.toFixed(1)} W/m²</td>
      <td class="num">${item.summerMeanW.toFixed(0)} W</td>
      <td class="num">${customDaily !== null ? customDaily : item.dailyWhm2d.toFixed(1) + ' Wh/(m²·j)'}</td>
      <td class="num"><strong>${item.summerKWh.toFixed(0)} kWh</strong></td>
      <td class="num">${item.summerKWhm2.toFixed(1)} kWh/m²</td>
      <td class="num">${item.sharePct.toFixed(1)} %</td>
    </tr>
  `;

  const blindReductionPct =
    g.solarUnshaded.summerKWh > 0
      ? (g.solarBlockedByBlinds.summerKWh / g.solarUnshaded.summerKWh) * 100
      : 0;

  const orientRows = Object.entries(activeFR.solOrientStats || {})
    .filter(([, v]) => v.energyKWh > 0.1 || v.unshadedKWh > 0.1)
    .map(([orient, os]) => {
      const saved = Math.max(0, os.unshadedKWh - os.energyKWh);
      return `<span class="pill neutral">${orient === 'R' ? 'Toiture' : orient} : ${os.peakW.toFixed(0)} W pic • ${os.energyKWh.toFixed(0)} kWh (irrad. max ${os.peakIrrWm2.toFixed(0)} W/m², ${os.hoursOver200} h ≥200 W/m², stores -${saved.toFixed(0)} kWh)</span>`;
    })
    .join('');

  document.getElementById('advGainsBody').innerHTML = `
    <div class="gains-summary-chips">
      <span class="pill neutral">Gains internes : <strong>${g.internalTotal.dailyWhm2d.toFixed(1)} Wh/(m²·j)</strong> (${g.internalTotal.peakW.toFixed(0)} W pointe)</span>
      <span class="pill neutral">Dont Personnes : ${g.people.peakW.toFixed(0)} W • Lampes : ${g.lighting.peakW.toFixed(0)} W • Appareils : ${g.appliances.peakW.toFixed(0)} W</span>
      <span class="pill ok">Gains solaires bloqués par stores : <strong>${g.solarBlockedByBlinds.summerKWh.toFixed(0)} kWh</strong> (−${blindReductionPct.toFixed(0)} %, pointe −${g.solarBlockedByBlinds.peakW.toFixed(0)} W)</span>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Type de gain / flux thermique (Mai–Sept)</th>
            <th class="num">Puissance pointe</th>
            <th class="num">Spécifique</th>
            <th class="num">Moy. été</th>
            <th class="num">Charge jour</th>
            <th class="num">Énergie été</th>
            <th class="num">Par m²</th>
            <th class="num">Part gains</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>1. Gains internes (Total : gens + lampes + appareils)</strong></td>
            <td class="num"><strong>${g.internalTotal.peakW.toFixed(0)} W</strong></td>
            <td class="num"><strong>${g.internalTotal.peakWm2.toFixed(1)} W/m²</strong></td>
            <td class="num">${g.internalTotal.summerMeanW.toFixed(0)} W</td>
            <td class="num"><strong>${g.internalTotal.dailyWhm2d.toFixed(1)} Wh/(m²·j)</strong></td>
            <td class="num"><strong>${g.internalTotal.summerKWh.toFixed(0)} kWh</strong></td>
            <td class="num">${g.internalTotal.summerKWhm2.toFixed(1)} kWh/m²</td>
            <td class="num"><strong>${g.internalTotal.sharePct.toFixed(1)} %</strong></td>
          </tr>
          ${fmtRow(`↳ Personnes / Occupants (${fl.occCount} p. × ${fl.occWatt} W × ${((fl.occPresenceFactor ?? 1) * 100).toFixed(0)} %)`, g.people, 'gains-row-sub')}
          ${fmtRow(`↳ Lampes / Éclairage (${fl.lightWm2.toFixed(1)} W/m²)`, g.lighting, 'gains-row-sub')}
          ${fmtRow(`↳ Appareils / Appliances (${fl.equipWatt.toFixed(0)} W inst., veille ${fl.standbyPct} %)`, g.appliances, 'gains-row-sub')}

          <tr>
            <td><strong>2. Gains solaires transmis (avec stores &amp; ombrages)</strong></td>
            <td class="num"><strong>${g.solarTransmitted.peakW.toFixed(0)} W</strong></td>
            <td class="num"><strong>${g.solarTransmitted.peakWm2.toFixed(1)} W/m²</strong></td>
            <td class="num">${g.solarTransmitted.summerMeanW.toFixed(0)} W</td>
            <td class="num">${g.solarTransmitted.dailyWhm2d.toFixed(1)} Wh/(m²·j)</td>
            <td class="num"><strong>${g.solarTransmitted.summerKWh.toFixed(0)} kWh</strong></td>
            <td class="num">${g.solarTransmitted.summerKWhm2.toFixed(1)} kWh/m²</td>
            <td class="num"><strong>${g.solarTransmitted.sharePct.toFixed(1)} %</strong></td>
          </tr>
          <tr class="gains-row-sub">
            <td>↳ Référence vitrage nu (sans stores) / Économie stores</td>
            <td class="num">${g.solarUnshaded.peakW.toFixed(0)} W</td>
            <td class="num">${g.solarUnshaded.peakWm2.toFixed(1)} W/m²</td>
            <td class="num">${g.solarUnshaded.summerMeanW.toFixed(0)} W</td>
            <td class="num">−${g.solarBlockedByBlinds.dailyWhm2d.toFixed(1)} Wh/(m²·j)</td>
            <td class="num">${g.solarUnshaded.summerKWh.toFixed(0)} kWh</td>
            <td class="num">−${g.solarBlockedByBlinds.summerKWhm2.toFixed(1)} kWh/m²</td>
            <td class="num">−${blindReductionPct.toFixed(0)} %</td>
          </tr>

          ${fmtRow('3. Conduction entrante par enveloppe (θ_e &gt; θ_op)', g.conductionIn)}
          ${g.slabIn.summerKWh >= 1 ? fmtRow('4. Apport thermique via dalles inter-étages (+)', g.slabIn) : ''}

          <tr class="gains-row-total">
            <td>TOTAL DES GAINS DE CHALEUR (pointe simultanée)</td>
            <td class="num">${g.totalGainPeakW.toFixed(0)} W</td>
            <td class="num">${g.totalGainPeakWm2.toFixed(1)} W/m²</td>
            <td class="num">${g.totalGainSummerMeanW.toFixed(0)} W</td>
            <td class="num">${((g.totalGainSummerKWh * 1000) / (154 * area)).toFixed(1)} Wh/(m²·j)</td>
            <td class="num">${g.totalGainSummerKWh.toFixed(0)} kWh</td>
            <td class="num">${g.totalGainSummerKWhm2.toFixed(1)} kWh/m²</td>
            <td class="num">100.0 %</td>
          </tr>

          <tr>
            <td style="color:var(--ok);">Évacuation : Conduction sortante (−)</td>
            <td class="num">${g.conductionOut.peakW.toFixed(0)} W</td>
            <td class="num">${g.conductionOut.peakWm2.toFixed(1)} W/m²</td>
            <td class="num">${g.conductionOut.summerMeanW.toFixed(0)} W</td>
            <td class="num">—</td>
            <td class="num">−${g.conductionOut.summerKWh.toFixed(0)} kWh</td>
            <td class="num">−${g.conductionOut.summerKWhm2.toFixed(1)} kWh/m²</td>
            <td class="num">—</td>
          </tr>
          <tr>
            <td style="color:var(--ok);">Évacuation : Ventilation diurne &amp; infiltration (−)</td>
            <td class="num">${g.ventDayOut.peakW.toFixed(0)} W</td>
            <td class="num">${g.ventDayOut.peakWm2.toFixed(1)} W/m²</td>
            <td class="num">${g.ventDayOut.summerMeanW.toFixed(0)} W</td>
            <td class="num">—</td>
            <td class="num">−${g.ventDayOut.summerKWh.toFixed(0)} kWh</td>
            <td class="num">−${g.ventDayOut.summerKWhm2.toFixed(1)} kWh/m²</td>
            <td class="num">—</td>
          </tr>
          <tr>
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
    ${orientRows ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">${orientRows}</div>` : ''}
  `;
}

function renderMinergieTab(activeFR, project) {
  const m = activeFR.minergie;
  if (!m) {
    document.getElementById('sub-minergie').innerHTML = '<p class="subtitle">Données Minergie indisponibles.</p>';
    return;
  }
  document.getElementById('sub-minergie').innerHTML = `
    <div style="margin-bottom:10px;">
      Verdict global Minergie Variante 2 : ${badge(m.globalPass, 'Conforme Minergie', 'Non conforme Minergie')}
      &nbsp; Volet constructif : ${badge(m.constructivePass, 'Rempli', 'Déficit')}
      &nbsp; Volet confort 2035 : ${badge(m.comfortPass, `≤ 100 h > 26.5 °C (${m.hoursOver265} h)`, `Dépassé (${m.hoursOver265} h)`)}
    </div>
    ${renderMinergieGaugeHtml(m)}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Paramètre Minergie SoWS Variante 2</th><th class="num">Calculé</th><th class="num">Exigence / Référence</th><th>Statut</th></tr></thead>
        <tbody>
          <tr><td>Surface nette de plancher (A_SNP)</td><td class="num">${m.area.toFixed(1)} m²</td><td class="num">Profondeur/h_libre = ${m.depthRatio.toFixed(1)} (max 2.5 reco.)</td><td>${badge(!m.depthWarning, 'OK', 'Profond (>2.5h)', true)}</td></tr>
          <tr><td>Indice de vitrage Z_g = A_G / A_SNP</td><td class="num">${m.glazingIndexZg.toFixed(2)} (${m.winArea.toFixed(1)} m²)</td><td class="num">—</td><td><span class="pill neutral">Info</span></td></tr>
          <tr><td>Facteur solaire g_total effectif moyen</td><td class="num">${m.gTotEffective.toFixed(3)}</td><td class="num">≤ ${m.gTotAuthorized.toFixed(3)} (autorisé)</td><td>${badge(m.gTotOk, 'OK', 'Trop élevé')}</td></tr>
          <tr><td>Capacité thermique effective (C_R / A_SNP)</td><td class="num">${m.thermalMassWhm2K.toFixed(0)} Wh/(m²·K)</td><td class="num">≥ 30 min. (45 réf.)</td><td>${badge(m.massMinOk, m.massReservePct >= 0 ? 'Réserve' : 'OK', 'Insuffisante', m.massReservePct < 0 && m.massMinOk)}</td></tr>
          <tr><td>Résistance au vent stores (SIA 342)</td><td class="num">${m.windRec.label}</td><td class="num">H_bât=${m.buildingHeightM.toFixed(1)} m • Föhn=${project.foehnExposed ? 'Oui' : 'Non'}</td><td>${badge(m.allWindSafe, 'Respectée', 'Non protégé')}</td></tr>
          <tr><td>Automatisation stores (SIA 380/2 §3.2.3.1 &amp; 7.1.2)</td><td class="num">${m.shadingAutomated ? 'Auto (200 W/m²)' : 'Manuelle / Absente'}</td><td class="num">Recommandée si Z_g élevé</td><td>${badge(m.shadingAutomated, 'Auto OK', 'Manuelle', true)}</td></tr>
          <tr><td>Charges internes (SIA 2024)</td><td class="num">${m.internalLoadWhm2d.toFixed(1)} Wh/(m²·j)</td><td class="num">Réf. ${m.internalLoadRefWhm2d} Wh/(m²·j)</td><td>${badge(m.internalLoadWhm2d <= m.internalLoadRefWhm2d * 1.15, 'OK', 'Élevées', true)}</td></tr>
          <tr><td>Stratégie estivale (débit nocturne nominal)</td><td class="num">${m.summerStrategyLabel}</td><td class="num">≥ 10.0 m³/(h·m²)</td><td>${badge(m.nightSpecM3hm2 >= 10, 'Efficace', 'Insuffisant', m.nightSpecM3hm2 > 0)}</td></tr>
          <tr><td>Heures &gt; 26.5 °C (Climat actif vs 2035)</td><td class="num">${m.hoursOver265Current} h (actif) / <strong>${m.hoursOver265} h (2035)</strong></td><td class="num">≤ 100 h/an (Minergie 2035)</td><td>${badge(m.comfortPass, 'Conforme 2035', 'Non conforme')}</td></tr>
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
      <div class="comfort-card">
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

      <div class="comfort-card">
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

      <div class="comfort-card">
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

      <div class="comfort-card">
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
        <div class="field">
          <label>Habillement [clo] : <strong id="lblComfortClo">${p.clo.toFixed(2)}</strong></label>
          <input type="range" id="inComfortClo" min="0.30" max="1.00" step="0.05" value="${p.clo}" />
        </div>
        <div class="field">
          <label>Métabolisme [met] : <strong id="lblComfortMet">${p.met.toFixed(2)}</strong></label>
          <input type="range" id="inComfortMet" min="0.80" max="2.00" step="0.10" value="${p.met}" />
        </div>
        <div class="field">
          <label>Vitesse d'air [m/s] : <strong id="lblComfortVel">${p.airSpeed.toFixed(2)}</strong></label>
          <input type="range" id="inComfortVel" min="0.05" max="0.80" step="0.05" value="${p.airSpeed}" />
        </div>
        <div class="field">
          <label>Humidité [%] : <strong id="lblComfortRh">${p.rh.toFixed(0)}</strong></label>
          <input type="range" id="inComfortRh" min="25" max="80" step="5" value="${p.rh}" />
        </div>
      </div>
    </div>

    <div>
      <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">
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
      renderComfortSection(activeFR);
      requestAnimationFrame(() => drawAdaptiveComparisonChart(activeFR, appState.project.siaCurveMode));
    });
  };
  rebindComfort('inComfortClo', 'clo', 'lblComfortClo', v => v.toFixed(2));
  rebindComfort('inComfortMet', 'met', 'lblComfortMet', v => v.toFixed(2));
  rebindComfort('inComfortVel', 'airSpeed', 'lblComfortVel', v => v.toFixed(2));
  rebindComfort('inComfortRh', 'rh', 'lblComfortRh', v => v.toFixed(0));
}

export function renderResultsView(onEnsureSimulation) {
  if (!appState.lastResults) onEnsureSimulation();
  const res = appState.lastResults;
  const { project, uiModes } = appState;

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
    prev && (prev === 'WORST' || res.floorResults.some(fr => fr.floor.id === prev)) ? prev : 'WORST';

  const activeFR =
    sel.value === 'WORST' ? res.worstFloor : res.floorResults.find(fr => fr.floor.id === sel.value);
  const limH = res.limHours;
  const pass = isMinergie ? activeFR.overMinergie265 <= 100 : activeFR.overSIA <= limH;
  const coolOk = activeFR.maxCoolWm2 <= 12.0;
  const isAdv = uiModes.results === 'advanced';

  document.getElementById('resProjectTitle').textContent = `${project.name} — ${activeFR.floor.name}`;
  document.getElementById('resSubMeta').textContent =
    `${res.weatherLabel}${project.foehnExposed ? ' • Zone föhn' : ''}  •  θ_e : ${res.minTe.toFixed(1)}..${res.maxTe.toFixed(1)} °C (${res.tropicalNights} nuits tropicales)`;

  const simpleView = document.getElementById('resultsSimpleView');
  const advView = document.getElementById('resultsAdvView');
  if (simpleView) simpleView.classList.toggle('hidden', isAdv);
  if (advView) advView.classList.toggle('hidden', !isAdv);

  if (!isAdv) {
    renderSimpleMinergieReport(res, activeFR, project);
    requestAnimationFrame(() => {
      simpleChartMeta = drawSimpleHeatwaveChart(activeFR, 26.5);
    });
    return;
  }

  // ==================== VUE AVANCÉE ====================
  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi-box">
      <div class="kpi-label">Surchauffe SIA 180 / Minergie</div>
      <div class="kpi-val" style="color:${pass ? 'var(--ok)' : 'var(--ko)'}">${activeFR.overSIA} h/an</div>
      <div class="kpi-sub">Minergie (&gt; 26.5 °C) : <strong>${activeFR.overMinergie265} h/an</strong> (tol. ≤ ${limH} h)</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Température opérative (Min / Max)</div>
      <div class="kpi-val" style="color:${activeFR.maxTop > 28 ? 'var(--ko)' : 'var(--primary)'}">${activeFR.minTop.toFixed(1)} / ${activeFR.maxTop.toFixed(1)} °C</div>
      <div class="kpi-sub">Été : <strong>${activeFR.summerMinTop.toFixed(1)}..${activeFR.summerMaxTop.toFixed(1)} °C</strong> • Pic J${Math.floor(activeFR.maxTopHour / 24) + 1} à ${activeFR.maxTopHour % 24}h (${activeFR.dhSIA.toFixed(1)} Kh)</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Score de résilience estivale</div>
      <div class="kpi-val" style="color:${activeFR.score >= 75 ? 'var(--ok)' : activeFR.score >= 45 ? 'var(--warn)' : 'var(--ko)'}">${activeFR.score} / 100</div>
      <div class="kpi-sub">Synthèse physique 5R1C</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Confort EN 16798-1 / PMV été</div>
      <div class="kpi-val" style="color:${activeFR.comfort.en16798.cat2OkPct >= 97 ? 'var(--ok)' : 'var(--warn)'}">${activeFR.comfort.en16798.cat2OkPct.toFixed(0)} % Cat.II</div>
      <div class="kpi-sub">PMV moy. ${activeFR.comfort.fanger.meanPmv >= 0 ? '+' : ''}${activeFR.comfort.fanger.meanPmv.toFixed(2)} • OMS nuit &gt;26°C : ${activeFR.comfort.healthSleep.nightOver26H} h</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Puissance froid fictive (0 h)</div>
      <div class="kpi-val" style="color:${coolOk ? 'var(--ok)' : 'var(--warn)'}">${activeFR.maxCoolWm2.toFixed(1)} W/m²</div>
      <div class="kpi-sub">${activeFR.coolKWhm2.toFixed(1)} kWh/(m²·an) — Seuil SIA 12 W/m²</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Déstockage nocturne (ΔT=8 K)</div>
      <div class="kpi-val">${activeFR.nomNightSpec.toFixed(1)} m³/(h·m²)</div>
      <div class="kpi-sub">${activeFR.nomNightM3h.toFixed(0)} m³/h (${(activeFR.nomNightM3h / Math.max(1, activeFR.fp.vol)).toFixed(1)} vol/h)</div>
    </div>
  `;

  renderDetailedGainsSection(activeFR);

  // Onglet Méthode 3
  document.getElementById('sub-m3').innerHTML = `
    <div style="margin-bottom:8px;">
      Verdict SIA 180 : ${badge(activeFR.passSIA)}
      &nbsp; Minergie (&gt; 26.5 °C) : ${badge(activeFR.overMinergie265 <= 100, `${activeFR.overMinergie265} h ≤ 100 h`, `${activeFR.overMinergie265} h > 100 h`)}
      &nbsp; ${badge(coolOk, 'Froid fictif ≤ 12 W/m²', 'Froid fictif > 12 W/m²', true)}
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Critère SIA 180 / SIA 380/2 / Minergie</th><th class="num">Valeur</th><th>Statut / Référence</th></tr></thead>
      <tbody>
        <tr><td>Heures d'occupation analysées</td><td class="num">${activeFR.occH} h/an</td><td>${activeFR.floor.occStart}h–${activeFR.floor.occEnd}h (${activeFR.floor.occDays} j/sem)</td></tr>
        <tr><td>Heures de surchauffe SIA 180 (courbe adaptative)</td><td class="num"><strong>${activeFR.overSIA} h/an</strong> (${activeFR.dhSIA.toFixed(1)} Kh)</td><td>${badge(activeFR.passSIA, `≤ ${limH} h/an`, `> ${limH} h/an`)}</td></tr>
        <tr><td>Heures Minergie θ_op &gt; 26.5 °C (occupation / 8760 h)</td><td class="num"><strong>${activeFR.overMinergie265} h</strong> / ${activeFR.over265All} h</td><td>${badge(activeFR.overMinergie265 <= 100, '≤ 100 h/an', '> 100 h/an')}</td></tr>
        <tr><td>Puissance / besoin froid pour 0 h de surchauffe</td><td class="num">${activeFR.maxCoolW.toFixed(0)} W (${activeFR.maxCoolWm2.toFixed(1)} W/m²)</td><td>${activeFR.coolKWhm2.toFixed(1)} kWh/(m²·an)</td></tr>
        <tr><td>Heures toutes périodes θ_op &gt; 26 °C</td><td class="num">${activeFR.over26} h/an</td><td>Indicateur d'inconfort global 8760 h</td></tr>
      </tbody>
    </table></div>
    <div class="reco-list">${activeFR.recos.map(r => `<div class="reco-item">${r}</div>`).join('')}</div>
  `;

  renderMinergieTab(activeFR, project);

  // Onglet Comparateur complet
  const compList = res.behavioralScenarios || res.variants;
  document.getElementById('sub-compare').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Scénario comparé</th><th>Hypothèses</th><th class="num">&gt; 26.5 °C</th><th class="num">SIA 180</th><th class="num">Degrés-heures</th><th class="num">θ_op Min / Max</th><th class="num">Score</th></tr></thead>
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

  // Onglet Méthode 2 (Fig. 12)
  const m2 = activeFR.prescriptive.method2;
  document.getElementById('sub-m2').innerHTML = `
    <div style="margin-bottom:8px;">Méthode 2 (Fig. 12 SIA 180) : ${badge(m2.pass, 'Satisfaite', 'Non satisfaite → Méthode 3')}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Orientation / Critère</th><th class="num">Calculé</th><th class="num">Limite SIA</th><th>Statut</th></tr></thead>
      <tbody>
        ${m2.rows
          .map(
            r => `<tr>
              <td>Orientation ${r.orient} (A_vit=${r.winA.toFixed(1)} m², f_g≈${(r.fg * 100).toFixed(0)} %)</td>
              <td class="num">g_tot=${r.maxG.toFixed(3)}</td>
              <td class="num">≤ ${r.limG.toFixed(3)}</td>
              <td>${badge(r.ok, 'OK', 'Trop élevé')}</td>
            </tr>`
          )
          .join('')}
        <tr><td>Capacité thermique (EN-102)</td><td class="num">${activeFR.floor.cSpec.toFixed(0)} Wh/(m²·K)</td><td class="num">≥ 45</td><td>${badge(m2.capOk, 'OK', 'Insuffisante')}</td></tr>
        <tr><td>Toiture U</td><td class="num">${activeFR.floor.uRoofExt.toFixed(2)} W/(m²·K)</td><td class="num">≤ 0.20</td><td>${badge(m2.roofOk, 'OK', 'Trop élevé')}</td></tr>
        <tr><td>Refroidissement nocturne</td><td class="num">${activeFR.nomNightSpec.toFixed(1)} m³/(h·m²)</td><td class="num">≥ 10.0</td><td>${badge(m2.nightOk, 'OK', 'Insuffisant')}</td></tr>
      </tbody>
    </table></div>
  `;

  // Onglet Méthode 1 (Tableau 8)
  const m1 = activeFR.prescriptive.method1;
  document.getElementById('sub-m1').innerHTML = `
    <div style="margin-bottom:8px;">Méthode 1 (Tableau 8 SIA 180) : ${badge(m1.pass, 'Satisfaite', 'Non satisfaite → Méthode 2 ou 3')}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Critère simplifié SIA 180</th><th class="num">Valeur</th><th>Statut</th></tr></thead>
      <tbody>${m1.criteria
        .map(c => `<tr><td>${escapeHtml(c.label)}</td><td class="num">${escapeHtml(c.val)}</td><td>${badge(c.ok, 'OK', 'Non respecté')}</td></tr>`)
        .join('')}</tbody>
    </table></div>
  `;

  // Onglet Synthèse par étage
  document.getElementById('sub-floors').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Étage</th><th class="num">Surface</th><th class="num">θ_op Min / Max</th><th class="num">Été Min / Max</th><th class="num">&gt; 26.5 °C</th><th class="num">SIA 180</th><th class="num">Froid fictif</th><th class="num">Score</th><th>Statut</th></tr></thead>
      <tbody>${res.floorResults
        .map(
          fr => `<tr>
            <td><strong>${escapeHtml(fr.floor.name)}</strong></td>
            <td class="num">${fr.floor.area.toFixed(0)} m²</td>
            <td class="num">${fr.minTop.toFixed(1)} / ${fr.maxTop.toFixed(1)} °C</td>
            <td class="num">${fr.summerMinTop.toFixed(1)} / ${fr.summerMaxTop.toFixed(1)} °C</td>
            <td class="num">${fr.overMinergie265} h</td>
            <td class="num"><strong>${fr.overSIA} h/an</strong></td>
            <td class="num">${fr.maxCoolWm2.toFixed(1)} W/m²</td>
            <td class="num">${fr.score}/100</td>
            <td>${badge((isMinergie ? fr.overMinergie265 <= 100 : fr.overSIA <= limH), 'Conforme', 'Non conforme')}</td>
          </tr>`
        )
        .join('')}</tbody>
    </table></div>
  `;

  // Onglet Méthodologie & Traçabilité
  document.getElementById('sub-methodology').innerHTML = renderMethodologyPanel(activeFR, project);

  renderComfortSection(activeFR);

  requestAnimationFrame(() => {
    const winMode = document.getElementById('plotWindow').value;
    const compareFloors = document.getElementById('plotCompareFloors').checked;
    drawGainsDetailChart(activeFR);
    timeChartMeta = drawTimeChart(res, activeFR, winMode, compareFloors);
    drawSIAChart(activeFR, project.siaCurveMode);
    drawBalanceChart(activeFR);
    drawOrientChart(activeFR);
    drawAdaptiveComparisonChart(activeFR, project.siaCurveMode);
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
      tooltipEl.style.left = Math.min(window.innerWidth - 230, e.clientX + 14) + 'px';
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
    (pt, meta) => `<strong>Jour ${pt.d + 1} — ${String(pt.hod).padStart(2, '0')}h00</strong><br>
      Temp. intérieure : <strong>${pt.Top.toFixed(1)} °C</strong><br>
      Temp. extérieure : ${pt.Te.toFixed(1)} °C<br>
      Seuil confort : ${meta.thresholdC.toFixed(1)} °C`
  );

  document.getElementById('resFloorSelect').addEventListener('change', onRenderResults);
  document.getElementById('plotWindow').addEventListener('change', () => {
    if (appState.lastResults) onRenderResults();
  });
  document.getElementById('plotCompareFloors').addEventListener('change', () => {
    if (appState.lastResults) onRenderResults();
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
      'Heure;Jour;HeureJour;Te_C;T_rm48_C;T_rmEN_C;Top_C;Tair_C;Ts_rad_C;Limite_Sup_SIA_C;Occupation;Surchauffe_SIA;Q_sol_W;Q_sol_brut_W;Q_int_W;Q_gens_W;Q_lampes_W;Q_appareils_W;Q_tr_W;Q_slab_W;Q_ve_jour_W;Q_ve_nuit_W\n';
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
          p.qVeNight.toFixed(1)
        ].join(';')
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'simulation_surchauffe_minergie_sia180.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
