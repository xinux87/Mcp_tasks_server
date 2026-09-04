import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * Carpeta con los `.sql`. Se resuelve relativa a este módulo para que funcione
 * igual ejecutando `src/db/migraciones.ts` que `dist/db/migraciones.js`: el
 * Dockerfile copia los `.sql` a `dist/db/migraciones/` en el build.
 */
export const CARPETA_MIGRACIONES = join(import.meta.dirname, "migraciones");

export type Migracion = {
	version: number;
	nombre: string;
	sql: string;
};

/** Lee los archivos `NNN-*.sql` de la carpeta, ordenados por número. */
export function leerMigraciones(carpeta: string = CARPETA_MIGRACIONES): Migracion[] {
	return readdirSync(carpeta)
		.filter((nombre) => nombre.endsWith(".sql"))
		.sort()
		.map((nombre) => {
			const version = Number.parseInt(nombre.slice(0, 3), 10);
			if (!Number.isInteger(version) || version < 1) {
				throw new Error(`migración con nombre inválido: ${nombre} (se espera NNN-descripcion.sql)`);
			}
			return { version, nombre, sql: readFileSync(join(carpeta, nombre), "utf8") };
		});
}

/** Versión de esquema registrada en la base de datos. */
export function versionEsquema(db: DatabaseSync): number {
	const fila = db.prepare("PRAGMA user_version").get();
	const valor = fila?.user_version;
	return typeof valor === "number" ? valor : 0;
}

/**
 * Aplica las migraciones pendientes, cada una dentro de su propia transacción
 * junto con el `PRAGMA user_version`. Volver a arrancar no reaplica nada.
 * Devuelve la versión final del esquema.
 */
export function aplicarMigraciones(db: DatabaseSync, carpeta: string = CARPETA_MIGRACIONES): number {
	const migraciones = leerMigraciones(carpeta);
	let aplicada = versionEsquema(db);

	for (const migracion of migraciones) {
		if (migracion.version <= aplicada) {
			continue;
		}
		if (migracion.version !== aplicada + 1) {
			throw new Error(`hueco en las migraciones: se esperaba la ${aplicada + 1} y llegó ${migracion.nombre}`);
		}
		db.exec("BEGIN");
		try {
			db.exec(migracion.sql);
			// `user_version` solo admite un literal, no un parámetro; el valor
			// viene del nombre del archivo y ya está validado como entero.
			db.exec(`PRAGMA user_version = ${migracion.version}`);
			db.exec("COMMIT");
		} catch (error) {
			db.exec("ROLLBACK");
			throw new Error(`falló la migración ${migracion.nombre}`, { cause: error });
		}
		aplicada = migracion.version;
	}

	return aplicada;
}
