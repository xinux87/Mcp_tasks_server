import type { DatabaseSync } from "node:sqlite";
import { hashPassword, verificarPassword } from "../auth/passwords.ts";
import { crearTerminalConToken, generarToken, hashToken, type TerminalConToken } from "../auth/tokens.ts";
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
import { exigirProyectoPorId, PROYECTO_PRINCIPAL } from "./proyectos.ts";

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
	/** El proyecto para el que trabaja, con su clave: es como lo enseña la web. */
	proyectoId: number;
	proyecto: string;
	nombre: string;
	cuenta: string;
	/** La carpeta local que reportó al registrarse, o nulo si aún no lo ha hecho. */
	ruta: string | null;
	/** Cuántos subagentes lanza a la vez su bucle. */
	agentes: number;
	conectadoEn: string | null;
	ultimaRevision: number | null;
	usoJson: string | null;
	creado: string;
	revocadoEn: string | null;
};

/** Todos los terminales, activos primero y por orden de alta. */
export function listarTerminales(db: DatabaseSync): TerminalListado[] {
	const sql = `
		SELECT t.id, t.usuario_id, u.nombre AS usuario, t.proyecto_id, p.clave AS proyecto, t.nombre, t.cuenta, t.ruta,
			t.agentes, t.conectado_en, t.ultima_revision, t.uso_json, t.creado, t.revocado_en
		FROM terminales t
		JOIN usuarios u ON u.id = t.usuario_id
		JOIN proyectos p ON p.id = t.proyecto_id
		ORDER BY CASE WHEN t.revocado_en IS NULL THEN 0 ELSE 1 END, t.id`;
	return sentencia(db, sql)
		.all()
		.map((fila) => ({
			id: entero(fila, "id"),
			usuarioId: entero(fila, "usuario_id"),
			usuario: texto(fila, "usuario"),
			proyectoId: entero(fila, "proyecto_id"),
			proyecto: texto(fila, "proyecto"),
			nombre: texto(fila, "nombre"),
			cuenta: texto(fila, "cuenta"),
			ruta: textoOpcional(fila, "ruta"),
			agentes: entero(fila, "agentes"),
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
	/** Cuántos subagentes lanza a la vez su bucle. Sin él, uno. */
	agentes?: number | string;
	/** El proyecto para el que trabaja. Sin él, el principal. */
	proyectoId?: number;
};

/**
 * Los agentes en paralelo de un terminal: un entero de 1 en adelante. Llega
 * como texto desde el formulario de la web y como número desde el resto, así
 * que se valida en un solo sitio. Sin valor, uno: el comportamiento de siempre.
 */
function agentesValidos(valor: number | string | undefined): number {
	if (valor === undefined || (typeof valor === "string" && valor.trim() === "")) {
		return 1;
	}
	const numero = typeof valor === "number" ? valor : Number(valor.trim());
	if (!Number.isInteger(numero) || numero < 1) {
		throw new ErrorDeRegla("agentes_invalido", "Los agentes en paralelo son un número entero de 1 en adelante.");
	}
	return numero;
}

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
	const agentes = agentesValidos(datos.agentes);
	const proyecto = exigirProyectoPorId(db, datos.proyectoId ?? PROYECTO_PRINCIPAL);
	// El terminal es del usuario de la sesión, que es también quien lo da de alta.
	return crearTerminalConToken(db, datos.usuarioId, nombre, cuenta, { usuarioId: datos.usuarioId }, agentes, proyecto.id)
		.valor;
}

export type CambioAgentes = {
	terminalId: number;
	agentes: number | string;
	actorId: number;
};

/**
 * Cambia los agentes en paralelo de un terminal. No sube la revisión: es
 * configuración del terminal, como rotar el token, y el bucle lo lee al
 * registrarse, así que vale a partir de su siguiente sesión. El servidor no lo
 * impone en `tomar_tarea`: quien lo respeta es el bucle.
 */
export function cambiarAgentes(db: DatabaseSync, datos: CambioAgentes): TerminalListado {
	return enTransaccion(db, (conexion) => {
		const terminal = listarTerminales(conexion).find((candidato) => candidato.id === datos.terminalId);
		if (terminal === undefined) {
			throw new ErrorDeRegla("terminal_inexistente", `No existe el terminal ${datos.terminalId}.`);
		}
		if (terminal.revocadoEn !== null) {
			throw new ErrorDeRegla(
				"terminal_revocado",
				`El terminal «${terminal.nombre}» está revocado: ya no va a tomar ninguna tarea.`,
			);
		}
		const agentes = agentesValidos(datos.agentes);
		if (agentes === terminal.agentes) {
			return terminal;
		}
		sentencia(conexion, "UPDATE terminales SET agentes = ? WHERE id = ?").run(agentes, terminal.id);
		registrarActividad(conexion, {
			actor: { usuarioId: datos.actorId },
			accion: "cambiar_agentes",
			objeto: "terminal",
			objetoId: terminal.id,
			objetoNombre: terminal.nombre,
			detalle: `${terminal.agentes} → ${agentes}`,
		});
		return { ...terminal, agentes };
	});
}

/** Los terminales que todavía valen: los que se pueden asignar a una tarea. */
export function terminalesActivos(db: DatabaseSync): TerminalListado[] {
	return listarTerminales(db).filter((terminal) => terminal.revocadoEn === null);
}

export type TerminalRotado = {
	terminal: TerminalListado;
	/** El token nuevo en claro. Como en el alta, solo se puede ver aquí. */
	token: string;
};

/**
 * Rotar el token da uno nuevo al mismo terminal y deja el anterior sin valor.
 * No revoca: `revocado_en` sigue a nulo y el terminal conserva su id, su
 * nombre, su historial y su consumo. No sube la revisión, porque es
 * configuración del terminal y no contenido que ningún agente tenga que ver.
 */
export function rotarTerminal(db: DatabaseSync, terminalId: number, actorId: number): TerminalRotado {
	return enTransaccion(db, (conexion) => {
		const terminal = listarTerminales(conexion).find((candidato) => candidato.id === terminalId);
		if (terminal === undefined) {
			throw new ErrorDeRegla("terminal_inexistente", `No existe el terminal ${terminalId}.`);
		}
		if (terminal.revocadoEn !== null) {
			throw new ErrorDeRegla(
				"terminal_revocado",
				`El terminal «${terminal.nombre}» está revocado: no se le puede dar un token nuevo.`,
			);
		}
		const token = generarToken();
		sentencia(conexion, "UPDATE terminales SET token_hash = ? WHERE id = ?").run(hashToken(token), terminalId);
		registrarActividad(conexion, {
			actor: { usuarioId: actorId },
			accion: "rotar_terminal",
			objeto: "terminal",
			objetoId: terminal.id,
			objetoNombre: terminal.nombre,
		});
		return { terminal, token };
	});
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

/**
 * Las cuatro columnas de `tareas` que nombran a un terminal. Al borrarlo pasan
 * a nulo: la tarea sigue, sin terminal, y cualquiera puede tomarla.
 */
const COLUMNAS_TERMINAL_EN_TAREAS = [
	"analisis_terminal_id",
	"ejecucion_terminal_id",
	"en_marcha_terminal_id",
	"creada_por_terminal_id",
] as const;

/**
 * Borrar un terminal lo quita de la lista del todo, esté revocado o no.
 * Revocar deja la fila para siempre, que es lo correcto para un token
 * comprometido pero convierte la lista en un cementerio.
 *
 * Sus tareas quedan sin terminal: las cuatro referencias pasan a nulo, como al
 * borrar un usuario, y las que estén en `prepared` o `doing` recuperan la marca
 * `sin terminal`. El consumo se conserva, porque son tokens gastados de verdad
 * y están sumados en la ficha; solo pierde el terminal. El rastro también, con
 * el nombre en texto: `actividad` no tiene clave foránea hacia el objeto.
 *
 * Es contenido y sube la revisión, como el alta y la revocación: cambia quién
 * puede tomar tareas.
 */
export function borrarTerminal(db: DatabaseSync, terminalId: number, actorId: number): TerminalListado {
	return enTransaccionConRevision(db, (conexion) => {
		const terminal = listarTerminales(conexion).find((candidato) => candidato.id === terminalId);
		if (terminal === undefined) {
			throw new ErrorDeRegla("terminal_inexistente", `No existe el terminal ${terminalId}.`);
		}
		// El rastro se firma antes de borrar, como en la baja de usuario: después
		// ya no habría de qué copiar el nombre.
		registrarActividad(conexion, {
			actor: { usuarioId: actorId },
			accion: "baja_terminal",
			objeto: "terminal",
			objetoId: terminal.id,
			objetoNombre: terminal.nombre,
		});
		for (const columna of COLUMNAS_TERMINAL_EN_TAREAS) {
			sentencia(conexion, `UPDATE tareas SET ${columna} = NULL WHERE ${columna} = ?`).run(terminalId);
		}
		sentencia(conexion, "UPDATE consumo SET terminal_id = NULL WHERE terminal_id = ?").run(terminalId);
		sentencia(conexion, "DELETE FROM terminales WHERE id = ?").run(terminalId);
		return terminal;
	}).valor;
}
