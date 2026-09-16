import type { DatabaseSync } from "node:sqlite";
import { ErrorDeRegla } from "../errores.ts";
import { formatearId } from "../md/ids.ts";
import { registrarActividad } from "./actividad.ts";
import { faseConAgente } from "./agentes.ts";
import { ahora, entero, escribirContenido, sentencia, texto } from "./base.ts";
import { tokensAbreviados } from "./consumo.ts";
import { dependenciasDe, detalleDependencias, escribirDependencias } from "./dependencias.ts";
import { autorHumano } from "./hilo.ts";
import { exigirProyectoPorId } from "./proyectos.ts";
import {
	buscarTarea,
	exigirPadreFuncionalidad,
	exigirPresupuesto,
	exigirTarea,
	type Tarea,
	type TipoTarea,
} from "./tareas.ts";

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
	/** Se puede cambiar de tipo (tarea, pregunta o funcionalidad) mientras esté en `backlog`. */
	tipo: TipoTarea;
	/**
	 * Los tres campos que se pueden dejar fuera: sin ellos la tarea se queda
	 * con la rama, el padre y las dependencias que ya tenía. La web que aún no
	 * los enseña no los toca.
	 */
	rama?: string | null;
	padreId?: number | null;
	dependeDe?: number[];
	/**
	 * Cambiar de proyecto solo es posible en una tarea suelta: sin padre, sin
	 * hijas y sin dependencias. Sin este campo, la tarea se queda donde está.
	 */
	proyectoId?: number;
	autoejecucion: boolean;
	/** Como la rama: sin este campo, la tarea se queda con el presupuesto que tenía. */
	presupuesto?: number | null;
	/**
	 * Papel de cada fase: con él, el modelo y el terminal se copian del agente y
	 * los que lleguen se ignoran. Sin el campo, la fase se queda con el papel que
	 * tenía, que es lo que hace un formulario que todavía no lo enseña.
	 */
	analisisAgenteId?: number | null;
	ejecucionAgenteId?: number | null;
	analisisModelo: string | null;
	analisisTerminalId: number | null;
	ejecucionModelo: string | null;
	ejecucionTerminalId: number | null;
};

/** Modelo y terminal de una fase, que es lo que se compara al editar. */
type Fase = { modelo: string | null; terminalId: number | null };

/** El nombre del papel de una fase, o «ninguno» cuando no lleva. */
function nombreDeAgente(conexion: DatabaseSync, agenteId: number | null): string {
	const fila =
		agenteId === null ? undefined : sentencia(conexion, "SELECT nombre FROM agentes WHERE id = ?").get(agenteId);
	return fila === undefined ? "ninguno" : texto(fila, "nombre");
}

/** `análisis: agente revisor`, o nada si la fase sigue con el mismo papel. */
function cambioDeAgente(
	conexion: DatabaseSync,
	nombre: string,
	antes: number | null,
	despues: number | null,
): string | null {
	return antes === despues ? null : `${nombre}: agente ${nombreDeAgente(conexion, despues)}`;
}

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

/** `200 k`, o una raya cuando no hay tope. */
function presupuestoComoTexto(presupuesto: number | null): string {
	return presupuesto === null ? "—" : tokensAbreviados(presupuesto);
}

/** `T-K7M3XQ`, o «ninguno» cuando la tarea no cuelga de nadie. */
function nombreDePadre(conexion: DatabaseSync, padreId: number | null): string {
	const padre = padreId === null ? undefined : buscarTarea(conexion, padreId);
	return padre === undefined ? "ninguno" : formatearId(padre.codigo);
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
	if (antes.tipo !== despues.tipo) {
		cambios.push(`tipo: ${antes.tipo} → ${despues.tipo}`);
	}
	if (despues.presupuesto !== undefined && antes.presupuesto !== despues.presupuesto) {
		cambios.push(
			`presupuesto: ${presupuestoComoTexto(antes.presupuesto)} → ${presupuestoComoTexto(despues.presupuesto)}`,
		);
	}
	if (despues.rama !== undefined && antes.rama !== despues.rama) {
		cambios.push(`rama: ${antes.rama ?? "ninguna"} → ${despues.rama ?? "ninguna"}`);
	}
	if (despues.padreId !== undefined && antes.padreId !== despues.padreId) {
		cambios.push(`padre: ${nombreDePadre(conexion, antes.padreId)} → ${nombreDePadre(conexion, despues.padreId)}`);
	}
	cambios.push(
		cambioDeAgente(conexion, "análisis", antes.analisisAgenteId, despues.analisisAgenteId ?? null),
		cambioDeFase(
			conexion,
			"análisis",
			{ modelo: antes.analisisModelo, terminalId: antes.analisisTerminalId },
			{ modelo: despues.analisisModelo, terminalId: despues.analisisTerminalId },
		),
		cambioDeAgente(conexion, "ejecución", antes.ejecucionAgenteId, despues.ejecucionAgenteId ?? null),
		cambioDeFase(
			conexion,
			"ejecución",
			{ modelo: antes.ejecucionModelo, terminalId: antes.ejecucionTerminalId },
			{ modelo: despues.ejecucionModelo, terminalId: despues.ejecucionTerminalId },
		),
	);
	return cambios.filter((cambio) => cambio !== null).join("; ");
}

/** Cuántas filas hay que impiden mover la tarea de proyecto. */
function cuantas(conexion: DatabaseSync, sql: string, ...parametros: number[]): number {
	const fila = sentencia(conexion, sql).get(...parametros);
	return fila === undefined ? 0 : entero(fila, "total");
}

/**
 * Cambiar una tarea de proyecto solo vale si está sola: una parte vive con su
 * funcionalidad, una madre con sus hijas, y una dependencia no cruza de
 * repositorio. Devuelve el detalle del rastro, `proyecto: DEFAULT → WEB`.
 */
function mudarDeProyecto(conexion: DatabaseSync, tarea: Tarea, proyectoId: number, padreId: number | null): string {
	const destino = exigirProyectoPorId(conexion, proyectoId);
	if (padreId !== null || tarea.padreId !== null) {
		throw new ErrorDeRegla(
			"no_cambia_de_proyecto",
			"La tarea cuelga de una funcionalidad: vive en el proyecto de su funcionalidad.",
		);
	}
	if (cuantas(conexion, "SELECT COUNT(*) AS total FROM tareas WHERE padre_id = ?", tarea.id) > 0) {
		throw new ErrorDeRegla("no_cambia_de_proyecto", "La tarea tiene tareas colgando: se quedarían en otro proyecto.");
	}
	if (
		cuantas(
			conexion,
			"SELECT COUNT(*) AS total FROM dependencias WHERE tarea_id = ? OR depende_de_id = ?",
			tarea.id,
			tarea.id,
		) > 0
	) {
		throw new ErrorDeRegla(
			"no_cambia_de_proyecto",
			"La tarea tiene dependencias: quita las que tiene y las que la esperan antes de moverla de proyecto.",
		);
	}
	return `proyecto: ${exigirProyectoPorId(conexion, tarea.proyectoId).clave} → ${destino.clave}`;
}

/**
 * Editar una tarea entera. Solo en `backlog`: al salir de esa columna la
 * descripción y las asignaciones se congelan y cualquier cambio posterior va
 * como `comentario` al hilo, para que no se pierda qué se pidió al
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
				`La tarea está en ${tarea.estado}: al salir de backlog la descripción y las asignaciones se congelan. Deja un comentario en el hilo.`,
			);
		}
		const padreId = datos.padreId === undefined ? tarea.padreId : datos.padreId;
		if (padreId !== null && padreId !== tarea.padreId) {
			exigirPadreFuncionalidad(conexion, padreId);
		}
		// Se comprueba antes de componer el rastro: un tope que no es un número no
		// se guarda ni se cuenta a medias.
		const presupuesto = datos.presupuesto === undefined ? tarea.presupuesto : exigirPresupuesto(datos.presupuesto);
		const proyectoId = datos.proyectoId ?? tarea.proyectoId;
		const mudanza = proyectoId === tarea.proyectoId ? null : mudarDeProyecto(conexion, tarea, proyectoId, padreId);
		// Una fase con agente no deja elegir modelo ni terminal a mano: vienen de
		// él. Sin el campo, la fase conserva el papel que ya tenía.
		const analisis = faseConAgente(
			conexion,
			datos.analisisAgenteId === undefined ? tarea.analisisAgenteId : datos.analisisAgenteId,
			{ modelo: datos.analisisModelo, terminalId: datos.analisisTerminalId },
		);
		const ejecucion = faseConAgente(
			conexion,
			datos.ejecucionAgenteId === undefined ? tarea.ejecucionAgenteId : datos.ejecucionAgenteId,
			{ modelo: datos.ejecucionModelo, terminalId: datos.ejecucionTerminalId },
		);
		// Un terminal es de un solo proyecto: al mudar la tarea, sus asignaciones
		// dejan de valer y cualquier terminal del proyecto nuevo puede tomarla.
		const asignado: EdicionTarea = {
			...datos,
			analisisAgenteId: analisis.agenteId,
			analisisModelo: analisis.modelo,
			analisisTerminalId: mudanza === null ? analisis.terminalId : null,
			ejecucionAgenteId: ejecucion.agenteId,
			ejecucionModelo: ejecucion.modelo,
			ejecucionTerminalId: mudanza === null ? ejecucion.terminalId : null,
		};
		// Se calcula antes del UPDATE: después ya no se sabe qué había.
		const cambios = [cambiosDeLaEdicion(conexion, tarea, asignado, titulo), mudanza ?? ""];
		sentencia(
			conexion,
			`UPDATE tareas
				SET titulo = ?, descripcion = ?, tipo = ?, rama = ?, padre_id = ?, proyecto_id = ?, autoejecucion = ?,
					presupuesto = ?,
					analisis_agente_id = ?, analisis_modelo = ?, analisis_terminal_id = ?,
					ejecucion_agente_id = ?, ejecucion_modelo = ?, ejecucion_terminal_id = ?,
					actualizada = ?, revision = ?
				WHERE id = ?`,
		).run(
			titulo,
			datos.descripcion,
			datos.tipo,
			datos.rama === undefined ? tarea.rama : datos.rama,
			padreId,
			proyectoId,
			datos.autoejecucion ? 1 : 0,
			presupuesto,
			asignado.analisisAgenteId ?? null,
			asignado.analisisModelo,
			asignado.analisisTerminalId,
			asignado.ejecucionAgenteId ?? null,
			asignado.ejecucionModelo,
			asignado.ejecucionTerminalId,
			ahora(),
			revision,
			tarea.id,
		);
		// Las dependencias se comparan con las que había: son filas aparte, no
		// una columna de la tarea.
		if (datos.dependeDe !== undefined) {
			const antes = dependenciasDe(conexion, tarea.id);
			const despues = escribirDependencias(conexion, tarea.id, datos.dependeDe);
			if (antes.join(",") !== despues.join(",")) {
				cambios.push(detalleDependencias(despues));
			}
		}
		const detalle = cambios.filter((cambio) => cambio !== "").join("; ");
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
