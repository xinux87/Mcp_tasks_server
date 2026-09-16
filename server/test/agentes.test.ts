import assert from "node:assert/strict";
import { test } from "node:test";
import { actividadDe, actividadReciente } from "../src/db/actividad.ts";
import { borrarTerminal } from "../src/db/admin.ts";
import {
	borrarAgente,
	buscarAgentePorNombre,
	crearAgente,
	editarAgente,
	esNombreDeAgente,
	exigirAgentePorNombre,
	fasesAsignadas,
	listarAgentes,
} from "../src/db/agentes.ts";
import { revisionActual } from "../src/db/base.ts";
import { editarTareaBacklog } from "../src/db/edicion.ts";
import { crearParte } from "../src/db/funcionalidades.ts";
import { comentarAnalisis } from "../src/db/hilo.ts";
import { crearTareaHumana, exigirTarea, moverTareaHumano, tomarTarea } from "../src/db/tareas.ts";
import { type Banco, codigoDe, montar } from "./comun.ts";

const ACTOR = { nombre: "cli" } as const;

/** Un papel con lo mínimo: el que sirve para casi todos los casos. */
function papel(banco: Banco, nombre = "revisor", terminalId: number | null = null): number {
	return crearAgente(banco.db, {
		nombre,
		descripcion: "Revisa lo entregado",
		instrucciones: "Eres el revisor.",
		modelo: "sonnet",
		terminalId,
		actor: ACTOR,
	}).id;
}

// --- la forma del nombre -----------------------------------------------------

test("el nombre de un agente son minúsculas, cifras y guiones, de dos a treinta, empezando por letra", () => {
	for (const bueno of ["revisor", "implementador-web", "a2", "x".repeat(30)]) {
		assert.ok(esNombreDeAgente(bueno), `${bueno} debería valer`);
	}
	for (const malo of ["", "a", "Revisor", "2revisor", "-revisor", "con espacio", "con_guion_bajo", "x".repeat(31)]) {
		assert.ok(!esNombreDeAgente(malo), `${malo} no debería valer`);
	}
});

// --- alta ---------------------------------------------------------------------

test("el alta de un agente comprueba nombre, modelo y terminal, y no sube la revisión", () => {
	const banco = montar();
	try {
		const antes = revisionActual(banco.db);
		const base = { instrucciones: "Eres el revisor.", modelo: "sonnet" };

		// El nombre se normaliza a minúsculas, como la clave de un proyecto a
		// mayúsculas; lo que no encaja con la forma es un error.
		for (const malo of ["con espacio", "2revisor", "r"]) {
			assert.equal(
				codigoDe(() => crearAgente(banco.db, { ...base, nombre: malo })),
				"nombre_invalido",
			);
		}
		assert.equal(
			codigoDe(() => crearAgente(banco.db, { ...base, nombre: "revisor", modelo: "gpt" })),
			"modelo_invalido",
		);
		assert.equal(
			codigoDe(() => crearAgente(banco.db, { ...base, nombre: "revisor", terminalId: 99 })),
			"terminal_inexistente",
		);

		const revisor = crearAgente(banco.db, { ...base, nombre: "revisor", terminalId: banco.portatil, actor: ACTOR });
		assert.equal(revisor.nombre, "revisor");
		assert.equal(crearAgente(banco.db, { ...base, nombre: " Redactor " }).nombre, "redactor");
		assert.equal(revisor.modelo, "sonnet");
		assert.equal(revisor.terminalId, banco.portatil);
		assert.equal(revisor.descripcion, "");
		assert.equal(
			codigoDe(() => crearAgente(banco.db, { ...base, nombre: "revisor" })),
			"nombre_repetido",
		);

		// Nada de esto lo ve un agente hasta que se le asigna a una tarea.
		assert.equal(revisionActual(banco.db), antes);
		assert.deepEqual(
			listarAgentes(banco.db).map((agente) => agente.nombre),
			["redactor", "revisor"],
		);
		assert.equal(buscarAgentePorNombre(banco.db, "REVISOR ")?.id, revisor.id);
		assert.equal(
			codigoDe(() => exigirAgentePorNombre(banco.db, "arquitecto")),
			"agente_inexistente",
		);

		const rastro = actividadDe(banco.db, "agente", revisor.id);
		assert.equal(rastro.length, 1);
		assert.equal(rastro[0]?.accion, "alta_agente");
		assert.equal(rastro[0]?.detalle, "modelo sonnet");
	} finally {
		banco.cerrar();
	}
});

// --- edición ------------------------------------------------------------------

test("editar un agente deja rastro de lo que cambió, y guardar sin tocar nada no deja ninguno", () => {
	const banco = montar();
	try {
		const revisor = papel(banco, "revisor", banco.portatil);

		editarAgente(banco.db, {
			agenteId: revisor,
			descripcion: "Revisa lo entregado",
			instrucciones: "Eres el revisor.",
			modelo: "sonnet",
			terminalId: banco.portatil,
			actor: ACTOR,
		});
		assert.equal(actividadDe(banco.db, "agente", revisor).length, 1);

		const despues = editarAgente(banco.db, {
			agenteId: revisor,
			instrucciones: "Eres el revisor. Primero lees la verificación.",
			modelo: "opus",
			terminalId: null,
			actor: ACTOR,
		});
		assert.equal(despues.modelo, "opus");
		assert.equal(despues.terminalId, null);
		// El papel entero no cabe en una línea: se anota como `instrucciones` a secas.
		const rastro = actividadDe(banco.db, "agente", revisor);
		assert.equal(rastro.at(-1)?.accion, "editar_agente");
		assert.equal(rastro.at(-1)?.detalle, "instrucciones; modelo: sonnet → opus; terminal: portatil-ana → cualquiera");

		assert.equal(
			codigoDe(() => editarAgente(banco.db, { agenteId: revisor, modelo: "gpt" })),
			"modelo_invalido",
		);
		assert.equal(
			codigoDe(() => editarAgente(banco.db, { agenteId: 99, modelo: "opus" })),
			"agente_inexistente",
		);
	} finally {
		banco.cerrar();
	}
});

// --- asignar a una fase -------------------------------------------------------

test("asignar un agente a una fase copia su modelo y su terminal, e ignora los que lleguen", () => {
	const banco = montar();
	try {
		const revisor = papel(banco, "revisor", banco.portatil);
		const tarea = crearTareaHumana(banco.db, {
			titulo: "Exportar el listado",
			descripcion: "d",
			usuarioId: banco.ana,
			analisisAgenteId: revisor,
			// Lo que venga en estos dos no manda: la fase lleva papel.
			analisisModelo: "haiku",
			analisisTerminalId: banco.sobremesa,
			ejecucionModelo: "opus",
			ejecucionTerminalId: banco.sobremesa,
		});
		assert.equal(tarea.analisisAgenteId, revisor);
		assert.equal(tarea.analisisModelo, "sonnet");
		assert.equal(tarea.analisisTerminalId, banco.portatil);
		// La fase sin papel se queda con lo que eligió el humano.
		assert.equal(tarea.ejecucionAgenteId, null);
		assert.equal(tarea.ejecucionModelo, "opus");
		assert.equal(tarea.ejecucionTerminalId, banco.sobremesa);

		// Editar en backlog hace lo mismo, y lo cuenta en el rastro.
		const redactor = papel(banco, "redactor");
		editarTareaBacklog(banco.db, {
			tareaId: tarea.id,
			usuarioId: banco.ana,
			titulo: tarea.titulo,
			descripcion: tarea.descripcion,
			tipo: "tarea",
			autoejecucion: true,
			analisisAgenteId: revisor,
			ejecucionAgenteId: redactor,
			analisisModelo: "haiku",
			analisisTerminalId: null,
			ejecucionModelo: "haiku",
			ejecucionTerminalId: banco.sobremesa,
		});
		const editada = exigirTarea(banco.db, tarea.id);
		assert.equal(editada.ejecucionAgenteId, redactor);
		assert.equal(editada.ejecucionModelo, "sonnet");
		assert.equal(editada.ejecucionTerminalId, null);
		const detalle = actividadDe(banco.db, "tarea", tarea.id).at(-1)?.detalle ?? "";
		assert.match(detalle, /ejecución: agente redactor/);
		// La fase de análisis no cambió de papel: no se anota.
		assert.doesNotMatch(detalle, /análisis: agente/);

		// Un papel que no existe no se asigna.
		assert.equal(
			codigoDe(() =>
				crearTareaHumana(banco.db, {
					titulo: "Otra",
					descripcion: "d",
					usuarioId: banco.ana,
					analisisAgenteId: 99,
				}),
			),
			"agente_inexistente",
		);
	} finally {
		banco.cerrar();
	}
});

test("una parte hereda el papel de su funcionalidad, no solo el modelo y el terminal", () => {
	const banco = montar();
	try {
		const revisor = papel(banco, "revisor", banco.portatil);
		const evolutivo = crearTareaHumana(banco.db, {
			titulo: "Que los comerciales se bajen sus listados",
			descripcion: "d",
			usuarioId: banco.ana,
			tipo: "funcionalidad",
			analisisAgenteId: revisor,
			ejecucionAgenteId: revisor,
		});
		moverTareaHumano(banco.db, { tareaId: evolutivo.id, usuarioId: banco.ana, estado: "prepared" });
		tomarTarea(banco.db, { tareaId: evolutivo.id, fase: "analisis", terminalId: banco.portatil });
		const parte = crearParte(banco.db, {
			titulo: "Poner el botón de descarga",
			descripcion: "d",
			padreId: evolutivo.id,
			terminalId: banco.portatil,
		});
		assert.equal(parte.analisisAgenteId, revisor);
		assert.equal(parte.ejecucionAgenteId, revisor);
		assert.equal(parte.analisisModelo, "sonnet");
		assert.equal(parte.analisisTerminalId, banco.portatil);
	} finally {
		banco.cerrar();
	}
});

// --- borrado ------------------------------------------------------------------

test("borrar un agente libera sus fases y les deja el modelo y el terminal que les copió", () => {
	const banco = montar();
	try {
		const revisor = papel(banco, "revisor", banco.portatil);
		const abierta = crearTareaHumana(banco.db, {
			titulo: "Exportar el listado",
			descripcion: "d",
			usuarioId: banco.ana,
			analisisAgenteId: revisor,
			ejecucionAgenteId: revisor,
		});
		// Las dos fases de la misma tarea cuentan dos.
		assert.equal(fasesAsignadas(banco.db, revisor), 2);

		const antes = revisionActual(banco.db);
		borrarAgente(banco.db, revisor, ACTOR);
		// Borrar un papel no es contenido: ningún agente lo ve.
		assert.equal(revisionActual(banco.db), antes);
		assert.equal(buscarAgentePorNombre(banco.db, "revisor"), undefined);

		const suelta = exigirTarea(banco.db, abierta.id);
		assert.equal(suelta.analisisAgenteId, null);
		assert.equal(suelta.ejecucionAgenteId, null);
		// Lo copiado se queda: la tarea sigue trabajándose igual, sin papel.
		assert.equal(suelta.analisisModelo, "sonnet");
		assert.equal(suelta.analisisTerminalId, banco.portatil);

		const baja = actividadReciente(banco.db, 1)[0];
		assert.equal(baja?.accion, "baja_agente");
		assert.equal(baja?.objetoNombre, "revisor");
		assert.equal(baja?.detalle, "2 fases se quedan sin agente");
		assert.equal(
			codigoDe(() => borrarAgente(banco.db, revisor)),
			"agente_inexistente",
		);
	} finally {
		banco.cerrar();
	}
});

test("una tarea cerrada no cuenta como fase asignada", () => {
	const banco = montar();
	try {
		const revisor = papel(banco, "revisor", banco.portatil);
		const pregunta = crearTareaHumana(banco.db, {
			titulo: "¿Cuánto se tarda hoy en cerrar el mes?",
			descripcion: "d",
			usuarioId: banco.ana,
			tipo: "pregunta",
			analisisAgenteId: revisor,
		});
		assert.equal(fasesAsignadas(banco.db, revisor), 1);

		moverTareaHumano(banco.db, { tareaId: pregunta.id, usuarioId: banco.ana, estado: "prepared" });
		tomarTarea(banco.db, { tareaId: pregunta.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: pregunta.id, terminalId: banco.portatil, texto: "Unos tres días." });
		moverTareaHumano(banco.db, { tareaId: pregunta.id, usuarioId: banco.ana, estado: "finished" });
		assert.equal(fasesAsignadas(banco.db, revisor), 0);
	} finally {
		banco.cerrar();
	}
});

test("borrar un terminal deja a nulo el suyo en los agentes, que pasan a correr en cualquiera", () => {
	const banco = montar();
	try {
		const revisor = papel(banco, "revisor", banco.portatil);
		borrarTerminal(banco.db, banco.portatil, banco.ana);
		assert.equal(buscarAgentePorNombre(banco.db, "revisor")?.terminalId, null);
		assert.equal(revisor, buscarAgentePorNombre(banco.db, "revisor")?.id);
	} finally {
		banco.cerrar();
	}
});
