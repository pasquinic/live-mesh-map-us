'use strict';
// Counties bordering the configured county (from the outlines of the ~3,200 US counties, FIPS codes)
// → "county + neighbours" area: codes, names and bounding box.
// Internal names keep the French edition's vocabulary ("département" = county, "région" = state).
const fs = require('fs');
const path = require('path');
let cacheComtes = null;
function lireComtes() {
  if (!cacheComtes) cacheComtes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'donnees-ref', 'departements.geojson'), 'utf8'));
  return cacheComtes;
}

function anneaux(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return geom.coordinates;
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat();
  return [];
}
function rectangle(f) {
  let s = 90, o = 180, n = -90, e = -180;
  for (const a of anneaux(f.geometry)) for (const [lon, lat] of a) { if (lat < s) s = lat; if (lat > n) n = lat; if (lon < o) o = lon; if (lon > e) e = lon; }
  return [s, o, n, e];
}

function calculerVoisins(code, zoneDep) {
  let d;
  try { d = lireComtes(); } catch { return null; }
  const feats = d.features || [];
  const dep = feats.find((f) => String(f.properties.code) === String(code));
  if (!dep) return null;
  const rDep = rectangle(dep);
  // Points du contour du département, sur une grille de ~1 km pour comparer vite
  const cle = (lon, lat) => `${Math.round(lon * 100)},${Math.round(lat * 100)}`;
  const grille = new Set();
  for (const a of anneaux(dep.geometry)) for (const [lon, lat] of a) grille.add(cle(lon, lat));
  const touche = (f) => {
    for (const a of anneaux(f.geometry)) for (const [lon, lat] of a) {
      const x = Math.round(lon * 100), y = Math.round(lat * 100);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (grille.has(`${x + i},${y + j}`)) return true;
    }
    return false;
  };
  const voisins = feats.filter((f) => {
    if (f === dep) return false;
    const r = rectangle(f);
    if (r[0] > rDep[2] + 0.05 || r[2] < rDep[0] - 0.05 || r[1] > rDep[3] + 0.05 || r[3] < rDep[1] - 0.05) return false;
    return touche(f);
  });
  const bbox = [...(zoneDep || rDep)];
  for (const f of voisins) { const r = rectangle(f); bbox[0] = Math.min(bbox[0], r[0]); bbox[1] = Math.min(bbox[1], r[1]); bbox[2] = Math.max(bbox[2], r[2]); bbox[3] = Math.max(bbox[3], r[3]); }
  return {
    bbox: bbox.map((v) => Math.round(v * 1000) / 1000),
    departements: voisins.map((f) => ({ code: String(f.properties.code), nom: f.properties.nom })).sort((a, b) => a.code.localeCompare(b.code)),
  };
}

// States: counties of each state and bounding box (computed from the county outlines).
// Code = 2-digit state FIPS (e.g. 04 = Arizona), the same "?zone=r04" parameter as the French regions.
let cacheRegions = null;
function calculerRegions() {
  if (cacheRegions) return cacheRegions;
  let d, etats = {};
  try { d = lireComtes(); } catch { return []; }
  try { etats = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'donnees-ref', 'etats.json'), 'utf8')); } catch { /* names optional */ }
  const parEtat = new Map();
  for (const f of d.features || []) {
    const s = String(f.properties.etat || String(f.properties.code).slice(0, 2));
    if (!parEtat.has(s)) parEtat.set(s, { code: s, nom: (etats[s] && etats[s].nom) || f.properties.etatNom || s, departements: [], bbox: [90, 180, -90, -180] });
    const e = parEtat.get(s), r = rectangle(f);
    e.departements.push(String(f.properties.code));
    // Alaska's Aleutians cross the antimeridian: keep the box on the western side
    if (r[3] - r[1] > 180) continue;
    e.bbox[0] = Math.min(e.bbox[0], r[0]); e.bbox[1] = Math.min(e.bbox[1], r[1]); e.bbox[2] = Math.max(e.bbox[2], r[2]); e.bbox[3] = Math.max(e.bbox[3], r[3]);
  }
  cacheRegions = [...parEtat.values()].sort((a, b) => a.nom.localeCompare(b.nom)).map((e) => ({ ...e, bbox: e.bbox.map((v) => Math.round(v * 1000) / 1000) }));
  return cacheRegions;
}
// State of a county code (FIPS 5 digits → 2 first digits)
const etatDuComte = (code) => (/^\d{5}$/.test(String(code)) ? String(code).slice(0, 2) : null);

module.exports = { calculerVoisins, calculerRegions, etatDuComte, lireComtes };
