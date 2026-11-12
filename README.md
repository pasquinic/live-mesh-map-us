# Live mesh map — world edition

[![Latest version](https://img.shields.io/github/v/release/sauveteur71/live-mesh-map-world?label=latest%20version)](https://github.com/sauveteur71/live-mesh-map-world/releases/latest)

**Current version: 1.0.0** — [what's new](https://github.com/sauveteur71/live-mesh-map-world/releases/latest) · [all versions](https://github.com/sauveteur71/live-mesh-map-world/releases)

Self-hosted **live map, monitoring and remote administration** for [Meshtastic](https://meshtastic.org) and [MeshCore](https://meshcore.co.uk) networks, **anywhere in the world**. It listens to your MQTT broker and/or a radio node, decodes packets, keeps the history, estimates radio coverage from terrain and lets you program your nodes over LoRa.

This is the world edition of the French [carte-live-meshtastic](https://github.com/sauveteur71/carte-live-meshtastic): same program, English by default (French available), with worldwide terrain.

📖 **Documentation: [the wiki](https://github.com/sauveteur71/live-mesh-map-world/wiki)** (sources in [`wiki/en/`](wiki/en/)).

![The live map](docs/captures/en-carte.jpg)

| Coverage computed from terrain | Link graph |
|---|---|
| ![Coverage](docs/captures/en-couverture.jpg) | ![Topology](docs/captures/en-topologie.jpg) |
| **Public map** | **Built-in help** |
| ![Public map](docs/captures/en-publique.jpg) | ![Help](docs/captures/en-aide.jpg) |

*Screenshots from a real network in Haute-Loire, France.*

## Install in one command (Linux)
```bash
curl -fsSL https://raw.githubusercontent.com/sauveteur71/live-mesh-map-world/main/install.sh | sudo sh
```
Then open `http://SERVER_IP:8095`: the wizard creates the admin account, sets the area (“🌍 Outside France: choose the position…”) and the MQTT server. Everything else is done in the map; updates are one click.

Or by hand: `cp .env.exemple .env` (set at least `DEPARTEMENT`, `RADIO_FREQ_MHZ`, `MQTT_URL`), then `docker compose up -d`.

## What it does
- **Live map** of Meshtastic and MeshCore nodes (alone or overlaid): relays, clients, gateways, repeaters, room servers, companions, sensors; measured RF links, traceroutes, telemetry, alerts, live packet animation, 24 h replay.
- **Messages** from both networks, with the channels that have new messages highlighted, acks and “heard by” for every message.
- **Coverage from terrain, worldwide**: point coverage, terrain profile and link budget, best high points, where to place relays, “what if” simulation. Terrain comes from **Copernicus DEM GLO-30** (ESA, free) outside France and **IGN RGE ALTI** in France, at 250 m resolution, calibrated on your measured links.
- **Remote administration over LoRa**: Meshtastic PKI admin (firmware ≥ 2.5), targeted reads, templates, favorites between relays, compliance check; MeshCore repeaters (settings, regions, passwords, traces, telemetry).
- **Field work**: reports (flooded road, fallen tree…) sent over LoRa as Meshtastic waypoints, teams with an encrypted channel and position tracking, offline field surveys.
- **Meshtastic ⇄ MeshCore bridge** for channel messages (optional, off by default).
- Public map, GeoJSON / GPX exports, Prometheus metrics, Home Assistant, PostgreSQL archive.

## Areas and radio
- Outside France, the map's area is a **1° × 1° square** named after its south-west corner: `MN40W075` = 40–41°N, 75–74°W. Points clicked elsewhere automatically load the square they fall in (a few seconds, cached on disk).
- Set `RADIO_FREQ_MHZ` for your region: `906.875` (US LongFast), `869.525` (EU_868), `919.875` (ANZ), `923.875` (AS923)…
- Town populations come from OpenStreetMap outside France.

## Security
Only publish the web map (port 8095, ideally behind an HTTPS reverse proxy or Tailscale). **Never expose the agents port (4404) to the internet**: local network or VPN only.

## Licence and credits
- GPL-3.0. Created by **F4GLD** · [♥ Support the project](https://www.helloasso.com/associations/radioclub-du-velay/formulaires/2) (Radio-club du Velay).
- Terrain: Copernicus DEM © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA; IGN RGE ALTI (Licence Ouverte Etalab). OpenStreetMap © contributors (ODbL).
- Meshtastic® is a registered trademark of Meshtastic LLC. This project is not affiliated with Meshtastic LLC.
