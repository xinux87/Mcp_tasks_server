import { html } from "hono/html";
import type { Usuario } from "../db/consultas.ts";
import type { Estado, Marca, TipoTarea } from "../db/tareas.ts";

/**
 * Lo que devuelve la plantilla `html` de Hono: HTML con cada interpolación ya
 * escapada. Es el único tipo que viaja como cuerpo entre las funciones de la
 * web; nunca se concatenan cadenas a mano.
 */
export type Html = ReturnType<typeof html>;

/**
 * Lo que devuelve `c.html(...)`: la plantilla puede resolverse ya o quedar
 * pendiente, así que la respuesta puede ser una promesa. Hono acepta las dos.
 */
export type RespuestaHtml = Response | Promise<Response>;

/** Nombre del proyecto, tal como aparece en la cabecera y en el título. */
export const NOMBRE_PROYECTO = "MCP Tareas";

/** Las cinco columnas del kanban, en su orden, con el título que se enseña. */
export const COLUMNAS: readonly { estado: Estado; titulo: string }[] = [
	{ estado: "backlog", titulo: "Backlog" },
	{ estado: "prepared", titulo: "Preparadas" },
	{ estado: "doing", titulo: "En curso" },
	{ estado: "done", titulo: "Hechas" },
	{ estado: "finished", titulo: "Cerradas" },
];

/** Sugerencias de modelo del formulario de tarea. No es una lista cerrada. */
export const MODELOS_SUGERIDOS: readonly string[] = ["opus", "sonnet", "haiku", "fable"];

/**
 * Clase CSS de cada marca. Las marcas llevan espacios y tildes, así que no se
 * pueden meter en un nombre de clase tal cual.
 */
const CLASE_MARCA: Record<Marca, string> = {
	bloqueada: "bloqueada",
	"sin terminal": "sin-terminal",
	"en marcha": "en-marcha",
	"análisis listo": "analisis-listo",
};

/** Badge de estado. El valor viene de un conjunto cerrado, así que sirve de clase. */
export function insigniaEstado(estado: Estado): Html {
	return html`<span class="insignia estado-${estado}">${estado}</span>`;
}

/** Badges de las marcas activas de una tarea, en su orden. */
export function insigniasMarcas(marcas: readonly Marca[]): Html {
	return html`${marcas.map((marca) => html`<span class="insignia marca-${CLASE_MARCA[marca]}">${marca}</span>`)}`;
}

/** Badge del tipo de un comentario del hilo. Los seis tipos son un conjunto cerrado. */
export function insigniaTipo(tipo: string): Html {
	return html`<span class="insignia tipo-${tipo}">${tipo}</span>`;
}

/**
 * Badge del tipo de la tarea. Solo se pinta en las preguntas: `tarea` es lo
 * normal y decirlo en cada tarjeta no aportaría nada.
 */
export function insigniaTipoTarea(tipo: TipoTarea): Html {
	return tipo === "pregunta" ? html`<span class="insignia tipo-pregunta">pregunta</span>` : html``;
}

export type OpcionesPagina = {
	titulo: string;
	/** Quién mira. Sin sesión (la pantalla de login) no hay navegación. */
	usuario: Usuario | null;
	/** Mensaje de un `ErrorDeRegla` o confirmación, tal cual. */
	aviso?: string | null;
	/**
	 * Qué vista es, para el cliente: `lista`, `kanban`, `ficha`, `terminales`
	 * o el nombre de la página. Cada una se refresca de una manera.
	 */
	vista?: string;
	/**
	 * Revisión global de la que parte el cliente. Solo la pasan las páginas
	 * que se refrescan en vivo; sin ella el cliente no abre el SSE.
	 */
	revision?: number;
	cuerpo: Html;
};

function navegacion(usuario: Usuario | null): Html {
	if (usuario === null) {
		return html``;
	}
	// Las dos vistas de las mismas tareas van juntas y siempre visibles: son
	// la misma sección, no dos sitios distintos.
	return html`<nav class="navegacion">
			<span class="par">
				Tareas <a href="/tareas">Lista</a> <a href="/tareas/kanban">Kanban</a>
			</span>
			<a href="/terminales">Terminales</a>
			<a href="/usuarios">Usuarios</a>
			<form method="post" action="/logout" class="en-linea">
				<button type="submit" class="enlace">Salir</button>
			</form>
			<span class="quien">${usuario.nombre}</span>
		</nav>`;
}

/**
 * Los `data-` del `<body>`: la vista siempre, y la revisión solo donde el
 * refresco en vivo tiene sentido. El cliente no hace nada sin ellos.
 */
function atributosCuerpo(vista: string | undefined, revision: number | undefined): Html {
	const cual = html` data-vista="${vista ?? "otra"}"`;
	return revision === undefined ? cual : html`${cual} data-revision="${revision}"`;
}

/**
 * El layout de toda la web: cabecera con el nombre del proyecto y la
 * navegación, zona de aviso, cuerpo y pie. HTML5 en español.
 */
export function pagina({ titulo, usuario, aviso, vista, revision, cuerpo }: OpcionesPagina): Html {
	return html`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo} · ${NOMBRE_PROYECTO}</title>
<link rel="stylesheet" href="/static/app.css">
</head>
<body${atributosCuerpo(vista, revision)}>
<header class="cabecera">
	<a class="marca" href="/tareas">${NOMBRE_PROYECTO}</a>
	${navegacion(usuario)}
</header>
<main class="contenido">
	${aviso === null || aviso === undefined || aviso === "" ? html`` : html`<p class="aviso" role="alert">${aviso}</p>`}
	${cuerpo}
</main>
<footer class="pie">
	<span>${NOMBRE_PROYECTO} · las tareas y quién las trabaja</span>
</footer>
<script type="module" src="/static/app.js"></script>
</body>
</html>`;
}
