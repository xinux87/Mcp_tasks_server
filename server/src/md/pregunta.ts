/** Una opción de una pregunta: qué se hace y qué consecuencia tiene. */
export type OpcionPregunta = {
	texto: string;
	consecuencia: string;
};

export type CamposPregunta = {
	pregunta: string;
	porQueImporta: string;
	opciones: OpcionPregunta[];
	recomendacion: string;
};

export type CamposRespuesta = {
	opcion: string;
	nota: string | null;
};

/**
 * Cuerpo del comentario `pregunta`. El agente manda los campos por separado y
 * el servidor los coloca: así ningún agente puede romper la estructura del
 * documento y todas las preguntas se leen igual.
 */
export function cuerpoPregunta({ pregunta, porQueImporta, opciones, recomendacion }: CamposPregunta): string {
	const bloques = [
		`**${pregunta}**`,
		`Por qué importa: ${porQueImporta}`,
		["Opciones:", ...opciones.map((opcion) => `- **${opcion.texto}**: ${opcion.consecuencia}`)].join("\n"),
		`Recomendación: ${recomendacion}.`,
	];
	return bloques.join("\n\n");
}

/** Cuerpo del comentario `respuesta`: la opción elegida y la nota libre. */
export function cuerpoRespuesta({ opcion, nota }: CamposRespuesta): string {
	const bloques = [`Opción: **${opcion}**`];
	if (nota !== null && nota !== "") {
		bloques.push(`Nota: ${nota}`);
	}
	return bloques.join("\n\n");
}
