import assert from "node:assert/strict";
import { test } from "node:test";
import { crearTerminalConToken } from "../src/auth/tokens.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { actividadDe, actividadReciente } from "../src/db/actividad.ts";
import { altaTerminal, borrarTerminal, borrarUsuario, listarTerminales } from "../src/db/admin.ts";
import { revisionActual } from "../src/db/base.ts";
import { buscarTerminalPorId, crearUsuario, registrarTerminal } from "../src/db/consultas.ts";
import { dependenciasDe, fijarDependencias } from "../src/db/dependencias.ts";
import { editarTareaBacklog } from "../src/db/edicion.ts";
import { crearParte } from "../src/db/funcionalidades.ts";
import { comentarAnalisis, preguntar, responder } from "../src/db/hilo.ts";
import {
	borrarProyecto,
	buscarProyectoPorClave,
	crearProyecto,
	editarProyecto,
	esClaveDeProyecto,
	exigirProyectoPorClave,
	listarProyectos,
	normalizarRepositorio,
	PROYECTO_PRINCIPAL,
} from "../src/db/proyectos.ts";
import {
	borrarTarea,
	crearHija,
	crearPropuesta,
	crearTareaHumana,
	leerTarea,
	listarTareas,
	moverTareaHumano,
	preguntasContestadasDesde,
	reordenar,
	type Tarea,
	tareasParaTerminalDesde,
	tomarTarea,
} from "../src/db/tareas.ts";
import { type Banco, codigoDe, montar } from "./comun.ts";

const ACTOR = { nombre: "cli" } as const;

/** Un proyecto nuevo con un terminal suyo: es lo mínimo para probar el corte. */
function otroProyecto(banco: Banco, clave = "WEB"): { proyectoId: number; terminalId: number } {
	const proyecto = crearProyecto(banco.db, { clave, nombre: `Proyecto ${clave}` });
	const { valor } = crearTerminalConToken(
		banco.db,
		banco.xinux,
		`terminal-${clave}`,
		"xinux@ejemplo.com",
		undefined,
		undefined,
		proyecto.id,
	);
	return { proyectoId: proyecto.id, terminalId: valor.terminal.id };
}

function tareaEn(banco: Banco, proyectoId: number, titulo: string): Tarea {
	return crearTareaHumana(banco.db, { titulo, descripcion: "d", usuarioId: banco.xinux, proyectoId });
}

// --- el proyecto principal ----------------------------------------------------

test("una base recién abierta trae el proyecto principal y solo ese", () => {
	const db = abrirBaseDeDatos(":memory:");
	try {
		const proyectos = listarProyectos(db);
		assert.equal(proyectos.length, 1);
		assert.equal(proyectos[0]?.id, PROYECTO_PRINCIPAL);
		assert.equal(proyectos[0]?.clave, "PRI");
		assert.equal(proyectos[0]?.nombre, "Principal");
		assert.equal(proyectos[0]?.ramaPrincipal, "main");
		// Lo crea la migración: el arranque no lo duplica ni escribe otro.
		assert.equal(buscarProyectoPorClave(db, "PRI")?.id, PROYECTO_PRINCIPAL);
	} finally {
		db.close();
	}
});

test("las tareas y los terminales nacen en el proyecto principal si no se dice otro", () => {
	const banco = montar();
	try {
		assert.equal(tareaEn(banco, PROYECTO_PRINCIPAL, "Suelta").proyectoId, PROYECTO_PRINCIPAL);
		assert.equal(
			crearTareaHumana(banco.db, { titulo: "Sin proyecto", descripcion: "d", usuarioId: banco.xinux }).proyectoId,
			PROYECTO_PRINCIPAL,
		);
		assert.equal(buscarTerminalPorId(banco.db, banco.portatil)?.proyectoId, PROYECTO_PRINCIPAL);
		assert.equal(buscarTerminalPorId(banco.db, banco.portatil)?.ruta, null);
	} finally {
		banco.cerrar();
	}
});

// --- clave y repositorio ------------------------------------------------------

test("la clave son de dos a seis caracteres en mayúsculas empezando por letra", () => {
	for (const buena of ["PR", "PRI", "WEB", "API2", "A1B2C3"]) {
		assert.ok(esClaveDeProyecto(buena), `${buena} debería valer`);
	}
	for (const mala of ["", "P", "1PR", "pri", "PRI-2", "DEMASIADO", "PR I"]) {
		assert.ok(!esClaveDeProyecto(mala), `${mala} no debería valer`);
	}
});

test("dos URLs que solo difieren en espacios, barra final o .git son el mismo repositorio", () => {
	const esperado = "https://github.com/xinux87/Mcp_tasks_server";
	for (const forma of [
		"  https://github.com/xinux87/Mcp_tasks_server  ",
		"https://github.com/xinux87/Mcp_tasks_server/",
		"https://github.com/xinux87/Mcp_tasks_server.git",
		"  https://github.com/xinux87/Mcp_tasks_server.git/ ",
	]) {
		assert.equal(normalizarRepositorio(forma), esperado);
	}
	assert.equal(normalizarRepositorio("   "), null);
	assert.equal(normalizarRepositorio(null), null);
});

// --- alta, edición y borrado --------------------------------------------------

test("crear un proyecto exige la forma de la clave y que no esté repetida", () => {
	const banco = montar();
	try {
		assert.equal(
			codigoDe(() => crearProyecto(banco.db, { clave: "web-1", nombre: "Web" })),
			"clave_invalida",
		);
		assert.equal(
			codigoDe(() => crearProyecto(banco.db, { clave: "WEB", nombre: "  " })),
			"nombre_vacio",
		);
		const web = crearProyecto(banco.db, { clave: "web", nombre: "La web", repositorio: "git@host:x/y.git " });
		// La clave se guarda en mayúsculas y el repositorio ya normalizado.
		assert.equal(web.clave, "WEB");
		assert.equal(web.repositorio, "git@host:x/y");
		assert.equal(web.ramaPrincipal, "main");
		assert.equal(
			codigoDe(() => crearProyecto(banco.db, { clave: "WEB", nombre: "Otra" })),
			"clave_repetida",
		);
		assert.equal(exigirProyectoPorClave(banco.db, "WEB").id, web.id);
		assert.equal(
			codigoDe(() => exigirProyectoPorClave(banco.db, "NADA")),
			"proyecto_inexistente",
		);
	} finally {
		banco.cerrar();
	}
});

test("crear, editar y borrar un proyecto dejan rastro y no suben la revisión", () => {
	const banco = montar();
	try {
		const antes = revisionActual(banco.db);
		const web = crearProyecto(banco.db, { clave: "WEB", nombre: "La web", actor: ACTOR });
		assert.equal(revisionActual(banco.db), antes, "el alta de un proyecto no es contenido para ningún agente");
		const alta = actividadDe(banco.db, "proyecto", web.id);
		assert.equal(alta.length, 1);
		assert.equal(alta[0]?.accion, "alta_proyecto");
		assert.equal(alta[0]?.detalle, "clave WEB");

		// Solo los campos que cambiaron, con el formato de `editar_tarea`.
		editarProyecto(banco.db, {
			proyectoId: web.id,
			nombre: "El portal",
			repositorio: "https://host/x/y.git",
			verificacion: "npm test",
			actor: ACTOR,
		});
		const edicion = actividadDe(banco.db, "proyecto", web.id).at(-1);
		assert.equal(edicion?.accion, "editar_proyecto");
		assert.equal(
			edicion?.detalle,
			"nombre: «La web» → «El portal»; repositorio: ninguno → https://host/x/y; verificación: ninguno → npm test",
		);

		// Guardar sin tocar nada no es una acción: no escribe fila.
		editarProyecto(banco.db, { proyectoId: web.id, nombre: "El portal", actor: ACTOR });
		assert.equal(actividadDe(banco.db, "proyecto", web.id).length, 2);

		const despues = revisionActual(banco.db);
		borrarProyecto(banco.db, web.id, ACTOR);
		assert.equal(revisionActual(banco.db), despues);
		assert.equal(actividadReciente(banco.db, 1)[0]?.accion, "baja_proyecto");
		assert.equal(listarProyectos(banco.db).length, 1);
	} finally {
		banco.cerrar();
	}
});

test("sin actor un proyecto no escribe actividad, y la clave no se edita", () => {
	const banco = montar();
	try {
		const web = crearProyecto(banco.db, { clave: "WEB", nombre: "La web" });
		editarProyecto(banco.db, { proyectoId: web.id, nombre: "Otro nombre" });
		assert.deepEqual(actividadDe(banco.db, "proyecto", web.id), []);
		// La clave se fija al crear: la edición no la toca ni aunque se le pase.
		assert.equal(buscarProyectoPorClave(banco.db, "WEB")?.nombre, "Otro nombre");
	} finally {
		banco.cerrar();
	}
});

test("un proyecto se borra vacío: nunca el principal, nunca con tareas ni terminales", () => {
	const banco = montar();
	try {
		assert.equal(
			codigoDe(() => borrarProyecto(banco.db, PROYECTO_PRINCIPAL, ACTOR)),
			"proyecto_principal",
		);

		const { proyectoId, terminalId } = otroProyecto(banco);
		assert.equal(
			codigoDe(() => borrarProyecto(banco.db, proyectoId, ACTOR)),
			"proyecto_con_terminales",
		);
		borrarTerminal(banco.db, terminalId, banco.xinux);

		const tarea = tareaEn(banco, proyectoId, "Suya");
		assert.equal(
			codigoDe(() => borrarProyecto(banco.db, proyectoId, ACTOR)),
			"proyecto_con_tareas",
		);

		// Por la puerta de siempre: la tarea se lleva su hilo y sus transiciones.
		borrarTarea(banco.db, { tareaId: tarea.id, actor: ACTOR });
		assert.equal(borrarProyecto(banco.db, proyectoId, ACTOR).clave, "WEB");
	} finally {
		banco.cerrar();
	}
});

// --- registrar un terminal ----------------------------------------------------

test("registrar un terminal guarda su carpeta y devuelve su proyecto", () => {
	const banco = montar();
	try {
		const registrado = registrarTerminal(banco.db, banco.portatil, { ruta: "/home/xinux/repo" });
		assert.equal(registrado.proyecto.clave, "PRI");
		assert.equal(registrado.terminal.ruta, "/home/xinux/repo");
		assert.notEqual(registrado.terminal.conectadoEn, null);
		// Es telemetría: no sube la revisión.
		const revision = revisionActual(banco.db);
		registrarTerminal(banco.db, banco.portatil, {});
		assert.equal(revisionActual(banco.db), revision);
		// Sin ruta nueva se conserva la que reportó antes.
		assert.equal(buscarTerminalPorId(banco.db, banco.portatil)?.ruta, "/home/xinux/repo");
	} finally {
		banco.cerrar();
	}
});

test("un terminal en otro repositorio no se registra: el proyecto no coincide", () => {
	const banco = montar();
	try {
		const web = crearProyecto(banco.db, {
			clave: "WEB",
			nombre: "La web",
			repositorio: "https://host/x/y.git",
		});
		const { valor } = crearTerminalConToken(
			banco.db,
			banco.xinux,
			"terminal-web",
			"xinux@ejemplo.com",
			undefined,
			undefined,
			web.id,
		);
		const terminalId = valor.terminal.id;

		assert.equal(
			codigoDe(() => registrarTerminal(banco.db, terminalId, { ruta: "/otro", repositorio: "https://host/a/b" })),
			"proyecto_no_coincide",
		);
		// No se marca conectado ni se guarda la ruta: la sesión se para ahí.
		assert.equal(buscarTerminalPorId(banco.db, terminalId)?.conectadoEn, null);
		assert.equal(buscarTerminalPorId(banco.db, terminalId)?.ruta, null);

		// El mismo repositorio escrito de otra forma sí vale.
		const bien = registrarTerminal(banco.db, terminalId, { repositorio: "https://host/x/y/" });
		assert.equal(bien.proyecto.clave, "WEB");
		// Y sin repositorio reportado no se comprueba nada.
		assert.equal(registrarTerminal(banco.db, banco.portatil, {}).proyecto.clave, "PRI");
	} finally {
		banco.cerrar();
	}
});

test("el alta de un terminal elige proyecto y la lista lo enseña con su ruta", () => {
	const banco = montar();
	try {
		const web = crearProyecto(banco.db, { clave: "WEB", nombre: "La web" });
		const creado = altaTerminal(banco.db, {
			usuarioId: banco.xinux,
			nombre: "sobremesa-web",
			cuenta: "xinux@ejemplo.com",
			proyectoId: web.id,
		});
		registrarTerminal(banco.db, creado.terminal.id, { ruta: "/srv/web" });
		const fila = listarTerminales(banco.db).find((candidato) => candidato.id === creado.terminal.id);
		assert.equal(fila?.proyecto, "WEB");
		assert.equal(fila?.proyectoId, web.id);
		assert.equal(fila?.ruta, "/srv/web");
		// Los de siempre siguen en el principal.
		assert.equal(listarTerminales(banco.db).find((otro) => otro.id === banco.portatil)?.proyecto, "PRI");
	} finally {
		banco.cerrar();
	}
});

// --- tareas acotadas al proyecto ----------------------------------------------

test("una tarea nace en el proyecto de quien la crea, y sus hijas y partes lo heredan", () => {
	const banco = montar();
	try {
		const { proyectoId, terminalId } = otroProyecto(banco);

		// Una propuesta nace en el proyecto del terminal que la propone.
		const propuesta = crearPropuesta(banco.db, { titulo: "De paso", descripcion: "d", terminalId });
		assert.equal(propuesta.proyectoId, proyectoId);

		// Una hija de trabajo hereda el de su padre.
		const madre = tareaEn(banco, proyectoId, "La madre");
		moverTareaHumano(banco.db, { tareaId: madre.id, usuarioId: banco.xinux, estado: "prepared" });
		tomarTarea(banco.db, { tareaId: madre.id, fase: "analisis", terminalId });
		comentarAnalisis(banco.db, { tareaId: madre.id, terminalId, texto: "hecho" });
		tomarTarea(banco.db, { tareaId: madre.id, fase: "ejecucion", terminalId });
		assert.equal(
			crearHija(banco.db, { titulo: "Un trozo", descripcion: "d", padreId: madre.id, terminalId }).proyectoId,
			proyectoId,
		);

		// Y una parte, el de su funcionalidad.
		const evolutivo = crearTareaHumana(banco.db, {
			titulo: "Un evolutivo",
			descripcion: "d",
			usuarioId: banco.xinux,
			proyectoId,
			tipo: "funcionalidad",
		});
		moverTareaHumano(banco.db, { tareaId: evolutivo.id, usuarioId: banco.xinux, estado: "prepared" });
		tomarTarea(banco.db, { tareaId: evolutivo.id, fase: "analisis", terminalId });
		const parte = crearParte(banco.db, {
			titulo: "Una parte",
			descripcion: "d",
			padreId: evolutivo.id,
			terminalId,
		});
		assert.equal(parte.proyectoId, proyectoId);
		// Y el documento de la tarea sabe decir de qué proyecto es.
		assert.equal(leerTarea(banco.db, parte.id)?.proyecto, "WEB");
	} finally {
		banco.cerrar();
	}
});

test("el índice se puede acotar a un proyecto", () => {
	const banco = montar();
	try {
		const { proyectoId } = otroProyecto(banco);
		const principal = tareaEn(banco, PROYECTO_PRINCIPAL, "Del principal");
		const suya = tareaEn(banco, proyectoId, "De la web");

		assert.deepEqual(
			listarTareas(banco.db, { proyectoId }).map((item) => item.id),
			[suya.id],
		);
		assert.deepEqual(
			listarTareas(banco.db, { proyectoId: PROYECTO_PRINCIPAL }).map((item) => item.id),
			[principal.id],
		);
		// Sin filtro salen las dos: es la vista cruzada.
		assert.equal(listarTareas(banco.db, {}).length, 2);
		assert.equal(listarTareas(banco.db, {})[0]?.proyectoId, PROYECTO_PRINCIPAL);
	} finally {
		banco.cerrar();
	}
});

test("las novedades de un terminal solo traen tareas y respuestas de su proyecto", () => {
	const banco = montar();
	try {
		const { proyectoId, terminalId } = otroProyecto(banco);
		// Una tarea sin terminal en cada proyecto: «sin terminal» es «cualquier
		// terminal de este proyecto», no de cualquiera.
		const ajena = tareaEn(banco, PROYECTO_PRINCIPAL, "Del principal");
		moverTareaHumano(banco.db, { tareaId: ajena.id, usuarioId: banco.xinux, estado: "prepared" });
		const suya = tareaEn(banco, proyectoId, "De la web");
		moverTareaHumano(banco.db, { tareaId: suya.id, usuarioId: banco.xinux, estado: "prepared" });

		assert.deepEqual(
			tareasParaTerminalDesde(banco.db, { terminalId, revision: 0 }).map((item) => item.id),
			[suya.id],
		);
		assert.deepEqual(
			tareasParaTerminalDesde(banco.db, { terminalId: banco.portatil, revision: 0 }).map((item) => item.id),
			[ajena.id],
		);

		// Y lo mismo con las preguntas contestadas.
		tomarTarea(banco.db, { tareaId: ajena.id, fase: "analisis", terminalId: banco.portatil });
		const pregunta = preguntar(banco.db, {
			tareaId: ajena.id,
			terminalId: banco.portatil,
			pregunta: "¿Seguimos?",
			porQueImporta: "porque sí",
			opciones: [
				{ texto: "Sí", consecuencia: "se sigue" },
				{ texto: "No hacer nada", consecuencia: "se queda como está" },
			],
			recomendacion: "Sí",
		});
		responder(banco.db, { preguntaId: pregunta.id, usuarioId: banco.xinux, opcion: "Sí" });
		assert.deepEqual(
			preguntasContestadasDesde(banco.db, { terminalId: banco.portatil, revision: 0 }).map((item) => item.tareaId),
			[ajena.id],
		);
		assert.deepEqual(preguntasContestadasDesde(banco.db, { terminalId, revision: 0 }), []);
	} finally {
		banco.cerrar();
	}
});

test("tomar una tarea de otro proyecto falla antes que cualquier otra comprobación", () => {
	const banco = montar();
	try {
		const { terminalId } = otroProyecto(banco);
		const ajena = tareaEn(banco, PROYECTO_PRINCIPAL, "Del principal");
		// En backlog: sin el corte del proyecto el error sería el del estado.
		assert.equal(
			codigoDe(() => tomarTarea(banco.db, { tareaId: ajena.id, fase: "analisis", terminalId })),
			"otro_proyecto",
		);
		moverTareaHumano(banco.db, { tareaId: ajena.id, usuarioId: banco.xinux, estado: "prepared" });
		assert.equal(
			codigoDe(() => tomarTarea(banco.db, { tareaId: ajena.id, fase: "ejecucion", terminalId })),
			"otro_proyecto",
		);
		// El terminal del proyecto sí la toma.
		assert.equal(
			tomarTarea(banco.db, { tareaId: ajena.id, fase: "analisis", terminalId: banco.portatil }).enMarchaTerminalId,
			banco.portatil,
		);
	} finally {
		banco.cerrar();
	}
});

// --- dependencias -------------------------------------------------------------

test("una dependencia no cruza de proyecto, venga por donde venga", () => {
	const banco = montar();
	try {
		const { proyectoId, terminalId } = otroProyecto(banco);
		const ajena = tareaEn(banco, PROYECTO_PRINCIPAL, "Del principal");
		const suya = tareaEn(banco, proyectoId, "De la web");

		// Al crear la tarea con dependencias.
		assert.equal(
			codigoDe(() =>
				crearTareaHumana(banco.db, {
					titulo: "Otra de la web",
					descripcion: "d",
					usuarioId: banco.xinux,
					proyectoId,
					dependeDe: [ajena.id],
				}),
			),
			"dependencia_otro_proyecto",
		);

		// Al fijarlas después, en backlog.
		assert.equal(
			codigoDe(() => fijarDependencias(banco.db, { tareaId: suya.id, dependeDe: [ajena.id], actor: ACTOR })),
			"dependencia_otro_proyecto",
		);

		// Y al crear una parte que depende de una tarea de fuera.
		const evolutivo = crearTareaHumana(banco.db, {
			titulo: "Un evolutivo",
			descripcion: "d",
			usuarioId: banco.xinux,
			proyectoId,
			tipo: "funcionalidad",
		});
		moverTareaHumano(banco.db, { tareaId: evolutivo.id, usuarioId: banco.xinux, estado: "prepared" });
		tomarTarea(banco.db, { tareaId: evolutivo.id, fase: "analisis", terminalId });
		const primera = crearParte(banco.db, { titulo: "Una", descripcion: "d", padreId: evolutivo.id, terminalId });
		assert.equal(
			codigoDe(() =>
				crearParte(banco.db, {
					titulo: "Otra",
					descripcion: "d",
					padreId: evolutivo.id,
					terminalId,
					dependeDe: [ajena.id],
				}),
			),
			"dependencia_fuera_de_la_funcionalidad",
		);

		// Dentro del mismo proyecto siguen funcionando.
		const segunda = crearParte(banco.db, {
			titulo: "La segunda",
			descripcion: "d",
			padreId: evolutivo.id,
			terminalId,
			dependeDe: [primera.id],
		});
		assert.deepEqual(dependenciasDe(banco.db, segunda.id), [primera.id]);
	} finally {
		banco.cerrar();
	}
});

// --- cambiar una tarea de proyecto --------------------------------------------

test("una tarea suelta cambia de proyecto en backlog y pierde sus terminales", () => {
	const banco = montar();
	try {
		const { proyectoId } = otroProyecto(banco);
		const tarea = crearTareaHumana(banco.db, {
			titulo: "Se muda",
			descripcion: "d",
			usuarioId: banco.xinux,
			analisisTerminalId: banco.portatil,
			ejecucionTerminalId: banco.portatil,
		});
		const mudada = editarTareaBacklog(banco.db, {
			tareaId: tarea.id,
			usuarioId: banco.xinux,
			titulo: "Se muda",
			descripcion: "d",
			tipo: "tarea",
			proyectoId,
			autoejecucion: true,
			analisisModelo: "sonnet",
			analisisTerminalId: banco.portatil,
			ejecucionModelo: "opus",
			ejecucionTerminalId: banco.portatil,
		});
		assert.equal(mudada.proyectoId, proyectoId);
		// Un terminal es de un solo proyecto: las asignaciones se caen.
		assert.equal(mudada.analisisTerminalId, null);
		assert.equal(mudada.ejecucionTerminalId, null);
		assert.equal(mudada.analisisModelo, "sonnet");
		const rastro = actividadDe(banco.db, "tarea", tarea.id).at(-1);
		assert.equal(rastro?.accion, "editar_tarea");
		assert.match(String(rastro?.detalle), /proyecto: PRI → WEB/);
	} finally {
		banco.cerrar();
	}
});

test("una tarea con padre, con hijas o con dependencias no cambia de proyecto", () => {
	const banco = montar();
	try {
		const { proyectoId } = otroProyecto(banco);
		const evolutivo = crearTareaHumana(banco.db, {
			titulo: "Un evolutivo",
			descripcion: "d",
			usuarioId: banco.xinux,
			tipo: "funcionalidad",
		});
		const parte = crearTareaHumana(banco.db, {
			titulo: "Una parte",
			descripcion: "d",
			usuarioId: banco.xinux,
			padreId: evolutivo.id,
		});
		const suelta = crearTareaHumana(banco.db, { titulo: "Suelta", descripcion: "d", usuarioId: banco.xinux });

		const mudanza = (tareaId: number, titulo: string) => () =>
			editarTareaBacklog(banco.db, {
				tareaId,
				usuarioId: banco.xinux,
				titulo,
				descripcion: "d",
				tipo: "tarea",
				proyectoId,
				autoejecucion: true,
				analisisModelo: null,
				analisisTerminalId: null,
				ejecucionModelo: null,
				ejecucionTerminalId: null,
			});

		// Una parte vive donde su funcionalidad.
		assert.equal(codigoDe(mudanza(parte.id, "Una parte")), "no_cambia_de_proyecto");
		// Una madre se llevaría a sus hijas por delante.
		assert.equal(
			codigoDe(() =>
				editarTareaBacklog(banco.db, {
					tareaId: evolutivo.id,
					usuarioId: banco.xinux,
					titulo: "Un evolutivo",
					descripcion: "d",
					tipo: "funcionalidad",
					proyectoId,
					autoejecucion: true,
					analisisModelo: null,
					analisisTerminalId: null,
					ejecucionModelo: null,
					ejecucionTerminalId: null,
				}),
			),
			"no_cambia_de_proyecto",
		);
		// Y una dependencia, en cualquiera de los dos sentidos, la ata.
		fijarDependencias(banco.db, { tareaId: suelta.id, dependeDe: [parte.id], actor: ACTOR });
		assert.equal(codigoDe(mudanza(suelta.id, "Suelta")), "no_cambia_de_proyecto");
		fijarDependencias(banco.db, { tareaId: suelta.id, dependeDe: [], actor: ACTOR });
		fijarDependencias(banco.db, { tareaId: parte.id, dependeDe: [suelta.id], actor: ACTOR });
		assert.equal(codigoDe(mudanza(suelta.id, "Suelta")), "no_cambia_de_proyecto");
	} finally {
		banco.cerrar();
	}
});

// --- reordenar dentro del tablero de un proyecto ------------------------------

test("reordenar entre las tareas de un proyecto no adelanta a las de otro", () => {
	const banco = montar();
	try {
		const { proyectoId } = otroProyecto(banco);
		const ids = [
			tareaEn(banco, PROYECTO_PRINCIPAL, "Principal A"),
			tareaEn(banco, proyectoId, "Web 1"),
			tareaEn(banco, PROYECTO_PRINCIPAL, "Principal B"),
			tareaEn(banco, proyectoId, "Web 2"),
			tareaEn(banco, proyectoId, "Web 3"),
		].map((tarea) => tarea.id);
		const titulos = () => listarTareas(banco.db, { estado: "backlog" }).map((item) => item.titulo);
		assert.deepEqual(titulos(), ["Principal A", "Web 1", "Principal B", "Web 2", "Web 3"]);

		// Soltar arriba del tablero del proyecto es ponerse delante de la primera
		// del proyecto, no de toda la columna.
		reordenar(banco.db, { tareaId: ids[4] ?? 0, orden: 1, entre: { proyectoId } });
		assert.deepEqual(titulos(), ["Principal A", "Web 3", "Web 1", "Principal B", "Web 2"]);

		// Con dos vecinas hay tres sitios: el cuarto no existe.
		assert.equal(
			codigoDe(() => reordenar(banco.db, { tareaId: ids[1] ?? 0, orden: 4, entre: { proyectoId } })),
			"orden_invalido",
		);
		// Y sin ámbito la posición sigue siendo la de la columna entera.
		reordenar(banco.db, { tareaId: ids[1] ?? 0, orden: 1 });
		assert.deepEqual(titulos(), ["Web 1", "Principal A", "Web 3", "Principal B", "Web 2"]);
	} finally {
		banco.cerrar();
	}
});

// --- bajas --------------------------------------------------------------------

test("borrar un terminal o un usuario sigue funcionando con proyectos de por medio", () => {
	const banco = montar();
	try {
		const { proyectoId, terminalId } = otroProyecto(banco);
		const tarea = crearTareaHumana(banco.db, {
			titulo: "De la web",
			descripcion: "d",
			usuarioId: banco.xinux,
			proyectoId,
			analisisTerminalId: terminalId,
		});
		borrarTerminal(banco.db, terminalId, banco.xinux);
		// La tarea se queda donde estaba, sin terminal: cualquiera del proyecto la toma.
		const suelta = leerTarea(banco.db, tarea.id);
		assert.equal(suelta?.tarea.proyectoId, proyectoId);
		assert.equal(suelta?.tarea.analisisTerminalId, null);

		// Y el usuario se borra igual, mientras quede otro y no tenga terminales.
		const { valor: otro } = crearUsuario(banco.db, "otro", "hash");
		borrarTerminal(banco.db, banco.portatil, banco.xinux);
		borrarTerminal(banco.db, banco.sobremesa, banco.xinux);
		assert.equal(borrarUsuario(banco.db, otro.id, banco.xinux).nombre, "otro");
	} finally {
		banco.cerrar();
	}
});
