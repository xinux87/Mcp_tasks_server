import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Hono } from "hono";
import { crearApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { crearUsuario } from "../src/db/consultas.ts";
import {
	ciclo,
	costePorModelo,
	devoluciones,
	interrupcionesPorModelo,
	primeraTransicion,
	ritmo,
	ritmoPorDia,
} from "../src/db/informes.ts";
import { crearProyecto } from "../src/db/proyectos.ts";
import { crearTareaHumana } from "../src/db/tareas.ts";
import { BASE_URL_PRUEBA, CONFIG_PRUEBA } from "./comun.ts";

const DIA = 24 * 60 * 60 * 1000;

// Un solo instante para todo el archivo: dos `Date.now()` que cruzan un
// milisegundo dejaban diferencias de 1 ms y el test fallaba una de cada quince.
const AHORA = Date.now();

/** Hace tantos días, en ISO 8601 UTC. Es como se fechan los datos de prueba. */
function hace(dias: number, horas = 0): string {
	return new Date(AHORA - dias * DIA - horas * 3_600_000).toISOString();
}

/**
 * Las tres tablas de las que sale un informe se escriben aquí a mano, con la
 * fecha puesta: ninguna de las funciones normales deja elegirla y sin fechas
 * controladas no se puede probar un periodo.
 */
function gasto(
	db: DatabaseSync,
	fila: {
		tareaId: number;
		fase: "analisis" | "ejecucion";
		modelo: string;
		terminalId: number;
		tokens: number;
		herramientas: number;
		duracionMs: number;
		creado: string;
	},
): void {
	db
		.prepare(
			`INSERT INTO consumo (tarea_id, fase, modelo, terminal_id, tokens, herramientas, duracion_ms, creado)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			fila.tareaId,
			fila.fase,
			fila.modelo,
			fila.terminalId,
			fila.tokens,
			fila.herramientas,
			fila.duracionMs,
			fila.creado,
		);
}

function preguntaDe(db: DatabaseSync, tareaId: number, autor: string, creado: string): void {
	db
		.prepare(
			`INSERT INTO comentarios (tarea_id, tipo, autor, texto, pregunta_id, creado, revision)
			VALUES (?, 'pregunta', ?, '¿Qué separador?', NULL, ?, 1)`,
		)
		.run(tareaId, autor, creado);
}

function salto(db: DatabaseSync, tareaId: number, de: string | null, a: string, creado: string): void {
	db.prepare("INSERT INTO transiciones (tarea_id, de, a, creado) VALUES (?, ?, ?, ?)").run(tareaId, de, a, creado);
}

type Banco = {
	db: DatabaseSync;
	usuario: number;
	terminal: number;
	/** La tarea de `opus`, cerrada y aceptada. */
	tranquila: number;
	/** La de `sonnet`, devuelta una vez antes de quedar hecha. */
	devuelta: number;
	otroProyecto: number;
	/** Una tarea del otro proyecto, con su propio gasto. */
	ajena: number;
	cerrar: () => void;
};

/**
 * Un banco con dos tareas cerradas en el proyecto principal y una tercera en
 * otro proyecto, todas con su gasto, sus preguntas y su historial de columnas.
 * Las fechas van en días hacia atrás para que el periodo se pueda probar.
 */
function sembrar(): Banco {
	const db = abrirBaseDeDatos(":memory:");
	const { valor: usuario } = crearUsuario(db, "ana", hashPassword("secreta"));
	const terminal = db
		.prepare(
			`INSERT INTO terminales (usuario_id, proyecto_id, nombre, cuenta, token_hash, creado)
				VALUES (?, 1, 'portatil-ana', 'ana@ejemplo.com', 'hash', ?) RETURNING id`,
		)
		.get(usuario.id, hace(30))?.id as number;

	const nueva = (titulo: string, modelo: string | null, proyectoId: number, tipo?: "funcionalidad"): number =>
		crearTareaHumana(db, {
			titulo,
			descripcion: "d",
			usuarioId: usuario.id,
			proyectoId,
			tipo,
			analisisModelo: "sonnet",
			ejecucionModelo: modelo,
		}).id;

	// Ciclo de dos días y revisión de uno: es la tarea que sale bien.
	const tranquila = nueva("Exportar el listado", "opus", 1);
	salto(db, tranquila, "backlog", "prepared", hace(10));
	salto(db, tranquila, "doing", "done", hace(8));
	salto(db, tranquila, "done", "finished", hace(7));
	gasto(db, {
		tareaId: tranquila,
		fase: "analisis",
		modelo: "sonnet",
		terminalId: terminal,
		tokens: 30_000,
		herramientas: 6,
		duracionMs: 60_000,
		creado: hace(10),
	});
	gasto(db, {
		tareaId: tranquila,
		fase: "ejecucion",
		modelo: "opus",
		terminalId: terminal,
		tokens: 200_000,
		herramientas: 40,
		duracionMs: 3_600_000,
		creado: hace(8),
	});
	preguntaDe(db, tranquila, "opus@portatil-ana", hace(9));

	// Devuelta una vez: dos entradas en `done` y una vuelta atrás.
	const devuelta = nueva("Migrar el envío de correos", "sonnet", 1);
	salto(db, devuelta, "backlog", "prepared", hace(10));
	salto(db, devuelta, "doing", "done", hace(6));
	salto(db, devuelta, "done", "doing", hace(5));
	salto(db, devuelta, "doing", "done", hace(4));
	gasto(db, {
		tareaId: devuelta,
		fase: "ejecucion",
		modelo: "sonnet",
		terminalId: terminal,
		tokens: 100_000,
		herramientas: 20,
		duracionMs: 1_800_000,
		creado: hace(6),
	});
	preguntaDe(db, devuelta, "sonnet@portatil-ana", hace(6));
	preguntaDe(db, devuelta, "sonnet@portatil-ana", hace(5));

	// Una funcionalidad con gasto y una pregunta: queda fuera de todas las tablas.
	const evolutivo = nueva("Informes del coste", null, 1, "funcionalidad");
	salto(db, evolutivo, "doing", "done", hace(4));
	gasto(db, {
		tareaId: evolutivo,
		fase: "analisis",
		modelo: "fable",
		terminalId: terminal,
		tokens: 500_000,
		herramientas: 90,
		duracionMs: 7_200_000,
		creado: hace(4),
	});
	preguntaDe(db, evolutivo, "fable@portatil-ana", hace(4));

	// Y otro proyecto, para que se vea que la vista acotada no lo mira.
	const otro = crearProyecto(db, { clave: "WEB", nombre: "La web", actor: { nombre: "cli" } });
	const ajena = nueva("Rehacer el login", "haiku", otro.id);
	salto(db, ajena, "backlog", "prepared", hace(3));
	salto(db, ajena, "doing", "done", hace(2));
	gasto(db, {
		tareaId: ajena,
		fase: "ejecucion",
		modelo: "haiku",
		terminalId: terminal,
		tokens: 50_000,
		herramientas: 10,
		duracionMs: 600_000,
		creado: hace(2),
	});

	return {
		db,
		usuario: usuario.id,
		terminal,
		tranquila,
		devuelta,
		otroProyecto: otro.id,
		ajena,
		cerrar: () => db.close(),
	};
}

test("el coste sale por fase y modelo, dividido entre tareas, sin las funcionalidades", () => {
	const banco = sembrar();
	try {
		const filas = costePorModelo(banco.db, { proyectoId: 1 });
		// `fable` solo gastó en la funcionalidad: no aparece.
		assert.deepEqual(
			filas.map((fila) => `${fila.fase} ${fila.modelo}`),
			["analisis sonnet", "ejecucion opus", "ejecucion sonnet"],
		);
		const opus = filas[1];
		assert.equal(opus?.tareas, 1);
		assert.equal(opus?.tokens, 200_000);
		assert.equal(opus?.tokensPorTarea, 200_000);
		assert.equal(opus?.herramientasPorTarea, 40);
		assert.equal(opus?.duracionMediaMs, 3_600_000);
		// La ejecución va ordenada por tokens: opus antes que sonnet.
		assert.equal(filas[2]?.tokens, 100_000);

		// Acotado al otro proyecto solo está lo suyo.
		assert.deepEqual(
			costePorModelo(banco.db, { proyectoId: banco.otroProyecto }).map((fila) => fila.modelo),
			["haiku"],
		);
		// Y sin acotar, los dos proyectos.
		assert.equal(costePorModelo(banco.db).length, 4);
	} finally {
		banco.cerrar();
	}
});

test("las interrupciones salen del autor de la pregunta y no dividen entre cero", () => {
	const banco = sembrar();
	try {
		const filas = interrupcionesPorModelo(banco.db, { proyectoId: 1 });
		const sonnet = filas.find((fila) => fila.modelo === "sonnet");
		assert.equal(sonnet?.preguntas, 2);
		// `sonnet` gastó en las dos tareas del proyecto: una analizando y otra ejecutando.
		assert.equal(sonnet?.tareas, 2);
		assert.equal(sonnet?.preguntasPorTarea, 1);

		const opus = filas.find((fila) => fila.modelo === "opus");
		assert.equal(opus?.preguntas, 1);
		assert.equal(opus?.tareas, 1);
		assert.equal(opus?.preguntasPorTarea, 1);

		// La pregunta de la funcionalidad no cuenta, así que `fable` no sale.
		assert.equal(
			filas.find((fila) => fila.modelo === "fable"),
			undefined,
		);

		// Un modelo que preguntó sin reportar consumo: sale, con cero tareas y
		// sin ratio, porque no hay entre qué dividir.
		preguntaDe(banco.db, banco.tranquila, "haiku@portatil-ana", hace(9));
		const haiku = interrupcionesPorModelo(banco.db, { proyectoId: 1 }).find((fila) => fila.modelo === "haiku");
		assert.equal(haiku?.preguntas, 1);
		assert.equal(haiku?.tareas, 0);
		assert.equal(haiku?.preguntasPorTarea, null);
	} finally {
		banco.cerrar();
	}
});

test("el ciclo toma la mediana, y la revisión solo cuenta donde ya hay finished", () => {
	const banco = sembrar();
	try {
		const filas = ciclo(banco.db, { proyectoId: 1 });
		const opus = filas.find((fila) => fila.modelo === "opus");
		assert.equal(opus?.tareas, 1);
		assert.equal(opus?.cicloMs, 2 * DIA);
		assert.equal(opus?.revisionMs, DIA);

		// Dos entradas en `done` de la misma tarea: la mediana de 4 y 6 días es 5.
		const sonnet = filas.find((fila) => fila.modelo === "sonnet");
		assert.equal(sonnet?.tareas, 2);
		assert.equal(sonnet?.cicloMs, 5 * DIA);
		// Ninguna llegó a `finished`: no hay revisión que medir.
		assert.equal(sonnet?.revisionMs, null);

		// La funcionalidad no entra aunque tenga su entrada en `done`.
		assert.deepEqual(filas.map((fila) => fila.modelo).sort(), ["opus", "sonnet"]);
	} finally {
		banco.cerrar();
	}
});

test("una tarea que nunca pasó por prepared cuenta el ciclo desde que se creó", () => {
	const banco = sembrar();
	try {
		// Una hija de trabajo nace en `doing`: su primera columna no es `prepared`.
		const hija = crearTareaHumana(banco.db, {
			titulo: "Generar el CSV",
			descripcion: "d",
			usuarioId: banco.usuario,
			ejecucionModelo: "fable",
		}).id;
		salto(banco.db, hija, "doing", "done", new Date(Date.now() + 60_000).toISOString());

		const fila = ciclo(banco.db, { proyectoId: 1 }).find((cual) => cual.modelo === "fable");
		assert.ok(fila !== undefined, "no sale el modelo de la hija");
		// Se acaba de crear: el ciclo es el minuto que va de la creación al cierre.
		assert.ok(fila.cicloMs >= 59_000 && fila.cicloMs <= 61_000, `ciclo inesperado: ${fila.cicloMs}`);
	} finally {
		banco.cerrar();
	}
});

test("las devoluciones cuentan cada vuelta atrás con su tasa", () => {
	const banco = sembrar();
	try {
		const filas = devoluciones(banco.db, { proyectoId: 1 });
		const sonnet = filas.find((fila) => fila.modelo === "sonnet");
		assert.equal(sonnet?.entradas, 2);
		assert.equal(sonnet?.devoluciones, 1);
		assert.equal(sonnet?.tasa, 0.5);

		const opus = filas.find((fila) => fila.modelo === "opus");
		assert.equal(opus?.entradas, 1);
		assert.equal(opus?.devoluciones, 0);
		assert.equal(opus?.tasa, 0);

		// Un periodo que solo pilla la vuelta atrás y el cierre siguiente: la
		// entrada de antes queda fuera, así que la tasa es de uno sobre uno.
		const recortado = devoluciones(banco.db, { proyectoId: 1, desde: hace(5, 12) }).find(
			(fila) => fila.modelo === "sonnet",
		);
		assert.equal(recortado?.entradas, 1);
		assert.equal(recortado?.devoluciones, 1);
		assert.equal(recortado?.tasa, 1);
	} finally {
		banco.cerrar();
	}
});

test("el ritmo agrupa por semana y el pie dice desde cuándo hay transiciones", () => {
	const banco = sembrar();
	try {
		const semanas = ritmo(banco.db, { proyectoId: 1 });
		// Tres entradas en `done` del proyecto, repartidas por semanas.
		assert.equal(
			semanas.reduce((total, semana) => total + semana.tareas, 0),
			3,
		);
		for (const semana of semanas) {
			assert.match(semana.semana, /^\d{4}-W\d{2}$/);
		}
		// Ordenadas por semana, que en este formato es orden de texto.
		assert.deepEqual(
			[...semanas].map((semana) => semana.semana).sort(),
			semanas.map((semana) => semana.semana),
		);

		// El periodo recorta: hace tres días solo queda el último cierre.
		assert.equal(
			ritmo(banco.db, { proyectoId: 1, desde: hace(4, 12) }).reduce((total, semana) => total + semana.tareas, 0),
			1,
		);

		const desde = primeraTransicion(banco.db);
		assert.ok(desde !== null, "no hay primera transición");
		assert.ok(desde <= hace(10), `la primera transición debería ser la más antigua: ${desde}`);
	} finally {
		banco.cerrar();
	}
});

test("sin transiciones no hay desde cuándo", () => {
	const db = abrirBaseDeDatos(":memory:");
	try {
		assert.equal(primeraTransicion(db), null);
		assert.deepEqual(ritmo(db), []);
		assert.deepEqual(ciclo(db), []);
	} finally {
		db.close();
	}
});

// --- la página ---------------------------------------------------------------

type Montaje = {
	db: DatabaseSync;
	app: Hono;
	cerrar: () => Promise<void>;
};

/** El banco sembrado, servido por la app entera sin abrir puerto. */
function montarWebConDatos(): { montaje: Montaje; banco: Banco } {
	const banco = sembrar();
	const { app, cerrar } = crearApp({ db: banco.db, config: CONFIG_PRUEBA });
	return {
		montaje: {
			db: banco.db,
			app,
			cerrar: async () => {
				await cerrar();
				banco.cerrar();
			},
		},
		banco,
	};
}

async function pedir(montaje: Montaje, ruta: string, cookie?: string, formulario?: Record<string, string>) {
	const url = new URL(ruta, BASE_URL_PRUEBA);
	const peticion = new Request(
		url,
		formulario === undefined
			? {}
			: {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams(formulario).toString(),
				},
	);
	peticion.headers.set("host", url.host);
	if (cookie !== undefined) {
		peticion.headers.set("cookie", cookie);
	}
	return await montaje.app.fetch(peticion);
}

async function entrar(montaje: Montaje): Promise<string> {
	const respuesta = await pedir(montaje, "/login", undefined, {
		usuario: "ana",
		password: "secreta",
		volver: "/informes",
	});
	assert.equal(respuesta.status, 302);
	return (respuesta.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

test("la página de informes exige sesión y enseña las cuatro preguntas con sus cifras", async () => {
	const { montaje } = montarWebConDatos();
	try {
		const sinCookie = await pedir(montaje, "/informes");
		assert.equal(sinCookie.status, 302);
		assert.match(sinCookie.headers.get("location") ?? "", /^\/login/);

		const cookie = await entrar(montaje);
		const respuesta = await pedir(montaje, "/informes", cookie);
		assert.equal(respuesta.status, 200);
		const cuerpo = await respuesta.text();

		for (const pregunta of [
			"¿Qué cuesta cada modelo?",
			"¿Cuánto interrumpe cada modelo?",
			"¿Dónde se atasca el flujo?",
			"¿Qué modelo entrega resultados que no valen?",
		]) {
			assert.ok(cuerpo.includes(pregunta), `falta la pregunta «${pregunta}»`);
		}
		// Los 200 000 tokens de opus, abreviados.
		assert.ok(cuerpo.includes("200 k"), "no sale el gasto de opus");
		// Y la tasa de devolución de sonnet, como porcentaje sin decimales.
		assert.ok(cuerpo.includes("50 %"), "no sale la tasa de devolución");
		// El ritmo con su barra, y el pie con la fecha de la primera transición.
		assert.ok(cuerpo.includes("<h2>Ritmo</h2>"), "falta el ritmo");
		assert.match(cuerpo, /Transiciones registradas desde \d{4}-\d{2}-\d{2}/);
		// La entrada de la barra lateral, al final del bloque de tareas.
		assert.match(cuerpo, /<a class="enlace-nav" href="\/p\/DEFAULT\/informes" aria-current="page">Informes/);
	} finally {
		await montaje.cerrar();
	}
});

test("el periodo se elige con enlaces y recorta lo que hay fuera", async () => {
	const { montaje } = montarWebConDatos();
	try {
		const cookie = await entrar(montaje);
		const treinta = await pedir(montaje, "/informes", cookie);
		const cuerpoTreinta = await treinta.text();
		// Los 30 días vienen puestos sin pedir nada.
		assert.match(cuerpoTreinta, /href="\/informes\?dias=30" aria-current="true"/);

		// Un consumo de hace veinte días entra en el mes y no en la semana.
		assert.ok(cuerpoTreinta.includes("200 k"), "el mes debería traer el gasto de opus");
		const semana = await pedir(montaje, "/informes?dias=7", cookie);
		const cuerpoSemana = await semana.text();
		assert.match(cuerpoSemana, /href="\/informes\?dias=7" aria-current="true"/);
		assert.ok(!cuerpoSemana.includes("200 k"), "el gasto de hace ocho días no debería salir en la semana");
		// Y «Todo» no acota nada.
		const todo = await pedir(montaje, "/informes?dias=todo", cookie);
		assert.ok((await todo.text()).includes("200 k"));
	} finally {
		await montaje.cerrar();
	}
});

test("el informe de un proyecto no cuenta el gasto de otro", async () => {
	const { montaje } = montarWebConDatos();
	try {
		const cookie = await entrar(montaje);
		const web = await pedir(montaje, "/p/WEB/informes?dias=todo", cookie);
		assert.equal(web.status, 200);
		const cuerpo = await web.text();
		assert.ok(cuerpo.includes("haiku"), "falta el modelo del proyecto acotado");
		assert.ok(!cuerpo.includes("200 k"), "el gasto del proyecto principal no es de este tablero");
		// Y su entrada de navegación se queda dentro del proyecto.
		assert.ok(cuerpo.includes('href="/p/WEB/informes"'), "la navegación se sale del proyecto");

		// Una clave que no existe sigue siendo un 404.
		assert.equal((await pedir(montaje, "/p/NADA/informes", cookie)).status, 404);
	} finally {
		await montaje.cerrar();
	}
});

test("el ritmo por día son catorce filas, con ceros donde no hubo nada", () => {
	const banco = sembrar();
	try {
		salto(banco.db, banco.tranquila, "doing", "done", hace(0));
		salto(banco.db, banco.tranquila, "doing", "done", hace(3));

		const dias = ritmoPorDia(banco.db, { proyectoId: 1 });
		assert.equal(dias.length, 14);
		// Uno detrás de otro y sin huecos: la serie ya viene ordenada.
		assert.deepEqual(
			[...dias].map((dia) => dia.dia).sort(),
			dias.map((dia) => dia.dia),
		);
		const dia = (atras: number): string => hace(atras).slice(0, 10);
		assert.equal(dias.at(-1)?.dia, dia(0));

		const cuantas = new Map(dias.map((fila) => [fila.dia, fila.tareas]));
		assert.equal(cuantas.get(dia(0)), 1, "el cierre de hoy");
		assert.equal(cuantas.get(dia(3)), 1, "el cierre de hace tres días");
		// Hace cuatro días cerraron una tarea y una funcionalidad: solo cuenta la tarea.
		assert.equal(cuantas.get(dia(4)), 1);
		// Un día sin cierres existe igual, a cero, y el otro proyecto no cuenta.
		assert.equal(cuantas.get(dia(1)), 0);
		assert.equal(cuantas.get(dia(2)), 0, "el cierre de WEB no es de este proyecto");

		// La ventana es fija: el periodo elegido no la recorta.
		assert.deepEqual(ritmoPorDia(banco.db, { proyectoId: 1, desde: hace(7) }), dias);
	} finally {
		banco.cerrar();
	}
});

test("el ritmo va por día en los periodos cortos y por semana en los largos", async () => {
	const { montaje } = montarWebConDatos();
	try {
		const cookie = await entrar(montaje);
		const mes = await (await pedir(montaje, "/informes?dias=30", cookie)).text();
		assert.ok(mes.includes("<th>Día</th>"), "el mes debería enseñar el ritmo por día");
		// Las catorce filas, con la de hace ocho días a uno y el día de hoy a cero.
		assert.ok(mes.includes(`<td>${hace(8).slice(0, 10)}</td>`), "falta el día del cierre");
		assert.ok(mes.includes(`<td>${hace(0).slice(0, 10)}</td>`), "falta el día de hoy");

		const trimestre = await (await pedir(montaje, "/informes?dias=90", cookie)).text();
		assert.ok(trimestre.includes("<th>Semana</th>"), "el trimestre debería enseñar el ritmo por semana");
		assert.ok(!trimestre.includes("<th>Día</th>"));
	} finally {
		await montaje.cerrar();
	}
});

test("sin cierres, el ritmo por día dice que no hay datos", async () => {
	const db = abrirBaseDeDatos(":memory:");
	const { valor: usuario } = crearUsuario(db, "ana", hashPassword("secreta"));
	assert.ok(usuario.id > 0);
	const { app, cerrar } = crearApp({ db, config: CONFIG_PRUEBA });
	const montaje: Montaje = {
		db,
		app,
		cerrar: async () => {
			await cerrar();
			db.close();
		},
	};
	try {
		const cookie = await entrar(montaje);
		const cuerpo = await (await pedir(montaje, "/informes?dias=30", cookie)).text();
		assert.equal(ritmoPorDia(db).length, 14, "las filas existen aunque no haya nada que contar");
		assert.ok(cuerpo.includes("<h2>Ritmo</h2>"));
		assert.ok(!cuerpo.includes("<th>Día</th>"), "sin datos no se pinta la tabla");
		assert.ok(cuerpo.includes("Todavía no hay transiciones registradas."));
	} finally {
		await montaje.cerrar();
	}
});
