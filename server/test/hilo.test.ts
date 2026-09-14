import assert from "node:assert/strict";
import { test } from "node:test";
import { revisionActual } from "../src/db/consultas.ts";
import {
	comentarAnalisis,
	comentarAvance,
	comentarResultado,
	notaHumana,
	preguntar,
	preguntasAbiertas,
	responder,
} from "../src/db/hilo.ts";
import {
	crearTareaHumana,
	exigirTarea,
	leerTarea,
	moverTareaHumano,
	preguntasContestadasDesde,
	type Tarea,
	tareasParaTerminalDesde,
	tomarTarea,
} from "../src/db/tareas.ts";
import { codigoDe, montar } from "./comun.ts";

const OPCIONES = [
	{ texto: "Coma", consecuencia: "es el estándar, pero hay que importar a mano." },
	{ texto: "Punto y coma", consecuencia: "se abre directo en su hoja de cálculo." },
	{ texto: "No hacer nada", consecuencia: "siguen copiando a mano." },
];

type Banco = ReturnType<typeof montar>;

/** Tarea en `prepared` con el análisis tomado por el portátil. */
function enAnalisis(banco: Banco, modelos: { analisis?: string; ejecucion?: string } = {}): Tarea {
	const tarea = crearTareaHumana(banco.db, {
		titulo: "Exportar el listado",
		descripcion: "Hoy lo copian a mano.",
		usuarioId: banco.ana,
		analisisModelo: modelos.analisis ?? "sonnet",
		ejecucionModelo: modelos.ejecucion ?? "opus",
	});
	moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "prepared" });
	return tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil });
}

/** La misma tarea, ya en `doing` con la ejecución tomada por el portátil. */
function enEjecucion(banco: Banco, modelos: { analisis?: string; ejecucion?: string } = {}): Tarea {
	const tarea = enAnalisis(banco, modelos);
	comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "plan" });
	return tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil });
}

test("el comentario de análisis lo firma el modelo de la fase, da el análisis por hecho y suelta la marca", () => {
	const banco = montar();
	try {
		const tarea = enAnalisis(banco);
		assert.equal(
			codigoDe(() => comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.sobremesa, texto: "x" })),
			"fase_no_tomada",
		);

		const comentario = comentarAnalisis(banco.db, {
			tareaId: tarea.id,
			terminalId: banco.portatil,
			texto: "qué hay que hacer, plan y riesgos",
		});
		assert.equal(comentario.tipo, "analisis");
		assert.equal(comentario.autor, "sonnet@portatil-ana");

		const despues = exigirTarea(banco.db, tarea.id);
		assert.equal(despues.analisisHecho, true);
		assert.equal(despues.enMarchaTerminalId, null);
		assert.equal(despues.revision, revisionActual(banco.db));

		// Ya en doing, el análisis no se vuelve a escribir.
		tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil });
		assert.equal(
			codigoDe(() => comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "otra vez" })),
			"estado_no_permite_analisis",
		);
	} finally {
		banco.cerrar();
	}
});

test("sin modelo asignado a la fase el autor del agente es agente@terminal", () => {
	const banco = montar();
	try {
		const tarea = crearTareaHumana(banco.db, { titulo: "Una", descripcion: "d", usuarioId: banco.ana });
		moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "prepared" });
		tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil });
		const comentario = comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "plan" });
		assert.equal(comentario.autor, "agente@portatil-ana");
	} finally {
		banco.cerrar();
	}
});

test("avance no mueve la tarea y resultado la pasa a done soltando la marca", () => {
	const banco = montar();
	try {
		const tarea = enEjecucion(banco);
		assert.equal(
			codigoDe(() => comentarAvance(banco.db, { tareaId: tarea.id, terminalId: banco.sobremesa, texto: "x" })),
			"fase_no_tomada",
		);

		const avance = comentarAvance(banco.db, {
			tareaId: tarea.id,
			terminalId: banco.portatil,
			texto: "Botón añadido. Faltan los tests.",
		});
		assert.equal(avance.autor, "opus@portatil-ana");
		assert.equal(exigirTarea(banco.db, tarea.id).estado, "doing");

		comentarResultado(banco.db, {
			tareaId: tarea.id,
			terminalId: banco.portatil,
			texto: "Qué se construyó: el botón.\n\nCommit: a1b2c3d",
		});
		const cerrada = exigirTarea(banco.db, tarea.id);
		assert.equal(cerrada.estado, "done");
		assert.equal(cerrada.enMarchaTerminalId, null);

		// En done ya no escribe la ejecución.
		assert.equal(
			codigoDe(() => comentarAvance(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "x" })),
			"estado_no_permite_avance",
		);
	} finally {
		banco.cerrar();
	}
});

test("las preguntas se numeran P1, P2 dentro de la tarea y validan sus opciones", () => {
	const banco = montar();
	try {
		const tarea = enEjecucion(banco);
		const comun = { tareaId: tarea.id, terminalId: banco.portatil, porQueImporta: "importa." };

		assert.equal(
			codigoDe(() =>
				preguntar(banco.db, {
					...comun,
					pregunta: "¿Una sola?",
					opciones: [{ texto: "Sí", consecuencia: "c" }],
					recomendacion: "Sí",
				}),
			),
			"pocas_opciones",
		);
		assert.equal(
			codigoDe(() =>
				preguntar(banco.db, {
					...comun,
					pregunta: "¿Repetidas?",
					opciones: [
						{ texto: "Sí", consecuencia: "c" },
						{ texto: "Sí", consecuencia: "d" },
					],
					recomendacion: "Sí",
				}),
			),
			"opciones_repetidas",
		);
		assert.equal(
			codigoDe(() =>
				preguntar(banco.db, { ...comun, pregunta: "¿Fuera?", opciones: OPCIONES, recomendacion: "Tabulador" }),
			),
			"recomendacion_invalida",
		);
		const p1 = preguntar(banco.db, {
			...comun,
			pregunta: "¿Qué separador usamos en el CSV?",
			opciones: OPCIONES,
			recomendacion: "Punto y coma",
		});
		assert.equal(p1.numero, 1);
		const p2 = preguntar(banco.db, {
			...comun,
			pregunta: "¿Y la codificación?",
			opciones: OPCIONES,
			recomendacion: "Coma",
		});
		assert.equal(p2.numero, 2);
		assert.equal(preguntasAbiertas(banco.db, tarea.id), 2);
		assert.deepEqual(p1.opciones, OPCIONES);

		const completa = leerTarea(banco.db, tarea.id);
		assert.equal(completa?.comentarios.at(-1)?.preguntaId, p2.id);
		assert.match(completa?.comentarios.at(-1)?.texto ?? "", /^\*\*¿Y la codificación\?\*\*/);
	} finally {
		banco.cerrar();
	}
});

test("solo pregunta el terminal responsable de la fase que toca", () => {
	const banco = montar();
	try {
		const tarea = enEjecucion(banco);
		assert.equal(
			codigoDe(() =>
				preguntar(banco.db, {
					tareaId: tarea.id,
					terminalId: banco.sobremesa,
					pregunta: "¿Puedo?",
					porQueImporta: "no.",
					opciones: OPCIONES,
					recomendacion: "Coma",
				}),
			),
			"no_puede_preguntar",
		);
	} finally {
		banco.cerrar();
	}
});

test("la respuesta guarda el texto de la opción, y no admite otra ni una segunda vuelta", () => {
	const banco = montar();
	try {
		const tarea = enEjecucion(banco);
		const p1 = preguntar(banco.db, {
			tareaId: tarea.id,
			terminalId: banco.portatil,
			pregunta: "¿Qué separador usamos en el CSV?",
			porQueImporta: "la hoja de cálculo abre mal la coma.",
			opciones: OPCIONES,
			recomendacion: "Punto y coma",
		});

		assert.equal(
			codigoDe(() => responder(banco.db, { preguntaId: p1.id, usuarioId: banco.ana, opcion: "Tabulador" })),
			"opcion_inexistente",
		);
		// Ni por posición: se guarda el texto exacto.
		assert.equal(
			codigoDe(() => responder(banco.db, { preguntaId: p1.id, usuarioId: banco.ana, opcion: "1" })),
			"opcion_inexistente",
		);
		assert.equal(
			codigoDe(() => responder(banco.db, { preguntaId: 404, usuarioId: banco.ana, opcion: "Coma" })),
			"pregunta_inexistente",
		);

		const contestada = responder(banco.db, {
			preguntaId: p1.id,
			usuarioId: banco.ana,
			opcion: "Punto y coma",
			nota: "si lo usa otro equipo, ya lo cambiaremos.",
		});
		assert.equal(contestada.respuestaOpcion, "Punto y coma");
		assert.equal(contestada.respuestaNota, "si lo usa otro equipo, ya lo cambiaremos.");
		assert.equal(contestada.respondidaPorUsuarioId, banco.ana);
		assert.equal(contestada.revision, revisionActual(banco.db));
		assert.equal(preguntasAbiertas(banco.db, tarea.id), 0);

		assert.equal(
			codigoDe(() => responder(banco.db, { preguntaId: p1.id, usuarioId: banco.ana, opcion: "Coma" })),
			"pregunta_ya_respondida",
		);

		const completa = leerTarea(banco.db, tarea.id);
		const respuesta = completa?.comentarios.at(-1);
		assert.equal(respuesta?.tipo, "respuesta");
		assert.equal(respuesta?.autor, "humano:ana");
		assert.equal(respuesta?.texto, "Opción: **Punto y coma**\n\nNota: si lo usa otro equipo, ya lo cambiaremos.");
	} finally {
		banco.cerrar();
	}
});

test("el humano deja notas en cualquier estado menos finished", () => {
	const banco = montar();
	try {
		const tarea = crearTareaHumana(banco.db, { titulo: "Una", descripcion: "d", usuarioId: banco.ana });
		const nota = notaHumana(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, texto: "y además esto" });
		assert.equal(nota.autor, "humano:ana");
		assert.equal(exigirTarea(banco.db, tarea.id).revision, revisionActual(banco.db));

		banco.db.prepare("UPDATE tareas SET estado = 'finished' WHERE id = ?").run(tarea.id);
		assert.equal(
			codigoDe(() => notaHumana(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, texto: "tarde" })),
			"tarea_archivada",
		);
	} finally {
		banco.cerrar();
	}
});

test("las novedades filtran por terminal y por revisión, y nunca traen backlog", () => {
	const banco = montar();
	try {
		// Una en backlog: no sale nunca, ni recién creada.
		crearTareaHumana(banco.db, { titulo: "En backlog", descripcion: "d", usuarioId: banco.ana });
		// Una en prepared del otro terminal: tampoco.
		const ajena = crearTareaHumana(banco.db, {
			titulo: "Del sobremesa",
			descripcion: "d",
			usuarioId: banco.ana,
			analisisTerminalId: banco.sobremesa,
		});
		moverTareaHumano(banco.db, { tareaId: ajena.id, usuarioId: banco.ana, estado: "prepared" });
		// Una en prepared sin terminal: la puede tomar cualquiera.
		const libre = crearTareaHumana(banco.db, { titulo: "Sin terminal", descripcion: "d", usuarioId: banco.ana });
		moverTareaHumano(banco.db, { tareaId: libre.id, usuarioId: banco.ana, estado: "prepared" });

		const mia = enEjecucion(banco);
		assert.deepEqual(
			tareasParaTerminalDesde(banco.db, { terminalId: banco.portatil, revision: 0 }).map((item) => item.id),
			[mia.id, libre.id],
		);
		// `doing` va antes que `prepared`: terminar lo empezado es prioritario.
		assert.deepEqual(
			tareasParaTerminalDesde(banco.db, { terminalId: banco.portatil, revision: 0 }).map((item) => item.estado),
			["doing", "prepared"],
		);
		assert.deepEqual(
			tareasParaTerminalDesde(banco.db, { terminalId: banco.sobremesa, revision: 0 }).map((item) => item.id),
			[ajena.id, libre.id],
		);
		// Desde la revisión actual ya no hay nada nuevo.
		assert.deepEqual(
			tareasParaTerminalDesde(banco.db, { terminalId: banco.portatil, revision: revisionActual(banco.db) }),
			[],
		);

		const p1 = preguntar(banco.db, {
			tareaId: mia.id,
			terminalId: banco.portatil,
			pregunta: "¿Qué separador usamos en el CSV?",
			porQueImporta: "importa.",
			opciones: OPCIONES,
			recomendacion: "Punto y coma",
		});
		// Sin contestar todavía no es novedad.
		assert.deepEqual(preguntasContestadasDesde(banco.db, { terminalId: banco.portatil, revision: 0 }), []);

		const corte = revisionActual(banco.db);
		responder(banco.db, { preguntaId: p1.id, usuarioId: banco.ana, opcion: "Coma" });
		assert.deepEqual(preguntasContestadasDesde(banco.db, { terminalId: banco.portatil, revision: corte }), [
			{ tareaId: mia.id, numero: 1, opcion: "Coma" },
		]);
		assert.deepEqual(preguntasContestadasDesde(banco.db, { terminalId: banco.sobremesa, revision: corte }), []);
		assert.deepEqual(
			preguntasContestadasDesde(banco.db, { terminalId: banco.portatil, revision: revisionActual(banco.db) }),
			[],
		);
	} finally {
		banco.cerrar();
	}
});
