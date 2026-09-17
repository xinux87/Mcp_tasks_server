import type { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { Avisador } from "../avisos.ts";
import { type ComentarioDeAgente, comentarAnalisis, comentarioDeAgente, comentarResultado } from "../db/hilo.ts";
import { buscarTarea, type ItemIndice, idDeCodigo, itemIndiceDe, type Tarea } from "../db/tareas.ts";
import { ErrorDeRegla } from "../errores.ts";
import { parsearId } from "../md/ids.ts";
import { lineaIndice } from "../md/indice.ts";
import { conErroresDeRegla } from "./errores.ts";

export const NOMBRE = "comentar_tarea";

/** Los tres tipos de comentario que escribe un agente. `respuesta` es del humano. */
type TipoDeAgente = "analisis" | "comentario" | "resultado";

const ESCRITORES: Record<TipoDeAgente, (db: DatabaseSync, datos: ComentarioDeAgente) => unknown> = {
	analisis: comentarAnalisis,
	comentario: comentarioDeAgente,
	resultado: comentarResultado,
};

/** La funcionalidad de la que cuelga la tarea, si es que cuelga de alguna. */
function funcionalidadDe(db: DatabaseSync, tareaId: number): Tarea | undefined {
	const padreId = buscarTarea(db, tareaId)?.padreId ?? null;
	if (padreId === null) {
		return undefined;
	}
	const padre = buscarTarea(db, padreId);
	return padre?.tipo === "funcionalidad" ? padre : undefined;
}

/**
 * Lo que este comentario deja esperando al humano. Se mira después de escribir,
 * con la tarea ya tal como queda: `done` es una tarea hecha, y la marca
 * «análisis listo» es un análisis (o una descomposición) pendiente de aprobar.
 *
 * `antes` es la funcionalidad de la que cuelga la tarea tal como estaba antes
 * de escribir: si el comentario la cerró en la misma transacción, también se
 * avisa de ella.
 */
function avisarDeLoQueEspera(avisar: Avisador, db: DatabaseSync, item: ItemIndice, antes: Tarea | undefined): void {
	if (item.estado === "done") {
		avisar({ tipo: "hecha", codigo: item.codigo, titulo: item.titulo });
	}
	if (item.marcas.includes("análisis listo")) {
		avisar({
			tipo: item.tipo === "funcionalidad" ? "descomposicion_lista" : "analisis_listo",
			codigo: item.codigo,
			titulo: item.titulo,
		});
	}
	if (antes === undefined || antes.estado === "done") {
		return;
	}
	const despues = funcionalidadDe(db, item.id);
	if (despues !== undefined && despues.estado === "done") {
		avisar({ tipo: "hecha", codigo: despues.codigo, titulo: despues.titulo });
	}
}

/**
 * `comentar_tarea`: añade un comentario al hilo. Cada tipo cierra o no una
 * fase; el estado no se toca a mano, lo mueve el comentario que corresponde.
 */
export function registrarHerramientaComentarTarea(
	server: McpServer,
	db: DatabaseSync,
	terminalId: number,
	avisar: Avisador,
	horasParada: number,
): void {
	server.registerTool(
		NOMBRE,
		{
			title: "Comentar tarea",
			description:
				"Añade un comentario al hilo de la tarea: «analisis» cierra el análisis, «comentario» para contar por dónde vas o contestar al humano, y «resultado» dice qué se construyó y con qué commit, y pasa la tarea a done. Devuelve la línea de índice de la tarea tal como queda.",
			inputSchema: z.object({
				id: z.string().describe("Identificador de la tarea, con la forma T-K7M3XQ."),
				tipo: z.enum(["analisis", "comentario", "resultado"]).describe("Qué clase de comentario se escribe."),
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
				const tareaId = idDeCodigo(db, parsearId(id));
				const funcionalidadAntes = funcionalidadDe(db, tareaId);
				ESCRITORES[tipo](db, { tareaId, terminalId, texto });
				// Escrito y confirmado: ahora sí se avisa de lo que queda esperando.
				const item = itemIndiceDe(db, tareaId, horasParada);
				avisarDeLoQueEspera(avisar, db, item, funcionalidadAntes);
				return [`comentado: ${tipo}`, lineaIndice(item)].join("\n");
			}),
	);
}
