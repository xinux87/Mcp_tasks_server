import type { DatabaseSync } from "node:sqlite";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import type { Hono } from "hono";
import { authInfoDelContexto, bearerTerminal } from "./auth/bearer.ts";
import { HOST_ESCUCHA, hostsPermitidos } from "./config.ts";
import { crearHandlerMcp } from "./mcp/handler.ts";

declare module "hono" {
	interface ContextVariableMap {
		/**
		 * Cuerpo JSON ya parseado. Lo deja el middleware que instala
		 * `createMcpHonoApp`, y se le pasa al handler MCP para que no vuelva
		 * a leer el cuerpo de la petición.
		 */
		parsedBody: unknown;
	}
}

export type OpcionesApp = {
	db: DatabaseSync;
	baseUrl: string;
};

export type App = {
	app: Hono;
	/** Cierra el handler MCP: aborta los intercambios en vuelo. */
	cerrar: () => Promise<void>;
};

/**
 * La app Hono del servidor. De momento monta `/salud` y `/mcp`; la API de uso,
 * los eventos y la web llegarán en otros encargos (ver «Un solo proceso, un
 * solo puerto» en CLAUDE.md).
 */
export function crearApp({ db, baseUrl }: OpcionesApp): App {
	const handler = crearHandlerMcp(db);
	const app = createMcpHonoApp({ host: HOST_ESCUCHA, allowedHosts: hostsPermitidos(baseUrl) });

	// Comprobación de vida para Docker. Sin autenticación.
	app.get("/salud", (c) => c.json({ ok: true }));

	// El bearer va delante del handler: sin token válido no se construye
	// ningún servidor MCP.
	app.all("/mcp", bearerTerminal(db), async (c) => {
		return await handler.fetch(c.req.raw, {
			authInfo: authInfoDelContexto(c),
			parsedBody: c.get("parsedBody"),
		});
	});

	return { app, cerrar: () => handler.close() };
}
