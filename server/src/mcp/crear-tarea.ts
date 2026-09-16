import type { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { crearParte } from "../db/funcionalidades.ts";
import { crearHija, crearPropuesta, idDeCodigo, itemIndiceDe, type Tarea } from "../db/tareas.ts";
import { ErrorDeRegla } from "../errores.ts";
import { formatearId, parsearId } from "../md/ids.ts";
import { lineaIndice } from "../md/indice.ts";
import { conErroresDeRegla } from "./errores.ts";

export const NOMBRE = "crear_tarea";

/** El padre es obligatorio en las clases que cuelgan de otra tarea. */
function exigirPadre(db: DatabaseSync, clase: string, padre: string | undefined): number {
	if (padre === undefined) {
		throw new ErrorDeRegla("padre_obligatorio", `Una tarea de clase «${clase}» necesita el identificador de su padre.`);
	}
	return idDeCodigo(db, parsearId(padre));
}

/**
 * `crear_tarea`: las tres razones por las que un agente crea una tarea van a
 * columnas distintas. Una hija de trabajo nace en `doing` colgando del padre;
 * una propuesta nace en `backlog` para que la decida el humano; una parte nace
 * en `backlog` colgando de la funcionalidad que se está descomponiendo.
 */
export function registrarHerramientaCrearTarea(server: McpServer, db: DatabaseSync, terminalId: number): void {
	server.registerTool(
		NOMBRE,
		{
			title: "Crear tarea",
			description:
				"Crea una tarea: clase «hija» para dejar visible una parte de la ejecución en curso (nace en doing colgando del padre), clase «propuesta» para el trabajo que descubres y que no es de esta tarea (nace en backlog, lo decide el humano) y clase «parte» para cada trozo de la funcionalidad que estás descomponiendo (nace en backlog colgando de ella y hereda sus asignaciones y su rama). Devuelve el id nuevo y su línea de índice.",
			inputSchema: z.object({
				titulo: z.string().min(1, { error: "el título no puede ir vacío" }).describe("Título de la tarea."),
				descripcion: z
					.string()
					.min(1, { error: "la descripción no puede ir vacía" })
					.describe("Qué hay que hacer, en Markdown."),
				clase: z
					.enum(["hija", "propuesta", "parte"])
					.describe(
						"«hija» cuelga de la tarea en curso; «propuesta» va al backlog; «parte» es un trozo de la funcionalidad que estás descomponiendo.",
					),
				padre: z.string().optional().describe("Identificador del padre, obligatorio si la clase es «hija» o «parte»."),
				tipo: z
					.enum(["tarea", "funcionalidad"])
					.optional()
					.describe("Solo en una propuesta: «funcionalidad» cuando lo que descubres es grande y habrá que descomponerlo."),
				dependeDe: z
					.array(z.string())
					.optional()
					.describe(
						"Solo en una parte: identificadores de otras partes de la misma funcionalidad que tienen que ir antes que esta.",
					),
			}),
		},
		async ({ titulo, descripcion, clase, padre, tipo, dependeDe }) =>
			conErroresDeRegla(() => {
				if (tipo !== undefined && clase !== "propuesta") {
					throw new ErrorDeRegla(
						"tipo_no_permitido",
						"El tipo solo se elige en una propuesta: una hija y una parte son siempre tareas normales.",
					);
				}
				if (dependeDe !== undefined && clase !== "parte") {
					throw new ErrorDeRegla(
						"dependencias_no_permitidas",
						"Las dependencias solo se ponen al crear una parte, entre partes de la misma funcionalidad.",
					);
				}
				let creada: Tarea;
				if (clase === "hija") {
					creada = crearHija(db, { titulo, descripcion, padreId: exigirPadre(db, clase, padre), terminalId });
				} else if (clase === "parte") {
					creada = crearParte(db, {
						titulo,
						descripcion,
						padreId: exigirPadre(db, clase, padre),
						terminalId,
						dependeDe: (dependeDe ?? []).map((otra) => idDeCodigo(db, parsearId(otra))),
					});
				} else {
					creada = crearPropuesta(db, { titulo, descripcion, terminalId, tipo });
				}
				return [`creada: ${formatearId(creada.codigo)}`, lineaIndice(itemIndiceDe(db, creada.id))].join("\n");
			}),
	);
}
