import type { DatabaseSync } from "node:sqlite";
import { createMcpHandler, type McpHttpHandler, McpServer } from "@modelcontextprotocol/server";
import { idTerminalDeAuthInfo } from "../auth/bearer.ts";
import type { Avisador } from "../avisos.ts";
import { registrarHerramientaComentarTarea } from "./comentar-tarea.ts";
import { registrarHerramientaCrearTarea } from "./crear-tarea.ts";
import { registrarHerramientaLeerTarea } from "./leer-tarea.ts";
import { registrarHerramientaListarTareas } from "./listar-tareas.ts";
import { registrarHerramientaNovedades } from "./novedades.ts";
import { registrarHerramientaPreguntar } from "./preguntar.ts";
import { registrarHerramientaRegistrarTerminal } from "./registrar-terminal.ts";
import { registrarHerramientaReportarConsumo } from "./reportar-consumo.ts";
import { registrarHerramientaTomarTarea } from "./tomar-tarea.ts";

export const NOMBRE_SERVIDOR = "mcp-tareas";
export const VERSION_SERVIDOR = "0.1.0";

/**
 * Handler MCP sin estado: la fábrica corre una vez por petición HTTP y recibe
 * el `authInfo` que le pasa el middleware bearer. Respuestas en modo JSON,
 * porque todas las operaciones son de petición y respuesta.
 *
 * `avisar` es lo que manda el aviso fuera de la web cuando una herramienta deja
 * algo esperando al humano. Lo usan `preguntar` y `comentar_tarea`.
 */
export function crearHandlerMcp(db: DatabaseSync, avisar: Avisador): McpHttpHandler {
	return createMcpHandler(
		({ authInfo }) => {
			const terminalId = idTerminalDeAuthInfo(authInfo);
			const server = new McpServer({ name: NOMBRE_SERVIDOR, version: VERSION_SERVIDOR });
			registrarHerramientaRegistrarTerminal(server, db, terminalId);
			registrarHerramientaNovedades(server, db, terminalId);
			registrarHerramientaListarTareas(server, db, terminalId);
			registrarHerramientaLeerTarea(server, db);
			registrarHerramientaTomarTarea(server, db, terminalId);
			registrarHerramientaComentarTarea(server, db, terminalId, avisar);
			registrarHerramientaCrearTarea(server, db, terminalId);
			registrarHerramientaPreguntar(server, db, terminalId, avisar);
			registrarHerramientaReportarConsumo(server, db, terminalId);
			return server;
		},
		{ responseMode: "json" },
	);
}
