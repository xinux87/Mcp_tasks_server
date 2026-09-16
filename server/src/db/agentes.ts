import type { DatabaseSync } from "node:sqlite";
import { ErrorDeRegla } from "../errores.ts";
import { type Actor, registrarActividad } from "./actividad.ts";
import { ahora, enTransaccion, entero, enteroOpcional, idInsertado, sentencia, texto } from "./base.ts";

/**
 * Agentes: un papel escrito en Markdown que se asigna a la fase de una tarea.
 * Quién es, cómo trabaja, qué mira y qué no. Cuando el bucle lanza esa fase,
 * el texto del agente es el contexto del subagente.
 *
 * Nada de lo que pasa aquí sube la revisión: ningún agente ve un papel hasta
 * que se le asigna a una tarea, y asignar es editar la tarea, que ya la sube.
 */

/** Los modelos con los que se puede lanzar un agente. */
export const MODELOS: readonly string[] = ["fable", "opus", "sonnet", "haiku"];

export type Agente = {
	id: number;
	/** `revisor`, `implementador-web`. Se fija al crear y no se cambia. */
	nombre: string;
	descripcion: string;
	/** El Markdown del papel, tal como se le habla al subagente. */
	instrucciones: string;
	modelo: string;
	/** Con él, el agente corre en ese terminal; sin él, en cualquiera. */
	terminalId: number | null;
	creado: string;
	actualizado: string;
};

const COLUMNAS = "id, nombre, descripcion, instrucciones, modelo, terminal_id, creado, actualizado";

function comoAgente(fila: Record<string, unknown>): Agente {
	return {
		id: entero(fila, "id"),
		nombre: texto(fila, "nombre"),
		descripcion: texto(fila, "descripcion"),
		instrucciones: texto(fila, "instrucciones"),
		modelo: texto(fila, "modelo"),
		terminalId: enteroOpcional(fila, "terminal_id"),
		creado: texto(fila, "creado"),
		actualizado: texto(fila, "actualizado"),
	};
}

/** Minúsculas, cifras y guiones, de dos a treinta, empezando por letra. */
export function esNombreDeAgente(valor: string): boolean {
	return /^[a-z][a-z0-9-]{1,29}$/.test(valor);
}

function exigirModelo(modelo: string): string {
	const limpio = modelo.trim();
	if (!MODELOS.includes(limpio)) {
		throw new ErrorDeRegla("modelo_invalido", `El modelo de un agente es uno de ${MODELOS.join(", ")}.`);
	}
	return limpio;
}

/** Un terminal que no existe deja el papel apuntando a nada. */
function exigirTerminal(conexion: DatabaseSync, terminalId: number | null): number | null {
	if (terminalId === null) {
		return null;
	}
	if (sentencia(conexion, "SELECT 1 FROM terminales WHERE id = ?").get(terminalId) === undefined) {
		throw new ErrorDeRegla("terminal_inexistente", `No existe el terminal ${terminalId}.`);
	}
	return terminalId;
}

// --- lectura -----------------------------------------------------------------

/** Todos los agentes, por nombre: es como se buscan en la lista y en el desplegable. */
export function listarAgentes(db: DatabaseSync): Agente[] {
	return sentencia(db, `SELECT ${COLUMNAS} FROM agentes ORDER BY nombre`).all().map(comoAgente);
}

export function buscarAgentePorId(db: DatabaseSync, id: number): Agente | undefined {
	const fila = sentencia(db, `SELECT ${COLUMNAS} FROM agentes WHERE id = ?`).get(id);
	return fila === undefined ? undefined : comoAgente(fila);
}

export function buscarAgentePorNombre(db: DatabaseSync, nombre: string): Agente | undefined {
	const fila = sentencia(db, `SELECT ${COLUMNAS} FROM agentes WHERE nombre = ?`).get(nombre.trim().toLowerCase());
	return fila === undefined ? undefined : comoAgente(fila);
}

/** El nombre de un terminal, o `null` si no hay ninguno o ya no existe. */
function nombreTerminal(db: DatabaseSync, terminalId: number | null): string | null {
	if (terminalId === null) {
		return null;
	}
	const fila = sentencia(db, "SELECT nombre FROM terminales WHERE id = ?").get(terminalId);
	return fila === undefined ? null : texto(fila, "nombre");
}

/**
 * El nombre del terminal al que está atado el agente, o `null` si corre en
 * cualquiera. Es lo que va en el documento que devuelve `leer_agente`.
 */
export function terminalDeAgente(db: DatabaseSync, agente: Agente): string | null {
	return nombreTerminal(db, agente.terminalId);
}

/** Como `buscarAgentePorNombre`, pero lo que no existe es un error de regla: lo pide `leer_agente`. */
export function exigirAgentePorNombre(db: DatabaseSync, nombre: string): Agente {
	const agente = buscarAgentePorNombre(db, nombre);
	if (agente === undefined) {
		throw new ErrorDeRegla("agente_inexistente", `No existe ningún agente que se llame «${nombre}».`);
	}
	return agente;
}

function exigirAgentePorId(conexion: DatabaseSync, id: number): Agente {
	const agente = buscarAgentePorId(conexion, id);
	if (agente === undefined) {
		throw new ErrorDeRegla("agente_inexistente", `No existe el agente ${id}.`);
	}
	return agente;
}

/**
 * A cuántas fases de tareas abiertas está asignado. Es lo que dice la
 * confirmación de borrado: esas fases se quedan sin papel. Una tarea que lo
 * lleve en las dos fases cuenta dos.
 */
export function fasesAsignadas(db: DatabaseSync, agenteId: number): number {
	const fila = sentencia(
		db,
		`SELECT (SELECT COUNT(*) FROM tareas WHERE analisis_agente_id = ?1 AND estado <> 'finished')
			+ (SELECT COUNT(*) FROM tareas WHERE ejecucion_agente_id = ?1 AND estado <> 'finished') AS total`,
	).get(agenteId);
	if (fila === undefined) {
		throw new Error("el recuento de fases no devolvió ninguna fila");
	}
	return entero(fila, "total");
}

// --- asignación a una fase ---------------------------------------------------

/** Modelo, terminal y papel de una fase de la tarea. */
export type FaseConAgente = {
	agenteId: number | null;
	modelo: string | null;
	terminalId: number | null;
};

/**
 * Asignar un agente a una fase copia su modelo y su terminal en ese momento,
 * ignorando los que vengan del formulario: una fase con agente no deja elegir
 * ninguno de los dos a mano. Sin agente, la fase se queda con lo que le pasen.
 *
 * Lo copiado no se vuelve a leer: si después se edita el agente, las tareas ya
 * asignadas conservan su modelo y su terminal. Las instrucciones sí se leen al
 * lanzar, así que un cambio en el texto vale desde la siguiente vuelta.
 */
export function faseConAgente(
	conexion: DatabaseSync,
	agenteId: number | null,
	fase: { modelo: string | null; terminalId: number | null },
): FaseConAgente {
	if (agenteId === null) {
		return { agenteId: null, ...fase };
	}
	const agente = exigirAgentePorId(conexion, agenteId);
	return { agenteId: agente.id, modelo: agente.modelo, terminalId: agente.terminalId };
}

// --- escritura ---------------------------------------------------------------

export type NuevoAgente = {
	nombre: string;
	instrucciones: string;
	modelo: string;
	descripcion?: string;
	terminalId?: number | null;
	/** Sin actor no se escribe actividad, como en el resto de altas. */
	actor?: Actor;
};

export function crearAgente(db: DatabaseSync, datos: NuevoAgente): Agente {
	const nombre = datos.nombre.trim().toLowerCase();
	if (!esNombreDeAgente(nombre)) {
		throw new ErrorDeRegla(
			"nombre_invalido",
			"El nombre de un agente son de dos a treinta caracteres, en minúsculas con guiones, empezando por letra.",
		);
	}
	const modelo = exigirModelo(datos.modelo);
	return enTransaccion(db, (conexion) => {
		if (buscarAgentePorNombre(conexion, nombre) !== undefined) {
			throw new ErrorDeRegla("nombre_repetido", `Ya hay un agente que se llama «${nombre}».`);
		}
		const marca = ahora();
		const cambios = sentencia(
			conexion,
			`INSERT INTO agentes (nombre, descripcion, instrucciones, modelo, terminal_id, creado, actualizado)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
		).run(
			nombre,
			datos.descripcion?.trim() ?? "",
			datos.instrucciones,
			modelo,
			exigirTerminal(conexion, datos.terminalId ?? null),
			marca,
			marca,
		);
		const creado = exigirAgentePorId(conexion, idInsertado(cambios.lastInsertRowid));
		if (datos.actor !== undefined) {
			registrarActividad(conexion, {
				actor: datos.actor,
				accion: "alta_agente",
				objeto: "agente",
				objetoId: creado.id,
				objetoNombre: creado.nombre,
				detalle: `modelo ${creado.modelo}`,
			});
		}
		return creado;
	});
}

export type EdicionAgente = {
	agenteId: number;
	descripcion?: string;
	instrucciones?: string;
	modelo?: string;
	terminalId?: number | null;
	actor?: Actor;
};

/**
 * Edita un agente. El nombre no está: es lo que va en el frontmatter de las
 * tareas ya asignadas y lo que pide `leer_agente`.
 */
export function editarAgente(db: DatabaseSync, datos: EdicionAgente): Agente {
	const modelo = datos.modelo === undefined ? undefined : exigirModelo(datos.modelo);
	return enTransaccion(db, (conexion) => {
		const antes = exigirAgentePorId(conexion, datos.agenteId);
		const despues: Agente = {
			...antes,
			descripcion: datos.descripcion?.trim() ?? antes.descripcion,
			instrucciones: datos.instrucciones ?? antes.instrucciones,
			modelo: modelo ?? antes.modelo,
			terminalId: datos.terminalId === undefined ? antes.terminalId : exigirTerminal(conexion, datos.terminalId),
			actualizado: ahora(),
		};
		sentencia(
			conexion,
			`UPDATE agentes SET descripcion = ?, instrucciones = ?, modelo = ?, terminal_id = ?, actualizado = ?
				WHERE id = ?`,
		).run(despues.descripcion, despues.instrucciones, despues.modelo, despues.terminalId, despues.actualizado, antes.id);
		const cambios = [
			antes.descripcion === despues.descripcion ? null : "descripción",
			// El papel entero no cabe en una línea de actividad: se lee en el agente.
			antes.instrucciones === despues.instrucciones ? null : "instrucciones",
			antes.modelo === despues.modelo ? null : `modelo: ${antes.modelo} → ${despues.modelo}`,
			antes.terminalId === despues.terminalId
				? null
				: `terminal: ${nombreTerminal(conexion, antes.terminalId) ?? "cualquiera"} → ${nombreTerminal(conexion, despues.terminalId) ?? "cualquiera"}`,
		].filter((cambio) => cambio !== null);
		// Guardar sin tocar nada no es una acción: no deja rastro.
		if (datos.actor !== undefined && cambios.length > 0) {
			registrarActividad(conexion, {
				actor: datos.actor,
				accion: "editar_agente",
				objeto: "agente",
				objetoId: antes.id,
				objetoNombre: despues.nombre,
				detalle: cambios.join("; "),
			});
		}
		return despues;
	});
}

/**
 * Borra un agente. Se borra siempre: las fases que lo llevaban se quedan sin
 * papel y con el modelo y el terminal que les copió al asignarlo, así que
 * siguen trabajándose igual.
 */
export function borrarAgente(db: DatabaseSync, agenteId: number, actor?: Actor): Agente {
	return enTransaccion(db, (conexion) => {
		const agente = exigirAgentePorId(conexion, agenteId);
		const fases = fasesAsignadas(conexion, agente.id);
		// El rastro se firma antes de borrar: después ya no habría nombre que copiar.
		if (actor !== undefined) {
			registrarActividad(conexion, {
				actor,
				accion: "baja_agente",
				objeto: "agente",
				objetoId: agente.id,
				objetoNombre: agente.nombre,
				detalle: fases === 0 ? "" : `${fases} ${fases === 1 ? "fase se queda" : "fases se quedan"} sin agente`,
			});
		}
		for (const columna of ["analisis_agente_id", "ejecucion_agente_id"]) {
			sentencia(conexion, `UPDATE tareas SET ${columna} = NULL WHERE ${columna} = ?`).run(agente.id);
		}
		sentencia(conexion, "DELETE FROM agentes WHERE id = ?").run(agente.id);
		return agente;
	});
}
