import type { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { type ComentarioDeAgente, comentarAnalisis, comentarAvance, comentarResultado } from "../db/hilo.ts";
import { itemIndiceDe } from "../db/tareas.ts";
import { ErrorDeRegla } from "../errores.ts";
import { parsearId } from "../md/ids.ts";
import { lineaIndice } from "../md/indice.ts";
import { conErroresDeRegla } from "./errores.ts";

export const NOMBRE = "comentar_tarea";

/** Los tres tipos de comentario que escribe un agente. Los otros tres son del humano. */
type TipoDeAgente = "analisis" | "avance" | "resultado";

const ESCRITORES: Record<TipoDeAgente, (db: DatabaseSync, datos: ComentarioDeAgente) => unknown> = {
	analisis: comentarAnalisis,
	avance: comentarAvance,
	resultado: comentarResultado,
};

/**
 * `comentar_tarea`: añade un comentario al hilo. Cada tipo cierra o no una
 * fase; el estado no se toca a mano, lo mueve el comentario que corresponde.
 */
export function registrarHerramientaComentarTarea(server: McpServer, db: DatabaseSync, terminalId: number): void {
	server.registerTool(
		NOMBRE,
		{
			title: "Comentar tarea",
			description:
				"Añade un comentario al hilo de la tarea: «analisis» cierra el análisis, «avance» cuenta por dónde va la ejecución y «resultado» dice qué se construyó y con qué commit, y pasa la tarea a done. Devuelve la línea de índice de la tarea tal como queda.",
			inputSchema: z.object({
				id: z.string().describe("Identificador de la tarea, con la forma T-0042."),
				tipo: z.enum(["analisis", "avance", "resultado"]).describe("Qué clase de comentario se escribe."),
				texto: z
					.string()
					.min(1, { error: "el texto del comentario no puede ir vacío" })
					.describe("El comentario, en Markdown."),
				estado: z
					.literal("done")
					.optional()
					.describe("Solo se admite «done», y solo con tipo «resultado», que ya lo pone por sí mismo."),
			}),
		},
		async ({ id, tipo, texto, estado }) =>
			conErroresDeRegla(() => {
				// `resultado` pasa la tarea a `done` con este parámetro o sin él;
				// con cualquier otro tipo, pedir un estado es un error del agente.
				if (estado !== undefined && tipo !== "resultado") {
					throw new ErrorDeRegla(
						"estado_no_permitido",
						`Un comentario de tipo ${tipo} no cambia el estado: solo «resultado» pasa la tarea a done.`,
					);
				}
				const tareaId = parsearId(id);
				ESCRITORES[tipo](db, { tareaId, terminalId, texto });
				return [`comentado: ${tipo}`, lineaIndice(itemIndiceDe(db, tareaId))].join("\n");
			}),
	);
}
