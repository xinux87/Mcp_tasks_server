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
	borrarTerminal,
	borrarUsuario,
	cambiarAgentes,
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
		assert.equal(buscarUsuarioPorNombre(banco.db, "ana")?.color, COLORES_USUARIO[0]);

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
			actor: { usuarioId: banco.ana },
		});
		assert.equal(elegido.color, "morado");
		assert.equal(detalleDe(banco.db, "usuario", elegido.id, "alta_usuario"), "color morado");
		assert.equal(altaPor(banco.db, "usuario", elegido.id), "ana");

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

		const cambiado = cambiarColor(banco.db, { usuarioId: banco.ana, color: "rojo", actorId: banco.ana });
		assert.equal(cambiado.color, "rojo");
		assert.equal(detalleDe(banco.db, "usuario", banco.ana, "cambiar_color"), `${COLORES_USUARIO[0]} → rojo`);
		assert.equal(revisionActual(banco.db), antes, "cambiar el color no es contenido: ningún agente lo ve");

		assert.equal(
			codigoDe(() => cambiarColor(banco.db, { usuarioId: banco.ana, color: "turquesa", actorId: banco.ana })),
			"color_invalido",
		);

		cambiarPassword(banco.db, { usuarioId: banco.ana, actual: "secreta", nueva: "otra", repetida: "otra" });
		assert.equal(detalleDe(banco.db, "usuario", banco.ana, "cambiar_password"), "");
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
			usuarioId: banco.ana,
		});
		assert.equal(detalleDe(banco.db, "tarea", tarea.id, "crear_tarea"), "");

		const edicion = {
			tareaId: tarea.id,
			usuarioId: banco.ana,
			titulo: "Exportar clientes a CSV",
			descripcion: "Con los filtros aplicados.",
			tipo: "tarea" as const,
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
				"autoejecución: activada → desactivada; análisis: sin asignar → sonnet@portatil-ana",
		);
		// Guardar el formulario sin tocar nada no es una acción: no repite fila.
		editarTareaBacklog(banco.db, edicion);
		assert.equal(actividadDe(banco.db, "tarea", tarea.id).filter((fila) => fila.accion === "editar_tarea").length, 1);
		// Cambiar el tipo también se cuenta: decide si la tarea tendrá ejecución.
		editarTareaBacklog(banco.db, { ...edicion, tipo: "pregunta" });
		const ediciones = actividadDe(banco.db, "tarea", tarea.id).filter((fila) => fila.accion === "editar_tarea");
		assert.equal(ediciones.at(-1)?.detalle, "tipo: tarea → pregunta");
		editarTareaBacklog(banco.db, edicion);

		moverTareaHumano(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, estado: "prepared" });
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

		responder(banco.db, { preguntaId: pregunta.id, usuarioId: banco.ana, opcion: "Punto y coma" });
		assert.equal(detalleDe(banco.db, "tarea", tarea.id, "responder_pregunta"), "P1: Punto y coma");

		aprobarEjecucion(banco.db, { tareaId: tarea.id, usuarioId: banco.ana });
		assert.equal(detalleDe(banco.db, "tarea", tarea.id, "aprobar_ejecucion"), "");

		const larga = "n".repeat(100);
		notaHumana(banco.db, { tareaId: tarea.id, usuarioId: banco.ana, texto: larga });
		assert.equal(detalleDe(banco.db, "tarea", tarea.id, "nota"), "n".repeat(80));

		// El orden es prioridad, no configuración: arrastrar no deja rastro.
		const antesDeReordenar = actividadDe(banco.db, "tarea", tarea.id).length;
		reordenar(banco.db, { tareaId: tarea.id, orden: 1 });
		assert.equal(actividadDe(banco.db, "tarea", tarea.id).length, antesDeReordenar);

		// De la más antigua a la más nueva, y todas firmadas por quien las hizo.
		assert.deepEqual(acciones(banco.db, tarea.id), [
			"crear_tarea",
			"editar_tarea",
			"editar_tarea",
			"editar_tarea",
			"mover_tarea",
			"responder_pregunta",
			"aprobar_ejecucion",
			"nota",
		]);
		assert.equal(altaPor(banco.db, "tarea", tarea.id), "ana");
		const rastro = actividadDe(banco.db, "tarea", tarea.id);
		for (const fila of rastro) {
			assert.equal(fila.usuarioNombre, "ana");
			assert.equal(fila.usuarioId, banco.ana);
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
			usuarioId: banco.ana,
			nombre: "torre-ana",
			cuenta: "ana@ejemplo.com",
		});
		const terminalId = creado.terminal.id;
		assert.equal(detalleDe(banco.db, "terminal", terminalId, "alta_terminal"), "cuenta ana@ejemplo.com, de ana");
		assert.equal(altaPor(banco.db, "terminal", terminalId), "ana");

		revocarTerminal(banco.db, terminalId, banco.ana);
		assert.equal(detalleDe(banco.db, "terminal", terminalId, "revocar_terminal"), "");
		assert.deepEqual(acciones(banco.db, terminalId, "terminal"), ["alta_terminal", "revocar_terminal"]);

		// Los terminales del banco se crearon sin actor: no tienen rastro.
		assert.deepEqual(acciones(banco.db, banco.portatil, "terminal"), []);
	} finally {
		banco.cerrar();
	}
});

test("los agentes en paralelo se eligen en el alta y se cambian después, sin subir la revisión", () => {
	const banco = montar();
	try {
		// En el alta, con un entero de 1 en adelante; sin él, uno.
		const tres = altaTerminal(banco.db, {
			usuarioId: banco.ana,
			nombre: "torre-ana",
			cuenta: "ana@ejemplo.com",
			agentes: 3,
		});
		assert.equal(tres.terminal.agentes, 3);
		assert.equal(
			altaTerminal(banco.db, { usuarioId: banco.ana, nombre: "otra", cuenta: "ana@ejemplo.com" }).terminal.agentes,
			1,
		);
		for (const agentes of [0, -1, 1.5, "x"] as (number | string)[]) {
			assert.equal(
				codigoDe(() => altaTerminal(banco.db, { usuarioId: banco.ana, nombre: "mala", cuenta: "c", agentes })),
				"agentes_invalido",
				`se esperaba agentes_invalido con ${agentes}`,
			);
		}

		// Cambiarlo es configuración del terminal: deja rastro y nadie más lo ve.
		const antes = revisionActual(banco.db);
		assert.equal(cambiarAgentes(banco.db, { terminalId: banco.portatil, agentes: "3", actorId: banco.ana }).agentes, 3);
		assert.equal(revisionActual(banco.db), antes);
		assert.equal(detalleDe(banco.db, "terminal", banco.portatil, "cambiar_agentes"), "1 → 3");

		// El mismo valor no escribe nada: arrastrar el formulario no es un cambio.
		cambiarAgentes(banco.db, { terminalId: banco.portatil, agentes: 3, actorId: banco.ana });
		assert.deepEqual(acciones(banco.db, banco.portatil, "terminal"), ["cambiar_agentes"]);

		assert.equal(
			codigoDe(() => cambiarAgentes(banco.db, { terminalId: banco.portatil, agentes: 0, actorId: banco.ana })),
			"agentes_invalido",
		);
		assert.equal(
			codigoDe(() => cambiarAgentes(banco.db, { terminalId: 999, agentes: 2, actorId: banco.ana })),
			"terminal_inexistente",
		);

		// Un terminal revocado ya no va a tomar nada: no se le cambian.
		revocarTerminal(banco.db, tres.terminal.id, banco.ana);
		assert.equal(
			codigoDe(() => cambiarAgentes(banco.db, { terminalId: tres.terminal.id, agentes: 2, actorId: banco.ana })),
			"terminal_revocado",
		);
	} finally {
		banco.cerrar();
	}
});

test("borrar un usuario conserva su nombre en el rastro y le quita el id", () => {
	const banco = montar();
	try {
		const { valor: otro } = crearUsuario(banco.db, "otro", hashPassword("clave"), {
			actor: { usuarioId: banco.ana },
		});
		// Una acción firmada por el usuario que se va a borrar.
		const tarea = crearTareaHumana(banco.db, { titulo: "Suya", descripcion: "", usuarioId: otro.id });

		borrarUsuario(banco.db, otro.id, banco.ana);
		assert.equal(buscarUsuarioPorNombre(banco.db, "otro"), undefined);

		const suya = actividadDe(banco.db, "tarea", tarea.id)[0];
		assert.equal(suya?.usuarioNombre, "otro", "el nombre sobrevive al borrado, como el autor del hilo");
		assert.equal(suya?.usuarioId, null);

		// La baja la firma quien la hizo y guarda el nombre del borrado.
		const baja = actividadDe(banco.db, "usuario", otro.id).find((fila) => fila.accion === "baja_usuario");
		assert.equal(baja?.usuarioNombre, "ana");
		assert.equal(baja?.objetoNombre, "otro");
	} finally {
		banco.cerrar();
	}
});

// --- por la web ---------------------------------------------------------------

type Montaje = { db: DatabaseSync; app: Hono; cerrar: () => Promise<void> };

function montarWeb(): Montaje {
	const db = abrirBaseDeDatos(":memory:");
	crearUsuario(db, "ana", hashPassword("secreta"));
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
		formulario: { usuario: "ana", password: "secreta", volver: "/tareas" },
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
		// Quien dio el alta también va como chip, con su propio color.
		assert.match(cuerpoLista, /<span class="chip color-azul"><span class="inicial">A<\/span>ana<\/span>/);
		assert.match(cuerpoLista, /<label class="muestra color-verde">/);

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
		// Cada acción se cuenta en castellano, no con el nombre de la columna.
		assert.match(cuerpo, /dio de alta al usuario/);
		assert.match(cuerpo, /cambió el color de/);
		assert.match(cuerpo, /color verde/);
		assert.match(cuerpo, /verde → rosa/);
		assert.match(cuerpo, /<html lang="es">/);
		// Agrupada por día: una sección por fecha y una lista dentro.
		assert.match(cuerpo, /<section class="dia">\s*<h2>\d{4}-\d{2}-\d{2}<\/h2>/);
		assert.match(cuerpo, /<ol class="actividad">/);
		assert.match(cuerpo, /<time class="hora silencio" datetime="[^"]+">\d{2}:\d{2}<\/time>/);
		// Quien hizo cada cosa, como chip con su color: ana es azul y ya cambió
		// el de «otro» a rosa, así que el nombre del objeto va en negrita.
		assert.match(cuerpo, /<span class="chip color-azul"><span class="inicial">A<\/span>ana<\/span>/);
		assert.match(cuerpo, /<strong class="objeto">otro<\/strong>/);
	} finally {
		await montaje.cerrar();
	}
});

test("la actividad de una tarea se enlaza a su ficha desde la lista global", async () => {
	const montaje = montarWeb();
	try {
		const cookie = await entrar(montaje);
		// El usuario del montaje se crea sin actor: todavía no hay nada que contar.
		assert.match(await (await pedir(montaje, "/actividad", { cookie })).text(), /Todavía no hay nada\./);

		const creada = await pedir(montaje, "/tareas", {
			cookie,
			formulario: { titulo: "Exportar clientes", descripcion: "", autoejecucion: "on" },
		});
		assert.equal(creada.status, 302);

		const cuerpo = await (await pedir(montaje, "/actividad", { cookie })).text();
		assert.match(cuerpo, /creó la tarea/);
		assert.match(cuerpo, /<a class="id-tarea" href="\/tareas\/T-0001">T-0001<\/a>/);
		assert.match(cuerpo, /<span class="objeto">Exportar clientes<\/span>/);
	} finally {
		await montaje.cerrar();
	}
});

test("el rastro de un terminal empieza en su alta aunque otro haya usado antes ese id", () => {
	const banco = montar();
	try {
		const viejo = altaTerminal(banco.db, {
			usuarioId: banco.ana,
			nombre: "el-de-antes",
			cuenta: "antes@ejemplo.com",
		}).terminal.id;
		revocarTerminal(banco.db, viejo, banco.ana);
		borrarTerminal(banco.db, viejo, banco.ana);

		// Solo `tareas` lleva AUTOINCREMENT: el id del borrado se vuelve a dar.
		const { valor: otro } = crearUsuario(banco.db, "otro", hashPassword("clave"), {
			actor: { usuarioId: banco.ana },
		});
		const nuevo = altaTerminal(banco.db, {
			usuarioId: otro.id,
			nombre: "el-de-ahora",
			cuenta: "ahora@ejemplo.com",
		}).terminal.id;
		assert.equal(nuevo, viejo);

		// El rastro del nuevo es solo suyo, y quien lo dio de alta es «otro».
		assert.deepEqual(acciones(banco.db, nuevo, "terminal"), ["alta_terminal"]);
		assert.equal(altaPor(banco.db, "terminal", nuevo), "otro");

		// Lo del anterior sigue en la tabla, con su nombre, para `GET /actividad`.
		assert.deepEqual(
			actividadReciente(banco.db, 10)
				.filter((fila) => fila.objetoNombre === "el-de-antes")
				.map((fila) => fila.accion),
			["baja_terminal", "revocar_terminal", "alta_terminal"],
		);
	} finally {
		banco.cerrar();
	}
});
