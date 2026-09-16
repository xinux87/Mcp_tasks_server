import type { DatabaseSync } from "node:sqlite";
import { ErrorDeRegla } from "../errores.ts";
import { formatearId } from "../md/ids.ts";
import { entero, escribirContenido, sentencia, texto } from "./base.ts";
import { escribirDependencias } from "./dependencias.ts";
import { insertarComentario } from "./hilo.ts";
import { cambiarEstado, comoTarea, exigirTarea, insertarTarea, type Tarea } from "./tareas.ts";

/**
 * Funcionalidades: lo que pide el humano en lenguaje de negocio. Su
 * «ejecución» son sus partes, que crea el análisis al descomponerla y que el
 * humano aprueba antes de que ningún agente las trabaje.
 *
 * Aquí vive todo lo que solo pasa en una funcionalidad: crear una parte,
 * aprobar la descomposición y cerrarla sola cuando la última parte se cierra.
 */

/** Autor del comentario que escribe el propio servidor, no un agente ni una persona. */
const AUTOR_SERVIDOR = "servidor";

export type PartesDeFuncionalidad = {
	total: number;
	/** Partes ya aceptadas por el humano: son las que cuentan para cerrarla. */
	cerradas: number;
};

/** Cuántas partes tiene la funcionalidad y cuántas están cerradas. */
export function partesDe(db: DatabaseSync, funcionalidadId: number): PartesDeFuncionalidad {
	const fila = sentencia(
		db,
		`SELECT COUNT(*) AS total, COUNT(CASE WHEN estado = 'finished' THEN 1 END) AS cerradas
			FROM tareas WHERE padre_id = ?`,
	).get(funcionalidadId);
	if (fila === undefined) {
		throw new Error("el recuento de partes no devolvió ninguna fila");
	}
	return { total: entero(fila, "total"), cerradas: entero(fila, "cerradas") };
}

/** Las hijas directas de una tarea, en orden de id. */
function hijasDirectas(conexion: DatabaseSync, padreId: number): Tarea[] {
	return sentencia(conexion, "SELECT * FROM tareas WHERE padre_id = ? ORDER BY id").all(padreId).map(comoTarea);
}

export type NuevaParte = {
	titulo: string;
	descripcion: string;
	padreId: number;
	terminalId: number;
	/** Otras partes de la misma funcionalidad que tienen que ir antes. */
	dependeDe?: number[];
};

/**
 * Parte de una funcionalidad: la crea su análisis al descomponerla. Nace en
 * `backlog` colgando de la funcionalidad y hereda su rama, sus modelos y sus
 * terminales; el humano la revisa antes de aprobar la descomposición.
 */
export function crearParte(db: DatabaseSync, datos: NuevaParte): Tarea {
	return escribirContenido(db, (conexion, revision) => {
		const padre = exigirTarea(conexion, datos.padreId);
		exigirDescomposicionEnMarcha(padre, datos.terminalId);
		const parte = insertarTarea(conexion, revision, {
			// Una parte vive en el proyecto de su funcionalidad: lo hereda, como la
			// rama y las asignaciones.
			proyectoId: padre.proyectoId,
			titulo: datos.titulo,
			descripcion: datos.descripcion,
			tipo: "tarea",
			rama: padre.rama,
			estado: "backlog",
			padreId: padre.id,
			autoejecucion: padre.autoejecucion,
			analisisHecho: false,
			analisisModelo: padre.analisisModelo,
			analisisTerminalId: padre.analisisTerminalId,
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

/** Una parte solo se crea desde el análisis de su funcionalidad, y por su terminal. */
function exigirDescomposicionEnMarcha(padre: Tarea, terminalId: number): void {
	if (padre.tipo !== "funcionalidad") {
		throw new ErrorDeRegla(
			"solo_desde_descomposicion",
			`La tarea ${formatearId(padre.codigo)} no es una funcionalidad: las partes solo cuelgan de una funcionalidad.`,
		);
	}
	if (padre.estado !== "prepared") {
		throw new ErrorDeRegla(
			"solo_desde_descomposicion",
			`La funcionalidad está en ${padre.estado}: sus partes se crean mientras se descompone, en prepared.`,
		);
	}
	if (padre.analisisTerminalId !== terminalId) {
		throw new ErrorDeRegla(
			"solo_desde_descomposicion",
			"Este terminal no es el responsable del análisis de esa funcionalidad.",
		);
	}
}

/** Una parte solo puede depender de otras partes de su misma funcionalidad. */
function exigirPartesDelMismoPadre(conexion: DatabaseSync, padreId: number, dependeDe: readonly number[]): void {
	for (const otra of dependeDe) {
		const candidata = exigirTarea(conexion, otra);
		if (candidata.padreId !== padreId) {
			throw new ErrorDeRegla(
				"dependencia_fuera_de_la_funcionalidad",
				`La tarea ${formatearId(candidata.codigo)} no es una parte de esta funcionalidad: una parte solo depende de sus hermanas.`,
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
 * Aprobar la descomposición: la funcionalidad pasa a `doing` y sus partes en
 * `backlog` pasan a `prepared` conservando el orden en el que están. Si la
 * funcionalidad tiene rama, se crea además la parte que integra esa rama en la
 * principal, que depende de todas las demás.
 *
 * Corre dentro de la escritura que abre `aprobarEjecucion`.
 */
export function aprobarDescomposicion(conexion: DatabaseSync, revision: number, funcionalidad: Tarea): void {
	if (funcionalidad.estado !== "prepared") {
		throw new ErrorDeRegla(
			"estado_no_permite_aprobar",
			`La funcionalidad está en ${funcionalidad.estado}: la descomposición se aprueba en prepared.`,
		);
	}
	if (!funcionalidad.analisisHecho) {
		throw new ErrorDeRegla("analisis_no_hecho", "Todavía no hay descomposición que aprobar.");
	}
	const abiertas = sentencia(
		conexion,
		"SELECT COUNT(*) AS total FROM preguntas WHERE tarea_id = ? AND respuesta_opcion IS NULL",
	).get(funcionalidad.id);
	if (abiertas !== undefined && entero(abiertas, "total") > 0) {
		throw new ErrorDeRegla(
			"tarea_bloqueada",
			"La funcionalidad tiene preguntas sin contestar: contéstalas antes de aprobar la descomposición.",
		);
	}

	cambiarEstado(conexion, revision, funcionalidad.id, "doing", ", ejecucion_aprobada = 1, en_marcha_terminal_id = NULL");

	// Las partes salen a `prepared` en el orden que traían, detrás de lo que ya
	// hubiera en esa columna: cada una entra al final, que es lo que hace
	// `cambiarEstado`, y así conservan su orden relativo.
	const enBacklog = hijasDirectas(conexion, funcionalidad.id).filter((parte) => parte.estado === "backlog");
	const ordenados = [...enBacklog].sort((uno, otro) => uno.orden - otro.orden || uno.id - otro.id);
	for (const parte of ordenados) {
		cambiarEstado(conexion, revision, parte.id, "prepared");
	}

	if (funcionalidad.rama !== null) {
		crearParteDeIntegracion(conexion, revision, funcionalidad);
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
function crearParteDeIntegracion(conexion: DatabaseSync, revision: number, funcionalidad: Tarea): Tarea {
	const rama = funcionalidad.rama ?? "";
	const parte = insertarTarea(conexion, revision, {
		proyectoId: funcionalidad.proyectoId,
		titulo: `Integrar la rama \`${rama}\` en la principal`,
		descripcion: descripcionDeIntegracion(rama),
		tipo: "tarea",
		rama: funcionalidad.rama,
		estado: "prepared",
		padreId: funcionalidad.id,
		autoejecucion: funcionalidad.autoejecucion,
		analisisHecho: false,
		analisisModelo: funcionalidad.analisisModelo,
		analisisTerminalId: funcionalidad.analisisTerminalId,
		ejecucionModelo: funcionalidad.ejecucionModelo,
		ejecucionTerminalId: funcionalidad.ejecucionTerminalId,
		enMarchaTerminalId: null,
		creadaPorUsuarioId: null,
		creadaPorTerminalId: null,
	});
	const hermanas = hijasDirectas(conexion, funcionalidad.id)
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
 * Cierra la funcionalidad cuando su última parte se acepta: pasa a `done` y
 * deja un comentario `resultado` firmado por el servidor con cada parte y su
 * commit. Las hijas de trabajo de una parte cuelgan de la parte, no de la
 * funcionalidad, así que no cuentan.
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
	const funcionalidad = exigirTarea(conexion, padreId);
	if (funcionalidad.tipo !== "funcionalidad" || funcionalidad.estado !== "doing") {
		return;
	}
	const partes = hijasDirectas(conexion, funcionalidad.id);
	if (partes.length === 0 || partes.some((hermana) => hermana.estado !== "finished")) {
		return;
	}
	insertarComentario(conexion, revision, {
		tareaId: funcionalidad.id,
		tipo: "resultado",
		autor: AUTOR_SERVIDOR,
		texto: partes
			.map((hermana) => `- ${formatearId(hermana.codigo)} · ${hermana.titulo} · ${commitDe(conexion, hermana.id)}`)
			.join("\n"),
		preguntaId: null,
	});
	cambiarEstado(conexion, revision, funcionalidad.id, "done");
}
