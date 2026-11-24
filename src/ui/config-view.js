/**
 * @fileoverview Gestion de l'interface Configuration (5 étapes unifiées Simple / Avancé,
 * vitrages et stores séparés, inspecteur latéral, importateurs BIM/météo et synchronisation bidirectionnelle).
 */

import {
  GLAZING_PRESETS,
  ORIENTATIONS,
  SIA380_CATEGORIES,
  STORE_PRESETS,
  deriveSiaInternalDefaults
} from '../standards/sia380-1.js';
import { getSIA180Profile } from '../standards/sia180.js';
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
  ensureBox3dDefaults,
  syncOpeningBackToBox3d
} from '../methodology/03-envelope-and-gains.js';
import {
  computeBuildingStackSpan,
  computeFloorNightFlowM3h
} from '../methodology/04-natural-ventilation.js';
import { fetchLiveWeatherData, parseAnyWeatherText } from '../methodology/02-weather-model.js';
import { parseHouseFile } from '../parsers/house-importers.js';
import {
  HOUSE_LIBRARY,
  appState,
  createNewVariant,
  deleteVariant,
  duplicateActiveVariant,
  escapeHtml,
  getActiveVariant,
  renameVariant,
  replaceActiveVariantProject,
  resetWorkspaceStorage,
  saveWorkspaceToStorage,
  switchVariant,
  syncActiveVariantSnapshot,
  upgradeActiveVariantToAdvanced
} from '../state/project-store.js';
import { BuildingViewer3D } from './viewer-3d.js';

const CONFIG_STEPS = ['step-house', 'step-floors', 'step-openings', 'step-sia', 'step-climate'];

let viewerInspector = null;
let viewerMain3D = null;
let notifyProjectChanged = () => {};
let notifyVariantSwitched = () => {};
let notifyOpenResults = () => {};

function isBox3dActiveForFloor(fl) {
  return Boolean(fl && fl.box3d && appState.uiModes.floorsEditor === 'box3d');
}

export function flashSaveIndicator(msg = 'Sauvegardé') {
  const el = document.getElementById('saveStatusLbl');
  if (!el) return;
  el.textContent = msg;
}

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

function detectGlazingPresetKey(ops) {
  if (!ops || ops.length === 0) return 'triple_std';
  const ref = ops[0];
  for (const [key, gp] of Object.entries(GLAZING_PRESETS)) {
    if (Math.abs((ref.uWin ?? 0.75) - gp.uWin) < 0.04 && Math.abs((ref.gVit ?? 0.55) - gp.gVit) < 0.02) {
      return key;
    }
  }
  return 'custom';
}

function detectStorePresetKey(ops) {
  if (!ops || ops.length === 0) return 'lamelles_10';
  const ref = ops[0];
  for (const [key, sp] of Object.entries(STORE_PRESETS)) {
    if (Math.abs((ref.gStore ?? 0.1) - sp.gStore) < 0.015 && (ref.gtotMode || 'product') === sp.gtotMode) {
      return key;
    }
  }
  return 'custom';
}

export function syncHeaderRequirementBadge() {
  const { project } = appState;
  const prof = getSIA180Profile(project.projectType);
  const hdr = document.getElementById('headerReqBadge');
  if (hdr) {
    hdr.textContent = prof.shortLabel;
    hdr.dataset.tip = prof.description;
  }
  const hint = document.getElementById('projectTypeHint');
  if (hint) hint.textContent = prof.description;
  const sel = document.getElementById('projectType');
  if (sel) {
    const mapped =
      project.projectType === 'residential_400'
        ? 'reno'
        : project.projectType === 'strict_100'
          ? 'new'
          : project.projectType;
    sel.value = ['minergie', 'new', 'reno', 'zero'].includes(mapped) ? mapped : 'new';
  }
}

function syncMainCategorySelect() {
  const sel = document.getElementById('projMainCategory');
  if (!sel) return;
  const floors = appState.project.floors || [];
  if (floors.length === 0) {
    sel.value = 'custom';
    return;
  }
  const firstCat = floors[0].siaCategory || 'custom';
  const allSame = firstCat !== 'custom' && floors.every(f => f.siaCategory === firstCat);
  sel.value = allSame ? firstCat : 'custom';
}

export function renderFloorSelectors() {
  const { project } = appState;
  if (!project.floors.some(f => f.id === appState.activeFloorId)) {
    appState.activeFloorId = project.floors[0].id;
  }
  const multiFloor = project.floors.length > 1;
  const opts = project.floors
    .map(f => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`)
    .join('');
  ['activeOpeningFloor', 'siaTargetFloor'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = opts;
    sel.value = appState.activeFloorId;
  });
  document.getElementById('openingsFloorBar')?.classList.toggle('hidden', !multiFloor);
  document.getElementById('siaFloorBar')?.classList.toggle('hidden', !multiFloor);
}

function updateRailCounts() {
  const { project } = appState;
  const fCount = project.floors.length;
  const oCount = project.openings.reduce((s, o) => s + (o.qty || 1), 0);
  const fEl = document.getElementById('railFloorCount');
  if (fEl) fEl.textContent = fCount;
  const oEl = document.getElementById('railOpeningCount');
  if (oEl) oEl.textContent = oCount;
}

function getFacadeGrossForFloor(fl) {
  return Math.max(4, Math.sqrt(Math.max(4, fl.area)) * fl.height);
}

function detectSimpleBlindPreset(op) {
  if (!op) return 'auto_sia';
  if (op.blindMode === 'always_down') return 'always_down';
  if (op.blindMode === 'always_up') return 'always_up';
  const ti = op.blindThreshI ?? 200;
  const tt = op.blindThreshT ?? 22.0;
  const rule = op.blindRule || 'irr_and_temp';
  if (op.blindMode === 'manual_day' && ti === 200 && Math.abs(tt - 22.0) < 0.05) return 'manual_day';
  if (op.blindMode === 'auto' && ti === 200 && Math.abs(tt - 22.0) < 0.05) {
    if (rule === 'irr_and_temp') return 'auto_sia';
    if (rule === 'irr_or_temp') return 'auto_bsol';
  }
  return 'custom';
}

function resolveSimpleBlindPreset(presetKey, fallbackOp = null) {
  if (presetKey === 'auto_bsol') {
    return { blindMode: 'auto', blindRule: 'irr_or_temp', blindThreshI: 200, blindThreshT: 22.0 };
  }
  if (presetKey === 'manual_day') {
    return { blindMode: 'manual_day', blindRule: 'irr_and_temp', blindThreshI: 200, blindThreshT: 22.0 };
  }
  if (presetKey === 'always_down') {
    return { blindMode: 'always_down', blindRule: 'irr_and_temp', blindThreshI: 200, blindThreshT: 22.0 };
  }
  if (presetKey === 'always_up') {
    return { blindMode: 'always_up', blindRule: 'irr_and_temp', blindThreshI: 200, blindThreshT: 22.0 };
  }
  if (presetKey === 'custom' && fallbackOp) {
    return {
      blindMode: fallbackOp.blindMode || 'auto',
      blindRule: fallbackOp.blindRule || 'irr_and_temp',
      blindThreshI: fallbackOp.blindThreshI ?? 200,
      blindThreshT: fallbackOp.blindThreshT ?? 22.0
    };
  }
  return { blindMode: 'auto', blindRule: 'irr_and_temp', blindThreshI: 200, blindThreshT: 22.0 };
}

function detectSimpleNightPreset(fl) {
  if (!fl || fl.nightVentMode === 'none') return 'none';
  if (
    fl.nightVentMode === 'fixed_m3hm2' &&
    Math.abs((fl.nightVentFixedVal ?? 0) - 8.0) < 0.2 &&
    ((fl.nightStart === 0 && fl.nightEnd === 24) || fl.nightStart === fl.nightEnd)
  ) {
    return 'bsol_24h';
  }
  if (fl.nightVentMode === 'simple_pct' && (fl.nightSimpleBasis || 'floor_pct') === 'floor_pct') {
    const eff = Number(fl.nightSimpleEff ?? 0.6);
    const pct = Number(fl.nightSimplePct ?? 5.0);
    if (!fl.nightSimpleCross && Math.abs(eff - 0.6) < 0.15 && pct >= 2.5 && pct <= 3.5) return 'mono_tilt';
    if (!fl.nightSimpleCross && Math.abs(eff - 0.6) < 0.15 && pct >= 4.0 && pct <= 6.0) return 'mono_open';
    if (fl.nightSimpleCross && Math.abs(eff - 0.6) < 0.15 && pct >= 3.0 && pct <= 5.0) return 'cross';
  }
  return 'custom';
}

function applySimpleNightPreset(fl, presetKey) {
  if (presetKey === 'none') {
    fl.nightVentMode = 'none';
  } else if (presetKey === 'mono_tilt') {
    fl.nightVentMode = 'simple_pct';
    fl.nightSimpleBasis = 'floor_pct';
    fl.nightSimplePct = 3.0;
    fl.nightSimpleEff = 0.60;
    fl.nightSimpleCross = false;
    fl.nightStart = 21;
    fl.nightEnd = 7;
    fl.nightTargetTi = 21.0;
    fl.nightMinDT = 1.5;
  } else if (presetKey === 'mono_open') {
    fl.nightVentMode = 'simple_pct';
    fl.nightSimpleBasis = 'floor_pct';
    fl.nightSimplePct = 5.0;
    fl.nightSimpleEff = 0.60;
    fl.nightSimpleCross = false;
    fl.nightStart = 21;
    fl.nightEnd = 7;
    fl.nightTargetTi = 21.0;
    fl.nightMinDT = 1.5;
  } else if (presetKey === 'cross') {
    fl.nightVentMode = 'simple_pct';
    fl.nightSimpleBasis = 'floor_pct';
    fl.nightSimplePct = 3.5;
    fl.nightSimpleEff = 0.60;
    fl.nightSimpleCross = true;
    fl.nightStart = 21;
    fl.nightEnd = 7;
    fl.nightTargetTi = 21.0;
    fl.nightMinDT = 1.5;
  } else if (presetKey === 'bsol_24h') {
    fl.nightVentMode = 'fixed_m3hm2';
    fl.nightVentFixedVal = 8.0;
    fl.nightStart = 0;
    fl.nightEnd = 24;
    fl.nightTargetTi = 22.0;
    fl.nightMinDT = 2.0;
  }
}

function updateSimpleGtotBadge(gVit, gStore, gtotMode) {
  const badge = document.getElementById('simpGtotLiveBadge');
  if (!badge) return;
  const gtot = gtotMode === 'direct' ? gStore : gVit * gStore;
  badge.textContent = `g_total effectif : ${gtot.toFixed(2)}`;
  badge.className = `pill ${gtot <= 0.15 ? 'ok' : gtot <= 0.30 ? 'warn' : 'ko'}`;
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

  const firstOp = ops[0];
  const curG = firstOp?.gVit ?? 0.55;
  const curU = firstOp?.uWin ?? 0.75;
  const curGStore = firstOp?.gStore ?? 0.10;
  const curGtotMode = firstOp?.gtotMode || 'product';

  const glazingSel = document.getElementById('simpGlazingType');
  const glazingBox = document.getElementById('simpCustomGlazingBox');
  const detectedGlazing = detectGlazingPresetKey(ops);
  if (glazingSel) {
    // Si l'utilisateur vient de choisir 'custom', on le respecte même si les valeurs coïncident encore
    const keepCustom = glazingSel.dataset.forceCustom === '1';
    glazingSel.value = keepCustom ? 'custom' : detectedGlazing;
    if (glazingBox) glazingBox.classList.toggle('hidden', glazingSel.value !== 'custom');
  }
  const cG = document.getElementById('simpCustomG');
  const cU = document.getElementById('simpCustomU');
  if (cG) cG.value = curG;
  if (cU) cU.value = curU;

  const storeSel = document.getElementById('simpStoreType');
  const storeBox = document.getElementById('simpCustomStoreBox');
  const detectedStore = detectStorePresetKey(ops);
  if (storeSel) {
    const keepCustom = storeSel.dataset.forceCustom === '1';
    storeSel.value = keepCustom ? 'custom' : detectedStore;
    if (storeBox) storeBox.classList.toggle('hidden', storeSel.value !== 'custom');
  }
  const cGS = document.getElementById('simpCustomGStore');
  const cGM = document.getElementById('simpCustomGtotMode');
  if (cGS) cGS.value = curGStore;
  if (cGM) cGM.value = curGtotMode;

  const blindSel = document.getElementById('simpBlindPreset');
  if (blindSel) {
    const detectedBlind = detectSimpleBlindPreset(firstOp);
    const cBlind = blindSel.querySelector('option[value="custom"]');
    if (detectedBlind === 'custom' && firstOp) {
      const lbl = `Personnalisé (I≥${firstOp.blindThreshI ?? 200} W/m², T≥${firstOp.blindThreshT ?? 22}°C)`;
      if (!cBlind) {
        const opt = document.createElement('option');
        opt.value = 'custom';
        opt.textContent = lbl;
        blindSel.appendChild(opt);
      } else {
        cBlind.textContent = lbl;
      }
      blindSel.value = 'custom';
    } else {
      if (cBlind) cBlind.remove();
      blindSel.value = detectedBlind;
    }
  }

  if (firstOp) {
    document.getElementById('simpOverhang').value = firstOp.overhangDepth || 0;
  }

  updateSimpleGtotBadge(curG, curGStore, curGtotMode);

  const totalWin = ops.reduce((s, o) => s + o.width * o.height * o.qty, 0);
  document.getElementById('simpleGlazingSummary').textContent =
    `Total vitré : ${totalWin.toFixed(1)} m² (${((totalWin / Math.max(1, fl.area)) * 100).toFixed(0)} % du sol)`;
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

  // 1. Vitrage (g_vit et U_fen)
  const glazingSel = document.getElementById('simpGlazingType');
  const glazingChoice = glazingSel?.value || 'triple_std';
  let gVit = 0.55;
  let uWin = 0.75;
  if (glazingChoice === 'custom') {
    if (glazingSel) glazingSel.dataset.forceCustom = '1';
    gVit = Math.max(0.10, Math.min(0.90, parseFloat(document.getElementById('simpCustomG')?.value) || 0.55));
    uWin = Math.max(0.40, Math.min(5.00, parseFloat(document.getElementById('simpCustomU')?.value) || 0.75));
  } else {
    if (glazingSel) delete glazingSel.dataset.forceCustom;
    const gp = GLAZING_PRESETS[glazingChoice] || GLAZING_PRESETS.triple_std;
    gVit = gp.gVit;
    uWin = gp.uWin;
  }

  // 2. Store (g_store et gtotMode)
  const storeSel = document.getElementById('simpStoreType');
  const storeChoice = storeSel?.value || 'lamelles_10';
  let gStore = 0.10;
  let gtotMode = 'product';
  if (storeChoice === 'custom') {
    if (storeSel) storeSel.dataset.forceCustom = '1';
    gStore = Math.max(0.02, Math.min(1.00, parseFloat(document.getElementById('simpCustomGStore')?.value) || 0.12));
    gtotMode = document.getElementById('simpCustomGtotMode')?.value === 'direct' ? 'direct' : 'product';
  } else {
    if (storeSel) delete storeSel.dataset.forceCustom;
    const sp = STORE_PRESETS[storeChoice] || STORE_PRESETS.lamelles_10;
    gStore = sp.gStore;
    gtotMode = sp.gtotMode;
  }

  const blindPreset = document.getElementById('simpBlindPreset')?.value || 'auto_sia';
  const { blindMode, blindRule, blindThreshI, blindThreshT } = resolveSimpleBlindPreset(
    blindPreset,
    existingOps[0]
  );
  const overhang = Math.max(0, parseFloat(document.getElementById('simpOverhang').value) || 0);

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
      uWin,
      gVit,
      gStore,
      gtotMode,
      overhangDepth: orient === 'R' ? 0 : overhang,
      frameFactor: 0.78,
      shadingFactor: 1.0,
      blindMode,
      blindThreshI,
      blindThreshT,
      blindRule,
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
  updateNightVentUI(fl);
  updateInspector();
  refresh3DViewers();
  updateRailCounts();
}

export function renderOpenings() {
  renderFloorSelectors();
  const { project, uiModes } = appState;
  const fl = project.floors.find(f => f.id === appState.activeFloorId) || project.floors[0];
  const advHor = document.getElementById('advHorizon');
  if (advHor) advHor.value = project.horizonDeg ?? 0;

  const box3dDriven = isBox3dActiveForFloor(fl);
  document.getElementById('box3dOpeningsBanner')?.classList.toggle('hidden', !box3dDriven);
  document.getElementById('btnAddOpening')?.classList.toggle('hidden', box3dDriven);

  if (uiModes.openings === 'simple') {
    renderSimpleOpeningsForFloor(fl);
    updateRailCounts();
    return;
  }

  const multiFloor = project.floors.length > 1;
  const list = project.openings.filter(o => o.floorId === fl.id);
  const thead = document.getElementById('openingsTableHead');
  const tbody = document.getElementById('openingsTableBody');
  const orients = Object.keys(ORIENTATIONS);

  // 1. TABLEAU FENÊTRES, VITRAGES & OMBRAGES (compact, synchronisé avec le 3D si actif)
  if (thead) {
    thead.innerHTML = `<tr>
      ${multiFloor && !box3dDriven ? '<th data-tip="Étage auquel appartient la fenêtre.">Étage</th>' : ''}
      <th data-tip="Nom ou repère de la fenêtre.">Nom</th>
      <th data-tip="${box3dDriven ? 'Orientation définie par la paroi 3D (modifiable dans le Constructeur 3D).' : 'Orientation cardinale (S, SO, O, NO, N, NE, E, SE) ou R = Toiture.'}">Orient.</th>
      <th data-tip="Largeur unitaire de la fenêtre [m].">L [m]</th>
      <th data-tip="Hauteur unitaire de la fenêtre [m].">H [m]</th>
      <th data-tip="Nombre de fenêtres identiques.">Qté</th>
      <th data-tip="Coefficient de transmission thermique U_fen [W/(m²·K)].">U_fen</th>
      <th data-tip="Facteur solaire du vitrage nu g_vit [-] (typ. 0.50–0.65).">g_vit</th>
      <th data-tip="Profondeur de la casquette / balcon au-dessus de la fenêtre [m].">Casq. [m]</th>
      <th data-tip="Profondeur des écrans latéraux (joues verticales gauche/droite) [m].">Écr. lat [m]</th>
      <th data-tip="Angle d'obstruction de l'horizon en face de cette fenêtre [°].">Hor. [°]</th>
      <th data-tip="Cocher si cette fenêtre s'ouvre la nuit (cf. bloc 3 ci-dessous).">Nuit</th>
      ${box3dDriven ? '' : '<th></th>'}
    </tr>`;
  }

  tbody.innerHTML = '';
  list.forEach(op => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      ${
        multiFloor && !box3dDriven
          ? `<td><select data-op="${escapeHtml(op.id)}" data-k="floorId" style="min-width:95px;">${project.floors
              .map(f => `<option value="${escapeHtml(f.id)}" ${f.id === op.floorId ? 'selected' : ''}>${escapeHtml(f.name)}</option>`)
              .join('')}</select></td>`
          : ''
      }
      <td><input type="text" value="${escapeHtml(op.name)}" data-op="${escapeHtml(op.id)}" data-k="name" style="min-width:110px;" /></td>
      <td>${
        box3dDriven
          ? `<span class="pill neutral" data-tip="Orientation liée à la paroi 3D (modifiable dans le Constructeur 3D).">${op.orient}</span>`
          : `<select data-op="${escapeHtml(op.id)}" data-k="orient" style="width:62px;">${orients
              .map(o => `<option value="${o}" ${o === op.orient ? 'selected' : ''}>${o}</option>`)
              .join('')}</select>`
      }</td>
      <td><input type="number" step="0.1" min="0.2" value="${op.width}" data-op="${escapeHtml(op.id)}" data-k="width" style="width:58px;" /></td>
      <td><input type="number" step="0.1" min="0.2" value="${op.height}" data-op="${escapeHtml(op.id)}" data-k="height" style="width:58px;" /></td>
      <td><input type="number" step="1" min="1" value="${op.qty}" data-op="${escapeHtml(op.id)}" data-k="qty" style="width:50px;" /></td>
      <td><input type="number" step="0.05" min="0.4" value="${op.uWin}" data-op="${escapeHtml(op.id)}" data-k="uWin" style="width:58px;" /></td>
      <td><input type="number" step="0.02" min="0.1" max="0.9" value="${op.gVit}" data-op="${escapeHtml(op.id)}" data-k="gVit" style="width:58px;" /></td>
      <td><input type="number" step="0.1" min="0" value="${op.overhangDepth || 0}" data-op="${escapeHtml(op.id)}" data-k="overhangDepth" style="width:58px;" /></td>
      <td><input type="number" step="0.1" min="0" value="${op.leftFinDepth || 0}" data-op="${escapeHtml(op.id)}" data-k="sideFinDepth" style="width:58px;" /></td>
      <td><input type="number" step="5" min="0" max="60" value="${op.horizonDeg ?? project.horizonDeg ?? 0}" data-op="${escapeHtml(op.id)}" data-k="horizonDeg" style="width:54px;" /></td>
      <td style="text-align:center;"><input type="checkbox" ${op.operable ? 'checked' : ''} data-op="${escapeHtml(op.id)}" data-k="operable" /></td>
      ${box3dDriven ? '' : `<td><button class="btn btn-danger" data-del-op="${escapeHtml(op.id)}" data-tip="Supprimer cette fenêtre.">✕</button></td>`}
    `;
    tbody.appendChild(tr);
  });

  // 2. TABLEAU SÉPARÉ : PROTECTIONS SOLAIRES & COMMANDE DES STORES
  const blindsBox = document.getElementById('openingBlindsDetails');
  if (blindsBox) {
    blindsBox.innerHTML = list.length
      ? `<div class="table-wrap"><table>
          <thead><tr>
            <th data-tip="Fenêtre concernée et orientation.">Fenêtre</th>
            <th data-tip="Facteur de réduction du store g_store [-] (ou g_total si le mode g_tot est choisi).">g_store</th>
            <th data-tip="g×g : g_total = g_vit × g_store. g_tot : valeur directe combinée.">Mode</th>
            <th data-tip="Mode de fermeture du store : Auto, Manuel (si occupé), Fermé ou Ouvert.">Commande</th>
            <th data-tip="Seuil d'ensoleillement sur la façade [W/m²] (SIA 380/2 : 200 W/m²).">Seuil I [W/m²]</th>
            <th data-tip="Seuil de température intérieure [°C] (typ. 22 °C).">Seuil T [°C]</th>
            <th data-tip="Condition logique : I ET T (SIA), I OU T (bSol), ou I seul.">Règle</th>
            <th class="num" data-tip="Facteur solaire effectif résultant lorsque le store est baissé.">g_tot eff.</th>
          </tr></thead>
          <tbody>${list
            .map(op => {
              const gtotEff = op.gtotMode === 'direct' ? op.gStore : op.gVit * op.gStore;
              return `<tr>
                <td><strong>${escapeHtml(op.name)}</strong> <span style="color:var(--text-muted);">(${op.orient}, ×${op.qty})</span></td>
                <td><input type="number" step="0.01" min="0.02" max="1" value="${op.gStore}" data-op="${escapeHtml(op.id)}" data-k="gStore" style="width:64px;" /></td>
                <td><select data-op="${escapeHtml(op.id)}" data-k="gtotMode" style="width:74px;">
                  <option value="product" ${op.gtotMode === 'product' ? 'selected' : ''}>g×g</option>
                  <option value="direct" ${op.gtotMode === 'direct' ? 'selected' : ''}>g_tot</option>
                </select></td>
                <td><select data-op="${escapeHtml(op.id)}" data-k="blindMode" style="width:90px;">
                  <option value="auto" ${op.blindMode === 'auto' ? 'selected' : ''}>Auto</option>
                  <option value="manual_day" ${op.blindMode === 'manual_day' ? 'selected' : ''}>Manuel</option>
                  <option value="always_down" ${op.blindMode === 'always_down' ? 'selected' : ''}>Fermé</option>
                  <option value="always_up" ${op.blindMode === 'always_up' ? 'selected' : ''}>Ouvert</option>
                </select></td>
                <td><input type="number" step="25" min="50" max="600" value="${op.blindThreshI ?? 200}" data-op="${escapeHtml(op.id)}" data-k="blindThreshI" style="width:68px;" /></td>
                <td><input type="number" step="0.5" min="16" max="30" value="${op.blindThreshT ?? 22.0}" data-op="${escapeHtml(op.id)}" data-k="blindThreshT" style="width:64px;" /></td>
                <td><select data-op="${escapeHtml(op.id)}" data-k="blindRule" style="width:82px;">
                  <option value="irr_and_temp" ${(op.blindRule || 'irr_and_temp') === 'irr_and_temp' ? 'selected' : ''}>I ET T</option>
                  <option value="irr_or_temp" ${op.blindRule === 'irr_or_temp' ? 'selected' : ''}>I OU T</option>
                  <option value="irr_only" ${op.blindRule === 'irr_only' ? 'selected' : ''}>I seul</option>
                </select></td>
                <td class="num"><span class="pill ${gtotEff <= 0.15 ? 'ok' : gtotEff <= 0.3 ? 'warn' : 'ko'}">${gtotEff.toFixed(2)}</span></td>
              </tr>`;
            })
            .join('')}</tbody>
        </table></div>`
      : '<span class="pill warn">Aucune fenêtre définie sur cet étage.</span>';
  }

  // 3. TABLEAU SÉPARÉ : OUVRANTS POUR AÉRATION NOCTURNE
  const nightBox = document.getElementById('openingNightDetails');
  const operables = list.filter(o => o.operable);
  nightBox.innerHTML = operables.length
    ? `<div class="table-wrap"><table>
      <thead><tr>
        <th data-tip="Nom et quantité de la fenêtre ouverte la nuit.">Ouverture</th>
        <th data-tip="Mécanisme d'ouverture : battante ou imposte (soufflet), sur une seule façade ou traversante.">Type</th>
        <th data-tip="Largeur libre du vantail qui s'ouvre [m].">Larg. ouvrante [m]</th>
        <th data-tip="Hauteur libre du vantail qui s'ouvre [m].">Haut. ouvrante [m]</th>
        <th data-tip="Angle d'inclinaison α [°] (EN 16798-7 pour imposte / soufflet).">Angle α [°]</th>
        <th data-tip="Hauteur de l'allège [m].">Allège [m]</th>
      </tr></thead>
      <tbody>${operables
        .map(
          op => `<tr>
        <td><strong>${escapeHtml(op.name)}</strong> <span style="color:var(--text-muted);">(×${op.qty})</span></td>
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
    : '<span class="pill warn">Aucune fenêtre cochée « Nuit » dans le tableau ci-dessus.</span>';

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
      } else if (['floorId', 'name', 'orient', 'gtotMode', 'blindMode', 'blindRule', 'openType'].includes(k)) {
        op[k] = e.target.value;
        if (k === 'openType') {
          const flOp = project.floors.find(f => f.id === op.floorId);
          if (flOp && (flOp.nightVentMode === 'none' || flOp.nightVentMode === 'simple_pct')) {
            flOp.nightVentMode = 'physical';
            loadSiaFloorInputs();
          }
        }
        if (['name', 'orient', 'gtotMode', 'openType', 'floorId'].includes(k)) renderOpenings();
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
        if (['qty', 'gVit', 'gStore'].includes(k)) renderOpenings();
      }
      if (box3dDriven) {
        syncOpeningBackToBox3d(op, fl, project);
      }
      updateNightVentUI();
      updateInspector();
      refresh3DViewers();
      notifyProjectChanged();
    });
  });

  tbody.querySelectorAll('[data-del-op]').forEach(btn => {
    btn.addEventListener('click', () => {
      project.openings = project.openings.filter(o => o.id !== btn.dataset.delOp);
      renderOpenings();
      updateInspector();
      refresh3DViewers();
      notifyProjectChanged();
    });
  });

  updateRailCounts();
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

  const capMJ = ((activeFl.cSpec * activeFl.area * 3600) / 1e6).toFixed(1);
  const b3BlindRule = b3.blindRule || flOps[0]?.blindRule || 'irr_and_temp';
  const b3BlindThreshI = b3.blindThreshI ?? flOps[0]?.blindThreshI ?? 200;
  const b3BlindThreshT = b3.blindThreshT ?? flOps[0]?.blindThreshT ?? 22.0;

  const card = document.createElement('div');
  card.className = 'well';
  card.innerHTML = `
    <div class="well-head">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1;">
        <strong style="color:var(--primary);">Étage actif :</strong>
        <select id="b3FloorSel" style="width:220px;font-weight:600;">
          ${project.floors.map(f => `<option value="${escapeHtml(f.id)}" ${f.id === activeFl.id ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}
        </select>
        <span class="pill neutral" data-tip="Surface nette de plancher et capacité thermique totale effective (ISO 13786) de la pièce.">Surface : ${activeFl.area.toFixed(1)} m² • Inertie : ${activeFl.cSpec} Wh/m²K (${capMJ} MJ/K)</span>
      </div>
      ${project.floors.length > 1 ? `<button class="btn btn-danger" data-del-floor="${escapeHtml(activeFl.id)}">Supprimer</button>` : ''}
    </div>

    <div class="box3d-grid">
      <div>
        <div class="wall-panel">
          <div class="wall-panel-head"><strong>Dimensions &amp; Orientation du volume</strong></div>
          <div class="g3">
            <div class="field" data-tip="Largeur du local le long du Mur Devant [m]."><label>Largeur X [m]</label><input type="number" id="b3DimX" step="0.2" min="1" value="${b3.dimX}" /></div>
            <div class="field" data-tip="Profondeur du local perpendiculairement au Mur Devant [m]."><label>Profondeur Y [m]</label><input type="number" id="b3DimY" step="0.2" min="1" value="${b3.dimY}" /></div>
            <div class="field" data-tip="Hauteur libre sous plafond [m]."><label>Hauteur Z [m]</label><input type="number" id="b3DimZ" step="0.05" min="1.8" value="${activeFl.height}" /></div>
          </div>
          <div class="g2" style="margin-top:8px;">
            <div class="field" data-tip="Orientation cardinale de la façade Devant (les 3 autres murs tournent automatiquement à 90°).">
              <label>Orient. Mur Devant</label>
              <select id="b3FrontOrient">
                ${Object.keys(ORIENTATIONS).filter(o => o !== 'R').map(o => `<option value="${o}" ${o === b3.frontOrient ? 'selected' : ''}>${o} (${ORIENTATIONS[o].label})</option>`).join('')}
              </select>
            </div>
            <div class="field" data-tip="Réflectance solaire du sol extérieur (0.20 standard, 0.40 gravier clair).">
              <label>Albédo sol [-]</label>
              <input type="number" id="b3Albedo" step="0.05" min="0.05" max="0.80" value="${project.albedo ?? 0.20}" />
            </div>
          </div>
        </div>

        <div class="wall-panel">
          <div class="wall-panel-head">
            <strong>Inertie thermique (ISO 13786)</strong>
            <span class="pill neutral" style="font-size:10.5px;">${capMJ} MJ/K</span>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <label data-tip="Calcule automatiquement la capacité thermique C_R/A_SNP à partir de la surface et de la composition des 6 parois (béton nu, faux-plafond acoustique, parquet, cloison plâtre, bois)." style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
              <input type="checkbox" id="b3AutoCSpec" ${!b3.manualCSpec ? 'checked' : ''} />
              Auto depuis les 6 parois
            </label>
            <div style="display:flex;align-items:center;gap:6px;" data-tip="Capacité thermique spécifique effective rapportée à la surface de plancher [Wh/(m²·K)]. Décochez « Auto » pour imposer une valeur manuelle (ex. 176 Wh/m²K pour le TB Léa / bSol).">
              <label style="font-size:11.5px;color:var(--text-muted);">C_R/A_SNP :</label>
              <input type="number" id="b3ManualCSpec" step="5" min="10" max="250" value="${activeFl.cSpec}" ${!b3.manualCSpec ? 'disabled' : ''} style="width:74px;" />
              <span style="font-size:11px;color:var(--text-muted);">Wh/m²K</span>
            </div>
          </div>
        </div>

        <div class="wall-panel">
          <div class="wall-panel-head"><strong>Régulation des stores (seuils d'abaissement)</strong></div>
          <div class="field" data-tip="Condition logique d'abaissement des stores automatiques sur les fenêtres de ce local.">
            <label>Condition d'abaissement</label>
            <select id="b3BlindRule">
              <option value="irr_and_temp" ${b3BlindRule === 'irr_and_temp' ? 'selected' : ''}>Soleil ≥ seuil ET T° int. ≥ seuil (SIA / Lesosai)</option>
              <option value="irr_or_temp" ${b3BlindRule === 'irr_or_temp' ? 'selected' : ''}>Soleil ≥ seuil OU T° int. ≥ seuil (bSol Pro)</option>
              <option value="irr_only" ${b3BlindRule === 'irr_only' ? 'selected' : ''}>Ensoleillement seul (pyranomètre)</option>
            </select>
          </div>
          <div class="g2" style="margin-top:6px;">
            <div class="field" data-tip="Rayonnement solaire incident sur la façade [W/m²] déclenchant la descente des stores (SIA 380/2 : 200 W/m²).">
              <label>Seuil soleil [W/m²]</label>
              <input type="number" id="b3BlindThreshI" step="25" min="50" max="600" value="${b3BlindThreshI}" />
            </div>
            <div class="field" data-tip="Température intérieure [°C] au-delà de laquelle les stores s'abaissent (bSol : 22 °C).">
              <label>Seuil T° int. [°C]</label>
              <input type="number" id="b3BlindThreshT" step="0.5" min="16" max="30" value="${b3BlindThreshT}" />
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
    updateRailCounts();
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
  card.querySelector('#b3AutoCSpec')?.addEventListener('change', e => {
    b3.manualCSpec = !e.target.checked;
    commitBox3d(true);
  });
  card.querySelector('#b3ManualCSpec')?.addEventListener('change', e => {
    b3.manualCSpec = true;
    activeFl.cSpec = Math.max(10, Math.min(250, Number(e.target.value) || 80));
    commitBox3d(true);
  });
  card.querySelector('#b3BlindRule')?.addEventListener('change', e => {
    b3.blindRule = e.target.value;
    commitBox3d(false);
  });
  card.querySelector('#b3BlindThreshI')?.addEventListener('change', e => {
    b3.blindThreshI = Math.max(50, Math.min(800, Number(e.target.value) || 200));
    commitBox3d(false);
  });
  card.querySelector('#b3BlindThreshT')?.addEventListener('change', e => {
    b3.blindThreshT = Math.max(16, Math.min(30, Number(e.target.value) || 22.0));
    commitBox3d(false);
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
    updateRailCounts();
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
              <option value="140" ${fl.inertiaClass === '140' ? 'selected' : ''}>Béton nu apparent (140 Wh/m²K)</option>
              ${fl.inertiaClass === 'custom' ? `<option value="custom" selected>Personnalisée (${fl.cSpec} Wh/m²K)</option>` : ''}
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
              <option value="140" ${fl.inertiaClass === '140' ? 'selected' : ''}>Béton nu (140)</option>
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

  updateRailCounts();
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
  document.getElementById('nightSimpleFullBox')?.classList.toggle('hidden', !isSimple);
  document.getElementById('nightPhysicalHintBox')?.classList.toggle('hidden', !isPhys);
  document.getElementById('nightRegulBox')?.classList.toggle('hidden', isNone);

  const lblFixed = document.getElementById('lblNightFixed');
  if (lblFixed) {
    lblFixed.textContent = mode === 'fixed_ach' ? 'Taux imposé [vol/h]' : 'Débit imposé [m³/(h·m²)]';
  }

  const basisEl = document.getElementById('inNightSimpleBasis');
  const simpPctEl = document.getElementById('inNightSimplePct');
  const simpEffEl = document.getElementById('inNightSimpleEff');
  const simpCrossEl = document.getElementById('inNightSimpleCross');
  if (basisEl) basisEl.value = fl.nightSimpleBasis === 'window_pct' ? 'window_pct' : 'floor_pct';
  if (simpPctEl) simpPctEl.value = fl.nightSimplePct ?? 5.0;
  if (simpEffEl) simpEffEl.value = Number(fl.nightSimpleEff ?? 0.6).toFixed(2);
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
  const ach = m3h / Math.max(1, fl.area * fl.height);
  const badgeText = isNone
    ? 'Ventilation nuit désactivée (0.0 m³/(h·m²))'
    : `Débit (ΔT=8 K) : ${m3h.toFixed(0)} m³/h (${spec.toFixed(1)} m³/(h·m²) • ${ach.toFixed(1)} vol/h)`;
  const badgeCls = `pill ${spec >= 10 ? 'ok' : spec > 0 ? 'warn' : 'ko'}`;

  const b = document.getElementById('simpNightLiveBadge');
  if (b) {
    b.textContent = badgeText;
    b.className = badgeCls;
  }

  const simpSel = document.getElementById('simpNightPreset');
  if (simpSel) {
    const detected = detectSimpleNightPreset(fl);
    const cOpt = simpSel.querySelector('option[value="custom"]');
    if (detected === 'custom') {
      const lbl = `Personnalisé (${spec.toFixed(1)} m³/(h·m²) • ${ach.toFixed(1)} vol/h)`;
      if (!cOpt) {
        const opt = document.createElement('option');
        opt.value = 'custom';
        opt.textContent = lbl;
        simpSel.appendChild(opt);
      } else {
        cOpt.textContent = lbl;
      }
      simpSel.value = 'custom';
    } else {
      if (cOpt) cOpt.remove();
      simpSel.value = detected;
    }
  }

  const fcEl = document.getElementById('inNightFreeCool24h');
  if (fcEl) {
    const is24 = (fl.nightStart === 0 && fl.nightEnd === 24) || fl.nightStart === fl.nightEnd;
    fcEl.checked = is24;
  }
}

export function loadSiaFloorInputs() {
  const { project } = appState;
  const fl = project.floors.find(f => f.id === appState.activeFloorId) || project.floors[0];
  if (!fl) return;

  document.getElementById('siaCategorySelect').value = fl.siaCategory || 'custom';
  const profModeEl = document.getElementById('inInternalProfileMode');
  if (profModeEl) profModeEl.value = fl.internalProfileMode || 'sia2024';
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

function applySiaCatToFloor(fl, catKey) {
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
}

export function applySiaCatToCurrentFloor(catKey) {
  const fl = appState.project.floors.find(f => f.id === appState.activeFloorId);
  if (!fl) return;
  applySiaCatToFloor(fl, catKey);
  syncMainCategorySelect();
  loadSiaFloorInputs();
  updateInspector();
}

export function applyMainCategoryToAllFloors(catKey) {
  if (!catKey || catKey === 'custom') return;
  appState.project.floors.forEach(fl => applySiaCatToFloor(fl, catKey));
  syncMainCategorySelect();
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
  if (cUhi) cUhi.checked = uhi;

  const badge = document.getElementById('weatherStatusBadge');
  if (customWeather) {
    badge.textContent = `Climat actif : ${customWeather.sourceLabel}`;
    badge.className = 'pill ok';
  } else {
    const st = SWISS_STATIONS[project.climate.station] || SWISS_STATIONS.SIO;
    badge.textContent = `Climat actif : ${st.name} (${project.climate.scenario}${uhi ? ' + Îlot chaleur' : ''})`;
    badge.className = 'pill neutral';
  }
  document.getElementById('btnResetWeatherQuick')?.classList.toggle('hidden', !customWeather);

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

function syncFloorsEditorButtons() {
  const ed = appState.uiModes.floorsEditor === 'box3d' ? 'box3d' : 'table';
  document.querySelectorAll('[data-floors-editor]').forEach(btn => {
    btn.classList.toggle('active-blue', btn.dataset.floorsEditor === ed);
  });
}

function syncStrictModeCard() {
  const isAdv = appState.uiModes.global === 'advanced';
  const badge = document.getElementById('modeStatusBadge');
  const hint = document.getElementById('modeStatusHint');
  const btnUp = document.getElementById('btnUpgradeToAdv');
  const btnNewS = document.getElementById('btnNewSimpleVariantFromLock');

  if (badge) {
    badge.textContent = isAdv ? '🔒 Mode Avancé' : 'Mode Simple';
    badge.className = `pill ${isAdv ? 'req-pill' : 'ok'}`;
  }
  if (hint) {
    hint.textContent = isAdv
      ? 'Verrouillé en Avancé sur cette variante pour préserver vos réglages détaillés (3D, fenêtres).'
      : 'Saisie rapide en 5 étapes. Passez en Avancé pour débloquer le 3D et les réglages experts.';
  }
  if (btnUp) btnUp.classList.toggle('hidden', isAdv);
  if (btnNewS) btnNewS.classList.toggle('hidden', !isAdv);
}

export function renderVariantBar() {
  const wrap = document.getElementById('variantTabs');
  if (!wrap) return;
  wrap.innerHTML = '';
  appState.variants.forEach(v => {
    const btn = document.createElement('button');
    const isActive = v.id === appState.activeVariantId;
    btn.className = `variant-tab${isActive ? ' active' : ''}`;
    btn.dataset.tip = `Variante « ${v.name} » (${v.inputMode === 'advanced' ? 'Mode Avancé' : 'Mode Simple'}). Cliquer pour basculer dessus.`;
    btn.innerHTML = `<span class="variant-tab-name">${escapeHtml(v.name)}</span><span class="variant-mode-dot">${v.inputMode === 'advanced' ? 'Av.' : 'Simp.'}</span>`;
    btn.addEventListener('click', () => {
      if (v.id === appState.activeVariantId) return;
      switchVariant(v.id);
      syncAllUI();
      notifyVariantSwitched();
    });
    btn.addEventListener('dblclick', () => {
      if (v.id === appState.activeVariantId) openInlineVariantRename();
    });
    wrap.appendChild(btn);
  });

  const delBtn = document.getElementById('btnDeleteVariant');
  if (delBtn) delBtn.classList.toggle('hidden', appState.variants.length <= 1);
}

function openInlineVariantRename() {
  const cur = getActiveVariant();
  const box = document.getElementById('variantRenameBox');
  const inp = document.getElementById('variantRenameInput');
  if (!cur || !box || !inp) return;
  inp.value = cur.name;
  box.classList.remove('hidden');
  inp.focus();
  inp.select();
}

function updateStepFooter(resolvedStep) {
  const idx = Math.max(0, CONFIG_STEPS.indexOf(resolvedStep));
  const total = CONFIG_STEPS.length;
  const info = document.getElementById('stepFooterInfo');
  if (info) info.textContent = `Étape ${idx + 1} / ${total}`;
  const prevBtn = document.getElementById('btnStepPrev');
  if (prevBtn) {
    prevBtn.style.visibility = idx === 0 ? 'hidden' : 'visible';
  }
  const nextBtn = document.getElementById('btnStepNext');
  const finBtn = document.getElementById('btnStepFinish');
  if (nextBtn) nextBtn.classList.toggle('hidden', idx >= total - 1);
  if (finBtn) finBtn.classList.toggle('hidden', idx < total - 1);
}

export function activateConfigStep(stepId, scrollTop = false) {
  const resolvedStep = CONFIG_STEPS.includes(stepId) ? stepId : 'step-house';
  appState.uiModes.activeStep = resolvedStep;

  document.querySelectorAll('.rail-item').forEach(b => {
    b.classList.toggle('active', b.dataset.step === resolvedStep);
  });

  document.querySelectorAll('.step-section').forEach(sec => {
    sec.classList.toggle('hidden', sec.id !== resolvedStep);
  });

  updateStepFooter(resolvedStep);

  if (resolvedStep === 'step-floors') renderFloors();
  if (resolvedStep === 'step-openings') renderOpenings();
  if (resolvedStep === 'step-sia') loadSiaFloorInputs();
  if (scrollTop) {
    const pane = document.querySelector('.center-pane');
    if (pane) pane.scrollTo({ top: 0, behavior: 'smooth' });
  }
  requestAnimationFrame(refresh3DViewers);
}

export function applyGlobalLayout(onResultsRefresh, targetStep = null) {
  const mode = appState.uiModes.global === 'advanced' ? 'advanced' : 'simple';
  const isAdv = mode === 'advanced';

  appState.uiModes.house = mode;
  appState.uiModes.openings = mode;
  appState.uiModes.sia = mode;
  appState.uiModes.climate = mode;
  appState.uiModes.floors = isAdv
    ? appState.uiModes.floorsEditor === 'box3d'
      ? 'box3d'
      : 'advanced'
    : 'simple';

  syncStrictModeCard();

  document.querySelectorAll('.adv-only').forEach(el => el.classList.toggle('hidden', !isAdv));
  document.querySelectorAll('.simple-only').forEach(el => el.classList.toggle('hidden', isAdv));

  document.getElementById('openingsSimpleBox')?.classList.toggle('hidden', isAdv);
  document.getElementById('openingsAdvBox')?.classList.toggle('hidden', !isAdv);

  const titles = {
    houseCardTitle: 'Identification & Affectation du projet',
    floorsCardTitle: isAdv ? 'Étages, Enveloppe & Constructeur 3D' : 'Volume, Isolation & Inertie thermique',
    siaCardTitle: isAdv ? '1. Affectation SIA 380/1 & Charges internes' : '1. Affectation de l’étage'
  };
  Object.entries(titles).forEach(([id, txt]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  });

  syncFloorsEditorButtons();
  activateConfigStep(targetStep || appState.uiModes.activeStep || 'step-house');
}

export function setGlobalMode(mode, onResultsRefresh, targetStep = null) {
  if (mode === 'advanced') {
    upgradeActiveVariantToAdvanced();
  }
  applyGlobalLayout(onResultsRefresh, targetStep);
  renderVariantBar();
}

export function syncAllUI(onResultsRefresh) {
  const { project } = appState;
  document.getElementById('projName').value = project.name;
  syncHeaderRequirementBadge();
  syncMainCategorySelect();
  document.getElementById('siaCurveMode').value = project.siaCurveMode;
  document.getElementById('stackCoupling').checked = project.stackCoupling;
  const fresnelEl = document.getElementById('projUseFresnel');
  if (fresnelEl) fresnelEl.checked = project.useFresnelIncidence !== false;
  const foehnEl = document.getElementById('projFoehn');
  if (foehnEl) foehnEl.checked = Boolean(project.foehnExposed);
  const albEl = document.getElementById('projAlbedo');
  if (albEl) albEl.value = project.albedo ?? 0.20;
  const advHorEl = document.getElementById('advHorizon');
  if (advHorEl) advHorEl.value = project.horizonDeg || 0;

  const gSel = document.getElementById('simpGlazingType');
  if (gSel) delete gSel.dataset.forceCustom;
  const sSel = document.getElementById('simpStoreType');
  if (sSel) delete sSel.dataset.forceCustom;

  renderVariantBar();
  renderFloorSelectors();
  renderFloors();
  renderOpenings();
  loadSiaFloorInputs();
  syncPvgisUI();
  updateInspector();
  updateRailCounts();
  applyGlobalLayout(onResultsRefresh);
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
      const is3dModel = item.id === 'local_bureau_box3d' || item.id === 'tb_lea_bsol';
      replaceActiveVariantProject(item.build(), {
        inputMode: is3dModel ? 'advanced' : 'simple',
        floorsEditor: is3dModel ? 'box3d' : 'table',
        customWeather: null
      });
      const drawer = document.getElementById('libraryDrawer');
      if (drawer) drawer.open = false;
      syncAllUI();
      onLoadProject();
    });
    grid.appendChild(btn);
  });
}

export function bindConfigEvents({ onRunSimulation, onResultsRefresh, onProjectChanged, onVariantSwitched, onOpenResults }) {
  notifyProjectChanged = onProjectChanged || (() => {});
  notifyVariantSwitched = onVariantSwitched || (() => {});
  notifyOpenResults = onOpenResults || (() => {});

  // Passage strict à sens unique Simple → Avancé
  document.getElementById('btnUpgradeToAdv')?.addEventListener('click', () => {
    upgradeActiveVariantToAdvanced();
    applyGlobalLayout(onResultsRefresh);
    renderVariantBar();
    notifyProjectChanged();
  });

  document.getElementById('btnNewSimpleVariantFromLock')?.addEventListener('click', () => {
    createNewVariant({ inputMode: 'simple' });
    syncAllUI();
    notifyVariantSwitched();
  });

  // Barre multi-variantes (style Lesosai)
  document.getElementById('btnDuplicateVariant')?.addEventListener('click', () => {
    duplicateActiveVariant();
    syncAllUI();
    notifyVariantSwitched();
  });

  document.getElementById('btnNewVariant')?.addEventListener('click', () => {
    createNewVariant({ inputMode: 'simple' });
    syncAllUI();
    notifyVariantSwitched();
  });

  document.getElementById('btnRenameVariant')?.addEventListener('click', openInlineVariantRename);

  const commitRename = () => {
    const box = document.getElementById('variantRenameBox');
    const inp = document.getElementById('variantRenameInput');
    if (!box || !inp) return;
    renameVariant(appState.activeVariantId, inp.value);
    box.classList.add('hidden');
    renderVariantBar();
    notifyVariantSwitched();
  };
  document.getElementById('btnVariantRenameOk')?.addEventListener('click', commitRename);
  document.getElementById('btnVariantRenameCancel')?.addEventListener('click', () => {
    document.getElementById('variantRenameBox')?.classList.add('hidden');
  });
  document.getElementById('variantRenameInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') document.getElementById('variantRenameBox')?.classList.add('hidden');
  });

  document.getElementById('btnDeleteVariant')?.addEventListener('click', () => {
    if (deleteVariant(appState.activeVariantId)) {
      syncAllUI();
      notifyVariantSwitched();
    }
  });

  // Réinitialisation locale sécurisée (confirmation en 2 clics)
  let resetArmedTimer = null;
  const resetBtn = document.getElementById('btnResetWorkspace');
  resetBtn?.addEventListener('click', () => {
    if (resetBtn.dataset.armed !== '1') {
      resetBtn.dataset.armed = '1';
      resetBtn.textContent = 'Confirmer ?';
      resetBtn.classList.add('ko');
      clearTimeout(resetArmedTimer);
      resetArmedTimer = setTimeout(() => {
        delete resetBtn.dataset.armed;
        resetBtn.textContent = 'Réinitialiser';
        resetBtn.classList.remove('ko');
      }, 4000);
      return;
    }
    clearTimeout(resetArmedTimer);
    delete resetBtn.dataset.armed;
    resetBtn.textContent = 'Réinitialiser';
    resetBtn.classList.remove('ko');
    resetWorkspaceStorage();
    syncAllUI();
    notifyVariantSwitched();
  });

  // Navigation pied de page pas-à-pas
  document.getElementById('btnStepPrev')?.addEventListener('click', () => {
    const idx = CONFIG_STEPS.indexOf(appState.uiModes.activeStep);
    if (idx > 0) activateConfigStep(CONFIG_STEPS[idx - 1], true);
  });
  document.getElementById('btnStepNext')?.addEventListener('click', () => {
    const idx = CONFIG_STEPS.indexOf(appState.uiModes.activeStep);
    if (idx >= 0 && idx < CONFIG_STEPS.length - 1) activateConfigStep(CONFIG_STEPS[idx + 1], true);
  });
  document.getElementById('btnStepFinish')?.addEventListener('click', () => notifyOpenResults());

  document.getElementById('btnBackToBox3d')?.addEventListener('click', () => {
    appState.uiModes.floorsEditor = 'box3d';
    appState.uiModes.floors = 'box3d';
    syncFloorsEditorButtons();
    activateConfigStep('step-floors', true);
  });

  document.querySelectorAll('[data-floors-editor]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ed = btn.dataset.floorsEditor === 'box3d' ? 'box3d' : 'table';
      appState.uiModes.floorsEditor = ed;
      appState.uiModes.floors = ed === 'box3d' ? 'box3d' : 'advanced';
      syncActiveVariantSnapshot();
      saveWorkspaceToStorage();
      syncFloorsEditorButtons();
      renderFloors();
      requestAnimationFrame(refresh3DViewers);
    });
  });

  document.getElementById('btnOpenBox3dFromSimple')?.addEventListener('click', () => {
    upgradeActiveVariantToAdvanced('box3d');
    applyGlobalLayout(onResultsRefresh, 'step-floors');
    renderVariantBar();
    notifyProjectChanged();
  });

  document.querySelectorAll('.rail-item').forEach(btn => {
    btn.addEventListener('click', () => {
      activateConfigStep(btn.dataset.step, true);
    });
  });

  // Détection générique de toute modification dans Configuration → sauvegarde locale + recalcul live du badge
  const configRoot = document.getElementById('view-config');
  if (configRoot) {
    configRoot.addEventListener('change', e => {
      if (e.target && ['activeOpeningFloor', 'siaTargetFloor', 'quickShadingPreset', 'pvType'].includes(e.target.id)) {
        return;
      }
      notifyProjectChanged();
    });
  }

  document.getElementById('projName').addEventListener('input', e => {
    appState.project.name = e.target.value;
    updateInspector();
    notifyProjectChanged();
  });
  document.getElementById('projMainCategory')?.addEventListener('change', e => {
    if (e.target.value !== 'custom') {
      applyMainCategoryToAllFloors(e.target.value);
      notifyProjectChanged();
    }
  });
  document.getElementById('projectType').addEventListener('change', e => {
    appState.project.projectType = e.target.value;
    syncHeaderRequirementBadge();
    notifyProjectChanged();
  });
  document.getElementById('projFoehn')?.addEventListener('change', e => {
    appState.project.foehnExposed = e.target.checked;
  });
  document.getElementById('climateUHI')?.addEventListener('change', e => {
    appState.project.climate.urbanHeatIsland = e.target.checked;
    syncPvgisUI();
    updateInspector();
  });
  document.getElementById('siaCurveMode').addEventListener('change', e => {
    appState.project.siaCurveMode = e.target.value;
  });
  document.getElementById('stackCoupling').addEventListener('change', e => {
    appState.project.stackCoupling = e.target.checked;
    renderOpenings();
  });
  document.getElementById('projUseFresnel')?.addEventListener('change', e => {
    appState.project.useFresnelIncidence = e.target.checked;
  });

  document.getElementById('projAlbedo')?.addEventListener('change', e => {
    appState.project.albedo = Math.max(0.05, Math.min(0.8, Number(e.target.value) || 0.2));
  });

  document.getElementById('advHorizon')?.addEventListener('change', e => {
    appState.project.horizonDeg = Math.max(0, Math.min(60, parseFloat(e.target.value) || 0));
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
      const gSel = document.getElementById('simpGlazingType');
      if (gSel) delete gSel.dataset.forceCustom;
      const sSel = document.getElementById('simpStoreType');
      if (sSel) delete sSel.dataset.forceCustom;
      renderFloorSelectors();
      renderFloors();
      renderOpenings();
      loadSiaFloorInputs();
      refresh3DViewers();
    });
  });

  [
    'simpPctS',
    'simpPctO',
    'simpPctE',
    'simpPctN',
    'simpPctR',
    'simpGlazingType',
    'simpCustomG',
    'simpCustomU',
    'simpStoreType',
    'simpCustomGStore',
    'simpCustomGtotMode',
    'simpBlindPreset',
    'simpOverhang'
  ].forEach(id => {
    document.getElementById(id)?.addEventListener('change', applySimpleGlazingFromInputs);
  });

  document.getElementById('simpNightPreset')?.addEventListener('change', e => {
    const fl = appState.project.floors.find(f => f.id === appState.activeFloorId);
    if (!fl || e.target.value === 'custom') return;
    applySimpleNightPreset(fl, e.target.value);
    loadSiaFloorInputs();
    updateInspector();
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
      shadingFactor: 1.0,
      blindMode: 'auto',
      blindThreshI: 200,
      blindThreshT: 22.0,
      blindRule: 'irr_and_temp',
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
    const sp = STORE_PRESETS[document.getElementById('quickShadingPreset').value];
    if (!sp) return;
    appState.project.openings.forEach(op => {
      if (op.floorId === appState.activeFloorId) {
        op.gStore = sp.gStore;
        op.gtotMode = sp.gtotMode;
      }
    });
    renderOpenings();
  });

  document.getElementById('siaCategorySelect').addEventListener('change', e =>
    applySiaCatToCurrentFloor(e.target.value)
  );
  document.getElementById('inInternalProfileMode')?.addEventListener('change', e => {
    const fl = appState.project.floors.find(f => f.id === appState.activeFloorId);
    if (!fl) return;
    fl.internalProfileMode = e.target.value;
  });
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
      }
      if (customFlag) {
        fl.siaCategory = 'custom';
        document.getElementById('siaCategorySelect').value = 'custom';
        updateSiaCatChips(fl);
      }
      if (['nightVentMode', 'nightVentFixedVal', 'nightStart', 'nightEnd'].includes(prop)) {
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

  document.getElementById('inNightFreeCool24h')?.addEventListener('change', e => {
    const fl = appState.project.floors.find(f => f.id === appState.activeFloorId);
    if (!fl) return;
    if (e.target.checked) {
      fl.nightStart = 0;
      fl.nightEnd = 24;
    } else {
      fl.nightStart = 21;
      fl.nightEnd = 7;
    }
    document.getElementById('inNightStart').value = fl.nightStart;
    document.getElementById('inNightEnd').value = fl.nightEnd;
    updateNightVentUI(fl);
  });

  ['inNightSimpleBasis', 'inNightSimplePct', 'inNightSimpleEff', 'inNightSimpleCross'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      const fl = appState.project.floors.find(f => f.id === appState.activeFloorId);
      if (!fl) return;
      fl.nightSimpleBasis = document.getElementById('inNightSimpleBasis')?.value || 'floor_pct';
      fl.nightSimplePct = Math.max(0, Math.min(100, parseFloat(document.getElementById('inNightSimplePct')?.value) || 0));
      fl.nightSimpleEff = parseFloat(document.getElementById('inNightSimpleEff')?.value) || 0.6;
      fl.nightSimpleCross = Boolean(document.getElementById('inNightSimpleCross')?.checked);
      updateNightVentUI(fl);
      updateInspector();
    });
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
      syncPvgisUI();
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
  const resetToSyntheticWeather = () => {
    appState.customWeather = null;
    const wIn = document.getElementById('weatherFileInput');
    if (wIn) wIn.value = '';
    syncPvgisUI();
    updateInspector();
  };
  document.getElementById('btnResetWeather').addEventListener('click', resetToSyntheticWeather);
  document.getElementById('btnResetWeatherQuick')?.addEventListener('click', resetToSyntheticWeather);

  const runLiveWeatherFetch = async (provider, btnId, label) => {
    const badge = document.getElementById('weatherStatusBadge');
    const btn = document.getElementById(btnId);
    const oldTxt = btn ? btn.textContent : '';
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = `Chargement ${label}…`;
      }
      badge.textContent = `Téléchargement ${label} en cours…`;
      badge.className = 'pill warn';
      const pvType = document.getElementById('pvType')?.value || 'tmy';
      const weatherObj = await fetchLiveWeatherData(provider, appState.project.climate, {
        year: pvType
      });
      appState.customWeather = weatherObj;
      syncPvgisUI();
      updateInspector();
      if (onRunSimulation) onRunSimulation();
    } catch (err) {
      badge.textContent = `Erreur ${label} : ${err.message}`;
      badge.className = 'pill ko';
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = oldTxt;
      }
    }
  };

  document.getElementById('btnFetchMeteoSwiss')?.addEventListener('click', () =>
    runLiveWeatherFetch('meteoswiss', 'btnFetchMeteoSwiss', 'MétéoSuisse OGD')
  );
  document.getElementById('btnFetchOpenMeteo')?.addEventListener('click', () =>
    runLiveWeatherFetch('openmeteo', 'btnFetchOpenMeteo', 'Open-Meteo ERA5')
  );
  document.getElementById('btnFetchPvgis')?.addEventListener('click', () =>
    runLiveWeatherFetch('pvgis', 'btnFetchPvgis', 'PVGIS 5.3')
  );

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
