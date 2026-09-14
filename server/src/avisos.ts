import { sinBarraFinal } from "./direcciones.ts";
import { formatearId } from "./md/ids.ts";

/**
 * Avisos fuera de la web: un POST de texto llano a `AVISOS_URL` por cada cosa
 * que un agente deja esperando al humano. Dos líneas, la frase y el enlace a la
 * ficha; es lo que ntfy acepta tal cual y cualquier otro receptor lee como
 * texto. Ver «Avisos fuera de la web» en CLAUDE.md.
 *
 * Lo llama la herramienta MCP que provocó el cambio, después de que la
 * transacción haya confirmado: `src/db/` no sabe de HTTP y un receptor caído no
 * puede tumbar una escritura.
 */

export type TipoAviso = "pregunta" | "hecha" | "analisis_listo" | "descomposicion_lista";

export type Evento = {
	tipo: TipoAviso;
	tareaId: number;
	titulo: string;
	/** Solo en `pregunta`: es lo que se entrecomilla, en vez del título. */
	pregunta?: string;
};

/** La frase de cada aviso, tal como sale en la primera línea. */
const FRASES: Record<TipoAviso, string> = {
	pregunta: "pregunta",
	hecha: "hecha",
	analisis_listo: "análisis listo",
	descomposicion_lista: "descomposición lista",
};

/** Quien hace el POST. Los tests pasan una que apunta lo que le llega. */
export type Enviar = (url: string, texto: string) => Promise<unknown>;

export type Avisador = (evento: Evento) => void;

export type OpcionesAvisador = {
	/** Sin ella no se envía nada y no se avisa de ello. */
	url?: string;
	/** De aquí sale el enlace a la ficha. */
	baseUrl: string;
	enviar?: Enviar;
};

/** El texto del aviso: la frase y, debajo, el enlace a la ficha. */
export function textoDeAviso(evento: Evento, baseUrl: string): string {
	const id = formatearId(evento.tareaId);
	const asunto = evento.tipo === "pregunta" ? (evento.pregunta ?? evento.titulo) : evento.titulo;
	return `${id} ${FRASES[evento.tipo]}: «${asunto}»\n${sinBarraFinal(baseUrl)}/tareas/${id}`;
}

/** El POST de verdad: texto llano y cinco segundos de espera como mucho. */
async function enviarPorHttp(url: string, texto: string): Promise<void> {
	const respuesta = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "text/plain; charset=utf-8" },
		body: texto,
		signal: AbortSignal.timeout(5000),
	});
	if (!respuesta.ok) {
		throw new Error(`respondió ${respuesta.status}`);
	}
}

/**
 * Devuelve la función que avisa. Nunca lanza y nunca se espera: con fallo o
 * tiempo de espera escribe una línea en stderr y sigue. Sin `url` no hace nada
 * y no crea ninguna promesa.
 */
export function crearAvisador({ url, baseUrl, enviar = enviarPorHttp }: OpcionesAvisador): Avisador {
	if (url === undefined || url === "") {
		return () => undefined;
	}
	return (evento) => {
		// El `then` recoge también lo que `enviar` lance de forma síncrona.
		void Promise.resolve()
			.then(() => enviar(url, textoDeAviso(evento, baseUrl)))
			.catch((error: unknown) => {
				console.error(`aviso no enviado a ${url}: ${error instanceof Error ? error.message : String(error)}`);
			});
	};
}
