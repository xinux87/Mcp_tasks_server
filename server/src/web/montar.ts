import type { Hono } from "hono";
import { html } from "hono/html";
import { registrarEstaticos } from "./estaticos.ts";
import { pagina } from "./plantilla.ts";
import { registrarRutasEventos } from "./rutas/eventos.ts";
import { registrarRutasKanban } from "./rutas/kanban.ts";
import { registrarRutasSesion } from "./rutas/sesion.ts";
import { registrarRutasTareas } from "./rutas/tareas.ts";
import { registrarRutasTerminales } from "./rutas/terminales.ts";
import { registrarRutasUsuarios } from "./rutas/usuarios.ts";
import { type DependenciasWeb, requiereSesion, sinCrossSite } from "./sesion.ts";

export type { DependenciasWeb } from "./sesion.ts";

/**
 * Rutas que exigen sesión. `/login` y `/salud` quedan fuera, como dice
 * «Sesión y seguridad» en CLAUDE.md. `/eventos` va con cookie de sesión, como
 * el resto de la web.
 */
const PRIVADAS = ["/tareas", "/tareas/*", "/terminales", "/terminales/*", "/usuarios", "/usuarios/*", "/eventos"];

/** Rutas de la web que aceptan POST y por tanto necesitan el filtro anti cross-site. */
const CON_POST = ["/login", "/logout", ...PRIVADAS];

/**
 * Monta la web entera sobre la app Hono. Es lo único que `app.ts` llama: las
 * rutas, la sesión y los estilos se registran desde aquí.
 */
export function montarWeb(app: Hono, deps: DependenciasWeb): void {
	// Va antes que la sesión: una petición de otro sitio se rechaza aunque no
	// haya cookie, y así el 403 no se convierte en una redirección al login.
	for (const ruta of CON_POST) {
		app.use(ruta, sinCrossSite());
	}
	for (const ruta of PRIVADAS) {
		app.use(ruta, requiereSesion(deps));
	}

	// La hoja de estilos, el JavaScript propio y SortableJS.
	registrarEstaticos(app);

	app.get("/", (c) => c.redirect("/tareas", 302));

	registrarRutasSesion(app, deps);
	registrarRutasEventos(app, deps);
	// El kanban va antes que las rutas de tarea: si no, `/tareas/kanban` se
	// leería como la ficha de una tarea llamada «kanban».
	registrarRutasKanban(app, deps);
	registrarRutasTareas(app, deps);
	registrarRutasTerminales(app, deps);
	registrarRutasUsuarios(app, deps);

	// Lo que no es un `ErrorDeRegla` es un fallo del servidor: se registra en
	// el log y al navegador solo le llega una página, nunca una traza.
	app.onError((error, c) => {
		console.error(error);
		if (!esDeLaWeb(c.req.path)) {
			return c.text("Internal Server Error", 500);
		}
		return c.html(
			pagina({
				titulo: "Error",
				usuario: null,
				aviso: "Algo ha fallado en el servidor. Vuelve a intentarlo.",
				cuerpo: html`<p><a href="/tareas">Volver a la lista de tareas</a></p>`,
			}),
			500,
		);
	});
}

/** El MCP y la API no son la web: sus fallos siguen respondiendo en texto plano. */
function esDeLaWeb(ruta: string): boolean {
	return ruta !== "/mcp" && ruta !== "/salud" && !ruta.startsWith("/api/");
}
