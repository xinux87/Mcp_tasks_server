import type { Context, Hono } from "hono";
import { html } from "hono/html";
import { altaTerminal, listarTerminales, revocarTerminal, type TerminalListado } from "../../db/admin.ts";
import { fechaLegible, SIN_DATO } from "../formatos.ts";
import { campo, ESTADO_AVISO, leerFormulario, mensajeDeRegla } from "../formulario.ts";
import { type Html, pagina, type RespuestaHtml } from "../plantilla.ts";
import { type DependenciasWeb, usuarioActual } from "../sesion.ts";

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

/** Una ventana de `rate_limits`: lo que queda y cuándo se reinicia. */
function lineaVentana(limites: Record<string, unknown>, clave: string, etiqueta: string): Html | null {
	const ventana = limites[clave];
	if (!esObjeto(ventana)) {
		return null;
	}
	const usado = numeroDe(ventana, "used_percentage");
	if (usado === null) {
		return null;
	}
	const restante = Math.round(Math.min(100, Math.max(0, 100 - usado)));
	// `resets_at` viene en segundos desde la época; se enseña en hora local.
	const reinicia = numeroDe(ventana, "resets_at");
	const cuando = reinicia === null ? SIN_DATO : fechaLegible(new Date(reinicia * 1000));
	return html`<li><strong>${etiqueta}</strong>: ${restante} % disponible · reinicia ${cuando}</li>`;
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
			return html`<span>coste de sesión: $${total.toFixed(2)}</span>`;
		}
	}
	return SIN_DATOS;
}

function filaTerminal(terminal: TerminalListado): Html {
	const revocado = terminal.revocadoEn !== null;
	return html`<tr>
			<td>${terminal.nombre}</td>
			<td class="pequeno">${terminal.cuenta}</td>
			<td class="pequeno">${terminal.usuario}</td>
			<td class="pequeno">
				${
					revocado
						? html`<span class="insignia">revocado ${fechaLegible(terminal.revocadoEn)}</span>`
						: html`<span class="insignia estado-done">activo</span>`
				}
			</td>
			<td class="pequeno">${terminal.conectadoEn === null ? "nunca" : fechaLegible(terminal.conectadoEn)}</td>
			<td class="numero pequeno">${terminal.ultimaRevision === null ? SIN_DATO : terminal.ultimaRevision}</td>
			<td>${usoLegible(terminal.usoJson)}</td>
			<td>
				${
					revocado
						? html`<span class="silencio">—</span>`
						: html`<a class="boton peligro" href="/terminales/${terminal.id}/revocar">Revocar</a>`
				}
			</td>
		</tr>`;
}

function paginaTerminales(c: Context, deps: DependenciasWeb, aviso: string | null): RespuestaHtml {
	const terminales = listarTerminales(deps.db);
	const tabla =
		terminales.length === 0
			? html`<p class="silencio">Ninguno todavía.</p>`
			: html`<div class="tabla-envuelta">
					<table>
						<thead>
							<tr>
								<th>Nombre</th><th>Cuenta</th><th>Usuario</th><th>Estado</th>
								<th>Conectado</th><th class="numero">Última revisión</th><th>Uso disponible</th><th></th>
							</tr>
						</thead>
						<tbody>${terminales.map((terminal) => filaTerminal(terminal))}</tbody>
					</table>
				</div>`;

	const cuerpo = html`<h1>Terminales</h1>
		${tabla}
		<form class="caja" method="post" action="/terminales">
			<h2>Nuevo terminal</h2>
			<label>
				<span>Nombre</span>
				<input type="text" name="nombre" placeholder="portatil-xinux" required>
			</label>
			<label>
				<span>Cuenta de origen</span>
				<input type="text" name="cuenta" placeholder="xinux@ejemplo.com" required>
			</label>
			<button type="submit" class="principal">Crear terminal</button>
		</form>`;

	return c.html(
		pagina({ titulo: "Terminales", usuario: usuarioActual(c), aviso, cuerpo }),
		aviso === null ? 200 : ESTADO_AVISO,
	);
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
			const cuerpo = html`<h1>Terminal creado</h1>
				<p>
					Terminal <strong>${creado.terminal.nombre}</strong> para la cuenta
					<strong>${creado.terminal.cuenta}</strong>.
				</p>
				<p>Este es su token. <strong>No se vuelve a ver:</strong> la base de datos solo guarda su hash.</p>
				<code class="token">${creado.token}</code>
				<p class="pequeno silencio">Cópialo en la configuración del plugin, nunca en el repositorio.</p>
				<p><a class="boton" href="/terminales">Volver a terminales</a></p>`;
			return c.html(pagina({ titulo: "Terminal creado", usuario: usuarioActual(c), cuerpo }));
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
					aviso: "No existe ese terminal.",
					cuerpo: html`<p><a href="/terminales">Volver a terminales</a></p>`,
				}),
				404,
			);
		}
		const cuerpo = html`<h1>Revocar terminal</h1>
			<p>
				Revocar el token desconecta <strong>${terminal.nombre}</strong> y solo ese. No se puede deshacer:
				habrá que crear un terminal nuevo y volver a configurar el plugin.
			</p>
			<div class="acciones">
				<form method="post" action="/terminales/${terminal.id}/revocar">
					<button type="submit" class="peligro">Sí, revocar</button>
				</form>
				<a class="boton" href="/terminales">Cancelar</a>
			</div>`;
		return c.html(pagina({ titulo: "Revocar terminal", usuario: usuarioActual(c), cuerpo }));
	});

	app.post("/terminales/:id/revocar", (c) => {
		const id = Number.parseInt(c.req.param("id") ?? "", 10);
		try {
			revocarTerminal(deps.db, id);
			return c.redirect("/terminales", 302);
		} catch (error) {
			return paginaTerminales(c, deps, mensajeDeRegla(error));
		}
	});
}
