/**
 * @fileoverview Visualisation 3D interactive en fil de fer (Canvas pur sans dépendance)
 * affichant la géométrie des étages, les orientations cardinales, les vitrages et les casquettes.
 */

import { ORIENTATIONS } from '../standards/sia380-1.js';

const DEG2RAD = Math.PI / 180;

function cssVar(n) {
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
}

export class BuildingViewer3D {
  constructor(canvasId) {
    this.canvasId = canvasId;
    this.yaw = -38;
    this.pitch = 24;
    this.zoom = 1.0;
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.project = null;
    this.activeFloorId = null;
    this._bindInteraction();
  }

  _bindInteraction() {
    const c = document.getElementById(this.canvasId);
    if (!c) return;

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
      this.yaw += dx * 0.6;
      this.pitch = Math.max(-10, Math.min(85, this.pitch + dy * 0.45));
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
        this.zoom = Math.max(0.55, Math.min(2.2, this.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
        this.render();
      },
      { passive: false }
    );
  }

  setView(preset) {
    if (preset === 'iso') {
      this.yaw = -38;
      this.pitch = 24;
      this.zoom = 1.0;
    } else if (preset === 'front') {
      this.yaw = 0;
      this.pitch = 8;
      this.zoom = 1.05;
    } else if (preset === 'top') {
      this.yaw = 0;
      this.pitch = 82;
      this.zoom = 1.0;
    }
    this.render();
  }

  update(project, activeFloorId) {
    this.project = project;
    this.activeFloorId = activeFloorId;
    this.render();
  }

  render() {
    const c = document.getElementById(this.canvasId);
    if (!c || !c.parentElement || !this.project) return;

    const rect = c.parentElement.getBoundingClientRect();
    const w = Math.max(260, Math.floor(rect.width));
    const h = Math.max(210, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;

    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Fond type studio thermique (sombre contrasté pour lisibilité fil de fer)
    const isLight = document.documentElement.dataset.theme === 'light';
    ctx.fillStyle = isLight ? '#161b22' : '#0b0c0e';
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

    const maxSpan = Math.max(
      4,
      ...dims.map(d => Math.max(d.dx, d.dy)),
      Math.max(...dims.map(d => d.z0 + d.dz)) - Math.min(...dims.map(d => d.z0))
    );
    const centerZ =
      0.5 * (Math.min(...dims.map(d => d.z0)) + Math.max(...dims.map(d => d.z0 + d.dz)));

    const scale = (Math.min(w, h) * 0.56 * this.zoom) / maxSpan;
    const yawR = this.yaw * DEG2RAD;
    const pitchR = this.pitch * DEG2RAD;
    const cy = Math.cos(yawR);
    const sy = Math.sin(yawR);
    const cp = Math.cos(pitchR);
    const sp = Math.sin(pitchR);

    // Système monde : +X = Est, +Y = Nord, +Z = Haut
    const projectPt = (wx, wy, wz) => {
      const zc = wz - centerZ;
      const rx = wx * cy - wy * sy;
      const ry = wx * sy + wy * cy;
      const y2 = ry * cp - zc * sp;
      const z2 = ry * sp + zc * cp;
      const persp = 1 / (1 - y2 / (maxSpan * 4.5));
      return {
        x: w * 0.5 + rx * scale * persp,
        y: h * 0.52 - z2 * scale * persp,
        depth: y2
      };
    };

    const drawLine3D = (a, b, col, lw = 1.4, dash = []) => {
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

    // Grille de sol & boussole cardinale (N/E/S/O)
    const gHalf = Math.ceil(maxSpan * 0.75);
    const zBase = dims[0].z0;
    for (let g = -gHalf; g <= gHalf; g += Math.max(1, Math.round(gHalf / 3))) {
      drawLine3D([g, -gHalf, zBase], [g, gHalf, zBase], 'rgba(255,255,255,0.06)', 1);
      drawLine3D([-gHalf, g, zBase], [gHalf, g, zBase], 'rgba(255,255,255,0.06)', 1);
    }

    const compassR = gHalf + 1.1;
    const dirs = [
      ['N', 0, compassR, '#81c995'],
      ['S', 0, -compassR, '#fdd663'],
      ['E', compassR, 0, '#9aa0a6'],
      ['O', -compassR, 0, '#9aa0a6']
    ];
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    for (const [lbl, cx, cy2, col] of dirs) {
      const p = projectPt(cx, cy2, zBase);
      ctx.fillStyle = col;
      ctx.fillText(lbl, p.x, p.y + 4);
    }

    // Dessin de chaque étage et de ses fenêtres
    for (const d of dims) {
      const isAct = d.fl.id === this.activeFloorId;
      const hx = d.dx / 2;
      const hy = d.dy / 2;
      const z0 = d.z0;
      const z1 = d.z0 + d.dz;

      // Rotation selon frontAz (si frontAz = 180° Sud, local +X = Est, local -Y = Sud)
      const rotAng = (180 - d.frontAz) * DEG2RAD;
      const cr = Math.cos(rotAng);
      const sr = Math.sin(rotAng);
      const toWorld = (lx, ly, lz) => [lx * cr - ly * sr, lx * sr + ly * cr, lz];

      const corners = [
        toWorld(-hx, -hy, z0),
        toWorld(hx, -hy, z0),
        toWorld(hx, hy, z0),
        toWorld(-hx, hy, z0),
        toWorld(-hx, -hy, z1),
        toWorld(hx, -hy, z1),
        toWorld(hx, hy, z1),
        toWorld(-hx, hy, z1)
      ];

      // Remplissage léger de la face avant pour repère visuel
      const pF = [0, 1, 5, 4].map(i => projectPt(...corners[i]));
      ctx.fillStyle = isAct ? 'rgba(242, 139, 130, 0.09)' : 'rgba(168, 199, 250, 0.04)';
      ctx.beginPath();
      pF.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();

      const edgeCol = isAct ? '#e57373' : '#6f8fb8';
      const lw = isAct ? 1.8 : 1.1;
      const edges = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7]
      ];
      for (const [i, j] of edges) {
        drawLine3D(corners[i], corners[j], edgeCol, lw);
      }

      // Fenêtres associées à l'étage
      const ops = this.project.openings.filter(o => o.floorId === d.fl.id);
      const byOrient = {};
      for (const op of ops) {
        if (!byOrient[op.orient]) byOrient[op.orient] = [];
        byOrient[op.orient].push(op);
      }

      for (const [orient, list] of Object.entries(byOrient)) {
        const g = ORIENTATIONS[orient] || ORIENTATIONS.S;
        if (orient === 'R') {
          // Fenêtres de toit sur la face supérieure
          list.forEach((op, idx) => {
            const ow = Math.min(d.dx * 0.6, op.width);
            const oh = Math.min(d.dy * 0.6, op.height);
            const off = (idx - (list.length - 1) / 2) * (ow + 0.3);
            const rPts = [
              toWorld(off - ow / 2, -oh / 2, z1 + 0.02),
              toWorld(off + ow / 2, -oh / 2, z1 + 0.02),
              toWorld(off + ow / 2, oh / 2, z1 + 0.02),
              toWorld(off - ow / 2, oh / 2, z1 + 0.02)
            ];
            for (let k = 0; k < 4; k++) {
              drawLine3D(rPts[k], rPts[(k + 1) % 4], '#4dd0e1', 2.0);
            }
          });
          continue;
        }

        // Vecteur normal sortant de l'orientation dans le plan X(Est)-Y(Nord)
        const azR = g.az * DEG2RAD;
        const nx = Math.sin(azR);
        const ny = Math.cos(azR);
        const tx = Math.cos(azR);
        const ty = -Math.sin(azR);

        // Distance au bord de la boîte projetée sur (nx, ny)
        const distWall = Math.abs(nx * cr + ny * sr) * hx + Math.abs(-nx * sr + ny * cr) * hy;
        const wallLen = Math.abs(tx * cr + ty * sr) * d.dx + Math.abs(-tx * sr + ty * cr) * d.dy;

        const totalWinW = list.reduce((s, o) => s + o.width * o.qty, 0);
        let cursor = -Math.min(wallLen * 0.85, totalWinW) / 2;

        for (const op of list) {
          for (let q = 0; q < op.qty; q++) {
            const ow = Math.min(wallLen * 0.85, op.width);
            const oh = Math.min(d.dz - 0.15, op.height);
            const wz0 = z0 + Math.min(d.dz - oh - 0.05, Math.max(0.05, op.sillHeight ?? 0.9));
            const wz1 = wz0 + oh;
            const c0 = cursor;
            const c1 = cursor + ow;
            cursor += ow + 0.25;

            const p00 = [nx * distWall + tx * c0, ny * distWall + ty * c0, wz0];
            const p10 = [nx * distWall + tx * c1, ny * distWall + ty * c1, wz0];
            const p11 = [nx * distWall + tx * c1, ny * distWall + ty * c1, wz1];
            const p01 = [nx * distWall + tx * c0, ny * distWall + ty * c0, wz1];

            drawLine3D(p00, p10, '#4dd0e1', 2.2);
            drawLine3D(p10, p11, '#4dd0e1', 2.2);
            drawLine3D(p11, p01, '#4dd0e1', 2.2);
            drawLine3D(p01, p00, '#4dd0e1', 2.2);

            // Casquette / avant-toit en ambre si > 0
            if ((op.overhangDepth || 0) > 0.05) {
              const od = op.overhangDepth;
              const q0 = [p01[0] + nx * od, p01[1] + ny * od, wz1];
              const q1 = [p11[0] + nx * od, p11[1] + ny * od, wz1];
              drawLine3D(p01, q0, '#fdd663', 1.6);
              drawLine3D(p11, q1, '#fdd663', 1.6);
              drawLine3D(q0, q1, '#fdd663', 1.6);
            }
          }
        }
      }
    }

    // Légende et dimensions en surimpression
    const actDim = dims.find(d => d.fl.id === this.activeFloorId) || dims[0];
    ctx.font = '11px "Roboto Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e3e3e3';
    ctx.fillText(
      `${actDim.fl.name} : ${actDim.dx.toFixed(1)} × ${actDim.dy.toFixed(1)} × ${actDim.dz.toFixed(2)} m (${(actDim.dx * actDim.dy).toFixed(1)} m²)`,
      10,
      18
    );
    ctx.font = '10.5px Inter, sans-serif';
    ctx.fillStyle = '#9aa0a6';
    ctx.fillText('Glisser pour pivoter • Molette pour zoomer • Cyan = vitrages • Jaune = casquettes', 10, h - 8);
  }
}
