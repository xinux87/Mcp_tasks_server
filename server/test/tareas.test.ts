import assert from "node:assert/strict";
import { test } from "node:test";
import { revisionActual } from "../src/db/consultas.ts";
import { comentarAnalisis, comentarResultado, preguntar } from "../src/db/hilo.ts";
import {
	aprobarEjecucion,
	borrarTareaBacklog,
	crearHija,
	crearPropuesta,
	crearTareaHumana,
	exigirTarea,
	faseQueToca,
	leerTarea,
	listarTareas,
	marcasDe,
	moverTareaHumano,
	reordenar,
	type Tarea,
	tareasParaTerminalDesde,
	tomarTarea,
} from "../src/db/tareas.ts";
import { codigoDe, montar } from "./comun.ts";

const OPCIONES = [
	{ texto: "Sí", consecuencia: "se hace." },
	{ texto: "No hacer nada", consecuencia: "se queda como está." },
];

/** Atajo para las pruebas: crea la tarea y la deja lista para analizar. */
function tareaPreparada(banco: ReturnType<typeof montar>, extra: Partial<{ autoejecucion: boolean }> = {}): Tarea {
	const tarea = crearTareaHumana(banco.db, {
		titulo: "Exportar el listado",
		descripcion: "Hoy lo copian a mano.",
		usuarioId: banco.xinux,
		autoejecucion: extra.autoejecucion,
		analisisModelo: "sonnet",
		ejecucionModelo: "opus",
	});
	return moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.xinux, estado: "prepared" });
}

/** Igual, pero con las dos fases sin modelo: es la tarea que el humano deja a medio asignar. */
function tareaSinModelos(banco: ReturnType<typeof montar>): Tarea {
	const tarea = crearTareaHumana(banco.db, {
		titulo: "Exportar el listado",
		descripcion: "Hoy lo copian a mano.",
		usuarioId: banco.xinux,
	});
	return moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.xinux, estado: "prepared" });
}

test("una tarea humana nace en backlog, al final de la columna y con la revisión de su escritura", () => {
	const banco = montar();
	try {
		const primera = crearTareaHumana(banco.db, { titulo: "Una", descripcion: "d", usuarioId: banco.xinux });
		assert.equal(primera.estado, "backlog");
		assert.equal(primera.orden, 1);
		assert.equal(primera.autoejecucion, true);
		assert.equal(primera.creadaPorUsuarioId, banco.xinux);
		assert.equal(primera.creadaPorTerminalId, null);
		assert.equal(primera.revision, revisionActual(banco.db));

		const segunda = crearTareaHumana(banco.db, { titulo: "Otra", descripcion: "d", usuarioId: banco.xinux });
		assert.equal(segunda.orden, 2);
		assert.equal(segunda.revision, primera.revision + 1);
	} finally {
		banco.cerrar();
	}
});

test("una propuesta del agente también nace en backlog, pero creada por un terminal", () => {
	const banco = montar();
	try {
		const propuesta = crearPropuesta(banco.db, {
			titulo: "Migrar el envío de correos",
			descripcion: "Se descubrió ejecutando otra cosa.",
			terminalId: banco.portatil,
		});
		assert.equal(propuesta.estado, "backlog");
		assert.equal(propuesta.creadaPorTerminalId, banco.portatil);
		assert.equal(propuesta.creadaPorUsuarioId, null);
	} finally {
		banco.cerrar();
	}
});

test("el humano hace las cuatro transiciones permitidas y ninguna más", () => {
	const banco = montar();
	try {
		const tarea = crearTareaHumana(banco.db, { titulo: "Una", descripcion: "d", usuarioId: banco.xinux });

		const preparada = moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.xinux, estado: "prepared" });
		assert.equal(preparada.estado, "prepared");
		assert.equal(preparada.orden, 1);

		const devuelta = moverTareaHumano(banco.db, {
			tareaId: tarea.id,
			usuarioId: banco.xinux,
			estado: "backlog",
			nota: "hay que repensarla",
		});
		assert.equal(devuelta.estado, "backlog");

		// El agente nunca mueve hacia atrás, y saltarse una columna tampoco vale.
		assert.equal(
			codigoDe(() => moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.xinux, estado: "doing" })),
			"transicion_no_permitida",
		);
		assert.equal(
			codigoDe(() => moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.xinux, estado: "finished" })),
			"transicion_no_permitida",
		);
	} finally {
		banco.cerrar();
	}
});

test("las vueltas atrás exigen nota y la dejan en el hilo firmada por el humano", () => {
	const banco = montar();
	try {
		const tarea = tareaPreparada(banco);
		assert.equal(
			codigoDe(() => moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.xinux, estado: "backlog" })),
			"nota_obligatoria",
		);

		moverTareaHumano(banco.db, {
			tareaId: tarea.id,
			usuarioId: banco.xinux,
			estado: "backlog",
			nota: "falta decidir el alcance",
		});
		const completa = leerTarea(banco.db, tarea.id);
		assert.ok(completa);
		assert.equal(completa.comentarios.length, 1);
		assert.equal(completa.comentarios[0]?.tipo, "nota");
		assert.equal(completa.comentarios[0]?.autor, "humano:xinux");
		assert.equal(completa.comentarios[0]?.texto, "falta decidir el alcance");
	} finally {
		banco.cerrar();
	}
});

test("volver a backlog caduca el análisis y la aprobación, pero deja el comentario en el hilo", () => {
	const banco = montar();
	try {
		const tarea = tareaPreparada(banco, { autoejecucion: false });
		tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "plan" });
		aprobarEjecucion(banco.db, { tareaId: tarea.id, usuarioId: banco.xinux });
		assert.equal(faseQueToca(exigirTarea(banco.db, tarea.id)), "ejecucion");

		moverTareaHumano(banco.db, {
			tareaId: tarea.id,
			usuarioId: banco.xinux,
			estado: "backlog",
			nota: "la descripción cambia",
		});
		const enBacklog = exigirTarea(banco.db, tarea.id);
		assert.equal(enBacklog.analisisHecho, false);
		assert.equal(enBacklog.ejecucionAprobada, false);

		// Al salir de nuevo, la tarea vuelve a necesitar análisis: la descripción
		// puede haber cambiado y el plan anterior ya no vale.
		const otraVez = moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.xinux, estado: "prepared" });
		assert.equal(faseQueToca(otraVez), "analisis");

		// El comentario de análisis se queda: el hilo no se edita nunca.
		const completa = leerTarea(banco.db, tarea.id);
		assert.ok(completa);
		assert.deepEqual(
			completa.comentarios.map((comentario) => comentario.tipo),
			["analisis", "nota"],
		);
	} finally {
		banco.cerrar();
	}
});

test("la marca «sin terminal» solo se calcula en prepared y en doing", () => {
	const banco = montar();
	try {
		const tarea = crearTareaHumana(banco.db, { titulo: "Sin asignar", descripcion: "d", usuarioId: banco.xinux });
		// En backlog el agente no la ve, así que no dice nada que no tenga terminal.
		assert.deepEqual(marcasDe(tarea, 0), []);

		const preparada = moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.xinux, estado: "prepared" });
		assert.deepEqual(marcasDe(preparada, 0), ["sin terminal"]);

		tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "plan" });
		// Ya toca la ejecución, que sigue sin terminal.
		assert.deepEqual(marcasDe(exigirTarea(banco.db, tarea.id), 0), ["sin terminal"]);

		tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil });
		comentarResultado(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "hecho" });
		const terminada = moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.xinux, estado: "finished" });
		assert.deepEqual(marcasDe(terminada, 0), []);
	} finally {
		banco.cerrar();
	}
});

test("de done se sale a finished, o de vuelta a doing con nota y sin terminal en marcha", () => {
	const banco = montar();
	try {
		const tarea = tareaPreparada(banco);
		tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "plan" });
		tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil });
		banco.db.prepare("UPDATE tareas SET estado = 'done' WHERE id = ?").run(tarea.id);

		const rechazada = moverTareaHumano(banco.db, {
			tareaId: tarea.id,
			usuarioId: banco.xinux,
			estado: "doing",
			nota: "faltan los tests",
		});
		assert.equal(rechazada.estado, "doing");
		assert.equal(rechazada.enMarchaTerminalId, null);
		// El terminal de ejecución se conserva: solo se suelta la marca.
		assert.equal(rechazada.ejecucionTerminalId, banco.portatil);

		banco.db.prepare("UPDATE tareas SET estado = 'done' WHERE id = ?").run(tarea.id);
		const aceptada = moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.xinux, estado: "finished" });
		assert.equal(aceptada.estado, "finished");
	} finally {
		banco.cerrar();
	}
});

test("tomar el análisis fija el terminal y otro terminal choca con fase_tomada", () => {
	const banco = montar();
	try {
		const tarea = tareaPreparada(banco);
		const tomada = tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil });
		assert.equal(tomada.analisisTerminalId, banco.portatil);
		assert.equal(tomada.enMarchaTerminalId, banco.portatil);

		// El mismo terminal puede repetir; otro no roba la fase.
		tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil });
		assert.equal(
			codigoDe(() => tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.sobremesa })),
			"fase_tomada",
		);
		assert.equal(
			codigoDe(() => tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil })),
			"analisis_no_hecho",
		);
	} finally {
		banco.cerrar();
	}
});

test("tomar la ejecución pasa a doing, y con otro terminal en la fase choca con fase_tomada", () => {
	const banco = montar();
	try {
		const tarea = tareaPreparada(banco);
		tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "plan" });

		const enMarcha = tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil });
		assert.equal(enMarcha.estado, "doing");
		assert.equal(enMarcha.ejecucionTerminalId, banco.portatil);
		assert.equal(enMarcha.enMarchaTerminalId, banco.portatil);

		assert.equal(
			codigoDe(() => tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.sobremesa })),
			"fase_tomada",
		);
		// Retomar tras una pregunta: mismo terminal, ya en doing, solo vuelve a
		// ponerse «en marcha».
		banco.db.prepare("UPDATE tareas SET en_marcha_terminal_id = NULL WHERE id = ?").run(tarea.id);
		const retomada = tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil });
		assert.equal(retomada.estado, "doing");
		assert.equal(retomada.enMarchaTerminalId, banco.portatil);
	} finally {
		banco.cerrar();
	}
});

test("el modelo de la toma se fija en la fase que no tenía ninguno y firma los comentarios", () => {
	const banco = montar();
	try {
		const tarea = tareaSinModelos(banco);
		const enAnalisis = tomarTarea(banco.db, {
			tareaId: tarea.id,
			fase: "analisis",
			terminalId: banco.portatil,
			modelo: "sonnet",
		});
		assert.equal(enAnalisis.analisisModelo, "sonnet");
		assert.equal(
			comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "plan" }).autor,
			"sonnet@portatil-xinux",
		);

		// Sin modelo en la toma, la fase se queda como estaba: sin modelo.
		const sinModelo = tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil });
		assert.equal(sinModelo.estado, "doing");
		assert.equal(sinModelo.ejecucionModelo, null);

		// Al retomar en doing vale la misma regla: el modelo que trae la toma
		// queda fijado y es el que firma el resultado.
		const retomada = tomarTarea(banco.db, {
			tareaId: tarea.id,
			fase: "ejecucion",
			terminalId: banco.portatil,
			modelo: "opus",
		});
		assert.equal(retomada.ejecucionModelo, "opus");
		assert.equal(
			comentarResultado(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "hecho" }).autor,
			"opus@portatil-xinux",
		);
	} finally {
		banco.cerrar();
	}
});

test("con la fase ya asignada, el mismo modelo pasa y otro distinto choca con modelo_no_coincide", () => {
	const banco = montar();
	try {
		const tarea = tareaPreparada(banco);
		const enAnalisis = tomarTarea(banco.db, {
			tareaId: tarea.id,
			fase: "analisis",
			terminalId: banco.portatil,
			modelo: "sonnet",
		});
		assert.equal(enAnalisis.analisisModelo, "sonnet");
		assert.equal(
			codigoDe(() =>
				tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil, modelo: "haiku" }),
			),
			"modelo_no_coincide",
		);
		// El mensaje dice con qué modelo hay que trabajarla.
		assert.throws(
			() => tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil, modelo: "haiku" }),
			/modelo sonnet/,
		);
		assert.equal(exigirTarea(banco.db, tarea.id).analisisModelo, "sonnet");

		comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "plan" });
		assert.equal(
			codigoDe(() =>
				tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil, modelo: "haiku" }),
			),
			"modelo_no_coincide",
		);
		assert.equal(exigirTarea(banco.db, tarea.id).estado, "prepared");

		const enEjecucion = tomarTarea(banco.db, {
			tareaId: tarea.id,
			fase: "ejecucion",
			terminalId: banco.portatil,
			modelo: "opus",
		});
		assert.equal(enEjecucion.estado, "doing");
		assert.equal(enEjecucion.ejecucionModelo, "opus");

		// Y al retomar en doing sigue valiendo: el modelo no se cambia sobre la marcha.
		assert.equal(
			codigoDe(() =>
				tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil, modelo: "haiku" }),
			),
			"modelo_no_coincide",
		);
	} finally {
		banco.cerrar();
	}
});

test("sin autoejecución la ejecución espera a que el humano apruebe el análisis", () => {
	const banco = montar();
	try {
		const tarea = tareaPreparada(banco, { autoejecucion: false });
		tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "plan" });

		const antes = exigirTarea(banco.db, tarea.id);
		assert.deepEqual(marcasDe(antes, 0), ["sin terminal", "análisis listo"]);
		assert.equal(
			codigoDe(() => tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil })),
			"ejecucion_no_aprobada",
		);

		const aprobada = aprobarEjecucion(banco.db, { tareaId: tarea.id, usuarioId: banco.xinux });
		assert.equal(aprobada.ejecucionAprobada, true);
		assert.deepEqual(marcasDe(aprobada, 0), ["sin terminal"]);
		assert.equal(
			tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil }).estado,
			"doing",
		);
		// Ya en doing, aprobar deja de tener sentido.
		assert.equal(
			codigoDe(() => aprobarEjecucion(banco.db, { tareaId: tarea.id, usuarioId: banco.xinux })),
			"estado_no_permite_aprobar",
		);
	} finally {
		banco.cerrar();
	}
});

test("con una pregunta abierta la tarea queda bloqueada y no se puede ejecutar", () => {
	const banco = montar();
	try {
		const tarea = tareaPreparada(banco);
		tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil });
		preguntar(banco.db, {
			tareaId: tarea.id,
			terminalId: banco.portatil,
			pregunta: "¿Qué separador usamos?",
			porQueImporta: "la hoja de cálculo abre mal la coma.",
			opciones: OPCIONES,
			recomendacion: "Sí",
		});
		comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "plan" });

		assert.equal(
			codigoDe(() => tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil })),
			"tarea_bloqueada",
		);
		const completa = leerTarea(banco.db, tarea.id);
		assert.ok(completa);
		assert.deepEqual(completa.marcas, ["bloqueada", "sin terminal"]);
	} finally {
		banco.cerrar();
	}
});

test("una hija de trabajo nace en doing colgando del padre y con sus asignaciones", () => {
	const banco = montar();
	try {
		const padre = tareaPreparada(banco);
		tomarTarea(banco.db, { tareaId: padre.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: padre.id, terminalId: banco.portatil, texto: "plan" });

		// Mientras el padre no está en doing no se le cuelga nada.
		assert.equal(
			codigoDe(() =>
				crearHija(banco.db, { titulo: "H", descripcion: "d", padreId: padre.id, terminalId: banco.portatil }),
			),
			"padre_no_en_ejecucion",
		);
		tomarTarea(banco.db, { tareaId: padre.id, fase: "ejecucion", terminalId: banco.portatil });
		assert.equal(
			codigoDe(() =>
				crearHija(banco.db, { titulo: "H", descripcion: "d", padreId: padre.id, terminalId: banco.sobremesa }),
			),
			"no_es_el_terminal_de_ejecucion",
		);

		const hija = crearHija(banco.db, {
			titulo: "Generar el fichero CSV",
			descripcion: "El fichero en sí.",
			padreId: padre.id,
			terminalId: banco.portatil,
		});
		assert.equal(hija.estado, "doing");
		assert.equal(hija.padreId, padre.id);
		assert.equal(hija.analisisHecho, true);
		assert.equal(hija.analisisModelo, "sonnet");
		assert.equal(hija.ejecucionModelo, "opus");
		assert.equal(hija.ejecucionTerminalId, banco.portatil);
		assert.equal(hija.enMarchaTerminalId, banco.portatil);
		assert.equal(faseQueToca(hija), "ejecucion");

		const completa = leerTarea(banco.db, padre.id);
		assert.deepEqual(completa?.hijas, [
			{ id: hija.id, estado: "doing", titulo: "Generar el fichero CSV", dependeDe: [] },
		]);
	} finally {
		banco.cerrar();
	}
});

test("una pregunta solo tiene fase de análisis: nace con su tipo y sin marcas de ejecución", () => {
	const banco = montar();
	try {
		const pregunta = crearTareaHumana(banco.db, {
			titulo: "¿Cuánto se tarda hoy en cerrar el mes?",
			descripcion: "Quiero saberlo antes de pedir nada.",
			usuarioId: banco.xinux,
			tipo: "pregunta",
			autoejecucion: false,
			analisisModelo: "sonnet",
		});
		assert.equal(pregunta.tipo, "pregunta");
		assert.equal(pregunta.estado, "backlog");

		// Una tarea normal sigue naciendo como `tarea` sin decir nada.
		assert.equal(crearTareaHumana(banco.db, { titulo: "Otra", descripcion: "d", usuarioId: banco.xinux }).tipo, "tarea");

		const preparada = moverTareaHumano(banco.db, { tareaId: pregunta.id, usuarioId: banco.xinux, estado: "prepared" });
		// «sin terminal» mira solo el análisis: la ejecución no existe aquí.
		assert.deepEqual(marcasDe(preparada, 0), ["sin terminal"]);

		tomarTarea(banco.db, { tareaId: pregunta.id, fase: "analisis", terminalId: banco.portatil });
		const tomada = exigirTarea(banco.db, pregunta.id);
		assert.equal(faseQueToca(tomada), "analisis");
		assert.deepEqual(marcasDe(tomada, 0), ["en marcha"]);
	} finally {
		banco.cerrar();
	}
});

test("el análisis de una pregunta es la respuesta: la deja en done y nunca sale «análisis listo»", () => {
	const banco = montar();
	try {
		// Una tarea normal ya en done, para comprobar que la pregunta entra
		// detrás de ella en la columna.
		const hecha = crearTareaHumana(banco.db, { titulo: "Ya hecha", descripcion: "d", usuarioId: banco.xinux });
		banco.db.prepare("UPDATE tareas SET estado = 'done', orden = 1 WHERE id = ?").run(hecha.id);

		const pregunta = crearTareaHumana(banco.db, {
			titulo: "¿Cuánto se tarda hoy en cerrar el mes?",
			descripcion: "Quiero saberlo antes de pedir nada.",
			usuarioId: banco.xinux,
			tipo: "pregunta",
			// Sin autoejecución una tarea normal esperaría aprobación; una
			// pregunta no, porque no hay ejecución que aprobar.
			autoejecucion: false,
			analisisModelo: "sonnet",
			analisisTerminalId: banco.portatil,
		});
		moverTareaHumano(banco.db, { tareaId: pregunta.id, usuarioId: banco.xinux, estado: "prepared" });
		tomarTarea(banco.db, { tareaId: pregunta.id, fase: "analisis", terminalId: banco.portatil });

		comentarAnalisis(banco.db, {
			tareaId: pregunta.id,
			terminalId: banco.portatil,
			texto: "Entre tres y cuatro días, casi todos de conciliar bancos a mano.",
		});

		const cerrada = exigirTarea(banco.db, pregunta.id);
		assert.equal(cerrada.estado, "done");
		assert.equal(cerrada.orden, 2);
		assert.equal(cerrada.analisisHecho, true);
		assert.equal(cerrada.enMarchaTerminalId, null);
		assert.deepEqual(marcasDe(cerrada, 0), []);

		const completa = leerTarea(banco.db, pregunta.id);
		assert.equal(completa?.comentarios.length, 1);
		assert.equal(completa?.comentarios[0]?.tipo, "analisis");
		assert.equal(completa?.comentarios[0]?.autor, "sonnet@portatil-xinux");
	} finally {
		banco.cerrar();
	}
});

test("una pregunta llega al terminal mientras está en prepared y deja de llegar al contestarse", () => {
	const banco = montar();
	try {
		const pregunta = crearTareaHumana(banco.db, {
			titulo: "¿Cuánto se tarda hoy en cerrar el mes?",
			descripcion: "d",
			usuarioId: banco.xinux,
			tipo: "pregunta",
			analisisModelo: "sonnet",
			analisisTerminalId: banco.portatil,
		});
		// En backlog el agente no la ve.
		assert.deepEqual(tareasParaTerminalDesde(banco.db, { terminalId: banco.portatil, revision: 0 }), []);

		moverTareaHumano(banco.db, { tareaId: pregunta.id, usuarioId: banco.xinux, estado: "prepared" });
		assert.deepEqual(
			tareasParaTerminalDesde(banco.db, { terminalId: banco.portatil, revision: 0 }).map((item) => item.id),
			[pregunta.id],
		);

		tomarTarea(banco.db, { tareaId: pregunta.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: pregunta.id, terminalId: banco.portatil, texto: "Tres o cuatro días." });
		// Contestada está en `done`: el bucle no la vuelve a traer nunca.
		assert.deepEqual(tareasParaTerminalDesde(banco.db, { terminalId: banco.portatil, revision: 0 }), []);
	} finally {
		banco.cerrar();
	}
});

test("reordenar desplaza al resto de la columna y sube la revisión de lo que mueve", () => {
	const banco = montar();
	try {
		const ids = ["A", "B", "C", "D"].map(
			(titulo) => crearTareaHumana(banco.db, { titulo, descripcion: "d", usuarioId: banco.xinux }).id,
		);
		const cuarta = ids[3];
		assert.ok(cuarta !== undefined);

		const movida = reordenar(banco.db, { tareaId: cuarta, orden: 1 });
		assert.equal(movida.orden, 1);
		assert.equal(movida.revision, revisionActual(banco.db));
		assert.deepEqual(
			listarTareas(banco.db, { estado: "backlog" }).map((item) => item.titulo),
			["D", "A", "B", "C"],
		);

		// Pasarse por arriba deja la tarea la última, no rompe.
		reordenar(banco.db, { tareaId: cuarta, orden: 99 });
		assert.deepEqual(
			listarTareas(banco.db, { estado: "backlog" }).map((item) => item.titulo),
			["A", "B", "C", "D"],
		);
	} finally {
		banco.cerrar();
	}
});

/** Las partes de la funcionalidad de `columnaIntercalada`, con la propia funcionalidad. */
type Intercalada = { evolutivo: number; parte1: number; parte2: number; parte3: number };

/**
 * Una columna `prepared` con tres partes de una funcionalidad y dos tareas
 * sueltas por medio: suelta A, parte 1, suelta B, parte 2, parte 3. Es el caso
 * en el que la posición del tablero de la funcionalidad no es la de la columna.
 */
function columnaIntercalada(banco: ReturnType<typeof montar>): Intercalada {
	const evolutivo = crearTareaHumana(banco.db, {
		titulo: "Que los comerciales se bajen sus listados",
		descripcion: "Hoy copian los datos a mano.",
		usuarioId: banco.xinux,
		tipo: "funcionalidad",
	});
	const crear = (titulo: string, padreId?: number): number =>
		crearTareaHumana(banco.db, { titulo, descripcion: "d", usuarioId: banco.xinux, padreId }).id;
	const orden = [
		crear("Suelta A"),
		crear("Parte 1", evolutivo.id),
		crear("Suelta B"),
		crear("Parte 2", evolutivo.id),
		crear("Parte 3", evolutivo.id),
	];
	// El orden de la columna es el orden en que entran en ella.
	for (const tareaId of orden) {
		moverTareaHumano(banco.db, { tareaId, usuarioId: banco.xinux, estado: "prepared" });
	}
	const [, parte1, , parte2, parte3] = orden;
	assert.ok(parte1 !== undefined && parte2 !== undefined && parte3 !== undefined);
	return { evolutivo: evolutivo.id, parte1, parte2, parte3 };
}

/** Los títulos de la columna `prepared`, en su orden. */
function preparadas(banco: ReturnType<typeof montar>): string[] {
	return listarTareas(banco.db, { estado: "prepared" }).map((item) => item.titulo);
}

test("reordenar entre hermanas sube la parte delante de la primera sin adelantar a las sueltas", () => {
	const banco = montar();
	try {
		const { evolutivo, parte3 } = columnaIntercalada(banco);
		assert.deepEqual(preparadas(banco), ["Suelta A", "Parte 1", "Suelta B", "Parte 2", "Parte 3"]);

		// Soltar arriba del tablero de la funcionalidad es ponerse delante de la
		// primera hermana, no la primera de toda la columna.
		reordenar(banco.db, { tareaId: parte3, orden: 1, entre: { padreId: evolutivo } });
		assert.deepEqual(preparadas(banco), ["Suelta A", "Parte 3", "Parte 1", "Suelta B", "Parte 2"]);
	} finally {
		banco.cerrar();
	}
});

test("reordenar entre hermanas baja la parte detrás de la que la precede, y la posición que no existe rompe", () => {
	const banco = montar();
	try {
		const { evolutivo, parte1 } = columnaIntercalada(banco);

		// La tercera posición entre hermanas es detrás de la parte 3, que es la
		// segunda de las que quedan al sacar la que se mueve.
		reordenar(banco.db, { tareaId: parte1, orden: 3, entre: { padreId: evolutivo } });
		assert.deepEqual(preparadas(banco), ["Suelta A", "Suelta B", "Parte 2", "Parte 3", "Parte 1"]);

		// Con dos hermanas hay tres sitios donde soltar: la cuarta no existe.
		assert.equal(
			codigoDe(() => reordenar(banco.db, { tareaId: parte1, orden: 4, entre: { padreId: evolutivo } })),
			"orden_invalido",
		);
		assert.deepEqual(preparadas(banco), ["Suelta A", "Suelta B", "Parte 2", "Parte 3", "Parte 1"]);

		// Sin ámbito la posición es la de la columna entera, como siempre.
		reordenar(banco.db, { tareaId: parte1, orden: 1 });
		assert.deepEqual(preparadas(banco), ["Parte 1", "Suelta A", "Suelta B", "Parte 2", "Parte 3"]);
	} finally {
		banco.cerrar();
	}
});

test("el índice sale ordenado por columna y por orden, y se puede filtrar por terminal", () => {
	const banco = montar();
	try {
		const enCurso = tareaPreparada(banco);
		tomarTarea(banco.db, { tareaId: enCurso.id, fase: "analisis", terminalId: banco.portatil });
		crearTareaHumana(banco.db, { titulo: "Sin tocar", descripcion: "d", usuarioId: banco.xinux });

		const todas = listarTareas(banco.db, {});
		assert.deepEqual(
			todas.map((item) => item.estado),
			["backlog", "prepared"],
		);
		assert.deepEqual(
			listarTareas(banco.db, { terminalId: banco.portatil }).map((item) => item.id),
			[enCurso.id],
		);
		assert.deepEqual(listarTareas(banco.db, { terminalId: banco.sobremesa }), []);
	} finally {
		banco.cerrar();
	}
});

test("un id de tarea no se reutiliza nunca, ni después de borrar la última", () => {
	const banco = montar();
	try {
		const primera = crearTareaHumana(banco.db, { titulo: "La que se queda", descripcion: "d", usuarioId: banco.xinux });
		const segunda = crearTareaHumana(banco.db, { titulo: "La que sobra", descripcion: "d", usuarioId: banco.xinux });
		assert.equal(segunda.id, primera.id + 1);

		borrarTareaBacklog(banco.db, { tareaId: segunda.id, actor: { usuarioId: banco.xinux } });
		assert.equal(leerTarea(banco.db, segunda.id), undefined);

		// El id borrado queda quemado: el hilo, la actividad y los commits ya lo
		// citan, y otra tarea con ese número cambiaría de dueño lo ya escrito.
		const tercera = crearTareaHumana(banco.db, { titulo: "La siguiente", descripcion: "d", usuarioId: banco.xinux });
		assert.ok(tercera.id > segunda.id, `el id ${tercera.id} reutiliza el de la tarea borrada`);
	} finally {
		banco.cerrar();
	}
});

test("las tareas inexistentes se rechazan con tarea_inexistente", () => {
	const banco = montar();
	try {
		assert.equal(leerTarea(banco.db, 404), undefined);
		assert.equal(
			codigoDe(() => tomarTarea(banco.db, { tareaId: 404, fase: "analisis", terminalId: banco.portatil })),
			"tarea_inexistente",
		);
	} finally {
		banco.cerrar();
	}
});
