/**
 * @fileoverview Visualisation 3D architecturale interactive (axonométrique / isométrique sans déformation)
 * affichant les volumes des étages avec ombrage des faces, vitrages, casquettes, écrans latéraux et boussole.
 */

import { ORIENTATIONS } from '../standards/sia380-1.js';

const DEG2RAD = Math.PI / 180;

export class BuildingViewer3D {
  constructor(canvasId) {
    this.canvasId = canvasId;
    this.yaw = -35;
    this.pitch = 26;
    this.zoom = 1.0;
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.project = null;
    this.activeFloorId = null;
    this._boundCanvas = null;
    this._resizeObserver = null;
    this._ensureBound();
  }

  _ensureBound() {
    const c = document.getElementById(this.canvasId);
    if (!c || this._boundCanvas === c) return c;
    this._boundCanvas = c;
    c.style.touchAction = 'none';

    c.addEventListener('pointerdown', e => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      c.setPointerCapture?.(e.pointerId);
    });

    c.addEventListener('pointermove', e => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw += dx * 0.55;
      this.pitch = Math.max(4, Math.min(86, this.pitch + dy * 0.45));
      this.render();
    });

    const stop = () => {
      this.dragging = false;
    };
    c.addEventListener('pointerup', stop);
    c.addEventListener('pointercancel', stop);

    c.addEventListener(
      'wheel',
      e => {
        e.preventDefault();
        this.zoom = Math.max(0.6, Math.min(2.2, this.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
        this.render();
      },
      { passive: false }
    );

    if (typeof ResizeObserver !== 'undefined' && c.parentElement) {
      this._resizeObserver?.disconnect();
      this._resizeObserver = new ResizeObserver(() => {
        if (this.project && c.isConnected) this.render();
      });
      this._resizeObserver.observe(c.parentElement);
    }
    return c;
  }

  setView(preset) {
    if (preset === 'iso') {
      this.yaw = -35;
      this.pitch = 26;
      this.zoom = 1.0;
    } else if (preset === 'front') {
      this.yaw = 0;
      this.pitch = 6;
      this.zoom = 1.05;
    } else if (preset === 'top') {
      this.yaw = 0;
      this.pitch = 85;
      this.zoom = 1.0;
    }
    this.render();
  }

  update(project, activeFloorId) {
    this.project = project;
    this.activeFloorId = activeFloorId;
    this._ensureBound();
    this.render();
  }

  render() {
    const c = this._ensureBound();
    if (!c || !c.parentElement || !this.project) return;

    const rect = c.parentElement.getBoundingClientRect();
    // Respecte exactement le ratio du conteneur pour éviter tout écrasement vertical/horizontal
    const w = Math.max(120, Math.round(rect.width) || 268);
    const h = Math.max(120, Math.round(rect.height) || 185);
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;

    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const isLight = document.documentElement.dataset.theme === 'light';
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    if (isLight) {
      bgGrad.addColorStop(0, '#1c232d');
      bgGrad.addColorStop(1, '#12171e');
    } else {
      bgGrad.addColorStop(0, '#14171c');
      bgGrad.addColorStop(1, '#0b0d10');
    }
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    const floors = [...this.project.floors].sort((a, b) => a.elevationZ - b.elevationZ);
    if (!floors.length) return;

    const dims = floors.map(fl => {
      const dx = fl.box3d?.dimX || Math.round(Math.sqrt(Math.max(4, fl.area)) * 10) / 10;
      const dy = fl.box3d?.dimY || Math.max(1.5, fl.area / dx);
      return {
        fl,
        dx,
        dy,
        dz: fl.height || 2.6,
        z0: fl.elevationZ || 0,
        frontAz: (ORIENTATIONS[fl.box3d?.frontOrient || 'S'] || ORIENTATIONS.S).az
      };
    });

    const maxHoriz = Math.max(4, ...dims.map(d => Math.hypot(d.dx, d.dy)));
    const minZ = Math.min(...dims.map(d => d.z0));
    const maxZ = Math.max(...dims.map(d => d.z0 + d.dz));
    const totalZ = Math.max(2.5, maxZ - minZ);
    const centerZ = 0.5 * (minZ + maxZ);

    const yawR = this.yaw * DEG2RAD;
    const pitchR = this.pitch * DEG2RAD;
    const cy = Math.cos(yawR);
    const sy = Math.sin(yawR);
    const cp = Math.cos(pitchR);
    const sp = Math.sin(pitchR);

    // Échelle axonométrique pure (aucune déformation de perspective, verticales 100 % parallèles)
    const projHeightSpan = maxHoriz * sp + totalZ * cp;
    const availW = Math.max(80, w - 46);
    const availH = Math.max(70, h - 54);
    const scale = Math.min(availW / maxHoriz, availH / Math.max(3, projHeightSpan)) * 0.88 * this.zoom;

    // Système monde : +X = Est, +Y = Nord, +Z = Haut
    // depth > 0 = éloigné de la caméra, depth < 0 = proche de la caméra
    const projectPt = (wx, wy, wz) => {
      const zc = wz - centerZ;
      const rx = wx * cy - wy * sy;
      const ry = wx * sy + wy * cy;
      const depth = ry * cp - zc * sp;
      const zScreen = ry * sp + zc * cp;
      return {
        x: w * 0.5 + rx * scale,
        y: h * 0.52 - zScreen * scale,
        depth
      };
    };

    const drawLine3D = (a, b, col, lw = 1.3, dash = []) => {
      const p1 = projectPt(a[0], a[1], a[2]);
      const p2 = projectPt(b[0], b[1], b[2]);
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    const fillPoly3D = (pts3d, fillCol, strokeCol = null, lw = 1.2) => {
      const p2d = pts3d.map(pt => projectPt(pt[0], pt[1], pt[2]));
      ctx.beginPath();
      p2d.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      if (fillCol) {
        ctx.fillStyle = fillCol;
        ctx.fill();
      }
      if (strokeCol) {
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
    };

    // Grille de sol & boussole cardinale (N/E/S/O)
    const maxSide = Math.max(4, ...dims.map(d => Math.max(d.dx, d.dy)));
    const gHalf = Math.ceil(maxSide * 0.7);
    const stepG = Math.max(1, Math.round(gHalf / 3));
    for (let g = -gHalf; g <= gHalf; g += stepG) {
      drawLine3D([g, -gHalf, minZ], [g, gHalf, minZ], 'rgba(255,255,255,0.06)', 1);
      drawLine3D([-gHalf, g, minZ], [gHalf, g, minZ], 'rgba(255,255,255,0.06)', 1);
    }

    const compassR = gHalf + Math.max(0.9, maxSide * 0.14);
    const dirs = [
      ['N', 0, compassR, '#81c995'],
      ['S', 0, -compassR, '#fdd663'],
      ['E', compassR, 0, '#9aa0a6'],
      ['O', -compassR, 0, '#9aa0a6']
    ];
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    for (const [lbl, cx, cy2, col] of dirs) {
      drawLine3D([0, 0, minZ], [cx * 0.85, cy2 * 0.85, minZ], 'rgba(255,255,255,0.08)', 1);
      const p = projectPt(cx, cy2, minZ);
      ctx.fillStyle = col;
      ctx.fillText(lbl, p.x, p.y + 4);
    }

    // Construction des faces 3D de chaque étage (algorithme du peintre : de l'arrière vers l'avant)
    for (const d of dims) {
      const isAct = d.fl.id === this.activeFloorId;
      const hx = d.dx / 2;
      const hy = d.dy / 2;
      const z0 = d.z0;
      const z1 = d.z0 + d.dz;

      const rotAng = (180 - d.frontAz) * DEG2RAD;
      const cr = Math.cos(rotAng);
      const sr = Math.sin(rotAng);
      const toWorld = (lx, ly, lz) => [lx * cr - ly * sr, lx * sr + ly * cr, lz];

      const C = [
        toWorld(-hx, -hy, z0), // 0: Sud-Ouest bas
        toWorld(hx, -hy, z0),  // 1: Sud-Est bas
        toWorld(hx, hy, z0),   // 2: Nord-Est bas
        toWorld(-hx, hy, z0),  // 3: Nord-Ouest bas
        toWorld(-hx, -hy, z1), // 4: Sud-Ouest haut
        toWorld(hx, -hy, z1),  // 5: Sud-Est haut
        toWorld(hx, hy, z1),   // 6: Nord-Est haut
        toWorld(-hx, hy, z1)   // 7: Nord-Ouest haut
      ];

      // Préparation des fenêtres par orientation pour les rattacher à leur façade
      const ops = this.project.openings.filter(o => o.floorId === d.fl.id);
      const byOrient = {};
      for (const op of ops) {
        if (!byOrient[op.orient]) byOrient[op.orient] = [];
        byOrient[op.orient].push(op);
      }

      // Les 6 faces du prisme avec leurs couleurs de remplissage nuancées
      const edgeCol = isAct ? '#7baaf7' : '#526b8e';
      const lw = isAct ? 1.6 : 1.1;
      const faces = [
        {
          key: 'floor',
          verts: [C[0], C[1], C[2], C[3]],
          fill: isAct ? 'rgba(66, 133, 244, 0.10)' : 'rgba(111, 143, 184, 0.05)'
        },
        {
          key: 'ceiling',
          verts: [C[4], C[5], C[6], C[7]],
          fill: isAct ? 'rgba(168, 199, 250, 0.16)' : 'rgba(111, 143, 184, 0.08)'
        },
        {
          key: 'front', // -Y local (Sud si frontAz=180)
          verts: [C[0], C[1], C[5], C[4]],
          fill: isAct ? 'rgba(138, 180, 248, 0.17)' : 'rgba(111, 143, 184, 0.09)'
        },
        {
          key: 'right', // +X local (Est si frontAz=180)
          verts: [C[1], C[2], C[6], C[5]],
          fill: isAct ? 'rgba(102, 157, 246, 0.13)' : 'rgba(111, 143, 184, 0.07)'
        },
        {
          key: 'back', // +Y local (Nord)
          verts: [C[2], C[3], C[7], C[6]],
          fill: isAct ? 'rgba(66, 133, 244, 0.10)' : 'rgba(111, 143, 184, 0.05)'
        },
        {
          key: 'left', // -X local (Ouest)
          verts: [C[3], C[0], C[4], C[7]],
          fill: isAct ? 'rgba(102, 157, 246, 0.13)' : 'rgba(111, 143, 184, 0.07)'
        }
      ];

      // Calcul de la profondeur moyenne de chaque face pour tri arrière → avant
      for (const f of faces) {
        const cx = (f.verts[0][0] + f.verts[1][0] + f.verts[2][0] + f.verts[3][0]) / 4;
        const cy2 = (f.verts[0][1] + f.verts[1][1] + f.verts[2][1] + f.verts[3][1]) / 4;
        const cz = (f.verts[0][2] + f.verts[1][2] + f.verts[2][2] + f.verts[3][2]) / 4;
        f.depth = projectPt(cx, cy2, cz).depth;
      }

      // Éléments vitrés & casquettes avec leur profondeur pour tri conjoint avec les parois
      const winDrawables = [];
      for (const [orient, list] of Object.entries(byOrient)) {
        const g = ORIENTATIONS[orient] || ORIENTATIONS.S;
        if (orient === 'R') {
          list.forEach((op, idx) => {
            const ow = Math.min(d.dx * 0.65, op.width);
            const oh = Math.min(d.dy * 0.65, op.height);
            const span = list.length * ow + Math.max(0, list.length - 1) * 0.25;
            const scaleFit = span > d.dx * 0.85 ? (d.dx * 0.85) / span : 1;
            const wEff = ow * scaleFit;
            const off = (idx - (list.length - 1) / 2) * (wEff + 0.25 * scaleFit);
            const rPts = [
              toWorld(off - wEff / 2, -oh / 2, z1 + 0.01),
              toWorld(off + wEff / 2, -oh / 2, z1 + 0.01),
              toWorld(off + wEff / 2, oh / 2, z1 + 0.01),
              toWorld(off - wEff / 2, oh / 2, z1 + 0.01)
            ];
            const mid = toWorld(off, 0, z1 + 0.02);
            winDrawables.push({
              depth: projectPt(mid[0], mid[1], mid[2]).depth - 0.02,
              draw: () => fillPoly3D(rPts, 'rgba(77, 208, 225, 0.34)', '#4dd0e1', 1.8)
            });
          });
          continue;
        }

        const azR = g.az * DEG2RAD;
        const nx = Math.sin(azR);
        const ny = Math.cos(azR);
        const tx = Math.cos(azR);
        const ty = -Math.sin(azR);

        const distWall = Math.abs(nx * cr + ny * sr) * hx + Math.abs(-nx * sr + ny * cr) * hy;
        const wallLen = Math.abs(tx * cr + ty * sr) * d.dx + Math.abs(-tx * sr + ty * cr) * d.dy;

        // Ajustement automatique pour que l'ensemble des fenêtres reste centré dans la paroi
        const rawTotalCount = list.reduce((s, o) => s + Math.max(1, o.qty), 0);
        const rawTotalW = list.reduce((s, o) => s + o.width * Math.max(1, o.qty), 0);
        const gapBase = 0.22;
        const rawSpan = rawTotalW + Math.max(0, rawTotalCount - 1) * gapBase;
        const maxAllowedSpan = wallLen * 0.88;
        const fitRatio = rawSpan > maxAllowedSpan && rawSpan > 0 ? maxAllowedSpan / rawSpan : 1.0;

        let cursor = -Math.min(maxAllowedSpan, rawSpan) / 2;

        for (const op of list) {
          const qty = Math.max(1, op.qty);
          for (let q = 0; q < qty; q++) {
            const ow = op.width * fitRatio;
            const gap = gapBase * fitRatio;
            const oh = Math.min(d.dz - 0.18, op.height);
            const wz0 = z0 + Math.min(d.dz - oh - 0.06, Math.max(0.06, op.sillHeight ?? 0.85));
            const wz1 = wz0 + oh;
            const c0 = cursor;
            const c1 = cursor + ow;
            cursor += ow + gap;

            const p00 = [nx * distWall + tx * c0, ny * distWall + ty * c0, wz0];
            const p10 = [nx * distWall + tx * c1, ny * distWall + ty * c1, wz0];
            const p11 = [nx * distWall + tx * c1, ny * distWall + ty * c1, wz1];
            const p01 = [nx * distWall + tx * c0, ny * distWall + ty * c0, wz1];
            const midW = [
              nx * (distWall + 0.02) + tx * ((c0 + c1) * 0.5),
              ny * (distWall + 0.02) + ty * ((c0 + c1) * 0.5),
              0.5 * (wz0 + wz1)
            ];

            winDrawables.push({
              depth: projectPt(midW[0], midW[1], midW[2]).depth,
              draw: () => {
                fillPoly3D([p00, p10, p11, p01], 'rgba(77, 208, 225, 0.30)', '#4dd0e1', 1.8);
                // Malloc central discret pour réalisme menuiserie
                const pm0 = [(p00[0] + p10[0]) * 0.5, (p00[1] + p10[1]) * 0.5, wz0];
                const pm1 = [(p01[0] + p11[0]) * 0.5, (p01[1] + p11[1]) * 0.5, wz1];
                drawLine3D(pm0, pm1, 'rgba(77, 208, 225, 0.55)', 1.0);

                if ((op.overhangDepth || 0) > 0.05) {
                  const od = op.overhangDepth;
                  const q0 = [p01[0] + nx * od, p01[1] + ny * od, wz1];
                  const q1 = [p11[0] + nx * od, p11[1] + ny * od, wz1];
                  fillPoly3D([p01, p11, q1, q0], 'rgba(253, 214, 99, 0.35)', '#fdd663', 1.4);
                }
              }
            });
          }
        }
      }

      const allItems = [
        ...faces.map(f => ({
          depth: f.depth,
          draw: () => fillPoly3D(f.verts, f.fill, edgeCol, lw)
        })),
        ...winDrawables
      ].sort((a, b) => b.depth - a.depth);

      for (const item of allItems) {
        item.draw();
      }
    }

    // Légende et dimensions en surimpression
    const actDim = dims.find(d => d.fl.id === this.activeFloorId) || dims[0];
    ctx.font = '11px "Roboto Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e3e3e3';
    ctx.fillText(
      `${actDim.fl.name} : ${actDim.dx.toFixed(1)} × ${actDim.dy.toFixed(1)} × ${actDim.dz.toFixed(2)} m (${(actDim.dx * actDim.dy).toFixed(0)} m²)`,
      10,
      17
    );
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = '#9aa0a6';
    ctx.fillText('Glisser : pivoter • Molette : zoom • Bleu = vitrages • Jaune = casquettes', 10, h - 7);
  }
}
