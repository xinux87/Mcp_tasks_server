import assert from "node:assert/strict";
import { test } from "node:test";
import { leerConfig } from "../src/config.ts";
import {
	direccionesDelServidor,
	direccionesDetectadas,
	esIpv4Privada,
	hostsPermitidos,
	type InterfacesDeRed,
} from "../src/direcciones.ts";

/** Lo mínimo que exige el esquema, para que cada test solo hable de lo suyo. */
const ENTORNO = { BASE_URL: "http://localhost:3000", SESSION_SECRET: "secreto-de-pruebas" };

/**
 * Interfaces de red simuladas: una loopback, una privada de cada rango, una
 * pública, una de enlace local y una IPv6. Con las de verdad el test daría un
 * resultado distinto en cada máquina.
 */
const INTERFACES: InterfacesDeRed = {
	lo0: [
		{ address: "127.0.0.1", family: "IPv4", internal: true },
		{ address: "::1", family: "IPv6", internal: true },
	],
	en0: [
		{ address: "192.168.1.10", family: "IPv4", internal: false },
		{ address: "fe80::423:f9a7:e885:dba6", family: "IPv6", internal: false },
	],
	en1: [
		{ address: "10.0.4.7", family: "IPv4", internal: false },
		{ address: "172.20.0.3", family: "IPv4", internal: false },
	],
	// Ni la pública ni la de enlace local son formas de llegar a este servidor.
	ppp0: [
		{ address: "88.20.4.7", family: "IPv4", internal: false },
		{ address: "169.254.3.2", family: "IPv4", internal: false },
		{ address: "172.32.0.1", family: "IPv4", internal: false },
	],
};

test("DIRECCIONES admite varias URLs y les quita la barra final", () => {
	const config = leerConfig({
		...ENTORNO,
		DIRECCIONES: "http://192.168.1.10:3020, https://tareas.example.com/ ,",
	});
	assert.deepEqual(config.DIRECCIONES, ["http://192.168.1.10:3020", "https://tareas.example.com"]);
});

test("una dirección que no es absoluta rompe la configuración", () => {
	assert.throws(
		() => leerConfig({ ...ENTORNO, DIRECCIONES: "http://192.168.1.10:3020,192.168.1.10:3021" }),
		/configuración inválida[\s\S]*DIRECCIONES\.1: cada dirección de DIRECCIONES tiene que ser una URL absoluta/,
	);
});

test("solo son privadas las IPv4 de los tres rangos", () => {
	for (const dentro of ["10.0.0.1", "10.255.255.254", "172.16.0.1", "172.31.255.254", "192.168.1.10"]) {
		assert.equal(esIpv4Privada(dentro), true, dentro);
	}
	for (const fuera of [
		"88.20.4.7",
		"169.254.3.2",
		"172.15.0.1",
		"172.32.0.1",
		"192.169.1.1",
		"10.0.0",
		"10.0.0.256",
		"a.b.c.d",
		"",
	]) {
		assert.equal(esIpv4Privada(fuera), false, fuera);
	}
});

test("se detectan las IPv4 privadas y no internas, con el puerto de escucha", () => {
	assert.deepEqual(direccionesDetectadas(3000, INTERFACES), [
		"http://192.168.1.10:3000",
		"http://10.0.4.7:3000",
		"http://172.20.0.3:3000",
	]);
});

test("sin DIRECCIONES, las direcciones son la base y las detectadas", () => {
	const config = leerConfig({ ...ENTORNO, PORT: "3020", BASE_URL: "http://192.168.1.10:3020" });
	assert.deepEqual(direccionesDelServidor(config, INTERFACES), [
		// La base va primero, y la detectada que es la misma no se repite.
		{ url: "http://192.168.1.10:3020", origen: "base" },
		{ url: "http://10.0.4.7:3020", origen: "detectada" },
		{ url: "http://172.20.0.3:3020", origen: "detectada" },
	]);
});

test("con DIRECCIONES no se detecta nada y cada una dice de dónde sale", () => {
	const config = leerConfig({
		...ENTORNO,
		BASE_URL: "https://tareas.example.com",
		DIRECCIONES: "http://192.168.50.5:3000,https://tareas.example.com/",
	});
	assert.deepEqual(direccionesDelServidor(config, INTERFACES), [
		{ url: "https://tareas.example.com", origen: "base" },
		{ url: "http://192.168.50.5:3000", origen: "configurada" },
	]);
});

test("los hosts permitidos son los de las direcciones, sin puerto, más los locales", () => {
	const config = leerConfig({
		...ENTORNO,
		BASE_URL: "https://tareas.example.com",
		DIRECCIONES: "http://192.168.50.5:3000",
	});
	// Sin puerto a propósito: el middleware del SDK compara solo el hostname.
	assert.deepEqual(hostsPermitidos(config, INTERFACES), [
		"tareas.example.com",
		"192.168.50.5",
		"localhost",
		"127.0.0.1",
		"[::1]",
	]);
});
