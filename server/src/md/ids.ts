import { randomInt } from "node:crypto";
import { ErrorDeRegla } from "../errores.ts";

/**
 * Forma de un identificador de tarea: `T-` y de cuatro a ocho caracteres. Es
 * ancha a propósito: los códigos nuevos son de seis caracteres del alfabeto de
 * abajo, y las tareas anteriores conservan su número de cuatro cifras.
 */
const FORMA_ID = /^T-([0-9A-Z]{4,8})$/;

/**
 * Los caracteres con los que se sortea un código: sin `0`, `1`, `I`, `L` ni
 * `O`, que se confunden al leerlos o al dictarlos.
 */
const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Cuántos caracteres tiene un código nuevo. 31^6 son casi novecientos millones. */
const LARGO = 6;

/** Convierte el código en el identificador visible: `K7M3XQ` → `T-K7M3XQ`. */
export function formatearId(codigo: string): string {
	return `T-${codigo}`;
}

/**
 * Un código nuevo, al azar. La unicidad la garantiza el índice único de
 * `tareas.codigo`: quien inserta reintenta si choca.
 */
export function generarCodigo(): string {
	let codigo = "";
	for (let posicion = 0; posicion < LARGO; posicion += 1) {
		codigo += ALFABETO[randomInt(ALFABETO.length)];
	}
	return codigo;
}

/**
 * Convierte el identificador visible en el código de la tarea: `T-K7M3XQ` →
 * `K7M3XQ`. Lanza `ErrorDeRegla` si el formato no es válido, porque quien lo
 * pasa mal es siempre un agente y el mensaje se le enseña tal cual.
 */
export function parsearId(id: string): string {
	const codigo = FORMA_ID.exec(id)?.[1];
	if (codigo === undefined) {
		throw new ErrorDeRegla("id_invalido", `«${id}» no es un identificador de tarea; tiene la forma T-K7M3XQ.`);
	}
	return codigo;
}

/**
 * El mismo código, pero `null` cuando no tiene la forma buena. Es lo que
 * necesitan los filtros y los desplegables de la web: un valor que no encaja no
 * es un error del que avisar, simplemente no selecciona nada.
 */
export function idONull(id: string): string | null {
	return FORMA_ID.exec(id)?.[1] ?? null;
}
