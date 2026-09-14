# MCP Tareas

Un tablero para trabajar con agentes de Claude Code sin ir pidiéndoles las cosas por el terminal.
El humano define las tareas en una web, las asigna a un terminal y a un modelo, y contesta desde ahí
las preguntas que le hagan; los agentes las toman solos, las trabajan y devuelven lo que han hecho.

## De qué se compone

| Pieza | Qué es | Dónde |
|---|---|---|
| **Servidor** | Un proceso Node en Docker: guarda las tareas y su hilo, expone las herramientas MCP a los agentes y sirve la web. SQLite en un volumen. | [`server/`](server/) |
| **Plugin** | El plugin de Claude Code que conecta un terminal al servidor, arranca el bucle del agente y reporta el uso de la cuenta. | [`plugin/`](plugin/) ([README](plugin/README.md)) |
| **Catálogo** | Lo que permite instalar ese plugin desde este mismo repositorio. | [`.claude-plugin/`](.claude-plugin/) |

**Una tarea** pasa por cinco columnas: `backlog` (la escribe el humano), `prepared` (un agente la analiza),
`doing` (otro la ejecuta), `done` (el humano revisa) y `finished`. Cada una lleva un hilo de comentarios
donde queda el análisis, las preguntas con sus opciones, las respuestas del humano y el resultado con su
commit, y cuenta los tokens que ha costado. Sobre la tarjeta se ven las marcas que dicen en qué anda
(`bloqueada` si espera una respuesta, `sin terminal` si cualquiera puede tomarla, `en marcha` si ya la ha
tomado alguien, `esperando` si depende de otra tarea que aún no está hecha), y con `autoejecucion`
activada —lo normal— la ejecución arranca sola en cuanto el análisis termina sin preguntas abiertas.
Una **funcionalidad** es una tarea que se descompone en partes; una **pregunta** es una tarea cuya
respuesta es la respuesta misma, sin código.

**La web abre en la bandeja**: lo que espera por el humano, de todos los proyectos, en cuatro bloques
—preguntas sin contestar, análisis por aprobar, resultados por revisar y lo que lleva más de una semana
en `backlog`—. Se contesta y se aprueba desde ahí mismo, sin abrir la ficha, y el número de pendientes va
en la barra lateral y en el título de la pestaña. Las tareas se ven además como lista y como kanban,
con filtros de un clic, búsqueda por texto y el kanban agrupado en carriles por funcionalidad. Cada
tarjeta enseña cuánto lleva en su columna, el progreso de sus hijas y los tokens que ha costado, contra
su presupuesto si lo tiene. La página de informes dice qué cuesta cada modelo, cuánto interrumpe, dónde
se atasca el flujo y qué modelo entrega resultados que no valen.

**Un proyecto** es un repositorio, con su rama principal y su comando de verificación. Las tareas viven
en un proyecto y cada terminal pertenece a uno y trabaja en una carpeta: una máquina con tres
repositorios tiene tres terminales, cada uno con su token. El bucle reporta al registrarse en qué carpeta
está, y el servidor no le deja tomar tareas de otro proyecto. Como el plugin solo guarda un token por
máquina, la segunda carpeta declara el servidor con ámbito local, que gana al del plugin y no escribe
nada en el repositorio:

```
claude mcp add --transport http --scope local tareas <url>/mcp --header "Authorization: Bearer <token>"
```

## Requisitos

Docker (o Node 24 si se levanta a mano) y, en la máquina del terminal, Claude Code con acceso git a este
repositorio.

## Levantarlo

```sh
cd server
printf 'BASE_URL=http://localhost:9917\nSESSION_SECRET=%s\nADMIN_PASSWORD=cambiala\n' "$(openssl rand -hex 32)" > .env
docker compose up --build
```

Abre `http://localhost:9917` (el puerto lo publica `compose.yaml`) y entra como **`admin`** con la
contraseña de `ADMIN_PASSWORD`; se crea sola en el primer arranque, cámbiala después en **Usuarios**.

Crea un terminal en **Terminales**: la página que enseña su token trae el tutorial de conexión con los
comandos ya montados para esa máquina, y un enlace para abrirlo allí directamente. El plugin se instala
desde GitHub con dos comandos en la sesión de Claude Code de esa máquina:

```
/plugin marketplace add xinux87/Mcp_tasks_server
/plugin install mcp-tareas@mcp-tareas-marketplace
```

El detalle está en [`plugin/README.md`](plugin/README.md). Después, una vez por sesión,
`/loop /mcp-tareas:tareas` arranca el bucle del agente.

### Si el terminal está en otra máquina

Con `BASE_URL=http://localhost:9917` y sin nada más, cualquier petición desde otra máquina de la red
responde `403 Invalid Host`: el servidor solo admite las direcciones que conoce. Y dentro de Docker las
que detecta solo son las del contenedor, que no valen desde fuera. Añade al `server/.env`, antes de
levantarlo:

```sh
DIRECCIONES=http://<ip-del-anfitrión>:9917
```

Es la dirección que el tutorial pondrá en los comandos del terminal.

### A mano, sin Docker

Con Node 24, las mismas variables del `.env` más `DATA_DIR`, que sin Docker apunta por defecto a `/data`:

```sh
cd server
npm install
DATA_DIR=./data npm run dev
```

### Desarrollo

Dentro de `server/`: `npm test`, `npm run typecheck` y `npm run lint`. El plugin se comprueba con
`claude plugin validate ./plugin --strict`.

## Dónde está el detalle

[`CLAUDE.md`](CLAUDE.md) es la definición completa: el modelo de tareas, las reglas, las operaciones del MCP,
la web y el stack, y cómo se construye este repositorio. Manda sobre este archivo; esto es solo el resumen.
[`modelo-comunicacion.md`](modelo-comunicacion.md) es el diseño original del hilo de comentarios y de la
señal de novedad, del que salió lo que hoy está en `CLAUDE.md`.

Licencia MIT.
