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
		db.prepare("INSERT INTO usuarios (nombre, hash_password, color, creado) VALUES ('xinux', 'h', 'azul', ?)").run(FECHA);
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
