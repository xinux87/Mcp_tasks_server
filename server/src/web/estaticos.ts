import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Hono } from "hono";
import { CLIENTE_JS } from "./cliente.ts";
import { CSS } from "./estilos.ts";
import { FAVICON, MARCA } from "./icono.ts";

/** Un día: los estáticos cambian solo cuando cambia la imagen. */
const CACHE = "public, max-age=3600";

/**
 * SortableJS se instala como dependencia npm y se sirve desde `node_modules`.
 * La ruta se resuelve con `createRequire`, que funciona igual desde `src/` y
 * desde `dist/`: en los dos casos sube hasta el `node_modules` del paquete.
 */
function leerSortable(): string {
	const resolver = createRequire(import.meta.url);
	return readFileSync(resolver.resolve("sortablejs/Sortable.min.js"), "utf8");
}

/**
 * Los estáticos de la web: la hoja de estilos, el JavaScript propio y los dos
 * SVG del icono son constantes, y SortableJS se lee una sola vez al montar la
 * web. No hay archivos estáticos en disco, así que el Dockerfile no copia nada
 * más.
 */
export function registrarEstaticos(app: Hono): void {
	const sortable = leerSortable();

	app.get("/static/app.css", (c) =>
		c.body(CSS, 200, {
			"Content-Type": "text/css; charset=utf-8",
			"Cache-Control": CACHE,
		}),
	);

	app.get("/static/app.js", (c) =>
		c.body(CLIENTE_JS, 200, {
			"Content-Type": "application/javascript; charset=utf-8",
			"Cache-Control": CACHE,
		}),
	);

	app.get("/static/sortable.min.js", (c) =>
		c.body(sortable, 200, {
			"Content-Type": "application/javascript; charset=utf-8",
			"Cache-Control": CACHE,
		}),
	);

	for (const [ruta, svg] of [
		["/static/icono.svg", MARCA],
		["/static/favicon.svg", FAVICON],
	] as const) {
		app.get(ruta, (c) =>
			c.body(svg, 200, {
				"Content-Type": "image/svg+xml; charset=utf-8",
				"Cache-Control": CACHE,
			}),
		);
	}
}
