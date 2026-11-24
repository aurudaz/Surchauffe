/**
 * @fileoverview Gestion centralisée de l'état de l'application :
 *  - Multi-variantes de projet (style Lesosai : dupliquer, basculer, renommer, supprimer, comparer)
 *  - Mode de saisie strict par variante ('simple' avec passage irréversible vers 'advanced')
 *  - Persistance locale automatique (localStorage) + réinitialisation sécurisée
 */

import { COMFORT_DEFAULTS } from '../standards/comfort-references.js';
import { createHouseLibrary, ensureFloorDefaults } from './house-library.js';

export const HOUSE_LIBRARY = createHouseLibrary();
export const STORAGE_KEY = 'sia_thermic_studio_workspace_v2';

function cloneDeep(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function makeDefaultVariant(id = 'var_1', name = 'Variante 1 — Base', inputMode = 'simple', floorsEditor = 'table', templateIdx = 0) {
  const proj = HOUSE_LIBRARY[templateIdx]?.build() || HOUSE_LIBRARY[0].build();
  return {
    id,
    name,
    inputMode: inputMode === 'advanced' ? 'advanced' : 'simple',
    floorsEditor: floorsEditor === 'box3d' ? 'box3d' : 'table',
    project: proj,
    customWeather: null,
    activeFloorId: proj.floors[0].id
  };
}

function hydrateProjectFloors(proj) {
  if (!proj || !Array.isArray(proj.floors) || proj.floors.length === 0) return false;
  proj.floors.forEach((fl, idx) => ensureFloorDefaults(fl, idx, proj.floors.length));
  if (!Array.isArray(proj.openings)) proj.openings = [];
  if (!proj.climate) {
    proj.climate = { station: 'SIO', scenario: 'REF', lat: 46.22, lon: 7.33, tzMode: 'cet_cest', urbanHeatIsland: false };
  }
  return true;
}

const initialVariant = makeDefaultVariant();

export const appState = {
  variants: [initialVariant],
  activeVariantId: initialVariant.id,
  compareVariantIds: [initialVariant.id],
  project: initialVariant.project,
  activeFloorId: initialVariant.activeFloorId,
  customWeather: null,
  lastResults: null,
  resultsStale: true,
  theme: 'dark',
  uiModes: {
    global: initialVariant.inputMode,
    floorsEditor: initialVariant.floorsEditor,
    activeStep: 'step-house',
    house: initialVariant.inputMode,
    floors: initialVariant.inputMode,
    openings: initialVariant.inputMode,
    sia: initialVariant.inputMode,
    climate: initialVariant.inputMode,
    results: 'simple'
  },
  comfortParams: { ...COMFORT_DEFAULTS }
};

export function getActiveVariant() {
  return appState.variants.find(v => v.id === appState.activeVariantId) || appState.variants[0];
}

/**
 * Synchronise l'objet projet actif vers la variante active.
 */
export function syncActiveVariantSnapshot() {
  const v = getActiveVariant();
  if (!v) return;
  v.project = appState.project;
  v.customWeather = appState.customWeather;
  v.activeFloorId = appState.activeFloorId;
  v.inputMode = appState.uiModes.global === 'advanced' ? 'advanced' : 'simple';
  v.floorsEditor = appState.uiModes.floorsEditor === 'box3d' ? 'box3d' : 'table';
}

function applyVariantToAppState(v) {
  appState.activeVariantId = v.id;
  appState.project = v.project;
  appState.customWeather = v.customWeather || null;
  appState.activeFloorId =
    v.activeFloorId && v.project.floors.some(f => f.id === v.activeFloorId)
      ? v.activeFloorId
      : v.project.floors[0].id;
  const mode = v.inputMode === 'advanced' ? 'advanced' : 'simple';
  const ed = v.floorsEditor === 'box3d' ? 'box3d' : 'table';
  appState.uiModes.global = mode;
  appState.uiModes.floorsEditor = ed;
  appState.uiModes.house = mode;
  appState.uiModes.openings = mode;
  appState.uiModes.sia = mode;
  appState.uiModes.climate = mode;
  appState.uiModes.floors = mode === 'advanced' ? (ed === 'box3d' ? 'box3d' : 'advanced') : 'simple';
  appState.lastResults = null;
  appState.resultsStale = true;
}

export function switchVariant(variantId) {
  syncActiveVariantSnapshot();
  const target = appState.variants.find(v => v.id === variantId);
  if (!target) return null;
  applyVariantToAppState(target);
  saveWorkspaceToStorage();
  return target;
}

export function duplicateActiveVariant(customName = null) {
  syncActiveVariantSnapshot();
  const cur = getActiveVariant();
  const nextNum = appState.variants.length + 1;
  const baseLabel = cur.name.replace(/^Variante\s+\d+\s*[—-]\s*/i, '').trim() || 'Base';
  const newId = `var_${Date.now()}_${nextNum}`;
  const copy = {
    id: newId,
    name: customName || `Variante ${nextNum} — ${baseLabel} (copie)`,
    inputMode: cur.inputMode,
    floorsEditor: cur.floorsEditor,
    project: cloneDeep(cur.project),
    customWeather: cur.customWeather ? cloneDeep(cur.customWeather) : null,
    activeFloorId: cur.activeFloorId
  };
  appState.variants.push(copy);
  if (!appState.compareVariantIds.includes(newId)) {
    appState.compareVariantIds.push(newId);
  }
  applyVariantToAppState(copy);
  saveWorkspaceToStorage();
  return copy;
}

export function createNewVariant({ inputMode = 'simple', floorsEditor = 'table', templateIdx = 0, name = null } = {}) {
  syncActiveVariantSnapshot();
  const nextNum = appState.variants.length + 1;
  const newId = `var_${Date.now()}_${nextNum}`;
  const v = makeDefaultVariant(
    newId,
    name || `Variante ${nextNum} — ${inputMode === 'advanced' ? 'Avancé' : 'Simple'}`,
    inputMode,
    floorsEditor,
    templateIdx
  );
  appState.variants.push(v);
  if (!appState.compareVariantIds.includes(newId)) {
    appState.compareVariantIds.push(newId);
  }
  applyVariantToAppState(v);
  saveWorkspaceToStorage();
  return v;
}

export function renameVariant(variantId, newName) {
  const v = appState.variants.find(x => x.id === variantId);
  if (!v) return false;
  const clean = String(newName || '').trim();
  if (!clean) return false;
  v.name = clean.slice(0, 48);
  saveWorkspaceToStorage();
  return true;
}

export function deleteVariant(variantId) {
  if (appState.variants.length <= 1) return false;
  const idx = appState.variants.findIndex(v => v.id === variantId);
  if (idx < 0) return false;
  appState.variants.splice(idx, 1);
  appState.compareVariantIds = appState.compareVariantIds.filter(id => id !== variantId);
  if (appState.activeVariantId === variantId) {
    const next = appState.variants[Math.max(0, idx - 1)] || appState.variants[0];
    applyVariantToAppState(next);
  }
  if (appState.compareVariantIds.length === 0 && appState.variants.length > 0) {
    appState.compareVariantIds = [appState.activeVariantId];
  }
  saveWorkspaceToStorage();
  return true;
}

/**
 * Passage strict à sens unique Simple → Avancé pour la variante active.
 * Empêche un retour accidentel vers Simple qui écraserait les détails 3D ou fenêtre par fenêtre.
 */
export function upgradeActiveVariantToAdvanced(floorsEditor = null) {
  const v = getActiveVariant();
  if (!v) return;
  v.inputMode = 'advanced';
  if (floorsEditor === 'box3d' || floorsEditor === 'table') {
    v.floorsEditor = floorsEditor;
  }
  appState.uiModes.global = 'advanced';
  appState.uiModes.floorsEditor = v.floorsEditor;
  appState.uiModes.house = 'advanced';
  appState.uiModes.openings = 'advanced';
  appState.uiModes.sia = 'advanced';
  appState.uiModes.climate = 'advanced';
  appState.uiModes.floors = v.floorsEditor === 'box3d' ? 'box3d' : 'advanced';
  saveWorkspaceToStorage();
}

export function replaceActiveVariantProject(proj, { inputMode = null, floorsEditor = null, customWeather = null } = {}) {
  const v = getActiveVariant();
  if (!v) return;
  hydrateProjectFloors(proj);
  v.project = proj;
  v.customWeather = customWeather;
  v.activeFloorId = proj.floors[0].id;
  if (inputMode === 'simple' || inputMode === 'advanced') {
    v.inputMode = inputMode;
  }
  if (floorsEditor === 'table' || floorsEditor === 'box3d') {
    v.floorsEditor = floorsEditor;
  }
  applyVariantToAppState(v);
  saveWorkspaceToStorage();
}

export function saveWorkspaceToStorage() {
  if (typeof localStorage === 'undefined') return false;
  syncActiveVariantSnapshot();
  const payload = {
    version: 2,
    savedAt: Date.now(),
    theme: appState.theme,
    activeVariantId: appState.activeVariantId,
    compareVariantIds: appState.compareVariantIds,
    activeStep: appState.uiModes.activeStep,
    comfortParams: appState.comfortParams,
    variants: appState.variants.map(v => ({
      id: v.id,
      name: v.name,
      inputMode: v.inputMode,
      floorsEditor: v.floorsEditor,
      activeFloorId: v.activeFloorId,
      project: v.project,
      // On garde la météo importée tant qu'elle tient dans le quota localStorage
      customWeather: v.customWeather || null
    }))
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    // Repli gracieux si un fichier météo 8760h dépasse le quota : on sauvegarde les projets sans la météo brute
    try {
      payload.variants = payload.variants.map(v => ({ ...v, customWeather: null }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }
}

export function loadWorkspaceFromStorage() {
  if (typeof localStorage === 'undefined') return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.variants) || parsed.variants.length === 0) return false;

    const validVariants = parsed.variants
      .filter(v => v && v.id && hydrateProjectFloors(v.project))
      .map((v, idx) => ({
        id: String(v.id),
        name: String(v.name || `Variante ${idx + 1}`),
        inputMode: v.inputMode === 'advanced' ? 'advanced' : 'simple',
        floorsEditor: v.floorsEditor === 'box3d' ? 'box3d' : 'table',
        project: v.project,
        customWeather: v.customWeather && Array.isArray(v.customWeather.data) ? v.customWeather : null,
        activeFloorId: v.activeFloorId || v.project.floors[0].id
      }));

    if (validVariants.length === 0) return false;

    appState.variants = validVariants;
    const activeV = validVariants.find(v => v.id === parsed.activeVariantId) || validVariants[0];
    appState.compareVariantIds = Array.isArray(parsed.compareVariantIds)
      ? parsed.compareVariantIds.filter(id => validVariants.some(v => v.id === id))
      : validVariants.map(v => v.id);
    if (appState.compareVariantIds.length === 0) {
      appState.compareVariantIds = [activeV.id];
    }
    if (parsed.theme === 'light' || parsed.theme === 'dark') {
      appState.theme = parsed.theme;
    }
    if (parsed.comfortParams && typeof parsed.comfortParams === 'object') {
      appState.comfortParams = { ...COMFORT_DEFAULTS, ...parsed.comfortParams };
    }
    if (parsed.activeStep) {
      appState.uiModes.activeStep = parsed.activeStep;
    }
    applyVariantToAppState(activeV);
    return true;
  } catch {
    return false;
  }
}

export function resetWorkspaceStorage() {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  const fresh = makeDefaultVariant();
  appState.variants = [fresh];
  appState.activeVariantId = fresh.id;
  appState.compareVariantIds = [fresh.id];
  appState.comfortParams = { ...COMFORT_DEFAULTS };
  appState.uiModes.activeStep = 'step-house';
  applyVariantToAppState(fresh);
}

/**
 * Échappe les caractères spéciaux HTML pour éviter toute cassure DOM ou injection.
 */
export function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
