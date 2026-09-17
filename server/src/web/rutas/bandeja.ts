import type { DatabaseSync } from "node:sqlite";
import type { Context, Hono } from "hono";
import { html } from "hono/html";
import { bandejaDelHumano } from "../../db/bandeja.ts";
import { revisionActual } from "../../db/consultas.ts";
import { type Comentario, comentariosDeTarea, preguntasDeTarea, type TipoComentario } from "../../db/hilo.ts";
import { listarProyectos, type Proyecto } from "../../db/proyectos.ts";
import { type ItemIndice, listarTareas } from "../../db/tareas.ts";
import { formatearId } from "../../md/ids.ts";
import { buscadorDeColor, chipAutor, chipProyecto, edadEnColumna } from "../componentes.ts";
import { edad } from "../formatos.ts";
import { ESTADO_AVISO } from "../formulario.ts";
import { type ColorDe, tarjetaComentario, tarjetaPreguntaAbierta } from "../hilo.ts";
import { type Html, insigniaEstado, pagina, type RespuestaHtml } from "../plantilla.ts";
import { type DependenciasWeb, usuarioActual } from "../sesion.ts";
import { navProyectos } from "./proyectos.ts";

/**
 * La bandeja del humano: lo que espera por él, de todos los proyectos. Es la
 * página de inicio, y se contesta y se aprueba desde aquí sin abrir la ficha:
 * cada formulario lleva un `volver` a `/`.
 *
 * Las tarjetas son las mismas del hilo (`web/hilo.ts`): nada se pinta dos veces
 * con dos plantillas.
 */

/** La clave de cada proyecto, para el chip de cada línea. Una lectura por página. */
type Claves = Map<number, Proyecto>;

/** Lo que hace falta para pintar cualquier bloque. Se arma una vez por página. */
type Entorno = {
	db: DatabaseSync;
	claves: Claves;
	colorDe: ColorDe;
	/** Todas las tareas, para sacar las partes de una funcionalidad sin más consultas. */
	items: ItemIndice[];
};

/** El último comentario de un tipo, que es el que cuenta: el hilo solo crece. */
function ultimo(db: DatabaseSync, tareaId: number, tipo: TipoComentario): Comentario | undefined {
	return comentariosDeTarea(db, tareaId)
		.filter((comentario) => comentario.tipo === tipo)
		.at(-1);
}

/**
 * La cabecera de un pendiente: su proyecto, su identificador enlazado, su
 * título, quién escribió lo que hay que atender y cuánto lleva esperando. Va
 * dentro de la misma tarjeta que el cuerpo, separada por un borde: una línea
 * suelta encima parecía de otra cosa.
 *
 * En `backlog` la edad en columna no se pinta (ahí no significa nada), pero en
 * la bandeja sí: es justo lo que se está mirando.
 */
function cabeceraItem(item: ItemIndice, claves: Claves, quien: Html, cuanto?: Html): Html {
	const id = formatearId(item.codigo);
	const proyecto = claves.get(item.proyectoId);
	return html`<div class="cabecera-item">
			${proyecto === undefined ? html`` : chipProyecto(proyecto)}
			<a class="id-tarea" href="/tareas/${id}">${id}</a>
			<span class="titulo">${item.titulo}</span>
			${quien}
			${cuanto ?? edadEnColumna(item)}
		</div>`;
}

/** Quién escribió lo último de ese tipo. Sin nada escrito, nadie que enseñar. */
function autorDe(entorno: Entorno, tareaId: number, tipo: TipoComentario): Html {
	const cual = ultimo(entorno.db, tareaId, tipo);
	return cual === undefined ? html`` : chipAutor(cual.autor, entorno.colorDe);
}

/**
 * Un bloque de la bandeja: el verbo que le toca al humano con su contador, una
 * línea que dice qué es, y lo que haya dentro. El título es lo que hay que
 * hacer, no cómo se llama la columna de la que sale. Cada pendiente es una sola
 * tarjeta, con su cabecera y su cuerpo dentro.
 */
function bloque(titulo: string, queEs: string, items: ItemIndice[], pintar: (item: ItemIndice) => Html): Html {
	return html`<section class="grupo bloque-bandeja">
			<h2>${titulo} <span class="contador">(${items.length})</span></h2>
			<p class="que-es">${queEs}</p>
			${
				items.length === 0
					? html`<p class="silencio">Nada pendiente.</p>`
					: html`${items.map((item) => html`<article class="item">${pintar(item)}</article>`)}`
			}
		</section>`;
}

/** Una tarea bloqueada: su cabecera y cada pregunta abierta con su formulario. */
function preguntasSinContestar(item: ItemIndice, entorno: Entorno): Html {
	const abiertas = preguntasDeTarea(entorno.db, item.id).filter((pregunta) => pregunta.respuestaOpcion === null);
	return html`${cabeceraItem(item, entorno.claves, autorDe(entorno, item.id, "pregunta"))}
		<div class="cuerpo-item">
			${abiertas.map((pregunta) => tarjetaPreguntaAbierta(item, pregunta, { volver: "/" }))}
		</div>`;
}

/** Las partes de una funcionalidad, para revisarlas antes de aprobar la descomposición. */
function partesDeLaFuncionalidad(item: ItemIndice, entorno: Entorno): Html {
	const partes = entorno.items.filter((otra) => otra.padreId === item.id);
	if (partes.length === 0) {
		return html``;
	}
	return html`<ul class="hijas">
			${partes.map((parte) => {
				const id = formatearId(parte.codigo);
				return html`<li>${insigniaEstado(parte.estado)} <a class="id-tarea" href="/tareas/${id}">${id}</a> ${parte.titulo}</li>`;
			})}
		</ul>`;
}

/** Una tarea con el análisis hecho: el comentario y el botón que lo aprueba. */
function porAprobar(item: ItemIndice, entorno: Entorno): Html {
	const analisis = ultimo(entorno.db, item.id, "analisis");
	const esFuncionalidad = item.tipo === "funcionalidad";
	return html`${cabeceraItem(item, entorno.claves, autorDe(entorno, item.id, "analisis"))}
		<div class="cuerpo-item">
			${
				analisis === undefined
					? html`<p class="silencio">Sin análisis en el hilo.</p>`
					: tarjetaComentario(analisis, entorno.colorDe)
			}
			${esFuncionalidad ? partesDeLaFuncionalidad(item, entorno) : html``}
			<form method="post" action="/tareas/${formatearId(item.codigo)}/aprobar">
				<input type="hidden" name="volver" value="/">
				<button type="submit" class="principal">${esFuncionalidad ? "Aprobar descomposición" : "Aprobar ejecución"}</button>
			</form>
		</div>`;
}

/**
 * Una tarea en `done`: su resultado y, en el pie, las dos salidas que tiene el
 * humano en una sola fila: escribir qué falta y pedir otra iteración, o
 * finalizarla. El campo es de una línea porque aquí se pide algo corto; lo
 * largo se escribe en la ficha, que va enlazada.
 */
function porRevisar(item: ItemIndice, entorno: Entorno): Html {
	const resultado = ultimo(entorno.db, item.id, "resultado");
	const id = formatearId(item.codigo);
	return html`${cabeceraItem(item, entorno.claves, autorDe(entorno, item.id, "resultado"))}
		<div class="cuerpo-item">
			${
				resultado === undefined
					? html`<p class="silencio">Sin resultado en el hilo.</p>`
					: tarjetaComentario(resultado, entorno.colorDe)
			}
			<div class="pie-item">
				<form class="iterar" method="post" action="/tareas/${id}/comentar">
					<input type="hidden" name="volver" value="/">
					<input type="text" name="texto" required aria-label="Mensaje para el agente" placeholder="Escribe al agente para pedir otra iteración…">
					<button type="submit" name="iterar" value="1">Pedir otra iteración</button>
				</form>
				<form method="post" action="/tareas/${id}/mover">
					<input type="hidden" name="estado" value="finished">
					<input type="hidden" name="volver" value="/">
					<button type="submit" class="principal">Finalizar</button>
				</form>
				<a href="/tareas/${id}">Abrir la ficha</a>
			</div>
		</div>`;
}

/**
 * `GET /`. Cruza todos los proyectos y se refresca como la lista: `revision` en
 * el cuerpo y recarga con GET cuando sube. El aviso es el de un `ErrorDeRegla`
 * de una acción lanzada desde aquí.
 */
export function paginaBandeja(c: Context, deps: DependenciasWeb, aviso: string | null = null): RespuestaHtml {
	const { db } = deps;
	const ahora = new Date();
	const bandeja = bandejaDelHumano(db, ahora, deps.config.FASE_PARADA_HORAS);
	const entorno: Entorno = {
		db,
		claves: new Map(listarProyectos(db).map((proyecto) => [proyecto.id, proyecto])),
		colorDe: buscadorDeColor(db),
		items: listarTareas(db),
	};
	const cuerpo = html`${bloque(
		"Contesta",
		"Preguntas de los agentes que no pueden seguir sin ti.",
		bandeja.bloqueadas,
		(item) => preguntasSinContestar(item, entorno),
	)}
		${bloque("Aprueba", "Análisis y descomposiciones que esperan tu visto bueno.", bandeja.porAprobar, (item) =>
			porAprobar(item, entorno),
		)}
		${bloque("Revisa", "Resultados terminados que esperan tu revisión.", bandeja.porRevisar, (item) =>
			porRevisar(item, entorno),
		)}
		${bloque("Define", "Tareas que llevan más de siete días sin definir.", bandeja.sinDefinir, (item) =>
			// Solo la cabecera: aquí no hay nada del agente que atender, y la edad
			// en columna, que en backlog no se pinta sola, es justo el dato.
			cabeceraItem(
				item,
				entorno.claves,
				html``,
				html`<span class="edad" title="${item.estadoDesde}">${edad(item.estadoDesde, ahora)}</span>`,
			),
		)}`;
	return c.html(
		pagina({
			...navProyectos(c, db),
			titulo: "Bandeja",
			proposito: "Lo que espera por ti, de todos los proyectos.",
			usuario: usuarioActual(c),
			vista: "bandeja",
			revision: revisionActual(db),
			aviso,
			cuerpo,
		}),
		aviso === null ? 200 : ESTADO_AVISO,
	);
}

export function registrarRutasBandeja(app: Hono, deps: DependenciasWeb): void {
	app.get("/", (c) => paginaBandeja(c, deps));
}
