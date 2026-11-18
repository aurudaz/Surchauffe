/**
 * @fileoverview Gestion de l'interface Résultats :
 *  - KPIs principaux & verdicts SIA 180 (Méthodes 1, 2, 3)
 *  - Section dédiée au Confort Thermique (EN 16798-1, ASHRAE 55, ISO 7730 PMV/PPD, CIBSE TM52/TM59, OMS/Sommeil, Seppänen 2006)
 *  - Panneau Méthodologie & Traçabilité
 *  - Graphiques interactifs & exports CSV / PDF
 */

import { evaluateThermalComfort } from '../methodology/07-thermal-comfort.js';
import { appState, escapeHtml } from '../state/project-store.js';
import {
  drawAdaptiveComparisonChart,
  drawBalanceChart,
  drawOrientChart,
  drawSIAChart,
  drawTimeChart
} from './charts.js';
import { renderMethodologyPanel } from './methodology-view.js';

let timeChartMeta = null;

function badge(ok, yesLabel = 'Conforme', noLabel = 'Non conforme', warnMode = false) {
  return `<span class="pill ${ok ? 'ok' : warnMode ? 'warn' : 'ko'}">${ok ? yesLabel : noLabel}</span>`;
}

function renderComfortSection(activeFR, isAdv) {
  const c = activeFR.comfort;
  if (!c) return;
  const p = c.params;

  const pmvVerdict = Math.abs(c.fanger.meanPmv) <= 0.5;
  const pmvPeakVerdict = c.fanger.maxPmv <= 1.0;
  const pmvBadgeHtml =
    c.fanger.meanPmv > 0.5
      ? badge(false, '', 'Inconfort chaud', c.fanger.meanPmv <= 0.7)
      : c.fanger.meanPmv < -0.5
        ? badge(false, '', `Frais (${p.clo.toFixed(2)} clo)`, true)
        : badge(pmvPeakVerdict, 'Classe B OK', 'Pic chaud', true);

  document.getElementById('comfortSectionBody').innerHTML = `
    <div class="well" style="margin-bottom:12px;">
      <div class="well-head" style="margin-bottom:8px;padding-bottom:6px;">
        <strong>Paramètres physiologiques pour le modèle analytique ISO 7730 (Fanger PMV/PPD)</strong>
        <span class="pill neutral">T_mr = θ_s (surfaces 5R1C)</span>
      </div>
      <div class="g4">
        <div class="field">
          <label>Habillement été [clo] : <strong id="lblComfortClo">${p.clo.toFixed(2)}</strong></label>
          <input type="range" id="inComfortClo" min="0.30" max="1.00" step="0.05" value="${p.clo}" />
          <small>0.35 short/T-shirt • 0.50 été • 1.00 hiver</small>
        </div>
        <div class="field">
          <label>Métabolisme [met] : <strong id="lblComfortMet">${p.met.toFixed(2)}</strong></label>
          <input type="range" id="inComfortMet" min="0.80" max="2.00" step="0.10" value="${p.met}" />
          <small>1.0 repos • 1.2 bureau/séjour • 1.6 actif</small>
        </div>
        <div class="field">
          <label>Vitesse d'air v_a [m/s] : <strong id="lblComfortVel">${p.airSpeed.toFixed(2)}</strong></label>
          <input type="range" id="inComfortVel" min="0.05" max="0.80" step="0.05" value="${p.airSpeed}" />
          <small>0.10 calme • 0.15 nat. • 0.50 brasseur</small>
        </div>
        <div class="field">
          <label>Humidité relative [%] : <strong id="lblComfortRh">${p.rh.toFixed(0)}</strong></label>
          <input type="range" id="inComfortRh" min="25" max="80" step="5" value="${p.rh}" />
          <small>Plage recommandée SIA 180 : 30–65 %</small>
        </div>
      </div>
    </div>

    <div class="comfort-grid">
      <div class="comfort-card">
        <div class="comfort-card-head">
          <strong>EN 16798-1:2019 (Adaptatif EU)</strong>
          ${badge(c.en16798.passCat2, 'Cat. II OK', 'Hors Cat. II')}
        </div>
        <div class="comfort-ref">θ_c = 0.33·θ_rm(α=0.8) + 18.8 °C (réf. européenne)</div>
        <div class="comfort-metric">${c.en16798.cat2OkPct.toFixed(1)} % <span style="font-size:12px;font-weight:500;color:var(--text-muted);">en Cat. II (${c.en16798.cat2HotH} h chaud)</span></div>
        <div style="font-size:12px;color:var(--text-muted);">
          Cat. I : <strong>${c.en16798.cat1OkPct.toFixed(1)} %</strong> (${c.en16798.cat1HotH} h chaud) •
          Cat. III : <strong>${c.en16798.cat3OkPct.toFixed(1)} %</strong> (${c.en16798.cat3HotH} h &gt; +4 K)
        </div>
      </div>

      <div class="comfort-card">
        <div class="comfort-card-head">
          <strong>ASHRAE 55-2020 (de Dear &amp; Brager)</strong>
          ${badge(c.ashrae55.pass80, '80 % OK', 'Hors 80 %')}
        </div>
        <div class="comfort-ref">θ_comf = 0.31·θ_pma(7j) + 17.8 °C (±2.5 / ±3.5 K)</div>
        <div class="comfort-metric">${c.ashrae55.pct80Ok.toFixed(1)} % <span style="font-size:12px;font-weight:500;color:var(--text-muted);">acceptabilité 80 %</span></div>
        <div style="font-size:12px;color:var(--text-muted);">
          Plage 90 % (±2.5 K) : <strong>${c.ashrae55.pct90Ok.toFixed(1)} %</strong> •
          Dépassement chaud (&gt; 80 %) : <strong>${c.ashrae55.hot80H} h</strong>
        </div>
      </div>

      <div class="comfort-card">
        <div class="comfort-card-head">
          <strong>ISO 7730:2005 — Fanger PMV / PPD</strong>
          ${pmvBadgeHtml}
        </div>
        <div class="comfort-ref">Bilan thermique humain (Mai–Septembre, jour 07h–22h)</div>
        <div class="comfort-metric">PMV ${c.fanger.meanPmv >= 0 ? '+' : ''}${c.fanger.meanPmv.toFixed(2)} <span style="font-size:12px;font-weight:500;color:var(--text-muted);">(PPD moy. ${c.fanger.meanPpd.toFixed(1)} %)</span></div>
        <div style="font-size:12px;color:var(--text-muted);">
          Pic été : <strong>PMV ${c.fanger.maxPmv >= 0 ? '+' : ''}${c.fanger.maxPmv.toFixed(2)}</strong> (PPD ${c.fanger.maxPpd.toFixed(0)} %) •
          Classe B : <strong>${c.fanger.pctClassB.toFixed(0)} %</strong> • Δ|T_air−T_s| max : ${c.fanger.maxRadiantDelta.toFixed(1)} K
        </div>
      </div>

      <div class="comfort-card">
        <div class="comfort-card-head">
          <strong>CIBSE TM52 (2013) &amp; TM59 (2017)</strong>
          ${badge(c.cibse.tm52Pass, 'TM52 OK', `TM52 Échec (${c.cibse.failCount}/3)`)}
        </div>
        <div class="comfort-ref">Sévérité surchauffe (3 critères, échec si ≥ 2 dépassés)</div>
        <div class="comfort-metric">${c.cibse.exceedPct.toFixed(1)} % <span style="font-size:12px;font-weight:500;color:var(--text-muted);">heures ΔT ≥ 1 K (seuil ≤ 3 %)</span></div>
        <div style="font-size:12px;color:var(--text-muted);">
          W_e max/j : <strong>${c.cibse.maxDailyWe.toFixed(1)} Kh</strong> (≤ 6) •
          ΔT_max : <strong>${c.cibse.maxDeltaT.toFixed(1)} K</strong> (≤ 4) •
          Nuit TM59 &gt;26 °C : <strong>${c.cibse.tm59NightOver26Pct.toFixed(1)} %</strong>
        </div>
      </div>

      <div class="comfort-card">
        <div class="comfort-card-head">
          <strong>OMS (2018) &amp; Qualité du sommeil</strong>
          ${badge(c.cibse.tm59Pass, 'Nuit OK', 'Risque sommeil', c.healthSleep.nightOver26H > 0)}
        </div>
        <div class="comfort-ref">WHO Housing Guidelines &amp; Lan et al. (2017)</div>
        <div class="comfort-metric">${c.healthSleep.nightOver26H} h <span style="font-size:12px;font-weight:500;color:var(--text-muted);">nocturnes &gt; 26 °C (22h–07h)</span></div>
        <div style="font-size:12px;color:var(--text-muted);">
          Nuits &gt; 24 °C : <strong>${c.healthSleep.nightOver24H} h</strong> •
          Nuits intérieures ≥ 24 °C min : <strong>${c.healthSleep.indoorTropicalNights} nuits</strong> •
          Occ. &gt; 24 °C : ${c.healthSleep.occOver24Pct.toFixed(0)} %
        </div>
      </div>

      <div class="comfort-card">
        <div class="comfort-card-head">
          <strong>Seppänen, Fisk &amp; Lei (2006)</strong>
          ${badge(c.productivity.meanLossPct <= 2.0, 'Impact faible', 'Perte &gt; 2 %', true)}
        </div>
        <div class="comfort-ref">LBNL-60952 : performance cognitive vs température</div>
        <div class="comfort-metric">${c.productivity.meanRelativePct.toFixed(1)} % <span style="font-size:12px;font-weight:500;color:var(--text-muted);">productivité estivale moy.</span></div>
        <div style="font-size:12px;color:var(--text-muted);">
          Perte de pointe : <strong>−${c.productivity.peakLossPct.toFixed(1)} %</strong> •
          Heures avec perte &gt; 2 % : <strong>${c.productivity.hoursLossOver2Pct} h</strong>
        </div>
      </div>
    </div>

    ${
      isAdv
        ? `
    <div class="charts-two">
      <div>
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">
          Comparaison des domaines adaptatifs : EN 16798-1 (Cat I/II/III), ASHRAE 55 (80 %) &amp; SIA 180
        </div>
        <div class="chart-box" style="height:230px;"><canvas id="chartComfortAdaptive"></canvas></div>
      </div>
      <div>
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">
          Détail des critères et répartitions ISO 7730 / CIBSE TM52
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Critère / Étude</th><th class="num">Valeur mesurée</th><th class="num">Seuil référence</th><th>Statut</th></tr></thead>
          <tbody>
            <tr><td>CIBSE TM52 — Crit. 1 (Heures ΔT ≥ 1 K)</td><td class="num">${c.cibse.exceedPct.toFixed(2)} % (${c.cibse.exceed1KHours} h)</td><td class="num">≤ 3.0 %</td><td>${badge(!c.cibse.crit1Fail, 'OK', 'Dépassé')}</td></tr>
            <tr><td>CIBSE TM52 — Crit. 2 (Sévérité jour W_e)</td><td class="num">${c.cibse.maxDailyWe.toFixed(1)} Kh (${c.cibse.daysOver6} j)</td><td class="num">≤ 6.0 Kh</td><td>${badge(!c.cibse.crit2Fail, 'OK', 'Dépassé')}</td></tr>
            <tr><td>CIBSE TM52 — Crit. 3 (Pic ΔT_max)</td><td class="num">${c.cibse.maxDeltaT.toFixed(1)} K</td><td class="num">≤ 4.0 K</td><td>${badge(!c.cibse.crit3Fail, 'OK', 'Dépassé')}</td></tr>
            <tr><td>CIBSE TM59 — Chambres nuit (&gt; 26 °C)</td><td class="num">${c.cibse.tm59NightOver26Pct.toFixed(2)} % (${c.cibse.tm59NightOver26H} h)</td><td class="num">≤ 1.0 %</td><td>${badge(c.cibse.tm59Pass, 'OK', 'Dépassé')}</td></tr>
            <tr><td>ISO 7730 — Classes A / B / C (été)</td><td class="num">${c.fanger.pctClassA.toFixed(0)}% / ${c.fanger.pctClassB.toFixed(0)}% / ${c.fanger.pctClassC.toFixed(0)}%</td><td class="num">|PMV| ≤ 0.2 / 0.5 / 0.7</td><td>${pmvBadgeHtml}</td></tr>
            <tr><td>Asymétrie θ_air − θ_s max (ISO 7730)</td><td class="num">${c.fanger.maxRadiantDelta.toFixed(2)} K</td><td class="num">&lt; 5.0 K</td><td>${badge(c.fanger.maxRadiantDelta < 5.0, 'OK', 'Élevée')}</td></tr>
          </tbody>
        </table></div>
      </div>
    </div>`
        : ''
    }
  `;

  // Bind live comfort sliders (recalcule instantanément sans relancer le 5R1C)
  const rebindComfort = (id, key, lblId, fmt) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      appState.comfortParams[key] = parseFloat(el.value);
      document.getElementById(lblId).textContent = fmt(appState.comfortParams[key]);
      activeFR.comfort = evaluateThermalComfort(activeFR.series, appState.comfortParams);
      renderComfortSection(activeFR, isAdv);
      if (isAdv) requestAnimationFrame(() => drawAdaptiveComparisonChart(activeFR, appState.project.siaCurveMode));
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
  sel.innerHTML =
    `<option value="WORST">Étage critique (${escapeHtml(res.worstFloor.floor.name)})</option>` +
    res.floorResults
      .map(fr => `<option value="${escapeHtml(fr.floor.id)}">${escapeHtml(fr.floor.name)} (${fr.overSIA} h)</option>`)
      .join('');
  sel.value =
    prev && (prev === 'WORST' || res.floorResults.some(fr => fr.floor.id === prev)) ? prev : 'WORST';

  const activeFR =
    sel.value === 'WORST' ? res.worstFloor : res.floorResults.find(fr => fr.floor.id === sel.value);
  const limH = res.limHours;
  const pass = activeFR.overSIA <= limH;
  const coolOk = activeFR.maxCoolWm2 <= 12.0;
  const isAdv = uiModes.results === 'advanced';

  document.getElementById('resProjectTitle').textContent = `${project.name} — ${activeFR.floor.name}`;
  document.getElementById('resSubMeta').textContent =
    `${res.weatherLabel}  •  Modèle 5R1C ISO 13790  •  θ_e,max = ${res.maxTe.toFixed(1)} °C (${res.tropicalNights} nuits tropicales)`;

  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi-box">
      <div class="kpi-label">Heures de surchauffe (SIA 180)</div>
      <div class="kpi-val" style="color:${pass ? 'var(--ok)' : 'var(--ko)'}">${activeFR.overSIA} h/an</div>
      <div class="kpi-sub">Tolérance : ≤ ${limH} h/an (EN-102 : ${activeFR.overSIA === 0 ? '0 h OK' : 'Dépassé'})</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Température opérative max θ_op</div>
      <div class="kpi-val" style="color:${activeFR.maxTop > 28 ? 'var(--ko)' : 'var(--primary)'}">${activeFR.maxTop.toFixed(1)} °C</div>
      <div class="kpi-sub">Degrés-heures : <strong>${activeFR.dhSIA.toFixed(1)} Kh</strong> (J${Math.floor(activeFR.maxTopHour / 24) + 1} à ${activeFR.maxTopHour % 24}h)</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Score de résilience estivale</div>
      <div class="kpi-val" style="color:${activeFR.score >= 75 ? 'var(--ok)' : activeFR.score >= 45 ? 'var(--warn)' : 'var(--ko)'}">${activeFR.score} / 100</div>
      <div class="kpi-sub">Synthèse physique 5R1C</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Confort EN 16798-1 / PMV été</div>
      <div class="kpi-val" style="color:${activeFR.comfort.en16798.cat2OkPct >= 97 ? 'var(--ok)' : 'var(--warn)'}">${activeFR.comfort.en16798.cat2OkPct.toFixed(0)} % Cat.II</div>
      <div class="kpi-sub">PMV moy. ${activeFR.comfort.fanger.meanPmv >= 0 ? '+' : ''}${activeFR.comfort.fanger.meanPmv.toFixed(2)} • TM52 : ${activeFR.comfort.cibse.tm52Pass ? 'OK' : 'Échec'}</div>
    </div>
    <div class="kpi-box res-adv-only">
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

  // Onglet Méthode 3
  document.getElementById('sub-m3').innerHTML = `
    <div style="margin-bottom:8px;">
      Verdict SIA 180 : ${badge(pass)}
      ${isAdv ? `&nbsp; ${badge(coolOk, 'Froid fictif ≤ 12 W/m²', 'Froid fictif > 12 W/m²', true)}` : ''}
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Critère SIA 180 / SIA 380/2</th><th class="num">Valeur</th><th>Statut / Référence</th></tr></thead>
      <tbody>
        <tr><td>Heures d'occupation analysées</td><td class="num">${activeFR.occH} h/an</td><td>${activeFR.floor.occStart}h–${activeFR.floor.occEnd}h (${activeFR.floor.occDays} j/sem)</td></tr>
        <tr><td>Heures de surchauffe SIA 180</td><td class="num"><strong>${activeFR.overSIA} h/an</strong></td><td>${badge(pass, `≤ ${limH} h/an`, `> ${limH} h/an`)}</td></tr>
        <tr><td>Puissance / besoin froid pour 0 h de surchauffe</td><td class="num">${activeFR.maxCoolW.toFixed(0)} W (${activeFR.maxCoolWm2.toFixed(1)} W/m²)</td><td>${activeFR.coolKWhm2.toFixed(1)} kWh/(m²·an)</td></tr>
        <tr><td>Heures toutes périodes θ_op &gt; 26 °C</td><td class="num">${activeFR.over26} h/an</td><td>Indicateur d'inconfort global 8760 h</td></tr>
      </tbody>
    </table></div>
    <div class="reco-list">${activeFR.recos.map(r => `<div class="reco-item">${r}</div>`).join('')}</div>
  `;

  // Onglet Comparateur
  document.getElementById('sub-compare').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Scénario comparé</th><th>Hypothèses</th><th class="num">Surchauffe SIA</th><th class="num">Degrés-heures</th><th class="num">θ_op,max</th><th class="num">Score</th></tr></thead>
      <tbody>${res.variants
        .map(
          v => `<tr>
            <td><strong>${escapeHtml(v.label)}</strong></td>
            <td><small style="color:var(--text-muted);">${escapeHtml(v.note)}</small></td>
            <td class="num"><strong>${v.wf.overSIA} h/an</strong></td>
            <td class="num">${v.wf.dhSIA.toFixed(1)} Kh</td>
            <td class="num">${v.wf.maxTop.toFixed(1)} °C</td>
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

  // Onglet Méthode 1 (Tableau 8 restauré intégralement)
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
      <thead><tr><th>Étage</th><th class="num">Surface</th><th class="num">θ_op,max</th><th class="num">Surchauffe SIA</th><th class="num">PMV moy. été</th><th class="num">Froid fictif</th><th class="num">Score</th><th>Statut</th></tr></thead>
      <tbody>${res.floorResults
        .map(
          fr => `<tr>
            <td><strong>${escapeHtml(fr.floor.name)}</strong></td>
            <td class="num">${fr.floor.area.toFixed(0)} m²</td>
            <td class="num">${fr.maxTop.toFixed(1)} °C</td>
            <td class="num"><strong>${fr.overSIA} h/an</strong></td>
            <td class="num">${fr.comfort.fanger.meanPmv >= 0 ? '+' : ''}${fr.comfort.fanger.meanPmv.toFixed(2)}</td>
            <td class="num">${fr.maxCoolWm2.toFixed(1)} W/m²</td>
            <td class="num">${fr.score}/100</td>
            <td>${badge(fr.overSIA <= limH, 'Conforme', 'Non conforme')}</td>
          </tr>`
        )
        .join('')}</tbody>
    </table></div>
  `;

  // Onglet Méthodologie & Traçabilité
  document.getElementById('sub-methodology').innerHTML = renderMethodologyPanel(activeFR, project);

  // Section dédiée Confort Thermique (Normes & Études)
  renderComfortSection(activeFR, isAdv);

  document.querySelectorAll('.res-adv-only').forEach(el => el.classList.toggle('hidden', !isAdv));

  requestAnimationFrame(() => {
    const winMode = document.getElementById('plotWindow').value;
    const compareFloors = document.getElementById('plotCompareFloors').checked;
    timeChartMeta = drawTimeChart(res, activeFR, winMode, compareFloors);
    drawSIAChart(activeFR, project.siaCurveMode);
    if (isAdv) {
      drawBalanceChart(activeFR);
      drawOrientChart(activeFR);
      drawAdaptiveComparisonChart(activeFR, project.siaCurveMode);
    }
  });
}

export function bindResultsEvents({ onEnsureSimulation, onRenderResults }) {
  document.querySelectorAll('.sub-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ['m3', 'compare', 'm2', 'm1', 'floors', 'methodology'].forEach(t =>
        document.getElementById('sub-' + t).classList.add('hidden')
      );
      document.getElementById('sub-' + btn.dataset.sub).classList.remove('hidden');
    });
  });

  const chartTimeEl = document.getElementById('chartTime');
  const tooltipEl = document.getElementById('chartTooltip');
  chartTimeEl.addEventListener('mousemove', e => {
    if (!timeChartMeta) return;
    const { c, i0, i1, pad, pw, activeFR } = timeChartMeta;
    const rect = c.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    if (mx < pad.l || mx > pad.l + pw) {
      tooltipEl.style.display = 'none';
      return;
    }
    const idx = Math.min(i1, Math.max(i0, Math.round(i0 + ((mx - pad.l) / pw) * (i1 - i0))));
    const pt = activeFR.series[idx];
    tooltipEl.innerHTML = `<strong>Jour ${pt.d + 1} — ${String(pt.hod).padStart(2, '0')}h00</strong><br>
      θ_op : <strong>${pt.Top.toFixed(1)} °C</strong> (air ${pt.Tair.toFixed(1)} °C | rad ${pt.Ts.toFixed(1)} °C)<br>
      θ_ext : ${pt.Te.toFixed(1)} °C | Limite SIA : ${pt.limUpper.toFixed(1)} °C`;
    tooltipEl.style.display = 'block';
    tooltipEl.style.left = Math.min(window.innerWidth - 230, e.clientX + 14) + 'px';
    tooltipEl.style.top = e.clientY - 12 + 'px';
  });
  chartTimeEl.addEventListener('mouseleave', () => {
    tooltipEl.style.display = 'none';
  });

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
      'Heure;Jour;HeureJour;Te_C;T_rm48_C;T_rmEN_C;Top_C;Tair_C;Ts_rad_C;Limite_Sup_SIA_C;Occupation;Surchauffe_SIA;Q_sol_W;Q_int_W;Q_tr_W;Q_slab_W;Q_ve_jour_W;Q_ve_nuit_W\n';
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
          p.qInt.toFixed(1),
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
    a.download = 'simulation_sia180.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
