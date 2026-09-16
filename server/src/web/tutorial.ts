import { html } from "hono/html";
import type { Direccion, OrigenDireccion } from "../direcciones.ts";
import { bloqueCodigo } from "./componentes.ts";
import type { Html } from "./plantilla.ts";

/**
 * El tutorial de conexión de un terminal, que sale en dos sitios: debajo del
 * token en «Terminal creado», con el token de verdad, y en
 * `GET /terminales/conectar`, con `<token>` como marcador.
 *
 * Los comandos están verificados contra la documentación de Claude Code, como
 * pide «Direcciones del servidor y tutorial de conexión» en CLAUDE.md: nada de
 * lo que hay aquí se ha inventado. Todo pasa por la plantilla `html`, así que
 * el token y las direcciones llegan escapados al navegador.
 */

/** El nombre del plugin y el de su catálogo, tal como los declara el repositorio. */
const PLUGIN = "mcp-tareas";
const CATALOGO = "mcp-tareas-marketplace";

/** El servidor MCP se llama así al declararlo a mano, sin plugin. */
const NOMBRE_MCP = "tareas";

/** El repositorio del que se instala el plugin. */
const REPOSITORIO = "xinux87/Mcp_tasks_server";

/** Marcador de la ruta donde el usuario haya clonado el repositorio: el servidor no la sabe. */
const RUTA_REPOSITORIO = "<ruta-del-repositorio>";

/** Hostnames que no sirven desde otra máquina: son el propio ordenador. */
const LOCALES: readonly string[] = ["localhost", "127.0.0.1", "[::1]", "::1"];

/** Cómo se explica cada origen en la tabla de direcciones. */
const FRASE_ORIGEN: Record<OrigenDireccion, string> = {
	base: "la configurada como base",
	configurada: "configurada en DIRECCIONES",
	detectada: "detectada en la red",
};

/** La que el navegador está usando ahora se explica aparte: no sale de la configuración. */
const FRASE_ACTUAL = "la que estás usando ahora en el navegador";

/** Una fila de la tabla de direcciones: la URL y de dónde ha salido. */
type Fila = {
	url: string;
	origen: string;
};

export type OpcionesTutorial = {
	/** Las direcciones conocidas del servidor, en orden. */
	direcciones: readonly Direccion[];
	/**
	 * La dirección por la que ha entrado el navegador, compuesta con la
	 * cabecera `Host` y el esquema de `BASE_URL`. Solo se enseña si no
	 * coincide con ninguna de las conocidas.
	 */
	direccionActual: string | null;
	/** El token del terminal, o `<token>` cuando el tutorial se enseña sin él. */
	token: string;
};

/** Las direcciones conocidas y, si aporta algo, por la que se ha entrado. */
function filasDe(direcciones: readonly Direccion[], direccionActual: string | null): Fila[] {
	const filas: Fila[] = direcciones.map((direccion) => ({
		url: direccion.url,
		origen: FRASE_ORIGEN[direccion.origen],
	}));
	if (direccionActual !== null && !filas.some((fila) => fila.url === direccionActual)) {
		filas.push({ url: direccionActual, origen: FRASE_ACTUAL });
	}
	return filas;
}

/**
 * La dirección que se recomienda para un terminal de otra máquina: la primera
 * que no sea el propio ordenador. Si todas lo son, la primera, que al menos
 * sirve para un terminal en esta misma máquina.
 */
function recomendada(filas: readonly Fila[]): string {
	const fuera = filas.find((fila) => !LOCALES.includes(new URL(fila.url).hostname));
	return fuera?.url ?? filas[0]?.url ?? "";
}

/**
 * El enlace que abre este tutorial en la máquina del terminal con el token ya
 * puesto. Es un secreto: quien lo tiene, tiene el terminal, y deja de valer en
 * cuanto el token se revoca o se rota.
 */
export function enlaceDeConexion({ direcciones, direccionActual, token }: OpcionesTutorial): string {
	const recomendacion = recomendada(filasDe(direcciones, direccionActual));
	return `${recomendacion}/terminales/conectar?token=${encodeURIComponent(token)}`;
}

/**
 * Un bloque de comandos copiable, entero o línea a línea. Los botones los
 * activa `cliente.ts`, que los esconde si el navegador no tiene portapapeles;
 * el texto se puede seleccionar a mano de todas formas.
 */
const bloque = bloqueCodigo;

/** Paso 1: por dónde se llega a este servidor. */
function pasoDirecciones(filas: readonly Fila[], recomendacion: string): Html {
	return html`<li>
			<h3>Direcciones del servidor</h3>
			<p>Por estas direcciones se llega a este servidor:</p>
			<div class="tabla-envuelta">
				<table>
					<thead><tr><th>Dirección</th><th>Origen</th></tr></thead>
					<tbody>
						${filas.map((fila) => html`<tr><td><code>${fila.url}</code></td><td class="pequeno">${fila.origen}</td></tr>`)}
					</tbody>
				</table>
			</div>
			<p>
				Para un terminal en otra máquina de la red usa <code>${recomendacion}</code>; es la que llevan
				los comandos de aquí abajo.
			</p>
			<p class="pequeno silencio">
				Si este servidor corre en Docker, las direcciones detectadas son las del contenedor y no valen
				desde fuera: hay que usar la IP de la máquina anfitriona y publicar el puerto sin atarlo a
				127.0.0.1. Lo más fiable es fijar la variable DIRECCIONES del servidor con las direcciones
				buenas.
			</p>
		</li>`;
}

/**
 * Paso 2: un terminal por carpeta. El plugin solo guarda un token por máquina
 * (los ámbitos de proyecto y local se ignoran para `pluginConfigs`), así que la
 * segunda carpeta de la misma máquina declara el servidor con ámbito local.
 */
function pasoPorCarpeta(recomendacion: string, token: string): Html {
	return html`<li>
			<h3>Un terminal por carpeta</h3>
			<p>
				Cada carpeta de trabajo tiene su propio terminal y su propio token, y el terminal se crea en el
				proyecto del repositorio que hay en esa carpeta. Una máquina con tres repositorios tiene tres
				terminales. El bucle avisa al servidor de en qué carpeta está: si no es la del proyecto de este
				token, la vuelta termina ahí y no toma ninguna tarea.
			</p>
			<p>
				Para una segunda carpeta en esta misma máquina, no repitas el plugin: declara el servidor dentro
				de esa carpeta con ámbito local.
			</p>
			${bloque(
				`claude mcp add --transport http --scope local ${NOMBRE_MCP} ${recomendacion}/mcp --header "Authorization: Bearer ${token}"`,
			)}
			<p class="pequeno silencio">
				La configuración del plugin es una por máquina: Claude Code guarda sus valores solo en los ajustes
				del usuario, así que el plugin no puede llevar dos tokens a la vez. El ámbito local gana al
				servidor del plugin, se guarda por ruta en la configuración de Claude Code y no escribe nada en el
				repositorio.
			</p>
		</li>`;
}

/** Paso 3: instalar el plugin desde el catálogo del repositorio. */
function pasoInstalar(): Html {
	return html`<li>
			<h3>Instalar el plugin</h3>
			<p>
				Desde una sesión de Claude Code en la máquina del terminal, que necesita acceso git a ese
				repositorio con sus propias credenciales (si intenta clonar por SSH y no hay clave,
				<code>CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1</code> fuerza HTTPS):
			</p>
			${bloque(`/plugin marketplace add ${REPOSITORIO}\n/plugin install ${PLUGIN}@${CATALOGO}`)}
			<p>Si lo tienes clonado y quieres esa copia, en su lugar la ruta del clon:</p>
			${bloque(`/plugin marketplace add ${RUTA_REPOSITORIO}\n/plugin install ${PLUGIN}@${CATALOGO}`)}
			<p>Y para probarlo sin instalar nada, arranca Claude Code apuntando a la carpeta del plugin:</p>
			${bloque(`claude --plugin-dir ${RUTA_REPOSITORIO}/plugin`)}
			<p class="pequeno silencio">
				Si Claude Code no te pide los dos valores del plugin (con <code>--plugin-dir</code> puede no
				hacerlo), escríbelos a mano donde toque.
			</p>
		</li>`;
}

/** Paso 4: los dos valores que el plugin pide al activarse. */
function pasoValores(recomendacion: string, token: string): Html {
	return html`<li>
			<h3>Los dos valores que pide al activarse</h3>
			<div class="tabla-envuelta">
				<table>
					<thead><tr><th>Clave</th><th>Valor</th></tr></thead>
					<tbody>
						<tr><td><code>servidor_url</code></td><td><code>${recomendacion}</code></td></tr>
						<tr><td><code>token_terminal</code></td><td><code>${token}</code></td></tr>
					</tbody>
				</table>
			</div>
			<p class="pequeno silencio">
				El token se guarda en la configuración local de Claude Code, nunca en el repositorio. Si lo has
				rotado, cámbialo en <code>/plugin</code> → Installed → <code>${PLUGIN}</code>, o con
				<code>${`claude plugin install ${PLUGIN}@${CATALOGO} --config token_terminal=<token nuevo>`}</code>.
			</p>
		</li>`;
}

/** Paso 5: declarar el servidor MCP a mano, sin plugin. */
function pasoSinPlugin(recomendacion: string, token: string): Html {
	return html`<li>
			<h3>Sin plugin: solo el servidor MCP</h3>
			<p>Declara el servidor por HTTP con la cabecera del token:</p>
			${bloque(
				`claude mcp add --transport http ${NOMBRE_MCP} ${recomendacion}/mcp --header "Authorization: Bearer ${token}"`,
			)}
			<p class="pequeno silencio">
				Añade <code>--scope user</code> para tenerlo en todos los proyectos, o <code>--scope project</code>
				para compartirlo en este. Así solo tienes las herramientas: sin plugin no hay bucle del agente ni
				línea de estado con el uso disponible. Si has rotado el token, repite el mismo comando con el
				nuevo.
			</p>
		</li>`;
}

/** Paso 6: la línea de estado, que es de donde sale el uso disponible de la cuenta. */
function pasoStatusline(recomendacion: string, token: string): Html {
	const ajustes = [
		"{",
		'  "statusLine": {',
		'    "type": "command",',
		'    "command": "~/.claude/mcp-tareas/statusline.sh",',
		'    "padding": 2',
		"  }",
		"}",
	].join("\n");
	const config = [
		"mkdir -p ~/.claude/mcp-tareas",
		"cat > ~/.claude/mcp-tareas/config <<EOF",
		`SERVIDOR_URL=${recomendacion}`,
		`TOKEN=${token}`,
		"EOF",
		"chmod 600 ~/.claude/mcp-tareas/config",
	].join("\n");
	return html`<li>
			<h3>Línea de estado</h3>
			<p>
				El uso disponible de la cuenta solo llega a la línea de estado, así que el plugin trae un script
				que la pinta y de paso lo reenvía aquí. En <code>~/.claude/settings.json</code>:
			</p>
			${bloque(ajustes)}
			<p class="pequeno silencio">
				Esa ruta es fija: el plugin copia ahí su script al empezar cada sesión, porque su carpeta de
				instalación lleva la versión y cambia al actualizarlo.
			</p>
			<p>
				El script lee la dirección y el token de su propio archivo, que el plugin también escribe al
				empezar la sesión. Si Claude Code no te ha pedido los valores, escríbelo tú:
			</p>
			${bloque(config)}
		</li>`;
}

/** Paso 7: el bucle, que no lo pone el plugin sino quien abre la sesión. */
function pasoBucle(): Html {
	return html`<li>
			<h3>Arrancar el bucle</h3>
			<p>Una vez por sesión, en la máquina del terminal:</p>
			${bloque("/loop /mcp-tareas:tareas")}
			<p class="pequeno silencio">
				Cada disparo es una vuelta: sincroniza y, si hay trabajo para este terminal, toma una tarea. El
				bucle caduca a los siete días y hay que relanzarlo.
			</p>
		</li>`;
}

/** Paso 8: cómo se ve desde aquí que ha conectado. */
function pasoComprobar(): Html {
	return html`<li>
			<h3>Comprobar</h3>
			<p>
				En la primera vuelta el terminal se registra y su fila de
				<a href="/terminales">Terminales</a> pasa a estar conectada, con la fecha y con la carpeta en la
				que está trabajando, que es la que ha reportado al registrarse. Si no pasa, repasa la dirección
				(que se llegue a ella desde esa máquina) y el token (que sea el de este terminal y no esté
				revocado). Y si el bucle dice que la carpeta no es la del proyecto, la sesión está abierta donde
				no toca: ábrela en la carpeta del repositorio de este terminal.
			</p>
		</li>`;
}

/**
 * El tutorial entero. Los pasos van numerados por la lista, y cada bloque de
 * comandos lleva su botón de copiar.
 */
export function tutorialConexion({ direcciones, direccionActual, token }: OpcionesTutorial): Html {
	const filas = filasDe(direcciones, direccionActual);
	const recomendacion = recomendada(filas);
	return html`<section class="caja tutorial">
			<h2>Cómo conectar un terminal</h2>
			<ol class="pasos">
				${pasoDirecciones(filas, recomendacion)}
				${pasoPorCarpeta(recomendacion, token)}
				${pasoInstalar()}
				${pasoValores(recomendacion, token)}
				${pasoSinPlugin(recomendacion, token)}
				${pasoStatusline(recomendacion, token)}
				${pasoBucle()}
				${pasoComprobar()}
			</ol>
		</section>`;
}
