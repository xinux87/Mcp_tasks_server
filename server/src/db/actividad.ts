import type { DatabaseSync } from "node:sqlite";
import { ErrorDeRegla } from "../errores.ts";
import { ahora, entero, enteroOpcional, sentencia, texto } from "./base.ts";

/**
 * El rastro de las acciones humanas. Lo que hace un agente ya está en el hilo
 * con su autor, así que el MCP nunca escribe aquí.
 *
 * Se escribe siempre en la misma transacción que la acción y nunca sube la
 * revisión por sí solo: la acción ya lo hace si es contenido, y las que no lo
 * son (contraseña, color) tampoco lo hacen por dejar rastro.
 *
 * Este módulo no importa `consultas.ts`: `consultas.ts` sí lo importa a él, y
 * el nombre del actor sale de una consulta de una línea.
 */

export type ObjetoActividad = "tarea" | "usuario" | "terminal";

const OBJETOS: readonly ObjetoActividad[] = ["tarea", "usuario", "terminal"];

/** Las acciones que se registran, tal como salen en la tabla de CLAUDE.md. */
export type AccionActividad =
	| "crear_tarea"
	| "editar_tarea"
	| "borrar_tarea"
	| "mover_tarea"
	| "aprobar_ejecucion"
	| "responder_pregunta"
	| "nota"
	| "alta_usuario"
	| "baja_usuario"
	| "cambiar_password"
	| "cambiar_color"
	| "alta_terminal"
	| "rotar_terminal"
	| "revocar_terminal"
	| "baja_terminal";

/**
 * Quién hace la acción: un usuario de la web, o un nombre suelto para lo que
 * no tiene sesión (`cli`, `arranque`). Sin actor no se escribe nada, que es lo
 * que hacen los tests que montan la base a mano.
 */
export type Actor = { usuarioId: number } | { nombre: string };

export type Actividad = {
	id: number;
	/** Nulo si el usuario se borró después, o si la acción no vino de la web. */
	usuarioId: number | null;
	usuarioNombre: string;
	/**
	 * Se lee como texto libre, no como `AccionActividad`: la columna no tiene
	 * `CHECK` y una fila escrita por otra versión no debe romper la lectura.
	 */
	accion: string;
	objeto: ObjetoActividad;
	objetoId: number;
	objetoNombre: string;
	detalle: string;
	creado: string;
};

export type NuevaActividad = {
	actor: Actor;
	accion: AccionActividad;
	objeto: ObjetoActividad;
	objetoId: number;
	objetoNombre: string;
	/** Lo compone el servidor. Vacío en las acciones que no tienen nada que contar. */
	detalle?: string;
};

const COLUMNAS = "id, usuario_id, usuario_nombre, accion, objeto, objeto_id, objeto_nombre, detalle, creado";

function esObjeto(valor: string): valor is ObjetoActividad {
	const nombres: readonly string[] = OBJETOS;
	return nombres.includes(valor);
}

function comoObjeto(fila: Record<string, unknown>): ObjetoActividad {
	const valor = texto(fila, "objeto");
	if (!esObjeto(valor)) {
		throw new Error(`objeto de actividad desconocido en la base de datos: ${valor}`);
	}
	return valor;
}

function comoActividad(fila: Record<string, unknown>): Actividad {
	return {
		id: entero(fila, "id"),
		usuarioId: enteroOpcional(fila, "usuario_id"),
		usuarioNombre: texto(fila, "usuario_nombre"),
		accion: texto(fila, "accion"),
		objeto: comoObjeto(fila),
		objetoId: entero(fila, "objeto_id"),
		objetoNombre: texto(fila, "objeto_nombre"),
		detalle: texto(fila, "detalle"),
		creado: texto(fila, "creado"),
	};
}

/** Id y nombre con los que se firma la fila. El nombre se guarda como texto. */
function firmaDelActor(conexion: DatabaseSync, actor: Actor): { id: number | null; nombre: string } {
	if ("nombre" in actor) {
		return { id: null, nombre: actor.nombre };
	}
	const fila = sentencia(conexion, "SELECT nombre FROM usuarios WHERE id = ?").get(actor.usuarioId);
	if (fila === undefined) {
		throw new ErrorDeRegla("usuario_inexistente", `No existe el usuario ${actor.usuarioId}.`);
	}
	return { id: actor.usuarioId, nombre: texto(fila, "nombre") };
}

// --- escritura ---------------------------------------------------------------

/**
 * Deja una fila de actividad dentro de la transacción ya abierta por la acción.
 * Recibe la conexión, no la base: si abriera transacción propia, el rastro y la
 * acción podrían quedar desparejados.
 */
export function registrarActividad(conexion: DatabaseSync, entrada: NuevaActividad): void {
	const firma = firmaDelActor(conexion, entrada.actor);
	sentencia(
		conexion,
		`INSERT INTO actividad (usuario_id, usuario_nombre, accion, objeto, objeto_id, objeto_nombre, detalle, creado)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		firma.id,
		firma.nombre,
		entrada.accion,
		entrada.objeto,
		entrada.objetoId,
		entrada.objetoNombre,
		entrada.detalle ?? "",
		ahora(),
	);
}

// --- lectura -----------------------------------------------------------------

/** El rastro de un objeto, de lo más antiguo a lo más nuevo. Es una línea de tiempo. */
/** El alta de un objeto: la fila que empieza su vida. */
const ES_UN_ALTA = "(accion LIKE 'alta_%' OR accion LIKE 'crear_%')";

/**
 * Solo `tareas` lleva `AUTOINCREMENT`: los ids de usuario y de terminal se
 * reciclan en cuanto se borra el más alto, así que un `objeto_id` puede haber
 * sido de dos objetos distintos. El rastro de uno empieza en su última alta;
 * lo anterior era de otro y solo se lee en `GET /actividad`, donde cada fila
 * lleva su propio `objeto_nombre`.
 */
const DESDE_EL_ALTA = `(SELECT COALESCE(MAX(id), 0) FROM actividad WHERE objeto = ? AND objeto_id = ? AND ${ES_UN_ALTA})`;

export function actividadDe(db: DatabaseSync, objeto: ObjetoActividad, objetoId: number): Actividad[] {
	return sentencia(
		db,
		`SELECT ${COLUMNAS} FROM actividad
			WHERE objeto = ? AND objeto_id = ? AND id >= ${DESDE_EL_ALTA}
			ORDER BY id`,
	)
		.all(objeto, objetoId, objeto, objetoId)
		.map(comoActividad);
}

/** Lo último que ha pasado en todo el servidor, de lo más nuevo a lo más antiguo. */
export function actividadReciente(db: DatabaseSync, limite: number): Actividad[] {
	return sentencia(db, `SELECT ${COLUMNAS} FROM actividad ORDER BY id DESC LIMIT ?`)
		.all(Math.max(0, Math.trunc(limite)))
		.map(comoActividad);
}

/**
 * Quién dio de alta el objeto, o `null` si no consta. El `_` de un `LIKE` es un
 * comodín de un carácter, pero ninguna acción empieza por «alta» o «crear» sin
 * guion, así que el filtro solo deja pasar las de creación.
 */
export function altaPor(db: DatabaseSync, objeto: ObjetoActividad, objetoId: number): string | null {
	const fila = sentencia(
		db,
		`SELECT usuario_nombre FROM actividad
			WHERE objeto = ? AND objeto_id = ? AND ${ES_UN_ALTA}
			ORDER BY id DESC LIMIT 1`,
	).get(objeto, objetoId);
	return fila === undefined ? null : texto(fila, "usuario_nombre");
}
