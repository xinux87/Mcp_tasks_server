import type { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { crearHija, crearPropuesta, itemIndiceDe, type Tarea } from "../db/tareas.ts";
import { ErrorDeRegla } from "../errores.ts";
import { formatearId, parsearId } from "../md/ids.ts";
import { lineaIndice } from "../md/indice.ts";
import { conErroresDeRegla } from "./errores.ts";

export const NOMBRE = "crear_tarea";

/**
 * `crear_tarea`: las dos razones por las que un agente crea una tarea van a
 * columnas distintas. Una hija de trabajo nace en `doing` colgando del padre;
 * una propuesta nace en `backlog` para que la decida el humano.
 */
export function registrarHerramientaCrearTarea(server: McpServer, db: DatabaseSync, terminalId: number): void {
	server.registerTool(
		NOMBRE,
		{
			title: "Crear tarea",
			description:
				"Crea una tarea: clase «hija» para dejar visible una parte de la ejecución en curso (nace en doing colgando del padre) y clase «propuesta» para el trabajo que descubres y que no es de esta tarea (nace en backlog, lo decide el humano). Devuelve el id nuevo y su línea de índice.",
			inputSchema: z.object({
				titulo: z.string().min(1, { error: "el título no puede ir vacío" }).describe("Título de la tarea."),
				descripcion: z
					.string()
					.min(1, { error: "la descripción no puede ir vacía" })
					.describe("Qué hay que hacer, en Markdown."),
				clase: z.enum(["hija", "propuesta"]).describe("«hija» cuelga de la tarea en curso; «propuesta» va al backlog."),
				padre: z.string().optional().describe("Identificador del padre, obligatorio si la clase es «hija»."),
			}),
		},
		async ({ titulo, descripcion, clase, padre }) =>
			conErroresDeRegla(() => {
				let creada: Tarea;
				if (clase === "hija") {
					if (padre === undefined) {
						throw new ErrorDeRegla("padre_obligatorio", "Una tarea hija necesita el identificador de su padre.");
					}
					creada = crearHija(db, { titulo, descripcion, padreId: parsearId(padre), terminalId });
				} else {
					creada = crearPropuesta(db, { titulo, descripcion, terminalId });
				}
				return [`creada: ${formatearId(creada.id)}`, lineaIndice(itemIndiceDe(db, creada.id))].join("\n");
			}),
	);
}
