import type { DatabaseSync } from "node:sqlite";
import { ahora, enTransaccionConRevision, entero, sentencia, texto } from "./base.ts";
import { exigirTarea, type Fase } from "./tareas.ts";

/** Lo gastado en una fase de la tarea, sumando todas las veces que se retomó. */
export type ConsumoFase = {
	/** Modelo de la fase. Si se retomó con otro, van los dos unidos con `+`. */
	modelo: string;
	tokens: number;
	herramientas: number;
	duracionMs: number;
};

export type ConsumoDeTarea = {
	analisis: ConsumoFase | null;
	ejecucion: ConsumoFase | null;
	/** Tokens de la tarea más los de todas sus descendientes. */
	totalConHijas: number;
};

export type NuevoConsumo = {
	tareaId: number;
	fase: Fase;
	modelo: string;
	terminalId: number;
	tokens: number;
	herramientas: number;
	duracionMs: number;
};

/**
 * `reportar_consumo`: lo que gastó un subagente de fase. La cifra viene de
 * Claude Code a través del plugin, nunca de una estimación del modelo.
 *
 * Es contenido, así que sube la revisión global, pero no toca la fila de la
 * tarea: el consumo no cambia nada de lo que el agente tiene que hacer, y
 * reescribir `tareas.revision` le devolvería su propia tarea como novedad en
 * la vuelta siguiente del bucle.
 */
export function registrarConsumo(db: DatabaseSync, datos: NuevoConsumo): ConsumoDeTarea {
	return enTransaccionConRevision(db, (conexion) => {
		exigirTarea(conexion, datos.tareaId);
		sentencia(
			conexion,
			`INSERT INTO consumo (tarea_id, fase, modelo, terminal_id, tokens, herramientas, duracion_ms, creado)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			datos.tareaId,
			datos.fase,
			datos.modelo,
			datos.terminalId,
			datos.tokens,
			datos.herramientas,
			datos.duracionMs,
			ahora(),
		);
		return consumoDeTarea(conexion, datos.tareaId);
	}).valor;
}

/**
 * Consumo propio de la tarea, desglosado por fase, y el total con hijas. La
 * ficha muestra los dos por separado: el propio dice lo que costó trabajarla,
 * el total lo que costó el árbol entero.
 */
export function consumoDeTarea(db: DatabaseSync, tareaId: number): ConsumoDeTarea {
	const porFase = new Map<Fase, ConsumoFase>();
	const filas = sentencia(
		db,
		`SELECT fase, modelo, SUM(tokens) AS tokens, SUM(herramientas) AS herramientas, SUM(duracion_ms) AS duracion_ms
			FROM consumo WHERE tarea_id = ? GROUP BY fase, modelo ORDER BY fase, modelo`,
	).all(tareaId);

	for (const fila of filas) {
		const fase: Fase = texto(fila, "fase") === "analisis" ? "analisis" : "ejecucion";
		const acumulado = porFase.get(fase);
		const modelo = texto(fila, "modelo");
		if (acumulado === undefined) {
			porFase.set(fase, {
				modelo,
				tokens: entero(fila, "tokens"),
				herramientas: entero(fila, "herramientas"),
				duracionMs: entero(fila, "duracion_ms"),
			});
			continue;
		}
		// Una fase retomada con otro modelo: se suman las cifras y se dejan
		// los dos nombres a la vista en vez de quedarse con uno solo.
		acumulado.modelo = `${acumulado.modelo}+${modelo}`;
		acumulado.tokens += entero(fila, "tokens");
		acumulado.herramientas += entero(fila, "herramientas");
		acumulado.duracionMs += entero(fila, "duracion_ms");
	}

	return {
		analisis: porFase.get("analisis") ?? null,
		ejecucion: porFase.get("ejecucion") ?? null,
		totalConHijas: totalConHijas(db, tareaId),
	};
}

/** Suma de tokens de la tarea y de todo lo que cuelga de ella, a cualquier profundidad. */
function totalConHijas(db: DatabaseSync, tareaId: number): number {
	const fila = sentencia(
		db,
		`WITH RECURSIVE arbol(id) AS (
				SELECT ?
				UNION
				SELECT t.id FROM tareas t JOIN arbol a ON t.padre_id = a.id
			)
			SELECT COALESCE(SUM(c.tokens), 0) AS tokens FROM consumo c JOIN arbol a ON c.tarea_id = a.id`,
	).get(tareaId);
	if (fila === undefined) {
		throw new Error("la suma de consumo no devolvió ninguna fila");
	}
	return entero(fila, "tokens");
}
