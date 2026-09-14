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
import { crearProyecto } from "../src/db/proyectos.ts";
import { aprobarEjecucion, crearTareaHumana, moverTareaHumano } from "../src/db/tareas.ts";
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
	const { valor: usuario } = crearUsuario(db, "ana", hashPassword("secreta"));
	const { valor: a } = crearTerminalConToken(db, usuario.id, "portatil-a", "ana@ejemplo.com");
	const { valor: b } = crearTerminalConToken(db, usuario.id, "sobremesa-b", "ana@ejemplo.com");
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

test("un terminal solo ve, toma y crea tareas de su proyecto", async () => {
	const montaje = montar();
	// Una tarea de PRI sin terminal: «sin terminal» significa «cualquier
	// terminal de este proyecto», no cualquier terminal del servidor.
	const suelta = crearTareaHumana(montaje.db, {
		titulo: "Avisar cuando falle el export",
		descripcion: "Hoy no se entera nadie.",
		usuarioId: montaje.usuarioId,
	});
	moverTareaHumano(montaje.db, { tareaId: suelta.id, usuarioId: montaje.usuarioId, estado: "prepared" });

	const web = crearProyecto(montaje.db, { clave: "WEB", nombre: "La web" });
	const { valor: c } = crearTerminalConToken(
		montaje.db,
		montaje.usuarioId,
		"portatil-web",
		"ana@ejemplo.com",
		undefined,
		undefined,
		web.id,
	);
	const cliente = await conectar(montaje, c.token);
	try {
		// Ni la asignada a otro terminal ni la que está sin terminal son suyas.
		assert.match((await llamar(cliente, "novedades", { revision: 0 })).texto, /^revision: \d+$/);
		assert.equal((await llamar(cliente, "listar_tareas", {})).texto, "Ninguna.");
		assert.equal(codigoDe(await llamar(cliente, "tomar_tarea", { id: "T-0002", fase: "analisis" })), "otro_proyecto");

		// Lo que propone nace en su proyecto, y ahí sí lo ve.
		const propuesta = await llamar(cliente, "crear_tarea", {
			titulo: "Pintar el tablero de la web",
			descripcion: "Se descubrió por el camino.",
			clase: "propuesta",
		});
		assert.match(propuesta.texto, /^creada: T-0003$/m);
		assert.match(
			(await llamar(cliente, "listar_tareas", {})).texto,
			/^- T-0003 · backlog · Pintar el tablero de la web/m,
		);

		// `leer_tarea` no se acota: una dependencia puede citar otro proyecto.
		assert.match((await llamar(cliente, "leer_tarea", { id: "T-0003" })).texto, /^id: T-0003\nproyecto: WEB$/m);
		assert.match((await llamar(cliente, "leer_tarea", { id: "T-0001" })).texto, /^id: T-0001\nproyecto: PRI$/m);
	} finally {
		await cliente.close();
		await montaje.cerrar();
	}
});

test("una funcionalidad se descompone en partes por el MCP y solo la primera llega al bucle", async () => {
	const montaje = montar();
	const a = await conectar(montaje, montaje.tokenA);
	const b = await conectar(montaje, montaje.tokenB);
	try {
		// El humano deja la funcionalidad lista para descomponer, con su rama.
		const evolutivo = crearTareaHumana(montaje.db, {
			titulo: "Que los comerciales se bajen sus listados",
			descripcion: "Hoy copian los datos a mano y se equivocan.",
			usuarioId: montaje.usuarioId,
			tipo: "funcionalidad",
			rama: "evolutivo/csv",
			analisisModelo: "sonnet",
			analisisTerminalId: 1,
			ejecucionModelo: "opus",
			ejecucionTerminalId: 1,
		});
		moverTareaHumano(montaje.db, { tareaId: evolutivo.id, usuarioId: montaje.usuarioId, estado: "prepared" });

		// Llega al bucle como funcionalidad, con su progreso y sin ejecución.
		const primeras = await llamar(a, "novedades", { revision: 0 });
		assert.match(primeras.texto, /^- T-0002 · prepared · funcionalidad 0\/0 · .+ · analisis: sonnet@portatil-a$/m);

		// No se ejecuta: se ejecutan sus partes.
		assert.equal(
			codigoDe(await llamar(a, "tomar_tarea", { id: "T-0002", fase: "ejecucion" })),
			"funcionalidad_sin_ejecucion",
		);
		await llamar(a, "tomar_tarea", { id: "T-0002", fase: "analisis" });

		// Las partes las crea el terminal que analiza, y nadie más.
		assert.equal(
			codigoDe(await llamar(b, "crear_tarea", { titulo: "Ajena", descripcion: "d", clase: "parte", padre: "T-0002" })),
			"solo_desde_descomposicion",
		);
		assert.equal(
			codigoDe(await llamar(a, "crear_tarea", { titulo: "Sin padre", descripcion: "d", clase: "parte" })),
			"padre_obligatorio",
		);

		const datos = await llamar(a, "crear_tarea", {
			titulo: "Sacar los datos del listado",
			descripcion: "Con los filtros puestos.",
			clase: "parte",
			padre: "T-0002",
		});
		assert.match(datos.texto, /^creada: T-0003$/m);
		assert.match(datos.texto, /^- T-0003 · backlog · Sacar los datos del listado · .+ · padre: T-0002$/m);

		const boton = await llamar(a, "crear_tarea", {
			titulo: "Poner el botón de descarga",
			descripcion: "En la pantalla de clientes.",
			clase: "parte",
			padre: "T-0002",
			dependeDe: ["T-0003"],
		});
		assert.match(boton.texto, /^creada: T-0004$/m);

		// Y una propuesta puede ser a su vez una funcionalidad.
		const propuesta = await llamar(a, "crear_tarea", {
			titulo: "Rehacer el informe mensual",
			descripcion: "Se descubrió por el camino.",
			clase: "propuesta",
			tipo: "funcionalidad",
		});
		assert.match(propuesta.texto, /^- T-0005 · backlog · funcionalidad 0\/0 · Rehacer el informe mensual · /m);

		// El comentario de análisis cierra la descomposición.
		const analizada = await llamar(a, "comentar_tarea", {
			id: "T-0002",
			tipo: "analisis",
			texto: "Dos partes: los datos y el botón.",
		});
		assert.match(analizada.texto, /^- T-0002 · prepared · funcionalidad 0\/2 · análisis listo · /m);

		const documento = await llamar(a, "leer_tarea", { id: "T-0002" });
		assert.match(documento.texto, /^rama: evolutivo\/csv$/m);
		assert.match(documento.texto, /^partes: 2\npartesCerradas: 0$/m);
		assert.match(documento.texto, /^- T-0004 · backlog · Poner el botón de descarga · depende de: T-0003$/m);

		// El humano aprueba desde la web: las partes salen del backlog y aparece
		// la de integrar la rama.
		aprobarEjecucion(montaje.db, { tareaId: evolutivo.id, usuarioId: montaje.usuarioId });
		const integrada = await llamar(a, "leer_tarea", { id: "T-0002" });
		assert.match(
			integrada.texto,
			/^- T-0006 · prepared · Integrar la rama `evolutivo\/csv` en la principal · depende de: T-0003, T-0004$/m,
		);

		// El bucle solo ve la primera parte: la funcionalidad ya no es trabajo
		// suyo y las demás partes esperan.
		const despues = await llamar(a, "novedades", { revision: 0 });
		const ids = despues.texto
			.split("\n")
			.filter((linea) => linea.startsWith("- T-"))
			.map((linea) => linea.slice(2, 8));
		assert.deepEqual(ids, ["T-0001", "T-0003"]);
		assert.equal(codigoDe(await llamar(a, "tomar_tarea", { id: "T-0004", fase: "analisis" })), "esperando_dependencias");
	} finally {
		await a.close();
		await b.close();
		await montaje.cerrar();
	}
});
