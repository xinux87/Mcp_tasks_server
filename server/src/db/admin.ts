import type { DatabaseSync } from "node:sqlite";
import { hashPassword, verificarPassword } from "../auth/passwords.ts";
import { crearTerminalConToken, type TerminalConToken } from "../auth/tokens.ts";
import { ErrorDeRegla } from "../errores.ts";
import { registrarActividad } from "./actividad.ts";
import {
	ahora,
	enTransaccion,
	enTransaccionConRevision,
	entero,
	enteroOpcional,
	sentencia,
	texto,
	textoOpcional,
} from "./base.ts";
import { colorElegido } from "./colores.ts";
import {
	buscarUsuarioPorId,
	buscarUsuarioPorNombre,
	COLUMNAS_USUARIO,
	comoUsuario,
	contarUsuarios,
	crearUsuario,
	type Usuario,
} from "./consultas.ts";

/**
 * Gestión de usuarios y terminales desde la web. Las reglas viven aquí, no en
 * las rutas: la web las llama y enseña el mensaje del `ErrorDeRegla` tal cual.
 */

// --- usuarios ----------------------------------------------------------------

/** Todos los usuarios, por orden de alta. */
export function listarUsuarios(db: DatabaseSync): Usuario[] {
	return sentencia(db, `SELECT ${COLUMNAS_USUARIO} FROM usuarios ORDER BY id`).all().map(comoUsuario);
}

export type AltaUsuario = {
	nombre: string;
	password: string;
	/** Vacío o ausente: se reparte el color menos usado. */
	color?: string;
	/** Quién da el alta. Es el usuario de la sesión que rellena el formulario. */
	actorId: number;
};

/** Alta de usuario desde la web: valida y deriva la contraseña con scrypt. */
export function altaUsuario(db: DatabaseSync, datos: AltaUsuario): Usuario {
	const nombre = datos.nombre.trim();
	if (nombre === "") {
		throw new ErrorDeRegla("nombre_vacio", "El nombre del usuario no puede estar vacío.");
	}
	if (datos.password === "") {
		throw new ErrorDeRegla("password_vacia", "La contraseña no puede estar vacía.");
	}
	if (buscarUsuarioPorNombre(db, nombre) !== undefined) {
		throw new ErrorDeRegla("usuario_repetido", `Ya existe un usuario llamado «${nombre}».`);
	}
	const color = datos.color === undefined || datos.color.trim() === "" ? undefined : datos.color.trim();
	return crearUsuario(db, nombre, hashPassword(datos.password), { color, actor: { usuarioId: datos.actorId } }).valor;
}

export type CambioColor = {
	usuarioId: number;
	color: string;
	actorId: number;
};

/**
 * Cambia el color de un usuario. Cualquiera puede cambiar el de cualquiera,
 * como el resto de la gestión de usuarios. No sube la revisión: el color es de
 * la web y ningún agente lo ve.
 */
export function cambiarColor(db: DatabaseSync, datos: CambioColor): Usuario {
	return enTransaccion(db, (conexion) => {
		const usuario = buscarUsuarioPorId(conexion, datos.usuarioId);
		if (usuario === undefined) {
			throw new ErrorDeRegla("usuario_inexistente", `No existe el usuario ${datos.usuarioId}.`);
		}
		const color = colorElegido(conexion, datos.color);
		sentencia(conexion, "UPDATE usuarios SET color = ? WHERE id = ?").run(color, usuario.id);
		registrarActividad(conexion, {
			actor: { usuarioId: datos.actorId },
			accion: "cambiar_color",
			objeto: "usuario",
			objetoId: usuario.id,
			objetoNombre: usuario.nombre,
			detalle: `${usuario.color} → ${color}`,
		});
		return { ...usuario, color };
	});
}

/** Cuántos terminales cuelgan de un usuario, revocados incluidos. */
function terminalesDeUsuario(db: DatabaseSync, usuarioId: number): number {
	const fila = sentencia(db, "SELECT COUNT(*) AS total FROM terminales WHERE usuario_id = ?").get(usuarioId);
	if (fila === undefined) {
		throw new Error("COUNT(*) no devolvió ninguna fila");
	}
	return entero(fila, "total");
}

/**
 * Baja de usuario. Nunca el último: sin usuarios nadie podría volver a entrar
 * en la web. Uno puede borrarse a sí mismo mientras quede otro.
 *
 * Lo que el usuario firmó (tareas creadas, preguntas contestadas) no se borra:
 * se queda sin referencia. El autor de los comentarios del hilo ya está
 * escrito como texto (`humano:xinux`), así que el hilo se lee igual.
 */
export function borrarUsuario(db: DatabaseSync, usuarioId: number, actorId: number): Usuario {
	return enTransaccionConRevision(db, (conexion) => {
		const usuario = buscarUsuarioPorId(conexion, usuarioId);
		if (usuario === undefined) {
			throw new ErrorDeRegla("usuario_inexistente", `No existe el usuario ${usuarioId}.`);
		}
		if (contarUsuarios(conexion) <= 1) {
			throw new ErrorDeRegla("ultimo_usuario", "Es el último usuario: si se borra, nadie podría entrar en la web.");
		}
		if (terminalesDeUsuario(conexion, usuarioId) > 0) {
			throw new ErrorDeRegla(
				"usuario_con_terminales",
				"El usuario tiene terminales a su nombre: los tokens quedarían sin dueño.",
			);
		}
		// El rastro se firma antes de borrar, para que quede aunque el usuario se
		// borre a sí mismo: la línea siguiente le quita el id a sus propias filas.
		registrarActividad(conexion, {
			actor: { usuarioId: actorId },
			accion: "baja_usuario",
			objeto: "usuario",
			objetoId: usuario.id,
			objetoNombre: usuario.nombre,
		});
		sentencia(conexion, "UPDATE actividad SET usuario_id = NULL WHERE usuario_id = ?").run(usuarioId);
		sentencia(conexion, "UPDATE tareas SET creada_por_usuario_id = NULL WHERE creada_por_usuario_id = ?").run(usuarioId);
		sentencia(conexion, "UPDATE preguntas SET respondida_por_usuario_id = NULL WHERE respondida_por_usuario_id = ?").run(
			usuarioId,
		);
		sentencia(conexion, "DELETE FROM usuarios WHERE id = ?").run(usuarioId);
		return usuario;
	}).valor;
}

export type CambioPassword = {
	usuarioId: number;
	actual: string;
	nueva: string;
	repetida: string;
};

/**
 * Cambio de la propia contraseña. Exige la actual: la cookie de sesión sola no
 * basta para cambiarla. No sube la revisión global, porque no es contenido
 * que ningún agente tenga que ver.
 */
export function cambiarPassword(db: DatabaseSync, datos: CambioPassword): Usuario {
	return enTransaccion(db, (conexion) => {
		const usuario = buscarUsuarioPorId(conexion, datos.usuarioId);
		if (usuario === undefined) {
			throw new ErrorDeRegla("usuario_inexistente", `No existe el usuario ${datos.usuarioId}.`);
		}
		if (!verificarPassword(datos.actual, usuario.hashPassword)) {
			throw new ErrorDeRegla("password_incorrecta", "La contraseña actual no es correcta.");
		}
		if (datos.nueva === "") {
			throw new ErrorDeRegla("password_vacia", "La contraseña nueva no puede estar vacía.");
		}
		if (datos.nueva !== datos.repetida) {
			throw new ErrorDeRegla("password_no_coincide", "La contraseña nueva y su repetición no coinciden.");
		}
		sentencia(conexion, "UPDATE usuarios SET hash_password = ? WHERE id = ?").run(hashPassword(datos.nueva), usuario.id);
		// Cada uno cambia la suya: el actor y el objeto son el mismo usuario.
		registrarActividad(conexion, {
			actor: { usuarioId: usuario.id },
			accion: "cambiar_password",
			objeto: "usuario",
			objetoId: usuario.id,
			objetoNombre: usuario.nombre,
		});
		return usuario;
	});
}

// --- terminales --------------------------------------------------------------

/** Un terminal con el nombre de su dueño, que es como lo enseña la web. */
export type TerminalListado = {
	id: number;
	usuarioId: number;
	usuario: string;
	nombre: string;
	cuenta: string;
	conectadoEn: string | null;
	ultimaRevision: number | null;
	usoJson: string | null;
	creado: string;
	revocadoEn: string | null;
};

/** Todos los terminales, activos primero y por orden de alta. */
export function listarTerminales(db: DatabaseSync): TerminalListado[] {
	const sql = `
		SELECT t.id, t.usuario_id, u.nombre AS usuario, t.nombre, t.cuenta, t.conectado_en,
			t.ultima_revision, t.uso_json, t.creado, t.revocado_en
		FROM terminales t
		JOIN usuarios u ON u.id = t.usuario_id
		ORDER BY CASE WHEN t.revocado_en IS NULL THEN 0 ELSE 1 END, t.id`;
	return sentencia(db, sql)
		.all()
		.map((fila) => ({
			id: entero(fila, "id"),
			usuarioId: entero(fila, "usuario_id"),
			usuario: texto(fila, "usuario"),
			nombre: texto(fila, "nombre"),
			cuenta: texto(fila, "cuenta"),
			conectadoEn: textoOpcional(fila, "conectado_en"),
			ultimaRevision: enteroOpcional(fila, "ultima_revision"),
			usoJson: textoOpcional(fila, "uso_json"),
			creado: texto(fila, "creado"),
			revocadoEn: textoOpcional(fila, "revocado_en"),
		}));
}

export type AltaTerminal = {
	usuarioId: number;
	nombre: string;
	cuenta: string;
};

/**
 * Alta de terminal desde la web. Devuelve el token en claro: es la única vez
 * que se puede ver, porque la base de datos solo guarda su hash.
 */
export function altaTerminal(db: DatabaseSync, datos: AltaTerminal): TerminalConToken {
	const nombre = datos.nombre.trim();
	const cuenta = datos.cuenta.trim();
	if (nombre === "") {
		throw new ErrorDeRegla("nombre_vacio", "El terminal necesita un nombre.");
	}
	if (cuenta === "") {
		throw new ErrorDeRegla("cuenta_vacia", "El terminal necesita la cuenta de origen de la sesión.");
	}
	// El terminal es del usuario de la sesión, que es también quien lo da de alta.
	return crearTerminalConToken(db, datos.usuarioId, nombre, cuenta, { usuarioId: datos.usuarioId }).valor;
}

/** Los terminales que todavía valen: los que se pueden asignar a una tarea. */
export function terminalesActivos(db: DatabaseSync): TerminalListado[] {
	return listarTerminales(db).filter((terminal) => terminal.revocadoEn === null);
}

/**
 * Revocar el token desconecta ese terminal y solo ese. Es contenido: sube la
 * revisión global, como el alta.
 */
export function revocarTerminal(db: DatabaseSync, terminalId: number, actorId: number): TerminalListado {
	return enTransaccionConRevision(db, (conexion) => {
		const terminal = listarTerminales(conexion).find((candidato) => candidato.id === terminalId);
		if (terminal === undefined) {
			throw new ErrorDeRegla("terminal_inexistente", `No existe el terminal ${terminalId}.`);
		}
		if (terminal.revocadoEn !== null) {
			throw new ErrorDeRegla("terminal_ya_revocado", `El terminal «${terminal.nombre}» ya estaba revocado.`);
		}
		const marca = ahora();
		sentencia(conexion, "UPDATE terminales SET revocado_en = ? WHERE id = ?").run(marca, terminalId);
		registrarActividad(conexion, {
			actor: { usuarioId: actorId },
			accion: "revocar_terminal",
			objeto: "terminal",
			objetoId: terminal.id,
			objetoNombre: terminal.nombre,
		});
		return { ...terminal, revocadoEn: marca };
	}).valor;
}
