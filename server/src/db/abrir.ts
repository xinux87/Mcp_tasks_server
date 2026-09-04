import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { aplicarMigraciones } from "./migraciones.ts";

/** Nombre fijo del archivo de base de datos dentro de `DATA_DIR`. */
export const NOMBRE_ARCHIVO = "tareas.sqlite";

/** Ruta de la base de datos a partir de `DATA_DIR`. */
export function rutaBaseDeDatos(dataDir: string): string {
	return join(dataDir, NOMBRE_ARCHIVO);
}

/**
 * Abre la base de datos, fija los pragmas y aplica las migraciones pendientes.
 * Acepta `':memory:'` para los tests.
 */
export function abrirBaseDeDatos(ruta: string): DatabaseSync {
	if (ruta !== ":memory:") {
		mkdirSync(dirname(ruta), { recursive: true });
	}
	const db = new DatabaseSync(ruta);
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	aplicarMigraciones(db);
	return db;
}
