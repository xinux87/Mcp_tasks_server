import * as z from "zod";
import { sinBarraFinal } from "./direcciones.ts";

/**
 * `DIRECCIONES`: URLs base separadas por comas por las que también se llega al
 * servidor. Se admiten en la cabecera `Host` y salen en el tutorial de
 * conexión. Cada una tiene que ser absoluta, y la barra final sobra.
 */
const listaDeDirecciones = z
	.string()
	.transform((valor) =>
		valor
			.split(",")
			.map((trozo) => trozo.trim())
			.filter((trozo) => trozo !== ""),
	)
	.pipe(z.array(z.url({ error: "cada dirección de DIRECCIONES tiene que ser una URL absoluta" })))
	.transform((direcciones) => direcciones.map(sinBarraFinal));

/**
 * Variables de entorno del servidor. La tabla de referencia está en
 * CLAUDE.md, sección «Variables de entorno del servidor».
 *
 * `ADMIN_PASSWORD` es opcional aquí porque solo es obligatoria cuando la base
 * de datos no tiene todavía ningún usuario. Esa comprobación se hace en
 * `main.ts`, una vez abierta la base de datos.
 */
const esquemaConfig = z.object({
	PORT: z.coerce.number().int().min(1).max(65535).default(3000),
	DATA_DIR: z.string().min(1).default("/data"),
	BASE_URL: z.url({ error: "BASE_URL es obligatoria y tiene que ser una URL absoluta" }),
	SESSION_SECRET: z.string().min(1, { error: "SESSION_SECRET es obligatoria" }),
	ADMIN_PASSWORD: z.string().min(1).optional(),
	DIRECCIONES: listaDeDirecciones.optional(),
	AVISOS_URL: z.url({ error: "AVISOS_URL tiene que ser una URL absoluta" }).optional(),
});

export type Config = z.infer<typeof esquemaConfig>;

/** Solo lo que necesita el CLI: dónde vive la base de datos. */
const esquemaConfigDatos = esquemaConfig.pick({ DATA_DIR: true });

export type ConfigDatos = z.infer<typeof esquemaConfigDatos>;

/** Host al que se ata el proceso. Fijo, para que la imagen Docker sea accesible. */
export const HOST_ESCUCHA = "0.0.0.0";

function formatearError(error: z.ZodError): string {
	return error.issues.map((problema) => `${problema.path.join(".") || "(raíz)"}: ${problema.message}`).join("\n");
}

/** Lee y valida la configuración completa. Lanza con un mensaje legible si falta algo. */
export function leerConfig(entorno: NodeJS.ProcessEnv = process.env): Config {
	const resultado = esquemaConfig.safeParse(entorno);
	if (!resultado.success) {
		throw new Error(`configuración inválida:\n${formatearError(resultado.error)}`);
	}
	return resultado.data;
}

/** Lee solo `DATA_DIR`. El CLI no necesita BASE_URL ni SESSION_SECRET. */
export function leerConfigDatos(entorno: NodeJS.ProcessEnv = process.env): ConfigDatos {
	const resultado = esquemaConfigDatos.safeParse(entorno);
	if (!resultado.success) {
		throw new Error(`configuración inválida:\n${formatearError(resultado.error)}`);
	}
	return resultado.data;
}
