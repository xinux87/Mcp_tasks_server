import { html, raw } from "hono/html";
import type { Comentario, Pregunta } from "../db/hilo.ts";
import { formatearId } from "../md/ids.ts";
import { type Color, chipAutor } from "./componentes.ts";
import { fechaLegible } from "./formatos.ts";
import { renderMarkdown } from "./markdown.ts";
import { type Html, insigniaTipo } from "./plantilla.ts";

/**
 * Las piezas del hilo de una tarea. Viven aquí y no en la ficha porque la
 * bandeja del humano enseña las mismas: una pregunta abierta con su formulario
 * y un comentario renderizado se ven igual se llegue por donde se llegue.
 */

/** Cómo se resuelve el color de un usuario al pintar. Una vez por página. */
export type ColorDe = (nombre: string) => Color | null;

export type OpcionesComentario = {
	/** El `P<n>` de la cabecera. Solo lo llevan las preguntas y sus respuestas. */
	numero?: number | null;
	/** Lo que va dentro de la tarjeta, debajo del cuerpo: el formulario de respuesta. */
	extra?: Html;
};

/**
 * Un comentario del hilo: cabecera con el chip de quien escribe, la etiqueta
 * de su tipo, el `P<n>` cuando toca y la fecha; debajo, el cuerpo renderizado.
 */
export function tarjetaComentario(
	comentario: Comentario,
	colorDe: ColorDe,
	{ numero = null, extra = html`` }: OpcionesComentario = {},
): Html {
	return html`<article class="comentario">
			<header>
				${chipAutor(comentario.autor, colorDe)}
				${insigniaTipo(comentario.tipo)}
				${numero === null ? html`` : html`<span>P${numero}</span>`}
				<span>${fechaLegible(comentario.creado)}</span>
			</header>
			<div class="cuerpo">${raw(renderMarkdown(comentario.texto))}</div>
			${extra}
		</article>`;
}

/** Una opción de una pregunta abierta: tarjeta seleccionable con su consecuencia. */
function opcionDePregunta(texto: string, consecuencia: string, recomendada: boolean): Html {
	return html`<label class="opcion">
			<input type="radio" name="opcion" value="${texto}" required>
			<span class="que">${texto}${recomendada ? html`<span class="recomendada">recomendada</span>` : html``}</span>
			<span class="consecuencia">${consecuencia}</span>
		</label>`;
}

/**
 * El formulario de respuesta: las opciones como tarjetas, la nota y el botón.
 * `volver` es la ruta a la que redirigir al contestar; sin él se vuelve a la
 * ficha, que es lo que hace la propia ficha.
 */
export function formularioRespuesta(tareaId: number, pregunta: Pregunta, volver?: string): Html {
	return html`<form class="responder" method="post" action="/tareas/${formatearId(tareaId)}/responder/P${pregunta.numero}">
			<fieldset>
				<legend>Responder a P${pregunta.numero}</legend>
				${volver === undefined ? html`` : html`<input type="hidden" name="volver" value="${volver}">`}
				${pregunta.opciones.map((opcion) =>
					opcionDePregunta(opcion.texto, opcion.consecuencia, opcion.texto === pregunta.recomendacion),
				)}
				<label>
					<span>Nota (opcional)</span>
					<textarea name="nota" rows="3"></textarea>
				</label>
				<button type="submit" class="principal">Responder</button>
			</fieldset>
		</form>`;
}

/** Lo que hace falta para enseñar una pregunta fuera de su hilo: de qué tarea es. */
export type TareaDeLaPregunta = {
	id: number;
	titulo: string;
};

export type OpcionesPregunta = {
	/** Ruta a la que volver al contestar. Sin ella, la ficha de la tarea. */
	volver?: string;
};

/**
 * Una pregunta abierta con todo lo que hace falta para contestarla: la
 * pregunta en negrita, por qué importa, las opciones y el formulario. Se pinta
 * desde los campos de la pregunta, no desde el Markdown del hilo, porque quien
 * la enseña fuera de la ficha no tiene el comentario delante.
 */
export function tarjetaPreguntaAbierta(
	tarea: TareaDeLaPregunta,
	pregunta: Pregunta,
	{ volver }: OpcionesPregunta = {},
): Html {
	// El ancla es a donde lleva el «Responder arriba» del hilo de la ficha. Lleva
	// el id de la tarea porque la bandeja pinta preguntas de varias tareas.
	return html`<article class="comentario pregunta-abierta" id="pregunta-${formatearId(tarea.id)}-P${pregunta.numero}">
			<header>
				<a class="id-tarea" href="/tareas/${formatearId(tarea.id)}">${formatearId(tarea.id)}</a>
				<span>${tarea.titulo}</span>
				<span>P${pregunta.numero}</span>
				<span>${fechaLegible(pregunta.creada)}</span>
			</header>
			<div class="cuerpo">
				<p><strong>${pregunta.pregunta}</strong></p>
				<p class="silencio">${pregunta.porQueImporta}</p>
			</div>
			${formularioRespuesta(tarea.id, pregunta, volver)}
		</article>`;
}
