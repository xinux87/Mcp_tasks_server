import type { DatabaseSync } from "node:sqlite";
import { ErrorDeRegla } from "../errores.ts";
import { type Actor, registrarActividad } from "./actividad.ts";
import {
	ahora,
	type ConRevision,
	enTransaccion,
	enTransaccionConRevision,
	entero,
	enteroOpcional,
	idInsertado,
	sentencia,
	texto,
	textoOpcional,
} from "./base.ts";
import { type ColorUsuario, colorElegido, esColorUsuario } from "./colores.ts";
import { exigirProyectoPorId, normalizarRepositorio, PROYECTO_PRINCIPAL, type Proyecto } from "./proyectos.ts";

// Los helpers compartidos viven en `base.ts` para que los usen también
// `tareas.ts`, `hilo.ts` y `consumo.ts`. Se reexportan desde aquí porque este
// es el módulo por el que entra el resto del servidor.
export { ahora, type ConRevision, enTransaccion, enTransaccionConRevision, revisionActual } from "./base.ts";

export type Usuario = {
	id: number;
	nombre: string;
	hashPassword: string;
	/** Uno de los ocho colores de etiqueta. Es de la web: el MCP no lo enseña. */
	color: ColorUsuario;
	creado: string;
};

export type Terminal = {
	id: number;
	usuarioId: number;
	/** Un terminal es de un solo proyecto: se elige en el alta y no se cambia. */
	proyectoId: number;
	nombre: string;
	cuenta: string;
	/** La carpeta local en la que trabaja, tal como la reportó al registrarse. */
	ruta: string | null;
	tokenHash: string;
	/** Cuántos subagentes lanza a la vez su bucle. Lo respeta el bucle, no el servidor. */
	agentes: number;
	conectadoEn: string | null;
	ultimaRevision: number | null;
	usoJson: string | null;
	creado: string;
	revocadoEn: string | null;
};

// --- mapeadores de fila ------------------------------------------------------

function comoColor(fila: Record<string, unknown>): ColorUsuario {
	const valor = texto(fila, "color");
	if (!esColorUsuario(valor)) {
		throw new Error(`color de usuario desconocido en la base de datos: ${valor}`);
	}
	return valor;
}

/** Las columnas de un usuario. Las comparte todo el que lee la tabla. */
export const COLUMNAS_USUARIO = "id, nombre, hash_password, color, creado";

export function comoUsuario(fila: Record<string, unknown>): Usuario {
	return {
		id: entero(fila, "id"),
		nombre: texto(fila, "nombre"),
		hashPassword: texto(fila, "hash_password"),
		color: comoColor(fila),
		creado: texto(fila, "creado"),
	};
}

function comoTerminal(fila: Record<string, unknown>): Terminal {
	return {
		id: entero(fila, "id"),
		usuarioId: entero(fila, "usuario_id"),
		proyectoId: entero(fila, "proyecto_id"),
		nombre: texto(fila, "nombre"),
		cuenta: texto(fila, "cuenta"),
		ruta: textoOpcional(fila, "ruta"),
		tokenHash: texto(fila, "token_hash"),
		agentes: entero(fila, "agentes"),
		conectadoEn: textoOpcional(fila, "conectado_en"),
		ultimaRevision: enteroOpcional(fila, "ultima_revision"),
		usoJson: textoOpcional(fila, "uso_json"),
		creado: texto(fila, "creado"),
		revocadoEn: textoOpcional(fila, "revocado_en"),
	};
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
	const fila = sentencia(db, `SELECT ${COLUMNAS_USUARIO} FROM usuarios WHERE nombre = ?`).get(nombre);
	return fila === undefined ? undefined : comoUsuario(fila);
}

export function buscarUsuarioPorId(db: DatabaseSync, id: number): Usuario | undefined {
	const fila = sentencia(db, `SELECT ${COLUMNAS_USUARIO} FROM usuarios WHERE id = ?`).get(id);
	return fila === undefined ? undefined : comoUsuario(fila);
}

export type OpcionesUsuario = {
	/** Sin color se reparte el menos usado. Uno que no exista es un error de regla. */
	color?: string;
	/** Sin actor no se escribe actividad: es lo que hacen los tests y las bases de prueba. */
	actor?: Actor;
};

/** Crea un usuario. Sube la revisión. */
export function crearUsuario(
	db: DatabaseSync,
	nombre: string,
	hashPassword: string,
	opciones: OpcionesUsuario = {},
): ConRevision<Usuario> {
	return enTransaccionConRevision(db, (conexion) => {
		const color = colorElegido(conexion, opciones.color);
		const cambios = sentencia(
			conexion,
			"INSERT INTO usuarios (nombre, hash_password, color, creado) VALUES (?, ?, ?, ?)",
		).run(nombre, hashPassword, color, ahora());
		const id = idInsertado(cambios.lastInsertRowid);
		const creado = buscarUsuarioPorId(conexion, id);
		if (creado === undefined) {
			throw new Error("no se pudo releer el usuario recién creado");
		}
		if (opciones.actor !== undefined) {
			registrarActividad(conexion, {
				actor: opciones.actor,
				accion: "alta_usuario",
				objeto: "usuario",
				objetoId: creado.id,
				objetoNombre: creado.nombre,
				detalle: `color ${creado.color}`,
			});
		}
		return creado;
	});
}

// --- terminales --------------------------------------------------------------

const COLUMNAS_TERMINAL =
	"id, usuario_id, proyecto_id, nombre, cuenta, ruta, token_hash, agentes, conectado_en, ultima_revision, uso_json, creado, revocado_en";

export function buscarTerminalPorId(db: DatabaseSync, id: number): Terminal | undefined {
	const fila = sentencia(db, `SELECT ${COLUMNAS_TERMINAL} FROM terminales WHERE id = ?`).get(id);
	return fila === undefined ? undefined : comoTerminal(fila);
}

/** Busca un terminal activo (no revocado) por su nombre. Lo usa el CLI. */
export function buscarTerminalPorNombre(db: DatabaseSync, nombre: string): Terminal | undefined {
	const fila = sentencia(db, `SELECT ${COLUMNAS_TERMINAL} FROM terminales WHERE nombre = ? AND revocado_en IS NULL`).get(
		nombre,
	);
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
	actor?: Actor,
	/** Ya validado por quien llama. Sin él, el de siempre: un subagente por vuelta. */
	agentes = 1,
	/** Un terminal es de un solo proyecto. Sin decir otro, el principal. */
	proyectoId = PROYECTO_PRINCIPAL,
): ConRevision<Terminal> {
	return enTransaccionConRevision(db, (conexion) => {
		const cambios = sentencia(
			conexion,
			`INSERT INTO terminales (usuario_id, proyecto_id, nombre, cuenta, token_hash, agentes, creado)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
		).run(usuarioId, proyectoId, nombre, cuenta, tokenHash, agentes, ahora());
		const id = idInsertado(cambios.lastInsertRowid);
		const creado = buscarTerminalPorId(conexion, id);
		if (creado === undefined) {
			throw new Error("no se pudo releer el terminal recién creado");
		}
		if (actor !== undefined) {
			const dueno = buscarUsuarioPorId(conexion, usuarioId);
			registrarActividad(conexion, {
				actor,
				accion: "alta_terminal",
				objeto: "terminal",
				objetoId: creado.id,
				objetoNombre: creado.nombre,
				detalle: `cuenta ${creado.cuenta}, de ${dueno?.nombre ?? usuarioId}`,
			});
		}
		return creado;
	});
}

/**
 * Marca el terminal como conectado ahora.
 *
 * Es telemetría: no sube la revisión. Si la subiera, cada arranque de sesión
 * de cualquier terminal sería una novedad para todos los demás y la señal
 * dejaría de significar nada.
 */
export function marcarTerminalConectado(db: DatabaseSync, terminalId: number): Terminal {
	return registrarTerminal(db, terminalId, {}).terminal;
}

export type RegistroDeTerminal = {
	/** La carpeta local del bucle. Se guarda tal cual: es informativa. */
	ruta?: string | null;
	/** La URL del remote de git, si el bucle trabaja en un repositorio. */
	repositorio?: string | null;
};

/** Lo que el terminal necesita saber de su proyecto al arrancar la sesión. */
export type TerminalRegistrado = {
	terminal: Terminal;
	proyecto: Proyecto;
};

/**
 * `registrar_terminal`: marca el terminal como conectado, guarda la carpeta en
 * la que trabaja y comprueba que sea el repositorio del proyecto.
 *
 * Si el proyecto tiene repositorio y el terminal reporta otro, la sesión se
 * para aquí (`proyecto_no_coincide`) sin marcarlo conectado: seguir sería
 * dejar que un terminal tomara tareas de un repositorio que no tiene delante.
 * Si alguno de los dos no tiene repositorio, no se comprueba nada.
 *
 * Es telemetría: no sube la revisión, como el resto de lo que escribe el bucle
 * mientras espera.
 */
export function registrarTerminal(db: DatabaseSync, terminalId: number, datos: RegistroDeTerminal): TerminalRegistrado {
	return enTransaccion(db, (conexion) => {
		const antes = buscarTerminalPorId(conexion, terminalId);
		if (antes === undefined) {
			throw new Error(`no existe el terminal ${terminalId}`);
		}
		const proyecto = exigirProyectoPorId(conexion, antes.proyectoId);
		const reportado = normalizarRepositorio(datos.repositorio);
		if (proyecto.repositorio !== null && reportado !== null && proyecto.repositorio !== reportado) {
			throw new ErrorDeRegla(
				"proyecto_no_coincide",
				`El proyecto ${proyecto.clave} trabaja en ${proyecto.repositorio} y este terminal está en ${reportado}.`,
			);
		}
		sentencia(conexion, "UPDATE terminales SET conectado_en = ?, ruta = COALESCE(?, ruta) WHERE id = ?").run(
			ahora(),
			datos.ruta?.trim() === "" ? null : (datos.ruta ?? null),
			terminalId,
		);
		const terminal = buscarTerminalPorId(conexion, terminalId);
		if (terminal === undefined) {
			throw new Error(`no existe el terminal ${terminalId}`);
		}
		return { terminal, proyecto };
	});
}

/**
 * Guarda la última revisión que el terminal dice conocer.
 *
 * Es telemetría: no sube la revisión. `novedades` es de solo lectura respecto
 * al contador, así que dos vueltas seguidas del bucle sin escrituras de
 * contenido devuelven la misma revisión.
 */
export function guardarUltimaRevision(db: DatabaseSync, terminalId: number, revision: number): Terminal {
	return enTransaccion(db, (conexion) => {
		sentencia(conexion, "UPDATE terminales SET ultima_revision = ? WHERE id = ?").run(revision, terminalId);
		const terminal = buscarTerminalPorId(conexion, terminalId);
		if (terminal === undefined) {
			throw new Error(`no existe el terminal ${terminalId}`);
		}
		return terminal;
	});
}

/**
 * Guarda el JSON de la statusline tal como llegó por `POST /api/uso`. El
 * servidor no lo interpreta: solo lo recibe y lo enseña en la web.
 *
 * Es telemetría: no sube la revisión. La statusline escribe cada minuto en cada
 * terminal, y si eso moviera el contador cada vuelta del bucle de cualquiera
 * sería una novedad para todos.
 */
export function guardarUso(db: DatabaseSync, terminalId: number, json: string): Terminal {
	return enTransaccion(db, (conexion) => {
		sentencia(conexion, "UPDATE terminales SET uso_json = ? WHERE id = ?").run(json, terminalId);
		const terminal = buscarTerminalPorId(conexion, terminalId);
		if (terminal === undefined) {
			throw new Error(`no existe el terminal ${terminalId}`);
		}
		return terminal;
	});
}
