import type { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { Avisador } from "../avisos.ts";
import { preguntar } from "../db/hilo.ts";
import { idDeCodigo, itemIndiceDe } from "../db/tareas.ts";
import { parsearId } from "../md/ids.ts";
import { lineaIndice } from "../md/indice.ts";
import { conErroresDeRegla } from "./errores.ts";

export const NOMBRE = "preguntar";

/**
 * `preguntar`: el agente manda los campos por separado y el servidor los coloca
 * en el hilo con su formato. La tarea queda `bloqueada` hasta que el humano
 * conteste; la respuesta llega por `novedades`.
 */
export function registrarHerramientaPreguntar(
	server: McpServer,
	db: DatabaseSync,
	terminalId: number,
	avisar: Avisador,
	horasParada: number,
): void {
	server.registerTool(
		NOMBRE,
		{
			title: "Preguntar al humano",
			description:
				"Deja una pregunta con opciones cerradas en el hilo de la tarea y la marca bloqueada hasta que el humano conteste. Se usa para toda decisión que no sea tuya; la pregunta tiene que entenderse sin abrir el repositorio. Devuelve el número de pregunta y la línea de índice de la tarea.",
			inputSchema: z.object({
				id: z.string().describe("Identificador de la tarea, con la forma T-K7M3XQ."),
				pregunta: z.string().min(1, { error: "la pregunta no puede ir vacía" }).describe("Qué se decide, en una frase."),
				porQueImporta: z
					.string()
					.min(1, { error: "«por qué importa» no puede ir vacío" })
					.describe("Por qué importa la decisión, en un párrafo y en términos de negocio."),
				opciones: z
					.array(
						z.object({
							texto: z.string().min(1, { error: "el texto de la opción no puede ir vacío" }),
							consecuencia: z.string().min(1, { error: "la consecuencia no puede ir vacía" }),
						}),
					)
					.min(2, { error: "una pregunta lleva al menos dos opciones, incluida la de no hacer nada" })
					.describe("Opciones cerradas, cada una con su consecuencia. Incluye siempre la de no hacer nada."),
				recomendacion: z
					.string()
					.min(1, { error: "la recomendación no puede ir vacía" })
					.describe("El texto exacto de una de las opciones."),
			}),
		},
		async ({ id, pregunta, porQueImporta, opciones, recomendacion }) =>
			conErroresDeRegla(() => {
				const tareaId = idDeCodigo(db, parsearId(id));
				const creada = preguntar(db, { tareaId, terminalId, pregunta, porQueImporta, opciones, recomendacion });
				const item = itemIndiceDe(db, tareaId, horasParada);
				// La pregunta ya está escrita: el aviso sale fuera de la transacción.
				avisar({ tipo: "pregunta", codigo: item.codigo, titulo: item.titulo, pregunta });
				return [`pregunta: P${creada.numero}`, lineaIndice(item)].join("\n");
			}),
	);
}
