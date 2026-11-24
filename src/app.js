/**
 * @fileoverview Point d'entrée principal de SIA Thermic Studio.
 * Initialise la bibliothèque de bâtiments, les infobulles au survol, les gestionnaires d'événements et la première simulation.
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
    if (t.tagName === 'CANVAS' && (t.id === 'chartTime' || t.id === 'chartSimpleHeatwave')) return;

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

function runSimulation() {
  const res = runFullSimulation(appState.project, appState.customWeather, appState.comfortParams);
  appState.lastResults = res;

  const badge = document.getElementById('navBadgeHours');
  const isMinergie = appState.project.projectType === 'minergie';
  const hrs = isMinergie ? res.worstFloor.overMinergie265 : res.worstFloor.overSIA;
  badge.textContent = `${hrs} h/an`;
  badge.className = `pill ${hrs <= res.limHours ? 'ok' : 'ko'}`;
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
  document.getElementById('btnRunTop')?.classList.toggle('hidden', isRes);
  if (isRes) {
    runSimulation();
    refreshResults();
  } else {
    requestAnimationFrame(refresh3DViewers);
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
  } else {
    refresh3DViewers();
  }
});

window.addEventListener('resize', () => {
  if (!document.getElementById('view-results').classList.contains('hidden')) {
    refreshResults();
  } else {
    refresh3DViewers();
  }
});

initHoverTooltips();

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
