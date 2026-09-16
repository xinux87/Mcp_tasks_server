import { html, raw } from "hono/html";
import type { Usuario } from "../db/consultas.ts";
import type { Proyecto } from "../db/proyectos.ts";
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
import {
	NOMBRE_COLUMNA,
	NOMBRE_ESTADO,
	NOMBRE_MARCA,
	NOMBRE_TIPO_COMENTARIO,
	NOMBRE_TIPO_TAREA,
} from "./vocabulario.ts";

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

/** Las cinco columnas del tablero, en su orden. El rótulo lo pone `rotuloColumna`. */
export const COLUMNAS: readonly Estado[] = ["backlog", "prepared", "doing", "done", "finished"];

/** Sugerencias de modelo del formulario de tarea. No es una lista cerrada. */
export const MODELOS_SUGERIDOS: readonly string[] = ["fable", "opus", "sonnet", "haiku"];

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
	"sobre presupuesto": "sobre-presupuesto",
};

/**
 * Etiqueta de estado. El texto es el del vocabulario; la clase lleva el nombre
 * interno, que viene de un conjunto cerrado y es lo que buscan los tests.
 */
export function insigniaEstado(estado: Estado): Html {
	return etiqueta(NOMBRE_ESTADO[estado], COLOR_ESTADO[estado], `estado-${estado}`);
}

/**
 * La misma etiqueta, con el nombre de la columna en plural: encabeza un montón
 * de tareas, no una. Comparte clase y color con la de estado, que es lo que
 * hace que el tablero y la tarjeta se lean como lo mismo.
 */
export function insigniaColumna(estado: Estado): Html {
	return etiqueta(NOMBRE_COLUMNA[estado], COLOR_ESTADO[estado], `estado-${estado}`);
}

/** Etiquetas de las marcas activas de una tarea, en su orden. */
export function insigniasMarcas(marcas: readonly Marca[]): Html {
	return html`${marcas.map((marca) =>
		etiqueta(NOMBRE_MARCA[marca], COLOR_MARCA[marca], `marca-${CLASE_MARCA[marca]}`),
	)}`;
}

/**
 * Etiqueta del tipo de un comentario del hilo. Recibe una cadena porque es lo
 * que hay guardado; un tipo que no esté en el mapa se pinta en gris y con su
 * nombre crudo en vez de romper la página.
 */
export function insigniaTipo(tipo: string): Html {
	const colores: Record<string, Color | undefined> = COLOR_TIPO;
	const nombres: Record<string, string | undefined> = NOMBRE_TIPO_COMENTARIO;
	return etiqueta(nombres[tipo] ?? tipo, colores[tipo] ?? "gris", `tipo-${tipo}`);
}

/**
 * Etiqueta del tipo de la tarea. No se pinta en una tarea normal: `tarea` es lo
 * corriente y decirlo en cada tarjeta no aportaría nada. Una funcionalidad
 * lleva su progreso al lado cuando se sabe: `Funcionalidad 3/7`.
 */
export function insigniaTipoTarea(tipo: TipoTarea, progreso?: string | null): Html {
	if (tipo === "pregunta") {
		return etiqueta(NOMBRE_TIPO_TAREA.pregunta, COLOR_TIPO_TAREA.pregunta, "tipo-pregunta");
	}
	if (tipo === "funcionalidad") {
		const nombre = NOMBRE_TIPO_TAREA.funcionalidad;
		const texto = progreso === undefined || progreso === null ? nombre : `${nombre} ${progreso}`;
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
	ruta: string;
	texto: string;
	vistas: readonly string[];
	/** Las tres vistas de tareas se acotan al proyecto de la URL; el sistema no. */
	acotable?: boolean;
};

/**
 * La bandeja va sola en lo alto de la navegación: es la pantalla que dice qué
 * espera por el humano y no es una más de las de trabajo. Cruza todos los
 * proyectos, así que no se acota a ninguno.
 */
const BANDEJA: EntradaNav = { ruta: "/", texto: "Bandeja", vistas: ["bandeja"] };

/**
 * Los dos bloques de la navegación. «Tareas» es una sección con dos vistas de
 * lo mismo, la lista y el tablero, y una sola entrada: la ficha y el alta son
 * la misma sección, no otro sitio.
 */
const BLOQUES: readonly { titulo: string; entradas: readonly EntradaNav[] }[] = [
	{
		titulo: "Trabajo",
		entradas: [
			{
				ruta: "/tareas",
				texto: "Tareas",
				vistas: ["lista", "kanban", "ficha", "tarea", "tarea-nueva"],
				acotable: true,
			},
			{ ruta: "/funcionalidades", texto: "Funcionalidades", vistas: ["funcionalidades"], acotable: true },
			{ ruta: "/informes", texto: "Informes", vistas: ["informes"], acotable: true },
			{ ruta: "/actividad", texto: "Actividad", vistas: ["actividad"] },
		],
	},
	{
		titulo: "Configuración",
		entradas: [
			{ ruta: "/proyectos", texto: "Proyectos", vistas: ["proyectos"] },
			{ ruta: "/terminales", texto: "Terminales", vistas: ["terminales", "conectar"] },
			{ ruta: "/usuarios", texto: "Usuarios", vistas: ["usuarios"] },
		],
	},
];

/** Las tres opciones del tema. El valor viaja al `localStorage` del navegador. */
const TEMAS: readonly { valor: string; texto: string }[] = [
	{ valor: "claro", texto: "Claro" },
	{ valor: "oscuro", texto: "Oscuro" },
	{ valor: "sistema", texto: "Sistema" },
];

/**
 * El conmutador de tema, en el pie de la barra. Es una preferencia de quien
 * mira y no del usuario: no toca el servidor ni la revisión, así que aquí se
 * pinta siempre «Sistema» marcado y `cliente.ts` corrige lo que haga falta con
 * lo que tenga guardado el navegador.
 */
function conmutadorTema(): Html {
	return html`<fieldset class="tema">
			<legend>Tema</legend>
			${TEMAS.map(
				(cual) => html`<label>
					<input type="radio" name="tema" value="${cual.valor}"${cual.valor === "sistema" ? raw(" checked") : ""}>${cual.texto}
				</label>`,
			)}
		</fieldset>`;
}

/**
 * A qué vista lleva el selector de proyecto: a la misma en la que se está, y a
 * la lista desde cualquier otra página. Es lo que hace que cambiar de proyecto
 * no cambie de pantalla.
 */
function rutaDeVista(vista: string): string {
	if (vista === "kanban") {
		return "/tareas/kanban";
	}
	return vista === "funcionalidades" ? "/funcionalidades" : "/tareas";
}

/**
 * Lo que la barra lateral necesita saber de los proyectos: todos, para el
 * selector, y el de la URL actual, que es el que dejan puesto los enlaces de
 * las tres vistas de tareas. Lo compone `navProyectos` en `rutas/proyectos.ts`.
 */
export type NavProyectos = {
	/** Sin lista no se pinta el selector: es lo que hacen el login y la página de error. */
	proyectos?: readonly Proyecto[];
	proyecto?: Proyecto;
	/**
	 * Cuántas cosas esperan por el humano: preguntas sin contestar, aprobaciones
	 * y resultados sin revisar. Sale en la entrada «Bandeja» y en el título de la
	 * pestaña. Lo calcula `navProyectos`, una vez por página.
	 */
	pendientes?: number;
};

export type OpcionesPagina = NavProyectos & {
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
	/** Con migas, propósito o acciones, la página arranca con `cabeceraPagina`. */
	migas?: readonly Miga[];
	/** Para qué sirve esta pantalla, en una frase y desde el punto de vista del humano. */
	proposito?: string;
	/** Etiquetas de estado y marcas, bajo el título. Solo se pintan con cabecera. */
	etiquetas?: Html;
	/** Las acciones principales, a la derecha del título. */
	acciones?: Html;
	/** El kanban ocupa todo el ancho; el resto se queda en 60 rem. */
	ancho?: "completo";
	cuerpo: Html;
};

function enlaceNav(entrada: EntradaNav, vista: string, prefijo: string, pendientes: number): Html {
	const activo = entrada.vistas.includes(vista);
	const href = entrada.acotable === true ? `${prefijo}${entrada.ruta}` : entrada.ruta;
	// Solo la bandeja lleva número, y solo cuando hay algo esperando.
	const cuantas = entrada.ruta === "/" && pendientes > 0 ? html`<span class="contador">${pendientes}</span>` : html``;
	return html`<a class="enlace-nav" href="${href}"${activo ? raw(' aria-current="page"') : ""}>${entrada.texto}${cuantas}</a>`;
}

/**
 * El selector de proyecto, debajo del nombre de la aplicación. Cada opción
 * lleva puesto su destino, que es la misma vista en el proyecto elegido, así
 * que sin JavaScript basta con enviar el formulario; con él, `cliente.ts`
 * esconde el botón y navega al cambiar.
 */
function selectorProyecto(proyectos: readonly Proyecto[], proyecto: Proyecto | undefined, vista: string): Html {
	const ruta = rutaDeVista(vista);
	return html`<form class="selector-proyecto" method="get" action="/ir">
			<label class="solo-lectores" for="ir-proyecto">Proyecto</label>
			<select id="ir-proyecto" name="destino">
				<option value="${ruta}"${proyecto === undefined ? raw(" selected") : ""}>Todos los proyectos</option>
				${proyectos.map(
					(cual) =>
						html`<option value="/p/${cual.clave}${ruta}"${cual.id === proyecto?.id ? raw(" selected") : ""}>${cual.clave} — ${cual.nombre}</option>`,
				)}
			</select>
			<button type="submit" class="pequeno">Ir</button>
		</form>`;
}

/**
 * La barra lateral: el nombre de la aplicación, el selector de proyecto, los
 * dos bloques de navegación y, abajo, quién está dentro y por dónde se sale.
 */
function barraLateral(
	usuario: Usuario,
	vista: string,
	nav: { proyectos: readonly Proyecto[]; proyecto?: Proyecto; pendientes: number },
): Html {
	const prefijo = nav.proyecto === undefined ? "" : `/p/${nav.proyecto.clave}`;
	return html`<aside class="lateral" id="lateral">
			<a class="marca" href="/">${NOMBRE_PROYECTO}</a>
			${nav.proyectos.length === 0 ? html`` : selectorProyecto(nav.proyectos, nav.proyecto, vista)}
			<nav class="bloque bloque-suelto">${enlaceNav(BANDEJA, vista, prefijo, nav.pendientes)}</nav>
			${BLOQUES.map(
				(bloque) => html`<nav class="bloque">
					<h2>${bloque.titulo}</h2>
					${bloque.entradas.map((entrada) => enlaceNav(entrada, vista, prefijo, nav.pendientes))}
				</nav>`,
			)}
			${conmutadorTema()}
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
	proposito,
	etiquetas,
	acciones,
	ancho,
	cuerpo,
	proyectos,
	proyecto,
	pendientes = 0,
}: OpcionesPagina): Html {
	const conCabecera = migas !== undefined || acciones !== undefined || proposito !== undefined;
	const clasesContenido = usuario === null ? "contenido contenido-entrada" : "contenido";
	const clasesDentro = ancho === "completo" ? "dentro dentro-completo" : "dentro";
	// Lo que espera por el humano se ve desde la pestaña, esté donde esté. Sin
	// sesión no hay bandeja que contar.
	const cuantas = usuario === null || pendientes === 0 ? "" : `(${pendientes}) `;
	return html`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${cuantas}${titulo} · ${NOMBRE_PROYECTO}</title>
<script>try{var t=localStorage.getItem("tema");if(t==="claro"||t==="oscuro"){document.documentElement.dataset.tema=t;}}catch(e){}</script>
<link rel="stylesheet" href="/static/app.css">
</head>
<body${atributosCuerpo(vista, revision)}>
${
	usuario === null
		? html``
		: html`<header class="cabecera-movil">
	<button type="button" class="alternar-lateral" id="alternar-lateral" aria-controls="lateral" aria-label="Navegación">☰</button>
	<a class="marca" href="/">${NOMBRE_PROYECTO}</a>
</header>
${barraLateral(usuario, vista ?? "", { proyectos: proyectos ?? [], proyecto, pendientes })}`
}
<main class="${clasesContenido}">
	<div class="${clasesDentro}">
		${aviso === null || aviso === undefined || aviso === "" ? html`` : html`<p class="aviso" role="alert">${aviso}</p>`}
		${conCabecera ? cabeceraPagina({ migas, titulo, proposito, etiquetas, acciones }) : html``}
		${cuerpo}
	</div>
</main>
<script type="module" src="/static/app.js"></script>
</body>
</html>`;
}
