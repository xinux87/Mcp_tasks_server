import type { DatabaseSync } from "node:sqlite";
import { ErrorDeRegla } from "../errores.ts";
import { cuerpoPregunta, cuerpoRespuesta } from "../md/pregunta.ts";
import {
	ahora,
	entero,
	enteroOpcional,
	escribirContenido,
	idInsertado,
	sentencia,
	texto,
	textoOpcional,
} from "./base.ts";
import { buscarTerminalPorId, buscarUsuarioPorId } from "./consultas.ts";
import { contarPreguntasAbiertas, exigirTarea, faseQueToca, type Tarea, tocarTarea } from "./tareas.ts";

/** Los seis tipos de comentario del hilo. Se añaden, nunca se editan ni se borran. */
export type TipoComentario = "analisis" | "pregunta" | "respuesta" | "avance" | "resultado" | "nota";

const TIPOS: readonly TipoComentario[] = ["analisis", "pregunta", "respuesta", "avance", "resultado", "nota"];

export type Comentario = {
	id: number;
	tareaId: number;
	tipo: TipoComentario;
	autor: string;
	texto: string;
	/** Solo en `pregunta` y `respuesta`: a qué pregunta pertenece. */
	preguntaId: number | null;
	creado: string;
	revision: number;
};

/** Una opción cerrada de una pregunta, con la consecuencia de elegirla. */
export type Opcion = {
	texto: string;
	consecuencia: string;
};

export type Pregunta = {
	id: number;
	tareaId: number;
	numero: number;
	pregunta: string;
	porQueImporta: string;
	opciones: Opcion[];
	recomendacion: string;
	/** El texto de la opción elegida, nunca su posición. */
	respuestaOpcion: string | null;
	respuestaNota: string | null;
	respondidaPorUsuarioId: number | null;
	respondidaEn: string | null;
	creada: string;
	revision: number;
};

// --- mapeadores de fila ------------------------------------------------------

function esRegistro(valor: unknown): valor is Record<string, unknown> {
	return typeof valor === "object" && valor !== null;
}

function esTipo(valor: string): valor is TipoComentario {
	const nombres: readonly string[] = TIPOS;
	return nombres.includes(valor);
}

function comoTipo(fila: Record<string, unknown>): TipoComentario {
	const valor = texto(fila, "tipo");
	if (!esTipo(valor)) {
		throw new Error(`tipo de comentario desconocido en la base de datos: ${valor}`);
	}
	return valor;
}

function comoComentario(fila: Record<string, unknown>): Comentario {
	return {
		id: entero(fila, "id"),
		tareaId: entero(fila, "tarea_id"),
		tipo: comoTipo(fila),
		autor: texto(fila, "autor"),
		texto: texto(fila, "texto"),
		preguntaId: enteroOpcional(fila, "pregunta_id"),
		creado: texto(fila, "creado"),
		revision: entero(fila, "revision"),
	};
}

/** Las opciones viajan a la base de datos como JSON: son una lista, no columnas. */
function comoOpciones(json: string): Opcion[] {
	const bruto: unknown = JSON.parse(json);
	if (!Array.isArray(bruto)) {
		throw new Error("opciones_json no contiene una lista");
	}
	const lista: unknown[] = bruto;
	return lista.map((elemento) => {
		if (!esRegistro(elemento)) {
			throw new Error("una opción guardada no es un objeto");
		}
		return { texto: texto(elemento, "texto"), consecuencia: texto(elemento, "consecuencia") };
	});
}

function comoPregunta(fila: Record<string, unknown>): Pregunta {
	return {
		id: entero(fila, "id"),
		tareaId: entero(fila, "tarea_id"),
		numero: entero(fila, "numero"),
		pregunta: texto(fila, "pregunta"),
		porQueImporta: texto(fila, "por_que_importa"),
		opciones: comoOpciones(texto(fila, "opciones_json")),
		recomendacion: texto(fila, "recomendacion"),
		respuestaOpcion: textoOpcional(fila, "respuesta_opcion"),
		respuestaNota: textoOpcional(fila, "respuesta_nota"),
		respondidaPorUsuarioId: enteroOpcional(fila, "respondida_por_usuario_id"),
		respondidaEn: textoOpcional(fila, "respondida_en"),
		creada: texto(fila, "creada"),
		revision: entero(fila, "revision"),
	};
}

// --- autores -----------------------------------------------------------------

/**
 * El autor lo compone el servidor, nunca el que escribe. Para una persona es
 * su nombre de usuario en la web.
 */
export function autorHumano(db: DatabaseSync, usuarioId: number): string {
	const usuario = buscarUsuarioPorId(db, usuarioId);
	if (usuario === undefined) {
		throw new ErrorDeRegla("usuario_inexistente", `No existe el usuario ${usuarioId}.`);
	}
	return `humano:${usuario.nombre}`;
}

/**
 * Para un agente, el modelo asignado a la fase que toca y el nombre del
 * terminal autenticado. Sin modelo asignado se escribe `agente`, porque el
 * autor nunca puede quedar vacío.
 */
export function autorAgente(db: DatabaseSync, tarea: Tarea, terminalId: number): string {
	const terminal = buscarTerminalPorId(db, terminalId);
	if (terminal === undefined) {
		throw new ErrorDeRegla("terminal_inexistente", `No existe el terminal ${terminalId}.`);
	}
	const modelo = faseQueToca(tarea) === "analisis" ? tarea.analisisModelo : tarea.ejecucionModelo;
	return `${modelo ?? "agente"}@${terminal.nombre}`;
}

// --- lectura -----------------------------------------------------------------

/** El hilo entero, en el orden en el que se escribió. */
export function comentariosDeTarea(db: DatabaseSync, tareaId: number): Comentario[] {
	return sentencia(db, "SELECT * FROM comentarios WHERE tarea_id = ? ORDER BY id").all(tareaId).map(comoComentario);
}

export function preguntasDeTarea(db: DatabaseSync, tareaId: number): Pregunta[] {
	return sentencia(db, "SELECT * FROM preguntas WHERE tarea_id = ? ORDER BY numero").all(tareaId).map(comoPregunta);
}

export function buscarPregunta(db: DatabaseSync, preguntaId: number): Pregunta | undefined {
	const fila = sentencia(db, "SELECT * FROM preguntas WHERE id = ?").get(preguntaId);
	return fila === undefined ? undefined : comoPregunta(fila);
}

/** Cuántas preguntas de la tarea siguen sin contestar. Es lo que la deja `bloqueada`. */
export function preguntasAbiertas(db: DatabaseSync, tareaId: number): number {
	return contarPreguntasAbiertas(db, tareaId);
}

// --- escritura ---------------------------------------------------------------

export type NuevoComentario = {
	tareaId: number;
	tipo: TipoComentario;
	autor: string;
	texto: string;
	preguntaId: number | null;
};

/**
 * Inserta un comentario dentro de una escritura ya abierta. También deja la
 * revisión en la fila de la tarea: un comentario nuevo es una novedad de la
 * tarea para el terminal que la trabaja.
 */
export function insertarComentario(conexion: DatabaseSync, revision: number, nuevo: NuevoComentario): Comentario {
	const cambios = sentencia(
		conexion,
		`INSERT INTO comentarios (tarea_id, tipo, autor, texto, pregunta_id, creado, revision)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
	).run(nuevo.tareaId, nuevo.tipo, nuevo.autor, nuevo.texto, nuevo.preguntaId, ahora(), revision);
	tocarTarea(conexion, nuevo.tareaId, revision);
	const fila = sentencia(conexion, "SELECT * FROM comentarios WHERE id = ?").get(idInsertado(cambios.lastInsertRowid));
	if (fila === undefined) {
		throw new Error("no se pudo releer el comentario recién escrito");
	}
	return comoComentario(fila);
}

export type ComentarioDeAgente = {
	tareaId: number;
	terminalId: number;
	texto: string;
};

/**
 * Comentario `analisis`: qué hay que hacer, plan y riesgos. Es el que da el
 * análisis por hecho y suelta la marca «en marcha» de esa fase.
 */
export function comentarAnalisis(db: DatabaseSync, datos: ComentarioDeAgente): Comentario {
	return escribirContenido(db, (conexion, revision) => {
		const tarea = exigirTarea(conexion, datos.tareaId);
		if (tarea.estado !== "prepared") {
			throw new ErrorDeRegla(
				"estado_no_permite_analisis",
				`La tarea está en ${tarea.estado}: el análisis se escribe en prepared.`,
			);
		}
		if (tarea.analisisTerminalId !== datos.terminalId) {
			throw new ErrorDeRegla("fase_no_tomada", "Este terminal no es el responsable del análisis de esta tarea.");
		}
		// El autor se compone antes de marcar el análisis como hecho: la fase
		// que toca todavía es «análisis» y el modelo es el de esa fase.
		const autor = autorAgente(conexion, tarea, datos.terminalId);
		const comentario = insertarComentario(conexion, revision, {
			tareaId: tarea.id,
			tipo: "analisis",
			autor,
			texto: datos.texto,
			preguntaId: null,
		});
		sentencia(
			conexion,
			"UPDATE tareas SET analisis_hecho = 1, en_marcha_terminal_id = NULL, actualizada = ?, revision = ? WHERE id = ?",
		).run(ahora(), revision, tarea.id);
		return comentario;
	});
}

/** Comprueba que el terminal es el que ejecuta la tarea y que está en `doing`. */
function exigirEjecucionEnMarcha(conexion: DatabaseSync, tareaId: number, terminalId: number, codigo: string): Tarea {
	const tarea = exigirTarea(conexion, tareaId);
	if (tarea.estado !== "doing") {
		throw new ErrorDeRegla(codigo, `La tarea está en ${tarea.estado}: la ejecución solo escribe en doing.`);
	}
	if (tarea.ejecucionTerminalId !== terminalId) {
		throw new ErrorDeRegla("fase_no_tomada", "Este terminal no es el responsable de la ejecución de esta tarea.");
	}
	return tarea;
}

/** Comentario `avance`: en qué punto va la ejecución. No mueve la tarea. */
export function comentarAvance(db: DatabaseSync, datos: ComentarioDeAgente): Comentario {
	return escribirContenido(db, (conexion, revision) => {
		const tarea = exigirEjecucionEnMarcha(conexion, datos.tareaId, datos.terminalId, "estado_no_permite_avance");
		return insertarComentario(conexion, revision, {
			tareaId: tarea.id,
			tipo: "avance",
			autor: autorAgente(conexion, tarea, datos.terminalId),
			texto: datos.texto,
			preguntaId: null,
		});
	});
}

/**
 * Comentario `resultado`: qué se construyó y el commit. Es lo que pasa la
 * tarea a `done` y cierra la fase de ejecución.
 */
export function comentarResultado(db: DatabaseSync, datos: ComentarioDeAgente): Comentario {
	return escribirContenido(db, (conexion, revision) => {
		const tarea = exigirEjecucionEnMarcha(conexion, datos.tareaId, datos.terminalId, "estado_no_permite_resultado");
		const comentario = insertarComentario(conexion, revision, {
			tareaId: tarea.id,
			tipo: "resultado",
			autor: autorAgente(conexion, tarea, datos.terminalId),
			texto: datos.texto,
			preguntaId: null,
		});
		sentencia(
			conexion,
			`UPDATE tareas
				SET estado = 'done', orden = (SELECT COALESCE(MAX(orden), 0) + 1 FROM tareas WHERE estado = 'done'),
					en_marcha_terminal_id = NULL, actualizada = ?, revision = ?
				WHERE id = ?`,
		).run(ahora(), revision, tarea.id);
		return comentario;
	});
}

export type NuevaPregunta = {
	tareaId: number;
	terminalId: number;
	pregunta: string;
	porQueImporta: string;
	opciones: Opcion[];
	recomendacion: string;
};

/**
 * `preguntar`: el agente manda los campos por separado y el servidor los
 * coloca en el hilo. Deja la tarea `bloqueada` hasta que se conteste.
 */
export function preguntar(db: DatabaseSync, datos: NuevaPregunta): Pregunta {
	return escribirContenido(db, (conexion, revision) => {
		const tarea = exigirTarea(conexion, datos.tareaId);
		const puedePreguntar =
			(tarea.estado === "prepared" && tarea.analisisTerminalId === datos.terminalId) ||
			(tarea.estado === "doing" && tarea.ejecucionTerminalId === datos.terminalId);
		if (!puedePreguntar) {
			throw new ErrorDeRegla(
				"no_puede_preguntar",
				"Solo pregunta el terminal de análisis con la tarea en prepared o el de ejecución con la tarea en doing.",
			);
		}
		validarOpciones(datos.opciones, datos.recomendacion);

		const siguiente = sentencia(
			conexion,
			"SELECT COALESCE(MAX(numero), 0) + 1 AS siguiente FROM preguntas WHERE tarea_id = ?",
		).get(tarea.id);
		if (siguiente === undefined) {
			throw new Error("MAX(numero) no devolvió ninguna fila");
		}
		const cambios = sentencia(
			conexion,
			`INSERT INTO preguntas (tarea_id, numero, pregunta, por_que_importa, opciones_json, recomendacion, creada, revision)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			tarea.id,
			entero(siguiente, "siguiente"),
			datos.pregunta,
			datos.porQueImporta,
			JSON.stringify(datos.opciones),
			datos.recomendacion,
			ahora(),
			revision,
		);
		const preguntaId = idInsertado(cambios.lastInsertRowid);
		insertarComentario(conexion, revision, {
			tareaId: tarea.id,
			tipo: "pregunta",
			autor: autorAgente(conexion, tarea, datos.terminalId),
			texto: cuerpoPregunta({
				pregunta: datos.pregunta,
				porQueImporta: datos.porQueImporta,
				opciones: datos.opciones,
				recomendacion: datos.recomendacion,
			}),
			preguntaId,
		});
		const creada = buscarPregunta(conexion, preguntaId);
		if (creada === undefined) {
			throw new Error("no se pudo releer la pregunta recién escrita");
		}
		return creada;
	});
}

/** Una pregunta lleva opciones cerradas, distintas, y una recomendación que es una de ellas. */
function validarOpciones(opciones: Opcion[], recomendacion: string): void {
	if (opciones.length < 2) {
		throw new ErrorDeRegla("pocas_opciones", "Una pregunta lleva al menos dos opciones, incluida la de no hacer nada.");
	}
	const textos = new Set<string>();
	for (const opcion of opciones) {
		if (opcion.texto.trim() === "") {
			throw new ErrorDeRegla("opcion_vacia", "Ninguna opción puede tener el texto vacío.");
		}
		if (textos.has(opcion.texto)) {
			throw new ErrorDeRegla("opciones_repetidas", `Hay dos opciones con el mismo texto: «${opcion.texto}».`);
		}
		textos.add(opcion.texto);
	}
	if (!textos.has(recomendacion)) {
		throw new ErrorDeRegla(
			"recomendacion_invalida",
			`La recomendación «${recomendacion}» tiene que ser el texto exacto de una de las opciones.`,
		);
	}
}

export type Respuesta = {
	preguntaId: number;
	usuarioId: number;
	opcion: string;
	nota?: string;
};

/**
 * La respuesta del humano. Se guarda el texto de la opción, nunca su posición:
 * un índice se rompe en silencio al reordenar y deja escrita una decisión que
 * nadie tomó.
 */
export function responder(db: DatabaseSync, datos: Respuesta): Pregunta {
	return escribirContenido(db, (conexion, revision) => {
		const pregunta = buscarPregunta(conexion, datos.preguntaId);
		if (pregunta === undefined) {
			throw new ErrorDeRegla("pregunta_inexistente", `No existe la pregunta ${datos.preguntaId}.`);
		}
		if (pregunta.respuestaOpcion !== null) {
			throw new ErrorDeRegla(
				"pregunta_ya_respondida",
				`La pregunta P${pregunta.numero} ya está contestada: «${pregunta.respuestaOpcion}».`,
			);
		}
		if (!pregunta.opciones.some((opcion) => opcion.texto === datos.opcion)) {
			throw new ErrorDeRegla(
				"opcion_inexistente",
				`«${datos.opcion}» no es ninguna de las opciones de la pregunta P${pregunta.numero}.`,
			);
		}
		const autor = autorHumano(conexion, datos.usuarioId);
		const nota = datos.nota ?? null;
		sentencia(
			conexion,
			`UPDATE preguntas
				SET respuesta_opcion = ?, respuesta_nota = ?, respondida_por_usuario_id = ?, respondida_en = ?, revision = ?
				WHERE id = ?`,
		).run(datos.opcion, nota, datos.usuarioId, ahora(), revision, pregunta.id);
		insertarComentario(conexion, revision, {
			tareaId: pregunta.tareaId,
			tipo: "respuesta",
			autor,
			texto: cuerpoRespuesta({ opcion: datos.opcion, nota }),
			preguntaId: pregunta.id,
		});
		const contestada = buscarPregunta(conexion, pregunta.id);
		if (contestada === undefined) {
			throw new Error("no se pudo releer la pregunta recién contestada");
		}
		return contestada;
	});
}

export type NotaHumana = {
	tareaId: number;
	usuarioId: number;
	texto: string;
};

/**
 * Comentario `nota`: cualquier indicación del humano durante la tarea. Es por
 * donde entra todo cambio posterior a salir de `backlog`, para que el agente
 * lo lea en contexto sin que se pierda qué se pidió al principio.
 */
export function notaHumana(db: DatabaseSync, datos: NotaHumana): Comentario {
	return escribirContenido(db, (conexion, revision) => {
		const tarea = exigirTarea(conexion, datos.tareaId);
		if (tarea.estado === "finished") {
			throw new ErrorDeRegla("tarea_archivada", "Una tarea finished está archivada y es de solo lectura.");
		}
		return insertarComentario(conexion, revision, {
			tareaId: tarea.id,
			tipo: "nota",
			autor: autorHumano(conexion, datos.usuarioId),
			texto: datos.texto,
			preguntaId: null,
		});
	});
}
