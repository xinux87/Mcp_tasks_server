import type { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { type Estado, type ItemIndice, listarTareas, proyectoDeTerminal } from "../db/tareas.ts";
import { lineaIndice } from "../md/indice.ts";
import { conErroresDeRegla } from "./errores.ts";

export const NOMBRE = "listar_tareas";

/**
 * Orden en el que el agente quiere ver el tablero: primero lo empezado, luego
 * lo que puede empezar, y al final lo que no es suyo todavía o ya está hecho.
 * No es el orden de las columnas del kanban, que es el de la web.
 */
const PRIORIDAD: Record<Estado, number> = { doing: 0, prepared: 1, backlog: 2, done: 3, finished: 4 };

function porPrioridad(items: ItemIndice[]): ItemIndice[] {
	// `listarTareas` ya devuelve ordenado por `orden` dentro de cada columna y
	// `sort` es estable, así que reordenar por estado lo conserva.
	return [...items].sort((uno, otro) => PRIORIDAD[uno.estado] - PRIORIDAD[otro.estado]);
}

/**
 * `listar_tareas`: el índice del tablero, una línea por tarea. Nunca devuelve
 * el cuerpo ni el hilo, para que mirar el tablero cueste poco contexto.
 *
 * Está acotada al proyecto del terminal, como `novedades` y `tomar_tarea`: el
 * agente no sabe que hay proyectos, solo ve el suyo.
 */
export function registrarHerramientaListarTareas(
	server: McpServer,
	db: DatabaseSync,
	terminalId: number,
	horasParada: number,
): void {
	server.registerTool(
		NOMBRE,
		{
			title: "Listar tareas",
			description:
				"Índice del tablero: una línea por tarea con su estado, sus marcas, su título y sus asignaciones. Se usa para ver de un vistazo qué hay, sin gastar contexto en los hilos.",
			inputSchema: z.object({
				estado: z
					.enum(["backlog", "prepared", "doing", "done", "finished"])
					.optional()
					.describe("Deja solo las tareas de esa columna."),
				soloMias: z.boolean().optional().describe("Deja solo las tareas en las que este terminal analiza o ejecuta."),
			}),
		},
		async ({ estado, soloMias }) =>
			conErroresDeRegla(() => {
				const items = porPrioridad(
					listarTareas(
						db,
						{
							estado,
							terminalId: soloMias === true ? terminalId : undefined,
							proyectoId: proyectoDeTerminal(db, terminalId),
						},
						horasParada,
					),
				);
				return items.length === 0 ? "Ninguna." : items.map(lineaIndice).join("\n");
			}),
	);
}
