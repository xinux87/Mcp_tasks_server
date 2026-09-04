import type { DatabaseSync } from "node:sqlite";
import type { Context, Hono } from "hono";
import { html } from "hono/html";
import { type TerminalListado, terminalesActivos } from "../../db/admin.ts";
import { revisionActual } from "../../db/consultas.ts";
import {
	buscarTarea,
	type Estado,
	esEstado,
	type ItemIndice,
	listarTareas,
	type Marca,
	moverTareaHumano,
	reordenar,
} from "../../db/tareas.ts";
import { ErrorDeRegla, esErrorDeRegla } from "../../errores.ts";
import { formatearId, parsearId } from "../../md/ids.ts";
import { accionNuevaTarea, filtroSelect, rotuloColumna } from "../componentes.ts";
import { faseLegible } from "../formatos.ts";
import { campo, ESTADO_AVISO, leerFormulario } from "../formulario.ts";
import {
	COLUMNAS,
	type Html,
	insigniaEstado,
	insigniasMarcas,
	insigniaTipoTarea,
	pagina,
	type RespuestaHtml,
} from "../plantilla.ts";
import { type DependenciasWeb, usuarioActual } from "../sesion.ts";

const MARCAS: readonly Marca[] = ["bloqueada", "sin terminal", "en marcha", "análisis listo"];

/** Cuántas cerradas se enseñan en su columna. El resto, en la lista filtrada. */
const CERRADAS_VISIBLES = 10;

function esMarca(valor: string): valor is Marca {
	const nombres: readonly string[] = MARCAS;
	return nombres.includes(valor);
}

/** El id de la ruta, o `null` si no tiene la forma `T-0042`. */
function idDeRuta(c: Context): number | null {
	try {
		return parsearId(c.req.param("id") ?? "");
	} catch (error) {
		if (esErrorDeRegla(error)) {
			return null;
		}
		throw error;
	}
}

// --- filtros -----------------------------------------------------------------

/** Los filtros del kanban: los mismos que la lista, sin `estado`. */
type Filtros = {
	terminal: string;
	marca: string;
};

function filtrosDe(c: Context): Filtros {
	return { terminal: c.req.query("terminal") ?? "", marca: c.req.query("marca") ?? "" };
}

/** La query string con la que el cliente vuelve a pedir el fragmento. */
function tareasFiltradas(db: DatabaseSync, filtros: Filtros): ItemIndice[] {
	const terminalId = Number.parseInt(filtros.terminal, 10);
	return listarTareas(db, Number.isSafeInteger(terminalId) ? { terminalId } : {}).filter((item) => {
		return !esMarca(filtros.marca) || item.marcas.includes(filtros.marca);
	});
}

// --- trozos de página --------------------------------------------------------

/**
 * La misma fila de filtros que la lista, sin `estado`: aquí el estado es la
 * columna. «Quitar filtros» solo sale cuando hay algo que quitar.
 */
function formularioFiltros(activos: TerminalListado[], filtros: Filtros): Html {
	const hayFiltro = filtros.terminal !== "" || filtros.marca !== "";
	return html`<form class="filtros" method="get" action="/tareas/kanban">
			${filtroSelect({
				nombre: "terminal",
				titulo: "Terminal",
				todas: "todos",
				valores: activos.map((activo) => ({ valor: String(activo.id), texto: activo.nombre })),
				seleccionado: filtros.terminal,
			})}
			${filtroSelect({
				nombre: "marca",
				titulo: "Marca",
				todas: "todas",
				valores: MARCAS.map((valor) => ({ valor, texto: valor })),
				seleccionado: filtros.marca,
			})}
			<button type="submit" class="pequeno">Filtrar</button>
			${hayFiltro ? html`<a class="quitar" href="/tareas/kanban">Quitar filtros</a>` : html``}
		</form>`;
}

/**
 * Las dos fases abreviadas: `sonnet@portatil · opus@portatil`, o «sin asignar».
 * Una pregunta solo tiene análisis, así que enseña esa sola.
 */
function fasesLegibles(item: ItemIndice): string {
	const analisis = faseLegible(item.analisisModelo, item.analisisTerminal);
	if (item.tipo === "pregunta") {
		return analisis;
	}
	const ejecucion = faseLegible(item.ejecucionModelo, item.ejecucionTerminal);
	if (analisis === "sin asignar" && ejecucion === "sin asignar") {
		return "sin asignar";
	}
	return `${analisis} · ${ejecucion}`;
}

/**
 * Una tarjeta. `data-id` y `data-estado` son lo que lee el cliente al soltar:
 * el id para la ruta y el estado para saber si cambió de columna.
 */
function tarjeta(item: ItemIndice): Html {
	const id = formatearId(item.id);
	return html`<article class="tarjeta" data-id="${id}" data-estado="${item.estado}">
			<div class="linea">
				<a class="id-tarea" href="/tareas/${id}">${id}</a>
				${insigniaTipoTarea(item.tipo)}
				${insigniasMarcas(item.marcas)}
			</div>
			<p class="titulo">${item.titulo}</p>
			<p class="pequeno silencio">${fasesLegibles(item)}</p>
		</article>`;
}

/**
 * Una columna. El contenedor de tarjetas lleva el `data-estado`: es la zona
 * donde suelta SortableJS, y de ahí sale la columna de destino.
 */
function columna(titulo: string, estado: Estado, items: ItemIndice[], total: number): Html {
	// Las cerradas están archivadas y son muchas: se enseñan las últimas y el
	// resto se ve en la lista filtrada.
	const pie =
		estado === "finished" && total > 0
			? html`<p class="pequeno"><a href="/tareas?estado=finished">ver todas (${total})</a></p>`
			: html``;
	return html`<section class="columna">
			<h2>${rotuloColumna(insigniaEstado(estado), titulo, total)}</h2>
			<div class="tarjetas" data-estado="${estado}">${items.map((item) => tarjeta(item))}</div>
			${pie}
		</section>`;
}

/**
 * Las cerradas más recientes primero: la columna solo enseña las últimas. Con
 * la misma marca de tiempo manda el identificador mayor, que es la más nueva.
 */
function ultimasCerradas(db: DatabaseSync, items: ItemIndice[]): ItemIndice[] {
	return items
		.map((item) => ({ item, actualizada: buscarTarea(db, item.id)?.actualizada ?? "" }))
		.sort((uno, otro) => {
			if (uno.actualizada !== otro.actualizada) {
				return uno.actualizada < otro.actualizada ? 1 : -1;
			}
			return otro.item.id - uno.item.id;
		})
		.slice(0, CERRADAS_VISIBLES)
		.map((entrada) => entrada.item);
}

/**
 * El fragmento del tablero, que es lo que el cliente vuelve a pedir cuando
 * sube la revisión. Lleva su propia revisión para no repintar hacia atrás.
 */
function tablero(db: DatabaseSync, filtros: Filtros): Html {
	const items = tareasFiltradas(db, filtros);
	return html`<section id="tablero" class="tablero" data-revision="${revisionActual(db)}">
			<p class="aviso aviso-tablero" id="aviso-tablero" role="alert" hidden></p>
			<div class="columnas">
				${COLUMNAS.map((cual) => {
					const propias = items.filter((item) => item.estado === cual.estado);
					const visibles = cual.estado === "finished" ? ultimasCerradas(db, propias) : propias;
					return columna(cual.titulo, cual.estado, visibles, propias.length);
				})}
			</div>
		</section>`;
}

// --- páginas -----------------------------------------------------------------

function paginaKanban(c: Context, deps: DependenciasWeb): RespuestaHtml {
	const { db } = deps;
	const filtros = filtrosDe(c);
	const cuerpo = html`${formularioFiltros(terminalesActivos(db), filtros)}
		${tablero(db, filtros)}`;
	// El tablero ocupa todo el ancho: cinco columnas no caben en 60 rem.
	return c.html(
		pagina({
			titulo: "Kanban",
			usuario: usuarioActual(c),
			vista: "kanban",
			revision: revisionActual(db),
			acciones: accionNuevaTarea(),
			ancho: "completo",
			cuerpo,
		}),
	);
}

// --- la acción de arrastrar --------------------------------------------------

/** Lo que manda el navegador al soltar una tarjeta. */
type Orden = {
	estado: string;
	orden: number;
	nota: string;
};

function esObjeto(valor: unknown): valor is Record<string, unknown> {
	return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function textoDe(objeto: Record<string, unknown>, clave: string): string {
	const valor = objeto[clave];
	return typeof valor === "string" ? valor : "";
}

/** El cuerpo llega como formulario o como JSON; el efecto es el mismo. */
async function leerOrden(c: Context): Promise<Orden> {
	if ((c.req.header("content-type") ?? "").includes("application/json")) {
		const bruto: unknown = await c.req.json();
		const objeto = esObjeto(bruto) ? bruto : {};
		const orden = objeto.orden;
		return {
			estado: textoDe(objeto, "estado"),
			orden: typeof orden === "number" ? orden : Number.parseInt(textoDe(objeto, "orden"), 10),
			nota: textoDe(objeto, "nota"),
		};
	}
	const formulario = await leerFormulario(c);
	return {
		estado: campo(formulario, "estado"),
		orden: Number.parseInt(campo(formulario, "orden"), 10),
		nota: campo(formulario, "nota"),
	};
}

/**
 * Arrastrar una tarjeta. Dentro de la misma columna es `reordenar`; a otra
 * columna es `moverTareaHumano` y después `reordenar` a la posición pedida.
 * Las reglas salen de `src/db/`: aquí no se reimplementa ninguna.
 */
function aplicarOrden(deps: DependenciasWeb, tareaId: number, usuarioId: number, datos: Orden): void {
	const tarea = buscarTarea(deps.db, tareaId);
	if (tarea === undefined) {
		throw new ErrorDeRegla("tarea_inexistente", `No existe la tarea ${formatearId(tareaId)}.`);
	}
	if (!esEstado(datos.estado)) {
		throw new ErrorDeRegla("estado_desconocido", `«${datos.estado}» no es ninguna de las cinco columnas.`);
	}
	if (!Number.isSafeInteger(datos.orden) || datos.orden < 1) {
		throw new ErrorDeRegla("orden_invalido", "La posición de destino tiene que ser un número a partir de 1.");
	}
	if (datos.estado !== tarea.estado) {
		moverTareaHumano(deps.db, { tareaId, usuarioId, estado: datos.estado, nota: datos.nota });
	}
	reordenar(deps.db, { tareaId, orden: datos.orden });
}

// --- rutas -------------------------------------------------------------------

/**
 * El kanban: la página entera, el fragmento del tablero que el cliente
 * recarga, y la acción de arrastrar. Se registra antes que `/tareas/:id` para
 * que «kanban» no se lea como identificador de tarea.
 */
export function registrarRutasKanban(app: Hono, deps: DependenciasWeb): void {
	app.get("/tareas/kanban", (c) => paginaKanban(c, deps));

	// Solo el fragmento: el cliente sustituye `#tablero` sin repintar la página.
	app.get("/tareas/kanban/tablero", (c) => c.html(tablero(deps.db, filtrosDe(c)), 200, { "Cache-Control": "no-store" }));

	app.post("/tareas/:id/orden", async (c) => {
		const tareaId = idDeRuta(c);
		if (tareaId === null) {
			return c.json(
				{ codigo: "id_invalido", mensaje: "Eso no es un identificador de tarea; tiene la forma T-0042." },
				404,
			);
		}
		const datos = await leerOrden(c);
		try {
			aplicarOrden(deps, tareaId, usuarioActual(c).id, datos);
		} catch (error) {
			if (!esErrorDeRegla(error)) {
				throw error;
			}
			// La tarea que no existe no es un error de reglas del humano: es una
			// tarjeta que el navegador tenía de antes.
			const estado = error.codigo === "tarea_inexistente" ? 404 : ESTADO_AVISO;
			return c.json({ codigo: error.codigo, mensaje: error.message }, estado);
		}
		// El navegador ya tiene la tarjeta donde la soltó: no hay nada que devolver.
		return c.body(null, 204);
	});
}
