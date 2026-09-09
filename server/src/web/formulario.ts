import type { Context } from "hono";
import { esErrorDeRegla } from "../errores.ts";

/**
 * Un formulario ya parseado. Hono devuelve texto o archivos; en esta web
 * todos los campos son de texto, así que lo que no sea texto se ignora.
 */
export type Formulario = Record<string, unknown>;

export async function leerFormulario(c: Context): Promise<Formulario> {
	// `all: true` para que un desplegable de varias opciones (las dependencias)
	// llegue entero y no solo con la última marcada. Los campos de un solo
	// valor siguen llegando como texto.
	return await c.req.parseBody({ all: true });
}

/** Valor de texto de un campo. Un campo ausente es cadena vacía, no `undefined`. */
export function campo(formulario: Formulario, nombre: string): string {
	const valor = formulario[nombre];
	return typeof valor === "string" ? valor : "";
}

/** Texto recortado, o `null` si quedó vacío. Es lo que espera la base de datos. */
export function campoOpcional(formulario: Formulario, nombre: string): string | null {
	const valor = campo(formulario, nombre).trim();
	return valor === "" ? null : valor;
}

/**
 * Lo elegido en un campo que admite varias opciones. Con una sola marcada el
 * valor llega como texto y con varias como lista; sin ninguna, no llega nada.
 */
export function campoLista(formulario: Formulario, nombre: string): string[] {
	const valor = formulario[nombre];
	if (typeof valor === "string") {
		return valor === "" ? [] : [valor];
	}
	if (!Array.isArray(valor)) {
		return [];
	}
	return valor.filter((uno) => typeof uno === "string" && uno !== "");
}

/** Una casilla marcada llega en el cuerpo; una sin marcar no llega. */
export function marcado(formulario: Formulario, nombre: string): boolean {
	return formulario[nombre] !== undefined;
}

/**
 * Código con el que se vuelve a pintar una página cuando la acción rompió una
 * regla: el formulario no se pudo procesar, pero la respuesta sigue siendo la
 * página con su aviso.
 */
export const ESTADO_AVISO = 422;

/**
 * Mensaje de un `ErrorDeRegla`, para enseñarlo tal cual. Cualquier otro error
 * se relanza: es un fallo del servidor, no algo que el humano pueda arreglar
 * desde el formulario.
 */
export function mensajeDeRegla(error: unknown): string {
	if (esErrorDeRegla(error)) {
		return error.message;
	}
	throw error;
}
