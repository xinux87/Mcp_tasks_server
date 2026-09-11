import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Hono } from "hono";
import { crearApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { crearTerminalConToken } from "../src/auth/tokens.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { crearUsuario } from "../src/db/consultas.ts";
import { comentarAnalisis, comentarResultado } from "../src/db/hilo.ts";
import { buscarTarea, crearTareaHumana, leerTarea, moverTareaHumano, tomarTarea } from "../src/db/tareas.ts";
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
	json?: unknown;
	cabeceras?: Record<string, string>;
};

/** Petición contra la app en memoria, con la cabecera `Host` que exige Hono. */
async function pedir(montaje: Montaje, ruta: string, opciones: Opciones = {}): Promise<Response> {
	const url = new URL(ruta, BASE_URL_PRUEBA);
	let inicio: RequestInit = {};
	if (opciones.formulario !== undefined) {
		inicio = {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams(opciones.formulario).toString(),
		};
	} else if (opciones.json !== undefined) {
		inicio = {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(opciones.json),
		};
	}
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

/** Entra con el usuario de prueba y devuelve su cookie de sesión. */
async function entrar(montaje: Montaje): Promise<string> {
	const respuesta = await pedir(montaje, "/login", {
		formulario: { usuario: "xinux", password: "secreta", volver: "/tareas" },
	});
	assert.equal(respuesta.status, 302);
	const bruto = respuesta.headers.get("set-cookie") ?? "";
	const primera = bruto.split(";")[0] ?? "";
	assert.ok(primera.startsWith("sesion="), `la cookie no se llama sesion: ${primera}`);
	return primera;
}

/** Crea una tarea desde la web y devuelve su identificador visible. */
async function crearTarea(montaje: Montaje, cookie: string, titulo: string): Promise<string> {
	const respuesta = await pedir(montaje, "/tareas", {
		cookie,
		formulario: { titulo, descripcion: "Lo que sea.", autoejecucion: "on", analisisTerminal: "", ejecucionTerminal: "" },
	});
	assert.equal(respuesta.status, 302);
	return (respuesta.headers.get("location") ?? "").slice("/tareas/".length);
}

/** El cuerpo de un 422 o un 404 del kanban: `{ codigo, mensaje }`. */
async function fallo(respuesta: Response): Promise<{ codigo: string; mensaje: string }> {
	const cuerpo: unknown = await respuesta.json();
	assert.ok(typeof cuerpo === "object" && cuerpo !== null, "se esperaba un objeto JSON");
	const objeto = cuerpo as Record<string, unknown>;
	return { codigo: String(objeto.codigo), mensaje: String(objeto.mensaje) };
}

test("el kanban pinta las cinco columnas con sus tarjetas", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await crearTarea(montaje, cookie, "Exportar clientes a CSV");
		await crearTarea(montaje, cookie, "Migrar el envío de correos");

		const respuesta = await pedir(montaje, "/tareas/kanban", { cookie });
		assert.equal(respuesta.status, 200);
		const cuerpo = await respuesta.text();

		for (const estado of ["backlog", "prepared", "doing", "done", "finished"]) {
			assert.ok(cuerpo.includes(`data-estado="${estado}"`), `falta la columna ${estado}`);
		}
		for (const titulo of ["Backlog", "Preparadas", "En curso", "Hechas", "Cerradas"]) {
			assert.ok(cuerpo.includes(titulo), `falta el título de columna ${titulo}`);
		}
		assert.match(cuerpo, /data-id="T-0001"/);
		assert.match(cuerpo, /data-id="T-0002"/);
		// El cliente necesita saber qué vista es y de qué revisión parte.
		assert.match(cuerpo, /data-vista="kanban"/);
		assert.match(cuerpo, /<body data-vista="kanban" data-revision="\d+">/);
		assert.match(cuerpo, /sin asignar/);
		assert.match(cuerpo, /<script type="module" src="\/static\/app\.js"><\/script>/);
		// Cabecera de página con su acción, y el tablero a todo lo ancho.
		assert.match(cuerpo, /<div class="dentro dentro-completo">/);
		assert.match(cuerpo, /<header class="cabecera-pagina">[\s\S]*?<h1>Kanban<\/h1>/);
		assert.match(cuerpo, /<a class="boton principal" href="\/tareas\/nueva">Nueva tarea<\/a>/);
		// Cada columna se encabeza con la etiqueta de su estado y el contador.
		assert.match(
			cuerpo,
			/<span class="insignia estado-backlog color-gris">backlog<\/span> Backlog <span class="contador">2<\/span>/,
		);
		// Los filtros son una fila de desplegables, sin caja alrededor.
		assert.match(cuerpo, /<form class="filtros" method="get" action="\/tareas\/kanban">/);
		assert.doesNotMatch(cuerpo, /Quitar filtros/);
		const filtrado = await pedir(montaje, "/tareas/kanban?marca=bloqueada", { cookie });
		assert.match(await filtrado.text(), /<a class="quitar" href="\/tareas\/kanban">Quitar filtros<\/a>/);
	} finally {
		await montaje.cerrar();
	}
});

test("el tablero filtrado por funcionalidad solo trae sus partes", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const evolutivo = crearTareaHumana(montaje.db, {
			titulo: "Listados para comerciales",
			descripcion: "Hoy los copian a mano.",
			usuarioId: 1,
			tipo: "funcionalidad",
			rama: "evolutivo/csv",
		});
		crearTareaHumana(montaje.db, {
			titulo: "Sacar los datos del listado",
			descripcion: "Con sus filtros.",
			usuarioId: 1,
			padreId: evolutivo.id,
		});
		await crearTarea(montaje, cookie, "Nada que ver con el evolutivo");

		// En el tablero global están las tres, y la funcionalidad lleva su progreso.
		const todo = await (await pedir(montaje, "/tareas/kanban", { cookie })).text();
		assert.match(todo, /data-id="T-0003"/);
		assert.match(todo, /<span class="insignia tipo-funcionalidad color-azul">funcionalidad · 0\/1<\/span>/);
		assert.match(todo, /<a class="parte-de" href="\/tareas\/T-0001">Listados para comerciales<\/a>/);

		// Filtrado por la funcionalidad, solo sus partes: ni ella misma ni las sueltas.
		const partes = await (await pedir(montaje, "/tareas/kanban?padre=T-0001", { cookie })).text();
		assert.match(partes, /data-id="T-0002"/);
		assert.ok(!partes.includes('data-id="T-0001"'), "la funcionalidad no es parte de sí misma");
		assert.ok(!partes.includes('data-id="T-0003"'), "una tarea suelta no es parte de la funcionalidad");
		assert.match(partes, /data-fuente="\/tareas\/kanban\/tablero\?padre=T-0001"/);
		assert.match(partes, /<a class="quitar" href="\/tareas\/kanban">Quitar filtros<\/a>/);

		// Y el fragmento suelto se sirve con el mismo filtro.
		const fragmento = await (await pedir(montaje, "/tareas/kanban/tablero?padre=T-0001", { cookie })).text();
		assert.match(fragmento, /data-id="T-0002"/);
		assert.ok(!fragmento.includes('data-id="T-0003"'));
	} finally {
		await montaje.cerrar();
	}
});

test("el fragmento del tablero se sirve solo, con los mismos filtros", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await crearTarea(montaje, cookie, "Exportar clientes a CSV");

		const respuesta = await pedir(montaje, "/tareas/kanban/tablero", { cookie });
		assert.equal(respuesta.status, 200);
		const cuerpo = await respuesta.text();
		assert.ok(cuerpo.trimStart().startsWith('<section id="tablero"'), `no es el fragmento: ${cuerpo.slice(0, 60)}`);
		assert.ok(!cuerpo.includes("<html"), "el fragmento no debe traer la página entera");
		assert.match(cuerpo, /data-revision="\d+"/);
		assert.match(cuerpo, /data-id="T-0001"/);

		// Con un filtro de marca que no cumple ninguna, el tablero queda vacío.
		const filtrado = await pedir(montaje, "/tareas/kanban/tablero?marca=bloqueada", { cookie });
		assert.equal(filtrado.status, 200);
		assert.ok(!(await filtrado.text()).includes('data-id="T-0001"'));
	} finally {
		await montaje.cerrar();
	}
});

test("la columna de cerradas enseña las diez últimas y enlaza a la lista", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const { valor } = crearTerminalConToken(montaje.db, 1, "portatil-xinux", "xinux@ejemplo.com");
		const terminalId = valor.terminal.id;

		// Once tareas hasta `finished`, que es el camino completo: el humano las
		// prepara, el agente las analiza y las ejecuta, y el humano las cierra.
		for (let numero = 1; numero <= 11; numero += 1) {
			await crearTarea(montaje, cookie, `Cerrada ${numero}`);
			moverTareaHumano(montaje.db, { tareaId: numero, usuarioId: 1, estado: "prepared" });
			tomarTarea(montaje.db, { tareaId: numero, fase: "analisis", terminalId });
			comentarAnalisis(montaje.db, { tareaId: numero, terminalId, texto: "Poca cosa." });
			tomarTarea(montaje.db, { tareaId: numero, fase: "ejecucion", terminalId });
			comentarResultado(montaje.db, { tareaId: numero, terminalId, texto: "Hecho. Commit: a1b2c3d" });
			moverTareaHumano(montaje.db, { tareaId: numero, usuarioId: 1, estado: "finished" });
		}

		const cuerpo = await (await pedir(montaje, "/tareas/kanban", { cookie })).text();
		const columna = cuerpo.slice(cuerpo.indexOf('data-estado="finished"'));
		const tarjetas = columna.match(/data-id="T-\d{4}"/g) ?? [];
		assert.equal(tarjetas.length, 10, "la columna de cerradas enseña solo diez");
		assert.ok(columna.includes('data-id="T-0011"'), "falta la más reciente");
		assert.ok(!columna.includes('data-id="T-0001"'), "la más antigua no debería salir");
		assert.match(cuerpo, /<a href="\/tareas\?estado=finished">ver todas \(11\)<\/a>/);
		// El contador de la columna cuenta todas, no solo las que se ven.
		assert.match(cuerpo, /Cerradas <span class="contador">11<\/span>/);
	} finally {
		await montaje.cerrar();
	}
});

test("arrastrar dentro de la misma columna reordena las tareas", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await crearTarea(montaje, cookie, "Primera");
		await crearTarea(montaje, cookie, "Segunda");
		await crearTarea(montaje, cookie, "Tercera");
		assert.equal(buscarTarea(montaje.db, 3)?.orden, 3);

		const respuesta = await pedir(montaje, "/tareas/T-0003/orden", {
			cookie,
			formulario: { estado: "backlog", orden: "1" },
		});
		assert.equal(respuesta.status, 204);
		assert.equal(await respuesta.text(), "");
		assert.equal(buscarTarea(montaje.db, 3)?.orden, 1);
		assert.equal(buscarTarea(montaje.db, 1)?.orden, 2);
		assert.equal(buscarTarea(montaje.db, 2)?.orden, 3);
		assert.equal(buscarTarea(montaje.db, 3)?.estado, "backlog");
	} finally {
		await montaje.cerrar();
	}
});

test("arrastrar dentro del tablero de una funcionalidad coloca la parte entre sus hermanas", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const evolutivo = crearTareaHumana(montaje.db, {
			titulo: "Listados para comerciales",
			descripcion: "Hoy los copian a mano.",
			usuarioId: 1,
			tipo: "funcionalidad",
		});
		const nueva = (titulo: string, padreId?: number): number =>
			crearTareaHumana(montaje.db, { titulo, descripcion: "d", usuarioId: 1, padreId }).id;
		// La columna queda: suelta (T-0002), parte 1 (T-0003), parte 2 (T-0004).
		for (const tareaId of [nueva("Suelta"), nueva("Parte 1", evolutivo.id), nueva("Parte 2", evolutivo.id)]) {
			moverTareaHumano(montaje.db, { tareaId, usuarioId: 1, estado: "prepared" });
		}

		// El fragmento dice de qué funcionalidad es el tablero: es lo que el
		// cliente manda al soltar para que la posición sea entre hermanas.
		const fragmento = await (await pedir(montaje, "/tareas/kanban/tablero?padre=T-0001", { cookie })).text();
		assert.match(fragmento, /data-padre="T-0001"/);

		// Soltar la parte 2 arriba de ese tablero la pone delante de la parte 1,
		// y la tarea suelta se queda donde estaba.
		const respuesta = await pedir(montaje, "/tareas/T-0004/orden", {
			cookie,
			formulario: { estado: "prepared", orden: "1", padre: "T-0001" },
		});
		assert.equal(respuesta.status, 204);
		assert.equal(buscarTarea(montaje.db, 2)?.orden, 1);
		assert.equal(buscarTarea(montaje.db, 4)?.orden, 2);
		assert.equal(buscarTarea(montaje.db, 3)?.orden, 3);

		// Una tarjeta que no es parte de esa funcionalidad no se coloca en su tablero.
		const ajena = await pedir(montaje, "/tareas/T-0002/orden", {
			cookie,
			formulario: { estado: "prepared", orden: "1", padre: "T-0001" },
		});
		assert.equal(ajena.status, 422);
		assert.equal((await fallo(ajena)).codigo, "padre_no_coincide");
		assert.equal(buscarTarea(montaje.db, 2)?.orden, 1);
	} finally {
		await montaje.cerrar();
	}
});

test("arrastrar a otra columna mueve la tarea y la coloca donde se soltó", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await crearTarea(montaje, cookie, "Primera");
		await crearTarea(montaje, cookie, "Segunda");

		// La segunda pasa a prepared, y después la primera se suelta encima.
		const segunda = await pedir(montaje, "/tareas/T-0002/orden", {
			cookie,
			formulario: { estado: "prepared", orden: "1" },
		});
		assert.equal(segunda.status, 204);
		const primera = await pedir(montaje, "/tareas/T-0001/orden", {
			cookie,
			json: { estado: "prepared", orden: 1 },
		});
		assert.equal(primera.status, 204);

		assert.equal(buscarTarea(montaje.db, 1)?.estado, "prepared");
		assert.equal(buscarTarea(montaje.db, 1)?.orden, 1);
		assert.equal(buscarTarea(montaje.db, 2)?.orden, 2);
	} finally {
		await montaje.cerrar();
	}
});

test("la vuelta atrás de prepared a backlog exige nota, y la deja en el hilo", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await crearTarea(montaje, cookie, "Exportar clientes a CSV");
		await pedir(montaje, "/tareas/T-0001/orden", { cookie, formulario: { estado: "prepared", orden: "1" } });

		const sinNota = await pedir(montaje, "/tareas/T-0001/orden", {
			cookie,
			formulario: { estado: "backlog", orden: "1", nota: "" },
		});
		assert.equal(sinNota.status, 422);
		assert.equal((await fallo(sinNota)).codigo, "nota_obligatoria");
		assert.equal(buscarTarea(montaje.db, 1)?.estado, "prepared");

		const conNota = await pedir(montaje, "/tareas/T-0001/orden", {
			cookie,
			formulario: { estado: "backlog", orden: "1", nota: "Falta decidir el formato." },
		});
		assert.equal(conNota.status, 204);
		assert.equal(buscarTarea(montaje.db, 1)?.estado, "backlog");
		const hilo = leerTarea(montaje.db, 1)?.comentarios ?? [];
		const nota = hilo.find((comentario) => comentario.tipo === "nota");
		assert.equal(nota?.texto, "Falta decidir el formato.");
		assert.equal(nota?.autor, "humano:xinux");
	} finally {
		await montaje.cerrar();
	}
});

test("una transición que no es del humano se rechaza y no mueve nada", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await crearTarea(montaje, cookie, "Exportar clientes a CSV");

		const respuesta = await pedir(montaje, "/tareas/T-0001/orden", {
			cookie,
			formulario: { estado: "doing", orden: "1" },
		});
		assert.equal(respuesta.status, 422);
		const { codigo, mensaje } = await fallo(respuesta);
		assert.equal(codigo, "transicion_no_permitida");
		assert.match(mensaje, /No se puede pasar una tarea de backlog a doing/);
		assert.equal(buscarTarea(montaje.db, 1)?.estado, "backlog");

		const inventada = await pedir(montaje, "/tareas/T-0009/orden", {
			cookie,
			formulario: { estado: "backlog", orden: "1" },
		});
		assert.equal(inventada.status, 404);
		assert.equal((await fallo(inventada)).codigo, "tarea_inexistente");
	} finally {
		await montaje.cerrar();
	}
});

test("el kanban exige sesión y rechaza los POST de otro sitio", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await crearTarea(montaje, cookie, "Exportar clientes a CSV");

		const sinSesion = await pedir(montaje, "/tareas/kanban");
		assert.equal(sinSesion.status, 302);
		assert.equal(sinSesion.headers.get("location"), "/login?volver=%2Ftareas%2Fkanban");

		const ordenSinSesion = await pedir(montaje, "/tareas/T-0001/orden", {
			formulario: { estado: "prepared", orden: "1" },
		});
		assert.equal(ordenSinSesion.status, 302);

		const deOtroSitio = await pedir(montaje, "/tareas/T-0001/orden", {
			cookie,
			formulario: { estado: "prepared", orden: "1" },
			cabeceras: { "sec-fetch-site": "cross-site" },
		});
		assert.equal(deOtroSitio.status, 403);
		assert.equal(buscarTarea(montaje.db, 1)?.estado, "backlog");
	} finally {
		await montaje.cerrar();
	}
});

test("el JavaScript del cliente y SortableJS se sirven como estáticos", async () => {
	const montaje = montar();
	try {
		const propio = await pedir(montaje, "/static/app.js");
		assert.equal(propio.status, 200);
		assert.equal(propio.headers.get("content-type"), "application/javascript; charset=utf-8");
		const cuerpoPropio = await propio.text();
		assert.match(cuerpoPropio, /EventSource\("\/eventos"\)/);
		// Solo la pestaña visible se queda con una de las seis conexiones.
		assert.match(cuerpoPropio, /visibilitychange/);
		assert.match(cuerpoPropio, /\.close\(\)/);
		assert.match(cuerpoPropio, /\/tareas\/kanban\/tablero/);
		// El ámbito del tablero viaja con la posición al soltar.
		assert.match(cuerpoPropio, /dataset\.padre/);
		// Nada de evaluar cadenas en el navegador.
		assert.ok(!/\beval\(/.test(cuerpoPropio), "el cliente no debe usar eval");
		assert.ok(!/new Function\(/.test(cuerpoPropio), "el cliente no debe usar Function");

		const sortable = await pedir(montaje, "/static/sortable.min.js");
		assert.equal(sortable.status, 200);
		assert.equal(sortable.headers.get("content-type"), "application/javascript; charset=utf-8");
		assert.match(await sortable.text(), /Sortable/);
	} finally {
		await montaje.cerrar();
	}
});
