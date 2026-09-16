import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { abrirBaseDeDatos, rutaBaseDeDatos } from "../src/db/abrir.ts";
import { crearParte } from "../src/db/funcionalidades.ts";
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
		assert.match(bien(dataDir, "crear-usuario", "ana", "secreta"), /^usuario creado: ana \(id 1\)$/m);
		assert.match(
			bien(dataDir, "crear-terminal", "ana", "portatil-a", "ana@ejemplo.com"),
			/^terminal creado: portatil-a \(id 1\)$/m,
		);

		const creada = bien(
			dataDir,
			"crear-tarea",
			"ana",
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

		assert.match(bien(dataDir, "mover-tarea", "ana", "T-0001", "prepared"), /^movida: T-0001 · prepared$/m);

		const documento = bien(dataDir, "ver-tarea", "T-0001");
		assert.match(documento, /^id: T-0001$/m);
		assert.match(documento, /^estado: prepared$/m);
		assert.match(documento, /^ {2}modelo: sonnet\n {2}terminal: portatil-a$/m);
		assert.match(documento, /^## Hilo\n\nNinguno\.$/m);
	} finally {
		rmSync(dataDir, { recursive: true, force: true });
	}
});

test("el CLI crea proyectos y pone cada terminal en el suyo", () => {
	const dataDir = mkdtempSync(join(tmpdir(), "mcp-tareas-cli-"));
	try {
		bien(dataDir, "crear-usuario", "ana", "secreta");
		assert.match(bien(dataDir, "crear-proyecto", "WEB", "La web"), /^proyecto creado: WEB · La web \(id 2\)$/m);

		// Sin clave, el principal.
		assert.match(bien(dataDir, "crear-terminal", "ana", "portatil-a", "ana@ejemplo.com"), /^proyecto: DEFAULT$/m);
		assert.match(bien(dataDir, "crear-terminal", "ana", "portatil-web", "ana@ejemplo.com", "WEB"), /^proyecto: WEB$/m);

		// Una clave que no existe se dice con su código, como cualquier regla.
		const sinProyecto = cli(dataDir, "crear-terminal", "ana", "portatil-c", "ana@ejemplo.com", "NADA");
		assert.equal(sinProyecto.codigo, 1);
		assert.match(sinProyecto.salida, /proyecto_inexistente/);

		// Y una clave mal formada tampoco crea el proyecto.
		const malaClave = cli(dataDir, "crear-proyecto", "web-1", "La web");
		assert.equal(malaClave.codigo, 1);
		assert.match(malaClave.salida, /clave_invalida/);

		const repetida = cli(dataDir, "crear-proyecto", "WEB", "Otra web");
		assert.equal(repetida.codigo, 1);
		assert.match(repetida.salida, /clave_repetida/);
	} finally {
		rmSync(dataDir, { recursive: true, force: true });
	}
});

test("el CLI crea una pregunta que solo tiene análisis y se cierra al responderla", () => {
	const dataDir = mkdtempSync(join(tmpdir(), "mcp-tareas-cli-"));
	try {
		bien(dataDir, "crear-usuario", "ana", "secreta");
		bien(dataDir, "crear-terminal", "ana", "portatil-a", "ana@ejemplo.com");
		bien(
			dataDir,
			"crear-tarea",
			"ana",
			"¿Cuánto se tarda hoy en cerrar el mes?",
			"Quiero saberlo antes de pedir nada.",
			"--pregunta",
			"--analisis",
			"sonnet@portatil-a",
		);
		bien(dataDir, "mover-tarea", "ana", "T-0001", "prepared");

		const documento = bien(dataDir, "ver-tarea", "T-0001");
		assert.match(documento, /^tipo: pregunta$/m);
		assert.doesNotMatch(documento, /^ejecucion:$/m);
		assert.match(
			bien(dataDir, "listar"),
			/^- T-0001 · prepared · pregunta · ¿Cuánto se tarda hoy en cerrar el mes\? · analisis: sonnet@portatil-a$/m,
		);

		// La respuesta la escribe el agente por el MCP: aquí con la función de
		// dominio, para ver que el CLI la enseña ya cerrada.
		const db = abrirBaseDeDatos(rutaBaseDeDatos(dataDir));
		try {
			tomarTarea(db, { tareaId: 1, fase: "analisis", terminalId: 1 });
			comentarAnalisis(db, { tareaId: 1, terminalId: 1, texto: "Entre tres y cuatro días." });
		} finally {
			db.close();
		}

		assert.match(bien(dataDir, "ver-tarea", "T-0001"), /^estado: done$/m);
		assert.match(bien(dataDir, "listar", "done"), /^- T-0001 · done · pregunta · /m);
	} finally {
		rmSync(dataDir, { recursive: true, force: true });
	}
});

test("un error de regla en el CLI sale con su código y termina en 1", () => {
	const dataDir = mkdtempSync(join(tmpdir(), "mcp-tareas-cli-"));
	try {
		bien(dataDir, "crear-usuario", "ana", "secreta");
		bien(dataDir, "crear-tarea", "ana", "Una", "d");

		// De backlog no se pasa a done: no es una de las cuatro transiciones.
		const salto = cli(dataDir, "mover-tarea", "ana", "T-0001", "done");
		assert.equal(salto.codigo, 1);
		assert.match(salto.salida, /^transicion_no_permitida: /m);

		// Volver atrás sin nota tampoco.
		bien(dataDir, "mover-tarea", "ana", "T-0001", "prepared");
		const sinNota = cli(dataDir, "mover-tarea", "ana", "T-0001", "backlog");
		assert.equal(sinNota.codigo, 1);
		assert.match(sinNota.salida, /^nota_obligatoria: /m);

		// Un terminal que no existe se detecta antes de escribir nada.
		const fantasma = cli(dataDir, "crear-tarea", "ana", "Otra", "d", "--analisis", "sonnet@fantasma");
		assert.equal(fantasma.codigo, 1);
		assert.match(fantasma.salida, /^no existe el terminal fantasma$/m);
	} finally {
		rmSync(dataDir, { recursive: true, force: true });
	}
});

test("el CLI contesta una pregunta por el texto de la opción y aprueba el análisis", () => {
	const dataDir = mkdtempSync(join(tmpdir(), "mcp-tareas-cli-"));
	try {
		bien(dataDir, "crear-usuario", "ana", "secreta");
		bien(dataDir, "crear-terminal", "ana", "portatil-a", "ana@ejemplo.com");
		bien(dataDir, "crear-tarea", "ana", "Una", "d", "--analisis", "sonnet@portatil-a", "--sin-autoejecucion");
		bien(dataDir, "mover-tarea", "ana", "T-0001", "prepared");

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
		const contestada = bien(dataDir, "responder", "ana", "T-0001", "P1", "Punto y coma", "ya lo cambiaremos");
		assert.match(contestada, /^contestada: T-0001 · P1 · Punto y coma$/m);

		const documento = bien(dataDir, "ver-tarea", "T-0001");
		assert.match(documento, /^### respuesta · humano:ana · .+ · P1$/m);
		assert.match(documento, /^Opción: \*\*Punto y coma\*\*$/m);
		assert.match(documento, /^Nota: ya lo cambiaremos$/m);

		// Sin autoejecución la tarea espera aprobación: la marca lo dice.
		assert.match(bien(dataDir, "listar"), / · análisis listo · /);
		assert.match(bien(dataDir, "aprobar", "ana", "T-0001"), /^aprobada: T-0001$/m);
		assert.doesNotMatch(bien(dataDir, "listar"), /análisis listo/);

		// Una pregunta ya contestada no se vuelve a contestar.
		const otraVez = cli(dataDir, "responder", "ana", "T-0001", "P1", "No hacer nada");
		assert.equal(otraVez.codigo, 1);
		assert.match(otraVez.salida, /^pregunta_ya_respondida: /m);
	} finally {
		rmSync(dataDir, { recursive: true, force: true });
	}
});

test("el CLI crea una funcionalidad con rama y dependencias, la aprueba y borra en backlog", () => {
	const dataDir = mkdtempSync(join(tmpdir(), "mcp-tareas-cli-"));
	try {
		bien(dataDir, "crear-usuario", "ana", "secreta");
		bien(dataDir, "crear-terminal", "ana", "portatil-a", "ana@ejemplo.com");
		bien(
			dataDir,
			"crear-tarea",
			"ana",
			"Que los comerciales se bajen sus listados",
			"Hoy copian los datos a mano.",
			"--funcionalidad",
			"--rama",
			"evolutivo/csv",
			"--analisis",
			"sonnet@portatil-a",
			"--ejecucion",
			"opus@portatil-a",
		);
		const documento = bien(dataDir, "ver-tarea", "T-0001");
		assert.match(documento, /^tipo: funcionalidad$/m);
		assert.match(documento, /^rama: evolutivo\/csv$/m);
		// Una funcionalidad no lleva bloque de ejecución, aunque sus partes lo hereden.
		assert.doesNotMatch(documento, /^ejecucion:$/m);
		assert.match(bien(dataDir, "listar"), /^- T-0001 · backlog · funcionalidad 0\/0 · /m);

		// Dependencias y padre desde la línea de comandos.
		bien(dataDir, "crear-tarea", "ana", "Primera", "d");
		bien(dataDir, "crear-tarea", "ana", "Segunda", "d", "--depende-de", "T-0002");
		assert.match(bien(dataDir, "ver-tarea", "T-0003"), /^dependeDe: \[T-0002\]$/m);
		bien(dataDir, "crear-tarea", "ana", "Una parte a mano", "d", "--padre", "T-0001");
		assert.match(bien(dataDir, "ver-tarea", "T-0004"), /^padre: T-0001$/m);

		// Solo una funcionalidad puede ser padre.
		const padreMalo = cli(dataDir, "crear-tarea", "ana", "Otra", "d", "--padre", "T-0002");
		assert.equal(padreMalo.codigo, 1);
		assert.match(padreMalo.salida, /^padre_no_es_funcionalidad: /m);

		// Borrar: lo que permite podar la descomposición.
		assert.match(bien(dataDir, "borrar-tarea", "ana", "T-0004"), /^borrada: T-0004 · Una parte a mano$/m);
		assert.doesNotMatch(bien(dataDir, "listar"), /Una parte a mano/);

		// Fuera de backlog también se borra; lo que frena es tener hijas.
		bien(dataDir, "mover-tarea", "ana", "T-0002", "prepared");
		assert.match(bien(dataDir, "borrar-tarea", "ana", "T-0002"), /^borrada: T-0002 · Primera$/m);

		bien(dataDir, "mover-tarea", "ana", "T-0001", "prepared");

		// La descomposición la hace el agente por el MCP: aquí con las funciones
		// de dominio, para probar solo la aprobación del humano.
		const db = abrirBaseDeDatos(rutaBaseDeDatos(dataDir));
		try {
			tomarTarea(db, { tareaId: 1, fase: "analisis", terminalId: 1 });
			crearParte(db, { titulo: "Sacar los datos", descripcion: "d", padreId: 1, terminalId: 1 });
			comentarAnalisis(db, { tareaId: 1, terminalId: 1, texto: "una parte" });
		} finally {
			db.close();
		}

		assert.match(bien(dataDir, "listar"), /^- T-0001 · prepared · funcionalidad 0\/1 · análisis listo · /m);
		assert.match(bien(dataDir, "aprobar", "ana", "T-0001"), /^aprobada: T-0001$/m);
		const tras = bien(dataDir, "listar");
		// La parte sale del backlog, y con ella la de integrar la rama, que ya
		// cuenta en el progreso de la funcionalidad. Los identificadores empiezan
		// en T-0005: el T-0004 se borró y ese número no se vuelve a repartir.
		assert.match(tras, /^- T-0001 · doing · funcionalidad 0\/2 · /m);
		assert.match(tras, /^- T-0005 · prepared · Sacar los datos · .+ · padre: T-0001$/m);
		assert.match(tras, /^- T-0006 · prepared · esperando · Integrar la rama `evolutivo\/csv` en la principal · /m);
	} finally {
		rmSync(dataDir, { recursive: true, force: true });
	}
});
