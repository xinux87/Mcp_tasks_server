import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Hono } from "hono";
import { crearApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { actividadDe, actividadReciente, altaPor } from "../src/db/actividad.ts";
import {
	altaTerminal,
	borrarUsuario,
	cambiarColor,
	cambiarPassword,
	listarUsuarios,
	revocarTerminal,
} from "../src/db/admin.ts";
import { COLORES_USUARIO } from "../src/db/colores.ts";
import { buscarUsuarioPorNombre, crearUsuario, revisionActual } from "../src/db/consultas.ts";
import { editarTareaBacklog } from "../src/db/edicion.ts";
import { comentarAnalisis, notaHumana, preguntar, responder } from "../src/db/hilo.ts";
import { aprobarEjecucion, crearTareaHumana, moverTareaHumano, reordenar, tomarTarea } from "../src/db/tareas.ts";
import { BASE_URL_PRUEBA, CONFIG_PRUEBA, codigoDe, montar } from "./comun.ts";

/** Las acciones del rastro de un objeto, en el orden en que se escribieron. */
function acciones(db: DatabaseSync, objetoId: number, objeto: "tarea" | "usuario" | "terminal" = "tarea"): string[] {
	return actividadDe(db, objeto, objetoId).map((fila) => fila.accion);
}

/** El detalle de la única fila con esa acción. Falla si hay más de una. */
function detalleDe(
	db: DatabaseSync,
	objeto: "tarea" | "usuario" | "terminal",
	objetoId: number,
	accion: string,
): string {
	const filas = actividadDe(db, objeto, objetoId).filter((fila) => fila.accion === accion);
	assert.equal(filas.length, 1, `se esperaba una sola fila ${accion} y hay ${filas.length}`);
	return filas[0]?.detalle ?? "";
}

test("sin color se reparte el menos usado, y el elegido se respeta o se rechaza", () => {
	const banco = montar();
	try {
		// El usuario del banco ya tiene el primero de la lista.
		assert.equal(buscarUsuarioPorNombre(banco.db, "xinux")?.color, COLORES_USUARIO[0]);

		// Los siguientes van cogiendo el primero que nadie usa, en orden.
		for (let indice = 1; indice < COLORES_USUARIO.length; indice += 1) {
			const { valor } = crearUsuario(banco.db, `usuario-${indice}`, hashPassword("clave"));
			assert.equal(valor.color, COLORES_USUARIO[indice]);
		}
		// Con los ocho repartidos se vuelve a empezar: empate, gana el primero.
		const { valor: noveno } = crearUsuario(banco.db, "noveno", hashPassword("clave"));
		assert.equal(noveno.color, COLORES_USUARIO[0]);

		// Sin actor no hay rastro: es lo que hacen las bases montadas a mano.
		assert.deepEqual(acciones(banco.db, noveno.id, "usuario"), []);

		const { valor: elegido } = crearUsuario(banco.db, "morada", hashPassword("clave"), {
			color: "morado",
			actor: { usuarioId: banco.xinux },
		});
		assert.equal(elegido.color, "morado");
		assert.equal(detalleDe(banco.db, "usuario", elegido.id, "alta_usuario"), "color morado");
		assert.equal(altaPor(banco.db, "usuario", elegido.id), "xinux");

		assert.equal(
			codigoDe(() => crearUsuario(banco.db, "fucsia", hashPassword("clave"), { color: "fucsia" })),
			"color_invalido",
		);
	} finally {
		banco.cerrar();
	}
});

test("cambiar el color y la contraseña dejan rastro sin mover la revisión", () => {
	const banco = montar();
	try {
		const antes = revisionActual(banco.db);

		const cambiado = cambiarColor(banco.db, { usuarioId: banco.xinux, color: "rojo", actorId: banco.xinux });
		assert.equal(cambiado.color, "rojo");
		assert.equal(detalleDe(banco.db, "usuario", banco.xinux, "cambiar_color"), `${COLORES_USUARIO[0]} → rojo`);
		assert.equal(revisionActual(banco.db), antes, "cambiar el color no es contenido: ningún agente lo ve");

		assert.equal(
			codigoDe(() => cambiarColor(banco.db, { usuarioId: banco.xinux, color: "turquesa", actorId: banco.xinux })),
			"color_invalido",
		);

		cambiarPassword(banco.db, { usuarioId: banco.xinux, actual: "secreta", nueva: "otra", repetida: "otra" });
		assert.equal(detalleDe(banco.db, "usuario", banco.xinux, "cambiar_password"), "");
		assert.equal(revisionActual(banco.db), antes);
	} finally {
		banco.cerrar();
	}
});

test("cada acción humana sobre una tarea deja su fila, y reordenar no", () => {
	const banco = montar();
	try {
		const tarea = crearTareaHumana(banco.db, {
			titulo: "Exportar clientes",
			descripcion: "Lo copian a mano.",
			usuarioId: banco.xinux,
		});
		assert.equal(detalleDe(banco.db, "tarea", tarea.id, "crear_tarea"), "");

		const edicion = {
			tareaId: tarea.id,
			usuarioId: banco.xinux,
			titulo: "Exportar clientes a CSV",
			descripcion: "Con los filtros aplicados.",
			autoejecucion: false,
			analisisModelo: "sonnet",
			analisisTerminalId: banco.portatil,
			ejecucionModelo: null,
			ejecucionTerminalId: null,
		};
		editarTareaBacklog(banco.db, edicion);
		assert.equal(
			detalleDe(banco.db, "tarea", tarea.id, "editar_tarea"),
			"título: «Exportar clientes» → «Exportar clientes a CSV»; descripción; " +
				"autoejecución: activada → desactivada; análisis: sin asignar → sonnet@portatil-xinux",
		);
		// Guardar el formulario sin tocar nada no es una acción: no repite fila.
		editarTareaBacklog(banco.db, edicion);
		assert.equal(actividadDe(banco.db, "tarea", tarea.id).filter((fila) => fila.accion === "editar_tarea").length, 1);

		moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.xinux, estado: "prepared" });
		assert.equal(detalleDe(banco.db, "tarea", tarea.id, "mover_tarea"), "backlog → prepared");

		// Lo que hace el agente no deja actividad: ya está en el hilo con su autor.
		const rastroAntesDelAgente = actividadDe(banco.db, "tarea", tarea.id).length;
		tomarTarea(banco.db, { tareaId: tarea.id, fase: "analisis", terminalId: banco.portatil });
		comentarAnalisis(banco.db, { tareaId: tarea.id, terminalId: banco.portatil, texto: "Un botón en el listado." });
		const pregunta = preguntar(banco.db, {
			tareaId: tarea.id,
			terminalId: banco.portatil,
			pregunta: "¿Qué separador usamos en el CSV?",
			porQueImporta: "Su hoja de cálculo está en español.",
			opciones: [
				{ texto: "Punto y coma", consecuencia: "Se abre directamente." },
				{ texto: "No hacer nada", consecuencia: "Siguen copiando a mano." },
			],
			recomendacion: "Punto y coma",
		});
		assert.equal(actividadDe(banco.db, "tarea", tarea.id).length, rastroAntesDelAgente);

		responder(banco.db, { preguntaId: pregunta.id, usuarioId: banco.xinux, opcion: "Punto y coma" });
		assert.equal(detalleDe(banco.db, "tarea", tarea.id, "responder_pregunta"), "P1: Punto y coma");

		aprobarEjecucion(banco.db, { tareaId: tarea.id, usuarioId: banco.xinux });
		assert.equal(detalleDe(banco.db, "tarea", tarea.id, "aprobar_ejecucion"), "");

		const larga = "n".repeat(100);
		notaHumana(banco.db, { tareaId: tarea.id, usuarioId: banco.xinux, texto: larga });
		assert.equal(detalleDe(banco.db, "tarea", tarea.id, "nota"), "n".repeat(80));

		// El orden es prioridad, no configuración: arrastrar no deja rastro.
		const antesDeReordenar = actividadDe(banco.db, "tarea", tarea.id).length;
		reordenar(banco.db, { tareaId: tarea.id, orden: 1 });
		assert.equal(actividadDe(banco.db, "tarea", tarea.id).length, antesDeReordenar);

		// De la más antigua a la más nueva, y todas firmadas por quien las hizo.
		assert.deepEqual(acciones(banco.db, tarea.id), [
			"crear_tarea",
			"editar_tarea",
			"mover_tarea",
			"responder_pregunta",
			"aprobar_ejecucion",
			"nota",
		]);
		assert.equal(altaPor(banco.db, "tarea", tarea.id), "xinux");
		const rastro = actividadDe(banco.db, "tarea", tarea.id);
		for (const fila of rastro) {
			assert.equal(fila.usuarioNombre, "xinux");
			assert.equal(fila.usuarioId, banco.xinux);
		}
		// `objeto_nombre` es el título de entonces, para que la lista global se
		// lea sin buscar: el alta guarda el viejo y lo posterior, el nuevo.
		assert.equal(rastro[0]?.objetoNombre, "Exportar clientes");
		assert.equal(rastro.at(-1)?.objetoNombre, "Exportar clientes a CSV");

		// `actividadReciente` va al revés: lo último, primero.
		assert.deepEqual(
			actividadReciente(banco.db, 2).map((fila) => fila.accion),
			["nota", "aprobar_ejecucion"],
		);
	} finally {
		banco.cerrar();
	}
});

test("los terminales dejan rastro de su alta y de su revocación", () => {
	const banco = montar();
	try {
		const creado = altaTerminal(banco.db, {
			usuarioId: banco.xinux,
			nombre: "torre-xinux",
			cuenta: "xinux@ejemplo.com",
		});
		const terminalId = creado.terminal.id;
		assert.equal(detalleDe(banco.db, "terminal", terminalId, "alta_terminal"), "cuenta xinux@ejemplo.com, de xinux");
		assert.equal(altaPor(banco.db, "terminal", terminalId), "xinux");

		revocarTerminal(banco.db, terminalId, banco.xinux);
		assert.equal(detalleDe(banco.db, "terminal", terminalId, "revocar_terminal"), "");
		assert.deepEqual(acciones(banco.db, terminalId, "terminal"), ["alta_terminal", "revocar_terminal"]);

		// Los terminales del banco se crearon sin actor: no tienen rastro.
		assert.deepEqual(acciones(banco.db, banco.portatil, "terminal"), []);
	} finally {
		banco.cerrar();
	}
});

test("borrar un usuario conserva su nombre en el rastro y le quita el id", () => {
	const banco = montar();
	try {
		const { valor: otro } = crearUsuario(banco.db, "otro", hashPassword("clave"), {
			actor: { usuarioId: banco.xinux },
		});
		// Una acción firmada por el usuario que se va a borrar.
		const tarea = crearTareaHumana(banco.db, { titulo: "Suya", descripcion: "", usuarioId: otro.id });

		borrarUsuario(banco.db, otro.id, banco.xinux);
		assert.equal(buscarUsuarioPorNombre(banco.db, "otro"), undefined);

		const suya = actividadDe(banco.db, "tarea", tarea.id)[0];
		assert.equal(suya?.usuarioNombre, "otro", "el nombre sobrevive al borrado, como el autor del hilo");
		assert.equal(suya?.usuarioId, null);

		// La baja la firma quien la hizo y guarda el nombre del borrado.
		const baja = actividadDe(banco.db, "usuario", otro.id).find((fila) => fila.accion === "baja_usuario");
		assert.equal(baja?.usuarioNombre, "xinux");
		assert.equal(baja?.objetoNombre, "otro");
	} finally {
		banco.cerrar();
	}
});

// --- por la web ---------------------------------------------------------------

type Montaje = { db: DatabaseSync; app: Hono; cerrar: () => Promise<void> };

function montarWeb(): Montaje {
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

async function pedir(
	montaje: Montaje,
	ruta: string,
	opciones: { cookie?: string; formulario?: Record<string, string> } = {},
): Promise<Response> {
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
	return (respuesta.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

test("la web da de alta con color, lo cambia desde la lista y enseña la actividad", async () => {
	const montaje = montarWeb();
	try {
		// `/actividad` es privada, como el resto de la web.
		const sinSesion = await pedir(montaje, "/actividad");
		assert.equal(sinSesion.status, 302);
		assert.equal(sinSesion.headers.get("location"), "/login?volver=%2Factividad");

		const cookie = await entrar(montaje);
		const alta = await pedir(montaje, "/usuarios", {
			cookie,
			formulario: { nombre: "otro", password: "clave", color: "verde" },
		});
		assert.equal(alta.status, 302);
		const otro = listarUsuarios(montaje.db).find((usuario) => usuario.nombre === "otro");
		assert.equal(otro?.color, "verde");

		const lista = await pedir(montaje, "/usuarios", { cookie });
		const cuerpoLista = await lista.text();
		assert.match(cuerpoLista, /<th>Color<\/th>/);
		assert.match(cuerpoLista, /<th>Alta por<\/th>/);
		assert.match(cuerpoLista, /action="\/usuarios\/\d+\/color"/);

		const cambio = await pedir(montaje, `/usuarios/${otro?.id ?? 0}/color`, { cookie, formulario: { color: "rosa" } });
		assert.equal(cambio.status, 302);
		assert.equal(cambio.headers.get("location"), "/usuarios");
		assert.equal(listarUsuarios(montaje.db).find((usuario) => usuario.nombre === "otro")?.color, "rosa");

		const malo = await pedir(montaje, `/usuarios/${otro?.id ?? 0}/color`, { cookie, formulario: { color: "fucsia" } });
		assert.equal(malo.status, 422);
		assert.match(await malo.text(), /no es un color de usuario/);

		const actividad = await pedir(montaje, "/actividad", { cookie });
		assert.equal(actividad.status, 200);
		const cuerpo = await actividad.text();
		assert.match(cuerpo, /alta_usuario/);
		assert.match(cuerpo, /color verde/);
		assert.match(cuerpo, /verde → rosa/);
		assert.match(cuerpo, /<html lang="es">/);
	} finally {
		await montaje.cerrar();
	}
});

test("la actividad de una tarea se enlaza a su ficha desde la lista global", async () => {
	const montaje = montarWeb();
	try {
		const cookie = await entrar(montaje);
		const creada = await pedir(montaje, "/tareas", {
			cookie,
			formulario: { titulo: "Exportar clientes", descripcion: "", autoejecucion: "on" },
		});
		assert.equal(creada.status, 302);

		const cuerpo = await (await pedir(montaje, "/actividad", { cookie })).text();
		assert.match(cuerpo, /crear_tarea/);
		assert.match(cuerpo, /href="\/tareas\/T-0001"/);
	} finally {
		await montaje.cerrar();
	}
});
