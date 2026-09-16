import assert from "node:assert/strict";
import { test } from "node:test";
import { actividadDe } from "../src/db/actividad.ts";
import { dependenciasDe, dependenciasPendientes, fijarDependencias } from "../src/db/dependencias.ts";
import { comentarAnalisis, comentarResultado } from "../src/db/hilo.ts";
import {
	crearTareaHumana,
	exigirTarea,
	itemIndiceDe,
	listarTareas,
	marcasDe,
	moverTareaHumano,
	type Tarea,
	tareasParaTerminalDesde,
	tomarTarea,
} from "../src/db/tareas.ts";
import { lineaIndice } from "../src/md/indice.ts";
import { codigoDe, montar } from "./comun.ts";

type Banco = ReturnType<typeof montar>;

/** Una tarea suelta en backlog, con las dos fases del terminal del banco. */
function tarea(banco: Banco, titulo: string, dependeDe: number[] = []): Tarea {
	return crearTareaHumana(banco.db, {
		titulo,
		descripcion: "d",
		usuarioId: banco.ana,
		dependeDe,
		analisisModelo: "sonnet",
		analisisTerminalId: banco.portatil,
		ejecucionModelo: "opus",
		ejecucionTerminalId: banco.portatil,
	});
}

/** Trabaja la tarea entera hasta dejarla en `done`, que es donde se satisface una dependencia. */
function hastaDone(banco: Banco, tareaId: number): void {
	tomarTarea(banco.db, { tareaId, fase: "analisis", terminalId: banco.portatil });
	comentarAnalisis(banco.db, { tareaId, terminalId: banco.portatil, texto: "plan" });
	tomarTarea(banco.db, { tareaId, fase: "ejecucion", terminalId: banco.portatil });
	comentarResultado(banco.db, { tareaId, terminalId: banco.portatil, texto: "hecho\n\nCommit: a1b2c3d" });
}

test("una tarea no depende de sí misma, ni de una que no existe, ni cierra un ciclo", () => {
	const banco = montar();
	try {
		const primera = tarea(banco, "Primera");
		const segunda = tarea(banco, "Segunda", [primera.id]);
		assert.deepEqual(dependenciasDe(banco.db, segunda.id), [primera.id]);

		assert.equal(
			codigoDe(() =>
				fijarDependencias(banco.db, {
					tareaId: segunda.id,
					dependeDe: [segunda.id],
					actor: { usuarioId: banco.ana },
				}),
			),
			"dependencia_propia",
		);
		assert.equal(
			codigoDe(() =>
				fijarDependencias(banco.db, { tareaId: segunda.id, dependeDe: [404], actor: { usuarioId: banco.ana } }),
			),
			"tarea_inexistente",
		);
		// La segunda ya depende de la primera: que la primera dependa de la
		// segunda las dejaría esperándose entre ellas para siempre.
		assert.equal(
			codigoDe(() =>
				fijarDependencias(banco.db, {
					tareaId: primera.id,
					dependeDe: [segunda.id],
					actor: { usuarioId: banco.ana },
				}),
			),
			"dependencia_ciclica",
		);
		// El ciclo indirecto tampoco cuela, y lo rechazado no deja rastro.
		const tercera = tarea(banco, "Tercera", [segunda.id]);
		assert.equal(
			codigoDe(() =>
				fijarDependencias(banco.db, {
					tareaId: primera.id,
					dependeDe: [tercera.id],
					actor: { usuarioId: banco.ana },
				}),
			),
			"dependencia_ciclica",
		);
		assert.deepEqual(dependenciasDe(banco.db, primera.id), []);
	} finally {
		banco.cerrar();
	}
});

test("las dependencias se fijan en backlog, dejan rastro y ahí se congelan", () => {
	const banco = montar();
	try {
		const primera = tarea(banco, "Primera");
		const otra = tarea(banco, "Otra");
		const segunda = tarea(banco, "Segunda");

		fijarDependencias(banco.db, {
			tareaId: segunda.id,
			dependeDe: [otra.id, primera.id, primera.id],
			actor: { usuarioId: banco.ana },
		});
		// Sin repetidas y en orden, aunque llegaran de cualquier manera.
		assert.deepEqual(dependenciasDe(banco.db, segunda.id), [primera.id, otra.id]);
		const rastro = actividadDe(banco.db, "tarea", segunda.id);
		assert.equal(rastro.at(-1)?.accion, "editar_tarea");
		assert.equal(rastro.at(-1)?.detalle, "dependencias: T-0001, T-0002");

		moverTareaHumano(banco.db, { tareaId: segunda.id, usuarioId: banco.ana, estado: "prepared" });
		assert.equal(
			codigoDe(() => fijarDependencias(banco.db, { tareaId: segunda.id, dependeDe: [], actor: { usuarioId: banco.ana } })),
			"solo_en_backlog",
		);
	} finally {
		banco.cerrar();
	}
});

test("con una dependencia sin cerrar la tarea espera: ni se toma ni sale en novedades", () => {
	const banco = montar();
	try {
		const primera = tarea(banco, "Primera");
		const segunda = tarea(banco, "Segunda", [primera.id]);
		moverTareaHumano(banco.db, { tareaId: primera.id, usuarioId: banco.ana, estado: "prepared" });
		moverTareaHumano(banco.db, { tareaId: segunda.id, usuarioId: banco.ana, estado: "prepared" });

		assert.deepEqual(marcasDe(exigirTarea(banco.db, segunda.id), 0, 1), ["esperando"]);
		assert.deepEqual(itemIndiceDe(banco.db, segunda.id).marcas, ["esperando"]);
		assert.match(lineaIndice(itemIndiceDe(banco.db, segunda.id)), / · prepared · esperando · Segunda · /);
		assert.deepEqual(dependenciasPendientes(banco.db, segunda.id), [primera.id]);

		// Analizar algo antes de que exista aquello de lo que depende es
		// analizar a ciegas: las dos fases se cortan igual.
		assert.equal(
			codigoDe(() => tomarTarea(banco.db, { tareaId: segunda.id, fase: "analisis", terminalId: banco.portatil })),
			"esperando_dependencias",
		);
		assert.equal(
			codigoDe(() => tomarTarea(banco.db, { tareaId: segunda.id, fase: "ejecucion", terminalId: banco.portatil })),
			"esperando_dependencias",
		);

		// El bucle no la ve, aunque el índice del tablero sí la enseñe.
		assert.deepEqual(
			tareasParaTerminalDesde(banco.db, { terminalId: banco.portatil, revision: 0 }).map((item) => item.id),
			[primera.id],
		);
		assert.deepEqual(
			listarTareas(banco.db, {}).map((item) => item.id),
			[primera.id, segunda.id],
		);

		// Basta con que la primera llegue a `done`: no hace falta esperar a que
		// el humano la acepte.
		hastaDone(banco, primera.id);
		assert.equal(exigirTarea(banco.db, primera.id).estado, "done");
		assert.deepEqual(dependenciasPendientes(banco.db, segunda.id), []);
		assert.deepEqual(itemIndiceDe(banco.db, segunda.id).marcas, []);
		assert.deepEqual(
			tareasParaTerminalDesde(banco.db, { terminalId: banco.portatil, revision: 0 }).map((item) => item.id),
			[segunda.id],
		);
		assert.equal(
			tomarTarea(banco.db, { tareaId: segunda.id, fase: "analisis", terminalId: banco.portatil }).enMarchaTerminalId,
			banco.portatil,
		);
	} finally {
		banco.cerrar();
	}
});
