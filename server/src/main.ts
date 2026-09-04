import type { DatabaseSync } from "node:sqlite";
import { serve } from "@hono/node-server";
import { crearApp } from "./app.ts";
import { hashPassword } from "./auth/passwords.ts";
import { type Config, HOST_ESCUCHA, leerConfig } from "./config.ts";
import { abrirBaseDeDatos, rutaBaseDeDatos } from "./db/abrir.ts";
import { contarUsuarios, crearUsuario } from "./db/consultas.ts";

/** Nombre del usuario que se crea en el primer arranque. */
export const USUARIO_INICIAL = "admin";

/**
 * Crea el primer usuario si la base de datos está vacía. `ADMIN_PASSWORD` solo
 * es obligatoria en ese caso.
 */
export function asegurarPrimerUsuario(db: DatabaseSync, config: Config): void {
	if (contarUsuarios(db) > 0) {
		return;
	}
	if (config.ADMIN_PASSWORD === undefined) {
		throw new Error("no hay ningún usuario y falta ADMIN_PASSWORD para crear el primero");
	}
	// El primer usuario no lo crea nadie con sesión: lo firma el arranque.
	crearUsuario(db, USUARIO_INICIAL, hashPassword(config.ADMIN_PASSWORD), { actor: { nombre: "arranque" } });
	console.log(`usuario inicial creado: ${USUARIO_INICIAL}`);
}

function arrancar(): void {
	const config = leerConfig();
	const ruta = rutaBaseDeDatos(config.DATA_DIR);
	const db = abrirBaseDeDatos(ruta);
	asegurarPrimerUsuario(db, config);

	const { app, cerrar } = crearApp({ db, config });
	const servidor = serve({ fetch: app.fetch, port: config.PORT, hostname: HOST_ESCUCHA }, (info) => {
		console.log(`servidor escuchando en http://${HOST_ESCUCHA}:${info.port} (base: ${config.BASE_URL})`);
		console.log(`base de datos: ${ruta}`);
	});

	let cerrando = false;
	const apagar = (senal: string): void => {
		if (cerrando) {
			return;
		}
		cerrando = true;
		console.log(`recibida ${senal}, cerrando`);
		servidor.close(() => {
			void cerrar().finally(() => {
				db.close();
				process.exit(0);
			});
		});
	};

	process.on("SIGINT", () => apagar("SIGINT"));
	process.on("SIGTERM", () => apagar("SIGTERM"));
}

arrancar();
