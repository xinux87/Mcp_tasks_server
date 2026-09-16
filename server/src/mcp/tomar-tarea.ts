import type { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { idDeCodigo, itemIndiceDe, tomarTarea } from "../db/tareas.ts";
import { parsearId } from "../md/ids.ts";
import { lineaIndice } from "../md/indice.ts";
import { conErroresDeRegla } from "./errores.ts";

export const NOMBRE = "tomar_tarea";

/**
 * `tomar_tarea`: este terminal se hace responsable de una fase. Falla si esa
 * fase ya tiene otro terminal: no hay robo silencioso de tareas. El modelo con
 * el que se va a trabajar queda fijado aquí, para que el autor de los
 * comentarios y el consumo cuenten lo mismo.
 */
export function registrarHerramientaTomarTarea(server: McpServer, db: DatabaseSync, terminalId: number): void {
	server.registerTool(
		NOMBRE,
		{
			title: "Tomar tarea",
			description:
				"Hace a este terminal responsable de una fase de la tarea y la marca «en marcha»; con fase «ejecucion» la tarea pasa además a doing. Llámala antes de ponerte a trabajar. Devuelve la línea de índice de la tarea tal como queda.",
			inputSchema: z.object({
				id: z.string().describe("Identificador de la tarea, con la forma T-K7M3XQ."),
				fase: z.enum(["analisis", "ejecucion"]).describe("Fase que se toma."),
				modelo: z
					.string()
					.min(1, { error: "el modelo no puede ir vacío" })
					.optional()
					.describe(
						"Modelo con el que vas a trabajar esta fase. Si la fase no tenía modelo asignado, queda fijado el que mandes; si tenía otro distinto, la toma falla con modelo_no_coincide.",
					),
			}),
		},
		async ({ id, fase, modelo }) =>
			conErroresDeRegla(() => {
				const tarea = tomarTarea(db, { tareaId: idDeCodigo(db, parsearId(id)), fase, terminalId, modelo });
				return [`tomada: ${fase}`, lineaIndice(itemIndiceDe(db, tarea.id))].join("\n");
			}),
	);
}
