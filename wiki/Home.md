# Live mesh map — US edition

Real-time map, monitoring and **remote administration** of a [Meshtastic](https://meshtastic.org) and [MeshCore](https://meshcore.co.uk) network, regional or local, **anywhere in the world**. **US edition**: areas are US counties, terrain-based coverage uses USGS 3DEP (Copernicus DEM elsewhere), base maps from the USGS National Map, US 915 MHz defaults and imperial units.

![The live map: Meshtastic and MeshCore nodes, measured links](https://raw.githubusercontent.com/pasquinic/live-mesh-map-us/main/docs/captures/en-carte.jpg)

## Where to start
1. [[Installation]]: Docker, `.env`, setup wizard.
2. [[Connect the network|Brancher le réseau]]: MQTT broker, channels.
3. [[Connect a node|Connecter un module]]: Bluetooth, USB or IP address, and the [[agent|Agent]].
4. Discover [[the map|La carte]].

## Using the map
- [[The map|La carte]]: nodes, links, layers, message route, replay.
- [[Messages]]: sending, acks, unread, sounds, alerts.
- [[Coverage and sites|Couverture et sites]]: USGS 3DEP terrain, high points, coverage plan, “what if…” simulation.
- [[Topology and simulation|Topologie et simulation]]: link graph, breaking points, packet propagation.
- [[Traffic control|Contrôle du trafic]]: overly chatty nodes, MQTT re-injection.

## Administration
- [[Remote programming|Programmation à distance]]: Meshtastic settings over LoRa, targeted read, templates, favorites, firmware 2.8.
- [[Reports|Signalements]]: flooded road, fallen tree… placed on the map and sent over LoRa (Meshtastic waypoint, MeshCore message).
- [[Teams|Équipes]]: encrypted channel per team, added or removed remotely on responders' nodes, new key, command-line equivalent.
- [[MeshCore]]: companion, repeaters, traces, regions, MQTT republishing.
- [[Accounts and security|Comptes et sécurité]]: roles, area managers, two-factor authentication, log.
- [[PostgreSQL archive|Archive PostgreSQL]]: full history, retention, maximum size.
- [[Versions and compatibility|Versions et compatibilité]]: supported firmware, Meshtastic 2.8.

## Help

![Help opens inside the map](https://raw.githubusercontent.com/pasquinic/live-mesh-map-us/main/docs/captures/en-aide.jpg)

- [[Troubleshooting|Dépannage]]: the most common problems and their solution.
- [Latest version](https://github.com/pasquinic/live-mesh-map-us/releases/latest) · [Report a problem](https://github.com/pasquinic/live-mesh-map-us/issues)

---
*Live map created by F4GLD · [♥ Support the project](https://www.helloasso.com/associations/radioclub-du-velay/formulaires/2) (Radio-club du Velay)*
