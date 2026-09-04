import type { DatabaseSync } from "node:sqlite";
import type { Context, Hono } from "hono";
import { html } from "hono/html";
import { actividadDe, altaPor } from "../../db/actividad.ts";
import { altaTerminal, listarTerminales, revocarTerminal, type TerminalListado } from "../../db/admin.ts";
import { buscadorDeColor, type Color, chipUsuario, etiqueta, type Miga } from "../componentes.ts";
import { fechaLegible, SIN_DATO } from "../formatos.ts";
import { campo, ESTADO_AVISO, leerFormulario, mensajeDeRegla } from "../formulario.ts";
import { type Html, pagina, type RespuestaHtml } from "../plantilla.ts";
import { type DependenciasWeb, usuarioActual } from "../sesion.ts";

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

/**
 * Nombres del rastro que no son personas: los deja el CLI y el primer arranque,
 * que no tienen sesión. No llevan chip porque no hay a quién enseñar.
 */
const NO_SON_PERSONAS: readonly string[] = ["cli", "arranque"];

function esObjeto(valor: unknown): valor is Record<string, unknown> {
	return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function numeroDe(objeto: Record<string, unknown>, clave: string): number | null {
	const valor = objeto[clave];
	return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

const SIN_DATOS = html`<span class="silencio">sin datos</span>`;

/**
 * Quién hizo algo, tal como lo guardó el rastro: una persona va como chip con
 * su color, y en gris si ya no existe; `cli` y `arranque` no son personas y van
 * en texto suave; sin dato, una raya.
 */
function quien(nombre: string | null, colorDe: ColorDe): Html {
	if (nombre === null) {
		return html`<span class="silencio">${SIN_DATO}</span>`;
	}
	if (NO_SON_PERSONAS.includes(nombre)) {
		return html`<span class="silencio">${nombre}</span>`;
	}
	return chipUsuario(nombre, colorDe(nombre));
}

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
		return etiqueta("activo", "verde");
	}
	return html`${etiqueta("revocado", "gris")}<span class="pequeno silencio">${fechaLegible(terminal.revocadoEn)}</span>`;
}

function filaTerminal(db: DatabaseSync, terminal: TerminalListado, colorDe: ColorDe): Html {
	const revocado = terminal.revocadoEn !== null;
	return html`<tr>
			<td>${terminal.nombre}</td>
			<td class="pequeno celda-cuenta">${terminal.cuenta}</td>
			<td>${chipUsuario(terminal.usuario, colorDe(terminal.usuario))}</td>
			<td>${insigniaTerminal(terminal)}</td>
			<td class="pequeno">${terminal.conectadoEn === null ? "nunca" : fechaLegible(terminal.conectadoEn)}</td>
			<td class="numero pequeno">${terminal.ultimaRevision === null ? SIN_DATO : terminal.ultimaRevision}</td>
			<td class="celda-uso">${usoLegible(terminal.usoJson)}</td>
			<td>${quien(altaPor(db, "terminal", terminal.id), colorDe)}</td>
			<td>${revocado ? quien(revocadoPor(db, terminal.id), colorDe) : html``}</td>
			<td>
				${
					revocado
						? html`<span class="silencio">${SIN_DATO}</span>`
						: html`<a class="accion-fila" href="/terminales/${terminal.id}/revocar">Revocar</a>`
				}
			</td>
		</tr>`;
}

/** El formulario de alta, en su tarjeta, al que apunta la acción de la cabecera. */
function tarjetaNuevoTerminal(): Html {
	return html`<section class="caja" id="nuevo-terminal">
			<h2>Nuevo terminal</h2>
			<form method="post" action="/terminales">
				<label>
					<span>Nombre</span>
					<input type="text" name="nombre" placeholder="portatil-xinux" required>
				</label>
				<label>
					<span>Cuenta de origen</span>
					<input type="text" name="cuenta" placeholder="xinux@ejemplo.com" required>
				</label>
				<button type="submit" class="principal">Crear terminal</button>
			</form>
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
								<th>Nombre</th><th>Cuenta</th><th>Dueño</th><th>Estado</th>
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
			titulo: "Terminales",
			usuario: usuarioActual(c),
			vista: "terminales",
			aviso,
			acciones: html`<a class="boton principal" href="#nuevo-terminal">Nuevo terminal</a>`,
			cuerpo: html`${tabla}${tarjetaNuevoTerminal()}`,
		}),
		aviso === null ? 200 : ESTADO_AVISO,
	);
}

/** Las migas de todo lo que cuelga de la lista de terminales. */
function migasDe(donde: string): Miga[] {
	return [{ texto: "Terminales", href: "/terminales" }, { texto: donde }];
}

/** Rutas de terminales: lista con el uso, alta que enseña el token y revocación. */
export function registrarRutasTerminales(app: Hono, deps: DependenciasWeb): void {
	app.get("/terminales", (c) => paginaTerminales(c, deps, null));

	app.post("/terminales", async (c) => {
		const formulario = await leerFormulario(c);
		try {
			const creado = altaTerminal(deps.db, {
				usuarioId: usuarioActual(c).id,
				nombre: campo(formulario, "nombre"),
				cuenta: campo(formulario, "cuenta"),
			});
			const cuerpo = html`<section class="caja caja-estrecha">
				<p>
					Terminal <strong>${creado.terminal.nombre}</strong> para la cuenta
					<strong>${creado.terminal.cuenta}</strong>.
				</p>
				<p>Este es su token. <strong>No se vuelve a ver:</strong> la base de datos solo guarda su hash.</p>
				<code class="token">${creado.token}</code>
				<p class="pequeno silencio">Cópialo en la configuración del plugin, nunca en el repositorio.</p>
				<p><a class="boton" href="/terminales">Volver a terminales</a></p>
			</section>`;
			// Sin `vista`: esta página no se refresca sola, porque una recarga se
			// llevaría por delante lo único que no se vuelve a enseñar.
			return c.html(
				pagina({
					titulo: "Terminal creado",
					usuario: usuarioActual(c),
					migas: migasDe("Terminal creado"),
					cuerpo,
				}),
			);
		} catch (error) {
			return paginaTerminales(c, deps, mensajeDeRegla(error));
		}
	});

	// Sin JavaScript: el botón de la tabla lleva a esta página y aquí está el POST.
	app.get("/terminales/:id/revocar", (c) => {
		const id = Number.parseInt(c.req.param("id") ?? "", 10);
		const terminal = listarTerminales(deps.db).find((candidato) => candidato.id === id);
		if (terminal === undefined) {
			return c.html(
				pagina({
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
		const cuerpo = html`<section class="caja caja-estrecha">
			<p>
				Revocar el token desconecta <strong>${terminal.nombre}</strong> y solo ese. No se puede deshacer:
				habrá que crear un terminal nuevo y volver a configurar el plugin.
			</p>
			<div class="acciones">
				<form method="post" action="/terminales/${terminal.id}/revocar">
					<button type="submit" class="peligro">Sí, revocar</button>
				</form>
				<a class="boton" href="/terminales">Cancelar</a>
			</div>
		</section>`;
		return c.html(
			pagina({
				titulo: "Revocar terminal",
				usuario: usuarioActual(c),
				vista: "terminales",
				migas: migasDe("Revocar terminal"),
				cuerpo,
			}),
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
}
