/**
 * @fileoverview Panneau "Méthodologie & Traçabilité" : expose de façon transparente
 * les 8 modules de calcul (`src/methodology/01..08`), les équations utilisées et les
 * grandeurs intermédiaires exactes de l'étage sélectionné.
 */

import { escapeHtml } from '../state/project-store.js';

export function renderMethodologyPanel(activeFR, project) {
  const fp = activeFR.fp;
  const fl = activeFR.floor;
  const comfort = activeFR.comfort;

  const g = activeFR.gains;

  return `
    <p class="subtitle" style="margin-top:0;margin-bottom:12px;">
      Chaque étape du calcul correspond directement à un module numéroté dans <code>src/methodology/</code>.
      Les valeurs ci-dessous reflètent exactement l'étage actif : <strong>${escapeHtml(fl.name)}</strong>.
    </p>

    <div class="method-step">
      <div class="method-step-head">
        <strong>1. Géométrie solaire &amp; Ombrage proche / horizon (EN 13790 / Minergie)</strong>
        <span class="method-file">src/methodology/01-solar-geometry.js</span>
      </div>
      <div class="formula-box">I_inc(t) = I_bn · max(0, cos θ_i) · (1 − f_ombre) + I_dh · F_sky + ρ · I_gh · (1 − cos β)/2
f_ombre = 1 − (1 − f_casq) · (1 − f_écrans_lat)  |  Horizon bloqué si α_sol ≤ α_hor (${project.horizonDeg ?? 0}°)</div>
      <small style="color:var(--text-muted);">
        Calcul horaire à la demi-heure solaire locale (${project.climate.lat.toFixed(2)}°N, ${project.climate.lon.toFixed(2)}°E). Automatisation des stores à 200 W/m² (SIA 380/2 §3.2.3.1 &amp; 7.1.2).
      </small>
    </div>

    <div class="method-step">
      <div class="method-step-head">
        <strong>2. Données climatiques, Scénario 2035 &amp; Îlot de chaleur (UHI)</strong>
        <span class="method-file">src/methodology/02-weather-model.js</span>
      </div>
      <div class="formula-box">θ_rm,48h(t) = (1/48) · Σ θ_e(t − j)   [SIA 180]
θ_rm,EN(d) = (1 − α) · θ_e,d-1 + α · θ_rm,EN(d−1)   (α = 0.8)   [EN 16798-1]
Scénario : ${escapeHtml(project.climate.scenario)} | Îlot de chaleur urbain : ${project.climate.urbanHeatIsland ? 'Actif (+0.4 °C jour / +1.8 °C nuit)' : 'Inactif'}</div>
      <small style="color:var(--text-muted);">
        Pré-amorçage circulaire sur les 48 dernières heures de l'année pour éliminer tout artefact au 1er janvier.
      </small>
    </div>

    <div class="method-step">
      <div class="method-step-head">
        <strong>3. Enveloppe 5R1C, Inertie &amp; Détail des gains (ISO 13790 / SIA 380/1)</strong>
        <span class="method-file">src/methodology/03-envelope-and-gains.js</span>
      </div>
      <div class="formula-box">A_tot = ${fp.A_tot.toFixed(1)} m²  |  A_m = ${fp.A_m.toFixed(1)} m²  |  C_m = ${(fp.C_m / 3600000).toFixed(2)} kWh/K (C_R/A_SNP = ${fl.cSpec} Wh/m²K)
H_tr,w = ${fp.H_tr_w.toFixed(2)} W/K  |  H_tr,op = ${fp.H_tr_op.toFixed(2)} W/K  |  H_tr,em = ${fp.H_tr_em.toFixed(2)} W/K
H_is = ${fp.H_is.toFixed(1)} W/K  |  H_ms = ${fp.H_ms.toFixed(1)} W/K  |  Constante de temps τ = ${fp.tauHours.toFixed(1)} h
Gains internes pointe : ${g ? `${g.internalTotal.peakW.toFixed(0)} W (Gens ${g.people.peakW.toFixed(0)} W + Lampes ${g.lighting.peakW.toFixed(0)} W + Appareils ${g.appliances.peakW.toFixed(0)} W)` : '—'}</div>
      <small style="color:var(--text-muted);">
        Surface vitrée totale : ${fp.winArea.toFixed(2)} m² (Z_g = ${(fp.winArea / Math.max(1, fl.area)).toFixed(2)}) • Facteur g_tot moyen : ${activeFR.avgGtot.toFixed(3)} •
        Présence occupant (t_p / plage) : ${(fl.occPresenceFactor ?? 1).toFixed(2)}.
      </small>
    </div>

    <div class="method-step">
      <div class="method-step-head">
        <strong>4. Ventilation diurne &amp; Déstockage nocturne</strong>
        <span class="method-file">src/methodology/04-natural-ventilation.js</span>
      </div>
      <div class="formula-box">Q_mono = (1/3) · C_d · A_ouv · √(g · H_ouv · ΔT / T_e,K) · C_k(α)
H_ve(t) = 0.335 · (q_hyg + q_infil + q_nuit(t))   [W/K]</div>
      <small style="color:var(--text-muted);">
        Mode nocturne actif : <code>${escapeHtml(fl.nightVentMode)}</code> • Hauteur de tirage bâtiment : ${activeFR.buildingStackSpan.toFixed(2)} m •
        Débit nominal (ΔT=8 K) : <strong>${activeFR.nomNightM3h.toFixed(0)} m³/h (${activeFR.nomNightSpec.toFixed(1)} m³/(h·m²))</strong>.
      </small>
    </div>

    <div class="method-step">
      <div class="method-step-head">
        <strong>5. Solveur Crank-Nicolson 5R1C multi-étages</strong>
        <span class="method-file">src/methodology/05-thermal-5r1c-engine.js</span>
      </div>
      <div class="formula-box">θ_m(t+Δt) = [θ_m(t)·(C_m/Δt − 0.5·H_tot) + Φ_m,tot] / (C_m/Δt + 0.5·H_tot)   (Δt = 900 s, 4 sous-pas/h)
θ_op(t) = 0.30 · θ_air(t) + 0.70 · θ_s(t)</div>
      <small style="color:var(--text-muted);">
        Pré-chauffe de 360 h, maintien hivernal θ_op ≥ 20.0 °C (SIA 380/1), couplage des dalles inter-étages (${project.stackCoupling ? 'actif' : 'désactivé'}) et passe parallèle pour puissance froid fictive.
      </small>
    </div>

    <div class="method-step">
      <div class="method-step-head">
        <strong>6. Conformité SIA 180 &amp; Minergie Variante 2</strong>
        <span class="method-file">src/methodology/06-sia180-compliance.js + src/standards/minergie.js</span>
      </div>
      <div class="formula-box">SIA 180 Fig. 3 : θ_sup = max(25.0, 0.33·θ_rm,48 + 21.8)  |  Minergie 2035 : θ_op ≤ 26.5 °C (max 100 h/an)
Heures SIA : ${activeFR.overSIA} h/an  |  Heures Minergie (&gt;26.5 °C) : ${activeFR.overMinergie265} h/an  |  Score : ${activeFR.score}/100</div>
    </div>

    <div class="method-step">
      <div class="method-step-head">
        <strong>7. Confort thermique multi-normes &amp; Études scientifiques</strong>
        <span class="method-file">src/methodology/07-thermal-comfort.js</span>
      </div>
      <div class="formula-box">EN 16798-1 : θ_c = 0.33·θ_rm + 18.8  |  ASHRAE 55 : θ_c = 0.31·θ_pma + 17.8
ISO 7730 : PMV itératif (Fanger, ${comfort.params.clo} clo, ${comfort.params.met} met, ${comfort.params.airSpeed} m/s, ${comfort.params.rh} % HR)
CIBSE TM52/59 (3 %, W_e ≤ 6 Kh, ΔT ≤ 4 K, nuit ≤ 1 % &gt; 26 °C)  |  Seppänen (2006) LBNL</div>
    </div>

    <div class="method-step">
      <div class="method-step-head">
        <strong>8. Comparateur de résilience (4 scénarios)</strong>
        <span class="method-file">src/methodology/08-scenario-comparator.js</span>
      </div>
      <small style="color:var(--text-muted);">
        Ré-exécute le moteur complet 5R1C pour comparer Configuration actuelle, Optimisation passive, Comportement dégradé et Climat 2050 (+1.5 °C).
      </small>
    </div>
  `;
}
