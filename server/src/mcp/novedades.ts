import type { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { guardarUltimaRevision, revisionActual } from "../db/consultas.ts";

export const NOMBRE = "novedades";

/**
 * `novedades`: la única llamada que hace el agente mientras espera. Recibe la
 * última revisión que conoce el terminal, la guarda y devuelve la revisión
 * actual.
 *
 * Punto de extensión: cuando existan las tareas, debajo de la línea
 * `revision: <n>` van los bloques «## Tareas nuevas o cambiadas» y
 * «## Preguntas contestadas» descritos en CLAUDE.md, sección «Salida de
 * novedades». Si no hay novedades la salida sigue siendo solo esa línea.
 */
export function registrarHerramientaNovedades(server: McpServer, db: DatabaseSync, terminalId: number): void {
	server.registerTool(
		NOMBRE,
		{
			title: "Novedades",
			description:
				"Devuelve lo que ha cambiado en el servidor desde la revisión que conoce este terminal, y la revisión actual.",
			inputSchema: z.object({
				revision: z.number().int().min(0).describe("Última revisión que conoce el terminal."),
			}),
		},
		async ({ revision }) => {
			// Guardar la revisión que conoce el terminal es telemetría: no sube
			// el contador, así que llamar dos veces seguidas sin escrituras de
			// contenido devuelve el mismo número.
			guardarUltimaRevision(db, terminalId, revision);
			const actual = revisionActual(db);
			const bloques = [`revision: ${actual}`];
			return { content: [{ type: "text", text: bloques.join("\n\n") }] };
		},
	);
}
