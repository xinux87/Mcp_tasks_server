import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Hono } from "hono";
import { crearApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { buscarTerminalPorToken, crearTerminalConToken } from "../src/auth/tokens.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { listarTerminales, listarUsuarios } from "../src/db/admin.ts";
import { crearUsuario } from "../src/db/consultas.ts";
import { comentarAnalisis, preguntar } from "../src/db/hilo.ts";
import { leerTarea, tomarTarea } from "../src/db/tareas.ts";
import { BASE_URL_PRUEBA, CONFIG_PRUEBA } from "./comun.ts";

type Montaje = {
	db: DatabaseSync;
	app: Hono;
	cerrar: () => Promise<void>;
};

/** Base en memoria con un usuario, y la app entera montada, sin abrir puerto. */
function montar(): Montaje {
	const db = abrirBaseDeDatos(":memory:");
	crearUsuario(db, "xinux", hashPassword("secreta"));
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
		formulario: { usuario: "xinux", password: "secreta", volver: "/tareas" },
	});
	assert.equal(respuesta.status, 302);
	return cookieDeSesion(respuesta);
}

/** El trozo de la lista que va desde el título de un grupo hasta el siguiente. */
function grupo(cuerpo: string, titulo: string): string {
	const inicio = cuerpo.indexOf(`<h2>${titulo} `);
	assert.ok(inicio >= 0, `no aparece el grupo «${titulo}»`);
	const resto = cuerpo.slice(inicio + 4);
	const fin = resto.indexOf("<h2");
	return fin < 0 ? resto : resto.slice(0, fin);
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
			formulario: { usuario: "xinux", password: "otra", volver: "/tareas" },
		});
		assert.equal(mala.status, 401);
		assert.match(await mala.text(), /Usuario o contraseña incorrectos/);

		const buena = await pedir(montaje, "/login", {
			formulario: { usuario: "xinux", password: "secreta", volver: "/tareas" },
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
		assert.match(grupo(cuerpoLista, "Backlog"), /T-0001/);
		assert.match(grupo(cuerpoLista, "Preparadas"), /Ninguna\./);

		const ficha = await pedir(montaje, "/tareas/T-0001", { cookie });
		assert.equal(ficha.status, 200);
		const cuerpoFicha = await ficha.text();
		assert.match(cuerpoFicha, /Exportar clientes a CSV/);
		// La descripción llega renderizada por markdown-it, no en crudo.
		assert.match(cuerpoFicha, /<strong>negrita<\/strong>/);
		assert.match(cuerpoFicha, /sin asignar/);
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
		assert.match(await enPrepared.text(), /<span class="insignia estado-prepared">prepared<\/span>/);

		const sinNota = await pedir(montaje, `/tareas/${id}/mover`, { cookie, formulario: { estado: "backlog", nota: "" } });
		assert.equal(sinNota.status, 422);
		assert.match(await sinNota.text(), /es una vuelta atrás: hace falta una nota/);

		const conNota = await pedir(montaje, `/tareas/${id}/mover`, {
			cookie,
			formulario: { estado: "backlog", nota: "Falta decidir el formato." },
		});
		assert.equal(conNota.status, 302);
		const vuelta = await pedir(montaje, `/tareas/${id}`, { cookie });
		const cuerpo = await vuelta.text();
		assert.match(cuerpo, /<span class="insignia estado-backlog">backlog<\/span>/);
		assert.match(cuerpo, /Falta decidir el formato\./);
		assert.match(cuerpo, /class="insignia tipo-nota"/);
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
		const { valor } = crearTerminalConToken(montaje.db, 1, "portatil-xinux", "xinux@ejemplo.com");
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
		assert.match(cuerpo, /class="insignia marca-bloqueada"/);

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

test("un terminal se crea con su token, se lista y se revoca", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const alta = await pedir(montaje, "/terminales", {
			cookie,
			formulario: { nombre: "portatil-xinux", cuenta: "xinux@ejemplo.com" },
		});
		assert.equal(alta.status, 200);
		const cuerpoAlta = await alta.text();
		const encaje = /<code class="token">([A-Za-z0-9_-]+)<\/code>/.exec(cuerpoAlta);
		const token = encaje?.[1] ?? "";
		assert.equal(token.length, 43);
		assert.notEqual(buscarTerminalPorToken(montaje.db, token), undefined);

		const lista = await pedir(montaje, "/terminales", { cookie });
		const cuerpoLista = await lista.text();
		assert.match(cuerpoLista, /portatil-xinux/);
		assert.match(cuerpoLista, />activo</);
		assert.match(cuerpoLista, /sin datos/);

		const terminalId = listarTerminales(montaje.db)[0]?.id ?? 0;
		const confirmacion = await pedir(montaje, `/terminales/${terminalId}/revocar`, { cookie });
		assert.equal(confirmacion.status, 200);
		assert.match(await confirmacion.text(), /Sí, revocar/);

		const revocado = await pedir(montaje, `/terminales/${terminalId}/revocar`, { cookie, formulario: {} });
		assert.equal(revocado.status, 302);
		assert.equal(buscarTerminalPorToken(montaje.db, token), undefined);
		assert.match(await (await pedir(montaje, "/terminales", { cookie })).text(), /revocado /);
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
		for (const ruta of ["/tareas", "/tareas/nueva", "/terminales", "/usuarios"]) {
			const respuesta = await pedir(montaje, ruta, { cookie });
			assert.equal(respuesta.status, 200, ruta);
			assert.equal(respuesta.headers.get("content-type"), "text/html; charset=UTF-8", ruta);
			assert.match(await respuesta.text(), /<html lang="es">/, ruta);
		}
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
