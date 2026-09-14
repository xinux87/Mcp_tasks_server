import type { DatabaseSync } from "node:sqlite";
import type { Context, Hono } from "hono";
import { html } from "hono/html";
import { revisionActual } from "../../db/consultas.ts";
import { consumoDeTarea } from "../../db/consumo.ts";
import { buscarProyectoPorClave, listarProyectos } from "../../db/proyectos.ts";
import { buscarTarea, type ItemIndice, listarTareas, type Tarea } from "../../db/tareas.ts";
import { formatearId } from "../../md/ids.ts";
import {
	barraProgreso,
	buscadorDeCreador,
	chipProyecto,
	etiqueta,
	filtroSelect,
	type QuienCreo,
} from "../componentes.ts";
import { fechaLegible, numeroLegible, SIN_DATO } from "../formatos.ts";
import { type Html, insigniaEstado, pagina, type RespuestaHtml } from "../plantilla.ts";
import { type DependenciasWeb, usuarioActual } from "../sesion.ts";
import { opcionesProyecto } from "./kanban.ts";
import { navProyectos, prefijo, proyectoActual } from "./proyectos.ts";

/**
 * `GET /funcionalidades`: en qué va cada evolutivo. Una fila por
 * funcionalidad, con lo que ha avanzado y lo que la frena; las cerradas se
 * pliegan al final, porque están archivadas y solo estorban.
 *
 * Aquí no hay ninguna regla: todo sale de `src/db/`. El progreso son las
 * partes `finished` sobre el total, y lo que frena son las marcas de sus
 * partes, las mismas que se ven en el tablero.
 */

/** Cómo se resuelve quién creó una funcionalidad. Una lectura por página. */
type Creador = (quien: QuienCreo) => Html | null;

/** Una funcionalidad con lo que hace falta para pintar su fila. */
type Fila = {
	item: ItemIndice;
	tarea: Tarea;
	/** Partes con alguna pregunta sin contestar: son las que piden atención. */
	bloqueadas: number;
	/** Partes que esperan a otra parte para poder empezar. */
	esperando: number;
	/** Tokens de la funcionalidad y de todas sus partes. */
	tokens: number;
};

/**
 * Las funcionalidades con sus cuentas. Las partes se agrupan de una sola
 * lectura del índice: una consulta por funcionalidad sería una por fila.
 */
function filasDe(db: DatabaseSync, proyectoId: number | undefined): Fila[] {
	// Las partes se agrupan sobre el índice entero aunque la vista esté acotada:
	// una parte y su funcionalidad viven siempre en el mismo proyecto.
	const items = listarTareas(db);
	const porPadre = new Map<number, ItemIndice[]>();
	for (const item of items) {
		if (item.padreId === null) {
			continue;
		}
		const suyas = porPadre.get(item.padreId);
		if (suyas === undefined) {
			porPadre.set(item.padreId, [item]);
		} else {
			suyas.push(item);
		}
	}

	const filas: Fila[] = [];
	for (const item of items) {
		if (item.tipo !== "funcionalidad" || (proyectoId !== undefined && item.proyectoId !== proyectoId)) {
			continue;
		}
		const tarea = buscarTarea(db, item.id);
		if (tarea === undefined) {
			continue;
		}
		const partes = porPadre.get(item.id) ?? [];
		filas.push({
			item,
			tarea,
			bloqueadas: partes.filter((parte) => parte.marcas.includes("bloqueada")).length,
			esperando: partes.filter((parte) => parte.marcas.includes("esperando")).length,
			tokens: consumoDeTarea(db, item.id).totalConHijas,
		});
	}
	return filas;
}

/** Lo que frena a la funcionalidad, con cuántas partes son. Vacío si no la frena nada. */
function frenos(fila: Fila): Html {
	if (fila.bloqueadas === 0 && fila.esperando === 0) {
		return html`<span class="silencio">${SIN_DATO}</span>`;
	}
	return html`${fila.bloqueadas === 0 ? html`` : etiqueta(`${fila.bloqueadas} bloqueada${fila.bloqueadas === 1 ? "" : "s"}`, "rojo", "marca-bloqueada")}
		${fila.esperando === 0 ? html`` : etiqueta(`${fila.esperando} esperando`, "naranja", "marca-esperando")}`;
}

function filaFuncionalidad(fila: Fila, creadorDe: Creador, claves: Claves): Html {
	const id = formatearId(fila.item.id);
	const creador = creadorDe({
		usuarioId: fila.tarea.creadaPorUsuarioId,
		terminalId: fila.tarea.creadaPorTerminalId,
	});
	const clave = claves?.get(fila.item.proyectoId);
	return html`<tr>
			<td>
				<a class="id-tarea" href="/tareas/${id}">${id}</a>
				${clave === undefined ? html`` : chipProyecto(clave)}
				<a href="/tareas/${id}">${fila.item.titulo}</a>
			</td>
			<td>${insigniaEstado(fila.item.estado)}</td>
			<td>${barraProgreso(fila.item.partesCerradas ?? 0, fila.item.partes ?? 0)}</td>
			<td>${frenos(fila)}</td>
			<td class="numero pequeno">${numeroLegible(fila.tokens)}</td>
			<td class="pequeno">${fila.tarea.rama === null ? html`<span class="silencio">${SIN_DATO}</span>` : html`<code>${fila.tarea.rama}</code>`}</td>
			<td>${creador ?? SIN_DATO}</td>
			<td class="pequeno">${fechaLegible(fila.tarea.actualizada)}</td>
		</tr>`;
}

/** La clave de cada proyecto, solo en la vista cruzada: acotada sobraría. */
type Claves = Map<number, string> | null;

function tabla(filas: Fila[], creadorDe: Creador, claves: Claves): Html {
	if (filas.length === 0) {
		return html`<p class="silencio">Ninguna.</p>`;
	}
	return html`<div class="tabla-envuelta">
			<table class="tabla-funcionalidades">
				<thead>
					<tr>
						<th>Funcionalidad</th><th>Estado</th><th>Progreso</th><th>Frena</th>
						<th class="numero">Tokens</th><th>Rama</th><th>Creada por</th><th>Actualizada</th>
					</tr>
				</thead>
				<tbody>${filas.map((fila) => filaFuncionalidad(fila, creadorDe, claves))}</tbody>
			</table>
		</div>`;
}

/** Las funcionalidades: en marcha arriba y las cerradas plegadas al final. */
export function registrarRutasFuncionalidades(app: Hono, deps: DependenciasWeb): void {
	const paginaFuncionalidades = (c: Context): RespuestaHtml => {
		const acotado = proyectoActual(c);
		// En la vista cruzada el proyecto se elige con el desplegable; acotada ya
		// está en la URL y el filtro sobraría.
		const elegida = acotado?.clave ?? c.req.query("proyecto") ?? "";
		const proyectoId = elegida === "" ? undefined : (buscarProyectoPorClave(deps.db, elegida)?.id ?? 0);
		const filas = filasDe(deps.db, proyectoId);
		const abiertas = filas.filter((fila) => fila.item.estado !== "finished");
		const cerradas = filas.filter((fila) => fila.item.estado === "finished");
		const creadorDe = buscadorDeCreador(deps.db);
		const claves = acotado === undefined ? new Map(listarProyectos(deps.db).map((cual) => [cual.id, cual.clave])) : null;
		const base = prefijo(acotado);

		const filtros =
			acotado !== undefined
				? html``
				: html`<form class="filtros" method="get" action="/funcionalidades">
					${filtroSelect(opcionesProyecto(deps.db, elegida))}
					<button type="submit" class="pequeno">Filtrar</button>
					${elegida === "" ? html`` : html`<a class="quitar" href="/funcionalidades">Quitar filtros</a>`}
				</form>`;

		const cuerpo = html`${filtros}
			${tabla(abiertas, creadorDe, claves)}
			${
				cerradas.length === 0
					? html``
					: html`<section class="grupo">
						<details>
							<summary>Cerradas <span class="contador">${cerradas.length}</span></summary>
							${tabla(cerradas, creadorDe, claves)}
						</details>
					</section>`
			}`;

		// Se refresca como la lista: cuando sube la revisión se vuelve a pedir
		// entera, porque no tiene ningún formulario que se pueda perder.
		return c.html(
			pagina({
				...navProyectos(c, deps.db),
				titulo: acotado === undefined ? "Funcionalidades" : `Funcionalidades · ${acotado.clave}`,
				usuario: usuarioActual(c),
				vista: "funcionalidades",
				revision: revisionActual(deps.db),
				acciones: html`<a class="boton principal" href="${base}/tareas/nueva?tipo=funcionalidad">Nueva funcionalidad</a>`,
				cuerpo,
			}),
		);
	};

	app.get("/funcionalidades", paginaFuncionalidades);
	app.get("/p/:clave/funcionalidades", paginaFuncionalidades);
}
