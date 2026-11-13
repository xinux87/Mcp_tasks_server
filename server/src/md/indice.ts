import type { ItemIndice } from "../db/tareas.ts";

/**
 * Cómo se escribe una fase en la línea de índice: `modelo@terminal` cuando
 * están los dos, y `sin asignar` cuando no hay ninguno de los dos. El papel,
 * cuando lo hay, va entre paréntesis al final.
 */
function fase(modelo: string | null, terminal: string | null, agente: string | null): string {
	const asignacion = quien(modelo, terminal);
	return agente === null ? asignacion : `${asignacion} (${agente})`;
}

function quien(modelo: string | null, terminal: string | null): string {
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
 * `funcionalidad 3/7` o `subtareas 2/7`: partes cerradas sobre partes totales.
 * Solo en una tarea descompuesta, que es la única que trae `partes`.
 */
function progreso(item: ItemIndice): string[] {
	if (item.partes === null) {
		return [];
	}
	const nombre = item.tipo === "funcionalidad" ? "funcionalidad" : "subtareas";
	return [`${nombre} ${item.partesCerradas ?? 0}/${item.partes}`];
}

/**
 * Una tarea en una línea, sin cuerpo: es lo que devuelven `listar_tareas` y
 * `novedades`. Las marcas van entre el estado y el título; si no hay ninguna,
 * no aparece nada en esa posición. Una pregunta lleva `pregunta` justo después
 * del estado y una tarea descompuesta (una funcionalidad, o una tarea con
 * partes) lleva ahí su progreso; ninguna lleva segmento `ejecucion:`, porque
 * no tienen esa fase. Una tarea que cuelga de otra cierra la línea con su padre.
 */
export function lineaIndice(item: ItemIndice): string {
	const esTarea = item.tipo === "tarea" && item.partes === null;
	const partes = [
		item.codigo,
		item.estado,
		...(item.tipo === "pregunta" ? ["pregunta"] : []),
		...progreso(item),
		...item.marcas,
		item.titulo,
		`analisis: ${fase(item.analisisModelo, item.analisisTerminal, item.analisisAgente)}`,
		...(esTarea ? [`ejecucion: ${fase(item.ejecucionModelo, item.ejecucionTerminal, item.ejecucionAgente)}`] : []),
		...(item.padreCodigo === null ? [] : [`padre: ${item.padreCodigo}`]),
	];
	return `- ${partes.join(" · ")}`;
}
