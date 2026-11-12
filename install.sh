#!/bin/sh
# One-command install of the live mesh map, world edition (Linux: Debian, Ubuntu, Raspberry Pi OS…)
#
#   curl -fsSL https://raw.githubusercontent.com/sauveteur71/live-mesh-map-world/main/install.sh | sudo sh
#
# Optional variables: DOSSIER (default /opt/live-mesh-map-world), CARTE_PORT (default 8095),
# MISE_A_JOUR=non (without the one-click update service).
# The script only touches the install folder. Run again on an existing install, it just updates the image,
# without changing the .env or the data.
set -eu

DEPOT="https://raw.githubusercontent.com/sauveteur71/live-mesh-map-world/main"
DOSSIER="${DOSSIER:-/opt/live-mesh-map-world}"
CARTE_PORT="${CARTE_PORT:-8095}"
MISE_A_JOUR="${MISE_A_JOUR:-oui}"

info() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
erreur() { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
# Question asked on the keyboard even when the script comes through « curl … | sh »
demander() { if [ -r /dev/tty ]; then printf '%s ' "$1" > /dev/tty; read -r rep < /dev/tty || rep=""; else rep=""; fi; echo "$rep"; }

[ "$(id -u)" = 0 ] || erreur "Run the script as administrator: … | sudo sh"
command -v curl > /dev/null 2>&1 || erreur "curl is required (apt install curl)"

# 1. Docker
if ! command -v docker > /dev/null 2>&1; then
  info "Docker is not installed."
  r=$(demander "Install it now with the official Docker script (get.docker.com)? [Y/n]")
  case "$r" in n|N|no|No|non|Non) erreur "Install Docker then run this script again: https://docs.docker.com/engine/install/";; esac
  curl -fsSL https://get.docker.com | sh || erreur "Docker installation failed"
  ok "Docker installed"
fi
docker compose version > /dev/null 2>&1 || erreur "The « docker compose » plugin is missing (package docker-compose-plugin)"

# 2. Dossier, docker-compose.yml et .env
mkdir -p "$DOSSIER"
cd "$DOSSIER"
if [ -f docker-compose.yml ]; then
  info "Existing install in $DOSSIER: updating the image only"
else
  info "Downloading files into $DOSSIER"
  curl -fsSL "$DEPOT/docker-compose.yml" -o docker-compose.yml
  if [ "$MISE_A_JOUR" = non ]; then
    # Removes the « maj » block (one-click update: Docker engine access)
    awk 'BEGIN{s=0} /^  maj:/{s=1; next} s && /^  [a-z#]/{s=0} !s' docker-compose.yml > dc.tmp && mv dc.tmp docker-compose.yml
  fi
  ok "docker-compose.yml"
fi
if [ ! -f .env ]; then
  curl -fsSL "$DEPOT/.env.exemple" -o .env
  # Map port
  if grep -q '^#\? *CARTE_PORT=' .env; then sed -i "s|^#\? *CARTE_PORT=.*|CARTE_PORT=$CARTE_PORT|" .env; else printf '\nCARTE_PORT=%s\n' "$CARTE_PORT" >> .env; fi
  # Team key (encrypts team channel keys): created once, kept in the .env
  if ! grep -q '^CLE_EQUIPES=' .env; then printf '\n# Teams master key (keep it: without it, a restored backup can no longer read the keys)\nCLE_EQUIPES=%s\n' "$(head -c 32 /dev/urandom | base64 | tr -d '\n')" >> .env; fi
  chmod 600 .env
  ok ".env created (settings are then made in the map)"
fi

# 3. Lancement
info "Downloading images (a few minutes the first time)"
docker compose pull -q
docker compose up -d
info "Starting the map"
i=0
until curl -fsS "http://127.0.0.1:$CARTE_PORT/sante" > /dev/null 2>&1; do
  i=$((i + 1)); [ $i -gt 60 ] && erreur "The map does not answer: docker compose logs carte-live"
  sleep 2
done
ok "The map is running"

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
CODE=$(docker compose logs carte-live 2>/dev/null | grep -o "code d'installation [A-Z0-9-]*" | tail -1 | sed 's/.* //')
echo
ok "Open http://${IP:-SERVER_IP}:$CARTE_PORT in a browser"
echo "   The wizard creates the admin account, sets the area and the MQTT server (with a test button)."
[ -n "$CODE" ] && echo "   Setup code asked from outside the local network: $CODE"
echo "   Then: Settings › 🩺 Diagnostics checks everything works; updates are one click in the map."
echo "   Folder: $DOSSIER (keep the .env: it contains the teams key)"
