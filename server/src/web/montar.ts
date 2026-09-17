import type { Hono } from "hono";
import { html } from "hono/html";
import { registrarEstaticos } from "./estaticos.ts";
import { marcaEntrada, pagina } from "./plantilla.ts";
import { registrarRutasActividad } from "./rutas/actividad.ts";
import { registrarRutasAgentes } from "./rutas/agentes.ts";
import { registrarRutasBandeja } from "./rutas/bandeja.ts";
import { registrarRutasEventos } from "./rutas/eventos.ts";
import { registrarRutasFuncionalidades } from "./rutas/funcionalidades.ts";
import { registrarRutasInformes } from "./rutas/informes.ts";
import { registrarRutasKanban } from "./rutas/kanban.ts";
import { exigeProyecto, registrarRutasProyectos } from "./rutas/proyectos.ts";
import { registrarRutasSesion } from "./rutas/sesion.ts";
import { registrarRutasTareas } from "./rutas/tareas.ts";
import { registrarEnlaceDeConexion, registrarRutasTerminales } from "./rutas/terminales.ts";
import { registrarRutasUsuarios } from "./rutas/usuarios.ts";
import { type DependenciasWeb, requiereSesion, sinCrossSite } from "./sesion.ts";

export type { DependenciasWeb } from "./sesion.ts";

/**
 * Rutas que exigen sesión. `/login` y `/salud` quedan fuera, como dice
 * «Sesión y seguridad» en CLAUDE.md. `/eventos` va con cookie de sesión, como
 * el resto de la web.
 */
const PRIVADAS = [
	// La bandeja del humano, que es la página de inicio.
	"/",
	"/tareas",
	"/tareas/*",
	"/funcionalidades",
	"/informes",
	// Las vistas acotadas a un proyecto: las mismas de arriba bajo `/p/:clave`.
	"/p/*",
	"/proyectos",
	"/proyectos/*",
	"/agentes",
	"/agentes/*",
	"/ir",
	"/terminales",
	"/terminales/*",
	"/usuarios",
	"/usuarios/*",
	"/actividad",
	"/eventos",
];

/** Rutas de la web que aceptan POST y por tanto necesitan el filtro anti cross-site. */
const CON_POST = ["/login", "/logout", ...PRIVADAS];

/**
 * Monta la web entera sobre la app Hono. Es lo único que `app.ts` llama: las
 * rutas, la sesión y los estilos se registran desde aquí.
 */
export function montarWeb(app: Hono, deps: DependenciasWeb): void {
	// El enlace de conexión se abre en la máquina del terminal, donde no hay
	// sesión: se registra antes que el guardián para poder responder sin cookie
	// cuando el token vale, y dejar pasar al login cuando no.
	registrarEnlaceDeConexion(app, deps);

	// Va antes que la sesión: una petición de otro sitio se rechaza aunque no
	// haya cookie, y así el 403 no se convierte en una redirección al login.
	for (const ruta of CON_POST) {
		app.use(ruta, sinCrossSite());
	}
	for (const ruta of PRIVADAS) {
		app.use(ruta, requiereSesion(deps));
	}

	// Detrás de la sesión: deja el proyecto de la URL en el contexto, o responde
	// 404 si la clave no es de ninguno. Las vistas acotadas lo leen de ahí.
	app.use("/p/:clave/*", exigeProyecto(deps));

	// La hoja de estilos, el JavaScript propio y SortableJS.
	registrarEstaticos(app);

	registrarRutasBandeja(app, deps);
	registrarRutasSesion(app, deps);
	registrarRutasEventos(app, deps);
	// El kanban va antes que las rutas de tarea: si no, `/tareas/kanban` se
	// leería como la ficha de una tarea llamada «kanban».
	registrarRutasKanban(app, deps);
	registrarRutasTareas(app, deps);
	registrarRutasFuncionalidades(app, deps);
	registrarRutasInformes(app, deps);
	registrarRutasProyectos(app, deps);
	registrarRutasAgentes(app, deps);
	registrarRutasTerminales(app, deps);
	registrarRutasUsuarios(app, deps);
	registrarRutasActividad(app, deps);

	// Lo que no es un `ErrorDeRegla` es un fallo del servidor: se registra en
	// el log y al navegador solo le llega una página, nunca una traza.
	app.onError((error, c) => {
		console.error(error);
		if (!esDeLaWeb(c.req.path)) {
			return c.text("Internal Server Error", 500);
		}
		// Sin sesión, como el login: una tarjeta centrada. El fallo puede venir de
		// la propia base de datos, así que esta página no lee nada.
		return c.html(
			pagina({
				titulo: "Error",
				usuario: null,
				cuerpo: html`<section class="caja">
					${marcaEntrada()}
					<h1>Algo ha fallado</h1>
					<p>Ha sido en el servidor, no en lo que pediste. Vuelve a intentarlo.</p>
					<p><a class="boton" href="/tareas">Volver a la lista de tareas</a></p>
				</section>`,
			}),
			500,
		);
	});
}

/** El MCP, la API y la skill no son la web: sus fallos siguen respondiendo en texto plano. */
function esDeLaWeb(ruta: string): boolean {
	return ruta !== "/mcp" && ruta !== "/salud" && ruta !== "/skill.md" && !ruta.startsWith("/api/");
}
