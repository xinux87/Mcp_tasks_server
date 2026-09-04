import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { buscarTerminalPorTokenHash, type ConRevision, crearTerminal, type Terminal } from "../db/consultas.ts";

/** 32 bytes aleatorios en base64url: 43 caracteres sin relleno. */
export function generarToken(): string {
	return randomBytes(32).toString("base64url");
}

/** SHA-256 en hexadecimal. Es lo único que se guarda del token. */
export function hashToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Busca el terminal activo dueño de un token en claro. */
export function buscarTerminalPorToken(db: DatabaseSync, token: string): Terminal | undefined {
	return buscarTerminalPorTokenHash(db, hashToken(token));
}

export type TerminalConToken = {
	terminal: Terminal;
	/** El token en claro. Solo se puede ver aquí: la base de datos guarda el hash. */
	token: string;
};

/** Crea un terminal y su token. Sube la revisión. */
export function crearTerminalConToken(
	db: DatabaseSync,
	usuarioId: number,
	nombre: string,
	cuenta: string,
): ConRevision<TerminalConToken> {
	const token = generarToken();
	const { valor, revision } = crearTerminal(db, usuarioId, nombre, cuenta, hashToken(token));
	return { valor: { terminal: valor, token }, revision };
}
