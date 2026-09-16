import type { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { buscarTerminalPorId, guardarUltimaRevision, revisionActual } from "../db/consultas.ts";
import { preguntasContestadasDesde, tareasParaTerminalDesde } from "../db/tareas.ts";
import { salidaNovedades } from "../md/novedades.ts";
import { conErroresDeRegla } from "./errores.ts";

export const NOMBRE = "novedades";

/**
 * `novedades`: la única llamada que hace el agente mientras espera. Devuelve lo
 * que ha cambiado desde la última revisión que vio este terminal: las tareas en
 * `prepared` o `doing` que puede trabajar, las preguntas que le han contestado
 * y la revisión actual.
 *
 * La revisión de partida la recuerda el servidor (`terminales.ultima_revision`)
 * y el propio `novedades` la deja puesta en la que acaba de devolver, así que
 * el bucle no tiene nada que guardar entre vueltas. Quien la pase la usa tal
 * cual, que es lo que permite volver a leer desde un punto anterior.
 *
 * Si no hay nada nuevo, la salida es solo la línea `revision: <n>`.
 */
export function registrarHerramientaNovedades(server: McpServer, db: DatabaseSync, terminalId: number): void {
	server.registerTool(
		NOMBRE,
		{
			title: "Novedades",
			description:
				"Devuelve lo que ha cambiado en el servidor desde la última revisión que vio este terminal: tareas nuevas o cambiadas que puede trabajar, preguntas que le han contestado y la revisión actual. Es la llamada del bucle: sin novedades devuelve solo la revisión. Llámala sin `revision`: el servidor recuerda por dónde iba este terminal.",
			inputSchema: z.object({
				revision: z
					.number()
					.int()
					.min(0)
					.optional()
					.describe("Desde qué revisión leer. Sin ella, la última que el servidor recuerda de este terminal."),
			}),
		},
		async ({ revision }) =>
			conErroresDeRegla(() => {
				const desde = { terminalId, revision: revision ?? buscarTerminalPorId(db, terminalId)?.ultimaRevision ?? 0 };
				const actual = revisionActual(db);
				const salida = salidaNovedades({
					revision: actual,
					tareas: tareasParaTerminalDesde(db, desde),
					preguntas: preguntasContestadasDesde(db, desde),
				});
				// Dejar apuntado por dónde va el terminal es telemetría: no sube el
				// contador, así que llamar dos veces seguidas sin escrituras de
				// contenido devuelve el mismo número.
				guardarUltimaRevision(db, terminalId, actual);
				return salida;
			}),
	);
}
