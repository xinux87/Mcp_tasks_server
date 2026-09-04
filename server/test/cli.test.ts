import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { abrirBaseDeDatos, rutaBaseDeDatos } from "../src/db/abrir.ts";
import { comentarAnalisis, preguntar } from "../src/db/hilo.ts";
import { tomarTarea } from "../src/db/tareas.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

type Salida = { codigo: number; salida: string };

/** `execFileSync` cuelga el código de salida y las salidas del error que lanza. */
function campo(error: unknown, nombre: string): unknown {
	return typeof error === "object" && error !== null && nombre in error ? Reflect.get(error, nombre) : undefined;
}

function numero(error: unknown, nombre: string): number | undefined {
	const valor = campo(error, nombre);
	return typeof valor === "number" ? valor : undefined;
}

function cadena(error: unknown, nombre: string): string {
	const valor = campo(error, nombre);
	return typeof valor === "string" ? valor : "";
}

/**
 * Ejecuta el CLI como lo ejecuta una persona: un proceso aparte con su propio
 * `DATA_DIR`. Es lo que se quiere probar, porque el CLI abre y cierra la base
 * de datos él mismo y termina con `process.exit`.
 */
function cli(dataDir: string, ...argumentos: string[]): Salida {
	try {
		const salida = execFileSync(process.execPath, [CLI, ...argumentos], {
			env: { ...process.env, DATA_DIR: dataDir },
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { codigo: 0, salida };
	} catch (error) {
		return { codigo: numero(error, "status") ?? 1, salida: `${cadena(error, "stdout")}${cadena(error, "stderr")}` };
	}
}

/** El CLI que tiene que salir bien: si no, el test enseña lo que imprimió. */
function bien(dataDir: string, ...argumentos: string[]): string {
	const resultado = cli(dataDir, ...argumentos);
	assert.equal(resultado.codigo, 0, `«${argumentos.join(" ")}» falló:\n${resultado.salida}`);
	return resultado.salida;
}

test("el CLI crea usuario, terminal y tarea, la mueve y la enseña", () => {
	const dataDir = mkdtempSync(join(tmpdir(), "mcp-tareas-cli-"));
	try {
		assert.match(bien(dataDir, "crear-usuario", "xinux", "secreta"), /^usuario creado: xinux \(id 1\)$/m);
		assert.match(
			bien(dataDir, "crear-terminal", "xinux", "portatil-a", "xinux@ejemplo.com"),
			/^terminal creado: portatil-a \(id 1\)$/m,
		);

		const creada = bien(
			dataDir,
			"crear-tarea",
			"xinux",
			"Exportar el listado de clientes a CSV",
			"Hoy lo copian a mano.",
			"--analisis",
			"sonnet@portatil-a",
			"--ejecucion",
			"opus@portatil-a",
		);
		assert.match(creada, /^creada: T-0001$/m);

		// En backlog la tarea existe pero el agente no la ve.
		assert.match(
			bien(dataDir, "listar"),
			/^- T-0001 · backlog · Exportar el listado de clientes a CSV · analisis: sonnet@portatil-a · ejecucion: opus@portatil-a$/m,
		);
		assert.equal(bien(dataDir, "listar", "prepared").trim(), "Ninguna.");

		assert.match(bien(dataDir, "mover-tarea", "xinux", "T-0001", "prepared"), /^movida: T-0001 · prepared$/m);

		const documento = bien(dataDir, "ver-tarea", "T-0001");
		assert.match(documento, /^id: T-0001$/m);
		assert.match(documento, /^estado: prepared$/m);
		assert.match(documento, /^ {2}modelo: sonnet\n {2}terminal: portatil-a$/m);
		assert.match(documento, /^## Hilo\n\nNinguno\.$/m);
	} finally {
		rmSync(dataDir, { recursive: true, force: true });
	}
});

test("un error de regla en el CLI sale con su código y termina en 1", () => {
	const dataDir = mkdtempSync(join(tmpdir(), "mcp-tareas-cli-"));
	try {
		bien(dataDir, "crear-usuario", "xinux", "secreta");
		bien(dataDir, "crear-tarea", "xinux", "Una", "d");

		// De backlog no se pasa a done: no es una de las cuatro transiciones.
		const salto = cli(dataDir, "mover-tarea", "xinux", "T-0001", "done");
		assert.equal(salto.codigo, 1);
		assert.match(salto.salida, /^transicion_no_permitida: /m);

		// Volver atrás sin nota tampoco.
		bien(dataDir, "mover-tarea", "xinux", "T-0001", "prepared");
		const sinNota = cli(dataDir, "mover-tarea", "xinux", "T-0001", "backlog");
		assert.equal(sinNota.codigo, 1);
		assert.match(sinNota.salida, /^nota_obligatoria: /m);

		// Un terminal que no existe se detecta antes de escribir nada.
		const fantasma = cli(dataDir, "crear-tarea", "xinux", "Otra", "d", "--analisis", "sonnet@fantasma");
		assert.equal(fantasma.codigo, 1);
		assert.match(fantasma.salida, /^no existe el terminal fantasma$/m);
	} finally {
		rmSync(dataDir, { recursive: true, force: true });
	}
});

test("el CLI contesta una pregunta por el texto de la opción y aprueba el análisis", () => {
	const dataDir = mkdtempSync(join(tmpdir(), "mcp-tareas-cli-"));
	try {
		bien(dataDir, "crear-usuario", "xinux", "secreta");
		bien(dataDir, "crear-terminal", "xinux", "portatil-a", "xinux@ejemplo.com");
		bien(dataDir, "crear-tarea", "xinux", "Una", "d", "--analisis", "sonnet@portatil-a", "--sin-autoejecucion");
		bien(dataDir, "mover-tarea", "xinux", "T-0001", "prepared");

		// La pregunta y el análisis los escribe el agente por el MCP: aquí se
		// dejan puestos con las funciones de dominio para probar solo los dos
		// comandos del humano.
		const db = abrirBaseDeDatos(rutaBaseDeDatos(dataDir));
		try {
			tomarTarea(db, { tareaId: 1, fase: "analisis", terminalId: 1 });
			preguntar(db, {
				tareaId: 1,
				terminalId: 1,
				pregunta: "¿Qué separador usamos en el CSV?",
				porQueImporta: "la hoja de cálculo abre mal la coma.",
				opciones: [
					{ texto: "Punto y coma", consecuencia: "se abre directo." },
					{ texto: "No hacer nada", consecuencia: "siguen copiando a mano." },
				],
				recomendacion: "Punto y coma",
			});
			comentarAnalisis(db, { tareaId: 1, terminalId: 1, texto: "plan" });
		} finally {
			db.close();
		}

		assert.match(bien(dataDir, "listar"), / · bloqueada · /);
		const contestada = bien(dataDir, "responder", "xinux", "T-0001", "P1", "Punto y coma", "ya lo cambiaremos");
		assert.match(contestada, /^contestada: T-0001 · P1 · Punto y coma$/m);

		const documento = bien(dataDir, "ver-tarea", "T-0001");
		assert.match(documento, /^### respuesta · humano:xinux · .+ · P1$/m);
		assert.match(documento, /^Opción: \*\*Punto y coma\*\*$/m);
		assert.match(documento, /^Nota: ya lo cambiaremos$/m);

		// Sin autoejecución la tarea espera aprobación: la marca lo dice.
		assert.match(bien(dataDir, "listar"), / · análisis listo · /);
		assert.match(bien(dataDir, "aprobar", "xinux", "T-0001"), /^aprobada: T-0001$/m);
		assert.doesNotMatch(bien(dataDir, "listar"), /análisis listo/);

		// Una pregunta ya contestada no se vuelve a contestar.
		const otraVez = cli(dataDir, "responder", "xinux", "T-0001", "P1", "No hacer nada");
		assert.equal(otraVez.codigo, 1);
		assert.match(otraVez.salida, /^pregunta_ya_respondida: /m);
	} finally {
		rmSync(dataDir, { recursive: true, force: true });
	}
});
