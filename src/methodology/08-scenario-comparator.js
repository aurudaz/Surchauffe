/**
 * @fileoverview Étape 08 — Orchestrateur de simulation et comparateur multi-scénarios
 * (Actuel, Stores oubliés, Fenêtres fermées la nuit, Double oubli, Optimal, Climat 2035 Minergie, Climat 2050).
 */

import { applyClimateDelta, generateSyntheticWeather } from './02-weather-model.js';
import { executeEngine } from './05-thermal-5r1c-engine.js';
import { enrichWithSIA180 } from './06-sia180-compliance.js';
import { evaluateThermalComfort } from './07-thermal-comfort.js';

/**
 * Exécute la simulation complète du projet + les variantes de sensibilité (comportement & climat).
 *
 * @param {object} project Projet complet
 * @param {object|null} customWeather Données météo importées (ou null pour station synthétique)
 * @param {object} [comfortUserParams] Paramètres Fanger (clo, met, airSpeed, rh)
 */
export function runFullSimulation(project, customWeather = null, comfortUserParams = {}) {
  const uhi = Boolean(project.climate?.urbanHeatIsland);
  const weatherObj = customWeather
    ? uhi
      ? applyClimateDelta(customWeather, 'REF', true)
      : customWeather
    : generateSyntheticWeather(project.climate.station, project.climate.scenario, uhi);

  const baseRaw = executeEngine(project, weatherObj.data, true, true);

  // Évaluation Minergie 2035 (DRY 2035 + UHI si actif)
  let raw2035 = baseRaw;
  if (customWeather || project.climate.scenario !== '2035') {
    const weather2035 = customWeather
      ? applyClimateDelta(customWeather, '2035', uhi)
      : generateSyntheticWeather(project.climate.station, '2035', uhi);
    raw2035 = executeEngine(project, weather2035.data, false, false);
  }

  const base = enrichWithSIA180(baseRaw, project.projectType, project, raw2035);
  const r2035 = enrichWithSIA180(raw2035, project.projectType);

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

  const pNoBlinds = clone(project);
  pNoBlinds.openings.forEach(o => {
    o.blindMode = 'always_up';
  });

  const pNoNight = clone(project);
  pNoNight.floors.forEach(f => {
    f.nightVentMode = 'none';
  });

  const pBad = clone(project);
  pBad.openings.forEach(o => {
    o.blindMode = 'always_up';
  });
  pBad.floors.forEach(f => {
    f.nightVentMode = 'none';
  });

  const rOpt = enrichWithSIA180(executeEngine(pOpt, weatherObj.data, false, false), project.projectType);
  const rNoBlinds = enrichWithSIA180(executeEngine(pNoBlinds, weatherObj.data, false, false), project.projectType);
  const rNoNight = enrichWithSIA180(executeEngine(pNoNight, weatherObj.data, false, false), project.projectType);
  const rBad = enrichWithSIA180(executeEngine(pBad, weatherObj.data, false, false), project.projectType);

  const weather2050 = customWeather
    ? applyClimateDelta(customWeather, '2050', uhi)
    : generateSyntheticWeather(project.climate.station, '2050', uhi);
  const r2050 = enrichWithSIA180(
    executeEngine(project, weather2050.data, false, false),
    project.projectType
  );

  const variants = [
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
  ];

  const behavioralScenarios = [
    {
      id: 'current',
      label: 'Votre configuration actuelle',
      shortLabel: 'Actuel',
      wf: base.worstFloor,
      note: 'Réglages actuels du bâtiment'
    },
    {
      id: 'no_blinds',
      label: 'Si les stores restent ouverts',
      shortLabel: 'Sans stores',
      wf: rNoBlinds.worstFloor,
      note: 'Stores non fermés le jour (ventilation nocturne inchangée)'
    },
    {
      id: 'no_night',
      label: 'Si les fenêtres restent fermées la nuit',
      shortLabel: 'Sans aération nuit',
      wf: rNoNight.worstFloor,
      note: 'Aucune ventilation nocturne (stores inchangés)'
    },
    {
      id: 'both_bad',
      label: 'Double oubli (stores ouverts + nuit fermée)',
      shortLabel: 'Double oubli',
      wf: rBad.worstFloor,
      note: 'Ni protection solaire mobile, ni rafraîchissement nocturne'
    },
    {
      id: 'optimal',
      label: 'Bonnes pratiques optimales',
      shortLabel: 'Optimal',
      wf: rOpt.worstFloor,
      note: 'Stores automatisés performants + aération nocturne efficace'
    },
    {
      id: 'climate_2035',
      label: 'Projection Minergie 2035',
      shortLabel: 'Climat 2035',
      wf: r2035.worstFloor,
      note: `Horizon climatique 2035${uhi ? ' + îlot de chaleur urbain' : ''}`
    },
    {
      id: 'climate_2050',
      label: 'Projection climat 2050 (+1.5 °C)',
      shortLabel: 'Climat 2050',
      wf: r2050.worstFloor,
      note: `Climat futur 2050${uhi ? ' + îlot de chaleur urbain' : ''}`
    }
  ];

  return {
    weatherLabel: weatherObj.sourceLabel,
    ...base,
    variants,
    behavioralScenarios
  };
}
