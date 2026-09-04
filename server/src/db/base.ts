import type { DatabaseSync, StatementSync } from "node:sqlite";

/** Valor devuelto por `enTransaccionConRevision`: lo que produjo la función y la nueva revisión. */
export type ConRevision<T> = {
	valor: T;
	revision: number;
};

// --- sentencias y lectura de filas -------------------------------------------

/**
 * Caché de sentencias preparadas por base de datos. Prepararlas una sola vez
 * es la razón de usar SQL a mano en vez de un ORM.
 */
const cacheSentencias = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

export function sentencia(db: DatabaseSync, sql: string): StatementSync {
	let porBase = cacheSentencias.get(db);
	if (porBase === undefined) {
		porBase = new Map();
		cacheSentencias.set(db, porBase);
	}
	let preparada = porBase.get(sql);
	if (preparada === undefined) {
		preparada = db.prepare(sql);
		porBase.set(sql, preparada);
	}
	return preparada;
}

export function texto(fila: Record<string, unknown>, columna: string): string {
	const valor = fila[columna];
	if (typeof valor !== "string") {
		throw new Error(`la columna ${columna} no es texto`);
	}
	return valor;
}

export function textoOpcional(fila: Record<string, unknown>, columna: string): string | null {
	const valor = fila[columna];
	if (valor === null || valor === undefined) {
		return null;
	}
	if (typeof valor !== "string") {
		throw new Error(`la columna ${columna} no es texto`);
	}
	return valor;
}

export function entero(fila: Record<string, unknown>, columna: string): number {
	const valor = fila[columna];
	if (typeof valor === "number") {
		return valor;
	}
	if (typeof valor === "bigint") {
		return Number(valor);
	}
	throw new Error(`la columna ${columna} no es un entero`);
}

export function enteroOpcional(fila: Record<string, unknown>, columna: string): number | null {
	const valor = fila[columna];
	if (valor === null || valor === undefined) {
		return null;
	}
	return entero(fila, columna);
}

/** SQLite no tiene booleanos: se guardan como 0 o 1 con un CHECK. */
export function booleano(fila: Record<string, unknown>, columna: string): boolean {
	return entero(fila, columna) !== 0;
}

export function idInsertado(valor: number | bigint): number {
	return typeof valor === "bigint" ? Number(valor) : valor;
}

/** Fecha actual en ISO 8601 UTC, el formato en el que se guardan todas las fechas. */
export function ahora(): string {
	return new Date().toISOString();
}

// --- revisión ----------------------------------------------------------------

/** Revisión global actual del servidor. */
export function revisionActual(db: DatabaseSync): number {
	const fila = sentencia(db, "SELECT valor FROM revision WHERE id = 1").get();
	if (fila === undefined) {
		throw new Error("la tabla revision no tiene la fila 1");
	}
	return entero(fila, "valor");
}

/**
 * Revisión con la que quedará marcada la escritura en curso. Solo tiene
 * sentido dentro de `enTransaccionConRevision`: como la transacción es
 * `IMMEDIATE`, nadie más puede mover el contador mientras tanto, así que la
 * actual más uno es exactamente la que quedará al confirmar.
 */
export function revisionEnCurso(db: DatabaseSync): number {
	return revisionActual(db) + 1;
}

/**
 * Transacción simple, sin tocar el contador de revisión. Es la que usan las
 * escrituras de telemetría de los terminales.
 */
export function enTransaccion<T>(db: DatabaseSync, fn: (db: DatabaseSync) => T): T {
	db.exec("BEGIN IMMEDIATE");
	try {
		const valor = fn(db);
		db.exec("COMMIT");
		return valor;
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

/**
 * Envuelve una escritura de contenido: la ejecuta en una transacción que
 * además sube el contador de revisión global. Contenido son tareas,
 * comentarios, preguntas, respuestas, consumo, y altas o revocaciones de
 * usuarios y terminales. La telemetría de los terminales NO pasa por aquí
 * (ver «Señal de novedad» en CLAUDE.md).
 */
export function enTransaccionConRevision<T>(db: DatabaseSync, fn: (db: DatabaseSync) => T): ConRevision<T> {
	db.exec("BEGIN IMMEDIATE");
	try {
		const valor = fn(db);
		sentencia(db, "UPDATE revision SET valor = valor + 1 WHERE id = 1").run();
		const revision = revisionActual(db);
		db.exec("COMMIT");
		return { valor, revision };
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

/**
 * Escritura de contenido que además necesita dejar la revisión resultante en
 * la fila que cambia (`tareas.revision`, `preguntas.revision`). Pasa a la
 * función la conexión ya en transacción y el número de revisión que va a
 * quedar. Devuelve solo el valor: la revisión ya viaja dentro de la fila.
 */
export function escribirContenido<T>(db: DatabaseSync, fn: (db: DatabaseSync, revision: number) => T): T {
	return enTransaccionConRevision(db, (conexion) => fn(conexion, revisionEnCurso(conexion))).valor;
}
