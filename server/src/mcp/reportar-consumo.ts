import type { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { registrarConsumo } from "../db/consumo.ts";
import { bloqueConsumo } from "../md/documento.ts";
import { parsearId } from "../md/ids.ts";
import { conErroresDeRegla } from "./errores.ts";

export const NOMBRE = "reportar_consumo";

/** Las tres cifras vienen de Claude Code y son enteros no negativos. */
const cifra = z.number().int().min(0);

/**
 * `reportar_consumo`: lo que gastó un subagente de fase. Sube la revisión
 * global pero no la de la tarea, para que el agente no reciba su propia tarea
 * como novedad justo después de reportar.
 */
export function registrarHerramientaReportarConsumo(server: McpServer, db: DatabaseSync, terminalId: number): void {
	server.registerTool(
		NOMBRE,
		{
			title: "Reportar consumo",
			description:
				"Suma al consumo de la tarea lo que gastó un subagente de fase. Se llama al terminar cada subagente, copiando tal cual las cifras del aviso de Claude Code: nunca las estimes ni las redondees. Devuelve el consumo acumulado de la tarea.",
			inputSchema: z.object({
				id: z.string().describe("Identificador de la tarea, con la forma T-0042."),
				fase: z.enum(["analisis", "ejecucion"]).describe("Fase a la que se imputa el gasto."),
				modelo: z
					.string()
					.min(1, { error: "el modelo no puede ir vacío" })
					.describe("Modelo con el que corrió el subagente."),
				tokens: cifra.describe("Tokens totales del subagente."),
				herramientas: cifra.describe("Llamadas a herramientas del subagente."),
				duracionMs: cifra.describe("Duración del subagente, en milisegundos."),
			}),
		},
		async ({ id, fase, modelo, tokens, herramientas, duracionMs }) =>
			conErroresDeRegla(() => {
				const consumo = registrarConsumo(db, {
					tareaId: parsearId(id),
					fase,
					modelo,
					terminalId,
					tokens,
					herramientas,
					duracionMs,
				});
				return bloqueConsumo(consumo);
			}),
	);
}
