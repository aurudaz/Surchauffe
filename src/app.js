/**
 * @fileoverview Point d'entrée principal de SIA Thermic Studio.
 * Initialise la bibliothèque de bâtiments, les gestionnaires d'événements et la première simulation.
 */

import { runFullSimulation } from './methodology/08-scenario-comparator.js';
import { appState } from './state/project-store.js';
import {
  bindConfigEvents,
  refresh3DViewers,
  renderLibrary,
  syncAllUI,
  updateInspector
} from './ui/config-view.js';
import { bindResultsEvents, renderResultsView } from './ui/results-view.js';

function runSimulation() {
  const res = runFullSimulation(appState.project, appState.customWeather, appState.comfortParams);
  appState.lastResults = res;

  const badge = document.getElementById('navBadgeHours');
  badge.textContent = `${res.worstFloor.overSIA} h/an`;
  badge.className = `pill ${res.worstFloor.overSIA <= res.limHours ? 'ok' : 'ko'}`;
  updateInspector();
  return res;
}

function refreshResults() {
  renderResultsView(runSimulation);
}

function setMode(mode) {
  const isRes = mode === 'results';
  document.getElementById('view-config').classList.toggle('hidden', isRes);
  document.getElementById('view-results').classList.toggle('hidden', !isRes);
  document.getElementById('btnModeConfig').classList.toggle('active', !isRes);
  document.getElementById('btnModeResults').classList.toggle('active', isRes);
  if (isRes) {
    runSimulation();
    refreshResults();
  }
}

document.getElementById('btnModeConfig').addEventListener('click', () => setMode('config'));
document.getElementById('btnModeResults').addEventListener('click', () => setMode('results'));
document.getElementById('btnRunTop').addEventListener('click', () => setMode('results'));
document.getElementById('btnRunInspector').addEventListener('click', () => setMode('results'));

document.getElementById('btnThemeToggle').addEventListener('click', () => {
  document.documentElement.dataset.theme =
    document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  if (!document.getElementById('view-results').classList.contains('hidden')) {
    refreshResults();
  }
});

window.addEventListener('resize', () => {
  if (!document.getElementById('view-results').classList.contains('hidden')) {
    refreshResults();
  } else {
    refresh3DViewers();
  }
});

bindConfigEvents({
  onRunSimulation: runSimulation,
  onResultsRefresh: refreshResults
});

bindResultsEvents({
  onEnsureSimulation: runSimulation,
  onRenderResults: refreshResults
});

renderLibrary(runSimulation);
syncAllUI(refreshResults);
runSimulation();
