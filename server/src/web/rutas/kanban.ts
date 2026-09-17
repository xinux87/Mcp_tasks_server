import type { DatabaseSync } from "node:sqlite";
import type { Context, Hono } from "hono";
import { html } from "hono/html";
import { revisionActual } from "../../db/consultas.ts";
import { dependenciasDeVarias } from "../../db/dependencias.ts";
import { buscarProyectoPorClave, listarProyectos, type Proyecto } from "../../db/proyectos.ts";
import {
	type AmbitoDeColumna,
	buscarTarea,
	type Estado,
	esEstado,
	esRapido,
	type FiltroIndice,
	type ItemIndice,
	idDeCodigoONull,
	listarTareas,
	type Marca,
	moverTareaHumano,
	reordenar,
	type Tarea,
} from "../../db/tareas.ts";
import { ErrorDeRegla, esErrorDeRegla } from "../../errores.ts";
import { formatearId, idONull } from "../../md/ids.ts";
import {
	accionNuevaTarea,
	barraProgreso,
	chipProyecto,
	conmutadorVistas,
	edadEnColumna,
	enlaceFuncionalidad,
	esperaPorElHumano,
	esperaPorTi,
	filtrosRapidos,
	type Miga,
	type OpcionesFiltro,
	rotuloColumna,
} from "../componentes.ts";
import { abreviar, faseLegible, tokensConPresupuesto } from "../formatos.ts";
import { campo, ESTADO_AVISO, leerFormulario } from "../formulario.ts";
import {
	COLUMNAS,
	type Html,
	insigniaColumna,
	insigniaEstado,
	insigniasMarcas,
	insigniaTipoDeItem,
	pagina,
	type RespuestaHtml,
} from "../plantilla.ts";
import { type DependenciasWeb, usuarioActual } from "../sesion.ts";
import { navProyectos, prefijo, proyectoActual, proyectoDeLaBarra } from "./proyectos.ts";

/** Las marcas por las que se puede filtrar, en el orden en que se muestran. */
export const MARCAS: readonly Marca[] = [
	"bloqueada",
	"sin terminal",
	"en marcha",
	"análisis listo",
	"esperando",
	"sobre presupuesto",
];

/** Cuántas cerradas se enseñan en su columna. El resto, en la lista filtrada. */
const CERRADAS_VISIBLES = 10;

/** Para qué sirve la sección Tareas. La comparten sus dos vistas. */
export const PROPOSITO_TAREAS = "Las tareas del proyecto, agrupadas por funcionalidad.";

/** `DEFAULT › Tareas` cuando la vista está acotada; sin proyecto no hay camino que contar. */
export function migasDeTareas(acotado: Proyecto | undefined): Miga[] | undefined {
	return acotado === undefined
		? undefined
		: [{ texto: acotado.clave, href: `/p/${acotado.clave}/tareas` }, { texto: "Tareas" }];
}

function esMarca(valor: string): valor is Marca {
	const nombres: readonly string[] = MARCAS;
	return nombres.includes(valor);
}

/** La tarea de la ruta, o `null` si el identificador no existe o no tiene la forma buena. */
function idDeRuta(db: DatabaseSync, c: Context): number | null {
	const codigo = idONull(c.req.param("id") ?? "");
	return codigo === null ? null : idDeCodigoONull(db, codigo);
}

// --- filtros -----------------------------------------------------------------

/** Los filtros de las dos vistas de Tareas. Vacío es no filtrar por ese campo. */
export type Filtros = {
	/**
	 * La columna. Solo filtra en la lista: en el tablero el estado es la columna
	 * y ahí solo viaja, para que el conmutador de vistas no lo pierda al volver.
	 */
	estado: string;
	terminal: string;
	marca: string;
	/** Identificador visible de la funcionalidad de la que se enseñan las partes. */
	padre: string;
	/** Clave del proyecto: la de la URL en una vista acotada, la elegida en la cruzada. */
	proyecto: string;
	/** El conmutador de un clic: `espera`, `en-marcha` o `sin-terminal`. */
	rapido: string;
	/** Lo que se busca en el título y en la descripción. */
	q: string;
	/**
	 * Cómo se agrupan la lista y el tablero: en carriles por funcionalidad, que
	 * es lo de serie, o `no` para verlos por columnas.
	 */
	agrupar?: string;
};

/** Lo que pide el tablero y la lista por columnas, sin carriles: `?agrupar=no`. */
const SIN_AGRUPAR = "no";

/** Las dos vistas de la sección Tareas, por la ruta de cada una. */
const RUTA_VISTA = { lista: "/tareas", tablero: "/tareas/kanban" } as const;

/**
 * Agrupar por funcionalidad es lo de serie: una funcionalidad agrupa tareas y
 * así se ve. Un tablero acotado a una funcionalidad ya son sus partes, así que
 * ahí no hay nada que agrupar.
 */
export function enCarriles(filtros: Filtros): boolean {
	return filtros.padre === "" && filtros.agrupar !== SIN_AGRUPAR;
}

/**
 * Los filtros de la petición. El proyecto sale de la URL cuando la vista está
 * acotada (`/p/WEB/…`) y del desplegable cuando es la cruzada: filtrar es lo
 * mismo en los dos casos, lo que cambia es de dónde viene la clave.
 */
export function filtrosDe(c: Context): Filtros {
	return {
		estado: c.req.query("estado") ?? "",
		terminal: c.req.query("terminal") ?? "",
		marca: c.req.query("marca") ?? "",
		padre: c.req.query("padre") ?? "",
		proyecto: proyectoActual(c)?.clave ?? c.req.query("proyecto") ?? "",
		rapido: c.req.query("rapido") ?? "",
		q: c.req.query("q") ?? "",
		agrupar: c.req.query("agrupar") ?? "",
	};
}

/**
 * Los filtros como parámetros de una dirección: los vacíos no viajan, y el
 * proyecto tampoco cuando ya va en la ruta. Con ellos se compone el enlace de
 * cada conmutador y la dirección con la que el tablero se vuelve a pedir.
 */
export function consultaDe(filtros: Filtros, acotado: Proyecto | undefined): URLSearchParams {
	const consulta = new URLSearchParams();
	for (const [nombre, valor] of Object.entries(filtros)) {
		if (valor !== undefined && valor !== "" && !(nombre === "proyecto" && acotado !== undefined)) {
			consulta.set(nombre, valor);
		}
	}
	return consulta;
}

/** Solo las partes de esa funcionalidad. Sin filtro pasan todas. */
function esDeLaFuncionalidad(item: ItemIndice, padre: string): boolean {
	if (padre === "") {
		return true;
	}
	return item.padreCodigo === idONull(padre);
}

/**
 * El filtro del índice: terminal y proyecto, que es lo que sabe resolver la
 * base. Una clave que no es de ningún proyecto no selecciona ninguna tarea,
 * igual que un identificador de funcionalidad que no encaja.
 */
export function filtroDeIndice(db: DatabaseSync, filtros: Filtros): FiltroIndice {
	const terminalId = Number.parseInt(filtros.terminal, 10);
	const proyectoId = filtros.proyecto === "" ? undefined : (buscarProyectoPorClave(db, filtros.proyecto)?.id ?? 0);
	return {
		...(Number.isSafeInteger(terminalId) ? { terminalId } : {}),
		...(proyectoId === undefined ? {} : { proyectoId }),
		...(esRapido(filtros.rapido) ? { rapido: filtros.rapido } : {}),
		...(filtros.q === "" ? {} : { q: filtros.q }),
	};
}

function tareasFiltradas(db: DatabaseSync, filtros: Filtros, horasParada: number): ItemIndice[] {
	return listarTareas(db, filtroDeIndice(db, filtros), horasParada).filter((item) => {
		if (esMarca(filtros.marca) && !item.marcas.includes(filtros.marca)) {
			return false;
		}
		return esDeLaFuncionalidad(item, filtros.padre);
	});
}

/**
 * La dirección con la que el cliente vuelve a pedir este mismo fragmento. En
 * una vista acotada el proyecto ya va en la ruta, así que no se repite en la
 * query.
 */
function fuenteDe(filtros: Filtros, acotado: Proyecto | undefined): string {
	const base = `${prefijo(acotado)}/tareas/kanban/tablero`;
	const texto = consultaDe(filtros, acotado).toString();
	return texto === "" ? base : `${base}?${texto}`;
}

// --- trozos de página --------------------------------------------------------

/**
 * El conmutador de agrupación, al lado de los filtros rápidos y con la misma
 * pinta. Dice a qué se va, no dónde se está: agrupado lleva a «Por columnas» y
 * por columnas, a «Agrupar por funcionalidad». Va en la dirección como un
 * filtro más, así que el refresco en vivo y los demás conmutadores lo conservan.
 */
function conmutadorCarriles(vista: Vista, filtros: Filtros, acotado: Proyecto | undefined): Html {
	const agrupado = enCarriles(filtros);
	const consulta = consultaDe({ ...filtros, agrupar: agrupado ? SIN_AGRUPAR : "" }, acotado).toString();
	const base = `${prefijo(acotado)}${RUTA_VISTA[vista]}`;
	return html`<a class="boton-filtro" href="${consulta === "" ? base : `${base}?${consulta}`}">${agrupado ? "Por columnas" : "Agrupar por funcionalidad"}</a>`;
}

/** Cuál de las dos vistas de Tareas se está pintando. */
export type Vista = keyof typeof RUTA_VISTA;

/**
 * La fila de filtros, la misma en la lista y en el tablero: cómo ver las
 * tareas, los tres conmutadores de un clic, la agrupación y la búsqueda. No
 * hay desplegables: el proyecto lo acota la URL y el estado es la columna.
 */
export function filaFiltros(vista: Vista, filtros: Filtros, acotado: Proyecto | undefined): Html {
	const base = `${prefijo(acotado)}${RUTA_VISTA[vista]}`;
	// Lo único que se escribe es la búsqueda; el resto viaja escondido para que
	// buscar no pierda el conmutador ni el ámbito.
	const ocultos = consultaDe(filtros, acotado);
	ocultos.delete("q");
	return html`<div class="fila-filtros">
		${conmutadorVistas(vista, prefijo(acotado), consultaDe(filtros, acotado))}
		${filtrosRapidos(filtros.rapido, base, consultaDe(filtros, acotado))}
		${conmutadorCarriles(vista, filtros, acotado)}
		<form class="filtros" method="get" action="${base}">
			${[...ocultos].map(([nombre, valor]) => html`<input type="hidden" name="${nombre}" value="${valor}">`)}
			<input type="search" name="q" value="${filtros.q}" placeholder="Buscar">
		</form>
	</div>`;
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
			texto: `${proyecto.clave} — ${abreviar(proyecto.nombre, 24)}`,
		})),
		seleccionado,
	};
}

/**
 * Las dos fases: «análisis sonnet@portatil, ejecución opus@portatil», o «sin asignar».
 * Una pregunta solo tiene análisis, así que enseña esa sola.
 */
function fasesLegibles(item: ItemIndice): string {
	const analisis = faseLegible(item.analisisModelo, item.analisisTerminal);
	if (item.tipo === "pregunta") {
		return `análisis ${analisis}`;
	}
	const ejecucion = faseLegible(item.ejecucionModelo, item.ejecucionTerminal);
	if (analisis === "sin asignar" && ejecucion === "sin asignar") {
		return "sin asignar";
	}
	return `análisis ${analisis}, ejecución ${ejecucion}`;
}

/**
 * Lo que una tarjeta necesita saber de su entorno y no trae el índice: de qué
 * depende y de qué funcionalidad es parte. Se resuelve una vez por tablero: el
 * kanban pinta muchas tarjetas y no puede consultar la base en cada una.
 */
type Vecindad = {
	dependencias: Map<number, string[]>;
	funcionalidades: Map<number, string>;
	/** El proyecto de cada tarea, solo en la vista cruzada: acotada sobraría. */
	proyectos: Map<number, Proyecto> | null;
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
		proyectos: conProyecto ? new Map(listarProyectos(db).map((proyecto) => [proyecto.id, proyecto])) : null,
	};
}

/** `depende de T-0043`, con las que la tarea espera. Vacío si no depende de nada. */
function dependenciasLegibles(dependeDe: string[] | undefined): Html {
	if (dependeDe === undefined || dependeDe.length === 0) {
		return html``;
	}
	return html`<p class="pequeno silencio">depende de ${dependeDe.map(formatearId).join(", ")}</p>`;
}

/**
 * El progreso de una tarea con hijas. En una funcionalidad son sus partes, y
 * una parte solo cuenta cuando el humano la acepta: es la cuenta que ya lleva
 * su etiqueta.
 */
export function progresoDe(item: ItemIndice): Html {
	return item.tipo === "funcionalidad"
		? barraProgreso(item.partesCerradas ?? 0, item.partes ?? 0, "partes")
		: barraProgreso(item.hijasCerradas, item.hijas);
}

/**
 * Una tarjeta. `data-id` y `data-estado` son lo que lee el cliente al soltar:
 * el id para la ruta y el estado para saber si cambió de columna.
 */
function tarjeta(item: ItemIndice, vecindad: Vecindad): Html {
	const id = formatearId(item.codigo);
	const funcionalidad = item.padreId === null ? undefined : vecindad.funcionalidades.get(item.padreId);
	const proyecto = vecindad.proyectos?.get(item.proyectoId);
	const tokens = tokensConPresupuesto(item.tokensConHijas, item.presupuesto);
	// El filete de la izquierda es la misma señal que la etiqueta: se ve de lejos
	// cuáles de todo el tablero esperan por el humano.
	const espera = esperaPorElHumano(item.estado, item.marcas);
	return html`<article class="tarjeta${espera ? " espera" : ""}" data-id="${id}" data-estado="${item.estado}">
			<div class="linea">
				<a class="id-tarea" href="/tareas/${id}">${id}</a>
				${proyecto === undefined ? html`` : chipProyecto(proyecto)}
				${esperaPorTi(item.estado, item.marcas)}
				${insigniaTipoDeItem(item)}
				${insigniasMarcas(item.marcas, item.enMarchaDesde)}
				${edadEnColumna(item)}
			</div>
			<p class="titulo">${item.titulo}</p>
			${progresoDe(item)}
			${
				funcionalidad === undefined || item.padreCodigo === null
					? html``
					: html`<p class="pequeno">${enlaceFuncionalidad(item.padreCodigo, funcionalidad)}</p>`
			}
			${dependenciasLegibles(vecindad.dependencias.get(item.id))}
			<p class="pequeno silencio pie">
				<span>${fasesLegibles(item)}</span>
				${tokens === "" ? html`` : html`<span class="tokens">${tokens}</span>`}
			</p>
		</article>`;
}

/**
 * Una columna. El contenedor de tarjetas lleva el `data-estado`: es la zona
 * donde suelta SortableJS, y de ahí sale la columna de destino.
 */
function columna(estado: Estado, items: ItemIndice[], total: number, vecindad: Vecindad): Html {
	// Las cerradas están archivadas y son muchas: se enseñan las últimas y el
	// resto se ve en la lista filtrada. Dentro de una franja caben todas, y
	// entonces no hay ninguna que ir a ver a otro sitio.
	const pie =
		estado === "finished" && total > items.length
			? html`<p class="pequeno"><a href="/tareas?estado=finished">ver todas (${total})</a></p>`
			: html``;
	return html`<section class="columna">
			<h2>${rotuloColumna(insigniaColumna(estado), estado, total)}</h2>
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
 * Las cinco columnas con las tareas que se les den. `recortarCerradas` es lo
 * que separa el tablero entero, donde las cerradas son muchas, de una franja,
 * donde son las de una sola funcionalidad y caben todas.
 */
function columnas(db: DatabaseSync, items: ItemIndice[], vecindad: Vecindad, recortarCerradas: boolean): Html {
	return html`<div class="columnas">
			${COLUMNAS.map((estado) => {
				const propias = items.filter((item) => item.estado === estado);
				const visibles = estado === "finished" && recortarCerradas ? ultimasCerradas(db, propias) : propias;
				return columna(estado, visibles, propias.length, vecindad);
			})}
		</div>`;
}

/** Un carril de la lista o del tablero: su funcionalidad, o `null` en «Sueltas». */
export type Franja = {
	cual: ItemIndice | null;
	items: ItemIndice[];
};

/** El orden de los carriles: primero lo que está en marcha. `finished` no tiene. */
const ORDEN_FRANJAS: readonly Estado[] = ["doing", "prepared", "backlog", "done"];

/**
 * De qué funcionalidad cuelga una tarea: se sube por el padre hasta dar con
 * una. Vale tanto para una parte como para la hija de trabajo de una parte.
 * El tope de saltos no debería hacer falta, pero un árbol con un ciclo colgaría
 * la página entera.
 */
function funcionalidadDe(item: ItemIndice, todas: Map<number, ItemIndice>): ItemIndice | null {
	let padreId = item.padreId;
	for (let salto = 0; padreId !== null && salto < todas.size; salto += 1) {
		const padre = todas.get(padreId);
		if (padre === undefined) {
			return null;
		}
		if (padre.tipo === "funcionalidad") {
			return padre;
		}
		padreId = padre.padreId;
	}
	return null;
}

/**
 * Las franjas del tablero agrupado. El índice entero se lee una vez, no una
 * por tarjeta: de ahí salen los antepasados y las cabeceras.
 *
 * Solo se pinta la funcionalidad que tenga alguna tarea visible con los
 * filtros puestos, y ninguna `finished`: sus partes están cerradas, así que lo
 * poco que quedara suyo cae en «Sueltas», que va siempre la última y siempre
 * se pinta.
 */
export function franjasDe(db: DatabaseSync, items: ItemIndice[]): Franja[] {
	const indice = listarTareas(db);
	const todas = new Map(indice.map((tarea) => [tarea.id, tarea]));
	const agrupadas = new Map<number, ItemIndice[]>();
	const sueltas: ItemIndice[] = [];
	for (const item of items) {
		// La funcionalidad es la cabecera de su franja, no una tarjeta más.
		if (item.tipo === "funcionalidad") {
			continue;
		}
		const cual = funcionalidadDe(item, todas);
		if (cual === null || cual.estado === "finished") {
			sueltas.push(item);
			continue;
		}
		const propias = agrupadas.get(cual.id);
		if (propias === undefined) {
			agrupadas.set(cual.id, [item]);
		} else {
			propias.push(item);
		}
	}
	// `listarTareas` ya viene ordenado por columna y por orden dentro de ella,
	// así que recorrerlo por estados da las franjas en su orden sin ordenar nada.
	const franjas: Franja[] = [];
	for (const estado of ORDEN_FRANJAS) {
		for (const tarea of indice) {
			const propias = agrupadas.get(tarea.id);
			if (propias !== undefined && tarea.tipo === "funcionalidad" && tarea.estado === estado) {
				franjas.push({ cual: tarea, items: propias });
			}
		}
	}
	franjas.push({ cual: null, items: sueltas });
	return franjas;
}

/**
 * Una franja con lo que sea que se le ponga dentro: las cinco columnas en el
 * tablero, la tabla de sus partes en la lista. La cabecera es la misma en las
 * dos, y `data-padre` es su ámbito, el mismo que lleva el tablero de la ficha
 * de una funcionalidad: el cliente lo manda al soltar y el servidor coloca la
 * tarjeta entre hermanas. «Sueltas» no lo lleva.
 */
export function seccionFranja(cual: ItemIndice | null, proyectos: Map<number, Proyecto> | null, dentro: Html): Html {
	const id = cual === null ? "" : formatearId(cual.codigo);
	const proyecto = cual === null ? undefined : proyectos?.get(cual.proyectoId);
	const cabecera =
		cual === null
			? html`<h2>Sueltas</h2>`
			: html`${proyecto === undefined ? html`` : chipProyecto(proyecto)}
				<a class="id-tarea" href="/tareas/${id}">${id}</a>
				<h2><a href="/tareas/${id}">${cual.titulo}</a></h2>
				${insigniaEstado(cual.estado)}
				${barraProgreso(cual.partesCerradas ?? 0, cual.partes ?? 0, "partes")}`;
	return html`<section class="franja"${cual === null ? html`` : html` data-padre="${id}"`}>
			<header class="franja-cabecera">${cabecera}</header>
			${dentro}
		</section>`;
}

/** Una franja del tablero: su cabecera y, debajo, las cinco columnas con solo sus tareas. */
function franja(db: DatabaseSync, { cual, items }: Franja, vecindad: Vecindad): Html {
	return seccionFranja(cual, vecindad.proyectos, columnas(db, items, vecindad, cual === null));
}

/**
 * El fragmento del tablero, que es lo que el cliente vuelve a pedir cuando
 * sube la revisión. Lleva su propia revisión para no repintar hacia atrás y la
 * dirección de la que salió, para volver a pedirse con sus mismos filtros: la
 * ficha de una funcionalidad enseña este mismo tablero con solo sus partes.
 */
export function tablero(db: DatabaseSync, filtros: Filtros, horasParada: number, acotado?: Proyecto): Html {
	const items = tareasFiltradas(db, filtros, horasParada);
	const carriles = enCarriles(filtros);
	// Dentro del tablero de una funcionalidad, y dentro de una franja, cada
	// tarjeta cuelga de la que encabeza: repetir su título en todas no diría
	// nada que no diga ya la cabecera.
	const vecindad = vecindadDe(db, items, filtros.padre === "" && !carriles, acotado === undefined);
	// `data-padre` y `data-proyecto` son el ámbito del tablero: con ellos, la
	// posición que manda el cliente al soltar es entre las tarjetas que se ven.
	return html`<section id="tablero" class="tablero" data-fuente="${fuenteDe(filtros, acotado)}" data-padre="${filtros.padre}" data-proyecto="${acotado?.clave ?? ""}" data-revision="${revisionActual(db)}">
			<p class="aviso aviso-tablero" id="aviso-tablero" role="alert" hidden></p>
			${carriles ? franjasDe(db, items).map((cual) => franja(db, cual, vecindad)) : columnas(db, items, vecindad, true)}
		</section>`;
}

// --- páginas -----------------------------------------------------------------

function paginaKanban(c: Context, deps: DependenciasWeb): RespuestaHtml {
	const { db } = deps;
	const filtros = filtrosDe(c);
	const acotado = proyectoActual(c);
	const cuerpo = html`${filaFiltros("tablero", filtros, acotado)}
		${tablero(db, filtros, deps.config.FASE_PARADA_HORAS, acotado)}`;
	// El tablero ocupa todo el ancho: cinco columnas no caben en 60 rem.
	return c.html(
		pagina({
			...navProyectos(c, db),
			// Lista y tablero son la misma sección vista de dos maneras: el título
			// es el de la sección y el proyecto va en las migas.
			titulo: "Tareas",
			proposito: PROPOSITO_TAREAS,
			migas: migasDeTareas(acotado),
			usuario: usuarioActual(c),
			vista: "kanban",
			revision: revisionActual(db),
			acciones: accionNuevaTarea(prefijo(proyectoDeLaBarra(c, db))),
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
		const padreId = tarea.padreId;
		const padre = padreId === null ? undefined : buscarTarea(db, padreId);
		if (padreId === null || padre?.codigo !== idONull(datos.padre)) {
			throw new ErrorDeRegla(
				"padre_no_coincide",
				`La tarea ${formatearId(tarea.codigo)} no es parte de ${datos.padre}: ese tablero no puede colocarla.`,
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
			`La tarea ${formatearId(tarea.codigo)} no es del proyecto ${datos.proyecto}: ese tablero no puede colocarla.`,
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
		throw new ErrorDeRegla("tarea_inexistente", "Esa tarea ya no existe.");
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
		c.html(tablero(deps.db, filtrosDe(c), deps.config.FASE_PARADA_HORAS, proyectoActual(c)), 200, {
			"Cache-Control": "no-store",
		});
	app.get("/tareas/kanban/tablero", fragmento);
	app.get("/p/:clave/tareas/kanban/tablero", fragmento);

	app.post("/tareas/:id/orden", async (c) => {
		const tareaId = idDeRuta(deps.db, c);
		if (tareaId === null) {
			return c.json(
				{ codigo: "id_invalido", mensaje: "Eso no es ninguna tarea; el identificador tiene la forma T-K7M3XQ." },
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
