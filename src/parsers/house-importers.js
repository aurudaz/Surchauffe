/**
 * @fileoverview Importateurs de géométrie de bâtiment :
 *  - .json (sauvegarde SIA Thermic Studio)
 *  - .gbxml / .xml (Revit / ArchiCAD / Vectorworks)
 *  - .ifc (STEP BIM)
 *  - .idf (EnergyPlus)
 */

import { ensureFloorDefaults, makeOpening, createHouseLibrary } from '../state/house-library.js';

function vectorToAzTilt(nx, ny, nz) {
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  const ux = nx / len;
  const uy = ny / len;
  const uz = nz / len;
  const tilt = (Math.acos(Math.max(-1, Math.min(1, uz))) * 180) / Math.PI;
  if (tilt < 30) return 'R';
  if (tilt > 150) return 'F';
  let az = (Math.atan2(ux, uy) * 180) / Math.PI;
  if (az < 0) az += 360;
  return azDegToOrient(az);
}

export function azDegToOrient(az) {
  const a = ((az % 360) + 360) % 360;
  const dirs = [
    ['N', 0],
    ['NE', 45],
    ['E', 90],
    ['SE', 135],
    ['S', 180],
    ['SO', 225],
    ['O', 270],
    ['NO', 315]
  ];
  let best = 'S';
  let minD = 999;
  for (const [k, deg] of dirs) {
    const d = Math.min(Math.abs(a - deg), 360 - Math.abs(a - deg));
    if (d < minD) {
      minD = d;
      best = k;
    }
  }
  return best;
}

/**
 * Extrait proprement les sommets 3D d'un objet IDF (BuildingSurface:Detailed ou FenestrationSurface:Detailed)
 * sans confondre "View Factor to Ground" avec "Number of Vertices".
 */
function extractIdfVertices(fields, headerLen) {
  const tail = fields.slice(headerLen);
  const pts = [];
  for (let i = 0; i + 2 < tail.length; i += 3) {
    const x = parseFloat(tail[i]);
    const y = parseFloat(tail[i + 1]);
    const z = parseFloat(tail[i + 2]);
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) break;
    pts.push([x, y, z]);
  }
  return pts;
}

/**
 * Parse un fichier de bâtiment (.json, .gbxml, .ifc, .idf).
 * @param {string} text Contenu brut
 * @param {string} filename Nom du fichier
 * @param {object} [fallbackClimate] Climat par défaut si non précisé dans le fichier
 */
export function parseHouseFile(text, filename, fallbackClimate = null) {
  const low = String(filename || '').toLowerCase();
  const baseTemplate = createHouseLibrary()[0].build();
  const baseFloor = JSON.parse(JSON.stringify(baseTemplate.floors[0]));
  const climate = fallbackClimate || baseTemplate.climate;

  // 1. JSON
  if (low.endsWith('.json') || text.trim().startsWith('{')) {
    const obj = JSON.parse(text);
    if (!Array.isArray(obj.floors) || !Array.isArray(obj.openings)) {
      throw new Error('Structure JSON invalide (floors/openings manquants).');
    }
    obj.floors.forEach((f, i) => ensureFloorDefaults(f, i, obj.floors.length));
    obj.openings.forEach(o => {
      if (o.overhangDepth === undefined) o.overhangDepth = 0;
      if (o.frameFactor === undefined) o.frameFactor = 0.78;
      if (o.shadingFactor === undefined) o.shadingFactor = 0.95;
    });
    return {
      proj: obj,
      msg: `Projet JSON importé : ${obj.floors.length} étage(s), ${obj.openings.length} ouverture(s).`
    };
  }

  // 2. gbXML
  if (low.endsWith('.gbxml') || low.endsWith('.xml') || text.includes('<gbXML')) {
    if (typeof DOMParser === 'undefined') {
      throw new Error('DOMParser indisponible hors navigateur pour gbXML.');
    }
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const storeys = Array.from(doc.getElementsByTagName('BuildingStorey'));
    const spaces = Array.from(doc.getElementsByTagName('Space'));
    const surfaces = Array.from(doc.getElementsByTagName('Surface'));
    const floorsMap = {};

    storeys.forEach((st, idx) => {
      const id = st.getAttribute('id') || `st_${idx}`;
      floorsMap[id] = {
        ...baseFloor,
        id,
        name: st.querySelector('Name')?.textContent || `Étage ${idx + 1}`,
        elevationZ: parseFloat(st.querySelector('Level')?.textContent) || idx * 2.8,
        area: 0,
        wallExtArea: 0,
        roofExtArea: 0,
        floorGroundArea: 0
      };
    });

    const spaceToFloor = {};
    spaces.forEach((sp, idx) => {
      const area = parseFloat(sp.querySelector('Area')?.textContent) || 50;
      const vol = parseFloat(sp.querySelector('Volume')?.textContent) || area * 2.6;
      const stRef = sp.getAttribute('buildingStoreyIdRef');
      let flId = stRef && floorsMap[stRef] ? stRef : null;
      if (!flId) {
        flId = sp.getAttribute('id') || `sp_${idx}`;
        floorsMap[flId] = {
          ...baseFloor,
          id: flId,
          name: sp.querySelector('Name')?.textContent || `Zone ${idx + 1}`,
          elevationZ: idx * 2.8,
          area: 0,
          wallExtArea: 0,
          roofExtArea: 0,
          floorGroundArea: 0
        };
      }
      floorsMap[flId].area += area;
      floorsMap[flId].height = Math.max(2.2, Math.round((vol / Math.max(1, area)) * 100) / 100);
      spaceToFloor[sp.getAttribute('id')] = flId;
    });

    if (!Object.keys(floorsMap).length) {
      floorsMap.f1 = {
        ...baseFloor,
        id: 'f1',
        name: 'Bâtiment importé',
        area: 100,
        wallExtArea: 0,
        roofExtArea: 0,
        floorGroundArea: 0
      };
    }

    const openings = [];
    const defId = Object.keys(floorsMap)[0];
    surfaces.forEach((surf, sIdx) => {
      const type = surf.getAttribute('surfaceType') || '';
      const spRef = surf.querySelector('AdjacentSpaceId')?.getAttribute('spaceIdRef');
      const fl = floorsMap[(spRef && spaceToFloor[spRef]) || defId];
      const rect = surf.querySelector('RectangularGeometry');
      const area =
        (parseFloat(rect?.querySelector('Width')?.textContent) || 0) *
        (parseFloat(rect?.querySelector('Height')?.textContent) || 0);
      const az = parseFloat(rect?.querySelector('Azimuth')?.textContent) || 180;
      const tilt = parseFloat(rect?.querySelector('Tilt')?.textContent) ?? 90;

      if (type === 'ExteriorWall') fl.wallExtArea += area;
      else if (type === 'Roof') fl.roofExtArea += area;
      else if (type === 'SlabOnGrade' || type === 'UndergroundSlab') {
        fl.floorGroundArea += area;
        fl.bFloorGround = 0.3;
      }

      Array.from(surf.getElementsByTagName('Opening')).forEach((op, oIdx) => {
        const or = op.querySelector('RectangularGeometry');
        const ow = parseFloat(or?.querySelector('Width')?.textContent) || 1.2;
        const oh = parseFloat(or?.querySelector('Height')?.textContent) || 1.4;
        const orient = tilt < 35 ? 'R' : azDegToOrient(az);
        openings.push(
          makeOpening(
            `gb_${sIdx}_${oIdx}`,
            fl.id,
            op.querySelector('Name')?.textContent || `Ouverture ${openings.length + 1}`,
            orient,
            ow,
            oh,
            1,
            1.0,
            0.6,
            0.15
          )
        );
      });
    });

    const floors = Object.values(floorsMap).map((fl, i, arr) => {
      const f = {
        ...fl,
        area: Math.max(10, Math.round(fl.area * 10) / 10),
        wallExtArea: Math.round(fl.wallExtArea * 10) / 10,
        roofExtArea: Math.round(fl.roofExtArea * 10) / 10,
        floorGroundArea: Math.round(fl.floorGroundArea * 10) / 10
      };
      ensureFloorDefaults(f, i, arr.length);
      return f;
    });

    return {
      proj: {
        name: filename.replace(/\.[^.]+$/, ''),
        projectType: 'new',
        siaCurveMode: 'fig3',
        stackCoupling: true,
        climate,
        floors,
        openings
      },
      msg: `gbXML importé : ${floors.length} étage(s), ${openings.length} ouverture(s).`
    };
  }

  // 3. IFC (STEP)
  if (low.endsWith('.ifc') || text.includes('ISO-10303-21')) {
    const scale = /IFCSIUNIT\s*\([^)]*\.LENGTHUNIT\.[^)]*\.MILLI\./i.test(text) ? 0.001 : 1.0;
    const storeys = [];
    const stRx = /#\d+\s*=\s*IFCBUILDINGSTOREY\s*\(([^;]+)\);/gi;
    let m;
    while ((m = stRx.exec(text)) !== null) {
      const p = m[1].split(',');
      const raw = parseFloat(p[p.length - 1]);
      storeys.push({
        name: (p[2] || '').replace(/'/g, '').trim() || `Étage ${storeys.length + 1}`,
        elev: Number.isNaN(raw) ? storeys.length * 2.8 : raw * scale
      });
    }
    if (!storeys.length) storeys.push({ name: 'Niveau 0 (IFC)', elev: 0 });

    const areas = [];
    const aRx = /IFCQUANTITYAREA\s*\([^,]*,[^,]*,[^,]*,([0-9.]+)\)/gi;
    while ((m = aRx.exec(text)) !== null) {
      const a = parseFloat(m[1]);
      if (a > 4 && a < 5000) areas.push(a);
    }
    const aFloor =
      Math.round(((areas.length ? areas.reduce((s, a) => s + a, 0) : storeys.length * 65) / storeys.length) * 10) /
      10;

    const floors = storeys.map((st, idx) => {
      const f = {
        ...baseFloor,
        id: `ifc_f${idx}`,
        name: st.name,
        elevationZ: Math.round(st.elev * 100) / 100,
        area: aFloor,
        height: 2.6,
        wallExtArea: Math.round(4 * Math.sqrt(aFloor) * 2.6 * 10) / 10,
        roofExtArea: idx === storeys.length - 1 ? aFloor : 0,
        floorGroundArea: idx === 0 ? aFloor : 0,
        bFloorGround: idx === 0 ? 0.3 : 0
      };
      ensureFloorDefaults(f, idx, storeys.length);
      return f;
    });

    const openings = [];
    const wRx = /#\d+\s*=\s*IFCWINDOW\s*\(([^;]+)\);/gi;
    const dirs = ['S', 'O', 'E', 'N'];
    while ((m = wRx.exec(text)) !== null) {
      const p = m[1].split(',');
      const nums = p
        .slice(-2)
        .map(x => parseFloat(x))
        .filter(x => !Number.isNaN(x));
      const h = nums[0] ? Math.max(0.4, Math.min(4, nums[0] * scale)) : 1.4;
      const w = nums[1] ? Math.max(0.4, Math.min(6, nums[1] * scale)) : 1.2;
      openings.push(
        makeOpening(
          `ifc_o${openings.length}`,
          floors[openings.length % floors.length].id,
          (p[2] || '').replace(/'/g, '').trim() || `Fenêtre ${openings.length + 1}`,
          dirs[openings.length % 4],
          Math.round(w * 100) / 100,
          Math.round(h * 100) / 100,
          1,
          1.0,
          0.6,
          0.15
        )
      );
    }

    return {
      proj: {
        name: filename.replace(/\.[^.]+$/, ''),
        projectType: 'new',
        siaCurveMode: 'fig3',
        stackCoupling: true,
        climate,
        floors,
        openings
      },
      msg: `IFC importé : ${floors.length} étage(s), ${openings.length} fenêtre(s).`
    };
  }

  // 4. EnergyPlus IDF
  if (low.endsWith('.idf') || text.includes('BuildingSurface:Detailed')) {
    const blocks = text
      .replace(/!.*$/gm, '')
      .split(';')
      .map(b => b.trim())
      .filter(Boolean);
    const zones = {};
    const s2z = {};
    const flList = [];
    const openings = [];

    const poly = pts => {
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
      }
      return { area: 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz), orient: vectorToAzTilt(nx, ny, nz) };
    };

    for (const b of blocks) {
      const f = b.split(',').map(x => x.trim());
      if (f[0].toLowerCase() === 'zone') {
        const fl = {
          ...baseFloor,
          id: `idf_${flList.length}`,
          name: f[1],
          elevationZ: flList.length * 2.8,
          area: 0,
          wallExtArea: 0,
          roofExtArea: 0,
          floorGroundArea: 0
        };
        zones[f[1]] = fl;
        flList.push(fl);
      }
    }
    if (!flList.length) {
      const fl = {
        ...baseFloor,
        id: 'idf_0',
        name: 'Zone IDF',
        area: 60,
        wallExtArea: 0,
        roofExtArea: 0,
        floorGroundArea: 0
      };
      zones['Zone IDF'] = fl;
      flList.push(fl);
    }

    for (const b of blocks) {
      const f = b.split(',').map(x => x.trim());
      if (f[0].toLowerCase() === 'buildingsurface:detailed') {
        const fl = zones[f[4]] || flList[0];
        s2z[f[1]] = fl.id;
        const pts = extractIdfVertices(f, 11);
        const g = pts.length >= 3 ? poly(pts) : { area: 0 };
        const st = (f[2] || '').toLowerCase();
        const bc = (f[5] || '').toLowerCase();
        if (st === 'wall' && bc === 'outdoors') fl.wallExtArea += g.area;
        else if (st === 'roof' && bc === 'outdoors') fl.roofExtArea += g.area;
        else if (st === 'floor') {
          fl.area += g.area;
          if (bc === 'ground') {
            fl.floorGroundArea += g.area;
            fl.bFloorGround = 0.3;
          }
        }
      }
    }

    for (const b of blocks) {
      const f = b.split(',').map(x => x.trim());
      if (f[0].toLowerCase() === 'fenestrationsurface:detailed') {
        const pts = extractIdfVertices(f, 10);
        if (pts.length >= 3) {
          const g = poly(pts);
          const zs = pts.map(p => p[2]);
          const h = Math.max(0.4, Math.max(...zs) - Math.min(...zs));
          const w = Math.max(0.4, g.area / h);
          openings.push(
            makeOpening(
              `idf_o${openings.length}`,
              s2z[f[4]] || flList[0].id,
              f[1],
              g.orient === 'F' ? 'S' : g.orient,
              Math.round(w * 100) / 100,
              Math.round(h * 100) / 100,
              1,
              1.0,
              0.6,
              0.15
            )
          );
        }
      }
    }

    flList.forEach((fl, i) => {
      fl.area = Math.max(10, Math.round(fl.area * 10) / 10);
      fl.wallExtArea = Math.round(fl.wallExtArea * 10) / 10;
      fl.roofExtArea = Math.round(fl.roofExtArea * 10) / 10;
      fl.floorGroundArea = Math.round(fl.floorGroundArea * 10) / 10;
      ensureFloorDefaults(fl, i, flList.length);
    });

    return {
      proj: {
        name: filename.replace(/\.[^.]+$/, ''),
        projectType: 'new',
        siaCurveMode: 'fig3',
        stackCoupling: true,
        climate,
        floors: flList,
        openings
      },
      msg: `IDF importé : ${flList.length} zone(s), ${openings.length} ouverture(s).`
    };
  }

  throw new Error('Format non reconnu (.json, .gbxml, .ifc ou .idf).');
}
