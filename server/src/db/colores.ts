import type { DatabaseSync } from "node:sqlite";
import { ErrorDeRegla } from "../errores.ts";
import { entero, sentencia, texto } from "./base.ts";

/**
 * Los ocho colores de etiqueta que puede llevar un usuario, en su orden. El
 * noveno color de la paleta, el gris, no está: es el de quien no tiene color,
 * es decir los agentes y los usuarios borrados.
 *
 * El orden importa dos veces: es el que se enseña en el formulario y el que
 * decide el empate al repartir el color menos usado.
 */
export const COLORES_USUARIO = ["azul", "verde", "morado", "naranja", "rosa", "amarillo", "rojo", "marron"] as const;

export type ColorUsuario = (typeof COLORES_USUARIO)[number];

export function esColorUsuario(valor: string): valor is ColorUsuario {
	const nombres: readonly string[] = COLORES_USUARIO;
	return nombres.includes(valor);
}

/** Cuántos usuarios lleva cada color ahora mismo. */
function usosPorColor(db: DatabaseSync): Map<string, number> {
	const usos = new Map<string, number>();
	for (const fila of sentencia(db, "SELECT color, COUNT(*) AS total FROM usuarios GROUP BY color").all()) {
		usos.set(texto(fila, "color"), entero(fila, "total"));
	}
	return usos;
}

/**
 * El color que se asigna a quien no elige ninguno: el menos usado y, en
 * empate, el primero de la lista. Con menos de ocho usuarios eso reparte un
 * color distinto a cada uno.
 */
export function colorMenosUsado(db: DatabaseSync): ColorUsuario {
	const usos = usosPorColor(db);
	let elegido: ColorUsuario = COLORES_USUARIO[0];
	let minimo = usos.get(elegido) ?? 0;
	for (const color of COLORES_USUARIO) {
		const veces = usos.get(color) ?? 0;
		// Solo con `<`: el empate lo gana el que ya estaba, que es el primero.
		if (veces < minimo) {
			elegido = color;
			minimo = veces;
		}
	}
	return elegido;
}

/**
 * El color que se guarda: el que se eligió, si existe, o el menos usado cuando
 * no se eligió ninguno. Es la única puerta por la que entra un color.
 */
export function colorElegido(conexion: DatabaseSync, color: string | undefined): ColorUsuario {
	if (color === undefined) {
		return colorMenosUsado(conexion);
	}
	if (!esColorUsuario(color)) {
		throw new ErrorDeRegla("color_invalido", `«${color}» no es un color de usuario; son ${COLORES_USUARIO.join(", ")}.`);
	}
	return color;
}
