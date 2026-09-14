import type { Context, Hono } from "hono";
import { html } from "hono/html";
import { altaPor } from "../../db/actividad.ts";
import { altaUsuario, borrarUsuario, cambiarColor, cambiarPassword, listarUsuarios } from "../../db/admin.ts";
import type { Usuario } from "../../db/consultas.ts";
import { buscadorDeColor, type Color, chipDeAlta, chipUsuario, type Miga, selectorDeColor } from "../componentes.ts";
import { fechaLegible } from "../formatos.ts";
import { campo, ESTADO_AVISO, leerFormulario, mensajeDeRegla } from "../formulario.ts";
import { type Html, pagina, type RespuestaHtml } from "../plantilla.ts";
import { type DependenciasWeb, usuarioActual } from "../sesion.ts";
import { navProyectos } from "./proyectos.ts";

/** Cómo se busca el color de cada usuario que aparece en la página. */
type ColorDe = (nombre: string) => Color | null;

/** El color de cada uno se cambia desde su propia fila, sin salir de la lista. */
function formularioColor(usuario: Usuario): Html {
	return html`<form class="cambio-color" method="post" action="/usuarios/${usuario.id}/color">
			${selectorDeColor(`Color de ${usuario.nombre}`, usuario.color)}
			<button type="submit" class="pequeno">Cambiar</button>
		</form>`;
}

function filaUsuario(usuario: Usuario, altaDe: string | null, colorDe: ColorDe, esElUltimo: boolean): Html {
	return html`<tr>
			<td>${chipUsuario(usuario.nombre, usuario.color)}</td>
			<td>${formularioColor(usuario)}</td>
			<td class="pequeno">${fechaLegible(usuario.creado)}</td>
			<td>${chipDeAlta(altaDe, colorDe)}</td>
			<td>
				${
					esElUltimo
						? html`<span class="silencio pequeno">el último usuario no se borra</span>`
						: html`<a class="boton peligro" href="/usuarios/${usuario.id}/borrar">Borrar</a>`
				}
			</td>
		</tr>`;
}

/** El alta, en su tarjeta, a la que apunta la acción de la cabecera. */
function tarjetaNuevoUsuario(): Html {
	return html`<section class="caja" id="nuevo-usuario">
			<h2>Nuevo usuario</h2>
			<form method="post" action="/usuarios">
				<label>
					<span>Nombre</span>
					<input type="text" name="nombre" autocomplete="off" required>
				</label>
				<label>
					<span>Contraseña</span>
					<input type="password" name="password" autocomplete="new-password" required>
				</label>
				<p class="nombre-campo">Color</p>
				${selectorDeColor("Color del usuario nuevo", null)}
				<button type="submit" class="principal">Crear usuario</button>
			</form>
		</section>`;
}

/** Cambiar la propia contraseña. Exige la actual: la cookie sola no basta. */
function tarjetaContrasena(): Html {
	return html`<section class="caja">
			<h2>Cambiar mi contraseña</h2>
			<form method="post" action="/usuarios/contrasena">
				<label>
					<span>Contraseña actual</span>
					<input type="password" name="actual" autocomplete="current-password" required>
				</label>
				<label>
					<span>Contraseña nueva</span>
					<input type="password" name="nueva" autocomplete="new-password" required>
				</label>
				<label>
					<span>Repetir la nueva</span>
					<input type="password" name="repetida" autocomplete="new-password" required>
				</label>
				<button type="submit">Cambiar contraseña</button>
			</form>
		</section>`;
}

function paginaUsuarios(c: Context, deps: DependenciasWeb, aviso: string | null): RespuestaHtml {
	const usuarios = listarUsuarios(deps.db);
	const colorDe = buscadorDeColor(deps.db);
	const esElUltimo = usuarios.length <= 1;

	const cuerpo = html`<div class="tabla-envuelta">
			<table class="tabla-usuarios">
				<thead><tr><th>Usuario</th><th>Color</th><th>Alta</th><th>Alta por</th><th></th></tr></thead>
				<tbody>
					${usuarios.map((usuario) => filaUsuario(usuario, altaPor(deps.db, "usuario", usuario.id), colorDe, esElUltimo))}
				</tbody>
			</table>
		</div>
		${tarjetaNuevoUsuario()}
		${tarjetaContrasena()}`;

	return c.html(
		pagina({
			...navProyectos(c, deps.db),
			titulo: "Usuarios",
			usuario: usuarioActual(c),
			vista: "usuarios",
			aviso,
			acciones: html`<a class="boton principal" href="#nuevo-usuario">Nuevo usuario</a>`,
			cuerpo,
		}),
		aviso === null ? 200 : ESTADO_AVISO,
	);
}

/** Las migas de todo lo que cuelga de la lista de usuarios. */
function migasDe(donde: string): Miga[] {
	return [{ texto: "Usuarios", href: "/usuarios" }, { texto: donde }];
}

/** Rutas de usuarios: alta, baja (nunca el último) y cambio de la propia contraseña. */
export function registrarRutasUsuarios(app: Hono, deps: DependenciasWeb): void {
	app.get("/usuarios", (c) => paginaUsuarios(c, deps, null));

	app.post("/usuarios", async (c) => {
		const formulario = await leerFormulario(c);
		try {
			altaUsuario(deps.db, {
				nombre: campo(formulario, "nombre"),
				password: campo(formulario, "password"),
				// El radio «automático» manda cadena vacía: se reparte el menos usado.
				color: campo(formulario, "color"),
				actorId: usuarioActual(c).id,
			});
			return c.redirect("/usuarios", 302);
		} catch (error) {
			return paginaUsuarios(c, deps, mensajeDeRegla(error));
		}
	});

	app.post("/usuarios/:id/color", async (c) => {
		const formulario = await leerFormulario(c);
		const id = Number.parseInt(c.req.param("id") ?? "", 10);
		try {
			cambiarColor(deps.db, { usuarioId: id, color: campo(formulario, "color"), actorId: usuarioActual(c).id });
			return c.redirect("/usuarios", 302);
		} catch (error) {
			return paginaUsuarios(c, deps, mensajeDeRegla(error));
		}
	});

	app.post("/usuarios/contrasena", async (c) => {
		const formulario = await leerFormulario(c);
		try {
			cambiarPassword(deps.db, {
				usuarioId: usuarioActual(c).id,
				actual: campo(formulario, "actual"),
				nueva: campo(formulario, "nueva"),
				repetida: campo(formulario, "repetida"),
			});
			return c.redirect("/usuarios", 302);
		} catch (error) {
			return paginaUsuarios(c, deps, mensajeDeRegla(error));
		}
	});

	// Sin JavaScript: el botón de la tabla lleva aquí y el POST está en esta página.
	app.get("/usuarios/:id/borrar", (c) => {
		const id = Number.parseInt(c.req.param("id") ?? "", 10);
		const usuario = listarUsuarios(deps.db).find((candidato) => candidato.id === id);
		if (usuario === undefined) {
			return c.html(
				pagina({
					...navProyectos(c, deps.db),
					titulo: "Usuario no encontrado",
					usuario: usuarioActual(c),
					vista: "usuarios",
					migas: migasDe("No encontrado"),
					cuerpo: html`<section class="caja caja-estrecha">
						<p>No existe ese usuario.</p>
						<p><a class="boton" href="/usuarios">Volver a usuarios</a></p>
					</section>`,
				}),
				404,
			);
		}
		const propio = usuario.id === usuarioActual(c).id;
		const cuerpo = html`<section class="caja caja-estrecha">
			<p>
				Se borra el usuario ${chipUsuario(usuario.nombre, usuario.color)}. No se puede deshacer.
			</p>
			${propio ? html`<p class="silencio">Es tu propio usuario: al borrarlo se te cierra la sesión.</p>` : html``}
			<div class="acciones">
				<form method="post" action="/usuarios/${usuario.id}/borrar">
					<button type="submit" class="peligro">Sí, borrar</button>
				</form>
				<a class="boton" href="/usuarios">Cancelar</a>
			</div>
		</section>`;
		return c.html(
			pagina({
				...navProyectos(c, deps.db),
				titulo: "Borrar usuario",
				usuario: usuarioActual(c),
				vista: "usuarios",
				migas: migasDe("Borrar usuario"),
				cuerpo,
			}),
		);
	});

	app.post("/usuarios/:id/borrar", (c) => {
		const id = Number.parseInt(c.req.param("id") ?? "", 10);
		try {
			borrarUsuario(deps.db, id, usuarioActual(c).id);
			return c.redirect("/usuarios", 302);
		} catch (error) {
			return paginaUsuarios(c, deps, mensajeDeRegla(error));
		}
	});
}
