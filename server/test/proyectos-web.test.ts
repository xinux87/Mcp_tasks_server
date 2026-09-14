import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Hono } from "hono";
import { crearApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { listarTerminales } from "../src/db/admin.ts";
import { crearUsuario } from "../src/db/consultas.ts";
import { crearProyecto, listarProyectos } from "../src/db/proyectos.ts";
import { buscarTarea, crearTareaHumana } from "../src/db/tareas.ts";
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
		formulario: { usuario: "xinux", password: "secreta", volver: "/tareas" },
	});
	assert.equal(respuesta.status, 302);
	const primera = (respuesta.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
	assert.ok(primera.startsWith("sesion="), `la cookie no se llama sesion: ${primera}`);
	return primera;
}

/** El chip de un proyecto, tal como lo pinta `chipProyecto`. */
function chip(clave: string): string {
	return `<span class="insignia proyecto color-gris">${clave}</span>`;
}

/** Un proyecto nuevo con una tarea suya, que es el montaje de casi todo. */
function conDosProyectos(montaje: Montaje): { web: number } {
	const web = crearProyecto(montaje.db, { clave: "WEB", nombre: "La web nueva" }).id;
	crearTareaHumana(montaje.db, { titulo: "Tarea del principal", descripcion: "d", usuarioId: 1 });
	crearTareaHumana(montaje.db, { titulo: "Tarea de la web", descripcion: "d", usuarioId: 1, proyectoId: web });
	return { web };
}

test("la vista acotada solo trae las tareas de su proyecto y la cruzada las enseña con su chip", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		conDosProyectos(montaje);

		// La cruzada: las dos, cada una con el chip de su proyecto y el filtro.
		for (const ruta of ["/tareas", "/tareas/kanban"]) {
			const cuerpo = await (await pedir(montaje, ruta, { cookie })).text();
			assert.match(cuerpo, /Tarea del principal/, `${ruta} no trae la del principal`);
			assert.match(cuerpo, /Tarea de la web/, `${ruta} no trae la de la web`);
			assert.ok(cuerpo.includes(chip("PRI")), `${ruta} no pinta el chip de PRI`);
			assert.ok(cuerpo.includes(chip("WEB")), `${ruta} no pinta el chip de WEB`);
			assert.match(cuerpo, /<select name="proyecto">/, `${ruta} no trae el filtro por proyecto`);
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
		assert.match(kanban, /<a class="id-tarea" href="\/tareas\/T-0002">/);

		// El fragmento que recarga el cliente sale por la misma ruta acotada.
		const fragmento = await pedir(montaje, "/p/WEB/tareas/kanban/tablero", { cookie });
		assert.equal(fragmento.status, 200);
		const cuerpoFragmento = await fragmento.text();
		assert.ok(cuerpoFragmento.trimStart().startsWith('<section id="tablero"'));
		assert.match(cuerpoFragmento, /data-id="T-0002"/);
		assert.ok(!cuerpoFragmento.includes('data-id="T-0001"'));

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
		const sinSesion = await pedir(montaje, "/p/PRI/tareas");
		assert.equal(sinSesion.status, 302);
		assert.equal(sinSesion.headers.get("location"), "/login?volver=%2Fp%2FPRI%2Ftareas");
	} finally {
		await montaje.cerrar();
	}
});

test("el selector de la barra lateral lleva puesto el proyecto de la URL", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		conDosProyectos(montaje);

		const cruzada = await (await pedir(montaje, "/tareas", { cookie })).text();
		assert.match(cruzada, /<option value="\/tareas" selected>Todos los proyectos<\/option>/);
		assert.match(cruzada, /<option value="\/p\/WEB\/tareas">WEB · La web nueva<\/option>/);

		// En una vista acotada, la opción del proyecto y el destino de cada vista.
		const kanban = await (await pedir(montaje, "/p/WEB/tareas/kanban", { cookie })).text();
		assert.match(kanban, /<option value="\/p\/WEB\/tareas\/kanban" selected>WEB · La web nueva<\/option>/);
		assert.match(kanban, /<option value="\/tareas\/kanban">Todos los proyectos<\/option>/);
		// Y la navegación se queda dentro del proyecto.
		assert.match(kanban, /<a class="enlace-nav" href="\/p\/WEB\/tareas">Lista<\/a>/);
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
				repositorio: "https://github.com/xinux87/web.git",
				ramaPrincipal: "main",
				verificacion: "npm test",
			},
		});
		assert.equal(alta.status, 302);
		const web = listarProyectos(montaje.db).find((cual) => cual.clave === "WEB");
		assert.ok(web !== undefined, "la clave se guarda en mayúsculas");
		// El `.git` y la barra final no son parte del repositorio.
		assert.equal(web.repositorio, "https://github.com/xinux87/web");

		// La clave repetida no crea otro, y el aviso se ve en la misma página.
		const repetida = await pedir(montaje, "/proyectos", { cookie, formulario: { clave: "WEB", nombre: "Otra" } });
		assert.equal(repetida.status, 422);
		assert.match(await repetida.text(), /Ya hay un proyecto con la clave/);

		// La tabla, con sus cuentas y quién lo creó.
		const lista = await (await pedir(montaje, "/proyectos", { cookie })).text();
		assert.ok(lista.includes(chip("PRI")) && lista.includes(chip("WEB")));
		assert.match(lista, /<th>Rama principal<\/th>/);
		assert.match(lista, /<th class="numero">Tareas abiertas<\/th>/);
		assert.match(lista, /<span class="chip color-azul"><span class="inicial">X<\/span>xinux<\/span>/);

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
		montaje.db.exec(`DELETE FROM tareas WHERE id = ${tarea.id}`);
		const conTerminal = await pedir(montaje, "/terminales", {
			cookie,
			formulario: { nombre: "portatil", cuenta: "xinux@ejemplo.com", agentes: "1", proyecto: String(web.id) },
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

test("el terminal se da de alta en un proyecto y la lista lo enseña", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const { web } = conDosProyectos(montaje);

		// El alta pide el proyecto, con el principal preseleccionado.
		const formulario = await (await pedir(montaje, "/terminales", { cookie })).text();
		assert.match(formulario, /<option value="1" selected>PRI · Principal<\/option>/);
		assert.match(formulario, /<option value="2">WEB · La web nueva<\/option>/);

		const alta = await pedir(montaje, "/terminales", {
			cookie,
			formulario: { nombre: "portatil-web", cuenta: "xinux@ejemplo.com", agentes: "2", proyecto: String(web) },
		});
		assert.equal(alta.status, 200);
		const creado = listarTerminales(montaje.db).find((cual) => cual.nombre === "portatil-web");
		assert.equal(creado?.proyectoId, web);

		const lista = await (await pedir(montaje, "/terminales", { cookie })).text();
		assert.match(lista, /<th>Proyecto<\/th>/);
		assert.ok(lista.includes(chip("WEB")));
	} finally {
		await montaje.cerrar();
	}
});

test("la ficha enseña el proyecto y el alta acotada crea la tarea en él", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const { web } = conDosProyectos(montaje);

		const ficha = await (await pedir(montaje, "/tareas/T-0002", { cookie })).text();
		assert.match(ficha, /<dt>Proyecto<\/dt>/);
		assert.match(ficha, /<dd><a href="\/p\/WEB\/tareas">.*?WEB<\/span><\/a> La web nueva<\/dd>/);

		// Desde el tablero de un proyecto, el alta ni pregunta: nace en él.
		const alta = await (await pedir(montaje, "/p/WEB/tareas/nueva", { cookie })).text();
		assert.match(alta, /<form method="post" action="\/p\/WEB\/tareas">/);
		assert.ok(!alta.includes('<select name="proyecto">'), "el proyecto viene de la ruta, no se elige");

		const creada = await pedir(montaje, "/p/WEB/tareas", {
			cookie,
			formulario: { titulo: "Nacida en la web", descripcion: "", analisisTerminal: "", ejecucionTerminal: "" },
		});
		assert.equal(creada.status, 302);
		assert.equal(creada.headers.get("location"), "/tareas/T-0003");
		assert.equal(buscarTarea(montaje.db, 3)?.proyectoId, web);

		// Desde la vista cruzada se elige, con el principal puesto.
		const cruzada = await (await pedir(montaje, "/tareas/nueva", { cookie })).text();
		assert.match(cruzada, /<option value="1" selected>PRI · Principal<\/option>/);
		const enLaWeb = await pedir(montaje, "/tareas", {
			cookie,
			formulario: {
				titulo: "Elegida a mano",
				descripcion: "",
				proyecto: String(web),
				analisisTerminal: "",
				ejecucionTerminal: "",
			},
		});
		assert.equal(enLaWeb.status, 302);
		assert.equal(buscarTarea(montaje.db, 4)?.proyectoId, web);

		// Y la edición en backlog cambia de proyecto una tarea que está sola.
		const mudanza = await pedir(montaje, "/tareas/T-0004/editar", {
			cookie,
			formulario: {
				titulo: "Elegida a mano",
				descripcion: "",
				proyecto: "1",
				tipo: "tarea",
				analisisTerminal: "",
				ejecucionTerminal: "",
			},
		});
		assert.equal(mudanza.status, 302);
		assert.equal(buscarTarea(montaje.db, 4)?.proyectoId, 1);
	} finally {
		await montaje.cerrar();
	}
});

test("arrastrar en el tablero de un proyecto coloca entre las suyas y no mueve las de otro", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		const web = crearProyecto(montaje.db, { clave: "WEB", nombre: "La web nueva" }).id;
		// La columna backlog queda: T-0001 (PRI), T-0002 (WEB), T-0003 (WEB).
		crearTareaHumana(montaje.db, { titulo: "Del principal", descripcion: "d", usuarioId: 1 });
		crearTareaHumana(montaje.db, { titulo: "Web una", descripcion: "d", usuarioId: 1, proyectoId: web });
		crearTareaHumana(montaje.db, { titulo: "Web dos", descripcion: "d", usuarioId: 1, proyectoId: web });

		// Soltar «Web dos» arriba del tablero de WEB la pone delante de «Web una»;
		// la del principal, que no sale en ese tablero, se queda donde estaba.
		const respuesta = await pedir(montaje, "/tareas/T-0003/orden", {
			cookie,
			formulario: { estado: "backlog", orden: "1", proyecto: "WEB" },
		});
		assert.equal(respuesta.status, 204);
		assert.equal(buscarTarea(montaje.db, 1)?.orden, 1);
		assert.equal(buscarTarea(montaje.db, 3)?.orden, 2);
		assert.equal(buscarTarea(montaje.db, 2)?.orden, 3);

		// Una tarjeta de otro proyecto no se coloca en ese tablero.
		const ajena = await pedir(montaje, "/tareas/T-0001/orden", {
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
		assert.ok(cruzada.includes(chip("WEB")));

		const acotada = await (await pedir(montaje, "/p/WEB/funcionalidades", { cookie })).text();
		assert.match(acotada, /Evolutivo de la web/);
		assert.ok(!acotada.includes("Evolutivo del principal"));
		assert.match(acotada, /href="\/p\/WEB\/tareas\/nueva\?tipo=funcionalidad"/);
	} finally {
		await montaje.cerrar();
	}
});
