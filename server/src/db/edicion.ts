import type { DatabaseSync } from "node:sqlite";
import { ErrorDeRegla } from "../errores.ts";
import { ahora, escribirContenido, sentencia } from "./base.ts";
import { autorHumano } from "./hilo.ts";
import { exigirTarea, type Tarea } from "./tareas.ts";

/**
 * Un título vacío deja la tarea sin nada que leer en el índice. Se comprueba
 * aquí para que la web y la edición usen la misma regla.
 */
export function exigirTitulo(titulo: string): string {
	const limpio = titulo.trim();
	if (limpio === "") {
		throw new ErrorDeRegla("titulo_vacio", "La tarea necesita un título.");
	}
	return limpio;
}

export type EdicionTarea = {
	tareaId: number;
	usuarioId: number;
	titulo: string;
	descripcion: string;
	autoejecucion: boolean;
	analisisModelo: string | null;
	analisisTerminalId: number | null;
	ejecucionModelo: string | null;
	ejecucionTerminalId: number | null;
};

/**
 * Editar una tarea entera. Solo en `backlog`: al salir de esa columna la
 * descripción y las asignaciones se congelan y cualquier cambio posterior va
 * como comentario `nota` al hilo, para que no se pierda qué se pidió al
 * principio.
 */
export function editarTareaBacklog(db: DatabaseSync, datos: EdicionTarea): Tarea {
	const titulo = exigirTitulo(datos.titulo);
	return escribirContenido(db, (conexion, revision) => {
		const tarea = exigirTarea(conexion, datos.tareaId);
		// Comprobar el usuario deja constancia de que la edición es humana.
		autorHumano(conexion, datos.usuarioId);
		if (tarea.estado !== "backlog") {
			throw new ErrorDeRegla(
				"solo_en_backlog",
				`La tarea está en ${tarea.estado}: al salir de backlog la descripción y las asignaciones se congelan. Deja una nota en el hilo.`,
			);
		}
		sentencia(
			conexion,
			`UPDATE tareas
				SET titulo = ?, descripcion = ?, autoejecucion = ?,
					analisis_modelo = ?, analisis_terminal_id = ?,
					ejecucion_modelo = ?, ejecucion_terminal_id = ?,
					actualizada = ?, revision = ?
				WHERE id = ?`,
		).run(
			titulo,
			datos.descripcion,
			datos.autoejecucion ? 1 : 0,
			datos.analisisModelo,
			datos.analisisTerminalId,
			datos.ejecucionModelo,
			datos.ejecucionTerminalId,
			ahora(),
			revision,
			tarea.id,
		);
		return exigirTarea(conexion, tarea.id);
	});
}
