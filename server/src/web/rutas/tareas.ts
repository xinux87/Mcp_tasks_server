import type { DatabaseSync } from "node:sqlite";
import type { Context, Hono } from "hono";
import { html, raw } from "hono/html";
import { type Actividad, actividadDe } from "../../db/actividad.ts";
import { type TerminalListado, terminalesActivos } from "../../db/admin.ts";
import { buscarTerminalPorId, revisionActual } from "../../db/consultas.ts";
import type { ConsumoDeTarea } from "../../db/consumo.ts";
import { dependenciasPendientes, dependientesDe } from "../../db/dependencias.ts";
import { editarTareaBacklog, exigirTitulo } from "../../db/edicion.ts";
import { type Comentario, notaHumana, responder, type TipoComentario } from "../../db/hilo.ts";
import { buscarProyectoPorId, listarProyectos, PROYECTO_PRINCIPAL, type Proyecto } from "../../db/proyectos.ts";
import {
	aprobarEjecucion,
	borrarTarea,
	buscarTarea,
	crearTareaHumana,
	type Estado,
	esTipoTarea,
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
import { formatearId, idONull, parsearId } from "../../md/ids.ts";
import {
	accionNuevaTarea,
	barraProgreso,
	buscadorDeColor,
	buscadorDeCreador,
	COLOR_ESTADO,
	chipProyecto,
	chipUsuario,
	edadEnColumna,
	enlaceFuncionalidad,
	etiqueta,
	filtroSelect,
	filtrosRapidos,
	fraseDeAccion,
	type Miga,
	muestraEdad,
	type Propiedad,
	propiedades,
	type QuienCreo,
	rotuloColumna,
} from "../componentes.ts";
import { duracionLegible, faseLegible, fechaLegible, numeroLegible, SIN_DATO, tokensAbreviados } from "../formatos.ts";
import {
	campo,
	campoLista,
	campoOpcional,
	ESTADO_AVISO,
	type Formulario,
	leerFormulario,
	marcado,
	mensajeDeRegla,
} from "../formulario.ts";
import { type ColorDe, tarjetaComentario, tarjetaPreguntaAbierta } from "../hilo.ts";
import { renderMarkdown } from "../markdown.ts";
import {
	COLUMNAS,
	type Html,
	insigniaEstado,
	insigniasMarcas,
	insigniaTipoDeItem,
	insigniaTipoTarea,
	MODELOS_SUGERIDOS,
	pagina,
	type RespuestaHtml,
} from "../plantilla.ts";
import { type DependenciasWeb, destinoSeguro, usuarioActual } from "../sesion.ts";
import { paginaBandeja } from "./bandeja.ts";
import {
	consultaDe,
	type Filtros,
	filtroDeIndice,
	filtrosDe,
	MARCAS,
	opcionesFuncionalidad,
	opcionesProyecto,
	progresoDe,
	tablero,
} from "./kanban.ts";
import { navProyectos, prefijo, proyectoActual } from "./proyectos.ts";

const ESTADOS: readonly Estado[] = ["backlog", "prepared", "doing", "done", "finished"];

/** Las tres clases de encargo, con el nombre que se lee en el desplegable. */
const TIPOS: readonly { valor: TipoTarea; texto: string }[] = [
	{ valor: "tarea", texto: "Tarea" },
	{ valor: "pregunta", texto: "Pregunta" },
	{ valor: "funcionalidad", texto: "Funcionalidad" },
];

/** Cómo se resuelve quién creó una tarea. Se construye una vez por página. */
type Creador = (quien: QuienCreo) => Html | null;

/** Lo que se puede filtrar en la lista. Vacío es no filtrar por ese campo. */
type FiltrosLista = Filtros & {
	estado: string;
};

/** Los valores de los campos de una tarea, para pintar el formulario relleno. */
type ValoresTarea = {
	titulo: string;
	descripcion: string;
	tipo: TipoTarea;
	/** Proyecto en el que vive. Nulo es «el que traiga la ruta, o el principal». */
	proyectoId: number | null;
	/** Rama de git en la que se trabaja. Una parte hereda la de su funcionalidad. */
	rama: string | null;
	/** La funcionalidad de la que esta tarea es parte, si cuelga de alguna. */
	padreId: number | null;
	/** Tareas que tienen que estar hechas antes que esta. */
	dependeDe: number[];
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
	proyectoId: null,
	rama: null,
	padreId: null,
	dependeDe: [],
	autoejecucion: true,
	analisisModelo: null,
	analisisTerminalId: null,
	ejecucionModelo: null,
	ejecucionTerminalId: null,
};

/**
 * Lo que el formulario de tarea necesita de la base: los terminales que se
 * pueden asignar, las funcionalidades que pueden ser su padre y las tareas de
 * las que puede depender. Ni una funcionalidad cerrada ni la propia tarea
 * entran en las listas: la primera ya no admite partes y la segunda no puede
 * depender de sí misma.
 */
type OpcionesTarea = {
	activos: TerminalListado[];
	padres: ItemIndice[];
	candidatas: ItemIndice[];
	/** Entre qué proyectos se elige, o `null` si lo fija la ruta del tablero. */
	proyectos: Proyecto[] | null;
};

function opcionesDeTarea(db: DatabaseSync, tareaId: number | null, conProyecto = true): OpcionesTarea {
	const items = listarTareas(db);
	return {
		activos: terminalesActivos(db),
		padres: items.filter((item) => item.tipo === "funcionalidad" && item.estado !== "finished" && item.id !== tareaId),
		candidatas: items.filter((item) => item.estado !== "finished" && item.id !== tareaId),
		proyectos: conProyecto ? listarProyectos(db) : null,
	};
}

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

/** El tipo elegido en el desplegable. Cualquier otra cosa es una tarea normal. */
function tipoDeFormulario(formulario: Formulario): TipoTarea {
	const valor = campo(formulario, "tipo");
	return esTipoTarea(valor) ? valor : "tarea";
}

/** Los identificadores de un desplegable, saltándose los que no tienen la forma buena. */
function idsDeFormulario(formulario: Formulario, nombre: string): number[] {
	const ids: number[] = [];
	for (const valor of campoLista(formulario, nombre)) {
		const id = idONull(valor);
		if (id !== null) {
			ids.push(id);
		}
	}
	return ids;
}

/**
 * Lo que el humano escribió, sin comprobar nada. Es lo que se le devuelve
 * cuando algo falla, para que no pierda lo que llevaba escrito.
 */
function valoresCrudos(formulario: Formulario): ValoresTarea {
	const tipo = tipoDeFormulario(formulario);
	// En una pregunta no hay ejecución que asignar: el formulario no enseña esos
	// campos, así que lo que llegue en ellos se ignora en vez de guardarse a
	// medias. Una funcionalidad sí los lleva, porque sus partes los heredan;
	// lo que no tiene es autoejecución, que en ella siempre aprueba el humano.
	const esPregunta = tipo === "pregunta";
	return {
		titulo: campo(formulario, "titulo"),
		descripcion: campo(formulario, "descripcion"),
		tipo,
		proyectoId: numeroONull(campo(formulario, "proyecto")),
		rama: campoOpcional(formulario, "rama"),
		padreId: idONull(campo(formulario, "padre")),
		dependeDe: idsDeFormulario(formulario, "dependeDe"),
		autoejecucion: tipo !== "tarea" || marcado(formulario, "autoejecucion"),
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
 * El desplegable del proyecto. Una tarea cambia de proyecto solo en `backlog`
 * y solo si está sola: la regla la comprueba la base al guardar.
 */
function selectProyecto(proyectos: Proyecto[], elegido: number | null): Html {
	const principal = elegido ?? PROYECTO_PRINCIPAL;
	return html`<label>
			<span>Proyecto</span>
			<select name="proyecto">
				${proyectos.map(
					(cual) =>
						html`<option value="${cual.id}"${cual.id === principal ? raw(" selected") : ""}>${cual.clave} · ${cual.nombre}</option>`,
				)}
			</select>
			<span class="ayuda">El repositorio en el que vive. Solo se cambia en backlog y si la tarea no cuelga de nada.</span>
		</label>`;
}

/** El desplegable del tipo: qué clase de encargo es esta tarea. */
function selectTipo(elegido: TipoTarea): Html {
	return html`<label>
			<span>Tipo</span>
			<select name="tipo">
				${TIPOS.map(
					(cual) =>
						html`<option value="${cual.valor}"${cual.valor === elegido ? raw(" selected") : ""}>${cual.texto}</option>`,
				)}
			</select>
			<span class="ayuda">Una pregunta se cierra con su respuesta; una funcionalidad se descompone en partes.</span>
		</label>`;
}

/** El desplegable de la funcionalidad de la que esta tarea es una parte. */
function selectPadre(padres: ItemIndice[], elegido: number | null): Html {
	return html`<label>
			<span>Parte de la funcionalidad</span>
			<select name="padre">
				<option value=""${elegido === null ? raw(" selected") : ""}>ninguna</option>
				${padres.map(
					(padre) =>
						html`<option value="${formatearId(padre.id)}"${padre.id === elegido ? raw(" selected") : ""}>${formatearId(padre.id)} · ${padre.titulo}</option>`,
				)}
			</select>
			<span class="ayuda">Si la eliges, esta tarea es una de sus partes y hereda su rama.</span>
		</label>`;
}

/**
 * Las dependencias, como desplegable de varias opciones. Se guardan por el
 * identificador de cada tarea, que es lo que el humano ve en el tablero.
 */
function selectDependencias(candidatas: ItemIndice[], elegidas: number[]): Html {
	if (candidatas.length === 0) {
		return html`<p class="nombre-campo">Dependencias</p>
			<p class="silencio">No hay ninguna otra tarea abierta de la que depender.</p>`;
	}
	return html`<label>
			<span>Depende de</span>
			<select name="dependeDe" multiple size="6">
				${candidatas.map(
					(otra) =>
						html`<option value="${formatearId(otra.id)}"${elegidas.includes(otra.id) ? raw(" selected") : ""}>${formatearId(otra.id)} · ${otra.estado} · ${otra.titulo}</option>`,
				)}
			</select>
			<span class="ayuda">Esta tarea espera a que las elegidas estén hechas. Se marcan varias con la tecla de control.</span>
		</label>`;
}

/**
 * El formulario de una tarea, compartido por «Nueva tarea» y «Editar». En una
 * pregunta no se pintan ni la autoejecución ni la ejecución: esa tarea solo
 * tiene fase de análisis y el comentario de análisis la cierra. Una
 * funcionalidad no tiene autoejecución (su descomposición la aprueba siempre
 * el humano), pero sí asignaciones: son las que heredan sus partes.
 */
function camposTarea(valores: ValoresTarea, opciones: OpcionesTarea): Html {
	const esPregunta = valores.tipo === "pregunta";
	const esFuncionalidad = valores.tipo === "funcionalidad";
	const autoejecucion =
		valores.tipo === "tarea"
			? casilla(
					"autoejecucion",
					valores.autoejecucion,
					"Autoejecución",
					"La ejecución arranca sola cuando el análisis termina sin preguntas abiertas.",
				)
			: html``;
	const ejecucion = esPregunta
		? html``
		: fase(
				esFuncionalidad ? "Ejecución de las partes (por defecto)" : "Ejecución",
				"ejecucion",
				valores.ejecucionModelo,
				valores.ejecucionTerminalId,
				opciones.activos,
			);
	return html`<label>
			<span>Título</span>
			<input type="text" name="titulo" value="${valores.titulo}" required>
		</label>
		<label>
			<span>Descripción (Markdown)</span>
			<textarea name="descripcion" rows="10">${valores.descripcion}</textarea>
		</label>
		${opciones.proyectos === null ? html`` : selectProyecto(opciones.proyectos, valores.proyectoId)}
		${selectTipo(valores.tipo)}
		<label>
			<span>Rama</span>
			<input type="text" name="rama" value="${valores.rama ?? ""}" placeholder="evolutivo/csv">
			<span class="ayuda">Los agentes trabajarán en esta rama.</span>
		</label>
		${esFuncionalidad ? html`` : selectPadre(opciones.padres, valores.padreId)}
		${selectDependencias(opciones.candidatas, valores.dependeDe)}
		${autoejecucion}
		<datalist id="modelos">${MODELOS_SUGERIDOS.map((modelo) => html`<option value="${modelo}"></option>`)}</datalist>
		<div class="fases">
			${fase(
				esFuncionalidad ? "Análisis de la funcionalidad" : "Análisis",
				"analisis",
				valores.analisisModelo,
				valores.analisisTerminalId,
				opciones.activos,
			)}
			${ejecucion}
		</div>`;
}

// --- la lista ----------------------------------------------------------------

function filaTarea(
	db: DatabaseSync,
	item: ItemIndice,
	creadorDe: Creador,
	deQuien: Funcionalidades,
	claves: Claves,
): Html {
	const tarea = buscarTarea(db, item.id);
	const creador =
		tarea === undefined
			? null
			: creadorDe({ usuarioId: tarea.creadaPorUsuarioId, terminalId: tarea.creadaPorTerminalId });
	const funcionalidad = item.padreId === null ? undefined : deQuien.get(item.padreId);
	const clave = claves?.get(item.proyectoId);
	return html`<tr>
			<td>${enlaceTarea(item.id)} ${clave === undefined ? html`` : chipProyecto(clave)}</td>
			<td>
				${insigniaTipoDeItem(item)}${insigniasMarcas(item.marcas)}${progresoDe(item)}${item.titulo}
				${
					funcionalidad === undefined || item.padreId === null
						? html``
						: html`<span class="pequeno">${enlaceFuncionalidad(item.padreId, funcionalidad)}</span>`
				}
			</td>
			<td class="pequeno">${faseLegible(item.analisisModelo, item.analisisTerminal)}</td>
			<td class="pequeno">${ejecucionLegible(item.tipo, item.ejecucionModelo, item.ejecucionTerminal)}</td>
			<td class="numero pequeno">${item.tokensConHijas === 0 ? html`` : tokensAbreviados(item.tokensConHijas)}</td>
			<td>${creador ?? SIN_DATO}</td>
			<td class="pequeno">${edadEnColumna(item)}</td>
		</tr>`;
}

/** La clave de cada proyecto, solo en la vista cruzada: acotada sobraría. */
type Claves = Map<number, string> | null;

function tablaLista(
	db: DatabaseSync,
	items: ItemIndice[],
	creadorDe: Creador,
	deQuien: Funcionalidades,
	claves: Claves,
): Html {
	if (items.length === 0) {
		return html`<p class="silencio">Ninguna.</p>`;
	}
	return html`<div class="tabla-envuelta">
			<table>
				<thead>
					<tr>
						<th>Id</th><th>Título</th><th>Análisis</th><th>Ejecución</th>
						<th class="numero">Tokens</th><th>Creada por</th><th>En columna</th>
					</tr>
				</thead>
				<tbody>${items.map((item) => filaTarea(db, item, creadorDe, deQuien, claves))}</tbody>
			</table>
		</div>`;
}

function grupoColumna(
	db: DatabaseSync,
	columna: { estado: Estado; titulo: string },
	items: ItemIndice[],
	creadorDe: Creador,
	deQuien: Funcionalidades,
	claves: Claves,
): Html {
	const tabla = tablaLista(db, items, creadorDe, deQuien, claves);
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

/** El título de cada funcionalidad, por su identificador. Una lectura por página. */
type Funcionalidades = Map<number, string>;

/**
 * Los títulos de las funcionalidades que aparecen como padres en esa lista de
 * tareas. Una hija de trabajo cuelga de una tarea normal: eso no es ser parte
 * de una funcionalidad y no se enseña.
 */
function funcionalidadesDe(db: DatabaseSync, items: ItemIndice[]): Funcionalidades {
	const titulos: Funcionalidades = new Map();
	for (const item of items) {
		if (item.padreId === null || titulos.has(item.padreId)) {
			continue;
		}
		const padre = buscarTarea(db, item.padreId);
		if (padre !== undefined && padre.tipo === "funcionalidad") {
			titulos.set(item.padreId, padre.titulo);
		}
	}
	return titulos;
}

/**
 * La fila de filtros: desplegables compactos y nada más. «Quitar filtros» solo
 * aparece cuando hay algo que quitar; si no, sería un enlace que no hace nada.
 */
function formularioFiltros(
	db: DatabaseSync,
	activos: TerminalListado[],
	filtros: FiltrosLista,
	acotado: Proyecto | undefined,
): Html {
	const { estado, terminal, marca, padre } = filtros;
	const base = `${prefijo(acotado)}/tareas`;
	const hayFiltro =
		estado !== "" ||
		terminal !== "" ||
		marca !== "" ||
		padre !== "" ||
		filtros.rapido !== "" ||
		filtros.q !== "" ||
		(acotado === undefined && filtros.proyecto !== "");
	return html`<div class="fila-filtros">
		${filtrosRapidos(filtros.rapido, base, consultaDe(filtros, acotado))}
		<form class="filtros" method="get" action="${base}">
			${filtros.rapido === "" ? html`` : html`<input type="hidden" name="rapido" value="${filtros.rapido}">`}
			<input type="search" name="q" value="${filtros.q}" placeholder="Buscar">
			${acotado !== undefined ? html`` : filtroSelect(opcionesProyecto(db, filtros.proyecto))}
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
			${filtroSelect(opcionesFuncionalidad(db, padre))}
			<button type="submit" class="pequeno">Filtrar</button>
			${hayFiltro ? html`<a class="quitar" href="${base}">Quitar filtros</a>` : html``}
		</form>
	</div>`;
}

// --- la ficha ----------------------------------------------------------------

/** Quién creó la tarea y cuándo. Sin creador conocido queda solo la fecha. */
function creadaLegible(tarea: Tarea, creadorDe: Creador): Html {
	const quien = creadorDe({ usuarioId: tarea.creadaPorUsuarioId, terminalId: tarea.creadaPorTerminalId });
	const cuando = html`<span class="silencio">${fechaLegible(tarea.creada)}</span>`;
	return quien === null ? cuando : html`${quien} ${cuando}`;
}

/** El proyecto de la tarea: su chip, enlazado a su tablero, y su nombre. */
function proyectoLegible(db: DatabaseSync, proyectoId: number): Html {
	const proyecto = buscarProyectoPorId(db, proyectoId);
	if (proyecto === undefined) {
		return html`<span class="silencio">${SIN_DATO}</span>`;
	}
	return html`<a href="/p/${proyecto.clave}/tareas">${chipProyecto(proyecto.clave)}</a> ${proyecto.nombre}`;
}

/**
 * El estado de la tarea con cuánto lleva en él. La edad se cuenta desde la
 * pregunta abierta más antigua cuando la tarea está bloqueada, que es lo que
 * hace la lista y el kanban: aquí se compone con lo que ya trae la ficha.
 */
function estadoLegible(completa: TareaCompleta): Html {
	const { tarea } = completa;
	const insignia = insigniaEstado(tarea.estado);
	if (!muestraEdad(tarea.estado)) {
		return insignia;
	}
	const abiertas = completa.preguntas.filter((pregunta) => pregunta.respuestaOpcion === null);
	const edad = edadEnColumna({
		estado: tarea.estado,
		marcas: completa.marcas,
		estadoDesde: tarea.estadoDesde,
		bloqueadaDesde: abiertas.map((pregunta) => pregunta.creada).sort()[0] ?? null,
	});
	return html`${insignia} <span class="silencio">desde hace ${edad}</span>`;
}

/** La rama en la que se trabaja la tarea, o que no hay ninguna. */
function ramaLegible(rama: string | null): Html {
	return rama === null ? html`<span class="silencio">ninguna</span>` : html`<code>${rama}</code>`;
}

/** La funcionalidad de la que la tarea es parte: su estado, su enlace y su título. */
function padreLegible(db: DatabaseSync, padreId: number | null): Html {
	if (padreId === null) {
		return html`<span class="silencio">ninguno</span>`;
	}
	const padre = buscarTarea(db, padreId);
	if (padre === undefined) {
		return enlaceTarea(padreId);
	}
	return html`${insigniaEstado(padre.estado)} ${enlaceTarea(padreId)} ${padre.titulo}`;
}

/**
 * De qué depende la tarea: el estado de cada una y su enlace. Las que todavía
 * no están hechas van en naranja, que es el color de lo que frena: son las
 * que mantienen la marca `esperando`.
 */
function dependenciasLegibles(db: DatabaseSync, tareaId: number, dependeDe: readonly number[]): Html {
	if (dependeDe.length === 0) {
		return html`<span class="silencio">ninguna</span>`;
	}
	const pendientes = new Set(dependenciasPendientes(db, tareaId));
	return html`<span class="dependencias">
			${dependeDe.map((otraId) => {
				const otra = buscarTarea(db, otraId);
				const insignia =
					otra === undefined
						? html``
						: etiqueta(otra.estado, pendientes.has(otraId) ? "naranja" : COLOR_ESTADO[otra.estado], `estado-${otra.estado}`);
				return html`<span class="dependencia">${insignia} ${enlaceTarea(otraId)}</span>`;
			})}
		</span>`;
}

/**
 * Las propiedades de la tarea, en filas de dos columnas. Una pregunta no
 * enseña ejecución ni autoejecución: enseñarlas haría creer que después del
 * análisis viene otra fase.
 */
function propiedadesDeTarea(db: DatabaseSync, completa: TareaCompleta, creadorDe: Creador): Html {
	const { tarea } = completa;
	if (tarea.tipo === "funcionalidad") {
		return propiedadesDeFuncionalidad(db, completa, creadorDe);
	}
	const filas: Propiedad[] = [
		{ nombre: "Estado", valor: estadoLegible(completa) },
		{ nombre: "Proyecto", valor: proyectoLegible(db, tarea.proyectoId) },
	];
	if (tarea.tipo === "pregunta") {
		filas.push({ nombre: "Tipo", valor: insigniaTipoTarea(tarea.tipo) });
	}
	filas.push({ nombre: "Rama", valor: ramaLegible(tarea.rama) });
	filas.push({ nombre: "Análisis", valor: faseLegible(tarea.analisisModelo, completa.analisisTerminal) });
	if (tarea.tipo !== "pregunta") {
		filas.push({ nombre: "Ejecución", valor: faseLegible(tarea.ejecucionModelo, completa.ejecucionTerminal) });
		filas.push({ nombre: "Autoejecución", valor: tarea.autoejecucion ? "activada" : "desactivada" });
	}
	filas.push({ nombre: "Padre", valor: padreLegible(db, tarea.padreId) });
	filas.push({ nombre: "Dependencias", valor: dependenciasLegibles(db, tarea.id, completa.dependeDe) });
	filas.push({ nombre: "Orden", valor: String(tarea.orden) });
	filas.push({ nombre: "Creada", valor: creadaLegible(tarea, creadorDe) });
	filas.push({ nombre: "Revisión", valor: String(tarea.revision) });
	return propiedades(filas);
}

/**
 * Las de una funcionalidad. No tiene ejecución propia ni autoejecución: lo que
 * se ejecuta son sus partes, y lo que cuesta es lo que cuestan ellas.
 */
function propiedadesDeFuncionalidad(db: DatabaseSync, completa: TareaCompleta, creadorDe: Creador): Html {
	const { tarea } = completa;
	const filas: Propiedad[] = [
		{ nombre: "Estado", valor: estadoLegible(completa) },
		{ nombre: "Proyecto", valor: proyectoLegible(db, tarea.proyectoId) },
		{ nombre: "Tipo", valor: insigniaTipoTarea(tarea.tipo) },
		{ nombre: "Rama", valor: ramaLegible(tarea.rama) },
		{
			nombre: "Partes",
			// Sin partes no hay barra que pintar: todavía no está descompuesta.
			valor:
				completa.partes === 0
					? html`<span class="silencio">ninguna</span>`
					: barraProgreso(completa.partesCerradas ?? 0, completa.partes ?? 0, "partes"),
		},
		{ nombre: "Análisis", valor: faseLegible(tarea.analisisModelo, completa.analisisTerminal) },
		{ nombre: "Ejecución de las partes", valor: faseLegible(tarea.ejecucionModelo, completa.ejecucionTerminal) },
	];
	if (completa.dependeDe.length > 0) {
		filas.push({ nombre: "Dependencias", valor: dependenciasLegibles(db, tarea.id, completa.dependeDe) });
	}
	filas.push({ nombre: "Consumo de las partes", valor: `${numeroLegible(completa.consumo.totalConHijas)} tokens` });
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

/**
 * Un comentario del hilo de la ficha. Una pregunta abierta se enseña aquí sin
 * formulario: el suyo está arriba del todo, y desde aquí se va a él. El humano
 * llega a la ficha a contestar y no tiene que bajar hasta el final.
 */
function comentarioDeLaFicha(completa: TareaCompleta, comentario: Comentario, colorDe: ColorDe): Html {
	const pregunta =
		comentario.tipo === "pregunta" && comentario.preguntaId !== null
			? completa.preguntas.find((candidata) => candidata.id === comentario.preguntaId)
			: undefined;
	const abierta = pregunta !== undefined && pregunta.respuestaOpcion === null;
	return tarjetaComentario(comentario, colorDe, {
		numero: pregunta?.numero ?? null,
		extra:
			abierta && pregunta !== undefined
				? html`<p class="responder-arriba"><a href="#pregunta-${formatearId(completa.tarea.id)}-P${pregunta.numero}">Responder arriba</a></p>`
				: html``,
	});
}

/** Los tres filtros del hilo: qué tipos de comentario deja pasar cada uno. */
const FILTROS_HILO: readonly { valor: string; texto: string; tipos: readonly TipoComentario[] }[] = [
	{ valor: "", texto: "Todo", tipos: [] },
	{ valor: "preguntas", texto: "Preguntas y respuestas", tipos: ["pregunta", "respuesta"] },
	{ valor: "avances", texto: "Avances y resultados", tipos: ["avance", "resultado"] },
];

/**
 * Los enlaces del filtro, sobre la misma dirección. Sin JavaScript: es un
 * parámetro de la URL. Un valor desconocido no filtra nada, como «Todo».
 */
function filtroHilo(id: string, elegido: string): Html {
	return html`<nav class="filtro-hilo" aria-label="Qué se ve del hilo">
			${FILTROS_HILO.map((filtro) => {
				const activo = filtro.valor === elegido;
				const href = filtro.valor === "" ? `/tareas/${id}` : `/tareas/${id}?hilo=${filtro.valor}`;
				return html`<a href="${href}"${activo ? raw(' aria-current="page"') : ""}>${filtro.texto}</a>`;
			})}
		</nav>`;
}

function hilo(completa: TareaCompleta, colorDe: ColorDe, elegido: string): Html {
	const filtro = FILTROS_HILO.find((candidato) => candidato.valor === elegido);
	const tipos = filtro === undefined ? [] : filtro.tipos;
	const comentarios =
		tipos.length === 0 ? completa.comentarios : completa.comentarios.filter((cual) => tipos.includes(cual.tipo));
	if (comentarios.length === 0) {
		return html`<p class="silencio">Ninguno.</p>`;
	}
	return html`<div class="hilo">
			${comentarios.map((comentario) => comentarioDeLaFicha(completa, comentario, colorDe))}
		</div>`;
}

/**
 * Las preguntas abiertas, arriba del todo y a todo lo ancho: es a lo que el
 * humano viene. La tarjeta es la misma que enseña la bandeja.
 */
function preguntasArriba(completa: TareaCompleta): Html {
	const abiertas = completa.preguntas.filter((pregunta) => pregunta.respuestaOpcion === null);
	if (abiertas.length === 0) {
		return html``;
	}
	return html`<section class="preguntas-arriba">
			${abiertas.map((pregunta) => tarjetaPreguntaAbierta(completa.tarea, pregunta))}
		</section>`;
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
	// En una funcionalidad, lo que se aprueba es su descomposición en partes.
	if (completa.tarea.estado === "prepared" && completa.marcas.includes("análisis listo")) {
		const texto = completa.tarea.tipo === "funcionalidad" ? "Aprobar descomposición" : "Aprobar ejecución";
		return html`<form method="post" action="/tareas/${id}/aprobar">
				<button type="submit" class="principal">${texto}</button>
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

/**
 * Editar solo en `backlog`: al salir, la descripción y las asignaciones se
 * congelan.
 */
function detallesEditar(db: DatabaseSync, tarea: Tarea, dependeDe: number[]): Html {
	if (tarea.estado !== "backlog") {
		return html``;
	}
	const id = formatearId(tarea.id);
	return html`<details class="caja">
			<summary><strong>Editar</strong></summary>
			<form method="post" action="/tareas/${id}/editar">
				${camposTarea(
					{
						titulo: tarea.titulo,
						descripcion: tarea.descripcion,
						tipo: tarea.tipo,
						proyectoId: tarea.proyectoId,
						rama: tarea.rama,
						padreId: tarea.padreId,
						dependeDe,
						autoejecucion: tarea.autoejecucion,
						analisisModelo: tarea.analisisModelo,
						analisisTerminalId: tarea.analisisTerminalId,
						ejecucionModelo: tarea.ejecucionModelo,
						ejecucionTerminalId: tarea.ejecucionTerminalId,
					},
					opcionesDeTarea(db, tarea.id),
				)}
				<div class="acciones">
					<button type="submit" class="principal">Guardar cambios</button>
				</div>
			</form>
		</details>`;
}

/**
 * Borrar, al final y en cualquier columna: es la salida de una tarea que ya no
 * va a ninguna parte. Plegado como las vueltas atrás, porque es igual de
 * excepcional; lo que se lleva por delante lo cuenta la confirmación.
 */
function detallesBorrar(tarea: Tarea): Html {
	const id = formatearId(tarea.id);
	return html`<details class="caja">
			<summary><strong>Borrar</strong></summary>
			<p class="silencio">Se lleva el hilo entero y no se puede deshacer.</p>
			<p><a class="accion-peligro" href="/tareas/${id}/borrar">Borrar esta tarea</a></p>
		</details>`;
}

// --- páginas -----------------------------------------------------------------

/**
 * Las migas de la ficha y de lo que cuelga de ella: `WEB › Tareas › T-0042`.
 * La clave lleva al kanban del proyecto y «Tareas», a su lista.
 */
function migasDeFicha(db: DatabaseSync, proyectoId: number, ...donde: string[]): Miga[] {
	const proyecto = buscarProyectoPorId(db, proyectoId);
	const base = proyecto === undefined ? "" : `/p/${proyecto.clave}`;
	const migas: Miga[] = proyecto === undefined ? [] : [{ texto: proyecto.clave, href: `${base}/tareas/kanban` }];
	migas.push({ texto: "Tareas", href: `${base}/tareas` });
	for (const [indice, texto] of donde.entries()) {
		// El último es donde se está: no enlaza. Los de en medio, a la ficha.
		migas.push(indice === donde.length - 1 ? { texto } : { texto, href: `/tareas/${texto}` });
	}
	return migas;
}

function paginaNoEncontrada(c: Context, deps: DependenciasWeb, mensaje: string): RespuestaHtml {
	return c.html(
		pagina({
			...navProyectos(c, deps.db),
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
	const acotado = proyectoActual(c);
	const filtros: FiltrosLista = { ...filtrosDe(c), estado: c.req.query("estado") ?? "" };
	const padreId = idONull(filtros.padre);

	// Terminal, proyecto, conmutador y búsqueda los resuelve el índice; aquí
	// quedan los que son de esta vista.
	const items = listarTareas(db, filtroDeIndice(db, filtros)).filter((item) => {
		if (esEstado(filtros.estado) && item.estado !== filtros.estado) {
			return false;
		}
		if (esMarca(filtros.marca) && !item.marcas.includes(filtros.marca)) {
			return false;
		}
		// Un identificador que no encaja no es un error del que avisar: no
		// selecciona ninguna tarea y la lista sale vacía.
		return filtros.padre === "" || item.padreId === padreId;
	});

	// Un solo buscador para toda la tabla: la lista pinta una fila por tarea y
	// no puede consultar usuarios y terminales en cada una.
	const creadorDe = buscadorDeCreador(db);
	const deQuien = funcionalidadesDe(db, items);
	// En la vista acotada el proyecto es el de la página: el chip solo repetiría.
	const claves = acotado === undefined ? new Map(listarProyectos(db).map((cual) => [cual.id, cual.clave])) : null;
	const cuerpo = html`${formularioFiltros(db, activos, filtros, acotado)}
		${COLUMNAS.map((columna) =>
			grupoColumna(
				db,
				columna,
				items.filter((item) => item.estado === columna.estado),
				creadorDe,
				deQuien,
				claves,
			),
		)}`;
	// `vista` y `revision` son lo que el cliente necesita para refrescarse: la
	// lista se recarga entera cuando sube la revisión.
	return c.html(
		pagina({
			...navProyectos(c, db),
			titulo: acotado === undefined ? "Tareas" : `Tareas · ${acotado.clave}`,
			usuario: usuarioActual(c),
			vista: "lista",
			// La tabla tiene seis columnas: en 60 rem se aprieta o se desplaza.
			ancho: "completo",
			revision: revisionActual(db),
			acciones: accionNuevaTarea(prefijo(acotado)),
			cuerpo,
		}),
	);
}

/**
 * Lo que trae puesto el formulario de alta según de dónde se venga: «Nueva
 * funcionalidad» abre con el tipo elegido y «Nueva parte», con su
 * funcionalidad como padre.
 */
function valoresIniciales(c: Context): ValoresTarea {
	const tipo = c.req.query("tipo") ?? "";
	const padre = c.req.query("padre") ?? "";
	return {
		...TAREA_VACIA,
		tipo: esTipoTarea(tipo) ? tipo : "tarea",
		padreId: idONull(padre),
	};
}

function paginaNueva(c: Context, deps: DependenciasWeb, valores: ValoresTarea, aviso: string | null): RespuestaHtml {
	const esFuncionalidad = valores.tipo === "funcionalidad";
	// Desde un tablero acotado el proyecto viene en la ruta y no se elige: la
	// tarea nace donde se está mirando.
	const acotado = proyectoActual(c);
	const base = prefijo(acotado);
	const cuerpo = html`<form method="post" action="${base}/tareas">
			${camposTarea(valores, opcionesDeTarea(deps.db, null, acotado === undefined))}
			<div class="acciones">
				<button type="submit" class="principal">${esFuncionalidad ? "Crear funcionalidad" : "Crear tarea"}</button>
				<a class="boton" href="${valores.padreId === null ? `${base}/tareas` : `/tareas/${formatearId(valores.padreId)}`}">Cancelar</a>
			</div>
		</form>`;
	const titulo = esFuncionalidad ? "Nueva funcionalidad" : "Nueva tarea";
	return c.html(
		pagina({
			...navProyectos(c, deps.db),
			titulo,
			usuario: usuarioActual(c),
			vista: "tarea-nueva",
			migas: [{ texto: "Tareas", href: `${base}/tareas` }, { texto: titulo }],
			etiquetas: acotado === undefined ? undefined : chipProyecto(acotado.clave),
			aviso,
			cuerpo,
		}),
		aviso === null ? 200 : ESTADO_AVISO,
	);
}

function paginaFicha(c: Context, deps: DependenciasWeb, tareaId: number, aviso: string | null): RespuestaHtml {
	const completa = leerTarea(deps.db, tareaId);
	if (completa === undefined) {
		return paginaNoEncontrada(c, deps, `No existe la tarea ${formatearId(tareaId)}.`);
	}
	const { tarea } = completa;
	const id = formatearId(tarea.id);
	// El color de un autor se busca al pintar, y el hilo tiene muchos: una sola
	// lectura de la tabla de usuarios para toda la página.
	const colorDe = buscadorDeColor(deps.db);

	const comun = html`<h2>Hilo</h2>
		${filtroHilo(id, c.req.query("hilo") ?? "")}
		${hilo(completa, colorDe, c.req.query("hilo") ?? "")}

		<h2>Nota</h2>
		<form method="post" action="/tareas/${id}/nota">
			<label>
				<span>Indicación para el agente (Markdown)</span>
				<textarea name="texto" rows="4" required></textarea>
			</label>
			<div class="acciones">
				<button type="submit">Añadir nota</button>
			</div>
		</form>`;

	const descripcion = html`<h2>Descripción</h2>
		<div class="cuerpo">${raw(renderMarkdown(tarea.descripcion))}</div>`;

	const actividad = html`<h2>Actividad</h2>
		${actividadDeTarea(deps.db, tarea.id, colorDe)}`;

	// La ficha de una funcionalidad es su propio tablero: encima lo que se
	// decidió, debajo las partes en las que se descompuso.
	const principal =
		tarea.tipo === "funcionalidad"
			? html`${descripcion}
				${comun}

				<h2>Partes</h2>
				<div class="acciones acciones-partes">
					<a class="boton" href="/tareas/nueva?padre=${id}">Nueva parte</a>
				</div>
				${tablero(deps.db, { terminal: "", marca: "", padre: id, proyecto: "", rapido: "", q: "" })}

				${actividad}`
			: html`${descripcion}

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

				${comun}
				${actividad}`;

	// A partir de 64 rem el panel se va a la derecha y se queda fijo al hacer
	// scroll; por debajo cae encima de la descripción. Lleva lo que se consulta
	// (propiedades y consumo) y lo excepcional, que va plegado.
	const panel = html`<aside class="panel">
		${propiedadesDeTarea(deps.db, completa, buscadorDeCreador(deps.db))}
		${
			tarea.tipo === "funcionalidad"
				? html``
				: html`<h2>Consumo</h2>
					${tablaConsumo(completa.consumo)}`
		}
		${vueltasAtras(completa)}
		${detallesEditar(deps.db, tarea, completa.dependeDe)}
		${detallesBorrar(tarea)}
	</aside>`;

	const cuerpo = html`${preguntasArriba(completa)}
		<div class="ficha">
			<div class="principal">${principal}</div>
			${panel}
		</div>`;

	return c.html(
		// La ficha no se recarga sola: tiene formularios y el humano puede estar
		// escribiendo una nota. El cliente solo avisa; en una funcionalidad,
		// además, repinta el tablero de sus partes, que no tiene nada que perder.
		pagina({
			...navProyectos(c, deps.db),
			titulo: tarea.titulo,
			usuario: usuarioActual(c),
			vista: "ficha",
			revision: completa.revisionServidor,
			// La ficha es global, que el identificador lo es; las migas dicen de qué
			// proyecto es y llevan a sus tableros.
			migas: migasDeFicha(deps.db, tarea.proyectoId, id),
			etiquetas: html`${insigniaEstado(tarea.estado)}${insigniaTipoTarea(tarea.tipo)}${insigniasMarcas(completa.marcas)}`,
			// La ficha es una vista de incidencia: en ancho, el panel de la derecha
			// necesita sitio, y el tablero de una funcionalidad, sus cinco columnas.
			ancho: "completo",
			acciones: accionesFicha(completa),
			aviso,
			cuerpo,
		}),
		aviso === null ? 200 : ESTADO_AVISO,
	);
}

/** Lo que se pierde del hilo, dicho en una línea. */
function hiloQueSeVa(comentarios: number): string {
	if (comentarios === 0) {
		return "Todavía no tiene hilo: no se pierde ningún comentario.";
	}
	return comentarios === 1 ? "Se va su hilo entero: 1 comentario." : `Se va su hilo entero: ${comentarios} comentarios.`;
}

/**
 * La confirmación de un borrado, en su propia página: sin JavaScript, el
 * enlace de la ficha lleva aquí y aquí está el POST, como el borrado de un
 * usuario o la revocación de un terminal. Dice qué se lleva por delante, que
 * es lo que el humano necesita ver antes de confirmar.
 */
function paginaBorrar(c: Context, deps: DependenciasWeb, tareaId: number): RespuestaHtml {
	const completa = leerTarea(deps.db, tareaId);
	if (completa === undefined) {
		return paginaNoEncontrada(c, deps, `No existe la tarea ${formatearId(tareaId)}.`);
	}
	const { tarea } = completa;
	const id = formatearId(tarea.id);
	const enMarcha =
		tarea.enMarchaTerminalId === null ? undefined : buscarTerminalPorId(deps.db, tarea.enMarchaTerminalId);
	const dejanDeEsperar = dependientesDe(deps.db, tarea.id);
	const cuerpo = html`<section class="caja caja-estrecha">
		<p>Se borra la tarea ${enlaceTarea(tarea.id)} <strong>${tarea.titulo}</strong>, que está en ${tarea.estado}.</p>
		<ul>
			<li>${hiloQueSeVa(completa.comentarios.length)}</li>
			${
				completa.consumo.totalConHijas === 0
					? ""
					: html`<li>Sus ${numeroLegible(completa.consumo.totalConHijas)} tokens de consumo dejan de contar.</li>`
			}
			${
				enMarcha === undefined
					? ""
					: html`<li><strong>Ahora mismo la está trabajando ${enMarcha.nombre}</strong>: ese trabajo se corta.</li>`
			}
			${
				dejanDeEsperar.length === 0
					? ""
					: html`<li>
							Dejan de esperarla y podrán empezar:
							<ul>
								${dejanDeEsperar.map((otra) => html`<li>${enlaceTarea(otra.id)} ${otra.titulo}</li>`)}
							</ul>
						</li>`
			}
		</ul>
		<p class="silencio">
			No se puede deshacer. El rastro se queda en la actividad y el número ${id} no vuelve a usarse.
		</p>
		<div class="acciones">
			<form method="post" action="/tareas/${id}/borrar">
				<button type="submit" class="peligro">Sí, borrar</button>
			</form>
			<a class="boton" href="/tareas/${id}">Cancelar</a>
		</div>
	</section>`;
	return c.html(
		pagina({
			...navProyectos(c, deps.db),
			titulo: "Borrar tarea",
			usuario: usuarioActual(c),
			vista: "tarea",
			migas: migasDeFicha(deps.db, tarea.proyectoId, id, "Borrar"),
			cuerpo,
		}),
	);
}

// --- rutas -------------------------------------------------------------------

/**
 * A dónde vuelve una acción que ha salido bien. La bandeja del humano manda un
 * campo oculto `volver` porque contesta y aprueba sin abrir la ficha; desde la
 * propia ficha no viene ninguno y se vuelve a ella, como siempre. Solo se
 * acepta una ruta del propio servidor: lo valida `destinoSeguro`.
 */
function vuelta(formulario: Formulario, tareaId: number): string {
	return destinoSeguro(campo(formulario, "volver"), `/tareas/${formatearId(tareaId)}`);
}

/**
 * Dónde se pinta el mensaje cuando la acción rompe una regla: en la página
 * desde la que se lanzó. Quien viene de la bandeja se queda en la bandeja; el
 * resto vuelve a la ficha, como siempre.
 */
function paginaDeVuelta(
	c: Context,
	deps: DependenciasWeb,
	formulario: Formulario,
	tareaId: number,
	error: unknown,
): RespuestaHtml {
	const aviso = mensajeDeRegla(error);
	return vuelta(formulario, tareaId) === "/" ? paginaBandeja(c, deps, aviso) : paginaFicha(c, deps, tareaId, aviso);
}

/** Todas las rutas de tareas: lista, alta, ficha y las acciones del humano. */
export function registrarRutasTareas(app: Hono, deps: DependenciasWeb): void {
	app.get("/tareas", (c) => paginaLista(c, deps));
	app.get("/p/:clave/tareas", (c) => paginaLista(c, deps));

	// Antes de `/tareas/:id` para que «nueva» no se lea como identificador.
	app.get("/tareas/nueva", (c) => paginaNueva(c, deps, valoresIniciales(c), null));
	app.get("/p/:clave/tareas/nueva", (c) => paginaNueva(c, deps, valoresIniciales(c), null));

	// Desde un tablero acotado la tarea nace en ese proyecto; desde la vista
	// cruzada, en el que diga el desplegable.
	const crear = async (c: Context): Promise<RespuestaHtml> => {
		const formulario = await leerFormulario(c);
		const activos = terminalesActivos(deps.db);
		try {
			const { proyectoId, ...valores } = valoresDeFormulario(formulario, activos);
			const elegido = proyectoActual(c)?.id ?? proyectoId;
			const tarea = crearTareaHumana(deps.db, {
				...valores,
				usuarioId: usuarioActual(c).id,
				...(elegido === null ? {} : { proyectoId: elegido }),
			});
			return c.redirect(`/tareas/${formatearId(tarea.id)}`, 302);
		} catch (error) {
			return paginaNueva(c, deps, valoresCrudos(formulario), mensajeDeRegla(error));
		}
	};
	app.post("/tareas", crear);
	app.post("/p/:clave/tareas", crear);

	app.get("/tareas/:id", (c) => {
		const tareaId = idDeRuta(c);
		if (tareaId === null) {
			return paginaNoEncontrada(c, deps, "Eso no es un identificador de tarea; tiene la forma T-0042.");
		}
		return paginaFicha(c, deps, tareaId, null);
	});

	app.post("/tareas/:id/editar", async (c) => {
		const tareaId = idDeRuta(c);
		if (tareaId === null) {
			return paginaNoEncontrada(c, deps, "Eso no es un identificador de tarea; tiene la forma T-0042.");
		}
		const formulario = await leerFormulario(c);
		try {
			const { proyectoId, ...valores } = valoresDeFormulario(formulario, terminalesActivos(deps.db));
			editarTareaBacklog(deps.db, {
				...valores,
				tareaId,
				usuarioId: usuarioActual(c).id,
				...(proyectoId === null ? {} : { proyectoId }),
			});
			return c.redirect(`/tareas/${formatearId(tareaId)}`, 302);
		} catch (error) {
			return paginaFicha(c, deps, tareaId, mensajeDeRegla(error));
		}
	});

	app.get("/tareas/:id/borrar", (c) => {
		const tareaId = idDeRuta(c);
		if (tareaId === null) {
			return paginaNoEncontrada(c, deps, "Eso no es un identificador de tarea; tiene la forma T-0042.");
		}
		return paginaBorrar(c, deps, tareaId);
	});

	app.post("/tareas/:id/borrar", (c) => {
		const tareaId = idDeRuta(c);
		if (tareaId === null) {
			return paginaNoEncontrada(c, deps, "Eso no es un identificador de tarea; tiene la forma T-0042.");
		}
		try {
			const borrada = borrarTarea(deps.db, { tareaId, actor: { usuarioId: usuarioActual(c).id } });
			// Una parte vuelve al tablero de su funcionalidad, que es de donde se
			// estaba podando; una tarea suelta, a la lista.
			const destino = borrada.padreId === null ? "/tareas" : `/tareas/${formatearId(borrada.padreId)}`;
			return c.redirect(destino, 302);
		} catch (error) {
			return paginaFicha(c, deps, tareaId, mensajeDeRegla(error));
		}
	});

	app.post("/tareas/:id/mover", async (c) => {
		const tareaId = idDeRuta(c);
		if (tareaId === null) {
			return paginaNoEncontrada(c, deps, "Eso no es un identificador de tarea; tiene la forma T-0042.");
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
			return c.redirect(vuelta(formulario, tareaId), 302);
		} catch (error) {
			return paginaDeVuelta(c, deps, formulario, tareaId, error);
		}
	});

	app.post("/tareas/:id/aprobar", async (c) => {
		const tareaId = idDeRuta(c);
		if (tareaId === null) {
			return paginaNoEncontrada(c, deps, "Eso no es un identificador de tarea; tiene la forma T-0042.");
		}
		const formulario = await leerFormulario(c);
		try {
			aprobarEjecucion(deps.db, { tareaId, usuarioId: usuarioActual(c).id });
			return c.redirect(vuelta(formulario, tareaId), 302);
		} catch (error) {
			return paginaDeVuelta(c, deps, formulario, tareaId, error);
		}
	});

	app.post("/tareas/:id/nota", async (c) => {
		const tareaId = idDeRuta(c);
		if (tareaId === null) {
			return paginaNoEncontrada(c, deps, "Eso no es un identificador de tarea; tiene la forma T-0042.");
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
			return paginaNoEncontrada(c, deps, "Eso no es un identificador de tarea; tiene la forma T-0042.");
		}
		const completa = leerTarea(deps.db, tareaId);
		if (completa === undefined) {
			return paginaNoEncontrada(c, deps, `No existe la tarea ${formatearId(tareaId)}.`);
		}
		const numero = Number.parseInt((c.req.param("pregunta") ?? "").replace(/^P/, ""), 10);
		const pregunta = completa.preguntas.find((candidata) => candidata.numero === numero);
		if (pregunta === undefined) {
			return paginaNoEncontrada(c, deps, `La tarea ${formatearId(tareaId)} no tiene la pregunta indicada.`);
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
			return c.redirect(vuelta(formulario, tareaId), 302);
		} catch (error) {
			return paginaDeVuelta(c, deps, formulario, tareaId, error);
		}
	});
}
