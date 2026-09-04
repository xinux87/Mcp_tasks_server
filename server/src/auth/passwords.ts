import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const ETIQUETA = "scrypt";
const BYTES_SAL = 16;
const BYTES_HASH = 64;

/**
 * Deriva la contraseña con scrypt y la devuelve en el formato
 * `scrypt$<sal>$<hash>`, ambos en base64url.
 */
export function hashPassword(password: string): string {
	const sal = randomBytes(BYTES_SAL);
	const derivada = scryptSync(password, sal, BYTES_HASH);
	return `${ETIQUETA}$${sal.toString("base64url")}$${derivada.toString("base64url")}`;
}

/** Comprueba una contraseña contra un hash guardado. Comparación en tiempo constante. */
export function verificarPassword(password: string, almacenado: string): boolean {
	const partes = almacenado.split("$");
	const salB64 = partes[1];
	const hashB64 = partes[2];
	if (partes.length !== 3 || partes[0] !== ETIQUETA || salB64 === undefined || hashB64 === undefined) {
		return false;
	}

	const sal = Buffer.from(salB64, "base64url");
	const esperado = Buffer.from(hashB64, "base64url");
	if (sal.length === 0 || esperado.length === 0) {
		return false;
	}

	const derivada = scryptSync(password, sal, esperado.length);
	return timingSafeEqual(derivada, esperado);
}
