import assert from "node:assert/strict";
import { test } from "node:test";
import { revisionActual } from "../src/db/consultas.ts";
import { registrarConsumo } from "../src/db/consumo.ts";
import { crearParte } from "../src/db/funcionalidades.ts";
import { comentarAnalisis, comentarioDeAgente, comentarResultado, preguntar } from "../src/db/hilo.ts";
import {
	aprobarEjecucion,
	borrarTarea,
	crearHija,
	crearPropuesta,
	crearTareaHumana,
	exigirTarea,
	faseQueToca,
	itemIndiceDe,
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
		usuarioId: banco.ana,
		autoejecucion: extra.autoejecucion,
		analisisModelo: "sonnet",
		ejecucionModelo: "opus",
	});
	return moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "prepared" });
}

/** Igual, pero con las dos fases sin modelo: es la tarea que el humano deja a medio asignar. */
function tareaSinModelos(banco: ReturnType<typeof montar>): Tarea {
	const tarea = crearTareaHumana(banco.db, {
		titulo: "Exportar el listado",
		descripcion: "Hoy lo copian a mano.",
		usuarioId: banco.ana,
	});
	return moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "prepared" });
}

test("una tarea humana nace en backlog, al final de la columna y con la revisión de su escritura", () => {
	const banco = montar();
	try {
		const primera = crearTareaHumana(banco.db, { titulo: "Una", descripcion: "d", usuarioId: banco.ana });
		assert.equal(primera.estado, "backlog");
		assert.equal(primera.orden, 1);
		assert.equal(primera.autoejecucion, true);
		assert.equal(primera.creadaPorUsuarioId, banco.ana);
		assert.equal(primera.creadaPorTerminalId, null);
		assert.equal(primera.revision, revisionActual(banco.db));

		const segunda = crearTareaHumana(banco.db, { titulo: "Otra", descripcion: "d", usuarioId: banco.ana });
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
		const tarea = crearTareaHumana(banco.db, { titulo: "Una", descripcion: "d", usuarioId: banco.ana });

		const preparada = moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "prepared" });
		assert.equal(preparada.estado, "prepared");
		assert.equal(preparada.orden, 1);

		const devuelta = moverTareaHumano(banco.db, {
			tareaId: tarea.id,
			usuarioId: banco.ana,
			estado: "backlog",
			nota: "hay que repensarla",
		});
		assert.equal(devuelta.estado, "backlog");

		// El agente nunca mueve hacia atrás, y saltarse una columna tampoco vale.
		assert.equal(
			codigoDe(() => moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "doing" })),
			"transicion_no_permitida",
		);
		assert.equal(
			codigoDe(() => moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "finished" })),
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
			codigoDe(() => moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "backlog" })),
			"nota_obligatoria",
		);

		moverTareaHumano(banco.db, {
			tareaId: tarea.id,
			usuarioId: banco.ana,
			estado: "backlog",
			nota: "falta decidir el alcance",
		});
		const completa = leerTarea(banco.db, tarea.id);
		assert.ok(completa);
		assert.equal(completa.comentarios.length, 1);
		assert.equal(completa.comentarios[0]?.tipo, "comentario");
		assert.equal(completa.comentarios[0]?.autor, "humano:ana");
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
		aprobarEjecucion(banco.db, { tareaId: tarea.id, usuarioId: banco.ana });
		assert.equal(faseQueToca(exigirTarea(banco.db, tarea.id)), "ejecucion");

		moverTareaHumano(banco.db, {
			tareaId: tarea.id,
			usuarioId: banco.ana,
			estado: "backlog",
			nota: "la descripción cambia",
		});
		const enBacklog = exigirTarea(banco.db, tarea.id);
		assert.equal(enBacklog.analisisHecho, false);
		assert.equal(enBacklog.ejecucionAprobada, false);

		// Al salir de nuevo, la tarea vuelve a necesitar análisis: la descripción
		// puede haber cambiado y el plan anterior ya no vale.
		const otraVez = moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "prepared" });
		assert.equal(faseQueToca(otraVez), "analisis");

		// El comentario de análisis se queda: el hilo no se edita nunca.
		const completa = leerTarea(banco.db, tarea.id);
		assert.ok(completa);
		assert.deepEqual(
			completa.comentarios.map((comentario) => comentario.tipo),
			["analisis", "comentario"],
		);
	} finally {
		banco.cerrar();
	}
});

test("la marca «sin terminal» solo se calcula en prepared y en doing", () => {
	const banco = montar();
	try {
		const tarea = crearTareaHumana(banco.db, { titulo: "Sin asignar", descripcion: "d", usuarioId: banco.ana });
		// En backlog el agente no la ve, así que no dice nada que no tenga terminal.
		assert.deepEqual(marcasDe(tarea, 0), []);

		const preparada = moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "prepared" });
		assert.deepEqual(marcasDe(preparada, 0), ["sin terminal"]);

		tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "plan" });
		// Ya toca la ejecución, que sigue sin terminal.
		assert.deepEqual(marcasDe(exigirTarea(banco.db, tarea.id), 0), ["sin terminal"]);

		tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil });
		comentarResultado(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "hecho" });
		const terminada = moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "finished" });
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
			usuarioId: banco.ana,
			estado: "doing",
			nota: "faltan los tests",
		});
		assert.equal(rechazada.estado, "doing");
		assert.equal(rechazada.enMarchaTerminalId, null);
		// El terminal de ejecución se conserva: solo se suelta la marca.
		assert.equal(rechazada.ejecucionTerminalId, banco.portatil);

		banco.db.prepare("UPDATE tareas SET estado = 'done' WHERE id = ?").run(tarea.id);
		const aceptada = moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "finished" });
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
			"sonnet@portatil-ana",
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
			"opus@portatil-ana",
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

		const aprobada = aprobarEjecucion(banco.db, { tareaId: tarea.id, usuarioId: banco.ana });
		assert.equal(aprobada.ejecucionAprobada, true);
		assert.deepEqual(marcasDe(aprobada, 0), ["sin terminal"]);
		assert.equal(
			tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil }).estado,
			"doing",
		);
		// Ya en doing, aprobar deja de tener sentido.
		assert.equal(
			codigoDe(() => aprobarEjecucion(banco.db, { tareaId: tarea.id, usuarioId: banco.ana })),
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
			{
				id: hija.id,
				codigo: hija.codigo,
				estado: "doing",
				titulo: "Generar el fichero CSV",
				dependeDe: [],
				bloqueada: false,
			},
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
			usuarioId: banco.ana,
			tipo: "pregunta",
			autoejecucion: false,
			analisisModelo: "sonnet",
		});
		assert.equal(pregunta.tipo, "pregunta");
		assert.equal(pregunta.estado, "backlog");

		// Una tarea normal sigue naciendo como `tarea` sin decir nada.
		assert.equal(crearTareaHumana(banco.db, { titulo: "Otra", descripcion: "d", usuarioId: banco.ana }).tipo, "tarea");

		const preparada = moverTareaHumano(banco.db, { tareaId: pregunta.id, usuarioId: banco.ana, estado: "prepared" });
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
		const hecha = crearTareaHumana(banco.db, { titulo: "Ya hecha", descripcion: "d", usuarioId: banco.ana });
		banco.db.prepare("UPDATE tareas SET estado = 'done', orden = 1 WHERE id = ?").run(hecha.id);

		const pregunta = crearTareaHumana(banco.db, {
			titulo: "¿Cuánto se tarda hoy en cerrar el mes?",
			descripcion: "Quiero saberlo antes de pedir nada.",
			usuarioId: banco.ana,
			tipo: "pregunta",
			// Sin autoejecución una tarea normal esperaría aprobación; una
			// pregunta no, porque no hay ejecución que aprobar.
			autoejecucion: false,
			analisisModelo: "sonnet",
			analisisTerminalId: banco.portatil,
		});
		moverTareaHumano(banco.db, { tareaId: pregunta.id, usuarioId: banco.ana, estado: "prepared" });
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
		assert.equal(completa?.comentarios[0]?.autor, "sonnet@portatil-ana");
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
			usuarioId: banco.ana,
			tipo: "pregunta",
			analisisModelo: "sonnet",
			analisisTerminalId: banco.portatil,
		});
		// En backlog el agente no la ve.
		assert.deepEqual(tareasParaTerminalDesde(banco.db, { terminalId: banco.portatil, revision: 0 }), []);

		moverTareaHumano(banco.db, { tareaId: pregunta.id, usuarioId: banco.ana, estado: "prepared" });
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
			(titulo) => crearTareaHumana(banco.db, { titulo, descripcion: "d", usuarioId: banco.ana }).id,
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
		usuarioId: banco.ana,
		tipo: "funcionalidad",
	});
	const crear = (titulo: string, padreId?: number): number =>
		crearTareaHumana(banco.db, { titulo, descripcion: "d", usuarioId: banco.ana, padreId }).id;
	const orden = [
		crear("Suelta A"),
		crear("Parte 1", evolutivo.id),
		crear("Suelta B"),
		crear("Parte 2", evolutivo.id),
		crear("Parte 3", evolutivo.id),
	];
	// El orden de la columna es el orden en que entran en ella.
	for (const tareaId of orden) {
		moverTareaHumano(banco.db, { tareaId, usuarioId: banco.ana, estado: "prepared" });
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
		crearTareaHumana(banco.db, { titulo: "Sin tocar", descripcion: "d", usuarioId: banco.ana });

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
		const primera = crearTareaHumana(banco.db, { titulo: "La que se queda", descripcion: "d", usuarioId: banco.ana });
		const segunda = crearTareaHumana(banco.db, { titulo: "La que sobra", descripcion: "d", usuarioId: banco.ana });
		assert.equal(segunda.id, primera.id + 1);

		borrarTarea(banco.db, { tareaId: segunda.id, actor: { usuarioId: banco.ana } });
		assert.equal(leerTarea(banco.db, segunda.id), undefined);

		// El id borrado queda quemado: el hilo, la actividad y los commits ya lo
		// citan, y otra tarea con ese número cambiaría de dueño lo ya escrito.
		const tercera = crearTareaHumana(banco.db, { titulo: "La siguiente", descripcion: "d", usuarioId: banco.ana });
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

// --- estado_desde: la edad en columna ---------------------------------------

/** Una fecha vieja: se escribe a mano para ver si el cambio de estado la refresca. */
const ANTIGUA = "2020-01-01T00:00:00.000Z";

function envejecerEstado(banco: ReturnType<typeof montar>, tareaId: number): void {
	banco.db.prepare("UPDATE tareas SET estado_desde = ? WHERE id = ?").run(ANTIGUA, tareaId);
}

/** Que el estado de la tarea se haya refrescado ahora, y no siga en la fecha vieja. */
function exigirRefrescada(banco: ReturnType<typeof montar>, tareaId: number, camino: string): void {
	const desde = exigirTarea(banco.db, tareaId).estadoDesde;
	assert.notEqual(desde, ANTIGUA, `${camino} no refrescó estado_desde`);
	assert.ok(desde > "2026-01-01", `${camino} dejó estado_desde en ${desde}`);
}

test("una tarea nace con estado_desde puesto, y es su misma fecha de creación", () => {
	const banco = montar();
	try {
		const tarea = crearTareaHumana(banco.db, { titulo: "Una", descripcion: "d", usuarioId: banco.ana });
		assert.equal(tarea.estadoDesde, tarea.creada);
	} finally {
		banco.cerrar();
	}
});

test("todo camino que cambia el estado refresca estado_desde, y un comentario no lo toca", () => {
	const banco = montar();
	try {
		// Mover desde la web.
		const tarea = crearTareaHumana(banco.db, {
			titulo: "Exportar el listado",
			descripcion: "d",
			usuarioId: banco.ana,
			analisisModelo: "sonnet",
			ejecucionModelo: "opus",
		});
		envejecerEstado(banco, tarea.id);
		moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "prepared" });
		exigirRefrescada(banco, tarea.id, "mover desde la web");

		// Tomar la ejecución, que es lo que la lleva a `doing`.
		tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "plan" });
		envejecerEstado(banco, tarea.id);
		tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil });
		exigirRefrescada(banco, tarea.id, "tomar la ejecución");

		// Un comentario no cambia de columna: la edad en columna sigue siendo la misma.
		envejecerEstado(banco, tarea.id);
		comentarioDeAgente(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "a medias" });
		assert.equal(exigirTarea(banco.db, tarea.id).estadoDesde, ANTIGUA);

		// El comentario que cierra la ejecución sí.
		comentarResultado(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "hecho" });
		exigirRefrescada(banco, tarea.id, "el comentario de resultado");

		// Y la aceptación del humano.
		envejecerEstado(banco, tarea.id);
		moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "finished" });
		exigirRefrescada(banco, tarea.id, "finalizar desde la web");
	} finally {
		banco.cerrar();
	}
});

test("el análisis de una pregunta la cierra y refresca su estado_desde", () => {
	const banco = montar();
	try {
		const creada = crearTareaHumana(banco.db, {
			titulo: "¿Cuánto cuesta una tarea?",
			descripcion: "d",
			usuarioId: banco.ana,
			tipo: "pregunta",
		});
		moverTareaHumano(banco.db, { tareaId: creada.id, usuarioId: banco.ana, estado: "prepared" });
		tomarTarea(banco.db, { tareaId: creada.id, fase: "analisis", terminalId: banco.portatil, modelo: "sonnet" });
		envejecerEstado(banco, creada.id);
		comentarAnalisis(banco.db, { tareaId: creada.id, terminalId: banco.portatil, texto: "unos 200.000 tokens." });

		assert.equal(exigirTarea(banco.db, creada.id).estado, "done");
		exigirRefrescada(banco, creada.id, "el análisis de una pregunta");
	} finally {
		banco.cerrar();
	}
});

test("aprobar la descomposición refresca la funcionalidad y sus partes, y cerrarla también", () => {
	const banco = montar();
	try {
		const creada = crearTareaHumana(banco.db, {
			titulo: "Que los comerciales se bajen sus listados",
			descripcion: "d",
			usuarioId: banco.ana,
			tipo: "funcionalidad",
			analisisModelo: "sonnet",
			analisisTerminalId: banco.portatil,
			ejecucionModelo: "opus",
			ejecucionTerminalId: banco.portatil,
		});
		moverTareaHumano(banco.db, { tareaId: creada.id, usuarioId: banco.ana, estado: "prepared" });
		tomarTarea(banco.db, { tareaId: creada.id, fase: "analisis", terminalId: banco.portatil });
		const parte = crearParte(banco.db, {
			titulo: "Sacar los datos",
			descripcion: "d",
			padreId: creada.id,
			terminalId: banco.portatil,
		});
		comentarAnalisis(banco.db, { tareaId: creada.id, terminalId: banco.portatil, texto: "una parte basta" });

		envejecerEstado(banco, creada.id);
		envejecerEstado(banco, parte.id);
		aprobarEjecucion(banco.db, { tareaId: creada.id, usuarioId: banco.ana });
		exigirRefrescada(banco, creada.id, "aprobar la descomposición");
		exigirRefrescada(banco, parte.id, "sacar la parte del backlog");

		// La última parte aceptada cierra la funcionalidad: la mueve el servidor.
		tomarTarea(banco.db, { tareaId: parte.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: parte.id, terminalId: banco.portatil, texto: "plan" });
		tomarTarea(banco.db, { tareaId: parte.id, fase: "ejecucion", terminalId: banco.portatil });
		comentarResultado(banco.db, { tareaId: parte.id, terminalId: banco.portatil, texto: "hecho" });
		envejecerEstado(banco, creada.id);
		moverTareaHumano(banco.db, { tareaId: parte.id, usuarioId: banco.ana, estado: "finished" });

		assert.equal(exigirTarea(banco.db, creada.id).estado, "done");
		exigirRefrescada(banco, creada.id, "el cierre automático de la funcionalidad");
	} finally {
		banco.cerrar();
	}
});

test("el índice trae la edad en columna y desde cuándo está bloqueada", () => {
	const banco = montar();
	try {
		const tarea = tareaPreparada(banco);
		const item = itemIndiceDe(banco.db, tarea.id);
		assert.equal(item.estadoDesde, exigirTarea(banco.db, tarea.id).estadoDesde);
		assert.equal(item.bloqueadaDesde, null);

		tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil });
		const primera = preguntar(banco.db, {
			tareaId: tarea.id,
			terminalId: banco.portatil,
			pregunta: "¿Coma o punto y coma?",
			porQueImporta: "La hoja de cálculo está en español.",
			opciones: OPCIONES,
			recomendacion: "Sí",
		});
		preguntar(banco.db, {
			tareaId: tarea.id,
			terminalId: banco.portatil,
			pregunta: "¿Y la cabecera?",
			porQueImporta: "Se abre sola en la hoja de cálculo.",
			opciones: OPCIONES,
			recomendacion: "Sí",
		});

		// La más antigua de las dos abiertas: es desde cuándo espera por el humano.
		assert.equal(itemIndiceDe(banco.db, tarea.id).bloqueadaDesde, primera.creada);
	} finally {
		banco.cerrar();
	}
});

// --- lo que el índice enseña en la tarjeta y en la fila -----------------------

test("el índice cuenta las hijas cerradas y suma los tokens de todo el árbol", () => {
	const banco = montar();
	try {
		const padre = tareaPreparada(banco);
		tomarTarea(banco.db, { tareaId: padre.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: padre.id, terminalId: banco.portatil, texto: "Plan." });
		tomarTarea(banco.db, { tareaId: padre.id, fase: "ejecucion", terminalId: banco.portatil });
		const hija = (titulo: string): Tarea =>
			crearHija(banco.db, { titulo, descripcion: "d", padreId: padre.id, terminalId: banco.portatil });

		const hecha = hija("La que se cierra");
		comentarResultado(banco.db, { tareaId: hecha.id, terminalId: banco.portatil, texto: "Hecho. Commit: a1b2c3d" });
		const aceptada = hija("La que se acepta");
		comentarResultado(banco.db, { tareaId: aceptada.id, terminalId: banco.portatil, texto: "Hecho. Commit: b2c3d4e" });
		moverTareaHumano(banco.db, { tareaId: aceptada.id, usuarioId: banco.ana, estado: "finished" });
		const enCurso = hija("La que sigue");

		// Una nieta: el consumo sube por todo el árbol, no solo por las hijas.
		const nieta = crearHija(banco.db, {
			titulo: "Lo que hace un subagente",
			descripcion: "d",
			padreId: enCurso.id,
			terminalId: banco.portatil,
		});
		registrarConsumo(banco.db, {
			tareaId: padre.id,
			fase: "ejecucion",
			modelo: "opus",
			terminalId: banco.portatil,
			tokens: 1_000,
			herramientas: 3,
			duracionMs: 1_000,
		});
		registrarConsumo(banco.db, {
			tareaId: enCurso.id,
			fase: "ejecucion",
			modelo: "opus",
			terminalId: banco.portatil,
			tokens: 200,
			herramientas: 1,
			duracionMs: 500,
		});
		registrarConsumo(banco.db, {
			tareaId: nieta.id,
			fase: "ejecucion",
			modelo: "opus",
			terminalId: banco.portatil,
			tokens: 30,
			herramientas: 1,
			duracionMs: 500,
		});

		const item = itemIndiceDe(banco.db, padre.id);
		assert.equal(item.hijas, 3);
		// `done` y `finished` cuentan como cerradas; la que sigue en `doing`, no.
		assert.equal(item.hijasCerradas, 2);
		assert.equal(item.tokensConHijas, 1_230);
		// La hija intermedia lleva lo suyo y lo de su nieta.
		assert.equal(itemIndiceDe(banco.db, enCurso.id).tokensConHijas, 230);

		const suelta = crearTareaHumana(banco.db, { titulo: "Sin nada", descripcion: "d", usuarioId: banco.ana });
		const sola = itemIndiceDe(banco.db, suelta.id);
		assert.equal(sola.hijas, 0);
		assert.equal(sola.hijasCerradas, 0);
		assert.equal(sola.tokensConHijas, 0);
	} finally {
		banco.cerrar();
	}
});

test("los conmutadores de un clic filtran por lo que espera, lo que está en marcha y lo huérfano", () => {
	const banco = montar();
	try {
		// Con las dos fases asignadas: así la única «sin terminal» es la que lo está.
		const preparada = (titulo: string, autoejecucion = true): Tarea => {
			const tarea = crearTareaHumana(banco.db, {
				titulo,
				descripcion: "d",
				usuarioId: banco.ana,
				autoejecucion,
				analisisModelo: "sonnet",
				analisisTerminalId: banco.portatil,
				ejecucionModelo: "opus",
				ejecucionTerminalId: banco.portatil,
			});
			return moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "prepared" });
		};

		// Bloqueada: una pregunta sin contestar.
		const bloqueada = preparada("La que pregunta");
		tomarTarea(banco.db, { tareaId: bloqueada.id, fase: "analisis", terminalId: banco.portatil });
		preguntar(banco.db, {
			tareaId: bloqueada.id,
			terminalId: banco.portatil,
			pregunta: "¿Coma o punto y coma?",
			porQueImporta: "La hoja de cálculo está en español.",
			opciones: OPCIONES,
			recomendacion: "Sí",
		});

		// Análisis listo: sin autoejecución, con el análisis escrito.
		const porAprobar = preparada("La que espera el visto bueno", false);
		tomarTarea(banco.db, { tareaId: porAprobar.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: porAprobar.id, terminalId: banco.portatil, texto: "Plan." });

		// Hecha: espera a que el humano la revise.
		const hecha = preparada("La que ya está");
		tomarTarea(banco.db, { tareaId: hecha.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: hecha.id, terminalId: banco.portatil, texto: "Plan." });
		tomarTarea(banco.db, { tareaId: hecha.id, fase: "ejecucion", terminalId: banco.portatil });
		comentarResultado(banco.db, { tareaId: hecha.id, terminalId: banco.portatil, texto: "Hecho. Commit: a1b2c3d" });

		// En prepared, con terminal y sin nada que espere: no sale en ninguno.
		const tranquila = preparada("La que sigue su curso");
		tomarTarea(banco.db, { tareaId: tranquila.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: tranquila.id, terminalId: banco.portatil, texto: "Plan." });

		// Sin terminal: cualquiera puede tomarla.
		const huerfana = tareaSinModelos(banco);

		const ids = (rapido: "espera" | "en-marcha" | "sin-terminal"): number[] =>
			listarTareas(banco.db, { rapido }).map((item) => item.id);

		assert.deepEqual(ids("espera").sort(), [bloqueada.id, porAprobar.id, hecha.id].sort());
		// «En marcha» es la que un terminal tiene tomada ahora mismo.
		assert.deepEqual(ids("en-marcha"), [bloqueada.id]);
		assert.deepEqual(ids("sin-terminal"), [huerfana.id]);
		// Sin conmutador salen todas.
		assert.equal(listarTareas(banco.db, {}).length, 5);
	} finally {
		banco.cerrar();
	}
});

test("la búsqueda mira el título y la descripción, no distingue mayúsculas y no toma el porcentaje por comodín", () => {
	const banco = montar();
	try {
		const csv = crearTareaHumana(banco.db, {
			titulo: "Exportar el listado a CSV",
			descripcion: "Los comerciales lo copian a mano.",
			usuarioId: banco.ana,
		});
		const cola = crearTareaHumana(banco.db, {
			titulo: "Migrar el envío de correos",
			descripcion: "Se manda todo por una cola.",
			usuarioId: banco.ana,
		});
		const descuento = crearTareaHumana(banco.db, {
			titulo: "Aplicar un 100% de descuento",
			descripcion: "Solo para el primer pedido.",
			usuarioId: banco.ana,
		});

		const ids = (q: string): number[] => listarTareas(banco.db, { q }).map((item) => item.id);

		// En el título, con otras mayúsculas.
		assert.deepEqual(ids("csv"), [csv.id]);
		// En la descripción.
		assert.deepEqual(ids("COLA"), [cola.id]);
		// Sin resultado no es un error: no hay ninguna.
		assert.deepEqual(ids("nada de nada"), []);
		// El porcentaje se busca tal cual, no como «cualquier cosa».
		assert.deepEqual(ids("100%"), [descuento.id]);
		assert.deepEqual(ids("100% de descuento"), [descuento.id]);
		assert.deepEqual(ids("%de%"), []);
	} finally {
		banco.cerrar();
	}
});

test("cada salto de columna deja su transición, y borrar la tarea se las lleva", () => {
	const banco = montar();
	try {
		const tarea = crearTareaHumana(banco.db, {
			titulo: "Exportar el listado",
			descripcion: "Hoy lo copian a mano.",
			usuarioId: banco.ana,
			analisisModelo: "sonnet",
			ejecucionModelo: "opus",
		});
		const saltos = (): string[] =>
			banco.db
				.prepare("SELECT de, a FROM transiciones WHERE tarea_id = ? ORDER BY id")
				.all(tarea.id)
				.map((fila) => `${fila.de ?? "—"} → ${fila.a}`);

		// Nacer también es entrar en una columna: la primera transición no viene
		// de ninguna parte.
		assert.deepEqual(saltos(), ["— → backlog"]);

		moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "prepared" });
		tomarTarea(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, fase: "analisis" });
		comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "Plan." });
		tomarTarea(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, fase: "ejecucion" });
		comentarResultado(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "Hecho. Commit: a1b2c3d" });

		assert.deepEqual(saltos(), ["— → backlog", "backlog → prepared", "prepared → doing", "doing → done"]);

		// El comentario de análisis no mueve la tarea, así que no anota nada: en
		// la lista de arriba no hay ningún salto entre `prepared` y `doing`.
		borrarTarea(banco.db, { tareaId: tarea.id, actor: { usuarioId: banco.ana } });
		assert.deepEqual(saltos(), []);
	} finally {
		banco.cerrar();
	}
});

test("el presupuesto marca la tarea cuando el árbol lo pasa, y solo cuando lo hay", () => {
	const banco = montar();
	try {
		const tarea = crearTareaHumana(banco.db, {
			titulo: "Con tope",
			descripcion: "d",
			usuarioId: banco.ana,
			presupuesto: 200_000,
		});
		assert.equal(tarea.presupuesto, 200_000);
		assert.equal(itemIndiceDe(banco.db, tarea.id).presupuesto, 200_000);
		// Sin gasto no hay nada que avisar.
		assert.deepEqual(marcasDe(tarea, 0, 0, 0), []);
		// Por debajo y justo en el tope tampoco: se marca al pasarse.
		assert.deepEqual(marcasDe(tarea, 0, 0, 199_999), []);
		assert.deepEqual(marcasDe(tarea, 0, 0, 200_000), []);
		assert.deepEqual(marcasDe(tarea, 0, 0, 200_001), ["sobre presupuesto"]);

		// Sin presupuesto no se marca nunca, gaste lo que gaste.
		const sinTope = crearTareaHumana(banco.db, { titulo: "Sin tope", descripcion: "d", usuarioId: banco.ana });
		assert.equal(sinTope.presupuesto, null);
		assert.deepEqual(marcasDe(sinTope, 0, 0, 9_000_000), []);

		// Y el índice y la ficha lo calculan con lo gastado de verdad en el árbol.
		moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "prepared" });
		tomarTarea(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, fase: "analisis", modelo: "sonnet" });
		comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "Plan." });
		tomarTarea(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, fase: "ejecucion", modelo: "opus" });
		const hija = crearHija(banco.db, {
			titulo: "Lo que hace un subagente",
			descripcion: "d",
			padreId: tarea.id,
			terminalId: banco.portatil,
		});
		registrarConsumo(banco.db, {
			tareaId: hija.id,
			fase: "ejecucion",
			modelo: "opus",
			terminalId: banco.portatil,
			tokens: 250_000,
			herramientas: 9,
			duracionMs: 1_000,
		});
		assert.ok(itemIndiceDe(banco.db, tarea.id).marcas.includes("sobre presupuesto"));
		assert.ok(leerTarea(banco.db, tarea.id)?.marcas.includes("sobre presupuesto"));
		// La hija nace sin tope: lo suyo no se compara con el de su madre.
		assert.equal(exigirTarea(banco.db, hija.id).presupuesto, null);
		assert.ok(!itemIndiceDe(banco.db, hija.id).marcas.includes("sobre presupuesto"));
	} finally {
		banco.cerrar();
	}
});

test("un presupuesto que no es un entero de cero en adelante no se guarda", () => {
	const banco = montar();
	try {
		for (const malo of [Number.NaN, -1, 1.5]) {
			assert.equal(
				codigoDe(() =>
					crearTareaHumana(banco.db, { titulo: "Con tope", descripcion: "d", usuarioId: banco.ana, presupuesto: malo }),
				),
				"presupuesto_invalido",
			);
		}
		// Cero es un tope válido: todo lo que se gaste se pasa de él.
		const cero = crearTareaHumana(banco.db, {
			titulo: "A coste cero",
			descripcion: "d",
			usuarioId: banco.ana,
			presupuesto: 0,
		});
		assert.equal(cero.presupuesto, 0);
		assert.deepEqual(marcasDe(cero, 0, 0, 1), ["sobre presupuesto"]);
	} finally {
		banco.cerrar();
	}
});
