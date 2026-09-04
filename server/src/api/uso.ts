import { Buffer } from "node:buffer";
import type { DatabaseSync } from "node:sqlite";
import type { Hono } from "hono";
import { bearerTerminal } from "../auth/bearer.ts";
import { guardarUso } from "../db/consultas.ts";

/** Ruta de la API, fuera del MCP: la llama un script de shell, no un agente. */
export const RUTA = "/api/uso";

/**
 * Tope del cuerpo. El JSON que Claude Code pasa a la statusline son unos pocos
 * cientos de bytes; 64 KB deja sitio de sobra y evita que un script roto llene
 * la base de datos.
 */
export const MAXIMO_BYTES = 64 * 1024;

/** Solo se guarda un objeto JSON: ni una lista, ni un número, ni texto suelto. */
function esObjetoJson(cuerpo: string): boolean {
	try {
		const valor: unknown = JSON.parse(cuerpo);
		return typeof valor === "object" && valor !== null && !Array.isArray(valor);
	} catch {
		return false;
	}
}

/**
 * `POST /api/uso`: recibe el JSON de la statusline del plugin y lo guarda tal
 * cual en el terminal autenticado por bearer. Responde 204 sin cuerpo: quien
 * llama es un script y no tiene nada que leer.
 */
export function montarApiUso(app: Hono, db: DatabaseSync): void {
	app.post(RUTA, bearerTerminal(db), async (c) => {
		const cuerpo = await c.req.text();
		if (Buffer.byteLength(cuerpo, "utf8") > MAXIMO_BYTES) {
			return c.json({ error: "cuerpo demasiado grande" }, 413);
		}
		if (!esObjetoJson(cuerpo)) {
			return c.json({ error: "cuerpo inválido" }, 400);
		}
		// Es telemetría: se guarda en su propia transacción, sin tocar la
		// revisión global.
		guardarUso(db, c.get("terminal").id, cuerpo);
		return c.body(null, 204);
	});
}
