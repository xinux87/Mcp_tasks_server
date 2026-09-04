import type { DatabaseSync } from "node:sqlite";
import type { Context, Hono } from "hono";
import { html, raw } from "hono/html";
import { type Actividad, actividadDe } from "../../db/actividad.ts";
import { type TerminalListado, terminalesActivos } from "../../db/admin.ts";
import { revisionActual } from "../../db/consultas.ts";
import type { ConsumoDeTarea } from "../../db/consumo.ts";
import { editarTareaBacklog, exigirTitulo } from "../../db/edicion.ts";
import { type Comentario, notaHumana, type Pregunta, responder } from "../../db/hilo.ts";
import {
	aprobarEjecucion,
	buscarTarea,
	crearTareaHumana,
	type Estado,
	type ItemIndice,
	leerTarea,
	listarTareas,
	type Marca,
	moverTareaHumano,
	type Tarea,
	type TareaCompleta,
	type TipoTarea,
} from "../../db/tareas.ts";
import { ErrorDeRegla, esErrorDeRegla } from "../../errores.ts";
import { formatearId, parsearId } from "../../md/ids.ts";
import {
	accionNuevaTarea,
	buscadorDeColor,
	buscadorDeCreador,
	type Color,
	chipAutor,
	chipUsuario,
	filtroSelect,
	fraseDeAccion,
	type Propiedad,
	propiedades,
	type QuienCreo,
	rotuloColumna,
} from "../componentes.ts";
import { duracionLegible, faseLegible, fechaLegible, numeroLegible, SIN_DATO } from "../formatos.ts";
import {
	campo,
	campoOpcional,
	ESTADO_AVISO,
	type Formulario,
	leerFormulario,
	marcado,
	mensajeDeRegla,
} from "../formulario.ts";
import { renderMarkdown } from "../markdown.ts";
import {
	COLUMNAS,
	type Html,
	insigniaEstado,
	insigniasMarcas,
	insigniaTipo,
	insigniaTipoTarea,
	MODELOS_SUGERIDOS,
	pagina,
	type RespuestaHtml,
} from "../plantilla.ts";
import { type DependenciasWeb, usuarioActual } from "../sesion.ts";

const ESTADOS: readonly Estado[] = ["backlog", "prepared", "doing", "done", "finished"];
const MARCAS: readonly Marca[] = ["bloqueada", "sin terminal", "en marcha", "análisis listo"];

/** Cómo se resuelve quién creó una tarea. Se construye una vez por página. */
type Creador = (quien: QuienCreo) => Html | null;

/** Cómo se resuelve el color de un usuario al pintar. Una vez por página. */
type ColorDe = (nombre: string) => Color | null;

/** Los valores de los campos de una tarea, para pintar el formulario relleno. */
type ValoresTarea = {
	titulo: string;
	descripcion: string;
	tipo: TipoTarea;
	autoejecucion: boolean;
	analisisModelo: string | null;
	analisisTerminalId: number | null;
	ejecucionModelo: string | null;
	ejecucionTerminalId: number | null;
};

const TAREA_VACIA: ValoresTarea = {
	titulo: "",
	descripcion: "",
	tipo: "tarea",
	autoejecucion: true,
	analisisModelo: null,
	analisisTerminalId: null,
	ejecucionModelo: null,
	ejecucionTerminalId: null,
};

// --- lectura de parámetros ---------------------------------------------------

/** El id de la ruta, o `null` si no tiene la forma `T-0042`. */
function idDeRuta(c: Context): number | null {
	try {
		return parsearId(c.req.param("id") ?? "");
	} catch (error) {
		if (esErrorDeRegla(error)) {
			return null;
		}
		throw error;
	}
}

function esEstado(valor: string): valor is Estado {
	const nombres: readonly string[] = ESTADOS;
	return nombres.includes(valor);
}

function esMarca(valor: string): valor is Marca {
	const nombres: readonly string[] = MARCAS;
	return nombres.includes(valor);
}

/**
 * Un terminal elegido en un desplegable. La opción vacía es «cualquiera»; un
 * id que no sea de un terminal activo es un formulario manipulado.
 */
function terminalDeFormulario(activos: TerminalListado[], valor: string): number | null {
	if (valor.trim() === "") {
		return null;
	}
	const id = Number.parseInt(valor, 10);
	if (!activos.some((terminal) => terminal.id === id)) {
		throw new ErrorDeRegla("terminal_inexistente", `No hay ningún terminal activo con el identificador ${valor}.`);
	}
	return id;
}

/** Un identificador de terminal tal como llegó, sin validar: solo para repintar el formulario. */
function numeroONull(valor: string): number | null {
	const numero = Number.parseInt(valor, 10);
	return Number.isSafeInteger(numero) ? numero : null;
}

/**
 * Lo que el humano escribió, sin comprobar nada. Es lo que se le devuelve
 * cuando algo falla, para que no pierda lo que llevaba escrito.
 */
function valoresCrudos(formulario: Formulario): ValoresTarea {
	// En una pregunta no hay ejecución que asignar ni autoejecución que
	// decidir: el formulario no enseña esos campos, así que lo que llegue en
	// ellos se ignora en vez de guardarse a medias.
	const esPregunta = marcado(formulario, "pregunta");
	return {
		titulo: campo(formulario, "titulo"),
		descripcion: campo(formulario, "descripcion"),
		tipo: esPregunta ? "pregunta" : "tarea",
		autoejecucion: esPregunta || marcado(formulario, "autoejecucion"),
		analisisModelo: campoOpcional(formulario, "analisisModelo"),
		analisisTerminalId: numeroONull(campo(formulario, "analisisTerminal")),
		ejecucionModelo: esPregunta ? null : campoOpcional(formulario, "ejecucionModelo"),
		ejecucionTerminalId: esPregunta ? null : numeroONull(campo(formulario, "ejecucionTerminal")),
	};
}

/** Los campos de tarea que comparten «Nueva tarea» y «Editar», ya validados. */
function valoresDeFormulario(formulario: Formulario, activos: TerminalListado[]): ValoresTarea {
	const crudos = valoresCrudos(formulario);
	return {
		...crudos,
		titulo: exigirTitulo(campo(formulario, "titulo")),
		analisisTerminalId: terminalDeFormulario(activos, campo(formulario, "analisisTerminal")),
		ejecucionTerminalId:
			crudos.tipo === "pregunta" ? null : terminalDeFormulario(activos, campo(formulario, "ejecucionTerminal")),
	};
}

// --- trozos compartidos ------------------------------------------------------

function enlaceTarea(id: number): Html {
	return html`<a class="id-tarea" href="/tareas/${formatearId(id)}">${formatearId(id)}</a>`;
}

/** La fase de ejecución de una pregunta no existe: no hay nada que enseñar. */
function ejecucionLegible(tipo: TipoTarea, modelo: string | null, terminal: string | null): string {
	return tipo === "pregunta" ? SIN_DATO : faseLegible(modelo, terminal);
}

// --- el formulario de una tarea ----------------------------------------------

function opcionTerminal(terminal: TerminalListado, seleccionado: number | null): Html {
	return html`<option value="${terminal.id}"${seleccionado === terminal.id ? raw(" selected") : ""}>${terminal.nombre}</option>`;
}

function selectTerminal(nombre: string, activos: TerminalListado[], seleccionado: number | null): Html {
	return html`<select name="${nombre}">
			<option value=""${seleccionado === null ? raw(" selected") : ""}>cualquiera</option>
			${activos.map((terminal) => opcionTerminal(terminal, seleccionado))}
		</select>`;
}

/** Una casilla con su explicación debajo, en texto suave. */
function casilla(nombre: string, marcada: boolean, texto: string, explicacion: string): Html {
	return html`<label class="casilla">
			<input type="checkbox" name="${nombre}"${marcada ? raw(" checked") : ""}>
			<span class="que">${texto}</span>
			<span class="detalle">${explicacion}</span>
		</label>`;
}

/** Una de las dos tarjetas de asignación: modelo y terminal de una fase. */
function fase(
	titulo: string,
	prefijo: string,
	modelo: string | null,
	terminalId: number | null,
	activos: TerminalListado[],
): Html {
	return html`<fieldset>
			<legend>${titulo}</legend>
			<label>
				<span>Modelo</span>
				<input type="text" name="${prefijo}Modelo" list="modelos" value="${modelo ?? ""}">
			</label>
			<label>
				<span>Terminal</span>
				${selectTerminal(`${prefijo}Terminal`, activos, terminalId)}
			</label>
		</fieldset>`;
}

/**
 * El formulario de una tarea, compartido por «Nueva tarea» y «Editar». En una
 * pregunta no se pintan ni la autoejecución ni la ejecución: esa tarea solo
 * tiene fase de análisis y el comentario de análisis la cierra.
 */
function camposTarea(valores: ValoresTarea, activos: TerminalListado[]): Html {
	const esPregunta = valores.tipo === "pregunta";
	const autoejecucion = esPregunta
		? html``
		: casilla(
				"autoejecucion",
				valores.autoejecucion,
				"Autoejecución",
				"La ejecución arranca sola cuando el análisis termina sin preguntas abiertas.",
			);
	const ejecucion = esPregunta
		? html``
		: fase("Ejecución", "ejecucion", valores.ejecucionModelo, valores.ejecucionTerminalId, activos);
	return html`<label>
			<span>Título</span>
			<input type="text" name="titulo" value="${valores.titulo}" required>
		</label>
		<label>
			<span>Descripción (Markdown)</span>
			<textarea name="descripcion" rows="10">${valores.descripcion}</textarea>
		</label>
		${casilla(
			"pregunta",
			esPregunta,
			"Es una pregunta",
			"La respuesta es el comentario de análisis y la tarea se cierra con él.",
		)}
		${autoejecucion}
		<datalist id="modelos">${MODELOS_SUGERIDOS.map((modelo) => html`<option value="${modelo}"></option>`)}</datalist>
		<div class="fases">
			${fase("Análisis", "analisis", valores.analisisModelo, valores.analisisTerminalId, activos)}
			${ejecucion}
		</div>`;
}

// --- la lista ----------------------------------------------------------------

function filaTarea(db: DatabaseSync, item: ItemIndice, creadorDe: Creador): Html {
	const tarea = buscarTarea(db, item.id);
	const creador =
		tarea === undefined
			? null
			: creadorDe({ usuarioId: tarea.creadaPorUsuarioId, terminalId: tarea.creadaPorTerminalId });
	return html`<tr>
			<td>${enlaceTarea(item.id)}</td>
			<td>${insigniaTipoTarea(item.tipo)}${insigniasMarcas(item.marcas)}${item.titulo}</td>
			<td class="pequeno">${faseLegible(item.analisisModelo, item.analisisTerminal)}</td>
			<td class="pequeno">${ejecucionLegible(item.tipo, item.ejecucionModelo, item.ejecucionTerminal)}</td>
			<td>${creador ?? SIN_DATO}</td>
			<td class="pequeno">${tarea === undefined ? SIN_DATO : fechaLegible(tarea.actualizada)}</td>
		</tr>`;
}

function tablaLista(db: DatabaseSync, items: ItemIndice[], creadorDe: Creador): Html {
	if (items.length === 0) {
		return html`<p class="silencio">Ninguna.</p>`;
	}
	return html`<div class="tabla-envuelta">
			<table>
				<thead>
					<tr>
						<th>Id</th><th>Título</th><th>Análisis</th><th>Ejecución</th><th>Creada por</th><th>Actualizada</th>
					</tr>
				</thead>
				<tbody>${items.map((item) => filaTarea(db, item, creadorDe))}</tbody>
			</table>
		</div>`;
}

function grupoColumna(
	db: DatabaseSync,
	columna: { estado: Estado; titulo: string },
	items: ItemIndice[],
	creadorDe: Creador,
): Html {
	const tabla = tablaLista(db, items, creadorDe);
	const rotulo = rotuloColumna(insigniaEstado(columna.estado), columna.titulo, items.length);
	// Las cerradas están archivadas: se ven si se piden, no estorban por defecto.
	if (columna.estado === "finished") {
		return html`<section class="grupo">
				<details>
					<summary>${rotulo}</summary>
					${tabla}
				</details>
			</section>`;
	}
	return html`<section class="grupo">
			<h2>${rotulo}</h2>
			${tabla}
		</section>`;
}

/**
 * La fila de filtros: desplegables compactos y nada más. «Quitar filtros» solo
 * aparece cuando hay algo que quitar; si no, sería un enlace que no hace nada.
 */
function formularioFiltros(activos: TerminalListado[], estado: string, terminal: string, marca: string): Html {
	const hayFiltro = estado !== "" || terminal !== "" || marca !== "";
	return html`<form class="filtros" method="get" action="/tareas">
			${filtroSelect({
				nombre: "estado",
				titulo: "Estado",
				todas: "todos",
				valores: ESTADOS.map((valor) => ({ valor, texto: valor })),
				seleccionado: estado,
			})}
			${filtroSelect({
				nombre: "terminal",
				titulo: "Terminal",
				todas: "todos",
				valores: activos.map((activo) => ({ valor: String(activo.id), texto: activo.nombre })),
				seleccionado: terminal,
			})}
			${filtroSelect({
				nombre: "marca",
				titulo: "Marca",
				todas: "todas",
				valores: MARCAS.map((valor) => ({ valor, texto: valor })),
				seleccionado: marca,
			})}
			<button type="submit" class="pequeno">Filtrar</button>
			${hayFiltro ? html`<a class="quitar" href="/tareas">Quitar filtros</a>` : html``}
		</form>`;
}

// --- la ficha ----------------------------------------------------------------

/** Quién creó la tarea y cuándo. Sin creador conocido queda solo la fecha. */
function creadaLegible(tarea: Tarea, creadorDe: Creador): Html {
	const quien = creadorDe({ usuarioId: tarea.creadaPorUsuarioId, terminalId: tarea.creadaPorTerminalId });
	const cuando = html`<span class="silencio">${fechaLegible(tarea.creada)}</span>`;
	return quien === null ? cuando : html`${quien} ${cuando}`;
}

/**
 * Las propiedades de la tarea, en filas de dos columnas. Una pregunta no
 * enseña ejecución ni autoejecución: enseñarlas haría creer que después del
 * análisis viene otra fase.
 */
function propiedadesDeTarea(completa: TareaCompleta, creadorDe: Creador): Html {
	const { tarea } = completa;
	const filas: Propiedad[] = [{ nombre: "Estado", valor: insigniaEstado(tarea.estado) }];
	if (tarea.tipo === "pregunta") {
		filas.push({ nombre: "Tipo", valor: insigniaTipoTarea(tarea.tipo) });
	}
	filas.push({ nombre: "Análisis", valor: faseLegible(tarea.analisisModelo, completa.analisisTerminal) });
	if (tarea.tipo !== "pregunta") {
		filas.push({ nombre: "Ejecución", valor: faseLegible(tarea.ejecucionModelo, completa.ejecucionTerminal) });
		filas.push({ nombre: "Autoejecución", valor: tarea.autoejecucion ? "activada" : "desactivada" });
	}
	filas.push({
		nombre: "Padre",
		valor: tarea.padreId === null ? html`<span class="silencio">ninguno</span>` : enlaceTarea(tarea.padreId),
	});
	filas.push({ nombre: "Orden", valor: String(tarea.orden) });
	filas.push({ nombre: "Creada", valor: creadaLegible(tarea, creadorDe) });
	filas.push({ nombre: "Revisión", valor: String(tarea.revision) });
	return propiedades(filas);
}

function tablaConsumo(consumo: ConsumoDeTarea): Html {
	const fases: { nombre: string; fase: ConsumoDeTarea["analisis"] }[] = [
		{ nombre: "analisis", fase: consumo.analisis },
		{ nombre: "ejecucion", fase: consumo.ejecucion },
	];
	const conDatos = fases.filter((entrada) => entrada.fase !== null);
	if (conDatos.length === 0 && consumo.totalConHijas === 0) {
		return html`<p class="silencio">Sin consumo.</p>`;
	}
	return html`<div class="tabla-envuelta">
			<table>
				<thead>
					<tr>
						<th>Fase</th><th>Modelo</th><th class="numero">Tokens</th>
						<th class="numero">Herramientas</th><th class="numero">Duración</th>
					</tr>
				</thead>
				<tbody>
					${conDatos.map(
						(entrada) => html`<tr>
							<td>${entrada.nombre}</td>
							<td>${entrada.fase?.modelo ?? SIN_DATO}</td>
							<td class="numero">${numeroLegible(entrada.fase?.tokens ?? 0)}</td>
							<td class="numero">${entrada.fase?.herramientas ?? 0}</td>
							<td class="numero">${duracionLegible(entrada.fase?.duracionMs ?? 0)}</td>
						</tr>`,
					)}
					<tr>
						<td colspan="2"><strong>Total con hijas</strong></td>
						<td class="numero"><strong>${numeroLegible(consumo.totalConHijas)}</strong></td>
						<td class="numero"></td>
						<td class="numero"></td>
					</tr>
				</tbody>
			</table>
		</div>`;
}

// --- el hilo -----------------------------------------------------------------

/** Una opción de una pregunta abierta: tarjeta seleccionable con su consecuencia. */
function opcionDePregunta(texto: string, consecuencia: string, recomendada: boolean): Html {
	return html`<label class="opcion">
			<input type="radio" name="opcion" value="${texto}" required>
			<span class="que">${texto}${recomendada ? html`<span class="recomendada">recomendada</span>` : html``}</span>
			<span class="consecuencia">${consecuencia}</span>
		</label>`;
}

/** El formulario de respuesta, dentro de la tarjeta de la pregunta abierta. */
function formularioRespuesta(tareaId: number, pregunta: Pregunta): Html {
	return html`<form class="responder" method="post" action="/tareas/${formatearId(tareaId)}/responder/P${pregunta.numero}">
			<fieldset>
				<legend>Responder a P${pregunta.numero}</legend>
				${pregunta.opciones.map((opcion) =>
					opcionDePregunta(opcion.texto, opcion.consecuencia, opcion.texto === pregunta.recomendacion),
				)}
				<label>
					<span>Nota (opcional)</span>
					<textarea name="nota" rows="3"></textarea>
				</label>
				<button type="submit" class="principal">Responder</button>
			</fieldset>
		</form>`;
}

function tarjetaComentario(completa: TareaCompleta, comentario: Comentario, colorDe: ColorDe): Html {
	const pregunta =
		comentario.tipo === "pregunta" && comentario.preguntaId !== null
			? completa.preguntas.find((candidata) => candidata.id === comentario.preguntaId)
			: undefined;
	const abierta = pregunta !== undefined && pregunta.respuestaOpcion === null;
	return html`<article class="comentario">
			<header>
				${chipAutor(comentario.autor, colorDe)}
				${insigniaTipo(comentario.tipo)}
				${pregunta === undefined ? html`` : html`<span>P${pregunta.numero}</span>`}
				<span>${fechaLegible(comentario.creado)}</span>
			</header>
			<div class="cuerpo">${raw(renderMarkdown(comentario.texto))}</div>
			${abierta && pregunta !== undefined ? formularioRespuesta(completa.tarea.id, pregunta) : html``}
		</article>`;
}

function hilo(completa: TareaCompleta, colorDe: ColorDe): Html {
	if (completa.comentarios.length === 0) {
		return html`<p class="silencio">Ninguno.</p>`;
	}
	return html`<div class="hilo">
			${completa.comentarios.map((comentario) => tarjetaComentario(completa, comentario, colorDe))}
		</div>`;
}

// --- la actividad de la tarea ------------------------------------------------

function lineaActividad(fila: Actividad, colorDe: ColorDe): Html {
	return html`<li>
			${chipUsuario(fila.usuarioNombre, colorDe(fila.usuarioNombre))}
			<span>${fraseDeAccion(fila.accion)}</span>
			${fila.detalle === "" ? html`` : html`<span class="silencio">${fila.detalle}</span>`}
			<span class="silencio pequeno">${fechaLegible(fila.creado)}</span>
		</li>`;
}

/** El rastro de lo que el humano ha hecho con esta tarea, de lo viejo a lo nuevo. */
function actividadDeTarea(db: DatabaseSync, tareaId: number, colorDe: ColorDe): Html {
	const filas = actividadDe(db, "tarea", tareaId);
	if (filas.length === 0) {
		return html`<p class="silencio">Ninguna.</p>`;
	}
	return html`<ol class="actividad">${filas.map((fila) => lineaActividad(fila, colorDe))}</ol>`;
}

// --- las acciones de la ficha ------------------------------------------------

function botonMover(id: string, estado: Estado, texto: string): Html {
	return html`<form method="post" action="/tareas/${id}/mover">
			<input type="hidden" name="estado" value="${estado}">
			<button type="submit" class="principal">${texto}</button>
		</form>`;
}

/**
 * Las transiciones hacia delante que toca hacer aquí, que van arriba con el
 * título. En `doing` manda el agente y `finished` está archivada: el humano no
 * mueve ninguna de las dos, y entonces no hay acciones que enseñar.
 */
function accionesFicha(completa: TareaCompleta): Html | undefined {
	const id = formatearId(completa.tarea.id);
	if (completa.tarea.estado === "backlog") {
		return botonMover(id, "prepared", "Pasar a preparadas");
	}
	// La marca «análisis listo» ya excluye las preguntas: no tienen ejecución.
	if (completa.tarea.estado === "prepared" && completa.marcas.includes("análisis listo")) {
		return html`<form method="post" action="/tareas/${id}/aprobar">
				<button type="submit" class="principal">Aprobar ejecución</button>
			</form>`;
	}
	if (completa.tarea.estado === "done") {
		return botonMover(id, "finished", "Finalizar");
	}
	return undefined;
}

/** Una vuelta atrás: plegada, porque es excepcional, y siempre con su nota. */
function vueltaAtras(id: string, estado: Estado, texto: string, queNota: string): Html {
	return html`<details class="caja">
			<summary><strong>${texto}</strong></summary>
			<form method="post" action="/tareas/${id}/mover">
				<input type="hidden" name="estado" value="${estado}">
				<label>
					<span>Nota: ${queNota}</span>
					<textarea name="nota" rows="3" required></textarea>
				</label>
				<button type="submit">${texto}</button>
			</form>
		</details>`;
}

function vueltasAtras(completa: TareaCompleta): Html {
	const id = formatearId(completa.tarea.id);
	if (completa.tarea.estado === "prepared") {
		return vueltaAtras(id, "backlog", "Volver a backlog", "por qué vuelve a backlog");
	}
	if (completa.tarea.estado === "done") {
		return vueltaAtras(id, "doing", "Devolver a doing", "qué falta");
	}
	return html``;
}

/** Editar solo en `backlog`: al salir, la descripción y las asignaciones se congelan. */
function detallesEditar(tarea: Tarea, activos: TerminalListado[]): Html {
	if (tarea.estado !== "backlog") {
		return html``;
	}
	return html`<details class="caja">
			<summary><strong>Editar</strong></summary>
			<form method="post" action="/tareas/${formatearId(tarea.id)}/editar">
				${camposTarea(
					{
						titulo: tarea.titulo,
						descripcion: tarea.descripcion,
						tipo: tarea.tipo,
						autoejecucion: tarea.autoejecucion,
						analisisModelo: tarea.analisisModelo,
						analisisTerminalId: tarea.analisisTerminalId,
						ejecucionModelo: tarea.ejecucionModelo,
						ejecucionTerminalId: tarea.ejecucionTerminalId,
					},
					activos,
				)}
				<div class="acciones">
					<button type="submit" class="principal">Guardar cambios</button>
				</div>
			</form>
		</details>`;
}

// --- páginas -----------------------------------------------------------------

function paginaNoEncontrada(c: Context, mensaje: string): RespuestaHtml {
	return c.html(
		pagina({
			titulo: "No encontrada",
			usuario: usuarioActual(c),
			vista: "tarea",
			aviso: mensaje,
			cuerpo: html`<p><a href="/tareas">Volver a la lista de tareas</a></p>`,
		}),
		404,
	);
}

function paginaLista(c: Context, deps: DependenciasWeb): RespuestaHtml {
	const { db } = deps;
	const activos = terminalesActivos(db);
	const estado = c.req.query("estado") ?? "";
	const terminal = c.req.query("terminal") ?? "";
	const marca = c.req.query("marca") ?? "";

	const terminalId = Number.parseInt(terminal, 10);
	const items = listarTareas(db, Number.isSafeInteger(terminalId) ? { terminalId } : {}).filter((item) => {
		if (esEstado(estado) && item.estado !== estado) {
			return false;
		}
		if (esMarca(marca) && !item.marcas.includes(marca)) {
			return false;
		}
		return true;
	});

	// Un solo buscador para toda la tabla: la lista pinta una fila por tarea y
	// no puede consultar usuarios y terminales en cada una.
	const creadorDe = buscadorDeCreador(db);
	const cuerpo = html`${formularioFiltros(activos, estado, terminal, marca)}
		${COLUMNAS.map((columna) =>
			grupoColumna(
				db,
				columna,
				items.filter((item) => item.estado === columna.estado),
				creadorDe,
			),
		)}`;
	// `vista` y `revision` son lo que el cliente necesita para refrescarse: la
	// lista se recarga entera cuando sube la revisión.
	return c.html(
		pagina({
			titulo: "Tareas",
			usuario: usuarioActual(c),
			vista: "lista",
			revision: revisionActual(db),
			acciones: accionNuevaTarea(),
			cuerpo,
		}),
	);
}

function paginaNueva(c: Context, deps: DependenciasWeb, valores: ValoresTarea, aviso: string | null): RespuestaHtml {
	const activos = terminalesActivos(deps.db);
	const cuerpo = html`<form method="post" action="/tareas">
			${camposTarea(valores, activos)}
			<div class="acciones">
				<button type="submit" class="principal">Crear tarea</button>
				<a class="boton" href="/tareas">Cancelar</a>
			</div>
		</form>`;
	return c.html(
		pagina({
			titulo: "Nueva tarea",
			usuario: usuarioActual(c),
			vista: "tarea-nueva",
			migas: [{ texto: "Tareas", href: "/tareas" }, { texto: "Nueva tarea" }],
			aviso,
			cuerpo,
		}),
		aviso === null ? 200 : ESTADO_AVISO,
	);
}

function paginaFicha(c: Context, deps: DependenciasWeb, tareaId: number, aviso: string | null): RespuestaHtml {
	const completa = leerTarea(deps.db, tareaId);
	if (completa === undefined) {
		return paginaNoEncontrada(c, `No existe la tarea ${formatearId(tareaId)}.`);
	}
	const { tarea } = completa;
	const id = formatearId(tarea.id);
	// El color de un autor se busca al pintar, y el hilo tiene muchos: una sola
	// lectura de la tabla de usuarios para toda la página.
	const colorDe = buscadorDeColor(deps.db);

	const cuerpo = html`${propiedadesDeTarea(completa, buscadorDeCreador(deps.db))}

		<h2>Descripción</h2>
		<div class="cuerpo">${raw(renderMarkdown(tarea.descripcion))}</div>

		<h2>Hijas</h2>
		${
			completa.hijas.length === 0
				? html`<p class="silencio">Ninguna.</p>`
				: html`<ul class="hijas">
					${completa.hijas.map(
						(hija) => html`<li>${insigniaEstado(hija.estado)} ${enlaceTarea(hija.id)} ${hija.titulo}</li>`,
					)}
				</ul>`
		}

		<h2>Consumo</h2>
		${tablaConsumo(completa.consumo)}

		<h2>Hilo</h2>
		${hilo(completa, colorDe)}

		<h2>Nota</h2>
		<form method="post" action="/tareas/${id}/nota">
			<label>
				<span>Indicación para el agente (Markdown)</span>
				<textarea name="texto" rows="4" required></textarea>
			</label>
			<div class="acciones">
				<button type="submit">Añadir nota</button>
			</div>
		</form>

		<h2>Actividad</h2>
		${actividadDeTarea(deps.db, tarea.id, colorDe)}

		${vueltasAtras(completa)}
		${detallesEditar(tarea, terminalesActivos(deps.db))}`;

	return c.html(
		// La ficha no se recarga sola: tiene formularios. El cliente solo avisa.
		pagina({
			titulo: tarea.titulo,
			usuario: usuarioActual(c),
			vista: "ficha",
			revision: completa.revisionServidor,
			migas: [{ texto: "Tareas", href: "/tareas" }, { texto: id }],
			etiquetas: html`${insigniaEstado(tarea.estado)}${insigniaTipoTarea(tarea.tipo)}${insigniasMarcas(completa.marcas)}`,
			acciones: accionesFicha(completa),
			aviso,
			cuerpo,
		}),
		aviso === null ? 200 : ESTADO_AVISO,
	);
}

// --- rutas -------------------------------------------------------------------

/** Todas las rutas de tareas: lista, alta, ficha y las acciones del humano. */
export function registrarRutasTareas(app: Hono, deps: DependenciasWeb): void {
	app.get("/tareas", (c) => paginaLista(c, deps));

	// Antes de `/tareas/:id` para que «nueva» no se lea como identificador.
	app.get("/tareas/nueva", (c) => paginaNueva(c, deps, TAREA_VACIA, null));

	app.post("/tareas", async (c) => {
		const formulario = await leerFormulario(c);
		const activos = terminalesActivos(deps.db);
		try {
			const valores = valoresDeFormulario(formulario, activos);
			const tarea = crearTareaHumana(deps.db, { ...valores, usuarioId: usuarioActual(c).id });
			return c.redirect(`/tareas/${formatearId(tarea.id)}`, 302);
		} catch (error) {
			return paginaNueva(c, deps, valoresCrudos(formulario), mensajeDeRegla(error));
		}
	});

	app.get("/tareas/:id", (c) => {
		const tareaId = idDeRuta(c);
		if (tareaId === null) {
			return paginaNoEncontrada(c, "Eso no es un identificador de tarea; tiene la forma T-0042.");
		}
		return paginaFicha(c, deps, tareaId, null);
	});

	app.post("/tareas/:id/editar", async (c) => {
		const tareaId = idDeRuta(c);
		if (tareaId === null) {
			return paginaNoEncontrada(c, "Eso no es un identificador de tarea; tiene la forma T-0042.");
		}
		const formulario = await leerFormulario(c);
		try {
			const valores = valoresDeFormulario(formulario, terminalesActivos(deps.db));
			editarTareaBacklog(deps.db, { ...valores, tareaId, usuarioId: usuarioActual(c).id });
			return c.redirect(`/tareas/${formatearId(tareaId)}`, 302);
		} catch (error) {
			return paginaFicha(c, deps, tareaId, mensajeDeRegla(error));
		}
	});

	app.post("/tareas/:id/mover", async (c) => {
		const tareaId = idDeRuta(c);
		if (tareaId === null) {
			return paginaNoEncontrada(c, "Eso no es un identificador de tarea; tiene la forma T-0042.");
		}
		const formulario = await leerFormulario(c);
		const estado = campo(formulario, "estado");
		try {
			if (!esEstado(estado)) {
				throw new ErrorDeRegla("estado_desconocido", `«${estado}» no es ninguna de las cinco columnas.`);
			}
			moverTareaHumano(deps.db, {
				tareaId,
				usuarioId: usuarioActual(c).id,
				estado,
				nota: campo(formulario, "nota"),
			});
			return c.redirect(`/tareas/${formatearId(tareaId)}`, 302);
		} catch (error) {
			return paginaFicha(c, deps, tareaId, mensajeDeRegla(error));
		}
	});

	app.post("/tareas/:id/aprobar", (c) => {
		const tareaId = idDeRuta(c);
		if (tareaId === null) {
			return paginaNoEncontrada(c, "Eso no es un identificador de tarea; tiene la forma T-0042.");
		}
		try {
			aprobarEjecucion(deps.db, { tareaId, usuarioId: usuarioActual(c).id });
			return c.redirect(`/tareas/${formatearId(tareaId)}`, 302);
		} catch (error) {
			return paginaFicha(c, deps, tareaId, mensajeDeRegla(error));
		}
	});

	app.post("/tareas/:id/nota", async (c) => {
		const tareaId = idDeRuta(c);
		if (tareaId === null) {
			return paginaNoEncontrada(c, "Eso no es un identificador de tarea; tiene la forma T-0042.");
		}
		const formulario = await leerFormulario(c);
		try {
			notaHumana(deps.db, { tareaId, usuarioId: usuarioActual(c).id, texto: campo(formulario, "texto") });
			return c.redirect(`/tareas/${formatearId(tareaId)}`, 302);
		} catch (error) {
			return paginaFicha(c, deps, tareaId, mensajeDeRegla(error));
		}
	});

	app.post("/tareas/:id/responder/:pregunta", async (c) => {
		const tareaId = idDeRuta(c);
		if (tareaId === null) {
			return paginaNoEncontrada(c, "Eso no es un identificador de tarea; tiene la forma T-0042.");
		}
		const completa = leerTarea(deps.db, tareaId);
		if (completa === undefined) {
			return paginaNoEncontrada(c, `No existe la tarea ${formatearId(tareaId)}.`);
		}
		const numero = Number.parseInt((c.req.param("pregunta") ?? "").replace(/^P/, ""), 10);
		const pregunta = completa.preguntas.find((candidata) => candidata.numero === numero);
		if (pregunta === undefined) {
			return paginaNoEncontrada(c, `La tarea ${formatearId(tareaId)} no tiene la pregunta indicada.`);
		}
		const formulario = await leerFormulario(c);
		try {
			// La respuesta se guarda por el texto de la opción, nunca por su
			// posición: un índice se rompe en silencio al reordenar.
			responder(deps.db, {
				preguntaId: pregunta.id,
				usuarioId: usuarioActual(c).id,
				opcion: campo(formulario, "opcion"),
				nota: campo(formulario, "nota"),
			});
			return c.redirect(`/tareas/${formatearId(tareaId)}`, 302);
		} catch (error) {
			return paginaFicha(c, deps, tareaId, mensajeDeRegla(error));
		}
	});
}
