/**
 * @fileoverview Gestion de l'interface Configuration (5 étapes, Mode Simple / Avancé,
 * inspecteur latéral, importateurs BIM/météo et synchronisation bidirectionnelle).
 */

import {
  ORIENTATIONS,
  SHADING_PRESETS,
  SIA380_CATEGORIES,
  deriveSiaInternalDefaults
} from '../standards/sia380-1.js';
import {
  BOX3D_CONTACTS,
  BOX3D_WALL_PRESETS,
  BOX3D_WINDOW_PRESETS,
  getWallOrientations
} from '../standards/box3d-presets.js';
import { SWISS_STATIONS } from '../standards/swiss-stations.js';
import {
  applyBox3dToFloor,
  buildFloorThermalParams,
  computeAutoEnvelopeFromFloor,
  ensureBox3dDefaults
} from '../methodology/03-envelope-and-gains.js';
import {
  calcSimplePctNightFlowM3s,
  computeBuildingStackSpan,
  computeFloorNightFlowM3h
} from '../methodology/04-natural-ventilation.js';
import { parseAnyWeatherText } from '../methodology/02-weather-model.js';
import { parseHouseFile } from '../parsers/house-importers.js';
import { HOUSE_LIBRARY, appState, escapeHtml } from '../state/project-store.js';
import { BuildingViewer3D } from './viewer-3d.js';

let viewerInspector = null;
let viewerMain3D = null;

export function refresh3DViewers() {
  if (!viewerInspector && document.getElementById('inspector3dCanvas')) {
    viewerInspector = new BuildingViewer3D('inspector3dCanvas');
  }
  if (viewerInspector) {
    viewerInspector.update(appState.project, appState.activeFloorId);
  }
  if (appState.uiModes.floors === 'box3d' && document.getElementById('box3dMainCanvas')) {
    if (!viewerMain3D || viewerMain3D.canvasId !== 'box3dMainCanvas') {
      viewerMain3D = new BuildingViewer3D('box3dMainCanvas');
    }
    viewerMain3D.update(appState.project, appState.activeFloorId);
  }
}

function detectShadingPresetKey(ops) {
  if (!ops || ops.length === 0) return 'triple_lamelles';
  const ref = ops[0];
  for (const [key, sp] of Object.entries(SHADING_PRESETS)) {
    if (
      Math.abs(ref.gVit - sp.gVit) < 0.02 &&
      Math.abs(ref.gStore - sp.gStore) < 0.02 &&
      ref.gtotMode === sp.gtotMode
    ) {
      return key;
    }
  }
  return 'custom';
}

export function renderFloorSelectors() {
  const { project } = appState;
  if (!project.floors.some(f => f.id === appState.activeFloorId)) {
    appState.activeFloorId = project.floors[0].id;
  }
  const opts = project.floors
    .map(f => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`)
    .join('');
  ['activeOpeningFloor', 'siaTargetFloor'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = opts;
    sel.value = appState.activeFloorId;
  });
}

function getFacadeGrossForFloor(fl) {
  return Math.max(4, Math.sqrt(Math.max(4, fl.area)) * fl.height);
}

export function updateSimpleNightLiveBadge(fl, totalWin) {
  const { project } = appState;
  const span = project.stackCoupling ? computeBuildingStackSpan(project) : fl.height;
  const { m3s, openArea } = calcSimplePctNightFlowM3s(fl, totalWin, 26, 18, span);
  const m3h = m3s * 3600;
  const spec = m3h / Math.max(1, fl.area);
  const badge = document.getElementById('simpNightLiveFlow');
  if (!badge) return;
  badge.textContent = `Ouvrant : ${openArea.toFixed(2)} m² → ${m3h.toFixed(0)} m³/h (${spec.toFixed(1)} m³/(h·m²) à ΔT=8K)`;
  badge.className = `pill ${spec >= 10 ? 'ok' : spec > 0 ? 'warn' : 'ko'}`;
}

export function renderSimpleOpeningsForFloor(fl) {
  const ops = appState.project.openings.filter(o => o.floorId === fl.id);
  const facA = getFacadeGrossForFloor(fl);
  const areaBy = orients =>
    ops.filter(o => orients.includes(o.orient)).reduce((s, o) => s + o.width * o.height * o.qty, 0);

  document.getElementById('simpPctS').value = Math.min(95, Math.round((areaBy(['S', 'SE', 'SO']) / facA) * 100));
  document.getElementById('simpPctO').value = Math.min(95, Math.round((areaBy(['O']) / facA) * 100));
  document.getElementById('simpPctE').value = Math.min(95, Math.round((areaBy(['E']) / facA) * 100));
  document.getElementById('simpPctN').value = Math.min(95, Math.round((areaBy(['N', 'NE', 'NO']) / facA) * 100));
  document.getElementById('simpPctR').value = Math.min(40, Math.round((areaBy(['R']) / Math.max(1, fl.area)) * 100));

  const simpShadingEl = document.getElementById('simpShading');
  const detectedPreset = detectShadingPresetKey(ops);
  const customOpt = simpShadingEl.querySelector('option[value="custom"]');
  if (detectedPreset === 'custom') {
    if (!customOpt) {
      const opt = document.createElement('option');
      opt.value = 'custom';
      opt.textContent = `Personnalisé (g_vit=${ops[0].gVit.toFixed(2)}, g_store=${ops[0].gStore.toFixed(2)})`;
      simpShadingEl.appendChild(opt);
    } else {
      customOpt.textContent = `Personnalisé (g_vit=${ops[0].gVit.toFixed(2)}, g_store=${ops[0].gStore.toFixed(2)})`;
    }
    simpShadingEl.value = 'custom';
  } else {
    if (customOpt) customOpt.remove();
    simpShadingEl.value = detectedPreset;
  }

  const firstOp = ops[0];
  if (firstOp) {
    document.getElementById('simpBlindMode').value = firstOp.blindMode;
    document.getElementById('simpOverhang').value = firstOp.overhangDepth || 0;
  }
  const horEl = document.getElementById('simpHorizon');
  if (horEl) horEl.value = appState.project.horizonDeg ?? 0;

  const totalWin = ops.reduce((s, o) => s + o.width * o.height * o.qty, 0);
  document.getElementById('simpleGlazingSummary').textContent =
    `Total vitré : ${totalWin.toFixed(1)} m² (${((totalWin / Math.max(1, fl.area)) * 100).toFixed(0)} % du sol)`;

  document.getElementById('simpOpenBasis').value = fl.nightSimpleBasis || 'floor_pct';
  document.getElementById('simpOpenPct').value = fl.nightSimplePct ?? 5.0;
  document.getElementById('simpOpenEff').value = String(fl.nightSimpleEff ?? 1.0);
  document.getElementById('simpOpenCross').checked = Boolean(fl.nightSimpleCross);

  updateSimpleNightLiveBadge(fl, totalWin);
}

export function applySimpleGlazingFromInputs() {
  const { project } = appState;
  const fl = project.floors.find(f => f.id === appState.activeFloorId);
  if (!fl) return;

  const facA = getFacadeGrossForFloor(fl);
  const pcts = {
    S: Math.max(0, Math.min(95, parseFloat(document.getElementById('simpPctS').value) || 0)),
    O: Math.max(0, Math.min(95, parseFloat(document.getElementById('simpPctO').value) || 0)),
    E: Math.max(0, Math.min(95, parseFloat(document.getElementById('simpPctE').value) || 0)),
    N: Math.max(0, Math.min(95, parseFloat(document.getElementById('simpPctN').value) || 0)),
    R: Math.max(0, Math.min(40, parseFloat(document.getElementById('simpPctR').value) || 0))
  };

  const existingOps = project.openings.filter(o => o.floorId === fl.id);
  const shadingChoice = document.getElementById('simpShading').value;
  const sp =
    shadingChoice === 'custom' && existingOps[0]
      ? {
          gVit: existingOps[0].gVit,
          gStore: existingOps[0].gStore,
          gtotMode: existingOps[0].gtotMode,
          uWin: existingOps[0].uWin
        }
      : SHADING_PRESETS[shadingChoice] || SHADING_PRESETS.triple_lamelles;

  const blindMode = document.getElementById('simpBlindMode').value;
  const overhang = Math.max(0, parseFloat(document.getElementById('simpOverhang').value) || 0);
  const horEl = document.getElementById('simpHorizon');
  if (horEl) {
    project.horizonDeg = Math.max(0, Math.min(60, parseFloat(horEl.value) || 0));
  }

  project.openings = project.openings.filter(o => o.floorId !== fl.id);
  const labels = {
    S: 'Vitrage Sud',
    O: 'Vitrage Ouest',
    E: 'Vitrage Est',
    N: 'Vitrage Nord',
    R: 'Fenêtre de toit'
  };

  Object.entries(pcts).forEach(([orient, pct]) => {
    if (pct <= 0) return;
    const area = orient === 'R' ? (pct / 100) * fl.area : (pct / 100) * facA;
    const h = orient === 'R' ? 1.18 : Math.min(2.2, fl.height * 0.72);
    const w = Math.round((area / h) * 100) / 100;
    project.openings.push({
      id: `op_${fl.id}_${orient}`,
      floorId: fl.id,
      name: labels[orient],
      orient,
      width: w,
      height: Math.round(h * 100) / 100,
      qty: 1,
      uWin: sp.uWin,
      gVit: sp.gVit,
      gStore: sp.gStore,
      gtotMode: sp.gtotMode,
      overhangDepth: orient === 'R' ? 0 : overhang,
      frameFactor: 0.78,
      shadingFactor: 0.95,
      blindMode,
      blindThreshI: 200,
      blindThreshT: 23.0,
      windSafe: true,
      operable: true,
      openWidth: Math.min(w, 1.2),
      openHeight: Math.min(h, 1.4),
      openType: fl.nightSimpleCross ? 'cross_rect' : 'rect',
      alphaDeg: 20,
      cd: 0.6,
      sillHeight: 0.9
    });
  });

  renderSimpleOpeningsForFloor(fl);
  updateInspector();
  refresh3DViewers();
  document.getElementById('railOpeningCount').textContent = project.openings.reduce(
    (s, o) => s + o.qty,
    0
  );
}

export function renderOpenings() {
  renderFloorSelectors();
  const { project, uiModes } = appState;
  const fl = project.floors.find(f => f.id === appState.activeFloorId) || project.floors[0];

  if (uiModes.openings === 'simple') {
    renderSimpleOpeningsForFloor(fl);
    document.getElementById('railOpeningCount').textContent = project.openings.reduce(
      (s, o) => s + o.qty,
      0
    );
    return;
  }

  const list = project.openings.filter(o => o.floorId === fl.id);
  const tbody = document.getElementById('openingsTableBody');
  tbody.innerHTML = '';
  const orients = Object.keys(ORIENTATIONS);

  list.forEach(op => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><select data-op="${escapeHtml(op.id)}" data-k="floorId" style="min-width:95px;">${project.floors
        .map(f => `<option value="${escapeHtml(f.id)}" ${f.id === op.floorId ? 'selected' : ''}>${escapeHtml(f.name)}</option>`)
        .join('')}</select></td>
      <td><input type="text" value="${escapeHtml(op.name)}" data-op="${escapeHtml(op.id)}" data-k="name" style="min-width:105px;" /></td>
      <td><select data-op="${escapeHtml(op.id)}" data-k="orient" style="width:60px;">${orients
        .map(o => `<option value="${o}" ${o === op.orient ? 'selected' : ''}>${o}</option>`)
        .join('')}</select></td>
      <td><input type="number" step="0.1" min="0.2" value="${op.width}" data-op="${escapeHtml(op.id)}" data-k="width" style="width:54px;" /></td>
      <td><input type="number" step="0.1" min="0.2" value="${op.height}" data-op="${escapeHtml(op.id)}" data-k="height" style="width:54px;" /></td>
      <td><input type="number" step="1" min="1" value="${op.qty}" data-op="${escapeHtml(op.id)}" data-k="qty" style="width:46px;" /></td>
      <td><input type="number" step="0.05" min="0.4" value="${op.uWin}" data-op="${escapeHtml(op.id)}" data-k="uWin" style="width:52px;" /></td>
      <td><input type="number" step="0.02" min="0.1" max="0.9" value="${op.gVit}" data-op="${escapeHtml(op.id)}" data-k="gVit" style="width:52px;" /></td>
      <td><input type="number" step="0.01" min="0.02" max="1" value="${op.gStore}" data-op="${escapeHtml(op.id)}" data-k="gStore" style="width:52px;" /></td>
      <td><select data-op="${escapeHtml(op.id)}" data-k="gtotMode" style="width:70px;">
        <option value="product" ${op.gtotMode === 'product' ? 'selected' : ''}>g×g</option>
        <option value="direct" ${op.gtotMode === 'direct' ? 'selected' : ''}>g_tot</option>
      </select></td>
      <td><input type="number" step="0.1" min="0" value="${op.overhangDepth || 0}" data-op="${escapeHtml(op.id)}" data-k="overhangDepth" style="width:52px;" /></td>
      <td><input type="number" step="0.1" min="0" value="${op.leftFinDepth || 0}" data-op="${escapeHtml(op.id)}" data-k="sideFinDepth" style="width:52px;" title="Profondeur écrans latéraux G/D [m]" /></td>
      <td><input type="number" step="5" min="0" max="60" value="${op.horizonDeg ?? project.horizonDeg ?? 0}" data-op="${escapeHtml(op.id)}" data-k="horizonDeg" style="width:48px;" title="Angle d'horizon [°]" /></td>
      <td><select data-op="${escapeHtml(op.id)}" data-k="blindMode" style="width:82px;">
        <option value="auto" ${op.blindMode === 'auto' ? 'selected' : ''}>Auto</option>
        <option value="manual_day" ${op.blindMode === 'manual_day' ? 'selected' : ''}>Manuel</option>
        <option value="always_down" ${op.blindMode === 'always_down' ? 'selected' : ''}>Fermé</option>
        <option value="always_up" ${op.blindMode === 'always_up' ? 'selected' : ''}>Ouvert</option>
      </select></td>
      <td style="text-align:center;"><input type="checkbox" ${op.operable ? 'checked' : ''} data-op="${escapeHtml(op.id)}" data-k="operable" /></td>
      <td><button class="btn btn-danger" data-del-op="${escapeHtml(op.id)}">✕</button></td>
    `;
    tbody.appendChild(tr);
  });

  const nightBox = document.getElementById('openingNightDetails');
  const operables = list.filter(o => o.operable);
  nightBox.innerHTML = operables.length
    ? `
    <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">
      Paramètres aérauliques détaillés (actifs si « Méthode avancée » est sélectionnée à l'étape 4) :
    </div>
    <div class="table-wrap"><table>
      <thead><tr>
        <th data-tip="Nom et quantité de la fenêtre ouverte la nuit.">Ouverture</th>
        <th data-tip="Mécanisme d'ouverture : battante ou imposte (soufflet), sur une seule façade ou traversante.">Type</th>
        <th data-tip="Largeur libre du vantail qui s'ouvre [m].">Larg. ouvrante [m]</th>
        <th data-tip="Hauteur libre du vantail qui s'ouvre [m].">Haut. ouvrante [m]</th>
        <th data-tip="Angle d'inclinaison α [°] (utilisé pour le calcul EN 16798-7 des fenêtres en imposte / soufflet).">Angle α [°]</th>
        <th data-tip="Hauteur de l'allège (distance entre le plancher de l'étage et le bas de la fenêtre) [m].">Allège [m]</th>
      </tr></thead>
      <tbody>${operables
        .map(
          op => `<tr>
        <td>${escapeHtml(op.name)} (×${op.qty})</td>
        <td><select data-op="${escapeHtml(op.id)}" data-k="openType">
          <option value="rect" ${op.openType === 'rect' ? 'selected' : ''}>Battante rect.</option>
          <option value="imposte" ${op.openType === 'imposte' ? 'selected' : ''}>Imposte / soufflet</option>
          <option value="cross_rect" ${op.openType === 'cross_rect' ? 'selected' : ''}>Traversante rect.</option>
          <option value="cross_imposte" ${op.openType === 'cross_imposte' ? 'selected' : ''}>Traversante imposte</option>
        </select></td>
        <td><input type="number" step="0.1" min="0.1" value="${op.openWidth}" data-op="${escapeHtml(op.id)}" data-k="openWidth" style="width:70px;" /></td>
        <td><input type="number" step="0.1" min="0.1" value="${op.openHeight}" data-op="${escapeHtml(op.id)}" data-k="openHeight" style="width:70px;" /></td>
        <td><input type="number" step="1" min="1" max="180" value="${op.alphaDeg}" data-op="${escapeHtml(op.id)}" data-k="alphaDeg" style="width:68px;" /></td>
        <td><input type="number" step="0.1" min="0" value="${op.sillHeight}" data-op="${escapeHtml(op.id)}" data-k="sillHeight" style="width:68px;" /></td>
      </tr>`
        )
        .join('')}</tbody>
    </table></div>`
    : '<span class="pill warn">Aucune ouverture cochée « Nuit ».</span>';

  document.querySelectorAll('[data-op]').forEach(el => {
    el.addEventListener('change', e => {
      const op = project.openings.find(o => o.id === e.target.dataset.op);
      const k = e.target.dataset.k;
      if (!op) return;
      if (k === 'operable') {
        op[k] = e.target.checked;
        const flOp = project.floors.find(f => f.id === op.floorId);
        if (flOp && e.target.checked && (flOp.nightVentMode === 'none' || flOp.nightVentMode === 'simple_pct')) {
          flOp.nightVentMode = 'physical';
          loadSiaFloorInputs();
        }
        renderOpenings();
      } else if (['floorId', 'name', 'orient', 'gtotMode', 'blindMode', 'openType'].includes(k)) {
        op[k] = e.target.value;
        if (k === 'openType') {
          const flOp = project.floors.find(f => f.id === op.floorId);
          if (flOp && (flOp.nightVentMode === 'none' || flOp.nightVentMode === 'simple_pct')) {
            flOp.nightVentMode = 'physical';
            loadSiaFloorInputs();
          }
        }
        if (['name', 'openType', 'floorId'].includes(k)) renderOpenings();
      } else if (k === 'sideFinDepth') {
        const v = Math.max(0, Number(e.target.value) || 0);
        op.leftFinDepth = v;
        op.rightFinDepth = v;
      } else {
        op[k] = Number(e.target.value);
        if (['openWidth', 'openHeight', 'alphaDeg', 'sillHeight'].includes(k)) {
          const flOp = project.floors.find(f => f.id === op.floorId);
          if (flOp && (flOp.nightVentMode === 'none' || flOp.nightVentMode === 'simple_pct')) {
            flOp.nightVentMode = 'physical';
            loadSiaFloorInputs();
          }
        }
        if (k === 'qty') renderOpenings();
      }
      updateNightVentUI();
      updateInspector();
      refresh3DViewers();
    });
  });

  tbody.querySelectorAll('[data-del-op]').forEach(btn => {
    btn.addEventListener('click', () => {
      project.openings = project.openings.filter(o => o.id !== btn.dataset.delOp);
      renderOpenings();
      updateInspector();
      refresh3DViewers();
    });
  });

  document.getElementById('railOpeningCount').textContent = project.openings.reduce(
    (s, o) => s + o.qty,
    0
  );
  refresh3DViewers();
}

function renderBox3dBuilder(wrap) {
  const { project } = appState;
  const activeFl = project.floors.find(f => f.id === appState.activeFloorId) || project.floors[0];
  const flOps = project.openings.filter(o => o.floorId === activeFl.id);
  const b3 = ensureBox3dDefaults(activeFl, flOps);
  const orients = getWallOrientations(b3.frontOrient || 'S');

  const faceLabels = [
    ['front', `Mur Devant (${orients.front})`],
    ['back', `Mur Fond (${orients.back})`],
    ['right', `Mur Droit (${orients.right})`],
    ['left', `Mur Gauche (${orients.left})`],
    ['ceiling', 'Plafond (X–Y)'],
    ['floor', 'Plancher (X–Y)']
  ];

  const card = document.createElement('div');
  card.className = 'well';
  card.innerHTML = `
    <div class="well-head">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1;">
        <strong style="color:var(--primary);">Étage actif :</strong>
        <select id="b3FloorSel" style="width:220px;font-weight:600;">
          ${project.floors.map(f => `<option value="${escapeHtml(f.id)}" ${f.id === activeFl.id ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}
        </select>
        <span class="pill neutral">Surface : ${activeFl.area.toFixed(1)} m² • Inertie estimée : ${activeFl.cSpec} Wh/m²K</span>
      </div>
      ${project.floors.length > 1 ? `<button class="btn btn-danger" data-del-floor="${escapeHtml(activeFl.id)}">Supprimer</button>` : ''}
    </div>

    <div class="box3d-grid">
      <div>
        <div class="wall-panel">
          <div class="wall-panel-head"><strong>Dimensions &amp; Orientation du volume</strong></div>
          <div class="g3">
            <div class="field"><label>Largeur X [m]</label><input type="number" id="b3DimX" step="0.2" min="1" value="${b3.dimX}" /></div>
            <div class="field"><label>Profondeur Y [m]</label><input type="number" id="b3DimY" step="0.2" min="1" value="${b3.dimY}" /></div>
            <div class="field"><label>Hauteur Z [m]</label><input type="number" id="b3DimZ" step="0.05" min="1.8" value="${activeFl.height}" /></div>
          </div>
          <div class="g2" style="margin-top:8px;">
            <div class="field">
              <label>Orient. Mur Devant</label>
              <select id="b3FrontOrient">
                ${Object.keys(ORIENTATIONS).filter(o => o !== 'R').map(o => `<option value="${o}" ${o === b3.frontOrient ? 'selected' : ''}>${o} (${ORIENTATIONS[o].label})</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Albédo sol [-]</label>
              <input type="number" id="b3Albedo" step="0.05" min="0.05" max="0.80" value="${project.albedo ?? 0.20}" />
            </div>
          </div>
        </div>

        <div class="viewer3d-card">
          <div class="viewer3d-toolbar">
            <strong>Visualisation 3D interactive</strong>
            <span style="display:flex;gap:4px;">
              <button class="btn btn-sm" id="b3ViewIso" style="padding:2px 8px;font-size:11px;">Iso</button>
              <button class="btn btn-sm" id="b3ViewFront" style="padding:2px 8px;font-size:11px;">Face</button>
              <button class="btn btn-sm" id="b3ViewTop" style="padding:2px 8px;font-size:11px;">Haut</button>
            </span>
          </div>
          <div class="viewer3d-box" style="height:270px;"><canvas id="box3dMainCanvas"></canvas></div>
        </div>
      </div>

      <div>
        ${faceLabels
          .map(([fk, flabel]) => {
            const w = b3.walls[fk];
            const isFloor = fk === 'floor';
            const showCustomU = w.preset === 'custom';
            const showCustomWin = !isFloor && w.winPreset === 'custom';
            return `
            <div class="wall-panel">
              <div class="wall-panel-head">
                <strong>${flabel}</strong>
                <span class="pill neutral" style="font-size:10.5px;">U=${(w.preset === 'custom' ? w.u : (BOX3D_WALL_PRESETS[w.preset]?.u ?? 0.2)).toFixed(2)} W/m²K</span>
              </div>
              <div class="g2">
                <div class="field">
                  <label>Condition limite</label>
                  <select data-b3wall="${fk}" data-k="contact">
                    ${Object.entries(BOX3D_CONTACTS)
                      .map(([ck, cv]) => `<option value="${ck}" ${w.contact === ck ? 'selected' : ''}>${cv.label}</option>`)
                      .join('')}
                  </select>
                </div>
                <div class="field">
                  <label>Paroi / Composition</label>
                  <select data-b3wall="${fk}" data-k="preset">
                    ${Object.entries(BOX3D_WALL_PRESETS)
                      .map(([pk, pv]) => `<option value="${pk}" ${w.preset === pk ? 'selected' : ''}>${pv.label}</option>`)
                      .join('')}
                  </select>
                </div>
              </div>
              ${
                showCustomU
                  ? `<div class="g2" style="margin-top:6px;">
                      <div class="field"><label>Valeur U paroi [W/(m²·K)]</label><input type="number" step="0.02" min="0.05" value="${w.u}" data-b3wall="${fk}" data-k="u" /></div>
                     </div>`
                  : ''
              }
              ${
                !isFloor
                  ? `<div class="g2" style="margin-top:6px;">
                      <div class="field">
                        <label>Vitrage / Ouverture</label>
                        <select data-b3wall="${fk}" data-k="winPreset">
                          ${Object.entries(BOX3D_WINDOW_PRESETS)
                            .map(([wk, wv]) => `<option value="${wk}" ${w.winPreset === wk ? 'selected' : ''}>${wv.label}</option>`)
                            .join('')}
                        </select>
                      </div>
                      ${
                        w.winPreset !== 'none'
                          ? `<div class="field">
                              <label>Store (g_store / commande)</label>
                              <div style="display:flex;gap:4px;">
                                <input type="number" step="0.02" min="0.02" max="1" value="${w.gStore ?? 0.12}" data-b3wall="${fk}" data-k="gStore" title="g_store" />
                                <select data-b3wall="${fk}" data-k="blindMode">
                                  <option value="auto" ${(w.blindMode || 'auto') === 'auto' ? 'selected' : ''}>Auto</option>
                                  <option value="always_down" ${w.blindMode === 'always_down' ? 'selected' : ''}>Fermé</option>
                                  <option value="always_up" ${w.blindMode === 'always_up' ? 'selected' : ''}>Sans</option>
                                </select>
                              </div>
                            </div>`
                          : '<div></div>'
                      }
                    </div>`
                  : ''
              }
              ${
                showCustomWin
                  ? `<div class="g4" style="margin-top:6px;">
                      <div class="field"><label>Larg. [m]</label><input type="number" step="0.1" min="0.2" value="${w.winW}" data-b3wall="${fk}" data-k="winW" /></div>
                      <div class="field"><label>Haut. [m]</label><input type="number" step="0.1" min="0.2" value="${w.winH}" data-b3wall="${fk}" data-k="winH" /></div>
                      <div class="field"><label>Qté</label><input type="number" step="1" min="1" value="${w.winQty}" data-b3wall="${fk}" data-k="winQty" /></div>
                      <div class="field"><label>Casq. [m]</label><input type="number" step="0.1" min="0" value="${w.overhang ?? 0}" data-b3wall="${fk}" data-k="overhang" /></div>
                    </div>`
                  : ''
              }
            </div>`;
          })
          .join('')}
      </div>
    </div>
  `;

  wrap.appendChild(card);

  const commitBox3d = (rerender = false) => {
    applyBox3dToFloor(activeFl, project);
    document.getElementById('railOpeningCount').textContent = project.openings.reduce(
      (s, o) => s + o.qty,
      0
    );
    updateInspector();
    if (rerender) renderFloors();
    else refresh3DViewers();
  };

  card.querySelector('#b3FloorSel').addEventListener('change', e => {
    appState.activeFloorId = e.target.value;
    renderFloorSelectors();
    renderFloors();
    renderOpenings();
    loadSiaFloorInputs();
  });

  card.querySelector('#b3DimX').addEventListener('change', e => {
    b3.dimX = Math.max(1, Number(e.target.value) || 4);
    commitBox3d(true);
  });
  card.querySelector('#b3DimY').addEventListener('change', e => {
    b3.dimY = Math.max(1, Number(e.target.value) || 5);
    commitBox3d(true);
  });
  card.querySelector('#b3DimZ').addEventListener('change', e => {
    activeFl.height = Math.max(1.8, Number(e.target.value) || 2.5);
    commitBox3d(true);
  });
  card.querySelector('#b3FrontOrient').addEventListener('change', e => {
    b3.frontOrient = e.target.value;
    commitBox3d(true);
  });
  card.querySelector('#b3Albedo').addEventListener('change', e => {
    project.albedo = Math.max(0.05, Math.min(0.8, Number(e.target.value) || 0.2));
    const advAlb = document.getElementById('projAlbedo');
    if (advAlb) advAlb.value = project.albedo;
  });

  card.querySelectorAll('[data-b3wall]').forEach(el => {
    el.addEventListener('change', e => {
      const fk = e.target.dataset.b3wall;
      const k = e.target.dataset.k;
      const w = b3.walls[fk];
      if (!w) return;
      if (['contact', 'preset', 'winPreset', 'blindMode'].includes(k)) {
        w[k] = e.target.value;
        if (k === 'preset' && BOX3D_WALL_PRESETS[w.preset]) {
          w.u = BOX3D_WALL_PRESETS[w.preset].u;
        }
        if (k === 'winPreset' && BOX3D_WINDOW_PRESETS[w.winPreset]) {
          const wp = BOX3D_WINDOW_PRESETS[w.winPreset];
          w.winW = wp.w;
          w.winH = wp.h;
          w.winQty = wp.qty;
          w.uWin = wp.uWin;
          w.gVit = wp.gVit;
          w.gStore = wp.gStore;
        }
        commitBox3d(true);
      } else {
        w[k] = Number(e.target.value);
        commitBox3d(false);
      }
    });
  });

  card.querySelector('#b3ViewIso').addEventListener('click', () => viewerMain3D?.setView('iso'));
  card.querySelector('#b3ViewFront').addEventListener('click', () => viewerMain3D?.setView('front'));
  card.querySelector('#b3ViewTop').addEventListener('click', () => viewerMain3D?.setView('top'));

  requestAnimationFrame(() => refresh3DViewers());
}

export function renderFloors() {
  const { project, uiModes } = appState;
  const mode = uiModes.floors;
  const isAdv = mode === 'advanced';
  document.getElementById('floorsSubtitle').textContent =
    mode === 'box3d'
      ? 'Constructeur 3D (Paroi par paroi) : définissez X, Y, Z, les 6 parois (contact, composition, vitrages) avec aperçu 3D interactif.'
      : isAdv
        ? 'Mode Avancé : édition manuelle de toutes les surfaces opaques, facteurs b, valeurs U et ponts thermiques.'
        : 'Mode Simple : choisissez uniquement la surface, la hauteur, la position de l’étage, le standard SIA et l’inertie.';

  const wrap = document.getElementById('floorsList');
  wrap.innerHTML = '';

  if (mode === 'box3d') {
    renderBox3dBuilder(wrap);
    wrap.querySelectorAll('[data-del-floor]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.delFloor;
        project.floors = project.floors.filter(f => f.id !== id);
        project.openings = project.openings.filter(o => o.floorId !== id);
        if (appState.activeFloorId === id) appState.activeFloorId = project.floors[0].id;
        syncAllUI();
      });
    });
    document.getElementById('railFloorCount').textContent = project.floors.length;
    return;
  }

  project.floors.forEach((fl, idx) => {
    const opsCount = project.openings.filter(o => o.floorId === fl.id).length;
    const div = document.createElement('div');
    div.className = 'well';

    if (!isAdv) {
      div.innerHTML = `
        <div class="well-head">
          <div style="display:flex;align-items:center;gap:8px;flex:1;">
            <strong style="color:var(--primary);">#${idx + 1}</strong>
            <input type="text" value="${escapeHtml(fl.name)}" data-fl="${escapeHtml(fl.id)}" data-k="name" data-tip="Nom ou désignation de l'étage / du local." style="max-width:260px;font-weight:600;" />
            <span class="pill neutral" data-tip="Nombre de types d'ouvertures vitrées rattachées à cet étage.">${opsCount} ouv.</span>
          </div>
          ${project.floors.length > 1 ? `<button class="btn btn-danger" data-del-floor="${escapeHtml(fl.id)}" data-tip="Supprimer cet étage et ses fenêtres.">Supprimer</button>` : ''}
        </div>
        <div class="g5">
          <div class="field" data-tip="Surface nette de plancher (A_SNP) de l'étage ou de la pièce [m²]."><label>Surface [m²]</label><input type="number" step="1" min="5" value="${fl.area}" data-fl="${escapeHtml(fl.id)}" data-k="area" /></div>
          <div class="field" data-tip="Hauteur libre sous plafond [m] (détermine le volume d'air et la hauteur des façades)."><label>Hauteur [m]</label><input type="number" step="0.05" min="1.8" value="${fl.height}" data-fl="${escapeHtml(fl.id)}" data-k="height" /></div>
          <div class="field" data-tip="Position verticale du niveau : détermine automatiquement si le plafond donne sur un toit extérieur et si le plancher donne sur le sol.">
            <label>Position étage</label>
            <select data-fl="${escapeHtml(fl.id)}" data-k="simplePos">
              <option value="ground" ${fl.simplePos === 'ground' ? 'selected' : ''}>RDC (sur sol)</option>
              <option value="mid" ${fl.simplePos === 'mid' ? 'selected' : ''}>Étage intermédiaire</option>
              <option value="top" ${fl.simplePos === 'top' ? 'selected' : ''}>Dernier étage (sous toit)</option>
              <option value="attic" ${fl.simplePos === 'attic' ? 'selected' : ''}>Combles</option>
              <option value="standalone" ${fl.simplePos === 'standalone' ? 'selected' : ''}>Local / Pavillon isolé</option>
            </select>
          </div>
          <div class="field" data-tip="Qualité d'isolation thermique des parois opaques extérieures (coefficient U en W/(m²·K)).">
            <label>Isolation</label>
            <select data-fl="${escapeHtml(fl.id)}" data-k="envelopeStd">
              <option value="sia_new" ${fl.envelopeStd === 'sia_new' ? 'selected' : ''}>SIA Neuf (U=0.20)</option>
              <option value="sia_reno" ${fl.envelopeStd === 'sia_reno' ? 'selected' : ''}>Rénovation (U=0.25)</option>
              <option value="minergie" ${fl.envelopeStd === 'minergie' ? 'selected' : ''}>Haute isolation (U=0.15)</option>
              <option value="old" ${fl.envelopeStd === 'old' ? 'selected' : ''}>Ancien (U=1.10)</option>
            </select>
          </div>
          <div class="field" data-tip="Capacité des matériaux intérieurs (dalles béton, murs lourds vs ossature bois/faux-plafonds) à stocker la chaleur la journée pour lisser le pic de température.">
            <label>Inertie thermique</label>
            <select data-fl="${escapeHtml(fl.id)}" data-k="inertiaClass">
              <option value="20" ${fl.inertiaClass === '20' ? 'selected' : ''}>Faible / légère (20 Wh/m²K)</option>
              <option value="45" ${fl.inertiaClass === '45' ? 'selected' : ''}>Moyenne (45 Wh/m²K)</option>
              <option value="75" ${fl.inertiaClass === '75' ? 'selected' : ''}>Forte / massive (75 Wh/m²K)</option>
              <option value="100" ${fl.inertiaClass === '100' ? 'selected' : ''}>Très forte (100 Wh/m²K)</option>
            </select>
          </div>
        </div>
      `;
    } else {
      div.innerHTML = `
        <div class="well-head">
          <div style="display:flex;align-items:center;gap:8px;flex:1;">
            <strong style="color:var(--primary);">#${idx + 1}</strong>
            <input type="text" value="${escapeHtml(fl.name)}" data-fl="${escapeHtml(fl.id)}" data-k="name" data-tip="Nom ou désignation de l'étage / du local." style="max-width:260px;font-weight:600;" />
            <span class="pill neutral" data-tip="Nombre de types d'ouvertures vitrées rattachées à cet étage.">${opsCount} ouv.</span>
          </div>
          ${project.floors.length > 1 ? `<button class="btn btn-danger" data-del-floor="${escapeHtml(fl.id)}" data-tip="Supprimer cet étage et ses fenêtres.">Supprimer</button>` : ''}
        </div>
        <div class="g4">
          <div class="field" data-tip="Surface nette de plancher A_SNP [m²]."><label>Surface plancher [m²]</label><input type="number" step="1" min="5" value="${fl.area}" data-fl="${escapeHtml(fl.id)}" data-k="area" /></div>
          <div class="field" data-tip="Hauteur libre sous plafond [m]."><label>Hauteur [m]</label><input type="number" step="0.05" min="1.8" value="${fl.height}" data-fl="${escapeHtml(fl.id)}" data-k="height" /></div>
          <div class="field" data-tip="Cote verticale du plancher [m] (utilisée pour le tirage thermique cheminée entre étages)."><label>Altitude z [m]</label><input type="number" step="0.1" value="${fl.elevationZ}" data-fl="${escapeHtml(fl.id)}" data-k="elevationZ" /></div>
          <div class="field" data-tip="Profondeur de la pièce perpendiculairement à la façade vitrée [m] (vérifiée dans SIA 180 Tab. 8 et ratio 2.5 × hauteur)."><label>Profondeur pièce [m]</label><input type="number" step="0.1" min="0.5" value="${fl.depthBehindWin}" data-fl="${escapeHtml(fl.id)}" data-k="depthBehindWin" /></div>
        </div>
        <div class="g4" style="margin-top:8px;">
          <div class="field" data-tip="Surface nette de murs verticaux opaques donnant sur l'extérieur (hors vitrages) [m²]."><label>Murs ext. opaques [m²]</label><input type="number" step="1" min="0" value="${fl.wallExtArea}" data-fl="${escapeHtml(fl.id)}" data-k="wallExtArea" /></div>
          <div class="field" data-tip="Coefficient de transmission thermique U des murs extérieurs opaques [W/(m²·K)]."><label>U murs ext. [W/(m²·K)]</label><input type="number" step="0.01" min="0.05" value="${fl.uWallExt}" data-fl="${escapeHtml(fl.id)}" data-k="uWallExt" /></div>
          <div class="field" data-tip="Surface opaque de toiture ou terrasse donnant directement sur l'extérieur [m²] (mettre 0 pour un étage intermédiaire)."><label>Toiture ext. [m²]</label><input type="number" step="1" min="0" value="${fl.roofExtArea}" data-fl="${escapeHtml(fl.id)}" data-k="roofExtArea" /></div>
          <div class="field" data-tip="Coefficient de transmission thermique U de la toiture [W/(m²·K)]."><label>U toiture [W/(m²·K)]</label><input type="number" step="0.01" min="0.05" value="${fl.uRoofExt}" data-fl="${escapeHtml(fl.id)}" data-k="uRoofExt" /></div>
        </div>
        <div class="g4" style="margin-top:8px;">
          <div class="field" data-tip="Surface de plancher bas donnant sur le terrain ou sur un sous-sol non chauffé [m²]."><label>Plancher sol/NC [m²]</label><input type="number" step="1" min="0" value="${fl.floorGroundArea}" data-fl="${escapeHtml(fl.id)}" data-k="floorGroundArea" /></div>
          <div class="field" data-tip="Facteur de réduction thermique b du plancher bas (0 = sur local chauffé, 0.3 = contre terre, 0.5 = sur sous-sol non chauffé, 1.0 = sur air extérieur).">
            <label>Facteur b plancher</label>
            <select data-fl="${escapeHtml(fl.id)}" data-k="bFloorGround">
              <option value="0" ${fl.bFloorGround === 0 ? 'selected' : ''}>0.0 (sur chauffé)</option>
              <option value="0.3" ${fl.bFloorGround === 0.3 ? 'selected' : ''}>0.3 (sur sol)</option>
              <option value="0.5" ${fl.bFloorGround === 0.5 ? 'selected' : ''}>0.5 (sur non chauffé)</option>
              <option value="1" ${fl.bFloorGround === 1 ? 'selected' : ''}>1.0 (sur extérieur)</option>
            </select>
          </div>
          <div class="field" data-tip="Classe d'inertie thermique prédéfinie selon SIA 180.">
            <label>Classe inertie SIA 180</label>
            <select data-fl="${escapeHtml(fl.id)}" data-k="inertiaClass">
              <option value="20" ${fl.inertiaClass === '20' ? 'selected' : ''}>Faible (20)</option>
              <option value="45" ${fl.inertiaClass === '45' ? 'selected' : ''}>Moyenne (45)</option>
              <option value="75" ${fl.inertiaClass === '75' ? 'selected' : ''}>Forte (75)</option>
              <option value="100" ${fl.inertiaClass === '100' ? 'selected' : ''}>Très forte (100)</option>
              <option value="custom" ${fl.inertiaClass === 'custom' ? 'selected' : ''}>Personnalisée</option>
            </select>
          </div>
          <div class="field" data-tip="Capacité thermique spécifique effective rapportée à la surface de plancher C_R / A_SNP [Wh/(m²·K)]."><label>Capacité C [Wh/(m²·K)]</label><input type="number" step="1" min="5" value="${fl.cSpec}" data-fl="${escapeHtml(fl.id)}" data-k="cSpec" /></div>
        </div>
      `;
    }
    wrap.appendChild(div);
  });

  wrap.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('change', e => {
      const fl = project.floors.find(f => f.id === e.target.dataset.fl);
      const k = e.target.dataset.k;
      if (!fl) return;
      fl[k] = ['name', 'inertiaClass', 'simplePos', 'envelopeStd'].includes(k)
        ? e.target.value
        : Number(e.target.value);

      if (k === 'inertiaClass' && e.target.value !== 'custom') {
        fl.cSpec = Number(e.target.value);
        renderFloors();
      }
      if (k === 'cSpec') {
        fl.inertiaClass = 'custom';
        renderFloors();
      }
      if (!isAdv && ['area', 'height', 'simplePos', 'envelopeStd'].includes(k)) {
        computeAutoEnvelopeFromFloor(fl);
      }
      if (['area', 'height', 'name'].includes(k)) {
        renderFloorSelectors();
        renderOpenings();
      }
      updateInspector();
      refresh3DViewers();
    });
  });

  wrap.querySelectorAll('[data-del-floor]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.delFloor;
      project.floors = project.floors.filter(f => f.id !== id);
      project.openings = project.openings.filter(o => o.floorId !== id);
      if (appState.activeFloorId === id) appState.activeFloorId = project.floors[0].id;
      syncAllUI();
    });
  });

  document.getElementById('railFloorCount').textContent = project.floors.length;
  refresh3DViewers();
}

export function updateNightVentUI(targetFl = null) {
  const { project } = appState;
  const fl = targetFl || project.floors.find(f => f.id === appState.activeFloorId) || project.floors[0];
  if (!fl) return;

  const mode = fl.nightVentMode || 'simple_pct';
  const isFixed = mode === 'fixed_m3hm2' || mode === 'fixed_ach';
  const isSimple = mode === 'simple_pct';
  const isPhys = mode === 'physical';
  const isNone = mode === 'none';

  document.getElementById('nightFixedBox')?.classList.toggle('hidden', !isFixed);
  document.getElementById('nightSimpleQuickBox')?.classList.toggle('hidden', !isSimple);
  document.getElementById('nightPhysicalHintBox')?.classList.toggle('hidden', !isPhys);
  document.getElementById('nightRegulBox')?.classList.toggle('hidden', isNone);

  const lblFixed = document.getElementById('lblNightFixed');
  if (lblFixed) {
    lblFixed.textContent = mode === 'fixed_ach' ? 'Taux imposé [vol/h]' : 'Débit imposé [m³/(h·m²)]';
  }

  const simpPctEl = document.getElementById('inNightSimplePct');
  const simpCrossEl = document.getElementById('inNightSimpleCross');
  if (simpPctEl) simpPctEl.value = fl.nightSimplePct ?? 5.0;
  if (simpCrossEl) simpCrossEl.checked = Boolean(fl.nightSimpleCross);

  const ops = project.openings.filter(o => o.floorId === fl.id);
  const operableCount = ops.filter(o => o.operable).reduce((s, o) => s + (o.qty || 1), 0);
  const physHint = document.getElementById('nightPhysicalHintTxt');
  if (physHint) {
    physHint.innerHTML =
      operableCount > 0
        ? `<span class="pill ok">${operableCount} ouvrant(s) actif(s) la nuit à l'étape 3</span>`
        : `<span class="pill ko">Aucun ouvrant coché « Nuit » à l'étape 3</span>`;
  }

  const fp = buildFloorThermalParams(fl, ops);
  const span = project.stackCoupling ? computeBuildingStackSpan(project) : fl.height;
  const m3h = computeFloorNightFlowM3h(fp, 26, 18, span, project.stackCoupling);
  const spec = m3h / Math.max(1, fl.area);
  const badge = document.getElementById('siaNightLiveBadge');
  if (badge) {
    badge.textContent = isNone
      ? 'Ventilation nuit désactivée (0.0 m³/(h·m²))'
      : `Débit nuit (ΔT=8 K) : ${m3h.toFixed(0)} m³/h (${spec.toFixed(1)} m³/(h·m²))`;
    badge.className = `pill ${spec >= 10 ? 'ok' : spec > 0 ? 'warn' : 'ko'}`;
  }
}

export function loadSiaFloorInputs() {
  const { project } = appState;
  const fl = project.floors.find(f => f.id === appState.activeFloorId) || project.floors[0];
  if (!fl) return;

  document.getElementById('siaCategorySelect').value = fl.siaCategory || 'custom';
  document.getElementById('siaGainFactor').value = fl.gainFactorPct ?? 100;
  document.getElementById('siaGainFactorLbl').textContent = `${fl.gainFactorPct ?? 100} %`;

  document.getElementById('inOccCount').value = fl.occCount;
  document.getElementById('inOccWatt').value = fl.occWatt;
  document.getElementById('inOccPresence').value = Math.round((fl.occPresenceFactor ?? 1) * 100);
  document.getElementById('inLightWm2').value = fl.lightWm2;
  document.getElementById('inEquipWatt').value = fl.equipWatt;
  document.getElementById('inOccStart').value = fl.occStart;
  document.getElementById('inOccEnd').value = fl.occEnd;
  document.getElementById('inOccDays').value = fl.occDays;
  document.getElementById('inStandbyPct').value = fl.standbyPct;
  document.getElementById('inQHyg').value = fl.qHygSpec;
  document.getElementById('inAchInfil').value = fl.achInfil;
  document.getElementById('inEtaWrg').value = fl.etaWRG;
  document.getElementById('inNightMode').value = fl.nightVentMode;
  document.getElementById('inNightFixed').value = fl.nightVentFixedVal;
  document.getElementById('inNightStart').value = fl.nightStart;
  document.getElementById('inNightEnd').value = fl.nightEnd;
  document.getElementById('inNightTargetTi').value = fl.nightTargetTi;
  document.getElementById('inNightMinDT').value = fl.nightMinDT;

  updateSiaCatChips(fl);
  updateNightVentUI(fl);
}

function updateSiaCatChips(fl) {
  const c = SIA380_CATEGORIES[fl.siaCategory];
  document.getElementById('siaCatChips').innerHTML = c
    ? `<span class="pill neutral" data-tip="Consigne minimale de chauffage hivernal SIA 380/1.">θ_i = ${c.ti} °C</span>
       <span class="pill neutral" data-tip="Surface nette de plancher par personne selon SIA 380/1.">A_P = ${c.Ap} m²/P</span>
       <span class="pill neutral" data-tip="Puissance de chaleur dégagée par personne et durée de présence journalière.">Q_P = ${c.Qp} W/P (t_p = ${c.tp} h/j)</span>
       <span class="pill neutral" data-tip="Consommation annuelle d'électricité (éclairage + appareils) et facteur de conversion en chaleur interne f_el.">E_F,el = ${c.Efel} kWh/m² (f_el = ${c.fel})</span>
       <span class="pill neutral" data-tip="Débit spécifique d'air neuf hygiénique pendant l'occupation.">q_th = ${c.qth} m³/(h·m²)</span>`
    : '<span class="pill neutral" data-tip="Vous avez personnalisé manuellement les valeurs de gains internes ou d\'occupation en Mode Avancé.">Valeurs manuelles actives pour cet étage.</span>';
}

export function applySiaCatToCurrentFloor(catKey) {
  const fl = appState.project.floors.find(f => f.id === appState.activeFloorId);
  if (!fl) return;
  fl.siaCategory = catKey;
  const sia = deriveSiaInternalDefaults(catKey, fl.area);
  if (sia) {
    fl.spaceType = sia.spaceType;
    fl.occCount = sia.occCount;
    fl.occWatt = sia.occWatt;
    fl.occPresenceFactor = sia.presenceFactor;
    fl.lightWm2 = sia.lightWm2;
    fl.equipWatt = sia.equipWatt;
    fl.occStart = sia.occStart;
    fl.occEnd = sia.occEnd;
    fl.occDays = sia.occDays;
    fl.standbyPct = sia.standbyPct;
    fl.qHygSpec = sia.qHygSpec;
    fl.gainFactorPct = 100;
  }
  loadSiaFloorInputs();
  updateInspector();
}

export function updateInspector() {
  const { project, customWeather } = appState;
  const totalArea = project.floors.reduce((s, f) => s + f.area, 0);
  const totalVol = project.floors.reduce((s, f) => s + f.area * f.height, 0);
  const totalWin = project.openings.reduce((s, o) => s + o.width * o.height * o.qty, 0);
  const avgC =
    totalArea > 0 ? project.floors.reduce((s, f) => s + f.cSpec * f.area, 0) / totalArea : 0;

  document.getElementById('inspectorSummary').innerHTML = `
    <div class="inspector-stat" data-tip="Nom du bâtiment actuellement configuré."><span>Projet</span><strong>${escapeHtml(project.name.slice(0, 18))}</strong></div>
    <div class="inspector-stat" data-tip="Nombre de niveaux thermiques modélisés."><span>Étages</span><strong>${project.floors.length}</strong></div>
    <div class="inspector-stat" data-tip="Somme des surfaces nettes de plancher (A_SNP) de tous les étages."><span>Surface totale</span><strong>${totalArea.toFixed(1)} m²</strong></div>
    <div class="inspector-stat" data-tip="Volume d'air intérieur total du bâtiment."><span>Volume total</span><strong>${totalVol.toFixed(0)} m³</strong></div>
    <div class="inspector-stat" data-tip="Surface totale des fenêtres toutes orientations confondues."><span>Surface vitrée</span><strong>${totalWin.toFixed(1)} m²</strong></div>
    <div class="inspector-stat" data-tip="Capacité thermique moyenne pondérée par la surface des étages (≥ 45 Wh/m²K recommandé)."><span>Inertie moyenne</span><strong>${avgC.toFixed(0)} Wh/m²K</strong></div>
    <div class="inspector-stat" data-tip="Station et scénario météo utilisés pour le calcul horaire."><span>Climat</span><strong>${customWeather ? 'Importé' : escapeHtml(project.climate.station + ' ' + project.climate.scenario)}</strong></div>
  `;

  const alerts = [];
  if (totalWin === 0) alerts.push('<span class="pill warn">Aucune ouverture vitrée définie</span>');
  if (project.floors.some(f => f.cSpec < 30)) {
    alerts.push('<span class="pill warn">Inertie faible sur un étage (&lt; 30 Wh/m²K)</span>');
  }
  document.getElementById('inspectorAlerts').innerHTML = alerts.join('');
}

export function syncPvgisUI() {
  const { project, customWeather } = appState;
  document.getElementById('climateStation').value = project.climate.station;
  document.getElementById('climateScenario').value = project.climate.scenario;
  document.getElementById('pvLat').value = project.climate.lat;
  document.getElementById('pvLon').value = project.climate.lon;
  document.getElementById('pvTzMode').value = project.climate.tzMode || 'cet_cest';
  const uhi = Boolean(project.climate.urbanHeatIsland);
  const cUhi = document.getElementById('climateUHI');
  const pUhi = document.getElementById('projUHI');
  if (cUhi) cUhi.checked = uhi;
  if (pUhi) pUhi.checked = uhi;

  const badge = document.getElementById('weatherStatusBadge');
  if (customWeather) {
    badge.textContent = `Climat actif : ${customWeather.sourceLabel}`;
    badge.className = 'pill ok';
  } else {
    const st = SWISS_STATIONS[project.climate.station] || SWISS_STATIONS.SIO;
    badge.textContent = `Climat actif : ${st.name} (${project.climate.scenario}${uhi ? ' + Îlot chaleur' : ''})`;
    badge.className = 'pill neutral';
  }

  const pvType = document.getElementById('pvType').value;
  const base = 'https://re.jrc.ec.europa.eu/api/v5_3/';
  if (pvType === 'tmy') {
    document.getElementById('linkPvgisJson').href = `${base}tmy?lat=${project.climate.lat}&lon=${project.climate.lon}&outputformat=json`;
    document.getElementById('linkPvgisCsv').href = `${base}tmy?lat=${project.climate.lat}&lon=${project.climate.lon}&outputformat=csv`;
    document.getElementById('linkPvgisEpw').href = `${base}tmy?lat=${project.climate.lat}&lon=${project.climate.lon}&outputformat=epw`;
    document.getElementById('linkPvgisEpw').classList.remove('hidden');
  } else {
    document.getElementById('linkPvgisJson').href = `${base}seriescalc?lat=${project.climate.lat}&lon=${project.climate.lon}&startyear=${pvType}&endyear=${pvType}&angle=0&components=1&outputformat=json`;
    document.getElementById('linkPvgisCsv').href = `${base}seriescalc?lat=${project.climate.lat}&lon=${project.climate.lon}&startyear=${pvType}&endyear=${pvType}&angle=0&components=1&outputformat=csv`;
    document.getElementById('linkPvgisEpw').classList.add('hidden');
  }
}

export function applyPartModeUI(part, onResultsRefresh) {
  const mode = appState.uiModes[part];
  document.querySelectorAll(`[data-part-toggle="${part}"] .seg-btn`).forEach(b => {
    b.classList.toggle('active-blue', b.dataset.mode === mode);
  });

  if (part === 'house') {
    document.getElementById('houseAdvBox').classList.toggle('hidden', mode === 'simple');
  } else if (part === 'floors') {
    renderFloors();
  } else if (part === 'openings') {
    const isSimple = mode === 'simple';
    document.getElementById('openingsSimpleBox').classList.toggle('hidden', !isSimple);
    document.getElementById('openingsAdvBox').classList.toggle('hidden', isSimple);
    renderOpenings();
  } else if (part === 'sia') {
    document.getElementById('siaAdvBox').classList.toggle('hidden', mode === 'simple');
  } else if (part === 'climate') {
    document.getElementById('climateAdvBox').classList.toggle('hidden', mode === 'simple');
  } else if (part === 'results') {
    const isAdv = mode === 'advanced';
    const simpleView = document.getElementById('resultsSimpleView');
    const advView = document.getElementById('resultsAdvView');
    if (simpleView) simpleView.classList.toggle('hidden', isAdv);
    if (advView) advView.classList.toggle('hidden', !isAdv);
    document.querySelectorAll('.res-adv-only').forEach(el => el.classList.toggle('hidden', !isAdv));
    if (!document.getElementById('view-results').classList.contains('hidden') && onResultsRefresh) {
      onResultsRefresh();
    }
  }
}

export function setGlobalMode(mode, onResultsRefresh) {
  Object.keys(appState.uiModes).forEach(k => {
    appState.uiModes[k] = mode;
  });
  document.getElementById('btnGlobalSimple').classList.toggle('active-blue', mode === 'simple');
  document.getElementById('btnGlobalAdv').classList.toggle('active-blue', mode === 'advanced');
  Object.keys(appState.uiModes).forEach(part => applyPartModeUI(part, onResultsRefresh));
}

export function syncAllUI(onResultsRefresh) {
  const { project } = appState;
  document.getElementById('projName').value = project.name;
  document.getElementById('projectType').value = project.projectType;
  document.getElementById('siaCurveMode').value = project.siaCurveMode;
  document.getElementById('stackCoupling').checked = project.stackCoupling;
  const foehnEl = document.getElementById('projFoehn');
  if (foehnEl) foehnEl.checked = Boolean(project.foehnExposed);
  const albEl = document.getElementById('projAlbedo');
  if (albEl) albEl.value = project.albedo ?? 0.20;

  renderFloorSelectors();
  renderFloors();
  renderOpenings();
  loadSiaFloorInputs();
  syncPvgisUI();
  updateInspector();
  Object.keys(appState.uiModes).forEach(part => applyPartModeUI(part, onResultsRefresh));
  refresh3DViewers();
}

export function renderLibrary(onLoadProject) {
  const grid = document.getElementById('libraryGrid');
  grid.innerHTML = '';
  HOUSE_LIBRARY.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'house-card';
    btn.dataset.tip = `Charger le modèle « ${item.title} » : ${item.desc}`;
    btn.innerHTML = `<h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.desc)}</p>`;
    btn.addEventListener('click', () => {
      appState.project = item.build();
      appState.activeFloorId = appState.project.floors[0].id;
      appState.customWeather = null;
      if (item.id === 'local_bureau_box3d') {
        appState.uiModes.floors = 'box3d';
      } else if (appState.uiModes.floors === 'box3d') {
        appState.uiModes.floors = 'simple';
      }
      syncAllUI();
      onLoadProject();
    });
    grid.appendChild(btn);
  });
}

export function bindConfigEvents({ onRunSimulation, onResultsRefresh }) {
  document.getElementById('btnGlobalSimple').addEventListener('click', () => setGlobalMode('simple', onResultsRefresh));
  document.getElementById('btnGlobalAdv').addEventListener('click', () => setGlobalMode('advanced', onResultsRefresh));

  document.querySelectorAll('[data-part-toggle]').forEach(grp => {
    const part = grp.dataset.partToggle;
    grp.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        appState.uiModes[part] = btn.dataset.mode;
        applyPartModeUI(part, onResultsRefresh);
      });
    });
  });

  document.querySelectorAll('.rail-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rail-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.step-section').forEach(s => s.classList.add('hidden'));
      document.getElementById(btn.dataset.step).classList.remove('hidden');
      if (btn.dataset.step === 'step-floors') {
        renderFloors();
        requestAnimationFrame(refresh3DViewers);
      }
      if (btn.dataset.step === 'step-openings') renderOpenings();
      requestAnimationFrame(refresh3DViewers);
    });
  });

  document.getElementById('projName').addEventListener('input', e => {
    appState.project.name = e.target.value;
    updateInspector();
  });
  document.getElementById('projectType').addEventListener('change', e => {
    appState.project.projectType = e.target.value;
    onRunSimulation();
  });
  document.getElementById('projFoehn')?.addEventListener('change', e => {
    appState.project.foehnExposed = e.target.checked;
  });
  const syncUhiCheckboxes = checked => {
    appState.project.climate.urbanHeatIsland = checked;
    syncPvgisUI();
    updateInspector();
  };
  document.getElementById('projUHI')?.addEventListener('change', e => syncUhiCheckboxes(e.target.checked));
  document.getElementById('climateUHI')?.addEventListener('change', e => syncUhiCheckboxes(e.target.checked));
  document.getElementById('siaCurveMode').addEventListener('change', e => {
    appState.project.siaCurveMode = e.target.value;
  });
  document.getElementById('stackCoupling').addEventListener('change', e => {
    appState.project.stackCoupling = e.target.checked;
    renderOpenings();
  });

  document.getElementById('projAlbedo')?.addEventListener('change', e => {
    appState.project.albedo = Math.max(0.05, Math.min(0.8, Number(e.target.value) || 0.2));
  });

  document.querySelectorAll('[data-3d-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      viewerInspector?.setView(btn.dataset['3dPreset']);
    });
  });

  document.getElementById('btnAddFloor').addEventListener('click', () => {
    const { project } = appState;
    const topFl = project.floors[project.floors.length - 1];
    const clone = JSON.parse(JSON.stringify(topFl));
    clone.id = 'fl_' + Date.now();
    clone.name = `Étage ${project.floors.length + 1}`;
    clone.elevationZ = Math.round((topFl.elevationZ + topFl.height + 0.25) * 100) / 100;
    clone.simplePos = 'top';
    computeAutoEnvelopeFromFloor(clone);
    project.floors.push(clone);
    appState.activeFloorId = clone.id;
    syncAllUI();
  });

  ['activeOpeningFloor', 'siaTargetFloor'].forEach(id => {
    document.getElementById(id).addEventListener('change', e => {
      appState.activeFloorId = e.target.value;
      renderFloorSelectors();
      renderFloors();
      renderOpenings();
      loadSiaFloorInputs();
      refresh3DViewers();
    });
  });

  ['simpPctS', 'simpPctO', 'simpPctE', 'simpPctN', 'simpPctR', 'simpShading', 'simpBlindMode', 'simpOverhang', 'simpHorizon'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', applySimpleGlazingFromInputs);
  });

  ['simpOpenBasis', 'simpOpenPct', 'simpOpenEff', 'simpOpenCross'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      const fl = appState.project.floors.find(f => f.id === appState.activeFloorId);
      if (!fl) return;
      fl.nightSimpleBasis = document.getElementById('simpOpenBasis').value;
      fl.nightSimplePct = Math.max(0, Math.min(100, parseFloat(document.getElementById('simpOpenPct').value) || 0));
      fl.nightSimpleEff = parseFloat(document.getElementById('simpOpenEff').value) || 1.0;
      fl.nightSimpleCross = document.getElementById('simpOpenCross').checked;
      fl.nightVentMode = fl.nightSimpleBasis === 'none' ? 'none' : 'simple_pct';
      document.getElementById('inNightMode').value = fl.nightVentMode;
      const totalWin = appState.project.openings
        .filter(o => o.floorId === fl.id)
        .reduce((s, o) => s + o.width * o.height * o.qty, 0);
      updateSimpleNightLiveBadge(fl, totalWin);
      updateNightVentUI(fl);
    });
  });

  document.getElementById('btnAddOpening').addEventListener('click', () => {
    appState.project.openings.push({
      id: 'op_' + Date.now(),
      floorId: appState.activeFloorId,
      name: `Fenêtre ${appState.project.openings.length + 1}`,
      orient: 'S',
      width: 1.4,
      height: 1.4,
      qty: 1,
      uWin: 1.0,
      gVit: 0.55,
      gStore: 0.12,
      gtotMode: 'product',
      overhangDepth: 0,
      frameFactor: 0.78,
      shadingFactor: 0.95,
      blindMode: 'auto',
      blindThreshI: 200,
      blindThreshT: 23.0,
      windSafe: true,
      operable: true,
      openWidth: 1.0,
      openHeight: 1.4,
      openType: 'imposte',
      alphaDeg: 20,
      cd: 0.6,
      sillHeight: 0.9
    });
    renderOpenings();
    updateInspector();
  });

  document.getElementById('btnApplyQuickShading').addEventListener('click', () => {
    const sp = SHADING_PRESETS[document.getElementById('quickShadingPreset').value];
    if (!sp) return;
    appState.project.openings.forEach(op => {
      if (op.floorId === appState.activeFloorId) {
        op.gVit = sp.gVit;
        op.gStore = sp.gStore;
        op.gtotMode = sp.gtotMode;
      }
    });
    renderOpenings();
  });

  document.getElementById('siaCategorySelect').addEventListener('change', e =>
    applySiaCatToCurrentFloor(e.target.value)
  );
  document.getElementById('siaGainFactor').addEventListener('input', e => {
    const fl = appState.project.floors.find(f => f.id === appState.activeFloorId);
    if (!fl) return;
    fl.gainFactorPct = Number(e.target.value);
    document.getElementById('siaGainFactorLbl').textContent = `${fl.gainFactorPct} %`;
  });

  const bindSia = (id, prop, customFlag = false, scaleDiv = 1) => {
    document.getElementById(id)?.addEventListener('change', e => {
      const fl = appState.project.floors.find(f => f.id === appState.activeFloorId);
      if (!fl) return;
      fl[prop] = prop === 'nightVentMode' ? e.target.value : Number(e.target.value) / scaleDiv;
      if (prop === 'nightVentMode' && e.target.value === 'simple_pct') {
        if (!fl.nightSimpleBasis || fl.nightSimpleBasis === 'none') {
          fl.nightSimpleBasis = 'floor_pct';
        }
        if ((fl.nightSimplePct ?? 0) <= 0) {
          fl.nightSimplePct = 5.0;
        }
        renderOpenings();
      }
      if (customFlag) {
        fl.siaCategory = 'custom';
        document.getElementById('siaCategorySelect').value = 'custom';
        updateSiaCatChips(fl);
      }
      if (['nightVentMode', 'nightVentFixedVal'].includes(prop)) {
        updateNightVentUI(fl);
      }
      updateInspector();
    });
  };
  bindSia('inOccCount', 'occCount', true);
  bindSia('inOccWatt', 'occWatt', true);
  bindSia('inOccPresence', 'occPresenceFactor', true, 100);
  bindSia('inLightWm2', 'lightWm2', true);
  bindSia('inEquipWatt', 'equipWatt', true);
  bindSia('inOccStart', 'occStart', true);
  bindSia('inOccEnd', 'occEnd', true);
  bindSia('inOccDays', 'occDays', true);
  bindSia('inStandbyPct', 'standbyPct', true);
  bindSia('inQHyg', 'qHygSpec', true);
  bindSia('inAchInfil', 'achInfil');
  bindSia('inEtaWrg', 'etaWRG');
  bindSia('inNightMode', 'nightVentMode');
  bindSia('inNightFixed', 'nightVentFixedVal');
  bindSia('inNightStart', 'nightStart');
  bindSia('inNightEnd', 'nightEnd');
  bindSia('inNightTargetTi', 'nightTargetTi');
  bindSia('inNightMinDT', 'nightMinDT');

  document.getElementById('inNightSimplePct')?.addEventListener('change', e => {
    const fl = appState.project.floors.find(f => f.id === appState.activeFloorId);
    if (!fl) return;
    if (!fl.nightSimpleBasis || fl.nightSimpleBasis === 'none') fl.nightSimpleBasis = 'floor_pct';
    fl.nightSimplePct = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
    renderOpenings();
    updateNightVentUI(fl);
  });
  document.getElementById('inNightSimpleCross')?.addEventListener('change', e => {
    const fl = appState.project.floors.find(f => f.id === appState.activeFloorId);
    if (!fl) return;
    fl.nightSimpleCross = e.target.checked;
    renderOpenings();
    updateNightVentUI(fl);
  });

  document.getElementById('climateStation').addEventListener('change', e => {
    appState.project.climate.station = e.target.value;
    const st = SWISS_STATIONS[e.target.value];
    if (st) {
      appState.project.climate.lat = st.lat;
      appState.project.climate.lon = st.lon;
    }
    appState.customWeather = null;
    syncPvgisUI();
    updateInspector();
  });

  document.getElementById('climateScenario').addEventListener('change', e => {
    appState.project.climate.scenario = e.target.value;
    appState.customWeather = null;
    syncPvgisUI();
    updateInspector();
  });

  ['pvLat', 'pvLon', 'pvType', 'pvTzMode'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      appState.project.climate.lat = parseFloat(document.getElementById('pvLat').value) || 46.22;
      appState.project.climate.lon = parseFloat(document.getElementById('pvLon').value) || 7.33;
      appState.project.climate.tzMode = document.getElementById('pvTzMode').value;
      syncPvgisUI();
    });
  });

  const loadWeatherText = (text, name) => {
    const badge = document.getElementById('weatherStatusBadge');
    try {
      appState.customWeather = parseAnyWeatherText(text, name, appState.project.climate);
      badge.textContent = `Climat actif : ${appState.customWeather.sourceLabel}`;
      badge.className = 'pill ok';
      updateInspector();
    } catch (err) {
      badge.textContent = `Erreur : ${err.message}`;
      badge.className = 'pill ko';
    }
  };

  document.getElementById('weatherFileInput').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => loadWeatherText(ev.target.result, f.name);
    r.readAsText(f);
  });

  const wdz = document.getElementById('weatherDropzone');
  wdz.addEventListener('dragover', e => {
    e.preventDefault();
    wdz.classList.add('dragover');
  });
  wdz.addEventListener('dragleave', () => wdz.classList.remove('dragover'));
  wdz.addEventListener('drop', e => {
    e.preventDefault();
    wdz.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => loadWeatherText(ev.target.result, f.name);
    r.readAsText(f);
  });

  document.getElementById('btnTogglePaste').addEventListener('click', () =>
    document.getElementById('pasteBox').classList.toggle('hidden')
  );
  document.getElementById('btnLoadPasted').addEventListener('click', () => {
    const val = document.getElementById('pasteArea').value.trim();
    if (val) loadWeatherText(val, 'Données collées');
  });
  document.getElementById('btnResetWeather').addEventListener('click', () => {
    appState.customWeather = null;
    document.getElementById('weatherFileInput').value = '';
    syncPvgisUI();
    updateInspector();
  });

  const handleHouseFile = file => {
    const r = new FileReader();
    r.onload = ev => {
      try {
        const p = parseHouseFile(ev.target.result, file.name, appState.project.climate);
        appState.project = p.proj;
        appState.activeFloorId = appState.project.floors[0].id;
        document.getElementById('houseImportMsg').textContent = p.msg;
        syncAllUI();
        onRunSimulation();
      } catch (err) {
        document.getElementById('houseImportMsg').textContent = `Erreur : ${err.message}`;
      }
    };
    r.readAsText(file);
  };

  document.getElementById('fileImportHouse').addEventListener('change', e => {
    if (e.target.files[0]) handleHouseFile(e.target.files[0]);
  });
  const hdz = document.getElementById('dropzoneHouse');
  hdz.addEventListener('dragover', e => {
    e.preventDefault();
    hdz.classList.add('dragover');
  });
  hdz.addEventListener('dragleave', () => hdz.classList.remove('dragover'));
  hdz.addEventListener('drop', e => {
    e.preventDefault();
    hdz.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleHouseFile(e.dataTransfer.files[0]);
  });

  document.getElementById('btnExportHouse').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(appState.project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${appState.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'projet'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
