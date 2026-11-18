/**
 * @fileoverview Étape 08 — Orchestrateur de simulation et comparateur multi-scénarios
 * (Actuel vs Passif optimisé vs Comportement dégradé vs Climat 2050).
 */

import { applyClimateDelta, generateSyntheticWeather } from './02-weather-model.js';
import { executeEngine } from './05-thermal-5r1c-engine.js';
import { enrichWithSIA180 } from './06-sia180-compliance.js';
import { evaluateThermalComfort } from './07-thermal-comfort.js';

/**
 * Exécute la simulation complète du projet + 3 variantes de sensibilité.
 *
 * @param {object} project Projet complet
 * @param {object|null} customWeather Données météo importées (ou null pour station synthétique)
 * @param {object} [comfortUserParams] Paramètres Fanger (clo, met, airSpeed, rh)
 */
export function runFullSimulation(project, customWeather = null, comfortUserParams = {}) {
  const weatherObj =
    customWeather || generateSyntheticWeather(project.climate.station, project.climate.scenario);

  const baseRaw = executeEngine(project, weatherObj.data, true, true);
  const base = enrichWithSIA180(baseRaw, project.projectType);

  // Calcul du confort thermique pour chaque étage
  base.floorResults = base.floorResults.map(fr => ({
    ...fr,
    comfort: evaluateThermalComfort(fr.series, comfortUserParams)
  }));
  base.worstFloor =
    base.floorResults.find(fr => fr.floor.id === base.worstFloor.floor.id) || base.floorResults[0];

  // Variantes rapides (sans séries 8760h ni passe froid fictif)
  const clone = obj => JSON.parse(JSON.stringify(obj));

  const pOpt = clone(project);
  pOpt.openings.forEach(o => {
    o.blindMode = 'auto';
    o.gStore = Math.min(o.gStore, 0.10);
    o.gtotMode = 'product';
    o.operable = true;
    if (o.openType === 'imposte') o.alphaDeg = Math.max(o.alphaDeg, 35);
  });
  pOpt.floors.forEach(f => {
    if (f.nightVentMode === 'none') {
      f.nightVentMode = 'simple_pct';
      f.nightSimpleBasis = 'floor_pct';
      f.nightSimplePct = 5.0;
      f.nightSimpleEff = 1.0;
    } else if (f.nightVentMode === 'simple_pct') {
      f.nightSimplePct = Math.max(f.nightSimplePct || 0, 5.0);
      f.nightSimpleEff = 1.0;
    }
  });

  const pBad = clone(project);
  pBad.openings.forEach(o => {
    o.blindMode = 'always_up';
  });
  pBad.floors.forEach(f => {
    f.nightVentMode = 'none';
  });

  const rOpt = enrichWithSIA180(executeEngine(pOpt, weatherObj.data, false, false), project.projectType);
  const rBad = enrichWithSIA180(executeEngine(pBad, weatherObj.data, false, false), project.projectType);

  const weather2050 = customWeather
    ? applyClimateDelta(customWeather, '2050')
    : generateSyntheticWeather(project.climate.station, '2050');
  const r2050 = enrichWithSIA180(
    executeEngine(project, weather2050.data, false, false),
    project.projectType
  );

  return {
    weatherLabel: weatherObj.sourceLabel,
    ...base,
    variants: [
      {
        label: 'Configuration actuelle',
        wf: base.worstFloor,
        note: 'Vos paramètres saisis'
      },
      {
        label: 'Optimisation passive (stores + nuit)',
        wf: rOpt.worstFloor,
        note: 'Stores auto g_store ≤ 0.10 + ventilation nocturne active'
      },
      {
        label: 'Comportement dégradé (stores/nuit oubliés)',
        wf: rBad.worstFloor,
        note: 'Stores toujours levés + aucune ventilation nocturne'
      },
      {
        label: 'Résilience climat 2050 (+1.5 °C)',
        wf: r2050.worstFloor,
        note: customWeather
          ? 'Même bâtiment sous votre météo importée décalée (+1.5 °C)'
          : 'Même bâtiment sous climat projeté 2050'
      }
    ]
  };
}
