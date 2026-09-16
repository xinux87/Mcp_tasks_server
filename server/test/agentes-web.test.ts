import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Hono } from "hono";
import { crearApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { crearTerminalConToken } from "../src/auth/tokens.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { buscarAgentePorNombre, listarAgentes } from "../src/db/agentes.ts";
import { crearUsuario } from "../src/db/consultas.ts";
import { exigirTarea } from "../src/db/tareas.ts";
import { formatearId } from "../src/md/ids.ts";
import { BASE_URL_PRUEBA, CONFIG_PRUEBA } from "./comun.ts";

/**
 * Los agentes en la web: la página de gestión con su alta, su edición y su
 * borrado en página aparte, el desplegable de papel del formulario de tarea y
 * el agente en la ficha.
 */

type Montaje = {
	db: DatabaseSync;
	app: Hono;
	/** El terminal al que se puede atar un agente. */
	terminal: number;
	cerrar: () => Promise<void>;
};

function montar(): Montaje {
	const db = abrirBaseDeDatos(":memory:");
	const { valor: usuario } = crearUsuario(db, "ana", hashPassword("secreta"));
	const { valor } = crearTerminalConToken(db, usuario.id, "portatil-ana", "ana@ejemplo.com");
	const { app, cerrar } = crearApp({ db, config: CONFIG_PRUEBA });
	return {
		db,
		app,
		terminal: valor.terminal.id,
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
		formulario: { usuario: "ana", password: "secreta", volver: "/agentes" },
	});
	assert.equal(respuesta.status, 302);
	return (respuesta.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

/** El alta de un agente tal como la manda el formulario. */
async function crear(montaje: Montaje, cookie: string, campos: Record<string, string>): Promise<Response> {
	return await pedir(montaje, "/agentes", {
		cookie,
		formulario: {
			nombre: "revisor",
			descripcion: "Revisa lo entregado",
			instrucciones: "Eres el revisor de lo que entregan los demás.",
			modelo: "sonnet",
			terminal: "",
			...campos,
		},
	});
}

test("sin sesión, la página de agentes lleva al login", async () => {
	const montaje = montar();
	try {
		const respuesta = await pedir(montaje, "/agentes");
		assert.equal(respuesta.status, 302);
		assert.equal(respuesta.headers.get("location"), "/login?volver=%2Fagentes");
	} finally {
		await montaje.cerrar();
	}
});

test("el alta crea el papel y un nombre repetido vuelve a la misma página con lo escrito", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);

		// La lista vacía lo dice, y ofrece el alta.
		const vacia = await (await pedir(montaje, "/agentes", { cookie })).text();
		assert.match(vacia, /Un agente es un papel/);
		assert.match(vacia, /href="\/agentes\/nuevo"/);

		// El formulario de alta pide nombre, instrucciones, modelo y terminal.
		const formulario = await (await pedir(montaje, "/agentes/nuevo", { cookie })).text();
		assert.match(formulario, /name="nombre"/);
		assert.match(formulario, /<textarea class="codigo" name="instrucciones" rows="18"/);
		assert.match(formulario, /<option value="haiku">haiku<\/option>/);
		assert.match(formulario, /<option value="1">portatil-ana<\/option>/);

		const alta = await crear(montaje, cookie, { terminal: String(montaje.terminal) });
		assert.equal(alta.status, 302);
		assert.equal(alta.headers.get("location"), "/agentes");
		const agente = buscarAgentePorNombre(montaje.db, "revisor");
		assert.equal(agente?.modelo, "sonnet");
		assert.equal(agente?.terminalId, montaje.terminal);
		assert.equal(agente?.instrucciones, "Eres el revisor de lo que entregan los demás.");

		// La lista: nombre enlazado a su edición, modelo, terminal, fases y quién lo creó.
		const lista = await (await pedir(montaje, "/agentes", { cookie })).text();
		assert.match(lista, /<a href="\/agentes\/1\/editar">revisor<\/a>/);
		assert.match(lista, /portatil-ana/);
		assert.match(lista, /Revisa lo entregado/);
		assert.match(lista, /class="chip color-\w+"><span class="inicial">A<\/span>ana/);

		// El mismo nombre otra vez: 422 en la página de alta, con lo escrito puesto.
		const repetido = await crear(montaje, cookie, { descripcion: "Otro papel" });
		assert.equal(repetido.status, 422);
		const cuerpo = await repetido.text();
		assert.match(cuerpo, /Ya hay un agente que se llama «revisor»/);
		assert.match(cuerpo, /action="\/agentes"/);
		assert.match(cuerpo, /value="Otro papel"/);
		assert.equal(listarAgentes(montaje.db).length, 1);
	} finally {
		await montaje.cerrar();
	}
});

test("editar un agente cambia su modelo y deja rastro con el objeto enlazado", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await crear(montaje, cookie, {});

		// La edición no deja tocar el nombre: se fija al crear.
		const pagina = await (await pedir(montaje, "/agentes/1/editar", { cookie })).text();
		assert.match(pagina, /action="\/agentes\/1\/editar"/);
		assert.doesNotMatch(pagina, /name="nombre"/);
		assert.match(pagina, /<option value="sonnet" selected>sonnet<\/option>/);

		const guardar = await pedir(montaje, "/agentes/1/editar", {
			cookie,
			formulario: {
				descripcion: "Revisa lo entregado",
				instrucciones: "Eres el revisor de lo que entregan los demás.",
				modelo: "opus",
				terminal: String(montaje.terminal),
			},
		});
		assert.equal(guardar.status, 302);
		const agente = buscarAgentePorNombre(montaje.db, "revisor");
		assert.equal(agente?.modelo, "opus");
		assert.equal(agente?.terminalId, montaje.terminal);

		// Un modelo que no existe rompe la regla y repinta la edición.
		const malo = await pedir(montaje, "/agentes/1/editar", {
			cookie,
			formulario: { descripcion: "", instrucciones: "x", modelo: "gpt", terminal: "" },
		});
		assert.equal(malo.status, 422);
		assert.match(await malo.text(), /El modelo de un agente es uno de/);

		const actividad = await (await pedir(montaje, "/actividad", { cookie })).text();
		assert.match(actividad, /creó el agente/);
		assert.match(actividad, /editó el agente/);
		assert.match(actividad, /<a class="objeto" href="\/agentes\/1\/editar">revisor<\/a>/);
		assert.match(actividad, /modelo: sonnet → opus/);
	} finally {
		await montaje.cerrar();
	}
});

test("borrar un agente avisa de las fases que suelta y la tarea se queda con lo copiado", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await crear(montaje, cookie, { terminal: String(montaje.terminal) });

		// Una tarea con el papel en las dos fases: son dos fases asignadas.
		const alta = await pedir(montaje, "/tareas", {
			cookie,
			formulario: {
				titulo: "Exportar el listado",
				descripcion: "Lo de siempre.",
				tipo: "tarea",
				analisisAgente: "1",
				ejecucionAgente: "1",
				analisisTerminal: "",
				ejecucionTerminal: "",
			},
		});
		assert.equal(alta.status, 302);
		const tarea = exigirTarea(montaje.db, 1);
		assert.equal(tarea.analisisAgenteId, 1);
		assert.equal(tarea.ejecucionAgenteId, 1);

		const confirmacion = await (await pedir(montaje, "/agentes/1/borrar", { cookie })).text();
		assert.match(confirmacion, /Está asignado a <strong>2<\/strong> fases/);

		const borrado = await pedir(montaje, "/agentes/1/borrar", { cookie, formulario: {} });
		assert.equal(borrado.status, 302);
		assert.equal(listarAgentes(montaje.db).length, 0);

		// La tarea sigue viva con el modelo y el terminal que le copió el papel.
		const suelta = exigirTarea(montaje.db, 1);
		assert.equal(suelta.analisisAgenteId, null);
		assert.equal(suelta.analisisModelo, "sonnet");
		assert.equal(suelta.analisisTerminalId, montaje.terminal);
		const ficha = await (await pedir(montaje, `/tareas/${formatearId(suelta.codigo)}`, { cookie })).text();
		assert.doesNotMatch(ficha, /\/agentes\/1\/editar/);
		assert.match(ficha, /sonnet@portatil-ana/);

		// El rastro del papel que ya no está lleva a la lista, no a una edición.
		const actividad = await (await pedir(montaje, "/actividad", { cookie })).text();
		assert.match(actividad, /borró el agente/);
		assert.match(actividad, /<a class="objeto" href="\/agentes">revisor<\/a>/);
	} finally {
		await montaje.cerrar();
	}
});

test("el formulario de tarea ofrece el papel de cada fase y el servidor copia lo suyo", async () => {
	const montaje = montar();
	try {
		const cookie = await entrar(montaje);
		await crear(montaje, cookie, { terminal: String(montaje.terminal) });

		// Cada opción trae puestos el modelo y el terminal del agente: es lo que
		// el cliente copia en los otros dos desplegables.
		const formulario = await (await pedir(montaje, "/tareas/nueva", { cookie })).text();
		assert.match(formulario, /<select name="analisisAgente" data-agente>/);
		assert.match(formulario, /<select name="ejecucionAgente" data-agente>/);
		assert.match(formulario, /<option value="1" data-modelo="sonnet" data-terminal="1">revisor<\/option>/);

		// Aunque el formulario mande otro modelo y ningún terminal, manda el papel.
		const alta = await pedir(montaje, "/tareas", {
			cookie,
			formulario: {
				titulo: "Exportar el listado",
				descripcion: "Lo de siempre.",
				tipo: "tarea",
				analisisAgente: "1",
				analisisModelo: "haiku",
				analisisTerminal: "",
				ejecucionModelo: "opus",
				ejecucionTerminal: "",
			},
		});
		assert.equal(alta.status, 302);
		const tarea = exigirTarea(montaje.db, 1);
		assert.equal(tarea.analisisModelo, "sonnet");
		assert.equal(tarea.analisisTerminalId, montaje.terminal);
		// La ejecución no lleva papel: se queda con lo que se eligió a mano.
		assert.equal(tarea.ejecucionAgenteId, null);
		assert.equal(tarea.ejecucionModelo, "opus");

		const ficha = await (await pedir(montaje, `/tareas/${formatearId(tarea.codigo)}`, { cookie })).text();
		assert.match(ficha, /<a href="\/agentes\/1\/editar">revisor<\/a> · sonnet@portatil-ana/);

		// Y el formulario de edición vuelve con el papel ya elegido.
		assert.match(ficha, /<option value="1" data-modelo="sonnet" data-terminal="1" selected>revisor<\/option>/);
	} finally {
		await montaje.cerrar();
	}
});

test("el cliente copia el modelo y el terminal del papel elegido y deshabilita los dos", async () => {
	const montaje = montar();
	try {
		const js = await (await pedir(montaje, "/static/app.js")).text();
		assert.match(js, /select\[data-agente\]/);
		assert.match(js, /opcion\.dataset\.modelo/);
		assert.match(js, /opcion\.dataset\.terminal/);
		assert.match(js, /modelo\.disabled = conPapel/);
		assert.match(js, /terminal\.disabled = conPapel/);
	} finally {
		await montaje.cerrar();
	}
});
