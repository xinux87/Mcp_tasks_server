import type { ConsumoDeTarea, ConsumoFase } from "../db/consumo.ts";
import type { Comentario } from "../db/hilo.ts";
import type { TareaCompleta } from "../db/tareas.ts";
import { formatearId } from "./ids.ts";

/**
 * El texto libre (descripción y cuerpo de los comentarios) se muestra tal como
 * lo escribieron. Lo único que se recorta son los saltos de línea de los
 * extremos, que no se ven y romperían la separación entre bloques.
 */
function libre(valor: string): string {
	return valor.replace(/^\n+|\n+$/g, "");
}

/** El bloque de una fase en el frontmatter: `~` cuando falta el dato. */
function faseFrontmatter(nombre: string, modelo: string | null, terminal: string | null): string[] {
	return [`${nombre}:`, `  modelo: ${modelo ?? "~"}`, `  terminal: ${terminal ?? "~"}`];
}

function faseConsumo(nombre: string, fase: ConsumoFase): string[] {
	return [
		`  ${nombre}:`,
		`    modelo: ${fase.modelo}`,
		`    tokens: ${fase.tokens}`,
		`    herramientas: ${fase.herramientas}`,
		`    duracionMs: ${fase.duracionMs}`,
	];
}

/** El bloque `consumo` solo aparece si se ha reportado algo, propio o de una hija. */
function consumoFrontmatter(consumo: ConsumoDeTarea): string[] {
	if (consumo.analisis === null && consumo.ejecucion === null && consumo.totalConHijas === 0) {
		return [];
	}
	const lineas = ["consumo:"];
	if (consumo.analisis !== null) {
		lineas.push(...faseConsumo("analisis", consumo.analisis));
	}
	if (consumo.ejecucion !== null) {
		lineas.push(...faseConsumo("ejecucion", consumo.ejecucion));
	}
	lineas.push("  totalConHijas:", `    tokens: ${consumo.totalConHijas}`);
	return lineas;
}

function frontmatter(completa: TareaCompleta): string {
	const { tarea } = completa;
	const lineas = ["---", `id: ${formatearId(tarea.id)}`];
	// El título va siempre entre comillas dobles: es texto del humano y puede
	// llevar dos puntos, comillas o almohadillas, que en YAML significan algo.
	lineas.push(`titulo: ${JSON.stringify(tarea.titulo)}`);
	lineas.push(`estado: ${tarea.estado}`);
	lineas.push(`orden: ${tarea.orden}`);
	if (tarea.padreId !== null) {
		lineas.push(`padre: ${formatearId(tarea.padreId)}`);
	}
	lineas.push(`autoejecucion: ${tarea.autoejecucion}`);
	lineas.push(`marcas: [${completa.marcas.join(", ")}]`);
	lineas.push(...faseFrontmatter("analisis", tarea.analisisModelo, completa.analisisTerminal));
	lineas.push(...faseFrontmatter("ejecucion", tarea.ejecucionModelo, completa.ejecucionTerminal));
	lineas.push(`creada: ${tarea.creada}`);
	lineas.push(...consumoFrontmatter(completa.consumo));
	// La revisión del frontmatter es la global del servidor en el momento de
	// la lectura, no la de la fila: es la que el agente pasa a `novedades`.
	lineas.push(`revision: ${completa.revisionServidor}`);
	lineas.push("---");
	return lineas.join("\n");
}

/**
 * Cabecera de un comentario: `### tipo · autor · fecha`, con `P<n>` al final
 * solo en preguntas y respuestas, para saber qué respuesta contesta a qué
 * pregunta.
 */
function cabecera(comentario: Comentario, numeroDePregunta: Map<number, number>): string {
	const partes = [comentario.tipo, comentario.autor, comentario.creado];
	if (comentario.preguntaId !== null) {
		const numero = numeroDePregunta.get(comentario.preguntaId);
		if (numero !== undefined) {
			partes.push(`P${numero}`);
		}
	}
	return `### ${partes.join(" · ")}`;
}

/**
 * El documento Markdown de una tarea, que es lo que devuelve `leer_tarea`.
 * El servidor es el único que escribe este formato: los agentes solo mandan
 * contenido, así que ninguno puede romper la estructura.
 */
export function documentoTarea(completa: TareaCompleta): string {
	const bloques = [frontmatter(completa), "## Descripción", libre(completa.tarea.descripcion), "## Hijas"];

	if (completa.hijas.length === 0) {
		bloques.push("Ninguna.");
	} else {
		bloques.push(completa.hijas.map((hija) => `- ${formatearId(hija.id)} · ${hija.estado} · ${hija.titulo}`).join("\n"));
	}

	bloques.push("## Hilo");
	if (completa.comentarios.length === 0) {
		bloques.push("Ninguno.");
	} else {
		const numeroDePregunta = new Map(completa.preguntas.map((pregunta) => [pregunta.id, pregunta.numero]));
		for (const comentario of completa.comentarios) {
			bloques.push(cabecera(comentario, numeroDePregunta), libre(comentario.texto));
		}
	}

	return bloques.join("\n\n");
}
