import type { DatabaseSync } from "node:sqlite";
import { createMcpHandler, type McpHttpHandler, McpServer } from "@modelcontextprotocol/server";
import { idTerminalDeAuthInfo } from "../auth/bearer.ts";
import { registrarHerramientaNovedades } from "./novedades.ts";
import { registrarHerramientaRegistrarTerminal } from "./registrar-terminal.ts";

export const NOMBRE_SERVIDOR = "mcp-tareas";
export const VERSION_SERVIDOR = "0.1.0";

/**
 * Handler MCP sin estado: la fábrica corre una vez por petición HTTP y recibe
 * el `authInfo` que le pasa el middleware bearer. Respuestas en modo JSON,
 * porque todas las operaciones son de petición y respuesta.
 */
export function crearHandlerMcp(db: DatabaseSync): McpHttpHandler {
	return createMcpHandler(
		({ authInfo }) => {
			const terminalId = idTerminalDeAuthInfo(authInfo);
			const server = new McpServer({ name: NOMBRE_SERVIDOR, version: VERSION_SERVIDOR });
			registrarHerramientaRegistrarTerminal(server, db, terminalId);
			registrarHerramientaNovedades(server, db, terminalId);
			return server;
		},
		{ responseMode: "json" },
	);
}
