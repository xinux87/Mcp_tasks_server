import type { DatabaseSync } from "node:sqlite";
import type { Context, Hono } from "hono";
import { html, raw } from "hono/html";
import { type TerminalListado, terminalesActivos } from "../../db/admin.ts";
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
	type TareaCompleta,
} from "../../db/tareas.ts";
import { ErrorDeRegla, esErrorDeRegla } from "../../errores.ts";
import { formatearId, parsearId } from "../../md/ids.ts";
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
	MODELOS_SUGERIDOS,
	pagina,
	type RespuestaHtml,
} from "../plantilla.ts";
import { type DependenciasWeb, usuarioActual } from "../sesion.ts";

const ESTADOS: readonly Estado[] = ["backlog", "prepared", "doing", "done", "finished"];
const MARCAS: readonly Marca[] = ["bloqueada", "sin terminal", "en marcha", "análisis listo"];

/** Los valores de los campos de una tarea, para pintar el formulario relleno. */
type ValoresTarea = {
	titulo: string;
	descripcion: string;
	autoejecucion: boolean;
	analisisModelo: string | null;
	analisisTerminalId: number | null;
	ejecucionModelo: string | null;
	ejecucionTerminalId: number | null;
};

const TAREA_VACIA: ValoresTarea = {
	titulo: "",
	descripcion: "",
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
	return {
		titulo: campo(formulario, "titulo"),
		descripcion: campo(formulario, "descripcion"),
		autoejecucion: marcado(formulario, "autoejecucion"),
		analisisModelo: campoOpcional(formulario, "analisisModelo"),
		analisisTerminalId: numeroONull(campo(formulario, "analisisTerminal")),
		ejecucionModelo: campoOpcional(formulario, "ejecucionModelo"),
		ejecucionTerminalId: numeroONull(campo(formulario, "ejecucionTerminal")),
	};
}

/** Los campos de tarea que comparten «Nueva tarea» y «Editar», ya validados. */
function valoresDeFormulario(formulario: Formulario, activos: TerminalListado[]): ValoresTarea {
	return {
		...valoresCrudos(formulario),
		titulo: exigirTitulo(campo(formulario, "titulo")),
		analisisTerminalId: terminalDeFormulario(activos, campo(formulario, "analisisTerminal")),
		ejecucionTerminalId: terminalDeFormulario(activos, campo(formulario, "ejecucionTerminal")),
	};
}

// --- trozos de página --------------------------------------------------------

function enlaceTarea(id: number): Html {
	return html`<a class="id-tarea" href="/tareas/${formatearId(id)}">${formatearId(id)}</a>`;
}

function opcionTerminal(terminal: TerminalListado, seleccionado: number | null): Html {
	return html`<option value="${terminal.id}"${seleccionado === terminal.id ? raw(" selected") : ""}>${terminal.nombre}</option>`;
}

function selectTerminal(nombre: string, activos: TerminalListado[], seleccionado: number | null): Html {
	return html`<select name="${nombre}">
			<option value=""${seleccionado === null ? raw(" selected") : ""}>cualquiera</option>
			${activos.map((terminal) => opcionTerminal(terminal, seleccionado))}
		</select>`;
}

/** El formulario de una tarea, compartido por «Nueva tarea» y «Editar». */
function camposTarea(valores: ValoresTarea, activos: TerminalListado[]): Html {
	return html`<label>
			<span>Título</span>
			<input type="text" name="titulo" value="${valores.titulo}" required>
		</label>
		<label>
			<span>Descripción (Markdown)</span>
			<textarea name="descripcion" rows="10">${valores.descripcion}</textarea>
		</label>
		<label>
			<input type="checkbox" name="autoejecucion"${valores.autoejecucion ? raw(" checked") : ""}>
			Autoejecución: la ejecución arranca sola cuando el análisis termina sin preguntas abiertas
		</label>
		<datalist id="modelos">${MODELOS_SUGERIDOS.map((modelo) => html`<option value="${modelo}"></option>`)}</datalist>
		<fieldset>
			<legend>Análisis</legend>
			<label>
				<span>Modelo</span>
				<input type="text" name="analisisModelo" list="modelos" value="${valores.analisisModelo ?? ""}">
			</label>
			<label>
				<span>Terminal</span>
				${selectTerminal("analisisTerminal", activos, valores.analisisTerminalId)}
			</label>
		</fieldset>
		<fieldset>
			<legend>Ejecución</legend>
			<label>
				<span>Modelo</span>
				<input type="text" name="ejecucionModelo" list="modelos" value="${valores.ejecucionModelo ?? ""}">
			</label>
			<label>
				<span>Terminal</span>
				${selectTerminal("ejecucionTerminal", activos, valores.ejecucionTerminalId)}
			</label>
		</fieldset>`;
}

function filaTarea(db: DatabaseSync, item: ItemIndice): Html {
	const tarea = buscarTarea(db, item.id);
	return html`<tr>
			<td>${enlaceTarea(item.id)}</td>
			<td>${insigniasMarcas(item.marcas)} ${item.titulo}</td>
			<td class="pequeno">${faseLegible(item.analisisModelo, item.analisisTerminal)}</td>
			<td class="pequeno">${faseLegible(item.ejecucionModelo, item.ejecucionTerminal)}</td>
			<td class="pequeno">${tarea === undefined ? SIN_DATO : fechaLegible(tarea.actualizada)}</td>
		</tr>`;
}

function tablaLista(db: DatabaseSync, items: ItemIndice[]): Html {
	if (items.length === 0) {
		return html`<p class="silencio">Ninguna.</p>`;
	}
	return html`<div class="tabla-envuelta">
			<table>
				<thead>
					<tr><th>Id</th><th>Título</th><th>Análisis</th><th>Ejecución</th><th>Actualizada</th></tr>
				</thead>
				<tbody>${items.map((item) => filaTarea(db, item))}</tbody>
			</table>
		</div>`;
}

function grupoColumna(db: DatabaseSync, titulo: string, estado: Estado, items: ItemIndice[]): Html {
	const tabla = tablaLista(db, items);
	// Las cerradas están archivadas: se ven si se piden, no estorban por defecto.
	if (estado === "finished") {
		return html`<section class="grupo">
				<details>
					<summary><strong>${titulo}</strong> <span class="contador">${items.length}</span></summary>
					${tabla}
				</details>
			</section>`;
	}
	return html`<section class="grupo">
			<h2>${titulo} <span class="contador">${items.length}</span></h2>
			${tabla}
		</section>`;
}

function formularioFiltros(activos: TerminalListado[], estado: string, terminal: string, marca: string): Html {
	return html`<form class="filtros caja" method="get" action="/tareas">
			<label>
				<span>Estado</span>
				<select name="estado">
					<option value="">todos</option>
					${ESTADOS.map((valor) => html`<option value="${valor}"${valor === estado ? raw(" selected") : ""}>${valor}</option>`)}
				</select>
			</label>
			<label>
				<span>Terminal</span>
				<select name="terminal">
					<option value="">todos</option>
					${activos.map(
						(t) => html`<option value="${t.id}"${String(t.id) === terminal ? raw(" selected") : ""}>${t.nombre}</option>`,
					)}
				</select>
			</label>
			<label>
				<span>Marca</span>
				<select name="marca">
					<option value="">todas</option>
					${MARCAS.map((valor) => html`<option value="${valor}"${valor === marca ? raw(" selected") : ""}>${valor}</option>`)}
				</select>
			</label>
			<button type="submit">Filtrar</button>
			<a class="boton" href="/tareas">Quitar filtros</a>
		</form>`;
}

function tablaCampos(completa: TareaCompleta): Html {
	const { tarea } = completa;
	return html`<div class="tabla-envuelta">
			<table>
				<tbody>
					<tr><th>Orden</th><td>${tarea.orden}</td></tr>
					<tr>
						<th>Padre</th>
						<td>${tarea.padreId === null ? html`<span class="silencio">ninguno</span>` : enlaceTarea(tarea.padreId)}</td>
					</tr>
					<tr><th>Autoejecución</th><td>${tarea.autoejecucion ? "activada" : "desactivada"}</td></tr>
					<tr><th>Análisis</th><td>${faseLegible(tarea.analisisModelo, completa.analisisTerminal)}</td></tr>
					<tr><th>Ejecución</th><td>${faseLegible(tarea.ejecucionModelo, completa.ejecucionTerminal)}</td></tr>
					<tr><th>Creada</th><td>${fechaLegible(tarea.creada)}</td></tr>
					<tr><th>Revisión</th><td>${tarea.revision}</td></tr>
				</tbody>
			</table>
		</div>`;
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

/** El formulario de respuesta, dentro de la tarjeta de la pregunta abierta. */
function formularioRespuesta(tareaId: number, pregunta: Pregunta): Html {
	return html`<form class="responder" method="post" action="/tareas/${formatearId(tareaId)}/responder/P${pregunta.numero}">
			<fieldset>
				<legend>Responder a P${pregunta.numero}</legend>
				${pregunta.opciones.map(
					(opcion) => html`<label class="opcion">
						<input type="radio" name="opcion" value="${opcion.texto}" required>${opcion.texto}${
							opcion.texto === pregunta.recomendacion ? html`<span class="recomendada">recomendada</span>` : html``
						}
						<span class="consecuencia">${opcion.consecuencia}</span>
					</label>`,
				)}
				<label>
					<span>Nota (opcional)</span>
					<textarea name="nota" rows="3"></textarea>
				</label>
				<button type="submit" class="principal">Responder</button>
			</fieldset>
		</form>`;
}

function tarjetaComentario(completa: TareaCompleta, comentario: Comentario): Html {
	const pregunta =
		comentario.tipo === "pregunta" && comentario.preguntaId !== null
			? completa.preguntas.find((candidata) => candidata.id === comentario.preguntaId)
			: undefined;
	const abierta = pregunta !== undefined && pregunta.respuestaOpcion === null;
	return html`<article class="comentario">
			<header>
				${insigniaTipo(comentario.tipo)}
				<span class="autor">${comentario.autor}</span>
				<span>${fechaLegible(comentario.creado)}</span>
				${pregunta === undefined ? html`` : html`<span>P${pregunta.numero}</span>`}
			</header>
			<div class="cuerpo">${raw(renderMarkdown(comentario.texto))}</div>
			${abierta && pregunta !== undefined ? formularioRespuesta(completa.tarea.id, pregunta) : html``}
		</article>`;
}

/** Las transiciones que puede hacer el humano desde este estado. */
function acciones(completa: TareaCompleta): Html {
	const id = formatearId(completa.tarea.id);
	const mover = `/tareas/${id}/mover`;
	if (completa.tarea.estado === "backlog") {
		return html`<div class="acciones">
				<form method="post" action="${mover}">
					<input type="hidden" name="estado" value="prepared">
					<button type="submit" class="principal">Pasar a prepared</button>
				</form>
			</div>`;
	}
	if (completa.tarea.estado === "prepared") {
		const aprobar = completa.marcas.includes("análisis listo")
			? html`<div class="acciones">
					<form method="post" action="/tareas/${id}/aprobar">
						<button type="submit" class="principal">Aprobar ejecución</button>
					</form>
				</div>`
			: html``;
		return html`${aprobar}
			<form method="post" action="${mover}">
				<input type="hidden" name="estado" value="backlog">
				<label>
					<span>Nota: por qué vuelve a backlog</span>
					<textarea name="nota" rows="3" required></textarea>
				</label>
				<button type="submit">Volver a backlog</button>
			</form>`;
	}
	if (completa.tarea.estado === "done") {
		return html`<div class="acciones">
				<form method="post" action="${mover}">
					<input type="hidden" name="estado" value="finished">
					<button type="submit" class="principal">Finalizar</button>
				</form>
			</div>
			<form method="post" action="${mover}">
				<input type="hidden" name="estado" value="doing">
				<label>
					<span>Nota: qué falta</span>
					<textarea name="nota" rows="3" required></textarea>
				</label>
				<button type="submit">Devolver a doing</button>
			</form>`;
	}
	// En `doing` manda el agente y `finished` está archivada: el humano no
	// mueve ninguna de las dos.
	return html`<p class="silencio">Ninguna: esta columna no la mueve el humano.</p>`;
}

// --- páginas -----------------------------------------------------------------

function paginaNoEncontrada(c: Context, mensaje: string): RespuestaHtml {
	return c.html(
		pagina({
			titulo: "No encontrada",
			usuario: usuarioActual(c),
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

	const cuerpo = html`<h1>Tareas</h1>
		<div class="acciones">
			<a class="boton principal" href="/tareas/nueva">Nueva tarea</a>
		</div>
		${formularioFiltros(activos, estado, terminal, marca)}
		${COLUMNAS.map((columna) =>
			grupoColumna(
				db,
				columna.titulo,
				columna.estado,
				items.filter((item) => item.estado === columna.estado),
			),
		)}`;
	return c.html(pagina({ titulo: "Tareas", usuario: usuarioActual(c), cuerpo }));
}

function paginaNueva(c: Context, deps: DependenciasWeb, valores: ValoresTarea, aviso: string | null): RespuestaHtml {
	const activos = terminalesActivos(deps.db);
	const cuerpo = html`<h1>Nueva tarea</h1>
		<form class="caja" method="post" action="/tareas">
			${camposTarea(valores, activos)}
			<button type="submit" class="principal">Crear tarea</button>
			<a class="boton" href="/tareas">Cancelar</a>
		</form>`;
	return c.html(
		pagina({ titulo: "Nueva tarea", usuario: usuarioActual(c), aviso, cuerpo }),
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
	const activos = terminalesActivos(deps.db);

	const editar =
		tarea.estado === "backlog"
			? html`<details class="caja">
					<summary><strong>Editar</strong></summary>
					<form method="post" action="/tareas/${id}/editar">
						${camposTarea(
							{
								titulo: tarea.titulo,
								descripcion: tarea.descripcion,
								autoejecucion: tarea.autoejecucion,
								analisisModelo: tarea.analisisModelo,
								analisisTerminalId: tarea.analisisTerminalId,
								ejecucionModelo: tarea.ejecucionModelo,
								ejecucionTerminalId: tarea.ejecucionTerminalId,
							},
							activos,
						)}
						<button type="submit" class="principal">Guardar cambios</button>
					</form>
				</details>`
			: html``;

	const cuerpo = html`<div class="cabecera-tarea">
			<span class="id-tarea">${id}</span>
			<h1>${tarea.titulo}</h1>
			${insigniaEstado(tarea.estado)}
			${insigniasMarcas(completa.marcas)}
		</div>

		<h2>Campos</h2>
		${tablaCampos(completa)}

		<h2>Descripción</h2>
		<div class="caja cuerpo">${raw(renderMarkdown(tarea.descripcion))}</div>

		<h2>Hijas</h2>
		${
			completa.hijas.length === 0
				? html`<p class="silencio">Ninguna.</p>`
				: html`<ul>
					${completa.hijas.map(
						(hija) => html`<li>${enlaceTarea(hija.id)} · ${insigniaEstado(hija.estado)} ${hija.titulo}</li>`,
					)}
				</ul>`
		}

		<h2>Consumo</h2>
		${tablaConsumo(completa.consumo)}

		<h2>Hilo</h2>
		${
			completa.comentarios.length === 0
				? html`<p class="silencio">Ninguno.</p>`
				: html`<div class="hilo">${completa.comentarios.map((comentario) => tarjetaComentario(completa, comentario))}</div>`
		}

		<h2>Nota</h2>
		<form class="caja" method="post" action="/tareas/${id}/nota">
			<label>
				<span>Indicación para el agente (Markdown)</span>
				<textarea name="texto" rows="4" required></textarea>
			</label>
			<button type="submit">Añadir nota</button>
		</form>

		<h2>Acciones</h2>
		${acciones(completa)}
		${editar}`;

	return c.html(
		pagina({ titulo: `${id} · ${tarea.titulo}`, usuario: usuarioActual(c), aviso, cuerpo }),
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
