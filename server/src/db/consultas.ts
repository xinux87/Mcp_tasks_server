import type { DatabaseSync, StatementSync } from "node:sqlite";

export type Usuario = {
	id: number;
	nombre: string;
	hashPassword: string;
	creado: string;
};

export type Terminal = {
	id: number;
	usuarioId: number;
	nombre: string;
	cuenta: string;
	tokenHash: string;
	conectadoEn: string | null;
	ultimaRevision: number | null;
	usoJson: string | null;
	creado: string;
	revocadoEn: string | null;
};

/** Valor devuelto por `enTransaccionConRevision`: lo que produjo la función y la nueva revisión. */
export type ConRevision<T> = {
	valor: T;
	revision: number;
};

// --- utilidades internas -----------------------------------------------------

/**
 * Caché de sentencias preparadas por base de datos. Prepararlas una sola vez
 * es la razón de usar SQL a mano en vez de un ORM.
 */
const cacheSentencias = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

function sentencia(db: DatabaseSync, sql: string): StatementSync {
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

function texto(fila: Record<string, unknown>, columna: string): string {
	const valor = fila[columna];
	if (typeof valor !== "string") {
		throw new Error(`la columna ${columna} no es texto`);
	}
	return valor;
}

function textoOpcional(fila: Record<string, unknown>, columna: string): string | null {
	const valor = fila[columna];
	if (valor === null || valor === undefined) {
		return null;
	}
	if (typeof valor !== "string") {
		throw new Error(`la columna ${columna} no es texto`);
	}
	return valor;
}

function entero(fila: Record<string, unknown>, columna: string): number {
	const valor = fila[columna];
	if (typeof valor === "number") {
		return valor;
	}
	if (typeof valor === "bigint") {
		return Number(valor);
	}
	throw new Error(`la columna ${columna} no es un entero`);
}

function enteroOpcional(fila: Record<string, unknown>, columna: string): number | null {
	const valor = fila[columna];
	if (valor === null || valor === undefined) {
		return null;
	}
	return entero(fila, columna);
}

function comoUsuario(fila: Record<string, unknown>): Usuario {
	return {
		id: entero(fila, "id"),
		nombre: texto(fila, "nombre"),
		hashPassword: texto(fila, "hash_password"),
		creado: texto(fila, "creado"),
	};
}

function comoTerminal(fila: Record<string, unknown>): Terminal {
	return {
		id: entero(fila, "id"),
		usuarioId: entero(fila, "usuario_id"),
		nombre: texto(fila, "nombre"),
		cuenta: texto(fila, "cuenta"),
		tokenHash: texto(fila, "token_hash"),
		conectadoEn: textoOpcional(fila, "conectado_en"),
		ultimaRevision: enteroOpcional(fila, "ultima_revision"),
		usoJson: textoOpcional(fila, "uso_json"),
		creado: texto(fila, "creado"),
		revocadoEn: textoOpcional(fila, "revocado_en"),
	};
}

function idInsertado(valor: number | bigint): number {
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
 * Envuelve una escritura que cambia estado visible: la ejecuta en una
 * transacción que además sube el contador de revisión global. Toda escritura
 * de ese tipo tiene que pasar por aquí (ver «Señal de novedad» en CLAUDE.md).
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

// --- usuarios ----------------------------------------------------------------

export function contarUsuarios(db: DatabaseSync): number {
	const fila = sentencia(db, "SELECT COUNT(*) AS total FROM usuarios").get();
	if (fila === undefined) {
		throw new Error("COUNT(*) no devolvió ninguna fila");
	}
	return entero(fila, "total");
}

export function buscarUsuarioPorNombre(db: DatabaseSync, nombre: string): Usuario | undefined {
	const fila = sentencia(db, "SELECT id, nombre, hash_password, creado FROM usuarios WHERE nombre = ?").get(nombre);
	return fila === undefined ? undefined : comoUsuario(fila);
}

export function buscarUsuarioPorId(db: DatabaseSync, id: number): Usuario | undefined {
	const fila = sentencia(db, "SELECT id, nombre, hash_password, creado FROM usuarios WHERE id = ?").get(id);
	return fila === undefined ? undefined : comoUsuario(fila);
}

/** Crea un usuario. Sube la revisión. */
export function crearUsuario(db: DatabaseSync, nombre: string, hashPassword: string): ConRevision<Usuario> {
	return enTransaccionConRevision(db, (conexion) => {
		const cambios = sentencia(conexion, "INSERT INTO usuarios (nombre, hash_password, creado) VALUES (?, ?, ?)").run(
			nombre,
			hashPassword,
			ahora(),
		);
		const id = idInsertado(cambios.lastInsertRowid);
		const creado = buscarUsuarioPorId(conexion, id);
		if (creado === undefined) {
			throw new Error("no se pudo releer el usuario recién creado");
		}
		return creado;
	});
}

// --- terminales --------------------------------------------------------------

const COLUMNAS_TERMINAL =
	"id, usuario_id, nombre, cuenta, token_hash, conectado_en, ultima_revision, uso_json, creado, revocado_en";

export function buscarTerminalPorId(db: DatabaseSync, id: number): Terminal | undefined {
	const fila = sentencia(db, `SELECT ${COLUMNAS_TERMINAL} FROM terminales WHERE id = ?`).get(id);
	return fila === undefined ? undefined : comoTerminal(fila);
}

/** Busca un terminal activo (no revocado) por el hash de su token. */
export function buscarTerminalPorTokenHash(db: DatabaseSync, tokenHash: string): Terminal | undefined {
	const fila = sentencia(
		db,
		`SELECT ${COLUMNAS_TERMINAL} FROM terminales WHERE token_hash = ? AND revocado_en IS NULL`,
	).get(tokenHash);
	return fila === undefined ? undefined : comoTerminal(fila);
}

/** Crea un terminal con el hash de su token ya calculado. Sube la revisión. */
export function crearTerminal(
	db: DatabaseSync,
	usuarioId: number,
	nombre: string,
	cuenta: string,
	tokenHash: string,
): ConRevision<Terminal> {
	return enTransaccionConRevision(db, (conexion) => {
		const cambios = sentencia(
			conexion,
			"INSERT INTO terminales (usuario_id, nombre, cuenta, token_hash, creado) VALUES (?, ?, ?, ?, ?)",
		).run(usuarioId, nombre, cuenta, tokenHash, ahora());
		const id = idInsertado(cambios.lastInsertRowid);
		const creado = buscarTerminalPorId(conexion, id);
		if (creado === undefined) {
			throw new Error("no se pudo releer el terminal recién creado");
		}
		return creado;
	});
}

/** Marca el terminal como conectado ahora. Sube la revisión. */
export function marcarTerminalConectado(db: DatabaseSync, terminalId: number): ConRevision<Terminal> {
	return enTransaccionConRevision(db, (conexion) => {
		sentencia(conexion, "UPDATE terminales SET conectado_en = ? WHERE id = ?").run(ahora(), terminalId);
		const terminal = buscarTerminalPorId(conexion, terminalId);
		if (terminal === undefined) {
			throw new Error(`no existe el terminal ${terminalId}`);
		}
		return terminal;
	});
}

/** Guarda la última revisión que el terminal dice conocer. Sube la revisión. */
export function guardarUltimaRevision(db: DatabaseSync, terminalId: number, revision: number): ConRevision<Terminal> {
	return enTransaccionConRevision(db, (conexion) => {
		sentencia(conexion, "UPDATE terminales SET ultima_revision = ? WHERE id = ?").run(revision, terminalId);
		const terminal = buscarTerminalPorId(conexion, terminalId);
		if (terminal === undefined) {
			throw new Error(`no existe el terminal ${terminalId}`);
		}
		return terminal;
	});
}
