import type { DatabaseSync } from "node:sqlite";
import { ErrorDeRegla } from "../errores.ts";
import { registrarActividad } from "./actividad.ts";
import { ahora, escribirContenido, sentencia, texto } from "./base.ts";
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

/** Modelo y terminal de una fase, que es lo que se compara al editar. */
type Fase = { modelo: string | null; terminalId: number | null };

/** Una fase como `modelo@terminal`, para contar en qué se quedó al editarla. */
function faseComoTexto(conexion: DatabaseSync, fase: Fase): string {
	const fila =
		fase.terminalId === null
			? undefined
			: sentencia(conexion, "SELECT nombre FROM terminales WHERE id = ?").get(fase.terminalId);
	const terminal = fila === undefined ? null : texto(fila, "nombre");
	if (fase.modelo !== null && terminal !== null) {
		return `${fase.modelo}@${terminal}`;
	}
	return fase.modelo ?? (terminal === null ? "sin asignar" : `@${terminal}`);
}

/** `análisis: sonnet@portatil → opus`, o nada si la fase se quedó igual. */
function cambioDeFase(conexion: DatabaseSync, nombre: string, antes: Fase, despues: Fase): string | null {
	if (antes.modelo === despues.modelo && antes.terminalId === despues.terminalId) {
		return null;
	}
	return `${nombre}: ${faseComoTexto(conexion, antes)} → ${faseComoTexto(conexion, despues)}`;
}

/**
 * Qué cambió de verdad, con el formato de la tabla de actividad de CLAUDE.md.
 * Vacío si la edición no tocó nada, que es cuando no se escribe rastro: el
 * humano abrió el formulario y lo guardó tal cual.
 */
function cambiosDeLaEdicion(conexion: DatabaseSync, antes: Tarea, despues: EdicionTarea, titulo: string): string {
	const cambios: (string | null)[] = [];
	if (antes.titulo !== titulo) {
		cambios.push(`título: «${antes.titulo}» → «${titulo}»`);
	}
	if (antes.descripcion !== despues.descripcion) {
		// Una descripción entera no cabe en una línea de actividad: el texto
		// nuevo se lee en la tarea, aquí basta con saber que se tocó.
		cambios.push("descripción");
	}
	if (antes.autoejecucion !== despues.autoejecucion) {
		cambios.push(`autoejecución: ${antes.autoejecucion ? "activada → desactivada" : "desactivada → activada"}`);
	}
	cambios.push(
		cambioDeFase(
			conexion,
			"análisis",
			{ modelo: antes.analisisModelo, terminalId: antes.analisisTerminalId },
			{ modelo: despues.analisisModelo, terminalId: despues.analisisTerminalId },
		),
		cambioDeFase(
			conexion,
			"ejecución",
			{ modelo: antes.ejecucionModelo, terminalId: antes.ejecucionTerminalId },
			{ modelo: despues.ejecucionModelo, terminalId: despues.ejecucionTerminalId },
		),
	);
	return cambios.filter((cambio) => cambio !== null).join("; ");
}

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
		// Se calcula antes del UPDATE: después ya no se sabe qué había.
		const detalle = cambiosDeLaEdicion(conexion, tarea, datos, titulo);
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
		// Guardar sin tocar nada no es una acción: no deja rastro.
		if (detalle !== "") {
			registrarActividad(conexion, {
				actor: { usuarioId: datos.usuarioId },
				accion: "editar_tarea",
				objeto: "tarea",
				objetoId: tarea.id,
				objetoNombre: titulo,
				detalle,
			});
		}
		return exigirTarea(conexion, tarea.id);
	});
}
