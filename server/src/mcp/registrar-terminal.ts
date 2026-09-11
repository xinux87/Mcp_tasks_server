import type { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { marcarTerminalConectado, revisionActual } from "../db/consultas.ts";

export const NOMBRE = "registrar_terminal";

/**
 * `registrar_terminal`: lo llama el plugin al arrancar la sesión. No recibe
 * nada; el terminal sale del token. Marca el terminal como conectado y
 * devuelve su nombre, su cuenta y la revisión actual.
 */
export function registrarHerramientaRegistrarTerminal(server: McpServer, db: DatabaseSync, terminalId: number): void {
	server.registerTool(
		NOMBRE,
		{
			title: "Registrar terminal",
			description:
				"Marca este terminal como conectado. Devuelve su nombre, su cuenta de origen, cuántos agentes en paralelo asume y la revisión actual del servidor.",
			inputSchema: z.object({}),
		},
		async () => {
			// Marcar el terminal como conectado es telemetría y no sube la
			// revisión, así que la actual se lee aparte.
			const terminal = marcarTerminalConectado(db, terminalId);
			const revision = revisionActual(db);
			const texto = [
				`terminal: ${terminal.nombre}`,
				`cuenta: ${terminal.cuenta}`,
				// Cuántos subagentes puede lanzar a la vez el bucle. Lo respeta él:
				// el servidor no lo impone al tomar una tarea.
				`agentes: ${terminal.agentes}`,
				`revision: ${revision}`,
			].join("\n");
			return { content: [{ type: "text", text: texto }] };
		},
	);
}
