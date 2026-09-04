import type { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { guardarUltimaRevision, revisionActual } from "../db/consultas.ts";
import { preguntasContestadasDesde, tareasParaTerminalDesde } from "../db/tareas.ts";
import { salidaNovedades } from "../md/novedades.ts";
import { conErroresDeRegla } from "./errores.ts";

export const NOMBRE = "novedades";

/**
 * `novedades`: la única llamada que hace el agente mientras espera. Recibe la
 * última revisión que conoce el terminal y devuelve lo que ha cambiado desde
 * entonces: las tareas en `prepared` o `doing` que este terminal puede
 * trabajar, las preguntas que le han contestado y la revisión actual.
 *
 * Si no hay nada nuevo, la salida es solo la línea `revision: <n>`.
 */
export function registrarHerramientaNovedades(server: McpServer, db: DatabaseSync, terminalId: number): void {
	server.registerTool(
		NOMBRE,
		{
			title: "Novedades",
			description:
				"Devuelve lo que ha cambiado en el servidor desde la revisión que conoce este terminal: tareas nuevas o cambiadas que puede trabajar, preguntas que le han contestado y la revisión actual. Es la llamada del bucle: sin novedades devuelve solo la revisión.",
			inputSchema: z.object({
				revision: z.number().int().min(0).describe("Última revisión que conoce el terminal."),
			}),
		},
		async ({ revision }) =>
			conErroresDeRegla(() => {
				// Guardar la revisión que conoce el terminal es telemetría: no sube
				// el contador, así que llamar dos veces seguidas sin escrituras de
				// contenido devuelve el mismo número.
				guardarUltimaRevision(db, terminalId, revision);
				const desde = { terminalId, revision };
				return salidaNovedades({
					revision: revisionActual(db),
					tareas: tareasParaTerminalDesde(db, desde),
					preguntas: preguntasContestadasDesde(db, desde),
				});
			}),
	);
}
