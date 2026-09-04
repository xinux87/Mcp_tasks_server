#!/bin/sh
# guardar-config.sh - hook SessionStart del plugin mcp-tareas.
#
# Deja la URL del servidor y el token del terminal en ~/.claude/mcp-tareas/config
# con permisos 600, para que scripts/statusline.sh pueda leerlos. La statusline
# no es un componente del plugin: Claude Code no le pasa ${user_config.*} ni las
# variables CLAUDE_PLUGIN_OPTION_*, asi que este hook es el puente.
#
# De donde saca los valores, en este orden:
#   1. Los argumentos $1 (URL) y $2 (token), para uso manual.
#   2. Las variables CLAUDE_PLUGIN_OPTION_SERVIDOR_URL y
#      CLAUDE_PLUGIN_OPTION_TOKEN_TERMINAL, que Claude Code exporta a los
#      procesos de hook con los valores de userConfig.
#
# Nunca escribe nada por stdout: un hook SessionStart que imprime inyecta ese
# texto en el contexto de la sesion.

set -u

URL="${1:-${CLAUDE_PLUGIN_OPTION_SERVIDOR_URL:-}}"
TOKEN="${2:-${CLAUDE_PLUGIN_OPTION_TOKEN_TERMINAL:-}}"

# Sin configuracion no hay nada que escribir. No es un error: el usuario puede
# no haber terminado de configurar el plugin todavia.
[ -n "$URL" ] || exit 0
[ -n "$TOKEN" ] || exit 0

# Quita la barra final de la URL para que el script de statusline pueda
# concatenar /api/uso sin duplicarla.
case "$URL" in
  */) URL="${URL%/}" ;;
esac

DIR="${HOME}/.claude/mcp-tareas"
FILE="${DIR}/config"

mkdir -p "$DIR" 2>/dev/null || exit 0
chmod 700 "$DIR" 2>/dev/null

TMP="${FILE}.$$"
umask 077
{
  printf '# Generado por el plugin mcp-tareas. No editar a mano.\n'
  printf 'SERVIDOR_URL=%s\n' "$URL"
  printf 'TOKEN=%s\n' "$TOKEN"
} > "$TMP" 2>/dev/null || exit 0

chmod 600 "$TMP" 2>/dev/null
mv -f "$TMP" "$FILE" 2>/dev/null || rm -f "$TMP" 2>/dev/null

exit 0
