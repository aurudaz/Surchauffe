import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    let relPath = decodeURIComponent(reqUrl.pathname);

    // Proxy météo sécurisé (liste blanche stricte : PVGIS 5.3 & MétéoSuisse OGD) pour éviter le blocage CORS navigateur
    if (relPath === '/api/pvgis') {
      const lat = Math.max(-90, Math.min(90, Number(reqUrl.searchParams.get('lat')) || 46.22));
      const lon = Math.max(-180, Math.min(180, Number(reqUrl.searchParams.get('lon')) || 7.33));
      const type = String(reqUrl.searchParams.get('type') || 'tmy');
      const base = 'https://re.jrc.ec.europa.eu/api/v5_3/';
      const upstream =
        type === 'tmy'
          ? `${base}tmy?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&outputformat=json`
          : `${base}seriescalc?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&startyear=${encodeURIComponent(type)}&endyear=${encodeURIComponent(type)}&angle=0&components=1&outputformat=json`;
      const upResp = await fetch(upstream);
      const body = await upResp.text();
      res.writeHead(upResp.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(body);
      return;
    }

    if (relPath === '/api/meteoswiss') {
      const stnRaw = String(reqUrl.searchParams.get('stn') || 'sio').toLowerCase();
      if (!/^[a-z]{3}$/.test(stnRaw)) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Code station invalide');
        return;
      }
      const candidates = [
        `https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/${stnRaw}/ogd-smn_${stnRaw}_h_historical_2020-2029.csv`,
        `https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/${stnRaw}/ogd-smn_${stnRaw}_h_recent.csv`
      ];
      for (const url of candidates) {
        const upResp = await fetch(url);
        if (upResp.ok) {
          const body = await upResp.text();
          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Cache-Control': 'no-store'
          });
          res.end(body);
          return;
        }
      }
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Données MétéoSuisse OGD indisponibles pour cette station.');
      return;
    }

    if (relPath === '/') relPath = '/index.html';

    const resolved = path.resolve(ROOT_DIR, '.' + relPath);
    if (!resolved.startsWith(ROOT_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }

    const stat = await fs.stat(resolved).catch(() => null);
    const targetFile = stat && stat.isDirectory() ? path.join(resolved, 'index.html') : resolved;
    const data = await fs.readFile(targetFile);
    const ext = path.extname(targetFile).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0'
    });
    res.end(data);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SIA Thermic Studio disponible sur http://${HOST}:${PORT}`);
});
