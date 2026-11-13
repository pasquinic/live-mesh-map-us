'use strict';
// Tall structures of the map area, from OpenStreetMap: communication towers and masts, water towers.
// (The French edition used the road webcams of Haute-Loire here.) These sites usually have height, power and
// sometimes a network link: good candidates to suggest for relays, subject to the owner's agreement.
// One-week cache in /data/sites-routiers.json. The "gestionnaire" field holds the OSM operator, if any.

const fs = require('fs');
const path = require('path');

const SERVEURS_OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

function creerSitesRoutiers(config, journal) {
  const fichier = path.join(path.dirname(config.fichierBase), 'sites-routiers.json');
  let donnees = null;
  try { donnees = JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { /* absent */ }

  async function charger() {
    const zone = (config.zone || []).join(',');
    if (donnees && donnees.zone === zone && Date.now() - donnees.date < 7 * 86400000) return donnees;
    const [s, o, n, e] = config.zone;
    const bb = `${s},${o},${n},${e}`;
    const q = `[out:json][timeout:90];(nwr["man_made"="mast"](${bb});nwr["man_made"="tower"]["tower:type"="communication"](${bb});nwr["man_made"="water_tower"](${bb}););out center tags 2000;`;
    let derniere = null;
    for (const url of SERVEURS_OVERPASS) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': 'live-mesh-map-us/1.0 (+https://github.com/pasquinic/live-mesh-map-us)', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(120000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const sites = (j.elements || []).map((x) => {
          const t = x.tags || {}, lat = x.lat ?? (x.center && x.center.lat), lon = x.lon ?? (x.center && x.center.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
          const eau = t.man_made === 'water_tower';
          const h = parseFloat(String(t.height || '').replace(',', '.'));
          return {
            id: `osm-${x.type[0]}${x.id}`,
            nom: t.name || (eau ? 'Water tower' : 'Communication tower') + (t.operator ? ` (${t.operator})` : ''),
            // "DIR…" kept the French edition's second marker colour: here, communication towers
            gestionnaire: eau ? (t.operator || 'water tower') : 'DIR ' + (t.operator || 'communication'),
            lat, lon, altitude: null, hauteur: Number.isFinite(h) ? h : null,
            type: eau ? 'château d’eau' : 'pylône',
            lien: `https://www.openstreetmap.org/${x.type}/${x.id}`,
          };
        }).filter(Boolean);
        donnees = { date: Date.now(), zone, source: 'OpenStreetMap', sites };
        try { fs.writeFileSync(fichier, JSON.stringify(donnees)); } catch { /* lecture seule */ }
        journal(`[Sites routiers] ${sites.length} sites chargés (OpenStreetMap)`);
        return donnees;
      } catch (err) { derniere = err; }
    }
    journal('[Sites routiers] chargement impossible :', derniere ? derniere.message : '?');
    return donnees || { date: null, sites: [] };
  }
  return { charger };
}

module.exports = { creerSitesRoutiers };
