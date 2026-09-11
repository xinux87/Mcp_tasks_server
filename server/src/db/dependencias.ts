import type { DatabaseSync } from "node:sqlite";
import { ErrorDeRegla } from "../errores.ts";
import { formatearId } from "../md/ids.ts";
import { type Actor, registrarActividad } from "./actividad.ts";
import { ahora, entero, escribirContenido, sentencia, texto } from "./base.ts";

/**
 * Dependencias entre tareas: `dependeDe` es la lista de tareas que tienen que
 * estar `done` o `finished` antes de que esta se pueda tomar. Sirve dentro de
 * una funcionalidad para ordenar sus partes y fuera de ella para cualquier
 * tarea suelta.
 *
 * Basta con `done`: lo construido y medido ya existe, y esperar a que el
 * humano lo acepte convertiría su revisión en cuello de botella.
 *
 * Este módulo no importa `tareas.ts`: es al revés, y la consulta que necesita
 * de la tabla de tareas cabe en una línea.
 */

/** Las dos columnas en las que una dependencia está satisfecha. */
const CERRADAS = "('done', 'finished')";

/** De qué depende la tarea, en orden de id. */
export function dependenciasDe(db: DatabaseSync, tareaId: number): number[] {
	return sentencia(db, "SELECT depende_de_id FROM dependencias WHERE tarea_id = ? ORDER BY depende_de_id")
		.all(tareaId)
		.map((fila) => entero(fila, "depende_de_id"));
}

/** Las dependencias que todavía no están cerradas. Son las que dejan la tarea `esperando`. */
export function dependenciasPendientes(db: DatabaseSync, tareaId: number): number[] {
	return sentencia(
		db,
		`SELECT d.depende_de_id
			FROM dependencias d
			JOIN tareas t ON t.id = d.depende_de_id
			WHERE d.tarea_id = ? AND t.estado NOT IN ${CERRADAS}
			ORDER BY d.depende_de_id`,
	)
		.all(tareaId)
		.map((fila) => entero(fila, "depende_de_id"));
}

/**
 * Qué tareas dependen de esta. Solo para avisar antes de borrarla: al borrarla
 * dejan de esperarla y pueden empezar, y eso el humano tiene que verlo antes.
 */
export function dependientesDe(db: DatabaseSync, tareaId: number): { id: number; titulo: string }[] {
	return sentencia(
		db,
		`SELECT t.id, t.titulo
			FROM dependencias d
			JOIN tareas t ON t.id = d.tarea_id
			WHERE d.depende_de_id = ?
			ORDER BY t.id`,
	)
		.all(tareaId)
		.map((fila) => ({ id: entero(fila, "id"), titulo: texto(fila, "titulo") }));
}

/** Cuántas dependencias quedan sin satisfacer. Es lo que necesita `marcasDe`. */
export function contarDependenciasPendientes(db: DatabaseSync, tareaId: number): number {
	return dependenciasPendientes(db, tareaId).length;
}

/**
 * Subconsulta que cuenta las dependencias pendientes de la tarea `t` de la
 * consulta que la incrusta. La comparten el índice y `novedades`, que no
 * pueden hacer una consulta por tarea.
 */
export const CUENTA_DEPENDENCIAS_PENDIENTES = `
	(SELECT COUNT(*) FROM dependencias d
		JOIN tareas dt ON dt.id = d.depende_de_id
		WHERE d.tarea_id = t.id AND dt.estado NOT IN ${CERRADAS})`;

/** Las dependencias de varias tareas a la vez, para el bloque de hijas del documento. */
export function dependenciasDeVarias(db: DatabaseSync, tareaIds: number[]): Map<number, number[]> {
	const porTarea = new Map<number, number[]>();
	for (const tareaId of tareaIds) {
		const suyas = dependenciasDe(db, tareaId);
		if (suyas.length > 0) {
			porTarea.set(tareaId, suyas);
		}
	}
	return porTarea;
}

/**
 * Escribe las dependencias de una tarea dentro de una escritura ya abierta.
 * Comprueba que existan, que no sea ella misma y que no cierren un ciclo.
 * Devuelve la lista tal como queda, sin repetidos y ordenada.
 */
export function escribirDependencias(conexion: DatabaseSync, tareaId: number, dependeDe: readonly number[]): number[] {
	const unicas = [...new Set(dependeDe)].sort((uno, otro) => uno - otro);
	for (const otra of unicas) {
		if (otra === tareaId) {
			throw new ErrorDeRegla("dependencia_propia", "Una tarea no puede depender de sí misma.");
		}
		// Que exista se comprueba aquí y no con la clave foránea: así el error
		// es de regla, con su código, y no un fallo del servidor.
		exigirQueExista(conexion, otra);
	}
	sentencia(conexion, "DELETE FROM dependencias WHERE tarea_id = ?").run(tareaId);
	for (const otra of unicas) {
		sentencia(conexion, "INSERT INTO dependencias (tarea_id, depende_de_id) VALUES (?, ?)").run(tareaId, otra);
	}
	exigirSinCiclos(conexion, tareaId);
	return unicas;
}

/** Como `exigirTarea`, pero sin traerse la fila entera ni el módulo de tareas. */
function exigirQueExista(conexion: DatabaseSync, tareaId: number): void {
	const fila = sentencia(conexion, "SELECT id FROM tareas WHERE id = ?").get(tareaId);
	if (fila === undefined) {
		throw new ErrorDeRegla("tarea_inexistente", `No existe la tarea ${tareaId}.`);
	}
}

/**
 * Un ciclo deja a un grupo de tareas esperándose entre ellas para siempre. Se
 * detecta después de escribir: si desde la tarea se puede volver a ella
 * siguiendo dependencias, hay ciclo y la escritura entera se deshace.
 */
function exigirSinCiclos(conexion: DatabaseSync, tareaId: number): void {
	const fila = sentencia(
		conexion,
		`WITH RECURSIVE alcanzables(id) AS (
				SELECT depende_de_id FROM dependencias WHERE tarea_id = ?1
				UNION
				SELECT d.depende_de_id FROM dependencias d JOIN alcanzables a ON d.tarea_id = a.id
			)
			SELECT COUNT(*) AS total FROM alcanzables WHERE id = ?1`,
	).get(tareaId);
	if (fila === undefined) {
		throw new Error("la comprobación de ciclos no devolvió ninguna fila");
	}
	if (entero(fila, "total") > 0) {
		throw new ErrorDeRegla(
			"dependencia_ciclica",
			"Esas dependencias cierran un ciclo: la tarea acabaría esperándose a sí misma.",
		);
	}
}

/** `dependencias: T-0041, T-0043`, tal como se cuenta en el rastro de actividad. */
export function detalleDependencias(dependeDe: readonly number[]): string {
	if (dependeDe.length === 0) {
		return "dependencias: ninguna";
	}
	return `dependencias: ${dependeDe.map(formatearId).join(", ")}`;
}

/** Estado y título de la tarea: lo justo para la comprobación y el rastro. */
function paraElRastro(conexion: DatabaseSync, tareaId: number): { id: number; estado: string; titulo: string } {
	const fila = sentencia(conexion, "SELECT id, estado, titulo FROM tareas WHERE id = ?").get(tareaId);
	if (fila === undefined) {
		throw new ErrorDeRegla("tarea_inexistente", `No existe la tarea ${tareaId}.`);
	}
	return { id: entero(fila, "id"), estado: texto(fila, "estado"), titulo: texto(fila, "titulo") };
}

export type FijacionDependencias = {
	tareaId: number;
	dependeDe: number[];
	actor: Actor;
};

/**
 * Fija las dependencias de una tarea. Solo en `backlog`: al salir de esa
 * columna se congelan como el resto de asignaciones.
 */
export function fijarDependencias(db: DatabaseSync, datos: FijacionDependencias): number[] {
	return escribirContenido(db, (conexion, revision) => {
		const tarea = paraElRastro(conexion, datos.tareaId);
		if (tarea.estado !== "backlog") {
			throw new ErrorDeRegla(
				"solo_en_backlog",
				`La tarea está en ${tarea.estado}: las dependencias se fijan en backlog y ahí se quedan.`,
			);
		}
		const puestas = escribirDependencias(conexion, tarea.id, datos.dependeDe);
		sentencia(conexion, "UPDATE tareas SET actualizada = ?, revision = ? WHERE id = ?").run(ahora(), revision, tarea.id);
		registrarActividad(conexion, {
			actor: datos.actor,
			accion: "editar_tarea",
			objeto: "tarea",
			objetoId: tarea.id,
			objetoNombre: tarea.titulo,
			detalle: detalleDependencias(puestas),
		});
		return puestas;
	});
}

/** Borra las dependencias de la tarea en los dos sentidos. Solo al borrarla. */
export function borrarDependenciasDe(conexion: DatabaseSync, tareaId: number): void {
	sentencia(conexion, "DELETE FROM dependencias WHERE tarea_id = ? OR depende_de_id = ?").run(tareaId, tareaId);
}
