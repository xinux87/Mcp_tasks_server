import type { DatabaseSync } from "node:sqlite";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { html } from "hono/html";
import { altaPor } from "../../db/actividad.ts";
import { listarTerminales } from "../../db/admin.ts";
import { contarPendientes } from "../../db/bandeja.ts";
import { type ColorUsuario, esColorUsuario } from "../../db/colores.ts";
import {
	borrarProyecto,
	buscarProyectoPorClave,
	buscarProyectoPorId,
	crearProyecto,
	editarProyecto,
	listarProyectos,
	PROYECTO_PRINCIPAL,
	type Proyecto,
} from "../../db/proyectos.ts";
import { listarTareas } from "../../db/tareas.ts";
import { buscadorDeColor, type Color, chipDeAlta, chipProyecto, type Miga, selectorDeColor } from "../componentes.ts";
import { SIN_DATO } from "../formatos.ts";
import { campo, campoOpcional, ESTADO_AVISO, type Formulario, leerFormulario, mensajeDeRegla } from "../formulario.ts";
import { type Html, type NavProyectos, pagina, type RespuestaHtml } from "../plantilla.ts";
import {
	claveRecordada,
	type DependenciasWeb,
	destinoSeguro,
	recordarProyecto,
	TODOS_LOS_PROYECTOS,
	usuarioActual,
} from "../sesion.ts";

declare module "hono" {
	interface ContextVariableMap {
		/**
		 * Proyecto del tablero acotado, o `undefined` en la vista cruzada. Lo deja
		 * `exigeProyecto` leyendo la clave de la URL.
		 */
		proyecto: Proyecto | undefined;
	}
}

// --- el proyecto de la URL ---------------------------------------------------

/** El proyecto de la URL actual, o `undefined` si la vista es la cruzada. */
export function proyectoActual(c: Context): Proyecto | undefined {
	return c.get("proyecto");
}

/**
 * El prefijo de las vistas acotadas: `/p/WEB`, o vacío en la vista cruzada. Es
 * lo que antepone cada enlace interno para no salirse del proyecto.
 */
export function prefijo(proyecto: Proyecto | undefined): string {
	return proyecto === undefined ? "" : `/p/${proyecto.clave}`;
}

/**
 * Qué se estaba mirando la última vez: un proyecto, o todos. La vista cruzada
 * solo sale de haberla elegido; sin cookie, o con la clave de un proyecto que
 * ya no existe, se vuelve al principal, que es donde cae todo por defecto.
 */
export type Recordado = { modo: "proyecto"; proyecto: Proyecto } | { modo: "todos" };

export function proyectoRecordado(c: Context, db: DatabaseSync): Recordado {
	const clave = claveRecordada(c);
	if (clave === TODOS_LOS_PROYECTOS) {
		return { modo: "todos" };
	}
	const recordado = clave === undefined ? undefined : buscarProyectoPorClave(db, clave);
	const proyecto = recordado ?? buscarProyectoPorId(db, PROYECTO_PRINCIPAL);
	return proyecto === undefined ? { modo: "todos" } : { modo: "proyecto", proyecto };
}

/**
 * El proyecto de una página que no lo lleva en la URL: el recordado, y el
 * principal cuando lo recordado es «todos». Es donde nace una tarea creada
 * desde la vista cruzada.
 */
export function proyectoDeTrabajo(c: Context, db: DatabaseSync): Proyecto | undefined {
	const recordado = proyectoRecordado(c, db);
	return recordado.modo === "proyecto" ? recordado.proyecto : buscarProyectoPorId(db, PROYECTO_PRINCIPAL);
}

/**
 * Lo que la barra lateral necesita saber en cualquier página con sesión: los
 * proyectos y cuántas cosas esperan por el humano. Todas las páginas lo
 * reparten sobre `pagina`, así que el contador de la bandeja se calcula aquí
 * una sola vez y no en cada ruta.
 *
 * El proyecto de la barra es el de la URL cuando la página está acotada y el
 * recordado cuando no: así los enlaces de Tareas, Funcionalidades e Informes
 * llevan al proyecto en el que se estaba desde cualquier pantalla.
 */
export function navProyectos(c: Context, db: DatabaseSync): NavProyectos {
	return { proyectos: listarProyectos(db), proyecto: proyectoDeLaBarra(c, db), pendientes: contarPendientes(db) };
}

/**
 * A qué proyecto apuntan la barra lateral y la acción «Nueva tarea»: el de la
 * URL si la página está acotada, y si no el recordado. `undefined` solo cuando
 * se eligieron todos los proyectos, que es la única forma de llegar a las
 * rutas sin prefijo.
 */
export function proyectoDeLaBarra(c: Context, db: DatabaseSync): Proyecto | undefined {
	const recordado = proyectoRecordado(c, db);
	return proyectoActual(c) ?? (recordado.modo === "proyecto" ? recordado.proyecto : undefined);
}

function paginaSinProyecto(c: Context, db: DatabaseSync, clave: string): RespuestaHtml {
	return c.html(
		pagina({
			...navProyectos(c, db),
			titulo: "Proyecto no encontrado",
			usuario: usuarioActual(c),
			vista: "proyectos",
			cuerpo: html`<section class="caja caja-estrecha">
				<p>No existe ningún proyecto con la clave «${clave}».</p>
				<p><a class="boton" href="/proyectos">Ver los proyectos</a></p>
			</section>`,
		}),
		404,
	);
}

/**
 * Guardián de las vistas acotadas `/p/:clave/…`: deja el proyecto en el
 * contexto, o responde la página de 404 si la clave no es de ninguno. Va
 * detrás de la sesión, como el resto de la web.
 */
export function exigeProyecto(deps: DependenciasWeb): MiddlewareHandler {
	return async (c, next) => {
		const clave = c.req.param("clave") ?? "";
		const proyecto = buscarProyectoPorClave(deps.db, clave);
		if (proyecto === undefined) {
			return paginaSinProyecto(c, deps.db, clave);
		}
		c.set("proyecto", proyecto);
		// Una vez por petición: la barra lateral de cualquier otra página volverá
		// a este proyecto sin preguntar.
		recordarProyecto(c, deps.config, proyecto.clave);
		await next();
		return;
	};
}

// --- la página de proyectos --------------------------------------------------

/** Un proyecto con lo que cuelga de él: es lo que impide borrarlo. */
type Fila = {
	proyecto: Proyecto;
	abiertas: number;
	terminales: number;
};

function filasDe(db: DatabaseSync): Fila[] {
	const tareas = listarTareas(db);
	const terminales = listarTerminales(db);
	return listarProyectos(db).map((proyecto) => ({
		proyecto,
		abiertas: tareas.filter((item) => item.proyectoId === proyecto.id && item.estado !== "finished").length,
		terminales: terminales.filter((terminal) => terminal.proyectoId === proyecto.id).length,
	}));
}

function textoOpcionalLegible(valor: string | null): Html {
	return valor === null ? html`<span class="silencio">${SIN_DATO}</span>` : html`<code>${valor}</code>`;
}

/** Cómo se busca el color de cada usuario que aparece en la página. */
type ColorDe = (nombre: string) => Color | null;

function filaProyecto(db: DatabaseSync, fila: Fila, colorDe: ColorDe): Html {
	const { proyecto } = fila;
	return html`<tr>
			<td>${chipProyecto(proyecto)}</td>
			<td>
				<a href="${`/p/${proyecto.clave}/tareas`}">${proyecto.nombre}</a>
				${proyecto.descripcion === "" ? html`` : html`<span class="pequeno silencio">${proyecto.descripcion}</span>`}
			</td>
			<td class="pequeno">${textoOpcionalLegible(proyecto.repositorio)}</td>
			<td class="pequeno"><code>${proyecto.ramaPrincipal}</code></td>
			<td class="numero pequeno">${fila.abiertas}</td>
			<td class="numero pequeno">${fila.terminales}</td>
			<td>${chipDeAlta(altaPor(db, "proyecto", proyecto.id), colorDe)}</td>
			<td>
				<span class="acciones-terminal">
					<a class="accion-fila neutra" href="/proyectos/${proyecto.id}/editar">Editar</a>
					<a class="accion-fila" href="/proyectos/${proyecto.id}/borrar">Borrar</a>
				</span>
			</td>
		</tr>`;
}

/**
 * Lo que enseña el formulario: en blanco al entrar en el alta, lo que ya tiene
 * el proyecto al editarlo, y lo que llegó cuando el alta rompió una regla.
 */
type ValoresProyecto = {
	clave: string;
	nombre: string;
	descripcion: string;
	repositorio: string | null;
	ramaPrincipal: string | null;
	verificacion: string | null;
	color: ColorUsuario | null;
};

const PROYECTO_EN_BLANCO: ValoresProyecto = {
	clave: "",
	nombre: "",
	descripcion: "",
	repositorio: null,
	ramaPrincipal: null,
	verificacion: null,
	color: null,
};

/** Lo que llegó en el alta, para repintarla sin perder lo escrito. */
function valoresDeFormulario(formulario: Formulario): ValoresProyecto {
	const color = campoOpcional(formulario, "color");
	return {
		clave: campo(formulario, "clave"),
		nombre: campo(formulario, "nombre"),
		descripcion: campo(formulario, "descripcion"),
		repositorio: campoOpcional(formulario, "repositorio"),
		ramaPrincipal: campoOpcional(formulario, "ramaPrincipal"),
		verificacion: campoOpcional(formulario, "verificacion"),
		color: color !== null && esColorUsuario(color) ? color : null,
	};
}

/** Los campos que se editan de un proyecto. La clave no está: se fija al crear. */
function camposProyecto(valores: ValoresProyecto, tituloColor: string): Html {
	return html`<label>
			<span>Nombre</span>
			<input type="text" name="nombre" value="${valores.nombre}" required>
		</label>
		<label>
			<span>Descripción</span>
			<textarea name="descripcion" rows="3">${valores.descripcion}</textarea>
		</label>
		<label>
			<span>Repositorio</span>
			<input type="text" name="repositorio" value="${valores.repositorio ?? ""}" placeholder="https://github.com/usuario/repositorio">
			<span class="ayuda">Si lo pones, un terminal que trabaje en otro repositorio no podrá registrarse.</span>
		</label>
		<label>
			<span>Rama principal</span>
			<input type="text" name="ramaPrincipal" value="${valores.ramaPrincipal ?? "main"}" required>
		</label>
		<label>
			<span>Verificación</span>
			<input type="text" name="verificacion" value="${valores.verificacion ?? ""}" placeholder="cd server && npm test">
			<span class="ayuda">El comando que tiene que pasar la parte que integra la rama.</span>
		</label>
		<p class="nombre-campo">Color</p>
		${selectorDeColor(tituloColor, valores.color)}`;
}

/** El alta, en su propia página: es donde lleva «Nuevo proyecto» de la lista. */
function paginaNuevoProyecto(
	c: Context,
	deps: DependenciasWeb,
	valores: ValoresProyecto,
	aviso: string | null,
): RespuestaHtml {
	const cuerpo = html`<form method="post" action="/proyectos">
			<label>
				<span>Clave</span>
				<input type="text" name="clave" value="${valores.clave}" placeholder="WEB" required>
				<span class="ayuda">De dos a ocho caracteres, mayúsculas y cifras, empezando por letra. Va en las URLs y no se cambia.</span>
			</label>
			${camposProyecto(valores, "Color del proyecto")}
			<div class="acciones">
				<button type="submit" class="principal">Crear proyecto</button>
				<a class="boton" href="/proyectos">Cancelar</a>
			</div>
		</form>`;
	return c.html(
		pagina({
			...navProyectos(c, deps.db),
			titulo: "Nuevo proyecto",
			proposito: "Un proyecto es un repositorio: clave, nombre, dónde está y cómo se verifica.",
			usuario: usuarioActual(c),
			vista: "proyectos",
			migas: migasDe("Nuevo proyecto"),
			aviso,
			cuerpo,
		}),
		aviso === null ? 200 : ESTADO_AVISO,
	);
}

function paginaProyectos(c: Context, deps: DependenciasWeb, aviso: string | null): RespuestaHtml {
	const filas = filasDe(deps.db);
	const colorDe = buscadorDeColor(deps.db);
	const cuerpo = html`<div class="tabla-envuelta">
			<table class="tabla-proyectos">
				<thead>
					<tr>
						<th>Clave</th><th>Nombre</th><th>Repositorio</th><th>Rama principal</th>
						<th class="numero">Tareas abiertas</th><th class="numero">Terminales</th><th>Creado por</th><th></th>
					</tr>
				</thead>
				<tbody>${filas.map((fila) => filaProyecto(deps.db, fila, colorDe))}</tbody>
			</table>
		</div>`;

	return c.html(
		pagina({
			...navProyectos(c, deps.db),
			titulo: "Proyectos",
			proposito: "Un proyecto es un repositorio; sus terminales y sus tareas cuelgan de él.",
			usuario: usuarioActual(c),
			vista: "proyectos",
			aviso,
			acciones: html`<a class="boton principal" href="/proyectos/nuevo">Nuevo proyecto</a>`,
			cuerpo,
		}),
		aviso === null ? 200 : ESTADO_AVISO,
	);
}

/** Las migas de todo lo que cuelga de la lista de proyectos. */
function migasDe(donde: string): Miga[] {
	return [{ texto: "Proyectos", href: "/proyectos" }, { texto: donde }];
}

/** El proyecto de la ruta `/proyectos/:id/…`, o `undefined` si el id no es de ninguno. */
function proyectoDeRuta(deps: DependenciasWeb, c: Context): Proyecto | undefined {
	return buscarProyectoPorId(deps.db, Number.parseInt(c.req.param("id") ?? "", 10));
}

function paginaNoEncontrado(c: Context, deps: DependenciasWeb): RespuestaHtml {
	return c.html(
		pagina({
			...navProyectos(c, deps.db),
			titulo: "Proyecto no encontrado",
			usuario: usuarioActual(c),
			vista: "proyectos",
			migas: migasDe("No encontrado"),
			cuerpo: html`<section class="caja caja-estrecha">
				<p>No existe ese proyecto.</p>
				<p><a class="boton" href="/proyectos">Volver a proyectos</a></p>
			</section>`,
		}),
		404,
	);
}

function paginaEditar(c: Context, deps: DependenciasWeb, proyecto: Proyecto, aviso: string | null): RespuestaHtml {
	const cuerpo = html`<form method="post" action="/proyectos/${proyecto.id}/editar">
			<p class="nombre-campo">Clave</p>
			<p>${chipProyecto(proyecto)} <span class="silencio">se fija al crear el proyecto y no se cambia.</span></p>
			${camposProyecto(proyecto, `Color de ${proyecto.clave}`)}
			<div class="acciones">
				<button type="submit" class="principal">Guardar cambios</button>
				<a class="boton" href="/proyectos">Cancelar</a>
			</div>
		</form>`;
	return c.html(
		pagina({
			...navProyectos(c, deps.db),
			titulo: proyecto.nombre,
			usuario: usuarioActual(c),
			vista: "proyectos",
			migas: migasDe(proyecto.clave),
			aviso,
			cuerpo,
		}),
		aviso === null ? 200 : ESTADO_AVISO,
	);
}

/**
 * El color elegido en el formulario. Sin elegir ninguno no se manda el campo:
 * es lo que hace que el alta reparta el menos usado y que la edición deje el
 * que ya tenía.
 */
function colorElegido(formulario: Formulario): { color?: string } {
	const color = campoOpcional(formulario, "color");
	return color === null ? {} : { color };
}

/** Rutas de proyectos: la lista, el alta, la edición, el borrado y el salto de vista. */
export function registrarRutasProyectos(app: Hono, deps: DependenciasWeb): void {
	app.get("/proyectos", (c) => paginaProyectos(c, deps, null));

	app.get("/proyectos/nuevo", (c) => paginaNuevoProyecto(c, deps, PROYECTO_EN_BLANCO, null));

	app.post("/proyectos", async (c) => {
		const formulario = await leerFormulario(c);
		try {
			crearProyecto(deps.db, {
				clave: campo(formulario, "clave"),
				nombre: campo(formulario, "nombre"),
				descripcion: campo(formulario, "descripcion"),
				repositorio: campoOpcional(formulario, "repositorio"),
				ramaPrincipal: campoOpcional(formulario, "ramaPrincipal"),
				verificacion: campoOpcional(formulario, "verificacion"),
				...colorElegido(formulario),
				actor: { usuarioId: usuarioActual(c).id },
			});
			return c.redirect("/proyectos", 302);
		} catch (error) {
			return paginaNuevoProyecto(c, deps, valoresDeFormulario(formulario), mensajeDeRegla(error));
		}
	});

	app.get("/proyectos/:id/editar", (c) => {
		const proyecto = proyectoDeRuta(deps, c);
		return proyecto === undefined ? paginaNoEncontrado(c, deps) : paginaEditar(c, deps, proyecto, null);
	});

	app.post("/proyectos/:id/editar", async (c) => {
		const proyecto = proyectoDeRuta(deps, c);
		if (proyecto === undefined) {
			return paginaNoEncontrado(c, deps);
		}
		const formulario = await leerFormulario(c);
		try {
			editarProyecto(deps.db, {
				proyectoId: proyecto.id,
				nombre: campo(formulario, "nombre"),
				descripcion: campo(formulario, "descripcion"),
				repositorio: campoOpcional(formulario, "repositorio"),
				ramaPrincipal: campoOpcional(formulario, "ramaPrincipal"),
				verificacion: campoOpcional(formulario, "verificacion"),
				...colorElegido(formulario),
				actor: { usuarioId: usuarioActual(c).id },
			});
			return c.redirect("/proyectos", 302);
		} catch (error) {
			return paginaEditar(c, deps, proyecto, mensajeDeRegla(error));
		}
	});

	// Sin JavaScript: el enlace de la tabla lleva aquí y aquí está el POST.
	app.get("/proyectos/:id/borrar", (c) => {
		const proyecto = proyectoDeRuta(deps, c);
		if (proyecto === undefined) {
			return paginaNoEncontrado(c, deps);
		}
		const cuerpo = html`<section class="caja caja-estrecha">
			<p>
				Se borra el proyecto ${chipProyecto(proyecto)} <strong>${proyecto.nombre}</strong>. Solo se
				puede si ya no le queda ninguna tarea ni ningún terminal.
			</p>
			<div class="acciones">
				<form method="post" action="/proyectos/${proyecto.id}/borrar">
					<button type="submit" class="peligro">Sí, borrar</button>
				</form>
				<a class="boton" href="/proyectos">Cancelar</a>
			</div>
		</section>`;
		return c.html(
			pagina({
				...navProyectos(c, deps.db),
				titulo: "Borrar proyecto",
				usuario: usuarioActual(c),
				vista: "proyectos",
				migas: migasDe("Borrar proyecto"),
				cuerpo,
			}),
		);
	});

	app.post("/proyectos/:id/borrar", (c) => {
		const proyecto = proyectoDeRuta(deps, c);
		if (proyecto === undefined) {
			return paginaNoEncontrado(c, deps);
		}
		try {
			borrarProyecto(deps.db, proyecto.id, { usuarioId: usuarioActual(c).id });
			return c.redirect("/proyectos", 302);
		} catch (error) {
			return paginaProyectos(c, deps, mensajeDeRegla(error));
		}
	});

	// El selector de la barra lateral, sin JavaScript: manda aquí el destino que
	// lleva puesto cada opción. Solo se admite una ruta de este mismo servidor.
	// Un destino sin prefijo es la vista cruzada, que es una elección: se
	// recuerda como tal, porque ninguna ruta la va a escribir después.
	app.get("/ir", (c) => {
		const destino = destinoSeguro(c.req.query("destino"));
		if (!destino.startsWith("/p/")) {
			recordarProyecto(c, deps.config, TODOS_LOS_PROYECTOS);
		}
		return c.redirect(destino, 302);
	});
}
