import { hashPassword } from "./auth/passwords.ts";
import { crearTerminalConToken } from "./auth/tokens.ts";
import { leerConfigDatos } from "./config.ts";
import { abrirBaseDeDatos, rutaBaseDeDatos } from "./db/abrir.ts";
import { buscarUsuarioPorNombre, crearUsuario } from "./db/consultas.ts";

const AYUDA = `Uso: node src/cli.ts <comando>

  crear-usuario <nombre> [contraseña]
      Crea un usuario. Si no se pasa la contraseña se lee de ADMIN_PASSWORD.

  crear-terminal <usuario> <nombre> <cuenta>
      Crea un terminal del usuario y escribe su token. El token se imprime
      una sola vez: la base de datos solo guarda su hash.

La base de datos se busca en DATA_DIR (por defecto /data).`;

function fallar(mensaje: string): never {
	console.error(mensaje);
	process.exit(1);
}

function comandoCrearUsuario(argumentos: string[]): void {
	const nombre = argumentos[0];
	if (nombre === undefined) {
		fallar("falta el nombre del usuario");
	}
	const password = argumentos[1] ?? process.env.ADMIN_PASSWORD;
	if (password === undefined || password.length === 0) {
		fallar("falta la contraseña: pásala como argumento o en ADMIN_PASSWORD");
	}

	const db = abrirBaseDeDatos(rutaBaseDeDatos(leerConfigDatos().DATA_DIR));
	try {
		if (buscarUsuarioPorNombre(db, nombre) !== undefined) {
			fallar(`ya existe un usuario llamado ${nombre}`);
		}
		const { valor: usuario, revision } = crearUsuario(db, nombre, hashPassword(password));
		console.log(`usuario creado: ${usuario.nombre} (id ${usuario.id})`);
		console.log(`revision: ${revision}`);
	} finally {
		db.close();
	}
}

function comandoCrearTerminal(argumentos: string[]): void {
	const usuario = argumentos[0];
	const nombre = argumentos[1];
	const cuenta = argumentos[2];
	if (usuario === undefined || nombre === undefined || cuenta === undefined) {
		fallar("uso: crear-terminal <usuario> <nombre> <cuenta>");
	}

	const db = abrirBaseDeDatos(rutaBaseDeDatos(leerConfigDatos().DATA_DIR));
	try {
		const dueno = buscarUsuarioPorNombre(db, usuario);
		if (dueno === undefined) {
			fallar(`no existe el usuario ${usuario}`);
		}
		const { valor, revision } = crearTerminalConToken(db, dueno.id, nombre, cuenta);
		console.log(`terminal creado: ${valor.terminal.nombre} (id ${valor.terminal.id})`);
		console.log(`cuenta: ${valor.terminal.cuenta}`);
		console.log(`revision: ${revision}`);
		console.log("");
		console.log("token (no se vuelve a mostrar):");
		console.log(valor.token);
	} finally {
		db.close();
	}
}

function principal(argv: string[]): void {
	const [comando, ...argumentos] = argv;
	switch (comando) {
		case "crear-usuario":
			comandoCrearUsuario(argumentos);
			break;
		case "crear-terminal":
			comandoCrearTerminal(argumentos);
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

principal(process.argv.slice(2));
