import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { revisionActual } from "../../db/consultas.ts";
import type { DependenciasWeb } from "../sesion.ts";

/** Cada cuánto se consulta la revisión en la base de datos. */
const INTERVALO_MS = 1000;

/** Vueltas seguidas sin cambios tras las que se manda un comentario de vida. */
const VUELTAS_LATIDO = 25;

/**
 * Espera que se corta sola cuando el cliente se desconecta. Sin esto, cada
 * conexión cerrada dejaría vivo un temporizador de hasta un segundo.
 */
function esperar(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) {
		return Promise.resolve();
	}
	return new Promise((resolver) => {
		let temporizador: ReturnType<typeof setTimeout> | undefined;
		const terminar = (): void => {
			if (temporizador !== undefined) {
				clearTimeout(temporizador);
			}
			signal.removeEventListener("abort", terminar);
			resolver();
		};
		temporizador = setTimeout(terminar, ms);
		signal.addEventListener("abort", terminar);
	});
}

/**
 * `GET /eventos`: la misma señal de novedad que usan los agentes, servida a
 * la web. El endpoint consulta la revisión en la base de datos cada segundo y
 * emite solo cuando cambia; no hay bus de eventos en memoria, así que funciona
 * igual con varios procesos. Exige sesión, como el resto de la web.
 */
export function registrarRutasEventos(app: Hono, deps: DependenciasWeb): void {
	app.get("/eventos", (c) => {
		const aborto = c.req.raw.signal;
		return streamSSE(c, async (stream) => {
			let ultima = revisionActual(deps.db);
			await stream.writeSSE({ event: "revision", data: String(ultima) });

			let silencio = 0;
			while (!aborto.aborted && !stream.aborted && !stream.closed) {
				await esperar(INTERVALO_MS, aborto);
				if (aborto.aborted || stream.aborted || stream.closed) {
					return;
				}
				try {
					const revision = revisionActual(deps.db);
					if (revision !== ultima) {
						ultima = revision;
						silencio = 0;
						await stream.writeSSE({ event: "revision", data: String(revision) });
						continue;
					}
					silencio += 1;
					if (silencio >= VUELTAS_LATIDO) {
						silencio = 0;
						// Comentario SSE: mantiene viva la conexión sin ser un evento.
						await stream.write(": keepalive\n\n");
					}
				} catch {
					// El cliente se fue o la base se cerró: se acaba el flujo.
					return;
				}
			}
		});
	});
}
