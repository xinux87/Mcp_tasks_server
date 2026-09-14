import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Hono } from "hono";
import { crearApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { crearUsuario, revisionActual } from "../src/db/consultas.ts";
import { crearTareaHumana } from "../src/db/tareas.ts";
import { BASE_URL_PRUEBA, CONFIG_PRUEBA } from "./comun.ts";

type Montaje = {
	db: DatabaseSync;
	app: Hono;
	usuarioId: number;
	cerrar: () => Promise<void>;
};

function montar(): Montaje {
	const db = abrirBaseDeDatos(":memory:");
	const { valor: usuario } = crearUsuario(db, "ana", hashPassword("secreta"));
	const { app, cerrar } = crearApp({ db, config: CONFIG_PRUEBA });
	return {
		db,
		app,
		usuarioId: usuario.id,
		cerrar: async () => {
			await cerrar();
			db.close();
		},
	};
}

type Opciones = {
	cookie?: string;
	formulario?: Record<string, string>;
	signal?: AbortSignal;
};

async function pedir(montaje: Montaje, ruta: string, opciones: Opciones = {}): Promise<Response> {
	const url = new URL(ruta, BASE_URL_PRUEBA);
	const inicio: RequestInit =
		opciones.formulario === undefined
			? { signal: opciones.signal }
			: {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams(opciones.formulario).toString(),
					signal: opciones.signal,
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
	return (respuesta.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

/** Lee del flujo SSE bloque a bloque: cada evento acaba en una línea en blanco. */
function lectorDeEventos(cuerpo: ReadableStream<Uint8Array>): {
	siguiente: () => Promise<{ evento: string; datos: string }>;
	cerrar: () => Promise<void>;
} {
	const lector = cuerpo.getReader();
	const decodificador = new TextDecoder();
	let buffer = "";
	const siguiente = async (): Promise<{ evento: string; datos: string }> => {
		for (;;) {
			const corte = buffer.indexOf("\n\n");
			if (corte >= 0) {
				const bloque = buffer.slice(0, corte);
				buffer = buffer.slice(corte + 2);
				const lineas = bloque.split("\n");
				const evento = lineas.find((linea) => linea.startsWith("event: "))?.slice(7) ?? "";
				const datos = lineas.find((linea) => linea.startsWith("data: "))?.slice(6) ?? "";
				return { evento, datos };
			}
			const { value, done } = await lector.read();
			if (done) {
				throw new Error("el flujo de eventos se cerró antes de tiempo");
			}
			buffer += decodificador.decode(value, { stream: true });
		}
	};
	return { siguiente, cerrar: async () => await lector.cancel() };
}

test("sin sesión, el flujo de eventos redirige al login", async () => {
	const montaje = montar();
	try {
		const respuesta = await pedir(montaje, "/eventos");
		assert.equal(respuesta.status, 302);
		assert.equal(respuesta.headers.get("location"), "/login?volver=%2Feventos");
	} finally {
		await montaje.cerrar();
	}
});

test("el flujo emite la revisión al conectar y cuando cambia", { timeout: 15_000 }, async (t) => {
	const montaje = montar();
	const control = new AbortController();
	// Aunque falle una comprobación, el flujo se corta y no queda ningún
	// temporizador vivo: la espera del servidor se cancela con la señal.
	t.after(async () => {
		control.abort();
		await montaje.cerrar();
	});

	const cookie = await entrar(montaje);
	const respuesta = await pedir(montaje, "/eventos", { cookie, signal: control.signal });
	assert.equal(respuesta.status, 200);
	assert.equal(respuesta.headers.get("content-type"), "text/event-stream");
	assert.ok(respuesta.body !== null, "el flujo no trae cuerpo");

	const flujo = lectorDeEventos(respuesta.body);
	const inicial = await flujo.siguiente();
	assert.equal(inicial.evento, "revision");
	assert.equal(inicial.datos, String(revisionActual(montaje.db)));

	// Una escritura de contenido sube la revisión: el flujo tiene que contarlo.
	const antes = Date.now();
	crearTareaHumana(montaje.db, {
		titulo: "Exportar clientes a CSV",
		descripcion: "Lo que sea.",
		autoejecucion: true,
		analisisModelo: null,
		analisisTerminalId: null,
		ejecucionModelo: null,
		ejecucionTerminalId: null,
		usuarioId: montaje.usuarioId,
	});
	const nueva = revisionActual(montaje.db);
	assert.equal(nueva, Number.parseInt(inicial.datos, 10) + 1);

	const siguiente = await flujo.siguiente();
	assert.equal(siguiente.evento, "revision");
	assert.equal(siguiente.datos, String(nueva));
	assert.ok(Date.now() - antes < 3000, "la revisión nueva tardó más de tres segundos");

	await flujo.cerrar();
	control.abort();
});
