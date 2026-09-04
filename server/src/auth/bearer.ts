import type { DatabaseSync } from "node:sqlite";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type { Context, MiddlewareHandler } from "hono";
import type { Terminal } from "../db/consultas.ts";
import { buscarTerminalPorToken } from "./tokens.ts";

declare module "hono" {
	interface ContextVariableMap {
		/** Terminal autenticado por el bearer token de la petición. */
		terminal: Terminal;
		/** El token en claro que vino en la cabecera, para pasarlo en `authInfo`. */
		tokenTerminal: string;
	}
}

/** Extrae el token de una cabecera `Authorization: Bearer <token>`. */
export function extraerBearer(cabecera: string | undefined): string | undefined {
	if (cabecera === undefined) {
		return undefined;
	}
	const separador = cabecera.indexOf(" ");
	if (separador < 0) {
		return undefined;
	}
	if (cabecera.slice(0, separador).toLowerCase() !== "bearer") {
		return undefined;
	}
	const token = cabecera.slice(separador + 1).trim();
	return token.length === 0 ? undefined : token;
}

/**
 * Middleware que autentica el terminal por bearer token. Va delante del
 * handler MCP: sin token válido la petición no llega al SDK.
 */
export function bearerTerminal(db: DatabaseSync): MiddlewareHandler {
	return async (c, next) => {
		const token = extraerBearer(c.req.header("authorization"));
		if (token !== undefined) {
			const terminal = buscarTerminalPorToken(db, token);
			if (terminal !== undefined) {
				c.set("terminal", terminal);
				c.set("tokenTerminal", token);
				await next();
				return;
			}
		}
		return c.json({ error: "no autorizado" }, 401, { "WWW-Authenticate": "Bearer" });
	};
}

/** Clave con la que viaja el id del terminal dentro de `authInfo.extra`. */
export const CLAVE_TERMINAL = "terminalId";

/** Construye el `authInfo` que se le pasa al handler MCP. */
export function authInfoDelContexto(c: Context): AuthInfo {
	const terminal = c.get("terminal");
	return {
		token: c.get("tokenTerminal"),
		clientId: `terminal:${terminal.id}`,
		scopes: [],
		extra: { [CLAVE_TERMINAL]: terminal.id },
	};
}

/** Lee el id del terminal de un `authInfo`. Lanza si no viene: el middleware lo garantiza. */
export function idTerminalDeAuthInfo(authInfo: AuthInfo | undefined): number {
	const valor = authInfo?.extra?.[CLAVE_TERMINAL];
	if (typeof valor !== "number") {
		throw new Error("la petición llegó al MCP sin terminal autenticado");
	}
	return valor;
}
