import MarkdownIt from "markdown-it";

/**
 * Renderizador único de la web. `html: false` desactiva el HTML crudo dentro
 * del Markdown: es la única entrada de terceros que llega al navegador, así
 * que ninguna etiqueta escrita por un agente o por el humano se interpreta.
 * `linkify: false` evita convertir en enlaces textos que nadie escribió como
 * tales.
 */
const renderizador = new MarkdownIt({ html: false, linkify: false });

/**
 * Markdown a HTML seguro. Lo que devuelve es lo único que se pasa por `raw()`
 * en toda la web: ya viene escapado por markdown-it.
 */
export function renderMarkdown(texto: string): string {
	return renderizador.render(texto);
}
