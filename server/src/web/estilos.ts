/**
 * La hoja de estilos entera, como constante. No hay archivos estáticos en
 * disco: así el Dockerfile no tiene que copiar nada más que `src/`. La sirve
 * `GET /static/app.css`.
 *
 * Escrita a mano, sin frameworks, y legible en claro y en oscuro: los colores
 * son variables y `prefers-color-scheme` cambia solo las variables.
 */
export const CSS = `:root {
	color-scheme: light dark;
	--fondo: #f7f7f5;
	--fondo-caja: #ffffff;
	--fondo-suave: #efeee9;
	--texto: #1d1d1b;
	--texto-suave: #5f5f58;
	--borde: #d9d8d0;
	--acento: #2f5d8a;
	--acento-texto: #ffffff;
	--aviso-fondo: #fdeceb;
	--aviso-borde: #d4756c;
	--aviso-texto: #7d251c;
	--peligro: #a5342a;
	--radio: 6px;
}

@media (prefers-color-scheme: dark) {
	:root {
		--fondo: #16171a;
		--fondo-caja: #1f2126;
		--fondo-suave: #272a30;
		--texto: #e8e8e4;
		--texto-suave: #a3a49f;
		--borde: #383b42;
		--acento: #7fb0e0;
		--acento-texto: #10131a;
		--aviso-fondo: #3a1f1c;
		--aviso-borde: #a5564c;
		--aviso-texto: #f3c3bd;
		--peligro: #e08379;
	}
}

* {
	box-sizing: border-box;
}

body {
	margin: 0;
	background: var(--fondo);
	color: var(--texto);
	font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
	font-size: 16px;
	line-height: 1.5;
}

a {
	color: var(--acento);
}

h1, h2, h3 {
	line-height: 1.25;
	margin: 0 0 0.6rem;
}

h1 {
	font-size: 1.5rem;
}

h2 {
	font-size: 1.2rem;
}

h3 {
	font-size: 1rem;
}

code, pre {
	font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	font-size: 0.9em;
}

pre {
	background: var(--fondo-suave);
	border-radius: var(--radio);
	padding: 0.7rem 0.9rem;
	overflow-x: auto;
}

/* --- cabecera y pie ----------------------------------------------------- */

.cabecera {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.6rem 1.2rem;
	padding: 0.8rem 1.2rem;
	background: var(--fondo-caja);
	border-bottom: 1px solid var(--borde);
}

.marca {
	font-weight: 700;
	text-decoration: none;
	color: var(--texto);
	letter-spacing: 0.01em;
}

.navegacion {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.2rem 1rem;
	margin-left: auto;
}

.navegacion a, .navegacion .enlace {
	color: var(--acento);
	text-decoration: none;
}

.navegacion a:hover, .navegacion .enlace:hover {
	text-decoration: underline;
}

.navegacion .quien {
	color: var(--texto-suave);
	font-size: 0.85rem;
}

.en-linea {
	display: inline;
	margin: 0;
}

.contenido {
	max-width: 68rem;
	margin: 0 auto;
	padding: 1.4rem 1.2rem 3rem;
}

.pie {
	max-width: 68rem;
	margin: 0 auto;
	padding: 0 1.2rem 2rem;
	color: var(--texto-suave);
	font-size: 0.8rem;
}

/* --- avisos y cajas ----------------------------------------------------- */

.aviso {
	background: var(--aviso-fondo);
	border: 1px solid var(--aviso-borde);
	border-left-width: 4px;
	border-radius: var(--radio);
	color: var(--aviso-texto);
	margin: 0 0 1.2rem;
	padding: 0.7rem 0.9rem;
}

.caja {
	background: var(--fondo-caja);
	border: 1px solid var(--borde);
	border-radius: var(--radio);
	padding: 1rem 1.1rem;
	margin: 0 0 1.2rem;
}

.silencio {
	color: var(--texto-suave);
}

.pequeno {
	font-size: 0.85rem;
}

/* --- tablas ------------------------------------------------------------- */

.tabla-envuelta {
	overflow-x: auto;
	margin: 0 0 1.2rem;
}

table {
	width: 100%;
	border-collapse: collapse;
	background: var(--fondo-caja);
	border: 1px solid var(--borde);
	border-radius: var(--radio);
}

th, td {
	text-align: left;
	padding: 0.5rem 0.7rem;
	border-bottom: 1px solid var(--borde);
	vertical-align: top;
}

thead th {
	background: var(--fondo-suave);
	font-size: 0.8rem;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--texto-suave);
}

tbody tr:last-child td {
	border-bottom: none;
}

td.numero, th.numero {
	text-align: right;
	font-variant-numeric: tabular-nums;
}

/* --- formularios -------------------------------------------------------- */

form {
	margin: 0 0 1rem;
}

fieldset {
	border: 1px solid var(--borde);
	border-radius: var(--radio);
	margin: 0 0 1rem;
	padding: 0.8rem 1rem 1rem;
}

legend {
	color: var(--texto-suave);
	font-size: 0.85rem;
	padding: 0 0.3rem;
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

label {
	display: block;
	font-size: 0.9rem;
	margin: 0 0 0.8rem;
}

label > span {
	display: block;
	color: var(--texto-suave);
	margin-bottom: 0.2rem;
}

input[type="text"], input[type="password"], textarea, select {
	width: 100%;
	max-width: 40rem;
	padding: 0.45rem 0.6rem;
	font: inherit;
	color: var(--texto);
	background: var(--fondo);
	border: 1px solid var(--borde);
	border-radius: var(--radio);
}

textarea {
	min-height: 6rem;
	resize: vertical;
}

input[type="checkbox"], input[type="radio"] {
	margin-right: 0.4rem;
}

label.opcion {
	background: var(--fondo-suave);
	border: 1px solid var(--borde);
	border-radius: var(--radio);
	padding: 0.5rem 0.7rem;
	margin-bottom: 0.5rem;
}

label.opcion .consecuencia {
	display: block;
	color: var(--texto-suave);
	font-size: 0.85rem;
	margin: 0.2rem 0 0 1.4rem;
}

.recomendada {
	color: var(--acento);
	font-size: 0.8rem;
	margin-left: 0.4rem;
	white-space: nowrap;
}

button, .boton {
	font: inherit;
	padding: 0.4rem 0.9rem;
	border-radius: var(--radio);
	border: 1px solid var(--borde);
	background: var(--fondo-suave);
	color: var(--texto);
	cursor: pointer;
	text-decoration: none;
	display: inline-block;
}

button:hover, .boton:hover {
	border-color: var(--acento);
}

button.principal {
	background: var(--acento);
	border-color: var(--acento);
	color: var(--acento-texto);
}

button.peligro, .boton.peligro {
	color: var(--peligro);
	border-color: var(--peligro);
	background: transparent;
}

button.enlace {
	background: none;
	border: none;
	padding: 0;
	cursor: pointer;
}

.acciones {
	display: flex;
	flex-wrap: wrap;
	gap: 0.6rem 1rem;
	align-items: flex-start;
}

.acciones form {
	margin: 0;
}

.filtros {
	display: flex;
	flex-wrap: wrap;
	gap: 0.6rem 1rem;
	align-items: flex-end;
}

.filtros label {
	margin: 0;
}

.filtros input, .filtros select {
	max-width: 14rem;
}

/* --- insignias ---------------------------------------------------------- */

.insignia {
	display: inline-block;
	font-size: 0.75rem;
	font-weight: 600;
	letter-spacing: 0.02em;
	padding: 0.1rem 0.5rem;
	margin-right: 0.3rem;
	border-radius: 999px;
	border: 1px solid var(--borde);
	background: var(--fondo-suave);
	color: var(--texto-suave);
	white-space: nowrap;
}

.estado-backlog { border-color: #9a9a92; color: #6c6c64; }
.estado-prepared { border-color: #6d8fbc; color: #37608f; }
.estado-doing { border-color: #c9963f; color: #8a6413; }
.estado-done { border-color: #5f9a68; color: #2f6b39; }
.estado-finished { border-color: #8d8d86; color: #6c6c64; }

.marca-bloqueada { border-color: #c0574c; color: #9c3125; }
.marca-sin-terminal { border-color: #b08a3a; color: #7f6011; }
.marca-en-marcha { border-color: #4d8fa8; color: #2b6579; }
.marca-analisis-listo { border-color: #6b8f4f; color: #47632f; }

.tipo-analisis { border-color: #6d8fbc; color: #37608f; }
.tipo-pregunta { border-color: #c0574c; color: #9c3125; }
.tipo-respuesta { border-color: #5f9a68; color: #2f6b39; }
.tipo-avance { border-color: #4d8fa8; color: #2b6579; }
.tipo-resultado { border-color: #6b8f4f; color: #47632f; }
.tipo-nota { border-color: #9a9a92; color: #6c6c64; }

@media (prefers-color-scheme: dark) {
	.estado-backlog { border-color: #7c7c74; color: #b6b6ae; }
	.estado-prepared { border-color: #6d8fbc; color: #9dc0e6; }
	.estado-doing { border-color: #c9963f; color: #e3bb74; }
	.estado-done { border-color: #5f9a68; color: #93c79b; }
	.estado-finished { border-color: #7c7c74; color: #b6b6ae; }

	.marca-bloqueada { border-color: #c0574c; color: #eda79e; }
	.marca-sin-terminal { border-color: #b08a3a; color: #dfbd74; }
	.marca-en-marcha { border-color: #4d8fa8; color: #93c6da; }
	.marca-analisis-listo { border-color: #6b8f4f; color: #adc98f; }

	.tipo-analisis { border-color: #6d8fbc; color: #9dc0e6; }
	.tipo-pregunta { border-color: #c0574c; color: #eda79e; }
	.tipo-respuesta { border-color: #5f9a68; color: #93c79b; }
	.tipo-avance { border-color: #4d8fa8; color: #93c6da; }
	.tipo-resultado { border-color: #6b8f4f; color: #adc98f; }
	.tipo-nota { border-color: #7c7c74; color: #b6b6ae; }
}

/* --- lista de tareas ---------------------------------------------------- */

.grupo {
	margin: 0 0 1.6rem;
}

.grupo h2 {
	display: flex;
	align-items: baseline;
	gap: 0.5rem;
}

.contador {
	color: var(--texto-suave);
	font-size: 0.85rem;
	font-weight: 400;
}

.id-tarea {
	font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	white-space: nowrap;
}

.cabecera-tarea {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.5rem;
	margin-bottom: 1rem;
}

/* --- hilo --------------------------------------------------------------- */

.hilo {
	display: flex;
	flex-direction: column;
	gap: 0.9rem;
	margin-bottom: 1.4rem;
}

.comentario {
	background: var(--fondo-caja);
	border: 1px solid var(--borde);
	border-left: 4px solid var(--borde);
	border-radius: var(--radio);
	padding: 0.7rem 0.9rem;
}

.comentario > header {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.4rem 0.7rem;
	margin-bottom: 0.4rem;
	color: var(--texto-suave);
	font-size: 0.85rem;
}

.comentario .autor {
	font-weight: 600;
	color: var(--texto);
}

.cuerpo > :first-child {
	margin-top: 0;
}

.cuerpo > :last-child {
	margin-bottom: 0;
}

.cuerpo img {
	max-width: 100%;
}

.responder {
	border-top: 1px dashed var(--borde);
	margin-top: 0.8rem;
	padding-top: 0.8rem;
}

/* --- terminales --------------------------------------------------------- */

.token {
	display: block;
	background: var(--fondo-suave);
	border: 1px solid var(--borde);
	border-radius: var(--radio);
	padding: 0.9rem 1rem;
	margin: 0.8rem 0;
	font-size: 1.1rem;
	word-break: break-all;
	user-select: all;
}

.uso {
	margin: 0;
	padding: 0;
	list-style: none;
	font-size: 0.85rem;
}

/* --- kanban ------------------------------------------------------------- */

/* Cinco columnas fijas: si no caben, el tablero se desplaza en horizontal. */
.columnas {
	display: grid;
	grid-template-columns: repeat(5, minmax(12rem, 1fr));
	gap: 0.7rem;
	align-items: start;
	overflow-x: auto;
	padding-bottom: 0.6rem;
}

.columna {
	background: var(--fondo-suave);
	border: 1px solid var(--borde);
	border-radius: var(--radio);
	min-width: 0;
	padding: 0.6rem 0.6rem 0.7rem;
}

.columna h2 {
	align-items: baseline;
	display: flex;
	font-size: 0.95rem;
	gap: 0.4rem;
	margin-bottom: 0.5rem;
}

.columna > p {
	margin: 0.5rem 0 0;
}

/* La zona donde se sueltan las tarjetas. Con la columna vacía sigue habiendo
   sitio para soltar. */
.tarjetas {
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
	min-height: 3rem;
}

.tarjeta {
	background: var(--fondo-caja);
	border: 1px solid var(--borde);
	border-radius: var(--radio);
	cursor: grab;
	padding: 0.5rem 0.6rem;
}

.tarjeta:active {
	cursor: grabbing;
}

.tarjeta p {
	margin: 0 0 0.2rem;
}

.tarjeta p:last-child {
	margin-bottom: 0;
}

.tarjeta .linea {
	align-items: baseline;
	display: flex;
	flex-wrap: wrap;
	gap: 0.3rem;
	margin-bottom: 0.25rem;
}

.tarjeta .titulo {
	font-size: 0.92rem;
	line-height: 1.35;
}

/* La marca de SortableJS mientras se arrastra. */
.tarjeta.arrastrando {
	border-style: dashed;
	opacity: 0.45;
}

.aviso-tablero {
	margin-bottom: 0.9rem;
}

/* Aviso de la ficha: no se recarga sola, así que el humano decide cuándo. */
.aviso-recarga {
	background: var(--fondo-caja);
	border: 1px solid var(--acento);
	border-radius: 0 0 var(--radio) var(--radio);
	border-top: none;
	box-shadow: 0 2px 8px rgb(0 0 0 / 18%);
	left: 50%;
	padding: 0.5rem 0.9rem;
	position: fixed;
	top: 0;
	transform: translateX(-50%);
	z-index: 10;
}

.navegacion .par {
	align-items: baseline;
	color: var(--texto-suave);
	display: flex;
	gap: 0.4rem;
}

@media (max-width: 40rem) {
	.contenido {
		padding: 1rem 0.8rem 2.5rem;
	}

	th, td {
		padding: 0.45rem 0.5rem;
	}
}
`;
