/**
 * @fileoverview Point d'entrée principal de SIA Thermic Studio.
 * Initialise la persistance locale, les variantes, les infobulles au survol,
 * la mise à jour automatique du badge Résultats et les événements principaux.
 */

import { applyClimateDelta, generateSyntheticWeather } from './methodology/02-weather-model.js';
import { executeEngine } from './methodology/05-thermal-5r1c-engine.js';
import { enrichWithSIA180 } from './methodology/06-sia180-compliance.js';
import { runFullSimulation } from './methodology/08-scenario-comparator.js';
import {
  appState,
  loadWorkspaceFromStorage,
  saveWorkspaceToStorage
} from './state/project-store.js';
import {
  bindConfigEvents,
  flashSaveIndicator,
  refresh3DViewers,
  renderLibrary,
  renderVariantBar,
  syncAllUI,
  updateInspector
} from './ui/config-view.js';
import { bindResultsEvents, renderResultsView } from './ui/results-view.js';

let liveSimTimer = null;

function initHoverTooltips() {
  const tipEl = document.getElementById('chartTooltip');
  if (!tipEl || typeof document.addEventListener !== 'function') return;

  let activeTipNode = null;

  const placeTip = e => {
    const pad = 14;
    const maxW = 325;
    const x = Math.min(window.innerWidth - maxW, Math.max(8, e.clientX + pad));
    const y = Math.min(window.innerHeight - 80, Math.max(8, e.clientY + pad));
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${y}px`;
  };

  document.addEventListener('pointerover', e => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (
      t.tagName === 'CANVAS' &&
      (t.id === 'chartTime' || t.id === 'chartSimpleHeatwave' || t.id === 'chartVariantsCompare')
    ) {
      return;
    }

    const host = t.closest('[data-tip], [title]');
    if (!host) {
      if (activeTipNode) {
        activeTipNode = null;
        tipEl.style.display = 'none';
      }
      return;
    }

    if (!host.dataset.tip && host.getAttribute('title')) {
      host.dataset.tip = host.getAttribute('title');
      host.removeAttribute('title');
    }

    const txt = host.dataset.tip;
    if (!txt) return;

    activeTipNode = host;
    tipEl.textContent = txt;
    tipEl.style.display = 'block';
    placeTip(e);
  });

  document.addEventListener('pointermove', e => {
    if (!activeTipNode) return;
    placeTip(e);
  });

  document.addEventListener('pointerout', e => {
    if (!activeTipNode) return;
    const rel = e.relatedTarget;
    if (rel && typeof rel.closest === 'function' && rel.closest('[data-tip]') === activeTipNode) {
      return;
    }
    activeTipNode = null;
    tipEl.style.display = 'none';
  });

  document.addEventListener('pointerdown', () => {
    activeTipNode = null;
    tipEl.style.display = 'none';
  });

  document.addEventListener('focusin', e => {
    if (e.target && e.target.tagName === 'SELECT') {
      activeTipNode = null;
      tipEl.style.display = 'none';
    }
  });
}

function updateNavBadge(hrs, limHours) {
  const badge = document.getElementById('navBadgeHours');
  if (!badge) return;
  badge.textContent = `${hrs} h/an`;
  badge.className = `pill ${hrs <= limHours ? 'ok' : 'ko'}`;
}

/**
 * Passe rapide (1 seul calcul 5R1C sans séries ni scénarios) pour garder le badge
 * "Résultats" toujours synchronisé en temps réel pendant la configuration (~50 ms).
 */
function runFastBadgeSimulation() {
  const { project, customWeather } = appState;
  const uhi = Boolean(project.climate?.urbanHeatIsland);
  const weatherObj = customWeather
    ? uhi
      ? applyClimateDelta(customWeather, 'REF', true)
      : customWeather
    : generateSyntheticWeather(project.climate.station, project.climate.scenario, uhi);
  const raw = executeEngine(project, weatherObj.data, false, false);
  const quick = enrichWithSIA180(raw, project.projectType);
  const isMinergie = project.projectType === 'minergie';
  const hrs = isMinergie ? quick.worstFloor.overMinergie265 : quick.worstFloor.overSIA;
  updateNavBadge(hrs, quick.limHours);
}

function scheduleLiveBadgeUpdate(delayMs = 280) {
  appState.resultsStale = true;
  const badge = document.getElementById('navBadgeHours');
  if (badge && delayMs > 0) {
    badge.textContent = '…';
    badge.className = 'pill warn';
  }
  clearTimeout(liveSimTimer);
  liveSimTimer = setTimeout(() => {
    try {
      runFastBadgeSimulation();
    } catch {
      // ignore erreur transitoire pendant saisie incomplète
    }
  }, delayMs);
}

function runSimulation() {
  clearTimeout(liveSimTimer);
  const res = runFullSimulation(appState.project, appState.customWeather, appState.comfortParams);
  appState.lastResults = res;
  appState.resultsStale = false;

  const isMinergie = appState.project.projectType === 'minergie';
  const hrs = isMinergie ? res.worstFloor.overMinergie265 : res.worstFloor.overSIA;
  updateNavBadge(hrs, res.limHours);
  updateInspector();
  return res;
}

function refreshResults() {
  renderResultsView(runSimulation);
}

function isResultsVisible() {
  return !document.getElementById('view-results').classList.contains('hidden');
}

function setMode(mode) {
  const isRes = mode === 'results';
  document.getElementById('view-config').classList.toggle('hidden', isRes);
  document.getElementById('view-results').classList.toggle('hidden', !isRes);
  document.getElementById('btnModeConfig').classList.toggle('active', !isRes);
  document.getElementById('btnModeResults').classList.toggle('active', isRes);
  if (isRes) {
    appState.resultsTab = 'report';
    if (appState.resultsStale || !appState.lastResults) {
      runSimulation();
    }
    refreshResults();
  } else {
    requestAnimationFrame(refresh3DViewers);
  }
}

function handleProjectChanged() {
  const ok = saveWorkspaceToStorage();
  flashSaveIndicator(ok ? 'Sauvegardé' : 'Local plein');
  scheduleLiveBadgeUpdate(280);
}

function handleVariantSwitched() {
  renderVariantBar();
  if (isResultsVisible()) {
    appState.resultsTab = 'report';
    runSimulation();
    refreshResults();
  } else {
    scheduleLiveBadgeUpdate(30);
  }
}

document.getElementById('btnModeConfig').addEventListener('click', () => setMode('config'));
document.getElementById('btnModeResults').addEventListener('click', () => setMode('results'));
document.getElementById('btnRunInspector').addEventListener('click', () => setMode('results'));

document.getElementById('btnThemeToggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  appState.theme = next;
  saveWorkspaceToStorage();
  if (isResultsVisible()) {
    refreshResults();
  } else {
    refresh3DViewers();
  }
});

window.addEventListener('resize', () => {
  if (isResultsVisible()) {
    refreshResults();
  } else {
    refresh3DViewers();
  }
});

// Restauration automatique de l'espace de travail local (variantes + thème)
loadWorkspaceFromStorage();
document.documentElement.dataset.theme = appState.theme || 'dark';

initHoverTooltips();

bindConfigEvents({
  onRunSimulation: runSimulation,
  onResultsRefresh: refreshResults,
  onProjectChanged: handleProjectChanged,
  onVariantSwitched: handleVariantSwitched,
  onOpenResults: () => setMode('results')
});

bindResultsEvents({
  onEnsureSimulation: runSimulation,
  onRenderResults: refreshResults,
  onVariantChanged: () => {
    syncAllUI(refreshResults);
    runSimulation();
    refreshResults();
  },
  onDuplicateToConfig: () => {
    syncAllUI(refreshResults);
    setMode('config');
    scheduleLiveBadgeUpdate(30);
  }
});

renderLibrary(() => {
  saveWorkspaceToStorage();
  scheduleLiveBadgeUpdate(20);
});
syncAllUI(refreshResults);
runFastBadgeSimulation();
