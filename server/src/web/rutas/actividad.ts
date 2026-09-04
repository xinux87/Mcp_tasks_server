import type { Hono } from "hono";
import { html } from "hono/html";
import { type Actividad, actividadReciente } from "../../db/actividad.ts";
import { formatearId } from "../../md/ids.ts";
import { fechaLegible, SIN_DATO } from "../formatos.ts";
import { type Html, pagina } from "../plantilla.ts";
import { type DependenciasWeb, usuarioActual } from "../sesion.ts";

/** Cuántas acciones se enseñan. Es una lista para mirar, no un archivo. */
const CUANTAS = 100;

/**
 * El objeto de la acción. Las tareas se enlazan a su ficha; los usuarios y los
 * terminales se enseñan por el nombre que tenían cuando pasó, que es lo que
 * queda cuando el objeto ya no existe.
 */
function objetoLegible(fila: Actividad): Html {
	if (fila.objeto === "tarea") {
		const id = formatearId(fila.objetoId);
		return html`<a href="/tareas/${id}">${id}</a> ${fila.objetoNombre}`;
	}
	return html`<span class="pequeno silencio">${fila.objeto}</span> ${fila.objetoNombre}`;
}

function filaActividad(fila: Actividad): Html {
	return html`<tr>
			<td class="pequeno">${fechaLegible(fila.creado)}</td>
			<td>${fila.usuarioNombre}</td>
			<td class="pequeno">${fila.accion}</td>
			<td>${objetoLegible(fila)}</td>
			<td class="pequeno">${fila.detalle === "" ? SIN_DATO : fila.detalle}</td>
		</tr>`;
}

/** `GET /actividad`: las últimas cien acciones humanas, con quién hizo cada una. */
export function registrarRutasActividad(app: Hono, deps: DependenciasWeb): void {
	app.get("/actividad", (c) => {
		const filas = actividadReciente(deps.db, CUANTAS);
		const tabla =
			filas.length === 0
				? html`<p class="silencio">Todavía no hay nada.</p>`
				: html`<div class="tabla-envuelta">
						<table>
							<thead>
								<tr><th>Cuándo</th><th>Quién</th><th>Acción</th><th>Objeto</th><th>Detalle</th></tr>
							</thead>
							<tbody>${filas.map(filaActividad)}</tbody>
						</table>
					</div>`;

		const cuerpo = html`<h1>Actividad</h1>
			<p class="pequeno silencio">Las últimas ${CUANTAS} acciones del equipo. Lo que hacen los agentes está en el hilo de cada tarea.</p>
			${tabla}`;

		return c.html(pagina({ titulo: "Actividad", usuario: usuarioActual(c), vista: "actividad", cuerpo }));
	});
}
