import assert from "node:assert/strict";
import { test } from "node:test";
import { actividadDe } from "../src/db/actividad.ts";
import { editarTareaBacklog } from "../src/db/edicion.ts";
import { crearParte, crearSubtarea, partesDe } from "../src/db/funcionalidades.ts";
import { comentarAnalisis, comentarioHumano, comentarResultado } from "../src/db/hilo.ts";
import { crearProyecto } from "../src/db/proyectos.ts";
import {
	aprobarEjecucion,
	crearHija,
	crearTareaHumana,
	exigirTarea,
	itemIndiceDe,
	leerTarea,
	moverTareaHumano,
	type Tarea,
	tareasParaTerminalDesde,
	tomarTarea,
} from "../src/db/tareas.ts";
import { documentoTarea } from "../src/md/documento.ts";
import { lineaIndice } from "../src/md/indice.ts";
import { olasDe } from "../src/web/componentes.ts";
import { type Banco, codigoDe, montar } from "./comun.ts";

/** Una tarea normal en `prepared`, con autoejecución y las dos fases en el portátil. */
function tareaEnPrepared(banco: Banco, rama: string | null = null, padreId: number | null = null): Tarea {
	const creada = crearTareaHumana(banco.db, {
		titulo: "Rehacer la exportación",
		descripcion: "Es grande: hay que partirla.",
		usuarioId: banco.ana,
		rama,
		padreId,
		analisisModelo: "sonnet",
		analisisTerminalId: banco.portatil,
		ejecucionModelo: "opus",
		ejecucionTerminalId: banco.portatil,
	});
	return moverTareaHumano(banco.db, { tareaId: creada.id, usuarioId: banco.ana, estado: "prepared" });
}

/** El análisis la descompone en las partes que se le pidan, encadenadas, y escribe el plan. */
function descomponer(banco: Banco, madre: Tarea, titulos: string[]): Tarea[] {
	tomarTarea(banco.db, { tareaId: madre.id, fase: "analisis", terminalId: banco.portatil });
	const partes: Tarea[] = [];
	for (const titulo of titulos) {
		const anterior = partes.at(-1);
		partes.push(
			crearParte(banco.db, {
				titulo,
				descripcion: "Qué entrega, cómo se comprueba y de qué depende.",
				padreId: madre.id,
				terminalId: banco.portatil,
				dependeDe: anterior === undefined ? [] : [anterior.id],
			}),
		);
	}
	comentarAnalisis(banco.db, { tareaId: madre.id, terminalId: banco.portatil, texto: "Plan de conjunto." });
	return partes;
}

/** Una parte trabajada de punta a punta y aceptada por el humano. */
function cerrarParte(banco: Banco, tareaId: number, commit: string): void {
	tomarTarea(banco.db, { tareaId, fase: "analisis", terminalId: banco.portatil });
	comentarAnalisis(banco.db, { tareaId, terminalId: banco.portatil, texto: "plan de la parte" });
	tomarTarea(banco.db, { tareaId, fase: "ejecucion", terminalId: banco.portatil });
	comentarResultado(banco.db, { tareaId, terminalId: banco.portatil, texto: `Hecho.\n\nCommit: ${commit}` });
	moverTareaHumano(banco.db, { tareaId, usuarioId: banco.ana, estado: "finished" });
}

test("el análisis de una tarea la descompone y la deja esperando al humano aunque tenga autoejecución", () => {
	const banco = montar();
	try {
		const madre = tareaEnPrepared(banco, "evolutivo/csv");
		const [datos, boton] = descomponer(banco, madre, ["Sacar los datos", "Poner el botón"]);
		assert.ok(datos !== undefined && boton !== undefined);

		// Cada parte es un trozo del plan y hereda rama, modelos y terminales.
		assert.equal(datos.clase, "parte");
		assert.equal(datos.estado, "backlog");
		assert.equal(datos.rama, "evolutivo/csv");
		assert.equal(datos.ejecucionModelo, "opus");
		assert.equal(datos.ejecucionTerminalId, banco.portatil);

		const tras = exigirTarea(banco.db, madre.id);
		assert.equal(tras.estado, "prepared");
		const item = itemIndiceDe(banco.db, madre.id);
		assert.deepEqual(item.marcas, ["análisis listo"]);
		assert.equal(item.partes, 2);
		assert.equal(item.partesCerradas, 0);
		assert.equal(item.hijas, 2);
		assert.deepEqual(partesDe(banco.db, madre.id), { total: 2, cerradas: 0 });
		assert.equal(leerTarea(banco.db, madre.id)?.partes, 2);

		// En el Markdown: subtareas en vez de ejecución, y el progreso en el frontmatter.
		assert.match(
			lineaIndice(item),
			/^- US[0-9A-F]+ · prepared · subtareas 0\/2 · análisis listo · Rehacer la exportación · analisis: sonnet@portatil-ana$/,
		);
		const completa = leerTarea(banco.db, madre.id);
		assert.ok(completa !== undefined);
		assert.match(documentoTarea(completa), /^marcas: \[análisis listo\]\npartes: 2\npartesCerradas: 0$/m);

		// No tiene ejecución propia.
		assert.equal(
			codigoDe(() => tomarTarea(banco.db, { tareaId: madre.id, fase: "ejecucion", terminalId: banco.portatil })),
			"sin_ejecucion_propia",
		);
	} finally {
		banco.cerrar();
	}
});

test("una tarea con solo hijas de trabajo no está descompuesta y conserva su línea de siempre", () => {
	const banco = montar();
	try {
		const tarea = tareaEnPrepared(banco);
		tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "plan" });
		tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil });
		const hija = crearHija(banco.db, {
			titulo: "Un trozo",
			descripcion: "d",
			padreId: tarea.id,
			terminalId: banco.portatil,
		});
		assert.equal(hija.clase, "hija");

		const item = itemIndiceDe(banco.db, tarea.id);
		assert.equal(item.partes, null);
		assert.equal(item.partesCerradas, null);
		assert.equal(item.hijas, 1);
		assert.match(lineaIndice(item), / · ejecucion: opus@portatil-ana$/);
		assert.doesNotMatch(lineaIndice(item), /subtareas/);
		const completa = leerTarea(banco.db, tarea.id);
		assert.ok(completa !== undefined);
		assert.doesNotMatch(documentoTarea(completa), /^partes:/m);
	} finally {
		banco.cerrar();
	}
});

test("una parte no cuelga de una pregunta ni fuera del análisis de su madre", () => {
	const banco = montar();
	try {
		const pregunta = crearTareaHumana(banco.db, {
			titulo: "¿Cuánto cuesta?",
			descripcion: "d",
			usuarioId: banco.ana,
			tipo: "pregunta",
			analisisTerminalId: banco.portatil,
		});
		moverTareaHumano(banco.db, { tareaId: pregunta.id, usuarioId: banco.ana, estado: "prepared" });
		tomarTarea(banco.db, { tareaId: pregunta.id, fase: "analisis", terminalId: banco.portatil });
		const parte = (padreId: number) => () =>
			crearParte(banco.db, { titulo: "P", descripcion: "d", padreId, terminalId: banco.portatil });
		assert.equal(codigoDe(parte(pregunta.id)), "solo_desde_descomposicion");

		// En backlog todavía no se analiza: no hay descomposición en marcha.
		const enBacklog = crearTareaHumana(banco.db, { titulo: "T", descripcion: "d", usuarioId: banco.ana });
		assert.equal(codigoDe(parte(enBacklog.id)), "solo_desde_descomposicion");

		// Una tarea sin partes cierra el análisis sin exigir ninguna.
		const sinPartes = tareaEnPrepared(banco);
		tomarTarea(banco.db, { tareaId: sinPartes.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: sinPartes.id, terminalId: banco.portatil, texto: "plan" });
		assert.deepEqual(itemIndiceDe(banco.db, sinPartes.id).marcas, []);
	} finally {
		banco.cerrar();
	}
});

test("aprobar la descomposición de una tarea raíz con rama crea la parte de integrar; la de una subtarea, no", () => {
	const banco = montar();
	try {
		const raiz = tareaEnPrepared(banco, "evolutivo/csv");
		descomponer(banco, raiz, ["Sacar los datos", "Poner el botón"]);
		aprobarEjecucion(banco.db, { tareaId: raiz.id, usuarioId: banco.ana });
		assert.equal(exigirTarea(banco.db, raiz.id).estado, "doing");
		const deLaRaiz = leerTarea(banco.db, raiz.id)?.hijas ?? [];
		assert.deepEqual(
			deLaRaiz.map((hija) => [hija.titulo, hija.estado, hija.clase]),
			[
				["Sacar los datos", "prepared", "parte"],
				["Poner el botón", "prepared", "parte"],
				["Integrar la rama `evolutivo/csv` en la principal", "prepared", "parte"],
			],
		);

		// La primera parte se descompone a su vez: hereda la rama, y la integra la madre.
		const primera = deLaRaiz[0];
		assert.ok(primera !== undefined);
		tomarTarea(banco.db, { tareaId: primera.id, fase: "analisis", terminalId: banco.portatil });
		crearParte(banco.db, { titulo: "Consulta", descripcion: "d", padreId: primera.id, terminalId: banco.portatil });
		crearParte(banco.db, { titulo: "Fichero", descripcion: "d", padreId: primera.id, terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: primera.id, terminalId: banco.portatil, texto: "plan" });
		assert.equal(exigirTarea(banco.db, primera.id).rama, "evolutivo/csv");
		aprobarEjecucion(banco.db, { tareaId: primera.id, usuarioId: banco.ana });
		assert.deepEqual(
			(leerTarea(banco.db, primera.id)?.hijas ?? []).map((hija) => hija.titulo),
			["Consulta", "Fichero"],
		);
	} finally {
		banco.cerrar();
	}
});

test("una tarea descompuesta en curso no se ofrece, no admite trabajo propio y se cierra sola con su última parte", () => {
	const banco = montar();
	try {
		const madre = tareaEnPrepared(banco);
		const [datos, boton] = descomponer(banco, madre, ["Sacar los datos", "Poner el botón"]);
		assert.ok(datos !== undefined && boton !== undefined);
		aprobarEjecucion(banco.db, { tareaId: madre.id, usuarioId: banco.ana });

		const ofrecidas = tareasParaTerminalDesde(banco.db, { terminalId: banco.portatil, revision: 0 }).map(
			(item) => item.id,
		);
		assert.ok(!ofrecidas.includes(madre.id));
		assert.ok(ofrecidas.includes(datos.id));

		assert.equal(
			codigoDe(() =>
				crearHija(banco.db, { titulo: "Suelta", descripcion: "d", padreId: madre.id, terminalId: banco.portatil }),
			),
			"sin_ejecucion_propia",
		);
		assert.equal(
			codigoDe(() => comentarResultado(banco.db, { tareaId: madre.id, terminalId: banco.portatil, texto: "Hecho." })),
			"sin_ejecucion_propia",
		);

		// La primera parte se ejecuta con una hija de trabajo, que no cuenta para cerrar a nadie.
		tomarTarea(banco.db, { tareaId: datos.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: datos.id, terminalId: banco.portatil, texto: "plan" });
		tomarTarea(banco.db, { tareaId: datos.id, fase: "ejecucion", terminalId: banco.portatil });
		crearHija(banco.db, { titulo: "Trabajo", descripcion: "d", padreId: datos.id, terminalId: banco.portatil });
		comentarResultado(banco.db, { tareaId: datos.id, terminalId: banco.portatil, texto: "Hecho.\n\nCommit: a1b2c3d" });
		moverTareaHumano(banco.db, { tareaId: datos.id, usuarioId: banco.ana, estado: "finished" });
		assert.equal(exigirTarea(banco.db, madre.id).estado, "doing");
		assert.equal(itemIndiceDe(banco.db, madre.id).partesCerradas, 1);

		cerrarParte(banco, boton.id, "b2c3d4e");
		const cerrada = leerTarea(banco.db, madre.id);
		assert.equal(cerrada?.tarea.estado, "done");
		const resultado = cerrada?.comentarios.at(-1);
		assert.equal(resultado?.tipo, "resultado");
		assert.equal(resultado?.autor, "servidor");
		assert.match(resultado?.texto ?? "", /Sacar los datos · Commit: a1b2c3d/);
		assert.match(resultado?.texto ?? "", /Poner el botón · Commit: b2c3d4e/);
	} finally {
		banco.cerrar();
	}
});

test("el humano cuelga una subtarea de cualquier tarea abierta que no sea una pregunta, y hereda de ella", () => {
	const banco = montar();
	try {
		const madre = crearTareaHumana(banco.db, {
			titulo: "Madre",
			descripcion: "d",
			usuarioId: banco.ana,
			rama: "evolutivo/csv",
			autoejecucion: false,
			analisisModelo: "sonnet",
			analisisTerminalId: banco.portatil,
			ejecucionModelo: "opus",
			ejecucionTerminalId: banco.sobremesa,
		});
		const hija = crearTareaHumana(banco.db, { titulo: "Hija", descripcion: "", usuarioId: banco.ana, padreId: madre.id });
		assert.equal(hija.clase, "parte");
		assert.equal(hija.rama, "evolutivo/csv");
		assert.equal(hija.autoejecucion, false);
		assert.equal(hija.analisisModelo, "sonnet");
		assert.equal(hija.analisisTerminalId, banco.portatil);
		assert.equal(hija.ejecucionModelo, "opus");
		assert.equal(hija.ejecucionTerminalId, banco.sobremesa);

		const pregunta = crearTareaHumana(banco.db, {
			titulo: "P",
			descripcion: "d",
			usuarioId: banco.ana,
			tipo: "pregunta",
		});
		assert.equal(
			codigoDe(() =>
				crearTareaHumana(banco.db, { titulo: "X", descripcion: "d", usuarioId: banco.ana, padreId: pregunta.id }),
			),
			"padre_invalido",
		);

		// En la edición, ni de sí misma, ni de una de sus subtareas, ni de otro proyecto.
		const edicion = (tareaId: number, padreId: number | null) => ({
			tareaId,
			usuarioId: banco.ana,
			titulo: "T",
			descripcion: "d",
			tipo: "tarea" as const,
			padreId,
			autoejecucion: true,
			analisisModelo: null,
			analisisTerminalId: null,
			ejecucionModelo: null,
			ejecucionTerminalId: null,
		});
		const editar = (tareaId: number, padreId: number) => () => editarTareaBacklog(banco.db, edicion(tareaId, padreId));
		assert.equal(codigoDe(editar(madre.id, madre.id)), "padre_invalido");
		assert.equal(codigoDe(editar(madre.id, hija.id)), "padre_invalido");
		const otro = crearProyecto(banco.db, { clave: "WEB", nombre: "Web" });
		const ajena = crearTareaHumana(banco.db, {
			titulo: "Ajena",
			descripcion: "d",
			usuarioId: banco.ana,
			proyectoId: otro.id,
		});
		assert.equal(codigoDe(editar(madre.id, ajena.id)), "padre_invalido");

		// Colgar a mano una tarea suelta la hace parte; descolgarla le quita la clase.
		const suelta = crearTareaHumana(banco.db, { titulo: "Suelta", descripcion: "d", usuarioId: banco.ana });
		assert.equal(editar(suelta.id, madre.id)().clase, "parte");
		assert.equal(editarTareaBacklog(banco.db, edicion(suelta.id, null)).clase, null);

		// Cerrada, ya no admite subtareas.
		const cerrada = tareaEnPrepared(banco);
		tomarTarea(banco.db, { tareaId: cerrada.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: cerrada.id, terminalId: banco.portatil, texto: "plan" });
		tomarTarea(banco.db, { tareaId: cerrada.id, fase: "ejecucion", terminalId: banco.portatil });
		comentarResultado(banco.db, { tareaId: cerrada.id, terminalId: banco.portatil, texto: "Hecho." });
		moverTareaHumano(banco.db, { tareaId: cerrada.id, usuarioId: banco.ana, estado: "finished" });
		assert.equal(
			codigoDe(() =>
				crearTareaHumana(banco.db, { titulo: "X", descripcion: "d", usuarioId: banco.ana, padreId: cerrada.id }),
			),
			"padre_invalido",
		);
	} finally {
		banco.cerrar();
	}
});

test("«Añadir subtarea» vale por definir, preparada y en curso sin fase en marcha, y deja rastro", () => {
	const banco = montar();
	try {
		const enBacklog = crearTareaHumana(banco.db, { titulo: "Por definir", descripcion: "d", usuarioId: banco.ana });
		const sub = crearSubtarea(banco.db, { madreId: enBacklog.id, titulo: "  Una subtarea  ", usuarioId: banco.ana });
		assert.equal(sub.titulo, "Una subtarea");
		assert.equal(sub.descripcion, "");
		assert.equal(sub.estado, "backlog");
		assert.equal(sub.clase, "parte");
		assert.deepEqual(
			actividadDe(banco.db, "tarea", sub.id).map((fila) => fila.accion),
			["crear_tarea"],
		);
		assert.equal(
			codigoDe(() => crearSubtarea(banco.db, { madreId: enBacklog.id, titulo: "  ", usuarioId: banco.ana })),
			"titulo_vacio",
		);

		const preparada = tareaEnPrepared(banco);
		crearSubtarea(banco.db, { madreId: preparada.id, titulo: "Otra", usuarioId: banco.ana });

		// En curso, con la ejecución en marcha, no: dejaría sin ejecutor al subagente.
		const enCurso = tareaEnPrepared(banco);
		tomarTarea(banco.db, { tareaId: enCurso.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: enCurso.id, terminalId: banco.portatil, texto: "plan" });
		tomarTarea(banco.db, { tareaId: enCurso.id, fase: "ejecucion", terminalId: banco.portatil });
		assert.equal(
			codigoDe(() => crearSubtarea(banco.db, { madreId: enCurso.id, titulo: "Más", usuarioId: banco.ana })),
			"en_ejecucion",
		);
		// Con la fase cerrada (el agente contesta y suelta) ya se puede, y la tarea queda descompuesta.
		comentarResultado(banco.db, { tareaId: enCurso.id, terminalId: banco.portatil, texto: "Hecho." });
		comentarioHumano(banco.db, { tareaId: enCurso.id, usuarioId: banco.ana, texto: "Falta una parte." });
		assert.equal(exigirTarea(banco.db, enCurso.id).estado, "doing");
		crearSubtarea(banco.db, { madreId: enCurso.id, titulo: "Más", usuarioId: banco.ana });
		assert.equal(itemIndiceDe(banco.db, enCurso.id).partes, 1);

		const pregunta = crearTareaHumana(banco.db, {
			titulo: "P",
			descripcion: "d",
			usuarioId: banco.ana,
			tipo: "pregunta",
		});
		assert.equal(
			codigoDe(() => crearSubtarea(banco.db, { madreId: pregunta.id, titulo: "X", usuarioId: banco.ana })),
			"padre_invalido",
		);
	} finally {
		banco.cerrar();
	}
});

test("las olas del orden de ejecución salen de las dependencias entre hermanas", () => {
	const parte = (codigo: string, ...dependeDe: string[]) => ({ codigo, dependeDe });
	const olas = olasDe([
		parte("F1"),
		parte("F2", "F1"),
		parte("F3", "F2"),
		parte("F4", "F3"),
		parte("F5", "F3"),
		parte("F6", "F4", "F5"),
		parte("F7", "F1", "F2", "F3", "F4", "F5", "F6"),
	]);
	assert.deepEqual(
		olas.map((ola) => ola.map((cual) => cual.codigo)),
		[["F1"], ["F2"], ["F3"], ["F4", "F5"], ["F6"], ["F7"]],
	);
	// Sin dependencias, una sola ola; una dependencia de fuera no ordena nada.
	assert.deepEqual(
		olasDe([parte("A"), parte("B", "FUERA")]).map((ola) => ola.map((cual) => cual.codigo)),
		[["A", "B"]],
	);
	// Un ciclo no debería existir, pero si se colara no cuelga.
	assert.equal(olasDe([parte("A", "B"), parte("B", "A")]).flat().length, 2);
});
