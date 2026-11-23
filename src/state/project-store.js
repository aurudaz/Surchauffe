/**
 * @fileoverview Gestion centralisée de l'état de l'application (projet actif, modes Simple/Avancé,
 * météo importée, paramètres de confort thermique, résultats).
 */

import { COMFORT_DEFAULTS } from '../standards/comfort-references.js';
import { createHouseLibrary } from './house-library.js';

export const HOUSE_LIBRARY = createHouseLibrary();

export const appState = {
  project: HOUSE_LIBRARY[0].build(),
  activeFloorId: null,
  customWeather: null,
  lastResults: null,
  uiModes: {
    global: 'simple',
    floorsEditor: 'table',
    activeStep: 'simple-1',
    house: 'simple',
    floors: 'simple',
    openings: 'simple',
    sia: 'simple',
    climate: 'simple',
    results: 'simple'
  },
  comfortParams: { ...COMFORT_DEFAULTS }
};

appState.activeFloorId = appState.project.floors[0].id;

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
