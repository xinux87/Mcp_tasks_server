/**
 * La hoja de estilos entera, como constante. No hay archivos estáticos en
 * disco: así el Dockerfile no tiene que copiar nada más que `src/`. La sirve
 * `GET /static/app.css`.
 *
 * El diseño es el de «Diseño visual» en CLAUDE.md: página limpia tipo Notion,
 * tipografía del sistema, colores neutros, etiquetas de color suave y una
 * barra lateral fija con la navegación. Todo el color sale de variables, y
 * `prefers-color-scheme` solo cambia las variables: no hay una segunda hoja
 * para el modo oscuro.
 */
export const CSS = `:root {
	color-scheme: light dark;

	/* Los ocho tokens de la tabla de CLAUDE.md. Nada más define color. */
	--fondo: #ffffff;
	--fondo-lateral: #f7f7f5;
	--fondo-hover: rgba(55, 53, 47, 0.08);
	--texto: #37352f;
	--texto-suave: rgba(55, 53, 47, 0.65);
	--borde: rgba(55, 53, 47, 0.16);
	--acento: #2383e2;
	--peligro: #eb5757;

	/* Medidas: 4 px en controles, 6 px en tarjetas, 15 rem de barra lateral. */
	--radio: 4px;
	--radio-tarjeta: 6px;
	--lateral: 15rem;
	--ancho-contenido: 60rem;
}

@media (prefers-color-scheme: dark) {
	:root {
		--fondo: #191919;
		--fondo-lateral: #202020;
		--fondo-hover: rgba(255, 255, 255, 0.055);
		--texto: rgba(255, 255, 255, 0.81);
		--texto-suave: rgba(255, 255, 255, 0.44);
		--borde: rgba(255, 255, 255, 0.13);
		--acento: #529cca;
		--peligro: #ff7369;
	}
}

/* --- base ---------------------------------------------------------------- */

* {
	box-sizing: border-box;
}

body {
	margin: 0;
	background: var(--fondo);
	color: var(--texto);
	font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
	font-size: 15px;
	line-height: 1.5;
	-webkit-font-smoothing: antialiased;
}

a {
	color: var(--acento);
}

h1, h2, h3 {
	line-height: 1.25;
	margin: 0 0 0.6rem;
}

/* El título de página, suelto o dentro de «cabeceraPagina», es el mismo. */
h1 {
	font-size: 2rem;
	font-weight: 700;
	letter-spacing: -0.01em;
}

h2 {
	font-size: 1.15rem;
	font-weight: 600;
	margin-top: 1.8rem;
}

h3 {
	font-size: 1rem;
	font-weight: 600;
}

code, pre {
	font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	font-size: 0.88em;
}

pre {
	background: var(--fondo-hover);
	border-radius: var(--radio-tarjeta);
	padding: 0.7rem 0.9rem;
	overflow-x: auto;
}

/* El foco se ve siempre, y siempre igual: un anillo de 2 px en el acento. */
:focus-visible {
	outline: 2px solid var(--acento);
	outline-offset: 1px;
}

/* --- esqueleto: barra lateral y contenido -------------------------------- */

.lateral {
	position: fixed;
	top: 0;
	bottom: 0;
	left: 0;
	width: var(--lateral);
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
	padding: 0.9rem 0.6rem 0.8rem;
	background: var(--fondo-lateral);
	border-right: 1px solid var(--borde);
	overflow-y: auto;
	z-index: 20;
}

.lateral .marca {
	display: block;
	padding: 0.25rem 0.5rem 1rem;
	color: var(--texto);
	font-weight: 700;
	text-decoration: none;
}

.bloque {
	margin-bottom: 1.1rem;
}

.bloque h2 {
	margin: 0 0 0.2rem;
	padding: 0 0.5rem;
	color: var(--texto-suave);
	font-size: 0.72rem;
	font-weight: 600;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}

.enlace-nav {
	display: block;
	padding: 0.25rem 0.5rem;
	border-radius: var(--radio);
	color: var(--texto);
	text-decoration: none;
}

.enlace-nav:hover {
	background: var(--fondo-hover);
}

/* La entrada activa: mismo fondo que al pasar por encima, y en negrita. */
.enlace-nav[aria-current="page"] {
	background: var(--fondo-hover);
	font-weight: 600;
}

.pie-lateral {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
	margin-top: auto;
	padding-top: 0.8rem;
	border-top: 1px solid var(--borde);
}

.pie-lateral form {
	margin: 0;
}

/* La cabecera con el botón «☰» solo existe cuando la barra se esconde. */
.cabecera-movil {
	display: none;
}

.alternar-lateral {
	padding: 0.15rem 0.5rem;
	border: none;
	background: none;
	color: var(--texto);
	font-size: 1.1rem;
	line-height: 1;
}

.contenido {
	margin-left: var(--lateral);
	padding: 3rem 2.5rem 5rem;
}

.dentro {
	max-width: var(--ancho-contenido);
	margin: 0 auto;
}

/* El kanban ocupa todo el ancho: cinco columnas no caben en 60 rem. */
.dentro-completo {
	max-width: none;
}

/* Sin sesión no hay barra lateral: una tarjeta centrada y nada más. */
.contenido-entrada {
	display: flex;
	align-items: center;
	justify-content: center;
	min-height: 100dvh;
	margin-left: 0;
	padding: 2rem 1rem;
}

.contenido-entrada .dentro {
	width: 22rem;
	max-width: 100%;
}

.marca-entrada {
	margin: 0 0 1.2rem;
	color: var(--texto-suave);
	font-weight: 600;
	letter-spacing: 0.02em;
}

/* --- cabecera de página -------------------------------------------------- */

.cabecera-pagina {
	margin: 0 0 1.8rem;
}

.migas {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.35rem;
	margin-bottom: 0.5rem;
	color: var(--texto-suave);
	font-size: 0.82rem;
}

.migas a {
	color: var(--texto-suave);
	text-decoration: none;
}

.migas a:hover {
	color: var(--texto);
	text-decoration: underline;
}

.migas .separador {
	opacity: 0.6;
}

.titular {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-start;
	justify-content: space-between;
	gap: 0.6rem 1rem;
}

.titular h1 {
	margin: 0;
}

/* Solo hueco entre filas: entre etiquetas ya separa el margen de «.insignia». */
.etiquetas {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.3rem 0;
	margin-top: 0.6rem;
}

/* --- etiquetas y chips --------------------------------------------------- */

/* Sin clase de color, la etiqueta es gris: es el color de lo que no tiene. El
   margen separa dos etiquetas seguidas donde no hay un contenedor con hueco. */
.insignia {
	display: inline-block;
	margin-right: 0.25rem;
	padding: 0.05rem 0.45rem;
	border-radius: var(--radio);
	background: var(--fondo-hover);
	color: var(--texto-suave);
	font-size: 0.78rem;
	font-weight: 500;
	line-height: 1.55;
	white-space: nowrap;
}

.chip {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	padding: 0.05rem 0.5rem 0.05rem 0.15rem;
	border-radius: 999px;
	background: var(--fondo-hover);
	color: var(--texto-suave);
	font-size: 0.82rem;
	line-height: 1.6;
	white-space: nowrap;
}

/* El círculo de la inicial se tiñe del propio texto del chip: así funciona
   con los nueve colores y en los dos modos sin repetir ninguna paleta. */
.chip .inicial {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.2rem;
	height: 1.2rem;
	border-radius: 50%;
	background: color-mix(in srgb, currentColor 22%, transparent);
	font-size: 0.66rem;
	font-weight: 700;
	line-height: 1;
}

.chip .terminal {
	color: var(--texto-suave);
}

/* Los nueve colores, los de Notion. Van después de «.insignia» y «.chip»
   porque tienen la misma especificidad y aquí manda el último que gana. */

.color-gris { background: #e3e2e0; color: #32302c; }
.color-marron { background: #eee0da; color: #442a1e; }
.color-naranja { background: #fadec9; color: #49290e; }
.color-amarillo { background: #fdecc8; color: #402c1b; }
.color-verde { background: #dbeddb; color: #1c3829; }
.color-azul { background: #d3e5ef; color: #183347; }
.color-morado { background: #e8deee; color: #412454; }
.color-rosa { background: #f5e0e9; color: #4c2337; }
.color-rojo { background: #ffe2dd; color: #5d1715; }

@media (prefers-color-scheme: dark) {
	.color-gris { background: #373737; color: rgba(255, 255, 255, 0.81); }
	.color-marron { background: #603b2c; color: rgba(255, 255, 255, 0.81); }
	.color-naranja { background: #854c1d; color: rgba(255, 255, 255, 0.81); }
	.color-amarillo { background: #89632a; color: rgba(255, 255, 255, 0.81); }
	.color-verde { background: #2b593f; color: rgba(255, 255, 255, 0.81); }
	.color-azul { background: #28456c; color: rgba(255, 255, 255, 0.81); }
	.color-morado { background: #492f64; color: rgba(255, 255, 255, 0.81); }
	.color-rosa { background: #69314c; color: rgba(255, 255, 255, 0.81); }
	.color-rojo { background: #6e3630; color: rgba(255, 255, 255, 0.81); }
}

/* --- avisos, cajas y texto secundario ------------------------------------ */

.aviso {
	margin: 0 0 1.4rem;
	padding: 0.6rem 0.8rem;
	border-radius: var(--radio);
	border-left: 3px solid var(--peligro);
	background: var(--fondo-hover);
	color: var(--texto);
}

.caja {
	margin: 0 0 1.4rem;
	padding: 1rem 1.1rem;
	border: 1px solid var(--borde);
	border-radius: var(--radio-tarjeta);
}

/* Un título dentro de una caja no necesita separarse de su propio borde. */
.caja > :first-child, .comentario > :first-child {
	margin-top: 0;
}

.silencio {
	color: var(--texto-suave);
}

.pequeno {
	font-size: 0.85rem;
}

.en-linea {
	display: inline;
	margin: 0;
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
	margin-bottom: 1.4rem;
}

.grupo {
	margin: 0 0 1.8rem;
}

.grupo h2 {
	display: flex;
	align-items: baseline;
	gap: 0.5rem;
}

/* --- propiedades --------------------------------------------------------- */

.propiedades {
	margin: 0 0 1.8rem;
}

.propiedad {
	display: grid;
	grid-template-columns: 10rem 1fr;
	align-items: baseline;
	gap: 0.2rem 0.6rem;
	padding: 0.18rem 0;
}

.propiedad dt {
	color: var(--texto-suave);
	font-size: 0.85rem;
}

.propiedad dd {
	margin: 0;
	min-width: 0;
}

/* --- tablas -------------------------------------------------------------- */

.tabla-envuelta {
	overflow-x: auto;
	margin: 0 0 1.4rem;
}

table {
	width: 100%;
	border-collapse: collapse;
}

th, td {
	text-align: left;
	padding: 0.45rem 0.6rem;
	border-bottom: 1px solid var(--borde);
	vertical-align: top;
}

thead th {
	color: var(--texto-suave);
	font-size: 0.72rem;
	font-weight: 500;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}

/* Las tablas de dos columnas (la ficha) usan «th» como nombre de la fila. */
tbody th {
	width: 10rem;
	color: var(--texto-suave);
	font-size: inherit;
	font-weight: 400;
	letter-spacing: normal;
	text-transform: none;
}

tbody tr:hover td {
	background: var(--fondo-hover);
}

tbody tr:last-child td, tbody tr:last-child th {
	border-bottom: none;
}

td.numero, th.numero {
	text-align: right;
	font-variant-numeric: tabular-nums;
}

/* --- formularios --------------------------------------------------------- */

form {
	margin: 0 0 1.2rem;
}

fieldset {
	margin: 0 0 1rem;
	padding: 0.8rem 1rem 0.3rem;
	border: 1px solid var(--borde);
	border-radius: var(--radio-tarjeta);
}

legend {
	padding: 0 0.35rem;
	color: var(--texto-suave);
	font-size: 0.72rem;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}

label {
	display: block;
	margin: 0 0 0.9rem;
}

label > span {
	display: block;
	margin-bottom: 0.25rem;
	color: var(--texto-suave);
	font-size: 0.85rem;
}

/* Los controles no llevan borde propio: un fondo suave y ya. El borde
   transparente reserva el sitio para que el foco no mueva el diseño. */
input[type="text"], input[type="password"], textarea, select {
	width: 100%;
	max-width: 34rem;
	padding: 0.4rem 0.6rem;
	font: inherit;
	color: var(--texto);
	background: var(--fondo-hover);
	border: 1px solid transparent;
	border-radius: var(--radio);
}

input[type="text"]:focus, input[type="password"]:focus, textarea:focus, select:focus {
	outline: 2px solid var(--acento);
	outline-offset: 0;
}

textarea {
	min-height: 6rem;
	resize: vertical;
}

input[type="checkbox"], input[type="radio"] {
	margin-right: 0.4rem;
	accent-color: var(--acento);
}

label.opcion {
	padding: 0.5rem 0.7rem;
	border: 1px solid var(--borde);
	border-radius: var(--radio-tarjeta);
	cursor: pointer;
}

label.opcion:hover {
	background: var(--fondo-hover);
}

label.opcion:has(input:checked) {
	border-color: var(--acento);
}

label.opcion .consecuencia {
	display: block;
	margin: 0.2rem 0 0 1.4rem;
	color: var(--texto-suave);
	font-size: 0.85rem;
}

.recomendada {
	margin-left: 0.4rem;
	color: var(--acento);
	font-size: 0.78rem;
	white-space: nowrap;
}

button, .boton {
	display: inline-block;
	padding: 0.35rem 0.8rem;
	font: inherit;
	color: var(--texto);
	background: var(--fondo);
	border: 1px solid var(--borde);
	border-radius: var(--radio);
	text-decoration: none;
	white-space: nowrap;
	cursor: pointer;
}

button:hover, .boton:hover {
	background: var(--fondo-hover);
}

button.principal, .boton.principal {
	background: var(--acento);
	border-color: var(--acento);
	color: #ffffff;
}

button.principal:hover, .boton.principal:hover {
	filter: brightness(0.93);
}

button.peligro, .boton.peligro {
	color: var(--peligro);
	background: none;
	border-color: transparent;
}

button.peligro:hover, .boton.peligro:hover {
	background: var(--fondo-hover);
}

button.enlace {
	padding: 0;
	color: var(--texto-suave);
	background: none;
	border: none;
	font-size: 0.85rem;
}

button.enlace:hover {
	background: none;
	color: var(--texto);
	text-decoration: underline;
}

.acciones {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-start;
	gap: 0.5rem 0.7rem;
}

.acciones form {
	margin: 0;
}

/* Los filtros son una fila de desplegables compactos, sin caja: la regla va
   después de «.caja» para ganarle cuando el formulario lleva las dos clases. */
.filtros {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	gap: 0.5rem 0.8rem;
	margin: 0 0 1.6rem;
	padding: 0;
	border: none;
}

/* Los desplegables encogen antes que desbordar: en móvil se reparten la fila
   y bajan a la siguiente, y la página nunca se desplaza en horizontal. */
.filtros label {
	flex: 1 1 8rem;
	min-width: 0;
	margin: 0;
}

.filtros input, .filtros select {
	max-width: 12rem;
}

/* --- hilo ---------------------------------------------------------------- */

.hilo {
	display: flex;
	flex-direction: column;
	gap: 0.8rem;
	margin-bottom: 1.6rem;
}

.comentario {
	padding: 0.8rem 1rem;
	background: var(--fondo);
	border: 1px solid var(--borde);
	border-radius: var(--radio-tarjeta);
}

.comentario > header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.35rem 0.6rem;
	margin-bottom: 0.5rem;
	color: var(--texto-suave);
	font-size: 0.85rem;
}

.comentario .autor {
	color: var(--texto);
	font-weight: 600;
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
	margin: 0.9rem 0 0;
	padding-top: 0.9rem;
	border-top: 1px solid var(--borde);
}

/* --- terminales ---------------------------------------------------------- */

.token {
	display: block;
	margin: 0.8rem 0;
	padding: 0.8rem 1rem;
	background: var(--fondo-hover);
	border-radius: var(--radio-tarjeta);
	font-size: 1.05rem;
	word-break: break-all;
	user-select: all;
}

.uso {
	margin: 0;
	padding: 0;
	list-style: none;
	font-size: 0.85rem;
}

/* --- kanban -------------------------------------------------------------- */

/* Cinco columnas fijas: si no caben, el tablero se desplaza en horizontal. El
   mínimo está calculado para que las cinco entren a lo ancho de un portátil. */
.columnas {
	display: grid;
	grid-template-columns: repeat(5, minmax(11rem, 1fr));
	gap: 0.9rem;
	align-items: start;
	overflow-x: auto;
	padding-bottom: 0.6rem;
}

/* Las columnas no tienen fondo: lo que se ve son las tarjetas. */
.columna {
	min-width: 0;
	padding: 0;
}

.columna h2 {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.4rem;
	margin: 0 0 0.6rem;
	padding: 0 0.15rem;
	font-size: 0.85rem;
	font-weight: 600;
}

.columna > p {
	margin: 0.5rem 0 0;
}

/* La zona donde se sueltan las tarjetas. Con la columna vacía sigue habiendo
   sitio para soltar. */
.tarjetas {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
	min-height: 3rem;
}

.tarjeta {
	padding: 0.5rem 0.6rem;
	background: var(--fondo);
	border: 1px solid var(--borde);
	border-radius: var(--radio-tarjeta);
	cursor: grab;
}

.tarjeta:hover {
	box-shadow: 0 1px 4px rgb(15 15 15 / 12%);
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
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.3rem;
	margin-bottom: 0.25rem;
}

.tarjeta .titulo {
	line-height: 1.35;
}

/* El hueco que SortableJS deja donde caería la tarjeta. */
.tarjeta.arrastrando {
	border-style: dashed;
	opacity: 0.45;
	box-shadow: none;
}

/* La tarjeta que va con el puntero: la única sombra fuerte de la web. */
.tarjeta.sortable-chosen, .tarjeta.sortable-drag {
	box-shadow: 0 6px 16px rgb(15 15 15 / 22%);
}

.aviso-tablero {
	margin-bottom: 0.9rem;
}

/* Aviso de la ficha: no se recarga sola, así que el humano decide cuándo. */
.aviso-recarga {
	position: fixed;
	top: 0;
	left: 50%;
	transform: translateX(-50%);
	padding: 0.5rem 0.9rem;
	background: var(--fondo);
	border: 1px solid var(--acento);
	border-top: none;
	border-radius: 0 0 var(--radio-tarjeta) var(--radio-tarjeta);
	z-index: 30;
}

/* --- móvil: la barra lateral se convierte en panel ----------------------- */

@media (max-width: 48rem) {
	.cabecera-movil {
		display: flex;
		position: sticky;
		top: 0;
		z-index: 15;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.8rem;
		background: var(--fondo-lateral);
		border-bottom: 1px solid var(--borde);
	}

	.cabecera-movil .marca {
		color: var(--texto);
		font-weight: 700;
		text-decoration: none;
	}

	.lateral {
		width: min(15rem, 82vw);
		transform: translateX(-100%);
		transition: transform 0.15s ease-out;
		box-shadow: 0 0 24px rgb(15 15 15 / 30%);
	}

	body.lateral-abierta .lateral {
		transform: none;
	}

	.contenido {
		margin-left: 0;
		padding: 1.6rem 1rem 4rem;
	}

	.propiedad {
		grid-template-columns: 1fr;
	}

	th, td {
		padding: 0.45rem 0.5rem;
	}
}

@media (prefers-reduced-motion: reduce) {
	.lateral {
		transition: none;
	}
}
`;
