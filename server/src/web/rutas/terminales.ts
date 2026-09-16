import type { DatabaseSync } from "node:sqlite";
import type { Context, Hono } from "hono";
import { html, raw } from "hono/html";
import { buscarTerminalPorToken } from "../../auth/tokens.ts";
import type { Config } from "../../config.ts";
import { actividadDe, altaPor } from "../../db/actividad.ts";
import {
	altaTerminal,
	borrarTerminal,
	cambiarAgentes,
	listarTerminales,
	revocarTerminal,
	rotarTerminal,
	type TerminalListado,
} from "../../db/admin.ts";
import type { Usuario } from "../../db/consultas.ts";
import { listarProyectos, PROYECTO_PRINCIPAL, type Proyecto } from "../../db/proyectos.ts";
import { direccionesDelServidor } from "../../direcciones.ts";
import {
	bloqueCodigo,
	buscadorDeColor,
	type Color,
	chipDeAlta,
	chipProyecto,
	chipUsuario,
	etiqueta,
	type Miga,
} from "../componentes.ts";
import { fechaLegible, SIN_DATO } from "../formatos.ts";
import { campo, ESTADO_AVISO, leerFormulario, mensajeDeRegla } from "../formulario.ts";
import { type Html, pagina, type RespuestaHtml } from "../plantilla.ts";
import { type DependenciasWeb, leerSesion, usuarioActual } from "../sesion.ts";
import { enlaceDeConexion, type OpcionesTutorial, tutorialConexion } from "../tutorial.ts";
import { navProyectos } from "./proyectos.ts";

/** Cómo se busca el color de cada usuario que aparece en la página. */
type ColorDe = (nombre: string) => Color | null;

/**
 * Las tres ventanas de uso que Claude Code pasa a la statusline, con el texto
 * que se enseña. El servidor solo recibe el JSON y lo muestra: nunca calcula
 * el uso.
 */
const VENTANAS: readonly { clave: string; etiqueta: string }[] = [
	{ clave: "five_hour", etiqueta: "5 h" },
	{ clave: "seven_day", etiqueta: "7 días" },
	{ clave: "spend_limit", etiqueta: "gasto" },
];

function esObjeto(valor: unknown): valor is Record<string, unknown> {
	return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function numeroDe(objeto: Record<string, unknown>, clave: string): number | null {
	const valor = objeto[clave];
	return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

const SIN_DATOS = html`<span class="silencio">sin datos</span>`;

/**
 * La decena que le toca a la barra, de 0 a 10. El ancho se pinta con una regla
 * por valor en la hoja de estilos: en las plantillas no hay estilos en línea.
 */
function nivelDe(porcentaje: number): number {
	return Math.round(porcentaje / 10);
}

/**
 * Cuándo se reinicia una ventana. Claude Code lo manda como fecha ISO, y
 * alguna versión como segundos desde la época: se aceptan las dos formas antes
 * que enseñar una raya donde hay dato.
 */
function cuandoReinicia(ventana: Record<string, unknown>): string | null {
	const valor = ventana.resets_at;
	if (typeof valor === "number" && Number.isFinite(valor)) {
		return fechaLegible(new Date(valor * 1000));
	}
	if (typeof valor === "string") {
		const legible = fechaLegible(valor);
		return legible === SIN_DATO ? null : legible;
	}
	return null;
}

/** Una ventana de `rate_limits`: lo que queda, como barra, y cuándo se reinicia. */
function lineaVentana(limites: Record<string, unknown>, clave: string, nombre: string): Html | null {
	const ventana = limites[clave];
	if (!esObjeto(ventana)) {
		return null;
	}
	const usado = numeroDe(ventana, "used_percentage");
	if (usado === null) {
		return null;
	}
	const restante = Math.round(Math.min(100, Math.max(0, 100 - usado)));
	const reinicia = cuandoReinicia(ventana);
	return html`<li class="uso-ventana">
			<span class="uso-cabecera">
				<span class="uso-nombre">${nombre}</span>
				<span class="uso-cifra">${restante} % disponible</span>
			</span>
			<span class="uso-barra"><span class="uso-relleno" data-nivel="${nivelDe(restante)}"></span></span>
			${reinicia === null ? html`` : html`<span class="uso-reinicio">reinicia ${reinicia}</span>`}
		</li>`;
}

/**
 * Uso disponible del terminal. Con `rate_limits` se enseña, por ventana, el
 * porcentaje que queda; una sesión con clave de API no los tiene y solo
 * reporta el coste estimado.
 */
function usoLegible(usoJson: string | null): Html {
	if (usoJson === null) {
		return SIN_DATOS;
	}
	let bruto: unknown;
	try {
		bruto = JSON.parse(usoJson);
	} catch {
		return SIN_DATOS;
	}
	if (!esObjeto(bruto)) {
		return SIN_DATOS;
	}
	const limites = bruto.rate_limits;
	if (esObjeto(limites)) {
		const lineas = VENTANAS.map((ventana) => lineaVentana(limites, ventana.clave, ventana.etiqueta)).filter(
			(linea) => linea !== null,
		);
		if (lineas.length > 0) {
			return html`<ul class="uso">${lineas}</ul>`;
		}
	}
	const coste = bruto.cost;
	if (esObjeto(coste)) {
		const total = numeroDe(coste, "total_cost_usd");
		if (total !== null) {
			return html`<span class="pequeno">coste de sesión: $${total.toFixed(2)}</span>`;
		}
	}
	return SIN_DATOS;
}

/**
 * Quién revocó el terminal. Se busca la última revocación del rastro: un
 * terminal solo se revoca una vez, pero la última es la que vale.
 */
function revocadoPor(db: DatabaseSync, terminalId: number): string | null {
	const rastro = actividadDe(db, "terminal", terminalId);
	return rastro.findLast((fila) => fila.accion === "revocar_terminal")?.usuarioNombre ?? null;
}

/**
 * El estado del terminal: verde mientras vale, gris con la fecha en que dejó de
 * valer. La fecha va fuera de la etiqueta porque dentro no puede partirse, y
 * una etiqueta de quince caracteres ensancharía la tabla entera.
 */
function insigniaTerminal(terminal: TerminalListado): Html {
	if (terminal.revocadoEn === null) {
		return etiqueta("Activo", "verde");
	}
	return html`${etiqueta("Revocado", "gris")}<span class="pequeno silencio">${fechaLegible(terminal.revocadoEn)}</span>`;
}

/**
 * Los agentes en paralelo se cambian desde la propia fila, sin salir de la
 * lista. Un terminal revocado no los cambia: ya no va a tomar nada.
 */
function formularioAgentes(terminal: TerminalListado): Html {
	if (terminal.revocadoEn !== null) {
		return html`<span class="silencio">${terminal.agentes}</span>`;
	}
	// El rótulo va en `aria-label`: la cabecera de la columna ya dice qué es, y
	// una etiqueta visible por fila repetiría «Agentes» diez veces.
	return html`<form class="cambio-agentes" method="post" action="/terminales/${terminal.id}/agentes">
			<input type="number" name="agentes" min="1" value="${terminal.agentes}" required
				aria-label="Agentes en paralelo de ${terminal.nombre}">
			<button type="submit" class="pequeno">Guardar</button>
		</form>`;
}

function filaTerminal(db: DatabaseSync, terminal: TerminalListado, colorDe: ColorDe): Html {
	const revocado = terminal.revocadoEn !== null;
	return html`<tr>
			<td>
				${terminal.nombre}
				${terminal.ruta === null ? html`` : html`<span class="pequeno silencio">${terminal.ruta}</span>`}
			</td>
			<td>${chipProyecto(terminal.proyecto)}</td>
			<td class="pequeno celda-cuenta">${terminal.cuenta}</td>
			<td>${chipUsuario(terminal.usuario, colorDe(terminal.usuario))}</td>
			<td>${insigniaTerminal(terminal)}</td>
			<td>${formularioAgentes(terminal)}</td>
			<td class="pequeno">${terminal.conectadoEn === null ? "nunca" : fechaLegible(terminal.conectadoEn)}</td>
			<td class="numero pequeno">${terminal.ultimaRevision === null ? SIN_DATO : terminal.ultimaRevision}</td>
			<td class="celda-uso">${usoLegible(terminal.usoJson)}</td>
			<td>${chipDeAlta(altaPor(db, "terminal", terminal.id), colorDe)}</td>
			<td>${revocado ? chipDeAlta(revocadoPor(db, terminal.id), colorDe) : html``}</td>
			<td>
				<span class="acciones-terminal">
					${
						revocado
							? html``
							: html`<a class="accion-fila neutra" href="/terminales/${terminal.id}/rotar">Rotar token</a>
								<a class="accion-fila" href="/terminales/${terminal.id}/revocar">Revocar</a>`
					}
					<a class="accion-fila" href="/terminales/${terminal.id}/borrar">Borrar</a>
				</span>
			</td>
		</tr>`;
}

/**
 * El formulario de alta, en su tarjeta, al que apunta la acción de la cabecera.
 * Lleva la explicación de qué se está dando de alta: quien crea un terminal por
 * primera vez no tiene por qué saber qué es, y los dos campos no se adivinan.
 */
function tarjetaNuevoTerminal(proyectos: readonly Proyecto[]): Html {
	return html`<section class="caja" id="nuevo-terminal">
			<h2>Nuevo terminal</h2>
			<p>
				Un terminal es cada máquina con Claude Code que trabaja las tareas de este servidor. Al crearlo
				se enseña <strong>una sola vez</strong> su token, con los pasos para conectarlo; después, las
				tareas se le asignan por su nombre.
			</p>
			<form method="post" action="/terminales">
				<label>
					<span>Nombre</span>
					<input type="text" name="nombre" placeholder="portatil-ana" required>
					<span class="ayuda">Con el que lo eliges en cada fase de una tarea y firma en el hilo: opus@portatil-ana.</span>
				</label>
				<label>
					<span>Proyecto</span>
					<select name="proyecto">
						${proyectos.map(
							(proyecto) =>
								html`<option value="${proyecto.id}"${proyecto.id === PROYECTO_PRINCIPAL ? raw(" selected") : ""}>${proyecto.clave} — ${proyecto.nombre}</option>`,
						)}
					</select>
					<span class="ayuda">El repositorio en el que trabaja esa carpeta. No se cambia después: una máquina con dos repositorios tiene dos terminales.</span>
				</label>
				<label>
					<span>Cuenta de origen</span>
					<input type="text" name="cuenta" placeholder="ana@ejemplo.com" required>
					<span class="ayuda">La cuenta de Claude Code de esa máquina. La escribes tú: el servidor no puede leerla, y es de la que sale el uso disponible.</span>
				</label>
				<label>
					<span>Agentes en paralelo</span>
					<input type="number" name="agentes" min="1" value="1" required>
					<span class="ayuda">Cuántos subagentes lanza a la vez el bucle de ese terminal. Se cambia después desde su fila.</span>
				</label>
				<button type="submit" class="principal">Crear terminal</button>
			</form>
			<p class="pequeno silencio">
				Los pasos completos están en <a href="/terminales/conectar">Cómo conectar un terminal</a>.
			</p>
		</section>`;
}

function paginaTerminales(c: Context, deps: DependenciasWeb, aviso: string | null): RespuestaHtml {
	const terminales = listarTerminales(deps.db);
	const colorDe = buscadorDeColor(deps.db);
	const tabla =
		terminales.length === 0
			? html`<p class="silencio">Ninguno todavía.</p>`
			: html`<div class="tabla-envuelta">
					<table class="tabla-terminales">
						<thead>
							<tr>
								<th>Nombre</th><th>Proyecto</th><th>Cuenta</th><th>Dueño</th><th>Estado</th><th>Agentes</th>
								<th>Conectado</th><th class="numero">Última revisión</th><th>Uso disponible</th>
								<th>Creado por</th><th>Revocado por</th><th></th>
							</tr>
						</thead>
						<tbody>${terminales.map((terminal) => filaTerminal(deps.db, terminal, colorDe))}</tbody>
					</table>
				</div>`;

	return c.html(
		// Solo esta página se refresca sola: la del token recién creado no, que
		// se perdería de vista lo único que no se vuelve a enseñar.
		pagina({
			...navProyectos(c, deps.db),
			titulo: "Terminales",
			proposito: "Las máquinas donde corren los agentes, con su cuenta y su uso disponible.",
			usuario: usuarioActual(c),
			vista: "terminales",
			aviso,
			acciones: html`<a class="boton" href="/terminales/conectar">Cómo conectar un terminal</a>
				<a class="boton principal" href="#nuevo-terminal">Nuevo terminal</a>`,
			cuerpo: html`${tabla}${tarjetaNuevoTerminal(listarProyectos(deps.db))}`,
		}),
		aviso === null ? 200 : ESTADO_AVISO,
	);
}

/**
 * Por dónde ha entrado el navegador: la cabecera `Host` con el esquema de
 * `BASE_URL`. Es la dirección que seguro funciona desde donde se está mirando,
 * y por eso el tutorial la enseña cuando no es ninguna de las conocidas.
 */
function direccionDelNavegador(c: Context, config: Config): string | null {
	const host = c.req.header("host");
	if (host === undefined || host === "") {
		return null;
	}
	return `${new URL(config.BASE_URL).protocol}//${host}`;
}

/** Lo que el tutorial necesita saber de este servidor, con el token que toque. */
function opcionesTutorial(c: Context, config: Config, token: string): OpcionesTutorial {
	return {
		direcciones: direccionesDelServidor(config),
		direccionActual: direccionDelNavegador(c, config),
		token,
	};
}

/** El tutorial de conexión con las direcciones de este servidor y el token que toque. */
function tutorialDe(c: Context, config: Config, token: string): Html {
	return tutorialConexion(opcionesTutorial(c, config, token));
}

/** Las migas de todo lo que cuelga de la lista de terminales. */
function migasDe(donde: string): Miga[] {
	return [{ texto: "Terminales", href: "/terminales" }, { texto: donde }];
}

/**
 * La página que solo se ve una vez: el token en claro, el enlace que lo lleva
 * puesto y el tutorial entero. Es la misma en el alta y al rotar, porque lo
 * que hay que hacer con el token nuevo es exactamente lo mismo.
 *
 * Sin `vista`: no se refresca sola, porque una recarga se llevaría por delante
 * lo único que no se vuelve a enseñar.
 */
function paginaToken(
	c: Context,
	deps: DependenciasWeb,
	datos: { terminal: { nombre: string; cuenta: string }; token: string },
	titulo: string,
): RespuestaHtml {
	const enlace = enlaceDeConexion(opcionesTutorial(c, deps.config, datos.token));
	const cuerpo = html`<section class="caja">
			<p>
				Terminal <strong>${datos.terminal.nombre}</strong> para la cuenta
				<strong>${datos.terminal.cuenta}</strong>.
			</p>
			<p>Este es su token. <strong>No se vuelve a ver:</strong> la base de datos solo guarda su hash.</p>
			${bloqueCodigo(datos.token, "token")}
			<p class="pequeno silencio">Cópialo en la configuración del plugin, nunca en el repositorio.</p>
			<p>O abre este enlace en la máquina del terminal: lleva a este mismo tutorial con el token puesto.</p>
			${bloqueCodigo(enlace, "token")}
			<p class="pequeno silencio">
				El enlace es un secreto: quien lo tenga, tiene el terminal. Deja de valer en cuanto revoques o
				rotes el token, y no se puede volver a componer desde aquí.
			</p>
			<p><a class="boton" href="/terminales">Volver a terminales</a></p>
		</section>
		${tutorialDe(c, deps.config, datos.token)}`;
	return c.html(
		pagina({
			...navProyectos(c, deps.db),
			titulo,
			usuario: usuarioActual(c),
			migas: migasDe(titulo),
			cuerpo,
		}),
	);
}

/**
 * El tutorial de conexión. Con `?token=` lleva el token puesto y se abre en la
 * máquina del terminal; sin él enseña `<token>` como marcador.
 *
 * `usuario` es nulo cuando se ha entrado con el enlace y sin sesión: entonces
 * la página va sin barra lateral, como el login.
 */
function paginaConectar(
	c: Context,
	deps: DependenciasWeb,
	usuario: Usuario | null,
	token: string | null,
): RespuestaHtml {
	const entrada =
		token === null
			? html`<p>
					Crea el terminal en <a href="/terminales">Terminales</a> y usa el token que te enseñe la
					web una sola vez. Aquí va como <code>&lt;token&gt;</code>.
				</p>`
			: html`<p>
					Este enlace trae el token del terminal ya puesto: sigue los pasos en esta máquina. No lo
					compartas, que quien lo tenga tiene el terminal.
				</p>`;
	return c.html(
		pagina({
			...navProyectos(c, deps.db),
			titulo: "Cómo conectar un terminal",
			usuario,
			// Vista propia y no «terminales»: esta página no se refresca por
			// intervalo, que perdería el sitio en un texto largo.
			vista: "conectar",
			// Sin sesión no hay lista de terminales a la que volver: queda el título.
			migas: usuario === null ? [] : migasDe("Cómo conectar"),
			cuerpo: html`${entrada}${tutorialDe(c, deps.config, token ?? "<token>")}`,
		}),
	);
}

/**
 * El enlace de conexión, que se abre en la máquina del terminal y no en la del
 * humano: con un token de un terminal vivo la página se sirve sin sesión.
 *
 * Se registra antes que el guardián de sesión, y por eso vive fuera de
 * `registrarRutasTerminales`. Si el token no vale, sigue el camino normal y
 * acaba en `/login` como el resto de la web. El enlace caduca solo: deja de
 * valer en cuanto el token se revoca o se rota.
 */
export function registrarEnlaceDeConexion(app: Hono, deps: DependenciasWeb): void {
	app.get("/terminales/conectar", async (c, next) => {
		const token = c.req.query("token");
		if (token === undefined || token === "" || buscarTerminalPorToken(deps.db, token) === undefined) {
			await next();
			return;
		}
		// Con sesión abierta se enseña la barra lateral; sin ella, la página sola.
		return await paginaConectar(c, deps, (await leerSesion(c, deps)) ?? null, token);
	});
}

/** El terminal de la ruta, o `undefined` si el id no es de ninguno. */
function terminalDe(deps: DependenciasWeb, c: Context): TerminalListado | undefined {
	const id = Number.parseInt(c.req.param("id") ?? "", 10);
	return listarTerminales(deps.db).find((candidato) => candidato.id === id);
}

/** La página de un id que no es de ningún terminal. */
function paginaSinTerminal(c: Context, deps: DependenciasWeb): RespuestaHtml {
	return c.html(
		pagina({
			...navProyectos(c, deps.db),
			titulo: "Terminal no encontrado",
			usuario: usuarioActual(c),
			vista: "terminales",
			migas: migasDe("No encontrado"),
			cuerpo: html`<section class="caja caja-estrecha">
				<p>No existe ese terminal.</p>
				<p><a class="boton" href="/terminales">Volver a terminales</a></p>
			</section>`,
		}),
		404,
	);
}

/** Confirmación en página aparte: sin JavaScript, el POST está aquí. */
function paginaConfirmacion(
	c: Context,
	deps: DependenciasWeb,
	titulo: string,
	explicacion: Html,
	accion: string,
	boton: { texto: string; clase: string },
): RespuestaHtml {
	return c.html(
		pagina({
			...navProyectos(c, deps.db),
			titulo,
			usuario: usuarioActual(c),
			vista: "terminales",
			migas: migasDe(titulo),
			cuerpo: html`<section class="caja caja-estrecha">
				${explicacion}
				<div class="acciones">
					<form method="post" action="${accion}">
						<button type="submit" class="${boton.clase}">${boton.texto}</button>
					</form>
					<a class="boton" href="/terminales">Cancelar</a>
				</div>
			</section>`,
		}),
	);
}

/** Rutas de terminales: lista con el uso, alta que enseña el token, rotación, revocación y borrado. */
export function registrarRutasTerminales(app: Hono, deps: DependenciasWeb): void {
	app.get("/terminales", (c) => paginaTerminales(c, deps, null));

	app.post("/terminales", async (c) => {
		const formulario = await leerFormulario(c);
		try {
			const proyectoId = Number.parseInt(campo(formulario, "proyecto"), 10);
			const creado = altaTerminal(deps.db, {
				usuarioId: usuarioActual(c).id,
				nombre: campo(formulario, "nombre"),
				cuenta: campo(formulario, "cuenta"),
				agentes: campo(formulario, "agentes"),
				// Sin proyecto elegido, el principal: es lo que hace la capa de datos.
				...(Number.isSafeInteger(proyectoId) ? { proyectoId } : {}),
			});
			return paginaToken(c, deps, creado, "Terminal creado");
		} catch (error) {
			return paginaTerminales(c, deps, mensajeDeRegla(error));
		}
	});

	// El mismo tutorial sin token, siempre disponible. Con `?token=` válido lo
	// sirve `registrarEnlaceDeConexion`, que va delante de la sesión. Va antes
	// que `/terminales/:id/...` por claridad; no chocan, porque esas llevan un
	// segmento más.
	app.get("/terminales/conectar", (c) => paginaConectar(c, deps, usuarioActual(c), null));

	// El único cambio que se hace desde la propia fila: no destruye nada y no
	// merece una página de confirmación.
	app.post("/terminales/:id/agentes", async (c) => {
		const id = Number.parseInt(c.req.param("id") ?? "", 10);
		const formulario = await leerFormulario(c);
		try {
			cambiarAgentes(deps.db, { terminalId: id, agentes: campo(formulario, "agentes"), actorId: usuarioActual(c).id });
			return c.redirect("/terminales", 302);
		} catch (error) {
			return paginaTerminales(c, deps, mensajeDeRegla(error));
		}
	});

	// Sin JavaScript: el enlace de la tabla lleva a esta página y aquí está el POST.
	app.get("/terminales/:id/rotar", (c) => {
		const terminal = terminalDe(deps, c);
		if (terminal === undefined) {
			return paginaSinTerminal(c, deps);
		}
		return paginaConfirmacion(
			c,
			deps,
			"Rotar el token",
			html`<p>
				Rotar el token da uno nuevo a <strong>${terminal.nombre}</strong> y deja el anterior sin valor.
				El terminal sigue vivo con su nombre, su historial y su consumo: solo hay que poner el token
				nuevo en esa máquina.
			</p>`,
			`/terminales/${terminal.id}/rotar`,
			{ texto: "Sí, rotar el token", clase: "principal" },
		);
	});

	app.post("/terminales/:id/rotar", (c) => {
		const id = Number.parseInt(c.req.param("id") ?? "", 10);
		try {
			return paginaToken(c, deps, rotarTerminal(deps.db, id, usuarioActual(c).id), "Token rotado");
		} catch (error) {
			return paginaTerminales(c, deps, mensajeDeRegla(error));
		}
	});

	app.get("/terminales/:id/revocar", (c) => {
		const terminal = terminalDe(deps, c);
		if (terminal === undefined) {
			return paginaSinTerminal(c, deps);
		}
		return paginaConfirmacion(
			c,
			deps,
			"Revocar terminal",
			html`<p>
				Revocar el token desconecta <strong>${terminal.nombre}</strong> y solo ese. No se puede
				deshacer: habrá que crear un terminal nuevo y volver a configurar el plugin. Si solo se ha
				perdido el token, rótalo en vez de revocarlo.
			</p>`,
			`/terminales/${terminal.id}/revocar`,
			{ texto: "Sí, revocar", clase: "peligro" },
		);
	});

	app.post("/terminales/:id/revocar", (c) => {
		const id = Number.parseInt(c.req.param("id") ?? "", 10);
		try {
			revocarTerminal(deps.db, id, usuarioActual(c).id);
			return c.redirect("/terminales", 302);
		} catch (error) {
			return paginaTerminales(c, deps, mensajeDeRegla(error));
		}
	});

	app.get("/terminales/:id/borrar", (c) => {
		const terminal = terminalDe(deps, c);
		if (terminal === undefined) {
			return paginaSinTerminal(c, deps);
		}
		return paginaConfirmacion(
			c,
			deps,
			"Borrar terminal",
			html`<p>
				Borrar quita <strong>${terminal.nombre}</strong> de la lista del todo, no solo lo desconecta.
				Las tareas que tuviera asignadas se quedan sin terminal y cualquier otro podrá tomarlas; el
				consumo ya registrado se conserva, porque son tokens gastados de verdad. No se puede deshacer.
			</p>`,
			`/terminales/${terminal.id}/borrar`,
			{ texto: "Sí, borrar", clase: "peligro" },
		);
	});

	app.post("/terminales/:id/borrar", (c) => {
		const id = Number.parseInt(c.req.param("id") ?? "", 10);
		try {
			borrarTerminal(deps.db, id, usuarioActual(c).id);
			return c.redirect("/terminales", 302);
		} catch (error) {
			return paginaTerminales(c, deps, mensajeDeRegla(error));
		}
	});
}
