import type { DatabaseSync } from "node:sqlite";
import { html, raw } from "hono/html";
import { listarTerminales, listarUsuarios } from "../db/admin.ts";
import { COLORES_USUARIO } from "../db/colores.ts";
import type { TipoComentario } from "../db/hilo.ts";
import type { Estado, Marca, TipoTarea } from "../db/tareas.ts";
import { formatearId } from "../md/ids.ts";
import { abreviar } from "./formatos.ts";
import type { Html } from "./plantilla.ts";

/**
 * Los componentes reutilizables de la web: etiquetas, chips, cabecera de
 * página y el bloque de propiedades. Todos devuelven `Html`, así que lo que
 * viene del humano o del agente pasa siempre por la plantilla `html` de Hono
 * y llega escapado al navegador. Aquí no se concatena HTML a mano.
 *
 * El mapa de colores de «Qué color lleva cada cosa» en CLAUDE.md vive en este
 * archivo: es el único sitio donde se decide de qué color va una cosa.
 */

/** Los nueve colores de etiqueta, los de Notion. Cada uno es una clase `.color-<nombre>`. */
export type Color = "gris" | "marron" | "naranja" | "amarillo" | "verde" | "azul" | "morado" | "rosa" | "rojo";

/**
 * Los ocho que puede llevar un usuario, en el orden en que se reparten. El
 * gris queda fuera: es el color de quien no tiene, agentes y usuarios
 * borrados.
 *
 * La lista vive en `src/db/colores.ts`, que es quien la valida al guardar; aquí
 * solo se reexporta para que la web tenga una única puerta de entrada. Dos
 * listas se habrían separado en cuanto se tocara una.
 */
export { COLORES_USUARIO };

/** Color de cada estado. Son las cinco columnas del kanban. */
export const COLOR_ESTADO: Record<Estado, Color> = {
	backlog: "gris",
	prepared: "azul",
	doing: "amarillo",
	done: "verde",
	finished: "marron",
};

/** Color de cada marca. Las marcas se derivan al leer la tarea, no se guardan. */
export const COLOR_MARCA: Record<Marca, Color> = {
	bloqueada: "rojo",
	"sin terminal": "naranja",
	"en marcha": "morado",
	"análisis listo": "rosa",
	esperando: "naranja",
};

/** Color de cada tipo de comentario del hilo. */
export const COLOR_TIPO: Record<TipoComentario, Color> = {
	analisis: "azul",
	pregunta: "rojo",
	respuesta: "verde",
	avance: "amarillo",
	resultado: "morado",
	nota: "gris",
};

/**
 * Color del tipo de tarea. Una tarea normal no lleva etiqueta de tipo; la
 * pregunta sí, en rosa, y la funcionalidad en azul.
 */
export const COLOR_TIPO_TAREA: Record<TipoTarea, Color> = {
	tarea: "gris",
	pregunta: "rosa",
	funcionalidad: "azul",
};

/**
 * Una etiqueta de color: estado, marca o tipo. La `clase` es el gancho que
 * buscan los tests (`estado-prepared`, `marca-bloqueada`, `tipo-nota`) y no
 * lleva color; el color va siempre en la última clase.
 */
export function etiqueta(texto: string, color: Color, clase?: string): Html {
	if (clase === undefined) {
		return html`<span class="insignia color-${color}">${texto}</span>`;
	}
	return html`<span class="insignia ${clase} color-${color}">${texto}</span>`;
}

/**
 * La inicial de un nombre, en mayúscula. Se recorre por caracteres y no por
 * unidades UTF-16 para que un nombre que empiece por emoji no se parta.
 */
function inicial(nombre: string): string {
	const primera = [...nombre.trim()][0];
	return primera === undefined ? "?" : primera.toUpperCase();
}

/**
 * Un usuario: círculo con su inicial sobre su color, y el nombre al lado. Es
 * la única forma de enseñar a un usuario en la web. Sin color (un usuario
 * borrado, o un autor que no es una persona) el chip va en gris.
 */
export function chipUsuario(nombre: string, color: Color | null): Html {
	return html`<span class="chip color-${color ?? "gris"}"><span class="inicial">${inicial(nombre)}</span>${nombre}</span>`;
}

/**
 * El autor de un comentario del hilo, tal como lo escribió el servidor:
 * `humano:xinux` es el chip de esa persona, con el color que tenga ahora;
 * `opus@portatil-xinux` es un chip gris con el modelo y su terminal detrás.
 *
 * El color se busca al pintar, nunca se guarda con el comentario: `colorDe`
 * devuelve el del usuario, o `null` si ya no existe.
 */
export function chipAutor(autor: string, colorDe: (nombre: string) => Color | null): Html {
	const marcaHumano = "humano:";
	if (autor.startsWith(marcaHumano)) {
		const nombre = autor.slice(marcaHumano.length);
		return chipUsuario(nombre, colorDe(nombre));
	}
	const arroba = autor.indexOf("@");
	if (arroba > 0) {
		const modelo = autor.slice(0, arroba);
		const terminal = autor.slice(arroba);
		return html`<span class="chip color-gris"><span class="inicial">${inicial(
			modelo,
		)}</span>${modelo}<span class="terminal">${terminal}</span></span>`;
	}
	// Un autor con otra forma no se inventa: se enseña tal cual, en gris.
	return chipUsuario(autor, null);
}

/**
 * Cómo se busca el color de un usuario al pintar. El hilo y la actividad
 * guardan el autor como texto (`humano:xinux`) y el color se resuelve ahora,
 * no cuando se escribió. Se lee la tabla una vez por página; un usuario que ya
 * no existe devuelve `null`, y su chip sale gris.
 */
export function buscadorDeColor(db: DatabaseSync): (nombre: string) => Color | null {
	const colores = new Map<string, Color>(listarUsuarios(db).map((usuario) => [usuario.nombre, usuario.color]));
	return (nombre) => colores.get(nombre) ?? null;
}

/**
 * Cómo se cuenta cada acción del rastro, en pasado y detrás del chip de quien
 * la hizo: «xinux movió la tarea». Una acción que no esté aquí se enseña con su
 * nombre crudo antes que romper la página.
 */
const FRASE_ACCION: Record<string, string | undefined> = {
	crear_tarea: "creó la tarea",
	editar_tarea: "editó la tarea",
	borrar_tarea: "borró la tarea",
	mover_tarea: "movió la tarea",
	aprobar_ejecucion: "aprobó la ejecución",
	responder_pregunta: "respondió",
	nota: "dejó una nota",
	alta_usuario: "dio de alta al usuario",
	baja_usuario: "dio de baja al usuario",
	cambiar_password: "cambió su contraseña",
	cambiar_color: "cambió el color de",
	alta_terminal: "creó el terminal",
	rotar_terminal: "rotó el token del terminal",
	revocar_terminal: "revocó el terminal",
	baja_terminal: "borró el terminal",
};

export function fraseDeAccion(accion: string): string {
	return FRASE_ACCION[accion] ?? accion;
}

/** Una miga de pan. Sin `href` es el sitio donde ya se está, y no enlaza. */
export type Miga = {
	texto: string;
	href?: string;
};

export type OpcionesCabecera = {
	/** El camino hasta aquí: `Tareas › T-0042`. Vacío en las páginas de primer nivel. */
	migas?: readonly Miga[];
	titulo: string;
	/** Estado y marcas, debajo del título. */
	etiquetas?: Html;
	/** Las acciones principales, a la derecha del título. */
	acciones?: Html;
};

function miga(cual: Miga): Html {
	return cual.href === undefined ? html`<span>${cual.texto}</span>` : html`<a href="${cual.href}">${cual.texto}</a>`;
}

/** El arranque de cada página: migas, título, etiquetas y acciones. */
export function cabeceraPagina({ migas, titulo, etiquetas, acciones }: OpcionesCabecera): Html {
	const camino =
		migas === undefined || migas.length === 0
			? html``
			: html`<nav class="migas" aria-label="Dónde estoy">
				${migas.map((cual, indice) =>
					indice === 0 ? miga(cual) : html`<span class="separador" aria-hidden="true">›</span>${miga(cual)}`,
				)}
			</nav>`;
	return html`<header class="cabecera-pagina">
			${camino}
			<div class="titular">
				<h1>${titulo}</h1>
				${acciones === undefined ? html`` : html`<div class="acciones">${acciones}</div>`}
			</div>
			${etiquetas === undefined ? html`` : html`<div class="etiquetas">${etiquetas}</div>`}
		</header>`;
}

/** Una fila del bloque de propiedades: el nombre a la izquierda, el valor al lado. */
export type Propiedad = {
	nombre: string;
	valor: Html | string;
};

/** El bloque de propiedades de la ficha: filas de dos columnas. */
export function propiedades(filas: readonly Propiedad[]): Html {
	return html`<dl class="propiedades">
			${filas.map(
				(fila) => html`<div class="propiedad">
					<dt>${fila.nombre}</dt>
					<dd>${fila.valor}</dd>
				</div>`,
			)}
		</dl>`;
}

/**
 * Las ocho muestras de color como botones de radio. Se usa dos veces en la
 * página de usuarios: en el alta y en cada fila de la tabla.
 *
 * Todos los radios se llaman `color` aunque haya varios selectores en la misma
 * página: un grupo de radios es el de su formulario, y cada selector va en el
 * suyo.
 *
 * `titulo` es el nombre accesible del grupo entero («Color de xinux»): el que
 * no ve los colores necesita saber de quién es el que está eligiendo. Cada
 * muestra lleva además el nombre de su color, solo para lectores de pantalla.
 *
 * Con `elegido` nulo se antepone la muestra «automático», que manda el valor
 * vacío para que el servidor reparta el color menos usado. Es lo que hace el
 * alta, donde todavía no hay color que respetar.
 */
export function selectorDeColor(titulo: string, elegido: Color | null): Html {
	const automatico =
		elegido === null
			? html`<label class="muestra muestra-auto">
				<input type="radio" name="color" value="" checked>automático
			</label>`
			: html``;
	return html`<div class="colores" role="group" aria-label="${titulo}">
			${automatico}
			${COLORES_USUARIO.map(
				(color) => html`<label class="muestra color-${color}">
					<input type="radio" name="color" value="${color}" ${color === elegido ? "checked" : ""}>
					<span class="solo-lectores">${color}</span>
				</label>`,
			)}
		</div>`;
}

/**
 * El rótulo de una columna de estado: su etiqueta, el título que se lee y
 * cuántas tareas hay. Lo comparten la lista, donde encabeza cada grupo, y el
 * kanban, donde encabeza cada columna.
 *
 * Recibe la etiqueta ya pintada en vez del estado: `insigniaEstado` vive en
 * `plantilla.ts`, que importa este archivo, y pedirla desde aquí cerraría el
 * círculo entre los dos módulos.
 */
export function rotuloColumna(insignia: Html, titulo: string, total: number): Html {
	return html`${insignia} ${titulo} <span class="contador">${total}</span>`;
}

/** El alta de tarea: la acción principal de la lista y del kanban. */
export function accionNuevaTarea(): Html {
	return html`<a class="boton principal" href="/tareas/nueva">Nueva tarea</a>`;
}

/**
 * Lo que ha avanzado una funcionalidad: barra fina y `3/7` al lado, partes
 * cerradas sobre partes totales.
 *
 * La barra es la misma idea que la del uso de un terminal, pero con su propia
 * clase: allí quedarse corto es una alarma y la barra se pinta en rojo, y aquí
 * empezar por cero es lo normal. El ancho sale de la decena, en un atributo,
 * porque en las plantillas no hay estilos en línea.
 */
export function barraProgreso(cerradas: number, total: number): Html {
	const nivel = total === 0 ? 0 : Math.round((cerradas / total) * 10);
	return html`<span class="progreso">
			<span class="barra"><span class="relleno" data-nivel="${nivel}"></span></span>
			<span class="cifra">${cerradas}/${total}</span>
		</span>`;
}

/** Cuánto título de la funcionalidad cabe en una fila o en una tarjeta. */
const TITULO_ABREVIADO = 40;

/**
 * De qué funcionalidad es parte una tarea: enlace a su ficha con el título
 * abreviado. Lo enseñan igual la fila de la lista y la tarjeta del kanban.
 */
export function enlaceFuncionalidad(padreId: number, titulo: string): Html {
	return html`<a class="parte-de" href="/tareas/${formatearId(padreId)}">${abreviar(titulo, TITULO_ABREVIADO)}</a>`;
}

/** Una opción de un desplegable de filtro: el valor que viaja y lo que se lee. */
export type OpcionFiltro = {
	valor: string;
	texto: string;
};

export type OpcionesFiltro = {
	nombre: string;
	titulo: string;
	/** La primera opción, la de no filtrar por este campo: «todos», «todas». */
	todas: string;
	valores: readonly OpcionFiltro[];
	seleccionado: string;
};

/**
 * Un desplegable de la fila de filtros, igual en la lista y en el kanban. La
 * opción de valor vacío está siempre y es la que deja pasar todo.
 */
export function filtroSelect({ nombre, titulo, todas, valores, seleccionado }: OpcionesFiltro): Html {
	return html`<label>
			<span>${titulo}</span>
			<select name="${nombre}">
				<option value=""${seleccionado === "" ? raw(" selected") : ""}>${todas}</option>
				${valores.map(
					(opcion) =>
						html`<option value="${opcion.valor}"${opcion.valor === seleccionado ? raw(" selected") : ""}>${opcion.texto}</option>`,
				)}
			</select>
		</label>`;
}

/** Quién creó una tarea, tal como lo guarda la fila: una persona o un terminal. */
export type QuienCreo = {
	usuarioId: number | null;
	terminalId: number | null;
};

/**
 * Cómo se enseña quién creó una tarea: el chip de la persona con su color, el
 * nombre del terminal en gris cuando la creó un agente, y `null` cuando no
 * consta ninguno de los dos, para que cada pantalla decida qué escribir en su
 * lugar.
 *
 * Las dos tablas se leen una vez por página, como en `buscadorDeColor`: la
 * lista pinta una fila por tarea y no puede consultar la base en cada una.
 */
export function buscadorDeCreador(db: DatabaseSync): (quien: QuienCreo) => Html | null {
	const usuarios = new Map(listarUsuarios(db).map((usuario) => [usuario.id, usuario]));
	const terminales = new Map(listarTerminales(db).map((terminal) => [terminal.id, terminal.nombre]));
	return ({ usuarioId, terminalId }) => {
		const usuario = usuarioId === null ? undefined : usuarios.get(usuarioId);
		if (usuario !== undefined) {
			return chipUsuario(usuario.nombre, usuario.color);
		}
		const terminal = terminalId === null ? undefined : terminales.get(terminalId);
		if (terminal !== undefined) {
			return html`<span class="silencio">${terminal}</span>`;
		}
		return null;
	};
}
