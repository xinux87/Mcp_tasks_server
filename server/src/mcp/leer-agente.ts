import type { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { exigirAgentePorNombre, terminalDeAgente } from "../db/agentes.ts";
import { documentoAgente } from "../md/documento.ts";
import { conErroresDeRegla } from "./errores.ts";

export const NOMBRE = "leer_agente";

/**
 * `leer_agente`: el papel entero de un agente. El bucle la llama antes de
 * lanzar la fase que lleva agente y pone lo devuelto al principio del prompt
 * del subagente. Es de solo lectura y no está acotada al proyecto del
 * terminal: un papel no es de ningún repositorio.
 */
export function registrarHerramientaLeerAgente(server: McpServer, db: DatabaseSync): void {
	server.registerTool(
		NOMBRE,
		{
			title: "Leer agente",
			description:
				"Devuelve el papel de un agente: quién es, cómo trabaja y con qué modelo. Llámala cuando la fase que vas a lanzar lleve agente y pon lo que devuelve al principio del prompt del subagente.",
			inputSchema: z.object({
				nombre: z.string().describe("Nombre del agente, en minúsculas con guiones: revisor, implementador-web."),
			}),
		},
		async ({ nombre }) =>
			conErroresDeRegla(() => {
				const agente = exigirAgentePorNombre(db, nombre);
				return documentoAgente(agente, terminalDeAgente(db, agente));
			}),
	);
}
