import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { revisionActual } from "../src/db/consultas.ts";
import {
	aplicarMigraciones,
	CARPETA_MIGRACIONES,
	leerMigraciones,
	type Migracion,
	versionEsquema,
} from "../src/db/migraciones.ts";

function tablas(db: DatabaseSync): string[] {
	return db
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
		.all()
		.map((fila) => String(fila.name));
}

test("abrir en memoria deja el esquema en la última versión con sus siete tablas", () => {
	const db = abrirBaseDeDatos(":memory:");
	try {
		assert.equal(versionEsquema(db), leerMigraciones().length);
		const nombres = tablas(db);
		for (const esperada of ["comentarios", "consumo", "preguntas", "revision", "tareas", "terminales", "usuarios"]) {
			assert.ok(nombres.includes(esperada), `falta la tabla ${esperada}`);
		}
		assert.equal(revisionActual(db), 0);
	} finally {
		db.close();
	}
});

test("la tabla de tareas lleva AUTOINCREMENT, así que sus ids no se reutilizan", () => {
	const db = abrirBaseDeDatos(":memory:");
	try {
		const fila = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tareas'").get();
		assert.match(String(fila?.sql), /id INTEGER PRIMARY KEY AUTOINCREMENT/);
		// La cuenta de ids la lleva SQLite en su propia tabla, que solo existe
		// cuando alguna tabla es AUTOINCREMENT.
		assert.ok(tablas(db).includes("sqlite_sequence"), "falta sqlite_sequence");
	} finally {
		db.close();
	}
});

test("aplicar las migraciones dos veces no falla ni reaplica nada", () => {
	const db = abrirBaseDeDatos(":memory:");
	try {
		const ultima = leerMigraciones().length;
		assert.equal(versionEsquema(db), ultima);
		// Si reaplicara la 001, el CREATE TABLE o el INSERT en revision fallarían.
		assert.equal(aplicarMigraciones(db), ultima);
		assert.equal(aplicarMigraciones(db), ultima);
		assert.equal(versionEsquema(db), ultima);
		const filas = db.prepare("SELECT COUNT(*) AS total FROM revision").get();
		assert.equal(filas?.total, 1);
	} finally {
		db.close();
	}
});

test("las migraciones están numeradas y ordenadas sin huecos", () => {
	const migraciones = leerMigraciones();
	assert.ok(migraciones.length >= 1);
	migraciones.forEach((migracion, indice) => {
		assert.equal(migracion.version, indice + 1, `orden inesperado en ${migracion.nombre}`);
	});
});

test("las claves foráneas están activas", () => {
	const db = abrirBaseDeDatos(":memory:");
	try {
		assert.throws(() => {
			db
				.prepare("INSERT INTO terminales (usuario_id, nombre, cuenta, token_hash, creado) VALUES (?, ?, ?, ?, ?)")
				.run(999, "fantasma", "cuenta", "hash", "2026-09-04T00:00:00.000Z");
		});
	} finally {
		db.close();
	}
});

/** Carpeta con solo las `n` primeras migraciones, para aplicar el esquema por partes. */
function hasta(carpeta: string, migraciones: Migracion[], cuantas: number): void {
	for (const migracion of migraciones.slice(0, cuantas)) {
		copyFileSync(join(CARPETA_MIGRACIONES, migracion.nombre), join(carpeta, migracion.nombre));
	}
}

test("la migración del tipo entra en una tabla STRICT con datos y deja las tareas de antes como «tarea»", () => {
	const carpeta = mkdtempSync(join(tmpdir(), "mcp-tareas-migraciones-"));
	const db = new DatabaseSync(":memory:");
	try {
		const migraciones = leerMigraciones();
		const tipo = migraciones.findIndex((migracion) => migracion.nombre.endsWith("-tipo.sql"));
		assert.ok(tipo > 0, "no está la migración del tipo");

		// El esquema anterior, con una tarea ya escrita: es el caso real de una
		// base de datos en marcha cuando llega la columna nueva.
		hasta(carpeta, migraciones, tipo);
		aplicarMigraciones(db, carpeta);
		db
			.prepare(
				`INSERT INTO tareas (titulo, descripcion, estado, orden, creada, actualizada, revision)
				VALUES ('De antes', 'd', 'doing', 1, '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z', 1)`,
			)
			.run();

		hasta(carpeta, migraciones, tipo + 1);
		assert.equal(aplicarMigraciones(db, carpeta), tipo + 1);
		assert.equal(db.prepare("SELECT tipo FROM tareas WHERE id = 1").get()?.tipo, "tarea");

		// Y el CHECK vale también para las filas nuevas.
		assert.throws(() => {
			db.prepare("UPDATE tareas SET tipo = 'otra cosa' WHERE id = 1").run();
		});
	} finally {
		db.close();
		rmSync(carpeta, { recursive: true, force: true });
	}
});

/** Fecha cualquiera: en estos datos de prueba solo tiene que ser texto. */
const FECHA = "2026-09-04T00:00:00.000Z";

test("la migración de dependencias reconstruye tareas sin perder ids ni referencias", () => {
	const carpeta = mkdtempSync(join(tmpdir(), "mcp-tareas-migraciones-"));
	const db = new DatabaseSync(":memory:");
	try {
		db.exec("PRAGMA foreign_keys = ON");
		const migraciones = leerMigraciones();
		const cual = migraciones.findIndex((migracion) => migracion.nombre.endsWith("-dependencias-funcionalidades.sql"));
		assert.ok(cual > 0, "no está la migración de dependencias y funcionalidades");

		// El esquema anterior con datos de todas las tablas que apuntan a
		// `tareas`: es lo que hay en una base en marcha cuando llega el cambio.
		hasta(carpeta, migraciones, cual);
		aplicarMigraciones(db, carpeta);
		db.prepare("INSERT INTO usuarios (nombre, hash_password, color, creado) VALUES ('ana', 'h', 'azul', ?)").run(FECHA);
		db
			.prepare(
				"INSERT INTO terminales (usuario_id, nombre, cuenta, token_hash, creado) VALUES (1, 'portatil-a', 'c', 'hash', ?)",
			)
			.run(FECHA);
		db
			.prepare(
				`INSERT INTO tareas (id, titulo, descripcion, tipo, estado, orden, analisis_modelo, analisis_terminal_id, creada, actualizada, revision)
				VALUES (7, 'De antes', 'd', 'pregunta', 'doing', 1, 'sonnet', 1, ?, ?, 3)`,
			)
			.run(FECHA, FECHA);
		db
			.prepare(
				`INSERT INTO preguntas (id, tarea_id, numero, pregunta, por_que_importa, opciones_json, recomendacion, creada, revision)
				VALUES (4, 7, 1, 'p', 'pq', '[]', 'r', ?, 3)`,
			)
			.run(FECHA);
		db
			.prepare(
				`INSERT INTO comentarios (tarea_id, tipo, autor, texto, pregunta_id, creado, revision)
				VALUES (7, 'pregunta', 'sonnet@portatil-a', 'texto', 4, ?, 3)`,
			)
			.run(FECHA);
		db
			.prepare(
				`INSERT INTO consumo (tarea_id, fase, modelo, terminal_id, tokens, herramientas, duracion_ms, creado)
				VALUES (7, 'analisis', 'sonnet', 1, 100, 2, 30, ?)`,
			)
			.run(FECHA);

		hasta(carpeta, migraciones, cual + 1);
		assert.equal(aplicarMigraciones(db, carpeta), cual + 1);

		// La fila sigue siendo la misma, con su id, y estrena la columna `rama`.
		const tarea = db.prepare("SELECT id, titulo, tipo, rama, estado, revision FROM tareas").all();
		assert.equal(tarea.length, 1);
		assert.equal(tarea[0]?.id, 7);
		assert.equal(tarea[0]?.titulo, "De antes");
		assert.equal(tarea[0]?.tipo, "pregunta");
		assert.equal(tarea[0]?.rama, null);
		assert.equal(tarea[0]?.revision, 3);
		assert.equal(db.prepare("SELECT COUNT(*) AS t FROM comentarios WHERE tarea_id = 7").get()?.t, 1);

		// Y lo que cuelga de ella sigue apuntando a `tareas`, no a la tabla
		// intermedia con la que se reconstruyó.
		assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
		for (const tabla of ["preguntas", "comentarios", "consumo", "dependencias"]) {
			const fila = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(tabla);
			assert.match(String(fila?.sql), /REFERENCES tareas/, `${tabla} ya no apunta a tareas`);
		}
		assert.deepEqual(
			db
				.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tareas' ORDER BY name")
				.all()
				.map((fila) => String(fila.name)),
			["tareas_por_columna", "tareas_por_padre", "tareas_por_revision"],
		);

		// La cuenta de ids arranca en el mayor que ya había: la tarea siguiente
		// es la 8, y ningún id de antes se vuelve a repartir.
		db
			.prepare(
				`INSERT INTO tareas (titulo, descripcion, tipo, estado, orden, creada, actualizada, revision)
				VALUES ('La siguiente', 'd', 'tarea', 'backlog', 2, ?, ?, 4)`,
			)
			.run(FECHA, FECHA);
		assert.equal(db.prepare("SELECT MAX(id) AS id FROM tareas").get()?.id, 8);
		db.prepare("DELETE FROM tareas WHERE id = 8").run();

		// El CHECK nuevo admite `funcionalidad` y sigue sin admitir cualquier cosa.
		db.prepare("UPDATE tareas SET tipo = 'funcionalidad', rama = 'evolutivo/csv' WHERE id = 7").run();
		assert.throws(() => {
			db.prepare("UPDATE tareas SET tipo = 'otra cosa' WHERE id = 7").run();
		});
		// Y las dependencias exigen que las dos tareas existan.
		assert.throws(() => {
			db.prepare("INSERT INTO dependencias (tarea_id, depende_de_id) VALUES (7, 99)").run();
		});
	} finally {
		db.close();
		rmSync(carpeta, { recursive: true, force: true });
	}
});

test("la migración del borrado de terminales deja anulable el terminal del consumo sin perder lo gastado", () => {
	const carpeta = mkdtempSync(join(tmpdir(), "mcp-tareas-migraciones-"));
	const db = new DatabaseSync(":memory:");
	try {
		db.exec("PRAGMA foreign_keys = ON");
		const migraciones = leerMigraciones();
		const cual = migraciones.findIndex((migracion) => migracion.nombre.endsWith("-borrar-terminal.sql"));
		assert.ok(cual > 0, "no está la migración del borrado de terminales");

		// El esquema anterior con consumo ya registrado: son tokens gastados de
		// verdad y el borrado no puede llevárselos por delante.
		hasta(carpeta, migraciones, cual);
		aplicarMigraciones(db, carpeta);
		db.prepare("INSERT INTO usuarios (nombre, hash_password, color, creado) VALUES ('ana', 'h', 'azul', ?)").run(FECHA);
		db
			.prepare(
				"INSERT INTO terminales (usuario_id, nombre, cuenta, token_hash, creado) VALUES (1, 'portatil-a', 'c', 'hash', ?)",
			)
			.run(FECHA);
		db
			.prepare(
				`INSERT INTO tareas (id, titulo, descripcion, tipo, estado, orden, creada, actualizada, revision)
				VALUES (7, 'De antes', 'd', 'tarea', 'doing', 1, ?, ?, 3)`,
			)
			.run(FECHA, FECHA);
		db
			.prepare(
				`INSERT INTO consumo (id, tarea_id, fase, modelo, terminal_id, tokens, herramientas, duracion_ms, creado)
				VALUES (5, 7, 'analisis', 'sonnet', 1, 31500, 6, 87000, ?)`,
			)
			.run(FECHA);

		hasta(carpeta, migraciones, cual + 1);
		assert.equal(aplicarMigraciones(db, carpeta), cual + 1);

		// La fila es la misma, con su id y sus tokens.
		const consumo = db.prepare("SELECT id, tarea_id, modelo, terminal_id, tokens, herramientas FROM consumo").all();
		assert.equal(consumo.length, 1);
		assert.equal(consumo[0]?.id, 5);
		assert.equal(consumo[0]?.tarea_id, 7);
		assert.equal(consumo[0]?.terminal_id, 1);
		assert.equal(consumo[0]?.tokens, 31500);
		assert.equal(consumo[0]?.herramientas, 6);

		// Y ahora el terminal puede quedar a nulo, que es lo que impedía borrarlo.
		db.prepare("UPDATE consumo SET terminal_id = NULL WHERE id = 5").run();
		assert.equal(db.prepare("SELECT terminal_id FROM consumo WHERE id = 5").get()?.terminal_id, null);
		assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);

		// El resto del esquema no se mueve: sigue siendo STRICT, sigue apuntando
		// a las dos tablas y conserva su índice.
		const sql = String(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'consumo'").get()?.sql);
		assert.match(sql, /REFERENCES tareas/);
		assert.match(sql, /REFERENCES terminales/);
		assert.match(sql, /STRICT/);
		assert.deepEqual(
			db
				.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'consumo' ORDER BY name")
				.all()
				.map((fila) => String(fila.name)),
			["consumo_por_tarea"],
		);
		// El CHECK de la fase sigue en pie, y el tipo de la tarea también.
		assert.throws(() => {
			db.prepare("UPDATE consumo SET fase = 'otra cosa' WHERE id = 5").run();
		});
	} finally {
		db.close();
		rmSync(carpeta, { recursive: true, force: true });
	}
});

test("la migración de proyectos cuelga del principal todo lo que ya había", () => {
	const carpeta = mkdtempSync(join(tmpdir(), "mcp-tareas-migraciones-"));
	const db = new DatabaseSync(":memory:");
	try {
		db.exec("PRAGMA foreign_keys = ON");
		const migraciones = leerMigraciones();
		const cual = migraciones.findIndex((migracion) => migracion.nombre.endsWith("-proyectos.sql"));
		assert.ok(cual > 0, "no está la migración de proyectos");

		// Una base en marcha: usuario, dos terminales, dos tareas y su rastro.
		hasta(carpeta, migraciones, cual);
		aplicarMigraciones(db, carpeta);
		db.prepare("INSERT INTO usuarios (nombre, hash_password, color, creado) VALUES ('ana', 'h', 'azul', ?)").run(FECHA);
		for (const nombre of ["portatil-a", "sobremesa-b"]) {
			db
				.prepare("INSERT INTO terminales (usuario_id, nombre, cuenta, token_hash, creado) VALUES (1, ?, 'c', ?, ?)")
				.run(nombre, `hash-${nombre}`, FECHA);
		}
		db
			.prepare(
				`INSERT INTO tareas (id, titulo, descripcion, tipo, estado, orden, analisis_terminal_id, creada, actualizada, revision)
				VALUES (7, 'De antes', 'd', 'tarea', 'doing', 1, 1, ?, ?, 3)`,
			)
			.run(FECHA, FECHA);
		db
			.prepare(
				`INSERT INTO actividad (usuario_id, usuario_nombre, accion, objeto, objeto_id, objeto_nombre, detalle, creado)
				VALUES (1, 'ana', 'crear_tarea', 'tarea', 7, 'De antes', '', ?)`,
			)
			.run(FECHA);

		hasta(carpeta, migraciones, cual + 1);
		assert.equal(aplicarMigraciones(db, carpeta), cual + 1);

		// El proyecto principal existe y todo lo de antes cuelga de él.
		const principal = db.prepare("SELECT id, clave, nombre, rama_principal FROM proyectos").all();
		assert.equal(principal.length, 1);
		assert.equal(principal[0]?.id, 1);
		assert.equal(principal[0]?.clave, "PRI");
		assert.equal(principal[0]?.nombre, "Principal");
		assert.equal(principal[0]?.rama_principal, "main");
		assert.deepEqual(
			db
				.prepare("SELECT proyecto_id FROM tareas UNION ALL SELECT proyecto_id FROM terminales")
				.all()
				.map((fila) => fila.proyecto_id),
			[1, 1, 1],
		);
		// La tarea sigue siendo la misma y el terminal estrena su ruta a nulo.
		assert.equal(db.prepare("SELECT titulo FROM tareas WHERE id = 7").get()?.titulo, "De antes");
		assert.equal(db.prepare("SELECT ruta FROM terminales WHERE id = 1").get()?.ruta, null);
		// El rastro de antes se conserva y ahora admite un objeto más.
		assert.equal(db.prepare("SELECT COUNT(*) AS t FROM actividad").get()?.t, 1);
		db
			.prepare(
				`INSERT INTO actividad (usuario_id, usuario_nombre, accion, objeto, objeto_id, objeto_nombre, detalle, creado)
				VALUES (1, 'ana', 'alta_proyecto', 'proyecto', 1, 'Principal', 'clave PRI', ?)`,
			)
			.run(FECHA);
		assert.throws(() => {
			db.prepare("UPDATE actividad SET objeto = 'otra cosa' WHERE id = 1").run();
		});
		assert.deepEqual(
			db
				.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'actividad'")
				.all()
				.map((fila) => String(fila.name)),
			["actividad_por_objeto"],
		);

		// El tablero se lee dentro de un proyecto: el índice lo encabeza.
		assert.match(
			String(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'tareas_por_columna'").get()?.sql),
			/tareas \(proyecto_id, estado, orden\)/,
		);
		// Y nada quedó apuntando a una fila que no existe.
		assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
		assert.throws(() => {
			db.prepare("UPDATE tareas SET proyecto_id = 99 WHERE id = 7").run();
		});
	} finally {
		db.close();
		rmSync(carpeta, { recursive: true, force: true });
	}
});

test("la migración del proyecto por defecto lo renombra y reparte los colores", () => {
	const carpeta = mkdtempSync(join(tmpdir(), "mcp-tareas-migraciones-"));
	const db = new DatabaseSync(":memory:");
	try {
		const migraciones = leerMigraciones();
		const cual = migraciones.findIndex((migracion) => migracion.nombre.endsWith("-default-color.sql"));
		assert.ok(cual > 0, "no está la migración del proyecto por defecto");

		// Una base de antes: el proyecto 1 se llamaba `PRI` «Principal».
		hasta(carpeta, migraciones, cual);
		aplicarMigraciones(db, carpeta);
		assert.equal(db.prepare("SELECT clave FROM proyectos WHERE id = 1").get()?.clave, "PRI");
		db.prepare("INSERT INTO proyectos (id, clave, nombre, creado) VALUES (2, 'WEB', 'La web', ?)").run(FECHA);

		hasta(carpeta, migraciones, cual + 1);
		assert.equal(aplicarMigraciones(db, carpeta), cual + 1);

		const filas = db.prepare("SELECT id, clave, nombre, color FROM proyectos ORDER BY id").all();
		assert.equal(filas[0]?.clave, "DEFAULT");
		assert.equal(filas[0]?.nombre, "Default");
		// Los colores se reparten por id, como la 004 con los usuarios.
		assert.equal(filas[0]?.color, "azul");
		assert.equal(filas[1]?.clave, "WEB");
		assert.equal(filas[1]?.color, "verde");
		// La columna no admite un color de fuera de los ocho.
		assert.throws(() => {
			db.prepare("UPDATE proyectos SET color = 'gris' WHERE id = 1").run();
		});
	} finally {
		db.close();
		rmSync(carpeta, { recursive: true, force: true });
	}
});

test("una base nueva trae el proyecto por defecto ya renombrado y con color", () => {
	const db = abrirBaseDeDatos(":memory:");
	try {
		const fila = db.prepare("SELECT clave, nombre, color FROM proyectos WHERE id = 1").get();
		assert.equal(fila?.clave, "DEFAULT");
		assert.equal(fila?.nombre, "Default");
		assert.equal(fila?.color, "azul");
	} finally {
		db.close();
	}
});

test("la migración de los agentes deja a 1 los terminales de antes y no admite menos", () => {
	const carpeta = mkdtempSync(join(tmpdir(), "mcp-tareas-migraciones-"));
	const db = new DatabaseSync(":memory:");
	try {
		const migraciones = leerMigraciones();
		const cual = migraciones.findIndex((migracion) => migracion.nombre.endsWith("-agentes.sql"));
		assert.ok(cual > 0, "no está la migración de los agentes en paralelo");

		// Un terminal ya conectado, que es lo que hay en una base en marcha.
		hasta(carpeta, migraciones, cual);
		aplicarMigraciones(db, carpeta);
		db.prepare("INSERT INTO usuarios (nombre, hash_password, color, creado) VALUES ('ana', 'h', 'azul', ?)").run(FECHA);
		db
			.prepare(
				"INSERT INTO terminales (usuario_id, nombre, cuenta, token_hash, creado) VALUES (1, 'portatil-a', 'c', 'hash', ?)",
			)
			.run(FECHA);

		hasta(carpeta, migraciones, cual + 1);
		assert.equal(aplicarMigraciones(db, carpeta), cual + 1);

		// El de antes estrena la columna con el comportamiento de siempre.
		assert.equal(db.prepare("SELECT agentes FROM terminales WHERE id = 1").get()?.agentes, 1);

		// Y de uno en adelante: cero agentes sería un terminal que no trabaja.
		db.prepare("UPDATE terminales SET agentes = 3 WHERE id = 1").run();
		assert.throws(() => {
			db.prepare("UPDATE terminales SET agentes = 0 WHERE id = 1").run();
		});
	} finally {
		db.close();
		rmSync(carpeta, { recursive: true, force: true });
	}
});

test("la migración de la edad en columna estrena estado_desde con la fecha de la última escritura", () => {
	const carpeta = mkdtempSync(join(tmpdir(), "mcp-tareas-migraciones-"));
	const db = new DatabaseSync(":memory:");
	try {
		const migraciones = leerMigraciones();
		const cual = migraciones.findIndex((migracion) => migracion.nombre.endsWith("-estado-desde.sql"));
		assert.ok(cual > 0, "no está la migración de la edad en columna");

		// Una tarea que lleva tiempo en marcha: lo único que se sabe de cuándo
		// entró en su columna es cuándo se escribió por última vez.
		hasta(carpeta, migraciones, cual);
		aplicarMigraciones(db, carpeta);
		const movida = "2026-09-10T08:00:00.000Z";
		db
			.prepare(
				`INSERT INTO tareas (id, titulo, descripcion, tipo, estado, orden, creada, actualizada, revision)
				VALUES (7, 'De antes', 'd', 'tarea', 'doing', 1, ?, ?, 3)`,
			)
			.run(FECHA, movida);

		hasta(carpeta, migraciones, cual + 1);
		assert.equal(aplicarMigraciones(db, carpeta), cual + 1);

		assert.equal(db.prepare("SELECT estado_desde FROM tareas WHERE id = 7").get()?.estado_desde, movida);
		// Y la columna no admite nulos, ni en las filas de antes ni en las nuevas.
		assert.throws(() => {
			db.prepare("UPDATE tareas SET estado_desde = NULL WHERE id = 7").run();
		});
	} finally {
		db.close();
		rmSync(carpeta, { recursive: true, force: true });
	}
});

test("la tabla de transiciones entra vacía, con sus dos índices, y no admite una tarea que no existe", () => {
	const db = abrirBaseDeDatos(":memory:");
	try {
		assert.ok(tablas(db).includes("transiciones"), "falta la tabla transiciones");
		// El pasado no está escrito en ninguna parte: no se reconstruye.
		assert.equal(db.prepare("SELECT COUNT(*) AS total FROM transiciones").get()?.total, 0);
		assert.deepEqual(
			db
				.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'transiciones' ORDER BY name")
				.all()
				.map((fila) => String(fila.name)),
			["transiciones_por_fecha", "transiciones_por_tarea"],
		);
		assert.throws(() => {
			db.prepare("INSERT INTO transiciones (tarea_id, de, a, creado) VALUES (999, NULL, 'backlog', ?)").run(FECHA);
		});
	} finally {
		db.close();
	}
});

test("la migración del presupuesto deja sin tope las tareas de antes y no admite uno negativo", () => {
	const carpeta = mkdtempSync(join(tmpdir(), "mcp-tareas-migraciones-"));
	const db = new DatabaseSync(":memory:");
	try {
		const migraciones = leerMigraciones();
		const cual = migraciones.findIndex((migracion) => migracion.nombre.endsWith("-presupuesto.sql"));
		assert.ok(cual > 0, "no está la migración del presupuesto");

		// Una tarea ya escrita: es lo que hay en una base en marcha.
		hasta(carpeta, migraciones, cual);
		aplicarMigraciones(db, carpeta);
		db
			.prepare(
				`INSERT INTO tareas (id, titulo, descripcion, tipo, estado, orden, creada, actualizada, estado_desde, revision)
				VALUES (7, 'De antes', 'd', 'tarea', 'doing', 1, ?, ?, ?, 3)`,
			)
			.run(FECHA, FECHA, FECHA);

		hasta(carpeta, migraciones, cual + 1);
		assert.equal(aplicarMigraciones(db, carpeta), cual + 1);

		// Nulo es lo de siempre: sin tope y sin marca.
		assert.equal(db.prepare("SELECT presupuesto FROM tareas WHERE id = 7").get()?.presupuesto, null);
		db.prepare("UPDATE tareas SET presupuesto = 200000 WHERE id = 7").run();
		assert.equal(db.prepare("SELECT presupuesto FROM tareas WHERE id = 7").get()?.presupuesto, 200_000);
		assert.throws(() => {
			db.prepare("UPDATE tareas SET presupuesto = -1 WHERE id = 7").run();
		});
	} finally {
		db.close();
		rmSync(carpeta, { recursive: true, force: true });
	}
});

test("la migración del comentario funde nota y avance, y renombra la acción del rastro", () => {
	const carpeta = mkdtempSync(join(tmpdir(), "mcp-tareas-migraciones-"));
	const db = new DatabaseSync(":memory:");
	try {
		db.exec("PRAGMA foreign_keys = ON");
		const migraciones = leerMigraciones();
		const cual = migraciones.findIndex((migracion) => migracion.nombre.endsWith("-comentario.sql"));
		assert.ok(cual > 0, "no está la migración del comentario");

		// El esquema anterior con un hilo de los seis tipos viejos: es lo que hay
		// en una base en marcha cuando los dos libres se funden en uno.
		hasta(carpeta, migraciones, cual);
		aplicarMigraciones(db, carpeta);
		db.prepare("INSERT INTO usuarios (nombre, hash_password, color, creado) VALUES ('ana', 'h', 'azul', ?)").run(FECHA);
		db
			.prepare(
				`INSERT INTO tareas (id, titulo, descripcion, tipo, estado, orden, creada, actualizada, estado_desde, revision)
				VALUES (7, 'De antes', 'd', 'tarea', 'doing', 1, ?, ?, ?, 3)`,
			)
			.run(FECHA, FECHA, FECHA);
		for (const { tipo, autor } of [
			{ tipo: "analisis", autor: "sonnet@portatil-a" },
			{ tipo: "avance", autor: "opus@portatil-a" },
			{ tipo: "nota", autor: "humano:ana" },
		]) {
			db
				.prepare("INSERT INTO comentarios (tarea_id, tipo, autor, texto, creado, revision) VALUES (7, ?, ?, 'texto', ?, 3)")
				.run(tipo, autor, FECHA);
		}
		db
			.prepare(
				`INSERT INTO actividad (usuario_id, usuario_nombre, accion, objeto, objeto_id, objeto_nombre, detalle, creado)
				VALUES (1, 'ana', 'nota', 'tarea', 7, 'De antes', 'lo de siempre', ?)`,
			)
			.run(FECHA);

		hasta(carpeta, migraciones, cual + 1);
		assert.equal(aplicarMigraciones(db, carpeta), cual + 1);

		// Los dos tipos libres son ahora uno, y lo demás no se toca.
		assert.deepEqual(
			db
				.prepare("SELECT tipo, autor FROM comentarios WHERE tarea_id = 7 ORDER BY id")
				.all()
				.map((fila) => `${String(fila.tipo)} · ${String(fila.autor)}`),
			["analisis · sonnet@portatil-a", "comentario · opus@portatil-a", "comentario · humano:ana"],
		);
		assert.equal(db.prepare("SELECT accion FROM actividad WHERE objeto_id = 7").get()?.accion, "comentario");

		// El CHECK nuevo ya no deja escribir los viejos, y nada quedó colgando.
		assert.throws(() => {
			db.prepare("UPDATE comentarios SET tipo = 'avance' WHERE id = 1").run();
		});
		assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
	} finally {
		db.close();
		rmSync(carpeta, { recursive: true, force: true });
	}
});

test("la migración del código deja a las tareas de antes con su número de siempre", () => {
	const carpeta = mkdtempSync(join(tmpdir(), "mcp-tareas-migraciones-"));
	const db = new DatabaseSync(":memory:");
	try {
		const migraciones = leerMigraciones();
		const cual = migraciones.findIndex((migracion) => migracion.nombre.endsWith("-codigo.sql"));
		assert.ok(cual > 0, "no está la migración del código");

		// Dos tareas ya escritas, con ids que no son correlativos: es lo que hay
		// en una base en marcha cuando llega la columna nueva.
		hasta(carpeta, migraciones, cual);
		aplicarMigraciones(db, carpeta);
		db.prepare("INSERT INTO usuarios (nombre, hash_password, color, creado) VALUES ('ana', 'h', 'azul', ?)").run(FECHA);
		for (const id of [7, 142]) {
			db
				.prepare(
					`INSERT INTO tareas (id, proyecto_id, titulo, descripcion, tipo, estado, orden, creada, actualizada, estado_desde, revision)
					VALUES (?, 1, 'De antes', 'd', 'tarea', 'doing', 1, ?, ?, ?, 3)`,
				)
				.run(id, FECHA, FECHA, FECHA);
		}

		hasta(carpeta, migraciones, cual + 1);
		assert.equal(aplicarMigraciones(db, carpeta), cual + 1);

		// Cada una conserva su número como código, con sus cuatro cifras: un id
		// ya citado en un hilo o en un commit sigue valiendo.
		assert.deepEqual(
			db
				.prepare("SELECT id, codigo FROM tareas ORDER BY id")
				.all()
				.map((fila) => `${String(fila.id)} → ${String(fila.codigo)}`),
			["7 → 0007", "142 → 0142"],
		);

		// Y dos tareas no pueden compartir código.
		assert.throws(() => {
			db.prepare("UPDATE tareas SET codigo = '0007' WHERE id = 142").run();
		});
	} finally {
		db.close();
		rmSync(carpeta, { recursive: true, force: true });
	}
});

test("la migración de los papeles crea la tabla, cuelga las dos fases y admite el objeto en el rastro", () => {
	const carpeta = mkdtempSync(join(tmpdir(), "mcp-tareas-migraciones-"));
	const db = new DatabaseSync(":memory:");
	try {
		db.exec("PRAGMA foreign_keys = ON");
		const migraciones = leerMigraciones();
		const cual = migraciones.findIndex((migracion) => migracion.nombre === "015-agentes.sql");
		assert.ok(cual > 0, "no está la migración de los papeles");

		// Una base en marcha: un usuario, un terminal, una tarea y su rastro.
		hasta(carpeta, migraciones, cual);
		aplicarMigraciones(db, carpeta);
		db.prepare("INSERT INTO usuarios (nombre, hash_password, color, creado) VALUES ('ana', 'h', 'azul', ?)").run(FECHA);
		db
			.prepare(
				"INSERT INTO terminales (usuario_id, nombre, cuenta, token_hash, creado) VALUES (1, 'portatil-a', 'c', 'hash', ?)",
			)
			.run(FECHA);
		db
			.prepare(
				`INSERT INTO tareas (id, proyecto_id, codigo, titulo, descripcion, tipo, estado, orden, creada, actualizada, estado_desde, revision)
				VALUES (7, 1, 'K7M3XQ', 'De antes', 'd', 'tarea', 'doing', 1, ?, ?, ?, 3)`,
			)
			.run(FECHA, FECHA, FECHA);
		db
			.prepare(
				`INSERT INTO actividad (usuario_id, usuario_nombre, accion, objeto, objeto_id, objeto_nombre, detalle, creado)
				VALUES (1, 'ana', 'crear_tarea', 'tarea', 7, 'De antes', '', ?)`,
			)
			.run(FECHA);

		hasta(carpeta, migraciones, cual + 1);
		assert.equal(aplicarMigraciones(db, carpeta), cual + 1);

		// La tarea de antes estrena las dos columnas sin papel: sigue trabajándose igual.
		const tarea = db.prepare("SELECT analisis_agente_id, ejecucion_agente_id FROM tareas WHERE id = 7").get();
		assert.equal(tarea?.analisis_agente_id, null);
		assert.equal(tarea?.ejecucion_agente_id, null);

		// La tabla existe, es STRICT y el terminal es opcional.
		assert.ok(tablas(db).includes("agentes"), "falta la tabla agentes");
		assert.match(String(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'agentes'").get()?.sql), /STRICT/);
		db
			.prepare(
				"INSERT INTO agentes (nombre, instrucciones, modelo, creado, actualizado) VALUES ('revisor', 'i', 'sonnet', ?, ?)",
			)
			.run(FECHA, FECHA);
		assert.throws(() => {
			db
				.prepare(
					"INSERT INTO agentes (nombre, instrucciones, modelo, creado, actualizado) VALUES ('revisor', 'i', 'opus', ?, ?)",
				)
				.run(FECHA, FECHA);
		});
		// Y una fase no puede apuntar a un papel que no existe.
		db.prepare("UPDATE tareas SET analisis_agente_id = 1 WHERE id = 7").run();
		assert.throws(() => {
			db.prepare("UPDATE tareas SET ejecucion_agente_id = 99 WHERE id = 7").run();
		});

		// El rastro de antes se conserva y ahora admite un objeto más.
		assert.equal(db.prepare("SELECT COUNT(*) AS t FROM actividad").get()?.t, 1);
		db
			.prepare(
				`INSERT INTO actividad (usuario_id, usuario_nombre, accion, objeto, objeto_id, objeto_nombre, detalle, creado)
				VALUES (1, 'ana', 'alta_agente', 'agente', 1, 'revisor', 'modelo sonnet', ?)`,
			)
			.run(FECHA);
		assert.throws(() => {
			db.prepare("UPDATE actividad SET objeto = 'otra cosa' WHERE id = 1").run();
		});
		assert.deepEqual(
			db
				.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'actividad'")
				.all()
				.map((fila) => String(fila.name)),
			["actividad_por_objeto"],
		);
		assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
	} finally {
		db.close();
		rmSync(carpeta, { recursive: true, force: true });
	}
});

test("la migración de la fase en marcha deja sin fecha lo que ya estaba tomado", () => {
	const carpeta = mkdtempSync(join(tmpdir(), "mcp-tareas-migraciones-"));
	const db = new DatabaseSync(":memory:");
	try {
		const migraciones = leerMigraciones();
		const cual = migraciones.findIndex((migracion) => migracion.nombre.endsWith("-en-marcha-desde.sql"));
		assert.ok(cual > 0, "no está la migración de la fase en marcha");

		hasta(carpeta, migraciones, cual);
		aplicarMigraciones(db, carpeta);
		// Una tarea que un terminal tenía tomada cuando llegó la columna.
		db
			.prepare(
				`INSERT INTO tareas (id, codigo, titulo, descripcion, tipo, estado, orden, en_marcha_terminal_id,
					creada, actualizada, estado_desde, revision)
				VALUES (7, 'K7M3XQ', 'De antes', 'd', 'tarea', 'doing', 1, NULL, ?, ?, ?, 3)`,
			)
			.run(FECHA, FECHA, FECHA);

		hasta(carpeta, migraciones, cual + 1);
		assert.equal(aplicarMigraciones(db, carpeta), cual + 1);

		// No se inventa una fecha que nadie apuntó: sin ella no hay marca `parada`.
		assert.equal(db.prepare("SELECT en_marcha_desde FROM tareas WHERE id = 7").get()?.en_marcha_desde, null);
	} finally {
		db.close();
		rmSync(carpeta, { recursive: true, force: true });
	}
});
