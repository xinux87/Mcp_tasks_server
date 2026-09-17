# MCP Tareas

Un tablero para trabajar con agentes de Claude Code sin ir pidiéndoles las cosas por el terminal.
El humano define las tareas en una web, las asigna a un terminal y a un modelo, y contesta desde ahí
las preguntas que le hagan; los agentes las toman solos, las trabajan y devuelven lo que han hecho.

## De qué se compone

| Pieza | Qué es | Dónde |
|---|---|---|
| **Servidor** | Un proceso Node en Docker: guarda las tareas y su hilo, expone las herramientas MCP a los agentes y sirve la web. SQLite en un volumen. | [`server/`](server/) |
| **Plugin** | Opcional: el plugin de Claude Code que reporta a la web el uso de la cuenta de un terminal. Conectarse no lo necesita. | [`plugin/`](plugin/) ([README](plugin/README.md)) |
| **Catálogo** | Lo que permite instalar ese plugin desde este mismo repositorio. | [`.claude-plugin/`](.claude-plugin/) |

**Una tarea** pasa por cinco columnas: `backlog` (la escribe el humano), `prepared` (un agente la analiza),
`doing` (otro la ejecuta), `done` (el humano revisa) y `finished`. Cada una lleva un hilo de comentarios
donde queda el análisis, las preguntas con sus opciones, las respuestas del humano y el resultado con su
commit, y cuenta los tokens que ha costado. Ese hilo es un chat: un comentario tuyo en una tarea
En curso lo atiende el agente en su siguiente vuelta, y desde Hechas puedes pedir otra iteración
con el mismo cuadro de comentar; las iteraciones se ven numeradas en la ficha. Sobre la tarjeta se
ven las marcas que dicen en qué anda
(`bloqueada` si espera una respuesta, `sin terminal` si cualquiera puede tomarla, `en marcha` si ya la ha
tomado alguien, `esperando` si depende de otra tarea que aún no está hecha), y con `autoejecucion`
activada —lo normal— la ejecución arranca sola en cuanto el análisis termina sin preguntas abiertas.
Una **funcionalidad** es una tarea que se descompone en partes; una **pregunta** es una tarea cuya
respuesta es la respuesta misma, sin código.

**La web abre en la bandeja**: lo que espera por el humano, de todos los proyectos, en cuatro bloques
por lo que le toca hacer —Contesta, Aprueba, Revisa, Define—. Se contesta y se aprueba desde ahí mismo,
sin abrir la ficha, y el número de pendientes va en la barra lateral y en el título de la pestaña. La web
habla en castellano llano (Por definir, Preparadas, En curso, Hechas, Cerradas), un único color ámbar
señala todo lo que espera por el humano, la ficha enseña el ciclo de la tarea como cinco pasos con su
dueño, y el tema es claro, oscuro o el del sistema, a elegir en la barra lateral. Las tareas se ven
además como lista y como tablero, con filtros de un clic, búsqueda por texto y el tablero agrupado en
carriles por funcionalidad. Cada
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

Docker (o Node 24 si se levanta a mano) y, en la máquina del terminal, Claude Code.

## Levantarlo

Con la imagen publicada, sin clonar el repositorio. En una carpeta vacía, el
[`docker-compose.yml`](docker-compose.yml) de la raíz y un `.env` al lado:

```sh
mkdir mcp-tareas && cd mcp-tareas
curl -fsSLO https://raw.githubusercontent.com/xinux87/Mcp_tasks_server/main/docker-compose.yml
cat > .env <<EOF
SESSION_SECRET=$(openssl rand -hex 32)
ADMIN_PASSWORD=cambiala
BASE_URL=http://localhost:9917
DATOS=./datos
EOF
docker compose up -d
```

La imagen es [`xinux87/mcp-tareas-server`](https://hub.docker.com/r/xinux87/mcp-tareas-server) en Docker Hub. Abre
`http://localhost:9917` y entra como **`admin`** con la contraseña de `ADMIN_PASSWORD`; se crea sola en el
primer arranque, cámbiala después en **Usuarios**.

### El `.env`

| Variable | Obligatoria | Qué es |
|---|---|---|
| `SESSION_SECRET` | sí | Clave con la que se firma la cookie de sesión. Cualquier cadena larga y aleatoria; `openssl rand -hex 32` vale. Cambiarla cierra todas las sesiones abiertas. |
| `ADMIN_PASSWORD` | sí | Contraseña del usuario `admin` que se crea en el primer arranque. Después de ese arranque no se vuelve a leer: la contraseña se cambia desde la web. |
| `BASE_URL` | no | URL pública del servidor, la que enseñan los enlaces y el tutorial de conexión. `http://localhost:9917` por defecto; si se accede por un dominio o una IP, va aquí. |
| `DIRECCIONES` | no | Otras URLs por las que se llega al servidor, separadas por comas (`http://192.168.1.10:9917`). Necesaria cuando los terminales están en otra máquina: dentro de Docker el servidor solo ve las direcciones del contenedor. |
| `DATOS` | no | Carpeta del anfitrión donde vive la base de datos (SQLite, el archivo `tareas.sqlite`) y todo lo de mcp-tareas. `./datos` por defecto, junto al compose. Copiarla con el servidor parado es la copia de seguridad. En Linux la escribe el uid 1000: si la creas con otro usuario, `sudo chown 1000:1000 datos`. |
| `PORT` | no | Puerto publicado en el anfitrión, `9917` por defecto. Dentro del contenedor el servidor escucha siempre en 3000. |
| `VERSION` | no | Etiqueta de la imagen, `0.1.6` por defecto. Para actualizar, súbela y vuelve a `docker compose up -d`; las migraciones de la base de datos corren solas al arrancar. |
| `AVISOS_URL` | no | Si está, cada vez que un agente deja algo esperando por ti (una pregunta, un análisis por aprobar, un resultado) se manda un POST de texto llano a esa URL: la frase y el enlace a la ficha. Es el formato de [ntfy](https://ntfy.sh); cualquier receptor de texto vale. |

### Desde el clon del repositorio

Para desarrollar o construir la imagen desde el código, el compose de `server/` la construye en vez de
descargarla y lee el `.env` de esa carpeta, con las mismas variables (menos `VERSION`; `DATOS` es opcional y
sin ella usa el volumen `datos` de Docker):

```sh
cd server
printf 'BASE_URL=http://localhost:9917\nSESSION_SECRET=%s\nADMIN_PASSWORD=cambiala\n' "$(openssl rand -hex 32)" > .env
docker compose up --build
```

### Conectar un terminal

Crea un terminal en **Terminales**: la página que enseña su token trae el tutorial de conexión con los
comandos ya montados para esa máquina, y un enlace para abrirlo allí directamente. Son dos, en la
carpeta del repositorio en la que va a trabajar ese terminal:

```
claude mcp add --transport http --scope local tareas <url>/mcp --header "Authorization: Bearer <token>"
curl -fsSL <url>/skill.md --create-dirs -o ~/.claude/skills/tareas/SKILL.md
```

El primero declara el servidor en esa carpeta —el token se guarda en la configuración de Claude Code,
nunca en el repositorio— y el segundo baja la skill del bucle, que sirve el propio servidor. Después,
una vez por sesión, `/loop 2m /tareas` arranca el bucle del agente, una vuelta cada dos minutos.

El [plugin](plugin/README.md) es opcional y sirve solo para que el **uso disponible de la cuenta** salga
en la web: ese dato únicamente llega a la línea de estado de Claude Code. Se instala desde GitHub con
`/plugin marketplace add xinux87/Mcp_tasks_server` y `/plugin install mcp-tareas@mcp-tareas-marketplace`.

### Si el terminal está en otra máquina

Con `BASE_URL=http://localhost:9917` y sin nada más, cualquier petición desde otra máquina de la red
responde `403 Invalid Host`: el servidor solo admite las direcciones que conoce. Y dentro de Docker las
que detecta solo son las del contenedor, que no valen desde fuera. Añade al `.env`, antes de levantarlo:

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

### Publicar una versión

La versión va en cuatro sitios a la vez: `server/package.json`, `plugin/.claude-plugin/plugin.json`,
`.claude-plugin/marketplace.json` y `server/Dockerfile` (etiqueta `org.opencontainers.image.version`).
Cada versión lleva su etiqueta `vX.Y.Z` en git, que es lo que fija `xinux87/Mcp_tasks_server#vX.Y.Z` al
instalar el plugin. La imagen se construye para `amd64` y `arm64` a la vez y se sube a Docker Hub, a `xinux87/mcp-tareas-server`;
`buildx` publica las dos bajo la misma etiqueta y cada máquina descarga la suya (una imagen multi-arquitectura
no se puede cargar en el Docker local, por eso se construye y se sube en el mismo comando):

```sh
cd server
docker buildx create --name mcp-tareas --driver docker-container --use   # solo la primera vez
docker login -u xinux87
docker buildx build --platform linux/amd64,linux/arm64 -t xinux87/mcp-tareas-server:0.1.6 --push .
```

Desde el clon, `IMAGEN=xinux87/mcp-tareas-server:0.1.6 docker compose up` la descarga en vez de
construirla. El `docker-compose.yml` de la raíz lleva la versión publicada en `VERSION`; al publicar una
nueva se actualiza ahí también.

## Dónde está el detalle

[`CLAUDE.md`](CLAUDE.md) es la definición completa: el modelo de tareas, las reglas, las operaciones del MCP,
la web y el stack, y cómo se construye este repositorio. Manda sobre este archivo; esto es solo el resumen.
[`modelo-comunicacion.md`](modelo-comunicacion.md) es el diseño original del hilo de comentarios y de la
señal de novedad, del que salió lo que hoy está en `CLAUDE.md`.

Licencia MIT.
