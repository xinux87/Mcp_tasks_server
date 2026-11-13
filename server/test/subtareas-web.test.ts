import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Hono } from "hono";
import { crearApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { crearTerminalConToken } from "../src/auth/tokens.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { actividadDe } from "../src/db/actividad.ts";
import { crearUsuario } from "../src/db/consultas.ts";
import { crearParte } from "../src/db/funcionalidades.ts";
import { comentarAnalisis, comentarResultado } from "../src/db/hilo.ts";
import {
	aprobarEjecucion,
	crearTareaHumana,
	exigirTarea,
	leerTarea,
	moverTareaHumano,
	type Tarea,
	tomarTarea,
} from "../src/db/tareas.ts";
import { BASE_URL_PRUEBA, CONFIG_PRUEBA } from "./comun.ts";

type Montaje = {
	db: DatabaseSync;
	app: Hono;
	terminalId: number;
	cerrar: () => Promise<void>;
};

/** Base en memoria con un usuario y un terminal, y la app entera montada, sin abrir puerto. */
function montar(): Montaje {
	const db = abrirBaseDeDatos(":memory:");
	const { valor: usuario } = crearUsuario(db, "ana", hashPassword("secreta"));
	const { valor } = crearTerminalConToken(db, usuario.id, "portatil-ana", "ana@ejemplo.com");
	const { app, cerrar } = crearApp({ db, config: CONFIG_PRUEBA });
	return {
		db,
		app,
		terminalId: valor.terminal.id,
		cerrar: async () => {
			await cerrar();
			db.close();
		},
	};
}

/** Petición contra la app en memoria, con la cabecera `Host` que exige la protección de DNS rebinding. */
async function pedir(
	montaje: Montaje,
	ruta: string,
	cookie?: string,
	formulario?: Record<string, string>,
): Promise<Response> {
	const url = new URL(ruta, BASE_URL_PRUEBA);
	const peticion = new Request(
		url,
		formulario === undefined
			? {}
			: {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams(formulario).toString(),
				},
	);
	peticion.headers.set("host", url.host);
	if (cookie !== undefined) {
		peticion.headers.set("cookie", cookie);
	}
	return await montaje.app.fetch(peticion);
}

async function entrar(montaje: Montaje): Promise<string> {
	const respuesta = await pedir(montaje, "/login", undefined, { usuario: "ana", password: "secreta", volver: "/" });
	assert.equal(respuesta.status, 302);
	return (respuesta.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function ficha(montaje: Montaje, cookie: string, tarea: Tarea): Promise<string> {
	return await (await pedir(montaje, `/tareas/${tarea.codigo}`, cookie)).text();
}

/** Una tarea normal, con las dos fases en el terminal de la prueba. */
function tarea(montaje: Montaje, titulo: string, tipo: "tarea" | "pregunta" | "funcionalidad" = "tarea"): Tarea {
	return crearTareaHumana(montaje.db, {
		titulo,
		descripcion: "d",
		usuarioId: 1,
		tipo,
		analisisModelo: "sonnet",
		analisisTerminalId: montaje.terminalId,
		ejecucionModelo: "opus",
		ejecucionTerminalId: montaje.terminalId,
	});
}

const FORMULARIO_SUBTAREA =
	/<form class="anadir-subtarea" method="post" action="\/tareas\/US[0-9A-F]+\/subtareas">\s*<input type="text" name="titulo" required/;

test("«Añadir subtarea» cuelga una parte con solo el título y la ficha pasa a ser el tablero de sus subtareas", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const madre = tarea(montaje, "Rehacer la exportación");
		const id = madre.codigo;

		const antes = await ficha(montaje, cookie, madre);
		assert.match(antes, /<h2>Subtareas<\/h2>\s*<p class="silencio">Ninguna\.<\/p>\s*<form class="anadir-subtarea"/);
		assert.match(antes, FORMULARIO_SUBTAREA);

		const respuesta = await pedir(montaje, `/tareas/${id}/subtareas`, cookie, { titulo: "Sacar los datos" });
		assert.equal(respuesta.status, 302);
		assert.equal(respuesta.headers.get("location"), `/tareas/${id}`);
		const [sub] = leerTarea(montaje.db, madre.id)?.hijas ?? [];
		assert.ok(sub !== undefined);
		const creada = exigirTarea(montaje.db, sub.id);
		assert.equal(creada.titulo, "Sacar los datos");
		assert.equal(creada.descripcion, "");
		assert.equal(creada.estado, "backlog");
		assert.equal(creada.clase, "parte");
		assert.equal(creada.ejecucionModelo, "opus");
		assert.deepEqual(
			actividadDe(montaje.db, "tarea", creada.id).map((fila) => fila.accion),
			["crear_tarea"],
		);

		// El título vacío no se guarda.
		const vacia = await pedir(montaje, `/tareas/${id}/subtareas`, cookie, { titulo: "  " });
		assert.equal(vacia.status, 422);
		assert.match(await vacia.text(), /La tarea necesita un título\./);

		// Con una subtarea ya es su tablero; con una sola no hay orden que enseñar.
		const con1 = await ficha(montaje, cookie, madre);
		assert.match(con1, /<h2>Subtareas 0\/1 <progress class="progreso" value="0" max="1"><\/progress><\/h2>/);
		assert.match(con1, new RegExp(`<section id="tablero" class="tablero"[^>]* data-padre="${id}"`));
		assert.doesNotMatch(con1, /Orden de ejecución/);
		assert.doesNotMatch(con1, />Hijas/);

		await pedir(montaje, `/tareas/${id}/subtareas`, cookie, { titulo: "Poner el botón" });
		const con2 = await ficha(montaje, cookie, madre);
		assert.match(
			con2,
			/<h2>Orden de ejecución<\/h2>\s*<p class="silencio">Lo que está en la misma ola puede ir a la vez\.<\/p>/,
		);
		assert.match(con2, /<ol class="olas">\s*<li>\s*<span class="rotulo-ola">Ola 1<\/span>/);
		assert.doesNotMatch(con2, /Ola 2/);

		// La subtarea dice de quién es en la tarjeta del tablero: `subtareas 0/2`.
		const lista = await (await pedir(montaje, "/tareas?agrupar=no", cookie)).text();
		assert.match(lista, /<span class="progreso-texto">subtareas 0\/2<\/span>/);
		// Y una tarea con subtareas no es un carril del tablero: eso es de las funcionalidades.
		const kanban = await (await pedir(montaje, "/tareas/kanban", cookie)).text();
		assert.doesNotMatch(kanban, new RegExp(`<section class="franja" data-padre="${id}"`));
	} finally {
		await montaje.cerrar();
	}
});

test("no se añaden subtareas a una pregunta, a una tarea cerrada ni a una que un agente está ejecutando", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const pregunta = tarea(montaje, "¿Cuánto cuesta?", "pregunta");
		assert.doesNotMatch(await ficha(montaje, cookie, pregunta), FORMULARIO_SUBTAREA);
		const contraPregunta = await pedir(montaje, `/tareas/${pregunta.codigo}/subtareas`, cookie, {
			titulo: "X",
		});
		assert.equal(contraPregunta.status, 422);

		// En curso con la ejecución tomada: el formulario se ve, pero el servidor lo frena.
		const enCurso = tarea(montaje, "En curso");
		const { terminalId } = montaje;
		moverTareaHumano(montaje.db, { tareaId: enCurso.id, usuarioId: 1, estado: "prepared" });
		tomarTarea(montaje.db, { tareaId: enCurso.id, fase: "analisis", terminalId });
		comentarAnalisis(montaje.db, { tareaId: enCurso.id, terminalId, texto: "plan" });
		tomarTarea(montaje.db, { tareaId: enCurso.id, fase: "ejecucion", terminalId });
		assert.match(await ficha(montaje, cookie, enCurso), FORMULARIO_SUBTAREA);
		const ocupada = await pedir(montaje, `/tareas/${enCurso.codigo}/subtareas`, cookie, { titulo: "X" });
		assert.equal(ocupada.status, 422);
		assert.match(await ocupada.text(), /Un agente está trabajando esta tarea ahora mismo/);

		comentarResultado(montaje.db, { tareaId: enCurso.id, terminalId, texto: "Hecho." });
		moverTareaHumano(montaje.db, { tareaId: enCurso.id, usuarioId: 1, estado: "finished" });
		assert.doesNotMatch(await ficha(montaje, cookie, enCurso), FORMULARIO_SUBTAREA);
		const cerrada = await pedir(montaje, `/tareas/${enCurso.codigo}/subtareas`, cookie, { titulo: "X" });
		assert.equal(cerrada.status, 422);
		assert.equal(leerTarea(montaje.db, enCurso.id)?.hijas.length, 0);
		assert.equal(leerTarea(montaje.db, pregunta.id)?.hijas.length, 0);
	} finally {
		await montaje.cerrar();
	}
});

test("una tarea descompuesta se aprueba como una funcionalidad, en la ficha y en la bandeja, y pinta sus olas", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const { terminalId } = montaje;
		const madre = tarea(montaje, "Rehacer la exportación");
		moverTareaHumano(montaje.db, { tareaId: madre.id, usuarioId: 1, estado: "prepared" });
		tomarTarea(montaje.db, { tareaId: madre.id, fase: "analisis", terminalId });
		const parte = (titulo: string, dependeDe: number[] = []) =>
			crearParte(montaje.db, { titulo, descripcion: "d", padreId: madre.id, terminalId, dependeDe });
		const datos = parte("Sacar los datos");
		const boton = parte("Poner el botón", [datos.id]);
		parte("Probarlo todo", [datos.id, boton.id]);
		comentarAnalisis(montaje.db, { tareaId: madre.id, terminalId, texto: "Plan de conjunto." });

		const lista = await ficha(montaje, cookie, madre);
		assert.match(lista, /<button type="submit" class="principal">Aprobar descomposición<\/button>/);
		assert.match(lista, /<span class="paso-ahora">Revisa las subtareas<\/span>/);
		assert.match(lista, /<h2>Subtareas 0\/3 /);
		// Su tablero no repite el proyecto en cada tarjeta: ya lo dice el panel.
		const tableroDeLaFicha = lista.slice(lista.indexOf('<section id="tablero"'), lista.indexOf('<ol class="olas">'));
		assert.match(tableroDeLaFicha, /Sacar los datos/);
		assert.ok(!tableroDeLaFicha.includes("insignia proyecto"), "el tablero de la ficha pinta el chip de proyecto");
		// Tres olas, cada una con su parte, en orden.
		const olas = lista.slice(lista.indexOf('<ol class="olas">'));
		const posiciones = ["Ola 1", "Sacar los datos", "Ola 2", "Poner el botón", "Ola 3", "Probarlo todo"].map((texto) =>
			olas.indexOf(texto),
		);
		assert.ok(
			posiciones.every((posicion, indice) => posicion > (posiciones[indice - 1] ?? -1)),
			`las olas no van en orden: ${posiciones.join(", ")}`,
		);
		assert.match(
			olas,
			/<li class="parte-ola"><div class="fila-tarea">\s*<span class="estado-fila"><span class="punto estado-backlog[\s\S]*?<a class="id-tarea" href="\/tareas\/US[0-9A-F]+">US[0-9A-F]+<\/a>\s*<span class="titulo">Sacar los datos<\/span>/,
		);

		// En la bandeja, «Aprueba» enseña sus partes bajo el análisis.
		const bandeja = await (await pedir(montaje, "/", cookie)).text();
		assert.match(bandeja, /Aprobar descomposición/);
		assert.match(bandeja, /<ul class="filas hijas">[\s\S]*Sacar los datos[\s\S]*Probarlo todo[\s\S]*<\/ul>/);

		aprobarEjecucion(montaje.db, { tareaId: madre.id, usuarioId: 1 });
		const enCurso = await ficha(montaje, cookie, madre);
		assert.match(enCurso, /<span class="paso-ahora">Las subtareas se están trabajando<\/span>/);
	} finally {
		await montaje.cerrar();
	}
});

test("el campo «Subtarea de» lista las tareas abiertas que no son preguntas, y la funcionalidad titula «Tareas»", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const madre = tarea(montaje, "Una tarea madre");
		tarea(montaje, "¿Una pregunta?", "pregunta");
		const evolutivo = tarea(montaje, "Un evolutivo", "funcionalidad");

		const alta = await (await pedir(montaje, "/tareas/nueva", cookie)).text();
		assert.match(alta, /<span>Subtarea de<\/span>\s*<select name="padre">\s*<option value="" selected>ninguna<\/option>/);
		assert.match(alta, new RegExp(`<option value="${madre.codigo}">`));
		assert.match(alta, new RegExp(`<option value="${evolutivo.codigo}">`));
		assert.doesNotMatch(alta, /¿Una pregunta\?<\/option>/);
		assert.doesNotMatch(alta, /Parte de la funcionalidad/);
		// El alta de una funcionalidad también lo lleva (el tipo se cambia en el
		// mismo formulario), pero una funcionalidad no cuelga de nada: 422 y el
		// formulario repintado con el mensaje.
		assert.match(
			await (await pedir(montaje, "/tareas/nueva?tipo=funcionalidad", cookie)).text(),
			/<span>Subtarea de<\/span>/,
		);
		const colgada = await pedir(montaje, "/tareas", cookie, {
			titulo: "Funcionalidad colgada",
			descripcion: "d",
			tipo: "funcionalidad",
			padre: madre.codigo,
			analisisTerminal: "",
			ejecucionTerminal: "",
		});
		assert.equal(colgada.status, 422);
		const repintado = await colgada.text();
		assert.match(repintado, /Una funcionalidad cuelga del proyecto, no de otra tarea\./);
		assert.match(repintado, /value="Funcionalidad colgada"/);

		// En la edición no se ofrece la propia tarea.
		const edicion = await ficha(montaje, cookie, madre);
		assert.doesNotMatch(edicion, new RegExp(`<option value="${madre.codigo}"`));

		// Una funcionalidad titula su bloque «Tareas» y también deja añadir.
		const deLaFuncionalidad = await ficha(montaje, cookie, evolutivo);
		assert.match(deLaFuncionalidad, /<h2>Tareas<\/h2>/);
		assert.doesNotMatch(deLaFuncionalidad, /<h2>Subtareas/);
		assert.match(deLaFuncionalidad, /<button type="submit">Añadir tarea<\/button>/);
	} finally {
		await montaje.cerrar();
	}
});
