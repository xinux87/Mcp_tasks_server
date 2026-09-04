import type { CallToolResult } from "@modelcontextprotocol/server";
import { esErrorDeRegla } from "../errores.ts";

/**
 * Cuerpo de una herramienta MCP. Todo lo que devuelven es texto Markdown ya
 * renderizado por `src/md/`: ninguna devuelve JSON.
 *
 * Un `ErrorDeRegla` es algo que el agente ha pedido y no se puede hacer con el
 * estado actual de la tarea, así que se le devuelve como resultado de error con
 * `<codigo>: <mensaje>` y él decide qué hacer. Cualquier otro error es un fallo
 * del servidor y se relanza para que lo trate el SDK.
 */
export function conErroresDeRegla(fn: () => string): CallToolResult {
	try {
		return { content: [{ type: "text", text: fn() }] };
	} catch (error) {
		if (esErrorDeRegla(error)) {
			return { content: [{ type: "text", text: `${error.codigo}: ${error.message}` }], isError: true };
		}
		throw error;
	}
}
