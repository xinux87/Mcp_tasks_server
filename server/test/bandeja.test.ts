import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Hono } from "hono";
import { crearApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { crearTerminalConToken } from "../src/auth/tokens.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { crearUsuario } from "../src/db/consultas.ts";
import { crearParte } from "../src/db/funcionalidades.ts";
import { comentarAnalisis, comentarResultado, preguntar } from "../src/db/hilo.ts";
import { crearTareaHumana, exigirTarea, moverTareaHumano, type Tarea, tomarTarea } from "../src/db/tareas.ts";
import { formatearId } from "../src/md/ids.ts";
import { BASE_URL_PRUEBA, CONFIG_PRUEBA } from "./comun.ts";

/**
 * La bandeja del humano: `GET /` con lo que espera por él en los cuatro
 * bloques, los contadores de la barra lateral y del título, y las acciones que
 * se lanzan desde aquí sin abrir la ficha.
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
	formulario?: Record<string, string>;
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
		formulario: { usuario: "ana", password: "secreta", volver: "/" },
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

/** El trozo de la bandeja que corresponde a un bloque, buscado por su título. */
function bloque(cuerpo: string, titulo: string): string {
	const trozos = cuerpo.split('<section class="grupo bloque-bandeja">');
	const encontrado = trozos.find((trozo) => trozo.includes(`<h2>${titulo} <span class="contador">`));
	assert.ok(encontrado !== undefined, `no aparece el bloque «${titulo}»`);
	return encontrado;
}

/** Lo que dice el contador del título de un bloque. */
function contador(cuerpo: string, titulo: string): string {
	const encontrado = bloque(cuerpo, titulo).match(/<span class="contador">\((\d+)\)<\/span>/);
	assert.ok(encontrado !== null, `el bloque «${titulo}» no lleva contador`);
	return encontrado[1] ?? "";
}

function tarea(
	db: DatabaseSync,
	titulo: string,
	extra: { autoejecucion?: boolean; tipo?: "funcionalidad" } = {},
): Tarea {
	return crearTareaHumana(db, { titulo, descripcion: "Lo que sea.", usuarioId: 1, ...extra });
}

/** Deja una tarea en `prepared` y con el análisis en marcha, como haría el agente. */
function enAnalisis(db: DatabaseSync, tareaId: number): void {
	moverTareaHumano(db, { tareaId, usuarioId: 1, estado: "prepared" });
	tomarTarea(db, { tareaId, fase: "analisis", terminalId: 1, modelo: "sonnet" });
}

/** Cuándo entró la tarea en su estado, para fabricar edades. */
function envejecer(db: DatabaseSync, tareaId: number, dias: number): void {
	const cuando = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
	db.prepare("UPDATE tareas SET estado_desde = ? WHERE id = ?").run(cuando, tareaId);
}

/** Una pregunta abierta del agente, que es lo que deja la tarea bloqueada. */
function preguntarAlgo(db: DatabaseSync, tareaId: number): void {
	preguntar(db, {
		tareaId,
		terminalId: 1,
		pregunta: "¿Qué separador usamos?",
		porQueImporta: "La hoja de cálculo está en español.",
		opciones: [
			{ texto: "Punto y coma", consecuencia: "Se abre directamente." },
			{ texto: "No hacer nada", consecuencia: "Siguen copiando a mano." },
		],
		recomendacion: "Punto y coma",
	});
}

/** Lo que deja montado `bandejaDePrueba`, una tarea por bloque. */
type Tareas = {
	bloqueada: Tarea;
	porAprobar: Tarea;
	funcionalidad: Tarea;
	hecha: Tarea;
	vieja: Tarea;
	reciente: Tarea;
};

/** Los cuatro bloques con una tarea cada uno, más una de backlog que no toca. */
function bandejaDePrueba(db: DatabaseSync): Tareas {
	const bloqueada = tarea(db, "Exportar clientes");
	enAnalisis(db, bloqueada.id);
	preguntarAlgo(db, bloqueada.id);

	const porAprobar = tarea(db, "Migrar el correo", { autoejecucion: false });
	enAnalisis(db, porAprobar.id);
	comentarAnalisis(db, { tareaId: porAprobar.id, terminalId: 1, texto: "Plan: una cola." });

	const funcionalidad = tarea(db, "Portal de clientes", { tipo: "funcionalidad" });
	enAnalisis(db, funcionalidad.id);
	crearParte(db, { titulo: "La pantalla", descripcion: "Lo que sea.", padreId: funcionalidad.id, terminalId: 1 });
	crearParte(db, { titulo: "El servicio", descripcion: "Lo que sea.", padreId: funcionalidad.id, terminalId: 1 });
	comentarAnalisis(db, { tareaId: funcionalidad.id, terminalId: 1, texto: "Se parte en dos." });

	const hecha = tarea(db, "Subir el informe");
	enAnalisis(db, hecha.id);
	comentarAnalisis(db, { tareaId: hecha.id, terminalId: 1, texto: "Plan: un botón." });
	tomarTarea(db, { tareaId: hecha.id, fase: "ejecucion", terminalId: 1, modelo: "opus" });
	comentarResultado(db, { tareaId: hecha.id, terminalId: 1, texto: "Hecho. Commit: a1b2c3d" });

	const vieja = tarea(db, "Repensar el cobro");
	envejecer(db, vieja.id, 8);
	const reciente = tarea(db, "Idea de ayer");
	envejecer(db, reciente.id, 1);

	return { bloqueada, porAprobar, funcionalidad, hecha, vieja, reciente };
}

test("sin sesión, la bandeja manda al login", async () => {
	const montaje = montar();
	try {
		const respuesta = await pedir(montaje, "/");
		assert.equal(respuesta.status, 302);
		assert.match(respuesta.headers.get("location") ?? "", /^\/login\?volver=/);
	} finally {
		await montaje.cerrar();
	}
});

test("cada cosa pendiente sale en su bloque de la bandeja, y solo en el suyo", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const tareas = bandejaDePrueba(montaje.db);
		const cuerpo = await ver(montaje, cookie, "/");

		assert.equal(contador(cuerpo, "Contesta"), "1");
		assert.equal(contador(cuerpo, "Aprueba"), "2");
		assert.equal(contador(cuerpo, "Revisa"), "1");
		assert.equal(contador(cuerpo, "Define"), "1");

		const preguntas = bloque(cuerpo, "Contesta");
		assert.match(preguntas, /¿Qué separador usamos\?/);
		assert.match(preguntas, new RegExp(`action="/tareas/${formatearId(tareas.bloqueada.codigo)}/responder/P1"`));
		assert.match(preguntas, /<input type="hidden" name="volver" value="\/">/);
		// Cada pendiente es una sola tarjeta con su cabecera: chip de proyecto,
		// identificador, título, quién escribió lo que hay que atender y la edad.
		assert.match(preguntas, /<article class="item">\s*<div class="cabecera-item">/);
		assert.doesNotMatch(cuerpo, /linea-bandeja/);
		assert.match(preguntas, /<span class="insignia proyecto color-azul">DEFAULT<\/span>/);
		assert.match(preguntas, /<span class="chip color-gris"><span class="inicial">S<\/span>sonnet/);

		const aprobar = bloque(cuerpo, "Aprueba");
		assert.match(aprobar, /Plan: una cola\./);
		assert.match(aprobar, /Aprobar ejecución/);
		// Una funcionalidad enseña sus partes encima del botón, que aprueba la
		// descomposición y no una ejecución que no tiene.
		assert.match(aprobar, /Aprobar descomposición/);
		assert.match(aprobar, /La pantalla/);
		assert.match(aprobar, /El servicio/);

		const revisar = bloque(cuerpo, "Revisa");
		assert.match(revisar, /Hecho\. Commit: a1b2c3d/);
		assert.match(revisar, /Finalizar/);
		// El pie es una sola fila: escribir qué falta y pedir otra iteración, o
		// finalizar. Se hace desde aquí, sin abrir la ficha.
		assert.match(
			revisar,
			new RegExp(`<form class="iterar" method="post" action="/tareas/${formatearId(tareas.hecha.codigo)}/comentar">`),
		);
		assert.match(revisar, /<input type="hidden" name="volver" value="\/">/);
		assert.match(revisar, /<input type="text" name="texto" required[^>]*placeholder="Escribe al agente/);
		assert.match(revisar, /<button type="submit" name="iterar" value="1">Pedir otra iteración<\/button>/);

		const backlog = bloque(cuerpo, "Define");
		assert.match(backlog, /Repensar el cobro/);
		assert.match(backlog, /8 d/);
		assert.doesNotMatch(backlog, /Idea de ayer/);

		// Cada tarea, en su bloque y en ningún otro.
		const donde: [Tarea, string][] = [
			[tareas.bloqueada, "Contesta"],
			[tareas.porAprobar, "Aprueba"],
			[tareas.hecha, "Revisa"],
			[tareas.vieja, "Define"],
		];
		for (const [cual, suyo] of donde) {
			const id = formatearId(cual.codigo);
			for (const titulo of ["Contesta", "Aprueba", "Revisa", "Define"]) {
				const trozo = bloque(cuerpo, titulo);
				if (titulo === suyo) {
					assert.match(trozo, new RegExp(`>${id}<`), `${id} tenía que salir en «${titulo}»`);
				} else {
					assert.doesNotMatch(trozo, new RegExp(`>${id}<`), `${id} no tenía que salir en «${titulo}»`);
				}
			}
		}
	} finally {
		await montaje.cerrar();
	}
});

test("una bandeja sin nada pendiente lo dice en los cuatro bloques", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const cuerpo = await ver(montaje, cookie, "/");
		for (const titulo of ["Contesta", "Aprueba", "Revisa", "Define"]) {
			assert.equal(contador(cuerpo, titulo), "0");
			assert.match(bloque(cuerpo, titulo), /Nada pendiente\./);
			// Debajo del verbo, una línea que dice de qué va el bloque.
			assert.match(bloque(cuerpo, titulo), /<p class="que-es">[^<]+<\/p>/);
		}
	} finally {
		await montaje.cerrar();
	}
});

test("se contesta y se finaliza desde la bandeja, sin abrir la ficha", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const tareas = bandejaDePrueba(montaje.db);

		const contestada = await pedir(montaje, `/tareas/${formatearId(tareas.bloqueada.codigo)}/responder/P1`, {
			cookie,
			formulario: { opcion: "Punto y coma", nota: "", volver: "/" },
		});
		assert.equal(contestada.status, 302);
		assert.equal(contestada.headers.get("location"), "/");

		const finalizada = await pedir(montaje, `/tareas/${formatearId(tareas.hecha.codigo)}/mover`, {
			cookie,
			formulario: { estado: "finished", nota: "", volver: "/" },
		});
		assert.equal(finalizada.status, 302);
		assert.equal(finalizada.headers.get("location"), "/");
		assert.equal(exigirTarea(montaje.db, tareas.hecha.id).estado, "finished");

		const cuerpo = await ver(montaje, cookie, "/");
		assert.equal(contador(cuerpo, "Contesta"), "0");
		assert.equal(contador(cuerpo, "Revisa"), "0");
	} finally {
		await montaje.cerrar();
	}
});

test("se pide otra iteración desde la bandeja y la tarea vuelve a En curso", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const tareas = bandejaDePrueba(montaje.db);

		const otra = await pedir(montaje, `/tareas/${formatearId(tareas.hecha.codigo)}/comentar`, {
			cookie,
			formulario: { texto: "Falta el pie del informe.", volver: "/" },
		});
		assert.equal(otra.status, 302);
		assert.equal(otra.headers.get("location"), "/");
		assert.equal(exigirTarea(montaje.db, tareas.hecha.id).estado, "doing");

		// Ya no espera por el humano: lo que espera ahora es el agente.
		assert.equal(contador(await ver(montaje, cookie, "/"), "Revisa"), "0");
	} finally {
		await montaje.cerrar();
	}
});

test("una acción que rompe una regla vuelve a pintar la bandeja con el mensaje", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const suelta = tarea(montaje.db, "Exportar clientes");

		// Aprobar una tarea que está en backlog no vale: no hay análisis que aprobar.
		const respuesta = await pedir(montaje, `/tareas/${formatearId(suelta.codigo)}/aprobar`, {
			cookie,
			formulario: { volver: "/" },
		});
		assert.equal(respuesta.status, 422);
		const cuerpo = await respuesta.text();
		assert.match(cuerpo, /class="aviso"/);
		assert.match(cuerpo, /<h2>Contesta/);
	} finally {
		await montaje.cerrar();
	}
});

test("el contador de pendientes sale en la barra lateral y en el título de cada página", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);

		// Sin nada pendiente, ni número ni prefijo.
		const vacia = await ver(montaje, cookie, "/tareas");
		assert.match(vacia, /<title>Tareas · MCP Tareas<\/title>/);
		assert.doesNotMatch(vacia, /class="enlace-nav" href="\/">Bandeja<span class="contador">/);

		// Una bloqueada, una por aprobar y una hecha: tres pendientes. El backlog
		// sin definir no cuenta, porque no frena a nadie.
		const db = montaje.db;
		const bloqueada = tarea(db, "Exportar clientes");
		enAnalisis(db, bloqueada.id);
		preguntarAlgo(db, bloqueada.id);

		const porAprobar = tarea(db, "Migrar el correo", { autoejecucion: false });
		enAnalisis(db, porAprobar.id);
		comentarAnalisis(db, { tareaId: porAprobar.id, terminalId: 1, texto: "Plan: una cola." });

		const hecha = tarea(db, "Subir el informe");
		enAnalisis(db, hecha.id);
		comentarAnalisis(db, { tareaId: hecha.id, terminalId: 1, texto: "Plan: un botón." });
		tomarTarea(db, { tareaId: hecha.id, fase: "ejecucion", terminalId: 1, modelo: "opus" });
		comentarResultado(db, { tareaId: hecha.id, terminalId: 1, texto: "Hecho. Commit: a1b2c3d" });

		const vieja = tarea(db, "Repensar el cobro");
		envejecer(db, vieja.id, 9);

		const lista = await ver(montaje, cookie, "/tareas");
		assert.match(lista, /<title>\(3\) Tareas · MCP Tareas<\/title>/);
		assert.match(lista, /href="\/">Bandeja<span class="contador">3<\/span>/);

		// Y en cualquier otra página con sesión, que es de lo que se trata.
		assert.match(await ver(montaje, cookie, "/actividad"), /<title>\(3\) Actividad · MCP Tareas<\/title>/);
	} finally {
		await montaje.cerrar();
	}
});
