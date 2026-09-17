import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Hono } from "hono";
import { crearApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { crearTerminalConToken } from "../src/auth/tokens.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { crearUsuario } from "../src/db/consultas.ts";
import { registrarConsumo } from "../src/db/consumo.ts";
import { comentarAnalisis, comentarResultado, preguntar } from "../src/db/hilo.ts";
import { crearProyecto } from "../src/db/proyectos.ts";
import {
	buscarTarea,
	crearHija,
	crearTareaHumana,
	exigirTarea,
	leerTarea,
	moverTareaHumano,
	tomarTarea,
} from "../src/db/tareas.ts";
import { formatearId } from "../src/md/ids.ts";
import { BASE_URL_PRUEBA, CONFIG_PRUEBA } from "./comun.ts";

type Montaje = {
	db: DatabaseSync;
	app: Hono;
	cerrar: () => Promise<void>;
};

/** Base en memoria con un usuario, y la app entera montada, sin abrir puerto. */
function montar(): Montaje {
	const db = abrirBaseDeDatos(":memory:");
	crearUsuario(db, "ana", hashPassword("secreta"));
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
		formulario: { usuario: "ana", password: "secreta", volver: "/tareas" },
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

/** El identificador visible de la tarea que ocupa esa fila. */
function idFila(montaje: Montaje, fila: number): string {
	return formatearId(exigirTarea(montaje.db, fila).codigo);
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
		for (const titulo of ["Por definir", "Preparadas", "En curso", "Hechas", "Cerradas"]) {
			assert.ok(cuerpo.includes(titulo), `falta el título de columna ${titulo}`);
		}
		assert.match(cuerpo, new RegExp(`data-id="${idFila(montaje, 1)}"`));
		assert.match(cuerpo, new RegExp(`data-id="${idFila(montaje, 2)}"`));
		// El cliente necesita saber qué vista es y de qué revisión parte.
		assert.match(cuerpo, /data-vista="kanban"/);
		assert.match(cuerpo, /<body data-vista="kanban" data-revision="\d+">/);
		// Sin modelo puesto, el agente es un círculo hueco que lo dice en su título.
		assert.match(cuerpo, /<span class="agente vacio" title="sin asignar">\?<\/span>/);
		assert.match(cuerpo, /<script type="module" src="\/static\/app\.js"><\/script>/);
		// Cabecera de página con su acción, y el tablero a todo lo ancho.
		assert.match(cuerpo, /<div class="dentro dentro-completo">/);
		assert.match(cuerpo, /<header class="cabecera-pagina">[\s\S]*?<h1>Tareas<\/h1>/);
		// El alta lleva al proyecto que se está mirando, que sin cookie es el principal.
		assert.match(cuerpo, /<a class="boton principal" href="\/p\/DEFAULT\/tareas\/nueva">Nueva tarea<\/a>/);
		// Cada columna se encabeza con la etiqueta de su estado y el contador, y
		// debajo, en su propia línea, de quién es el turno mientras está ahí.
		assert.match(
			cuerpo,
			/<span class="insignia estado-backlog color-gris">Por definir<\/span> <span class="contador">2<\/span>/,
		);
		assert.match(cuerpo, /<p class="dueno-columna">la defines tú<\/p>/);
		// La fila de filtros no lleva desplegables: el proyecto lo acota la URL, el
		// estado es la columna y el resto no se usaba.
		assert.match(cuerpo, /<form class="filtros" method="get" action="\/tareas\/kanban">/);
		const fila = cuerpo.slice(cuerpo.indexOf('<div class="fila-filtros">'), cuerpo.indexOf("</form>"));
		assert.ok(!fila.includes("<select"), "la fila de filtros no lleva desplegables");
		assert.ok(!fila.includes("Filtrar"), "la búsqueda se envía con Enter, sin botón");
		assert.doesNotMatch(cuerpo, /Quitar filtros/);
		// Pero un parámetro escrito a mano sigue filtrando.
		const filtrado = await (await pedir(montaje, "/tareas/kanban?marca=bloqueada", { cookie })).text();
		assert.ok(!filtrado.includes(`data-id="${idFila(montaje, 1)}"`), "ninguna está bloqueada");
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

		// En el tablero por columnas están las tres, y la funcionalidad lleva su progreso.
		const todo = await (await pedir(montaje, "/tareas/kanban?agrupar=no", { cookie })).text();
		assert.match(todo, new RegExp(`data-id="${idFila(montaje, 3)}"`));
		assert.match(todo, /<span class="insignia tipo-funcionalidad color-azul">Funcionalidad 0\/1<\/span>/);
		assert.match(
			todo,
			new RegExp(`<a class="parte-de" href="\\/tareas\\/${idFila(montaje, 1)}">Listados para comerciales<\\/a>`),
		);

		// Filtrado por la funcionalidad, solo sus partes: ni ella misma ni las sueltas.
		const partes = await (await pedir(montaje, `/tareas/kanban?padre=${idFila(montaje, 1)}`, { cookie })).text();
		assert.match(partes, new RegExp(`data-id="${idFila(montaje, 2)}"`));
		assert.ok(!partes.includes(`data-id="${idFila(montaje, 1)}"`), "la funcionalidad no es parte de sí misma");
		assert.ok(!partes.includes(`data-id="${idFila(montaje, 3)}"`), "una tarea suelta no es parte de la funcionalidad");
		assert.match(partes, new RegExp(`data-fuente="\\/tareas\\/kanban\\/tablero\\?padre=${idFila(montaje, 1)}"`));
		// Acotado a una funcionalidad no se agrupa: ya son sus partes.
		assert.ok(!partes.includes('class="franja"'), "un tablero acotado no lleva carriles");

		// Y el fragmento suelto se sirve con el mismo filtro.
		const fragmento = await (
			await pedir(montaje, `/tareas/kanban/tablero?padre=${idFila(montaje, 1)}`, { cookie })
		).text();
		assert.match(fragmento, new RegExp(`data-id="${idFila(montaje, 2)}"`));
		assert.ok(!fragmento.includes(`data-id="${idFila(montaje, 3)}"`));
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
		assert.match(cuerpo, new RegExp(`data-id="${idFila(montaje, 1)}"`));

		// Con un filtro de marca que no cumple ninguna, el tablero queda vacío.
		const filtrado = await pedir(montaje, "/tareas/kanban/tablero?marca=bloqueada", { cookie });
		assert.equal(filtrado.status, 200);
		assert.ok(!(await filtrado.text()).includes(`data-id="${idFila(montaje, 1)}"`));
	} finally {
		await montaje.cerrar();
	}
});

test("la columna de cerradas enseña las diez últimas y enlaza a la lista", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const { valor } = crearTerminalConToken(montaje.db, 1, "portatil-ana", "ana@ejemplo.com");
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
		const tarjetas = columna.match(/data-id="T-[0-9A-Z]{4,8}"/g) ?? [];
		assert.equal(tarjetas.length, 10, "la columna de cerradas enseña solo diez");
		assert.ok(columna.includes(`data-id="${idFila(montaje, 11)}"`), "falta la más reciente");
		assert.ok(!columna.includes(`data-id="${idFila(montaje, 1)}"`), "la más antigua no debería salir");
		assert.match(cuerpo, /<a href="\/tareas\?estado=finished">ver todas \(11\)<\/a>/);
		// El contador de la columna cuenta todas, no solo las que se ven.
		assert.match(
			cuerpo,
			/<span class="insignia estado-finished color-marron">Cerradas<\/span> <span class="contador">11<\/span>/,
		);
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

		const respuesta = await pedir(montaje, `/tareas/${idFila(montaje, 3)}/orden`, {
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
		const fragmento = await (
			await pedir(montaje, `/tareas/kanban/tablero?padre=${idFila(montaje, 1)}`, { cookie })
		).text();
		assert.match(fragmento, new RegExp(`data-padre="${idFila(montaje, 1)}"`));

		// Soltar la parte 2 arriba de ese tablero la pone delante de la parte 1,
		// y la tarea suelta se queda donde estaba.
		const respuesta = await pedir(montaje, `/tareas/${idFila(montaje, 4)}/orden`, {
			cookie,
			formulario: { estado: "prepared", orden: "1", padre: idFila(montaje, 1) },
		});
		assert.equal(respuesta.status, 204);
		assert.equal(buscarTarea(montaje.db, 2)?.orden, 1);
		assert.equal(buscarTarea(montaje.db, 4)?.orden, 2);
		assert.equal(buscarTarea(montaje.db, 3)?.orden, 3);

		// Una tarjeta que no es parte de esa funcionalidad no se coloca en su tablero.
		const ajena = await pedir(montaje, `/tareas/${idFila(montaje, 2)}/orden`, {
			cookie,
			formulario: { estado: "prepared", orden: "1", padre: idFila(montaje, 1) },
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
		const segunda = await pedir(montaje, `/tareas/${idFila(montaje, 2)}/orden`, {
			cookie,
			formulario: { estado: "prepared", orden: "1" },
		});
		assert.equal(segunda.status, 204);
		const primera = await pedir(montaje, `/tareas/${idFila(montaje, 1)}/orden`, {
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
		await pedir(montaje, `/tareas/${idFila(montaje, 1)}/orden`, {
			cookie,
			formulario: { estado: "prepared", orden: "1" },
		});

		const sinNota = await pedir(montaje, `/tareas/${idFila(montaje, 1)}/orden`, {
			cookie,
			formulario: { estado: "backlog", orden: "1", nota: "" },
		});
		assert.equal(sinNota.status, 422);
		assert.equal((await fallo(sinNota)).codigo, "nota_obligatoria");
		assert.equal(buscarTarea(montaje.db, 1)?.estado, "prepared");

		const conNota = await pedir(montaje, `/tareas/${idFila(montaje, 1)}/orden`, {
			cookie,
			formulario: { estado: "backlog", orden: "1", nota: "Falta decidir el formato." },
		});
		assert.equal(conNota.status, 204);
		assert.equal(buscarTarea(montaje.db, 1)?.estado, "backlog");
		const hilo = leerTarea(montaje.db, 1)?.comentarios ?? [];
		const nota = hilo.find((comentario) => comentario.tipo === "comentario");
		assert.equal(nota?.texto, "Falta decidir el formato.");
		assert.equal(nota?.autor, "humano:ana");
	} finally {
		await montaje.cerrar();
	}
});

test("una transición que no es del humano se rechaza y no mueve nada", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await crearTarea(montaje, cookie, "Exportar clientes a CSV");

		const respuesta = await pedir(montaje, `/tareas/${idFila(montaje, 1)}/orden`, {
			cookie,
			formulario: { estado: "doing", orden: "1" },
		});
		assert.equal(respuesta.status, 422);
		const { codigo, mensaje } = await fallo(respuesta);
		assert.equal(codigo, "transicion_no_permitida");
		assert.match(mensaje, /No se puede pasar una tarea de backlog a doing/);
		assert.equal(buscarTarea(montaje.db, 1)?.estado, "backlog");

		// Un identificador bien formado que no es de ninguna tarea: una tarjeta
		// que el navegador tenía de antes.
		const inventada = await pedir(montaje, "/tareas/T-ZZZZZZ/orden", {
			cookie,
			formulario: { estado: "backlog", orden: "1" },
		});
		assert.equal(inventada.status, 404);
		assert.equal((await fallo(inventada)).codigo, "id_invalido");
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

		const ordenSinSesion = await pedir(montaje, `/tareas/${idFila(montaje, 1)}/orden`, {
			formulario: { estado: "prepared", orden: "1" },
		});
		assert.equal(ordenSinSesion.status, 302);

		const deOtroSitio = await pedir(montaje, `/tareas/${idFila(montaje, 1)}/orden`, {
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
		// Y cada franja tiene su propio grupo: entre carriles no se arrastra.
		assert.match(cuerpoPropio, /"franja-"/);
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

test("la tarjeta lleva su edad en columna, a la derecha del identificador y de las marcas", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const id = await crearTarea(montaje, cookie, "Exportar clientes a CSV");
		await pedir(montaje, `/tareas/${id}/mover`, { cookie, formulario: { estado: "prepared" } });

		// Una tarea que lleva cuatro días en su columna: la edad sale de ahí.
		const hace = new Date(Date.now() - 4 * 24 * 3_600_000).toISOString();
		montaje.db.prepare("UPDATE tareas SET estado_desde = ? WHERE id = 1").run(hace);

		const cuerpo = await (await pedir(montaje, "/tareas/kanban", { cookie })).text();
		const linea = cuerpo.split('<div class="linea">')[1]?.split("</div>")[0] ?? "";
		assert.match(linea, /<span class="edad" title="[^"]+">4 d<\/span>\s*$/);
		// Y va después del identificador, no delante.
		assert.ok(linea.indexOf("id-tarea") < linea.indexOf('class="edad"'), "la edad va antes del identificador");
	} finally {
		await montaje.cerrar();
	}
});

test("la tarjeta enseña el progreso de sus hijas y los tokens de todo su árbol", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const { valor } = crearTerminalConToken(montaje.db, 1, "portatil-ana", "ana@ejemplo.com");
		const terminalId = valor.terminal.id;
		const padre = crearTareaHumana(montaje.db, {
			titulo: "Exportar el listado a CSV",
			descripcion: "Hoy lo copian a mano.",
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

		const cuerpo = await (await pedir(montaje, "/tareas/kanban", { cookie })).text();
		// La barra va debajo del título, con las hijas cerradas sobre el total.
		assert.match(
			cuerpo,
			/<progress class="progreso" value="1" max="2"><\/progress><span class="progreso-texto">hijas 1\/2<\/span>/,
		);
		// Y los tokens, abreviados, al final de la tarjeta.
		assert.match(cuerpo, /<span class="tokens">184 k<\/span>/);
		// Una hija sin hijas ni consumo no lleva ni barra ni cifra.
		const tarjetaHija = cuerpo.split(`data-id="${idFila(montaje, 3)}"`)[1] ?? "";
		assert.ok(!tarjetaHija.startsWith("</article>"), "la tarjeta de la hija tiene que existir");
		assert.ok(!(tarjetaHija.split("</article>")[0] ?? "").includes("progreso"), "sin hijas no hay barra");
	} finally {
		await montaje.cerrar();
	}
});

/** Los `data-padre` de las franjas, en el orden en que se pintan. */
function franjas(cuerpo: string): string[] {
	const encajes = cuerpo.matchAll(/<section class="franja"(?: data-padre="(T-[0-9A-Z]{4,8})")?>/g);
	return [...encajes].map((encaje) => encaje[1] ?? "sueltas");
}

test("agrupado por funcionalidad, el tablero es una franja por cada una y otra de sueltas", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const { valor } = crearTerminalConToken(montaje.db, 1, "portatil-ana", "ana@ejemplo.com");
		const terminalId = valor.terminal.id;
		const nueva = (titulo: string, extra: { tipo?: "funcionalidad"; padreId?: number } = {}): number =>
			crearTareaHumana(montaje.db, { titulo, descripcion: "d", usuarioId: 1, ...extra }).id;

		// Una funcionalidad en marcha con dos partes, y una hija de trabajo
		// colgada de la primera: la hija tiene que ir a la franja de su abuela.
		const enMarcha = nueva("Listados para comerciales", { tipo: "funcionalidad" });
		const parte = nueva("Sacar los datos del listado", { padreId: enMarcha });
		nueva("Pintar el botón", { padreId: enMarcha });
		moverTareaHumano(montaje.db, { tareaId: parte, usuarioId: 1, estado: "prepared" });
		tomarTarea(montaje.db, { tareaId: parte, fase: "analisis", terminalId, modelo: "sonnet" });
		comentarAnalisis(montaje.db, { tareaId: parte, terminalId, texto: "Plan." });
		tomarTarea(montaje.db, { tareaId: parte, fase: "ejecucion", terminalId, modelo: "opus" });
		crearHija(montaje.db, { titulo: "Generar el fichero", descripcion: "d", padreId: parte, terminalId });
		// Aprobar la descomposición es de la web y exige su análisis; aquí lo
		// único que importa es en qué columna está la funcionalidad.
		montaje.db.prepare("UPDATE tareas SET estado = 'doing' WHERE id = ?").run(enMarcha);

		// Una idea todavía en backlog, con su parte, y una cerrada que ya no
		// tiene franja: sus partes están cerradas.
		const idea = nueva("Avisos por correo", { tipo: "funcionalidad" });
		nueva("Elegir la plantilla", { padreId: idea });
		const cerrada = nueva("Lo de antes", { tipo: "funcionalidad" });
		montaje.db.prepare("UPDATE tareas SET estado = 'finished' WHERE id = ?").run(cerrada);

		await crearTarea(montaje, cookie, "Suelta primera");
		await crearTarea(montaje, cookie, "Suelta segunda");

		const cuerpo = await (await pedir(montaje, "/tareas/kanban?agrupar=funcionalidad", { cookie })).text();
		// Primero la que está en marcha, después la idea, y «Sueltas» la última.
		assert.deepEqual(franjas(cuerpo), [idFila(montaje, 1), idFila(montaje, 5), "sueltas"]);
		assert.match(cuerpo, /<h2>Sueltas<\/h2>/);
		assert.ok(!cuerpo.includes(`data-padre="${idFila(montaje, 7)}"`), "una funcionalidad finished no tiene franja");

		// La cabecera de la franja: el id enlazado, el título, el estado y el
		// progreso en partes.
		assert.match(
			cuerpo,
			new RegExp(`<a class="id-tarea" href="\\/tareas\\/${idFila(montaje, 1)}">${idFila(montaje, 1)}<\\/a>`),
		);
		assert.match(
			cuerpo,
			new RegExp(`<h2><a href="\\/tareas\\/${idFila(montaje, 1)}">Listados para comerciales<\\/a><\\/h2>`),
		);
		assert.match(cuerpo, /<span class="insignia estado-doing color-amarillo">En curso<\/span>/);
		assert.match(cuerpo, /<span class="progreso-texto">partes 0\/2<\/span>/);

		// Las funcionalidades son cabecera, no tarjeta.
		for (const id of [idFila(montaje, 1), idFila(montaje, 5), idFila(montaje, 7)]) {
			assert.ok(!cuerpo.includes(`data-id="${id}"`), `la funcionalidad ${id} no se pinta como tarjeta`);
		}
		// Cada tarea en su franja: las partes y la hija de trabajo con su abuela,
		// y las sueltas en la última.
		const [, primera = "", segunda = "", ultima = ""] = cuerpo.split('<section class="franja"');
		for (const id of [
			`data-id="${idFila(montaje, 2)}"`,
			`data-id="${idFila(montaje, 3)}"`,
			`data-id="${idFila(montaje, 4)}"`,
		]) {
			assert.ok(primera.includes(id), `${id} va en la franja de ${idFila(montaje, 1)}`);
		}
		assert.ok(segunda.includes(`data-id="${idFila(montaje, 6)}"`), "la parte de la idea va en su franja");
		assert.ok(
			ultima.includes(`data-id="${idFila(montaje, 8)}"`) && ultima.includes(`data-id="${idFila(montaje, 9)}"`),
			"faltan las sueltas",
		);
	} finally {
		await montaje.cerrar();
	}
});

test("la lista sale agrupada por funcionalidad, con la columna Estado y las sueltas al final", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const evolutivo = crearTareaHumana(montaje.db, {
			titulo: "Listados para comerciales",
			descripcion: "d",
			usuarioId: 1,
			tipo: "funcionalidad",
		});
		const nueva = (titulo: string, padreId?: number): number =>
			crearTareaHumana(montaje.db, { titulo, descripcion: "d", usuarioId: 1, padreId }).id;
		const primera = nueva("Sacar los datos del listado", evolutivo.id);
		nueva("Pintar el botón", evolutivo.id);
		nueva("Migrar el envío de correos");
		moverTareaHumano(montaje.db, { tareaId: primera, usuarioId: 1, estado: "prepared" });

		// Una franja por funcionalidad, con su cabecera, y «Sueltas» la última.
		const cuerpo = await (await pedir(montaje, "/tareas", { cookie })).text();
		assert.deepEqual(franjas(cuerpo), [idFila(montaje, 1), "sueltas"]);
		assert.match(
			cuerpo,
			new RegExp(`<h2><a href="\\/tareas\\/${idFila(montaje, 1)}">Listados para comerciales<\\/a><\\/h2>`),
		);
		assert.match(cuerpo, /<span class="progreso-texto">partes 0\/2<\/span>/);
		// La tabla de la franja lleva la columna Estado delante, con su etiqueta.
		const [, franja = "", sueltas = ""] = cuerpo.split('<section class="franja"');
		assert.match(franja, /<th>Estado<\/th>\s*<th>Id<\/th>/);
		assert.match(franja, /<td><span class="insignia estado-prepared color-azul">Preparada<\/span><\/td>/);
		// Sus partes, en su franja y ordenadas por columna: por definir va antes
		// que preparada, como en el tablero.
		assert.ok(franja.indexOf("Pintar el botón") < franja.indexOf("Sacar los datos del listado"));
		// La funcionalidad es la cabecera, no una fila más.
		assert.ok(
			!cuerpo.includes(`<td><a class="id-tarea" href="/tareas/${idFila(montaje, 1)}">`),
			"la funcionalidad no es una fila",
		);
		// Y lo que no cuelga de ninguna, en «Sueltas» con los grupos de siempre.
		assert.match(sueltas, /<h2>Sueltas<\/h2>/);
		assert.match(sueltas, /Migrar el envío de correos/);
		assert.match(sueltas, /<span class="insignia estado-backlog color-gris">Por definir<\/span>/);

		// Por columnas, la lista de siempre: sin franjas y con la funcionalidad
		// como una fila más.
		const columnas = await (await pedir(montaje, "/tareas?agrupar=no", { cookie })).text();
		assert.ok(!columnas.includes('class="franja"'), "por columnas no hay franjas");
		assert.ok(!columnas.includes("<th>Estado</th>"), "el grupo ya dice en qué columna está");
		assert.match(columnas, /<span class="insignia tipo-funcionalidad color-azul">Funcionalidad 0\/2<\/span>/);
		assert.match(columnas, /<a class="boton-filtro" href="\/tareas">Agrupar por funcionalidad<\/a>/);
		// El conmutador de vistas se lleva la agrupación de una vista a la otra.
		assert.match(columnas, /<a href="\/tareas\/kanban\?agrupar=no">Tablero<\/a>/);
	} finally {
		await montaje.cerrar();
	}
});

test("el tablero sale agrupado de serie y el conmutador lleva a las columnas", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const evolutivo = crearTareaHumana(montaje.db, {
			titulo: "Listados para comerciales",
			descripcion: "d",
			usuarioId: 1,
			tipo: "funcionalidad",
		});
		crearTareaHumana(montaje.db, {
			titulo: "Sacar los datos del listado",
			descripcion: "d",
			usuarioId: 1,
			padreId: evolutivo.id,
		});

		// Sin parámetro, carriles: el conmutador dice a qué se va.
		const serie = await (await pedir(montaje, "/tareas/kanban", { cookie })).text();
		assert.deepEqual(franjas(serie), [idFila(montaje, 1), "sueltas"]);
		assert.match(serie, /<a class="boton-filtro" href="\/tareas\/kanban\?agrupar=no">Por columnas<\/a>/);

		// Y conserva la búsqueda y el conmutador rápido.
		const filtrado = await (await pedir(montaje, "/tareas/kanban?q=listado&rapido=espera", { cookie })).text();
		assert.match(
			filtrado,
			/<a class="boton-filtro" href="\/tareas\/kanban\?rapido=espera&amp;q=listado&amp;agrupar=no">Por columnas<\/a>/,
		);

		// Por columnas, el conmutador vuelve a ofrecer la agrupación sin parámetro.
		const columnas = await (await pedir(montaje, "/tareas/kanban?q=listado&rapido=espera&agrupar=no", { cookie })).text();
		assert.match(
			columnas,
			/<a class="boton-filtro" href="\/tareas\/kanban\?rapido=espera&amp;q=listado">Agrupar por funcionalidad<\/a>/,
		);
		assert.ok(!columnas.includes('class="franja"'), "por columnas no hay franjas");
		// Y viaja con el formulario y con el refresco en vivo.
		assert.match(columnas, /<input type="hidden" name="agrupar" value="no">/);
		assert.match(columnas, /data-fuente="\/tareas\/kanban\/tablero\?rapido=espera&amp;q=listado&amp;agrupar=no"/);

		// `agrupar=funcionalidad` sigue valiendo: es lo mismo que no decir nada.
		const explicito = await (await pedir(montaje, "/tareas/kanban?agrupar=funcionalidad", { cookie })).text();
		assert.deepEqual(franjas(explicito), [idFila(montaje, 1), "sueltas"]);

		// El fragmento que recarga el cliente respeta lo mismo.
		const fragmento = await (await pedir(montaje, "/tareas/kanban/tablero", { cookie })).text();
		assert.deepEqual(franjas(fragmento), [idFila(montaje, 1), "sueltas"]);
		assert.match(fragmento, new RegExp(`data-id="${idFila(montaje, 2)}"`));
		const suelto = await (await pedir(montaje, "/tareas/kanban/tablero?agrupar=no", { cookie })).text();
		assert.ok(!suelto.includes('class="franja"'), "el fragmento por columnas tampoco lleva franjas");

		// El tablero de la ficha de una funcionalidad ya está acotado a sus partes.
		const ficha = await (await pedir(montaje, `/tareas/${idFila(montaje, 1)}`, { cookie })).text();
		assert.ok(!ficha.includes("Agrupar por funcionalidad"), "la ficha no lleva el conmutador");
		assert.ok(!ficha.includes('class="franja"'), "la ficha no pinta franjas");
	} finally {
		await montaje.cerrar();
	}
});

test("el kanban de un proyecto agrupa solo sus funcionalidades", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const web = crearProyecto(montaje.db, { clave: "WEB", nombre: "La web nueva" }).id;
		const nueva = (titulo: string, extra: { tipo?: "funcionalidad"; padreId?: number; proyectoId?: number }): number =>
			crearTareaHumana(montaje.db, { titulo, descripcion: "d", usuarioId: 1, ...extra }).id;
		const principal = nueva("Listados para comerciales", { tipo: "funcionalidad" });
		nueva("Sacar los datos del listado", { padreId: principal });
		const deLaWeb = nueva("Avisos por correo", { tipo: "funcionalidad", proyectoId: web });
		nueva("Elegir la plantilla", { padreId: deLaWeb });

		const cuerpo = await (await pedir(montaje, "/p/WEB/tareas/kanban", { cookie })).text();
		assert.deepEqual(franjas(cuerpo), [idFila(montaje, 3), "sueltas"]);
		assert.match(cuerpo, new RegExp(`data-id="${idFila(montaje, 4)}"`));
		assert.ok(!cuerpo.includes(`data-id="${idFila(montaje, 2)}"`), "la parte del otro proyecto no sale");
		assert.match(cuerpo, /<a class="boton-filtro" href="\/p\/WEB\/tareas\/kanban\?agrupar=no">Por columnas<\/a>/);

		// La lista acotada se agrupa igual, con las partes de su funcionalidad.
		const lista = await (await pedir(montaje, "/p/WEB/tareas", { cookie })).text();
		assert.deepEqual(franjas(lista), [idFila(montaje, 3), "sueltas"]);
		assert.match(lista, new RegExp(`<h2><a href="\\/tareas\\/${idFila(montaje, 3)}">Avisos por correo<\\/a><\\/h2>`));
		assert.ok(!lista.includes("Listados para comerciales"), "la funcionalidad del otro proyecto no sale");

		// En la vista cruzada salen las dos, y cada cabecera lleva su chip.
		const cruzada = await (await pedir(montaje, "/tareas/kanban", { cookie })).text();
		assert.deepEqual(franjas(cruzada), [idFila(montaje, 1), idFila(montaje, 3), "sueltas"]);
		assert.match(
			cruzada,
			new RegExp(
				`<span class="insignia proyecto color-verde">WEB<\\/span>\\s*<a class="id-tarea" href="\\/tareas\\/${idFila(montaje, 3)}">`,
			),
		);
	} finally {
		await montaje.cerrar();
	}
});

test("los conmutadores y la búsqueda filtran el tablero y se combinan con el proyecto", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await crearTarea(montaje, cookie, "Exportar el listado a CSV");
		await crearTarea(montaje, cookie, "Migrar el envío de correos");

		// La búsqueda mira el título: la otra tarea se queda fuera.
		const buscado = await (await pedir(montaje, "/tareas/kanban?q=correos", { cookie })).text();
		assert.match(buscado, new RegExp(`data-id="${idFila(montaje, 2)}"`));
		assert.ok(!buscado.includes(`data-id="${idFila(montaje, 1)}"`), "la búsqueda deja fuera lo que no encaja");
		// Lo que se buscó se queda escrito y viaja en la dirección del refresco.
		assert.match(buscado, /<input type="search" name="q" value="correos" placeholder="Buscar">/);
		assert.match(buscado, /data-fuente="\/tareas\/kanban\/tablero\?q=correos"/);

		// Los tres conmutadores, con el resto de filtros puesto en cada enlace.
		assert.match(
			buscado,
			/<a class="boton-filtro" href="\/tareas\/kanban\?q=correos&amp;rapido=espera">Espera por ti<\/a>/,
		);

		// Puesto, el activo lo quita al pulsarlo y viaja como campo oculto.
		const enMarcha = await (await pedir(montaje, "/tareas/kanban?rapido=en-marcha", { cookie })).text();
		assert.match(enMarcha, /<a class="boton-filtro" href="\/tareas\/kanban" aria-current="true">En marcha<\/a>/);
		assert.match(enMarcha, /<input type="hidden" name="rapido" value="en-marcha">/);
		// Ninguna está en marcha: el tablero sale vacío.
		assert.ok(!enMarcha.includes("data-id="), "ninguna tarea está en marcha");

		// Acotado a un proyecto, los conmutadores conservan su ruta y sus filtros.
		const delProyecto = await (await pedir(montaje, "/p/DEFAULT/tareas/kanban?q=csv", { cookie })).text();
		assert.match(delProyecto, new RegExp(`data-id="${idFila(montaje, 1)}"`));
		assert.ok(!delProyecto.includes(`data-id="${idFila(montaje, 2)}"`));
		assert.match(
			delProyecto,
			/<a class="boton-filtro" href="\/p\/DEFAULT\/tareas\/kanban\?q=csv&amp;rapido=espera">Espera por ti<\/a>/,
		);
		assert.match(delProyecto, /data-fuente="\/p\/DEFAULT\/tareas\/kanban\/tablero\?q=csv"/);
	} finally {
		await montaje.cerrar();
	}
});

test("la tarjeta enseña los tokens sobre su presupuesto y avisa al pasarse", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const { valor } = crearTerminalConToken(montaje.db, 1, "portatil-ana", "ana@ejemplo.com");
		const terminalId = valor.terminal.id;
		const tarea = crearTareaHumana(montaje.db, {
			titulo: "Exportar el listado a CSV",
			descripcion: "Hoy lo copian a mano.",
			usuarioId: 1,
			presupuesto: 200_000,
		});
		const gastar = (tokens: number): void => {
			registrarConsumo(montaje.db, {
				tareaId: tarea.id,
				fase: "ejecucion",
				modelo: "opus",
				terminalId,
				tokens,
				herramientas: 41,
				duracionMs: 1_000,
			});
		};

		gastar(184_600);
		const dentro = await (await pedir(montaje, "/tareas/kanban", { cookie })).text();
		assert.match(dentro, /<span class="tokens">184 k \/ 200 k<\/span>/);
		assert.ok(!dentro.includes("marca-sobre-presupuesto"), "por debajo del tope no hay aviso");

		gastar(20_000);
		const fuera = await (await pedir(montaje, "/tareas/kanban", { cookie })).text();
		assert.match(fuera, /<span class="tokens">204 k \/ 200 k<\/span>/);
		assert.match(fuera, /<span class="insignia marca-sobre-presupuesto color-naranja">Sobre presupuesto<\/span>/);
		// Y se puede filtrar por la marca, como por cualquier otra.
		const filtrado = await (await pedir(montaje, "/tareas/kanban?marca=sobre+presupuesto", { cookie })).text();
		assert.match(filtrado, new RegExp(`data-id="${idFila(montaje, 1)}"`));
	} finally {
		await montaje.cerrar();
	}
});

test("una tarjeta lleva una etiqueta como máximo, y sus agentes como chips", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const { valor } = crearTerminalConToken(montaje.db, 1, "portatil-ana", "ana@ejemplo.com");
		const terminalId = valor.terminal.id;

		// Bloqueada y en marcha a la vez: dos marcas y el turno del humano encima.
		const tarea = crearTareaHumana(montaje.db, {
			titulo: "Exportar el listado a CSV",
			descripcion: "Hoy lo copian a mano.",
			usuarioId: 1,
		});
		moverTareaHumano(montaje.db, { tareaId: tarea.id, usuarioId: 1, estado: "prepared" });
		tomarTarea(montaje.db, { tareaId: tarea.id, fase: "analisis", terminalId, modelo: "sonnet" });
		preguntar(montaje.db, {
			tareaId: tarea.id,
			terminalId,
			pregunta: "¿Qué separador usamos?",
			porQueImporta: "La hoja de cálculo está en español.",
			opciones: [
				{ texto: "Punto y coma", consecuencia: "Se abre directamente." },
				{ texto: "No hacer nada", consecuencia: "Siguen copiando a mano." },
			],
			recomendacion: "Punto y coma",
		});

		const cuerpo = await (await pedir(montaje, "/tareas/kanban", { cookie })).text();
		const id = formatearId(tarea.codigo);
		const tarjeta = cuerpo.slice(cuerpo.indexOf(`data-id="${id}"`), cuerpo.indexOf("</article>", cuerpo.indexOf(id)));

		// Una sola etiqueta de marca o turno, y la que manda es la del turno: lo que
		// espera por el humano gana a lo que está pasando. El chip del proyecto no
		// cuenta: eso no es una marca.
		assert.equal(
			(tarjeta.match(/class="insignia (?:turno|marca-)/g) ?? []).length,
			1,
			"la tarjeta lleva más de una etiqueta de marca o turno",
		);
		assert.match(tarjeta, /<span class="insignia turno">Contesta<\/span>/);
		assert.ok(!tarjeta.includes("marca-en-marcha"), "la marca de agente trabajando no se pinta con el turno encima");
		// Con el identificador a un lado y la edad al otro.
		assert.match(tarjeta, new RegExp(`<a class="id-tarea" href="/tareas/${id}">${id}</a>`));
		assert.match(tarjeta, /<span class="edad" title="[^"]+">0 min<\/span>/);

		// Los agentes van como chips de inicial, con su modelo y su terminal en el
		// título; el terminal ya no se lee en la tarjeta.
		const agentes = tarjeta.match(/<span class="agentes">[\s\S]*?<\/span>\s*<\/span>/);
		assert.ok(agentes !== null, "la tarjeta no lleva los agentes");
		assert.match(agentes[0], /<span class="agente" title="sonnet@portatil-ana">S<\/span>/);
		assert.match(agentes[0], /<span class="agente vacio" title="sin asignar">\?<\/span>/);
		assert.equal((agentes[0].match(/class="agente[ "]/g) ?? []).length, 2, "son dos fases, dos chips");
	} finally {
		await montaje.cerrar();
	}
});
