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

/**
 * Una tarea en una línea, sin cuerpo: es lo que devuelven `listar_tareas` y
 * `novedades`. Las marcas van entre el estado y el título; si no hay ninguna,
 * no aparece nada en esa posición. Una pregunta lleva `pregunta` justo después
 * del estado, antes de las marcas, y no lleva segmento `ejecucion:`: no tiene
 * esa fase.
 */
export function lineaIndice(item: ItemIndice): string {
	const esPregunta = item.tipo === "pregunta";
	const partes = [
		formatearId(item.id),
		item.estado,
		...(esPregunta ? ["pregunta"] : []),
		...item.marcas,
		item.titulo,
		`analisis: ${fase(item.analisisModelo, item.analisisTerminal)}`,
		...(esPregunta ? [] : [`ejecucion: ${fase(item.ejecucionModelo, item.ejecucionTerminal)}`]),
	];
	return `- ${partes.join(" · ")}`;
}
