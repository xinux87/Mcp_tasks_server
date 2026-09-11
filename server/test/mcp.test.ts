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
import { BASE_URL_PRUEBA, CONFIG_PRUEBA } from "./comun.ts";

const BASE_URL = BASE_URL_PRUEBA;
const URL_MCP = new URL("/mcp", BASE_URL);

type Montaje = {
	db: DatabaseSync;
	app: Hono;
	token: string;
	nombreTerminal: string;
	cuenta: string;
	cerrar: () => Promise<void>;
};

/** Base en memoria, app montada y un terminal con su token, sin abrir puerto. */
function montar(): Montaje {
	const db = abrirBaseDeDatos(":memory:");
	const { valor: usuario } = crearUsuario(db, "xinux", hashPassword("secreta"));
	const { valor } = crearTerminalConToken(db, usuario.id, "portatil-xinux", "xinux@ejemplo.com");
	const { app, cerrar } = crearApp({ db, config: CONFIG_PRUEBA });
	return {
		db,
		app,
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

test("sin bearer válido, /mcp responde 401", async () => {
	const montaje = montar();
	const llamar = fetchContraApp(montaje.app);
	const cuerpo = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
	try {
		for (const cabeceras of [{}, { Authorization: "Bearer token-inventado" }, { Authorization: "Basic xinux:secreta" }]) {
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

test("registrar_terminal devuelve nombre, cuenta y revisión, y marca el terminal conectado", async () => {
	const montaje = montar();
	const cliente = await conectar(montaje, montaje.token);
	try {
		// Crear usuario y terminal dejaron la revisión en 2. Marcar el terminal
		// como conectado es telemetría y no la mueve.
		const antes = revisionActual(montaje.db);
		assert.equal(antes, 2);

		const resultado = await cliente.callTool({ name: "registrar_terminal", arguments: {} });
		const texto = textoDe(resultado.content);
		assert.match(texto, new RegExp(`^terminal: ${montaje.nombreTerminal}$`, "m"));
		assert.match(texto, new RegExp(`^cuenta: ${montaje.cuenta}$`, "m"));
		// Cuántos subagentes puede lanzar a la vez su bucle. Sin tocarlo, uno.
		assert.match(texto, /^agentes: 1$/m);
		assert.match(texto, /^revision: 2$/m);
		assert.equal(revisionActual(montaje.db), antes);

		const terminal = montaje.db
			.prepare("SELECT conectado_en FROM terminales WHERE nombre = ?")
			.get(montaje.nombreTerminal);
		assert.equal(typeof terminal?.conectado_en, "string");
	} finally {
		await cliente.close();
		await montaje.cerrar();
	}
});

test("novedades guarda la revisión que conoce el terminal y devuelve la actual", async () => {
	const montaje = montar();
	const cliente = await conectar(montaje, montaje.token);
	try {
		const resultado = await cliente.callTool({ name: "novedades", arguments: { revision: 0 } });
		assert.equal(textoDe(resultado.content), "revision: 2");
		assert.equal(revisionActual(montaje.db), 2);

		const terminal = montaje.db.prepare("SELECT ultima_revision FROM terminales WHERE id = 1").get();
		assert.equal(terminal?.ultima_revision, 0);

		// Segunda vuelta del bucle sin escrituras de contenido: misma revisión,
		// y el terminal recuerda el último valor que pasó.
		const segunda = await cliente.callTool({ name: "novedades", arguments: { revision: 2 } });
		assert.equal(textoDe(segunda.content), "revision: 2");
		assert.equal(revisionActual(montaje.db), 2);

		const despues = montaje.db.prepare("SELECT ultima_revision FROM terminales WHERE id = 1").get();
		assert.equal(despues?.ultima_revision, 2);
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
