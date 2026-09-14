import type { TipoComentario } from "../db/hilo.ts";
import type { Estado, Fase, Marca, TipoTarea } from "../db/tareas.ts";

/**
 * Las palabras de la web, en castellano llano. Es el único sitio que traduce un
 * nombre interno a lo que lee una persona: la tabla «Vocabulario» de CLAUDE.md.
 *
 * Lo que no cambia: las clases CSS (`estado-prepared`, `marca-bloqueada`,
 * `tipo-analisis`), los `value` de los desplegables, los parámetros de la URL
 * (`?estado=prepared`) y el Markdown del MCP. Solo el texto que se ve.
 */

/** Cómo se llama una tarea que está en ese estado: «la tarea está Preparada». */
export const NOMBRE_ESTADO: Record<Estado, string> = {
	backlog: "Por definir",
	prepared: "Preparada",
	doing: "En curso",
	done: "Hecha",
	finished: "Cerrada",
};

/** Cómo se llama la columna, que agrupa varias: «Preparadas», «Hechas». */
export const NOMBRE_COLUMNA: Record<Estado, string> = {
	backlog: "Por definir",
	prepared: "Preparadas",
	doing: "En curso",
	done: "Hechas",
	finished: "Cerradas",
};

/**
 * De quién es el turno en cada columna: quien decide que la tarea salga de
 * ella. Es lo que va debajo del rótulo de la columna y en los pasos del ciclo.
 */
export const DUENO_COLUMNA: Record<Estado, string> = {
	backlog: "tú",
	prepared: "el agente",
	doing: "el agente",
	done: "tú",
	finished: "nadie",
};

/**
 * Lo mismo dicho en la fila del rótulo de una columna, donde hay sitio para una
 * frase: «Preparadas, la trabaja el agente». `finished` queda fuera: una tarea
 * cerrada no es el turno de nadie y el rótulo no escribe nada.
 */
export const FRASE_DUENO_COLUMNA: Record<Exclude<Estado, "finished">, string> = {
	backlog: "la defines tú",
	prepared: "la trabaja el agente",
	doing: "la trabaja el agente",
	done: "la revisas tú",
};

/** Las marcas derivadas, con el nombre que dice qué pasa y no cómo se llama. */
export const NOMBRE_MARCA: Record<Marca, string> = {
	bloqueada: "Pregunta abierta",
	"sin terminal": "Sin terminal",
	"en marcha": "Agente trabajando",
	"análisis listo": "Por aprobar",
	esperando: "Espera a otra tarea",
	"sobre presupuesto": "Sobre presupuesto",
};

/** Los tipos de comentario del hilo. */
export const NOMBRE_TIPO_COMENTARIO: Record<TipoComentario, string> = {
	analisis: "Análisis",
	pregunta: "Pregunta",
	respuesta: "Respuesta",
	avance: "Avance",
	resultado: "Resultado",
	nota: "Nota",
};

/** Las dos fases de una tarea: en el consumo y en los informes. */
export const NOMBRE_FASE: Record<Fase, string> = {
	analisis: "Análisis",
	ejecucion: "Ejecución",
};

/** Los tipos de tarea. Una tarea normal no lleva etiqueta: es lo corriente. */
export const NOMBRE_TIPO_TAREA: Record<TipoTarea, string> = {
	tarea: "Tarea",
	pregunta: "Pregunta",
	funcionalidad: "Funcionalidad",
};

/**
 * Las dos vueltas atrás del humano, dichas por lo que significan y no por la
 * columna a la que van. Las usan la ficha, el prompt del tablero y la ayuda.
 */
export const VOLVER_A_DEFINIR = "Devolver a por definir";
export const RECHAZAR_RESULTADO = "Rechazar el resultado";
