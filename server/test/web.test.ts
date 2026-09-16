import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Hono } from "hono";
import { crearApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { buscarTerminalPorToken, crearTerminalConToken } from "../src/auth/tokens.ts";
import type { Config } from "../src/config.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { actividadDe } from "../src/db/actividad.ts";
import { listarTerminales, listarUsuarios } from "../src/db/admin.ts";
import { COLORES_USUARIO } from "../src/db/colores.ts";
import { crearUsuario, revisionActual } from "../src/db/consultas.ts";
import { registrarConsumo } from "../src/db/consumo.ts";
import { comentarAnalisis, comentarioDeAgente, comentarResultado, preguntar } from "../src/db/hilo.ts";
import {
	crearHija,
	crearPropuesta,
	crearTareaHumana,
	exigirTarea,
	leerTarea,
	moverTareaHumano,
	tomarTarea,
} from "../src/db/tareas.ts";
import { formatearId } from "../src/md/ids.ts";
import { type ConEdad, edadEnColumna } from "../src/web/componentes.ts";
import { edad, tokensAbreviados } from "../src/web/formatos.ts";
import { tarjetaPreguntaAbierta } from "../src/web/hilo.ts";
import { renderMarkdown } from "../src/web/markdown.ts";
import { BASE_URL_PRUEBA, CONFIG_PRUEBA } from "./comun.ts";

type Montaje = {
	db: DatabaseSync;
	app: Hono;
	cerrar: () => Promise<void>;
};

/** Base en memoria con un usuario, y la app entera montada, sin abrir puerto. */
function montar(config: Config = CONFIG_PRUEBA): Montaje {
	const db = abrirBaseDeDatos(":memory:");
	crearUsuario(db, "ana", hashPassword("secreta"));
	const { app, cerrar } = crearApp({ db, config });
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
	formulario?: Record<string, string>;
	cabeceras?: Record<string, string>;
};

/**
 * Petición contra la app en memoria. La cabecera `Host` la pone un cliente
 * real y `new Request(...)` no, y la protección contra DNS rebinding la exige.
 */
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
	for (const [nombre, valor] of Object.entries(opciones.cabeceras ?? {})) {
		peticion.headers.set(nombre, valor);
	}
	return await montaje.app.fetch(peticion);
}

/** La cookie `sesion` tal como se manda de vuelta, sin sus atributos. */
function cookieDeSesion(respuesta: Response): string {
	const bruto = respuesta.headers.get("set-cookie");
	assert.ok(bruto !== null, "se esperaba una cookie de sesión");
	const primera = bruto.split(";")[0] ?? "";
	assert.ok(primera.startsWith("sesion="), `la cookie no se llama sesion: ${primera}`);
	return primera;
}

/** Entra con el usuario de prueba y devuelve su cookie. */
async function entrar(montaje: Montaje): Promise<string> {
	const respuesta = await pedir(montaje, "/login", {
		formulario: { usuario: "ana", password: "secreta", volver: "/tareas" },
	});
	assert.equal(respuesta.status, 302);
	return cookieDeSesion(respuesta);
}

/**
 * El trozo de la lista que corresponde a un grupo de estado. Se busca por el
 * rótulo de la columna, que es la etiqueta del estado, el título y el contador.
 */
function grupo(cuerpo: string, titulo: string): string {
	const trozos = cuerpo.split('<section class="grupo">');
	const encontrado = trozos.find((trozo) => trozo.includes(`${titulo}</span> <span class="dueno"`));
	assert.ok(encontrado !== undefined, `no aparece el grupo «${titulo}»`);
	return encontrado;
}

/** El JSON de la statusline, tal como lo manda el plugin por `POST /api/uso`. */
async function reportarUso(montaje: Montaje, token: string, uso: unknown): Promise<Response> {
	const url = new URL("/api/uso", BASE_URL_PRUEBA);
	const peticion = new Request(url, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
		body: JSON.stringify(uso),
	});
	peticion.headers.set("host", url.host);
	return await montaje.app.fetch(peticion);
}

/** Crea una tarea desde la web y devuelve su identificador visible. */
async function crearTarea(montaje: Montaje, cookie: string, titulo: string, descripcion: string): Promise<string> {
	const respuesta = await pedir(montaje, "/tareas", {
		cookie,
		formulario: { titulo, descripcion, autoejecucion: "on", analisisTerminal: "", ejecucionTerminal: "" },
	});
	assert.equal(respuesta.status, 302);
	const destino = respuesta.headers.get("location") ?? "";
	assert.match(destino, /^\/tareas\/T-\d{4,}$/);
	return destino.slice("/tareas/".length);
}

test("sin sesión la web redirige al login, y el login exige la contraseña buena", async () => {
	const montaje = montar();
	try {
		const sinSesion = await pedir(montaje, "/tareas");
		assert.equal(sinSesion.status, 302);
		assert.equal(sinSesion.headers.get("location"), "/login?volver=%2Ftareas");

		const mala = await pedir(montaje, "/login", {
			formulario: { usuario: "ana", password: "otra", volver: "/tareas" },
		});
		assert.equal(mala.status, 401);
		assert.match(await mala.text(), /Usuario o contraseña incorrectos/);

		const buena = await pedir(montaje, "/login", {
			formulario: { usuario: "ana", password: "secreta", volver: "/tareas" },
		});
		assert.equal(buena.status, 302);
		assert.equal(buena.headers.get("location"), "/tareas");
		assert.match(cookieDeSesion(buena), /^sesion=/);

		// Con la cookie, la lista ya responde.
		const lista = await pedir(montaje, "/tareas", { cookie: cookieDeSesion(buena) });
		assert.equal(lista.status, 200);
	} finally {
		await montaje.cerrar();
	}
});

test("un POST marcado como cross-site se rechaza con 403", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const respuesta = await pedir(montaje, "/tareas", {
			cookie,
			formulario: { titulo: "Desde otro sitio", descripcion: "" },
			cabeceras: { "sec-fetch-site": "cross-site" },
		});
		assert.equal(respuesta.status, 403);
	} finally {
		await montaje.cerrar();
	}
});

test("crear una tarea la deja en backlog, en la lista y en su ficha", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const id = await crearTarea(montaje, cookie, "Exportar clientes a CSV", "Primera línea con **negrita**.");
		assert.equal(id, "T-0001");

		const lista = await pedir(montaje, "/tareas", { cookie });
		assert.equal(lista.status, 200);
		const cuerpoLista = await lista.text();
		// El grupo se encabeza con la etiqueta del estado, el título y el contador.
		assert.match(
			cuerpoLista,
			/<span class="insignia estado-backlog color-gris">Por definir<\/span> <span class="dueno">la defines tú<\/span> <span class="contador">1<\/span>/,
		);
		const backlog = grupo(cuerpoLista, "Por definir");
		assert.match(backlog, /T-0001/);
		// «Creada por» enseña el chip de quien la creó, con su color.
		assert.match(backlog, /<span class="chip color-\w+"><span class="inicial">A<\/span>ana<\/span>/);
		assert.match(grupo(cuerpoLista, "Preparadas"), /Ninguna\./);
		// La lista arranca con «cabeceraPagina» y su acción principal, y su tabla
		// ocupa todo el ancho como el kanban.
		assert.match(cuerpoLista, /<div class="dentro dentro-completo">/);
		assert.match(cuerpoLista, /<header class="cabecera-pagina">/);
		assert.match(cuerpoLista, /<a class="boton principal" href="\/p\/DEFAULT\/tareas\/nueva">Nueva tarea<\/a>/);
		// La fila de filtros no lleva desplegables ni enlace de quitarlos.
		const fila = cuerpoLista.slice(cuerpoLista.indexOf('<div class="fila-filtros">'), cuerpoLista.indexOf("</form>"));
		assert.ok(!fila.includes("<select"), "la fila de filtros no lleva desplegables");
		assert.doesNotMatch(cuerpoLista, /Quitar filtros/);
		// Pero un estado escrito en la dirección sigue filtrando.
		const soloPreparadas = await (await pedir(montaje, "/tareas?estado=prepared", { cookie })).text();
		assert.ok(!soloPreparadas.includes("T-0001"), "la tarea está en por definir, no en preparadas");

		const ficha = await pedir(montaje, "/tareas/T-0001", { cookie });
		assert.equal(ficha.status, 200);
		const cuerpoFicha = await ficha.text();
		assert.match(cuerpoFicha, /Exportar clientes a CSV/);
		// La descripción llega renderizada por markdown-it, no en crudo.
		assert.match(cuerpoFicha, /<strong>negrita<\/strong>/);
		assert.match(cuerpoFicha, /sin asignar/);
		// Migas «DEFAULT › Tareas › T-0001», con la última sin enlace.
		assert.match(cuerpoFicha, /<nav class="migas"[^>]*>\s*<a href="\/p\/DEFAULT\/tareas\/kanban">DEFAULT<\/a>/);
		assert.match(cuerpoFicha, /<a href="\/p\/DEFAULT\/tareas">Tareas<\/a>/);
		assert.match(cuerpoFicha, /<span>T-0001<\/span>/);
		// Las propiedades, y solo la transición hacia delante que toca.
		assert.match(cuerpoFicha, /<dt>Estado<\/dt>/);
		assert.match(cuerpoFicha, /<dt>Autoejecución<\/dt>\s*<dd>activada<\/dd>/);
		assert.match(cuerpoFicha, /<dt>Creada<\/dt>/);
		assert.match(cuerpoFicha, /Pasar a preparadas/);
		assert.doesNotMatch(cuerpoFicha, /Finalizar/);
		assert.match(cuerpoFicha, /<h2>Actividad<\/h2>/);
	} finally {
		await montaje.cerrar();
	}
});

test("el formulario de tarea abre como pregunta, con el tipo bajo el título y el proyecto fijo", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const nueva = await (await pedir(montaje, "/tareas/nueva", { cookie })).text();

		// Lo que más se pide es una pregunta: es lo que trae puesto.
		assert.match(nueva, /<option value="pregunta" selected>Pregunta<\/option>/);
		// Y el tipo va justo debajo del título, antes de la descripción: es la
		// decisión que cambia todo lo demás del formulario.
		const titulo = nueva.indexOf('<input type="text" name="titulo"');
		const tipo = nueva.indexOf('<select name="tipo">');
		const descripcion = nueva.indexOf('<textarea name="descripcion"');
		assert.ok(titulo > 0 && titulo < tipo && tipo < descripcion, "el tipo no va entre el título y la descripción");

		// El proyecto se enseña, no se elige.
		assert.ok(!nueva.includes('<select name="proyecto">'), "el proyecto no se elige");
		assert.match(nueva, /<p class="nombre-campo">Proyecto<\/p>/);
		assert.match(nueva, /<span class="insignia proyecto color-azul">DEFAULT<\/span>/);

		// Lo que se pide por la dirección manda sobre lo que trae puesto.
		const otra = await (await pedir(montaje, "/tareas/nueva?tipo=funcionalidad", { cookie })).text();
		assert.match(otra, /<option value="funcionalidad" selected>Funcionalidad<\/option>/);
	} finally {
		await montaje.cerrar();
	}
});

test("una pregunta se crea con su tipo, sale con badge y sin nada de ejecución", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const alta = await pedir(montaje, "/tareas", {
			cookie,
			formulario: {
				titulo: "¿Cuánto se tarda hoy en cerrar el mes?",
				descripcion: "Quiero saberlo antes de pedir nada.",
				tipo: "pregunta",
				analisisModelo: "sonnet",
				analisisTerminal: "",
				// Lo de ejecución llega del formulario anterior y se ignora.
				ejecucionModelo: "opus",
				ejecucionTerminal: "",
			},
		});
		assert.equal(alta.status, 302);
		const tarea = exigirTarea(montaje.db, 1);
		assert.equal(tarea.tipo, "pregunta");
		assert.equal(tarea.ejecucionModelo, null);

		const ficha = await pedir(montaje, "/tareas/T-0001", { cookie });
		assert.equal(ficha.status, 200);
		const cuerpo = await ficha.text();
		assert.match(cuerpo, /<span class="insignia tipo-pregunta color-rosa">Pregunta<\/span>/);
		// Las propiedades de una pregunta llevan Tipo y no llevan ejecución.
		assert.match(cuerpo, /<dt>Tipo<\/dt>/);
		assert.doesNotMatch(cuerpo, /<dt>Ejecución<\/dt>/);
		assert.doesNotMatch(cuerpo, /<dt>Autoejecución<\/dt>/);
		// El formulario sí la lleva, escondida por la hoja: es lo que hace que
		// cambiar el tipo a tarea la enseñe sin recargar ni JavaScript.
		assert.match(cuerpo, /name="ejecucionModelo"/);
		// El desplegable de tipo vuelve con la pregunta elegida.
		assert.match(cuerpo, /<option value="pregunta" selected>Pregunta<\/option>/);
		// Y en la lista, su columna de ejecución queda vacía.
		const lista = await (await pedir(montaje, "/tareas", { cookie })).text();
		assert.match(lista, /<th>Creada por<\/th>/);
		assert.match(lista, /<td class="pequeno">—<\/td>/);

		// El kanban la marca igual en su tarjeta.
		const kanban = await pedir(montaje, "/tareas/kanban", { cookie });
		assert.match(await kanban.text(), /<span class="insignia tipo-pregunta color-rosa">Pregunta<\/span>/);
	} finally {
		await montaje.cerrar();
	}
});

test("mover una tarea: a prepared y de vuelta a backlog, que exige nota", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const id = await crearTarea(montaje, cookie, "Migrar el envío de correos", "Lo que sea.");

		const aPrepared = await pedir(montaje, `/tareas/${id}/mover`, { cookie, formulario: { estado: "prepared" } });
		assert.equal(aPrepared.status, 302);
		const enPrepared = await pedir(montaje, `/tareas/${id}`, { cookie });
		// La clase de estado es el gancho; el color va siempre en la última clase.
		assert.match(await enPrepared.text(), /<span class="insignia estado-prepared color-azul">Preparada<\/span>/);

		const sinNota = await pedir(montaje, `/tareas/${id}/mover`, { cookie, formulario: { estado: "backlog", nota: "" } });
		assert.equal(sinNota.status, 422);
		assert.match(await sinNota.text(), /es una vuelta atrás: hace falta un comentario/);

		const conNota = await pedir(montaje, `/tareas/${id}/mover`, {
			cookie,
			formulario: { estado: "backlog", nota: "Falta decidir el formato." },
		});
		assert.equal(conNota.status, 302);
		const vuelta = await pedir(montaje, `/tareas/${id}`, { cookie });
		const cuerpo = await vuelta.text();
		assert.match(cuerpo, /<span class="insignia estado-backlog color-gris">Por definir<\/span>/);
		assert.match(cuerpo, /Falta decidir el formato\./);
		assert.match(cuerpo, /class="insignia tipo-comentario color-gris"/);
	} finally {
		await montaje.cerrar();
	}
});

test("una pregunta abierta se contesta desde la ficha, y solo una vez", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const id = await crearTarea(montaje, cookie, "Exportar clientes", "Hace falta un CSV.");
		await pedir(montaje, `/tareas/${id}/mover`, { cookie, formulario: { estado: "prepared" } });

		// El agente, contra la base de datos directamente.
		const { valor } = crearTerminalConToken(montaje.db, 1, "portatil-ana", "ana@ejemplo.com");
		const terminalId = valor.terminal.id;
		tomarTarea(montaje.db, { tareaId: 1, fase: "analisis", terminalId });
		comentarAnalisis(montaje.db, { tareaId: 1, terminalId, texto: "Hay que añadir un botón al listado." });
		preguntar(montaje.db, {
			tareaId: 1,
			terminalId,
			pregunta: "¿Qué separador usamos en el CSV?",
			porQueImporta: "La hoja de cálculo de los comerciales está en español.",
			opciones: [
				{ texto: "Punto y coma", consecuencia: "Se abre directamente en su hoja de cálculo." },
				{ texto: "No hacer nada", consecuencia: "Siguen copiando a mano." },
			],
			recomendacion: "Punto y coma",
		});

		const conPregunta = await pedir(montaje, `/tareas/${id}`, { cookie });
		const cuerpo = await conPregunta.text();
		assert.match(cuerpo, /action="\/tareas\/T-0001\/responder\/P1"/);
		assert.match(cuerpo, /value="Punto y coma"/);
		assert.match(cuerpo, /class="insignia marca-bloqueada color-rojo"/);

		const respuesta = await pedir(montaje, `/tareas/${id}/responder/P1`, {
			cookie,
			formulario: { opcion: "Punto y coma", nota: "Si lo usa otro equipo, ya lo cambiaremos." },
		});
		assert.equal(respuesta.status, 302);
		const contestada = leerTarea(montaje.db, 1);
		assert.equal(contestada?.preguntas[0]?.respuestaOpcion, "Punto y coma");

		const repetida = await pedir(montaje, `/tareas/${id}/responder/P1`, {
			cookie,
			formulario: { opcion: "No hacer nada", nota: "" },
		});
		assert.equal(repetida.status, 422);
		assert.match(await repetida.text(), /ya está contestada/);
	} finally {
		await montaje.cerrar();
	}
});

test("la ficha pone la pregunta abierta arriba, el hilo la manda a ella y se filtra", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const id = await crearTarea(montaje, cookie, "Exportar clientes", "Hace falta un CSV.");
		await pedir(montaje, `/tareas/${id}/mover`, { cookie, formulario: { estado: "prepared" } });

		const { valor } = crearTerminalConToken(montaje.db, 1, "portatil-ana", "ana@ejemplo.com");
		const terminalId = valor.terminal.id;
		tomarTarea(montaje.db, { tareaId: 1, fase: "analisis", terminalId });
		comentarAnalisis(montaje.db, { tareaId: 1, terminalId, texto: "Hay que añadir un botón al listado." });
		tomarTarea(montaje.db, { tareaId: 1, fase: "ejecucion", terminalId });
		comentarioDeAgente(montaje.db, { tareaId: 1, terminalId, texto: "El botón ya baja el fichero." });
		preguntar(montaje.db, {
			tareaId: 1,
			terminalId,
			pregunta: "¿Qué separador usamos en el CSV?",
			porQueImporta: "La hoja de cálculo de los comerciales está en español.",
			opciones: [
				{ texto: "Punto y coma", consecuencia: "Se abre directamente en su hoja de cálculo." },
				{ texto: "No hacer nada", consecuencia: "Siguen copiando a mano." },
			],
			recomendacion: "Punto y coma",
		});

		const cuerpo = await (await pedir(montaje, `/tareas/${id}`, { cookie })).text();
		// La pregunta, con su formulario, antes de las propiedades; en el hilo
		// sigue estando, sin formulario y con el enlace que sube a ella.
		const arriba = cuerpo.indexOf(`id="pregunta-${id}-P1"`);
		assert.ok(arriba > 0, "la ficha no lleva la pregunta abierta arriba");
		assert.ok(arriba < cuerpo.indexOf('<dl class="propiedades">'), "la pregunta no va antes de las propiedades");
		assert.equal(cuerpo.split(`action="/tareas/${id}/responder/P1"`).length - 1, 1);
		assert.ok(cuerpo.includes(`<a href="#pregunta-${id}-P1">Responder arriba</a>`));
		// El panel de la derecha lleva las propiedades y lo excepcional.
		assert.match(cuerpo, /<aside class="panel">/);

		const preguntas = await (await pedir(montaje, `/tareas/${id}?hilo=preguntas`, { cookie })).text();
		assert.match(preguntas, /¿Qué separador usamos en el CSV\?/);
		assert.doesNotMatch(preguntas, /El botón ya baja el fichero\./);
		assert.match(preguntas, /aria-current="page">Preguntas y respuestas/);

		const avances = await (await pedir(montaje, `/tareas/${id}?hilo=comentarios`, { cookie })).text();
		assert.match(avances, /El botón ya baja el fichero\./);
		assert.doesNotMatch(avances, /Hay que añadir un botón al listado\./);

		// Un valor desconocido enseña el hilo entero, como «Todo».
		const todo = await (await pedir(montaje, `/tareas/${id}?hilo=loquesea`, { cookie })).text();
		assert.match(todo, /Hay que añadir un botón al listado\./);
		assert.match(todo, /El botón ya baja el fichero\./);
	} finally {
		await montaje.cerrar();
	}
});

test("comentar una tarea hecha pidiendo otra iteración la devuelve a En curso", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const id = await crearTarea(montaje, cookie, "Exportar clientes", "Hace falta un CSV.");
		await pedir(montaje, `/tareas/${id}/mover`, { cookie, formulario: { estado: "prepared" } });
		const { valor } = crearTerminalConToken(montaje.db, 1, "portatil-ana", "ana@ejemplo.com");
		const terminalId = valor.terminal.id;
		tomarTarea(montaje.db, { tareaId: 1, fase: "analisis", terminalId });
		comentarAnalisis(montaje.db, { tareaId: 1, terminalId, texto: "plan" });
		tomarTarea(montaje.db, { tareaId: 1, fase: "ejecucion", terminalId });
		comentarResultado(montaje.db, { tareaId: 1, terminalId, texto: "Commit: a1b2c3d" });

		// En `done` el cuadro ofrece las dos cosas: dejar constancia y pedir otra
		// iteración. Todavía va por la primera: ni separador ni cuenta.
		const hecha = await (await pedir(montaje, `/tareas/${id}`, { cookie })).text();
		assert.match(hecha, /<form class="comentar" method="post" action="\/tareas\/T-0001\/comentar">/);
		assert.match(hecha, /name="iterar" value="1">Comentar y pedir otra iteración/);
		assert.doesNotMatch(hecha, /class="iteracion"/);
		assert.doesNotMatch(hecha, /Iteración 2/);

		const otra = await pedir(montaje, `/tareas/${id}/comentar`, {
			cookie,
			formulario: { texto: "Falta el separador.", iterar: "1" },
		});
		assert.equal(otra.status, 302);
		const cuerpo = await (await pedir(montaje, `/tareas/${id}`, { cookie })).text();
		assert.match(cuerpo, /<span class="insignia estado-doing color-amarillo">En curso<\/span>/);
		assert.match(cuerpo, /Falta el separador\./);
		// Y ya no hay iteración que pedir: la tarea no está hecha.
		assert.doesNotMatch(cuerpo, /name="iterar"/);

		// La vuelta parte el hilo: el separador abre la iteración 2 justo delante
		// del comentario que la pidió, y las propiedades la cuentan.
		assert.match(cuerpo, /<div class="iteracion"><span>Iteración 2 · /);
		assert.ok(
			cuerpo.indexOf('<div class="iteracion">') < cuerpo.indexOf("Falta el separador."),
			"el separador no va antes del comentario que pidió la vuelta",
		);
		assert.match(cuerpo, /<span class="silencio">Iteración 2<\/span>/);
	} finally {
		await montaje.cerrar();
	}
});

/** Cuántos botones ofrece el cuadro de comentar de una ficha; ninguno si no hay cuadro. */
function botonesDeComentar(cuerpo: string): number {
	const desde = cuerpo.indexOf('<form class="comentar"');
	if (desde < 0) {
		return 0;
	}
	return (cuerpo.slice(desde, cuerpo.indexOf("</form>", desde)).match(/<button/g) ?? []).length;
}

test("el cuadro de comentar cierra el hilo y ofrece lo que toca en cada columna", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const id = await crearTarea(montaje, cookie, "Exportar clientes", "Hace falta un CSV.");
		await pedir(montaje, `/tareas/${id}/mover`, { cookie, formulario: { estado: "prepared" } });
		const { valor } = crearTerminalConToken(montaje.db, 1, "portatil-ana", "ana@ejemplo.com");
		const terminalId = valor.terminal.id;
		tomarTarea(montaje.db, { tareaId: 1, fase: "analisis", terminalId });
		comentarAnalisis(montaje.db, { tareaId: 1, terminalId, texto: "plan" });
		tomarTarea(montaje.db, { tareaId: 1, fase: "ejecucion", terminalId });

		// En curso solo se comenta, y el cuadro va detrás del hilo: es la caja de
		// escribir de un chat, no una sección aparte.
		const enCurso = await (await pedir(montaje, `/tareas/${id}`, { cookie })).text();
		assert.equal(botonesDeComentar(enCurso), 1);
		assert.ok(
			enCurso.indexOf('<div class="hilo">') < enCurso.indexOf('<form class="comentar"'),
			"el cuadro de comentar no va después del hilo",
		);
		assert.match(enCurso, /placeholder="Escribe al agente…"/);
		assert.doesNotMatch(enCurso, /<h2>Nota<\/h2>/);

		// Hecha, además se puede pedir otra iteración.
		comentarResultado(montaje.db, { tareaId: 1, terminalId, texto: "Commit: a1b2c3d" });
		assert.equal(botonesDeComentar(await (await pedir(montaje, `/tareas/${id}`, { cookie })).text()), 2);

		// Cerrada es de solo lectura: no hay cuadro.
		await pedir(montaje, `/tareas/${id}/mover`, { cookie, formulario: { estado: "finished" } });
		assert.equal(botonesDeComentar(await (await pedir(montaje, `/tareas/${id}`, { cookie })).text()), 0);
	} finally {
		await montaje.cerrar();
	}
});

test("el hilo enseña cada autor como chip y la ficha lleva su rastro de actividad", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const alta = await pedir(montaje, "/tareas", {
			cookie,
			formulario: {
				titulo: "Exportar clientes",
				descripcion: "Hace falta un CSV.",
				autoejecucion: "on",
				analisisModelo: "sonnet",
				analisisTerminal: "",
				ejecucionTerminal: "",
			},
		});
		assert.equal(alta.status, 302);
		await pedir(montaje, "/tareas/T-0001/mover", { cookie, formulario: { estado: "prepared" } });

		const { valor } = crearTerminalConToken(montaje.db, 1, "portatil-ana", "ana@ejemplo.com");
		const terminalId = valor.terminal.id;
		tomarTarea(montaje.db, { tareaId: 1, fase: "analisis", terminalId });
		comentarAnalisis(montaje.db, { tareaId: 1, terminalId, texto: "Hay que añadir un botón al listado." });
		preguntar(montaje.db, {
			tareaId: 1,
			terminalId,
			pregunta: "¿Qué separador usamos en el CSV?",
			porQueImporta: "La hoja de cálculo de los comerciales está en español.",
			opciones: [
				{ texto: "Punto y coma", consecuencia: "Se abre directamente en su hoja de cálculo." },
				{ texto: "No hacer nada", consecuencia: "Siguen copiando a mano." },
			],
			recomendacion: "Punto y coma",
		});

		// Con la pregunta abierta, sus opciones son tarjetas seleccionables.
		const abierta = await (await pedir(montaje, "/tareas/T-0001", { cookie })).text();
		assert.match(abierta, /<label class="opcion">/);
		assert.match(abierta, /<span class="recomendada">recomendada<\/span>/);

		await pedir(montaje, "/tareas/T-0001/responder/P1", {
			cookie,
			formulario: { opcion: "Punto y coma", nota: "Ya lo cambiaremos." },
		});

		const cuerpo = await (await pedir(montaje, "/tareas/T-0001", { cookie })).text();
		// El agente: chip gris con la inicial del modelo y su terminal detrás.
		assert.match(
			cuerpo,
			/<span class="chip color-gris"><span class="inicial">S<\/span>sonnet<span class="terminal">@portatil-ana<\/span><\/span>/,
		);
		// El humano: el chip de su usuario, con el color que tiene ahora.
		assert.match(cuerpo, /<span class="chip color-\w+"><span class="inicial">A<\/span>ana<\/span>/);
		assert.match(cuerpo, /<span class="insignia tipo-analisis color-azul">Análisis<\/span>/);
		assert.match(cuerpo, /<span>P1<\/span>/);
		// Contestada, ya no hay formulario de respuesta en su tarjeta.
		assert.doesNotMatch(cuerpo, /class="responder"/);

		// La actividad, de lo más antiguo a lo más nuevo y con la frase de cada acción.
		const actividad = cuerpo.slice(cuerpo.indexOf('<ol class="actividad">'));
		assert.ok(actividad.startsWith('<ol class="actividad">'), "falta la lista de actividad");
		assert.ok(actividad.indexOf("creó la tarea") < actividad.indexOf("movió la tarea"), "el rastro va del revés");
		assert.match(actividad, /respondió/);
		assert.match(actividad, /P1: Punto y coma/);

		// La vuelta atrás está, pero plegada: es excepcional.
		assert.match(cuerpo, /<details class="caja">\s*<summary><strong>Devolver a por definir<\/strong><\/summary>/);
	} finally {
		await montaje.cerrar();
	}
});

test("un terminal se crea con su token, se lista y se revoca", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const alta = await pedir(montaje, "/terminales", {
			cookie,
			formulario: { nombre: "portatil-ana", cuenta: "ana@ejemplo.com" },
		});
		assert.equal(alta.status, 200);
		const cuerpoAlta = await alta.text();
		const token = tokenDe(cuerpoAlta);
		assert.notEqual(buscarTerminalPorToken(montaje.db, token), undefined);
		// La página del token no se refresca sola: una recarga se llevaría por
		// delante lo único que no se vuelve a enseñar.
		assert.doesNotMatch(cuerpoAlta, /data-vista="terminales"/);

		const lista = await pedir(montaje, "/terminales", { cookie });
		const cuerpoLista = await lista.text();
		assert.match(cuerpoLista, /portatil-ana/);
		assert.match(cuerpoLista, />Activo</);
		assert.match(cuerpoLista, /sin datos/);
		// El dueño y quien lo creó van como chip con el color del usuario.
		assert.match(cuerpoLista, /<span class="chip color-azul"><span class="inicial">A<\/span>ana<\/span>/);
		// La telemetría no mueve la revisión: esta vista se refresca por intervalo.
		assert.match(cuerpoLista, /data-vista="terminales"/);

		const terminalId = listarTerminales(montaje.db)[0]?.id ?? 0;
		const confirmacion = await pedir(montaje, `/terminales/${terminalId}/revocar`, { cookie });
		assert.equal(confirmacion.status, 200);
		assert.match(await confirmacion.text(), /Sí, revocar/);

		const revocado = await pedir(montaje, `/terminales/${terminalId}/revocar`, { cookie, formulario: {} });
		assert.equal(revocado.status, 302);
		assert.equal(buscarTerminalPorToken(montaje.db, token), undefined);
		// La etiqueta dice «Revocado» y la fecha va al lado, fuera: dentro no
		// podría partirse y ensancharía la tabla entera.
		const yaRevocado = await (await pedir(montaje, "/terminales", { cookie })).text();
		assert.match(yaRevocado, /<span class="insignia color-gris">Revocado<\/span>/);
		assert.match(yaRevocado, /<span class="pequeno silencio">\d{4}-\d{2}-\d{2} \d{2}:\d{2}<\/span>/);
	} finally {
		await montaje.cerrar();
	}
});

test("el uso disponible se pinta por ventana como barra, sin estilos en línea", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const alta = await pedir(montaje, "/terminales", {
			cookie,
			formulario: { nombre: "portatil-ana", cuenta: "ana@ejemplo.com" },
		});
		const token = tokenDe(await alta.text());

		const reportado = await reportarUso(montaje, token, {
			rate_limits: {
				five_hour: { used_percentage: 30, resets_at: "2026-09-04T13:00:00Z" },
				seven_day: { used_percentage: 95, resets_at: "2026-09-11T13:00:00Z" },
			},
		});
		assert.equal(reportado.status, 204);

		const cuerpo = await (await pedir(montaje, "/terminales", { cookie })).text();
		assert.match(cuerpo, /<span class="uso-nombre">5 h<\/span>/);
		assert.match(cuerpo, /70 % disponible/);
		// El ancho sale de la decena, en un atributo: en las plantillas no hay
		// estilos en línea que puedan colar nada.
		assert.match(cuerpo, /<span class="uso-relleno" data-nivel="7"><\/span>/);
		assert.match(cuerpo, /<span class="uso-relleno" data-nivel="1"><\/span>/);
		assert.match(cuerpo, /reinicia /);
		assert.doesNotMatch(cuerpo, /style="/);

		// Sin `rate_limits` queda el coste estimado, que es lo único que tiene
		// una sesión con clave de API.
		assert.equal((await reportarUso(montaje, token, { cost: { total_cost_usd: 1.5 } })).status, 204);
		const conCoste = await (await pedir(montaje, "/terminales", { cookie })).text();
		assert.match(conCoste, /coste de sesión: \$1\.50/);
	} finally {
		await montaje.cerrar();
	}
});

test("los usuarios se dan de alta y de baja, pero nunca el último", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const alta = await pedir(montaje, "/usuarios", { cookie, formulario: { nombre: "otro", password: "clave" } });
		assert.equal(alta.status, 302);
		assert.equal(listarUsuarios(montaje.db).length, 2);

		const otro = listarUsuarios(montaje.db).find((usuario) => usuario.nombre === "otro");
		const confirmacion = await pedir(montaje, `/usuarios/${otro?.id ?? 0}/borrar`, { cookie });
		assert.equal(confirmacion.status, 200);
		assert.match(await confirmacion.text(), /Sí, borrar/);

		const baja = await pedir(montaje, `/usuarios/${otro?.id ?? 0}/borrar`, { cookie, formulario: {} });
		assert.equal(baja.status, 302);
		assert.equal(listarUsuarios(montaje.db).length, 1);

		const ultimo = listarUsuarios(montaje.db)[0]?.id ?? 0;
		const rechazada = await pedir(montaje, `/usuarios/${ultimo}/borrar`, { cookie, formulario: {} });
		assert.equal(rechazada.status, 422);
		assert.match(await rechazada.text(), /Es el último usuario/);
		assert.equal(listarUsuarios(montaje.db).length, 1);
	} finally {
		await montaje.cerrar();
	}
});

test("las páginas con sesión son HTML en español", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		for (const ruta of ["/tareas", "/tareas/nueva", "/terminales", "/usuarios", "/actividad"]) {
			const respuesta = await pedir(montaje, ruta, { cookie });
			assert.equal(respuesta.status, 200, ruta);
			assert.equal(respuesta.headers.get("content-type"), "text/html; charset=UTF-8", ruta);
			assert.match(await respuesta.text(), /<html lang="es">/, ruta);
		}
	} finally {
		await montaje.cerrar();
	}
});

test("la barra lateral enseña al usuario de la sesión con su color y marca dónde está", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		// El primer usuario se lleva el primer color de la lista: azul.
		assert.equal(listarUsuarios(montaje.db)[0]?.color, "azul");

		const sistema: readonly { ruta: string; vista: string }[] = [
			{ ruta: "/terminales", vista: "terminales" },
			{ ruta: "/usuarios", vista: "usuarios" },
			{ ruta: "/actividad", vista: "actividad" },
		];
		for (const { ruta, vista } of sistema) {
			const cuerpo = await (await pedir(montaje, ruta, { cookie })).text();
			assert.match(cuerpo, /<span class="chip color-azul"><span class="inicial">A<\/span>ana<\/span>/, ruta);
			assert.match(cuerpo, new RegExp(`data-vista="${vista}"`), ruta);
			// Las tres son del bloque «Sistema» y cada una marca su entrada.
			assert.match(cuerpo, new RegExp(`<a class="enlace-nav" href="${ruta}" aria-current="page">`), ruta);
		}
	} finally {
		await montaje.cerrar();
	}
});

test("las páginas de sistema empiezan por su cabecera, con sus acciones", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);

		const terminales = await (await pedir(montaje, "/terminales", { cookie })).text();
		assert.match(terminales, /<h1>Terminales<\/h1>/);
		assert.match(terminales, /<a class="boton principal" href="#nuevo-terminal">Nuevo terminal<\/a>/);
		assert.match(terminales, /<section class="caja" id="nuevo-terminal">/);

		const usuarios = await (await pedir(montaje, "/usuarios", { cookie })).text();
		assert.match(usuarios, /<h1>Usuarios<\/h1>/);
		assert.match(usuarios, /<a class="boton principal" href="#nuevo-usuario">Nuevo usuario<\/a>/);
		assert.match(usuarios, /<section class="caja" id="nuevo-usuario">/);
		assert.match(usuarios, /Cambiar mi contraseña/);

		// Una tarjeta con el mensaje y la vuelta, no una página en blanco.
		const sinTerminal = await pedir(montaje, "/terminales/999/revocar", { cookie });
		assert.equal(sinTerminal.status, 404);
		const cuerpo404 = await sinTerminal.text();
		assert.match(cuerpo404, /<section class="caja caja-estrecha">/);
		assert.match(cuerpo404, /No existe ese terminal\./);
		assert.match(cuerpo404, /href="\/terminales"/);

		const sinUsuario = await pedir(montaje, "/usuarios/999/borrar", { cookie });
		assert.equal(sinUsuario.status, 404);
		assert.match(await sinUsuario.text(), /No existe ese usuario\./);
	} finally {
		await montaje.cerrar();
	}
});

test("el color de un usuario se elige con las ocho muestras, y en el alta hay automático", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await pedir(montaje, "/usuarios", { cookie, formulario: { nombre: "otro", password: "clave", color: "rosa" } });
		const otro = listarUsuarios(montaje.db).find((usuario) => usuario.nombre === "otro");
		assert.equal(otro?.color, "rosa");

		const cuerpo = await (await pedir(montaje, "/usuarios", { cookie })).text();
		// Cada usuario se enseña con su chip, y su color va en la última clase.
		assert.match(cuerpo, /<span class="chip color-rosa"><span class="inicial">O<\/span>otro<\/span>/);
		// Las ocho muestras, con la del usuario marcada y su nombre para quien no
		// ve el color.
		for (const color of COLORES_USUARIO) {
			assert.match(cuerpo, new RegExp(`<label class="muestra color-${color}">`), color);
		}
		assert.match(cuerpo, /name="color" value="rosa" checked/);
		assert.match(cuerpo, /<span class="solo-lectores">rosa<\/span>/);
		assert.match(cuerpo, /aria-label="Color de otro"/);
		// El alta trae la muestra «automático» marcada: manda el valor vacío y el
		// servidor reparte el color menos usado.
		assert.match(cuerpo, /<input type="radio" name="color" value="" checked>automático/);
		assert.match(cuerpo, /<form class="cambio-color" method="post" action="\/usuarios\/\d+\/color">/);
	} finally {
		await montaje.cerrar();
	}
});

test("nada de lo que escribe el humano llega al navegador sin escapar", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const id = await crearTarea(montaje, cookie, '<script>alert("uy")</script>', "<img src=x onerror=alert(1)>");

		for (const ruta of ["/tareas", `/tareas/${id}`]) {
			const cuerpo = await (await pedir(montaje, ruta, { cookie })).text();
			assert.ok(!cuerpo.includes("<script>alert"), `${ruta} dejó pasar una etiqueta script`);
			assert.ok(!cuerpo.includes("<img src=x"), `${ruta} dejó pasar una etiqueta img`);
			assert.match(cuerpo, /&lt;script&gt;/);
		}
	} finally {
		await montaje.cerrar();
	}
});

/** La configuración de un servidor al que se llega también por una IP de la red. */
const CONFIG_CON_DIRECCIONES: Config = { ...CONFIG_PRUEBA, DIRECCIONES: ["http://192.168.50.5:3000"] };

test("el Host de una dirección configurada pasa y el de otra da 403", async () => {
	const montaje = montar(CONFIG_CON_DIRECCIONES);
	try {
		// El middleware compara solo el hostname, así que el puerto de la cabecera
		// no tiene por qué ser el de la dirección configurada.
		const propia = await pedir(montaje, "/salud", { cabeceras: { host: "192.168.50.5:3020" } });
		assert.equal(propia.status, 200);

		const local = await pedir(montaje, "/salud", { cabeceras: { host: "127.0.0.1:3000" } });
		assert.equal(local.status, 200);

		const ajena = await pedir(montaje, "/salud", { cabeceras: { host: "ajeno.example" } });
		assert.equal(ajena.status, 403);
	} finally {
		await montaje.cerrar();
	}
});

test("la página del terminal creado lleva el tutorial con el token y las direcciones", async () => {
	const montaje = montar(CONFIG_CON_DIRECCIONES);
	try {
		const cookie = await entrar(montaje);
		const alta = await pedir(montaje, "/terminales", {
			cookie,
			formulario: { nombre: "portatil-ana", cuenta: "ana@ejemplo.com" },
		});
		const cuerpo = await alta.text();
		const token = tokenDe(cuerpo);

		// Las direcciones, cada una con su origen. La base es la de las pruebas.
		assert.match(cuerpo, /<code>http:\/\/localhost:3000<\/code><\/td><td class="pequeno">la configurada como base</);
		assert.match(
			cuerpo,
			/<code>http:\/\/192\.168\.50\.5:3000<\/code><\/td><td class="pequeno">configurada en DIRECCIONES</,
		);
		// La recomendada para otra máquina es la privada, no localhost.
		assert.match(cuerpo, /<code>servidor_url<\/code><\/td><td><code>http:\/\/192\.168\.50\.5:3000<\/code>/);
		// El token, dentro del primer comando y dentro del archivo de la statusline.
		assert.match(
			cuerpo,
			new RegExp(
				`claude mcp add --transport http --scope local tareas http://192\\.168\\.50\\.5:3000/mcp --header &quot;Authorization: Bearer ${token}&quot;`,
			),
		);
		assert.match(
			cuerpo,
			/curl -fsSL http:\/\/192\.168\.50\.5:3000\/skill\.md --create-dirs -o ~\/\.claude\/skills\/tareas\/SKILL\.md/,
		);
		// Cada línea del archivo de configuración es ya la suya, con su botón.
		assert.match(cuerpo, /<code>SERVIDOR_URL=http:\/\/192\.168\.50\.5:3000<\/code>/);
		assert.match(cuerpo, new RegExp(`<code>TOKEN=${token}</code>`));
		assert.match(cuerpo, /\/plugin install mcp-tareas@mcp-tareas-marketplace/);
		// Se instala desde GitHub, no solo desde un clon local.
		assert.match(cuerpo, /marketplace add xinux87\/Mcp_tasks_server/);
		// La statusline va por una ruta estable, no por la carpeta de instalación del plugin.
		assert.match(cuerpo, /~\/\.claude\/mcp-tareas\/statusline\.sh/);
		assert.doesNotMatch(cuerpo, /plugins\/marketplaces/);
		// Rotar el token no obliga a reinstalar.
		assert.match(cuerpo, /--config token_terminal=/);
		assert.match(cuerpo, /\/loop 2m \/tareas/);
		// La advertencia de Docker, que es la trampa de las direcciones detectadas.
		assert.match(cuerpo, /Docker[\s\S]*máquina anfitriona/);
		// Cada bloque de comandos se puede copiar entero.
		assert.match(
			cuerpo,
			/<div class="bloque-codigo"><button type="button" class="boton pequeno copiar">Copiar<\/button>/,
		);
		// Y línea a línea cuando tiene varias: los dos comandos de la instalación
		// son dos, no uno. El de una sola línea no lleva botón de línea, que el
		// del bloque ya lo es.
		const instalar = bloquesDe(cuerpo).find((bloque) => bloque.includes("marketplace add xinux87")) ?? "";
		assert.equal(instalar.match(/class="copiar copiar-linea"/g)?.length, 2);
		const bucle = bloquesDe(cuerpo).find((bloque) => bloque.includes("/loop 2m /tareas")) ?? "";
		assert.doesNotMatch(bucle, /copiar-linea/);
	} finally {
		await montaje.cerrar();
	}
});

test("el tutorial sin token está siempre en /terminales/conectar", async () => {
	const montaje = montar(CONFIG_CON_DIRECCIONES);
	try {
		const sinSesion = await pedir(montaje, "/terminales/conectar");
		assert.equal(sinSesion.status, 302);
		assert.equal(sinSesion.headers.get("location"), "/login?volver=%2Fterminales%2Fconectar");

		const cookie = await entrar(montaje);
		const { valor } = crearTerminalConToken(montaje.db, listarUsuarios(montaje.db)[0]?.id ?? 0, "sobremesa", "x@y.z");
		// La cabecera dice por dónde ha entrado el navegador: no es ninguna de las
		// conocidas, así que sale como una fila más.
		const respuesta = await pedir(montaje, "/terminales/conectar", {
			cookie,
			cabeceras: { host: "127.0.0.1:3000" },
		});
		assert.equal(respuesta.status, 200);
		const cuerpo = await respuesta.text();
		assert.match(cuerpo, /data-vista="conectar"/);
		assert.match(cuerpo, /Bearer &lt;token&gt;/);
		assert.match(cuerpo, /TOKEN=&lt;token&gt;/);
		assert.match(
			cuerpo,
			/<code>http:\/\/127\.0\.0\.1:3000<\/code><\/td><td class="pequeno">la que estás usando ahora en el navegador</,
		);
		// Ningún token de verdad se enseña aquí.
		assert.ok(!cuerpo.includes(valor.token), "el tutorial sin token enseñó un token real");
		assert.doesNotMatch(cuerpo, /bloque-codigo token/);
	} finally {
		await montaje.cerrar();
	}
});

test("el tutorial conecta en dos comandos y deja el plugin como opcional", async () => {
	const montaje = montar(CONFIG_CON_DIRECCIONES);
	try {
		const { valor } = crearTerminalConToken(montaje.db, listarUsuarios(montaje.db)[0]?.id ?? 0, "sobremesa", "x@y.z");
		const conToken = await pedir(montaje, `/terminales/conectar?token=${valor.token}`);
		assert.equal(conToken.status, 200);
		const cuerpo = await conToken.text();
		// Los dos comandos, con la dirección y el token puestos y en un solo bloque.
		assert.match(cuerpo, /Conectar en dos comandos/);
		const dos = bloquesDe(cuerpo).find((bloque) => bloque.includes("claude mcp add")) ?? "";
		assert.match(
			dos,
			new RegExp(
				`claude mcp add --transport http --scope local tareas http://192\\.168\\.50\\.5:3000/mcp --header &quot;Authorization: Bearer ${valor.token}&quot;`,
			),
		);
		assert.match(
			dos,
			/curl -fsSL http:\/\/192\.168\.50\.5:3000\/skill\.md --create-dirs -o ~\/\.claude\/skills\/tareas\/SKILL\.md/,
		);
		// Cada uno se copia por su cuenta.
		assert.equal(dos.match(/class="copiar copiar-linea"/g)?.length, 2);
		// El bucle es el de la skill personal, y el plugin queda como opcional.
		assert.match(cuerpo, /\/loop 2m \/tareas/);
		assert.doesNotMatch(cuerpo, /mcp-tareas:tareas/);
		assert.match(cuerpo, /Opcional: ver el uso de la cuenta en la web/);
		// La comprobación cuenta que la fila enseña la carpeta reportada.
		assert.match(cuerpo, /carpeta\s+en\s+la\s+que\s+está\s+trabajando/);

		// Sin token, los mismos comandos con el marcador y ningún token de verdad.
		const cookie = await entrar(montaje);
		const sinToken = await pedir(montaje, "/terminales/conectar", { cookie });
		const marcador = await sinToken.text();
		assert.match(
			marcador,
			/claude mcp add --transport http --scope local tareas http:\/\/192\.168\.50\.5:3000\/mcp --header &quot;Authorization: Bearer &lt;token&gt;&quot;/,
		);
		assert.ok(!marcador.includes(valor.token), "el tutorial sin token enseñó un token real");
	} finally {
		await montaje.cerrar();
	}
});

/** Cada bloque de código copiable de una página, sin lo que hay entre ellos. */
function bloquesDe(cuerpo: string): string[] {
	return cuerpo
		.split('<div class="bloque-codigo')
		.slice(1)
		.map((trozo) => trozo.split("</div>")[0] ?? "");
}

/** El token en claro que enseña una vez la página del alta o la de la rotación. */
function tokenDe(cuerpo: string): string {
	const token = /<div class="bloque-codigo token">.*?<code>([A-Za-z0-9_-]+)<\/code>/.exec(cuerpo)?.[1] ?? "";
	assert.equal(token.length, 43, "no se enseñó un token en claro");
	return token;
}

/** Una llamada al MCP con bearer, que es lo único que comprueba si el token vale. */
async function llamarMcp(montaje: Montaje, token: string): Promise<Response> {
	const url = new URL("/mcp", BASE_URL_PRUEBA);
	const peticion = new Request(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "test", version: "0" } },
		}),
	});
	peticion.headers.set("host", url.host);
	return await montaje.app.fetch(peticion);
}

test("el enlace de conexión sirve el tutorial con el token y sin sesión", async () => {
	const montaje = montar(CONFIG_CON_DIRECCIONES);
	try {
		const { valor } = crearTerminalConToken(montaje.db, listarUsuarios(montaje.db)[0]?.id ?? 0, "sobremesa", "x@y.z");
		const token = valor.token;

		// Se abre en la máquina del terminal, donde no hay sesión ni usuario.
		const respuesta = await pedir(montaje, `/terminales/conectar?token=${token}`);
		assert.equal(respuesta.status, 200);
		const cuerpo = await respuesta.text();
		assert.match(cuerpo, new RegExp(`Bearer ${token}`));
		assert.match(cuerpo, new RegExp(`TOKEN=${token}`));
		// Sin sesión no hay barra lateral, como en el login, pero sí título.
		assert.doesNotMatch(cuerpo, /class="lateral"/);
		assert.match(cuerpo, /<h1>Cómo conectar un terminal<\/h1>/);
		assert.doesNotMatch(cuerpo, /style="/);

		// Un token que no es de nadie se comporta como el resto de la web.
		const basura = await pedir(montaje, "/terminales/conectar?token=basura");
		assert.equal(basura.status, 302);
		assert.equal(basura.headers.get("location"), "/login?volver=%2Fterminales%2Fconectar%3Ftoken%3Dbasura");

		// Y el de un terminal revocado deja de valer, sin nada que caducar aparte.
		const cookie = await entrar(montaje);
		const revocado = await pedir(montaje, `/terminales/${valor.terminal.id}/revocar`, { cookie, formulario: {} });
		assert.equal(revocado.status, 302);
		assert.equal((await pedir(montaje, `/terminales/conectar?token=${token}`)).status, 302);
	} finally {
		await montaje.cerrar();
	}
});

test("la página del terminal creado ofrece el enlace de conexión con el token dentro", async () => {
	const montaje = montar(CONFIG_CON_DIRECCIONES);
	try {
		const cookie = await entrar(montaje);
		const alta = await pedir(montaje, "/terminales", {
			cookie,
			formulario: { nombre: "portatil-ana", cuenta: "ana@ejemplo.com" },
		});
		const cuerpo = await alta.text();
		const token = tokenDe(cuerpo);
		// La dirección recomendada, no localhost: el terminal está en otra máquina.
		assert.match(cuerpo, new RegExp(`<code>http://192\\.168\\.50\\.5:3000/terminales/conectar\\?token=${token}</code>`));
		assert.match(cuerpo, /quien lo tenga, tiene el terminal/);
	} finally {
		await montaje.cerrar();
	}
});

test("los agentes en paralelo se eligen en el alta y se cambian desde la fila", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await pedir(montaje, "/terminales", {
			cookie,
			formulario: { nombre: "portatil-ana", cuenta: "ana@ejemplo.com", agentes: "2" },
		});
		const id = listarTerminales(montaje.db)[0]?.id ?? 0;
		assert.equal(listarTerminales(montaje.db)[0]?.agentes, 2);

		// La fila lo enseña en su propio formulario, con el valor de ahora.
		const lista = await (await pedir(montaje, "/terminales", { cookie })).text();
		assert.match(lista, /<th>Agentes<\/th>/);
		assert.match(lista, new RegExp(`<form class="cambio-agentes" method="post" action="/terminales/${id}/agentes">`));
		assert.match(lista, /<input type="number" name="agentes" min="1" value="2"/);

		const antes = revisionActual(montaje.db);
		const cambio = await pedir(montaje, `/terminales/${id}/agentes`, { cookie, formulario: { agentes: "4" } });
		assert.equal(cambio.status, 302);
		assert.equal(listarTerminales(montaje.db)[0]?.agentes, 4);
		// Es configuración del terminal, como rotar el token: ningún agente lo ve.
		assert.equal(revisionActual(montaje.db), antes);
		assert.match(await (await pedir(montaje, "/terminales", { cookie })).text(), /name="agentes" min="1" value="4"/);

		// Con el usuario de la sesión, en el rastro del terminal.
		const rastro = actividadDe(montaje.db, "terminal", id).filter((fila) => fila.accion === "cambiar_agentes");
		assert.equal(rastro.length, 1);
		assert.equal(rastro[0]?.usuarioNombre, "ana");
		assert.equal(rastro[0]?.detalle, "2 → 4");

		// Un valor que no es un entero de 1 en adelante vuelve a la lista con el aviso.
		const malo = await pedir(montaje, `/terminales/${id}/agentes`, { cookie, formulario: { agentes: "0" } });
		assert.equal(malo.status, 422);
		assert.match(await malo.text(), /número entero de 1 en adelante/);
		assert.equal(listarTerminales(montaje.db)[0]?.agentes, 4);
	} finally {
		await montaje.cerrar();
	}
});

test("rotar el token da uno nuevo al mismo terminal, sin revocarlo ni subir la revisión", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const alta = await pedir(montaje, "/terminales", {
			cookie,
			formulario: { nombre: "portatil-ana", cuenta: "ana@ejemplo.com" },
		});
		const viejo = tokenDe(await alta.text());
		const id = listarTerminales(montaje.db)[0]?.id ?? 0;

		// La fila ofrece rotar, junto a revocar.
		const lista = await (await pedir(montaje, "/terminales", { cookie })).text();
		assert.match(lista, new RegExp(`<a class="accion-fila neutra" href="/terminales/${id}/rotar">Rotar token</a>`));

		const confirmacion = await pedir(montaje, `/terminales/${id}/rotar`, { cookie });
		assert.equal(confirmacion.status, 200);
		assert.match(await confirmacion.text(), /Sí, rotar el token/);

		const antes = revisionActual(montaje.db);
		const rotado = await pedir(montaje, `/terminales/${id}/rotar`, { cookie, formulario: {} });
		assert.equal(rotado.status, 200);
		const nuevo = tokenDe(await rotado.text());
		assert.notEqual(nuevo, viejo);
		// Rotar es configuración del terminal, no contenido: nadie tiene que verlo.
		assert.equal(revisionActual(montaje.db), antes);

		// El terminal es el mismo y sigue vivo: lo que cambia es el token.
		assert.equal(buscarTerminalPorToken(montaje.db, viejo), undefined);
		assert.equal(buscarTerminalPorToken(montaje.db, nuevo)?.id, id);
		assert.equal(listarTerminales(montaje.db)[0]?.revocadoEn, null);

		// Y es el token lo que abre el MCP: el viejo ya no autentica.
		assert.equal((await llamarMcp(montaje, viejo)).status, 401);
		assert.equal((await llamarMcp(montaje, nuevo)).status, 200);

		// Con el usuario de la sesión, en el rastro del terminal.
		const rastro = actividadDe(montaje.db, "terminal", id).filter((fila) => fila.accion === "rotar_terminal");
		assert.equal(rastro.length, 1);
		assert.equal(rastro[0]?.usuarioNombre, "ana");

		// Un terminal revocado no se rota: el token nuevo no serviría de nada.
		assert.equal((await pedir(montaje, `/terminales/${id}/revocar`, { cookie, formulario: {} })).status, 302);
		const tarde = await pedir(montaje, `/terminales/${id}/rotar`, { cookie, formulario: {} });
		assert.equal(tarde.status, 422);
		assert.match(await tarde.text(), /está revocado: no se le puede dar un token nuevo/);
	} finally {
		await montaje.cerrar();
	}
});

test("borrar un terminal lo quita de la lista: sus tareas quedan sin terminal y el consumo se conserva", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const alta = await pedir(montaje, "/terminales", {
			cookie,
			formulario: { nombre: "portatil-ana", cuenta: "ana@ejemplo.com" },
		});
		const token = tokenDe(await alta.text());
		const id = listarTerminales(montaje.db)[0]?.id ?? 0;
		const humano = listarUsuarios(montaje.db)[0]?.id ?? 0;

		// Una tarea con las dos fases asignadas al terminal y tomada por él, y
		// una propuesta que creó él mismo: las cuatro referencias que hay.
		const suya = crearTareaHumana(montaje.db, {
			titulo: "Exportar el listado",
			descripcion: "d",
			usuarioId: humano,
			analisisModelo: "sonnet",
			analisisTerminalId: id,
			ejecucionModelo: "opus",
			ejecucionTerminalId: id,
		});
		moverTareaHumano(montaje.db, { tareaId: suya.id, usuarioId: humano, estado: "prepared" });
		tomarTarea(montaje.db, { tareaId: suya.id, fase: "analisis", terminalId: id });
		const propuesta = crearPropuesta(montaje.db, { titulo: "De paso", descripcion: "d", terminalId: id });
		registrarConsumo(montaje.db, {
			tareaId: suya.id,
			fase: "analisis",
			modelo: "sonnet",
			terminalId: id,
			tokens: 31500,
			herramientas: 6,
			duracionMs: 87000,
		});

		// La confirmación va en página aparte y dice qué se lleva por delante.
		const confirmacion = await pedir(montaje, `/terminales/${id}/borrar`, { cookie });
		assert.equal(confirmacion.status, 200);
		const textoConfirmacion = await confirmacion.text();
		assert.match(textoConfirmacion, /Sí, borrar/);
		assert.match(textoConfirmacion, /se quedan sin terminal/);
		assert.match(textoConfirmacion, /consumo ya registrado se conserva/);
		assert.doesNotMatch(textoConfirmacion, /style="/);

		const antes = revisionActual(montaje.db);
		const borrado = await pedir(montaje, `/terminales/${id}/borrar`, { cookie, formulario: {} });
		assert.equal(borrado.status, 302);
		assert.equal(borrado.headers.get("location"), "/terminales");
		assert.deepEqual(listarTerminales(montaje.db), []);
		// Cambia quién puede tomar tareas: eso los agentes lo ven.
		assert.ok(revisionActual(montaje.db) > antes);

		// La tarea sigue, sin terminal en ninguna de sus cuatro referencias, y
		// vuelve a estar libre para quien la quiera tomar.
		const leida = leerTarea(montaje.db, suya.id);
		assert.equal(leida?.tarea.analisisTerminalId, null);
		assert.equal(leida?.tarea.ejecucionTerminalId, null);
		assert.equal(leida?.tarea.enMarchaTerminalId, null);
		assert.ok(leida?.marcas.includes("sin terminal"), "la tarea tendría que quedar sin terminal");
		assert.equal(exigirTarea(montaje.db, propuesta.id).creadaPorTerminalId, null);

		// El consumo son tokens gastados de verdad: se queda tal cual estaba.
		assert.equal(leida?.consumo.analisis?.tokens, 31500);
		assert.equal(leida?.consumo.totalConHijas, 31500);
		assert.equal(montaje.db.prepare("SELECT COUNT(*) AS total FROM consumo").get()?.total, 1);
		assert.equal(montaje.db.prepare("SELECT terminal_id FROM consumo").get()?.terminal_id, null);

		// El token deja de valer en el acto, como si se hubiera revocado.
		assert.equal(buscarTerminalPorToken(montaje.db, token), undefined);
		assert.equal((await llamarMcp(montaje, token)).status, 401);

		// Y el rastro se queda, con el nombre del terminal y quien lo borró.
		const baja = actividadDe(montaje.db, "terminal", id).find((fila) => fila.accion === "baja_terminal");
		assert.equal(baja?.usuarioNombre, "ana");
		assert.equal(baja?.objetoNombre, "portatil-ana");
		assert.match(await (await pedir(montaje, "/actividad", { cookie })).text(), /borró el terminal/);
	} finally {
		await montaje.cerrar();
	}
});

test("un terminal revocado se puede borrar, y borrar uno que no existe avisa sin romper", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await pedir(montaje, "/terminales", {
			cookie,
			formulario: { nombre: "portatil-ana", cuenta: "ana@ejemplo.com" },
		});
		const id = listarTerminales(montaje.db)[0]?.id ?? 0;
		assert.equal((await pedir(montaje, `/terminales/${id}/revocar`, { cookie, formulario: {} })).status, 302);

		// Un terminal revocado es justo el que se quiere quitar de la lista: su
		// fila ofrece borrar, aunque ya no ofrezca rotar ni revocar.
		const lista = await (await pedir(montaje, "/terminales", { cookie })).text();
		assert.match(lista, new RegExp(`<a class="accion-fila" href="/terminales/${id}/borrar">Borrar</a>`));
		assert.doesNotMatch(lista, new RegExp(`href="/terminales/${id}/rotar"`));

		assert.equal((await pedir(montaje, `/terminales/${id}/borrar`, { cookie, formulario: {} })).status, 302);
		assert.deepEqual(listarTerminales(montaje.db), []);

		// Y el que ya no está no se puede volver a borrar.
		assert.equal((await pedir(montaje, `/terminales/${id}/borrar`, { cookie })).status, 404);
		const tarde = await pedir(montaje, `/terminales/${id}/borrar`, { cookie, formulario: {} });
		assert.equal(tarde.status, 422);
		assert.match(await tarde.text(), new RegExp(`No existe el terminal ${id}\\.`));
	} finally {
		await montaje.cerrar();
	}
});

// --- la edad en columna ------------------------------------------------------

test("la edad se lee en una sola unidad y cambia en los bordes de la hora y del día", () => {
	const ahora = new Date("2026-09-14T12:00:00.000Z");
	const hace = (ms: number): string => new Date(ahora.getTime() - ms).toISOString();
	const MINUTO = 60_000;
	const HORA = 60 * MINUTO;

	assert.equal(edad(hace(0), ahora), "0 min");
	assert.equal(edad(hace(12 * MINUTO), ahora), "12 min");
	assert.equal(edad(hace(59 * MINUTO), ahora), "59 min");
	assert.equal(edad(hace(60 * MINUTO), ahora), "1 h");
	assert.equal(edad(hace(5 * HORA), ahora), "5 h");
	assert.equal(edad(hace(23 * HORA), ahora), "23 h");
	assert.equal(edad(hace(24 * HORA), ahora), "1 d");
	assert.equal(edad(hace(3 * 24 * HORA), ahora), "3 d");
	// Una fecha futura no cuenta hacia atrás.
	assert.equal(edad(new Date(ahora.getTime() + HORA).toISOString(), ahora), "0 min");
});

test("la edad en columna se calla en backlog y se pinta en peligro cuando duele", async () => {
	const ahora = new Date("2026-09-14T12:00:00.000Z");
	const hace = (horas: number): string => new Date(ahora.getTime() - horas * 3_600_000).toISOString();
	const como = async (item: ConEdad): Promise<string> => String(await edadEnColumna(item, ahora));

	// En backlog y en finished el tiempo no dice nada: no se enseña.
	assert.equal(await como({ estado: "backlog", marcas: [], estadoDesde: hace(200), bloqueadaDesde: null }), "");
	assert.equal(await como({ estado: "finished", marcas: [], estadoDesde: hace(200), bloqueadaDesde: null }), "");

	// En prepared, la edad normal: en texto suave y con su fecha en el title.
	const normal = await como({ estado: "prepared", marcas: [], estadoDesde: hace(5), bloqueadaDesde: null });
	assert.match(normal, /<span class="edad" title="[^"]+">5 h<\/span>/);

	// Bloqueada desde hace más de un día: se cuenta desde la pregunta, no desde
	// el estado, y duele.
	const bloqueada = await como({
		estado: "doing",
		marcas: ["bloqueada"],
		estadoDesde: hace(2),
		bloqueadaDesde: hace(30),
	});
	assert.match(bloqueada, /class="edad edad-peligro"/);
	assert.match(bloqueada, />1 d</);

	// Bloqueada hace un rato: la misma cuenta, pero todavía no duele.
	const reciente = await como({
		estado: "doing",
		marcas: ["bloqueada"],
		estadoDesde: hace(200),
		bloqueadaDesde: hace(2),
	});
	assert.match(reciente, /<span class="edad" title/);
	assert.match(reciente, />2 h</);

	// Tres días en done es un resultado que nadie ha revisado.
	const revisar = await como({ estado: "done", marcas: [], estadoDesde: hace(80), bloqueadaDesde: null });
	assert.match(revisar, /class="edad edad-peligro"/);
	assert.match(revisar, />3 d</);
	const fresca = await como({ estado: "done", marcas: [], estadoDesde: hace(5), bloqueadaDesde: null });
	assert.match(fresca, /<span class="edad" title/);
});

test("la lista y el kanban enseñan la edad en columna, y la ficha desde cuándo", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const id = await crearTarea(montaje, cookie, "Exportar clientes", "Hace falta un CSV.");

		// En backlog no hay edad que enseñar, pero la columna ya se llama así.
		const enBacklog = await (await pedir(montaje, "/tareas", { cookie })).text();
		assert.match(enBacklog, /<th>En columna<\/th>/);
		assert.doesNotMatch(enBacklog, /class="edad"/);

		await pedir(montaje, `/tareas/${id}/mover`, { cookie, formulario: { estado: "prepared" } });
		assert.match(
			await (await pedir(montaje, "/tareas", { cookie })).text(),
			/<span class="edad" title="[^"]+">0 min<\/span>/,
		);
		assert.match(await (await pedir(montaje, "/tareas/kanban", { cookie })).text(), /<span class="edad" title/);

		// En la ficha va detrás del estado, en texto suave.
		const ficha = await (await pedir(montaje, `/tareas/${id}`, { cookie })).text();
		assert.match(
			ficha,
			/estado-prepared color-azul">Preparada<\/span> <span class="silencio">desde hace <span class="edad"/,
		);
	} finally {
		await montaje.cerrar();
	}
});

// --- los identificadores enlazan --------------------------------------------

test("un identificador de tarea del hilo enlaza a su ficha, salvo en código o en otro enlace", () => {
	assert.equal(
		renderMarkdown("Depende de T-0042 para empezar."),
		'<p>Depende de <a href="/tareas/T-0042">T-0042</a> para empezar.</p>\n',
	);
	// Dentro de código no se toca: ahí el identificador es texto literal.
	assert.equal(renderMarkdown("El literal `T-0042` no enlaza."), "<p>El literal <code>T-0042</code> no enlaza.</p>\n");
	assert.equal(
		renderMarkdown("```\nT-0042\n```"),
		'<div class="bloque-codigo"><button type="button" class="boton pequeno copiar">Copiar</button>' +
			'<pre><span class="linea"><code>T-0042</code></span></pre></div>\n',
	);
	// Ni dentro de un enlace que ya existe: no se anidan dos <a>.
	assert.equal(
		renderMarkdown("Mira [T-0042](https://ejemplo/otro)."),
		'<p>Mira <a href="https://ejemplo/otro">T-0042</a>.</p>\n',
	);
	// Cinco cifras también, y lo que no tiene cuatro no es un identificador.
	assert.match(renderMarkdown("T-10042"), /href="\/tareas\/T-10042"/);
	assert.equal(renderMarkdown("T-42 no lo es."), "<p>T-42 no lo es.</p>\n");
});

test("un bloque de código del hilo se copia entero y línea a línea, sin abrir HTML crudo", () => {
	const pintado = renderMarkdown("```\nprimero <b>\nsegundo\n```");
	// Dos líneas, dos botones de línea, además del del bloque entero.
	assert.equal(pintado.match(/copiar-linea/g)?.length, 2);
	assert.match(pintado, /<code>primero &lt;b&gt;<\/code>/);
	assert.doesNotMatch(pintado, /<b>/);
	// El otro bloque de código de Markdown, el sangrado, se pinta igual.
	assert.match(renderMarkdown("    sangrado"), /<span class="linea"><code>sangrado<\/code><\/span>/);
});

test("los identificadores de la descripción y del hilo enlazan en la ficha", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await crearTarea(montaje, cookie, "La primera", "Nada.");
		const segunda = await crearTarea(montaje, cookie, "La segunda", "Va después de T-0001.");

		const ficha = await (await pedir(montaje, `/tareas/${segunda}`, { cookie })).text();
		assert.match(ficha, /Va después de <a href="\/tareas\/T-0001">T-0001<\/a>\./);
	} finally {
		await montaje.cerrar();
	}
});

// --- volver: lo que la bandeja del humano necesita ---------------------------

test("responder, aprobar y mover vuelven a donde diga el campo volver, y a la ficha si no vale", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const id = await crearTarea(montaje, cookie, "Exportar clientes", "Hace falta un CSV.");

		// Mover, con y sin destino de vuelta.
		const conVolver = await pedir(montaje, `/tareas/${id}/mover`, {
			cookie,
			formulario: { estado: "prepared", volver: "/" },
		});
		assert.equal(conVolver.headers.get("location"), "/");

		// El análisis deja la tarea lista para aprobar y con una pregunta que contestar.
		const { valor } = crearTerminalConToken(montaje.db, 1, "portatil-ana", "ana@ejemplo.com");
		const terminalId = valor.terminal.id;
		montaje.db.prepare("UPDATE tareas SET autoejecucion = 0 WHERE id = 1").run();
		tomarTarea(montaje.db, { tareaId: 1, fase: "analisis", terminalId });
		preguntar(montaje.db, {
			tareaId: 1,
			terminalId,
			pregunta: "¿Qué separador usamos?",
			porQueImporta: "La hoja de cálculo está en español.",
			opciones: [
				{ texto: "Punto y coma", consecuencia: "Se abre directamente." },
				{ texto: "No hacer nada", consecuencia: "Siguen copiando a mano." },
			],
			recomendacion: "Punto y coma",
		});

		// Un destino que no es una ruta del propio servidor no se sigue.
		const mal = await pedir(montaje, `/tareas/${id}/responder/P1`, {
			cookie,
			formulario: { opcion: "Punto y coma", nota: "", volver: "//mal" },
		});
		assert.equal(mal.headers.get("location"), `/tareas/${id}`);

		comentarAnalisis(montaje.db, { tareaId: 1, terminalId, texto: "Hay que añadir un botón." });
		const aprobada = await pedir(montaje, `/tareas/${id}/aprobar`, { cookie, formulario: { volver: "/" } });
		assert.equal(aprobada.headers.get("location"), "/");

		// Sin campo `volver`, a la ficha, como se ha hecho siempre.
		const sinVolver = await pedir(montaje, `/tareas/${id}/aprobar`, { cookie, formulario: {} });
		assert.equal(sinVolver.headers.get("location"), `/tareas/${id}`);

		const aMano = await pedir(montaje, `/tareas/${id}/mover`, {
			cookie,
			formulario: { estado: "backlog", nota: "Falta decidir el formato.", volver: "//otro.sitio" },
		});
		assert.equal(aMano.headers.get("location"), `/tareas/${id}`);
	} finally {
		await montaje.cerrar();
	}
});

test("la tarjeta de una pregunta abierta se contesta fuera de la ficha y vuelve a donde se pida", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await crearTarea(montaje, cookie, "Exportar clientes", "Hace falta un CSV.");
		await pedir(montaje, "/tareas/T-0001/mover", { cookie, formulario: { estado: "prepared" } });
		const { valor } = crearTerminalConToken(montaje.db, 1, "portatil-ana", "ana@ejemplo.com");
		tomarTarea(montaje.db, { tareaId: 1, fase: "analisis", terminalId: valor.terminal.id });
		const pregunta = preguntar(montaje.db, {
			tareaId: 1,
			terminalId: valor.terminal.id,
			pregunta: "¿Qué separador usamos?",
			porQueImporta: "La hoja de cálculo está en español.",
			opciones: [
				{ texto: "Punto y coma", consecuencia: "Se abre directamente." },
				{ texto: "No hacer nada", consecuencia: "Siguen copiando a mano." },
			],
			recomendacion: "Punto y coma",
		});

		const tarjeta = String(
			await tarjetaPreguntaAbierta({ id: 1, titulo: "Exportar clientes" }, pregunta, { volver: "/" }),
		);
		assert.match(tarjeta, /<strong>¿Qué separador usamos\?<\/strong>/);
		assert.match(tarjeta, /La hoja de cálculo está en español\./);
		assert.match(tarjeta, /action="\/tareas\/T-0001\/responder\/P1"/);
		assert.match(tarjeta, /<input type="hidden" name="volver" value="\/">/);
		assert.match(tarjeta, /<span class="recomendada">recomendada<\/span>/);
		// Sin destino de vuelta no se manda el campo: es lo que hace la ficha.
		assert.doesNotMatch(String(await tarjetaPreguntaAbierta({ id: 1, titulo: "T" }, pregunta)), /name="volver"/);
	} finally {
		await montaje.cerrar();
	}
});

// --- el progreso, los tokens y los filtros de un clic ------------------------

test("los tokens se abrevian: entero, miles con k y millones con una decimal", () => {
	assert.equal(tokensAbreviados(0), "0");
	assert.equal(tokensAbreviados(980), "980");
	assert.equal(tokensAbreviados(999), "999");
	assert.equal(tokensAbreviados(1_000), "1 k");
	assert.equal(tokensAbreviados(184_600), "184 k");
	// Siempre hacia abajo: lo que no se ha gastado no se enseña.
	assert.equal(tokensAbreviados(999_999), "999 k");
	assert.equal(tokensAbreviados(1_200_000), "1,2 M");
});

test("la lista enseña el progreso y los tokens, y filtra por conmutador y por texto", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const { valor } = crearTerminalConToken(montaje.db, 1, "portatil-ana", "ana@ejemplo.com");
		const terminalId = valor.terminal.id;
		const padre = crearTareaHumana(montaje.db, {
			titulo: "Exportar el listado a CSV",
			descripcion: "Los comerciales lo copian a mano.",
			usuarioId: 1,
			analisisTerminalId: terminalId,
			ejecucionTerminalId: terminalId,
		});
		moverTareaHumano(montaje.db, { tareaId: padre.id, usuarioId: 1, estado: "prepared" });
		tomarTarea(montaje.db, { tareaId: padre.id, fase: "analisis", terminalId, modelo: "sonnet" });
		comentarAnalisis(montaje.db, { tareaId: padre.id, terminalId, texto: "Plan." });
		tomarTarea(montaje.db, { tareaId: padre.id, fase: "ejecucion", terminalId, modelo: "opus" });
		const hecha = crearHija(montaje.db, {
			titulo: "Generar el fichero",
			descripcion: "d",
			padreId: padre.id,
			terminalId,
		});
		crearHija(montaje.db, { titulo: "Tests de la exportación", descripcion: "d", padreId: padre.id, terminalId });
		comentarResultado(montaje.db, { tareaId: hecha.id, terminalId, texto: "Hecho. Commit: a1b2c3d" });
		registrarConsumo(montaje.db, {
			tareaId: padre.id,
			fase: "ejecucion",
			modelo: "opus",
			terminalId,
			tokens: 184_600,
			herramientas: 41,
			duracionMs: 1_520_000,
		});
		// Una tarea suelta que no espera por nadie ni tiene consumo.
		const suelta = crearTareaHumana(montaje.db, {
			titulo: "Migrar el envío de correos",
			descripcion: "Se manda todo por una cola.",
			usuarioId: 1,
			analisisTerminalId: terminalId,
			ejecucionTerminalId: terminalId,
		});
		moverTareaHumano(montaje.db, { tareaId: suelta.id, usuarioId: 1, estado: "prepared" });

		const lista = await (await pedir(montaje, "/tareas", { cookie })).text();
		assert.match(lista, /<th class="numero">Tokens<\/th>/);
		// El progreso va detrás del título, al final de la celda.
		assert.match(
			lista,
			/Exportar el listado a CSV <progress class="progreso" value="1" max="2"><\/progress><span class="progreso-texto">hijas 1\/2<\/span>/,
		);
		assert.match(lista, /<td class="numero pequeno">184 k<\/td>/);
		// Sin consumo la celda se queda vacía: un cero no dice nada.
		assert.match(lista, /<td class="numero pequeno"><\/td>/);

		// «Espera por ti»: la hija en done entra; la preparada sin nada pendiente, no.
		const espera = await (await pedir(montaje, "/tareas?rapido=espera", { cookie })).text();
		assert.match(espera, /Generar el fichero/);
		assert.ok(!espera.includes("Migrar el envío de correos"), "una preparada tranquila no espera por nadie");
		// El conmutador puesto se marca y su enlace lo quita.
		assert.match(espera, /<a class="boton-filtro" href="\/tareas" aria-current="true">Espera por ti<\/a>/);
		assert.match(espera, /<input type="hidden" name="rapido" value="espera">/);

		// La búsqueda mira también la descripción.
		const buscado = await (await pedir(montaje, "/tareas?q=cola", { cookie })).text();
		assert.match(buscado, /Migrar el envío de correos/);
		assert.ok(!buscado.includes("Exportar el listado a CSV"), "la búsqueda deja fuera lo que no encaja");
		// Y se combina con el conmutador, que conserva lo buscado.
		assert.match(buscado, /<a class="boton-filtro" href="\/tareas\?q=cola&amp;rapido=espera">Espera por ti<\/a>/);
	} finally {
		await montaje.cerrar();
	}
});

test("el presupuesto se pone en el formulario, se ve en la ficha y avisa cuando se pasa", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		// El formulario de alta lleva la casilla, vacía.
		const nueva = await (await pedir(montaje, "/tareas/nueva", { cookie })).text();
		assert.match(nueva, /<span>Presupuesto en tokens<\/span>/);
		assert.match(nueva, /<input type="number" name="presupuesto" min="0" step="1000" value="">/);
		// Los modelos por defecto: Fable analiza y Opus ejecuta. La ejecución va
		// marcada para que la hoja la esconda cuando el tipo elegido es pregunta.
		assert.match(nueva, /<input type="text" name="analisisModelo" list="modelos" value="fable">/);
		assert.match(nueva, /<fieldset data-fase="ejecucion">/);
		assert.match(nueva, /<input type="text" name="ejecucionModelo" list="modelos" value="opus">/);
		assert.match(nueva, /<label class="casilla" data-casilla="autoejecucion">/);

		const respuesta = await pedir(montaje, "/tareas", {
			cookie,
			formulario: {
				titulo: "Exportar el listado a CSV",
				descripcion: "Los comerciales lo copian a mano.",
				autoejecucion: "on",
				presupuesto: "200000",
				analisisTerminal: "",
				ejecucionTerminal: "",
			},
		});
		assert.equal(respuesta.status, 302);
		assert.equal(exigirTarea(montaje.db, 1).presupuesto, 200_000);

		// La ficha lo enseña en las propiedades y el formulario vuelve con él puesto.
		const conTope = await (await pedir(montaje, "/tareas/T-0001", { cookie })).text();
		assert.match(conTope, /<dt>Presupuesto<\/dt>\s*<dd>200 k<\/dd>/);
		assert.match(conTope, /<input type="number" name="presupuesto" min="0" step="1000" value="200000">/);
		assert.ok(!conTope.includes("marca-sobre-presupuesto"), "sin gasto no hay aviso");

		const { valor } = crearTerminalConToken(montaje.db, 1, "portatil-ana", "ana@ejemplo.com");
		registrarConsumo(montaje.db, {
			tareaId: 1,
			fase: "ejecucion",
			modelo: "opus",
			terminalId: valor.terminal.id,
			tokens: 250_000,
			herramientas: 41,
			duracionMs: 1_520_000,
		});

		const pasada = await (await pedir(montaje, "/tareas/T-0001", { cookie })).text();
		assert.match(pasada, /<span class="insignia marca-sobre-presupuesto color-naranja">Sobre presupuesto<\/span>/);
		// El consumo se lee contra el tope.
		assert.match(pasada, /<strong>250\.000 de 200\.000<\/strong>/);
		// Y la fila de la lista pinta lo gastado sobre el tope.
		const lista = await (await pedir(montaje, "/tareas", { cookie })).text();
		assert.match(lista, /<td class="numero pequeno">250 k \/ 200 k<\/td>/);
		assert.match(lista, /<span class="insignia marca-sobre-presupuesto color-naranja">Sobre presupuesto<\/span>/);

		// Quitarlo deja la tarea sin tope y sin marca, y deja rastro en los dos sentidos.
		const edicion = (presupuesto: string): Promise<Response> =>
			pedir(montaje, "/tareas/T-0001/editar", {
				cookie,
				formulario: {
					titulo: "Exportar el listado a CSV",
					descripcion: "Los comerciales lo copian a mano.",
					tipo: "tarea",
					rama: "",
					padre: "",
					autoejecucion: "on",
					presupuesto,
					analisisTerminal: "",
					ejecucionTerminal: "",
				},
			});
		assert.equal((await edicion("")).status, 302);
		assert.equal(exigirTarea(montaje.db, 1).presupuesto, null);
		const sinTope = await (await pedir(montaje, "/tareas/T-0001", { cookie })).text();
		assert.match(sinTope, /<dt>Presupuesto<\/dt>\s*<dd><span class="silencio">sin presupuesto<\/span><\/dd>/);
		assert.ok(!sinTope.includes("marca-sobre-presupuesto"), "sin tope no hay nada que pasarse");
		assert.equal((await edicion("300000")).status, 302);

		assert.deepEqual(
			actividadDe(montaje.db, "tarea", 1)
				.filter((fila) => fila.accion === "editar_tarea")
				.map((fila) => fila.detalle),
			["presupuesto: 200 k → —", "presupuesto: — → 300 k"],
		);

		// Lo que no es un número no se guarda: se vuelve a la ficha con el aviso.
		const mala = await edicion("abc");
		assert.equal(mala.status, 422);
		assert.match(await mala.text(), /El presupuesto se escribe en tokens, con un número entero de 0 en adelante\./);
		assert.equal(exigirTarea(montaje.db, 1).presupuesto, 300_000);
	} finally {
		await montaje.cerrar();
	}
});

test("el tema tiene tres opciones, se aplica antes de pintar y la hoja lo sigue", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const cuerpo = await (await pedir(montaje, "/tareas", { cookie })).text();

		// El conmutador: tres radios en un grupo, con «Sistema» puesto de salida.
		assert.match(cuerpo, /<fieldset class="tema">\s*<legend>Tema<\/legend>/);
		for (const valor of ["claro", "oscuro", "sistema"]) {
			assert.match(cuerpo, new RegExp(`<input type="radio" name="tema" value="${valor}"`));
		}
		assert.match(cuerpo, /<input type="radio" name="tema" value="sistema" checked>/);

		// El script del tema va antes de la hoja: sin él la página parpadearía en
		// el tema del sistema. Es el único JavaScript en línea, y no evalúa nada.
		const script = cuerpo.indexOf('<script>try{var t=localStorage.getItem("tema")');
		assert.ok(script > 0, "el script del tema está en la cabecera");
		assert.ok(script < cuerpo.indexOf("/static/app.css"), "y antes de la hoja de estilos");
		assert.ok(!cuerpo.includes("new Function("), "nada de new Function");
		assert.ok(!cuerpo.includes('style="'), "ningún estilo en línea");

		// La hoja define los tres bloques de tema y el color de la señal.
		const css = await (await pedir(montaje, "/static/app.css")).text();
		for (const trozo of ['[data-tema="oscuro"]', '[data-tema="claro"]', "--turno"]) {
			assert.ok(css.includes(trozo), `la hoja define ${trozo}`);
		}
		// Los nueve colores también siguen al tema elegido, no solo al del sistema.
		assert.match(css, /:root\[data-tema="oscuro"\] \.color-azul \{/);

		// Y el cliente guarda y aplica la preferencia.
		const js = await (await pedir(montaje, "/static/app.js")).text();
		assert.match(js, /localStorage\.setItem\("tema"/);
		assert.match(js, /localStorage\.removeItem\("tema"\)/);
	} finally {
		await montaje.cerrar();
	}
});

test("nada de lo que se ve enseña un nombre interno: estados, marcas y fases", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		crearTerminalConToken(montaje.db, 1, "portatil-ana", "ana@ejemplo.com");
		const id = await crearTarea(montaje, cookie, "Exportar clientes", "Hace falta un CSV.");
		await pedir(montaje, `/tareas/${id}/mover`, { cookie, formulario: { estado: "prepared" } });
		tomarTarea(montaje.db, { tareaId: 1, fase: "analisis", terminalId: 1, modelo: "sonnet" });
		comentarAnalisis(montaje.db, { tareaId: 1, terminalId: 1, texto: "Plan." });
		registrarConsumo(montaje.db, {
			tareaId: 1,
			fase: "analisis",
			modelo: "sonnet",
			tokens: 31_500,
			herramientas: 6,
			duracionMs: 87_000,
			terminalId: 1,
		});

		// La clase lleva el nombre interno; el texto, el del vocabulario.
		const ficha = await (await pedir(montaje, `/tareas/${id}`, { cookie })).text();
		assert.match(ficha, /<span class="insignia estado-prepared color-azul">Preparada<\/span>/);
		assert.match(ficha, /<td>Análisis<\/td>/);
		assert.match(ficha, /<span class="insignia tipo-analisis color-azul">Análisis<\/span>/);

		// En la lista, el rótulo de cada grupo dice la columna en plural.
		const lista = await (await pedir(montaje, "/tareas", { cookie })).text();
		assert.match(lista, /<span class="insignia estado-prepared color-azul">Preparadas<\/span>/);

		for (const pagina of [lista, ficha, await (await pedir(montaje, "/tareas/kanban", { cookie })).text()]) {
			for (const crudo of [">backlog<", ">prepared<", ">doing<", ">done<", ">finished<", ">analisis<", ">ejecucion<"]) {
				assert.ok(!pagina.includes(crudo), `no se ve «${crudo}»`);
			}
		}
	} finally {
		await montaje.cerrar();
	}
});

/**
 * Un `<li>` del ciclo, con sus clases y lo que dice. La lista es la misma en
 * todas las fichas: cinco pasos en el mismo orden.
 */
function paso(cuerpo: string, nombre: string): string {
	const ciclo = cuerpo.match(/<ol class="ciclo">[\s\S]*?<\/ol>/);
	assert.ok(ciclo !== null, "la ficha no lleva el ciclo");
	const pasos = ciclo[0].split("<li").slice(1);
	assert.equal(pasos.length, 5, "el ciclo tiene cinco pasos");
	const encontrado = pasos.find((trozo) => trozo.includes(`<span class="paso-nombre">${nombre}</span>`));
	assert.ok(encontrado !== undefined, `no aparece el paso «${nombre}»`);
	return encontrado;
}

test("la ficha enseña el ciclo con el paso actual, su dueño y qué pasa ahora", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		crearTerminalConToken(montaje.db, 1, "portatil-ana", "ana@ejemplo.com");

		// Preparada y sin análisis: el turno es del agente, no del humano.
		const estudiando = crearTareaHumana(montaje.db, { titulo: "Exportar clientes", descripcion: ".", usuarioId: 1 });
		moverTareaHumano(montaje.db, { tareaId: estudiando.id, usuarioId: 1, estado: "prepared" });
		const enAnalisis = await (await pedir(montaje, `/tareas/${formatearId(estudiando.id)}`, { cookie })).text();
		const preparada = paso(enAnalisis, "Preparada");
		assert.match(preparada, / class="agente" aria-current="step"/);
		assert.match(preparada, /<span class="paso-dueno">el agente<\/span>/);
		assert.match(preparada, /El agente de análisis la está estudiando/);
		// Por definir ya pasó; En curso todavía no, así que no dice nada.
		assert.match(paso(enAnalisis, "Por definir"), / class="pasado"/);
		assert.doesNotMatch(paso(enAnalisis, "En curso"), /paso-ahora/);

		// Con una pregunta abierta el turno se le da la vuelta al humano.
		tomarTarea(montaje.db, { tareaId: estudiando.id, fase: "analisis", terminalId: 1, modelo: "sonnet" });
		preguntar(montaje.db, {
			tareaId: estudiando.id,
			terminalId: 1,
			pregunta: "¿Qué separador?",
			porQueImporta: "La hoja está en español.",
			opciones: [
				{ texto: "Punto y coma", consecuencia: "Se abre." },
				{ texto: "No hacer nada", consecuencia: "Siguen a mano." },
			],
			recomendacion: "Punto y coma",
		});
		const bloqueada = await (await pedir(montaje, `/tareas/${formatearId(estudiando.id)}`, { cookie })).text();
		assert.match(paso(bloqueada, "Preparada"), / class="turno" aria-current="step"/);
		assert.match(paso(bloqueada, "Preparada"), /Espera tu respuesta a P1/);
		// El paso actual dice de quién es el turno de verdad, no de quién es la
		// columna: está en la del agente y espera por el humano.
		assert.match(paso(bloqueada, "Preparada"), /<span class="paso-dueno">tú<\/span>/);
		// Los demás siguen diciendo el dueño de su columna.
		assert.match(paso(bloqueada, "En curso"), /<span class="paso-dueno">el agente<\/span>/);

		// Hecha: el resultado espera por el humano.
		const hecha = crearTareaHumana(montaje.db, { titulo: "Subir el informe", descripcion: ".", usuarioId: 1 });
		moverTareaHumano(montaje.db, { tareaId: hecha.id, usuarioId: 1, estado: "prepared" });
		tomarTarea(montaje.db, { tareaId: hecha.id, fase: "analisis", terminalId: 1, modelo: "sonnet" });
		comentarAnalisis(montaje.db, { tareaId: hecha.id, terminalId: 1, texto: "Plan." });
		tomarTarea(montaje.db, { tareaId: hecha.id, fase: "ejecucion", terminalId: 1, modelo: "opus" });
		comentarResultado(montaje.db, { tareaId: hecha.id, terminalId: 1, texto: "Hecho. Commit: a1b2c3d" });
		const revisar = await (await pedir(montaje, `/tareas/${formatearId(hecha.id)}`, { cookie })).text();
		assert.match(paso(revisar, "Hecha"), / class="turno" aria-current="step"/);
		assert.match(paso(revisar, "Hecha"), /Revisa el resultado/);

		// Una pregunta no se ejecuta: su paso En curso se salta y no tiene dueño.
		const duda = crearTareaHumana(montaje.db, {
			titulo: "¿Cuánto cuesta un informe?",
			descripcion: ".",
			usuarioId: 1,
			tipo: "pregunta",
		});
		const suya = await (await pedir(montaje, `/tareas/${formatearId(duda.id)}`, { cookie })).text();
		const saltado = paso(suya, "En curso");
		assert.match(saltado, / class="omitido"/);
		assert.doesNotMatch(saltado, /paso-dueno/);
	} finally {
		await montaje.cerrar();
	}
});

test("«Espera por ti» sale en la lista, el tablero y la ficha, y solo donde toca", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		crearTerminalConToken(montaje.db, 1, "portatil-ana", "ana@ejemplo.com");

		const hecha = crearTareaHumana(montaje.db, { titulo: "Subir el informe", descripcion: ".", usuarioId: 1 });
		moverTareaHumano(montaje.db, { tareaId: hecha.id, usuarioId: 1, estado: "prepared" });
		tomarTarea(montaje.db, { tareaId: hecha.id, fase: "analisis", terminalId: 1, modelo: "sonnet" });
		comentarAnalisis(montaje.db, { tareaId: hecha.id, terminalId: 1, texto: "Plan." });
		tomarTarea(montaje.db, { tareaId: hecha.id, fase: "ejecucion", terminalId: 1, modelo: "opus" });
		comentarResultado(montaje.db, { tareaId: hecha.id, terminalId: 1, texto: "Hecho. Commit: a1b2c3d" });

		// En curso y sin marcas: la trabaja el agente, no espera por nadie.
		const enCurso = crearTareaHumana(montaje.db, { titulo: "Migrar el correo", descripcion: ".", usuarioId: 1 });
		moverTareaHumano(montaje.db, { tareaId: enCurso.id, usuarioId: 1, estado: "prepared" });
		tomarTarea(montaje.db, { tareaId: enCurso.id, fase: "analisis", terminalId: 1, modelo: "sonnet" });
		comentarAnalisis(montaje.db, { tareaId: enCurso.id, terminalId: 1, texto: "Plan." });
		tomarTarea(montaje.db, { tareaId: enCurso.id, fase: "ejecucion", terminalId: 1, modelo: "opus" });

		// Por definir no lleva la señal: la tarea todavía no bloquea a nadie.
		crearTareaHumana(montaje.db, { titulo: "Idea suelta", descripcion: ".", usuarioId: 1 });

		const señal = '<span class="insignia turno">Espera por ti</span>';
		for (const ruta of ["/tareas", "/tareas/kanban"]) {
			const cuerpo = await (await pedir(montaje, ruta, { cookie })).text();
			assert.equal(cuerpo.split(señal).length - 1, 1, `${ruta}: solo la hecha espera por el humano`);
			const suyo = cuerpo.slice(cuerpo.indexOf(formatearId(hecha.id)) - 400, cuerpo.indexOf(formatearId(hecha.id)) + 400);
			assert.ok(suyo.includes(señal), `${ruta}: la etiqueta va con la tarea hecha`);
		}

		// En el tablero la tarjeta lleva además el filete de la izquierda.
		const tablero = await (await pedir(montaje, "/tareas/kanban", { cookie })).text();
		assert.match(tablero, new RegExp(`<article class="tarjeta espera" data-id="${formatearId(hecha.id)}"`));
		assert.match(tablero, new RegExp(`<article class="tarjeta" data-id="${formatearId(enCurso.id)}"`));

		const ficha = await (await pedir(montaje, `/tareas/${formatearId(hecha.id)}`, { cookie })).text();
		assert.ok(ficha.includes(señal));
		const otra = await (await pedir(montaje, `/tareas/${formatearId(enCurso.id)}`, { cookie })).text();
		assert.ok(!otra.includes(señal));
	} finally {
		await montaje.cerrar();
	}
});

test("Tareas es una sección con dos vistas, y el conmutador conserva los filtros", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);

		const lista = await (await pedir(montaje, "/tareas?estado=doing", { cookie })).text();
		assert.match(lista, /<nav class="vistas" aria-label="Cómo ver las tareas">/);
		assert.match(lista, /<a href="\/tareas\?estado=doing" aria-current="page">Lista<\/a>/);
		assert.match(lista, /<a href="\/tareas\/kanban\?estado=doing">Tablero<\/a>/);
		// La sección se llama Tareas en las dos vistas; «kanban» no se lee.
		assert.match(lista, /<h1>Tareas<\/h1>/);
		assert.match(lista, /<p class="proposito">Las tareas del proyecto, agrupadas por funcionalidad\.<\/p>/);

		const tablero = await (await pedir(montaje, "/tareas/kanban?estado=doing", { cookie })).text();
		assert.match(tablero, /<a href="\/tareas\/kanban\?estado=doing" aria-current="page">Tablero<\/a>/);
		assert.match(tablero, /<a href="\/tareas\?estado=doing">Lista<\/a>/);
		assert.match(tablero, /<h1>Tareas<\/h1>/);
		for (const cuerpo of [lista, tablero]) {
			assert.ok(!cuerpo.toLowerCase().includes(">kanban<"), "la palabra kanban no se ve");
		}

		// Las dos vistas se agrupan igual: la agrupación viaja con el conmutador.
		const porColumnas = await (await pedir(montaje, "/tareas/kanban?agrupar=no", { cookie })).text();
		assert.match(porColumnas, /<a href="\/tareas\?agrupar=no">Lista<\/a>/);
	} finally {
		await montaje.cerrar();
	}
});

test("cada pantalla con sesión dice para qué sirve", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const rutas = [
			"/",
			"/tareas",
			"/tareas/kanban",
			"/tareas/nueva",
			"/funcionalidades",
			"/informes",
			"/actividad",
			"/proyectos",
			"/terminales",
			"/usuarios",
		];
		for (const ruta of rutas) {
			const cuerpo = await (await pedir(montaje, ruta, { cookie })).text();
			assert.match(cuerpo, /<p class="proposito">[^<]+<\/p>/, `${ruta} no dice para qué sirve`);
		}
	} finally {
		await montaje.cerrar();
	}
});
