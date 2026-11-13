import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Hono } from "hono";
import { crearApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { altaTerminal, cambiarColor, listarTerminales } from "../src/db/admin.ts";
import { crearUsuario } from "../src/db/consultas.ts";
import { crearProyecto, listarProyectos } from "../src/db/proyectos.ts";
import { borrarTarea, buscarTarea, crearTareaHumana, exigirTarea } from "../src/db/tareas.ts";
import { BASE_URL_PRUEBA, CONFIG_PRUEBA } from "./comun.ts";

/**
 * Los proyectos en la web: las vistas acotadas bajo `/p/:clave/`, la vista
 * cruzada con su chip y su filtro, la página de proyectos y el proyecto en la
 * ficha, en el alta de tarea y en el alta de terminal.
 */

type Montaje = {
	db: DatabaseSync;
	app: Hono;
	cerrar: () => Promise<void>;
};

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
};

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

async function entrar(montaje: Montaje): Promise<string> {
	const respuesta = await pedir(montaje, "/login", {
		formulario: { usuario: "ana", password: "secreta", volver: "/tareas" },
	});
	assert.equal(respuesta.status, 302);
	const primera = (respuesta.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
	assert.ok(primera.startsWith("sesion="), `la cookie no se llama sesion: ${primera}`);
	return primera;
}

/**
 * El chip de un proyecto, tal como lo pinta `chipProyecto`. El color se
 * reparte por orden de alta: DEFAULT es el primero de la lista y WEB, el
 * segundo.
 */
function chip(clave: string, color = "azul"): string {
	return `<span class="insignia proyecto color-${color}">${clave}</span>`;
}

/** La clave que el servidor pide recordar en esta respuesta, si pide alguna. */
function recordado(respuesta: Response): string | undefined {
	const cookie = respuesta.headers.getSetCookie().find((cual) => cual.startsWith("proyecto="));
	return cookie === undefined ? undefined : (cookie.split(";")[0] ?? "").slice("proyecto=".length);
}

/** La cookie de sesión con el proyecto recordado, como la mandaría el navegador. */
function conProyecto(cookie: string, clave: string): string {
	return `${cookie}; proyecto=${clave}`;
}

/** Un proyecto nuevo con una tarea suya, que es el montaje de casi todo. */
function conDosProyectos(montaje: Montaje): { web: number } {
	const web = crearProyecto(montaje.db, { clave: "WEB", nombre: "La web nueva" }).id;
	crearTareaHumana(montaje.db, { titulo: "Tarea del principal", descripcion: "d", usuarioId: 1 });
	crearTareaHumana(montaje.db, { titulo: "Tarea de la web", descripcion: "d", usuarioId: 1, proyectoId: web });
	return { web };
}

/** El identificador visible de la tarea que ocupa esa fila. */
function idFila(montaje: Montaje, fila: number): string {
	return exigirTarea(montaje.db, fila).codigo;
}

test("la vista acotada solo trae las tareas de su proyecto y la cruzada las enseña con su chip", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		conDosProyectos(montaje);

		// La cruzada: las dos, cada una con el chip de su proyecto. El proyecto ya
		// no se filtra con un desplegable: se elige en la barra o va en la URL.
		for (const ruta of ["/tareas", "/tareas/kanban"]) {
			const cuerpo = await (await pedir(montaje, ruta, { cookie })).text();
			assert.match(cuerpo, /Tarea del principal/, `${ruta} no trae la del principal`);
			assert.match(cuerpo, /Tarea de la web/, `${ruta} no trae la de la web`);
			assert.ok(cuerpo.includes(chip("DEFAULT")), `${ruta} no pinta el chip de DEFAULT`);
			assert.ok(cuerpo.includes(chip("WEB", "verde")), `${ruta} no pinta el chip de WEB`);
			assert.ok(!cuerpo.includes('<select name="proyecto">'), `${ruta} no debería llevar desplegable`);
			// Pero el parámetro escrito a mano sigue acotando.
			const soloWeb = await (await pedir(montaje, `${ruta}?proyecto=WEB`, { cookie })).text();
			assert.ok(!soloWeb.includes("Tarea del principal"), `${ruta}?proyecto=WEB trae la de otro`);
		}

		// Acotada: solo las suyas, y sin filtro de proyecto, que ya está en la URL.
		for (const ruta of ["/p/WEB/tareas", "/p/WEB/tareas/kanban"]) {
			const cuerpo = await (await pedir(montaje, ruta, { cookie })).text();
			assert.match(cuerpo, /Tarea de la web/, `${ruta} no trae la suya`);
			assert.ok(!cuerpo.includes("Tarea del principal"), `${ruta} trae una tarea de otro proyecto`);
			assert.ok(!cuerpo.includes('<select name="proyecto">'), `${ruta} no debería filtrar por proyecto`);
		}

		// Los enlaces internos no se salen del proyecto, y la ficha sigue siendo global.
		const kanban = await (await pedir(montaje, "/p/WEB/tareas/kanban", { cookie })).text();
		assert.match(kanban, /<a class="boton principal" href="\/p\/WEB\/tareas\/nueva">Nueva tarea<\/a>/);
		assert.match(kanban, /data-proyecto="WEB"/);
		assert.match(kanban, /data-fuente="\/p\/WEB\/tareas\/kanban\/tablero"/);
		assert.match(kanban, new RegExp(`<a class="id-tarea" href="\\/tareas\\/${idFila(montaje, 2)}">`));

		// El fragmento que recarga el cliente sale por la misma ruta acotada.
		const fragmento = await pedir(montaje, "/p/WEB/tareas/kanban/tablero", { cookie });
		assert.equal(fragmento.status, 200);
		const cuerpoFragmento = await fragmento.text();
		assert.ok(cuerpoFragmento.trimStart().startsWith('<section id="tablero"'));
		assert.match(cuerpoFragmento, new RegExp(`data-id="${idFila(montaje, 2)}"`));
		assert.ok(!cuerpoFragmento.includes(`data-id="${idFila(montaje, 1)}"`));

		// El filtro de la cruzada acota igual, pero el arrastre sigue siendo global.
		const filtrada = await (await pedir(montaje, "/tareas/kanban?proyecto=WEB", { cookie })).text();
		assert.match(filtrada, /Tarea de la web/);
		assert.ok(!filtrada.includes("Tarea del principal"));
		assert.match(filtrada, /data-proyecto=""/);
	} finally {
		await montaje.cerrar();
	}
});

test("una clave de proyecto que no existe es un 404", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		for (const ruta of ["/p/NADA/tareas", "/p/NADA/tareas/kanban", "/p/NADA/tareas/nueva", "/p/NADA/funcionalidades"]) {
			const respuesta = await pedir(montaje, ruta, { cookie });
			assert.equal(respuesta.status, 404, `${ruta} debería ser 404`);
			assert.match(await respuesta.text(), /No existe ningún proyecto con la clave/);
		}

		// Y sin sesión, la vista acotada pide entrar como el resto de la web.
		const sinSesion = await pedir(montaje, "/p/DEFAULT/tareas");
		assert.equal(sinSesion.status, 302);
		assert.equal(sinSesion.headers.get("location"), "/login?volver=%2Fp%2FDEFAULT%2Ftareas");
	} finally {
		await montaje.cerrar();
	}
});

test("el selector de la barra lateral lleva puesto el proyecto de la URL", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		conDosProyectos(montaje);

		// Los proyectos primero y «Todos» al final: la vista cruzada se elige.
		const cruzada = await (await pedir(montaje, "/tareas", { cookie })).text();
		assert.match(
			cruzada,
			/<option value="\/p\/WEB\/tareas">WEB — La web nueva<\/option>\s*<option value="\/tareas">Todos los proyectos<\/option>/,
		);
		// Sin cookie, el principal: la cruzada no sale por no haber elegido.
		assert.match(cruzada, /<option value="\/p\/DEFAULT\/tareas" selected>DEFAULT — Default<\/option>/);

		// En una vista acotada, la opción del proyecto y el destino de cada vista.
		const kanban = await (await pedir(montaje, "/p/WEB/tareas/kanban", { cookie })).text();
		assert.match(kanban, /<option value="\/p\/WEB\/tareas\/kanban" selected>WEB — La web nueva<\/option>/);
		assert.match(kanban, /<option value="\/tareas\/kanban">Todos los proyectos<\/option>/);
		// Y la navegación se queda dentro del proyecto.
		// «Tareas» es una sola entrada y está activa también en el tablero.
		assert.match(kanban, /<a class="enlace-nav" href="\/p\/WEB\/tareas" aria-current="page">Tareas<\/a>/);
		assert.match(kanban, /<a class="enlace-nav" href="\/p\/WEB\/funcionalidades">Funcionalidades<\/a>/);
		assert.match(kanban, /<a class="enlace-nav" href="\/proyectos">Proyectos<\/a>/);

		// Sin JavaScript, el formulario del selector va a `/ir`, que redirige.
		const salto = await pedir(montaje, "/ir?destino=%2Fp%2FWEB%2Ftareas", { cookie });
		assert.equal(salto.status, 302);
		assert.equal(salto.headers.get("location"), "/p/WEB/tareas");
		// Un destino de fuera no se sigue: se vuelve a la lista.
		const fuera = await pedir(montaje, "/ir?destino=https%3A%2F%2Fotro.sitio", { cookie });
		assert.equal(fuera.headers.get("location"), "/tareas");
	} finally {
		await montaje.cerrar();
	}
});

test("la web recuerda el proyecto que se está mirando, y la vista cruzada se elige a mano", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		conDosProyectos(montaje);

		// Cualquier página acotada pide recordar su clave.
		const acotada = await pedir(montaje, "/p/WEB/tareas", { cookie });
		assert.equal(recordado(acotada), "WEB");

		// Con ella, la navegación de cualquier otra página vuelve a ese proyecto,
		// pero `/tareas` sigue siendo la vista cruzada: manda la URL.
		const conWeb = conProyecto(cookie, "WEB");
		const actividad = await (await pedir(montaje, "/actividad", { cookie: conWeb })).text();
		assert.match(actividad, /<a class="enlace-nav" href="\/p\/WEB\/tareas">Tareas<\/a>/);
		assert.match(actividad, /<a class="enlace-nav" href="\/p\/WEB">Proyecto<\/a>/);
		const todas = await (await pedir(montaje, "/tareas", { cookie: conWeb })).text();
		assert.match(todas, /Tarea del principal/);
		assert.match(todas, /Tarea de la web/);

		// Sin cookie, el principal; con una clave que ya no existe, también.
		const sinCookie = await (await pedir(montaje, "/actividad", { cookie })).text();
		assert.match(sinCookie, /<a class="enlace-nav" href="\/p\/DEFAULT\/tareas">Tareas<\/a>/);
		const borrada = await (await pedir(montaje, "/actividad", { cookie: conProyecto(cookie, "NADA") })).text();
		assert.match(borrada, /<a class="enlace-nav" href="\/p\/DEFAULT\/tareas">Tareas<\/a>/);

		// Elegir «Todos los proyectos» pasa por `/ir` con un destino sin prefijo:
		// eso es lo que recuerda la vista cruzada, y la navegación la respeta.
		const salto = await pedir(montaje, "/ir?destino=%2Ftareas", { cookie: conWeb });
		assert.equal(recordado(salto), "todos");
		const cruzada = await (await pedir(montaje, "/actividad", { cookie: conProyecto(cookie, "todos") })).text();
		assert.match(cruzada, /<a class="enlace-nav" href="\/tareas">Tareas<\/a>/);
		// Desde la actividad, el selector se queda en la actividad: la de todo o
		// la pestaña del proyecto elegido.
		assert.match(cruzada, /<option value="\/actividad" selected>Todos los proyectos<\/option>/);
		assert.match(cruzada, /<option value="\/p\/WEB\/actividad">WEB — La web nueva<\/option>/);
		// Con todos los proyectos elegidos no hay página de proyecto a la que llevar.
		assert.doesNotMatch(cruzada, />Proyecto<\/a>/);
	} finally {
		await montaje.cerrar();
	}
});

test("la página de proyectos crea, edita y borra, con sus tres errores de borrado", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);

		const alta = await pedir(montaje, "/proyectos", {
			cookie,
			formulario: {
				clave: "web",
				nombre: "La web nueva",
				descripcion: "El frontal",
				repositorio: "https://github.com/ejemplo/web.git",
				ramaPrincipal: "main",
				verificacion: "npm test",
			},
		});
		assert.equal(alta.status, 302);
		const web = listarProyectos(montaje.db).find((cual) => cual.clave === "WEB");
		assert.ok(web !== undefined, "la clave se guarda en mayúsculas");
		// El `.git` y la barra final no son parte del repositorio.
		assert.equal(web.repositorio, "https://github.com/ejemplo/web");

		// La clave repetida no crea otro: vuelve el alta con el aviso y lo escrito.
		const repetida = await pedir(montaje, "/proyectos", { cookie, formulario: { clave: "WEB", nombre: "Otra" } });
		assert.equal(repetida.status, 422);
		const repintada = await repetida.text();
		assert.match(repintada, /Ya hay un proyecto con la clave/);
		assert.match(repintada, /<h1>Nuevo proyecto<\/h1>/);
		assert.match(repintada, /<input type="text" name="clave" value="WEB"/);
		assert.match(repintada, /<input type="text" name="nombre" value="Otra"/);

		// La tabla, con sus cuentas y quién lo creó.
		const lista = await (await pedir(montaje, "/proyectos", { cookie })).text();
		assert.ok(lista.includes(chip("DEFAULT")) && lista.includes(chip("WEB", "verde")));
		assert.match(lista, /<th>Rama principal<\/th>/);
		assert.match(lista, /<th class="numero">Tareas abiertas<\/th>/);
		assert.match(lista, /<span class="chip color-azul"><span class="inicial">A<\/span>ana<\/span>/);

		// Editar cambia todo menos la clave.
		const edicion = await pedir(montaje, `/proyectos/${web.id}/editar`, {
			cookie,
			formulario: { nombre: "La web", descripcion: "", repositorio: "", ramaPrincipal: "principal", verificacion: "" },
		});
		assert.equal(edicion.status, 302);
		const editado = listarProyectos(montaje.db).find((cual) => cual.id === web.id);
		assert.equal(editado?.nombre, "La web");
		assert.equal(editado?.ramaPrincipal, "principal");
		assert.equal(editado?.repositorio, null);
		assert.equal(editado?.clave, "WEB");

		// El principal no se borra nunca.
		const principal = await pedir(montaje, "/proyectos/1/borrar", { cookie, formulario: {} });
		assert.equal(principal.status, 422);
		assert.match(await principal.text(), /El proyecto principal no se borra/);

		// Con una tarea dentro, tampoco.
		const tarea = crearTareaHumana(montaje.db, {
			titulo: "Tarea de la web",
			descripcion: "d",
			usuarioId: 1,
			proyectoId: web.id,
		});
		const conTareas = await pedir(montaje, `/proyectos/${web.id}/borrar`, { cookie, formulario: {} });
		assert.equal(conTareas.status, 422);
		assert.match(await conTareas.text(), /El proyecto tiene 1 tarea/);

		// Ni con un terminal suyo.
		// Por la puerta de siempre: la tarea se lleva su hilo y sus transiciones.
		borrarTarea(montaje.db, { tareaId: tarea.id, actor: { nombre: "cli" } });
		const conTerminal = await pedir(montaje, "/terminales", {
			cookie,
			formulario: { nombre: "portatil", cuenta: "ana@ejemplo.com", agentes: "1", proyecto: String(web.id) },
		});
		assert.equal(conTerminal.status, 200);
		const conTerminales = await pedir(montaje, `/proyectos/${web.id}/borrar`, { cookie, formulario: {} });
		assert.equal(conTerminales.status, 422);
		assert.match(await conTerminales.text(), /El proyecto tiene 1 terminal/);

		// Vacío, se borra. La confirmación va en su propia página.
		const terminal = listarTerminales(montaje.db)[0];
		assert.ok(terminal !== undefined);
		await pedir(montaje, `/terminales/${terminal.id}/borrar`, { cookie, formulario: {} });
		const confirmacion = await pedir(montaje, `/proyectos/${web.id}/borrar`, { cookie });
		assert.equal(confirmacion.status, 200);
		assert.match(await confirmacion.text(), /Sí, borrar/);
		const borrado = await pedir(montaje, `/proyectos/${web.id}/borrar`, { cookie, formulario: {} });
		assert.equal(borrado.status, 302);
		assert.equal(listarProyectos(montaje.db).length, 1);
	} finally {
		await montaje.cerrar();
	}
});

test("el proyecto se crea con el color de sus siglas y se le cambia después", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);

		// El alta ofrece los ocho colores, con «automático» puesto.
		const formulario = await (await pedir(montaje, "/proyectos/nuevo", { cookie })).text();
		assert.match(formulario, /<label class="muestra muestra-auto">/);
		assert.match(formulario, /De dos a ocho caracteres/);

		const alta = await pedir(montaje, "/proyectos", {
			cookie,
			formulario: { clave: "WEB", nombre: "La web nueva", descripcion: "", color: "rojo" },
		});
		assert.equal(alta.status, 302);
		const web = listarProyectos(montaje.db).find((cual) => cual.clave === "WEB");
		assert.equal(web?.color, "rojo");
		assert.ok((await (await pedir(montaje, "/proyectos", { cookie })).text()).includes(chip("WEB", "rojo")));

		// La edición vuelve con el suyo marcado y lo cambia.
		const editar = await (await pedir(montaje, `/proyectos/${web?.id}/editar`, { cookie })).text();
		assert.match(editar, /<input type="radio" name="color" value="rojo" checked>/);
		const guardado = await pedir(montaje, `/proyectos/${web?.id}/editar`, {
			cookie,
			formulario: { nombre: "La web nueva", descripcion: "", color: "morado" },
		});
		assert.equal(guardado.status, 302);
		assert.equal(listarProyectos(montaje.db).find((cual) => cual.clave === "WEB")?.color, "morado");

		// Y el chip de una tarjeta del tablero cruzado lleva ese color.
		crearTareaHumana(montaje.db, { titulo: "Tarea de la web", descripcion: "d", usuarioId: 1, proyectoId: web?.id });
		const kanban = await (await pedir(montaje, "/tareas/kanban", { cookie })).text();
		assert.ok(kanban.includes(chip("WEB", "morado")), "la tarjeta no lleva el color del proyecto");
	} finally {
		await montaje.cerrar();
	}
});

test("crear un proyecto es una página aparte a la que lleva la lista", async () => {
	const montaje = montar();
	try {
		// Como el resto de la web, pide entrar.
		const sinSesion = await pedir(montaje, "/proyectos/nuevo");
		assert.equal(sinSesion.status, 302);
		assert.equal(sinSesion.headers.get("location"), "/login?volver=%2Fproyectos%2Fnuevo");

		const cookie = await entrar(montaje);
		const alta = await (await pedir(montaje, "/proyectos/nuevo", { cookie })).text();
		assert.match(alta, /<form method="post" action="\/proyectos">/);
		assert.match(alta, /<input type="text" name="clave" value="" placeholder="WEB" required>/);
		assert.match(alta, /<input type="text" name="ramaPrincipal" value="main" required>/);
		assert.match(alta, /<label class="muestra muestra-auto">/);
		assert.match(alta, /Un proyecto es un repositorio: clave, nombre, dónde está y cómo se verifica\./);
		assert.match(alta, /<a class="boton" href="\/proyectos">Cancelar<\/a>/);

		// Y la lista solo enlaza a ella: ni formulario al pie ni ancla.
		const lista = await (await pedir(montaje, "/proyectos", { cookie })).text();
		assert.match(lista, /<a class="boton principal" href="\/proyectos\/nuevo">Nuevo proyecto<\/a>/);
		assert.ok(!lista.includes('<form method="post" action="/proyectos">'), "la lista sigue llevando el alta");
		assert.ok(!lista.includes("nuevo-proyecto"), "la lista sigue llevando el ancla");
	} finally {
		await montaje.cerrar();
	}
});

test("el terminal se da de alta en un proyecto y la lista lo enseña", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const { web } = conDosProyectos(montaje);

		// El alta pide el proyecto, con el principal preseleccionado.
		const formulario = await (await pedir(montaje, "/terminales", { cookie })).text();
		assert.match(formulario, /<option value="1" selected>DEFAULT — Default<\/option>/);
		assert.match(formulario, /<option value="2">WEB — La web nueva<\/option>/);

		const alta = await pedir(montaje, "/terminales", {
			cookie,
			formulario: { nombre: "portatil-web", cuenta: "ana@ejemplo.com", agentes: "2", proyecto: String(web) },
		});
		assert.equal(alta.status, 200);
		const creado = listarTerminales(montaje.db).find((cual) => cual.nombre === "portatil-web");
		assert.equal(creado?.proyectoId, web);

		const lista = await (await pedir(montaje, "/terminales", { cookie })).text();
		assert.match(lista, /<th>Proyecto<\/th>/);
		assert.ok(lista.includes(chip("WEB", "verde")));
	} finally {
		await montaje.cerrar();
	}
});

test("la ficha enseña el proyecto y el alta acotada crea la tarea en él", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const { web } = conDosProyectos(montaje);

		const ficha = await (await pedir(montaje, `/tareas/${idFila(montaje, 2)}`, { cookie })).text();
		assert.match(ficha, /<dt>Proyecto<\/dt>/);
		assert.match(ficha, /<dd><a href="\/p\/WEB">.*?WEB<\/span><\/a> La web nueva<\/dd>/);

		// Desde el tablero de un proyecto, el alta ni pregunta: nace en él.
		const alta = await (await pedir(montaje, "/p/WEB/tareas/nueva", { cookie })).text();
		assert.match(alta, /<form method="post" action="\/p\/WEB\/tareas">/);
		assert.ok(!alta.includes('<select name="proyecto">'), "el proyecto viene de la ruta, no se elige");

		const creada = await pedir(montaje, "/p/WEB/tareas", {
			cookie,
			formulario: { titulo: "Nacida en la web", descripcion: "", analisisTerminal: "", ejecucionTerminal: "" },
		});
		assert.equal(creada.status, 302);
		assert.equal(creada.headers.get("location"), `/tareas/${idFila(montaje, 3)}`);
		assert.equal(buscarTarea(montaje.db, 3)?.proyectoId, web);

		// Sin prefijo, el proyecto es el que se estaba mirando: se enseña y no se
		// elige, y la tarea nace en él.
		const conWeb = conProyecto(cookie, "WEB");
		const cruzada = await (await pedir(montaje, "/tareas/nueva", { cookie: conWeb })).text();
		assert.ok(!cruzada.includes('<select name="proyecto">'), "el proyecto no se elige en el alta");
		assert.ok(cruzada.includes(chip("WEB", "verde")), "el alta no dice en qué proyecto nace");
		const enLaWeb = await pedir(montaje, "/tareas", {
			cookie: conWeb,
			formulario: { titulo: "Nacida en lo mirado", descripcion: "", analisisTerminal: "", ejecucionTerminal: "" },
		});
		assert.equal(enLaWeb.status, 302);
		assert.equal(buscarTarea(montaje.db, 4)?.proyectoId, web);

		// Sin nada recordado, el principal.
		const enElPrincipal = await pedir(montaje, "/tareas", {
			cookie,
			formulario: { titulo: "Nacida en el principal", descripcion: "", analisisTerminal: "", ejecucionTerminal: "" },
		});
		assert.equal(enElPrincipal.status, 302);
		assert.equal(buscarTarea(montaje.db, 5)?.proyectoId, 1);

		// Y la edición en backlog no muda de proyecto: enseña el suyo, sin desplegable.
		const ficha4 = await (await pedir(montaje, `/tareas/${idFila(montaje, 4)}`, { cookie })).text();
		assert.ok(!ficha4.includes('<select name="proyecto">'), "la edición no cambia de proyecto");
		const edicion = await pedir(montaje, `/tareas/${idFila(montaje, 4)}/editar`, {
			cookie,
			formulario: {
				titulo: "Nacida en lo mirado",
				descripcion: "",
				tipo: "tarea",
				analisisTerminal: "",
				ejecucionTerminal: "",
			},
		});
		assert.equal(edicion.status, 302);
		assert.equal(buscarTarea(montaje.db, 4)?.proyectoId, web);
	} finally {
		await montaje.cerrar();
	}
});

test("arrastrar en el tablero de un proyecto coloca entre las suyas y no mueve las de otro", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const web = crearProyecto(montaje.db, { clave: "WEB", nombre: "La web nueva" }).id;
		// La columna backlog queda: US00001 (DEFAULT), US00002 (WEB), US00003 (WEB).
		crearTareaHumana(montaje.db, { titulo: "Del principal", descripcion: "d", usuarioId: 1 });
		crearTareaHumana(montaje.db, { titulo: "Web una", descripcion: "d", usuarioId: 1, proyectoId: web });
		crearTareaHumana(montaje.db, { titulo: "Web dos", descripcion: "d", usuarioId: 1, proyectoId: web });

		// Soltar «Web dos» arriba del tablero de WEB la pone delante de «Web una»;
		// la del principal, que no sale en ese tablero, se queda donde estaba.
		const respuesta = await pedir(montaje, `/tareas/${idFila(montaje, 3)}/orden`, {
			cookie,
			formulario: { estado: "backlog", orden: "1", proyecto: "WEB" },
		});
		assert.equal(respuesta.status, 204);
		assert.equal(buscarTarea(montaje.db, 1)?.orden, 1);
		assert.equal(buscarTarea(montaje.db, 3)?.orden, 2);
		assert.equal(buscarTarea(montaje.db, 2)?.orden, 3);

		// Una tarjeta de otro proyecto no se coloca en ese tablero.
		const ajena = await pedir(montaje, `/tareas/${idFila(montaje, 1)}/orden`, {
			cookie,
			formulario: { estado: "backlog", orden: "1", proyecto: "WEB" },
		});
		assert.equal(ajena.status, 422);
		const fallo: unknown = await ajena.json();
		assert.equal((fallo as { codigo: string }).codigo, "otro_proyecto");
		assert.equal(buscarTarea(montaje.db, 1)?.orden, 1);
	} finally {
		await montaje.cerrar();
	}
});

test("las funcionalidades se acotan al proyecto y llevan su chip en la vista cruzada", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const web = crearProyecto(montaje.db, { clave: "WEB", nombre: "La web nueva" }).id;
		crearTareaHumana(montaje.db, {
			titulo: "Evolutivo del principal",
			descripcion: "d",
			usuarioId: 1,
			tipo: "funcionalidad",
		});
		crearTareaHumana(montaje.db, {
			titulo: "Evolutivo de la web",
			descripcion: "d",
			usuarioId: 1,
			tipo: "funcionalidad",
			proyectoId: web,
		});

		const cruzada = await (await pedir(montaje, "/funcionalidades", { cookie })).text();
		assert.match(cruzada, /Evolutivo del principal/);
		assert.match(cruzada, /Evolutivo de la web/);
		assert.ok(cruzada.includes(chip("WEB", "verde")));

		const acotada = await (await pedir(montaje, "/p/WEB/funcionalidades", { cookie })).text();
		assert.match(acotada, /Evolutivo de la web/);
		assert.ok(!acotada.includes("Evolutivo del principal"));
		assert.match(acotada, /href="\/p\/WEB\/tareas\/nueva\?tipo=funcionalidad"/);
	} finally {
		await montaje.cerrar();
	}
});

/** La barra lateral de una página, sin el resto. */
function barraDe(cuerpo: string): string {
	return cuerpo.slice(cuerpo.indexOf('<aside class="lateral"'), cuerpo.indexOf("</aside>"));
}

/**
 * Una base que cuenta las lecturas del índice de un proyecto: cada `.all` de
 * la consulta con la CTE `arbol` filtrada por proyecto. El panel tiene que
 * hacer una sola, nunca una por funcionalidad.
 */
function contandoIndice(db: DatabaseSync): { db: DatabaseSync; lecturas: () => number } {
	let lecturas = 0;
	const proxy = new Proxy(db, {
		get(objetivo, nombre) {
			const valor = Reflect.get(objetivo, nombre, objetivo);
			if (nombre !== "prepare" || typeof valor !== "function") {
				return typeof valor === "function" ? valor.bind(objetivo) : valor;
			}
			return (sql: string) => {
				const sentencia = objetivo.prepare(sql);
				const delIndice = sql.includes("WITH RECURSIVE arbol") && sql.includes("t.proyecto_id = ?");
				return new Proxy(sentencia, {
					get(otra, cual) {
						const metodo = Reflect.get(otra, cual, otra);
						if (typeof metodo !== "function") {
							return metodo;
						}
						return (...argumentos: unknown[]) => {
							if (delIndice && cual === "all") {
								lecturas += 1;
							}
							return metodo.apply(otra, argumentos);
						};
					},
				});
			};
		},
	});
	return { db: proxy, lecturas: () => lecturas };
}

test("el panel del proyecto: cifras, ahora mismo, funcionalidades, cerradas, sueltas y propiedades, en una sola lectura", async () => {
	const base = abrirBaseDeDatos(":memory:");
	crearUsuario(base, "ana", hashPassword("secreta"));
	const contado = contandoIndice(base);
	const { app, cerrar } = crearApp({ db: contado.db, config: CONFIG_PRUEBA });
	const montaje: Montaje = {
		db: base,
		app,
		cerrar: async () => {
			await cerrar();
			base.close();
		},
	};
	try {
		const cookie = await entrar(montaje);
		const db = base;
		const web = crearProyecto(db, {
			clave: "WEB",
			nombre: "La web nueva",
			descripcion: "El **frontal** de clientes.",
			verificacion: "npm test",
		});
		const { terminal } = altaTerminal(db, {
			usuarioId: 1,
			nombre: "portatil-web",
			cuenta: "ana@ejemplo.com",
			proyectoId: web.id,
		});
		const estado = (id: number, cual: string) => db.prepare("UPDATE tareas SET estado = ? WHERE id = ?").run(cual, id);
		const nueva = (titulo: string, extra: { tipo?: "funcionalidad" | "pregunta"; padreId?: number } = {}) =>
			crearTareaHumana(db, { titulo, descripcion: "d", usuarioId: 1, proyectoId: web.id, ...extra });

		// Una funcionalidad en curso con una parte en cada uno de tres estados.
		const portal = nueva("Portal de clientes", { tipo: "funcionalidad" });
		const pantalla = nueva("La pantalla", { padreId: portal.id });
		const servicio = nueva("El servicio", { padreId: portal.id });
		const cerrada = nueva("El diseño", { padreId: portal.id });
		estado(servicio.id, "doing");
		estado(cerrada.id, "finished");
		estado(portal.id, "doing");
		// El servicio lo trabaja un agente y tiene una hija de trabajo, que no es parte.
		db.prepare("UPDATE tareas SET en_marcha_terminal_id = ? WHERE id = ?").run(terminal.id, servicio.id);
		const hijaPortal = nueva("Trozo del servicio", { padreId: servicio.id });
		db.prepare("UPDATE tareas SET clase = 'hija', estado = 'doing' WHERE id = ?").run(hijaPortal.id);
		// Una funcionalidad ya cerrada.
		const vieja = nueva("Alta de comerciales", { tipo: "funcionalidad" });
		estado(nueva("Formulario de alta", { padreId: vieja.id }).id, "finished");
		estado(vieja.id, "finished");
		// Sueltas: una con una pregunta abierta, una hecha, una cerrada y una hija de trabajo.
		const bloqueada = nueva("Migrar los correos");
		estado(bloqueada.id, "prepared");
		db
			.prepare(
				`INSERT INTO preguntas (tarea_id, numero, pregunta, por_que_importa, opciones_json, recomendacion, creada, revision)
				VALUES (?, 1, '¿Cola?', 'Importa', '[]', 'Redis', '2026-01-01T00:00:00Z', 1)`,
			)
			.run(bloqueada.id);
		const hecha = nueva("Botón de exportar");
		estado(hecha.id, "done");
		estado(nueva("Suelta ya cerrada").id, "finished");
		const hija = nueva("Hija suelta", { padreId: hecha.id });
		db.prepare("UPDATE tareas SET clase = 'hija' WHERE id = ?").run(hija.id);
		// Lo del otro proyecto no cuenta.
		const ajena = crearTareaHumana(db, { titulo: "Ajena", descripcion: "d", usuarioId: 1 });
		estado(ajena.id, "done");

		const antes = contado.lecturas();
		const respuesta = await pedir(montaje, "/p/WEB", { cookie });
		assert.equal(respuesta.status, 200);
		assert.equal(contado.lecturas() - antes, 1, "el panel lee el índice del proyecto una sola vez");
		assert.equal(recordado(respuesta), "WEB");
		const cuerpo = await respuesta.text();
		assert.match(cuerpo, /data-vista="proyecto"/);
		assert.match(
			cuerpo,
			/<nav class="migas"[^>]*>\s*<a href="\/p\/WEB">WEB<\/a>\s*<span class="separador"[^>]*>›<\/span><span>Proyecto<\/span>/,
		);
		assert.match(cuerpo, /<h1>La web nueva<\/h1>/);
		assert.match(cuerpo, /<div class="proposito"><p>El <strong>frontal<\/strong> de clientes\.<\/p>/);
		assert.match(cuerpo, new RegExp(`<a class="boton" href="/proyectos/${web.id}/editar">Editar</a>`));
		assert.match(
			cuerpo,
			/<nav class="vistas pestanas"[^>]*>\s*<a href="\/p\/WEB" aria-current="page">Panel<\/a><a href="\/p\/WEB\/informes">Informes<\/a><a href="\/p\/WEB\/actividad">Actividad<\/a>/,
		);
		assert.doesNotMatch(cuerpo, /Resumen/);

		// En su orden: cifras, ahora mismo, funcionalidades, cerradas, sueltas y propiedades.
		const orden = [
			'<section class="cifras"',
			"<h2>Ahora mismo</h2>",
			"<h2>Funcionalidades</h2>",
			"<summary>Cerradas (1)</summary>",
			"<h2>Tareas sueltas</h2>",
			"<summary>Propiedades del proyecto</summary>",
		];
		const posiciones = orden.map((trozo) => cuerpo.indexOf(trozo));
		assert.ok(
			posiciones.every((posicion) => posicion >= 0),
			`falta algún bloque: ${posiciones.join(", ")}`,
		);
		assert.deepEqual(
			[...posiciones].sort((a, b) => a - b),
			posiciones,
		);
		const trozo = (desde: string, hasta: string) => cuerpo.slice(cuerpo.indexOf(desde), cuerpo.indexOf(hasta));
		const cifras = trozo('<section class="cifras"', "<h2>Ahora mismo</h2>");
		const abiertas = trozo("<h2>Funcionalidades</h2>", "<summary>Cerradas (1)</summary>");
		const cerradas = trozo("<summary>Cerradas (1)</summary>", "<h2>Tareas sueltas</h2>");
		const sueltas = trozo("<h2>Tareas sueltas</h2>", "<summary>Propiedades del proyecto</summary>");

		// Las cifras. Tareas: tres partes del portal, la del alta y tres sueltas;
		// ni funcionalidades ni hijas de trabajo. Abiertas, las cuatro no cerradas.
		const cifra = (rotulo: string) =>
			new RegExp(
				`<div class="cifra([^"]*)">\\s*<span class="cifra-valor">((?:(?!cifra-valor).)*?)</span>\\s*<span class="cifra-rotulo">${rotulo}</span>`,
				"s",
			).exec(cifras);
		assert.equal(cifra("Funcionalidades abiertas")?.[2], "1");
		assert.equal(cifra("Tareas abiertas")?.[2], "4");
		assert.match(cifras, /<title>1 por definir · 1 preparada · 1 en curso · 1 hecha · 3 cerradas<\/title>/);
		assert.equal(cifras.match(/<rect /g)?.length, 5);
		for (const leyenda of ["1 por definir", "1 preparada", "1 en curso", "1 hecha", "3 cerradas"]) {
			assert.match(cifras, new RegExp(`<span class="punto [^"]*"></span>${leyenda}</span>`), leyenda);
		}
		// Espera por ti: la pregunta, nada por aprobar y el resultado por revisar.
		const espera = cifra("Espera por ti");
		assert.equal(espera?.[1], " en-turno");
		assert.equal(espera?.[2], "2");
		for (const texto of ["Contesta 1", "Aprueba 0", "Revisa 1"]) {
			assert.match(cifras, new RegExp(`<a href="/p/WEB/tareas\\?rapido=espera">${texto}</a>`), texto);
		}
		const agentes = cifra("Agentes trabajando");
		assert.match(agentes?.[2] ?? "", /class="punto latido[^"]*"[^>]*><\/span>1/);

		assert.match(cuerpo, /<strong>portatil-web<\/strong>/);

		// La funcionalidad en curso: su barra de partes, la cuenta y sus partes dentro.
		assert.match(abiertas, /<details class="desplegable">\s*<summary>/);
		assert.match(abiertas, /tareas 1\/3/);
		const barraPortal = /<svg class="barra-apilada"[^>]*>(.*?)<\/svg>/s.exec(abiertas)?.[1] ?? "";
		assert.equal(barraPortal.match(/<rect /g)?.length, 3);
		assert.match(barraPortal, /<title>1 por definir · 1 en curso · 1 cerrada<\/title>/);
		for (const parte of [pantalla, servicio, cerrada]) {
			assert.match(abiertas, new RegExp(`<a class="id-tarea" href="/tareas/${parte.codigo}">${parte.codigo}</a>`));
			assert.match(parte.codigo, /^US/);
		}
		assert.doesNotMatch(abiertas, new RegExp(hijaPortal.codigo));
		assert.match(abiertas, /<span class="trabajando"[^>]*><span class="punto latido[^>]*><\/span>1<\/span>/);
		assert.doesNotMatch(abiertas, new RegExp(vieja.codigo));
		assert.match(cerradas, new RegExp(vieja.codigo));

		// Sueltas: ni las cerradas ni las hijas de trabajo ni lo de otro proyecto.
		assert.match(sueltas, new RegExp(bloqueada.codigo));
		assert.match(sueltas, new RegExp(hecha.codigo));
		assert.doesNotMatch(sueltas, /Suelta ya cerrada/);
		assert.doesNotMatch(sueltas, new RegExp(hija.codigo));
		assert.doesNotMatch(cuerpo, new RegExp(ajena.codigo));

		// Las propiedades, plegadas al final.
		assert.match(cuerpo, /<details class="caja propiedades-proyecto">\s*<summary>Propiedades del proyecto<\/summary>/);
		assert.match(cuerpo, /<dt>Verificación<\/dt>\s*<dd><code>npm test<\/code><\/dd>/);
		assert.match(cuerpo, /<dt>Rama principal<\/dt>\s*<dd><code>main<\/code><\/dd>/);
		assert.match(cuerpo, /<dt>Creado por<\/dt>/);
		// «Proyecto» está activa en la barra; Configuración, cerrada.
		assert.match(barraDe(cuerpo), /<a class="enlace-nav" href="\/p\/WEB" aria-current="page">Proyecto<\/a>/);
		assert.match(barraDe(cuerpo), /<details class="bloque">/);

		// El principal: sin descripción ni terminales, con la tarea ajena por revisar.
		const principal = await (await pedir(montaje, "/p/DEFAULT", { cookie })).text();
		assert.match(
			principal,
			/<p class="proposito">Cómo va el proyecto: qué se está trabajando, qué espera por ti y qué falta\.<\/p>/,
		);
		assert.match(principal, /Sin terminales en este proyecto\./);
		assert.match(
			principal,
			/<div class="cifra">\s*<span class="cifra-valor">0<\/span>\s*<span class="cifra-rotulo">Agentes trabajando/,
		);
		assert.match(
			principal,
			/<div class="cifra en-turno">\s*<span class="cifra-valor">1<\/span>\s*<span class="cifra-rotulo">Espera por ti/,
		);
		assert.doesNotMatch(principal, /portatil-web/);

		assert.equal((await pedir(montaje, "/p/NOEXISTE", { cookie })).status, 404);
	} finally {
		await montaje.cerrar();
	}
});

test("un proyecto sin tareas enseña «Nada todavía» con el enlace de alta", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		crearProyecto(montaje.db, { clave: "VACIO", nombre: "Vacío", descripcion: "" });
		const cuerpo = await (await pedir(montaje, "/p/VACIO", { cookie })).text();
		assert.match(cuerpo, /Nada todavía\. <a href="\/p\/VACIO\/tareas\/nueva">Crea la primera tarea<\/a>/);
		assert.doesNotMatch(cuerpo, /<h2>Funcionalidades<\/h2>/);
		assert.doesNotMatch(cuerpo, /<svg class="barra-apilada"/);
		// Sin nada que esperar, la cifra no lleva la señal; sin agentes, no late.
		assert.match(
			cuerpo,
			/<div class="cifra">\s*<span class="cifra-valor">0<\/span>\s*<span class="cifra-rotulo">Espera por ti/,
		);
		assert.doesNotMatch(cuerpo, /latido/);
	} finally {
		await montaje.cerrar();
	}
});

test("los informes y la actividad del proyecto son pestañas de su página; las vistas cruzadas siguen", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		conDosProyectos(montaje);
		// Una acción sobre un usuario: es global, no de ningún proyecto.
		cambiarColor(montaje.db, { usuarioId: 1, color: "verde", actorId: 1 });

		const informes = await (await pedir(montaje, "/p/WEB/informes", { cookie })).text();
		assert.match(informes, /data-vista="proyecto-informes"/);
		assert.match(informes, /<h1>La web nueva<\/h1>/);
		assert.match(informes, /<nav class="migas"[^>]*>\s*<a href="\/p\/WEB">WEB<\/a>/);
		assert.match(informes, /<a href="\/p\/WEB\/informes" aria-current="page">Informes<\/a>/);
		assert.match(informes, /¿Qué cuesta cada modelo\?/);
		assert.match(barraDe(informes), /<a class="enlace-nav" href="\/p\/WEB" aria-current="page">Proyecto<\/a>/);

		const cruzados = await (await pedir(montaje, "/informes", { cookie })).text();
		assert.match(cruzados, /<h1>Informes<\/h1>/);
		assert.doesNotMatch(cruzados, /class="vistas pestanas"/);
		assert.doesNotMatch(barraDe(cruzados), /aria-current="page">Proyecto/);

		const respuesta = await pedir(montaje, "/p/WEB/actividad", { cookie });
		assert.equal(respuesta.status, 200);
		const actividad = await respuesta.text();
		assert.match(actividad, /data-vista="proyecto-actividad"/);
		assert.match(actividad, /<a href="\/p\/WEB\/actividad" aria-current="page">Actividad<\/a>/);
		assert.match(barraDe(actividad), /<a class="enlace-nav" href="\/p\/WEB" aria-current="page">Proyecto<\/a>/);
		assert.match(actividad, /<section class="dia">/);
		assert.match(actividad, /Tarea de la web/);
		assert.doesNotMatch(actividad, /Tarea del principal/);
		assert.doesNotMatch(actividad, /cambió el color de/);

		const todo = await (await pedir(montaje, "/actividad", { cookie })).text();
		assert.match(todo, /Tarea de la web/);
		assert.match(todo, /Tarea del principal/);
		assert.match(todo, /cambió el color de/);
	} finally {
		await montaje.cerrar();
	}
});

test("la lista de proyectos enlaza a la página de cada uno y a las vistas cruzadas", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		conDosProyectos(montaje);
		const lista = await (await pedir(montaje, "/proyectos", { cookie })).text();
		assert.match(lista, /<a href="\/p\/WEB">La web nueva<\/a>/);
		assert.match(lista, /<a href="\/p\/DEFAULT">Default<\/a>/);
		assert.match(lista, /<a class="boton" href="\/informes">Informes de todos los proyectos<\/a>/);
		assert.match(lista, /<a class="boton" href="\/actividad">Actividad de todo<\/a>/);
	} finally {
		await montaje.cerrar();
	}
});
