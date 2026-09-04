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
