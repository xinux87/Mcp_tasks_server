import MarkdownIt, { type StateCore, type Token } from "markdown-it";
import { bloqueCodigo } from "./componentes.ts";

/**
 * Renderizador único de la web. `html: false` desactiva el HTML crudo dentro
 * del Markdown: es la única entrada de terceros que llega al navegador, así
 * que ninguna etiqueta escrita por un agente o por el humano se interpreta.
 * `linkify: false` evita convertir en enlaces textos que nadie escribió como
 * tales.
 */
const renderizador = new MarkdownIt({ html: false, linkify: false });

/** Un identificador de tarea tal como se cita en el hilo: `T-0042`. */
const ID_TAREA = /T-\d{4,}/g;

/** Un token de texto suelto, con el nivel de anidamiento que le toca. */
function tokenTexto(state: StateCore, contenido: string, nivel: number): Token {
	const token = new state.Token("text", "", 0);
	token.content = contenido;
	token.level = nivel;
	return token;
}

/**
 * Un token `text` partido en los trozos que le corresponden: lo que hay entre
 * identificadores queda como texto y cada identificador, como enlace a su
 * ficha. Sin ningún identificador devuelve el token tal cual.
 */
function partirEnEnlaces(state: StateCore, original: Token): Token[] {
	const partes: Token[] = [];
	let desde = 0;
	ID_TAREA.lastIndex = 0;
	for (let encaje = ID_TAREA.exec(original.content); encaje !== null; encaje = ID_TAREA.exec(original.content)) {
		const antes = original.content.slice(desde, encaje.index);
		if (antes !== "") {
			partes.push(tokenTexto(state, antes, original.level));
		}
		const abre = new state.Token("link_open", "a", 1);
		abre.attrSet("href", `/tareas/${encaje[0]}`);
		abre.level = original.level;
		const cierra = new state.Token("link_close", "a", -1);
		cierra.level = original.level;
		partes.push(abre, tokenTexto(state, encaje[0], original.level + 1), cierra);
		desde = encaje.index + encaje[0].length;
	}
	if (partes.length === 0) {
		return [original];
	}
	const resto = original.content.slice(desde);
	if (resto !== "") {
		partes.push(tokenTexto(state, resto, original.level));
	}
	return partes;
}

/**
 * Los identificadores del hilo, la descripción y las notas enlazan a su ficha:
 * es el «relates to» de Jira sin tabla nueva.
 *
 * Se hace sobre los tokens y no sobre el HTML ya escrito, que es lo que evita
 * enlazar donde no toca: un `code_inline` y un bloque de código no son tokens
 * `text`, y lo que va entre `link_open` y `link_close` se deja pasar tal cual.
 */
renderizador.core.ruler.push("ids_de_tarea", (state: StateCore) => {
	for (const bloque of state.tokens) {
		if (bloque.type !== "inline" || bloque.children === null) {
			continue;
		}
		let dentroDeEnlace = 0;
		const nuevos: Token[] = [];
		for (const hijo of bloque.children) {
			if (hijo.type === "link_open") {
				dentroDeEnlace += 1;
			} else if (hijo.type === "link_close") {
				dentroDeEnlace -= 1;
			}
			if (hijo.type === "text" && dentroDeEnlace === 0) {
				nuevos.push(...partirEnEnlaces(state, hijo));
			} else {
				nuevos.push(hijo);
			}
		}
		bloque.children = nuevos;
	}
});

/**
 * Un bloque de código del hilo o de la descripción se pinta como el del
 * tutorial: con su botón de copiar el bloque y otro por línea. El texto llega
 * aquí sin tocar y lo escapa la plantilla `html`, igual que en el resto de la
 * web; `html: false` sigue mandando sobre lo demás.
 */
function pintarBloque(tokens: Token[], indice: number): string {
	return `${bloqueCodigo(tokens[indice]?.content ?? "")}\n`;
}

renderizador.renderer.rules.fence = pintarBloque;
renderizador.renderer.rules.code_block = pintarBloque;

/**
 * Markdown a HTML seguro. Lo que devuelve es lo único que se pasa por `raw()`
 * en toda la web: ya viene escapado por markdown-it.
 */
export function renderMarkdown(texto: string): string {
	return renderizador.render(texto);
}
