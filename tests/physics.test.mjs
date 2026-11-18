import test from 'node:test';
import assert from 'node:assert/strict';

import {
  incidentIrradiance,
  solarPosition,
  splitGlobalToComponents
} from '../src/methodology/01-solar-geometry.js';
import {
  applyClimateDelta,
  generateSyntheticWeather,
  parseAnyWeatherText
} from '../src/methodology/02-weather-model.js';
import {
  buildFloorThermalParams,
  computeAutoEnvelopeFromFloor,
  computeHourlyInternalGains
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
import { getSIA180Limits } from '../src/standards/sia180.js';
import { createHouseLibrary } from '../src/state/house-library.js';
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

test('06-sia180 & 08-comparator : simulation complète des 4 bâtiments types', () => {
  const lib = createHouseLibrary();
  assert.equal(lib.length, 5, 'La bibliothèque doit inclure les 5 modèles dont le Constructeur 3D');
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
