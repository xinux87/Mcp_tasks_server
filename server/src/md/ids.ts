import { ErrorDeRegla } from "../errores.ts";

/** Forma de un identificador de tarea: `T-` y al menos cuatro cifras. */
const FORMA_ID = /^T-(\d{4,})$/;

/** Convierte el número de fila en el identificador visible: 42 → `T-0042`. */
export function formatearId(n: number): string {
	return `T-${String(n).padStart(4, "0")}`;
}

/**
 * Convierte el identificador visible en el número de fila: `T-0042` → 42.
 * Lanza `ErrorDeRegla` si el formato no es válido, porque quien lo pasa mal
 * es siempre un agente y el mensaje se le enseña tal cual.
 */
export function parsearId(id: string): number {
	const encaje = FORMA_ID.exec(id);
	const cifras = encaje?.[1];
	if (cifras === undefined) {
		throw new ErrorDeRegla("id_invalido", `«${id}» no es un identificador de tarea; tiene la forma T-0042.`);
	}
	return Number.parseInt(cifras, 10);
}
