import assert from "node:assert/strict";
import { test } from "node:test";
import { dependenciasDe } from "../src/db/dependencias.ts";
import { crearParte, partesDe } from "../src/db/funcionalidades.ts";
import { comentarAnalisis, comentarResultado, preguntar } from "../src/db/hilo.ts";
import {
	aprobarEjecucion,
	borrarTarea,
	crearHija,
	crearTareaHumana,
	exigirTarea,
	itemIndiceDe,
	leerTarea,
	marcasDe,
	moverTareaHumano,
	type Tarea,
	tareasParaTerminalDesde,
	tomarTarea,
} from "../src/db/tareas.ts";
import { formatearId } from "../src/md/ids.ts";
import { lineaIndice } from "../src/md/indice.ts";
import { codigoDe, montar } from "./comun.ts";

type Banco = ReturnType<typeof montar>;

const OPCIONES = [
	{ texto: "Sí", consecuencia: "se hace." },
	{ texto: "No hacer nada", consecuencia: "se queda como está." },
];

/** Una funcionalidad ya en `prepared`, lista para descomponer. */
function funcionalidad(banco: Banco, rama: string | null = "evolutivo/csv"): Tarea {
	const creada = crearTareaHumana(banco.db, {
		titulo: "Que los comerciales se bajen sus listados",
		descripcion: "Hoy copian los datos a mano y se equivocan.",
		usuarioId: banco.ana,
		tipo: "funcionalidad",
		rama,
		analisisModelo: "sonnet",
		analisisTerminalId: banco.portatil,
		ejecucionModelo: "opus",
		ejecucionTerminalId: banco.portatil,
	});
	return moverTareaHumano(banco.db, { tareaId: creada.id, usuarioId: banco.ana, estado: "prepared" });
}

/** Trabaja una parte de punta a punta y la deja aceptada, como haría el agente y el humano. */
function cerrarParte(banco: Banco, tareaId: number, resultado: string): void {
	tomarTarea(banco.db, { tareaId, fase: "analisis", terminalId: banco.portatil });
	comentarAnalisis(banco.db, { tareaId, terminalId: banco.portatil, texto: "plan de la parte" });
	tomarTarea(banco.db, { tareaId, fase: "ejecucion", terminalId: banco.portatil });
	comentarResultado(banco.db, { tareaId, terminalId: banco.portatil, texto: resultado });
	moverTareaHumano(banco.db, { tareaId, usuarioId: banco.ana, estado: "finished" });
}

test("una funcionalidad con rama: se descompone, se aprueba, se ejecuta parte a parte y se cierra sola", () => {
	const banco = montar();
	try {
		const evolutivo = funcionalidad(banco);
		assert.equal(evolutivo.tipo, "funcionalidad");
		assert.equal(evolutivo.rama, "evolutivo/csv");

		// La descomposición es del terminal de análisis y de nadie más.
		assert.equal(
			codigoDe(() =>
				crearParte(banco.db, {
					titulo: "Ajena",
					descripcion: "d",
					padreId: evolutivo.id,
					terminalId: banco.sobremesa,
				}),
			),
			"solo_desde_descomposicion",
		);

		tomarTarea(banco.db, { tareaId: evolutivo.id, fase: "analisis", terminalId: banco.portatil, modelo: "sonnet" });
		const datos = crearParte(banco.db, {
			titulo: "Sacar los datos del listado",
			descripcion: "Con los filtros que el comercial tenga puestos.",
			padreId: evolutivo.id,
			terminalId: banco.portatil,
		});
		const boton = crearParte(banco.db, {
			titulo: "Poner el botón de descarga",
			descripcion: "En la pantalla de clientes.",
			padreId: evolutivo.id,
			terminalId: banco.portatil,
			dependeDe: [datos.id],
		});
		const aviso = crearParte(banco.db, {
			titulo: "Avisar cuando la descarga falle",
			descripcion: "Para que no se enteren por el cliente.",
			padreId: evolutivo.id,
			terminalId: banco.portatil,
			dependeDe: [boton.id],
		});

		// Nace en backlog, colgando de la funcionalidad y con todo lo suyo heredado.
		assert.equal(datos.estado, "backlog");
		assert.equal(datos.padreId, evolutivo.id);
		assert.equal(datos.rama, "evolutivo/csv");
		assert.equal(datos.analisisModelo, "sonnet");
		assert.equal(datos.analisisTerminalId, banco.portatil);
		assert.equal(datos.ejecucionModelo, "opus");
		assert.equal(datos.ejecucionTerminalId, banco.portatil);
		assert.deepEqual(dependenciasDe(banco.db, boton.id), [datos.codigo]);

		// Una parte solo depende de sus hermanas.
		const suelta = crearTareaHumana(banco.db, { titulo: "Suelta", descripcion: "d", usuarioId: banco.ana });
		assert.equal(
			codigoDe(() =>
				crearParte(banco.db, {
					titulo: "Cuarta",
					descripcion: "d",
					padreId: evolutivo.id,
					terminalId: banco.portatil,
					dependeDe: [suelta.id],
				}),
			),
			"dependencia_fuera_de_la_funcionalidad",
		);

		// El análisis cierra la descomposición y la deja lista para el humano.
		comentarAnalisis(banco.db, {
			tareaId: evolutivo.id,
			terminalId: banco.portatil,
			texto: "Tres partes: los datos, el botón y el aviso.",
		});
		const descompuesta = exigirTarea(banco.db, evolutivo.id);
		assert.equal(descompuesta.estado, "prepared");
		assert.equal(descompuesta.analisisHecho, true);
		assert.equal(descompuesta.enMarchaTerminalId, null);
		// La autoejecución no cuenta en una funcionalidad: aprueba el humano.
		assert.equal(descompuesta.autoejecucion, true);
		assert.deepEqual(marcasDe(descompuesta, 0), ["análisis listo"]);
		assert.match(lineaIndice(itemIndiceDe(banco.db, evolutivo.id)), / · prepared · funcionalidad 0\/3 · /);
		assert.doesNotMatch(lineaIndice(itemIndiceDe(banco.db, evolutivo.id)), /ejecucion:/);
		assert.match(
			lineaIndice(itemIndiceDe(banco.db, datos.id)),
			new RegExp(` · padre: ${formatearId(evolutivo.codigo)}$`),
		);

		// Una funcionalidad no se ejecuta: se ejecutan sus partes.
		assert.equal(
			codigoDe(() => tomarTarea(banco.db, { tareaId: evolutivo.id, fase: "ejecucion", terminalId: banco.portatil })),
			"funcionalidad_sin_ejecucion",
		);

		// Aprobar la descomposición saca las partes del backlog en su orden y
		// añade la de integrar la rama, que depende de todas las demás.
		const enMarcha = aprobarEjecucion(banco.db, { tareaId: evolutivo.id, usuarioId: banco.ana });
		assert.equal(enMarcha.estado, "doing");
		const partes = leerTarea(banco.db, evolutivo.id)?.hijas ?? [];
		assert.equal(partes.length, 4);
		const integrar = partes[3];
		assert.ok(integrar);
		assert.equal(integrar.titulo, "Integrar la rama `evolutivo/csv` en la principal");
		assert.deepEqual(integrar.dependeDe, [datos.codigo, boton.codigo, aviso.codigo]);
		for (const parte of [datos.id, boton.id, aviso.id, integrar.id]) {
			assert.equal(exigirTarea(banco.db, parte).estado, "prepared", `la parte ${parte} no salió del backlog`);
		}
		assert.deepEqual(
			[datos.id, boton.id, aviso.id, integrar.id].map((parte) => exigirTarea(banco.db, parte).orden),
			[1, 2, 3, 4],
		);
		assert.equal(exigirTarea(banco.db, integrar.id).rama, "evolutivo/csv");

		// En doing la funcionalidad no es trabajo de nadie: solo sale la primera
		// parte, porque las demás esperan.
		assert.deepEqual(
			tareasParaTerminalDesde(banco.db, { terminalId: banco.portatil, revision: 0 }).map((item) => item.id),
			[datos.id],
		);
		assert.equal(
			codigoDe(() => tomarTarea(banco.db, { tareaId: boton.id, fase: "analisis", terminalId: banco.portatil })),
			"esperando_dependencias",
		);

		// Las partes se ejecutan y se aceptan una a una.
		cerrarParte(banco, datos.id, "Qué se construyó: la consulta.\n\nCommit: aaaaaaa");
		assert.equal(exigirTarea(banco.db, evolutivo.id).estado, "doing");
		assert.deepEqual(partesDe(banco.db, evolutivo.id), { total: 4, cerradas: 1 });
		assert.match(lineaIndice(itemIndiceDe(banco.db, evolutivo.id)), / · doing · funcionalidad 1\/4 · /);

		cerrarParte(banco, boton.id, "Qué se construyó: el botón.\n\nCommit: bbbbbbb");
		// Una parte puede cerrarse sin citar commit: se cuenta tal cual.
		cerrarParte(banco, aviso.id, "Qué se construyó: el aviso, que ya estaba hecho.");
		assert.equal(exigirTarea(banco.db, evolutivo.id).estado, "doing");

		// La última parte cierra la funcionalidad en la misma transacción.
		cerrarParte(banco, integrar.id, "Qué se construyó: la fusión.\n\nCommit: eeeeeee");
		const cerrada = leerTarea(banco.db, evolutivo.id);
		assert.equal(cerrada?.tarea.estado, "done");
		const resultado = cerrada?.comentarios.at(-1);
		assert.equal(resultado?.tipo, "resultado");
		assert.equal(resultado?.autor, "servidor");
		assert.equal(
			resultado?.texto,
			[
				`- ${formatearId(datos.codigo)} · Sacar los datos del listado · Commit: aaaaaaa`,
				`- ${formatearId(boton.codigo)} · Poner el botón de descarga · Commit: bbbbbbb`,
				`- ${formatearId(aviso.codigo)} · Avisar cuando la descarga falle · sin commit`,
				`- ${formatearId(integrar.codigo)} · Integrar la rama \`evolutivo/csv\` en la principal · Commit: eeeeeee`,
			].join("\n"),
		);

		// Y de done sale a finished como cualquier otra tarea.
		assert.equal(
			moverTareaHumano(banco.db, { tareaId: evolutivo.id, usuarioId: banco.ana, estado: "finished" }).estado,
			"finished",
		);
	} finally {
		banco.cerrar();
	}
});

test("sin rama no se crea la parte de integrar, y las hijas de trabajo de una parte no cuentan", () => {
	const banco = montar();
	try {
		const evolutivo = funcionalidad(banco, null);
		tomarTarea(banco.db, { tareaId: evolutivo.id, fase: "analisis", terminalId: banco.portatil });
		const unica = crearParte(banco.db, {
			titulo: "Sacar los datos del listado",
			descripcion: "d",
			padreId: evolutivo.id,
			terminalId: banco.portatil,
		});
		assert.equal(unica.rama, null);
		comentarAnalisis(banco.db, { tareaId: evolutivo.id, terminalId: banco.portatil, texto: "una sola parte" });
		aprobarEjecucion(banco.db, { tareaId: evolutivo.id, usuarioId: banco.ana });
		assert.deepEqual(partesDe(banco.db, evolutivo.id), { total: 1, cerradas: 0 });

		// La hija de trabajo cuelga de la parte, no de la funcionalidad, y no
		// hace falta cerrarla para que la funcionalidad se cierre.
		tomarTarea(banco.db, { tareaId: unica.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: unica.id, terminalId: banco.portatil, texto: "plan" });
		tomarTarea(banco.db, { tareaId: unica.id, fase: "ejecucion", terminalId: banco.portatil });
		const hija = crearHija(banco.db, {
			titulo: "La consulta",
			descripcion: "d",
			padreId: unica.id,
			terminalId: banco.portatil,
		});
		assert.equal(hija.padreId, unica.id);
		// Y de la funcionalidad no cuelga trabajo suelto: solo partes.
		assert.equal(
			codigoDe(() =>
				crearHija(banco.db, {
					titulo: "Colgada de la funcionalidad",
					descripcion: "d",
					padreId: evolutivo.id,
					terminalId: banco.portatil,
				}),
			),
			"funcionalidad_sin_ejecucion",
		);
		comentarResultado(banco.db, { tareaId: unica.id, terminalId: banco.portatil, texto: "hecho\n\nCommit: aaaaaaa" });
		moverTareaHumano(banco.db, { tareaId: unica.id, usuarioId: banco.ana, estado: "finished" });

		const cerrada = leerTarea(banco.db, evolutivo.id);
		assert.equal(cerrada?.tarea.estado, "done");
		assert.equal(
			cerrada?.comentarios.at(-1)?.texto,
			`- ${formatearId(unica.codigo)} · Sacar los datos del listado · Commit: aaaaaaa`,
		);
	} finally {
		banco.cerrar();
	}
});

test("borrar la última parte pendiente cierra la funcionalidad", () => {
	const banco = montar();
	try {
		const evolutivo = funcionalidad(banco, null);
		tomarTarea(banco.db, { tareaId: evolutivo.id, fase: "analisis", terminalId: banco.portatil });
		const hecha = crearParte(banco.db, {
			titulo: "La que sí se hace",
			descripcion: "d",
			padreId: evolutivo.id,
			terminalId: banco.portatil,
		});
		const sobrante = crearParte(banco.db, {
			titulo: "La que se cae por el camino",
			descripcion: "d",
			padreId: evolutivo.id,
			terminalId: banco.portatil,
		});
		comentarAnalisis(banco.db, { tareaId: evolutivo.id, terminalId: banco.portatil, texto: "dos partes" });
		aprobarEjecucion(banco.db, { tareaId: evolutivo.id, usuarioId: banco.ana });

		cerrarParte(banco, hecha.id, "hecho\n\nCommit: bbbbbbb");
		// Con una parte sin cerrar, la funcionalidad sigue en marcha.
		assert.equal(exigirTarea(banco.db, evolutivo.id).estado, "doing");

		// Al borrar la que quedaba, ya no falta nada: se cierra en el mismo acto.
		borrarTarea(banco.db, { tareaId: sobrante.id, actor: { usuarioId: banco.ana } });
		const cerrada = leerTarea(banco.db, evolutivo.id);
		assert.equal(cerrada?.tarea.estado, "done");
		assert.deepEqual(partesDe(banco.db, evolutivo.id), { total: 1, cerradas: 1 });
		assert.equal(
			cerrada?.comentarios.at(-1)?.texto,
			`- ${formatearId(hecha.codigo)} · La que sí se hace · Commit: bbbbbbb`,
		);
	} finally {
		banco.cerrar();
	}
});

test("el análisis de una funcionalidad exige partes, y la aprobación exige análisis sin preguntas", () => {
	const banco = montar();
	try {
		const evolutivo = funcionalidad(banco);
		tomarTarea(banco.db, { tareaId: evolutivo.id, fase: "analisis", terminalId: banco.portatil });
		assert.equal(
			codigoDe(() =>
				comentarAnalisis(banco.db, { tareaId: evolutivo.id, terminalId: banco.portatil, texto: "no es viable" }),
			),
			"sin_partes",
		);
		assert.equal(
			codigoDe(() => aprobarEjecucion(banco.db, { tareaId: evolutivo.id, usuarioId: banco.ana })),
			"analisis_no_hecho",
		);

		crearParte(banco.db, { titulo: "Una parte", descripcion: "d", padreId: evolutivo.id, terminalId: banco.portatil });
		preguntar(banco.db, {
			tareaId: evolutivo.id,
			terminalId: banco.portatil,
			pregunta: "¿Entra también el cierre de año?",
			porQueImporta: "cambia el tamaño del evolutivo.",
			opciones: OPCIONES,
			recomendacion: "Sí",
		});
		comentarAnalisis(banco.db, { tareaId: evolutivo.id, terminalId: banco.portatil, texto: "una parte" });
		assert.equal(
			codigoDe(() => aprobarEjecucion(banco.db, { tareaId: evolutivo.id, usuarioId: banco.ana })),
			"tarea_bloqueada",
		);
		// Bloqueada gana a «análisis listo» en el orden de las marcas.
		assert.deepEqual(marcasDe(exigirTarea(banco.db, evolutivo.id), 1), ["bloqueada"]);
	} finally {
		banco.cerrar();
	}
});

test("borrar una tarea se hace en cualquier columna, sin hijas, y se lleva su hilo por delante", () => {
	const banco = montar();
	try {
		const evolutivo = funcionalidad(banco);
		const parte = crearParte(banco.db, {
			titulo: "Una parte que sobra",
			descripcion: "d",
			padreId: evolutivo.id,
			terminalId: banco.portatil,
		});
		const otra = crearTareaHumana(banco.db, {
			titulo: "Depende de la que sobra",
			descripcion: "d",
			usuarioId: banco.ana,
			dependeDe: [parte.id],
		});

		// La funcionalidad está en prepared, que ya no frena el borrado, pero
		// tiene una parte colgando: eso sí lo frena.
		assert.equal(
			codigoDe(() => borrarTarea(banco.db, { tareaId: evolutivo.id, actor: { usuarioId: banco.ana } })),
			"con_hijas",
		);

		// La parte se borra esté donde esté: es lo que permite podar la
		// descomposición y también deshacerse de una tarea ya en marcha.
		const borrada = borrarTarea(banco.db, { tareaId: parte.id, actor: { usuarioId: banco.ana } });
		assert.equal(borrada.titulo, "Una parte que sobra");
		assert.equal(leerTarea(banco.db, parte.id), undefined);
		assert.deepEqual(dependenciasDe(banco.db, otra.id), []);
		// Y ahora la funcionalidad se queda sin hijas y se puede borrar.
		borrarTarea(banco.db, { tareaId: evolutivo.id, actor: { usuarioId: banco.ana } });
		assert.equal(leerTarea(banco.db, evolutivo.id), undefined);
		assert.equal(banco.db.prepare("SELECT COUNT(*) AS t FROM comentarios").get()?.t, 0);
	} finally {
		banco.cerrar();
	}
});

test("una tarea en doing que un terminal tiene en marcha también se borra", () => {
	const banco = montar();
	try {
		const tarea = crearTareaHumana(banco.db, {
			titulo: "La que está dentro de un agente",
			descripcion: "d",
			usuarioId: banco.ana,
		});
		moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "prepared" });
		tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil, modelo: "sonnet" });
		comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "plan" });
		tomarTarea(banco.db, { tareaId: tarea.id, fase: "ejecucion", terminalId: banco.portatil, modelo: "opus" });
		assert.equal(exigirTarea(banco.db, tarea.id).estado, "doing");

		// El humano manda: se borra aunque haya un agente dentro. Ese agente se
		// entera al intentar escribir en ella.
		borrarTarea(banco.db, { tareaId: tarea.id, actor: { usuarioId: banco.ana } });
		assert.equal(leerTarea(banco.db, tarea.id), undefined);
	} finally {
		banco.cerrar();
	}
});
