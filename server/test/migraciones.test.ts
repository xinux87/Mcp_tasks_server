import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { revisionActual } from "../src/db/consultas.ts";
import { aplicarMigraciones, leerMigraciones, versionEsquema } from "../src/db/migraciones.ts";

function tablas(db: DatabaseSync): string[] {
	return db
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
		.all()
		.map((fila) => String(fila.name));
}

test("abrir en memoria deja el esquema en la versión 1 con sus tres tablas", () => {
	const db = abrirBaseDeDatos(":memory:");
	try {
		assert.equal(versionEsquema(db), 1);
		const nombres = tablas(db);
		for (const esperada of ["revision", "terminales", "usuarios"]) {
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
		assert.equal(versionEsquema(db), 1);
		// Si reaplicara la 001, el CREATE TABLE o el INSERT en revision fallarían.
		assert.equal(aplicarMigraciones(db), 1);
		assert.equal(aplicarMigraciones(db), 1);
		assert.equal(versionEsquema(db), 1);
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
