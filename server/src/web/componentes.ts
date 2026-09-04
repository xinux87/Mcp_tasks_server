import { html } from "hono/html";
import type { TipoComentario } from "../db/hilo.ts";
import type { Estado, Marca } from "../db/tareas.ts";
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
 */
export const COLORES_USUARIO: readonly Color[] = [
	"azul",
	"verde",
	"morado",
	"naranja",
	"rosa",
	"amarillo",
	"rojo",
	"marron",
];

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
 * pregunta sí, y va en rosa.
 */
export const COLOR_TIPO_TAREA: Record<string, Color> = {
	tarea: "gris",
	pregunta: "rosa",
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
