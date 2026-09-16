import type { DatabaseSync } from "node:sqlite";
import { ErrorDeRegla } from "../errores.ts";
import { formatearId, generarCodigo } from "../md/ids.ts";
import { type Actor, registrarActividad } from "./actividad.ts";
import { faseConAgente } from "./agentes.ts";
import {
	ahora,
	booleano,
	entero,
	enteroOpcional,
	escribirContenido,
	idInsertado,
	revisionActual,
	sentencia,
	texto,
	textoOpcional,
} from "./base.ts";
import { type ConsumoDeTarea, consumoDeTarea } from "./consumo.ts";
import {
	borrarDependenciasDe,
	CERRADAS,
	CUENTA_DEPENDENCIAS_PENDIENTES,
	contarDependenciasPendientes,
	dependenciasDe,
	dependenciasDeVarias,
	escribirDependencias,
} from "./dependencias.ts";
import {
	aprobarDescomposicion,
	cerrarFuncionalidadSiProcede,
	cerrarPadreSiProcede,
	partesDe,
} from "./funcionalidades.ts";
import {
	autorHumano,
	type Comentario,
	comentariosDeTarea,
	insertarComentario,
	type Pregunta,
	preguntasDeTarea,
} from "./hilo.ts";
import { exigirProyectoPorId, PROYECTO_PRINCIPAL } from "./proyectos.ts";

/** Las cinco columnas del kanban, en su orden. */
export type Estado = "backlog" | "prepared" | "doing" | "done" | "finished";

/** Las dos fases de una tarea: primero se analiza, después se ejecuta. */
export type Fase = "analisis" | "ejecucion";

/**
 * Qué clase de encargo es. Una `pregunta` es un encargo cuya salida es una
 * respuesta escrita, no código: solo tiene fase de análisis y el comentario
 * `analisis` es la respuesta. Una `funcionalidad` es lo que pide el humano en
 * lenguaje de negocio: su ejecución son sus partes, no código propio.
 */
export type TipoTarea = "tarea" | "pregunta" | "funcionalidad";

/** Etiquetas derivadas del estado de la tarea. No se guardan: se calculan al leer. */
export type Marca = "bloqueada" | "sin terminal" | "en marcha" | "análisis listo" | "esperando" | "sobre presupuesto";

const ESTADOS: readonly Estado[] = ["backlog", "prepared", "doing", "done", "finished"];

const TIPOS: readonly TipoTarea[] = ["tarea", "pregunta", "funcionalidad"];

export type Tarea = {
	id: number;
	/** Identificador visible, sin el prefijo: `K7M3XQ`, o `0042` en las de antes. */
	codigo: string;
	/** Proyecto al que pertenece. Una tarea nace en el proyecto de quien la crea. */
	proyectoId: number;
	titulo: string;
	descripcion: string;
	tipo: TipoTarea;
	/** Rama de git en la que se trabaja. Una funcionalidad la fija y sus partes la heredan. */
	rama: string | null;
	estado: Estado;
	orden: number;
	padreId: number | null;
	autoejecucion: boolean;
	/** Tope de tokens, o `null` si no tiene. Pasarlo pone la marca `sobre presupuesto`. */
	presupuesto: number | null;
	ejecucionAprobada: boolean;
	analisisHecho: boolean;
	/** Papel con el que se trabaja la fase, o `null` si no lleva ninguno. */
	analisisAgenteId: number | null;
	analisisModelo: string | null;
	analisisTerminalId: number | null;
	ejecucionAgenteId: number | null;
	ejecucionModelo: string | null;
	ejecucionTerminalId: number | null;
	enMarchaTerminalId: number | null;
	creadaPorUsuarioId: number | null;
	creadaPorTerminalId: number | null;
	creada: string;
	actualizada: string;
	/** Cuándo entró en el estado en el que está. Solo la web la enseña, como edad en columna. */
	estadoDesde: string;
	/** Revisión global con la que se escribió esta fila por última vez. */
	revision: number;
};

/** Una hija tal como se lista en el documento de la tarea padre. */
export type HijaDeTarea = {
	id: number;
	codigo: string;
	estado: Estado;
	titulo: string;
	/** Códigos de las hermanas que tienen que ir antes que ella. Vacío si no depende de ninguna. */
	dependeDe: string[];
};

/** Lo que necesita `lineaIndice`: una tarea sin cuerpo ni hilo. */
export type ItemIndice = {
	id: number;
	codigo: string;
	/** La línea de índice no lo pinta: el agente solo ve tareas de su proyecto. Lo usa la web. */
	proyectoId: number;
	tipo: TipoTarea;
	estado: Estado;
	titulo: string;
	padreId: number | null;
	/** Código del padre, para enlazarlo sin volver a consultarlo. */
	padreCodigo: string | null;
	marcas: Marca[];
	/** Cuándo entró en su estado actual: la edad en columna sale de aquí. */
	estadoDesde: string;
	/**
	 * Cuándo se hizo la pregunta abierta más antigua, o `null` si no hay ninguna.
	 * La edad de una tarea bloqueada se cuenta desde aquí, no desde `estadoDesde`.
	 */
	bloqueadaDesde: string | null;
	/** Solo en una funcionalidad: cuántas partes tiene y cuántas están cerradas. */
	partes: number | null;
	partesCerradas: number | null;
	/** Hijas directas y cuántas de ellas están `done` o `finished`: el progreso de la tarjeta. */
	hijas: number;
	hijasCerradas: number;
	/** Tokens de la tarea más los de todas sus descendientes. */
	tokensConHijas: number;
	/** Tope de tokens, o `null` si no tiene: la fila y la tarjeta pintan `184 k / 200 k`. */
	presupuesto: number | null;
	/** Nombre del papel de cada fase, resuelto en la misma consulta. */
	analisisAgente: string | null;
	analisisModelo: string | null;
	analisisTerminal: string | null;
	ejecucionAgente: string | null;
	ejecucionModelo: string | null;
	ejecucionTerminal: string | null;
};

/** Una pregunta contestada tal como sale en `novedades`. */
export type PreguntaContestada = {
	tareaId: number;
	codigo: string;
	numero: number;
	opcion: string;
};

/** Todo lo que hace falta para escribir el documento Markdown de una tarea. */
export type TareaCompleta = {
	tarea: Tarea;
	/** La clave del proyecto de la tarea: es lo que va en el frontmatter. */
	proyecto: string;
	/** Código de la funcionalidad de la que es parte, o `null` si no cuelga de nadie. */
	padre: string | null;
	/** Nombre del papel de cada fase, o `null` si no lleva ninguno. */
	analisisAgente: string | null;
	analisisTerminal: string | null;
	ejecucionAgente: string | null;
	ejecucionTerminal: string | null;
	marcas: Marca[];
	/** Códigos de las tareas que tienen que estar `done` o `finished` antes que esta. */
	dependeDe: string[];
	/** Solo en una funcionalidad: cuántas partes tiene y cuántas están cerradas. */
	partes: number | null;
	partesCerradas: number | null;
	hijas: HijaDeTarea[];
	comentarios: Comentario[];
	preguntas: Pregunta[];
	consumo: ConsumoDeTarea;
	/**
	 * Revisión global del servidor en el momento de la lectura, no la de la
	 * fila. Es la que el agente guarda para la siguiente llamada a `novedades`.
	 */
	revisionServidor: number;
};

// --- mapeadores de fila ------------------------------------------------------

export function esEstado(valor: string): valor is Estado {
	const nombres: readonly string[] = ESTADOS;
	return nombres.includes(valor);
}

export function esTipoTarea(valor: string): valor is TipoTarea {
	const nombres: readonly string[] = TIPOS;
	return nombres.includes(valor);
}

function comoTipo(fila: Record<string, unknown>): TipoTarea {
	const valor = texto(fila, "tipo");
	if (!esTipoTarea(valor)) {
		throw new Error(`tipo de tarea desconocido en la base de datos: ${valor}`);
	}
	return valor;
}

function comoEstado(fila: Record<string, unknown>, columna: string): Estado {
	const valor = texto(fila, columna);
	if (!esEstado(valor)) {
		throw new Error(`estado desconocido en la base de datos: ${valor}`);
	}
	return valor;
}

export function comoTarea(fila: Record<string, unknown>): Tarea {
	return {
		id: entero(fila, "id"),
		codigo: texto(fila, "codigo"),
		proyectoId: entero(fila, "proyecto_id"),
		titulo: texto(fila, "titulo"),
		descripcion: texto(fila, "descripcion"),
		tipo: comoTipo(fila),
		rama: textoOpcional(fila, "rama"),
		estado: comoEstado(fila, "estado"),
		orden: entero(fila, "orden"),
		padreId: enteroOpcional(fila, "padre_id"),
		autoejecucion: booleano(fila, "autoejecucion"),
		presupuesto: enteroOpcional(fila, "presupuesto"),
		ejecucionAprobada: booleano(fila, "ejecucion_aprobada"),
		analisisHecho: booleano(fila, "analisis_hecho"),
		analisisAgenteId: enteroOpcional(fila, "analisis_agente_id"),
		analisisModelo: textoOpcional(fila, "analisis_modelo"),
		analisisTerminalId: enteroOpcional(fila, "analisis_terminal_id"),
		ejecucionAgenteId: enteroOpcional(fila, "ejecucion_agente_id"),
		ejecucionModelo: textoOpcional(fila, "ejecucion_modelo"),
		ejecucionTerminalId: enteroOpcional(fila, "ejecucion_terminal_id"),
		enMarchaTerminalId: enteroOpcional(fila, "en_marcha_terminal_id"),
		creadaPorUsuarioId: enteroOpcional(fila, "creada_por_usuario_id"),
		creadaPorTerminalId: enteroOpcional(fila, "creada_por_terminal_id"),
		creada: texto(fila, "creada"),
		actualizada: texto(fila, "actualizada"),
		estadoDesde: texto(fila, "estado_desde"),
		revision: entero(fila, "revision"),
	};
}

/** Índice y novedades traen los nombres de terminal y las preguntas abiertas por JOIN. */
function comoItemIndice(fila: Record<string, unknown>): ItemIndice {
	const tarea = comoTarea(fila);
	const esFuncionalidad = tarea.tipo === "funcionalidad";
	const tokensConHijas = entero(fila, "tokens_con_hijas");
	return {
		id: tarea.id,
		codigo: tarea.codigo,
		proyectoId: tarea.proyectoId,
		tipo: tarea.tipo,
		estado: tarea.estado,
		titulo: tarea.titulo,
		padreId: tarea.padreId,
		padreCodigo: textoOpcional(fila, "padre_codigo"),
		marcas: marcasDe(tarea, entero(fila, "preguntas_abiertas"), entero(fila, "dependencias_pendientes"), tokensConHijas),
		estadoDesde: tarea.estadoDesde,
		bloqueadaDesde: textoOpcional(fila, "bloqueada_desde"),
		// Una parte cerrada es una hija `finished`: en una funcionalidad la
		// entrega la da por buena el humano, no basta con que esté construida.
		partes: esFuncionalidad ? entero(fila, "hijas") : null,
		partesCerradas: esFuncionalidad ? entero(fila, "partes_cerradas") : null,
		hijas: entero(fila, "hijas"),
		hijasCerradas: entero(fila, "hijas_cerradas"),
		tokensConHijas,
		presupuesto: tarea.presupuesto,
		analisisAgente: textoOpcional(fila, "analisis_agente"),
		analisisModelo: tarea.analisisModelo,
		analisisTerminal: textoOpcional(fila, "analisis_terminal"),
		ejecucionAgente: textoOpcional(fila, "ejecucion_agente"),
		ejecucionModelo: tarea.ejecucionModelo,
		ejecucionTerminal: textoOpcional(fila, "ejecucion_terminal"),
	};
}

/**
 * `SELECT` con los nombres de los terminales de cada fase y el número de
 * preguntas abiertas, que es lo que necesitan las marcas. El `t.*` trae todas
 * las columnas de la tarea, `tipo` incluido: el índice lo necesita para pintar
 * `pregunta` y para saltarse el segmento de ejecución.
 *
 * El árbol de cada tarea se arma una sola vez para toda la consulta y de él
 * sale el consumo con hijas: el kanban pinta muchas tarjetas y no puede hacer
 * una consulta por cada una. `UNION` y no `UNION ALL` porque así un ciclo de
 * padres, si alguna vez se colara, deja de recorrerse en vez de no acabar.
 */
const SELECT_INDICE = `
	WITH RECURSIVE arbol(raiz, id) AS (
		SELECT id, id FROM tareas
		UNION
		SELECT a.raiz, h.id FROM tareas h JOIN arbol a ON h.padre_id = a.id
	)
	SELECT t.*,
		p.codigo AS padre_codigo,
		ta.nombre AS analisis_terminal,
		te.nombre AS ejecucion_terminal,
		aa.nombre AS analisis_agente,
		ae.nombre AS ejecucion_agente,
		(SELECT COUNT(*) FROM preguntas p WHERE p.tarea_id = t.id AND p.respuesta_opcion IS NULL) AS preguntas_abiertas,
		(SELECT MIN(p.creada) FROM preguntas p WHERE p.tarea_id = t.id AND p.respuesta_opcion IS NULL) AS bloqueada_desde,
		${CUENTA_DEPENDENCIAS_PENDIENTES} AS dependencias_pendientes,
		(SELECT COUNT(*) FROM tareas h WHERE h.padre_id = t.id) AS hijas,
		(SELECT COUNT(*) FROM tareas h WHERE h.padre_id = t.id AND h.estado IN ${CERRADAS}) AS hijas_cerradas,
		(SELECT COUNT(*) FROM tareas h WHERE h.padre_id = t.id AND h.estado = 'finished') AS partes_cerradas,
		COALESCE(tk.tokens, 0) AS tokens_con_hijas
	FROM tareas t
	LEFT JOIN tareas p ON p.id = t.padre_id
	LEFT JOIN terminales ta ON ta.id = t.analisis_terminal_id
	LEFT JOIN terminales te ON te.id = t.ejecucion_terminal_id
	LEFT JOIN agentes aa ON aa.id = t.analisis_agente_id
	LEFT JOIN agentes ae ON ae.id = t.ejecucion_agente_id
	LEFT JOIN (
		SELECT a.raiz AS id, SUM(c.tokens) AS tokens
		FROM arbol a JOIN consumo c ON c.tarea_id = a.id
		GROUP BY a.raiz
	) tk ON tk.id = t.id`;

/** Orden de las columnas del kanban dentro de un `ORDER BY`. */
const ORDEN_COLUMNAS =
	"CASE t.estado WHEN 'backlog' THEN 0 WHEN 'prepared' THEN 1 WHEN 'doing' THEN 2 WHEN 'done' THEN 3 ELSE 4 END";

// --- lectura -----------------------------------------------------------------

export function buscarTarea(db: DatabaseSync, tareaId: number): Tarea | undefined {
	const fila = sentencia(db, "SELECT * FROM tareas WHERE id = ?").get(tareaId);
	return fila === undefined ? undefined : comoTarea(fila);
}

/** La tarea que lleva ese código visible, o `undefined` si no hay ninguna. */
export function buscarTareaPorCodigo(db: DatabaseSync, codigo: string): Tarea | undefined {
	const fila = sentencia(db, "SELECT * FROM tareas WHERE codigo = ?").get(codigo);
	return fila === undefined ? undefined : comoTarea(fila);
}

/**
 * El número de fila de un código, o `null` si no existe. Es el paso que traduce
 * lo que se ve (`T-K7M3XQ`) a lo que enlazan las tablas.
 */
export function idDeCodigoONull(db: DatabaseSync, codigo: string): number | null {
	const fila = sentencia(db, "SELECT id FROM tareas WHERE codigo = ?").get(codigo);
	return fila === undefined ? null : entero(fila, "id");
}

/** El mismo número de fila, exigiendo que exista: lanza `tarea_inexistente`. */
export function idDeCodigo(db: DatabaseSync, codigo: string): number {
	const id = idDeCodigoONull(db, codigo);
	if (id === null) {
		throw new ErrorDeRegla("tarea_inexistente", `No existe la tarea ${formatearId(codigo)}.`);
	}
	return id;
}

/** Como `buscarTarea`, pero el fallo es del agente: lanza `tarea_inexistente`. */
export function exigirTarea(db: DatabaseSync, tareaId: number): Tarea {
	const tarea = buscarTarea(db, tareaId);
	if (tarea === undefined) {
		throw new ErrorDeRegla("tarea_inexistente", `No existe la tarea ${tareaId}.`);
	}
	return tarea;
}

/**
 * El proyecto para el que trabaja un terminal. Se lee suelto, sin traerse el
 * módulo de consultas: `consultas.ts` no depende de este y así sigue.
 */
export function proyectoDeTerminal(db: DatabaseSync, terminalId: number): number {
	const fila = sentencia(db, "SELECT proyecto_id FROM terminales WHERE id = ?").get(terminalId);
	if (fila === undefined) {
		throw new ErrorDeRegla("terminal_inexistente", `No existe el terminal ${terminalId}.`);
	}
	return entero(fila, "proyecto_id");
}

function nombreTerminal(db: DatabaseSync, terminalId: number | null): string | null {
	if (terminalId === null) {
		return null;
	}
	const fila = sentencia(db, "SELECT nombre FROM terminales WHERE id = ?").get(terminalId);
	return fila === undefined ? null : texto(fila, "nombre");
}

/** El nombre del papel de una fase, que es lo que va en el frontmatter. */
function nombreAgente(db: DatabaseSync, agenteId: number | null): string | null {
	if (agenteId === null) {
		return null;
	}
	const fila = sentencia(db, "SELECT nombre FROM agentes WHERE id = ?").get(agenteId);
	return fila === undefined ? null : texto(fila, "nombre");
}

/** Preguntas de la tarea que todavía no tienen respuesta. */
export function contarPreguntasAbiertas(db: DatabaseSync, tareaId: number): number {
	const fila = sentencia(
		db,
		"SELECT COUNT(*) AS total FROM preguntas WHERE tarea_id = ? AND respuesta_opcion IS NULL",
	).get(tareaId);
	if (fila === undefined) {
		throw new Error("COUNT(*) no devolvió ninguna fila");
	}
	return entero(fila, "total");
}

function hijasDe(db: DatabaseSync, tareaId: number): HijaDeTarea[] {
	const hijas = sentencia(db, "SELECT id, codigo, estado, titulo FROM tareas WHERE padre_id = ? ORDER BY id")
		.all(tareaId)
		.map((fila) => ({
			id: entero(fila, "id"),
			codigo: texto(fila, "codigo"),
			estado: comoEstado(fila, "estado"),
			titulo: texto(fila, "titulo"),
			dependeDe: [] as string[],
		}));
	// Las dependencias de todas las hijas se leen de una vez: la
	// descomposición de una funcionalidad son varias partes encadenadas.
	const porHija = dependenciasDeVarias(
		db,
		hijas.map((hija) => hija.id),
	);
	for (const hija of hijas) {
		hija.dependeDe = porHija.get(hija.id) ?? [];
	}
	return hijas;
}

/**
 * La fase que toca: «análisis» mientras la tarea está en `prepared` sin
 * análisis hecho, «ejecución» en cualquier otro caso.
 */
export function faseQueToca(tarea: Tarea): Fase {
	return tarea.estado === "prepared" && !tarea.analisisHecho ? "analisis" : "ejecucion";
}

/**
 * Marcas activas de la tarea, en el orden en el que se muestran. No se
 * guardan en la base de datos: son consecuencia del estado.
 *
 * `tokensConHijas` es lo gastado en el árbol entero, que es con lo que se
 * compara el presupuesto: el índice ya lo trae y `leerTarea` ya lo calcula
 * para la ficha.
 */
export function marcasDe(
	tarea: Tarea,
	preguntasAbiertas: number,
	dependenciasPendientes = 0,
	tokensConHijas = 0,
): Marca[] {
	const marcas: Marca[] = [];
	if (preguntasAbiertas > 0) {
		marcas.push("bloqueada");
	}
	// «sin terminal» solo se calcula donde hay una fase que tomar: en `backlog`
	// la tarea todavía no la ve el agente, y en `done` y `finished` ya no la
	// trabaja nadie, así que ahí la marca no diría nada.
	if (tarea.estado === "prepared" || tarea.estado === "doing") {
		// Ni una pregunta ni una funcionalidad tienen fase de ejecución: la
		// única fase que se puede tomar es el análisis, así que la marca mira
		// solo ese terminal.
		const esAnalisis = tarea.tipo !== "tarea" || faseQueToca(tarea) === "analisis";
		const terminalDeLaFase = esAnalisis ? tarea.analisisTerminalId : tarea.ejecucionTerminalId;
		if (terminalDeLaFase === null) {
			marcas.push("sin terminal");
		}
	}
	if (tarea.enMarchaTerminalId !== null) {
		marcas.push("en marcha");
	}
	// En una pregunta no hay ejecución que aprobar: el análisis es la respuesta
	// y la deja en `done` él solo. En una funcionalidad la aprobación de la
	// descomposición es siempre del humano, tenga o no autoejecución: es la
	// decisión que más dinero gobierna.
	if (
		tarea.tipo !== "pregunta" &&
		tarea.estado === "prepared" &&
		tarea.analisisHecho &&
		preguntasAbiertas === 0 &&
		(tarea.tipo === "funcionalidad" || !tarea.autoejecucion) &&
		!tarea.ejecucionAprobada
	) {
		marcas.push("análisis listo");
	}
	// Con alguna dependencia sin cerrar no la puede tomar nadie. Solo en
	// `prepared`: en `doing` ya se está trabajando y en el resto no aplica.
	if (tarea.estado === "prepared" && dependenciasPendientes > 0) {
		marcas.push("esperando");
	}
	// Pasarse del tope es un aviso al humano, en cualquier columna: no frena a
	// nadie y no depende del estado, solo de lo que ya se ha gastado.
	if (tarea.presupuesto !== null && tokensConHijas > tarea.presupuesto) {
		marcas.push("sobre presupuesto");
	}
	return marcas;
}

/**
 * Un presupuesto tal como llega de la web o del CLI: entero de cero en
 * adelante, o nulo para quitarlo. Cualquier otra cosa (un texto, un decimal,
 * un negativo) es un formulario que no se guarda a medias.
 */
export function exigirPresupuesto(presupuesto: number | null): number | null {
	if (presupuesto === null) {
		return null;
	}
	if (!Number.isSafeInteger(presupuesto) || presupuesto < 0) {
		throw new ErrorDeRegla(
			"presupuesto_invalido",
			"El presupuesto se escribe en tokens, con un número entero de 0 en adelante.",
		);
	}
	return presupuesto;
}

/** Todo lo que necesita el documento Markdown de la tarea. */
export function leerTarea(db: DatabaseSync, tareaId: number): TareaCompleta | undefined {
	const tarea = buscarTarea(db, tareaId);
	if (tarea === undefined) {
		return undefined;
	}
	const partes = tarea.tipo === "funcionalidad" ? partesDe(db, tareaId) : null;
	// El consumo se lee antes que las marcas: de él sale el total con hijas con
	// el que se compara el presupuesto, y la ficha ya lo necesitaba entero.
	const consumo = consumoDeTarea(db, tareaId);
	return {
		tarea,
		proyecto: exigirProyectoPorId(db, tarea.proyectoId).clave,
		padre: tarea.padreId === null ? null : (buscarTarea(db, tarea.padreId)?.codigo ?? null),
		analisisAgente: nombreAgente(db, tarea.analisisAgenteId),
		analisisTerminal: nombreTerminal(db, tarea.analisisTerminalId),
		ejecucionAgente: nombreAgente(db, tarea.ejecucionAgenteId),
		ejecucionTerminal: nombreTerminal(db, tarea.ejecucionTerminalId),
		marcas: marcasDe(
			tarea,
			contarPreguntasAbiertas(db, tareaId),
			contarDependenciasPendientes(db, tareaId),
			consumo.totalConHijas,
		),
		dependeDe: dependenciasDe(db, tareaId),
		partes: partes === null ? null : partes.total,
		partesCerradas: partes === null ? null : partes.cerradas,
		hijas: hijasDe(db, tareaId),
		comentarios: comentariosDeTarea(db, tareaId),
		preguntas: preguntasDeTarea(db, tareaId),
		consumo,
		revisionServidor: revisionActual(db),
	};
}

/**
 * La línea de índice de una sola tarea. Es lo que devuelven las herramientas
 * que escriben (`tomar_tarea`, `comentar_tarea`, `crear_tarea`, `preguntar`):
 * el agente ve en una línea cómo quedó la tarea sin releerla entera.
 */
export function itemIndiceDe(db: DatabaseSync, tareaId: number): ItemIndice {
	const fila = sentencia(db, `${SELECT_INDICE} WHERE t.id = ?`).get(tareaId);
	if (fila === undefined) {
		throw new ErrorDeRegla("tarea_inexistente", `No existe la tarea ${tareaId}.`);
	}
	return comoItemIndice(fila);
}

/** Los tres conmutadores de un clic de la lista y del kanban. */
export type Rapido = "espera" | "en-marcha" | "sin-terminal";

const RAPIDOS: readonly Rapido[] = ["espera", "en-marcha", "sin-terminal"];

export function esRapido(valor: string): valor is Rapido {
	const nombres: readonly string[] = RAPIDOS;
	return nombres.includes(valor);
}

/**
 * Qué deja pasar cada conmutador. Se corta sobre las marcas ya calculadas y no
 * en SQL: «análisis listo» y «sin terminal» son cinco condiciones cada una y
 * repetirlas en la consulta las dejaría divergir de `marcasDe` en cuanto una
 * cambiara. «Espera por mí» añade `done`, que es lo que espera revisión.
 */
const PASA_RAPIDO: Record<Rapido, (item: ItemIndice) => boolean> = {
	espera: (item) =>
		item.estado === "done" || item.marcas.includes("bloqueada") || item.marcas.includes("análisis listo"),
	"en-marcha": (item) => item.marcas.includes("en marcha"),
	"sin-terminal": (item) => item.marcas.includes("sin terminal"),
};

export type FiltroIndice = {
	estado?: Estado;
	/** Tareas en las que este terminal es el de análisis o el de ejecución. */
	terminalId?: number;
	/** El tablero de un proyecto. Sin él, la vista cruzada: todos los proyectos. */
	proyectoId?: number;
	/** El conmutador de un clic: lo que espera por el humano, lo que está en marcha, lo huérfano. */
	rapido?: Rapido;
	/** Búsqueda por texto en el título y en la descripción. */
	q?: string;
};

/**
 * Escapa lo que en un `LIKE` es comodín, para que buscar `100%` busque `100%`
 * y no «cualquier cosa detrás de 100».
 */
function patronLike(texto: string): string {
	return `%${texto.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
}

/** Índice ligero, ordenado por columna del kanban y por orden dentro de ella. */
export function listarTareas(db: DatabaseSync, filtro: FiltroIndice = {}): ItemIndice[] {
	const condiciones: string[] = [];
	const parametros: (string | number)[] = [];
	if (filtro.estado !== undefined) {
		condiciones.push("t.estado = ?");
		parametros.push(filtro.estado);
	}
	if (filtro.terminalId !== undefined) {
		condiciones.push("(t.analisis_terminal_id = ? OR t.ejecucion_terminal_id = ?)");
		parametros.push(filtro.terminalId, filtro.terminalId);
	}
	if (filtro.proyectoId !== undefined) {
		condiciones.push("t.proyecto_id = ?");
		parametros.push(filtro.proyectoId);
	}
	if (filtro.q !== undefined && filtro.q.trim() !== "") {
		// `lower()` de SQLite solo pliega ASCII: «Métrica» no encuentra
		// «métrica» escrita con mayúscula acentuada. Es una limitación conocida.
		// ponytail: LIKE sobre lower(), FTS5 unicode61 cuando se quede corta.
		condiciones.push("(lower(t.titulo) LIKE ? ESCAPE '\\' OR lower(t.descripcion) LIKE ? ESCAPE '\\')");
		const patron = patronLike(filtro.q.trim());
		parametros.push(patron, patron);
	}
	const donde = condiciones.length === 0 ? "" : ` WHERE ${condiciones.join(" AND ")}`;
	const sql = `${SELECT_INDICE}${donde} ORDER BY ${ORDEN_COLUMNAS}, t.orden, t.id`;
	const items = sentencia(db, sql)
		.all(...parametros)
		.map(comoItemIndice);
	return filtro.rapido === undefined ? items : items.filter(PASA_RAPIDO[filtro.rapido]);
}

export type Desde = {
	terminalId: number;
	revision: number;
};

/**
 * El proyecto del terminal que pregunta. `novedades` está acotada a él: un
 * terminal es de un solo proyecto y «sin terminal» significa «cualquier
 * terminal de este proyecto».
 */
const PROYECTO_DEL_TERMINAL = "(SELECT proyecto_id FROM terminales WHERE id = ?)";

/**
 * Lo que `novedades` devuelve como tareas: solo `prepared` y `doing`, solo lo
 * cambiado desde esa revisión, y solo aquello en lo que este terminal puede
 * trabajar, es decir, la fase que toca es suya o no tiene terminal. Las de
 * `backlog`, `done` y `finished` nunca salen, ni las que esperan a una
 * dependencia, ni una funcionalidad en `doing`: esa no tiene nada que un
 * agente pueda hacer, su trabajo son sus partes. `doing` va antes que
 * `prepared` porque terminar lo empezado es prioritario sobre empezar algo
 * nuevo.
 */
export function tareasParaTerminalDesde(db: DatabaseSync, { terminalId, revision }: Desde): ItemIndice[] {
	const sql = `${SELECT_INDICE}
		WHERE t.estado IN ('prepared', 'doing')
			AND t.proyecto_id = ${PROYECTO_DEL_TERMINAL}
			AND t.revision > ?
			AND ${CUENTA_DEPENDENCIAS_PENDIENTES} = 0
			AND NOT (t.tipo = 'funcionalidad' AND t.estado = 'doing')
			AND CASE
				WHEN t.estado = 'prepared' AND t.analisis_hecho = 0
					THEN (t.analisis_terminal_id IS NULL OR t.analisis_terminal_id = ?)
					ELSE (t.ejecucion_terminal_id IS NULL OR t.ejecucion_terminal_id = ?)
			END
		ORDER BY CASE t.estado WHEN 'doing' THEN 0 ELSE 1 END, t.orden, t.id`;
	return sentencia(db, sql).all(terminalId, revision, terminalId, terminalId).map(comoItemIndice);
}

/**
 * Preguntas contestadas desde esa revisión en tareas de este terminal. Es la
 * señal con la que el agente retoma una tarea que dejó bloqueada.
 */
export function preguntasContestadasDesde(db: DatabaseSync, { terminalId, revision }: Desde): PreguntaContestada[] {
	const sql = `
		SELECT p.tarea_id, t.codigo, p.numero, p.respuesta_opcion
		FROM preguntas p
		JOIN tareas t ON t.id = p.tarea_id
		WHERE p.respuesta_opcion IS NOT NULL
			AND t.proyecto_id = ${PROYECTO_DEL_TERMINAL}
			AND p.revision > ?
			AND (t.analisis_terminal_id = ? OR t.ejecucion_terminal_id = ?)
		ORDER BY p.tarea_id, p.numero`;
	return sentencia(db, sql)
		.all(terminalId, revision, terminalId, terminalId)
		.map((fila) => ({
			tareaId: entero(fila, "tarea_id"),
			codigo: texto(fila, "codigo"),
			numero: entero(fila, "numero"),
			opcion: texto(fila, "respuesta_opcion"),
		}));
}

// --- escritura ---------------------------------------------------------------

/**
 * Última posición de una columna más uno: las tareas nuevas entran al final.
 * Lo comparte `funcionalidades.ts`, que también mueve tareas entre columnas.
 */
export function siguienteOrden(db: DatabaseSync, estado: Estado): number {
	const fila = sentencia(db, "SELECT COALESCE(MAX(orden), 0) + 1 AS siguiente FROM tareas WHERE estado = ?").get(estado);
	if (fila === undefined) {
		throw new Error("MAX(orden) no devolvió ninguna fila");
	}
	return entero(fila, "siguiente");
}

const INSERTAR_TAREA = `
	INSERT INTO tareas (
		codigo, proyecto_id, titulo, descripcion, tipo, rama, estado, orden, padre_id, autoejecucion, presupuesto,
		ejecucion_aprobada, analisis_hecho, analisis_agente_id, analisis_modelo, analisis_terminal_id,
		ejecucion_agente_id, ejecucion_modelo, ejecucion_terminal_id,
		en_marcha_terminal_id, creada_por_usuario_id, creada_por_terminal_id, creada, actualizada, estado_desde, revision
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Cuántas veces se vuelve a sortear si el código ya está cogido. Con 31^6
 * combinaciones el segundo intento ya es rarísimo; el tope está para que un
 * fallo raro sea un error y no un bucle infinito.
 */
const INTENTOS_CODIGO = 10;

/** Un código que todavía no tiene ninguna tarea. Lo único que reintenta. */
function codigoLibre(conexion: DatabaseSync): string {
	for (let intento = 0; intento < INTENTOS_CODIGO; intento += 1) {
		const codigo = generarCodigo();
		if (sentencia(conexion, "SELECT 1 FROM tareas WHERE codigo = ?").get(codigo) === undefined) {
			return codigo;
		}
	}
	throw new Error(`no se encontró un código de tarea libre en ${INTENTOS_CODIGO} intentos`);
}

/** Los campos con los que nace una tarea. Lo comparte `funcionalidades.ts`. */
export type FilaNueva = {
	proyectoId: number;
	titulo: string;
	descripcion: string;
	tipo: TipoTarea;
	rama: string | null;
	estado: Estado;
	padreId: number | null;
	autoejecucion: boolean;
	/** Solo lo pone el humano al crearla: una hija, una propuesta y una parte nacen sin tope. */
	presupuesto?: number | null;
	analisisHecho: boolean;
	/** Sin papel si no se dice otra cosa: una propuesta y una hija nacen sin él. */
	analisisAgenteId?: number | null;
	analisisModelo: string | null;
	analisisTerminalId: number | null;
	ejecucionAgenteId?: number | null;
	ejecucionModelo: string | null;
	ejecucionTerminalId: number | null;
	enMarchaTerminalId: number | null;
	creadaPorUsuarioId: number | null;
	creadaPorTerminalId: number | null;
};

export function insertarTarea(conexion: DatabaseSync, revision: number, nueva: FilaNueva): Tarea {
	const marca = ahora();
	const cambios = sentencia(conexion, INSERTAR_TAREA).run(
		codigoLibre(conexion),
		nueva.proyectoId,
		nueva.titulo,
		nueva.descripcion,
		nueva.tipo,
		nueva.rama,
		nueva.estado,
		siguienteOrden(conexion, nueva.estado),
		nueva.padreId,
		nueva.autoejecucion ? 1 : 0,
		nueva.presupuesto ?? null,
		0,
		nueva.analisisHecho ? 1 : 0,
		nueva.analisisAgenteId ?? null,
		nueva.analisisModelo,
		nueva.analisisTerminalId,
		nueva.ejecucionAgenteId ?? null,
		nueva.ejecucionModelo,
		nueva.ejecucionTerminalId,
		nueva.enMarchaTerminalId,
		nueva.creadaPorUsuarioId,
		nueva.creadaPorTerminalId,
		marca,
		marca,
		marca,
		revision,
	);
	const tareaId = idInsertado(cambios.lastInsertRowid);
	anotarTransicion(conexion, tareaId, null, nueva.estado, marca);
	return exigirTarea(conexion, tareaId);
}

/**
 * Deja escrito el salto de columna. Se llama desde los dos únicos sitios que
 * ponen un estado —la creación, con `de` a nulo, y `cambiarEstado`— y de ahí
 * salen los tiempos de ciclo y las devoluciones de los informes. Va siempre
 * dentro de la misma transacción que el cambio: o se guardan los dos o ninguno.
 */
function anotarTransicion(conexion: DatabaseSync, tareaId: number, de: Estado | null, a: Estado, creado: string): void {
	sentencia(conexion, "INSERT INTO transiciones (tarea_id, de, a, creado) VALUES (?, ?, ?, ?)").run(
		tareaId,
		de,
		a,
		creado,
	);
}

/**
 * El único sitio que cambia el estado de una tarea. Todo camino pasa por aquí
 * —mover desde la web, tomar la ejecución, el comentario que cierra una fase,
 * la aprobación de una descomposición, el cierre de una funcionalidad— y así
 * `estado_desde` se pone a la hora actual sin que ningún llamador tenga que
 * acordarse. La tarea va al final de su columna nueva, que es donde entra
 * cualquier tarea que llega a un estado.
 *
 * `extra` son las columnas que ese camino escribe además del estado, como
 * fragmento de SQL con sus parámetros: son constantes de este módulo y de
 * `hilo.ts`, nunca texto que venga de fuera.
 */
export function cambiarEstado(
	conexion: DatabaseSync,
	revision: number,
	tareaId: number,
	estado: Estado,
	extra = "",
	parametros: readonly (string | number | null)[] = [],
): void {
	const marca = ahora();
	const antes = exigirTarea(conexion, tareaId).estado;
	sentencia(
		conexion,
		`UPDATE tareas
			SET estado = ?, orden = ?, estado_desde = ?, actualizada = ?, revision = ?${extra}
			WHERE id = ?`,
	).run(estado, siguienteOrden(conexion, estado), marca, marca, revision, ...parametros, tareaId);
	anotarTransicion(conexion, tareaId, antes, estado, marca);
}

/**
 * Deja la revisión de la escritura en curso en la fila de la tarea. Todo el
 * contenido que cuelga de una tarea (comentarios, respuestas) la toca, para
 * que `novedades` se la devuelva al terminal que la trabaja.
 */
export function tocarTarea(conexion: DatabaseSync, tareaId: number, revision: number): void {
	sentencia(conexion, "UPDATE tareas SET actualizada = ?, revision = ? WHERE id = ?").run(ahora(), revision, tareaId);
}

export type NuevaTareaHumana = {
	titulo: string;
	descripcion: string;
	usuarioId: number;
	/** El proyecto del tablero desde el que se crea. Sin decir otro, el principal. */
	proyectoId?: number;
	/** `tarea` si no se dice otra cosa: la pregunta y la funcionalidad son los casos raros. */
	tipo?: TipoTarea;
	/** Rama de git en la que se trabaja. Sus partes la heredan si es una funcionalidad. */
	rama?: string | null;
	/** Solo una funcionalidad puede ser padre: una parte cuelga de ella. */
	padreId?: number | null;
	/** Tareas que tienen que estar `done` o `finished` antes que esta. */
	dependeDe?: number[];
	autoejecucion?: boolean;
	/** Tope de tokens. Sin él, la tarea no tiene presupuesto y nunca lleva la marca. */
	presupuesto?: number | null;
	/** Papel de cada fase. Con él, el modelo y el terminal se copian del agente. */
	analisisAgenteId?: number | null;
	analisisModelo?: string | null;
	analisisTerminalId?: number | null;
	ejecucionAgenteId?: number | null;
	ejecucionModelo?: string | null;
	ejecucionTerminalId?: number | null;
};

/**
 * Colgar una tarea de otra solo tiene sentido bajo una funcionalidad: es una
 * de sus partes. Las hijas de trabajo las cuelga el agente por su cuenta.
 */
export function exigirPadreFuncionalidad(conexion: DatabaseSync, padreId: number): Tarea {
	const padre = exigirTarea(conexion, padreId);
	if (padre.tipo !== "funcionalidad") {
		throw new ErrorDeRegla(
			"padre_no_es_funcionalidad",
			`La tarea ${formatearId(padre.codigo)} no es una funcionalidad: solo una funcionalidad tiene partes colgando.`,
		);
	}
	return padre;
}

/** Tarea escrita por el humano en la web. Nace en `backlog`, que es su columna. */
export function crearTareaHumana(db: DatabaseSync, datos: NuevaTareaHumana): Tarea {
	return escribirContenido(db, (conexion, revision) => {
		const padreId = datos.padreId ?? null;
		const padre = padreId === null ? null : exigirPadreFuncionalidad(conexion, padreId);
		// Asignar un agente a una fase copia su modelo y su terminal: lo que
		// llegue en esos dos campos se ignora.
		const analisis = faseConAgente(conexion, datos.analisisAgenteId ?? null, {
			modelo: datos.analisisModelo ?? null,
			terminalId: datos.analisisTerminalId ?? null,
		});
		const ejecucion = faseConAgente(conexion, datos.ejecucionAgenteId ?? null, {
			modelo: datos.ejecucionModelo ?? null,
			terminalId: datos.ejecucionTerminalId ?? null,
		});
		const tarea = insertarTarea(conexion, revision, {
			// Una parte cuelga de su funcionalidad: vive donde ella, aunque el
			// formulario venga de otro tablero.
			proyectoId: padre?.proyectoId ?? datos.proyectoId ?? PROYECTO_PRINCIPAL,
			titulo: datos.titulo,
			descripcion: datos.descripcion,
			tipo: datos.tipo ?? "tarea",
			// Una parte que crea el humano hereda la rama de su funcionalidad,
			// igual que las que crea el análisis: se trabaja donde se trabaja el
			// evolutivo, salvo que él escriba otra rama.
			rama: datos.rama ?? padre?.rama ?? null,
			estado: "backlog",
			padreId,
			autoejecucion: datos.autoejecucion ?? true,
			presupuesto: exigirPresupuesto(datos.presupuesto ?? null),
			analisisHecho: false,
			analisisAgenteId: analisis.agenteId,
			analisisModelo: analisis.modelo,
			analisisTerminalId: analisis.terminalId,
			ejecucionAgenteId: ejecucion.agenteId,
			ejecucionModelo: ejecucion.modelo,
			ejecucionTerminalId: ejecucion.terminalId,
			enMarchaTerminalId: null,
			creadaPorUsuarioId: datos.usuarioId,
			creadaPorTerminalId: null,
		});
		if (datos.dependeDe !== undefined && datos.dependeDe.length > 0) {
			escribirDependencias(conexion, tarea.id, datos.dependeDe);
		}
		registrarActividad(conexion, {
			actor: { usuarioId: datos.usuarioId },
			accion: "crear_tarea",
			objeto: "tarea",
			objetoId: tarea.id,
			objetoNombre: tarea.titulo,
		});
		return tarea;
	});
}

export type NuevaPropuesta = {
	titulo: string;
	descripcion: string;
	terminalId: number;
	/** `funcionalidad` cuando lo descubierto es grande; `tarea` si no se dice nada. */
	tipo?: "tarea" | "funcionalidad";
};

/**
 * Propuesta: el agente descubre algo que habría que hacer y que no es parte de
 * la tarea actual. Nace en `backlog` para que lo decida el humano.
 */
export function crearPropuesta(db: DatabaseSync, datos: NuevaPropuesta): Tarea {
	return escribirContenido(db, (conexion, revision) =>
		insertarTarea(conexion, revision, {
			// Una propuesta nace en el proyecto del terminal que la propone: es lo
			// que ese agente tiene delante.
			proyectoId: proyectoDeTerminal(conexion, datos.terminalId),
			titulo: datos.titulo,
			descripcion: datos.descripcion,
			tipo: datos.tipo ?? "tarea",
			rama: null,
			estado: "backlog",
			padreId: null,
			autoejecucion: true,
			analisisHecho: false,
			analisisModelo: null,
			analisisTerminalId: null,
			ejecucionModelo: null,
			ejecucionTerminalId: null,
			enMarchaTerminalId: null,
			creadaPorUsuarioId: null,
			creadaPorTerminalId: datos.terminalId,
		}),
	);
}

export type NuevaHija = {
	titulo: string;
	descripcion: string;
	padreId: number;
	terminalId: number;
};

/**
 * Hija de trabajo: un subagente la crea para dejar visible su parte de la
 * ejecución. Nace directamente en `doing`, colgando del padre y con sus mismas
 * asignaciones, y con el análisis dado por hecho: lo hizo el padre.
 */
export function crearHija(db: DatabaseSync, datos: NuevaHija): Tarea {
	return escribirContenido(db, (conexion, revision) => {
		const padre = exigirTarea(conexion, datos.padreId);
		if (padre.estado !== "doing") {
			throw new ErrorDeRegla(
				"padre_no_en_ejecucion",
				`La tarea padre está en ${padre.estado}: solo se cuelgan hijas de una tarea en doing.`,
			);
		}
		if (padre.ejecucionTerminalId !== datos.terminalId) {
			throw new ErrorDeRegla(
				"no_es_el_terminal_de_ejecucion",
				"Solo el terminal que ejecuta la tarea padre puede colgarle hijas.",
			);
		}
		// De una funcionalidad solo cuelgan partes, y las crea su análisis: una
		// hija de trabajo aquí se contaría como parte y no dejaría cerrarla.
		if (padre.tipo === "funcionalidad") {
			throw new ErrorDeRegla(
				"funcionalidad_sin_ejecucion",
				"Una funcionalidad no tiene ejecución propia: cuelga tu trabajo de la parte que estás ejecutando.",
			);
		}
		return insertarTarea(conexion, revision, {
			proyectoId: padre.proyectoId,
			titulo: datos.titulo,
			descripcion: datos.descripcion,
			tipo: "tarea",
			// La hija se trabaja donde se trabaja el padre: si el padre va en
			// una rama, sus commits van a esa misma rama.
			rama: padre.rama,
			estado: "doing",
			padreId: padre.id,
			autoejecucion: padre.autoejecucion,
			analisisHecho: true,
			analisisModelo: padre.analisisModelo,
			analisisTerminalId: null,
			ejecucionModelo: padre.ejecucionModelo,
			ejecucionTerminalId: datos.terminalId,
			enMarchaTerminalId: datos.terminalId,
			creadaPorUsuarioId: null,
			creadaPorTerminalId: datos.terminalId,
		});
	});
}

/** Las únicas transiciones que puede hacer el humano, y cuáles exigen nota. */
const TRANSICIONES: readonly {
	desde: Estado;
	hasta: Estado;
	notaObligatoria: boolean;
	/** Deja la tarea otra vez pendiente de análisis y de aprobación. */
	caducaElAnalisis: boolean;
}[] = [
	{ desde: "backlog", hasta: "prepared", notaObligatoria: false, caducaElAnalisis: false },
	{ desde: "prepared", hasta: "backlog", notaObligatoria: true, caducaElAnalisis: true },
	{ desde: "done", hasta: "finished", notaObligatoria: false, caducaElAnalisis: false },
	{ desde: "done", hasta: "doing", notaObligatoria: true, caducaElAnalisis: false },
];

export type MovimientoHumano = {
	tareaId: number;
	usuarioId: number;
	estado: Estado;
	nota?: string;
};

/**
 * Mover una tarea de columna desde la web. Las vueltas atrás son del humano y
 * siempre dejan un comentario en el hilo explicando por qué. El agente nunca pasa
 * por aquí: él solo mueve hacia delante escribiendo su comentario de cierre.
 */
export function moverTareaHumano(db: DatabaseSync, datos: MovimientoHumano): Tarea {
	return escribirContenido(db, (conexion, revision) => {
		const tarea = exigirTarea(conexion, datos.tareaId);
		const transicion = TRANSICIONES.find(
			(candidata) => candidata.desde === tarea.estado && candidata.hasta === datos.estado,
		);
		if (transicion === undefined) {
			throw new ErrorDeRegla(
				"transicion_no_permitida",
				`No se puede pasar una tarea de ${tarea.estado} a ${datos.estado}.`,
			);
		}
		const nota = datos.nota ?? "";
		if (transicion.notaObligatoria && nota.trim() === "") {
			throw new ErrorDeRegla(
				"nota_obligatoria",
				`Pasar de ${tarea.estado} a ${datos.estado} es una vuelta atrás: hace falta un comentario que explique qué falta.`,
			);
		}
		// Al volver a `doing` nadie la tiene tomada todavía: la marca «en
		// marcha» la vuelve a poner el agente con `tomar_tarea`.
		cambiarEstado(conexion, revision, tarea.id, datos.estado, ", en_marcha_terminal_id = NULL");
		// Volver a `backlog` es repensar la tarea: la descripción puede cambiar,
		// así que el análisis y la aprobación se repiten al salir de nuevo. El
		// comentario de análisis se queda en el hilo, que no se edita nunca.
		if (transicion.caducaElAnalisis) {
			sentencia(conexion, "UPDATE tareas SET analisis_hecho = 0, ejecucion_aprobada = 0 WHERE id = ?").run(tarea.id);
		}
		if (nota !== "") {
			insertarComentario(conexion, revision, {
				tareaId: tarea.id,
				tipo: "comentario",
				autor: autorHumano(conexion, datos.usuarioId),
				texto: nota,
				preguntaId: null,
			});
		}
		registrarActividad(conexion, {
			actor: { usuarioId: datos.usuarioId },
			accion: "mover_tarea",
			objeto: "tarea",
			objetoId: tarea.id,
			objetoNombre: tarea.titulo,
			detalle: `${tarea.estado} → ${datos.estado}`,
		});
		// Aceptar la última parte de una funcionalidad la cierra a ella también,
		// en esta misma transacción: la mueve el servidor, no el humano.
		if (datos.estado === "finished") {
			cerrarFuncionalidadSiProcede(conexion, revision, tarea.id);
		}
		return exigirTarea(conexion, tarea.id);
	});
}

export type Aprobacion = {
	tareaId: number;
	usuarioId: number;
};

/**
 * Con `autoejecucion` desactivada la tarea espera en `prepared` a que el
 * humano dé el análisis por bueno. Esto es lo que desbloquea la ejecución.
 *
 * En una funcionalidad es lo mismo pero se llama descomposición: aprobarla la
 * pasa a `doing` y saca sus partes del backlog.
 */
export function aprobarEjecucion(db: DatabaseSync, datos: Aprobacion): Tarea {
	return escribirContenido(db, (conexion, revision) => {
		const tarea = exigirTarea(conexion, datos.tareaId);
		// Comprobar el usuario deja constancia de que la aprobación es humana.
		autorHumano(conexion, datos.usuarioId);
		if (tarea.tipo === "funcionalidad") {
			aprobarDescomposicion(conexion, revision, tarea);
		} else {
			aprobarTareaNormal(conexion, revision, tarea);
		}
		registrarActividad(conexion, {
			actor: { usuarioId: datos.usuarioId },
			accion: "aprobar_ejecucion",
			objeto: "tarea",
			objetoId: tarea.id,
			objetoNombre: tarea.titulo,
		});
		return exigirTarea(conexion, tarea.id);
	});
}

/** La aprobación de siempre: desbloquear la ejecución de una tarea que espera en `prepared`. */
function aprobarTareaNormal(conexion: DatabaseSync, revision: number, tarea: Tarea): void {
	if (tarea.estado !== "prepared") {
		throw new ErrorDeRegla(
			"estado_no_permite_aprobar",
			`La tarea está en ${tarea.estado}: solo se aprueba la ejecución de una tarea en prepared.`,
		);
	}
	if (!tarea.analisisHecho) {
		throw new ErrorDeRegla("analisis_no_hecho", "Todavía no hay análisis que aprobar.");
	}
	sentencia(conexion, "UPDATE tareas SET ejecucion_aprobada = 1, actualizada = ?, revision = ? WHERE id = ?").run(
		ahora(),
		revision,
		tarea.id,
	);
}

/**
 * Ámbito de un tablero acotado: el de una funcionalidad son sus partes, el de
 * un proyecto son sus tareas. En los dos la posición es entre las de esa vista,
 * no en la columna entera.
 */
export type AmbitoDeColumna = { padreId: number } | { proyectoId: number };

export type Reordenacion = {
	tareaId: number;
	orden: number;
	/** Sin ámbito, la posición es la de la columna global. */
	entre?: AmbitoDeColumna;
};

/** Una fila de la columna que se reordena: lo justo para colocarla. */
type FilaDeColumna = { id: number; orden: number; padreId: number | null; proyectoId: number };

/** Si la fila está en el tablero acotado que se está reordenando. */
function estaEnElAmbito(fila: FilaDeColumna, ambito: AmbitoDeColumna): boolean {
	return "padreId" in ambito ? fila.padreId === ambito.padreId : fila.proyectoId === ambito.proyectoId;
}

/**
 * Traduce una posición dentro de un tablero acotado a la posición global de la
 * columna: la tarea va justo delante de la primera vecina si se soltó arriba, y
 * justo detrás de la que ocupa la posición anterior en cualquier otro caso. Así
 * las tareas que no salen en ese tablero conservan su orden relativo. Devuelve
 * `null` cuando no hay ninguna vecina en la columna: ahí soltar no mueve nada.
 */
function posicionEnElAmbito(resto: FilaDeColumna[], ambito: AmbitoDeColumna, orden: number): number | null {
	// Posición global (desde 1) de cada vecina dentro de la columna sin la propia.
	const hermanas: number[] = [];
	for (let indice = 0; indice < resto.length; indice += 1) {
		const fila = resto[indice];
		if (fila !== undefined && estaEnElAmbito(fila, ambito)) {
			hermanas.push(indice + 1);
		}
	}
	if (orden < 1 || orden > hermanas.length + 1) {
		throw new ErrorDeRegla(
			"orden_invalido",
			`La posición ${orden} no existe: ese tablero tiene ${hermanas.length + 1} sitios donde soltar en esa columna.`,
		);
	}
	const primera = hermanas[0];
	if (primera === undefined) {
		return null;
	}
	if (orden === 1) {
		return primera;
	}
	const anterior = hermanas[orden - 2];
	return anterior === undefined ? null : anterior + 1;
}

/**
 * Cambia la posición de la tarea dentro de su columna y desplaza a las demás.
 * El orden es la prioridad: el agente toma primero la tarea más alta.
 */
export function reordenar(db: DatabaseSync, datos: Reordenacion): Tarea {
	return escribirContenido(db, (conexion, revision) => {
		const tarea = exigirTarea(conexion, datos.tareaId);
		const columna = sentencia(
			conexion,
			"SELECT id, orden, padre_id, proyecto_id FROM tareas WHERE estado = ? ORDER BY orden, id",
		)
			.all(tarea.estado)
			.map((fila) => ({
				id: entero(fila, "id"),
				orden: entero(fila, "orden"),
				padreId: enteroOpcional(fila, "padre_id"),
				proyectoId: entero(fila, "proyecto_id"),
			}));
		const resto = columna.filter((fila) => fila.id !== tarea.id);
		const pedida =
			datos.entre === undefined
				? Math.trunc(datos.orden)
				: posicionEnElAmbito(resto, datos.entre, Math.trunc(datos.orden));
		// Única tarjeta de ese tablero en la columna: no hay entre qué ponerla.
		if (pedida === null) {
			return exigirTarea(conexion, tarea.id);
		}
		const destino = Math.min(Math.max(pedida, 1), resto.length + 1);
		resto.splice(destino - 1, 0, {
			id: tarea.id,
			orden: tarea.orden,
			padreId: tarea.padreId,
			proyectoId: tarea.proyectoId,
		});

		const marca = ahora();
		for (let indice = 0; indice < resto.length; indice += 1) {
			const fila = resto[indice];
			if (fila === undefined) {
				continue;
			}
			const nuevoOrden = indice + 1;
			// La tarea movida se reescribe siempre, aunque caiga donde estaba:
			// el resto, solo si de verdad se desplaza.
			if (fila.id !== tarea.id && fila.orden === nuevoOrden) {
				continue;
			}
			sentencia(conexion, "UPDATE tareas SET orden = ?, actualizada = ?, revision = ? WHERE id = ?").run(
				nuevoOrden,
				marca,
				revision,
				fila.id,
			);
		}
		return exigirTarea(conexion, tarea.id);
	});
}

export type Toma = {
	tareaId: number;
	fase: Fase;
	terminalId: number;
	/** Modelo con el que el bucle va a trabajar la fase. Queda fijado si no había ninguno. */
	modelo?: string;
};

/** `tomar_tarea`: el terminal se hace responsable de una fase y la pone «en marcha». */
export function tomarTarea(db: DatabaseSync, datos: Toma): Tarea {
	return escribirContenido(db, (conexion, revision) => {
		const tarea = exigirTarea(conexion, datos.tareaId);
		// Antes que nada, si la tarea es de otro repositorio: sin esto un terminal
		// tomaría una tarea `sin terminal` que no es la suya.
		if (tarea.proyectoId !== proyectoDeTerminal(conexion, datos.terminalId)) {
			throw new ErrorDeRegla(
				"otro_proyecto",
				`La tarea ${formatearId(tarea.codigo)} es de otro proyecto: este terminal no trabaja en él.`,
			);
		}
		// Una funcionalidad no se ejecuta: lo que se ejecuta son sus partes.
		if (tarea.tipo === "funcionalidad" && datos.fase === "ejecucion") {
			throw new ErrorDeRegla(
				"funcionalidad_sin_ejecucion",
				"Una funcionalidad no tiene fase de ejecución: se ejecutan sus partes, una a una.",
			);
		}
		// Analizar algo antes de que exista aquello de lo que depende es
		// analizar a ciegas: la marca `esperando` corta las dos fases.
		const pendientes = contarDependenciasPendientes(conexion, tarea.id);
		if (pendientes > 0) {
			throw new ErrorDeRegla(
				"esperando_dependencias",
				`La tarea espera a ${pendientes === 1 ? "otra tarea que todavía no está" : `${pendientes} tareas que todavía no están`} done ni finished.`,
			);
		}
		if (datos.fase === "analisis") {
			tomarAnalisis(conexion, revision, tarea, datos.terminalId, datos.modelo);
		} else {
			tomarEjecucion(conexion, revision, tarea, datos.terminalId, datos.modelo);
		}
		return exigirTarea(conexion, tarea.id);
	});
}

const NOMBRE_FASE: Record<Fase, string> = { analisis: "análisis", ejecucion: "ejecución" };

/**
 * El modelo con el que se trabaja una fase queda fijado al tomarla: si no
 * había ninguno se guarda el que trae el bucle, y si había otro distinto la
 * toma falla, porque el autor de los comentarios y el consumo tienen que
 * contar lo mismo. Sin modelo en la toma, la fase se queda como estaba.
 */
function modeloDeLaFase(fase: Fase, asignado: string | null, modelo: string | undefined): string | null {
	if (modelo === undefined) {
		return asignado;
	}
	if (asignado !== null && asignado !== modelo) {
		throw new ErrorDeRegla(
			"modelo_no_coincide",
			`La fase de ${NOMBRE_FASE[fase]} tiene asignado el modelo ${asignado}: trabájala con ${asignado}, no con ${modelo}.`,
		);
	}
	return modelo;
}

function tomarAnalisis(
	conexion: DatabaseSync,
	revision: number,
	tarea: Tarea,
	terminalId: number,
	modelo?: string,
): void {
	if (tarea.estado !== "prepared") {
		throw new ErrorDeRegla(
			"estado_no_permite_analisis",
			`La tarea está en ${tarea.estado}: el análisis solo se toma en prepared.`,
		);
	}
	if (tarea.analisisHecho) {
		throw new ErrorDeRegla("analisis_ya_hecho", "El análisis de esta tarea ya está escrito.");
	}
	if (tarea.analisisTerminalId !== null && tarea.analisisTerminalId !== terminalId) {
		throw new ErrorDeRegla("fase_tomada", "Otro terminal es el responsable del análisis de esta tarea.");
	}
	const analisisModelo = modeloDeLaFase("analisis", tarea.analisisModelo, modelo);
	sentencia(
		conexion,
		`UPDATE tareas
			SET analisis_modelo = ?, analisis_terminal_id = ?, en_marcha_terminal_id = ?, actualizada = ?, revision = ?
			WHERE id = ?`,
	).run(analisisModelo, terminalId, terminalId, ahora(), revision, tarea.id);
}

function tomarEjecucion(
	conexion: DatabaseSync,
	revision: number,
	tarea: Tarea,
	terminalId: number,
	modelo?: string,
): void {
	if (tarea.ejecucionTerminalId !== null && tarea.ejecucionTerminalId !== terminalId) {
		throw new ErrorDeRegla("fase_tomada", "Otro terminal es el responsable de la ejecución de esta tarea.");
	}
	const ejecucionModelo = modeloDeLaFase("ejecucion", tarea.ejecucionModelo, modelo);
	// Retomar una tarea ya en marcha, típicamente tras contestarse una
	// pregunta: no cambia de columna, solo vuelve a ponerse «en marcha».
	if (tarea.estado === "doing") {
		sentencia(
			conexion,
			`UPDATE tareas
				SET ejecucion_modelo = ?, ejecucion_terminal_id = ?, en_marcha_terminal_id = ?, actualizada = ?, revision = ?
				WHERE id = ?`,
		).run(ejecucionModelo, terminalId, terminalId, ahora(), revision, tarea.id);
		return;
	}
	if (tarea.estado !== "prepared") {
		throw new ErrorDeRegla(
			"estado_no_permite_ejecucion",
			`La tarea está en ${tarea.estado}: la ejecución se toma en prepared o se retoma en doing.`,
		);
	}
	if (!tarea.analisisHecho) {
		throw new ErrorDeRegla("analisis_no_hecho", "Pasar a doing exige que el análisis esté escrito.");
	}
	if (contarPreguntasAbiertas(conexion, tarea.id) > 0) {
		throw new ErrorDeRegla(
			"tarea_bloqueada",
			"La tarea tiene preguntas sin contestar: no se ejecuta hasta que se respondan.",
		);
	}
	if (!tarea.autoejecucion && !tarea.ejecucionAprobada) {
		throw new ErrorDeRegla(
			"ejecucion_no_aprobada",
			"La tarea tiene la autoejecución desactivada y el humano todavía no ha aprobado el análisis.",
		);
	}
	cambiarEstado(
		conexion,
		revision,
		tarea.id,
		"doing",
		", ejecucion_modelo = ?, ejecucion_terminal_id = ?, en_marcha_terminal_id = ?",
		[ejecucionModelo, terminalId, terminalId],
	);
}

export type BorradoDeTarea = {
	tareaId: number;
	actor: Actor;
};

/**
 * Borrar una tarea, esté en la columna que esté. Se lleva por delante lo que
 * cuelga de ella (hilo, preguntas, consumo y sus dependencias en los dos
 * sentidos); el rastro de actividad se queda, porque no apunta a la fila con
 * una clave foránea y cuenta lo que pasó, y el id queda quemado para siempre.
 *
 * Una tarea con hijas no se borra: primero se borran ellas. Un solo «sí» no
 * puede llevarse por delante siete tareas con su historia.
 *
 * La que un terminal tiene en marcha sí se borra: el humano manda, y la
 * confirmación le dice que ese trabajo se corta. El agente se entera al
 * intentar escribir en ella.
 */
export function borrarTarea(db: DatabaseSync, datos: BorradoDeTarea): Tarea {
	return escribirContenido(db, (conexion, revision) => {
		const tarea = exigirTarea(conexion, datos.tareaId);
		const hijas = sentencia(conexion, "SELECT COUNT(*) AS total FROM tareas WHERE padre_id = ?").get(tarea.id);
		if (hijas !== undefined && entero(hijas, "total") > 0) {
			throw new ErrorDeRegla("con_hijas", "La tarea tiene tareas colgando: borra primero las hijas.");
		}
		// El rastro se escribe antes del borrado: después ya no habría título
		// que copiar.
		registrarActividad(conexion, {
			actor: datos.actor,
			accion: "borrar_tarea",
			objeto: "tarea",
			objetoId: tarea.id,
			objetoNombre: tarea.titulo,
		});
		// Los comentarios van primero: apuntan a las preguntas.
		sentencia(conexion, "DELETE FROM comentarios WHERE tarea_id = ?").run(tarea.id);
		sentencia(conexion, "DELETE FROM preguntas WHERE tarea_id = ?").run(tarea.id);
		sentencia(conexion, "DELETE FROM consumo WHERE tarea_id = ?").run(tarea.id);
		sentencia(conexion, "DELETE FROM transiciones WHERE tarea_id = ?").run(tarea.id);
		borrarDependenciasDe(conexion, tarea.id);
		sentencia(conexion, "DELETE FROM tareas WHERE id = ?").run(tarea.id);
		// Si era la última parte pendiente de una funcionalidad, con ella fuera
		// la funcionalidad ya está entera: nadie más va a pasar por el cierre.
		cerrarPadreSiProcede(conexion, revision, tarea.padreId);
		return tarea;
	});
}
