#!/bin/bash
# Instala o agendamento no macOS (launchd): de 15 em 15 min corre scripts/sync.mjs --auto,
# que só actua à segunda 10:00 (carga completa) e ao fim de semana 10:00-22:00 (resultados).
# Uso: ./scripts/install-sync.sh https://o-teu-site.netlify.app
set -euo pipefail

URL="${1:?Uso: $0 https://o-teu-site.netlify.app}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)" || { echo "node não encontrado"; exit 1; }
LABEL="pt.totobola.sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
CFG="$HOME/.config/totobola/sync.json"
LOG="$HOME/Library/Logs/totobola-sync.log"

GENERATED=0
KEY=""
# Reaproveita a chave já instalada (a não ser que peças --nova-chave)
if [ "${2:-}" != "--nova-chave" ] && [ -f "$CFG" ]; then
  KEY="$(node -p 'try{const k=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).key;/^[0-9a-f]{48}$/.test(k)?k:""}catch{""}' "$CFG")"
  [ -n "$KEY" ] && echo "A manter a chave que já estava instalada."
fi
if [ -z "$KEY" ]; then
  read -r -s -p "SYNC_KEY (carrega só em Enter para gerar uma nova e copiá-la): " KEY; echo
  if [ -z "$KEY" ]; then
    KEY="$(openssl rand -hex 24)"
    printf '%s' "$KEY" | pbcopy
    GENERATED=1
  fi
fi
if ! printf '%s' "$KEY" | grep -Eq '^[0-9a-f]{48}$'; then
  echo "Chave inválida: tem de ter 48 caracteres entre 0-9 e a-f (esta tem ${#KEY}). Nada foi alterado."
  echo "Dica: não copies o valor mascarado (••••) do Netlify; carrega só em Enter para gerar uma nova."
  exit 1
fi

mkdir -p "$(dirname "$CFG")"
printf '{ "url": "%s", "key": "%s" }\n' "$URL" "$KEY" > "$CFG"
chmod 600 "$CFG"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$ROOT/scripts/sync.mjs</string><string>--auto</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
EOF

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
if [ "$GENERATED" = 1 ]; then
  echo
  echo ">>> A chave nova JÁ ESTÁ COPIADA. No Netlify: Environment variables -> SYNC_KEY -> cola (Cmd+V),"
  echo ">>> guarda e faz Deploys -> Trigger deploy -> Deploy project without cache."
  echo
fi
echo "Instalado. Agenda: segunda 10:00 (carga completa) e sáb/dom 10:00-22:00 de 15 em 15 min. Log: $LOG"
echo "Para remover: launchctl bootout gui/$UID/$LABEL && rm \"$PLIST\" \"$CFG\""
