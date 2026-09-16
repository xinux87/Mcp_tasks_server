import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Hono } from "hono";
import { crearApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { crearTerminalConToken } from "../src/auth/tokens.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { crearUsuario } from "../src/db/consultas.ts";
import { dependenciasDe } from "../src/db/dependencias.ts";
import { comentarAnalisis, comentarResultado } from "../src/db/hilo.ts";
import { buscarTarea, exigirTarea, idDeCodigo, moverTareaHumano, tomarTarea } from "../src/db/tareas.ts";
import { formatearId, parsearId } from "../src/md/ids.ts";
import { BASE_URL_PRUEBA, CONFIG_PRUEBA } from "./comun.ts";

/**
 * La web de las funcionalidades: crearlas con su rama, colgarles partes,
 * encadenarlas con dependencias, revisar la descomposición en su propio
 * tablero, aprobarla y podar lo que sobre. Todas las reglas son de `src/db/`:
 * aquí se comprueba lo que el humano ve y lo que puede pulsar.
 */

type Montaje = {
	db: DatabaseSync;
	app: Hono;
	cerrar: () => Promise<void>;
};

/** Base en memoria con un usuario y un terminal, y la app entera sin abrir puerto. */
function montar(): Montaje {
	const db = abrirBaseDeDatos(":memory:");
	crearUsuario(db, "ana", hashPassword("secreta"));
	crearTerminalConToken(db, 1, "portatil-ana", "ana@ejemplo.com");
	const { app, cerrar } = crearApp({ db, config: CONFIG_PRUEBA });
	return {
		db,
		app,
		cerrar: async () => {
			await cerrar();
			db.close();
		},
	};
}

type Opciones = {
	cookie?: string;
	formulario?: Record<string, string> | URLSearchParams;
};

/** Petición contra la app en memoria, con la cabecera `Host` que exige Hono. */
async function pedir(montaje: Montaje, ruta: string, opciones: Opciones = {}): Promise<Response> {
	const url = new URL(ruta, BASE_URL_PRUEBA);
	const inicio: RequestInit =
		opciones.formulario === undefined
			? {}
			: {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams(opciones.formulario).toString(),
				};
	const peticion = new Request(url, inicio);
	peticion.headers.set("host", url.host);
	if (opciones.cookie !== undefined) {
		peticion.headers.set("cookie", opciones.cookie);
	}
	return await montaje.app.fetch(peticion);
}

/** Entra con el usuario de prueba y devuelve su cookie de sesión. */
async function entrar(montaje: Montaje): Promise<string> {
	const respuesta = await pedir(montaje, "/login", {
		formulario: { usuario: "ana", password: "secreta", volver: "/tareas" },
	});
	assert.equal(respuesta.status, 302);
	const primera = (respuesta.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
	assert.ok(primera.startsWith("sesion="), `la cookie no se llama sesion: ${primera}`);
	return primera;
}

/** El cuerpo de un GET que tiene que responder 200. */
async function ver(montaje: Montaje, cookie: string, ruta: string): Promise<string> {
	const respuesta = await pedir(montaje, ruta, { cookie });
	assert.equal(respuesta.status, 200, ruta);
	return await respuesta.text();
}

/** Alta desde el formulario. Devuelve el identificador visible de lo creado. */
async function crear(montaje: Montaje, cookie: string, campos: Record<string, string>): Promise<string> {
	const respuesta = await pedir(montaje, "/tareas", {
		cookie,
		formulario: { descripcion: "Lo que sea.", analisisTerminal: "", ejecucionTerminal: "", ...campos },
	});
	assert.equal(respuesta.status, 302);
	const destino = respuesta.headers.get("location") ?? "";
	assert.match(destino, /^\/tareas\/T-[0-9A-Z]{4,8}$/);
	return destino.slice("/tareas/".length);
}

/** Trabaja una parte hasta dejarla aceptada, como harían el agente y el humano. */
function cerrarParte(db: DatabaseSync, tareaId: number): void {
	tomarTarea(db, { tareaId, fase: "analisis", terminalId: 1, modelo: "sonnet" });
	comentarAnalisis(db, { tareaId, terminalId: 1, texto: "Plan de la parte." });
	tomarTarea(db, { tareaId, fase: "ejecucion", terminalId: 1, modelo: "opus" });
	comentarResultado(db, { tareaId, terminalId: 1, texto: "Hecho. Commit: a1b2c3d" });
	moverTareaHumano(db, { tareaId, usuarioId: 1, estado: "finished" });
}

/** El número de fila de una tarea a partir de su identificador visible. */
function filaDe(montaje: Montaje, id: string): number {
	return idDeCodigo(montaje.db, parsearId(id));
}

/** El identificador visible de la tarea que ocupa esa fila. */
function idFila(montaje: Montaje, fila: number): string {
	return formatearId(exigirTarea(montaje.db, fila).codigo);
}

test("una funcionalidad se crea con su rama y sale en su propia lista", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const id = await crear(montaje, cookie, {
			titulo: "Que los comerciales se bajen sus listados",
			tipo: "funcionalidad",
			rama: "evolutivo/csv",
			analisisModelo: "sonnet",
			ejecucionModelo: "opus",
		});
		assert.equal(id, idFila(montaje, 1));
		const creada = exigirTarea(montaje.db, 1);
		assert.equal(creada.tipo, "funcionalidad");
		assert.equal(creada.rama, "evolutivo/csv");

		const ficha = await ver(montaje, cookie, `/tareas/${id}`);
		assert.match(ficha, /<span class="insignia tipo-funcionalidad color-azul">Funcionalidad<\/span>/);
		assert.match(ficha, /<dt>Rama<\/dt>\s*<dd><code>evolutivo\/csv<\/code><\/dd>/);
		// Sin partes todavía no hay barra que pintar: se dice y ya está.
		assert.match(ficha, /<dt>Partes<\/dt>\s*<dd><span class="silencio">ninguna<\/span><\/dd>/);
		assert.match(ficha, /<dt>Consumo de las partes<\/dt>/);
		// Su ficha es su tablero, y encima está el alta de una parte.
		assert.match(ficha, /<h2>Partes<\/h2>/);
		assert.match(
			ficha,
			new RegExp(`<a class="boton" href="\\/tareas\\/nueva\\?padre=${idFila(montaje, 1)}">Nueva parte<\\/a>`),
		);
		assert.match(ficha, new RegExp(`data-fuente="\\/tareas\\/kanban\\/tablero\\?padre=${idFila(montaje, 1)}"`));

		const lista = await ver(montaje, cookie, "/funcionalidades");
		assert.match(lista, /<h1>Funcionalidades<\/h1>/);
		assert.match(lista, /<a class="boton principal" href="\/tareas\/nueva\?tipo=funcionalidad">Nueva funcionalidad<\/a>/);
		assert.match(lista, /Que los comerciales se bajen sus listados/);
		assert.match(lista, /<code>evolutivo\/csv<\/code>/);
		assert.ok(!lista.includes('class="progreso"'), "sin partes no hay barra de progreso");
		// Se refresca sola, como la lista de tareas.
		assert.match(lista, /<body data-vista="funcionalidades" data-revision="\d+">/);
		// La navegación lleva al proyecto que se está mirando, que sin cookie es el principal.
		assert.match(lista, /<a class="enlace-nav" href="\/p\/DEFAULT\/funcionalidades" aria-current="page">/);
	} finally {
		await montaje.cerrar();
	}
});

test("una parte creada desde la web hereda la rama y aparece en el tablero de su funcionalidad", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await crear(montaje, cookie, { titulo: "Listados para comerciales", tipo: "funcionalidad", rama: "evolutivo/csv" });
		const parte = await crear(montaje, cookie, {
			titulo: "Sacar los datos del listado",
			tipo: "tarea",
			padre: idFila(montaje, 1),
			autoejecucion: "on",
		});
		assert.equal(parte, idFila(montaje, 2));
		// La rama se hereda: la parte se trabaja donde se trabaja el evolutivo.
		assert.equal(exigirTarea(montaje.db, 2).rama, "evolutivo/csv");

		const ficha = await ver(montaje, cookie, `/tareas/${parte}`);
		assert.match(ficha, /<dt>Padre<\/dt>/);
		assert.match(
			ficha,
			new RegExp(
				`<span class="insignia estado-backlog color-gris">Por definir<\\/span> <a class="id-tarea" href="\\/tareas\\/${idFila(montaje, 1)}">${idFila(montaje, 1)}<\\/a> Listados para comerciales`,
			),
		);
		assert.match(ficha, /<dt>Rama<\/dt>\s*<dd><code>evolutivo\/csv<\/code><\/dd>/);

		// El tablero de la funcionalidad enseña la parte, y la cuenta ya es 0/1.
		const tablero = await ver(montaje, cookie, `/tareas/${idFila(montaje, 1)}`);
		assert.match(tablero, new RegExp(`data-id="${idFila(montaje, 2)}"`));
		assert.match(tablero, /<span class="progreso-texto">partes 0\/1<\/span>/);

		// En la lista agrupada, la funcionalidad es la cabecera de su franja.
		const lista = await ver(montaje, cookie, "/tareas");
		assert.match(lista, new RegExp(`<section class="franja" data-padre="${idFila(montaje, 1)}">`));
		assert.match(
			lista,
			new RegExp(`<h2><a href="\\/tareas\\/${idFila(montaje, 1)}">Listados para comerciales<\\/a><\\/h2>`),
		);

		// Y por columnas, la parte lleva el enlace a su funcionalidad.
		const porColumnas = await ver(montaje, cookie, "/tareas?agrupar=no");
		assert.match(
			porColumnas,
			new RegExp(`<a class="parte-de" href="\\/tareas\\/${idFila(montaje, 1)}">Listados para comerciales<\\/a>`),
		);
		assert.match(porColumnas, /<span class="insignia tipo-funcionalidad color-azul">Funcionalidad 0\/1<\/span>/);
	} finally {
		await montaje.cerrar();
	}
});

test("las dependencias se editan en backlog y dejan la tarea esperando hasta que la otra está hecha", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const primera = await crear(montaje, cookie, { titulo: "Sacar los datos", tipo: "tarea", autoejecucion: "on" });
		const segunda = await crear(montaje, cookie, { titulo: "Poner el botón", tipo: "tarea", autoejecucion: "on" });

		const editada = await pedir(montaje, `/tareas/${segunda}/editar`, {
			cookie,
			formulario: {
				titulo: "Poner el botón",
				descripcion: "En la pantalla de clientes.",
				tipo: "tarea",
				rama: "",
				padre: "",
				dependeDe: primera,
				autoejecucion: "on",
				analisisTerminal: "",
				ejecucionTerminal: "",
			},
		});
		assert.equal(editada.status, 302);
		assert.deepEqual(dependenciasDe(montaje.db, 2), [exigirTarea(montaje.db, 1).codigo]);

		// La ficha las enseña con el estado de cada una, y en naranja las que
		// todavía frenan.
		const ficha = await ver(montaje, cookie, `/tareas/${segunda}`);
		assert.match(
			ficha,
			new RegExp(
				`<span class="insignia estado-backlog color-naranja">Por definir<\\/span> <a class="id-tarea" href="\\/tareas\\/${idFila(montaje, 1)}">${idFila(montaje, 1)}<\\/a>`,
			),
		);
		// Y el rastro cuenta lo que se fijó.
		assert.match(ficha, new RegExp(`dependencias: ${idFila(montaje, 1)}`));

		// En prepared, la marca «esperando» hasta que la otra esté hecha.
		await pedir(montaje, `/tareas/${segunda}/mover`, { cookie, formulario: { estado: "prepared" } });
		const esperando = await ver(montaje, cookie, `/tareas/${segunda}`);
		assert.match(esperando, /<span class="insignia marca-esperando color-naranja">Espera a otra tarea<\/span>/);
		// Y se puede filtrar por ella en la lista.
		assert.match(await ver(montaje, cookie, "/tareas?marca=esperando"), new RegExp(`${idFila(montaje, 2)}`));

		await pedir(montaje, `/tareas/${primera}/mover`, { cookie, formulario: { estado: "prepared" } });
		cerrarParte(montaje.db, 1);
		const suelta = await ver(montaje, cookie, `/tareas/${segunda}`);
		assert.doesNotMatch(suelta, /marca-esperando/);
		// Cerrada la dependencia, su etiqueta deja de ir en naranja.
		assert.match(suelta, /<span class="insignia estado-finished color-marron">Cerrada<\/span>/);
	} finally {
		await montaje.cerrar();
	}
});

test("la descomposición se aprueba desde la ficha y la funcionalidad se cierra con sus partes", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		// Sin rama: así no se crea la parte de integrar y las partes son las dos.
		await crear(montaje, cookie, {
			titulo: "Listados para comerciales",
			tipo: "funcionalidad",
			analisisModelo: "sonnet",
			ejecucionModelo: "opus",
		});
		await pedir(montaje, `/tareas/${idFila(montaje, 1)}/mover`, { cookie, formulario: { estado: "prepared" } });

		// El terminal de análisis la descompone: dos partes y su comentario.
		tomarTarea(montaje.db, { tareaId: 1, fase: "analisis", terminalId: 1, modelo: "sonnet" });
		const datos = await crear(montaje, cookie, {
			titulo: "Sacar los datos",
			tipo: "tarea",
			padre: idFila(montaje, 1),
			autoejecucion: "on",
		});
		const boton = await crear(montaje, cookie, {
			titulo: "Poner el botón",
			tipo: "tarea",
			padre: idFila(montaje, 1),
			dependeDe: datos,
			autoejecucion: "on",
		});
		comentarAnalisis(montaje.db, { tareaId: 1, terminalId: 1, texto: "Dos partes: los datos y el botón." });

		const listaParaAprobar = await ver(montaje, cookie, `/tareas/${idFila(montaje, 1)}`);
		assert.match(listaParaAprobar, /<span class="insignia marca-analisis-listo color-rosa">Por aprobar<\/span>/);
		assert.match(listaParaAprobar, /<button type="submit" class="principal">Aprobar descomposición<\/button>/);
		// Las partes están en backlog, que es donde el humano las poda.
		assert.equal(buscarTarea(montaje.db, 2)?.estado, "backlog");

		const aprobada = await pedir(montaje, `/tareas/${idFila(montaje, 1)}/aprobar`, { cookie, formulario: {} });
		assert.equal(aprobada.status, 302);
		assert.equal(exigirTarea(montaje.db, 1).estado, "doing");
		assert.equal(exigirTarea(montaje.db, 2).estado, "prepared");
		assert.equal(exigirTarea(montaje.db, 3).estado, "prepared");

		const enMarcha = await ver(montaje, cookie, "/funcionalidades");
		assert.match(enMarcha, /<span class="insignia estado-doing color-amarillo">En curso<\/span>/);
		assert.match(
			enMarcha,
			/<progress class="progreso" value="0" max="2"><\/progress><span class="progreso-texto">partes 0\/2<\/span>/,
		);
		// Una parte espera a la otra: eso es lo que frena la funcionalidad.
		assert.match(enMarcha, /<span class="insignia marca-esperando color-naranja">1 esperando a otra<\/span>/);

		cerrarParte(montaje.db, filaDe(montaje, datos));
		cerrarParte(montaje.db, filaDe(montaje, boton));

		// Cerrada la última parte, el servidor cierra la funcionalidad.
		assert.equal(exigirTarea(montaje.db, 1).estado, "done");
		const cerrada = await ver(montaje, cookie, "/funcionalidades");
		assert.match(cerrada, /<span class="progreso-texto">partes 2\/2<\/span>/);
		assert.match(cerrada, /<span class="insignia estado-done color-verde">Hecha<\/span>/);
		// La barra llena: el valor iguala al máximo.
		assert.match(cerrada, /<progress class="progreso" value="2" max="2"><\/progress>/);
	} finally {
		await montaje.cerrar();
	}
});

test("una tarea se borra con su confirmación esté en la columna que esté", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await crear(montaje, cookie, { titulo: "Listados para comerciales", tipo: "funcionalidad" });
		const parte = await crear(montaje, cookie, { titulo: "Parte que sobra", tipo: "tarea", padre: idFila(montaje, 1) });

		// El enlace vive en su propio bloque al final de la ficha.
		const ficha = await ver(montaje, cookie, `/tareas/${parte}`);
		assert.match(
			ficha,
			new RegExp(`<a class="accion-peligro" href="\\/tareas\\/${idFila(montaje, 2)}\\/borrar">Borrar esta tarea<\\/a>`),
		);

		const confirmacion = await ver(montaje, cookie, `/tareas/${parte}/borrar`);
		assert.match(confirmacion, /Parte que sobra/);
		assert.match(confirmacion, /No se puede deshacer/);
		assert.match(confirmacion, /<button type="submit" class="peligro">Sí, borrar<\/button>/);

		const borrada = await pedir(montaje, `/tareas/${parte}/borrar`, { cookie, formulario: {} });
		assert.equal(borrada.status, 302);
		// Una parte vuelve al tablero de su funcionalidad, de donde se podó.
		assert.equal(borrada.headers.get("location"), `/tareas/${idFila(montaje, 1)}`);
		assert.equal(buscarTarea(montaje.db, 2), undefined);
		assert.equal((await pedir(montaje, `/tareas/${parte}`, { cookie })).status, 404);

		// El rastro se queda, con quién lo hizo.
		const actividad = await ver(montaje, cookie, "/actividad");
		assert.match(actividad, /borró la tarea/);
		assert.match(actividad, /Parte que sobra/);

		// Fuera de backlog también se borra, y la ficha ofrece el enlace igual.
		const suelta = await crear(montaje, cookie, { titulo: "Ya en marcha", tipo: "tarea", autoejecucion: "on" });
		const sueltaId = filaDe(montaje, suelta);
		await crear(montaje, cookie, { titulo: "La que la espera", tipo: "tarea", dependeDe: suelta });
		await pedir(montaje, `/tareas/${suelta}/mover`, { cookie, formulario: { estado: "prepared" } });
		tomarTarea(montaje.db, { tareaId: sueltaId, fase: "analisis", terminalId: 1, modelo: "sonnet" });
		comentarAnalisis(montaje.db, { tareaId: sueltaId, terminalId: 1, texto: "Plan." });
		tomarTarea(montaje.db, { tareaId: sueltaId, fase: "ejecucion", terminalId: 1, modelo: "opus" });
		assert.match(
			await ver(montaje, cookie, `/tareas/${suelta}`),
			new RegExp(`<a class="accion-peligro" href="/tareas/${suelta}/borrar">`),
		);

		// La confirmación cuenta lo que se lleva por delante: el hilo, el terminal
		// que la está trabajando y quién deja de esperarla.
		const aviso = await ver(montaje, cookie, `/tareas/${suelta}/borrar`);
		assert.match(aviso, /Se va su hilo entero: 1 comentario/);
		assert.match(aviso, /la está trabajando portatil-ana/);
		assert.match(aviso, /Dejan de esperarla/);
		assert.match(aviso, /La que la espera/);

		const fuera = await pedir(montaje, `/tareas/${suelta}/borrar`, { cookie, formulario: {} });
		assert.equal(fuera.status, 302);
		assert.equal(buscarTarea(montaje.db, sueltaId), undefined);
	} finally {
		await montaje.cerrar();
	}
});

test("un título con etiquetas no se ejecuta en la lista de funcionalidades", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await crear(montaje, cookie, { titulo: '<script>alert("uy")</script>', tipo: "funcionalidad", rama: "<img src=x>" });
		const cuerpo = await ver(montaje, cookie, "/funcionalidades");
		assert.ok(!cuerpo.includes("<script>alert"), "dejó pasar una etiqueta script");
		assert.ok(!cuerpo.includes("<img src=x"), "dejó pasar una etiqueta img");
		assert.match(cuerpo, /&lt;script&gt;/);
		assert.doesNotMatch(cuerpo, /style="/);
	} finally {
		await montaje.cerrar();
	}
});
