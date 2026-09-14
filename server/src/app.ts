import type { DatabaseSync } from "node:sqlite";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import type { Hono } from "hono";
import { montarApiUso } from "./api/uso.ts";
import { authInfoDelContexto, bearerTerminal } from "./auth/bearer.ts";
import { crearAvisador, type Enviar } from "./avisos.ts";
import { type Config, HOST_ESCUCHA } from "./config.ts";
import { hostsPermitidos } from "./direcciones.ts";
import { crearHandlerMcp } from "./mcp/handler.ts";
import { montarWeb } from "./web/montar.ts";

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
	/** La configuración entera: la web necesita `SESSION_SECRET` además de `BASE_URL`. */
	config: Config;
	/** Cómo se manda el aviso de `AVISOS_URL`. Solo los tests pasan otra cosa. */
	enviarAviso?: Enviar;
};

export type App = {
	app: Hono;
	/** Cierra el handler MCP: aborta los intercambios en vuelo. */
	cerrar: () => Promise<void>;
};

/**
 * La app Hono del servidor. Monta `/salud`, `/mcp`, `/api/uso` y la web; los
 * eventos SSE llegarán en otro encargo (ver «Un solo proceso, un solo puerto»
 * en CLAUDE.md).
 */
export function crearApp({ db, config, enviarAviso }: OpcionesApp): App {
	const avisar = crearAvisador({ url: config.AVISOS_URL, baseUrl: config.BASE_URL, enviar: enviarAviso });
	const handler = crearHandlerMcp(db, avisar);
	const app = createMcpHonoApp({ host: HOST_ESCUCHA, allowedHosts: hostsPermitidos(config) });

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

	// La API de uso va por HTTP plano y no por MCP porque quien la llama es el
	// script de statusline del plugin, no un agente.
	montarApiUso(app, db);

	montarWeb(app, { db, config });

	return { app, cerrar: () => handler.close() };
}
