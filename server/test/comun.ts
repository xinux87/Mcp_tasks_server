import type { DatabaseSync } from "node:sqlite";
import { hashPassword } from "../src/auth/passwords.ts";
import { crearTerminalConToken } from "../src/auth/tokens.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { crearUsuario } from "../src/db/consultas.ts";
import { esErrorDeRegla } from "../src/errores.ts";

/** Base en memoria con un humano y dos terminales, que es lo mínimo para probar las reglas. */
export type Banco = {
	db: DatabaseSync;
	xinux: number;
	portatil: number;
	sobremesa: number;
	cerrar: () => void;
};

export function montar(): Banco {
	const db = abrirBaseDeDatos(":memory:");
	const { valor: usuario } = crearUsuario(db, "xinux", hashPassword("secreta"));
	const { valor: uno } = crearTerminalConToken(db, usuario.id, "portatil-xinux", "xinux@ejemplo.com");
	const { valor: dos } = crearTerminalConToken(db, usuario.id, "sobremesa-xinux", "xinux@ejemplo.com");
	return {
		db,
		xinux: usuario.id,
		portatil: uno.terminal.id,
		sobremesa: dos.terminal.id,
		cerrar: () => db.close(),
	};
}

/**
 * Ejecuta algo que tiene que romper una regla y devuelve el código del error.
 * Si no lanza, o lanza otra cosa, el test falla aquí y no en la comparación.
 */
export function codigoDe(fn: () => unknown): string {
	try {
		fn();
	} catch (error) {
		if (esErrorDeRegla(error)) {
			return error.codigo;
		}
		throw error;
	}
	throw new Error("se esperaba un ErrorDeRegla y no se lanzó ninguno");
}
