import type { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { idDeCodigo, leerTarea } from "../db/tareas.ts";
import { ErrorDeRegla } from "../errores.ts";
import { documentoTarea } from "../md/documento.ts";
import { parsearId } from "../md/ids.ts";
import { conErroresDeRegla } from "./errores.ts";

export const NOMBRE = "leer_tarea";

/**
 * `leer_tarea`: el documento entero de la tarea, hilo incluido. Es la llamada
 * más cara en contexto de todas, así que solo se hace cuando se va a trabajar
 * la tarea; para mirar el tablero está `listar_tareas`.
 */
export function registrarHerramientaLeerTarea(server: McpServer, db: DatabaseSync): void {
	server.registerTool(
		NOMBRE,
		{
			title: "Leer tarea",
			description:
				"Devuelve el documento Markdown completo de una tarea: campos, descripción, hijas y el hilo entero de comentarios. Es lo más caro en contexto de todo el servidor: llámala solo cuando vayas a trabajar esa tarea, no para curiosear el tablero.",
			inputSchema: z.object({
				id: z.string().describe("Identificador de la tarea, con la forma T-K7M3XQ."),
			}),
		},
		async ({ id }) =>
			conErroresDeRegla(() => {
				const completa = leerTarea(db, idDeCodigo(db, parsearId(id)));
				if (completa === undefined) {
					throw new ErrorDeRegla("tarea_inexistente", `No existe la tarea ${id}.`);
				}
				return documentoTarea(completa);
			}),
	);
}
