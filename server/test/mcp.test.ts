import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Hono } from "hono";
import { crearApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { crearTerminalConToken } from "../src/auth/tokens.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { crearUsuario, revisionActual } from "../src/db/consultas.ts";
import { crearProyecto } from "../src/db/proyectos.ts";
import { crearTareaHumana, exigirTarea, moverTareaHumano } from "../src/db/tareas.ts";
import { formatearId } from "../src/md/ids.ts";
import { BASE_URL_PRUEBA, CONFIG_PRUEBA } from "./comun.ts";

const BASE_URL = BASE_URL_PRUEBA;
const URL_MCP = new URL("/mcp", BASE_URL);

type Montaje = {
	db: DatabaseSync;
	app: Hono;
	usuarioId: number;
	token: string;
	nombreTerminal: string;
	cuenta: string;
	cerrar: () => Promise<void>;
};

/** Base en memoria, app montada y un terminal con su token, sin abrir puerto. */
function montar(): Montaje {
	const db = abrirBaseDeDatos(":memory:");
	const { valor: usuario } = crearUsuario(db, "ana", hashPassword("secreta"));
	const { valor } = crearTerminalConToken(db, usuario.id, "portatil-ana", "ana@ejemplo.com");
	const { app, cerrar } = crearApp({ db, config: CONFIG_PRUEBA });
	return {
		db,
		app,
		usuarioId: usuario.id,
		token: valor.token,
		nombreTerminal: valor.terminal.nombre,
		cuenta: valor.terminal.cuenta,
		cerrar: async () => {
			await cerrar();
			db.close();
		},
	};
}

/**
 * `fetch` que habla con la app en memoria. Añade la cabecera `Host`, que un
 * cliente HTTP real pone y `new Request(...)` no, y que la protección contra
 * DNS rebinding del SDK exige.
 */
function fetchContraApp(app: Hono): (url: string | URL, init?: RequestInit) => Promise<Response> {
	return async (url, init) => {
		const destino = new URL(url);
		const peticion = new Request(destino, init);
		peticion.headers.set("host", destino.host);
		return await app.fetch(peticion);
	};
}

function textoDe(contenido: unknown): string {
	assert.ok(Array.isArray(contenido), "el resultado tiene que traer un array `content`");
	const primero: unknown = contenido[0];
	assert.ok(typeof primero === "object" && primero !== null, "el primer bloque tiene que ser un objeto");
	const bloque = primero as { type?: unknown; text?: unknown };
	assert.equal(bloque.type, "text");
	assert.equal(typeof bloque.text, "string");
	return String(bloque.text);
}

async function conectar(montaje: Montaje, token: string): Promise<Client> {
	const cliente = new Client({ name: "test-tareas", version: "0.0.0" });
	const transporte = new StreamableHTTPClientTransport(URL_MCP, {
		fetch: fetchContraApp(montaje.app),
		requestInit: { headers: { Authorization: `Bearer ${token}` } },
	});
	await cliente.connect(transporte);
	return cliente;
}

/** El identificador visible de la tarea que ocupa esa fila. */
function idFila(montaje: Montaje, fila: number): string {
	return formatearId(exigirTarea(montaje.db, fila).codigo);
}

test("GET /salud responde 200 y { ok: true }", async () => {
	const montaje = montar();
	try {
		const respuesta = await fetchContraApp(montaje.app)(new URL("/salud", BASE_URL));
		assert.equal(respuesta.status, 200);
		assert.deepEqual(await respuesta.json(), { ok: true });
	} finally {
		await montaje.cerrar();
	}
});

test("GET /skill.md sirve la skill del bucle sin sesión ni token", async () => {
	const montaje = montar();
	try {
		const respuesta = await fetchContraApp(montaje.app)(new URL("/skill.md", BASE_URL));
		assert.equal(respuesta.status, 200);
		assert.equal(respuesta.headers.get("content-type"), "text/markdown; charset=utf-8");
		const cuerpo = await respuesta.text();
		assert.match(cuerpo, /^name: tareas$/m);
		assert.match(cuerpo, /\/loop 2m \/tareas/);
		// La skill se baja con curl y funciona sola: nada que venga del plugin.
		assert.doesNotMatch(cuerpo, /CLAUDE_PLUGIN|revision\.sh/);
	} finally {
		await montaje.cerrar();
	}
});

test("sin bearer válido, /mcp responde 401", async () => {
	const montaje = montar();
	const llamar = fetchContraApp(montaje.app);
	const cuerpo = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
	try {
		for (const cabeceras of [{}, { Authorization: "Bearer token-inventado" }, { Authorization: "Basic ana:secreta" }]) {
			const respuesta = await llamar(URL_MCP, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json", ...cabeceras },
				body: cuerpo,
			});
			assert.equal(respuesta.status, 401);
			assert.deepEqual(await respuesta.json(), { error: "no autorizado" });
		}
	} finally {
		await montaje.cerrar();
	}
});

test("con el bearer correcto el cliente MCP lista exactamente las nueve herramientas", async () => {
	const montaje = montar();
	const cliente = await conectar(montaje, montaje.token);
	try {
		const { tools } = await cliente.listTools();
		const nombres = tools.map((herramienta) => herramienta.name).sort();
		assert.deepEqual(nombres, [
			"comentar_tarea",
			"crear_tarea",
			"leer_tarea",
			"listar_tareas",
			"novedades",
			"preguntar",
			"registrar_terminal",
			"reportar_consumo",
			"tomar_tarea",
		]);
	} finally {
		await cliente.close();
		await montaje.cerrar();
	}
});

test("registrar_terminal devuelve nombre, cuenta, proyecto y revisión, y marca el terminal conectado", async () => {
	const montaje = montar();
	const cliente = await conectar(montaje, montaje.token);
	try {
		// Crear usuario y terminal dejaron la revisión en 2. Marcar el terminal
		// como conectado es telemetría y no la mueve.
		const antes = revisionActual(montaje.db);
		assert.equal(antes, 2);

		const resultado = await cliente.callTool({
			name: "registrar_terminal",
			arguments: { ruta: "/home/ana/proyectos/tareas" },
		});
		// Sin repositorio en el proyecto principal no se comprueba nada, y sin
		// comando de verificación esa línea no se pinta.
		assert.equal(
			textoDe(resultado.content),
			[
				`terminal: ${montaje.nombreTerminal}`,
				`cuenta: ${montaje.cuenta}`,
				// Cuántos subagentes puede lanzar a la vez su bucle. Sin tocarlo, uno.
				"agentes: 1",
				"proyecto: DEFAULT · Default",
				"rama principal: main",
				"revision: 2",
			].join("\n"),
		);
		assert.equal(revisionActual(montaje.db), antes);

		const terminal = montaje.db
			.prepare("SELECT conectado_en, ruta FROM terminales WHERE nombre = ?")
			.get(montaje.nombreTerminal);
		assert.equal(typeof terminal?.conectado_en, "string");
		assert.equal(terminal?.ruta, "/home/ana/proyectos/tareas");
	} finally {
		await cliente.close();
		await montaje.cerrar();
	}
});

test("registrar_terminal comprueba el repositorio del proyecto y para la sesión si no es el suyo", async () => {
	const montaje = montar();
	const web = crearProyecto(montaje.db, {
		clave: "WEB",
		nombre: "La web",
		repositorio: "https://github.com/ejemplo/web.git",
		verificacion: "npm test",
	});
	const { valor } = crearTerminalConToken(
		montaje.db,
		montaje.usuarioId,
		"portatil-web",
		"ana@ejemplo.com",
		undefined,
		undefined,
		web.id,
	);
	const cliente = await conectar(montaje, valor.token);
	const conectadoEn = (): unknown =>
		montaje.db.prepare("SELECT conectado_en FROM terminales WHERE id = ?").get(valor.terminal.id)?.conectado_en;
	try {
		// Otro repositorio: error de regla y el terminal no queda conectado.
		const otro = await cliente.callTool({
			name: "registrar_terminal",
			arguments: { ruta: "/home/ana/proyectos/otra", repositorio: "https://github.com/ejemplo/otra.git" },
		});
		assert.equal(otro.isError, true);
		assert.match(textoDe(otro.content), /^proyecto_no_coincide: /);
		assert.equal(conectadoEn(), null);

		// El mismo, con y sin el sufijo `.git`: las dos formas son el mismo remote.
		for (const repositorio of ["https://github.com/ejemplo/web.git", "https://github.com/ejemplo/web"]) {
			const bien = await cliente.callTool({ name: "registrar_terminal", arguments: { repositorio } });
			assert.notEqual(bien.isError, true);
			assert.match(textoDe(bien.content), /^proyecto: WEB · La web$/m);
			assert.match(textoDe(bien.content), /^rama principal: main\nverificacion: npm test$/m);
		}
		assert.equal(typeof conectadoEn(), "string");
	} finally {
		await cliente.close();
		await montaje.cerrar();
	}
});

/** La revisión que el servidor recuerda de este terminal. */
function ultimaRevision(montaje: Montaje): unknown {
	return montaje.db.prepare("SELECT ultima_revision FROM terminales WHERE id = 1").get()?.ultima_revision;
}

/** Una tarea lista para que el bucle la vea: en `prepared` y sin terminal. */
function crearPreparada(montaje: Montaje, titulo: string): void {
	const tarea = crearTareaHumana(montaje.db, { titulo, descripcion: "Lo que sea.", usuarioId: montaje.usuarioId });
	moverTareaHumano(montaje.db, { tareaId: tarea.id, usuarioId: montaje.usuarioId, estado: "prepared" });
}

test("novedades sin revisión sigue por donde iba el terminal", async () => {
	const montaje = montar();
	const cliente = await conectar(montaje, montaje.token);
	try {
		// Primera vuelta de un terminal que nunca ha llamado: parte de 0, no hay
		// nada todavía, y queda apuntada la revisión que acaba de devolver.
		const primera = textoDe((await cliente.callTool({ name: "novedades", arguments: {} })).content);
		assert.equal(primera, "revision: 2");
		assert.equal(ultimaRevision(montaje), 2);

		// Una tarea nueva entre vuelta y vuelta: la siguiente trae esa y solo esa.
		crearPreparada(montaje, "Exportar el listado de clientes a CSV");
		const segunda = textoDe((await cliente.callTool({ name: "novedades", arguments: {} })).content);
		const alDia = revisionActual(montaje.db);
		assert.match(
			segunda,
			new RegExp(`^- ${idFila(montaje, 1)} · prepared · sin terminal · Exportar el listado de clientes a CSV · `, "m"),
		);
		assert.equal(segunda.split("\n").filter((linea) => linea.startsWith("- ")).length, 1);
		assert.equal(ultimaRevision(montaje), alDia);

		// Y la de después, sin escrituras de contenido, solo la revisión: ni se
		// repite lo anterior ni sube el contador.
		const tercera = textoDe((await cliente.callTool({ name: "novedades", arguments: {} })).content);
		assert.equal(tercera, `revision: ${alDia}`);
		assert.equal(revisionActual(montaje.db), alDia);

		// Pasar `revision` manda sobre lo apuntado: con 0 vuelve todo.
		const desdeCero = textoDe((await cliente.callTool({ name: "novedades", arguments: { revision: 0 } })).content);
		assert.match(desdeCero, new RegExp(`^- ${idFila(montaje, 1)} · prepared · `, "m"));
		assert.equal(ultimaRevision(montaje), alDia);

		// Una sesión nueva del mismo terminal no pasa nada y no repite nada.
		const otraSesion = await conectar(montaje, montaje.token);
		try {
			const vuelta = textoDe((await otraSesion.callTool({ name: "novedades", arguments: {} })).content);
			assert.equal(vuelta, `revision: ${alDia}`);
		} finally {
			await otraSesion.close();
		}
	} finally {
		await cliente.close();
		await montaje.cerrar();
	}
});

test("la telemetría de los terminales nunca mueve la revisión global", async () => {
	const montaje = montar();
	const cliente = await conectar(montaje, montaje.token);
	try {
		const antes = revisionActual(montaje.db);
		await cliente.callTool({ name: "registrar_terminal", arguments: {} });
		await cliente.callTool({ name: "novedades", arguments: { revision: antes } });
		await cliente.callTool({ name: "registrar_terminal", arguments: {} });
		await cliente.callTool({ name: "novedades", arguments: { revision: antes } });
		assert.equal(revisionActual(montaje.db), antes);
	} finally {
		await cliente.close();
		await montaje.cerrar();
	}
});
