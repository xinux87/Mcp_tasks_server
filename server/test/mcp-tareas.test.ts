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
import { preguntasDeTarea, responder } from "../src/db/hilo.ts";
import { crearTareaHumana, moverTareaHumano } from "../src/db/tareas.ts";
import { CONFIG_PRUEBA } from "./comun.ts";

const BASE_URL = "http://localhost:3000";
const URL_MCP = new URL("/mcp", BASE_URL);

type Montaje = {
	db: DatabaseSync;
	app: Hono;
	usuarioId: number;
	/** Token del terminal que tiene asignadas las dos fases de la tarea. */
	tokenA: string;
	/** Token de un segundo terminal, para probar que no roba fases ajenas. */
	tokenB: string;
	cerrar: () => Promise<void>;
};

/**
 * Base en memoria con un humano, dos terminales y la tarea T-0001 ya en
 * `prepared` con las dos fases asignadas al terminal A. A partir de aquí todo
 * se hace por MCP, que es lo que este archivo prueba.
 */
function montar(): Montaje {
	const db = abrirBaseDeDatos(":memory:");
	const { valor: usuario } = crearUsuario(db, "xinux", hashPassword("secreta"));
	const { valor: a } = crearTerminalConToken(db, usuario.id, "portatil-a", "xinux@ejemplo.com");
	const { valor: b } = crearTerminalConToken(db, usuario.id, "sobremesa-b", "xinux@ejemplo.com");
	const tarea = crearTareaHumana(db, {
		titulo: "Exportar el listado de clientes a CSV",
		descripcion: "Hoy lo copian a mano.",
		usuarioId: usuario.id,
		analisisModelo: "sonnet",
		analisisTerminalId: a.terminal.id,
		ejecucionModelo: "opus",
		ejecucionTerminalId: a.terminal.id,
	});
	moverTareaHumano(db, { tareaId: tarea.id, usuarioId: usuario.id, estado: "prepared" });

	const { app, cerrar } = crearApp({ db, config: CONFIG_PRUEBA });
	return {
		db,
		app,
		usuarioId: usuario.id,
		tokenA: a.token,
		tokenB: b.token,
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

async function conectar(montaje: Montaje, token: string): Promise<Client> {
	const cliente = new Client({ name: "test-tareas", version: "0.0.0" });
	const transporte = new StreamableHTTPClientTransport(URL_MCP, {
		fetch: fetchContraApp(montaje.app),
		requestInit: { headers: { Authorization: `Bearer ${token}` } },
	});
	await cliente.connect(transporte);
	return cliente;
}

type Resultado = { texto: string; error: boolean };

/** Llama a una herramienta y devuelve su texto Markdown y si vino como error. */
async function llamar(cliente: Client, nombre: string, argumentos: Record<string, unknown> = {}): Promise<Resultado> {
	const resultado = await cliente.callTool({ name: nombre, arguments: argumentos });
	const contenido = resultado.content;
	assert.ok(Array.isArray(contenido), "el resultado tiene que traer un array `content`");
	const primero: unknown = contenido[0];
	assert.ok(typeof primero === "object" && primero !== null, "el primer bloque tiene que ser un objeto");
	const bloque = primero as { type?: unknown; text?: unknown };
	assert.equal(bloque.type, "text", "ninguna herramienta devuelve JSON: todo es texto Markdown");
	assert.equal(typeof bloque.text, "string");
	return { texto: String(bloque.text), error: resultado.isError === true };
}

/** El código de un error de regla, tal como se le enseña al agente. */
function codigoDe(resultado: Resultado): string {
	assert.ok(resultado.error, `se esperaba un error de regla y llegó: ${resultado.texto}`);
	const codigo = resultado.texto.split(":")[0];
	assert.ok(codigo !== undefined && codigo !== "");
	return codigo;
}

const OPCIONES = [
	{ texto: "Coma", consecuencia: "es el estándar, pero hay que importar a mano." },
	{ texto: "Punto y coma", consecuencia: "se abre directo en la hoja de cálculo." },
	{ texto: "No hacer nada", consecuencia: "siguen copiando a mano." },
];

test("una tarea entera de principio a fin solo con las herramientas del MCP", async () => {
	const montaje = montar();
	const a = await conectar(montaje, montaje.tokenA);
	const b = await conectar(montaje, montaje.tokenB);
	try {
		// 1. La tarea llega por novedades con su terminal puesto, así que no
		// lleva la marca «sin terminal», y todavía no hay nada contestado.
		const primeras = await llamar(a, "novedades", { revision: 0 });
		assert.match(primeras.texto, /^## Tareas nuevas o cambiadas$/m);
		assert.match(
			primeras.texto,
			/^- T-0001 · prepared · Exportar el listado de clientes a CSV · analisis: sonnet@portatil-a · ejecucion: opus@portatil-a$/m,
		);
		assert.doesNotMatch(primeras.texto, /sin terminal/);
		assert.doesNotMatch(primeras.texto, /Preguntas contestadas/);

		// 2. El análisis es del terminal A: B no lo roba.
		assert.equal(codigoDe(await llamar(b, "tomar_tarea", { id: "T-0001", fase: "analisis" })), "fase_tomada");

		// 3. A toma el análisis y lo escribe. Lo cambiado sale por novedades desde
		// la revisión anterior, y desde la nueva ya no hay nada.
		const antes = revisionActual(montaje.db);
		const tomada = await llamar(a, "tomar_tarea", { id: "T-0001", fase: "analisis" });
		assert.match(tomada.texto, /^tomada: analisis$/m);
		assert.match(tomada.texto, /^- T-0001 · prepared · en marcha · /m);

		const comentada = await llamar(a, "comentar_tarea", {
			id: "T-0001",
			tipo: "analisis",
			texto: "Hay que añadir un botón que descargue lo que se ve en pantalla.",
		});
		assert.match(comentada.texto, /^comentado: analisis$/m);

		assert.match((await llamar(a, "novedades", { revision: antes })).texto, /^- T-0001 · prepared · /m);
		const alDia = revisionActual(montaje.db);
		assert.equal((await llamar(a, "novedades", { revision: alDia })).texto, `revision: ${alDia}`);

		// 4. Una pregunta abierta bloquea la tarea y corta la ejecución.
		const preguntada = await llamar(a, "preguntar", {
			id: "T-0001",
			pregunta: "¿Qué separador usamos en el CSV?",
			porQueImporta: "la hoja de cálculo de los comerciales abre mal la coma.",
			opciones: OPCIONES,
			recomendacion: "Punto y coma",
		});
		assert.match(preguntada.texto, /^pregunta: P1$/m);
		assert.match(preguntada.texto, /^- T-0001 · prepared · bloqueada · /m);
		assert.equal(codigoDe(await llamar(a, "tomar_tarea", { id: "T-0001", fase: "ejecucion" })), "tarea_bloqueada");

		// 5. El humano contesta desde la web, que es la base de datos directamente.
		const corte = revisionActual(montaje.db);
		const p1 = preguntasDeTarea(montaje.db, 1)[0];
		assert.ok(p1);
		responder(montaje.db, { preguntaId: p1.id, usuarioId: montaje.usuarioId, opcion: "Punto y coma" });

		const contestadas = await llamar(a, "novedades", { revision: corte });
		assert.match(contestadas.texto, /^## Preguntas contestadas$/m);
		assert.match(contestadas.texto, /^- T-0001 · P1 · Punto y coma$/m);

		// 6. Ejecución: se toma, se cuelga una hija, se avanza y se cierra.
		const enEjecucion = await llamar(a, "tomar_tarea", { id: "T-0001", fase: "ejecucion" });
		assert.match(enEjecucion.texto, /^- T-0001 · doing · en marcha · /m);

		const hija = await llamar(a, "crear_tarea", {
			titulo: "Generar el fichero CSV",
			descripcion: "El fichero en sí.",
			clase: "hija",
			padre: "T-0001",
		});
		assert.match(hija.texto, /^creada: T-0002$/m);
		assert.match(hija.texto, /^- T-0002 · doing · en marcha · Generar el fichero CSV · /m);

		assert.match(
			(await llamar(a, "comentar_tarea", { id: "T-0001", tipo: "avance", texto: "Botón puesto." })).texto,
			/^comentado: avance$/m,
		);

		const cerrada = await llamar(a, "comentar_tarea", {
			id: "T-0001",
			tipo: "resultado",
			texto: "Qué se construyó: el botón.\n\nCommit: a1b2c3d",
			estado: "done",
		});
		assert.match(cerrada.texto, /^comentado: resultado$/m);
		assert.match(cerrada.texto, /^- T-0001 · done · /m);

		// Un estado con cualquier otro tipo de comentario no está permitido.
		assert.equal(
			codigoDe(await llamar(a, "comentar_tarea", { id: "T-0001", tipo: "avance", texto: "x", estado: "done" })),
			"estado_no_permitido",
		);

		// 7. El consumo se reporta por fase y sale en el documento de la tarea.
		const consumoAnalisis = await llamar(a, "reportar_consumo", {
			id: "T-0001",
			fase: "analisis",
			modelo: "sonnet",
			tokens: 31500,
			herramientas: 6,
			duracionMs: 87000,
		});
		assert.match(consumoAnalisis.texto, /^consumo:$/m);
		assert.match(consumoAnalisis.texto, /^ {4}tokens: 31500$/m);

		const consumoEjecucion = await llamar(a, "reportar_consumo", {
			id: "T-0001",
			fase: "ejecucion",
			modelo: "opus",
			tokens: 184600,
			herramientas: 41,
			duracionMs: 1520000,
		});
		assert.match(consumoEjecucion.texto, /^ {2}totalConHijas:\n {4}tokens: 216100$/m);

		const documento = await llamar(a, "leer_tarea", { id: "T-0001" });
		assert.match(documento.texto, /^consumo:\n {2}analisis:\n {4}modelo: sonnet\n {4}tokens: 31500$/m);
		assert.match(documento.texto, /^ {2}ejecucion:\n {4}modelo: opus\n {4}tokens: 184600$/m);
		assert.match(documento.texto, /^## Hijas\n\n- T-0002 · doing · Generar el fichero CSV$/m);

		// 8. El índice lista las dos tareas, y filtrado por una columna vacía dice
		// que no hay ninguna.
		const indice = await llamar(a, "listar_tareas", {});
		assert.deepEqual(
			indice.texto.split("\n").map((linea) => linea.slice(2, 8)),
			["T-0002", "T-0001"],
		);
		assert.equal((await llamar(a, "listar_tareas", { estado: "backlog" })).texto, "Ninguna.");

		// 9. Un identificador mal escrito es un error de regla, no un fallo.
		assert.equal(codigoDe(await llamar(a, "leer_tarea", { id: "T-42" })), "id_invalido");

		// 10. Una tarea con la ejecución sin asignar: el modelo con el que el
		// bucle la toma queda fijado en la fase y es el que firma el resultado.
		const suelta = crearTareaHumana(montaje.db, {
			titulo: "Avisar cuando falle el export",
			descripcion: "Hoy no se entera nadie.",
			usuarioId: montaje.usuarioId,
			analisisModelo: "sonnet",
		});
		moverTareaHumano(montaje.db, { tareaId: suelta.id, usuarioId: montaje.usuarioId, estado: "prepared" });

		const analisisSuelto = await llamar(a, "tomar_tarea", { id: "T-0003", fase: "analisis", modelo: "sonnet" });
		assert.match(
			analisisSuelto.texto,
			/^- T-0003 · prepared · en marcha · .+ · analisis: sonnet@portatil-a · ejecucion: sin asignar$/m,
		);
		await llamar(a, "comentar_tarea", { id: "T-0003", tipo: "analisis", texto: "Un aviso por correo al fallar." });

		const ejecucionSuelta = await llamar(a, "tomar_tarea", { id: "T-0003", fase: "ejecucion", modelo: "opus" });
		assert.match(ejecucionSuelta.texto, /^- T-0003 · doing · en marcha · .+ · ejecucion: opus@portatil-a$/m);

		// Ya fijado, tomarla con otro modelo no cuela.
		assert.equal(
			codigoDe(await llamar(a, "tomar_tarea", { id: "T-0003", fase: "ejecucion", modelo: "haiku" })),
			"modelo_no_coincide",
		);

		const cerradaSuelta = await llamar(a, "comentar_tarea", {
			id: "T-0003",
			tipo: "resultado",
			texto: "Qué se construyó: el aviso.\n\nCommit: d4e5f6a",
			estado: "done",
		});
		assert.match(cerradaSuelta.texto, /^- T-0003 · done · /m);
		assert.match((await llamar(a, "leer_tarea", { id: "T-0003" })).texto, /^### resultado · opus@portatil-a · /m);
	} finally {
		await a.close();
		await b.close();
		await montaje.cerrar();
	}
});
