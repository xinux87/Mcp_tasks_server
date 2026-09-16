# mcp-tareas

Plugin **opcional** de Claude Code. Sirve para una sola cosa: que el **uso disponible de la cuenta** salga en la web del servidor de tareas. Ese dato solo llega a la línea de estado de Claude Code, y una línea de estado no se puede poner desde un archivo de texto: por eso hay un plugin.

- **Reenvía el uso de la cuenta** (`scripts/statusline.sh`), que pinta la línea de estado y de paso manda el JSON a `POST /api/uso`.
- **Declara el servidor MCP** (`.mcp.json`) con la URL y el token que pides al activarlo, por si prefieres tenerlo puesto para toda la máquina.

## Conectar un terminal no necesita este plugin

Un terminal se conecta con dos comandos, en la carpeta del repositorio en la que va a trabajar:

```
claude mcp add --transport http --scope local tareas <url>/mcp --header "Authorization: Bearer <token>"
curl -fsSL <url>/skill.md --create-dirs -o ~/.claude/skills/tareas/SKILL.md
```

Y en la sesión de Claude Code de esa carpeta, `/loop 2m /tareas`.

El primero declara el servidor en esa carpeta; el token se guarda en la configuración de Claude Code, nunca en el repositorio. El segundo baja la skill del bucle, que la sirve el propio servidor y ya no viene en este plugin: quien instale el plugin hace también ese segundo comando. La página «Terminal creado» de la web trae los dos comandos con la dirección y el token puestos.

El ámbito local es por carpeta, que es justo lo que hace falta: una máquina con tres repositorios tiene tres terminales, cada uno con su token. La configuración de este plugin, en cambio, es una por máquina (Claude Code guarda los valores de `userConfig` solo en los ajustes del usuario), y basta: el uso es de la cuenta, no de la carpeta.

## 1. Crear el terminal en la web

1. Entra en la web del servidor y ve a la sección de terminales.
2. Crea un terminal con su **nombre** (por ejemplo `portatil-1`), la **cuenta de origen** de la sesión de Claude Code y el **proyecto** en el que trabaja.
3. La web te enseña el **token una sola vez**. Cópialo antes de cerrar. Si lo pierdes, rota el token de ese terminal desde la web: el terminal sigue siendo el mismo, con su nombre, su historial y su consumo, y lo que deja de valer es el token anterior.

Esa misma página trae el tutorial de conexión con el token ya puesto y un **enlace de conexión**. El enlace abre el tutorial en la máquina del terminal sin necesidad de sesión en la web, así que no hace falta copiar el token a mano de una máquina a otra. Es un secreto: quien lo tiene, tiene el terminal, y deja de valer en cuanto se revoca o se rota el token.

El token identifica al terminal y a su usuario. El plugin lo guarda en tu configuración local; nunca en el repositorio.

## 2. Instalar el plugin (opcional)

### Desde GitHub

Dentro de una sesión de Claude Code:

```
/plugin marketplace add xinux87/Mcp_tasks_server
/plugin install mcp-tareas@mcp-tareas-marketplace
```

Y los mismos dos pasos desde fuera de la sesión:

```
claude plugin marketplace add xinux87/Mcp_tasks_server
claude plugin install mcp-tareas@mcp-tareas-marketplace
```

El primer comando registra el catálogo del repositorio (`.claude-plugin/marketplace.json` en la raíz, que apunta a `./plugin`). El catálogo se llama `mcp-tareas-marketplace`, que es el `name` del `marketplace.json`, no el nombre del repositorio: por eso el segundo comando lleva ese sufijo.

El repositorio es público: no hace falta ninguna credencial para instalar. Claude Code 2.1 clona por HTTPS; si tu versión intenta SSH y no tienes clave, fuerza HTTPS:

```
CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1 claude plugin marketplace add xinux87/Mcp_tasks_server
```

Para fijar una rama o una etiqueta, añade `#` y la referencia: `xinux87/Mcp_tasks_server#v0.1.0`.

Actualizar y desinstalar:

```
claude plugin update mcp-tareas@mcp-tareas-marketplace
claude plugin uninstall mcp-tareas@mcp-tareas-marketplace
```

### Desde un clon local

Con la raíz del clon de este repositorio como `<repo>`:

```
/plugin marketplace add <repo>
/plugin install mcp-tareas@mcp-tareas-marketplace
```

Es la misma instalación, con el catálogo leído del disco en vez de clonado de GitHub.

Para desarrollo, sin instalar ni registrar nada, arranca Claude Code apuntando directamente al plugin:

```
claude --plugin-dir <repo>/plugin
```

### Configuración

Cuando habilitas el plugin, Claude Code te pide los dos valores:

| Clave | Qué es |
|---|---|
| `servidor_url` | URL base del servidor, sin barra final. Por ejemplo `https://tareas.example.com` |
| `token_terminal` | El token que te dio la web. Va marcado como sensible y se guarda en la configuración de Claude Code, nunca en el repositorio |

Si Claude Code no te los pide (con `--plugin-dir` puede no hacerlo), escribe el archivo de configuración de la statusline a mano (paso 3) y declara el servidor MCP por tu cuenta.

Si el resumen de la instalación dice `Run /reload-plugins to activate.`, ejecuta `/reload-plugins`.

Para cambiarlos después, por ejemplo tras rotar el token, hay dos formas y ninguna exige desinstalar:

- Abre `/plugin`, ve a la pestaña **Installed** y entra en el detalle de `mcp-tareas`.
- O vuelve a lanzar la instalación con el valor nuevo:

```
claude plugin install mcp-tareas@mcp-tareas-marketplace --config token_terminal=<token>
```

## 3. Configurar la statusline

Claude Code solo pasa el uso disponible de la cuenta (`rate_limits`) a la statusline, y un plugin no puede imponer la suya. Añade esto a `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/mcp-tareas/statusline.sh",
    "padding": 2
  }
}
```

Esa ruta es una copia que el hook `SessionStart` del plugin refresca al empezar cada sesión, porque la carpeta donde Claude Code instala el plugin lleva la versión dentro y cambia con cada actualización.

La línea que pinta es el modelo y, cuando existen, el porcentaje usado de la ventana de 5 horas y la de 7 días:

```
Opus | 5h 23% | 7d 41%
```

`rate_limits` solo existe en cuentas Pro o Max y solo a partir de la primera respuesta de la API. Sin ese dato la línea muestra solo el modelo.

El script envía el JSON al servidor como mucho una vez por minuto y por sesión, en segundo plano y con dos segundos de tope. Si el servidor no responde, la statusline no se entera.

### De dónde saca el script la URL y el token

La statusline no es un componente del plugin: Claude Code no le pasa `${user_config.*}` ni las variables `CLAUDE_PLUGIN_OPTION_*`. El puente es el mismo hook `SessionStart` (`scripts/guardar-config.sh`), que al empezar cada sesión escribe `~/.claude/mcp-tareas/config` con permisos 600 y este contenido:

```
SERVIDOR_URL=https://tareas.example.com
TOKEN=el-token-del-terminal
```

No hay que hacer nada: el hook lo mantiene al día. Si Claude Code no te pidió los dos valores, o quieres apuntar la statusline a otro servidor, crea ese archivo tú:

```
mkdir -p ~/.claude/mcp-tareas
printf 'SERVIDOR_URL=%s\nTOKEN=%s\n' 'https://tareas.example.com' 'el-token' > ~/.claude/mcp-tareas/config
chmod 600 ~/.claude/mcp-tareas/config
```

Las variables de entorno `SERVIDOR_URL` y `TOKEN` tienen prioridad sobre el archivo.

## 4. Arrancar el bucle

Esto no es del plugin: la skill `tareas` la baja el segundo comando de arriba. Una vez por terminal, al abrir la sesión:

```
/loop 2m /tareas
```

Sin intervalo, Claude elige uno entre un minuto y una hora según lo que vea: corto mientras hay trabajo, largo cuando no pasa nada. Para un intervalo fijo:

```
/loop 2m /tareas
```

Cada disparo es **una vuelta**: sincroniza, y si no hay novedades termina sin gastar casi nada. Si hay trabajo, toma **una** tarea, lanza la fase que toque como subagente con el modelo asignado y reporta su consumo.

La primera vuelta registra el terminal en el servidor y, si ya hay tareas asignadas, toma la primera.

## 5. Parar el bucle

- **Sin intervalo** (el bucle elige el ritmo): pulsa `Esc` mientras espera.
- **Con intervalo fijo**: pídeselo a Claude, «cancela la tarea programada del bucle de tareas». Por debajo usa `CronList` y `CronDelete`.
- Empezar una conversación nueva también lo borra. Los bucles caducan solos a los 7 días.

## Estructura

```
plugin/
  .claude-plugin/plugin.json   manifiesto, userConfig (URL y token)
  .mcp.json                    el servidor MCP `tareas`, HTTP con bearer
  hooks/hooks.json             SessionStart, para la statusline y su config
  scripts/statusline.sh        pinta la línea y reenvía el uso a /api/uso
  scripts/guardar-config.sh    copia la statusline a ~/.claude/mcp-tareas/ y
                               vuelca ahí la URL y el token
```

## Comprobaciones

Desde la raíz del repositorio:

```
claude plugin validate ./plugin --strict
claude plugin validate . --strict
```

El segundo valida el marketplace de la raíz.
