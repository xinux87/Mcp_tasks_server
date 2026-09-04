#!/bin/sh
# statusline.sh - statusline del plugin mcp-tareas.
#
# Hace dos cosas, en este orden de prioridad:
#   1. Pinta la linea de estado. Esto no puede fallar nunca ni tardar.
#   2. Como mucho una vez por minuto y por sesion, reenvia al servidor el JSON
#      que Claude Code le pasa por stdin, con POST ${SERVIDOR_URL}/api/uso y la
#      cabecera Authorization: Bearer ${TOKEN}. El envio va en segundo plano y
#      con --max-time 2, asi que un servidor caido no bloquea la statusline.
#
# Configuracion, en este orden de precedencia:
#   1. Las variables de entorno SERVIDOR_URL y TOKEN.
#   2. El archivo ~/.claude/mcp-tareas/config, que escribe el hook SessionStart
#      del plugin (scripts/guardar-config.sh), con el formato:
#         SERVIDOR_URL=https://tareas.example.com
#         TOKEN=el-token-del-terminal
#
# Sin jq no se reenvia nada y la linea se degrada a solo el modelo.
# El script sale siempre con codigo 0.

INPUT=$(cat 2>/dev/null)
[ -n "$INPUT" ] || { printf 'tareas\n'; exit 0; }

CONFIG="${HOME}/.claude/mcp-tareas/config"

# Lee el archivo de configuracion linea a linea. No usa "." ni "source" para no
# ejecutar lo que haya dentro del archivo.
if [ -r "$CONFIG" ]; then
  while IFS= read -r LINEA || [ -n "$LINEA" ]; do
    case "$LINEA" in
      \#*|'') continue ;;
      SERVIDOR_URL=*) [ -n "${SERVIDOR_URL:-}" ] || SERVIDOR_URL="${LINEA#SERVIDOR_URL=}" ;;
      TOKEN=*)        [ -n "${TOKEN:-}" ]        || TOKEN="${LINEA#TOKEN=}" ;;
    esac
  done < "$CONFIG"
fi

SERVIDOR_URL="${SERVIDOR_URL:-}"
TOKEN="${TOKEN:-}"
SERVIDOR_URL="${SERVIDOR_URL%/}"

# ---------------------------------------------------------------- sin jq -----
# Degradacion: solo el nombre del modelo, sacado con sed. No se reenvia nada,
# porque sin jq no se puede leer el session_id con el que se limita el envio.
if ! command -v jq >/dev/null 2>&1; then
  MODELO=$(printf '%s' "$INPUT" \
    | sed -n 's/.*"display_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1)
  printf '%s\n' "${MODELO:-tareas}"
  exit 0
fi

MODELO=$(printf '%s' "$INPUT" | jq -r '.model.display_name // .model.id // empty' 2>/dev/null)
SESION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
CINCO_H=$(printf '%s' "$INPUT" | jq -r '.rate_limits.five_hour.used_percentage // empty' 2>/dev/null)
SIETE_D=$(printf '%s' "$INPUT" | jq -r '.rate_limits.seven_day.used_percentage // empty' 2>/dev/null)

# ------------------------------------------------------------- envio (1/min) --
if [ -n "$SERVIDOR_URL" ] && [ -n "$TOKEN" ] && command -v curl >/dev/null 2>&1; then
  MARCA="${TMPDIR:-/tmp}/mcp-tareas-uso-$(printf '%s' "${SESION:-sin-sesion}" | tr -c 'A-Za-z0-9_-' '_')"
  AHORA=$(date +%s 2>/dev/null || echo 0)
  ULTIMO=0
  [ -r "$MARCA" ] && ULTIMO=$(cat "$MARCA" 2>/dev/null)
  case "$ULTIMO" in
    ''|*[!0-9]*) ULTIMO=0 ;;
  esac

  if [ "$AHORA" -ge $((ULTIMO + 60)) ]; then
    printf '%s' "$AHORA" > "$MARCA" 2>/dev/null
    (
      printf '%s' "$INPUT" | curl \
        --silent --output /dev/null \
        --max-time 2 \
        --request POST \
        --header "Authorization: Bearer ${TOKEN}" \
        --header 'Content-Type: application/json' \
        --data-binary @- \
        "${SERVIDOR_URL}/api/uso" >/dev/null 2>&1
    ) >/dev/null 2>&1 </dev/null &
  fi
fi

# ------------------------------------------------------------------- linea ----
LINEA="${MODELO:-tareas}"
[ -n "$CINCO_H" ] && LINEA="${LINEA} | 5h ${CINCO_H%.*}%"
[ -n "$SIETE_D" ] && LINEA="${LINEA} | 7d ${SIETE_D%.*}%"

printf '%s\n' "$LINEA"
exit 0
