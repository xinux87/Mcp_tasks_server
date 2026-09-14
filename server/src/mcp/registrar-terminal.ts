import type { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { registrarTerminal, revisionActual } from "../db/consultas.ts";
import { conErroresDeRegla } from "./errores.ts";

export const NOMBRE = "registrar_terminal";

/**
 * `registrar_terminal`: lo llama el plugin al arrancar la sesión. El terminal
 * sale del token; lo que recibe es dónde está trabajando, que el bucle conoce
 * sin preguntar a nadie. Marca el terminal como conectado y devuelve su
 * nombre, su cuenta, su proyecto y la revisión actual.
 */
export function registrarHerramientaRegistrarTerminal(server: McpServer, db: DatabaseSync, terminalId: number): void {
	server.registerTool(
		NOMBRE,
		{
			title: "Registrar terminal",
			description:
				"Marca este terminal como conectado. Recibe la carpeta en la que trabaja el bucle y la URL del remote de git, si es un repositorio. Devuelve su nombre, su cuenta de origen, cuántos agentes en paralelo asume, el proyecto con su clave y su nombre, la rama principal del proyecto, su comando de verificación si lo tiene, y la revisión actual del servidor. Si el repositorio no es el del proyecto, falla con `proyecto_no_coincide` y la sesión para aquí.",
			inputSchema: z.object({
				ruta: z.string().optional().describe("La carpeta local en la que trabaja este terminal."),
				repositorio: z.string().optional().describe("La URL del remote de git de esa carpeta, si es un repositorio."),
			}),
		},
		async ({ ruta, repositorio }) =>
			conErroresDeRegla(() => {
				// Registrar el terminal es telemetría y no sube la revisión, así que
				// la actual se lee aparte.
				const { terminal, proyecto } = registrarTerminal(db, terminalId, { ruta, repositorio });
				const revision = revisionActual(db);
				const lineas = [
					`terminal: ${terminal.nombre}`,
					`cuenta: ${terminal.cuenta}`,
					// Cuántos subagentes puede lanzar a la vez el bucle. Lo respeta él:
					// el servidor no lo impone al tomar una tarea.
					`agentes: ${terminal.agentes}`,
					`proyecto: ${proyecto.clave} · ${proyecto.nombre}`,
					`rama principal: ${proyecto.ramaPrincipal}`,
				];
				// El comando de verificación solo si el proyecto lo tiene: sin él, el
				// agente de integración pasa la que encuentre en el repositorio.
				if (proyecto.verificacion !== null) {
					lineas.push(`verificacion: ${proyecto.verificacion}`);
				}
				lineas.push(`revision: ${revision}`);
				return lineas.join("\n");
			}),
	);
}
