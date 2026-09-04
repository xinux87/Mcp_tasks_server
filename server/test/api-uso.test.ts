import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Hono } from "hono";
import { crearApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { crearTerminalConToken } from "../src/auth/tokens.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { buscarTerminalPorId, crearUsuario, revisionActual } from "../src/db/consultas.ts";

const BASE_URL = "http://localhost:3000";
const URL_USO = new URL("/api/uso", BASE_URL);

/** El JSON que Claude Code pasa a la statusline, recortado a lo que importa. */
const USO = {
	rate_limits: {
		five_hour: { used_percentage: 42, resets_at: "2026-09-04T13:00:00Z" },
	},
	cost: { total_cost_usd: 1.23 },
};

type Montaje = {
	db: DatabaseSync;
	app: Hono;
	terminalId: number;
	token: string;
	cerrar: () => Promise<void>;
};

function montar(): Montaje {
	const db = abrirBaseDeDatos(":memory:");
	const { valor: usuario } = crearUsuario(db, "xinux", hashPassword("secreta"));
	const { valor } = crearTerminalConToken(db, usuario.id, "portatil-xinux", "xinux@ejemplo.com");
	const { app, cerrar } = crearApp({ db, baseUrl: BASE_URL });
	return {
		db,
		app,
		terminalId: valor.terminal.id,
		token: valor.token,
		cerrar: async () => {
			await cerrar();
			db.close();
		},
	};
}

/** `fetch` contra la app en memoria, con la cabecera `Host` que exige el SDK. */
function fetchContraApp(app: Hono): (url: string | URL, init?: RequestInit) => Promise<Response> {
	return async (url, init) => {
		const destino = new URL(url);
		const peticion = new Request(destino, init);
		peticion.headers.set("host", destino.host);
		return await app.fetch(peticion);
	};
}

test("POST /api/uso guarda el JSON de la statusline sin mover la revisión", async () => {
	const montaje = montar();
	try {
		const antes = revisionActual(montaje.db);
		const respuesta = await fetchContraApp(montaje.app)(URL_USO, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${montaje.token}` },
			body: JSON.stringify(USO),
		});
		assert.equal(respuesta.status, 204);
		assert.equal(await respuesta.text(), "");

		// Se guarda tal cual: el servidor no interpreta el JSON, solo lo enseña.
		const terminal = buscarTerminalPorId(montaje.db, montaje.terminalId);
		assert.equal(terminal?.usoJson, JSON.stringify(USO));
		// Es telemetría: si subiera la revisión, cada minuto de cada terminal
		// sería una novedad para todos los demás.
		assert.equal(revisionActual(montaje.db), antes);
	} finally {
		await montaje.cerrar();
	}
});

test("POST /api/uso sin bearer válido responde 401 y no guarda nada", async () => {
	const montaje = montar();
	const llamar = fetchContraApp(montaje.app);
	try {
		for (const cabeceras of [{}, { Authorization: "Bearer token-inventado" }]) {
			const respuesta = await llamar(URL_USO, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...cabeceras },
				body: JSON.stringify(USO),
			});
			assert.equal(respuesta.status, 401);
			assert.deepEqual(await respuesta.json(), { error: "no autorizado" });
		}
		assert.equal(buscarTerminalPorId(montaje.db, montaje.terminalId)?.usoJson, null);
	} finally {
		await montaje.cerrar();
	}
});

test("POST /api/uso con un cuerpo que no es un objeto JSON responde 400", async () => {
	const montaje = montar();
	const llamar = fetchContraApp(montaje.app);
	try {
		for (const cuerpo of ["no soy json", "[1, 2, 3]", "42", '"texto"', ""]) {
			const respuesta = await llamar(URL_USO, {
				method: "POST",
				// A propósito sin `application/json`: con ese tipo, el middleware
				// que instala `createMcpHonoApp` parsea el cuerpo antes que
				// nosotros y rechaza lo que no sea JSON con su propio 400.
				headers: { "Content-Type": "text/plain", Authorization: `Bearer ${montaje.token}` },
				body: cuerpo,
			});
			assert.equal(respuesta.status, 400, `se esperaba 400 para «${cuerpo}»`);
			assert.deepEqual(await respuesta.json(), { error: "cuerpo inválido" });
		}
		assert.equal(buscarTerminalPorId(montaje.db, montaje.terminalId)?.usoJson, null);
	} finally {
		await montaje.cerrar();
	}
});

test("POST /api/uso con un cuerpo de más de 64 KB responde 413", async () => {
	const montaje = montar();
	try {
		const gordo = JSON.stringify({ relleno: "x".repeat(64 * 1024) });
		const respuesta = await fetchContraApp(montaje.app)(URL_USO, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${montaje.token}` },
			body: gordo,
		});
		assert.equal(respuesta.status, 413);
		assert.equal(buscarTerminalPorId(montaje.db, montaje.terminalId)?.usoJson, null);
	} finally {
		await montaje.cerrar();
	}
});
