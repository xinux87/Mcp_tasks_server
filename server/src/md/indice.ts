import type { ItemIndice } from "../db/tareas.ts";
import { formatearId } from "./ids.ts";

/**
 * Cómo se escribe una fase en la línea de índice: `modelo@terminal` cuando
 * están los dos, y `sin asignar` cuando no hay ninguno de los dos.
 */
function fase(modelo: string | null, terminal: string | null): string {
	if (modelo !== null && terminal !== null) {
		return `${modelo}@${terminal}`;
	}
	if (modelo !== null) {
		return modelo;
	}
	if (terminal !== null) {
		return `@${terminal}`;
	}
	return "sin asignar";
}

/** `funcionalidad 3/7`: partes cerradas sobre partes totales. */
function progreso(item: ItemIndice): string {
	return `funcionalidad ${item.partesCerradas ?? 0}/${item.partes ?? 0}`;
}

/**
 * Una tarea en una línea, sin cuerpo: es lo que devuelven `listar_tareas` y
 * `novedades`. Las marcas van entre el estado y el título; si no hay ninguna,
 * no aparece nada en esa posición. Una pregunta lleva `pregunta` justo después
 * del estado y una funcionalidad lleva ahí su progreso; ninguna de las dos
 * lleva segmento `ejecucion:`, porque no tienen esa fase. Una tarea que cuelga
 * de otra cierra la línea con su padre.
 */
export function lineaIndice(item: ItemIndice): string {
	const esTarea = item.tipo === "tarea";
	const partes = [
		formatearId(item.codigo),
		item.estado,
		...(item.tipo === "pregunta" ? ["pregunta"] : []),
		...(item.tipo === "funcionalidad" ? [progreso(item)] : []),
		...item.marcas,
		item.titulo,
		`analisis: ${fase(item.analisisModelo, item.analisisTerminal)}`,
		...(esTarea ? [`ejecucion: ${fase(item.ejecucionModelo, item.ejecucionTerminal)}`] : []),
		...(item.padreCodigo === null ? [] : [`padre: ${formatearId(item.padreCodigo)}`]),
	];
	return `- ${partes.join(" · ")}`;
}
