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
          <strong>OMS (WHO 2018) — Santé &amp; Sommeil</strong>
          ${badge(c.healthSleep.nightOver26H <= 32, 'Nuit OK', 'Chaleur nocturne', c.healthSleep.nightOver26H <= 100)}
        </div>
        <div class="comfort-ref">WHO Housing &amp; Health Guidelines (seuil santé 24 °C / sommeil 26 °C)</div>
        <div class="comfort-metric">${c.healthSleep.nightOver26H} h <span style="font-size:12px;font-weight:500;color:var(--text-muted);">nocturnes &gt; 26 °C (22h–07h)</span></div>
        <div style="font-size:12px;color:var(--text-muted);">
          Nuits &gt; 24 °C : <strong>${c.healthSleep.nightOver24H} h</strong> •
          Nuits chaudes ≥ 24 °C min : <strong>${c.healthSleep.indoorTropicalNights} nuits</strong> •
          Jour &gt; 24 °C : ${c.healthSleep.occOver24Pct.toFixed(0)} %
        </div>
      </div>

      <div class="comfort-card">
        <div class="comfort-card-head">
          <strong>EN 16798-1:2019 (Adaptatif EU)</strong>
          ${badge(c.en16798.passCat2, 'Cat. II OK', 'Hors Cat. II')}
        </div>
        <div class="comfort-ref">θ_c = 0.33·θ_rm(α=0.8) + 18.8 °C (référence européenne)</div>
        <div class="comfort-metric">${c.en16798.cat2OkPct.toFixed(1)} % <span style="font-size:12px;font-weight:500;color:var(--text-muted);">en Cat. II (${c.en16798.cat2HotH} h chaud)</span></div>
        <div style="font-size:12px;color:var(--text-muted);">
          Cat. I : <strong>${c.en16798.cat1OkPct.toFixed(1)} %</strong> (${c.en16798.cat1HotH} h chaud) •
          Cat. III : <strong>${c.en16798.cat3OkPct.toFixed(1)} %</strong> (${c.en16798.cat3HotH} h &gt; +4 K)
        </div>
      </div>

      <div class="comfort-card">
        <div class="comfort-card-head">
          <strong>ISO 7730:2005 — Fanger PMV / PPD</strong>
          ${pmvBadgeHtml}
        </div>
        <div class="comfort-ref">Confort physiologique (Mai–Sept., jour 07h–22h)</div>
        <div class="comfort-metric">PMV ${c.fanger.meanPmv >= 0 ? '+' : ''}${c.fanger.meanPmv.toFixed(2)} <span style="font-size:12px;font-weight:500;color:var(--text-muted);">(PPD moy. ${c.fanger.meanPpd.toFixed(1)} %)</span></div>
        <div style="font-size:12px;color:var(--text-muted);">
          Pic été : <strong>PMV ${c.fanger.maxPmv >= 0 ? '+' : ''}${c.fanger.maxPmv.toFixed(2)}</strong> (PPD ${c.fanger.maxPpd.toFixed(0)} %) •
          Classe B : <strong>${c.fanger.pctClassB.toFixed(0)} %</strong> • Δ|T_air−T_s| : ${c.fanger.maxRadiantDelta.toFixed(1)} K
        </div>
      </div>
    </div>

    <div class="well" style="margin-bottom:${isAdv ? '12px' : '0'};">
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

    ${
      isAdv
        ? `
    <div>
      <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">
        Domaines adaptatifs comparés : EN 16798-1 (Cat I/II/III), SECO (26 °C) &amp; SIA 180
      </div>
      <div class="chart-box" style="height:230px;"><canvas id="chartComfortAdaptive"></canvas></div>
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
    `${res.weatherLabel}  •  Modèle 5R1C ISO 13790  •  θ_e : ${res.minTe.toFixed(1)}..${res.maxTe.toFixed(1)} °C (${res.tropicalNights} nuits tropicales)`;

  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi-box">
      <div class="kpi-label">Heures de surchauffe (SIA 180)</div>
      <div class="kpi-val" style="color:${pass ? 'var(--ok)' : 'var(--ko)'}">${activeFR.overSIA} h/an</div>
      <div class="kpi-sub">Tolérance : ≤ ${limH} h/an (EN-102 : ${activeFR.overSIA === 0 ? '0 h OK' : 'Dépassé'})</div>
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
      <thead><tr><th>Scénario comparé</th><th>Hypothèses</th><th class="num">Surchauffe SIA</th><th class="num">Degrés-heures</th><th class="num">θ_op Min / Max</th><th class="num">Score</th></tr></thead>
      <tbody>${res.variants
        .map(
          v => `<tr>
            <td><strong>${escapeHtml(v.label)}</strong></td>
            <td><small style="color:var(--text-muted);">${escapeHtml(v.note)}</small></td>
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
      <thead><tr><th>Étage</th><th class="num">Surface</th><th class="num">θ_op Min / Max</th><th class="num">Été Min / Max</th><th class="num">Surchauffe SIA</th><th class="num">Froid fictif</th><th class="num">Score</th><th>Statut</th></tr></thead>
      <tbody>${res.floorResults
        .map(
          fr => `<tr>
            <td><strong>${escapeHtml(fr.floor.name)}</strong></td>
            <td class="num">${fr.floor.area.toFixed(0)} m²</td>
            <td class="num">${fr.minTop.toFixed(1)} / ${fr.maxTop.toFixed(1)} °C</td>
            <td class="num">${fr.summerMinTop.toFixed(1)} / ${fr.summerMaxTop.toFixed(1)} °C</td>
            <td class="num"><strong>${fr.overSIA} h/an</strong></td>
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
