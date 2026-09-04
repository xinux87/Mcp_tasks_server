import type { Hono } from "hono";
import { html } from "hono/html";
import { verificarPassword } from "../../auth/passwords.ts";
import { buscarUsuarioPorNombre } from "../../db/consultas.ts";
import { campo, leerFormulario } from "../formulario.ts";
import { type Html, pagina } from "../plantilla.ts";
import { cerrarSesion, type DependenciasWeb, destinoSeguro, iniciarSesion, leerSesion } from "../sesion.ts";

/** El formulario de entrada. Es la única página de la web que no exige sesión. */
function paginaLogin(volver: string, aviso: string | null): Html {
	const cuerpo = html`<section class="caja">
		<h1>Entrar</h1>
		<form method="post" action="/login">
			<input type="hidden" name="volver" value="${volver}">
			<label>
				<span>Usuario</span>
				<input type="text" name="usuario" autocomplete="username" autofocus required>
			</label>
			<label>
				<span>Contraseña</span>
				<input type="password" name="password" autocomplete="current-password" required>
			</label>
			<button type="submit" class="principal">Entrar</button>
		</form>
	</section>`;
	return pagina({ titulo: "Entrar", usuario: null, aviso, cuerpo });
}

/** `GET /login`, `POST /login` y `POST /logout`. */
export function registrarRutasSesion(app: Hono, deps: DependenciasWeb): void {
	app.get("/login", async (c) => {
		if ((await leerSesion(c, deps)) !== undefined) {
			return c.redirect("/tareas", 302);
		}
		return c.html(paginaLogin(destinoSeguro(c.req.query("volver")), null));
	});

	app.post("/login", async (c) => {
		const formulario = await leerFormulario(c);
		const nombre = campo(formulario, "usuario").trim();
		const password = campo(formulario, "password");
		const volver = destinoSeguro(campo(formulario, "volver"));

		const usuario = buscarUsuarioPorNombre(deps.db, nombre);
		if (usuario === undefined || !verificarPassword(password, usuario.hashPassword)) {
			// El mismo aviso para los dos casos: decir cuál falló regala si el
			// usuario existe.
			return c.html(paginaLogin(volver, "Usuario o contraseña incorrectos."), 401);
		}
		await iniciarSesion(c, deps.config, usuario.id);
		return c.redirect(volver, 302);
	});

	app.post("/logout", (c) => {
		cerrarSesion(c, deps.config);
		return c.redirect("/login", 302);
	});
}
