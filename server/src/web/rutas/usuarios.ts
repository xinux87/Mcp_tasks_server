import type { Context, Hono } from "hono";
import { html } from "hono/html";
import { altaUsuario, borrarUsuario, cambiarPassword, listarUsuarios } from "../../db/admin.ts";
import type { Usuario } from "../../db/consultas.ts";
import { fechaLegible } from "../formatos.ts";
import { campo, ESTADO_AVISO, leerFormulario, mensajeDeRegla } from "../formulario.ts";
import { type Html, pagina, type RespuestaHtml } from "../plantilla.ts";
import { type DependenciasWeb, usuarioActual } from "../sesion.ts";

function filaUsuario(usuario: Usuario, esElUltimo: boolean): Html {
	return html`<tr>
			<td>${usuario.nombre}</td>
			<td class="pequeno">${fechaLegible(usuario.creado)}</td>
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
				<thead><tr><th>Nombre</th><th>Creado</th><th></th></tr></thead>
				<tbody>${usuarios.map((usuario) => filaUsuario(usuario, esElUltimo))}</tbody>
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
			altaUsuario(deps.db, { nombre: campo(formulario, "nombre"), password: campo(formulario, "password") });
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
			borrarUsuario(deps.db, id);
			return c.redirect("/usuarios", 302);
		} catch (error) {
			return paginaUsuarios(c, deps, mensajeDeRegla(error));
		}
	});
}
