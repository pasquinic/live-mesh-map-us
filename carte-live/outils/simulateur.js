'use strict';
// Meshtastic traffic simulator (to try the map without a radio).
// Usage: node outils/simulateur.js mqtt://IP:1883 [user] [password]
// Publishes realistic encrypted packets under msh/US/2/e/<channel>/<gateway> (demo nodes around Phoenix, AZ)

const crypto = require('crypto');
const mqtt = require('mqtt');
const { types, etendreCle, hachageCanal, dechiffrer } = require('../src/decodeur');

const [url = 'mqtt://localhost:1883', utilisateur, motDePasse] = process.argv.slice(2);
const RACINE = process.env.MQTT_RACINE || 'msh/US';

const CANAUX = {
  LongFast: etendreCle('AQ=='),
  PHX_Mesh: etendreCle('AQ=='),
};

// Demo nodes (approximate positions around Phoenix, AZ)
const N = [];
const def = (num, nom, court, role, lat, lon, alt, opts = {}) => N.push({ num, nom, court, role, lat, lon, alt, hw: opts.hw || 4, gw: !!opts.gw, batt: opts.batt ?? 80, v: opts.v ?? 3.95, canal: opts.canal ?? 8 });
def(0x5a1e0001, 'DEMO Gateway Tempe', 'TMGW', 12, 33.4255, -111.9400, 360, { gw: true, batt: 101, v: 5.0, hw: 43 });
def(0x5a1e0002, 'DEMO South Mountain Relay', 'SMTN', 2, 33.3350, -112.0600, 790, { gw: true, batt: 92, v: 4.12, hw: 4, canal: 14 });
def(0x5a1e0003, 'DEMO Shaw Butte Relay', 'SHAW', 2, 33.6230, -112.0870, 640, { batt: 38, v: 3.42, canal: 31 });
def(0x5a1e0004, 'DEMO Gateway Mesa', 'MSGW', 12, 33.4152, -111.8315, 380, { gw: true, batt: 101, v: 5.0, hw: 43 });
def(0x5a1e0005, 'DEMO Downtown Phoenix', 'DTPX', 0, 33.4484, -112.0740, 330, { batt: 64, v: 3.88 });
def(0x5a1e0006, 'DEMO Scottsdale', 'SCOT', 0, 33.4942, -111.9261, 380, { batt: 77 });
def(0x5a1e0007, 'DEMO Goodyear', 'GDYR', 0, 33.4353, -112.3577, 300, { batt: 55 });
def(0x5a1e0008, 'DEMO Fountain Hills', 'FNTH', 0, 33.6117, -111.7174, 480, { batt: 90 });
def(0x5a1e0009, 'DEMO Car', 'AUTO', 5, 33.5000, -112.0000, 340, { batt: 101, v: 4.8 });
def(0x5a1e000a, 'DEMO Chandler', 'CHND', 0, 33.3062, -111.8413, 370, { batt: 71 });
def(0x5a1e000b, 'DEMO Usery Peak Relay', 'USRY', 11, 33.4730, -111.6100, 900, { batt: 88, v: 4.05 });

const passerelles = N.filter((n) => n.gw);
const hasard = (t) => t[Math.floor(Math.random() * t.length)];
const id = (num) => '!' + num.toString(16).padStart(8, '0');

function envelopper(canal, de, vers, portnum, payload, gw, opts = {}) {
  const idPaquet = crypto.randomBytes(4).readUInt32LE(0);
  const data = types.Data.encode({ portnum, payload, requestId: opts.requestId || 0 }).finish();
  const cle = CANAUX[canal];
  const chiffre = dechiffrer(cle, idPaquet, de.num, Buffer.from(data)); // AES-CTR : chiffrer == déchiffrer
  const hopStart = 3;
  const sauts = de.num === gw.num ? 0 : opts.sauts ?? 0;
  const paquet = {
    from: de.num, to: vers, id: idPaquet, channel: hachageCanal(canal, cle), encrypted: chiffre,
    hopStart, hopLimit: hopStart - sauts, rxTime: Math.floor(Date.now() / 1000),
    rxSnr: de.num === gw.num ? 0 : +(Math.random() * 16 - 10).toFixed(2),
    rxRssi: de.num === gw.num ? 0 : -Math.round(80 + Math.random() * 45),
    relayNode: opts.relais ? opts.relais.num & 0xff : sauts === 0 ? de.num & 0xff : 0,
  };
  const env = types.ServiceEnvelope.encode({ packet: paquet, channelId: canal, gatewayId: id(gw.num) }).finish();
  return { topic: `${RACINE}/2/e/${canal}/${id(gw.num)}`, message: Buffer.from(env) };
}

const client = mqtt.connect(url, { username: utilisateur, password: motDePasse });
client.on('connect', () => {
  console.log('Simulateur connecté à', url);
  for (const g of passerelles) client.publish(`${RACINE}/2/stat/${id(g.num)}`, 'online', { retain: true });
  // Infos de tous les nœuds au démarrage
  for (const n of N) {
    const gw = n.gw ? n : hasard(passerelles);
    pub(envelopper('LongFast', n, 0xffffffff, 4, types.User.encode({ id: id(n.num), longName: n.nom, shortName: n.court, hwModel: n.hw, role: n.role }).finish(), gw, { sauts: 1 }));
    pub(envelopper('LongFast', n, 0xffffffff, 3, types.Position.encode({ latitudeI: Math.round(n.lat * 1e7), longitudeI: Math.round(n.lon * 1e7), altitude: n.alt, precisionBits: 32 }).finish(), gw, { sauts: 1 }));
  }
  setInterval(tour, 700);
});

function pub({ topic, message }) {
  client.publish(topic, message);
}

let t = 0;
function tour() {
  t++;
  const n = hasard(N);
  const gwProche = hasard(passerelles);
  const sauts = n.gw ? 0 : Math.random() < 0.5 ? 0 : 1 + Math.floor(Math.random() * 2);
  const relais = sauts > 0 ? hasard(N.filter((x) => x.role === 2 || x.role === 11)) : null;
  const r = Math.random();
  if (r < 0.3) {
    n.v = Math.max(3.3, Math.min(4.2, n.v + (Math.random() - 0.5) * 0.04));
    const payload = types.Telemetry.encode({ time: Math.floor(Date.now() / 1000), deviceMetrics: { batteryLevel: n.batt, voltage: n.v, channelUtilization: n.canal + Math.random() * 4, airUtilTx: Math.random() * 3, uptimeSeconds: 3600 * 30 + t * 10 } }).finish();
    pub(envelopper('LongFast', n, 0xffffffff, 67, payload, gwProche, { sauts, relais }));
  } else if (r < 0.55) {
    if (n.num === 0x5a1e0009) { n.lat += (Math.random() - 0.4) * 0.01; n.lon += (Math.random() - 0.4) * 0.01; }
    const payload = types.Position.encode({ latitudeI: Math.round(n.lat * 1e7), longitudeI: Math.round(n.lon * 1e7), altitude: n.alt, precisionBits: 32 }).finish();
    pub(envelopper('LongFast', n, 0xffffffff, 3, payload, gwProche, { sauts, relais }));
  } else if (r < 0.65) {
    const voisins = N.filter((x) => x !== n).sort(() => Math.random() - 0.5).slice(0, 3).map((x) => ({ nodeId: x.num, snr: +(Math.random() * 18 - 12).toFixed(2) }));
    pub(envelopper('LongFast', n, 0xffffffff, 71, types.NeighborInfo.encode({ nodeId: n.num, neighbors: voisins }).finish(), gwProche, { sauts, relais }));
  } else if (r < 0.72) {
    const dest = hasard(N.filter((x) => x !== n));
    const via = hasard(N.filter((x) => x.role === 2 && x !== n && x !== dest));
    const payload = types.RouteDiscovery.encode({ route: [via.num], snrTowards: [24, -20], routeBack: [via.num], snrBack: [8, 12] }).finish();
    pub(envelopper('LongFast', dest, n.num, 70, payload, gwProche, { sauts: 1, relais: via, requestId: 1234 }));
  } else if (r < 0.8) {
    const textes = ['Hello Phoenix mesh!', 'Range test from Usery Peak', 'Anyone hearing me?', 'All good on the relay', '73 de KK7ABC'];
    pub(envelopper(Math.random() < 0.5 ? 'PHX_Mesh' : 'LongFast', n, 0xffffffff, 1, Buffer.from(hasard(textes)), gwProche, { sauts, relais }));
  } else {
    pub(envelopper('LongFast', n, 0xffffffff, 4, types.User.encode({ id: id(n.num), longName: n.nom, shortName: n.court, hwModel: n.hw, role: n.role }).finish(), gwProche, { sauts, relais }));
  }
  // Même paquet parfois reçu par une 2e passerelle
  if (Math.random() < 0.15) {
    const autre = hasard(passerelles);
    pub(envelopper('LongFast', n, 0xffffffff, 67, types.Telemetry.encode({ deviceMetrics: { batteryLevel: n.batt, voltage: n.v, channelUtilization: n.canal, airUtilTx: 1.2 } }).finish(), autre, { sauts: 0 }));
  }
}
