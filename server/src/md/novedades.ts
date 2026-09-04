import type { ItemIndice, PreguntaContestada } from "../db/tareas.ts";
import { formatearId } from "./ids.ts";
import { lineaIndice } from "./indice.ts";

export type Novedades = {
	/** Revisión actual del servidor. El agente la guarda para la vuelta siguiente. */
	revision: number;
	tareas: ItemIndice[];
	preguntas: PreguntaContestada[];
};

/**
 * Salida de `novedades`. Si no hay nada nuevo es solo la línea de la
 * revisión: con este índice el agente decide qué tareas leer enteras.
 */
export function salidaNovedades({ revision, tareas, preguntas }: Novedades): string {
	const bloques = [`revision: ${revision}`];
	if (tareas.length > 0) {
		bloques.push("## Tareas nuevas o cambiadas", tareas.map(lineaIndice).join("\n"));
	}
	if (preguntas.length > 0) {
		bloques.push(
			"## Preguntas contestadas",
			preguntas
				.map((contestada) => `- ${formatearId(contestada.tareaId)} · P${contestada.numero} · ${contestada.opcion}`)
				.join("\n"),
		);
	}
	return bloques.join("\n\n");
}
