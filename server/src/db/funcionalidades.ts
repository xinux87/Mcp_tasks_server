import type { DatabaseSync } from "node:sqlite";
import { ErrorDeRegla } from "../errores.ts";
import { entero, escribirContenido, SOLTAR_FASE, sentencia, texto } from "./base.ts";
import { escribirDependencias } from "./dependencias.ts";
import { exigirTitulo } from "./edicion.ts";
import { AUTOR_SERVIDOR, insertarComentario } from "./hilo.ts";
import { cambiarEstado, comoTarea, crearTareaHumana, exigirTarea, insertarTarea, type Tarea } from "./tareas.ts";

/**
 * Tareas descompuestas: una funcionalidad, que es lo que pide el humano en
 * lenguaje de negocio, o cualquier tarea cuyo análisis la partió en partes
 * (ver `ES_DESCOMPUESTA` en `tareas.ts`). Su «ejecución» son sus partes, que
 * crea el análisis al descomponerla o el humano, y que el humano aprueba antes
 * de que ningún agente las trabaje.
 *
 * Aquí vive todo lo que solo pasa en una descompuesta: crear una parte,
 * aprobar la descomposición y cerrarla sola cuando la última parte se cierra.
 */

export type PartesDeFuncionalidad = {
	total: number;
	/** Partes ya aceptadas por el humano: son las que cuentan para cerrarla. */
	cerradas: number;
};

/**
 * Cuántas partes tiene la madre y cuántas están cerradas. Solo cuentan las de
 * clase `parte`: una hija de trabajo no es un trozo del plan.
 */
export function partesDe(db: DatabaseSync, madreId: number): PartesDeFuncionalidad {
	const fila = sentencia(
		db,
		`SELECT COUNT(*) AS total, COUNT(CASE WHEN estado = 'finished' THEN 1 END) AS cerradas
			FROM tareas WHERE padre_id = ? AND clase = 'parte'`,
	).get(madreId);
	if (fila === undefined) {
		throw new Error("el recuento de partes no devolvió ninguna fila");
	}
	return { total: entero(fila, "total"), cerradas: entero(fila, "cerradas") };
}

/** Las partes de una tarea (sus hijas de clase `parte`), en orden de id. */
function partesDirectas(conexion: DatabaseSync, madreId: number): Tarea[] {
	return sentencia(conexion, "SELECT * FROM tareas WHERE padre_id = ? AND clase = 'parte' ORDER BY id")
		.all(madreId)
		.map(comoTarea);
}

export type NuevaParte = {
	titulo: string;
	descripcion: string;
	padreId: number;
	terminalId: number;
	/** Otras partes de la misma madre que tienen que ir antes. */
	dependeDe?: number[];
};

/**
 * Parte de una funcionalidad o de una tarea: la crea su análisis al
 * descomponerla. Nace en `backlog` colgando de la madre y hereda su rama, sus
 * modelos y sus terminales; el humano la revisa antes de aprobar la
 * descomposición.
 */
export function crearParte(db: DatabaseSync, datos: NuevaParte): Tarea {
	return escribirContenido(db, (conexion, revision) => {
		const padre = exigirTarea(conexion, datos.padreId);
		exigirDescomposicionEnMarcha(padre, datos.terminalId);
		const parte = insertarTarea(conexion, revision, {
			// Una parte vive en el proyecto de su madre: lo hereda, como la rama y
			// las asignaciones.
			proyectoId: padre.proyectoId,
			titulo: datos.titulo,
			descripcion: datos.descripcion,
			tipo: "tarea",
			rama: padre.rama,
			estado: "backlog",
			padreId: padre.id,
			clase: "parte",
			autoejecucion: padre.autoejecucion,
			analisisHecho: false,
			// Una parte hereda también el papel de cada fase, no solo el modelo
			// y el terminal: es el mismo reparto de la madre.
			analisisAgenteId: padre.analisisAgenteId,
			analisisModelo: padre.analisisModelo,
			analisisTerminalId: padre.analisisTerminalId,
			ejecucionAgenteId: padre.ejecucionAgenteId,
			ejecucionModelo: padre.ejecucionModelo,
			ejecucionTerminalId: padre.ejecucionTerminalId,
			enMarchaTerminalId: null,
			creadaPorUsuarioId: null,
			creadaPorTerminalId: datos.terminalId,
		});
		const dependeDe = datos.dependeDe ?? [];
		if (dependeDe.length > 0) {
			exigirPartesDelMismoPadre(conexion, padre.id, dependeDe);
			escribirDependencias(conexion, parte.id, dependeDe);
		}
		return exigirTarea(conexion, parte.id);
	});
}

/**
 * Una parte solo se crea desde el análisis de su madre, y por su terminal. La
 * madre es una funcionalidad o una tarea; una pregunta se cierra con su
 * respuesta y no se descompone.
 */
function exigirDescomposicionEnMarcha(padre: Tarea, terminalId: number): void {
	if (padre.tipo === "pregunta") {
		throw new ErrorDeRegla(
			"solo_desde_descomposicion",
			`La tarea ${padre.codigo} es una pregunta: se contesta, no se descompone en partes.`,
		);
	}
	if (padre.estado !== "prepared") {
		throw new ErrorDeRegla(
			"solo_desde_descomposicion",
			`La tarea está en ${padre.estado}: sus partes se crean mientras se analiza, en prepared.`,
		);
	}
	if (padre.analisisTerminalId !== terminalId) {
		throw new ErrorDeRegla("solo_desde_descomposicion", "Este terminal no es el responsable del análisis de esa tarea.");
	}
}

/** Una parte solo puede depender de otras partes de su misma madre. */
function exigirPartesDelMismoPadre(conexion: DatabaseSync, padreId: number, dependeDe: readonly number[]): void {
	for (const otra of dependeDe) {
		const candidata = exigirTarea(conexion, otra);
		if (candidata.padreId !== padreId) {
			throw new ErrorDeRegla(
				"dependencia_fuera_de_la_funcionalidad",
				`La tarea ${candidata.codigo} no es una parte de esta misma tarea: una parte solo depende de sus hermanas.`,
			);
		}
	}
}

/** El análisis de una funcionalidad es su descomposición: sin partes no hay nada que aprobar. */
export function exigirPartes(conexion: DatabaseSync, funcionalidad: Tarea): void {
	if (partesDe(conexion, funcionalidad.id).total === 0) {
		throw new ErrorDeRegla(
			"sin_partes",
			"Una funcionalidad se cierra en análisis con sus partes creadas. Si no es viable descomponerla, pregunta.",
		);
	}
}

/**
 * Aprobar la descomposición: la madre pasa a `doing` y sus partes en `backlog`
 * pasan a `prepared` conservando el orden en el que están. Si la madre tiene
 * rama y no cuelga de nadie, se crea además la parte que integra esa rama en
 * la principal, que depende de todas las demás. Una madre que es a su vez
 * parte de otra trabaja en la rama heredada, y la integra quien la fijó.
 *
 * Corre dentro de la escritura que abre `aprobarEjecucion`.
 */
export function aprobarDescomposicion(conexion: DatabaseSync, revision: number, madre: Tarea): void {
	if (madre.estado !== "prepared") {
		throw new ErrorDeRegla(
			"estado_no_permite_aprobar",
			`La tarea está en ${madre.estado}: la descomposición se aprueba en prepared.`,
		);
	}
	if (!madre.analisisHecho) {
		throw new ErrorDeRegla("analisis_no_hecho", "Todavía no hay descomposición que aprobar.");
	}
	const abiertas = sentencia(
		conexion,
		"SELECT COUNT(*) AS total FROM preguntas WHERE tarea_id = ? AND respuesta_opcion IS NULL",
	).get(madre.id);
	if (abiertas !== undefined && entero(abiertas, "total") > 0) {
		throw new ErrorDeRegla(
			"tarea_bloqueada",
			"La tarea tiene preguntas sin contestar: contéstalas antes de aprobar la descomposición.",
		);
	}

	cambiarEstado(conexion, revision, madre.id, "doing", `, ejecucion_aprobada = 1${SOLTAR_FASE}`);

	// Las partes salen a `prepared` en el orden que traían, detrás de lo que ya
	// hubiera en esa columna: cada una entra al final, que es lo que hace
	// `cambiarEstado`, y así conservan su orden relativo.
	const enBacklog = partesDirectas(conexion, madre.id).filter((parte) => parte.estado === "backlog");
	const ordenados = [...enBacklog].sort((uno, otro) => uno.orden - otro.orden || uno.id - otro.id);
	for (const parte of ordenados) {
		cambiarEstado(conexion, revision, parte.id, "prepared");
	}

	if (madre.rama !== null && madre.padreId === null) {
		crearParteDeIntegracion(conexion, revision, madre);
	}
}

/** Descripción fija de la parte que integra la rama. Va en llano, como cualquier tarea. */
function descripcionDeIntegracion(rama: string): string {
	return [
		`Llevar a la rama principal todo lo hecho en la rama «${rama}», una vez que las demás partes están terminadas.`,
		"",
		"Cómo se sabe que está hecho: la fusión se hace sin fast-forward, la verificación del repositorio pasa después de fusionar y el resultado cita el commit de la fusión.",
	].join("\n");
}

/**
 * La última parte de una funcionalidad con rama: integrar esa rama en la
 * principal. Depende de todas las demás partes, así que no se puede tomar
 * hasta que estén cerradas. La crea el servidor al aprobar, no el análisis.
 */
function crearParteDeIntegracion(conexion: DatabaseSync, revision: number, madre: Tarea): Tarea {
	const rama = madre.rama ?? "";
	const parte = insertarTarea(conexion, revision, {
		proyectoId: madre.proyectoId,
		titulo: `Integrar la rama \`${rama}\` en la principal`,
		descripcion: descripcionDeIntegracion(rama),
		tipo: "tarea",
		rama: madre.rama,
		estado: "prepared",
		padreId: madre.id,
		clase: "parte",
		autoejecucion: madre.autoejecucion,
		analisisHecho: false,
		analisisAgenteId: madre.analisisAgenteId,
		analisisModelo: madre.analisisModelo,
		analisisTerminalId: madre.analisisTerminalId,
		ejecucionAgenteId: madre.ejecucionAgenteId,
		ejecucionModelo: madre.ejecucionModelo,
		ejecucionTerminalId: madre.ejecucionTerminalId,
		enMarchaTerminalId: null,
		creadaPorUsuarioId: null,
		creadaPorTerminalId: null,
	});
	const hermanas = partesDirectas(conexion, madre.id)
		.filter((hermana) => hermana.id !== parte.id)
		.map((hermana) => hermana.id);
	if (hermanas.length > 0) {
		escribirDependencias(conexion, parte.id, hermanas);
	}
	return exigirTarea(conexion, parte.id);
}

/** El commit que citó una parte al cerrarse, o `sin commit` si no citó ninguno. */
function commitDe(conexion: DatabaseSync, parteId: number): string {
	const fila = sentencia(
		conexion,
		"SELECT texto FROM comentarios WHERE tarea_id = ? AND tipo = 'resultado' ORDER BY id DESC LIMIT 1",
	).get(parteId);
	if (fila === undefined) {
		return "sin commit";
	}
	const lineas = texto(fila, "texto")
		.split("\n")
		.map((linea) => linea.trim())
		.filter((linea) => linea.startsWith("Commit:"));
	return lineas.at(-1) ?? "sin commit";
}

/**
 * Cierra la madre descompuesta cuando su última parte se acepta: pasa a
 * `done` y deja un comentario `resultado` firmado por el servidor con cada
 * parte y su commit. Las hijas de trabajo cuelgan de la parte que se ejecuta y
 * no son partes de nadie, así que no cuentan.
 *
 * Corre dentro de la escritura que mueve la parte a `finished`.
 */
export function cerrarFuncionalidadSiProcede(conexion: DatabaseSync, revision: number, parteId: number): void {
	cerrarPadreSiProcede(conexion, revision, exigirTarea(conexion, parteId).padreId);
}

/**
 * Lo mismo, pero a partir del padre. Es lo que necesita el borrado de una
 * parte: cuando toca comprobarlo, la parte ya no existe.
 */
export function cerrarPadreSiProcede(conexion: DatabaseSync, revision: number, padreId: number | null): void {
	if (padreId === null) {
		return;
	}
	const madre = exigirTarea(conexion, padreId);
	if (madre.estado !== "doing") {
		return;
	}
	// Sin partes la madre no está descompuesta (o es una funcionalidad vacía):
	// no hay nada que cierre por ella.
	const partes = partesDirectas(conexion, madre.id);
	if (partes.length === 0 || partes.some((hermana) => hermana.estado !== "finished")) {
		return;
	}
	insertarComentario(conexion, revision, {
		tareaId: madre.id,
		tipo: "resultado",
		autor: AUTOR_SERVIDOR,
		texto: partes
			.map((hermana) => `- ${hermana.codigo} · ${hermana.titulo} · ${commitDe(conexion, hermana.id)}`)
			.join("\n"),
		preguntaId: null,
	});
	cambiarEstado(conexion, revision, madre.id, "done");
}

export type NuevaSubtarea = {
	madreId: number;
	titulo: string;
	usuarioId: number;
};

/**
 * «Añadir subtarea» desde la ficha: el humano cuelga una parte con solo el
 * título. Nace en `backlog` con la descripción vacía y hereda de la madre la
 * rama y las asignaciones, como la que crea el análisis. Vale con la madre por
 * definir, preparada o en curso; en curso, solo si ningún terminal tiene una
 * fase en marcha, porque una parte nueva dejaría sin ejecutor a la tarea que un
 * subagente está ejecutando.
 */
export function crearSubtarea(db: DatabaseSync, datos: NuevaSubtarea): Tarea {
	const titulo = exigirTitulo(datos.titulo);
	const madre = exigirTarea(db, datos.madreId);
	if (madre.estado === "done" || madre.estado === "finished") {
		throw new ErrorDeRegla(
			"padre_invalido",
			`La tarea ${madre.codigo} ya está hecha: las subtareas se añaden mientras se define, se prepara o se trabaja.`,
		);
	}
	if (madre.estado === "doing" && madre.enMarchaTerminalId !== null) {
		throw new ErrorDeRegla(
			"en_ejecucion",
			"Un agente está trabajando esta tarea ahora mismo: espera a que termine su fase para añadirle subtareas.",
		);
	}
	// La pregunta y la cerrada las rechaza `exigirPadre`, el mismo sitio que en
	// el alta y la edición.
	return crearTareaHumana(db, { titulo, descripcion: "", usuarioId: datos.usuarioId, padreId: madre.id });
}
