import type { Context, Hono } from "hono";
import { html } from "hono/html";
import { altaPor } from "../../db/actividad.ts";
import { altaUsuario, borrarUsuario, cambiarColor, cambiarPassword, listarUsuarios } from "../../db/admin.ts";
import { COLORES_USUARIO } from "../../db/colores.ts";
import type { Usuario } from "../../db/consultas.ts";
import { fechaLegible, SIN_DATO } from "../formatos.ts";
import { campo, ESTADO_AVISO, leerFormulario, mensajeDeRegla } from "../formulario.ts";
import { type Html, pagina, type RespuestaHtml } from "../plantilla.ts";
import { type DependenciasWeb, usuarioActual } from "../sesion.ts";

/** El color de cada uno se cambia desde su propia fila, sin salir de la lista. */
function formularioColor(usuario: Usuario): Html {
	return html`<form class="en-linea" method="post" action="/usuarios/${usuario.id}/color">
			<select name="color" aria-label="Color de ${usuario.nombre}">
				${COLORES_USUARIO.map(
					(color) => html`<option value="${color}" ${color === usuario.color ? "selected" : ""}>${color}</option>`,
				)}
			</select>
			<button type="submit">Cambiar</button>
		</form>`;
}

function filaUsuario(usuario: Usuario, altaDe: string | null, esElUltimo: boolean): Html {
	return html`<tr>
			<td>${usuario.nombre}</td>
			<td><span class="insignia color-${usuario.color}">${usuario.color}</span> ${formularioColor(usuario)}</td>
			<td class="pequeno">${fechaLegible(usuario.creado)}</td>
			<td class="pequeno">${altaDe ?? SIN_DATO}</td>
			<td>
				${
					esElUltimo
						? html`<span class="silencio pequeno">el último usuario no se borra</span>`
						: html`<a class="boton peligro" href="/usuarios/${usuario.id}/borrar">Borrar</a>`
				}
			</td>
		</tr>`;
}

function paginaUsuarios(c: Context, deps: DependenciasWeb, aviso: string | null): RespuestaHtml {
	const usuarios = listarUsuarios(deps.db);
	const esElUltimo = usuarios.length <= 1;

	const cuerpo = html`<h1>Usuarios</h1>
		<div class="tabla-envuelta">
			<table>
				<thead><tr><th>Nombre</th><th>Color</th><th>Creado</th><th>Alta por</th><th></th></tr></thead>
				<tbody>
					${usuarios.map((usuario) => filaUsuario(usuario, altaPor(deps.db, "usuario", usuario.id), esElUltimo))}
				</tbody>
			</table>
		</div>

		<form class="caja" method="post" action="/usuarios">
			<h2>Nuevo usuario</h2>
			<label>
				<span>Nombre</span>
				<input type="text" name="nombre" autocomplete="off" required>
			</label>
			<label>
				<span>Contraseña</span>
				<input type="password" name="password" autocomplete="new-password" required>
			</label>
			<fieldset>
				<legend>Color</legend>
				<label class="en-linea">
					<input type="radio" name="color" value="" checked> automático
				</label>
				${COLORES_USUARIO.map(
					(color) => html`<label class="en-linea">
						<input type="radio" name="color" value="${color}"> ${color}
					</label>`,
				)}
			</fieldset>
			<button type="submit" class="principal">Crear usuario</button>
		</form>

		<form class="caja" method="post" action="/usuarios/contrasena">
			<h2>Cambiar mi contraseña</h2>
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
		</form>`;

	return c.html(
		pagina({ titulo: "Usuarios", usuario: usuarioActual(c), aviso, cuerpo }),
		aviso === null ? 200 : ESTADO_AVISO,
	);
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
					titulo: "Usuario no encontrado",
					usuario: usuarioActual(c),
					aviso: "No existe ese usuario.",
					cuerpo: html`<p><a href="/usuarios">Volver a usuarios</a></p>`,
				}),
				404,
			);
		}
		const propio = usuario.id === usuarioActual(c).id;
		const cuerpo = html`<h1>Borrar usuario</h1>
			<p>Se borra el usuario <strong>${usuario.nombre}</strong>. No se puede deshacer.</p>
			${propio ? html`<p class="silencio">Es tu propio usuario: al borrarlo se te cierra la sesión.</p>` : html``}
			<div class="acciones">
				<form method="post" action="/usuarios/${usuario.id}/borrar">
					<button type="submit" class="peligro">Sí, borrar</button>
				</form>
				<a class="boton" href="/usuarios">Cancelar</a>
			</div>`;
		return c.html(pagina({ titulo: "Borrar usuario", usuario: usuarioActual(c), cuerpo }));
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
