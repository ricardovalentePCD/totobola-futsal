#!/bin/bash
# Instala o agendamento no macOS (launchd): corre scripts/sync.mjs de 15 em 15 minutos.
# Uso: ./scripts/install-sync.sh https://o-teu-site.netlify.app
set -euo pipefail

URL="${1:?Uso: $0 https://o-teu-site.netlify.app}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)" || { echo "node não encontrado"; exit 1; }
LABEL="pt.totobola.sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
CFG="$HOME/.config/totobola/sync.json"
LOG="$HOME/Library/Logs/totobola-sync.log"

read -r -s -p "Cola a SYNC_KEY (a mesma que pões no Netlify; não aparece ao escrever): " KEY; echo
[ -n "$KEY" ] || { echo "Chave vazia."; exit 1; }

mkdir -p "$(dirname "$CFG")"
printf '{ "url": "%s", "key": "%s" }\n' "$URL" "$KEY" > "$CFG"
chmod 600 "$CFG"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$ROOT/scripts/sync.mjs</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
EOF

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
echo "Instalado. Corre agora e depois de 15 em 15 min. Log: $LOG"
echo "Para remover: launchctl bootout gui/$UID/$LABEL && rm \"$PLIST\" \"$CFG\""
