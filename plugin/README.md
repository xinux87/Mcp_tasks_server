# mcp-tareas

Plugin de Claude Code que conecta un terminal al servidor MCP de tareas. Hace tres cosas:

- **Declara el servidor MCP** (`.mcp.json`), con la URL y el token que pides al activar el plugin.
- **Arranca el bucle del agente** (`skills/tareas/SKILL.md`): sincroniza con el servidor, y cuando hay una tarea para este terminal la analiza o la ejecuta con un subagente y reporta su consumo de tokens.
- **Reenvía el uso disponible de la cuenta** (`scripts/statusline.sh`), que solo existe en la entrada de la statusline de Claude Code.

## 1. Crear el terminal en la web

1. Entra en la web del servidor y ve a la sección de terminales.
2. Crea un terminal con su **nombre** (por ejemplo `portatil-1`) y la **cuenta de origen** de la sesión de Claude Code.
3. La web te enseña el **token una sola vez**. Cópialo antes de cerrar. Si lo pierdes, revoca ese terminal y crea otro.

El token identifica al terminal y a su usuario. El plugin lo guarda en tu configuración local; nunca en el repositorio.

## 2. Instalar el plugin

### Desde una ruta local

Desde una sesión de Claude Code, con la raíz de este repositorio como `<repo>`:

```
/plugin marketplace add <repo>
/plugin install mcp-tareas@mcp-tareas-marketplace
```

El primer comando registra el catálogo (`.claude-plugin/marketplace.json` en la raíz del repositorio, que apunta a `./plugin`). El segundo instala el plugin y te pide el ámbito.

Para probar sin instalar nada, arranca Claude Code apuntando directamente al plugin:

```
claude --plugin-dir <repo>/plugin
```

Con `--plugin-dir` no hay marketplace ni instalación, pero tampoco se te piden los valores de `userConfig`: para esa vía, escribe el archivo de configuración de la statusline a mano (paso 4) y declara el servidor MCP por tu cuenta.

### Desde git

```
/plugin marketplace add <owner>/<repo>
/plugin install mcp-tareas@mcp-tareas-marketplace
```

También sirve la URL completa. En hosts que no son github.com ni gitlab.com hay que poner el sufijo `.git`:

```
/plugin marketplace add https://git.example.com/equipo/repo.git
```

Para fijar una rama o una etiqueta, añade `#` y la referencia: `...repo.git#v0.1.0`.

### Configuración

Al activarlo, Claude Code te pide los dos valores:

| Clave | Qué es |
|---|---|
| `servidor_url` | URL base del servidor, sin barra final. Por ejemplo `https://tareas.example.com` |
| `token_terminal` | El token que te dio la web. Se guarda en el llavero del sistema, no en `settings.json` |

Si el resumen de la instalación dice `Run /reload-plugins to activate.`, ejecuta `/reload-plugins`.

Para cambiarlos después, abre `/plugin`, ve a la pestaña **Installed** y entra en el detalle de `mcp-tareas`.

## 3. Configurar la statusline

Claude Code solo pasa el uso disponible de la cuenta (`rate_limits`) a la statusline, y un plugin no puede imponer la suya. Añade esto a `~/.claude/settings.json`, con la ruta real donde quedó instalado el plugin:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/plugins/marketplaces/mcp-tareas-marketplace/plugin/scripts/statusline.sh",
    "padding": 2
  }
}
```

Si no sabes la ruta, ejecuta `claude plugin details mcp-tareas` o mira el detalle en `/plugin`.

La línea que pinta es el modelo y, cuando existen, el porcentaje usado de la ventana de 5 horas y la de 7 días:

```
Opus | 5h 23% | 7d 41%
```

`rate_limits` solo existe en cuentas Pro o Max y solo a partir de la primera respuesta de la API. Sin ese dato la línea muestra solo el modelo.

El script envía el JSON al servidor como mucho una vez por minuto y por sesión, en segundo plano y con dos segundos de tope. Si el servidor no responde, la statusline no se entera.

### De dónde saca el script la URL y el token

La statusline no es un componente del plugin: Claude Code no le pasa `${user_config.*}` ni las variables `CLAUDE_PLUGIN_OPTION_*`. El puente es el hook `SessionStart` del plugin (`scripts/guardar-config.sh`), que al empezar cada sesión escribe `~/.claude/mcp-tareas/config` con permisos 600 y este contenido:

```
SERVIDOR_URL=https://tareas.example.com
TOKEN=el-token-del-terminal
```

No hay que hacer nada: el hook lo mantiene al día. Si usas el plugin con `--plugin-dir`, o quieres apuntar la statusline a otro servidor, crea ese archivo tú:

```
mkdir -p ~/.claude/mcp-tareas
printf 'SERVIDOR_URL=%s\nTOKEN=%s\n' 'https://tareas.example.com' 'el-token' > ~/.claude/mcp-tareas/config
chmod 600 ~/.claude/mcp-tareas/config
```

Las variables de entorno `SERVIDOR_URL` y `TOKEN` tienen prioridad sobre el archivo.

## 4. Arrancar el bucle

Una vez por terminal, al abrir la sesión:

```
/loop /mcp-tareas:tareas
```

Sin intervalo, Claude elige uno entre un minuto y una hora según lo que vea: corto mientras hay trabajo, largo cuando no pasa nada. Para un intervalo fijo:

```
/loop 2m /mcp-tareas:tareas
```

Cada disparo es **una vuelta**: sincroniza, y si no hay novedades termina sin gastar casi nada. Si hay trabajo, toma **una** tarea, lanza la fase que toque como subagente con el modelo asignado y reporta su consumo.

La primera vuelta solo registra el terminal en el servidor. El trabajo empieza en la segunda.

## 5. Parar el bucle

- **Sin intervalo** (el bucle elige el ritmo): pulsa `Esc` mientras espera.
- **Con intervalo fijo**: pídeselo a Claude, «cancela la tarea programada del bucle de tareas». Por debajo usa `CronList` y `CronDelete`.
- Empezar una conversación nueva también lo borra. Los bucles caducan solos a los 7 días.

## Estructura

```
plugin/
  .claude-plugin/plugin.json   manifiesto, userConfig (URL y token)
  .mcp.json                    el servidor MCP `tareas`, HTTP con bearer
  skills/tareas/SKILL.md       una vuelta del bucle del agente
  hooks/hooks.json             SessionStart, para la config de la statusline
  scripts/statusline.sh        pinta la línea y reenvía el uso a /api/uso
  scripts/guardar-config.sh    vuelca URL y token a ~/.claude/mcp-tareas/config
  scripts/revision.sh          guarda la última revisión vista del servidor
```

## Comprobaciones

```
claude plugin validate <repo>/plugin
claude plugin validate <repo>
```

El segundo valida el marketplace de la raíz.
