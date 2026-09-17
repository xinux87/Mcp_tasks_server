import type { DatabaseSync } from "node:sqlite";
import type { Context, Hono } from "hono";
import { html, raw } from "hono/html";
import { type Actividad, actividadDe } from "../../db/actividad.ts";
import { type TerminalListado, terminalesActivos } from "../../db/admin.ts";
import { type Agente, listarAgentes } from "../../db/agentes.ts";
import { buscarTerminalPorId, revisionActual } from "../../db/consultas.ts";
import type { ConsumoDeTarea } from "../../db/consumo.ts";
import { dependenciasPendientes, dependientesDe } from "../../db/dependencias.ts";
import { editarTareaBacklog, exigirTitulo } from "../../db/edicion.ts";
import { type Comentario, comentarioHumano, iteracionesDe, responder, type TipoComentario } from "../../db/hilo.ts";
import { buscarProyectoPorId, listarProyectos, type Proyecto } from "../../db/proyectos.ts";
import {
	aprobarEjecucion,
	borrarTarea,
	buscarTarea,
	buscarTareaPorCodigo,
	crearTareaHumana,
	type Estado,
	esTipoTarea,
	type HijaDeTarea,
	type ItemIndice,
	idDeCodigo,
	idDeCodigoONull,
	leerTarea,
	liberarFase,
	listarTareas,
	type Marca,
	moverTareaHumano,
	type Tarea,
	type TareaCompleta,
	type TipoTarea,
} from "../../db/tareas.ts";
import { ErrorDeRegla } from "../../errores.ts";
import { formatearId, idONull } from "../../md/ids.ts";
import {
	accionNuevaTarea,
	barraProgreso,
	buscadorDeColor,
	buscadorDeCreador,
	COLOR_ESTADO,
	chipProyecto,
	chipUsuario,
	duenoDeColumna,
	edadEnColumna,
	enlaceFuncionalidad,
	esperaPorTi,
	etiqueta,
	fraseDeAccion,
	type Miga,
	muestraEdad,
	type Propiedad,
	pasosDelCiclo,
	propiedades,
	type QuienCreo,
	rotuloColumna,
} from "../componentes.ts";
import {
	duracionLegible,
	edad,
	faseLegible,
	fechaLegible,
	numeroLegible,
	SIN_DATO,
	tokensAbreviados,
	tokensConPresupuesto,
} from "../formatos.ts";
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
import {
	type ColorDe,
	cuadroDeComentar,
	separadorIteracion,
	tarjetaComentario,
	tarjetaPreguntaAbierta,
} from "../hilo.ts";
import { renderMarkdown } from "../markdown.ts";
import {
	COLUMNAS,
	type Html,
	insigniaColumna,
	insigniaEstado,
	insigniasMarcas,
	insigniaTipoDeItem,
	insigniaTipoTarea,
	MODELOS_SUGERIDOS,
	pagina,
	type RespuestaHtml,
} from "../plantilla.ts";
import { type DependenciasWeb, destinoSeguro, usuarioActual } from "../sesion.ts";
import { NOMBRE_COLUMNA, NOMBRE_ESTADO, NOMBRE_FASE, VOLVER_A_DEFINIR } from "../vocabulario.ts";
import { paginaBandeja } from "./bandeja.ts";
import {
	enCarriles,
	filaFiltros,
	filtroDeIndice,
	filtrosDe,
	franjasDe,
	MARCAS,
	migasDeTareas,
	PROPOSITO_TAREAS,
	progresoDe,
	seccionFranja,
	tablero,
} from "./kanban.ts";
import { navProyectos, prefijo, proyectoActual, proyectoDeLaBarra, proyectoDeTrabajo } from "./proyectos.ts";

const ESTADOS: readonly Estado[] = ["backlog", "prepared", "doing", "done", "finished"];

/** Para qué sirve el alta: lo que se decide aquí y hasta cuándo se puede cambiar. */
const PROPOSITO_ALTA = "Define qué quieres y quién lo analiza y lo ejecuta. Se podrá editar mientras esté por definir.";

/** Las tres clases de encargo, con el nombre que se lee en el desplegable. */
const TIPOS: readonly { valor: TipoTarea; texto: string }[] = [
	{ valor: "tarea", texto: "Tarea" },
	{ valor: "pregunta", texto: "Pregunta" },
	{ valor: "funcionalidad", texto: "Funcionalidad" },
];

/** Cómo se resuelve quién creó una tarea. Se construye una vez por página. */
type Creador = (quien: QuienCreo) => Html | null;

/** Los valores de los campos de una tarea, para pintar el formulario relleno. */
type ValoresTarea = {
	titulo: string;
	descripcion: string;
	tipo: TipoTarea;
	/** Rama de git en la que se trabaja. Una parte hereda la de su funcionalidad. */
	rama: string | null;
	/** Código de la funcionalidad de la que esta tarea es parte, si cuelga de alguna. */
	padre: string | null;
	/** Códigos de las tareas que tienen que estar hechas antes que esta. */
	dependeDe: string[];
	autoejecucion: boolean;
	/** Tope de tokens. `null` es sin tope; `NaN`, lo que el humano escribió y no era un número. */
	presupuesto: number | null;
	/** Papel de cada fase. Con él, el modelo y el terminal se copian del agente. */
	analisisAgenteId: number | null;
	analisisModelo: string | null;
	analisisTerminalId: number | null;
	ejecucionAgenteId: number | null;
	ejecucionModelo: string | null;
	ejecucionTerminalId: number | null;
};

const TAREA_VACIA: ValoresTarea = {
	titulo: "",
	descripcion: "",
	tipo: "pregunta",
	rama: null,
	padre: null,
	dependeDe: [],
	autoejecucion: true,
	presupuesto: null,
	analisisAgenteId: null,
	analisisModelo: "fable",
	analisisTerminalId: null,
	ejecucionAgenteId: null,
	ejecucionModelo: "opus",
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
	/** Los papeles que se pueden asignar a una fase. */
	agentes: Agente[];
	padres: ItemIndice[];
	candidatas: ItemIndice[];
	/** En qué proyecto vive o va a nacer. No se elige: se enseña. */
	proyecto: Proyecto | undefined;
};

function opcionesDeTarea(db: DatabaseSync, tareaId: number | null, proyecto: Proyecto | undefined): OpcionesTarea {
	const items = listarTareas(db);
	return {
		activos: terminalesActivos(db),
		agentes: listarAgentes(db),
		padres: items.filter((item) => item.tipo === "funcionalidad" && item.estado !== "finished" && item.id !== tareaId),
		candidatas: items.filter((item) => item.estado !== "finished" && item.id !== tareaId),
		proyecto,
	};
}

// --- lectura de parámetros ---------------------------------------------------

/**
 * La tarea de la ruta: su número de fila y el código con el que se la nombra.
 * `null` si el identificador no tiene la forma buena o no es de ninguna tarea:
 * para la web las dos cosas son la misma página de «no encontrada».
 */
function tareaDeRuta(db: DatabaseSync, c: Context): TareaDeRuta | null {
	const codigo = idONull(c.req.param("id") ?? "");
	if (codigo === null) {
		return null;
	}
	const id = idDeCodigoONull(db, codigo);
	return id === null ? null : { id, codigo };
}

/** Lo que la ruta necesita de una tarea: por dentro el número, por fuera el código. */
type TareaDeRuta = { id: number; codigo: string };

/** El mismo texto en todas las rutas que reciben un identificador. */
const NO_ES_UNA_TAREA = "Eso no es ninguna tarea; el identificador tiene la forma T-K7M3XQ.";

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
 * El presupuesto del formulario. Vacío es sin tope; lo que no es un número
 * llega como `NaN` y lo rechaza la regla de la base, que es la que manda.
 */
function presupuestoDeFormulario(formulario: Formulario): number | null {
	const valor = campo(formulario, "presupuesto").trim();
	return valor === "" ? null : Number(valor);
}

/** El tipo elegido en el desplegable. Cualquier otra cosa es una tarea normal. */
function tipoDeFormulario(formulario: Formulario): TipoTarea {
	const valor = campo(formulario, "tipo");
	return esTipoTarea(valor) ? valor : "tarea";
}

/** Los identificadores de un desplegable, saltándose los que no tienen la forma buena. */
function codigosDeFormulario(formulario: Formulario, nombre: string): string[] {
	const codigos: string[] = [];
	for (const valor of campoLista(formulario, nombre)) {
		const codigo = idONull(valor);
		if (codigo !== null) {
			codigos.push(codigo);
		}
	}
	return codigos;
}

/**
 * El padre y las dependencias como números de fila, que es lo que espera la
 * base: el formulario los manda con el identificador que se ve en el tablero.
 */
function conIdsResueltos(db: DatabaseSync, valores: ValoresTarea): { padreId: number | null; dependeDe: number[] } {
	return {
		padreId: valores.padre === null ? null : idDeCodigo(db, valores.padre),
		dependeDe: valores.dependeDe.map((codigo) => idDeCodigo(db, codigo)),
	};
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
		rama: campoOpcional(formulario, "rama"),
		padre: idONull(campo(formulario, "padre")),
		dependeDe: codigosDeFormulario(formulario, "dependeDe"),
		autoejecucion: tipo !== "tarea" || marcado(formulario, "autoejecucion"),
		presupuesto: presupuestoDeFormulario(formulario),
		// Con agente, el modelo y el terminal los copia la base de datos del papel
		// e ignora lo que llegue en los otros dos campos: el formulario los
		// deshabilita, así que ni siquiera se envían.
		analisisAgenteId: numeroONull(campo(formulario, "analisisAgente")),
		analisisModelo: campoOpcional(formulario, "analisisModelo"),
		analisisTerminalId: numeroONull(campo(formulario, "analisisTerminal")),
		ejecucionAgenteId: esPregunta ? null : numeroONull(campo(formulario, "ejecucionAgente")),
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

function enlaceTarea(codigo: string): Html {
	const id = formatearId(codigo);
	return html`<a class="id-tarea" href="/tareas/${id}">${id}</a>`;
}

/** La fase de ejecución de una pregunta no existe: no hay nada que enseñar. */
function ejecucionLegible(tipo: TipoTarea, modelo: string | null, terminal: string | null): string {
	return tipo === "pregunta" ? SIN_DATO : faseLegible(modelo, terminal);
}

// --- el formulario de una tarea ----------------------------------------------

function opcionTerminal(terminal: TerminalListado, seleccionado: number | null): Html {
	return html`<option value="${terminal.id}"${seleccionado === terminal.id ? raw(" selected") : ""}>${terminal.nombre}</option>`;
}

/** Los terminales activos con «cualquiera» delante. Lo comparte el alta de un agente. */
export function selectTerminal(nombre: string, activos: TerminalListado[], seleccionado: number | null): Html {
	return html`<select name="${nombre}">
			<option value=""${seleccionado === null ? raw(" selected") : ""}>cualquiera</option>
			${activos.map((terminal) => opcionTerminal(terminal, seleccionado))}
		</select>`;
}

/**
 * El desplegable de modelo: los conocidos, «sin asignar», y el que tenga puesto
 * la tarea si no está en la lista (un agente puede haber fijado otro). Era un
 * campo de texto con `datalist`, pero con un valor ya escrito el navegador solo
 * sugiere lo que empieza igual y las demás opciones no se veían.
 */
function selectModelo(nombre: string, seleccionado: string | null): Html {
	const opciones =
		seleccionado === null || MODELOS_SUGERIDOS.includes(seleccionado)
			? MODELOS_SUGERIDOS
			: [seleccionado, ...MODELOS_SUGERIDOS];
	return html`<select name="${nombre}">
			<option value=""${seleccionado === null ? raw(" selected") : ""}>sin asignar</option>
			${opciones.map((modelo) => html`<option value="${modelo}"${modelo === seleccionado ? raw(" selected") : ""}>${modelo}</option>`)}
		</select>`;
}

/** El presupuesto en la casilla del formulario: vacío si no hay, o si lo que llegó no era un número. */
function valorPresupuesto(presupuesto: number | null): string {
	return presupuesto === null || !Number.isSafeInteger(presupuesto) ? "" : String(presupuesto);
}

/** Una casilla con su explicación debajo, en texto suave. */
function casilla(nombre: string, marcada: boolean, texto: string, explicacion: string): Html {
	return html`<label class="casilla" data-casilla="${nombre}">
			<input type="checkbox" name="${nombre}"${marcada ? raw(" checked") : ""}>
			<span class="que">${texto}</span>
			<span class="detalle">${explicacion}</span>
		</label>`;
}

/**
 * El desplegable de papel de una fase. Cada opción lleva el modelo y el
 * terminal del agente, que es lo que `cliente.ts` copia en los otros dos
 * desplegables antes de deshabilitarlos: con papel no se elige a mano.
 */
function selectAgente(nombre: string, agentes: readonly Agente[], elegido: number | null): Html {
	return html`<select name="${nombre}" data-agente>
			<option value=""${elegido === null ? raw(" selected") : ""}>ninguno</option>
			${agentes.map(
				(agente) =>
					html`<option value="${agente.id}" data-modelo="${agente.modelo}" data-terminal="${agente.terminalId ?? ""}"${agente.id === elegido ? raw(" selected") : ""}>${agente.nombre}</option>`,
			)}
		</select>`;
}

/** Lo que se asigna a una fase: su papel, y el modelo y el terminal con los que corre. */
type ValoresFase = {
	agenteId: number | null;
	modelo: string | null;
	terminalId: number | null;
};

/** Una de las dos tarjetas de asignación: agente, modelo y terminal de una fase. */
function fase(titulo: string, prefijo: string, valores: ValoresFase, opciones: OpcionesTarea): Html {
	return html`<fieldset data-fase="${prefijo}">
			<legend>${titulo}</legend>
			<label>
				<span>Agente</span>
				${selectAgente(`${prefijo}Agente`, opciones.agentes, valores.agenteId)}
				<span class="ayuda">Con papel, el modelo y el terminal vienen de él.</span>
			</label>
			<label>
				<span>Modelo</span>
				${selectModelo(`${prefijo}Modelo`, valores.modelo)}
			</label>
			<label>
				<span>Terminal</span>
				${selectTerminal(`${prefijo}Terminal`, opciones.activos, valores.terminalId)}
			</label>
		</fieldset>`;
}

/**
 * El proyecto de la tarea, de solo lectura: el del tablero desde el que se
 * crea, o el que se estaba mirando. No se elige aquí ni se cambia después; una
 * mudanza es de la ficha del proyecto, no del alta de una tarea.
 */
function filaProyecto(proyecto: Proyecto | undefined): Html {
	if (proyecto === undefined) {
		return html``;
	}
	return html`<p class="nombre-campo">Proyecto</p>
		<p>${chipProyecto(proyecto)} <span class="silencio">${proyecto.nombre}</span></p>`;
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
function selectPadre(padres: ItemIndice[], elegido: string | null): Html {
	return html`<label>
			<span>Parte de la funcionalidad</span>
			<select name="padre">
				<option value=""${elegido === null ? raw(" selected") : ""}>ninguna</option>
				${padres.map(
					(padre) =>
						html`<option value="${formatearId(padre.codigo)}"${padre.codigo === elegido ? raw(" selected") : ""}>${formatearId(padre.codigo)} — ${padre.titulo}</option>`,
				)}
			</select>
			<span class="ayuda">Si la eliges, esta tarea es una de sus partes y hereda su rama.</span>
		</label>`;
}

/**
 * Las dependencias, como desplegable de varias opciones. Se guardan por el
 * identificador de cada tarea, que es lo que el humano ve en el tablero.
 */
function selectDependencias(candidatas: ItemIndice[], elegidas: string[]): Html {
	if (candidatas.length === 0) {
		return html`<p class="nombre-campo">Dependencias</p>
			<p class="silencio">No hay ninguna otra tarea abierta de la que depender.</p>`;
	}
	return html`<label>
			<span>Depende de</span>
			<select name="dependeDe" multiple size="6">
				${candidatas.map(
					(otra) =>
						html`<option value="${formatearId(otra.codigo)}"${elegidas.includes(otra.codigo) ? raw(" selected") : ""}>${formatearId(otra.codigo)} — ${otra.titulo} (${NOMBRE_ESTADO[otra.estado]})</option>`,
				)}
			</select>
			<span class="ayuda">Esta tarea espera a que las elegidas estén hechas. Se marcan varias con la tecla de control.</span>
		</label>`;
}

/**
 * El formulario de una tarea, compartido por «Nueva tarea» y «Editar». Se
 * pintan siempre todos los campos: lo que no aplica a un tipo lo esconde la
 * hoja de estilos en cuanto se elige, sin JavaScript, y así cambiar de tipo no
 * deja el formulario a medias. El servidor vuelve a ignorarlo al guardar: una
 * pregunta no tiene ejecución ni autoejecución, y una funcionalidad aprueba
 * siempre el humano.
 */
function camposTarea(valores: ValoresTarea, opciones: OpcionesTarea): Html {
	const esFuncionalidad = valores.tipo === "funcionalidad";
	return html`${filaProyecto(opciones.proyecto)}
		<label>
			<span>Título</span>
			<input type="text" name="titulo" value="${valores.titulo}" required>
		</label>
		${selectTipo(valores.tipo)}
		<label>
			<span>Descripción (Markdown)</span>
			<textarea name="descripcion" rows="10">${valores.descripcion}</textarea>
		</label>
		<label>
			<span>Rama</span>
			<input type="text" name="rama" value="${valores.rama ?? ""}" placeholder="evolutivo/csv">
			<span class="ayuda">Los agentes trabajarán en esta rama.</span>
		</label>
		${selectPadre(opciones.padres, valores.padre)}
		${selectDependencias(opciones.candidatas, valores.dependeDe)}
		<label>
			<span>Presupuesto en tokens</span>
			<input type="number" name="presupuesto" min="0" step="1000" value="${valorPresupuesto(valores.presupuesto)}">
			<span class="ayuda">${
				esFuncionalidad
					? "Tope del evolutivo entero. Pasarse solo avisa: sus partes no lo heredan."
					: "Tope de la tarea con sus hijas. Pasarse solo avisa, no frena nada."
			}</span>
		</label>
		${casilla(
			"autoejecucion",
			valores.autoejecucion,
			"Autoejecución",
			"La ejecución arranca sola cuando el análisis termina sin preguntas abiertas.",
		)}
		<div class="fases">
			${fase(
				esFuncionalidad ? "Análisis de la funcionalidad" : "Análisis",
				"analisis",
				{
					agenteId: valores.analisisAgenteId,
					modelo: valores.analisisModelo,
					terminalId: valores.analisisTerminalId,
				},
				opciones,
			)}
			${fase(
				esFuncionalidad ? "Ejecución de las partes (por defecto)" : "Ejecución",
				"ejecucion",
				{
					agenteId: valores.ejecucionAgenteId,
					modelo: valores.ejecucionModelo,
					terminalId: valores.ejecucionTerminalId,
				},
				opciones,
			)}
		</div>`;
}

// --- la lista ----------------------------------------------------------------

function filaTarea(
	db: DatabaseSync,
	item: ItemIndice,
	creadorDe: Creador,
	deQuien: Funcionalidades,
	claves: Claves,
	conEstado: boolean,
): Html {
	const tarea = buscarTarea(db, item.id);
	const creador =
		tarea === undefined
			? null
			: creadorDe({ usuarioId: tarea.creadaPorUsuarioId, terminalId: tarea.creadaPorTerminalId });
	const funcionalidad = item.padreId === null ? undefined : deQuien.get(item.padreId);
	const proyecto = claves?.get(item.proyectoId);
	return html`<tr>
			${conEstado ? html`<td>${insigniaEstado(item.estado)}</td>` : html``}
			<td>${enlaceTarea(item.codigo)} ${proyecto === undefined ? html`` : chipProyecto(proyecto)}</td>
			<td>
				${esperaPorTi(item.estado, item.marcas)}${insigniaTipoDeItem(item)}${insigniasMarcas(item.marcas, item.enMarchaDesde)}${item.titulo} ${progresoDe(item)}
				${
					funcionalidad === undefined || item.padreCodigo === null
						? html``
						: html`<span class="pequeno">${enlaceFuncionalidad(item.padreCodigo, funcionalidad)}</span>`
				}
			</td>
			<td class="pequeno">${faseLegible(item.analisisModelo, item.analisisTerminal)}</td>
			<td class="pequeno">${ejecucionLegible(item.tipo, item.ejecucionModelo, item.ejecucionTerminal)}</td>
			<td class="numero pequeno">${tokensConPresupuesto(item.tokensConHijas, item.presupuesto)}</td>
			<td>${creador ?? SIN_DATO}</td>
			<td class="pequeno">${edadEnColumna(item)}</td>
		</tr>`;
}

/** El proyecto de cada fila, solo en la vista cruzada: acotada sobraría. */
type Claves = Map<number, Proyecto> | null;

/**
 * La tabla de la lista. Agrupada por funcionalidad las tareas de una franja
 * están en columnas distintas, así que la columna Estado va delante; por
 * columnas la enseña el rótulo del grupo y sobraría en cada fila.
 */
function tablaLista(
	db: DatabaseSync,
	items: ItemIndice[],
	creadorDe: Creador,
	deQuien: Funcionalidades,
	claves: Claves,
	conEstado = false,
): Html {
	if (items.length === 0) {
		return html`<p class="silencio">Ninguna.</p>`;
	}
	return html`<div class="tabla-envuelta">
			<table>
				<thead>
					<tr>
						${conEstado ? html`<th>Estado</th>` : html``}
						<th>Id</th><th>Título</th><th>Análisis</th><th>Ejecución</th>
						<th class="numero">Tokens</th><th>Creada por</th><th>En columna</th>
					</tr>
				</thead>
				<tbody>${items.map((item) => filaTarea(db, item, creadorDe, deQuien, claves, conEstado))}</tbody>
			</table>
		</div>`;
}

function grupoColumna(
	db: DatabaseSync,
	estado: Estado,
	items: ItemIndice[],
	creadorDe: Creador,
	deQuien: Funcionalidades,
	claves: Claves,
): Html {
	const tabla = tablaLista(db, items, creadorDe, deQuien, claves);
	const rotulo = rotuloColumna(insigniaColumna(estado), items.length);
	// Las cerradas están archivadas: se ven si se piden, no estorban por defecto.
	if (estado === "finished") {
		return html`<section class="grupo">
				<details>
					<summary>${rotulo}</summary>
					${tabla}
				</details>
			</section>`;
	}
	return html`<section class="grupo">
			<h2>${rotulo}</h2>
			${duenoDeColumna(estado)}
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
	return html`<a href="/p/${proyecto.clave}/tareas">${chipProyecto(proyecto)}</a> ${proyecto.nombre}`;
}

/**
 * En qué vuelta va la tarea y cuánto lleva donde está: «Iteración 2 · desde
 * hace 3 h», en texto suave y junto a las etiquetas de la cabecera. La edad se
 * cuenta desde la pregunta abierta más antigua cuando la tarea está bloqueada,
 * que es lo que hacen la lista y el tablero.
 *
 * Iteración 1 es la primera ejecución: decirlo no aporta nada. Se dice desde la
 * segunda, que es cuando la tarea ha dado alguna vuelta.
 */
function estadoLegible(completa: TareaCompleta, iteraciones: number): Html {
	const { tarea } = completa;
	const vuelta = iteraciones > 1 ? html`Iteración ${iteraciones}` : html``;
	if (!muestraEdad(tarea.estado)) {
		return iteraciones > 1 ? html`<span class="silencio">${vuelta}</span>` : html``;
	}
	const abiertas = completa.preguntas.filter((pregunta) => pregunta.respuestaOpcion === null);
	const edad = edadEnColumna({
		estado: tarea.estado,
		marcas: completa.marcas,
		estadoDesde: tarea.estadoDesde,
		bloqueadaDesde: abiertas.map((pregunta) => pregunta.creada).sort()[0] ?? null,
	});
	return html`<span class="silencio">${iteraciones > 1 ? html`${vuelta} · ` : html``}desde hace ${edad}</span>`;
}

/** El tope de tokens de la tarea, o que no tiene ninguno. */
function presupuestoLegible(presupuesto: number | null): Html {
	return presupuesto === null
		? html`<span class="silencio">sin presupuesto</span>`
		: html`${tokensAbreviados(presupuesto)}`;
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
		return html`<span class="silencio">ninguno</span>`;
	}
	return html`${insigniaEstado(padre.estado)} ${enlaceTarea(padre.codigo)} ${padre.titulo}`;
}

/**
 * Una lista de tareas por su código, cada una con la etiqueta de su estado y
 * su enlace. Las de `naranjas` van en ese color, que es el de lo que frena.
 */
function tareasConEstado(db: DatabaseSync, codigos: readonly string[], naranjas: ReadonlySet<string>): Html {
	if (codigos.length === 0) {
		return html`<span class="silencio">ninguna</span>`;
	}
	return html`<span class="dependencias">
			${codigos.map((codigo) => {
				const otra = buscarTareaPorCodigo(db, codigo);
				const insignia =
					otra === undefined
						? html``
						: etiqueta(
								NOMBRE_ESTADO[otra.estado],
								naranjas.has(codigo) ? "naranja" : COLOR_ESTADO[otra.estado],
								`estado-${otra.estado}`,
							);
				return html`<span class="dependencia">${insignia} ${enlaceTarea(codigo)}</span>`;
			})}
		</span>`;
}

/**
 * De qué depende la tarea: el estado de cada una y su enlace. Las que todavía
 * no están hechas van en naranja: son las que mantienen la marca `esperando`.
 */
function dependenciasLegibles(db: DatabaseSync, tareaId: number, dependeDe: readonly string[]): Html {
	return tareasConEstado(db, dependeDe, new Set(dependenciasPendientes(db, tareaId)));
}

/**
 * La otra dirección: qué tareas esperan a esta. Es lo que dice cuántas hay
 * detrás de desbloquearla, y hasta ahora solo se veía al ir a borrarla.
 */
function dependientesLegibles(db: DatabaseSync, tareaId: number): Html {
	return tareasConEstado(
		db,
		dependientesDe(db, tareaId).map((otra) => otra.codigo),
		new Set(),
	);
}

/**
 * Una fase en la ficha: el papel delante, enlazado a su ficha, y detrás el
 * modelo y el terminal con los que se trabaja de verdad. Sin papel, solo eso
 * último, como siempre.
 */
function faseConPapel(completa: TareaCompleta, cual: "analisis" | "ejecucion"): Html {
	const { tarea } = completa;
	const esAnalisis = cual === "analisis";
	const trabajo = faseLegible(
		esAnalisis ? tarea.analisisModelo : tarea.ejecucionModelo,
		esAnalisis ? completa.analisisTerminal : completa.ejecucionTerminal,
	);
	const agenteId = esAnalisis ? tarea.analisisAgenteId : tarea.ejecucionAgenteId;
	const agente = esAnalisis ? completa.analisisAgente : completa.ejecucionAgente;
	if (agenteId === null || agente === null) {
		return html`${trabajo}`;
	}
	return html`<a href="/agentes/${agenteId}">${agente}</a> · ${trabajo}`;
}

/**
 * Las propiedades de la tarea, en filas de dos columnas. No lleva fila Estado:
 * el estado, la edad y la iteración ya están en la cabecera, junto al título.
 * Una pregunta no enseña ejecución ni autoejecución: enseñarlas haría creer que
 * después del análisis viene otra fase.
 */
function propiedadesDeTarea(db: DatabaseSync, completa: TareaCompleta, creadorDe: Creador): Html {
	const { tarea } = completa;
	if (tarea.tipo === "funcionalidad") {
		return propiedadesDeFuncionalidad(db, completa, creadorDe);
	}
	const filas: Propiedad[] = [{ nombre: "Proyecto", valor: proyectoLegible(db, tarea.proyectoId) }];
	if (tarea.tipo === "pregunta") {
		filas.push({ nombre: "Tipo", valor: insigniaTipoTarea(tarea.tipo) });
	}
	if (tarea.rama !== null) {
		filas.push({ nombre: "Rama", valor: ramaLegible(tarea.rama) });
	}
	filas.push({ nombre: "Análisis", valor: faseConPapel(completa, "analisis") });
	if (tarea.tipo !== "pregunta") {
		filas.push({ nombre: "Ejecución", valor: faseConPapel(completa, "ejecucion") });
		filas.push({ nombre: "Autoejecución", valor: tarea.autoejecucion ? "activada" : "desactivada" });
	}
	filas.push({ nombre: "Presupuesto", valor: presupuestoLegible(tarea.presupuesto) });
	filas.push({ nombre: "Padre", valor: padreLegible(db, tarea.padreId) });
	filas.push({ nombre: "Depende de", valor: dependenciasLegibles(db, tarea.id, completa.dependeDe) });
	filas.push({ nombre: "Bloquea a", valor: dependientesLegibles(db, tarea.id) });
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
		{ nombre: "Proyecto", valor: proyectoLegible(db, tarea.proyectoId) },
		{ nombre: "Tipo", valor: insigniaTipoTarea(tarea.tipo) },
	];
	if (tarea.rama !== null) {
		filas.push({ nombre: "Rama", valor: ramaLegible(tarea.rama) });
	}
	filas.push({
		nombre: "Partes",
		// Sin partes no hay barra que pintar: todavía no está descompuesta.
		valor:
			completa.partes === 0
				? html`<span class="silencio">ninguna</span>`
				: barraProgreso(completa.partesCerradas ?? 0, completa.partes ?? 0, "partes"),
	});
	filas.push({ nombre: "Análisis", valor: faseConPapel(completa, "analisis") });
	filas.push({ nombre: "Ejecución de las partes", valor: faseConPapel(completa, "ejecucion") });
	filas.push({ nombre: "Depende de", valor: dependenciasLegibles(db, tarea.id, completa.dependeDe) });
	filas.push({ nombre: "Bloquea a", valor: dependientesLegibles(db, tarea.id) });
	filas.push({ nombre: "Consumo de las partes", valor: `${numeroLegible(completa.consumo.totalConHijas)} tokens` });
	filas.push({ nombre: "Presupuesto", valor: presupuestoLegible(tarea.presupuesto) });
	filas.push({ nombre: "Creada", valor: creadaLegible(tarea, creadorDe) });
	filas.push({ nombre: "Revisión", valor: String(tarea.revision) });
	return propiedades(filas);
}

/**
 * En qué punto están las hijas: «2 hechas · 2 en curso · 1 con pregunta abierta». De la
 * más avanzada a la menos, y al final las que tienen una pregunta abierta, que
 * es lo que hay que atender. Solo se nombra lo que hay.
 */
function desgloseHijas(hijas: readonly HijaDeTarea[]): string {
	const partes: string[] = [];
	for (const estado of [...ESTADOS].reverse()) {
		const cuantas = hijas.filter((hija) => hija.estado === estado).length;
		if (cuantas > 0) {
			// El singular es el nombre del estado; el plural, el de la columna.
			const nombre = cuantas === 1 ? NOMBRE_ESTADO[estado] : NOMBRE_COLUMNA[estado];
			partes.push(`${cuantas} ${nombre.toLowerCase()}`);
		}
	}
	const bloqueadas = hijas.filter((hija) => hija.bloqueada).length;
	if (bloqueadas > 0) {
		partes.push(`${bloqueadas} con pregunta abierta`);
	}
	return partes.join(" · ");
}

/**
 * Las hijas de la tarea, con la misma cuenta y la misma barra que la tarjeta
 * del tablero: es donde el humano decide si acepta el resultado de la padre.
 */
function bloqueHijas(hijas: readonly HijaDeTarea[]): Html {
	if (hijas.length === 0) {
		return html`<h2>Hijas</h2>
			<p class="silencio">Ninguna.</p>`;
	}
	const hechas = hijas.filter((hija) => hija.estado === "done" || hija.estado === "finished").length;
	return html`<h2>Hijas ${hechas}/${hijas.length} <progress class="progreso" value="${hechas}" max="${hijas.length}"></progress></h2>
		<p class="pequeno silencio">${desgloseHijas(hijas)}</p>
		<ul class="hijas">
			${hijas.map((hija) => html`<li>${insigniaEstado(hija.estado)} ${enlaceTarea(hija.codigo)} ${hija.titulo}</li>`)}
		</ul>`;
}

function tablaConsumo(consumo: ConsumoDeTarea, presupuesto: number | null): Html {
	const fases: { nombre: string; fase: ConsumoDeTarea["analisis"] }[] = [
		{ nombre: NOMBRE_FASE.analisis, fase: consumo.analisis },
		{ nombre: NOMBRE_FASE.ejecucion, fase: consumo.ejecucion },
	];
	const conDatos = fases.filter((entrada) => entrada.fase !== null);
	if (conDatos.length === 0 && consumo.totalConHijas === 0) {
		return html`<p class="silencio">Sin consumo.</p>`;
	}
	// Con tope, el total se lee contra él: lo gastado de lo que había.
	const total =
		presupuesto === null
			? numeroLegible(consumo.totalConHijas)
			: `${numeroLegible(consumo.totalConHijas)} de ${numeroLegible(presupuesto)}`;
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
						<td class="numero"><strong>${total}</strong></td>
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
				? html`<p class="responder-arriba"><a href="#pregunta-${formatearId(completa.tarea.codigo)}-P${pregunta.numero}">Responder arriba</a></p>`
				: html``,
	});
}

/** Los tres filtros del hilo: qué tipos de comentario deja pasar cada uno. */
const FILTROS_HILO: readonly { valor: string; texto: string; tipos: readonly TipoComentario[] }[] = [
	{ valor: "", texto: "Todo", tipos: [] },
	{ valor: "preguntas", texto: "Preguntas y respuestas", tipos: ["pregunta", "respuesta"] },
	{ valor: "comentarios", texto: "Comentarios y resultados", tipos: ["comentario", "resultado"] },
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

/**
 * Dónde entra el separador de cada iteración: justo delante del comentario que
 * pidió la vuelta, que es el último escrito antes de la transición porque los
 * dos van en la misma transacción. Si la vuelta es anterior a todo lo que se
 * ve, abre el hilo; si no hay comentario que la siga, lo cierra.
 */
function puntosDeIteracion(comentarios: Comentario[], iteraciones: string[]): Map<number, number[]> {
	const puntos = new Map<number, number[]>();
	for (const [indice, creado] of iteraciones.entries()) {
		const anterior = comentarios.findLastIndex((comentario) => comentario.creado <= creado);
		const donde = anterior < 0 ? 0 : anterior;
		puntos.set(donde, [...(puntos.get(donde) ?? []), indice]);
	}
	return puntos;
}

/**
 * El hilo, de arriba abajo como un chat, con el corte de cada iteración entre
 * los mensajes. `iteraciones` son las fechas de las vueltas: la primera empieza
 * la iteración 2.
 */
function hilo(completa: TareaCompleta, colorDe: ColorDe, elegido: string, iteraciones: string[]): Html {
	const filtro = FILTROS_HILO.find((candidato) => candidato.valor === elegido);
	const tipos = filtro === undefined ? [] : filtro.tipos;
	const comentarios =
		tipos.length === 0 ? completa.comentarios : completa.comentarios.filter((cual) => tipos.includes(cual.tipo));
	if (comentarios.length === 0 && iteraciones.length === 0) {
		return html`<p class="silencio">Ninguno.</p>`;
	}
	const puntos = puntosDeIteracion(comentarios, iteraciones);
	const corte = (indice: number): Html =>
		html`${(puntos.get(indice) ?? []).map((vuelta) => separadorIteracion(vuelta + 2, iteraciones[vuelta] ?? ""))}`;
	return html`<div class="hilo">
			${comentarios.map((comentario, indice) => html`${corte(indice)}${comentarioDeLaFicha(completa, comentario, colorDe)}`)}
			${corte(comentarios.length)}
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
	const id = formatearId(completa.tarea.codigo);
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

/**
 * Una vuelta atrás: plegada, porque es excepcional, y siempre con su comentario
 * explicando por qué. La otra, pedir otra iteración sobre una tarea hecha, no
 * es excepcional y va en el cuadro de comentar.
 */
function vueltaAtras(id: string, estado: Estado, texto: string, quePasa: string): Html {
	return html`<details class="caja">
			<summary><strong>${texto}</strong></summary>
			<form method="post" action="/tareas/${id}/mover">
				<input type="hidden" name="estado" value="${estado}">
				<label>
					<span>Comentario: ${quePasa}</span>
					<textarea name="nota" rows="3" required></textarea>
				</label>
				<button type="submit">${texto}</button>
			</form>
		</details>`;
}

function vueltasAtras(completa: TareaCompleta): Html {
	if (completa.tarea.estado !== "prepared") {
		return html``;
	}
	return vueltaAtras(formatearId(completa.tarea.codigo), "backlog", VOLVER_A_DEFINIR, "por qué vuelve a por definir");
}

/**
 * La salida de una fase que se quedó tomada. Solo se pinta cuando hay una, y
 * cuando además está `parada` dice desde cuándo la tiene el terminal: es lo que
 * distingue un subagente trabajando de uno que murió hace horas.
 */
function liberarLaFase(completa: TareaCompleta): Html {
	const { tarea } = completa;
	if (tarea.enMarchaTerminalId === null) {
		return html``;
	}
	const desde = completa.marcas.includes("parada") && tarea.enMarchaDesde !== null ? tarea.enMarchaDesde : null;
	return html`<form class="caja" method="post" action="/tareas/${formatearId(tarea.codigo)}/liberar">
			<p class="silencio">
				La fase queda libre y cualquier terminal puede retomarla. No mueve la tarea de columna.
			</p>
			<button type="submit">${desde === null ? "Liberar la fase" : `Liberar la fase, parada desde hace ${edad(desde)}`}</button>
		</form>`;
}

/**
 * Editar solo en `backlog`: al salir, la descripción y las asignaciones se
 * congelan.
 */
function detallesEditar(db: DatabaseSync, tarea: Tarea, padre: string | null, dependeDe: string[]): Html {
	if (tarea.estado !== "backlog") {
		return html``;
	}
	const id = formatearId(tarea.codigo);
	return html`<details class="caja">
			<summary><strong>Editar</strong></summary>
			<form method="post" action="/tareas/${id}/editar">
				${camposTarea(
					{
						titulo: tarea.titulo,
						descripcion: tarea.descripcion,
						tipo: tarea.tipo,
						rama: tarea.rama,
						padre,
						dependeDe,
						autoejecucion: tarea.autoejecucion,
						presupuesto: tarea.presupuesto,
						analisisAgenteId: tarea.analisisAgenteId,
						analisisModelo: tarea.analisisModelo,
						analisisTerminalId: tarea.analisisTerminalId,
						ejecucionAgenteId: tarea.ejecucionAgenteId,
						ejecucionModelo: tarea.ejecucionModelo,
						ejecucionTerminalId: tarea.ejecucionTerminalId,
					},
					opcionesDeTarea(db, tarea.id, buscarProyectoPorId(db, tarea.proyectoId)),
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
	const id = formatearId(tarea.codigo);
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
	const acotado = proyectoActual(c);
	const filtros = filtrosDe(c);
	const padreCodigo = idONull(filtros.padre);

	// Terminal, proyecto, conmutador y búsqueda los resuelve el índice; aquí
	// quedan los que son de esta vista.
	const items = listarTareas(db, filtroDeIndice(db, filtros), deps.config.FASE_PARADA_HORAS).filter((item) => {
		if (esEstado(filtros.estado) && item.estado !== filtros.estado) {
			return false;
		}
		if (esMarca(filtros.marca) && !item.marcas.includes(filtros.marca)) {
			return false;
		}
		// Un identificador que no encaja no es un error del que avisar: no
		// selecciona ninguna tarea y la lista sale vacía.
		return filtros.padre === "" || item.padreCodigo === padreCodigo;
	});

	// Un solo buscador para toda la tabla: la lista pinta una fila por tarea y
	// no puede consultar usuarios y terminales en cada una.
	const creadorDe = buscadorDeCreador(db);
	// Agrupada, la cabecera de cada franja ya dice de quién son sus partes: las
	// filas no lo repiten y no hay títulos que buscar.
	const carriles = enCarriles(filtros);
	const deQuien: Funcionalidades = carriles ? new Map() : funcionalidadesDe(db, items);
	// En la vista acotada el proyecto es el de la página: el chip solo repetiría.
	const claves = acotado === undefined ? new Map(listarProyectos(db).map((cual) => [cual.id, cual])) : null;
	// Los grupos por columna, que son lo de dentro de «Sueltas» y toda la lista
	// cuando no se agrupa.
	const porColumna = (suyos: ItemIndice[]): Html =>
		html`${COLUMNAS.map((estado) =>
			grupoColumna(
				db,
				estado,
				suyos.filter((item) => item.estado === estado),
				creadorDe,
				deQuien,
				claves,
			),
		)}`;
	// Agrupada, cada funcionalidad es una franja con la tabla de sus partes, y
	// «Sueltas» cierra con los grupos por columna de siempre.
	const cuerpo = html`${filaFiltros("lista", filtros, acotado)}
		${
			carriles
				? franjasDe(db, items).map(({ cual, items: suyos }) =>
						seccionFranja(
							cual,
							claves,
							cual === null ? porColumna(suyos) : tablaLista(db, suyos, creadorDe, deQuien, claves, true),
						),
					)
				: porColumna(items)
		}`;
	// `vista` y `revision` son lo que el cliente necesita para refrescarse: la
	// lista se recarga entera cuando sube la revisión.
	return c.html(
		pagina({
			...navProyectos(c, db),
			// Lista y tablero son la misma sección vista de dos maneras: el título
			// es el de la sección y el proyecto va en las migas.
			titulo: "Tareas",
			proposito: PROPOSITO_TAREAS,
			migas: migasDeTareas(acotado),
			usuario: usuarioActual(c),
			vista: "lista",
			// La tabla tiene seis columnas: en 60 rem se aprieta o se desplaza.
			ancho: "completo",
			revision: revisionActual(db),
			acciones: accionNuevaTarea(prefijo(proyectoDeLaBarra(c, db))),
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
		tipo: esTipoTarea(tipo) ? tipo : TAREA_VACIA.tipo,
		padre: idONull(padre),
	};
}

function paginaNueva(c: Context, deps: DependenciasWeb, valores: ValoresTarea, aviso: string | null): RespuestaHtml {
	const esFuncionalidad = valores.tipo === "funcionalidad";
	// El proyecto no se elige: desde un tablero acotado es el de la ruta, y
	// desde la vista cruzada el que se estaba mirando. La tarea nace donde se
	// está mirando.
	const acotado = proyectoActual(c);
	const base = prefijo(acotado);
	const cuerpo = html`<form method="post" action="${base}/tareas">
			${camposTarea(valores, opcionesDeTarea(deps.db, null, acotado ?? proyectoDeTrabajo(c, deps.db)))}
			<div class="acciones">
				<button type="submit" class="principal">${esFuncionalidad ? "Crear funcionalidad" : "Crear tarea"}</button>
				<a class="boton" href="${valores.padre === null ? `${base}/tareas` : `/tareas/${formatearId(valores.padre)}`}">Cancelar</a>
			</div>
		</form>`;
	const titulo = esFuncionalidad ? "Nueva funcionalidad" : "Nueva tarea";
	return c.html(
		pagina({
			...navProyectos(c, deps.db),
			titulo,
			usuario: usuarioActual(c),
			vista: "tarea-nueva",
			proposito: PROPOSITO_ALTA,
			migas: [{ texto: "Tareas", href: `${base}/tareas` }, { texto: titulo }],
			aviso,
			cuerpo,
		}),
		aviso === null ? 200 : ESTADO_AVISO,
	);
}

function paginaFicha(c: Context, deps: DependenciasWeb, tareaId: number, aviso: string | null): RespuestaHtml {
	const completa = leerTarea(deps.db, tareaId, deps.config.FASE_PARADA_HORAS);
	if (completa === undefined) {
		return paginaNoEncontrada(c, deps, NO_ES_UNA_TAREA);
	}
	const { tarea } = completa;
	const id = formatearId(tarea.codigo);
	// El color de un autor se busca al pintar, y el hilo tiene muchos: una sola
	// lectura de la tabla de usuarios para toda la página.
	const colorDe = buscadorDeColor(deps.db);
	// Una funcionalidad no se ejecuta: no da vueltas y su hilo no lleva cortes.
	const iteraciones = tarea.tipo === "funcionalidad" ? [] : iteracionesDe(deps.db, tarea.id);

	// El cuadro de escribir cierra el hilo, pegado al último mensaje: es un chat.
	const comun = html`<h2>Hilo</h2>
		${filtroHilo(id, c.req.query("hilo") ?? "")}
		${hilo(completa, colorDe, c.req.query("hilo") ?? "", iteraciones)}
		${cuadroDeComentar(tarea.codigo, tarea.estado)}`;

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
				${tablero(
					deps.db,
					{ estado: "", terminal: "", marca: "", padre: id, proyecto: "", rapido: "", q: "" },
					deps.config.FASE_PARADA_HORAS,
				)}

				${actividad}`
			: html`${descripcion}

				${bloqueHijas(completa.hijas)}

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
					${tablaConsumo(completa.consumo, tarea.presupuesto)}`
		}
		${liberarLaFase(completa)}
		${vueltasAtras(completa)}
		${detallesEditar(deps.db, tarea, completa.padre, completa.dependeDe)}
		${detallesBorrar(tarea)}
	</aside>`;

	// El ciclo va a todo lo ancho y lo primero: en qué punto está la tarea, de
	// quién es el turno y qué pasa ahora, antes que nada de lo que hay debajo.
	const abiertas = completa.preguntas.filter((pregunta) => pregunta.respuestaOpcion === null);
	const cuerpo = html`${pasosDelCiclo({
		estado: tarea.estado,
		tipo: tarea.tipo,
		marcas: completa.marcas,
		preguntaAbierta: abiertas[0]?.numero ?? null,
	})}
		${preguntasArriba(completa)}
		<div class="ficha">
			<div class="principal">${principal}</div>
			${panel}
		</div>`;

	return c.html(
		// La ficha no se recarga sola: tiene formularios y el humano puede estar
		// escribiendo un comentario. El cliente solo avisa; en una funcionalidad,
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
			// Estado, de quién es el turno, el tipo y, en texto suave, en qué vuelta
			// va y cuánto lleva ahí: lo que antes había que ir a buscar a la fila
			// Estado de las propiedades.
			etiquetas: html`${insigniaEstado(tarea.estado)}${esperaPorTi(tarea.estado, completa.marcas)}${insigniaTipoTarea(tarea.tipo)}${insigniasMarcas(completa.marcas, tarea.enMarchaDesde)}${estadoLegible(completa, iteraciones.length + 1)}`,
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
		return paginaNoEncontrada(c, deps, NO_ES_UNA_TAREA);
	}
	const { tarea } = completa;
	const id = formatearId(tarea.codigo);
	const enMarcha =
		tarea.enMarchaTerminalId === null ? undefined : buscarTerminalPorId(deps.db, tarea.enMarchaTerminalId);
	const dejanDeEsperar = dependientesDe(deps.db, tarea.id);
	const cuerpo = html`<section class="caja caja-estrecha">
		<p>Se borra la tarea ${enlaceTarea(tarea.codigo)} <strong>${tarea.titulo}</strong>, que está en ${NOMBRE_COLUMNA[tarea.estado]}.</p>
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
								${dejanDeEsperar.map((otra) => html`<li>${enlaceTarea(otra.codigo)} ${otra.titulo}</li>`)}
							</ul>
						</li>`
			}
		</ul>
		<p class="silencio">
			No se puede deshacer. El rastro se queda en la actividad y el identificador ${id} no vuelve a usarse.
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
function vuelta(formulario: Formulario, codigo: string): string {
	return destinoSeguro(campo(formulario, "volver"), `/tareas/${formatearId(codigo)}`);
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
	cual: TareaDeRuta,
	error: unknown,
): RespuestaHtml {
	const aviso = mensajeDeRegla(error);
	return vuelta(formulario, cual.codigo) === "/" ? paginaBandeja(c, deps, aviso) : paginaFicha(c, deps, cual.id, aviso);
}

/** Todas las rutas de tareas: lista, alta, ficha y las acciones del humano. */
export function registrarRutasTareas(app: Hono, deps: DependenciasWeb): void {
	app.get("/tareas", (c) => paginaLista(c, deps));
	app.get("/p/:clave/tareas", (c) => paginaLista(c, deps));

	// Antes de `/tareas/:id` para que «nueva» no se lea como identificador.
	app.get("/tareas/nueva", (c) => paginaNueva(c, deps, valoresIniciales(c), null));
	app.get("/p/:clave/tareas/nueva", (c) => paginaNueva(c, deps, valoresIniciales(c), null));

	// Desde un tablero acotado la tarea nace en ese proyecto; desde la vista
	// cruzada, en el que se estaba mirando, que es el que enseñó el formulario.
	const crear = async (c: Context): Promise<RespuestaHtml> => {
		const formulario = await leerFormulario(c);
		const activos = terminalesActivos(deps.db);
		try {
			const valores = valoresDeFormulario(formulario, activos);
			const elegido = proyectoActual(c) ?? proyectoDeTrabajo(c, deps.db);
			const tarea = crearTareaHumana(deps.db, {
				...valores,
				...conIdsResueltos(deps.db, valores),
				usuarioId: usuarioActual(c).id,
				...(elegido === undefined ? {} : { proyectoId: elegido.id }),
			});
			return c.redirect(`/tareas/${formatearId(tarea.codigo)}`, 302);
		} catch (error) {
			return paginaNueva(c, deps, valoresCrudos(formulario), mensajeDeRegla(error));
		}
	};
	app.post("/tareas", crear);
	app.post("/p/:clave/tareas", crear);

	app.get("/tareas/:id", (c) => {
		const cual = tareaDeRuta(deps.db, c);
		if (cual === null) {
			return paginaNoEncontrada(c, deps, NO_ES_UNA_TAREA);
		}
		return paginaFicha(c, deps, cual.id, null);
	});

	app.post("/tareas/:id/editar", async (c) => {
		const cual = tareaDeRuta(deps.db, c);
		if (cual === null) {
			return paginaNoEncontrada(c, deps, NO_ES_UNA_TAREA);
		}
		const formulario = await leerFormulario(c);
		try {
			const valores = valoresDeFormulario(formulario, terminalesActivos(deps.db));
			editarTareaBacklog(deps.db, {
				...valores,
				...conIdsResueltos(deps.db, valores),
				tareaId: cual.id,
				usuarioId: usuarioActual(c).id,
			});
			return c.redirect(`/tareas/${formatearId(cual.codigo)}`, 302);
		} catch (error) {
			return paginaFicha(c, deps, cual.id, mensajeDeRegla(error));
		}
	});

	app.get("/tareas/:id/borrar", (c) => {
		const cual = tareaDeRuta(deps.db, c);
		if (cual === null) {
			return paginaNoEncontrada(c, deps, NO_ES_UNA_TAREA);
		}
		return paginaBorrar(c, deps, cual.id);
	});

	app.post("/tareas/:id/borrar", (c) => {
		const cual = tareaDeRuta(deps.db, c);
		if (cual === null) {
			return paginaNoEncontrada(c, deps, NO_ES_UNA_TAREA);
		}
		try {
			const borrada = borrarTarea(deps.db, { tareaId: cual.id, actor: { usuarioId: usuarioActual(c).id } });
			// Una parte vuelve al tablero de su funcionalidad, que es de donde se
			// estaba podando; una tarea suelta, a la lista.
			const padre = borrada.padreId === null ? undefined : buscarTarea(deps.db, borrada.padreId);
			const destino = padre === undefined ? "/tareas" : `/tareas/${formatearId(padre.codigo)}`;
			return c.redirect(destino, 302);
		} catch (error) {
			return paginaFicha(c, deps, cual.id, mensajeDeRegla(error));
		}
	});

	app.post("/tareas/:id/mover", async (c) => {
		const cual = tareaDeRuta(deps.db, c);
		if (cual === null) {
			return paginaNoEncontrada(c, deps, NO_ES_UNA_TAREA);
		}
		const formulario = await leerFormulario(c);
		const estado = campo(formulario, "estado");
		try {
			if (!esEstado(estado)) {
				throw new ErrorDeRegla("estado_desconocido", `«${estado}» no es ninguna de las cinco columnas.`);
			}
			moverTareaHumano(deps.db, {
				tareaId: cual.id,
				usuarioId: usuarioActual(c).id,
				estado,
				nota: campo(formulario, "nota"),
			});
			return c.redirect(vuelta(formulario, cual.codigo), 302);
		} catch (error) {
			return paginaDeVuelta(c, deps, formulario, cual, error);
		}
	});

	app.post("/tareas/:id/aprobar", async (c) => {
		const cual = tareaDeRuta(deps.db, c);
		if (cual === null) {
			return paginaNoEncontrada(c, deps, NO_ES_UNA_TAREA);
		}
		const formulario = await leerFormulario(c);
		try {
			aprobarEjecucion(deps.db, { tareaId: cual.id, usuarioId: usuarioActual(c).id });
			return c.redirect(vuelta(formulario, cual.codigo), 302);
		} catch (error) {
			return paginaDeVuelta(c, deps, formulario, cual, error);
		}
	});

	// Suelta la fase que un terminal dejó tomada: la salida de una fase parada.
	app.post("/tareas/:id/liberar", async (c) => {
		const cual = tareaDeRuta(deps.db, c);
		if (cual === null) {
			return paginaNoEncontrada(c, deps, NO_ES_UNA_TAREA);
		}
		const formulario = await leerFormulario(c);
		try {
			liberarFase(deps.db, { tareaId: cual.id, usuarioId: usuarioActual(c).id });
			return c.redirect(vuelta(formulario, cual.codigo), 302);
		} catch (error) {
			return paginaDeVuelta(c, deps, formulario, cual, error);
		}
	});

	app.post("/tareas/:id/comentar", async (c) => {
		const cual = tareaDeRuta(deps.db, c);
		if (cual === null) {
			return paginaNoEncontrada(c, deps, NO_ES_UNA_TAREA);
		}
		const formulario = await leerFormulario(c);
		try {
			comentarioHumano(deps.db, {
				tareaId: cual.id,
				usuarioId: usuarioActual(c).id,
				// En `done`, comentar pide otra iteración: lo decide el estado de la
				// tarea, no el formulario.
				texto: campo(formulario, "texto"),
			});
			// Quien comenta desde la bandeja se queda en la bandeja.
			return c.redirect(vuelta(formulario, cual.codigo), 302);
		} catch (error) {
			return paginaDeVuelta(c, deps, formulario, cual, error);
		}
	});

	app.post("/tareas/:id/responder/:pregunta", async (c) => {
		const cual = tareaDeRuta(deps.db, c);
		if (cual === null) {
			return paginaNoEncontrada(c, deps, NO_ES_UNA_TAREA);
		}
		const completa = leerTarea(deps.db, cual.id);
		if (completa === undefined) {
			return paginaNoEncontrada(c, deps, NO_ES_UNA_TAREA);
		}
		const numero = Number.parseInt((c.req.param("pregunta") ?? "").replace(/^P/, ""), 10);
		const pregunta = completa.preguntas.find((candidata) => candidata.numero === numero);
		if (pregunta === undefined) {
			return paginaNoEncontrada(c, deps, `La tarea ${formatearId(cual.codigo)} no tiene la pregunta indicada.`);
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
			return c.redirect(vuelta(formulario, cual.codigo), 302);
		} catch (error) {
			return paginaDeVuelta(c, deps, formulario, cual, error);
		}
	});
}
