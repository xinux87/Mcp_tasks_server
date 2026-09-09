import { networkInterfaces } from "node:os";

/**
 * Por qué direcciones se llega a este servidor. Un terminal suele estar en
 * otra máquina de la misma red, así que el servidor tiene que saberlas para
 * admitirlas en la cabecera `Host` y para enseñarlas en el tutorial de
 * conexión. Ver «Direcciones del servidor y tutorial de conexión» en CLAUDE.md.
 *
 * Este módulo no importa nada de `config.ts` para que la configuración pueda
 * usar `sinBarraFinal` sin que los dos archivos se importen en círculo: lo que
 * necesita de la configuración va como tipo estructural.
 */

/** De dónde sale una dirección. El tutorial lo dice en cada fila de su tabla. */
export type OrigenDireccion = "base" | "configurada" | "detectada";

export type Direccion = {
	/** URL base, sin barra final. */
	url: string;
	origen: OrigenDireccion;
};

/**
 * Lo único que se mira de una interfaz de red. Es un tipo propio y no el de
 * `node:os` para que los tests puedan simular interfaces sin inventarse la
 * máscara, la mac y el cidr.
 */
export type InterfazDeRed = {
	address: string;
	family: string;
	internal: boolean;
};

/** Lo que devuelve `os.networkInterfaces()`: el nombre de cada interfaz y sus direcciones. */
export type InterfacesDeRed = Record<string, readonly InterfazDeRed[] | undefined>;

/** Lo que este módulo necesita de la configuración del servidor. */
export type ConfigDeDirecciones = {
	BASE_URL: string;
	PORT: number;
	DIRECCIONES?: readonly string[] | undefined;
};

/**
 * Hostnames que siempre valen, además de los de las direcciones conocidas: el
 * HEALTHCHECK de la imagen Docker llama a `http://127.0.0.1:3000/salud`.
 */
const LOCALES: readonly string[] = ["localhost", "127.0.0.1", "[::1]"];

/** `http://x:3000/` y `http://x:3000` son la misma dirección: se guarda sin barra. */
export function sinBarraFinal(url: string): string {
	return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** Un octeto de una IPv4: tres cifras como mucho y dentro de rango. */
function esOcteto(texto: string): boolean {
	if (!/^\d{1,3}$/.test(texto)) {
		return false;
	}
	return Number(texto) <= 255;
}

/**
 * Si una IPv4 está en los tres rangos privados: `10.0.0.0/8`, `172.16.0.0/12`
 * y `192.168.0.0/16`. Una dirección pública no se enseña como forma de llegar
 * al servidor: sería la de la red de salida, no la suya.
 */
export function esIpv4Privada(direccion: string): boolean {
	const partes = direccion.split(".");
	if (partes.length !== 4 || !partes.every(esOcteto)) {
		return false;
	}
	const [primero, segundo] = partes.map(Number);
	if (primero === undefined || segundo === undefined) {
		return false;
	}
	if (primero === 10) {
		return true;
	}
	if (primero === 172) {
		return segundo >= 16 && segundo <= 31;
	}
	return primero === 192 && segundo === 168;
}

/**
 * Las direcciones privadas del propio proceso, compuestas con el puerto de
 * escucha. Dentro de Docker son las del contenedor y no las del anfitrión: por
 * eso existe `DIRECCIONES`, y el tutorial lo advierte.
 */
export function direccionesDetectadas(puerto: number, interfaces: InterfacesDeRed = networkInterfaces()): string[] {
	const encontradas: string[] = [];
	for (const lista of Object.values(interfaces)) {
		for (const interfaz of lista ?? []) {
			if (interfaz.internal || interfaz.family !== "IPv4" || !esIpv4Privada(interfaz.address)) {
				continue;
			}
			encontradas.push(`http://${interfaz.address}:${puerto}`);
		}
	}
	return [...new Set(encontradas)];
}

/**
 * Todas las direcciones conocidas, sin repetir y en orden: primero la de
 * `BASE_URL`, después las de `DIRECCIONES` y, solo si esa variable no dice
 * nada, las que se detectan en la red.
 */
export function direccionesDelServidor(
	config: ConfigDeDirecciones,
	interfaces: InterfacesDeRed = networkInterfaces(),
): Direccion[] {
	const configuradas = config.DIRECCIONES ?? [];
	const lista: Direccion[] = [{ url: sinBarraFinal(config.BASE_URL), origen: "base" }];
	if (configuradas.length > 0) {
		for (const url of configuradas) {
			lista.push({ url: sinBarraFinal(url), origen: "configurada" });
		}
	} else {
		for (const url of direccionesDetectadas(config.PORT, interfaces)) {
			lista.push({ url, origen: "detectada" });
		}
	}
	const vistas = new Set<string>();
	return lista.filter((direccion) => {
		if (vistas.has(direccion.url)) {
			return false;
		}
		vistas.add(direccion.url);
		return true;
	});
}

/**
 * Hostnames aceptados en la cabecera `Host` (protección contra DNS rebinding):
 * el de cada dirección conocida, más los locales.
 *
 * Van sin puerto a propósito. El middleware del SDK compara solo el hostname:
 * lee la cabecera como `new URL('http://' + host).hostname` antes de buscarla
 * en esta lista, así que `Host: 192.168.1.10:3020` encaja con `192.168.1.10`.
 * Una IPv6 se escribe con corchetes, que es lo que devuelve ese `hostname`.
 */
export function hostsPermitidos(
	config: ConfigDeDirecciones,
	interfaces: InterfacesDeRed = networkInterfaces(),
): string[] {
	const nombres = direccionesDelServidor(config, interfaces).map((direccion) => new URL(direccion.url).hostname);
	return [...new Set([...nombres, ...LOCALES])];
}
