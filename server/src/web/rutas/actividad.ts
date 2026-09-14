import type { Hono } from "hono";
import { html } from "hono/html";
import { type Actividad, actividadReciente } from "../../db/actividad.ts";
import { formatearId } from "../../md/ids.ts";
import { buscadorDeColor, type Color, cabeceraPagina, chipUsuario, fraseDeAccion } from "../componentes.ts";
import { fechaLegible } from "../formatos.ts";
import { type Html, pagina } from "../plantilla.ts";
import { type DependenciasWeb, usuarioActual } from "../sesion.ts";
import { navProyectos } from "./proyectos.ts";

/** Cuántas acciones se enseñan. Es una lista para mirar, no un archivo. */
const CUANTAS = 100;

/** Cómo se busca el color de cada usuario que aparece en la página. */
type ColorDe = (nombre: string) => Color | null;

/** Un día de la lista, con sus acciones de la más nueva a la más antigua. */
type Dia = {
	dia: string;
	filas: Actividad[];
};

/**
 * Día y hora locales de una marca de tiempo. Se parten del único helper de
 * fechas de la web para que la agrupación y la hora usen el mismo huso: si el
 * día saliera de la cadena ISO en UTC, lo de última hora caería en otro día.
 */
function diaYHora(creado: string): { dia: string; hora: string } {
	const legible = fechaLegible(creado);
	const espacio = legible.indexOf(" ");
	if (espacio < 0) {
		return { dia: legible, hora: "" };
	}
	return { dia: legible.slice(0, espacio), hora: legible.slice(espacio + 1) };
}

/**
 * Agrupa por día conservando el orden en que llegan, que ya es de lo más nuevo
 * a lo más antiguo. Basta comparar con el último grupo abierto porque la lista
 * viene ordenada.
 */
function porDia(filas: readonly Actividad[]): Dia[] {
	const dias: Dia[] = [];
	for (const fila of filas) {
		const { dia } = diaYHora(fila.creado);
		const ultimo = dias.at(-1);
		if (ultimo !== undefined && ultimo.dia === dia) {
			ultimo.filas.push(fila);
		} else {
			dias.push({ dia, filas: [fila] });
		}
	}
	return dias;
}

/**
 * El objeto de la acción. Las tareas se enlazan a su ficha; los usuarios y los
 * terminales se enseñan por el nombre que tenían cuando pasó, que es lo que
 * queda cuando el objeto ya no existe.
 */
function objetoLegible(fila: Actividad): Html {
	if (fila.objeto === "tarea") {
		const id = formatearId(fila.objetoId);
		return html`<a class="id-tarea" href="/tareas/${id}">${id}</a> <span class="objeto">${fila.objetoNombre}</span>`;
	}
	return html`<strong class="objeto">${fila.objetoNombre}</strong>`;
}

/** Una acción: quién, qué hizo, sobre qué, con qué detalle y a qué hora. */
function lineaActividad(fila: Actividad, colorDe: ColorDe): Html {
	const { hora } = diaYHora(fila.creado);
	return html`<li class="acto">
			${chipUsuario(fila.usuarioNombre, colorDe(fila.usuarioNombre))}
			<span class="frase">${fraseDeAccion(fila.accion)}</span>
			${objetoLegible(fila)}
			${fila.detalle === "" ? html`` : html`<span class="detalle silencio">${fila.detalle}</span>`}
			<time class="hora silencio" datetime="${fila.creado}">${hora}</time>
		</li>`;
}

function seccionDia(dia: Dia, colorDe: ColorDe): Html {
	return html`<section class="dia">
			<h2>${dia.dia}</h2>
			<ol class="actividad">${dia.filas.map((fila) => lineaActividad(fila, colorDe))}</ol>
		</section>`;
}

/** `GET /actividad`: las últimas cien acciones humanas, con quién hizo cada una. */
export function registrarRutasActividad(app: Hono, deps: DependenciasWeb): void {
	app.get("/actividad", (c) => {
		const filas = actividadReciente(deps.db, CUANTAS);
		const colorDe = buscadorDeColor(deps.db);
		const dias = porDia(filas);
		const lista =
			dias.length === 0
				? html`<p class="silencio">Todavía no hay nada.</p>`
				: html`${dias.map((dia) => seccionDia(dia, colorDe))}`;

		// La cabecera se pinta aquí y no desde `pagina` porque esta página no
		// tiene migas ni acciones, pero sí una explicación pegada al título.
		const cuerpo = html`${cabeceraPagina({ titulo: "Actividad" })}
			<p class="explicacion silencio">
				Las últimas ${CUANTAS} acciones del equipo. Lo que hacen los agentes está en el hilo de cada tarea.
			</p>
			${lista}`;

		return c.html(
			pagina({ ...navProyectos(c, deps.db), titulo: "Actividad", usuario: usuarioActual(c), vista: "actividad", cuerpo }),
		);
	});
}
