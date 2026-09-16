import type { DatabaseSync } from "node:sqlite";
import { html, raw } from "hono/html";
import { listarTerminales, listarUsuarios } from "../db/admin.ts";
import { COLORES_USUARIO } from "../db/colores.ts";
import type { TipoComentario } from "../db/hilo.ts";
import { listarProyectos, type Proyecto } from "../db/proyectos.ts";
import type { Estado, Marca, TipoTarea } from "../db/tareas.ts";
import { formatearId } from "../md/ids.ts";
import { abreviar, edad, horasDesde, SIN_DATO } from "./formatos.ts";
import type { Html } from "./plantilla.ts";
import { DUENO_COLUMNA, FRASE_DUENO_COLUMNA, NOMBRE_ESTADO } from "./vocabulario.ts";

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
	"sobre presupuesto": "naranja",
};

/** Color de cada tipo de comentario del hilo. */
export const COLOR_TIPO: Record<TipoComentario, Color> = {
	analisis: "azul",
	pregunta: "rojo",
	respuesta: "verde",
	resultado: "morado",
	comentario: "gris",
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
 * buscan los tests (`estado-prepared`, `marca-bloqueada`, `tipo-comentario`) y no
 * lleva color; el color va siempre en la última clase.
 */
export function etiqueta(texto: string, color: Color, clase?: string): Html {
	if (clase === undefined) {
		return html`<span class="insignia color-${color}">${texto}</span>`;
	}
	return html`<span class="insignia ${clase} color-${color}">${texto}</span>`;
}

/**
 * Si la tarea espera por el humano. No es una marca guardada: se deriva de
 * dónde está y de qué lleva encima. Es `done` (la tiene que revisar), una
 * pregunta sin contestar o un análisis por aprobar.
 *
 * `backlog` queda fuera: ahí la tarea no bloquea a nadie. Es la misma cuenta
 * que el contador de pendientes de la bandeja y que el conmutador «Espera por
 * ti» de la lista y del tablero; tres sitios que dicen lo mismo tienen que
 * seleccionar lo mismo.
 */
export function esperaPorElHumano(estado: Estado, marcas: readonly Marca[]): boolean {
	return estado === "done" || marcas.includes("bloqueada") || marcas.includes("análisis listo");
}

/**
 * La señal: lo único que va en `--turno` además del contador de la bandeja y
 * del paso actual del ciclo. No lleva clase de color porque no es uno de los
 * nueve: el turno es su propio color.
 */
export function esperaPorTi(estado: Estado, marcas: readonly Marca[]): Html {
	return esperaPorElHumano(estado, marcas) ? html`<span class="insignia turno">Espera por ti</span>` : html``;
}

/** Los cinco pasos del ciclo, en su orden. */
const PASOS: readonly Estado[] = ["backlog", "prepared", "doing", "done", "finished"];

/**
 * Lo que el ciclo necesita saber de la tarea. Las marcas ya vienen calculadas
 * (`marcasDe`): «análisis listo» encierra la autoejecución y la aprobación, y
 * volver a deducirlas aquí las dejaría divergir en cuanto una cambiara.
 */
export type EnElCiclo = {
	estado: Estado;
	tipo: TipoTarea;
	marcas: readonly Marca[];
	/** Número de la pregunta abierta más antigua: «Espera tu respuesta a P1». */
	preguntaAbierta: number | null;
};

/** Qué pasa ahora mismo y de quién es el turno. */
function quePasaAhora(tarea: EnElCiclo): { frase: string; deTurno: boolean } {
	const respuesta = { frase: `Espera tu respuesta a P${tarea.preguntaAbierta ?? 1}`, deTurno: true };
	const bloqueada = tarea.marcas.includes("bloqueada");
	switch (tarea.estado) {
		case "backlog":
			return { frase: "Termina de definirla y pásala a preparadas", deTurno: true };
		case "prepared":
			if (bloqueada) {
				return respuesta;
			}
			if (tarea.marcas.includes("análisis listo")) {
				// En una funcionalidad el análisis son sus partes: lo que hay que
				// mirar antes de aprobar no es un texto, es la descomposición.
				return tarea.tipo === "funcionalidad"
					? { frase: "Revisa las partes", deTurno: true }
					: { frase: "Espera tu aprobación del análisis", deTurno: true };
			}
			return { frase: "El agente de análisis la está estudiando", deTurno: false };
		case "doing":
			if (bloqueada) {
				return respuesta;
			}
			return tarea.tipo === "funcionalidad"
				? { frase: "Las partes se están trabajando", deTurno: false }
				: { frase: "El agente la está ejecutando", deTurno: false };
		case "done":
			return { frase: "Revisa el resultado", deTurno: true };
		default:
			return { frase: "Cerrada", deTurno: false };
	}
}

/**
 * De quién es el turno en un paso. En el actual manda quien lo tiene de verdad,
 * que no siempre es el dueño de la columna: una tarea preparada con una
 * pregunta abierta está en la columna del agente y espera por el humano. En los
 * demás pasos, el dueño de la columna, que es lo que pasará cuando lleguen.
 */
function duenoDelPaso(estado: Estado, esActual: boolean, deTurno: boolean): string {
	if (!esActual || estado === "finished") {
		return DUENO_COLUMNA[estado];
	}
	return deTurno ? "tú" : "el agente";
}

/**
 * El ciclo de la tarea: los cinco pasos con su dueño debajo y, en el que toca,
 * qué pasa ahora. El actual va en `--turno` cuando el turno es del humano y en
 * `--acento` cuando es del agente; los pasados, tachados en texto suave.
 */
export function pasosDelCiclo(tarea: EnElCiclo): Html {
	const ahora = quePasaAhora(tarea);
	const actual = PASOS.indexOf(tarea.estado);
	return html`<ol class="ciclo">
			${PASOS.map((estado, indice) => {
				// Una pregunta no se ejecuta: su respuesta la lleva de Preparada a
				// Hecha, así que el paso En curso no es suyo.
				const omitido = tarea.tipo === "pregunta" && estado === "doing";
				const esActual = indice === actual && !omitido;
				const clases = [
					omitido ? "omitido" : "",
					indice < actual && !omitido ? "pasado" : "",
					esActual ? (ahora.deTurno ? "turno" : "agente") : "",
				]
					.filter((clase) => clase !== "")
					.join(" ");
				return html`<li${clases === "" ? html`` : html` class="${clases}"`}${esActual ? raw(' aria-current="step"') : ""}>
					<span class="paso-nombre">${NOMBRE_ESTADO[estado]}</span>
					${omitido ? html`` : html`<span class="paso-dueno">${duenoDelPaso(estado, esActual, ahora.deTurno)}</span>`}
					${esActual ? html`<span class="paso-ahora">${ahora.frase}</span>` : html``}
				</li>`;
			})}
		</ol>`;
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
 * `humano:ana` es el chip de esa persona, con el color que tenga ahora;
 * `opus@portatil-ana` es un chip gris con el modelo y su terminal detrás.
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

/** Lo que hace falta para pintar el chip de un proyecto. Un `Proyecto` lo cumple. */
export type ConChip = {
	clave: string;
	color: Color;
};

/**
 * Un proyecto: su clave en una etiqueta de su color. El color es del proyecto
 * entero, así que la misma clave se reconoce igual en el tablero, en la ficha
 * y en la lista de terminales.
 */
export function chipProyecto(proyecto: ConChip): Html {
	return etiqueta(proyecto.clave, proyecto.color, "proyecto");
}

/**
 * Cómo se busca el proyecto de una tarea o de un terminal al pintar, cuando lo
 * único que se tiene es su identificador. Se lee la tabla una vez por página,
 * como en `buscadorDeColor`: hay una fila por tarjeta y ninguna puede consultar
 * la base por su cuenta.
 */
export type BuscaProyecto = (proyectoId: number) => Proyecto | undefined;

export function buscadorDeProyecto(db: DatabaseSync): BuscaProyecto {
	const proyectos = new Map(listarProyectos(db).map((proyecto) => [proyecto.id, proyecto]));
	return (proyectoId) => proyectos.get(proyectoId);
}

/**
 * Nombres del rastro que no son personas: los deja el CLI y el primer arranque,
 * que no tienen sesión. No llevan chip porque no hay a quién enseñar.
 */
const NO_SON_PERSONAS: readonly string[] = ["cli", "arranque"];

/**
 * Quién dio de alta algo, tal como lo guardó el rastro: una persona va como
 * chip con su color, y en gris si ya no existe; `cli` y `arranque` van en texto
 * suave; sin dato, una raya. Lo enseñan igual usuarios, terminales y proyectos.
 */
export function chipDeAlta(nombre: string | null, colorDe: (nombre: string) => Color | null): Html {
	if (nombre === null) {
		return html`<span class="silencio">${SIN_DATO}</span>`;
	}
	if (NO_SON_PERSONAS.includes(nombre)) {
		return html`<span class="silencio">${nombre}</span>`;
	}
	return chipUsuario(nombre, colorDe(nombre));
}

/**
 * Cómo se busca el color de un usuario al pintar. El hilo y la actividad
 * guardan el autor como texto (`humano:ana`) y el color se resuelve ahora,
 * no cuando se escribió. Se lee la tabla una vez por página; un usuario que ya
 * no existe devuelve `null`, y su chip sale gris.
 */
export function buscadorDeColor(db: DatabaseSync): (nombre: string) => Color | null {
	const colores = new Map<string, Color>(listarUsuarios(db).map((usuario) => [usuario.nombre, usuario.color]));
	return (nombre) => colores.get(nombre) ?? null;
}

/**
 * Cómo se cuenta cada acción del rastro, en pasado y detrás del chip de quien
 * la hizo: «ana movió la tarea». Una acción que no esté aquí se enseña con su
 * nombre crudo antes que romper la página.
 */
const FRASE_ACCION: Record<string, string | undefined> = {
	crear_tarea: "creó la tarea",
	editar_tarea: "editó la tarea",
	borrar_tarea: "borró la tarea",
	mover_tarea: "movió la tarea",
	aprobar_ejecucion: "aprobó la ejecución",
	responder_pregunta: "respondió",
	comentario: "comentó en la tarea",
	alta_usuario: "dio de alta al usuario",
	baja_usuario: "dio de baja al usuario",
	cambiar_password: "cambió su contraseña",
	cambiar_color: "cambió el color de",
	alta_terminal: "creó el terminal",
	rotar_terminal: "rotó el token del terminal",
	cambiar_agentes: "cambió los agentes en paralelo del terminal",
	revocar_terminal: "revocó el terminal",
	baja_terminal: "borró el terminal",
	alta_proyecto: "creó el proyecto",
	editar_proyecto: "editó el proyecto",
	baja_proyecto: "borró el proyecto",
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
	/** Para qué sirve la pantalla, en una frase y justo debajo del título. */
	proposito?: string;
	/** Estado y marcas, debajo del título. */
	etiquetas?: Html;
	/** Las acciones principales, a la derecha del título. */
	acciones?: Html;
};

function miga(cual: Miga): Html {
	return cual.href === undefined ? html`<span>${cual.texto}</span>` : html`<a href="${cual.href}">${cual.texto}</a>`;
}

/** El arranque de cada página: migas, título, propósito, etiquetas y acciones. */
export function cabeceraPagina({ migas, titulo, proposito, etiquetas, acciones }: OpcionesCabecera): Html {
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
			${proposito === undefined ? html`` : html`<p class="proposito">${proposito}</p>`}
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
 * `titulo` es el nombre accesible del grupo entero («Color de ana»): el que
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
 * El rótulo de una columna: su etiqueta con el nombre de la columna, de quién
 * es el turno mientras la tarea está ahí y cuántas hay. Lo comparten la lista,
 * donde encabeza cada grupo, y el tablero, donde encabeza cada columna. El
 * nombre va una sola vez, dentro de la etiqueta: repetirlo al lado no decía
 * nada más. En `finished` no hay turno de nadie y no se escribe.
 *
 * Recibe la etiqueta ya pintada en vez de componerla: `insigniaColumna` vive en
 * `plantilla.ts`, que importa este archivo, y pedirla desde aquí cerraría el
 * círculo entre los dos módulos.
 */
export function rotuloColumna(insignia: Html, estado: Estado, total: number): Html {
	const dueno = estado === "finished" ? html`` : html`<span class="dueno">${FRASE_DUENO_COLUMNA[estado]}</span> `;
	return html`${insignia} ${dueno}<span class="contador">${total}</span>`;
}

/** Las dos vistas de la sección Tareas: las mismas tareas, miradas de dos maneras. */
const VISTAS: readonly { clave: "lista" | "tablero"; texto: string; ruta: string }[] = [
	{ clave: "lista", texto: "Lista", ruta: "/tareas" },
	{ clave: "tablero", texto: "Tablero", ruta: "/tareas/kanban" },
];

/**
 * El conmutador Lista | Tablero, a la izquierda de la fila de filtros. Los
 * filtros viajan con él, la agrupación incluida: las dos vistas se agrupan
 * igual, así que cambiar de vista no pierde lo que se estaba mirando.
 */
export function conmutadorVistas(actual: "lista" | "tablero", prefijo: string, consulta: URLSearchParams): Html {
	return html`<nav class="vistas" aria-label="Cómo ver las tareas">
			${VISTAS.map((vista) => {
				const texto = consulta.toString();
				const base = `${prefijo}${vista.ruta}`;
				return html`<a href="${texto === "" ? base : `${base}?${texto}`}"${vista.clave === actual ? raw(' aria-current="page"') : ""}>${vista.texto}</a>`;
			})}
		</nav>`;
}

/**
 * El alta de tarea: la acción principal de la lista y del kanban. En un
 * tablero acotado lleva el prefijo del proyecto, para que la tarea nazca donde
 * se está mirando.
 */
export function accionNuevaTarea(prefijo = ""): Html {
	return html`<a class="boton principal" href="${prefijo}/tareas/nueva">Nueva tarea</a>`;
}

/**
 * Lo que ha avanzado una tarea: barra fina y `hijas 2/5` al lado, hijas
 * cerradas sobre hijas totales. En una funcionalidad son sus partes, y el
 * rótulo lo dice.
 *
 * Es un `<progress>` y no una barra dibujada a mano: el navegador ya sabe
 * pintarla y contarla a quien no la ve. Sin nada que contar no se pinta:
 * una tarea sin hijas no tiene progreso, tiene trabajo.
 */
export function barraProgreso(cerradas: number, total: number, rotulo = "hijas"): Html {
	if (total === 0) {
		return html``;
	}
	return html`<progress class="progreso" value="${cerradas}" max="${total}"></progress><span class="progreso-texto">${rotulo} ${cerradas}/${total}</span>`;
}

/**
 * El botón que copia una línea suelta. El glifo se cambia por el de `data-hecho`
 * mientras dura el aviso, así que el cliente no necesita saber cuál era.
 */
const BOTON_LINEA = html`<button type="button" class="copiar copiar-linea" aria-label="Copiar línea" title="Copiar línea" data-hecho="✓" data-fallo="✗">⧉</button>`;

/**
 * Un bloque de código copiable, el único que pinta la web: el tutorial de
 * conexión, la página del token y los bloques que un agente escribe en el hilo
 * o en la descripción salen todos de aquí.
 *
 * Lleva el botón «Copiar» del bloque entero, porque hay bloques que son una
 * unidad, y además uno por línea cuando hay más de una, que es lo que evita
 * recortar a mano un bloque con dos comandos seguidos. Un bloque de una sola
 * línea no lleva botón de línea: el del bloque ya lo es.
 *
 * Dentro del `<pre>` no hay ni un espacio de más: ahí los espacios se ven.
 */
export function bloqueCodigo(codigo: string, clase = ""): Html {
	const lineas = codigo.replace(/\n+$/, "").split("\n");
	const porLinea = lineas.length > 1;
	const clases = clase === "" ? "bloque-codigo" : `bloque-codigo ${clase}`;
	return html`<div class="${clases}"><button type="button" class="boton pequeno copiar">Copiar</button><pre>${lineas.map((linea) => html`<span class="linea"><code>${linea}</code>${porLinea ? BOTON_LINEA : ""}</span>`)}</pre></div>`;
}

/** Los tres conmutadores de un clic, con el texto que se lee en cada uno. */
const FILTROS_RAPIDOS: readonly { valor: string; texto: string }[] = [
	{ valor: "espera", texto: "Espera por ti" },
	{ valor: "en-marcha", texto: "En marcha" },
	{ valor: "sin-terminal", texto: "Sin terminal" },
];

/**
 * Los tres conmutadores, a la izquierda de los desplegables. Son enlaces con
 * aspecto de botón: uno cada vez, el activo lleva `aria-current` y pulsarlo lo
 * quita. El resto de filtros viaja con ellos, así que se combinan con los
 * desplegables y con la búsqueda.
 */
export function filtrosRapidos(activo: string, urlBase: string, parametros: URLSearchParams): Html {
	return html`<nav class="filtros-rapidos" aria-label="Filtros rápidos">
			${FILTROS_RAPIDOS.map((filtro) => {
				const puesto = filtro.valor === activo;
				const consulta = new URLSearchParams(parametros);
				consulta.delete("rapido");
				if (!puesto) {
					consulta.set("rapido", filtro.valor);
				}
				const texto = consulta.toString();
				return html`<a class="boton-filtro" href="${texto === "" ? urlBase : `${urlBase}?${texto}`}"${puesto ? raw(' aria-current="true"') : ""}>${filtro.texto}</a>`;
			})}
		</nav>`;
}

/** Un día bloqueada ya es una pregunta que nadie ha visto. */
const HORAS_BLOQUEADA = 24;

/** Tres días en `done` es un resultado que nadie ha revisado. */
const HORAS_DONE = 72;

/**
 * Dónde significa algo la edad en columna. En `backlog` la tarea todavía no es
 * de nadie y en `finished` está archivada: ahí el tiempo no dice nada.
 */
export function muestraEdad(estado: Estado): boolean {
	return estado !== "backlog" && estado !== "finished";
}

/** Lo que hace falta para contar la edad de una tarea. Un `ItemIndice` lo cumple. */
export type ConEdad = {
	estado: Estado;
	marcas: readonly Marca[];
	estadoDesde: string;
	/** Cuándo se hizo la pregunta abierta más antigua, si hay alguna. */
	bloqueadaDesde: string | null;
};

/**
 * La edad en columna: cuánto lleva la tarea donde está. En una bloqueada se
 * cuenta desde la pregunta abierta más antigua y no desde el estado, que es lo
 * que de verdad espera por el humano.
 *
 * Se pinta en `--peligro` cuando duele: un día bloqueada o tres días en `done`.
 */
export function edadEnColumna(item: ConEdad, ahora: Date = new Date()): Html {
	if (!muestraEdad(item.estado)) {
		return html``;
	}
	const bloqueada = item.marcas.includes("bloqueada") ? item.bloqueadaDesde : null;
	const desde = bloqueada ?? item.estadoDesde;
	const horas = horasDesde(desde, ahora);
	const duele = bloqueada === null ? item.estado === "done" && horas > HORAS_DONE : horas > HORAS_BLOQUEADA;
	return html`<span class="edad${duele ? " edad-peligro" : ""}" title="${desde}">${edad(desde, ahora)}</span>`;
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
