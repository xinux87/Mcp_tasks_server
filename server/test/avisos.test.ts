import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Hono } from "hono";
import { crearApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { crearTerminalConToken } from "../src/auth/tokens.ts";
import { crearAvisador, type Enviar, type Evento } from "../src/avisos.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { crearUsuario } from "../src/db/consultas.ts";
import { aprobarEjecucion, crearTareaHumana, moverTareaHumano, type Tarea } from "../src/db/tareas.ts";
import { formatearId, parsearId } from "../src/md/ids.ts";
import { BASE_URL_PRUEBA, CONFIG_PRUEBA } from "./comun.ts";

const URL_AVISOS = "http://avisos.local/mcp-tareas";
const URL_MCP = new URL("/mcp", BASE_URL_PRUEBA);

/** Deja correr las microtareas: el aviso sale sin esperarlo, en su propia promesa. */
function vaciar(): Promise<void> {
	return new Promise((listo) => setImmediate(listo));
}

// --- el texto del aviso ------------------------------------------------------

const EVENTOS: [Evento, string][] = [
	[
		{ tipo: "pregunta", tareaId: 42, titulo: "Exportar el listado", pregunta: "¿Qué separador usamos en el CSV?" },
		"T-0042 pregunta: «¿Qué separador usamos en el CSV?»",
	],
	[
		{ tipo: "hecha", tareaId: 42, titulo: "Exportar el listado de clientes a CSV" },
		"T-0042 hecha: «Exportar el listado de clientes a CSV»",
	],
	[
		{ tipo: "analisis_listo", tareaId: 42, titulo: "Exportar el listado de clientes a CSV" },
		"T-0042 análisis listo: «Exportar el listado de clientes a CSV»",
	],
	[
		{ tipo: "descomposicion_lista", tareaId: 50, titulo: "Que los comerciales se bajen sus listados" },
		"T-0050 descomposición lista: «Que los comerciales se bajen sus listados»",
	],
];

test("cada aviso son dos líneas: la frase y el enlace a la ficha", async () => {
	const enviados: { url: string; texto: string }[] = [];
	const enviar: Enviar = async (url, texto) => {
		enviados.push({ url, texto });
	};
	// Con barra final en la base, para comprobar que no se duplica en el enlace.
	const avisar = crearAvisador({ url: URL_AVISOS, baseUrl: `${BASE_URL_PRUEBA}/`, enviar });

	for (const [evento] of EVENTOS) {
		avisar(evento);
	}
	await vaciar();

	assert.deepEqual(
		enviados,
		EVENTOS.map(([evento, primeraLinea]) => ({
			url: URL_AVISOS,
			texto: `${primeraLinea}\n${BASE_URL_PRUEBA}/tareas/${formatearId(evento.tareaId)}`,
		})),
	);
});

test("un envío que falla no lanza: deja una línea en stderr y sigue", async () => {
	const original = console.error;
	const lineas: string[] = [];
	console.error = (...trozos: unknown[]) => {
		lineas.push(trozos.map(String).join(" "));
	};
	try {
		const rota = crearAvisador({
			url: URL_AVISOS,
			baseUrl: BASE_URL_PRUEBA,
			enviar: async () => {
				throw new Error("conexión rechazada");
			},
		});
		const sincrona = crearAvisador({
			url: URL_AVISOS,
			baseUrl: BASE_URL_PRUEBA,
			// Un `enviar` que revienta antes de devolver la promesa tampoco escapa.
			enviar: () => {
				throw new Error("url mal formada");
			},
		});
		// Si se propagara, estas dos líneas tumbarían el test.
		rota({ tipo: "hecha", tareaId: 1, titulo: "Una tarea" });
		sincrona({ tipo: "hecha", tareaId: 1, titulo: "Una tarea" });
		await vaciar();
	} finally {
		console.error = original;
	}

	// Ordenadas: cada fallo se recoge en su propia promesa y no en el orden en
	// que se pidieron.
	assert.deepEqual(lineas.toSorted(), [
		`aviso no enviado a ${URL_AVISOS}: conexión rechazada`,
		`aviso no enviado a ${URL_AVISOS}: url mal formada`,
	]);
});

test("sin AVISOS_URL no se envía nada y no se avisa de ello", async () => {
	let llamadas = 0;
	const avisar = crearAvisador({
		baseUrl: BASE_URL_PRUEBA,
		enviar: async () => {
			llamadas += 1;
		},
	});
	for (const [evento] of EVENTOS) {
		avisar(evento);
	}
	await vaciar();
	assert.equal(llamadas, 0);
});

// --- de punta a punta, con la app y las herramientas del MCP ------------------

type Montaje = {
	db: DatabaseSync;
	app: Hono;
	cliente: Client;
	usuarioId: number;
	terminalId: number;
	/** Los textos de los avisos enviados, en orden. */
	avisos: string[];
	/** Vacía la lista y devuelve lo que había, ya con las microtareas corridas. */
	recoger: () => Promise<string[]>;
	cerrar: () => Promise<void>;
};

/** `fetch` contra la app en memoria, con la cabecera `Host` que exige el SDK. */
function fetchContraApp(app: Hono): (url: string | URL, init?: RequestInit) => Promise<Response> {
	return async (url, init) => {
		const destino = new URL(url);
		const peticion = new Request(destino, init);
		peticion.headers.set("host", destino.host);
		return await app.fetch(peticion);
	};
}

/** Base en memoria, un terminal conectado por MCP y los avisos apuntados. */
async function montar(): Promise<Montaje> {
	const db = abrirBaseDeDatos(":memory:");
	const { valor: usuario } = crearUsuario(db, "ana", hashPassword("secreta"));
	const { valor } = crearTerminalConToken(db, usuario.id, "portatil-ana", "ana@ejemplo.com");
	const avisos: string[] = [];
	const { app, cerrar } = crearApp({
		db,
		config: { ...CONFIG_PRUEBA, AVISOS_URL: URL_AVISOS },
		enviarAviso: async (url, texto) => {
			assert.equal(url, URL_AVISOS);
			avisos.push(texto);
		},
	});
	const cliente = new Client({ name: "test-avisos", version: "0.0.0" });
	await cliente.connect(
		new StreamableHTTPClientTransport(URL_MCP, {
			fetch: fetchContraApp(app),
			requestInit: { headers: { Authorization: `Bearer ${valor.token}` } },
		}),
	);
	return {
		db,
		app,
		cliente,
		usuarioId: usuario.id,
		terminalId: valor.terminal.id,
		avisos,
		recoger: async () => {
			await vaciar();
			return avisos.splice(0, avisos.length);
		},
		cerrar: async () => {
			await cliente.close();
			await cerrar();
			db.close();
		},
	};
}

/** Llama a una herramienta y devuelve su texto, fallando si vino como error. */
async function llamar(montaje: Montaje, nombre: string, argumentos: Record<string, unknown>): Promise<string> {
	const resultado = await montaje.cliente.callTool({ name: nombre, arguments: argumentos });
	const contenido = resultado.content;
	assert.ok(Array.isArray(contenido));
	const bloque = contenido[0] as { text?: unknown };
	const texto = String(bloque.text);
	assert.notEqual(resultado.isError, true, texto);
	return texto;
}

/** Una tarea del humano ya en `prepared`, con las dos fases en este terminal. */
function tareaEnPrepared(montaje: Montaje, titulo: string, autoejecucion = true, tipo?: "funcionalidad"): Tarea {
	const terminalId = montaje.terminalId;
	const creada = crearTareaHumana(montaje.db, {
		titulo,
		descripcion: "Da igual qué diga: lo que se prueba es el aviso.",
		usuarioId: montaje.usuarioId,
		tipo,
		rama: null,
		autoejecucion,
		analisisModelo: "sonnet",
		analisisTerminalId: terminalId,
		ejecucionModelo: "opus",
		ejecucionTerminalId: terminalId,
	});
	return moverTareaHumano(montaje.db, { tareaId: creada.id, usuarioId: montaje.usuarioId, estado: "prepared" });
}

/** El enlace a la ficha, que es la segunda línea de cualquier aviso. */
function ficha(tareaId: number): string {
	return `${BASE_URL_PRUEBA}/tareas/${formatearId(tareaId)}`;
}

test("preguntar avisa con la pregunta y el enlace de la ficha", async () => {
	const montaje = await montar();
	try {
		const tarea = tareaEnPrepared(montaje, "Exportar el listado de clientes a CSV");
		const id = formatearId(tarea.id);
		await llamar(montaje, "tomar_tarea", { id, fase: "analisis" });
		assert.deepEqual(await montaje.recoger(), []);

		await llamar(montaje, "preguntar", {
			id,
			pregunta: "¿Qué separador usamos en el CSV?",
			porQueImporta: "La hoja de cálculo de los comerciales está en español.",
			opciones: [
				{ texto: "Coma", consecuencia: "hay que importar a mano." },
				{ texto: "Punto y coma", consecuencia: "se abre directo." },
				{ texto: "No hacer nada", consecuencia: "siguen copiando a mano." },
			],
			recomendacion: "Punto y coma",
		});

		assert.deepEqual(await montaje.recoger(), [`${id} pregunta: «¿Qué separador usamos en el CSV?»\n${ficha(tarea.id)}`]);
	} finally {
		await montaje.cerrar();
	}
});

test("un resultado avisa de la tarea hecha; un avance no avisa de nada", async () => {
	const montaje = await montar();
	try {
		const tarea = tareaEnPrepared(montaje, "Exportar el listado de clientes a CSV");
		const id = formatearId(tarea.id);
		await llamar(montaje, "tomar_tarea", { id, fase: "analisis" });
		// Con autoejecución, el análisis no espera a nadie: no hay aviso.
		await llamar(montaje, "comentar_tarea", { id, tipo: "analisis", texto: "Plan: un botón y un fichero." });
		await llamar(montaje, "tomar_tarea", { id, fase: "ejecucion" });
		await llamar(montaje, "comentar_tarea", { id, tipo: "avance", texto: "Botón puesto, faltan los tests." });
		assert.deepEqual(await montaje.recoger(), []);

		await llamar(montaje, "comentar_tarea", { id, tipo: "resultado", texto: "Hecho.\n\nCommit: a1b2c3d" });
		assert.deepEqual(await montaje.recoger(), [
			`${id} hecha: «Exportar el listado de clientes a CSV»\n${ficha(tarea.id)}`,
		]);
	} finally {
		await montaje.cerrar();
	}
});

test("un análisis sin autoejecución avisa de que espera aprobación", async () => {
	const montaje = await montar();
	try {
		const tarea = tareaEnPrepared(montaje, "Migrar el envío de correos a la cola", false);
		const id = formatearId(tarea.id);
		await llamar(montaje, "tomar_tarea", { id, fase: "analisis" });
		await llamar(montaje, "comentar_tarea", { id, tipo: "analisis", texto: "Plan: una cola y un reintento." });

		assert.deepEqual(await montaje.recoger(), [
			`${id} análisis listo: «Migrar el envío de correos a la cola»\n${ficha(tarea.id)}`,
		]);
	} finally {
		await montaje.cerrar();
	}
});

test("una pregunta del humano avisa como hecha en cuanto se responde", async () => {
	const montaje = await montar();
	try {
		const creada = crearTareaHumana(montaje.db, {
			titulo: "¿Cuánto nos cuesta cada tarea?",
			descripcion: "Quiero saberlo antes de contratar otro terminal.",
			usuarioId: montaje.usuarioId,
			tipo: "pregunta",
			analisisModelo: "sonnet",
			analisisTerminalId: montaje.terminalId,
		});
		const tarea = moverTareaHumano(montaje.db, {
			tareaId: creada.id,
			usuarioId: montaje.usuarioId,
			estado: "prepared",
		});
		const id = formatearId(tarea.id);
		await llamar(montaje, "tomar_tarea", { id, fase: "analisis" });
		// En una pregunta el comentario `analisis` es la respuesta y la deja en done.
		await llamar(montaje, "comentar_tarea", { id, tipo: "analisis", texto: "Unos 200.000 tokens de media." });

		assert.deepEqual(await montaje.recoger(), [`${id} hecha: «¿Cuánto nos cuesta cada tarea?»\n${ficha(tarea.id)}`]);
	} finally {
		await montaje.cerrar();
	}
});

test("la descomposición de una funcionalidad avisa, y cerrar su última parte avisa de la parte", async () => {
	const montaje = await montar();
	try {
		const evolutivo = tareaEnPrepared(montaje, "Que los comerciales se bajen sus listados", true, "funcionalidad");
		const evolutivoId = formatearId(evolutivo.id);
		await llamar(montaje, "tomar_tarea", { id: evolutivoId, fase: "analisis" });
		const creada = await llamar(montaje, "crear_tarea", {
			titulo: "Poner el botón de descarga",
			descripcion: "En la pantalla de clientes.",
			clase: "parte",
			padre: evolutivoId,
		});
		const parteId = creada.split("\n")[0]?.replace("creada: ", "") ?? "";
		assert.match(parteId, /^T-\d{4}$/);
		// Crear la parte no avisa: lo que espera al humano es la descomposición.
		assert.deepEqual(await montaje.recoger(), []);

		await llamar(montaje, "comentar_tarea", { id: evolutivoId, tipo: "analisis", texto: "Una sola parte: el botón." });
		assert.deepEqual(await montaje.recoger(), [
			`${evolutivoId} descomposición lista: «Que los comerciales se bajen sus listados»\n${ficha(evolutivo.id)}`,
		]);

		// El humano aprueba la descomposición: la parte sale a prepared.
		aprobarEjecucion(montaje.db, { tareaId: evolutivo.id, usuarioId: montaje.usuarioId });
		assert.deepEqual(await montaje.recoger(), []);

		await llamar(montaje, "tomar_tarea", { id: parteId, fase: "analisis" });
		await llamar(montaje, "comentar_tarea", { id: parteId, tipo: "analisis", texto: "Plan de la parte." });
		await llamar(montaje, "tomar_tarea", { id: parteId, fase: "ejecucion" });
		await llamar(montaje, "comentar_tarea", { id: parteId, tipo: "resultado", texto: "Hecho.\n\nCommit: bbbbbbb" });
		assert.deepEqual(await montaje.recoger(), [
			`${parteId} hecha: «Poner el botón de descarga»\n${BASE_URL_PRUEBA}/tareas/${parteId}`,
		]);

		// Y la funcionalidad se cierra cuando el humano acepta esa última parte,
		// en su misma transacción. Eso lo hace él desde la web, así que no avisa:
		// ya lo sabe. El aviso de la funcionalidad solo saldría si la cerrara la
		// transacción de un agente.
		moverTareaHumano(montaje.db, { tareaId: parsearId(parteId), usuarioId: montaje.usuarioId, estado: "finished" });
		assert.deepEqual(await montaje.recoger(), []);
	} finally {
		await montaje.cerrar();
	}
});
