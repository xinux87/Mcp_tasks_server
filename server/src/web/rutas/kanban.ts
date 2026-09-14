import type { DatabaseSync } from "node:sqlite";
import type { Context, Hono } from "hono";
import { html } from "hono/html";
import { type TerminalListado, terminalesActivos } from "../../db/admin.ts";
import { revisionActual } from "../../db/consultas.ts";
import { dependenciasDeVarias } from "../../db/dependencias.ts";
import { buscarProyectoPorClave, listarProyectos, type Proyecto } from "../../db/proyectos.ts";
import {
	type AmbitoDeColumna,
	buscarTarea,
	type Estado,
	esEstado,
	type FiltroIndice,
	type ItemIndice,
	listarTareas,
	type Marca,
	moverTareaHumano,
	reordenar,
	type Tarea,
} from "../../db/tareas.ts";
import { ErrorDeRegla, esErrorDeRegla } from "../../errores.ts";
import { formatearId, idONull, parsearId } from "../../md/ids.ts";
import {
	accionNuevaTarea,
	chipProyecto,
	enlaceFuncionalidad,
	filtroSelect,
	type OpcionesFiltro,
	rotuloColumna,
} from "../componentes.ts";
import { abreviar, faseLegible } from "../formatos.ts";
import { campo, ESTADO_AVISO, leerFormulario } from "../formulario.ts";
import {
	COLUMNAS,
	type Html,
	insigniaEstado,
	insigniasMarcas,
	insigniaTipoDeItem,
	pagina,
	type RespuestaHtml,
} from "../plantilla.ts";
import { type DependenciasWeb, usuarioActual } from "../sesion.ts";
import { navProyectos, prefijo, proyectoActual } from "./proyectos.ts";

/** Las marcas por las que se puede filtrar, en el orden en que se muestran. */
export const MARCAS: readonly Marca[] = ["bloqueada", "sin terminal", "en marcha", "análisis listo", "esperando"];

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
export type Filtros = {
	terminal: string;
	marca: string;
	/** Identificador visible de la funcionalidad de la que se enseñan las partes. */
	padre: string;
	/** Clave del proyecto: la de la URL en una vista acotada, la elegida en la cruzada. */
	proyecto: string;
};

/**
 * Los filtros de la petición. El proyecto sale de la URL cuando la vista está
 * acotada (`/p/WEB/…`) y del desplegable cuando es la cruzada: filtrar es lo
 * mismo en los dos casos, lo que cambia es de dónde viene la clave.
 */
export function filtrosDe(c: Context): Filtros {
	return {
		terminal: c.req.query("terminal") ?? "",
		marca: c.req.query("marca") ?? "",
		padre: c.req.query("padre") ?? "",
		proyecto: proyectoActual(c)?.clave ?? c.req.query("proyecto") ?? "",
	};
}

/** Solo las partes de esa funcionalidad. Sin filtro pasan todas. */
function esDeLaFuncionalidad(item: ItemIndice, padre: string): boolean {
	if (padre === "") {
		return true;
	}
	const padreId = idONull(padre);
	return padreId !== null && item.padreId === padreId;
}

/**
 * El filtro del índice: terminal y proyecto, que es lo que sabe resolver la
 * base. Una clave que no es de ningún proyecto no selecciona ninguna tarea,
 * igual que un identificador de funcionalidad que no encaja.
 */
function filtroDeIndice(db: DatabaseSync, filtros: Filtros): FiltroIndice {
	const terminalId = Number.parseInt(filtros.terminal, 10);
	const proyectoId = filtros.proyecto === "" ? undefined : (buscarProyectoPorClave(db, filtros.proyecto)?.id ?? 0);
	return {
		...(Number.isSafeInteger(terminalId) ? { terminalId } : {}),
		...(proyectoId === undefined ? {} : { proyectoId }),
	};
}

function tareasFiltradas(db: DatabaseSync, filtros: Filtros): ItemIndice[] {
	return listarTareas(db, filtroDeIndice(db, filtros)).filter((item) => {
		if (esMarca(filtros.marca) && !item.marcas.includes(filtros.marca)) {
			return false;
		}
		return esDeLaFuncionalidad(item, filtros.padre);
	});
}

/** Las funcionalidades vivas, que son por las que tiene sentido filtrar. */
export function funcionalidadesAbiertas(db: DatabaseSync): ItemIndice[] {
	return listarTareas(db).filter((item) => item.tipo === "funcionalidad" && item.estado !== "finished");
}

/**
 * La dirección con la que el cliente vuelve a pedir este mismo fragmento. En
 * una vista acotada el proyecto ya va en la ruta, así que no se repite en la
 * query.
 */
function fuenteDe(filtros: Filtros, acotado: Proyecto | undefined): string {
	const consulta = new URLSearchParams();
	for (const [nombre, valor] of Object.entries(filtros)) {
		if (valor !== "" && !(nombre === "proyecto" && acotado !== undefined)) {
			consulta.set(nombre, valor);
		}
	}
	const base = `${prefijo(acotado)}/tareas/kanban/tablero`;
	const texto = consulta.toString();
	return texto === "" ? base : `${base}?${texto}`;
}

// --- trozos de página --------------------------------------------------------

/**
 * La misma fila de filtros que la lista, sin `estado`: aquí el estado es la
 * columna. «Quitar filtros» solo sale cuando hay algo que quitar.
 */
function formularioFiltros(
	db: DatabaseSync,
	activos: TerminalListado[],
	filtros: Filtros,
	acotado: Proyecto | undefined,
): Html {
	const hayFiltro = filtros.terminal !== "" || filtros.marca !== "" || filtros.padre !== "";
	const base = `${prefijo(acotado)}/tareas/kanban`;
	return html`<form class="filtros" method="get" action="${base}">
			${acotado !== undefined ? html`` : filtroSelect(opcionesProyecto(db, filtros.proyecto))}
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
			${filtroSelect(opcionesFuncionalidad(db, filtros.padre))}
			<button type="submit" class="pequeno">Filtrar</button>
			${hayFiltro || (acotado === undefined && filtros.proyecto !== "") ? html`<a class="quitar" href="${base}">Quitar filtros</a>` : html``}
		</form>`;
}

/**
 * El desplegable de proyectos de la vista cruzada, compartido por la lista, el
 * kanban y las funcionalidades. En una vista acotada no se pinta: el proyecto
 * ya está en la URL.
 */
export function opcionesProyecto(db: DatabaseSync, seleccionado: string): OpcionesFiltro {
	return {
		nombre: "proyecto",
		titulo: "Proyecto",
		todas: "todos",
		valores: listarProyectos(db).map((proyecto) => ({
			valor: proyecto.clave,
			texto: `${proyecto.clave} · ${abreviar(proyecto.nombre, 24)}`,
		})),
		seleccionado,
	};
}

/**
 * El desplegable de funcionalidades, compartido por la lista y el kanban: se
 * filtra por la funcionalidad de la que una tarea es parte.
 */
export function opcionesFuncionalidad(db: DatabaseSync, seleccionado: string): OpcionesFiltro {
	return {
		nombre: "padre",
		titulo: "Funcionalidad",
		todas: "todas",
		valores: funcionalidadesAbiertas(db).map((item) => ({
			valor: formatearId(item.id),
			texto: abreviar(item.titulo, 32),
		})),
		seleccionado,
	};
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
 * Lo que una tarjeta necesita saber de su entorno y no trae el índice: de qué
 * depende y de qué funcionalidad es parte. Se resuelve una vez por tablero: el
 * kanban pinta muchas tarjetas y no puede consultar la base en cada una.
 */
type Vecindad = {
	dependencias: Map<number, number[]>;
	funcionalidades: Map<number, string>;
	/** La clave de cada proyecto, solo en la vista cruzada: acotada sobraría. */
	proyectos: Map<number, string> | null;
};

function vecindadDe(db: DatabaseSync, items: ItemIndice[], conFuncionalidad: boolean, conProyecto: boolean): Vecindad {
	const padres = new Set<number>();
	for (const item of items) {
		if (item.padreId !== null && conFuncionalidad) {
			padres.add(item.padreId);
		}
	}
	const funcionalidades = new Map<number, string>();
	for (const padreId of padres) {
		const padre = buscarTarea(db, padreId);
		// Una hija de trabajo cuelga de una tarea normal: eso no es ser parte de
		// una funcionalidad y no se enseña en la tarjeta.
		if (padre !== undefined && padre.tipo === "funcionalidad") {
			funcionalidades.set(padreId, padre.titulo);
		}
	}
	return {
		dependencias: dependenciasDeVarias(
			db,
			items.map((item) => item.id),
		),
		funcionalidades,
		proyectos: conProyecto ? new Map(listarProyectos(db).map((proyecto) => [proyecto.id, proyecto.clave])) : null,
	};
}

/** `depende de T-0043`, con las que la tarea espera. Vacío si no depende de nada. */
function dependenciasLegibles(dependeDe: number[] | undefined): Html {
	if (dependeDe === undefined || dependeDe.length === 0) {
		return html``;
	}
	return html`<p class="pequeno silencio">depende de ${dependeDe.map(formatearId).join(", ")}</p>`;
}

/**
 * Una tarjeta. `data-id` y `data-estado` son lo que lee el cliente al soltar:
 * el id para la ruta y el estado para saber si cambió de columna.
 */
function tarjeta(item: ItemIndice, vecindad: Vecindad): Html {
	const id = formatearId(item.id);
	const funcionalidad = item.padreId === null ? undefined : vecindad.funcionalidades.get(item.padreId);
	const clave = vecindad.proyectos?.get(item.proyectoId);
	return html`<article class="tarjeta" data-id="${id}" data-estado="${item.estado}">
			<div class="linea">
				<a class="id-tarea" href="/tareas/${id}">${id}</a>
				${clave === undefined ? html`` : chipProyecto(clave)}
				${insigniaTipoDeItem(item)}
				${insigniasMarcas(item.marcas)}
			</div>
			<p class="titulo">${item.titulo}</p>
			${
				funcionalidad === undefined || item.padreId === null
					? html``
					: html`<p class="pequeno">${enlaceFuncionalidad(item.padreId, funcionalidad)}</p>`
			}
			${dependenciasLegibles(vecindad.dependencias.get(item.id))}
			<p class="pequeno silencio">${fasesLegibles(item)}</p>
		</article>`;
}

/**
 * Una columna. El contenedor de tarjetas lleva el `data-estado`: es la zona
 * donde suelta SortableJS, y de ahí sale la columna de destino.
 */
function columna(titulo: string, estado: Estado, items: ItemIndice[], total: number, vecindad: Vecindad): Html {
	// Las cerradas están archivadas y son muchas: se enseñan las últimas y el
	// resto se ve en la lista filtrada.
	const pie =
		estado === "finished" && total > 0
			? html`<p class="pequeno"><a href="/tareas?estado=finished">ver todas (${total})</a></p>`
			: html``;
	return html`<section class="columna">
			<h2>${rotuloColumna(insigniaEstado(estado), titulo, total)}</h2>
			<div class="tarjetas" data-estado="${estado}">${items.map((item) => tarjeta(item, vecindad))}</div>
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
 * sube la revisión. Lleva su propia revisión para no repintar hacia atrás y la
 * dirección de la que salió, para volver a pedirse con sus mismos filtros: la
 * ficha de una funcionalidad enseña este mismo tablero con solo sus partes.
 */
export function tablero(db: DatabaseSync, filtros: Filtros, acotado?: Proyecto): Html {
	const items = tareasFiltradas(db, filtros);
	// Dentro del tablero de una funcionalidad, cada tarjeta es una parte suya:
	// repetir su título en todas no diría nada que no diga la propia página.
	const vecindad = vecindadDe(db, items, filtros.padre === "", acotado === undefined);
	// `data-padre` y `data-proyecto` son el ámbito del tablero: con ellos, la
	// posición que manda el cliente al soltar es entre las tarjetas que se ven.
	return html`<section id="tablero" class="tablero" data-fuente="${fuenteDe(filtros, acotado)}" data-padre="${filtros.padre}" data-proyecto="${acotado?.clave ?? ""}" data-revision="${revisionActual(db)}">
			<p class="aviso aviso-tablero" id="aviso-tablero" role="alert" hidden></p>
			<div class="columnas">
				${COLUMNAS.map((cual) => {
					const propias = items.filter((item) => item.estado === cual.estado);
					const visibles = cual.estado === "finished" ? ultimasCerradas(db, propias) : propias;
					return columna(cual.titulo, cual.estado, visibles, propias.length, vecindad);
				})}
			</div>
		</section>`;
}

// --- páginas -----------------------------------------------------------------

function paginaKanban(c: Context, deps: DependenciasWeb): RespuestaHtml {
	const { db } = deps;
	const filtros = filtrosDe(c);
	const acotado = proyectoActual(c);
	const cuerpo = html`${formularioFiltros(db, terminalesActivos(db), filtros, acotado)}
		${tablero(db, filtros, acotado)}`;
	// El tablero ocupa todo el ancho: cinco columnas no caben en 60 rem.
	return c.html(
		pagina({
			...navProyectos(c, db),
			titulo: acotado === undefined ? "Kanban" : `Kanban · ${acotado.clave}`,
			usuario: usuarioActual(c),
			vista: "kanban",
			revision: revisionActual(db),
			acciones: accionNuevaTarea(prefijo(acotado)),
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
	/** Funcionalidad del tablero del que salió, si venía acotado. Vacío en el kanban global. */
	padre: string;
	/** Clave del proyecto del tablero del que salió. Vacía en la vista cruzada. */
	proyecto: string;
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
			padre: textoDe(objeto, "padre"),
			proyecto: textoDe(objeto, "proyecto"),
		};
	}
	const formulario = await leerFormulario(c);
	return {
		estado: campo(formulario, "estado"),
		orden: Number.parseInt(campo(formulario, "orden"), 10),
		nota: campo(formulario, "nota"),
		padre: campo(formulario, "padre"),
		proyecto: campo(formulario, "proyecto"),
	};
}

/**
 * El ámbito de la reordenación. En el tablero de una funcionalidad la posición
 * es entre sus partes y en el de un proyecto, entre sus tareas: en los dos la
 * tarjeta tiene que ser una de las que ese tablero enseña.
 */
function ambitoDe(db: DatabaseSync, tarea: Tarea, datos: Orden): AmbitoDeColumna | undefined {
	if (datos.padre !== "") {
		const padreId = idONull(datos.padre);
		if (padreId === null || tarea.padreId !== padreId) {
			throw new ErrorDeRegla(
				"padre_no_coincide",
				`La tarea ${formatearId(tarea.id)} no es parte de ${datos.padre}: ese tablero no puede colocarla.`,
			);
		}
		return { padreId };
	}
	if (datos.proyecto === "") {
		return undefined;
	}
	const proyecto = buscarProyectoPorClave(db, datos.proyecto);
	if (proyecto === undefined || proyecto.id !== tarea.proyectoId) {
		throw new ErrorDeRegla(
			"otro_proyecto",
			`La tarea ${formatearId(tarea.id)} no es del proyecto ${datos.proyecto}: ese tablero no puede colocarla.`,
		);
	}
	return { proyectoId: proyecto.id };
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
	const entre = ambitoDe(deps.db, tarea, datos);
	if (datos.estado !== tarea.estado) {
		moverTareaHumano(deps.db, { tareaId, usuarioId, estado: datos.estado, nota: datos.nota });
	}
	reordenar(deps.db, { tareaId, orden: datos.orden, entre });
}

// --- rutas -------------------------------------------------------------------

/**
 * El kanban: la página entera, el fragmento del tablero que el cliente
 * recarga, y la acción de arrastrar. Se registra antes que `/tareas/:id` para
 * que «kanban» no se lea como identificador de tarea.
 */
export function registrarRutasKanban(app: Hono, deps: DependenciasWeb): void {
	app.get("/tareas/kanban", (c) => paginaKanban(c, deps));
	app.get("/p/:clave/tareas/kanban", (c) => paginaKanban(c, deps));

	// Solo el fragmento: el cliente sustituye `#tablero` sin repintar la página.
	const fragmento = (c: Context): RespuestaHtml =>
		c.html(tablero(deps.db, filtrosDe(c), proyectoActual(c)), 200, { "Cache-Control": "no-store" });
	app.get("/tareas/kanban/tablero", fragmento);
	app.get("/p/:clave/tareas/kanban/tablero", fragmento);

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
