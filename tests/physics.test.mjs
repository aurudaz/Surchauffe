import test from 'node:test';
import assert from 'node:assert/strict';

import {
  erbsDiffuseFraction,
  glazingIncidenceModifier,
  incidentIrradiance,
  solarPosition,
  splitGlobalToComponents
} from '../src/methodology/01-solar-geometry.js';
import {
  applyClimateDelta,
  buildOpenMeteoArchiveUrl,
  generateManualDesignDayWeather,
  generateSyntheticWeather,
  parseAnyWeatherText,
  summarizeWeatherData
} from '../src/methodology/02-weather-model.js';
import {
  applyBox3dToFloor,
  buildFloorThermalParams,
  computeAutoEnvelopeFromFloor,
  computeHourlyInternalGains,
  computeHourlyInternalGainsBreakdown,
  computeHourlySolarGains,
  syncOpeningBackToBox3d
} from '../src/methodology/03-envelope-and-gains.js';
import {
  calcOpeningFlowM3s,
  calcSimplePctNightFlowM3s,
  ckImposte
} from '../src/methodology/04-natural-ventilation.js';
import { executeEngine, step5R1C } from '../src/methodology/05-thermal-5r1c-engine.js';
import {
  evaluateSIA180PrescriptiveMethods
} from '../src/methodology/06-sia180-compliance.js';
import {
  calculateFangerPMV,
  calculateSeppanenProductivityPct,
  evaluateThermalComfort
} from '../src/methodology/07-thermal-comfort.js';
import { runFullSimulation } from '../src/methodology/08-scenario-comparator.js';
import { getProjectComfortLimits, getSIA180Limits } from '../src/standards/sia180.js';
import {
  evaluateMinergieVariante2,
  getMinergieRecommendedWindClass
} from '../src/standards/minergie.js';
import {
  SWISS_STATIONS,
  findNearestOfficialSiaStation
} from '../src/standards/swiss-stations.js';
import { createDefaultStarterProject, createHouseLibrary } from '../src/state/house-library.js';
import {
  appState,
  buildWorkspaceExportObject,
  createNewVariant,
  deleteVariant,
  detectAdvancedDetailsInActiveVariant,
  duplicateActiveVariant,
  importJsonToWorkspace,
  renameVariant,
  resetWorkspaceStorage,
  setActiveVariantInputMode,
  switchVariant,
  upgradeActiveVariantToAdvanced
} from '../src/state/project-store.js';
import { formatDayOfYearFR } from '../src/ui/charts.js';
import { parseHouseFile } from '../src/parsers/house-importers.js';

test('01-solar-geometry : midi solaire été & ombrage casquette', () => {
  // 21 juin (jour 172) à Sion (46.22°N, 7.33°E) vers 12h30 heure locale CET
  const sun = solarPosition(172, 12.5, 46.22, 7.33, 1);
  assert.ok(sun.altDeg > 60 && sun.altDeg < 70, `Hauteur solaire attendue ~67°, reçu ${sun.altDeg}`);
  assert.ok(Math.abs(sun.azDeg - 180) < 15, `Azimut proche du Sud, reçu ${sun.azDeg}`);

  const noShade = incidentIrradiance(800, 750, 120, sun, 180, 90, 0, 2.0);
  const withShade = incidentIrradiance(800, 750, 120, sun, 180, 90, 1.2, 2.0);
  assert.ok(withShade.direct < noShade.direct, 'Une casquette de 1.2 m doit réduire le direct en été');
  assert.ok(withShade.shadedFrac > 0.8, `Fraction ombragée attendue élevée, reçu ${withShade.shadedFrac}`);

  const split = splitGlobalToComponents(700, sun, 172);
  assert.ok(split.Ibn > 0 && split.Idh > 0 && split.Idh < 700);
});

test('02-weather-model : 8760h synthétiques, delta 2050 & import PVGIS JSON', () => {
  const wRef = generateSyntheticWeather('SIO', 'REF');
  assert.equal(wRef.data.length, 8760);

  const w2050 = applyClimateDelta(wRef, '2050');
  assert.equal(w2050.data.length, 8760);
  const diffWinter = w2050.data[0].Te - wRef.data[0].Te;
  const diffSummer = w2050.data[190 * 24].Te - wRef.data[190 * 24].Te;
  assert.ok(Math.abs(diffWinter - 1.5) < 1e-6);
  assert.ok(Math.abs(diffSummer - 2.0) < 1e-6);

  // Import PVGIS JSON minimal (24h)
  const samplePvgis = {
    inputs: { location: { latitude: 46.52, longitude: 6.63 } },
    outputs: {
      tmy_hourly: Array.from({ length: 24 }, (_, h) => ({
        'time(UTC)': `20200715:${String(h).padStart(2, '0')}00`,
        T2m: 20 + 5 * Math.sin((Math.PI * h) / 24),
        'G(h)': h >= 6 && h <= 18 ? 500 : 0,
        'Gb(n)': h >= 6 && h <= 18 ? 450 : 0,
        'Gd(h)': h >= 6 && h <= 18 ? 120 : 0
      }))
    }
  };
  const parsed = parseAnyWeatherText(JSON.stringify(samplePvgis), 'test.json', { tzMode: 'cet' });
  assert.equal(parsed.data.length, 24);
  assert.ok(parsed.sourceLabel.includes('46.52°N'));
});

test('03-envelope & 04-ventilation : présence SIA 380/1 & aéraulique ouvrants', () => {
  const villa = createHouseLibrary()[0].build();
  const rdc = villa.floors[0];
  assert.equal(rdc.occPresenceFactor, 0.5, 'Habitat Cat. II : tp=12h sur plage 24h => présence 0.5');

  const pInt = computeHourlyInternalGains(rdc, true);
  // 1.1 pers * 70 W * 0.5 + élec > 0
  assert.ok(pInt > 100 && pInt < 350, `Gains internes RDC attendus réalistes, reçu ${pInt}`);

  const ck20 = ckImposte(20);
  const ck90 = ckImposte(90);
  assert.ok(ck20 > 0.3 && ck20 < 0.4, `ck(20°) attendu ~0.33, reçu ${ck20}`);
  assert.ok(ck90 > 0.85 && ck90 <= 1.0, `ck(90°) attendu ~0.90, reçu ${ck90}`);

  const simpleMono = calcSimplePctNightFlowM3s(
    { area: 65, height: 2.6, nightSimpleBasis: 'floor_pct', nightSimplePct: 5, nightSimpleEff: 1, nightSimpleCross: false },
    10,
    26,
    18,
    2.6
  );
  const specM3hm2 = (simpleMono.m3s * 3600) / 65;
  assert.ok(specM3hm2 > 18 && specM3hm2 < 26, `5 % simple face ΔT=8K attendu ~22 m³/(h·m²), reçu ${specM3hm2}`);

  const opFlow = calcOpeningFlowM3s(villa.openings[0], 26, 18, 3.0);
  assert.ok(opFlow > 0.1);
});

test('05-thermal-5r1c-engine : pas de NaN si zone sans vitrage/ventilation & convergence stationnaire', () => {
  const fl = {
    id: 'z1',
    name: 'Test',
    elevationZ: 0,
    area: 50,
    height: 2.5,
    simplePos: 'standalone',
    envelopeStd: 'sia_new',
    cSpec: 45,
    psiTotal: 0
  };
  computeAutoEnvelopeFromFloor(fl);
  const fp = buildFloorThermalParams(fl, []); // 0 fenêtre => H_tr_w = 0
  const out = step5R1C(fp, 21.0, 0, 0, 0, 21.0, 0, 900, 0);
  assert.ok(Number.isFinite(out.Top), 'step5R1C ne doit jamais produire NaN quand H_tr_w=0 et H_ve=0');
  assert.ok(Math.abs(out.Top - 21.0) < 1e-6, 'À l équilibre à 21°C sans gains, Top doit rester 21.0°C');
});

test('06-sia180 & 08-comparator : simulation complète des 6 bâtiments types', () => {
  const lib = createHouseLibrary();
  assert.equal(lib.length, 6, 'La bibliothèque doit inclure les 6 modèles dont Constructeur 3D et TB Léa (bSol)');
  for (const item of lib) {
    const proj = item.build();
    const res = runFullSimulation(proj);
    assert.ok(res.worstFloor.overSIA >= 0);
    assert.ok(res.worstFloor.minTop <= res.worstFloor.maxTop, 'minTop doit être ≤ maxTop');
    assert.ok(res.worstFloor.summerMinTop <= res.worstFloor.summerMaxTop, 'summerMinTop ≤ summerMaxTop');
    assert.ok(res.minTe <= res.maxTe, 'minTe ≤ maxTe');
    assert.ok(res.worstFloor.maxTop > 20 && res.worstFloor.maxTop < 45);
    assert.equal(res.variants.length, 4);
    assert.ok(
      res.variants[2].wf.overSIA >= res.variants[1].wf.overSIA,
      `Scénario dégradé doit surchauffer au moins autant que l'optimisé (${item.id})`
    );
    const presc = evaluateSIA180PrescriptiveMethods(res.worstFloor);
    assert.equal(presc.method1.criteria.length, 6, 'Méthode 1 doit vérifier les 6 critères Tab. 8');
  }

  // Vérification spécifique du modèle Constructeur 3D (4x5x2.5 m)
  const boxProj = lib.find(x => x.id === 'local_bureau_box3d').build();
  assert.equal(boxProj.floors[0].area, 20);
  assert.ok(boxProj.floors[0].wallExtArea > 5 && boxProj.floors[0].wallExtArea < 7, 'Surface opaque façade Sud nette ~6.2 m²');
  assert.equal(boxProj.floors[0].roofExtArea, 0, 'Plafond adiabatique => 0 m² vers extérieur');
  assert.equal(boxProj.openings.length, 1);

  const f3 = getSIA180Limits(20, 'fig3');
  assert.ok(Math.abs(f3.upper - (0.33 * 20 + 21.8)) < 1e-6);
  const f4 = getSIA180Limits(18, 'fig4');
  assert.equal(f4.upper, 26.5);
});

test('07-thermal-comfort : Fanger PMV/PPD (ISO 7730), Seppänen 2006, TM52, EN 16798-1', () => {
  // Référence ISO 7730 : Ta=Tr=25°C, vel=0.10 m/s, rh=50%, met=1.2, clo=0.5 => PMV proche de la neutralité (~0.0 à +0.15)
  const neutral = calculateFangerPMV(25.0, 25.0, 0.1, 50, 1.2, 0.5);
  assert.ok(Math.abs(neutral.pmv) < 0.25, `PMV neutre été attendu proche de 0, reçu ${neutral.pmv}`);
  assert.ok(neutral.ppd >= 5 && neutral.ppd < 7, `PPD attendu ~5-6 %, reçu ${neutral.ppd}`);

  const hot = calculateFangerPMV(31.0, 31.5, 0.1, 50, 1.2, 0.5);
  assert.ok(hot.pmv > 1.8, `PMV à 31°C attendu chaud (>1.8), reçu ${hot.pmv}`);

  // Seppänen 2006 : optimum vers 21.75°C (~100%), baisse vers ~91% à 30°C
  const prodOpt = calculateSeppanenProductivityPct(21.75);
  const prod30 = calculateSeppanenProductivityPct(30.0);
  assert.ok(prodOpt > 99.5);
  assert.ok(prod30 > 89 && prod30 < 93.5, `Productivité à 30°C attendue ~91 %, reçu ${prod30}`);

  const villa = createHouseLibrary()[0].build();
  const w = generateSyntheticWeather('SIO', 'REF');
  const raw = executeEngine(villa, w.data, true, true);
  const comfort = evaluateThermalComfort(raw.floorRaw[0].series);
  assert.ok(comfort.en16798.occHoursEvaluated > 1000);
  assert.ok(comfort.secoOlt3.occTotalH > 1000);
  assert.ok(comfort.secoOlt3.occWithin26Pct >= 0 && comfort.secoOlt3.occWithin26Pct <= 100);
  assert.ok(comfort.ashrae55.occHoursEvaluated > 1000);
  assert.ok(typeof comfort.cibse.tm52Pass === 'boolean');
  assert.ok(typeof comfort.cibse.tm59Pass === 'boolean');
});

test('house-importers : IDF vertices avec View Factor numérique correctement parsés', () => {
  const idfSample = `
    Zone, Z1, 0, 0, 0, 0;
    BuildingSurface:Detailed,
      Floor1, Floor, FloorConst, Z1, Ground, , NoSun, NoWind, 0.5, 4,
      0, 0, 0,
      0, 10, 0,
      8, 10, 0,
      8, 0, 0;
    BuildingSurface:Detailed,
      WallSouth, Wall, WallConst, Z1, Outdoors, , SunExposed, WindExposed, 0.5, 4,
      0, 0, 3,
      0, 0, 0,
      8, 0, 0,
      8, 0, 3;
    FenestrationSurface:Detailed,
      WinSouth, Window, WinConst, WallSouth, , 0.5, , 1, 4,
      1, 0, 2.2,
      1, 0, 0.8,
      3, 0, 0.8,
      3, 0, 2.2;
  `;
  const { proj } = parseHouseFile(idfSample, 'test.idf');
  assert.equal(proj.floors[0].area, 80, `Surface plancher IDF attendue 80 m², reçu ${proj.floors[0].area}`);
  assert.equal(proj.floors[0].wallExtArea, 24, `Surface mur Sud IDF attendue 24 m², reçu ${proj.floors[0].wallExtArea}`);
  assert.equal(proj.openings.length, 1);
  assert.equal(proj.openings[0].width, 2);
  assert.equal(proj.openings[0].height, 1.4);
});

test('Minergie Variante 2 : horizon, écrans latéraux, UHI, détail gains & scénarios oublis', () => {
  // 1. Géométrie solaire : horizon & écrans latéraux réduisent l'irradiance directe
  const lowSun = solarPosition(172, 7.0, 46.22, 7.33, 1);
  const openHor = incidentIrradiance(400, 500, 80, lowSun, 90, 90, 0, 1.5, 0.2, { horizonDeg: 0 });
  const blockedHor = incidentIrradiance(400, 500, 80, lowSun, 90, 90, 0, 1.5, 0.2, { horizonDeg: 30 });
  assert.ok(blockedHor.direct < openHor.direct || openHor.direct === 0, 'Un horizon élevé doit masquer le rayonnement direct bas');

  const middaySun = solarPosition(172, 10.0, 46.22, 7.33, 1); // Sud-Est (az < 180)
  const noFin = incidentIrradiance(700, 750, 120, middaySun, 180, 90, 0, 1.5, 0.2);
  const withFin = incidentIrradiance(700, 750, 120, middaySun, 180, 90, 0, 1.5, 0.2, {
    leftFinDepth: 0.8,
    winWidth: 1.2
  });
  assert.ok(withFin.direct < noFin.direct, 'Un écran latéral gauche doit réduire le soleil matinal Sud-Est');

  // 2. Climat 2035 & Îlot de chaleur urbain (UHI)
  const wRef = generateSyntheticWeather('GVE', 'REF', false);
  const w2035 = generateSyntheticWeather('GVE', '2035', false);
  const w2035Uhi = generateSyntheticWeather('GVE', '2035', true);
  assert.ok(w2035.data[190 * 24 + 12].Te > wRef.data[190 * 24 + 12].Te, '2035 doit être plus chaud que REF');
  const uhiNightDelta = w2035Uhi.data[190 * 24 + 3].Te - w2035.data[190 * 24 + 3].Te;
  const uhiDayDelta = w2035Uhi.data[190 * 24 + 15].Te - w2035.data[190 * 24 + 15].Te;
  assert.ok(uhiNightDelta > uhiDayDelta + 0.5, 'UHI doit réchauffer nettement plus la nuit que le jour');

  // 3. Détail des gains internes (personnes + lampes + appareils === total)
  const villa = createHouseLibrary()[0].build();
  const rdc = villa.floors[0];
  const bd = computeHourlyInternalGainsBreakdown(rdc, true);
  assert.ok(bd.people > 0 && bd.lighting > 0 && bd.appliances > 0);
  assert.ok(Math.abs(bd.people + bd.lighting + bd.appliances - bd.total) < 1e-9);
  assert.equal(computeHourlyInternalGains(rdc, true), bd.total);

  // 4. Simulation complète : puissances de gains, validation Minergie & scénarios d'oubli
  const res = runFullSimulation(villa);
  const wf = res.worstFloor;
  assert.ok(wf.gains.totalGainPeakW > wf.gains.internalTotal.peakW);
  assert.ok(wf.gains.people.peakW > 0 && wf.gains.lighting.peakW > 0 && wf.gains.appliances.peakW > 0);
  assert.ok(wf.gains.solarBlockedByBlinds.summerKWh > 0, 'Les stores doivent bloquer une part mesurable du solaire');
  assert.ok(wf.minergie && typeof wf.minergie.constructivePass === 'boolean');
  assert.ok(wf.minergie.windRec.minClass >= 3 && wf.minergie.windRec.gustKmh > 25);

  const windNoFoehn = getMinergieRecommendedWindClass(6, 'residential', false, 'III', 'SIO');
  const windFoehn = getMinergieRecommendedWindClass(6, 'residential', true, 'III', 'SIO');
  assert.ok(windNoFoehn.minClass >= 3, 'En habitat, la classe minimale SIA 342 est ≥ 3');
  assert.equal(
    windFoehn.minClass,
    Math.min(6, windNoFoehn.minClass + 1),
    'Exposition au föhn doit majorer d’une classe de résistance au vent (+1)'
  );

  assert.ok(Array.isArray(res.behavioralScenarios) && res.behavioralScenarios.length >= 6);
  const sCurr = res.behavioralScenarios.find(s => s.id === 'current');
  const sNoBlinds = res.behavioralScenarios.find(s => s.id === 'no_blinds');
  const sNoNight = res.behavioralScenarios.find(s => s.id === 'no_night');
  const sBothBad = res.behavioralScenarios.find(s => s.id === 'both_bad');
  assert.ok(sNoBlinds.wf.overMinergie265 >= sCurr.wf.overMinergie265, 'Oublier les stores ne doit pas réduire la surchauffe');
  assert.ok(sNoNight.wf.overMinergie265 >= sCurr.wf.overMinergie265, 'Oublier la nuit ne doit pas réduire la surchauffe');
  assert.ok(sBothBad.wf.overMinergie265 >= sNoBlinds.wf.overMinergie265);
});

test('Validation TB Léa Bohren (bSol Pro) : aéraulique, stores, inertie ISO 13786, bypass WRG & tendances', () => {
  // 1. Ventilation naturelle mono-face (TB Léa Tableau 3 : 2.5 m² à ΔT=2K, Cd=0.6)
  const qPortrait = calcOpeningFlowM3s(
    { operable: true, qty: 1, openWidth: 1.0, openHeight: 2.5, cd: 0.6, openType: 'rect' },
    27,
    25,
    2.5
  ) * 3600;
  const qLandscape = calcOpeningFlowM3s(
    { operable: true, qty: 1, openWidth: 2.5, openHeight: 1.0, cd: 0.6, openType: 'rect' },
    27,
    25,
    2.5
  ) * 3600;
  assert.ok(Math.abs(qPortrait - 730) < 10, `Portrait 1×2.5 m attendu ~730 m³/h, reçu ${qPortrait}`);
  assert.ok(Math.abs(qLandscape - 460) < 10, `Paysage 2.5×1 m attendu ~460 m³/h, reçu ${qLandscape}`);

  // 2. Corrélation d'Erbs (1982) & capteur façade non masqué par la casquette
  assert.ok(erbsDiffuseFraction(0.70) > 0.20 && erbsDiffuseFraction(0.70) < 0.28);
  const noonSun = solarPosition(172, 12.5, 46.22, 7.33, 1);
  const irrShade = incidentIrradiance(900, 820, 140, noonSun, 180, 90, 1.5, 2.0);
  assert.ok(irrShade.totalUnshaded > irrShade.total, 'L irradiance capteur façade doit excéder celle sous casquette');

  // 3. Règles de déclenchement des stores (I ET T vs I OU T)
  const testOp = {
    orient: 'S', width: 2, height: 1.9, qty: 1, gVit: 0.6, gStore: 0.2, gtotMode: 'product',
    overhangDepth: 0, frameFactor: 0.75, shadingFactor: 1.0,
    blindMode: 'auto', blindThreshI: 200, blindThreshT: 22.0, blindRule: 'irr_and_temp'
  };
  const hrSun = { Igh: 850, Ibn: 750, Idh: 150, sun: noonSun };
  const coldAnd = computeHourlySolarGains([testOp], hrSun, 20.5, 16, true);
  const hotAnd = computeHourlySolarGains([testOp], hrSun, 23.0, 20, true);
  assert.ok(hotAnd.totalW < coldAnd.totalW * 0.3, 'En règle I ET T, les stores restent levés à 20.5°C et baissés à 23°C');

  // 4. Inertie ISO 13786 en Constructeur 3D : faux-plafond acoustique + parquet réduisent fortement C_R/A_SNP
  const lib = createHouseLibrary();
  const boxBare = lib.find(x => x.id === 'local_bureau_box3d').build();
  const cBare = boxBare.floors[0].cSpec;
  boxBare.floors[0].box3d.walls.ceiling.preset = 'slab_acoustic';
  boxBare.floors[0].box3d.walls.floor.preset = 'floor_parquet';
  applyBox3dToFloor(boxBare.floors[0], boxBare);
  const cCovered = boxBare.floors[0].cSpec;
  assert.ok(cBare > 140 && cCovered < cBare * 0.6, `Revêtements isolants doivent réduire fortement l inertie (${cBare} -> ${cCovered})`);

  // 5. Bypass estival automatique du récupérateur de chaleur (η=0.85 ne doit pas aggraver la surchauffe)
  const leaBase = lib.find(x => x.id === 'tb_lea_bsol').build();
  const wSioRef = generateSyntheticWeather('SIO', 'REF');
  const resNoWrg = executeEngine(leaBase, wSioRef.data, false, false).floorRaw[0];
  const leaWrg = JSON.parse(JSON.stringify(leaBase));
  leaWrg.floors[0].hasMechVent = true;
  leaWrg.floors[0].vmcSchedule = '24h';
  leaWrg.floors[0].etaWRG = 0.85;
  const resWithWrg = executeEngine(leaWrg, wSioRef.data, false, false).floorRaw[0];
  assert.ok(resWithWrg.over26 <= resNoWrg.over26 + 5, 'Le bypass estival WRG doit empêcher la surchauffe par récupération');

  // 6. Tendances physiques TB Léa (bSol Pro) : REF < 2050 < 2100, MVE REF = 0h, masse faible >> masse lourde, U quasi neutre
  const wSio2050 = generateSyntheticWeather('SIO', '2050');
  const wSio2100 = generateSyntheticWeather('SIO', '2100');
  const wMveRef = generateSyntheticWeather('MVE', 'REF');
  const rRef = executeEngine(leaBase, wSioRef.data, false, true).floorRaw[0];
  const r2050 = executeEngine(leaBase, wSio2050.data, false, true).floorRaw[0];
  const r2100 = executeEngine(leaBase, wSio2100.data, false, true).floorRaw[0];
  const rMve = executeEngine(leaBase, wMveRef.data, false, true).floorRaw[0];
  assert.equal(rMve.over26, 0, 'Montana REF doit rester à 0 h > 26°C comme dans bSol Pro');
  assert.ok(rRef.over26 < r2050.over26 && r2050.over26 < r2100.over26, 'Progression climatique REF < 2050 < 2100');
  assert.ok(r2100.coolKWhm2 > 4.0 && r2100.coolKWhm2 < 9.5, `Besoin froid SIO 2100 attendu ~6.5 kWh/m² (bSol), reçu ${r2100.coolKWhm2.toFixed(1)}`);

  const leaLight = JSON.parse(JSON.stringify(leaBase));
  leaLight.floors[0].cSpec = 20;
  const rLight = executeEngine(leaLight, wSioRef.data, false, false).floorRaw[0];
  assert.ok(rLight.over26 > rRef.over26 * 1.4, 'Une masse faible doit provoquer nettement plus de surchauffe');

  const leaU17 = JSON.parse(JSON.stringify(leaBase));
  leaU17.floors[0].uWallExt = 0.17;
  const rU17 = executeEngine(leaU17, wSio2100.data, false, false).floorRaw[0];
  assert.ok(Math.abs(rU17.over26 - r2100.over26) <= 20, 'Variation U_mur 0.10 -> 0.17 doit être quasi négligeable comme dans bSol');
});

test('Améliorations avancées : Fresnel (ISO 52016), Profils horaires SIA 2024 & Parseurs MétéoSuisse / SIA 2028 / Open-Meteo', () => {
  // 1. Loi angulaire Fresnel / Karlsson-Roos sur g_vit
  const k0 = glazingIncidenceModifier(1.0, 0.80);
  const k70Triple = glazingIncidenceModifier(Math.cos((70 * Math.PI) / 180), 0.80);
  const k70Double = glazingIncidenceModifier(Math.cos((70 * Math.PI) / 180), 1.20);
  assert.equal(k0.kDir, 1.0);
  assert.ok(k70Triple.kDir > 0.60 && k70Triple.kDir < 0.70, `Triple vitrage à 70° attendu ~0.66, reçu ${k70Triple.kDir}`);
  assert.ok(k70Double.kDir > k70Triple.kDir, 'Le double vitrage atténue moins que le triple à grand angle');

  const noonSun = solarPosition(172, 12.5, 46.22, 7.33, 1);
  const opS = {
    orient: 'S', width: 2, height: 1.9, qty: 1, uWin: 0.80, gVit: 0.60, gStore: 1.0,
    gtotMode: 'product', overhangDepth: 0, frameFactor: 0.75, shadingFactor: 1.0, blindMode: 'always_up'
  };
  const hrNoon = { Igh: 900, Ibn: 820, Idh: 130, sun: noonSun };
  const solNoFresnel = computeHourlySolarGains([opS], hrNoon, 24, 20, true, 0.2, 0, false).totalW;
  const solFresnel = computeHourlySolarGains([opS], hrNoon, 24, 20, true, 0.2, 0, true).totalW;
  assert.ok(solFresnel < solNoFresnel * 0.85, `Fresnel doit réduire nettement les apports Sud à midi été (${solFresnel.toFixed(0)} vs ${solNoFresnel.toFixed(0)} W)`);

  // 2. Profils horaires SIA 2024 : conservation exacte de l'énergie journalière + pics réalistes
  const villa = createHouseLibrary()[0].build();
  const rdc = villa.floors[0];
  let sumSia = 0;
  let sumConst = 0;
  const rdcConst = { ...rdc, internalProfileMode: 'constant' };
  const rdcSia = { ...rdc, internalProfileMode: 'sia2024' };
  for (let h = 0; h < 24; h++) {
    sumSia += computeHourlyInternalGains(rdcSia, true, h, true);
    sumConst += computeHourlyInternalGains(rdcConst, true, h, true);
  }
  assert.ok(Math.abs(sumSia - sumConst) < 1e-6, `Conservation énergie journalière SIA 2024 attendue (${sumSia} vs ${sumConst})`);
  const eveRes = computeHourlyInternalGains(rdcSia, true, 19, true);
  const midRes = computeHourlyInternalGains(rdcSia, true, 14, true);
  assert.ok(eveRes > midRes * 2.0, 'En logement SIA 2024, le pic du soir (19h) doit dépasser largement le creux de 14h');

  // 3. Parseur MétéoSuisse OGD CSV (tre200h0 / gre000h0)
  const smnLines = ['station_abbr;reference_timestamp;tre200h0;gre000h0'];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    smnLines.push(`SIO;15.07.2024 ${hh}:00;${(18 + 8 * Math.sin((Math.PI * h) / 24)).toFixed(1)};${h >= 6 && h <= 18 ? 600 : 0}`);
  }
  const smnParsed = parseAnyWeatherText(smnLines.join('\n'), 'ogd-smn_sio_h_recent.csv', { tzMode: 'cet' });
  assert.equal(smnParsed.data.length, 24);
  assert.ok(smnParsed.sourceLabel.includes('MétéoSuisse OGD') && smnParsed.sourceLabel.includes('Sion'));

  // 4. Parseur SIA 2028 / Meteonorm (.dat / .cli)
  const datLines = ['time.yy\ttime.mm\ttime.dd\ttime.hh\tta\tgls\tg_diff'];
  for (let h = 0; h < 24; h++) {
    datLines.push(`2010\t7\t15\t${h + 1}\t${(19 + 6 * Math.sin((Math.PI * h) / 24)).toFixed(1)}\t${h >= 6 && h <= 18 ? 700 : 0}\t${h >= 6 && h <= 18 ? 140 : 0}`);
  }
  const datParsed = parseAnyWeatherText(datLines.join('\n'), 'Sion_SIA2028.dat', { lat: 46.22, lon: 7.33 });
  assert.equal(datParsed.data.length, 24);
  assert.ok(datParsed.sourceLabel.includes('SIA 2028'));
  assert.ok(datParsed.data[12].Ibn > 0 && datParsed.data[12].Idh === 140);

  // 5. Parseur Open-Meteo Archive JSON + URL builder
  const omUrl = buildOpenMeteoArchiveUrl(46.22, 7.33, 2023);
  assert.ok(omUrl.includes('archive-api.open-meteo.com') && omUrl.includes('2023-01-01'));
  const omJson = {
    latitude: 46.22,
    longitude: 7.33,
    hourly: {
      time: Array.from({ length: 24 }, (_, h) => `2023-07-15T${String(h).padStart(2, '0')}:00`),
      temperature_2m: Array.from({ length: 24 }, (_, h) => 20 + 6 * Math.sin((Math.PI * h) / 24)),
      shortwave_radiation: Array.from({ length: 24 }, (_, h) => (h >= 6 && h <= 18 ? 650 : 0)),
      direct_normal_irradiance: Array.from({ length: 24 }, (_, h) => (h >= 6 && h <= 18 ? 600 : 0)),
      diffuse_radiation: Array.from({ length: 24 }, (_, h) => (h >= 6 && h <= 18 ? 130 : 0))
    }
  };
  const omParsed = parseAnyWeatherText(JSON.stringify(omJson), 'openmeteo_2023.json', { tzMode: 'cet_cest' });
  assert.equal(omParsed.data.length, 24);
  assert.ok(omParsed.sourceLabel.includes('Open-Meteo ERA5 (2023)'));
});

test('Besoins énergétiques de froid actif : calcul, seuils excessifs & propositions ciblées', () => {
  const lib = createHouseLibrary();
  // 1. Cas critique : bureau Sion sans stores + sans ventilation nuit => besoin excessif
  const hotOffice = lib.find(x => x.id === 'tb_lea_bsol').build();
  hotOffice.openings.forEach(o => {
    o.blindMode = 'always_up';
  });
  hotOffice.floors.forEach(f => {
    f.nightVentMode = 'none';
  });
  const resHot = runFullSimulation(hotOffice);
  const acHot = resHot.worstFloor.activeCooling;
  assert.ok(acHot && acHot.needed, 'Un bureau non protégé sans aération nuit doit nécessiter du froid actif');
  assert.equal(acHot.level, 'excessive', `Niveau attendu excessive, reçu ${acHot.level} (${acHot.coolKWhm2.toFixed(1)} kWh/m², ${acHot.maxCoolWm2.toFixed(1)} W/m²)`);
  assert.ok(acHot.coolHours > 100, 'Doit compter les heures actives de refroidissement');
  assert.ok(acHot.elecPacKWh > 0 && acHot.elecGeoKWh < acHot.elecPacKWh);
  const monthlySum = acHot.coolMonthlyKWh.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(monthlySum - acHot.coolKWh) < 1e-6, 'Somme mensuelle doit égaler coolKWh');
  assert.ok(acHot.proposals.length >= 2, 'Doit générer des propositions ciblées');
  assert.ok(acHot.optSavings && acHot.optSavings.savedEnergyPct > 20, 'Le scénario passif optimal doit réduire nettement le besoin de froid');
  assert.ok(resHot.buildingCooling && resHot.buildingCooling.totalCoolKWh >= acHot.coolKWh - 1e-6);

  // 2. Cas passif en montagne (Zermatt) : aucun froid actif requis
  const coolHouse = lib[0].build();
  coolHouse.climate.station = 'ZER';
  coolHouse.climate.scenario = 'REF';
  const resCool = runFullSimulation(coolHouse);
  assert.equal(resCool.worstFloor.activeCooling.needed, false, 'À Zermatt avec protections, le froid actif ne doit pas être nécessaire');
  assert.equal(resCool.worstFloor.activeCooling.level, 'none');
});

test('UX Avancée : projet défaut 1 étage/1 fenêtre Sud, sync 3D ↔ Fenêtres, multi-variantes & bascule libre Simple ↔ Avancé', () => {
  // 0. Projet par défaut : 1 seul étage + 1 fenêtre Sud simple
  const starter = createDefaultStarterProject();
  assert.equal(starter.floors.length, 1, 'Le projet par défaut doit comporter exactement 1 étage');
  assert.equal(starter.openings.length, 1, 'Le projet par défaut doit comporter exactement 1 fenêtre');
  assert.equal(starter.openings[0].orient, 'S', 'La fenêtre par défaut doit être orientée Sud');

  // 1. Sync bidirectionnelle 3D ↔ Vitrages sans perte d'écrans latéraux / ouvrants nuit
  const lib = createHouseLibrary();
  const boxProj = lib.find(x => x.id === 'tb_lea_bsol').build();
  const fl = boxProj.floors[0];
  const op = boxProj.openings[0];
  op.gStore = 0.08;
  op.leftFinDepth = 0.6;
  op.rightFinDepth = 0.6;
  op.openType = 'cross_rect';
  const synced = syncOpeningBackToBox3d(op, fl, boxProj);
  assert.equal(synced, true, 'syncOpeningBackToBox3d doit synchroniser vers la paroi 3D correspondante');
  applyBox3dToFloor(fl, boxProj);
  const opAfter = boxProj.openings[0];
  assert.equal(opAfter.gStore, 0.08, 'gStore doit être préservé après recalcul 3D');
  assert.equal(opAfter.leftFinDepth, 0.6, 'Écrans latéraux doivent être préservés après recalcul 3D');
  assert.equal(opAfter.openType, 'cross_rect', 'Type ouvrant nuit doit être préservé après recalcul 3D');

  // 2. Multi-variantes & bascule libre Simple ↔ Avancé avec détection non bloquante des réglages avancés
  resetWorkspaceStorage();
  assert.equal(appState.variants.length, 1);
  assert.equal(appState.uiModes.global, 'simple');
  assert.equal(appState.project.floors.length, 1);
  assert.equal(appState.project.openings.length, 1);
  assert.equal(detectAdvancedDetailsInActiveVariant().length, 0);

  const v2 = duplicateActiveVariant('Variante 2 — Stores perf.');
  assert.equal(appState.variants.length, 2);
  assert.equal(appState.activeVariantId, v2.id);
  upgradeActiveVariantToAdvanced('box3d');
  assert.equal(appState.uiModes.global, 'advanced');
  assert.equal(appState.uiModes.floorsEditor, 'box3d');

  // Retour libre vers Simple sans blocage + détection de l'alerte non bloquante
  appState.project.floors[0].nightVentMode = 'physical';
  setActiveVariantInputMode('simple');
  assert.equal(appState.uiModes.global, 'simple');
  const advReasons = detectAdvancedDetailsInActiveVariant();
  assert.ok(advReasons.length >= 1, 'Doit signaler les réglages avancés lors du retour en Mode Simple');
  setActiveVariantInputMode('advanced', 'box3d');

  // Revenir à Variante 1 doit restaurer son mode Simple intact
  switchVariant(appState.variants[0].id);
  assert.equal(appState.uiModes.global, 'simple');
  // Revenir à Variante 2 doit restaurer son mode Avancé + box3d
  switchVariant(v2.id);
  assert.equal(appState.uiModes.global, 'advanced');
  assert.equal(appState.uiModes.floorsEditor, 'box3d');

  renameVariant(v2.id, 'Variante 2 — Renommée');
  assert.equal(appState.variants.find(x => x.id === v2.id).name, 'Variante 2 — Renommée');

  const v3 = createNewVariant({ inputMode: 'simple', name: 'Variante 3 — Simple' });
  assert.equal(appState.variants.length, 3);
  assert.equal(appState.uiModes.global, 'simple');
  assert.equal(appState.project.floors.length, 1);
  assert.equal(appState.project.openings.length, 1);

  assert.equal(deleteVariant(v3.id), true);
  assert.equal(appState.variants.length, 2);
  resetWorkspaceStorage();

  // 3. Dates calendaires françaises
  assert.equal(formatDayOfYearFR(0), '1 jan.');
  assert.equal(formatDayOfYearFR(181), '1 juil.');
  assert.equal(formatDayOfYearFR(222), '11 août');
});

test('Nouvelles fonctionnalités : journée type manuelle, structure 3D indépendante des fenêtres, VMC & import/export JSON', () => {
  // 1. Journée type manuelle (test canicule 14 j) + simulation complète sans erreur
  const hotDay = generateManualDesignDayWeather({ tMin: 22, tMax: 38, peakIgh: 900, dayOfYear: 201 });
  const hotStats = summarizeWeatherData(hotDay);
  assert.equal(hotDay.isManualDesignDay, true);
  assert.equal(hotStats.hoursCount, 336);
  assert.ok(Math.abs(hotStats.minTe - 22) < 0.05, `minTe attendu 22, reçu ${hotStats.minTe}`);
  assert.ok(Math.abs(hotStats.maxTe - 38) < 0.05, `maxTe attendu 38, reçu ${hotStats.maxTe}`);
  assert.ok(Math.abs(hotStats.peakIgh - 900) < 2, `peakIgh attendu 900, reçu ${hotStats.peakIgh}`);

  const starter = createDefaultStarterProject();
  starter.openings[0].blindMode = 'always_up';
  starter.floors[0].nightVentMode = 'none';
  const resHotDay = runFullSimulation(starter, hotDay);
  assert.equal(resHotDay.isManualDesignDay, true);
  assert.ok(resHotDay.worstFloor.overSIA > 20, `Doit surchauffer sous canicule 22..38 °C, reçu ${resHotDay.worstFloor.overSIA} h`);

  const coolDay = generateManualDesignDayWeather({ tMin: 12, tMax: 21, peakIgh: 400, dayOfYear: 201 });
  const resCoolDay = runFullSimulation(createDefaultStarterProject(), coolDay);
  assert.equal(resCoolDay.worstFloor.overSIA, 0, 'Aucune surchauffe attendue sous journée fraîche 12..21 °C');

  // 2. Structure 3D pure (preserveOpenings = true) : ne supprime jamais les fenêtres et pivote leur orientation
  const lib = createHouseLibrary();
  const boxProj = lib.find(x => x.id === 'tb_lea_bsol').build();
  const fl = boxProj.floors[0];
  boxProj.openings.push({
    ...boxProj.openings[0],
    id: 'op_extra_right',
    box3dFace: 'right',
    orient: 'O',
    width: 1.5,
    height: 1.5,
    qty: 1
  });
  const wallAreaBefore = fl.wallExtArea;
  fl.box3d.frontOrient = 'O'; // Rotation 90° : front devient O, right devient N
  applyBox3dToFloor(fl, boxProj, { preserveOpenings: true });
  assert.equal(boxProj.openings.length, 2, 'Les 2 fenêtres doivent être intégralement conservées en mode structure 3D');
  assert.equal(boxProj.openings[0].orient, 'O', 'La fenêtre Mur Devant doit pivoter vers O');
  assert.equal(boxProj.openings[1].orient, 'N', 'La fenêtre Mur Droit doit pivoter vers N');
  assert.ok(fl.wallExtArea <= wallAreaBefore + 0.1);

  // 3. Export / Import JSON (espace multi-variantes complet + projet unique)
  resetWorkspaceStorage();
  const v2 = duplicateActiveVariant('Variante 2 — VMC 85%');
  appState.project.floors[0].hasMechVent = true;
  appState.project.floors[0].etaWRG = 0.85;
  const exportedWs = JSON.stringify(buildWorkspaceExportObject());

  resetWorkspaceStorage();
  assert.equal(appState.variants.length, 1);

  const impWs = importJsonToWorkspace(exportedWs);
  assert.equal(impWs.kind, 'workspace');
  assert.equal(impWs.count, 2);
  assert.equal(appState.variants.length, 2);
  assert.equal(appState.variants.find(x => x.id === v2.id)?.project.floors[0].etaWRG, 0.85);

  const singleJson = JSON.stringify(createDefaultStarterProject());
  const impSingle = importJsonToWorkspace(singleJson);
  assert.equal(impSingle.kind, 'project');
  assert.equal(appState.project.floors.length, 1);

  resetWorkspaceStorage();
});

test('Minergie v2023.2 (CALC_1) : benchmark bureau exercice, aération diurne, saison 16 avr.–15 oct., SIA strict, Custom & stores manuels', () => {
  // 1. Test de référence : bureau exercice 20 m² (Sion 2035, 3.80 m² Sud brut → 3.12 m² verre net, C_R/A_SNP = 46.2, stratégie jour)
  const fl = {
    id: 'f1',
    name: 'Bureau exercice 20 m²',
    elevationZ: 2.5,
    area: 20,
    height: 2.5,
    depthBehindWin: 5.0,
    siaCategory: 'III',
    roomType2024: 'bureau_indiv',
    spaceType: 'office',
    cSpec: 125,
    cSpecMinergie: 46.2,
    wallExtArea: 6.2,
    uWallExt: 0.17,
    roofExtArea: 0,
    uRoofExt: 0.2,
    floorGroundArea: 0,
    bFloorGround: 0,
    uFloorGround: 0.2,
    uSlabInter: 1.4,
    psiTotal: 0.5,
    occCount: 2,
    occWatt: 80,
    occPresenceFactor: 1.0,
    lightWm2: 2.0,
    equipWatt: 120,
    occStart: 8,
    occEnd: 18,
    occDays: 5,
    standbyPct: 10,
    internalProfileMode: 'sia2024',
    qHygSpec: 1.0,
    achInfil: 0.1,
    hasMechVent: false,
    etaWRG: 0,
    dayVentMode: 'none',
    dayTargetTi: 23.0,
    dayMinDT: 1.0,
    nightVentMode: 'none',
    nightSimpleBasis: 'floor_pct',
    nightSimplePct: 3.0,
    nightSimpleEff: 0.6,
    nightSimpleCross: false,
    nightVentFixedVal: 0,
    nightStart: 21,
    nightEnd: 7,
    nightTargetTi: 21.0,
    nightMinDT: 1.5,
    minergieStrategy: 'day',
    minergieInternalLoadWhm2d: 160
  };
  const op = {
    id: 'o1',
    floorId: 'f1',
    name: 'Fenêtres Sud',
    orient: 'S',
    width: 1.9,
    height: 1.0,
    qty: 2,
    uWin: 0.8,
    gVit: 0.60,
    gStore: 0.15,
    gtotMode: 'direct',
    overhangDepth: 0,
    frameFactor: 3.12 / 3.80,
    shadingFactor: 1.0,
    blindMode: 'auto',
    blindThreshI: 200,
    blindThreshT: 22.0,
    blindRule: 'irr_and_temp',
    windSafe: true,
    operable: true,
    openWidth: 1.0,
    openHeight: 1.0,
    openType: 'rect',
    alphaDeg: 20,
    cd: 0.6,
    sillHeight: 0.9
  };
  const projClosed = {
    name: 'Bureau exercice Minergie',
    projectType: 'minergie',
    siaCurveMode: 'fig3',
    stackCoupling: false,
    foehnExposed: true,
    terrainCat: 'III',
    buildingHeightM: 5.0,
    horizonDeg: 0,
    albedo: 0.20,
    climate: { station: 'SIO', scenario: '2035', lat: 46.22, lon: 7.33 },
    floors: [fl],
    openings: [op]
  };
  const w2035 = generateSyntheticWeather('SIO', '2035', false);
  const rawClosed = executeEngine(projClosed, w2035.data, false, false);
  const m = evaluateMinergieVariante2(rawClosed.floorRaw[0], projClosed, rawClosed.floorRaw[0]);

  assert.ok(Math.abs(m.thermalMassWhm2K - 46.2) < 0.05, `C_R/A_SNP attendu 46.2, reçu ${m.thermalMassWhm2K}`);
  assert.ok(Math.abs(m.glazingIndexZg - 0.156) < 0.002, `Z_g attendu 0.156, reçu ${m.glazingIndexZg.toFixed(4)}`);
  assert.ok(Math.abs(m.qMaxWhDay - 2600.8) < 1.0, `Q_max attendu 2600.8 Wh/j, reçu ${m.qMaxWhDay.toFixed(1)}`);
  assert.ok(Math.abs(m.gTotAuthorized - 0.123) < 0.005, `g_tot admis attendu ~0.123, reçu ${m.gTotAuthorized.toFixed(3)}`);
  assert.ok(Math.abs(m.bilanPct - 117) < 2.0, `Bilan constructif attendu ~117 %, reçu ${m.bilanPct.toFixed(1)} %`);
  assert.ok(Math.abs(m.gainsLossesRatio - 1.69) < 0.04, `Rapport gains/pertes attendu ~1.69, reçu ${m.gainsLossesRatio.toFixed(2)}`);
  assert.equal(m.windRec.minClass, 4, `Classe de vent attendue 4, reçu ${m.windRec.minClass}`);
  assert.ok(Math.abs(m.windRec.gustKmh - 41.5) < 0.3, `Rafale SIA 261 attendue ~41.5 km/h, reçu ${m.windRec.gustKmh}`);
  assert.equal(m.constructivePass, false, 'Le bureau exercice doit échouer au contrôle constructif (> 100 %)');
  assert.equal(m.analyticalComfortPass, false, 'Le confort analytique doit être refusé');
  assert.equal(m.automationRequired, true, 'Charges 160 > 100 Wh/m²j en stratégie jour => automatisation requise');
  assert.equal(m.coolingRequiredByRule, true, 'Charges 160 > 140 Wh/m²j en stratégie jour => refroidissement requis');

  // 2. Séparation des capacités thermiques Box3D : cSpecMinergie plafonnée à 75 Wh/m²K et inférieure à cSpec 5R1C
  const lib = createHouseLibrary();
  const box = lib.find(x => x.id === 'local_bureau_box3d').build();
  assert.ok(box.floors[0].cSpec > 100, 'cSpec 5R1C doit rester élevé pour béton nu');
  assert.ok(box.floors[0].cSpecMinergie <= 75, `cSpecMinergie doit être plafonnée à 75 Wh/m²K (reçu ${box.floors[0].cSpecMinergie})`);

  // 3. Aération par les fenêtres en journée (dayVentMode = 'window_occ') : réduit fortement le pic thermique
  const projDayAir = JSON.parse(JSON.stringify(projClosed));
  projDayAir.floors[0].dayVentMode = 'window_occ';
  const rawDayAir = executeEngine(projDayAir, w2035.data, false, false);
  assert.ok(
    rawDayAir.floorRaw[0].maxTop < rawClosed.floorRaw[0].maxTop - 2.0,
    `L’aération fenêtres en journée doit réduire nettement le pic (${rawClosed.floorRaw[0].maxTop.toFixed(1)} -> ${rawDayAir.floorRaw[0].maxTop.toFixed(1)} °C)`
  );

  // 4. Fenêtre saisonnière Minergie (16 avril – 15 octobre uniquement : d ∈ [105, 287])
  const hotWinterData = generateManualDesignDayWeather({ tMin: 25, tMax: 35, peakIgh: 600, dayOfYear: 201 }).data.map(
    (hr, idx) => ({ ...hr, d: 35 + Math.floor(idx / 24) }) // Février (j=35..48, hors 16 avr.–15 oct.)
  );
  const rawWinter = executeEngine(projClosed, hotWinterData, false, false);
  assert.equal(rawWinter.floorRaw[0].overMinergie265, 0, 'Hors période 16 avr.–15 oct., overMinergie265 doit rester à 0');
  assert.ok(rawWinter.floorRaw[0].over265All > 50, 'La température dépasse bien 26.5 °C mais hors saison Minergie');

  // 5. Mode Strict SIA 2028 : stations officielles Valais (SIO, MVE, GSB ; ZER hors SIA)
  assert.equal(SWISS_STATIONS.SIO.officialSIA, true);
  assert.equal(SWISS_STATIONS.MVE.officialSIA, true);
  assert.equal(SWISS_STATIONS.GSB.officialSIA, true);
  assert.equal(SWISS_STATIONS.ZER.officialSIA, false);
  assert.equal(findNearestOfficialSiaStation(46.02, 7.75, 1620).stationKey, 'MVE', 'Zermatt (1620 m) → Montana (MVE)');
  assert.equal(findNearestOfficialSiaStation(46.103, 7.073, 471).stationKey, 'SIO', 'Martigny (471 m) → Sion (SIO)');
  assert.equal(findNearestOfficialSiaStation(45.948, 7.207, 2100).stationKey, 'GSB', 'Bourg-St-Pierre (2100 m) → Grand-St-Bernard (GSB)');

  // 6. Réglementation personnalisée (Custom) & stores manuels avec plage horaire dédiée / règle 'none'
  const limCustomFixed = getProjectComfortLimits(25, { projectType: 'custom', customReg: { limitMode: 'fixed', maxTempC: 27.5, maxHours: 80, countMode: 'all' } });
  assert.equal(limCustomFixed.upper, 27.5);
  const limCustomCap = getProjectComfortLimits(30, { projectType: 'custom', customReg: { limitMode: 'adaptive_cap', maxTempC: 28.0, maxHours: 100, countMode: 'occupied' } });
  assert.equal(limCustomCap.upper, 28.0, 'SIA adaptatif plafonné doit plafonner à 28.0 °C');

  const noonSun = solarPosition(172, 12.5, 46.22, 7.33, 1);
  const hrSun = { Igh: 850, Ibn: 750, Idh: 150, sun: noonSun };
  const opManual = {
    ...op,
    blindMode: 'manual_day',
    blindRule: 'schedule_only',
    blindManualUseOcc: false,
    blindStart: 12,
    blindEnd: 16
  };
  const solAt10h = computeHourlySolarGains([opManual], hrSun, 25, 22, true, 0.2, 0, true, { hod: 10, isOcc24h: true }).totalW;
  const solAt14h = computeHourlySolarGains([opManual], hrSun, 25, 22, true, 0.2, 0, true, { hod: 14, isOcc24h: true }).totalW;
  assert.ok(solAt14h < solAt10h * 0.4, 'En commande manuelle 12h–16h (plage seule), le store doit être baissé à 14h et levé à 10h');

  const opNoneRule = { ...op, blindMode: 'auto', blindRule: 'none' };
  const solNoneRule = computeHourlySolarGains([opNoneRule], hrSun, 28, 24, true, 0.2, 0, true, { hod: 14, isOcc24h: false }).totalW;
  assert.ok(Math.abs(solNoneRule - solAt10h) < 1e-6, 'Avec règle « Aucune », le store doit rester ouvert');

  // 7. Store manuel par défaut indépendant de l'occupation (blindManualUseOcc non défini => plage horaire 10h–18h même hors occupation)
  const opManualDefault = { ...op, blindMode: 'manual_day', blindRule: 'schedule_only' };
  delete opManualDefault.blindManualUseOcc;
  delete opManualDefault.blindStart;
  delete opManualDefault.blindEnd;
  const solDefaultOutsideOcc14h = computeHourlySolarGains([opManualDefault], hrSun, 25, 22, false, 0.2, 0, true, { hod: 14, isOcc24h: false }).totalW;
  const solDefaultOutsideOcc08h = computeHourlySolarGains([opManualDefault], hrSun, 25, 22, false, 0.2, 0, true, { hod: 8, isOcc24h: false }).totalW;
  assert.ok(
    solDefaultOutsideOcc14h < solDefaultOutsideOcc08h * 0.4,
    'Par défaut en mode manuel, les stores suivent la plage horaire (10h–18h) indépendamment de l’occupation'
  );

  // 8. Journée type manuelle : statistiques day24 sur la dernière journée convergée (24 h exactement)
  const manualWeather = generateManualDesignDayWeather({ tMin: 18, tMax: 34, peakIgh: 850, dayOfYear: 201 });
  const rawManual = executeEngine(projClosed, manualWeather.data, true, false);
  const d24 = rawManual.floorRaw[0].day24;
  assert.ok(d24 && d24.hoursCount === 24, 'day24 doit compter exactement 24 h convergées');
  assert.ok(d24.overSIA >= 0 && d24.overSIA <= 24, `day24.overSIA doit être dans [0, 24], reçu ${d24.overSIA}`);
  assert.ok(d24.overMinergie265 >= 0 && d24.overMinergie265 <= 24, `day24.overMinergie265 doit être dans [0, 24]`);
  assert.ok(d24.maxTop > 22 && d24.maxTop >= d24.minTop, 'day24.maxTop doit être physiquement cohérent');
  assert.ok(d24.maxTopHod >= 0 && d24.maxTopHod <= 23, 'day24.maxTopHod doit être une heure 0..23');
});

test('Correctifs physiques complets : VMC active/bypass nuit, pic froid horaire, masse d’air solaire, couloir 3D, charges ouvrées & Meteonorm', () => {
  // Cas exact du bureau 20 m² à Sion 2035 (exercice Minergie 2 pers., 380 W internes)
  const makeBureauProj = () => ({
    name: 'Bureau exercice 20 m²',
    projectType: 'minergie',
    siaCurveMode: 'fig4',
    stackCoupling: false,
    albedo: 0.2,
    climate: { station: 'SIO', scenario: '2035', lat: 46.22, lon: 7.33, tzMode: 'cet_cest', urbanHeatIsland: false },
    floors: [
      {
        id: 'f1',
        name: 'Bureau',
        elevationZ: 0,
        area: 20,
        height: 2.5,
        depthBehindWin: 4,
        simplePos: 'mid',
        envelopeStd: 'sia_new',
        siaCategory: 'custom',
        roomType2024: 'bureau_indiv',
        spaceType: 'office',
        inertiaClass: 'custom',
        cSpec: 125,
        cSpecMinergie: 46.2,
        gainFactorPct: 100,
        wallExtArea: 8.7,
        uWallExt: 0.17,
        roofExtArea: 0,
        uRoofExt: 0.2,
        floorGroundArea: 0,
        bFloorGround: 0,
        uFloorGround: 0.2,
        uSlabInter: 1.4,
        psiTotal: 0,
        adjCorridorUA: 0,
        occCount: 2,
        occWatt: 70,
        occPresenceFactor: 1.0,
        lightWm2: 2.0,
        equipWatt: 200,
        occStart: 8,
        occEnd: 16,
        occDays: 5,
        standbyPct: 0,
        internalProfileMode: 'constant',
        qHygSpec: 0.7,
        achInfil: 0.1,
        hasMechVent: true,
        vmcSchedule: 'occ_bypass_night',
        etaWRG: 0.75,
        dayVentMode: 'none',
        dayTargetTi: 23,
        dayMinDT: 1,
        nightVentMode: 'none',
        nightStart: 21,
        nightEnd: 7,
        nightTargetTi: 21,
        nightMinDT: 1.5,
        heatSetpoint: 20,
        box3d: {
          dimX: 5,
          dimY: 4,
          frontOrient: 'S',
          manualCSpec: false,
          manualCSpecMinergie: true,
          walls: {
            front: { contact: 'ext_sun', preset: 'wall_sia_heavy', u: 0.17 },
            back: { contact: 'adiabatic', preset: 'wall_plaster_int', u: 1.8 },
            right: { contact: 'adiabatic', preset: 'wall_plaster_int', u: 1.8 },
            left: { contact: 'adiabatic', preset: 'wall_plaster_int', u: 1.8 },
            ceiling: { contact: 'adiabatic', preset: 'slab_acoustic', u: 1.1 },
            floor: { contact: 'adiabatic', preset: 'slab_heavy_int', u: 1.4 }
          }
        }
      }
    ],
    openings: [
      {
        id: 'b3_f1_front',
        floorId: 'f1',
        box3dFace: 'front',
        name: 'Fenêtre Sud',
        orient: 'S',
        width: 2.0,
        height: 1.9,
        qty: 1,
        uWin: 1.0,
        gVit: 0.60,
        gStore: 0.15,
        gtotMode: 'direct',
        overhangDepth: 0,
        frameFactor: 0.82,
        shadingFactor: 1.0,
        blindMode: 'auto',
        blindThreshI: 200,
        blindThreshT: 22.0,
        blindRule: 'irr_only',
        windSafe: true,
        operable: true,
        openWidth: 1.0,
        openHeight: 1.4,
        openType: 'imposte',
        alphaDeg: 20,
        cd: 0.6,
        sillHeight: 0.6
      }
    ]
  });

  const w2035 = generateSyntheticWeather('SIO', '2035', false);

  // 1. Bug #1 : VMC active avec bypass nocturne réduit fortement la surchauffe vs absence de bypass (et 3.0 m³/hm² encore plus)
  const pVmcBypass = makeBureauProj();
  const pVmcOccOnly = makeBureauProj();
  pVmcOccOnly.floors[0].vmcSchedule = 'occ_only';
  const pVmcSia382 = makeBureauProj();
  pVmcSia382.floors[0].qHygSpec = 3.0; // 60 m³/h pour 2 pers. (SIA 382/1)

  const rBypass = executeEngine(pVmcBypass, w2035.data, false, true).floorRaw[0];
  const rOccOnly = executeEngine(pVmcOccOnly, w2035.data, false, true).floorRaw[0];
  const rSia382 = executeEngine(pVmcSia382, w2035.data, false, true).floorRaw[0];

  assert.ok(
    rBypass.maxTop < rOccOnly.maxTop - 4.0,
    `Le bypass nocturne VMC doit abaisser nettement le pic (${rOccOnly.maxTop.toFixed(1)} -> ${rBypass.maxTop.toFixed(1)} °C)`
  );
  assert.ok(
    rSia382.maxTop < 38.5 && rSia382.overMinergie265 < rBypass.overMinergie265,
    `Le débit SIA 382/1 (3.0 m³/hm²) doit abaisser le pic sous 38.5 °C (reçu ${rSia382.maxTop.toFixed(1)} °C)`
  );

  // 2. Bug #3 : Plus de pic artificiel sur 15 min à 08h00 le lundi (maxCoolWm2 < 45 W/m² vs ~100 W/m² avant)
  assert.ok(
    rOccOnly.maxCoolWm2 < 45.0,
    `La puissance de froid de pointe horaire doit rester réaliste (< 45 W/m²), reçu ${rOccOnly.maxCoolWm2.toFixed(1)} W/m²`
  );

  // 3. Bug #4 : Atténuation par masse d'air atmosphérique (Sion REF 16 août 06h : Ibn < 350 W/m² au lieu de 856 W/m²)
  const wSioRef = generateSyntheticWeather('SIO', 'REF', false);
  const earlySun = wSioRef.data[228 * 24 + 6];
  const maxIghRef = Math.max(...wSioRef.data.map(h => h.Igh));
  assert.ok(earlySun.Ibn < 350, `À 06h00 (soleil bas), Ibn doit rester modéré (< 350 W/m²), reçu ${earlySun.Ibn.toFixed(0)}`);
  assert.ok(maxIghRef >= 900 && maxIghRef <= 1100, `Pic Igh Sion REF attendu 900–1100 W/m², reçu ${maxIghRef.toFixed(0)}`);

  // 4. Bug #5 : Contact 3D 'adj_corridor' dissipe vers le couloir tempéré
  const pCorr = makeBureauProj();
  pCorr.floors[0].vmcSchedule = 'occ_only';
  pCorr.floors[0].box3d.walls.back.contact = 'adj_corridor';
  applyBox3dToFloor(pCorr.floors[0], pCorr, { preserveOpenings: true });
  assert.ok(pCorr.floors[0].adjCorridorUA > 15, `adjCorridorUA attendu > 15 W/K, reçu ${pCorr.floors[0].adjCorridorUA}`);
  const rCorr = executeEngine(pCorr, w2035.data, false, false).floorRaw[0];
  assert.ok(
    rCorr.maxTop < rOccOnly.maxTop - 10.0,
    `Couplage couloir doit supprimer l'effet four (${rOccOnly.maxTop.toFixed(1)} -> ${rCorr.maxTop.toFixed(1)} °C)`
  );

  // 5. Bug #6 : Charges internes Minergie évaluées par jour d'exploitation (152 Wh/m²j pour 5 j/7, > seuil 120 mech)
  const mCorr = evaluateMinergieVariante2(rOccOnly, pVmcOccOnly, rOccOnly);
  assert.ok(
    Math.abs(mCorr.internalLoadForAnalytical - 152) < 1.0,
    `Charge interne par jour ouvré attendue 152 Wh/(m²·j), reçu ${mCorr.internalLoadForAnalytical.toFixed(1)}`
  );
  assert.equal(mCorr.coolingRequiredByRule, true, 'En stratégie mech (seuil 120 Wh/m²j), 152 Wh/m²j exige du froid');

  // 6. Import Meteonorm complet (colonnes G_Gh, G_Dh, G_Bn + Latitude dans l'en-tête)
  const meteonormSample = [
    '# Meteonorm v8 export — Sion REF',
    '# Latitude: 46.22, Longitude: 7.33',
    'm;d;h;Ta;G_Gh;G_Dh;G_Bn',
    ...Array.from({ length: 24 }, (_, h) => {
      const te = (18 + 8 * Math.sin((Math.PI * h) / 24)).toFixed(1);
      const gh = h >= 6 && h <= 18 ? 720 : 0;
      const dh = h >= 6 && h <= 18 ? 140 : 0;
      const bn = h >= 6 && h <= 18 ? 780 : 0;
      return `7;15;${h + 1};${te};${gh};${dh};${bn}`;
    })
  ].join('\n');
  const mnParsed = parseAnyWeatherText(meteonormSample, 'Sion_Meteonorm.csv', { lat: 46.22, lon: 7.33 });
  assert.equal(mnParsed.data.length, 24);
  assert.ok(mnParsed.sourceLabel.includes('Meteonorm'), `sourceLabel doit mentionner Meteonorm, reçu ${mnParsed.sourceLabel}`);
  assert.equal(mnParsed.data[12].Igh, 720);
  assert.equal(mnParsed.data[12].Idh, 140);
  assert.equal(mnParsed.data[12].Ibn, 780);
});
