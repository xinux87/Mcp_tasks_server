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

/** El servidor MCP se llama así al declararlo con `claude mcp add`. */
const NOMBRE_MCP = "tareas";

/** El repositorio del que se instala el plugin. */
const REPOSITORIO = "xinux87/Mcp_tasks_server";

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
 * Paso 2: los dos comandos que conectan el terminal. Son los de «Conexión en
 * dos comandos» de CLAUDE.md, literales, con la dirección y el token puestos.
 */
function pasoDosComandos(recomendacion: string, token: string): Html {
	const comandos = [
		`claude mcp add --transport http --scope local ${NOMBRE_MCP} ${recomendacion}/mcp --header "Authorization: Bearer ${token}"`,
		`curl -fsSL ${recomendacion}/skill.md --create-dirs -o ~/.claude/skills/tareas/SKILL.md`,
	].join("\n");
	return html`<li>
			<h3>Conectar en dos comandos</h3>
			<p>
				En una terminal, <strong>dentro de la carpeta del repositorio</strong> en la que va a trabajar este
				terminal:
			</p>
			${bloque(comandos)}
			<p>
				El primero declara este servidor en esa carpeta con la cabecera del token. El segundo baja la skill
				del bucle del agente, que es la que sabe qué hacer con las tareas; se instala para tu usuario, así
				que solo hay que bajarla una vez por máquina y volver a bajarla cuando el servidor se actualice.
			</p>
			<p class="pequeno silencio">
				El ámbito local es por carpeta: cada carpeta tiene su terminal y su token, y el terminal se crea en
				el proyecto del repositorio que hay en ella. Una máquina con tres repositorios tiene tres
				terminales. El token se guarda en la configuración de Claude Code (<code>~/.claude.json</code>),
				nunca en el repositorio. El bucle avisa al servidor de en qué carpeta está: si no es la del proyecto
				de este token, la vuelta termina ahí y no toma ninguna tarea.
			</p>
		</li>`;
}

/** Paso 3: el bucle, que lo pone quien abre la sesión. */
function pasoBucle(): Html {
	return html`<li>
			<h3>Arrancar el bucle</h3>
			<p>Una vez por sesión, en la sesión de Claude Code de esa carpeta:</p>
			${bloque("/loop 2m /tareas")}
			<p class="pequeno silencio">
				Cada dos minutos una vuelta: sincroniza y, si hay trabajo para este terminal, toma una tarea. Sin
				intervalo, Claude Code elige el ritmo entre un minuto y una hora, y en reposo tiende a media hora. El
				bucle caduca a los siete días y hay que relanzarlo.
			</p>
		</li>`;
}

/** Paso 4: cómo se ve que ha conectado, desde la máquina y desde aquí. */
function pasoComprobar(): Html {
	return html`<li>
			<h3>Comprobar</h3>
			<p>En esa máquina, el servidor tiene que salir conectado:</p>
			${bloque("claude mcp list")}
			<p>
				Y aquí, en la primera vuelta el terminal se registra y su fila de
				<a href="/terminales">Terminales</a> pasa a estar conectada, con la fecha y con la carpeta en la
				que está trabajando, que es la que ha reportado al registrarse. Si no pasa, repasa la dirección
				(que se llegue a ella desde esa máquina) y el token (que sea el de este terminal y no esté
				revocado). Y si el bucle dice que la carpeta no es la del proyecto, la sesión está abierta donde
				no toca: ábrela en la carpeta del repositorio de este terminal.
			</p>
		</li>`;
}

/**
 * Paso 5: el plugin, que ya solo sirve para que el uso de la cuenta llegue a la
 * web. La skill y el servidor MCP ya están puestos con los dos comandos.
 */
function pasoPlugin(recomendacion: string, token: string): Html {
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
			<h3>Opcional: ver el uso de la cuenta en la web</h3>
			<p>
				El uso disponible de la cuenta solo llega a la línea de estado de Claude Code, así que hay un
				plugin que la pinta y de paso lo reenvía aquí. No hace falta para trabajar: el terminal ya está
				conectado. Desde una sesión de Claude Code en esa máquina, que necesita acceso git al repositorio
				con sus propias credenciales (si intenta clonar por SSH y no hay clave,
				<code>CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1</code> fuerza HTTPS):
			</p>
			${bloque(`/plugin marketplace add ${REPOSITORIO}\n/plugin install ${PLUGIN}@${CATALOGO}`)}
			<p>Al activarse pide dos valores:</p>
			<div class="tabla-envuelta">
				<table>
					<thead><tr><th>Clave</th><th>Valor</th></tr></thead>
					<tbody>
						<tr><td><code>servidor_url</code></td><td><code>${recomendacion}</code></td></tr>
						<tr><td><code>token_terminal</code></td><td><code>${token}</code></td></tr>
					</tbody>
				</table>
			</div>
			<p>Y la línea de estado se declara en <code>~/.claude/settings.json</code>:</p>
			${bloque(ajustes)}
			<p class="pequeno silencio">
				Esa ruta es fija: el plugin copia ahí su script al empezar cada sesión, porque su carpeta de
				instalación lleva la versión y cambia al actualizarlo. El script lee la dirección y el token de su
				propio archivo, que el plugin también escribe al empezar la sesión; si Claude Code no te ha pedido
				los valores, escríbelo tú:
			</p>
			${bloque(config)}
			<p class="pequeno silencio">
				El plugin no trae la skill del bucle: esa se baja con el segundo comando de arriba, la instale
				quien la instale.
			</p>
		</li>`;
}

/** Paso 6: qué hacer cuando el token cambia. */
function pasoRotar(): Html {
	return html`<li>
			<h3>Si rotas el token</h3>
			<p>
				Repite el primer comando con el token nuevo: <code>claude mcp add</code> sobre un nombre que ya
				existe lo sustituye. Si además tienes el plugin, cambia su valor en <code>/plugin</code> →
				Installed → <code>${PLUGIN}</code>, o con
				<code>${`claude plugin install ${PLUGIN}@${CATALOGO} --config token_terminal=<token nuevo>`}</code>.
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
				${pasoDosComandos(recomendacion, token)}
				${pasoBucle()}
				${pasoComprobar()}
				${pasoPlugin(recomendacion, token)}
				${pasoRotar()}
			</ol>
		</section>`;
}
