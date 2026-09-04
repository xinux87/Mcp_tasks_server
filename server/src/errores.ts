/**
 * Error de regla: lo que se pide no está permitido con el estado actual de la
 * tarea. El `codigo` identifica la regla en snake_case y el mensaje está
 * escrito en español para poder enseñárselo al agente tal cual, sin traducir.
 */
export class ErrorDeRegla extends Error {
	readonly codigo: string;

	constructor(codigo: string, mensaje: string) {
		super(mensaje);
		this.name = "ErrorDeRegla";
		this.codigo = codigo;
	}
}

/** Distingue un error de regla de un fallo del servidor. */
export function esErrorDeRegla(error: unknown): error is ErrorDeRegla {
	return error instanceof ErrorDeRegla;
}
