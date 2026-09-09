import type { ConsumoDeTarea, ConsumoFase } from "../db/consumo.ts";
import type { Comentario } from "../db/hilo.ts";
import type { HijaDeTarea, TareaCompleta } from "../db/tareas.ts";
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
function lineasConsumo(consumo: ConsumoDeTarea): string[] {
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

/**
 * El bloque `consumo` suelto, tal como lo pinta el documento de la tarea. Es
 * lo que devuelve `reportar_consumo`: el mismo texto que el agente ya sabe
 * leer, sin una segunda forma de escribir las mismas cifras.
 */
export function bloqueConsumo(consumo: ConsumoDeTarea): string {
	return lineasConsumo(consumo).join("\n");
}

function frontmatter(completa: TareaCompleta): string {
	const { tarea } = completa;
	const lineas = ["---", `id: ${formatearId(tarea.id)}`];
	// El título va siempre entre comillas dobles: es texto del humano y puede
	// llevar dos puntos, comillas o almohadillas, que en YAML significan algo.
	lineas.push(`titulo: ${JSON.stringify(tarea.titulo)}`);
	lineas.push(`tipo: ${tarea.tipo}`);
	lineas.push(`estado: ${tarea.estado}`);
	lineas.push(`orden: ${tarea.orden}`);
	if (tarea.padreId !== null) {
		lineas.push(`padre: ${formatearId(tarea.padreId)}`);
	}
	lineas.push(`autoejecucion: ${tarea.autoejecucion}`);
	// La rama y las dependencias solo se escriben cuando las hay: en la mayoría
	// de las tareas serían dos líneas vacías en cada lectura.
	if (tarea.rama !== null) {
		lineas.push(`rama: ${tarea.rama}`);
	}
	if (completa.dependeDe.length > 0) {
		lineas.push(`dependeDe: [${completa.dependeDe.map(formatearId).join(", ")}]`);
	}
	lineas.push(`marcas: [${completa.marcas.join(", ")}]`);
	// El progreso de una funcionalidad: partes cerradas sobre partes totales.
	if (completa.partes !== null && completa.partesCerradas !== null) {
		lineas.push(`partes: ${completa.partes}`, `partesCerradas: ${completa.partesCerradas}`);
	}
	lineas.push(...faseFrontmatter("analisis", tarea.analisisModelo, completa.analisisTerminal));
	// Ni una pregunta ni una funcionalidad tienen fase de ejecución: el bloque
	// no se pinta, para que el agente no lea una asignación que no va a usar.
	if (tarea.tipo === "tarea") {
		lineas.push(...faseFrontmatter("ejecucion", tarea.ejecucionModelo, completa.ejecucionTerminal));
	}
	lineas.push(`creada: ${tarea.creada}`);
	lineas.push(...lineasConsumo(completa.consumo));
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
 * Una hija en el bloque de hijas. Las partes de una funcionalidad llevan
 * detrás de qué hermanas dependen, que es el orden de la descomposición.
 */
function lineaHija(hija: HijaDeTarea): string {
	const partes = [formatearId(hija.id), hija.estado, hija.titulo];
	if (hija.dependeDe.length > 0) {
		partes.push(`depende de: ${hija.dependeDe.map(formatearId).join(", ")}`);
	}
	return `- ${partes.join(" · ")}`;
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
		bloques.push(completa.hijas.map(lineaHija).join("\n"));
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
