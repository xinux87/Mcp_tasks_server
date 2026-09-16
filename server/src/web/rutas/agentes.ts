import type { Context, Hono } from "hono";
import { html, raw } from "hono/html";
import { altaPor } from "../../db/actividad.ts";
import { type TerminalListado, terminalesActivos } from "../../db/admin.ts";
import {
	type Agente,
	borrarAgente,
	buscarAgentePorId,
	crearAgente,
	editarAgente,
	fasesAsignadas,
	listarAgentes,
	MODELOS,
	terminalDeAgente,
} from "../../db/agentes.ts";
import { buscadorDeColor, type Color, chipDeAlta, type Miga } from "../componentes.ts";
import { campo, campoOpcional, ESTADO_AVISO, type Formulario, leerFormulario, mensajeDeRegla } from "../formulario.ts";
import { type Html, pagina, type RespuestaHtml } from "../plantilla.ts";
import { type DependenciasWeb, usuarioActual } from "../sesion.ts";
import { navProyectos } from "./proyectos.ts";
import { selectTerminal } from "./tareas.ts";

/** Para qué sirve la pantalla, en la frase que va bajo el título. */
const PROPOSITO = "Un agente es un papel: quién es, cómo trabaja y con qué modelo. Las tareas se lo asignan por fase.";

/** Cómo se busca el color de cada usuario que aparece en la página. */
type ColorDe = (nombre: string) => Color | null;

/** Las migas de todo lo que cuelga de la lista de agentes. */
function migasDe(donde: string): Miga[] {
	return [{ texto: "Agentes", href: "/agentes" }, { texto: donde }];
}

// --- la lista ----------------------------------------------------------------

function filaAgente(deps: DependenciasWeb, agente: Agente, colorDe: ColorDe): Html {
	const terminal = terminalDeAgente(deps.db, agente);
	return html`<tr>
			<td><a href="/agentes/${agente.id}/editar">${agente.nombre}</a></td>
			<td class="pequeno">${agente.descripcion === "" ? html`<span class="silencio">—</span>` : agente.descripcion}</td>
			<td class="pequeno"><code>${agente.modelo}</code></td>
			<td class="pequeno">${
				terminal === null ? html`<span class="silencio">cualquiera</span>` : html`<code>${terminal}</code>`
			}</td>
			<td class="numero pequeno">${fasesAsignadas(deps.db, agente.id)}</td>
			<td>${chipDeAlta(altaPor(deps.db, "agente", agente.id), colorDe)}</td>
			<td>
				<span class="acciones-terminal">
					<a class="accion-fila neutra" href="/agentes/${agente.id}/editar">Editar</a>
					<a class="accion-fila" href="/agentes/${agente.id}/borrar">Borrar</a>
				</span>
			</td>
		</tr>`;
}

function paginaAgentes(c: Context, deps: DependenciasWeb, aviso: string | null): RespuestaHtml {
	const agentes = listarAgentes(deps.db);
	const colorDe = buscadorDeColor(deps.db);
	const cuerpo =
		agentes.length === 0
			? html`<p class="silencio">Todavía no hay ningún agente. Sin papel, cada fase se lanza con su modelo a secas.</p>`
			: html`<div class="tabla-envuelta">
				<table class="tabla-agentes">
					<thead>
						<tr>
							<th>Nombre</th><th>Descripción</th><th>Modelo</th><th>Terminal</th>
							<th class="numero">Fases asignadas</th><th>Creado por</th><th></th>
						</tr>
					</thead>
					<tbody>${agentes.map((agente) => filaAgente(deps, agente, colorDe))}</tbody>
				</table>
			</div>`;
	return c.html(
		pagina({
			...navProyectos(c, deps.db),
			titulo: "Agentes",
			proposito: PROPOSITO,
			usuario: usuarioActual(c),
			vista: "agentes",
			aviso,
			acciones: html`<a class="boton principal" href="/agentes/nuevo">Nuevo agente</a>`,
			cuerpo,
		}),
		aviso === null ? 200 : ESTADO_AVISO,
	);
}

// --- el formulario -----------------------------------------------------------

/**
 * Lo que enseña el formulario: en blanco al entrar en el alta, lo que ya tiene
 * el agente al editarlo, y lo que llegó cuando el alta rompió una regla.
 */
type ValoresAgente = {
	nombre: string;
	descripcion: string;
	instrucciones: string;
	modelo: string;
	terminalId: number | null;
};

const AGENTE_EN_BLANCO: ValoresAgente = {
	nombre: "",
	descripcion: "",
	instrucciones: "",
	modelo: "sonnet",
	terminalId: null,
};

function valoresDeFormulario(formulario: Formulario): ValoresAgente {
	const terminal = campoOpcional(formulario, "terminal");
	return {
		nombre: campo(formulario, "nombre"),
		descripcion: campo(formulario, "descripcion"),
		instrucciones: campo(formulario, "instrucciones"),
		modelo: campo(formulario, "modelo"),
		terminalId: terminal === null ? null : Number.parseInt(terminal, 10),
	};
}

/** El desplegable de modelo: la lista cerrada con la que se lanza un agente. */
function selectModelo(elegido: string): Html {
	return html`<select name="modelo">
			${MODELOS.map(
				(modelo) => html`<option value="${modelo}"${modelo === elegido ? raw(" selected") : ""}>${modelo}</option>`,
			)}
		</select>`;
}

/** Lo que se edita de un agente. El nombre no está: se fija al crear. */
function camposAgente(valores: ValoresAgente, activos: TerminalListado[]): Html {
	return html`<label>
			<span>Descripción</span>
			<input type="text" name="descripcion" value="${valores.descripcion}" placeholder="Revisa lo entregado y no toca código">
		</label>
		<label>
			<span>Instrucciones (Markdown)</span>
			<textarea class="codigo" name="instrucciones" rows="18" required>${valores.instrucciones}</textarea>
			<span class="ayuda">El papel, escrito como se le habla al subagente: «Eres el revisor de…». El bucle lo copia entero al prompt.</span>
		</label>
		<label>
			<span>Modelo</span>
			${selectModelo(valores.modelo)}
		</label>
		<label>
			<span>Terminal</span>
			${selectTerminal("terminal", activos, valores.terminalId)}
			<span class="ayuda">Con terminal, el agente corre solo en él; sin terminal, en cualquiera.</span>
		</label>`;
}

function paginaNuevo(c: Context, deps: DependenciasWeb, valores: ValoresAgente, aviso: string | null): RespuestaHtml {
	const cuerpo = html`<form method="post" action="/agentes">
			<label>
				<span>Nombre</span>
				<input type="text" name="nombre" value="${valores.nombre}" placeholder="revisor" required>
				<span class="ayuda">De dos a treinta caracteres, en minúsculas con guiones, empezando por letra. No se cambia después.</span>
			</label>
			${camposAgente(valores, terminalesActivos(deps.db))}
			<div class="acciones">
				<button type="submit" class="principal">Crear agente</button>
				<a class="boton" href="/agentes">Cancelar</a>
			</div>
		</form>`;
	return c.html(
		pagina({
			...navProyectos(c, deps.db),
			titulo: "Nuevo agente",
			proposito: PROPOSITO,
			usuario: usuarioActual(c),
			vista: "agentes",
			migas: migasDe("Nuevo agente"),
			aviso,
			cuerpo,
		}),
		aviso === null ? 200 : ESTADO_AVISO,
	);
}

function paginaEditar(
	c: Context,
	deps: DependenciasWeb,
	agenteId: number,
	valores: ValoresAgente,
	aviso: string | null,
): RespuestaHtml {
	const cuerpo = html`<form method="post" action="/agentes/${agenteId}/editar">
			<p class="nombre-campo">Nombre</p>
			<p><code>${valores.nombre}</code> <span class="silencio">se fija al crear el agente y no se cambia.</span></p>
			${camposAgente(valores, terminalesActivos(deps.db))}
			<div class="acciones">
				<button type="submit" class="principal">Guardar cambios</button>
				<a class="boton" href="/agentes">Cancelar</a>
			</div>
		</form>`;
	return c.html(
		pagina({
			...navProyectos(c, deps.db),
			titulo: valores.nombre,
			proposito: PROPOSITO,
			usuario: usuarioActual(c),
			vista: "agentes",
			migas: migasDe(valores.nombre),
			aviso,
			cuerpo,
		}),
		aviso === null ? 200 : ESTADO_AVISO,
	);
}

function paginaNoEncontrado(c: Context, deps: DependenciasWeb): RespuestaHtml {
	return c.html(
		pagina({
			...navProyectos(c, deps.db),
			titulo: "Agente no encontrado",
			usuario: usuarioActual(c),
			vista: "agentes",
			migas: migasDe("No encontrado"),
			cuerpo: html`<section class="caja caja-estrecha">
				<p>No existe ese agente.</p>
				<p><a class="boton" href="/agentes">Volver a agentes</a></p>
			</section>`,
		}),
		404,
	);
}

/** El agente de la ruta `/agentes/:id/…`, o `undefined` si el id no es de ninguno. */
function agenteDeRuta(deps: DependenciasWeb, c: Context): Agente | undefined {
	return buscarAgentePorId(deps.db, Number.parseInt(c.req.param("id") ?? "", 10));
}

/** Del agente al formulario: lo que ya tiene puesto, para repintarlo relleno. */
function valoresDe(agente: Agente): ValoresAgente {
	return {
		nombre: agente.nombre,
		descripcion: agente.descripcion,
		instrucciones: agente.instrucciones,
		modelo: agente.modelo,
		terminalId: agente.terminalId,
	};
}

/** Rutas de agentes: la lista, el alta, la edición y el borrado. */
export function registrarRutasAgentes(app: Hono, deps: DependenciasWeb): void {
	app.get("/agentes", (c) => paginaAgentes(c, deps, null));

	app.get("/agentes/nuevo", (c) => paginaNuevo(c, deps, AGENTE_EN_BLANCO, null));

	app.post("/agentes", async (c) => {
		const formulario = await leerFormulario(c);
		const valores = valoresDeFormulario(formulario);
		try {
			crearAgente(deps.db, { ...valores, actor: { usuarioId: usuarioActual(c).id } });
			return c.redirect("/agentes", 302);
		} catch (error) {
			return paginaNuevo(c, deps, valores, mensajeDeRegla(error));
		}
	});

	app.get("/agentes/:id/editar", (c) => {
		const agente = agenteDeRuta(deps, c);
		return agente === undefined ? paginaNoEncontrado(c, deps) : paginaEditar(c, deps, agente.id, valoresDe(agente), null);
	});

	app.post("/agentes/:id/editar", async (c) => {
		const agente = agenteDeRuta(deps, c);
		if (agente === undefined) {
			return paginaNoEncontrado(c, deps);
		}
		const valores = valoresDeFormulario(await leerFormulario(c));
		try {
			editarAgente(deps.db, { ...valores, agenteId: agente.id, actor: { usuarioId: usuarioActual(c).id } });
			return c.redirect("/agentes", 302);
		} catch (error) {
			// El nombre nunca viene del formulario: es el del agente que se edita.
			return paginaEditar(c, deps, agente.id, { ...valores, nombre: agente.nombre }, mensajeDeRegla(error));
		}
	});

	// Sin JavaScript: el enlace de la tabla lleva aquí y aquí está el POST.
	app.get("/agentes/:id/borrar", (c) => {
		const agente = agenteDeRuta(deps, c);
		if (agente === undefined) {
			return paginaNoEncontrado(c, deps);
		}
		const fases = fasesAsignadas(deps.db, agente.id);
		const cuerpo = html`<section class="caja caja-estrecha">
			<p>Se borra el agente <strong>${agente.nombre}</strong>.</p>
			<p>${
				fases === 0
					? html`No está asignado a ninguna fase.`
					: html`Está asignado a <strong>${fases}</strong> ${fases === 1 ? "fase" : "fases"}: ${fases === 1 ? "se queda" : "se quedan"} sin papel, con el modelo y el terminal que les copió al asignarlo.`
			}</p>
			<div class="acciones">
				<form method="post" action="/agentes/${agente.id}/borrar">
					<button type="submit" class="peligro">Sí, borrar</button>
				</form>
				<a class="boton" href="/agentes">Cancelar</a>
			</div>
		</section>`;
		return c.html(
			pagina({
				...navProyectos(c, deps.db),
				titulo: "Borrar agente",
				usuario: usuarioActual(c),
				vista: "agentes",
				migas: migasDe("Borrar agente"),
				cuerpo,
			}),
		);
	});

	app.post("/agentes/:id/borrar", (c) => {
		const agente = agenteDeRuta(deps, c);
		if (agente === undefined) {
			return paginaNoEncontrado(c, deps);
		}
		try {
			borrarAgente(deps.db, agente.id, { usuarioId: usuarioActual(c).id });
			return c.redirect("/agentes", 302);
		} catch (error) {
			return paginaAgentes(c, deps, mensajeDeRegla(error));
		}
	});
}
