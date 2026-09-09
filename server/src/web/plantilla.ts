import { html, raw } from "hono/html";
import type { Usuario } from "../db/consultas.ts";
import type { Estado, ItemIndice, Marca, TipoTarea } from "../db/tareas.ts";
import {
	COLOR_ESTADO,
	COLOR_MARCA,
	COLOR_TIPO,
	COLOR_TIPO_TAREA,
	type Color,
	cabeceraPagina,
	chipUsuario,
	etiqueta,
	type Miga,
} from "./componentes.ts";

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

/** Nombre del proyecto, tal como aparece en la barra lateral y en el título. */
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
	esperando: "esperando",
};

/** Etiqueta de estado. El valor viene de un conjunto cerrado, así que sirve de clase. */
export function insigniaEstado(estado: Estado): Html {
	return etiqueta(estado, COLOR_ESTADO[estado], `estado-${estado}`);
}

/** Etiquetas de las marcas activas de una tarea, en su orden. */
export function insigniasMarcas(marcas: readonly Marca[]): Html {
	return html`${marcas.map((marca) => etiqueta(marca, COLOR_MARCA[marca], `marca-${CLASE_MARCA[marca]}`))}`;
}

/**
 * Etiqueta del tipo de un comentario del hilo. Recibe una cadena porque es lo
 * que hay guardado; un tipo que no esté en el mapa se pinta en gris en vez de
 * romper la página.
 */
export function insigniaTipo(tipo: string): Html {
	const colores: Record<string, Color | undefined> = COLOR_TIPO;
	return etiqueta(tipo, colores[tipo] ?? "gris", `tipo-${tipo}`);
}

/**
 * Etiqueta del tipo de la tarea. No se pinta en una tarea normal: `tarea` es lo
 * corriente y decirlo en cada tarjeta no aportaría nada. Una funcionalidad
 * lleva su progreso al lado cuando se sabe: `funcionalidad · 3/7`.
 */
export function insigniaTipoTarea(tipo: TipoTarea, progreso?: string | null): Html {
	if (tipo === "pregunta") {
		return etiqueta("pregunta", COLOR_TIPO_TAREA.pregunta, "tipo-pregunta");
	}
	if (tipo === "funcionalidad") {
		const texto = progreso === undefined || progreso === null ? "funcionalidad" : `funcionalidad · ${progreso}`;
		return etiqueta(texto, COLOR_TIPO_TAREA.funcionalidad, "tipo-funcionalidad");
	}
	return html``;
}

/**
 * La etiqueta de tipo de una tarea del índice, que es donde se conoce el
 * progreso: la lista y el kanban la pintan así.
 */
export function insigniaTipoDeItem(item: ItemIndice): Html {
	return insigniaTipoTarea(item.tipo, item.partes === null ? null : `${item.partesCerradas ?? 0}/${item.partes}`);
}

/** Una entrada de la navegación y las vistas que la dejan marcada como activa. */
type EntradaNav = {
	href: string;
	texto: string;
	vistas: readonly string[];
};

/**
 * Los dos bloques de la navegación. La ficha y el alta de tarea marcan
 * «Lista»: son la misma sección, no otro sitio.
 */
const BLOQUES: readonly { titulo: string; entradas: readonly EntradaNav[] }[] = [
	{
		titulo: "Tareas",
		entradas: [
			{ href: "/tareas", texto: "Lista", vistas: ["lista", "ficha", "tarea", "tarea-nueva"] },
			{ href: "/tareas/kanban", texto: "Kanban", vistas: ["kanban"] },
			{ href: "/funcionalidades", texto: "Funcionalidades", vistas: ["funcionalidades"] },
		],
	},
	{
		titulo: "Sistema",
		entradas: [
			{ href: "/terminales", texto: "Terminales", vistas: ["terminales", "conectar"] },
			{ href: "/usuarios", texto: "Usuarios", vistas: ["usuarios"] },
			{ href: "/actividad", texto: "Actividad", vistas: ["actividad"] },
		],
	},
];

export type OpcionesPagina = {
	titulo: string;
	/** Quién mira. Sin sesión (la pantalla de login) no hay barra lateral. */
	usuario: Usuario | null;
	/** Mensaje de un `ErrorDeRegla` o confirmación, tal cual. */
	aviso?: string | null;
	/**
	 * Qué vista es, para el cliente y para la navegación: `lista`, `kanban`,
	 * `ficha`, `funcionalidades`, `terminales`, `usuarios`, `actividad`. Cada una se refresca de
	 * una manera y marca su entrada en la barra lateral.
	 */
	vista?: string;
	/**
	 * Revisión global de la que parte el cliente. Solo la pasan las páginas
	 * que se refrescan en vivo; sin ella el cliente no abre el SSE.
	 */
	revision?: number;
	/** Con migas o con acciones, la página arranca con `cabeceraPagina`. */
	migas?: readonly Miga[];
	/** Etiquetas de estado y marcas, bajo el título. Solo se pintan con cabecera. */
	etiquetas?: Html;
	/** Las acciones principales, a la derecha del título. */
	acciones?: Html;
	/** El kanban ocupa todo el ancho; el resto se queda en 60 rem. */
	ancho?: "completo";
	cuerpo: Html;
};

function enlaceNav(entrada: EntradaNav, vista: string): Html {
	const activo = entrada.vistas.includes(vista);
	return html`<a class="enlace-nav" href="${entrada.href}"${activo ? raw(' aria-current="page"') : ""}>${entrada.texto}</a>`;
}

/**
 * La barra lateral: el nombre del proyecto, los dos bloques de navegación y,
 * abajo, quién está dentro y por dónde se sale.
 */
function barraLateral(usuario: Usuario, vista: string): Html {
	return html`<aside class="lateral" id="lateral">
			<a class="marca" href="/tareas">${NOMBRE_PROYECTO}</a>
			${BLOQUES.map(
				(bloque) => html`<nav class="bloque">
					<h2>${bloque.titulo}</h2>
					${bloque.entradas.map((entrada) => enlaceNav(entrada, vista))}
				</nav>`,
			)}
			<div class="pie-lateral">
				${chipUsuario(usuario.nombre, usuario.color)}
				<form method="post" action="/logout" class="en-linea">
					<button type="submit" class="enlace">Salir</button>
				</form>
			</div>
		</aside>`;
}

/**
 * Los `data-` del `<body>`: la vista siempre, y la revisión solo donde el
 * refresco en vivo tiene sentido. El cliente no hace nada sin ellos. Ninguna
 * clase se pinta aquí: `lateral-abierta` la pone solo el navegador.
 */
function atributosCuerpo(vista: string | undefined, revision: number | undefined): Html {
	const cual = html` data-vista="${vista ?? "otra"}"`;
	return revision === undefined ? cual : html`${cual} data-revision="${revision}"`;
}

/**
 * El esqueleto de toda la web: barra lateral fija con la navegación y el
 * contenido a su derecha. Por debajo de 48 rem la barra se esconde y la
 * cabecera con el botón «☰» la despliega como panel. HTML5 en español.
 */
export function pagina({
	titulo,
	usuario,
	aviso,
	vista,
	revision,
	migas,
	etiquetas,
	acciones,
	ancho,
	cuerpo,
}: OpcionesPagina): Html {
	const conCabecera = migas !== undefined || acciones !== undefined;
	const clasesContenido = usuario === null ? "contenido contenido-entrada" : "contenido";
	const clasesDentro = ancho === "completo" ? "dentro dentro-completo" : "dentro";
	return html`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo} · ${NOMBRE_PROYECTO}</title>
<link rel="stylesheet" href="/static/app.css">
</head>
<body${atributosCuerpo(vista, revision)}>
${
	usuario === null
		? html``
		: html`<header class="cabecera-movil">
	<button type="button" class="alternar-lateral" id="alternar-lateral" aria-controls="lateral" aria-label="Navegación">☰</button>
	<a class="marca" href="/tareas">${NOMBRE_PROYECTO}</a>
</header>
${barraLateral(usuario, vista ?? "")}`
}
<main class="${clasesContenido}">
	<div class="${clasesDentro}">
		${aviso === null || aviso === undefined || aviso === "" ? html`` : html`<p class="aviso" role="alert">${aviso}</p>`}
		${conCabecera ? cabeceraPagina({ migas, titulo, etiquetas, acciones }) : html``}
		${cuerpo}
	</div>
</main>
<script type="module" src="/static/app.js"></script>
</body>
</html>`;
}
