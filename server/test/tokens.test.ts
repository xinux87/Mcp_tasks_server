import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verificarPassword } from "../src/auth/passwords.ts";
import { buscarTerminalPorToken, crearTerminalConToken, generarToken, hashToken } from "../src/auth/tokens.ts";
import { abrirBaseDeDatos } from "../src/db/abrir.ts";
import { crearUsuario, guardarUltimaRevision, marcarTerminalConectado, revisionActual } from "../src/db/consultas.ts";

test("el token generado son 43 caracteres base64url", () => {
	const token = generarToken();
	assert.equal(token.length, 43);
	assert.match(token, /^[A-Za-z0-9_-]{43}$/);
	assert.notEqual(token, generarToken());
});

test("crear usuario y terminal sube la revisión y el token encuentra el terminal", () => {
	const db = abrirBaseDeDatos(":memory:");
	try {
		assert.equal(revisionActual(db), 0);

		const { valor: usuario, revision: trasUsuario } = crearUsuario(db, "xinux", hashPassword("secreta"));
		assert.equal(trasUsuario, 1);

		const { valor, revision: trasTerminal } = crearTerminalConToken(
			db,
			usuario.id,
			"portatil-xinux",
			"xinux@ejemplo.com",
		);
		assert.equal(trasTerminal, 2);
		assert.equal(revisionActual(db), 2);
		assert.equal(valor.token.length, 43);

		const encontrado = buscarTerminalPorToken(db, valor.token);
		assert.ok(encontrado, "el token válido tiene que encontrar el terminal");
		assert.equal(encontrado.id, valor.terminal.id);
		assert.equal(encontrado.nombre, "portatil-xinux");
		assert.equal(encontrado.cuenta, "xinux@ejemplo.com");

		// En la base de datos solo está el hash, nunca el token en claro.
		assert.equal(encontrado.tokenHash, hashToken(valor.token));
		assert.notEqual(encontrado.tokenHash, valor.token);

		assert.equal(buscarTerminalPorToken(db, generarToken()), undefined);
		assert.equal(buscarTerminalPorToken(db, "inventado"), undefined);
	} finally {
		db.close();
	}
});

test("un terminal revocado deja de encontrarse por su token", () => {
	const db = abrirBaseDeDatos(":memory:");
	try {
		const { valor: usuario } = crearUsuario(db, "xinux", hashPassword("secreta"));
		const { valor } = crearTerminalConToken(db, usuario.id, "sobremesa", "xinux@ejemplo.com");
		assert.ok(buscarTerminalPorToken(db, valor.token));

		db.prepare("UPDATE terminales SET revocado_en = ? WHERE id = ?").run("2026-09-04T00:00:00.000Z", valor.terminal.id);
		assert.equal(buscarTerminalPorToken(db, valor.token), undefined);
	} finally {
		db.close();
	}
});

test("scrypt guarda la contraseña en el formato scrypt$sal$hash y la verifica", () => {
	const guardado = hashPassword("contraseña larga");
	assert.match(guardado, /^scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
	assert.equal(guardado.split("$").length, 3);
	assert.ok(verificarPassword("contraseña larga", guardado));
	assert.ok(!verificarPassword("otra", guardado));
	assert.ok(!verificarPassword("contraseña larga", "cualquier-cosa"));
	// La sal es aleatoria: dos hashes de la misma contraseña no coinciden.
	assert.notEqual(guardado, hashPassword("contraseña larga"));
});

test("la telemetría del terminal se escribe pero no sube la revisión", () => {
	const db = abrirBaseDeDatos(":memory:");
	try {
		const { valor: usuario } = crearUsuario(db, "xinux", hashPassword("secreta"));
		const { valor } = crearTerminalConToken(db, usuario.id, "portatil-xinux", "xinux@ejemplo.com");
		const antes = revisionActual(db);
		assert.equal(antes, 2);

		const conectado = marcarTerminalConectado(db, valor.terminal.id);
		assert.equal(typeof conectado.conectadoEn, "string");
		assert.equal(revisionActual(db), antes);

		const anotado = guardarUltimaRevision(db, valor.terminal.id, 7);
		assert.equal(anotado.ultimaRevision, 7);
		assert.equal(revisionActual(db), antes);

		// El último valor pasado es el que queda guardado.
		assert.equal(guardarUltimaRevision(db, valor.terminal.id, 9).ultimaRevision, 9);
		assert.equal(revisionActual(db), antes);
	} finally {
		db.close();
	}
});
