import type { DatabaseSync } from "node:sqlite";
import { entero, sentencia, texto, textoOpcional } from "./base.ts";
import type { Fase } from "./tareas.ts";

/**
 * Lo que acota un informe: un proyecto, o todos en la vista cruzada, y desde
 * cuándo. `desde` es una fecha ISO 8601 UTC; sin ella el informe mira todo lo
 * que hay. El tipo `funcionalidad` queda fuera de todas las tablas: no se
 * ejecuta ni consume, y las de flujo son de tareas y partes.
 */
export type FiltroInforme = {
	proyectoId?: number;
	desde?: string;
};

/** Una fila de «¿Qué cuesta cada modelo?». */
export type CosteModelo = {
	fase: Fase;
	modelo: string;
	tareas: number;
	tokens: number;
	tokensPorTarea: number;
	herramientasPorTarea: number;
	duracionMediaMs: number;
};

/** Una fila de «¿Cuánto interrumpe cada modelo?». */
export type InterrupcionModelo = {
	modelo: string;
	preguntas: number;
	/** Tareas distintas en las que hay consumo suyo. Sin consumo, cero. */
	tareas: number;
	/** Nulo cuando no trabajó ninguna tarea: dividir entre cero no dice nada. */
	preguntasPorTarea: number | null;
};

/** Una fila de «¿Dónde se atasca el flujo?». */
export type CicloModelo = {
	/** El modelo de ejecución de la tarea, o nulo si nunca se le asignó ninguno. */
	modelo: string | null;
	tareas: number;
	/** Mediana del tiempo de ciclo, en milisegundos. */
	cicloMs: number;
	/** Mediana del tiempo de revisión; nula si ninguna llegó a `finished`. */
	revisionMs: number | null;
};

/** Una fila de «¿Qué modelo entrega resultados que no valen?». */
export type DevolucionModelo = {
	modelo: string | null;
	entradas: number;
	devoluciones: number;
	/** Devoluciones entre entradas; nula sin entradas en el periodo. */
	tasa: number | null;
};

/** Una semana del ritmo: `2026-W37` y cuántas tareas llegaron a `done`. */
export type SemanaRitmo = {
	semana: string;
	tareas: number;
};

/** Un día del ritmo: `2026-09-17` y cuántas tareas llegaron a `done` ese día. */
export type DiaRitmo = {
	dia: string;
	tareas: number;
};

// --- el filtro compartido ----------------------------------------------------

/**
 * El `WHERE` común a todas las tablas: fuera las funcionalidades, dentro el
 * proyecto si lo hay y el periodo si lo hay. Se compone aquí para que cada
 * informe siga siendo una sola sentencia y no haya cuatro copias del mismo
 * criterio; `alias` es el de `tareas` y `fecha` la columna que fecha el dato.
 */
function acotar(alias: string, fecha: string, filtro: FiltroInforme): { sql: string; params: (string | number)[] } {
	const trozos = [`${alias}.tipo <> 'funcionalidad'`];
	const params: (string | number)[] = [];
	if (filtro.proyectoId !== undefined) {
		trozos.push(`${alias}.proyecto_id = ?`);
		params.push(filtro.proyectoId);
	}
	if (filtro.desde !== undefined) {
		trozos.push(`${fecha} >= ?`);
		params.push(filtro.desde);
	}
	return { sql: trozos.join(" AND "), params };
}

/** Un número que puede traer decimales: las medias y las tasas. */
function real(fila: Record<string, unknown>, columna: string): number {
	const valor = fila[columna];
	if (typeof valor === "bigint") {
		return Number(valor);
	}
	return typeof valor === "number" ? valor : 0;
}

function realOpcional(fila: Record<string, unknown>, columna: string): number | null {
	const valor = fila[columna];
	return valor === null || valor === undefined ? null : real(fila, columna);
}

// --- 1. ¿Qué cuesta cada modelo? ---------------------------------------------

/**
 * Lo gastado por fase y modelo. Las medias se dividen entre tareas distintas y
 * no entre filas de consumo: una fase retomada tres veces sigue siendo una
 * tarea, y contarla tres veces abarataría al modelo que más se atasca.
 */
export function costePorModelo(db: DatabaseSync, filtro: FiltroInforme = {}): CosteModelo[] {
	const donde = acotar("t", "c.creado", filtro);
	return sentencia(
		db,
		`SELECT c.fase AS fase, c.modelo AS modelo,
				COUNT(DISTINCT c.tarea_id) AS tareas,
				SUM(c.tokens) AS tokens,
				SUM(c.tokens) * 1.0 / COUNT(DISTINCT c.tarea_id) AS tokens_por_tarea,
				SUM(c.herramientas) * 1.0 / COUNT(DISTINCT c.tarea_id) AS herramientas_por_tarea,
				AVG(c.duracion_ms) AS duracion_media
			FROM consumo c JOIN tareas t ON t.id = c.tarea_id
			WHERE ${donde.sql}
			GROUP BY c.fase, c.modelo
			ORDER BY c.fase, tokens DESC`,
	)
		.all(...donde.params)
		.map((fila) => ({
			fase: texto(fila, "fase") === "analisis" ? ("analisis" as const) : ("ejecucion" as const),
			modelo: texto(fila, "modelo"),
			tareas: entero(fila, "tareas"),
			tokens: entero(fila, "tokens"),
			tokensPorTarea: real(fila, "tokens_por_tarea"),
			herramientasPorTarea: real(fila, "herramientas_por_tarea"),
			duracionMediaMs: real(fila, "duracion_media"),
		}));
}

// --- 2. ¿Cuánto interrumpe cada modelo? --------------------------------------

/**
 * Preguntas por tarea trabajada. El modelo sale del autor del comentario
 * (`modelo@terminal`), que es donde está escrito quién preguntó; las tareas,
 * del consumo, que es lo único que dice en qué trabajó de verdad.
 *
 * Un modelo que pregunta sin haber reportado consumo aparece con cero tareas y
 * el ratio a nulo: preguntó, y eso se ve, pero no hay entre qué dividir.
 */
export function interrupcionesPorModelo(db: DatabaseSync, filtro: FiltroInforme = {}): InterrupcionModelo[] {
	const preguntas = acotar("t", "m.creado", filtro);
	const trabajo = acotar("t", "k.creado", filtro);
	return sentencia(
		db,
		`WITH preguntadas AS (
				SELECT substr(m.autor, 1, instr(m.autor, '@') - 1) AS modelo, COUNT(*) AS preguntas
					FROM comentarios m JOIN tareas t ON t.id = m.tarea_id
					WHERE m.tipo = 'pregunta' AND instr(m.autor, '@') > 1 AND ${preguntas.sql}
					GROUP BY 1
			),
			trabajadas AS (
				SELECT k.modelo AS modelo, COUNT(DISTINCT k.tarea_id) AS tareas
					FROM consumo k JOIN tareas t ON t.id = k.tarea_id
					WHERE ${trabajo.sql}
					GROUP BY 1
			),
			modelos AS (SELECT modelo FROM preguntadas UNION SELECT modelo FROM trabajadas)
			SELECT m.modelo AS modelo,
				COALESCE(p.preguntas, 0) AS preguntas,
				COALESCE(w.tareas, 0) AS tareas,
				CASE WHEN COALESCE(w.tareas, 0) = 0 THEN NULL
					ELSE COALESCE(p.preguntas, 0) * 1.0 / w.tareas END AS por_tarea
			FROM modelos m
			LEFT JOIN preguntadas p ON p.modelo = m.modelo
			LEFT JOIN trabajadas w ON w.modelo = m.modelo
			ORDER BY preguntas DESC, m.modelo`,
	)
		.all(...preguntas.params, ...trabajo.params)
		.map((fila) => ({
			modelo: texto(fila, "modelo"),
			preguntas: entero(fila, "preguntas"),
			tareas: entero(fila, "tareas"),
			preguntasPorTarea: realOpcional(fila, "por_tarea"),
		}));
}

// --- 3. ¿Dónde se atasca el flujo? -------------------------------------------

/** Una entrada en `done`, con lo que tardó en llegar y lo que tardó en revisarse. */
type EntradaEnDone = {
	modelo: string | null;
	cicloMs: number;
	revisionMs: number | null;
};

/**
 * Mediana de una lista, redondeada al milisegundo. Con un número par de
 * valores es la media de los dos centrales. Lista vacía, nulo.
 *
 * Se calcula aquí y no en SQL porque en SQLite una mediana por grupo son dos
 * subconsultas correlacionadas con `LIMIT/OFFSET` sobre el recuento; sobre las
 * filas que devuelve la consulta es una línea y se lee.
 */
function mediana(valores: number[]): number | null {
	if (valores.length === 0) {
		return null;
	}
	const orden = [...valores].sort((uno, otro) => uno - otro);
	const medio = Math.floor(orden.length / 2);
	const valor = orden.length % 2 === 1 ? (orden[medio] ?? 0) : ((orden[medio - 1] ?? 0) + (orden[medio] ?? 0)) / 2;
	return Math.round(valor);
}

/**
 * Tiempo de ciclo y tiempo de revisión medianos por modelo de ejecución. El
 * ciclo va de la primera entrada en `prepared` a esa entrada en `done`; si la
 * tarea nunca pasó por `prepared` (una hija de trabajo nace en `doing`), se
 * cuenta desde que se creó. La revisión va de esa `done` a la `finished`
 * siguiente, y solo cuenta en las que ya la tienen.
 *
 * El periodo acota por la fecha de la entrada en `done`, que es lo que decide
 * qué tareas entran en la tabla; los dos tiempos pueden empezar antes.
 */
export function ciclo(db: DatabaseSync, filtro: FiltroInforme = {}): CicloModelo[] {
	const donde = acotar("t", "d.creado", filtro);
	const filas: EntradaEnDone[] = sentencia(
		db,
		`SELECT t.ejecucion_modelo AS modelo,
				CAST(ROUND((julianday(d.creado) - julianday(COALESCE(p.primera, t.creada))) * 86400000) AS INTEGER) AS ciclo_ms,
				CAST(ROUND((julianday((
					SELECT MIN(f.creado) FROM transiciones f
						WHERE f.tarea_id = d.tarea_id AND f.a = 'finished' AND f.creado >= d.creado
				)) - julianday(d.creado)) * 86400000) AS INTEGER) AS revision_ms
			FROM transiciones d
			JOIN tareas t ON t.id = d.tarea_id
			LEFT JOIN (
				SELECT tarea_id, MIN(creado) AS primera FROM transiciones WHERE a = 'prepared' GROUP BY tarea_id
			) p ON p.tarea_id = d.tarea_id
			WHERE d.a = 'done' AND ${donde.sql}`,
	)
		.all(...donde.params)
		.map((fila) => ({
			modelo: textoOpcional(fila, "modelo"),
			cicloMs: Math.max(0, real(fila, "ciclo_ms")),
			revisionMs: realOpcional(fila, "revision_ms"),
		}));

	const porModelo = new Map<string | null, EntradaEnDone[]>();
	for (const fila of filas) {
		const cual = porModelo.get(fila.modelo);
		if (cual === undefined) {
			porModelo.set(fila.modelo, [fila]);
		} else {
			cual.push(fila);
		}
	}

	return [...porModelo.entries()]
		.map(([modelo, suyas]) => ({
			modelo,
			tareas: suyas.length,
			cicloMs: mediana(suyas.map((fila) => fila.cicloMs)) ?? 0,
			revisionMs: mediana(suyas.flatMap((fila) => (fila.revisionMs === null ? [] : [fila.revisionMs]))),
		}))
		.sort((uno, otro) => otro.cicloMs - uno.cicloMs);
}

// --- 4. ¿Qué modelo entrega resultados que no valen? -------------------------

/**
 * Entradas en `done` y vueltas atrás por modelo de ejecución. Una tarea
 * devuelta dos veces cuenta dos: lo que se mide es cuántas veces hubo que
 * repetir el trabajo, no a cuántas tareas les pasó.
 */
export function devoluciones(db: DatabaseSync, filtro: FiltroInforme = {}): DevolucionModelo[] {
	const donde = acotar("t", "tr.creado", filtro);
	return sentencia(
		db,
		`SELECT t.ejecucion_modelo AS modelo,
				SUM(CASE WHEN tr.a = 'done' THEN 1 ELSE 0 END) AS entradas,
				SUM(CASE WHEN tr.a = 'doing' AND tr.de = 'done' THEN 1 ELSE 0 END) AS devueltas,
				CASE WHEN SUM(CASE WHEN tr.a = 'done' THEN 1 ELSE 0 END) = 0 THEN NULL
					ELSE SUM(CASE WHEN tr.a = 'doing' AND tr.de = 'done' THEN 1 ELSE 0 END) * 1.0
						/ SUM(CASE WHEN tr.a = 'done' THEN 1 ELSE 0 END) END AS tasa
			FROM transiciones tr JOIN tareas t ON t.id = tr.tarea_id
			WHERE (tr.a = 'done' OR (tr.a = 'doing' AND tr.de = 'done')) AND ${donde.sql}
			GROUP BY t.ejecucion_modelo
			ORDER BY devueltas DESC, entradas DESC`,
	)
		.all(...donde.params)
		.map((fila) => ({
			modelo: textoOpcional(fila, "modelo"),
			entradas: entero(fila, "entradas"),
			devoluciones: entero(fila, "devueltas"),
			tasa: realOpcional(fila, "tasa"),
		}));
}

// --- el ritmo ----------------------------------------------------------------

/**
 * Cuántas tareas llegaron a `done` cada semana del periodo. La semana va como
 * `2026-W37`, que ordena por sí sola y no necesita otra columna para hacerlo.
 */
export function ritmo(db: DatabaseSync, filtro: FiltroInforme = {}): SemanaRitmo[] {
	const donde = acotar("t", "tr.creado", filtro);
	return sentencia(
		db,
		`SELECT strftime('%Y-W%W', tr.creado) AS semana, COUNT(*) AS tareas
			FROM transiciones tr JOIN tareas t ON t.id = tr.tarea_id
			WHERE tr.a = 'done' AND ${donde.sql}
			GROUP BY semana
			ORDER BY semana`,
	)
		.all(...donde.params)
		.map((fila) => ({ semana: texto(fila, "semana"), tareas: entero(fila, "tareas") }));
}

/** Cuántos días enseña el ritmo diario. Es la ventana de Paperclip: dos semanas. */
const DIAS_DEL_RITMO = 14;

/**
 * Cuántas tareas llegaron a `done` cada uno de los últimos catorce días, hoy
 * incluido y en UTC, con los días vacíos a cero: una serie con huecos no se lee
 * como una serie. La ventana es fija, así que del filtro solo usa el proyecto;
 * el periodo elegido decide si se llama a esta o a `ritmo`, no cuánto abarca.
 */
export function ritmoPorDia(db: DatabaseSync, filtro: FiltroInforme = {}): DiaRitmo[] {
	const donde = acotar("t", "tr.creado", { proyectoId: filtro.proyectoId });
	return sentencia(
		db,
		`WITH RECURSIVE dias(dia) AS (
				SELECT date('now', '-${DIAS_DEL_RITMO - 1} days')
				UNION ALL
				SELECT date(dia, '+1 day') FROM dias WHERE dia < date('now')
			),
			hechas AS (
				SELECT date(tr.creado) AS dia, COUNT(*) AS tareas
					FROM transiciones tr JOIN tareas t ON t.id = tr.tarea_id
					WHERE tr.a = 'done' AND ${donde.sql}
					GROUP BY dia
			)
			SELECT d.dia AS dia, COALESCE(h.tareas, 0) AS tareas
				FROM dias d LEFT JOIN hechas h ON h.dia = d.dia
				ORDER BY d.dia`,
	)
		.all(...donde.params)
		.map((fila) => ({ dia: texto(fila, "dia"), tareas: entero(fila, "tareas") }));
}

/**
 * Desde cuándo hay datos: la transición más antigua registrada, o nulo si la
 * tabla sigue vacía. Es lo que el pie de los informes dice al humano para que
 * no lea como un cero lo que es «todavía no lo sabíamos».
 */
export function primeraTransicion(db: DatabaseSync): string | null {
	const fila = sentencia(db, "SELECT MIN(creado) AS creado FROM transiciones").get();
	return fila === undefined ? null : textoOpcional(fila, "creado");
}
