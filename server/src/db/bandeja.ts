import type { DatabaseSync } from "node:sqlite";
import { type ItemIndice, listarTareas } from "./tareas.ts";

/**
 * Lo que espera por el humano, de todos los proyectos. Es lo único que lee la
 * bandeja: los cuatro bloques salen de una sola pasada por el índice, que ya
 * trae las marcas calculadas y cuándo entró cada tarea en su estado.
 */

/** Una semana en backlog es una tarea que el humano no ha terminado de decidir. */
const HORAS_BACKLOG = 7 * 24;

export type Bandeja = {
	/** Tareas con alguna pregunta sin contestar. */
	bloqueadas: ItemIndice[];
	/** Tareas con el análisis hecho esperando la aprobación del humano. */
	porAprobar: ItemIndice[];
	/** Lo que está en `done`: ejecutado y sin revisar. */
	porRevisar: ItemIndice[];
	/** Lo que lleva más de siete días en `backlog`. */
	sinDefinir: ItemIndice[];
};

/** Milisegundos desde una fecha ISO. Una fecha ilegible cuenta como recién llegada. */
function antiguedad(desde: string, ahora: Date): number {
	const transcurrido = ahora.getTime() - new Date(desde).getTime();
	return Number.isFinite(transcurrido) ? transcurrido : 0;
}

/** De más antigua a más nueva en su estado: lo que más lleva esperando, primero. */
function porEdad(items: ItemIndice[], desde: (item: ItemIndice) => string): ItemIndice[] {
	return items.sort((uno, otro) => desde(uno).localeCompare(desde(otro)));
}

export function bandejaDelHumano(db: DatabaseSync, ahora: Date = new Date(), horasParada?: number): Bandeja {
	const items = listarTareas(db, {}, horasParada);
	const limite = HORAS_BACKLOG * 60 * 60 * 1000;
	return {
		// En una bloqueada lo que espera es la pregunta, no la columna.
		bloqueadas: porEdad(
			items.filter((item) => item.marcas.includes("bloqueada")),
			(item) => item.bloqueadaDesde ?? item.estadoDesde,
		),
		porAprobar: porEdad(
			items.filter((item) => item.marcas.includes("análisis listo")),
			(item) => item.estadoDesde,
		),
		porRevisar: porEdad(
			items.filter((item) => item.estado === "done"),
			(item) => item.estadoDesde,
		),
		sinDefinir: porEdad(
			items.filter((item) => item.estado === "backlog" && antiguedad(item.estadoDesde, ahora) > limite),
			(item) => item.estadoDesde,
		),
	};
}

/**
 * El contador de la barra lateral y del título: los tres bloques que bloquean
 * a alguien. El backlog no cuenta, porque no frena a nadie más que al humano.
 */
export function contarPendientes(db: DatabaseSync): number {
	const bandeja = bandejaDelHumano(db);
	return bandeja.bloqueadas.length + bandeja.porAprobar.length + bandeja.porRevisar.length;
}
