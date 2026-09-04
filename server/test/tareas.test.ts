import assert from "node:assert/strict";
import { test } from "node:test";
import { revisionActual } from "../src/db/consultas.ts";
import { comentarAnalisis, preguntar } from "../src/db/hilo.ts";
import {
	aprobarEjecucion,
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
		assert.deepEqual(completa?.hijas, [{ id: hija.id, estado: "doing", titulo: "Generar el fichero CSV" }]);
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
