import type { DatabaseSync } from "node:sqlite";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { Config } from "../config.ts";
import { buscarUsuarioPorId, type Usuario } from "../db/consultas.ts";

declare module "hono" {
	interface ContextVariableMap {
		/** Usuario de la sesión. Lo deja `requiereSesion`. */
		usuario: Usuario;
	}
}

/** Lo que necesitan todas las rutas de la web. */
export type DependenciasWeb = {
	db: DatabaseSync;
	config: Config;
};

/** Nombre de la cookie de sesión. */
export const NOMBRE_COOKIE = "sesion";

/** Treinta días, como dice «Sesión y seguridad» en CLAUDE.md. */
export const SEGUNDOS_SESION = 30 * 24 * 60 * 60;

/** `Secure` solo si la web se sirve por https: en http el navegador tiraría la cookie. */
function esSeguro(config: Config): boolean {
	return new URL(config.BASE_URL).protocol === "https:";
}

/**
 * Escribe la cookie firmada. El valor es `<usuarioId>.<caducidad en ms>`: la
 * firma impide falsificarlo y la caducidad se vuelve a comprobar en el
 * servidor, sin fiarse de que el navegador borre la cookie.
 */
export async function iniciarSesion(c: Context, config: Config, usuarioId: number): Promise<void> {
	const caduca = Date.now() + SEGUNDOS_SESION * 1000;
	await setSignedCookie(c, NOMBRE_COOKIE, `${usuarioId}.${caduca}`, config.SESSION_SECRET, {
		path: "/",
		httpOnly: true,
		sameSite: "Lax",
		secure: esSeguro(config),
		maxAge: SEGUNDOS_SESION,
	});
}

/** Borra la cookie de sesión. */
export function cerrarSesion(c: Context, config: Config): void {
	deleteCookie(c, NOMBRE_COOKIE, { path: "/", secure: esSeguro(config) });
}

/** Parte el valor de la cookie y comprueba la caducidad. */
function usuarioDeValor(db: DatabaseSync, valor: string): Usuario | undefined {
	const punto = valor.indexOf(".");
	if (punto < 0) {
		return undefined;
	}
	const usuarioId = Number.parseInt(valor.slice(0, punto), 10);
	const caduca = Number.parseInt(valor.slice(punto + 1), 10);
	if (!Number.isSafeInteger(usuarioId) || !Number.isSafeInteger(caduca) || caduca <= Date.now()) {
		return undefined;
	}
	return buscarUsuarioPorId(db, usuarioId);
}

/**
 * Usuario de la sesión, si la cookie está firmada, no ha caducado y el
 * usuario sigue existiendo. Un usuario borrado deja de tener sesión.
 */
export async function leerSesion(c: Context, { db, config }: DependenciasWeb): Promise<Usuario | undefined> {
	const firmada = await getSignedCookie(c, config.SESSION_SECRET, NOMBRE_COOKIE);
	if (typeof firmada !== "string") {
		return undefined;
	}
	return usuarioDeValor(db, firmada);
}

/**
 * Toda la web exige sesión salvo `/login` y `/salud`. Sin sesión, redirección
 * a `/login` con la ruta a la que se quería ir, para volver después.
 */
export function requiereSesion(deps: DependenciasWeb): MiddlewareHandler {
	return async (c, next) => {
		const usuario = await leerSesion(c, deps);
		if (usuario === undefined) {
			const consulta = new URL(c.req.url).search;
			return c.redirect(`/login?volver=${encodeURIComponent(c.req.path + consulta)}`, 302);
		}
		c.set("usuario", usuario);
		await next();
		return;
	};
}

/** El usuario de la sesión. Solo se llama detrás de `requiereSesion`. */
export function usuarioActual(c: Context): Usuario {
	return c.get("usuario");
}

/**
 * Única protección CSRF de la web: los formularios van con cookie
 * `SameSite=Lax` y el servidor rechaza cualquier POST que el navegador marque
 * como venido de otro sitio.
 */
export function sinCrossSite(): MiddlewareHandler {
	return async (c, next) => {
		if (c.req.method === "POST" && c.req.header("sec-fetch-site") === "cross-site") {
			return c.text("Petición enviada desde otro sitio: rechazada.", 403);
		}
		await next();
		return;
	};
}

/**
 * Destino de una vuelta: tras el login, o tras una acción lanzada desde la
 * bandeja. Solo se acepta una ruta relativa del propio servidor: `//otro.sitio`
 * o una URL absoluta serían un salto abierto. Lo que no valga cae en el destino
 * por defecto de quien pregunta.
 */
export function destinoSeguro(volver: string | undefined, porDefecto = "/tareas"): string {
	if (volver === undefined || !volver.startsWith("/") || volver.startsWith("//")) {
		return porDefecto;
	}
	return volver;
}
