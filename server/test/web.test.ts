import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Hono } from "hono";
import { crearApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { buscarTerminalPorToken, crearTerminalConToken } from "../src/auth/tokens.ts";
import type { Config } from "../src/config.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { listarTerminales, listarUsuarios } from "../src/db/admin.ts";
import { COLORES_USUARIO } from "../src/db/colores.ts";
import { crearUsuario } from "../src/db/consultas.ts";
import { comentarAnalisis, preguntar } from "../src/db/hilo.ts";
import { exigirTarea, leerTarea, tomarTarea } from "../src/db/tareas.ts";
import { BASE_URL_PRUEBA, CONFIG_PRUEBA } from "./comun.ts";

type Montaje = {
	db: DatabaseSync;
	app: Hono;
	cerrar: () => Promise<void>;
};

/** Base en memoria con un usuario, y la app entera montada, sin abrir puerto. */
function montar(config: Config = CONFIG_PRUEBA): Montaje {
	const db = abrirBaseDeDatos(":memory:");
	crearUsuario(db, "xinux", hashPassword("secreta"));
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
		formulario: { usuario: "xinux", password: "secreta", volver: "/tareas" },
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
	const encontrado = trozos.find((trozo) => trozo.includes(`</span> ${titulo} <span class="contador"`));
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
		// El grupo se encabeza con la etiqueta del estado, el título y el contador.
		assert.match(
			cuerpoLista,
			/<span class="insignia estado-backlog color-gris">backlog<\/span> Backlog <span class="contador">1<\/span>/,
		);
		const backlog = grupo(cuerpoLista, "Backlog");
		assert.match(backlog, /T-0001/);
		// «Creada por» enseña el chip de quien la creó, con su color.
		assert.match(backlog, /<span class="chip color-\w+"><span class="inicial">X<\/span>xinux<\/span>/);
		assert.match(grupo(cuerpoLista, "Preparadas"), /Ninguna\./);
		// La lista arranca con «cabeceraPagina» y su acción principal.
		assert.match(cuerpoLista, /<header class="cabecera-pagina">/);
		assert.match(cuerpoLista, /<a class="boton principal" href="\/tareas\/nueva">Nueva tarea<\/a>/);
		// Sin filtros puestos no hay nada que quitar.
		assert.doesNotMatch(cuerpoLista, /Quitar filtros/);
		assert.match(await (await pedir(montaje, "/tareas?estado=backlog", { cookie })).text(), /Quitar filtros/);

		const ficha = await pedir(montaje, "/tareas/T-0001", { cookie });
		assert.equal(ficha.status, 200);
		const cuerpoFicha = await ficha.text();
		assert.match(cuerpoFicha, /Exportar clientes a CSV/);
		// La descripción llega renderizada por markdown-it, no en crudo.
		assert.match(cuerpoFicha, /<strong>negrita<\/strong>/);
		assert.match(cuerpoFicha, /sin asignar/);
		// Migas «Tareas › T-0001», con la última sin enlace.
		assert.match(cuerpoFicha, /<nav class="migas"[^>]*>\s*<a href="\/tareas">Tareas<\/a>/);
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
		assert.match(cuerpo, /<span class="insignia tipo-pregunta color-rosa">pregunta<\/span>/);
		// Las propiedades de una pregunta llevan Tipo y no llevan ejecución.
		assert.match(cuerpo, /<dt>Tipo<\/dt>/);
		assert.doesNotMatch(cuerpo, /<dt>Ejecución<\/dt>/);
		assert.doesNotMatch(cuerpo, /<dt>Autoejecución<\/dt>/);
		// Al editarla, el formulario tampoco enseña la ejecución.
		assert.doesNotMatch(cuerpo, /name="ejecucionModelo"/);
		// El desplegable de tipo vuelve con la pregunta elegida.
		assert.match(cuerpo, /<option value="pregunta" selected>Pregunta<\/option>/);
		// Y en la lista, su columna de ejecución queda vacía.
		const lista = await (await pedir(montaje, "/tareas", { cookie })).text();
		assert.match(lista, /<th>Creada por<\/th>/);
		assert.match(lista, /<td class="pequeno">—<\/td>/);

		// El kanban la marca igual en su tarjeta.
		const kanban = await pedir(montaje, "/tareas/kanban", { cookie });
		assert.match(await kanban.text(), /<span class="insignia tipo-pregunta color-rosa">pregunta<\/span>/);
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
		assert.match(await enPrepared.text(), /<span class="insignia estado-prepared color-azul">prepared<\/span>/);

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
		assert.match(cuerpo, /<span class="insignia estado-backlog color-gris">backlog<\/span>/);
		assert.match(cuerpo, /Falta decidir el formato\./);
		assert.match(cuerpo, /class="insignia tipo-nota color-gris"/);
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
			/<span class="chip color-gris"><span class="inicial">S<\/span>sonnet<span class="terminal">@portatil-xinux<\/span><\/span>/,
		);
		// El humano: el chip de su usuario, con el color que tiene ahora.
		assert.match(cuerpo, /<span class="chip color-\w+"><span class="inicial">X<\/span>xinux<\/span>/);
		assert.match(cuerpo, /<span class="insignia tipo-analisis color-azul">analisis<\/span>/);
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
		assert.match(cuerpo, /<details class="caja">\s*<summary><strong>Volver a backlog<\/strong><\/summary>/);
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
		// La página del token no se refresca sola: una recarga se llevaría por
		// delante lo único que no se vuelve a enseñar.
		assert.doesNotMatch(cuerpoAlta, /data-vista="terminales"/);

		const lista = await pedir(montaje, "/terminales", { cookie });
		const cuerpoLista = await lista.text();
		assert.match(cuerpoLista, /portatil-xinux/);
		assert.match(cuerpoLista, />activo</);
		assert.match(cuerpoLista, /sin datos/);
		// El dueño y quien lo creó van como chip con el color del usuario.
		assert.match(cuerpoLista, /<span class="chip color-azul"><span class="inicial">X<\/span>xinux<\/span>/);
		// La telemetría no mueve la revisión: esta vista se refresca por intervalo.
		assert.match(cuerpoLista, /data-vista="terminales"/);

		const terminalId = listarTerminales(montaje.db)[0]?.id ?? 0;
		const confirmacion = await pedir(montaje, `/terminales/${terminalId}/revocar`, { cookie });
		assert.equal(confirmacion.status, 200);
		assert.match(await confirmacion.text(), /Sí, revocar/);

		const revocado = await pedir(montaje, `/terminales/${terminalId}/revocar`, { cookie, formulario: {} });
		assert.equal(revocado.status, 302);
		assert.equal(buscarTerminalPorToken(montaje.db, token), undefined);
		// La etiqueta dice «revocado» y la fecha va al lado, fuera: dentro no
		// podría partirse y ensancharía la tabla entera.
		const yaRevocado = await (await pedir(montaje, "/terminales", { cookie })).text();
		assert.match(yaRevocado, /<span class="insignia color-gris">revocado<\/span>/);
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
			formulario: { nombre: "portatil-xinux", cuenta: "xinux@ejemplo.com" },
		});
		const token = /<code class="token">([A-Za-z0-9_-]+)<\/code>/.exec(await alta.text())?.[1] ?? "";

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
			assert.match(cuerpo, /<span class="chip color-azul"><span class="inicial">X<\/span>xinux<\/span>/, ruta);
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
			formulario: { nombre: "portatil-xinux", cuenta: "xinux@ejemplo.com" },
		});
		const cuerpo = await alta.text();
		const token = /<code class="token">([A-Za-z0-9_-]+)<\/code>/.exec(cuerpo)?.[1] ?? "";
		assert.equal(token.length, 43);

		// Las direcciones, cada una con su origen. La base es la de las pruebas.
		assert.match(cuerpo, /<code>http:\/\/localhost:3000<\/code><\/td><td class="pequeno">la configurada como base</);
		assert.match(
			cuerpo,
			/<code>http:\/\/192\.168\.50\.5:3000<\/code><\/td><td class="pequeno">configurada en DIRECCIONES</,
		);
		// La recomendada para otra máquina es la privada, no localhost.
		assert.match(cuerpo, /<code>servidor_url<\/code><\/td><td><code>http:\/\/192\.168\.50\.5:3000<\/code>/);
		// El token, dentro del comando sin plugin y dentro del archivo de la statusline.
		assert.match(
			cuerpo,
			new RegExp(
				`claude mcp add --transport http tareas http://192\\.168\\.50\\.5:3000/mcp --header &quot;Authorization: Bearer ${token}&quot;`,
			),
		);
		assert.match(cuerpo, new RegExp(`SERVIDOR_URL=http://192\\.168\\.50\\.5:3000\nTOKEN=${token}`));
		assert.match(cuerpo, /\/plugin install mcp-tareas@mcp-tareas-marketplace/);
		assert.match(cuerpo, /\/loop \/mcp-tareas:tareas/);
		// La advertencia de Docker, que es la trampa de las direcciones detectadas.
		assert.match(cuerpo, /Docker[\s\S]*máquina anfitriona/);
		// Cada bloque de comandos se puede copiar.
		assert.match(
			cuerpo,
			/<div class="bloque-codigo">\s*<button type="button" class="boton pequeno copiar">Copiar<\/button>/,
		);
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
		assert.doesNotMatch(cuerpo, /<code class="token">/);
	} finally {
		await montaje.cerrar();
	}
});
