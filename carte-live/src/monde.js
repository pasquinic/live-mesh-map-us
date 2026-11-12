'use strict';
// Relief hors de France : modèle Copernicus DEM GLO-30 (ESA, 30 m, monde entier), en accès libre sur AWS.
// Les zones d'étude hors de France sont des carrés de 1° × 1°, nommés d'après leur coin sud-ouest :
// « MN40W075 » = 40° à 41° N, 75° à 74° O. Une marge de 0,4° (≈ 44 km) les entoure pour que la couverture
// d'un point proche du bord ne soit pas tronquée.
const { fromUrl } = require('geotiff');

const RE_CODE = /^M([NS])(\d{2})([EW])(\d{3})$/;
const MARGE_MONDE = 0.4;
const pad = (n, l) => String(Math.abs(n)).padStart(l, '0');

const estCodeMonde = (code) => RE_CODE.test(String(code || '').toUpperCase());
function codeMonde(lat, lon) {
  const la = Math.floor(lat), lo = Math.floor(lon);
  return `M${la >= 0 ? 'N' : 'S'}${pad(la, 2)}${lo >= 0 ? 'E' : 'W'}${pad(lo, 3)}`;
}
// [sud, ouest, nord, est]
function rectangleMonde(code) {
  const m = RE_CODE.exec(String(code || '').toUpperCase());
  if (!m) return null;
  const sud = (m[1] === 'N' ? 1 : -1) * Number(m[2]), ouest = (m[3] === 'E' ? 1 : -1) * Number(m[4]);
  return [sud, ouest, sud + 1, ouest + 1];
}
function contourMonde(code) {
  const r = rectangleMonde(code);
  if (!r) return null;
  const [s, o, n, e] = r;
  return { type: 'Polygon', coordinates: [[[o, s], [e, s], [e, n], [o, n], [o, s]]] };
}
const deg = (v, pos, neg) => `${Math.abs(v)}°${v >= 0 ? pos : neg}`;
function nomMonde(code) {
  const r = rectangleMonde(code);
  if (!r) return null;
  return `${deg(r[0], 'N', 'S')}–${deg(r[2], 'N', 'S')} · ${deg(r[1], 'E', 'W')}–${deg(r[3], 'E', 'W')}`;
}

// Tuile Copernicus de 1° contenant le coin sud-ouest (la, lo)
function urlTuile(la, lo) {
  const n = `Copernicus_DSM_COG_10_${la >= 0 ? 'N' : 'S'}${pad(la, 2)}_00_${lo >= 0 ? 'E' : 'W'}${pad(lo, 3)}_00_DEM`;
  return `${process.env.COPERNICUS_URL || 'https://copernicus-dem-30m.s3.amazonaws.com'}/${n}/${n}.tif`;
}

// Altitudes d'une grille régulière (ligne 0 = sud) : chaque tuile de 1° est lue une fois, en version réduite
// (aperçu du fichier, ≈ 120 m), puis échantillonnée en bilinéaire. Mer et tuiles absentes : NaN.
async function grilleCopernicus({ sud, ouest, pasLat, pasLon, nLat, nLon }, progression = () => {}, arrete = () => false) {
  const z = new Float32Array(nLat * nLon).fill(NaN);
  const nord = sud + (nLat - 1) * pasLat, est = ouest + (nLon - 1) * pasLon;
  const tuiles = [];
  for (let la = Math.floor(sud); la <= Math.floor(nord); la++) for (let lo = Math.floor(ouest); lo <= Math.floor(est); lo++) tuiles.push([la, lo]);
  let faites = 0;
  const lire = async ([la, lo]) => {
    if (arrete()) throw new Error('chargement interrompu');
    let r = null, w = 0, h = 0, absente = false;
    // Tuile absente du jeu de données (mer, zone sans relevé) : HTTP 403 ou 404
    try { const t = await fetch(urlTuile(la, lo), { method: 'HEAD', signal: AbortSignal.timeout(20000) }); absente = t.status === 403 || t.status === 404; } catch { /* on essaie quand même */ }
    for (let essai = 0; essai < 3 && !r && !absente; essai++) {
      try {
        const tiff = await fromUrl(urlTuile(la, lo), { allowFullFile: false });
        const im = await tiff.getImage();
        // ≈ 120 m : assez fin pour une grille de 250 m, et les aperçus du fichier évitent de tout télécharger
        w = Math.max(60, Math.round(im.getWidth() / 4)); h = Math.max(60, Math.round(im.getHeight() / 4));
        r = (await tiff.readRasters({ width: w, height: h, resampleMethod: 'bilinear' }))[0];
      } catch (e) {
        if (essai === 2) throw new Error(`relief Copernicus indisponible (${e.message})`);
        await new Promise((res) => setTimeout(res, 2000 * (essai + 1)));
      }
    }
    if (r) {
      // Pixels : ligne 0 = nord, centrés (pixel-is-point décalé d'un demi-pixel négligé à cette échelle)
      const i0 = Math.max(0, Math.ceil((la - sud) / pasLat)), i1 = Math.min(nLat - 1, Math.floor((la + 1 - sud) / pasLat));
      const j0 = Math.max(0, Math.ceil((lo - ouest) / pasLon)), j1 = Math.min(nLon - 1, Math.floor((lo + 1 - ouest) / pasLon));
      for (let i = i0; i <= i1; i++) {
        const fy = (1 - (sud + i * pasLat - la)) * (h - 1);
        const y = Math.min(h - 2, Math.max(0, Math.floor(fy))), dy = Math.min(1, Math.max(0, fy - y));
        for (let j = j0; j <= j1; j++) {
          const fx = (ouest + j * pasLon - lo) * (w - 1);
          const x = Math.min(w - 2, Math.max(0, Math.floor(fx))), dx = Math.min(1, Math.max(0, fx - x));
          const a = r[y * w + x], b = r[y * w + x + 1], c = r[(y + 1) * w + x], d = r[(y + 1) * w + x + 1];
          const v = a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy;
          z[i * nLon + j] = Number.isFinite(v) && v > -1000 ? v : NaN;
        }
      }
    }
    faites++;
    progression(Math.round((faites / tuiles.length) * 100));
  };
  for (let k = 0; k < tuiles.length; k += 3) await Promise.all(tuiles.slice(k, k + 3).map(lire));
  return z;
}

// Villes et villages d'un carré mondial (OpenStreetMap : place=city|town|village avec population)
const SERVEURS_OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
async function lieuxMonde(code) {
  const r = rectangleMonde(code);
  if (!r) return [];
  const q = `[out:json][timeout:90];node["place"~"^(city|town|village)$"]["population"](${r.join(',')});out body;`;
  let derniere = null;
  for (const url of SERVEURS_OVERPASS) {
    try {
      const rep = await fetch(url, { method: 'POST', headers: { 'User-Agent': 'live-mesh-map-world/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(120000) });
      if (!rep.ok) throw new Error('HTTP ' + rep.status);
      const j = await rep.json();
      return j.elements.map((e) => ({ nom: (e.tags && (e.tags['name:en'] || e.tags.name)) || '?', lat: e.lat, lon: e.lon, population: parseInt(String(e.tags.population).replace(/[^\d]/g, ''), 10) || 0 }))
        .filter((x) => x.population > 0);
    } catch (e) { derniere = e; }
  }
  throw new Error('OpenStreetMap (Overpass) : ' + (derniere ? derniere.message : 'indisponible'));
}

module.exports = { lieuxMonde, MARGE_MONDE, estCodeMonde, codeMonde, rectangleMonde, contourMonde, nomMonde, grilleCopernicus };
