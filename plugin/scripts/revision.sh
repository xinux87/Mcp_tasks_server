#!/bin/sh
# revision.sh - guarda y lee la ultima revision del servidor que este terminal
# ha visto, para que el bucle sepa que pasar a `novedades` en la vuelta siguiente.
#
# Uso:
#   revision.sh leer            imprime la revision guardada, o nada si no hay
#   revision.sh guardar <n>     guarda la revision <n>
#
# El archivo vive en ${CLAUDE_PLUGIN_DATA}/revision cuando Claude Code exporta
# esa variable (persiste entre sesiones y entre actualizaciones del plugin), y
# si no, en ~/.claude/mcp-tareas/revision. Nunca en ${CLAUDE_PLUGIN_ROOT}: ese
# directorio se sobrescribe al actualizar el plugin.

set -u

BASE="${CLAUDE_PLUGIN_DATA:-${HOME}/.claude/mcp-tareas}"
FILE="${BASE}/revision"

case "${1:-}" in
  leer)
    [ -r "$FILE" ] || exit 0
    REV=$(cat "$FILE" 2>/dev/null)
    case "$REV" in
      ''|*[!0-9]*) exit 0 ;;
    esac
    printf '%s\n' "$REV"
    ;;
  guardar)
    REV="${2:-}"
    case "$REV" in
      ''|*[!0-9]*)
        echo "revision.sh: se esperaba un numero, no '${REV}'" >&2
        exit 1
        ;;
    esac
    mkdir -p "$BASE" 2>/dev/null || exit 1
    printf '%s\n' "$REV" > "${FILE}.$$" 2>/dev/null || exit 1
    mv -f "${FILE}.$$" "$FILE" 2>/dev/null || { rm -f "${FILE}.$$"; exit 1; }
    printf '%s\n' "$REV"
    ;;
  *)
    echo "uso: revision.sh leer | revision.sh guardar <n>" >&2
    exit 1
    ;;
esac

exit 0
