import type { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./auth/passwords.ts";
import { crearTerminalConToken } from "./auth/tokens.ts";
import { leerConfigDatos } from "./config.ts";
import { abrirBaseDeDatos, rutaBaseDeDatos } from "./db/abrir.ts";
import type { Actor } from "./db/actividad.ts";
import { buscarTerminalPorNombre, buscarUsuarioPorNombre, crearUsuario, type Usuario } from "./db/consultas.ts";
import { preguntasDeTarea, responder } from "./db/hilo.ts";
import { crearProyecto, exigirProyectoPorClave } from "./db/proyectos.ts";
import {
	aprobarEjecucion,
	borrarTarea,
	crearTareaHumana,
	esEstado,
	idDeCodigo,
	leerTarea,
	listarTareas,
	moverTareaHumano,
	type TipoTarea,
} from "./db/tareas.ts";
import { esErrorDeRegla } from "./errores.ts";
import { documentoTarea } from "./md/documento.ts";
import { formatearId, parsearId } from "./md/ids.ts";
import { lineaIndice } from "./md/indice.ts";

const AYUDA = `Uso: node src/cli.ts <comando>

  crear-usuario <nombre> [contraseña]
      Crea un usuario. Si no se pasa la contraseña se lee de ADMIN_PASSWORD.

  crear-proyecto <clave> <nombre>
      Crea un proyecto. La clave son de dos a ocho caracteres, mayúsculas y
      cifras, empezando por letra; se fija al crearlo y no se cambia.

  crear-terminal <usuario> <nombre> <cuenta> [clave]
      Crea un terminal del usuario y escribe su token. El token se imprime
      una sola vez: la base de datos solo guarda su hash. La clave es la del
      proyecto para el que trabaja; sin ella, DEFAULT.

  crear-tarea <usuario> <titulo> <descripcion>
              [--analisis <modelo>[@<terminal>]] [--ejecucion <modelo>[@<terminal>]]
              [--sin-autoejecucion] [--pregunta] [--funcionalidad]
              [--rama <rama>] [--padre <T-K7M3XQ>] [--depende-de <T-K7M3XQ,T-0043>]
      Crea una tarea en backlog a nombre del usuario, con sus asignaciones.
      Con --pregunta la tarea solo tiene fase de análisis: ese comentario es la
      respuesta y cierra la tarea. La asignación de ejecución se ignora.
      Con --funcionalidad la tarea es un evolutivo: su análisis la descompone en
      partes y el humano las aprueba. --rama es la rama de git en la que se
      trabaja, que sus partes heredan. --padre solo admite una funcionalidad.

  borrar-tarea <usuario> <id>
      Borra una tarea, esté en la columna que esté, con su hilo. Una tarea con
      hijas no se borra: primero se borran ellas.

  mover-tarea <usuario> <id> <estado> [nota]
      Mueve la tarea de columna. Las vueltas atrás exigen nota.

  aprobar <usuario> <id>
      Da por bueno el análisis de una tarea sin autoejecución.

  responder <usuario> <id> <P1> <opción> [nota]
      Contesta una pregunta de la tarea. La opción se pasa por su texto.

  ver-tarea <id>
      Imprime el documento Markdown completo de la tarea.

  listar [estado]
      Imprime el índice del tablero, una línea por tarea.

La base de datos se busca en DATA_DIR (por defecto /data).`;

/**
 * Quién firma la actividad de los comandos que no van a nombre de nadie. El
 * resto de comandos exigen un usuario y firman con él.
 */
const ACTOR_CLI: Actor = { nombre: "cli" };

function fallar(mensaje: string): never {
	console.error(mensaje);
	process.exit(1);
}

/** Abre la base de datos, hace el trabajo y la cierra pase lo que pase. */
function conBaseDeDatos<T>(fn: (db: DatabaseSync) => T): T {
	const db = abrirBaseDeDatos(rutaBaseDeDatos(leerConfigDatos().DATA_DIR));
	try {
		return fn(db);
	} finally {
		db.close();
	}
}

/** Todos los comandos del humano van a nombre de un usuario, que tiene que existir. */
function exigirUsuario(db: DatabaseSync, nombre: string): Usuario {
	const usuario = buscarUsuarioPorNombre(db, nombre);
	if (usuario === undefined) {
		fallar(`no existe el usuario ${nombre}`);
	}
	return usuario;
}

// --- argumentos --------------------------------------------------------------

type Argumentos = {
	posicionales: string[];
	analisis?: string;
	ejecucion?: string;
	rama?: string;
	padre?: string;
	dependeDe?: string;
	sinAutoejecucion: boolean;
	pregunta: boolean;
	funcionalidad: boolean;
};

/** Las opciones que llevan un valor detrás, y dónde se guarda cada una. */
const CON_VALOR: Record<string, keyof Pick<Argumentos, "analisis" | "ejecucion" | "rama" | "padre" | "dependeDe">> = {
	"--analisis": "analisis",
	"--ejecucion": "ejecucion",
	"--rama": "rama",
	"--padre": "padre",
	"--depende-de": "dependeDe",
};

/** Separa las opciones con guiones de los argumentos posicionales. */
function partir(argumentos: string[]): Argumentos {
	const partido: Argumentos = {
		posicionales: [],
		sinAutoejecucion: false,
		pregunta: false,
		funcionalidad: false,
	};
	for (let indice = 0; indice < argumentos.length; indice += 1) {
		const argumento = argumentos[indice];
		if (argumento === undefined) {
			continue;
		}
		if (argumento === "--sin-autoejecucion") {
			partido.sinAutoejecucion = true;
			continue;
		}
		if (argumento === "--pregunta") {
			partido.pregunta = true;
			continue;
		}
		if (argumento === "--funcionalidad") {
			partido.funcionalidad = true;
			continue;
		}
		const clave = CON_VALOR[argumento];
		if (clave !== undefined) {
			const valor = argumentos[indice + 1];
			if (valor === undefined) {
				fallar(`${argumento} necesita un valor`);
			}
			partido[clave] = valor;
			indice += 1;
			continue;
		}
		if (argumento.startsWith("--")) {
			fallar(`opción desconocida: ${argumento}`);
		}
		partido.posicionales.push(argumento);
	}
	return partido;
}

type Asignacion = { modelo: string | null; terminalId: number | null };

/**
 * La fase que no se asigna. En una pregunta la ejecución no existe: lo que
 * venga en `--ejecucion` se ignora en vez de guardarse para no usarse nunca.
 * En una funcionalidad sí se guarda, porque sus partes la heredan.
 */
const EJECUCION_VACIA: Asignacion = { modelo: null, terminalId: null };

/** El tipo que sale de las opciones. Sin ninguna, la tarea de siempre. */
function tipoElegido(partido: Argumentos): TipoTarea {
	if (partido.pregunta) {
		return "pregunta";
	}
	return partido.funcionalidad ? "funcionalidad" : "tarea";
}

/** Lee `T-0041,T-K7M3XQ` y devuelve los números de fila. Vacío si no se pasó nada. */
function listaDeIds(db: DatabaseSync, valor: string | undefined): number[] {
	if (valor === undefined) {
		return [];
	}
	return valor
		.split(",")
		.map((trozo) => trozo.trim())
		.filter((trozo) => trozo !== "")
		.map((trozo) => idDeCodigo(db, parsearId(trozo)));
}

/** Lee `<modelo>[@<terminal>]`. El terminal se busca por nombre y tiene que existir. */
function asignacion(db: DatabaseSync, valor: string | undefined): Asignacion {
	if (valor === undefined) {
		return { modelo: null, terminalId: null };
	}
	const arroba = valor.indexOf("@");
	if (arroba < 0) {
		return { modelo: valor, terminalId: null };
	}
	const nombre = valor.slice(arroba + 1);
	const terminal = buscarTerminalPorNombre(db, nombre);
	if (terminal === undefined) {
		fallar(`no existe el terminal ${nombre}`);
	}
	const modelo = valor.slice(0, arroba);
	return { modelo: modelo === "" ? null : modelo, terminalId: terminal.id };
}

// --- comandos ----------------------------------------------------------------

function comandoCrearUsuario(argumentos: string[]): void {
	const nombre = argumentos[0];
	if (nombre === undefined) {
		fallar("falta el nombre del usuario");
	}
	const password = argumentos[1] ?? process.env.ADMIN_PASSWORD;
	if (password === undefined || password.length === 0) {
		fallar("falta la contraseña: pásala como argumento o en ADMIN_PASSWORD");
	}

	conBaseDeDatos((db) => {
		if (buscarUsuarioPorNombre(db, nombre) !== undefined) {
			fallar(`ya existe un usuario llamado ${nombre}`);
		}
		// El CLI no tiene sesión: firma la actividad con su propio nombre.
		const { valor: usuario, revision } = crearUsuario(db, nombre, hashPassword(password), { actor: ACTOR_CLI });
		console.log(`usuario creado: ${usuario.nombre} (id ${usuario.id})`);
		console.log(`revision: ${revision}`);
	});
}

function comandoCrearProyecto(argumentos: string[]): void {
	const [clave, nombre] = argumentos;
	if (clave === undefined || nombre === undefined) {
		fallar("uso: crear-proyecto <clave> <nombre>");
	}

	conBaseDeDatos((db) => {
		const proyecto = crearProyecto(db, { clave, nombre, actor: ACTOR_CLI });
		console.log(`proyecto creado: ${proyecto.clave} · ${proyecto.nombre} (id ${proyecto.id})`);
	});
}

function comandoCrearTerminal(argumentos: string[]): void {
	const usuario = argumentos[0];
	const nombre = argumentos[1];
	const cuenta = argumentos[2];
	const clave = argumentos[3];
	if (usuario === undefined || nombre === undefined || cuenta === undefined) {
		fallar("uso: crear-terminal <usuario> <nombre> <cuenta> [clave]");
	}

	conBaseDeDatos((db) => {
		const dueno = exigirUsuario(db, usuario);
		const proyecto = clave === undefined ? undefined : exigirProyectoPorClave(db, clave);
		const { valor, revision } = crearTerminalConToken(db, dueno.id, nombre, cuenta, ACTOR_CLI, undefined, proyecto?.id);
		console.log(`terminal creado: ${valor.terminal.nombre} (id ${valor.terminal.id})`);
		console.log(`cuenta: ${valor.terminal.cuenta}`);
		console.log(`proyecto: ${proyecto?.clave ?? "DEFAULT"}`);
		console.log(`revision: ${revision}`);
		console.log("");
		console.log("token (no se vuelve a mostrar):");
		console.log(valor.token);
	});
}

function comandoCrearTarea(argumentos: string[]): void {
	const partido = partir(argumentos);
	const [usuario, titulo, descripcion] = partido.posicionales;
	if (usuario === undefined || titulo === undefined || descripcion === undefined) {
		fallar("uso: crear-tarea <usuario> <titulo> <descripcion> [--analisis m[@t]] [--ejecucion m[@t]] [--pregunta]");
	}
	if (partido.pregunta && partido.funcionalidad) {
		fallar("--pregunta y --funcionalidad son excluyentes: una tarea es de un tipo o de otro");
	}

	conBaseDeDatos((db) => {
		const dueno = exigirUsuario(db, usuario);
		const analisis = asignacion(db, partido.analisis);
		const ejecucion = partido.pregunta ? EJECUCION_VACIA : asignacion(db, partido.ejecucion);
		const tarea = crearTareaHumana(db, {
			titulo,
			descripcion,
			usuarioId: dueno.id,
			tipo: tipoElegido(partido),
			rama: partido.rama ?? null,
			padreId: partido.padre === undefined ? null : idDeCodigo(db, parsearId(partido.padre)),
			dependeDe: listaDeIds(db, partido.dependeDe),
			autoejecucion: !partido.sinAutoejecucion,
			analisisModelo: analisis.modelo,
			analisisTerminalId: analisis.terminalId,
			ejecucionModelo: ejecucion.modelo,
			ejecucionTerminalId: ejecucion.terminalId,
		});
		console.log(`creada: ${formatearId(tarea.codigo)}`);
	});
}

function comandoMoverTarea(argumentos: string[]): void {
	const [usuario, id, estado, nota] = argumentos;
	if (usuario === undefined || id === undefined || estado === undefined) {
		fallar("uso: mover-tarea <usuario> <id> <estado> [nota]");
	}
	if (!esEstado(estado)) {
		fallar(`estado desconocido: ${estado}`);
	}

	conBaseDeDatos((db) => {
		const dueno = exigirUsuario(db, usuario);
		const tarea = moverTareaHumano(db, { tareaId: idDeCodigo(db, parsearId(id)), usuarioId: dueno.id, estado, nota });
		console.log(`movida: ${formatearId(tarea.codigo)} · ${tarea.estado}`);
	});
}

function comandoBorrarTarea(argumentos: string[]): void {
	const [usuario, id] = argumentos;
	if (usuario === undefined || id === undefined) {
		fallar("uso: borrar-tarea <usuario> <id>");
	}

	conBaseDeDatos((db) => {
		const dueno = exigirUsuario(db, usuario);
		const tarea = borrarTarea(db, { tareaId: idDeCodigo(db, parsearId(id)), actor: { usuarioId: dueno.id } });
		console.log(`borrada: ${formatearId(tarea.codigo)} · ${tarea.titulo}`);
	});
}

function comandoAprobar(argumentos: string[]): void {
	const [usuario, id] = argumentos;
	if (usuario === undefined || id === undefined) {
		fallar("uso: aprobar <usuario> <id>");
	}

	conBaseDeDatos((db) => {
		const dueno = exigirUsuario(db, usuario);
		const tarea = aprobarEjecucion(db, { tareaId: idDeCodigo(db, parsearId(id)), usuarioId: dueno.id });
		console.log(`aprobada: ${formatearId(tarea.codigo)}`);
	});
}

/** Lee `P1` y devuelve el 1. El humano ve el número, no el id de la fila. */
function numeroDePregunta(valor: string): number {
	const encaje = /^P(\d+)$/.exec(valor);
	const cifras = encaje?.[1];
	if (cifras === undefined) {
		fallar(`«${valor}» no es un número de pregunta; tiene la forma P1`);
	}
	return Number.parseInt(cifras, 10);
}

function comandoResponder(argumentos: string[]): void {
	const [usuario, id, etiqueta, opcion, nota] = argumentos;
	if (usuario === undefined || id === undefined || etiqueta === undefined || opcion === undefined) {
		fallar("uso: responder <usuario> <id> <P1> <opción> [nota]");
	}
	const numero = numeroDePregunta(etiqueta);

	conBaseDeDatos((db) => {
		const dueno = exigirUsuario(db, usuario);
		const codigo = parsearId(id);
		const tareaId = idDeCodigo(db, codigo);
		const pregunta = preguntasDeTarea(db, tareaId).find((candidata) => candidata.numero === numero);
		if (pregunta === undefined) {
			fallar(`la tarea ${id} no tiene ninguna pregunta ${etiqueta}`);
		}
		responder(db, { preguntaId: pregunta.id, usuarioId: dueno.id, opcion, nota });
		console.log(`contestada: ${formatearId(codigo)} · ${etiqueta} · ${opcion}`);
	});
}

function comandoVerTarea(argumentos: string[]): void {
	const id = argumentos[0];
	if (id === undefined) {
		fallar("uso: ver-tarea <id>");
	}

	conBaseDeDatos((db) => {
		const completa = leerTarea(db, idDeCodigo(db, parsearId(id)));
		if (completa === undefined) {
			fallar(`no existe la tarea ${id}`);
		}
		console.log(documentoTarea(completa));
	});
}

function comandoListar(argumentos: string[]): void {
	const estado = argumentos[0];
	if (estado !== undefined && !esEstado(estado)) {
		fallar(`estado desconocido: ${estado}`);
	}

	conBaseDeDatos((db) => {
		const lineas = listarTareas(db, { estado }).map(lineaIndice);
		console.log(lineas.length === 0 ? "Ninguna." : lineas.join("\n"));
	});
}

function principal(argv: string[]): void {
	const [comando, ...argumentos] = argv;
	switch (comando) {
		case "crear-usuario":
			comandoCrearUsuario(argumentos);
			break;
		case "crear-proyecto":
			comandoCrearProyecto(argumentos);
			break;
		case "crear-terminal":
			comandoCrearTerminal(argumentos);
			break;
		case "crear-tarea":
			comandoCrearTarea(argumentos);
			break;
		case "mover-tarea":
			comandoMoverTarea(argumentos);
			break;
		case "borrar-tarea":
			comandoBorrarTarea(argumentos);
			break;
		case "aprobar":
			comandoAprobar(argumentos);
			break;
		case "responder":
			comandoResponder(argumentos);
			break;
		case "ver-tarea":
			comandoVerTarea(argumentos);
			break;
		case "listar":
			comandoListar(argumentos);
			break;
		case undefined:
		case "-h":
		case "--help":
		case "ayuda":
			console.log(AYUDA);
			break;
		default:
			console.error(`comando desconocido: ${comando}`);
			console.error("");
			console.error(AYUDA);
			process.exit(1);
	}
}

try {
	principal(process.argv.slice(2));
} catch (error) {
	// Un error de regla es algo que el humano ha pedido y no se puede hacer: se
	// enseña tal cual, con su código, igual que lo ve un agente por el MCP.
	if (esErrorDeRegla(error)) {
		fallar(`${error.codigo}: ${error.message}`);
	}
	throw error;
}
