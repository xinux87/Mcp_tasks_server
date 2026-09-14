/**
 * La hoja de estilos entera, como constante. No hay archivos estáticos en
 * disco: así el Dockerfile no tiene que copiar nada más que `src/`. La sirve
 * `GET /static/app.css`.
 *
 * El diseño es el de «Diseño visual» en CLAUDE.md: el puesto de mando de quien
 * dirige agentes. Un único color de señal (`--turno`) para lo que espera por el
 * humano, otro (`--acento`) para las acciones, y lo demás neutro.
 *
 * El tema tiene tres estados y tres bloques, que redefinen los mismos tokens:
 * `:root` es la paleta clara, `@media (prefers-color-scheme: dark)` acotado a
 * `:root:not([data-tema="claro"])` sigue al sistema, y `:root[data-tema="oscuro"]`
 * manda sobre los dos. Ningún color se define fuera de los tokens y de la tabla
 * de nueve colores.
 */
export const CSS = `:root {
	color-scheme: light;

	/* Los diez tokens de la tabla de CLAUDE.md. Nada más define color. */
	--fondo: #ffffff;
	--fondo-lateral: #f4f5f7;
	--fondo-hover: rgba(28, 36, 48, 0.06);
	--texto: #1c2430;
	--texto-suave: rgba(28, 36, 48, 0.62);
	--borde: rgba(28, 36, 48, 0.14);
	--acento: #0f766e;
	--turno: #b45309;
	--turno-fondo: #fff4e5;
	--peligro: #b91c1c;

	/* Medidas: 4 px en controles, 8 px en tarjetas, 15 rem de barra lateral. */
	--radio: 4px;
	--radio-tarjeta: 8px;
	--lateral: 15rem;
	--ancho-contenido: 64rem;
}

/* Sin elegir tema se sigue al sistema; con «claro» puesto, no. */
@media (prefers-color-scheme: dark) {
	:root:not([data-tema="claro"]) {
		color-scheme: dark;

		--fondo: #1b2027;
		--fondo-lateral: #14181d;
		--fondo-hover: rgba(255, 255, 255, 0.06);
		--texto: rgba(255, 255, 255, 0.86);
		--texto-suave: rgba(255, 255, 255, 0.5);
		--borde: rgba(255, 255, 255, 0.12);
		--acento: #34b8ab;
		--turno: #f59e0b;
		--turno-fondo: rgba(245, 158, 11, 0.14);
		--peligro: #f87171;
	}
}

/* Elegido a mano: gana al sistema, esté como esté. */
:root[data-tema="oscuro"] {
	color-scheme: dark;

	--fondo: #1b2027;
	--fondo-lateral: #14181d;
	--fondo-hover: rgba(255, 255, 255, 0.06);
	--texto: rgba(255, 255, 255, 0.86);
	--texto-suave: rgba(255, 255, 255, 0.5);
	--borde: rgba(255, 255, 255, 0.12);
	--acento: #34b8ab;
	--turno: #f59e0b;
	--turno-fondo: rgba(245, 158, 11, 0.14);
	--peligro: #f87171;
}

/* --- base ---------------------------------------------------------------- */

* {
	box-sizing: border-box;
}

body {
	margin: 0;
	background: var(--fondo);
	color: var(--texto);
	font-family: "Avenir Next", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
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
	font-size: 1.75rem;
	font-weight: 600;
	letter-spacing: -0.01em;
}

h2 {
	font-size: 1.2rem;
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

/* El selector de proyecto, debajo del nombre: ocupa el ancho de la barra y el
   botón «Ir» solo se ve sin JavaScript, que es quien lo esconde. */
.selector-proyecto {
	display: flex;
	gap: 0.3rem;
	margin: 0 0 1.1rem;
	padding: 0 0.5rem;
}

.selector-proyecto select {
	flex: 1;
	min-width: 0;
	font-size: 0.85rem;
}

.bloque {
	margin-bottom: 1.1rem;
}

/* El título de un bloque de navegación: pequeño y suave, nunca en mayúsculas. */
.bloque h2 {
	margin: 0 0 0.2rem;
	padding: 0 0.5rem;
	color: var(--texto-suave);
	font-size: 0.8125rem;
	font-weight: 600;
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
	padding-top: 0.8rem;
	border-top: 1px solid var(--borde);
}

.pie-lateral form {
	margin: 0;
}

/* --- conmutador de tema -------------------------------------------------- */

/* Tres radios como un grupo de botones segmentado: lo marcado se ve hundido
   sobre el fondo del papel, y el foco se ve aunque el radio esté escondido. */
fieldset.tema {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.3rem;
	margin: auto 0 0.6rem;
	padding: 0.2rem;
	border: 1px solid var(--borde);
	border-radius: var(--radio);
}

fieldset.tema legend {
	padding: 0;
	color: var(--texto-suave);
	font-size: 0.8125rem;
}

fieldset.tema label {
	flex: 1 1 auto;
	margin: 0;
	padding: 0.1rem 0.4rem;
	border: 1px solid transparent;
	border-radius: var(--radio);
	color: var(--texto-suave);
	font-size: 0.8125rem;
	text-align: center;
	cursor: pointer;
}

fieldset.tema label:hover {
	color: var(--texto);
}

/* El radio no se ve: lo que se pulsa es su rótulo. Sigue siendo un radio, así
   que el teclado y los lectores de pantalla lo recorren como un grupo. */
fieldset.tema input[type="radio"] {
	position: absolute;
	width: 1px;
	height: 1px;
	margin: 0;
	opacity: 0;
}

fieldset.tema label:has(input:checked) {
	background: var(--fondo);
	border-color: var(--borde);
	color: var(--texto);
	font-weight: 600;
}

fieldset.tema label:has(input:focus-visible) {
	outline: 2px solid var(--acento);
	outline-offset: 1px;
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
	padding: 2.5rem 2.5rem 5rem;
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

/* El enlace de conexión también se sirve sin sesión, pero no es un formulario
   de 22 rem: es un texto largo que se lee de arriba abajo. */
body[data-vista="conectar"] .contenido-entrada {
	display: block;
	min-height: 0;
	padding: 3rem 1rem;
}

body[data-vista="conectar"] .contenido-entrada .dentro {
	max-width: 60rem;
	margin: 0 auto;
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

/* Para qué sirve esta pantalla, escrito desde el punto de vista de quien mira.
   Va pegada al título: es parte de la cabecera, no un párrafo suelto. */
.proposito {
	margin: 0.35rem 0 0;
	max-width: 46rem;
	color: var(--texto-suave);
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

/* Los nueve en oscuro, dos veces: siguiendo al sistema y elegido a mano. Las
   dos listas son la misma, y el selector de raíz las hace ganar a las de
   arriba sin depender del orden de la hoja. */
@media (prefers-color-scheme: dark) {
	:root:not([data-tema="claro"]) .color-gris { background: #373737; color: rgba(255, 255, 255, 0.81); }
	:root:not([data-tema="claro"]) .color-marron { background: #603b2c; color: rgba(255, 255, 255, 0.81); }
	:root:not([data-tema="claro"]) .color-naranja { background: #854c1d; color: rgba(255, 255, 255, 0.81); }
	:root:not([data-tema="claro"]) .color-amarillo { background: #89632a; color: rgba(255, 255, 255, 0.81); }
	:root:not([data-tema="claro"]) .color-verde { background: #2b593f; color: rgba(255, 255, 255, 0.81); }
	:root:not([data-tema="claro"]) .color-azul { background: #28456c; color: rgba(255, 255, 255, 0.81); }
	:root:not([data-tema="claro"]) .color-morado { background: #492f64; color: rgba(255, 255, 255, 0.81); }
	:root:not([data-tema="claro"]) .color-rosa { background: #69314c; color: rgba(255, 255, 255, 0.81); }
	:root:not([data-tema="claro"]) .color-rojo { background: #6e3630; color: rgba(255, 255, 255, 0.81); }
}

:root[data-tema="oscuro"] .color-gris { background: #373737; color: rgba(255, 255, 255, 0.81); }
:root[data-tema="oscuro"] .color-marron { background: #603b2c; color: rgba(255, 255, 255, 0.81); }
:root[data-tema="oscuro"] .color-naranja { background: #854c1d; color: rgba(255, 255, 255, 0.81); }
:root[data-tema="oscuro"] .color-amarillo { background: #89632a; color: rgba(255, 255, 255, 0.81); }
:root[data-tema="oscuro"] .color-verde { background: #2b593f; color: rgba(255, 255, 255, 0.81); }
:root[data-tema="oscuro"] .color-azul { background: #28456c; color: rgba(255, 255, 255, 0.81); }
:root[data-tema="oscuro"] .color-morado { background: #492f64; color: rgba(255, 255, 255, 0.81); }
:root[data-tema="oscuro"] .color-rosa { background: #69314c; color: rgba(255, 255, 255, 0.81); }
:root[data-tema="oscuro"] .color-rojo { background: #6e3630; color: rgba(255, 255, 255, 0.81); }

/* La señal: lo que espera por el humano. Va después de los nueve colores
   porque no es uno de ellos, es el único color de turno. */
.insignia.turno {
	background: var(--turno-fondo);
	color: var(--turno);
	font-weight: 600;
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

/*
 * Cuánto lleva una tarea en su columna. Va en texto suave salvo cuando duele:
 * un día bloqueada o tres días esperando revisión.
 */
.edad {
	color: var(--texto-suave);
	font-size: 0.85rem;
	white-space: nowrap;
}

.edad-peligro {
	color: var(--peligro);
}

.pequeno {
	font-size: 0.85rem;
}

.en-linea {
	display: inline;
	margin: 0;
}

/* Cuántas cosas hay. En una columna es un dato más y va en texto suave. */
.contador {
	color: var(--texto-suave);
	font-size: 0.8125rem;
	font-weight: 400;
	font-variant-numeric: tabular-nums;
}

/* De quién es el turno mientras la tarea está en esa columna. Es un dato de
   apoyo del rótulo: se lee si se busca, no compite con el nombre. */
.dueno {
	color: var(--texto-suave);
	font-size: 0.8125rem;
	font-weight: 400;
}

/* En la bandeja y en su entrada de la barra lateral, en cambio, es lo que
   espera por el humano: ahí, y solo ahí, lleva el color de la señal. */
.enlace-nav .contador, .bloque-bandeja .contador {
	color: var(--turno);
	font-weight: 600;
}

/* Un identificador es una cifra, no código: alineado por columnas y con la
   misma tipografía que el resto. La monoespaciada es solo para comandos. */
.id-tarea {
	font-variant-numeric: tabular-nums;
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
	font-size: 0.8125rem;
	font-weight: 500;
}

/* Las tablas de dos columnas (la ficha) usan «th» como nombre de la fila. */
tbody th {
	width: 10rem;
	color: var(--texto-suave);
	font-size: inherit;
	font-weight: 400;
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
	font-size: 0.8125rem;
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

/* La ayuda de un campo va debajo de su control, no encima como el rótulo. */
label > span.ayuda {
	margin: 0.3rem 0 0;
	font-size: 0.8rem;
}

/* Un desplegable de varias opciones se lee como una lista: sitio a los lados
   de cada opción y el alto que pida el atributo «size». */
select[multiple] {
	padding: 0.3rem;
}

/* Los controles no llevan borde propio: un fondo suave y ya. El borde
   transparente reserva el sitio para que el foco no mueva el diseño. */
input[type="text"], input[type="password"], input[type="number"], textarea, select {
	width: 100%;
	max-width: 34rem;
	padding: 0.4rem 0.6rem;
	font: inherit;
	color: var(--texto);
	background: var(--fondo-hover);
	border: 1px solid transparent;
	border-radius: var(--radio);
}

/* Un número de una o dos cifras no necesita el ancho de un campo de texto. */
input[type="number"] {
	max-width: 6rem;
}

input[type="text"]:focus, input[type="password"]:focus, input[type="number"]:focus, textarea:focus, select:focus {
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

/* --- tutorial de conexión ------------------------------------------------ */

/* Los pasos van numerados por la propia lista: el número a la izquierda y el
   contenido del paso debajo de su título. */
.pasos {
	margin: 0;
	padding-left: 1.5rem;
}

.pasos > li {
	margin-bottom: 1.6rem;
}

.pasos > li:last-child {
	margin-bottom: 0;
}

.pasos > li > h3:first-child {
	margin-top: 0;
}

.tutorial table {
	width: auto;
}

/* Un bloque copiable: el botón flota sobre la esquina del código, que le deja
   sitio con su propio relleno. */
.bloque-codigo {
	position: relative;
	margin-bottom: 0.9rem;
}

.bloque-codigo pre {
	margin: 0;
	padding-right: 5.5rem;
}

.bloque-codigo .copiar {
	position: absolute;
	top: 0.45rem;
	right: 0.45rem;
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

/* La edad se va al borde derecho de la línea, lejos del identificador. */
.tarjeta .linea .edad {
	margin-left: auto;
}

/* La última línea: las fases a la izquierda y los tokens al otro extremo, que
   es la cifra que dice si la tarea se ha ido de madre. */
.tarjeta .pie {
	display: flex;
	align-items: baseline;
	gap: 0.4rem;
}

.tarjeta .pie .tokens {
	margin-left: auto;
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}

/* La misma señal que la etiqueta, pero visible de lejos: de un vistazo se ve
   cuáles de todo el tablero esperan por el humano. */
.tarjeta.espera {
	border-left: 3px solid var(--turno);
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

/* Carriles del kanban */

/* Agrupado por funcionalidad, el tablero es una franja por funcionalidad más
   «Sueltas»: la cabecera de ancho completo y debajo las columnas de siempre. */
.franja + .franja {
	margin-top: 1.5rem;
}

.franja-cabecera {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.4rem;
	margin-bottom: 0.6rem;
	padding: 0.2rem 0.15rem 0.35rem;
	border-bottom: 1px solid var(--borde);
}

.franja-cabecera h2 {
	margin: 0;
	font-size: 1rem;
	font-weight: 600;
}

.franja-cabecera h2 a {
	color: inherit;
	text-decoration: none;
}

.franja-cabecera h2 a:hover {
	text-decoration: underline;
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

/* Quien pide menos movimiento no lo tiene: ni el panel lateral ni el arrastre
   ni nada que se anime. Es la regla entera, no una excepción por elemento. */
@media (prefers-reduced-motion: reduce) {
	*, *::before, *::after {
		transition: none !important;
		animation: none !important;
		scroll-behavior: auto !important;
	}
}

/* --- pantallas de sistema ---------------------------------------------- */

/* Texto que solo existe para quien no ve la pantalla: el nombre del color de
   una muestra, que a la vista ya lo dice el propio color. */
.solo-lectores {
	position: absolute;
	width: 1px;
	height: 1px;
	margin: -1px;
	padding: 0;
	border: 0;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
}

/* Una tarjeta que no necesita los 60 rem del contenido: confirmaciones,
   páginas de error y la del token. */
.caja-estrecha {
	max-width: 34rem;
}

/* Lo último de una tarjeta no separa de su propio borde, igual que lo primero. */
.caja > :last-child {
	margin-bottom: 0;
}

/* El nombre de un campo que no envuelve a su control, como el selector de
   color: mismo aspecto que el «span» de una etiqueta normal. */
.nombre-campo {
	margin: 0 0 0.3rem;
	color: var(--texto-suave);
	font-size: 0.85rem;
}

button.pequeno, .boton.pequeno {
	padding: 0.15rem 0.55rem;
}

/* La acción de una fila de terminales es un enlace discreto y no un botón: con
   diez columnas, el relleno de un botón por fila es justo el ancho que hace
   que la última columna no quepa. La confirmación que abre sí lleva botón. */
.accion-fila {
	color: var(--peligro);
	font-size: 0.85rem;
	text-decoration: none;
	white-space: nowrap;
}

.accion-fila:hover {
	text-decoration: underline;
}

/* Rotar un token no destruye nada: no lleva el rojo de revocar. */
.accion-fila.neutra {
	color: var(--acento);
}

/* Las dos acciones de la fila de un terminal, una debajo de otra si no caben:
   la última columna es estrecha y «Rotar token» no puede partirse. */
.acciones-terminal {
	display: flex;
	flex-wrap: wrap;
	gap: 0.2rem 0.6rem;
}

/* --- selector de color --------------------------------------------------- */

.colores {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.3rem;
	margin: 0 0 1rem;
}

/* La muestra no pinta fondo: el color se lo da su clase «.color-*», que está
   más arriba en la hoja y ganaría a lo que se declarase aquí. */
.muestra {
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.35rem;
	height: 1.35rem;
	margin: 0;
	border-radius: 50%;
	cursor: pointer;
}

/* El radio ocupa la muestra entera y no se ve: lo que se pulsa es el color. */
.muestra input[type="radio"] {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	margin: 0;
	opacity: 0;
	cursor: pointer;
}

/* El elegido lleva un anillo, con un hueco del color del fondo para que se
   distinga en los nueve colores y en los dos modos. */
.muestra:has(input:checked) {
	box-shadow: 0 0 0 2px var(--fondo), 0 0 0 3px var(--texto);
}

.muestra:has(input:focus-visible) {
	outline: 2px solid var(--acento);
	outline-offset: 2px;
}

/* «Automático» no es un color: se enseña con su nombre y borde de puntos. */
.muestra-auto {
	width: auto;
	height: auto;
	padding: 0.05rem 0.55rem;
	border: 1px dashed var(--borde);
	border-radius: 999px;
	color: var(--texto-suave);
	font-size: 0.78rem;
}

/* El cambio de color de una fila: muestras y botón en la misma línea. */
.cambio-color {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem;
	margin: 0;
}

.cambio-color .colores {
	margin: 0;
}

/* --- terminales ---------------------------------------------------------- */

/* Diez columnas aprietan: la cuenta parte por donde haga falta y el uso reserva
   lo justo para que la barra se lea. Si aun así no cabe, es «.tabla-envuelta»
   la que se desplaza, no la página. */
/* Con diez columnas, el hueco lateral de cada una suma más que cualquier dato:
   aquí se recorta para que la fila entera quepa sin desplazar la tabla. */
.tabla-terminales th, .tabla-terminales td {
	padding-left: 0.4rem;
	padding-right: 0.4rem;
}

/* Los agentes en paralelo se cambian en la propia fila: el número es de una
   cifra, así que el campo ocupa lo justo y el botón va a su lado. */
.cambio-agentes {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.3rem;
	margin: 0;
}

.cambio-agentes input {
	width: 3.5rem;
}

.celda-cuenta {
	min-width: 9rem;
	overflow-wrap: anywhere;
}

.celda-uso {
	min-width: 11rem;
}

.uso {
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
}

.uso-ventana {
	display: grid;
	gap: 0.15rem;
}

.uso-cabecera {
	display: flex;
	justify-content: space-between;
	gap: 0.6rem;
}

.uso-nombre {
	color: var(--texto-suave);
}

.uso-cifra {
	font-variant-numeric: tabular-nums;
}

.uso-barra {
	display: block;
	height: 4px;
	border-radius: 999px;
	background: var(--fondo-hover);
	overflow: hidden;
}

/* El ancho sale de la decena que calcula el servidor: una regla por valor, y
   así ninguna plantilla lleva estilos en línea. */
.uso-relleno {
	display: block;
	height: 100%;
	border-radius: 999px;
	background: var(--acento);
}

.uso-relleno[data-nivel="0"] { width: 0; }
.uso-relleno[data-nivel="1"] { width: 10%; }
.uso-relleno[data-nivel="2"] { width: 20%; }
.uso-relleno[data-nivel="3"] { width: 30%; }
.uso-relleno[data-nivel="4"] { width: 40%; }
.uso-relleno[data-nivel="5"] { width: 50%; }
.uso-relleno[data-nivel="6"] { width: 60%; }
.uso-relleno[data-nivel="7"] { width: 70%; }
.uso-relleno[data-nivel="8"] { width: 80%; }
.uso-relleno[data-nivel="9"] { width: 90%; }
.uso-relleno[data-nivel="10"] { width: 100%; }

/* Queda poco: la barra avisa sola, sin tener que leer la cifra. */
.uso-relleno[data-nivel="0"],
.uso-relleno[data-nivel="1"],
.uso-relleno[data-nivel="2"] {
	background: var(--peligro);
}

.uso-reinicio {
	color: var(--texto-suave);
	font-size: 0.78rem;
}

/* --- usuarios ------------------------------------------------------------ */

.tabla-usuarios {
	min-width: 34rem;
}

/* --- actividad ----------------------------------------------------------- */

.dia h2 {
	margin: 1.6rem 0 0.2rem;
	color: var(--texto-suave);
	font-size: 0.8125rem;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
}

.dia:first-of-type h2 {
	margin-top: 0;
}

.actividad {
	margin: 0;
	padding: 0;
	list-style: none;
}

.acto {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.2rem 0.45rem;
	padding: 0.4rem 0.15rem;
	border-bottom: 1px solid var(--borde);
}

.acto:last-child {
	border-bottom: none;
}

.acto .frase {
	color: var(--texto-suave);
}

.acto .detalle {
	font-size: 0.85rem;
}

/* La hora se va al extremo: la columna que se lee de un vistazo. */
.acto .hora {
	margin-left: auto;
	padding-left: 0.6rem;
	font-size: 0.82rem;
	font-variant-numeric: tabular-nums;
}

/* --- pantallas de tareas --------------------------------------------- */

/* La fila de filtros es compacta: los desplegables se quedan en su ancho en
   vez de repartirse la fila, y encogen solo cuando no caben. El botón y el
   enlace se alinean con su base, que es donde el ojo espera encontrarlos. */
.filtros label {
	flex: 0 1 10rem;
}

/* Los conmutadores de un clic van a la izquierda de los desplegables, en la
   misma fila mientras quepan. */
.fila-filtros {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	gap: 0.5rem 0.8rem;
	margin-bottom: 1.6rem;
}

.fila-filtros .filtros {
	margin-bottom: 0;
}

/* Las dos vistas de la sección Tareas, como un solo control segmentado: son
   la misma cosa mirada de dos maneras, no dos filtros que se suman. */
.vistas {
	display: flex;
	border: 1px solid var(--borde);
	border-radius: var(--radio);
	overflow: hidden;
}

.vistas a {
	padding: 0.3rem 0.8rem;
	color: var(--texto-suave);
	font-size: 0.85rem;
	text-decoration: none;
}

.vistas a + a {
	border-left: 1px solid var(--borde);
}

.vistas a:hover {
	background: var(--fondo-hover);
	color: var(--texto);
}

.vistas a[aria-current="page"] {
	background: var(--fondo-hover);
	color: var(--texto);
	font-weight: 600;
}

.filtros-rapidos {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem;
	padding-bottom: 0.1rem;
}

.boton-filtro {
	padding: 0.3rem 0.7rem;
	color: var(--texto);
	font-size: 0.85rem;
	text-decoration: none;
	border: 1px solid var(--borde);
	border-radius: var(--radio);
}

.boton-filtro:hover {
	background: var(--fondo-hover);
}

/* El activo se ve puesto: pulsarlo otra vez lo quita. */
.boton-filtro[aria-current="true"] {
	background: var(--fondo-hover);
	border-color: var(--acento);
	font-weight: 600;
}

.filtros button {
	padding: 0.3rem 0.7rem;
}

.filtros .quitar {
	padding-bottom: 0.35rem;
	color: var(--texto-suave);
	font-size: 0.85rem;
	text-decoration: none;
}

.filtros .quitar:hover {
	color: var(--texto);
	text-decoration: underline;
}

/* La etiqueta de estado ya trae su propio margen: en un rótulo con hueco
   propio sumarían dos separaciones seguidas. */
.grupo h2 .insignia, .columna h2 .insignia, .etiquetas .insignia {
	margin-right: 0;
}

/* En la lista, el título manda: el resto de columnas se lee de refilón. */
.grupo td:first-child, .grupo th:first-child {
	width: 6rem;
}

.grupo tbody td:nth-child(3), .grupo tbody td:nth-child(4) {
	color: var(--texto-suave);
}

/* El grupo de las cerradas se pliega; el triángulo no debe empujar el rótulo. */
.grupo summary {
	cursor: pointer;
	font-size: 1.15rem;
	font-weight: 600;
	margin-bottom: 0.6rem;
}

/* --- casillas y opciones: la marca a un lado, el texto y su detalle al otro */

label.casilla, label.opcion {
	display: grid;
	grid-template-columns: auto 1fr;
	align-items: baseline;
}

/* El texto de la casilla es el texto de la página, no un rótulo de campo: la
   regla general de «label > span» lo dejaría suave y pequeño. */
label.casilla .que, label.opcion .que {
	grid-column: 2;
	margin: 0;
	color: var(--texto);
	font-size: inherit;
}

label.casilla .detalle, label.opcion .consecuencia {
	grid-column: 2;
	margin: 0.1rem 0 0;
	color: var(--texto-suave);
	font-size: 0.85rem;
}

/* Va dentro del texto de la opción, no debajo. */
label.opcion .recomendada {
	display: inline;
}

/* --- nueva tarea y edición ----------------------------------------------- */

/* Las dos fases, lado a lado a partir de 48 rem. Cuando solo hay una (una
   pregunta no tiene ejecución) ocupa el ancho entero en vez de dejar hueco. */
.fases {
	display: grid;
	gap: 0 1rem;
}

.fases > fieldset:only-child {
	grid-column: 1 / -1;
}

@media (min-width: 48rem) {
	.fases {
		grid-template-columns: 1fr 1fr;
	}
}

/* --- ficha --------------------------------------------------------------- */

.hijas {
	margin: 0 0 1.4rem;
	padding: 0;
	list-style: none;
}

.hijas li {
	padding: 0.2rem 0;
}

/* El rastro de la tarea: una línea por acción, de la más antigua a la más
   nueva. Sin numerar: lo que ordena es la fecha del final. */
.actividad {
	margin: 0 0 1.4rem;
	padding: 0;
	list-style: none;
}

.actividad li {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.35rem;
	padding: 0.25rem 0;
	border-bottom: 1px solid var(--borde);
}

.actividad li:last-child {
	border-bottom: none;
}

/* La fecha se va al final de la línea, que es donde no estorba al leer. */
.actividad li > :last-child {
	margin-left: auto;
}

/* Los detalles plegados del final (vueltas atrás, editar) son excepcionales. */
details.caja > summary {
	cursor: pointer;
}

details.caja[open] > summary {
	margin-bottom: 0.9rem;
}

/* --- funcionalidades, partes y dependencias ------------------------------ */

/* El progreso de una tarea con hijas: barra fina y la cuenta al lado. Es un
   elemento progress, así que el navegador la pinta y la cuenta él solo; hay
   que quitarle su aspecto en cada motor para que sea la misma raya en todos. */
.progreso {
	width: 4.5rem;
	height: 4px;
	vertical-align: middle;
	border: none;
	border-radius: 2px;
	background: var(--fondo-hover);
	appearance: none;
}

.progreso::-webkit-progress-bar {
	border-radius: 2px;
	background: var(--fondo-hover);
}

.progreso::-webkit-progress-value {
	border-radius: 2px;
	background: var(--acento);
}

.progreso::-moz-progress-bar {
	border-radius: 2px;
	background: var(--acento);
}

/* Los márgenes van aquí y no en el hueco de la plantilla: en la fila el texto
   queda pegado al título de la tarea si no los lleva. */
.progreso-texto {
	margin: 0 0.4rem 0 0.5rem;
	color: var(--texto-suave);
	font-size: 0.85rem;
	font-variant-numeric: tabular-nums;
}

/* De qué funcionalidad es parte una tarea: debajo de su título en la lista y
   en la tarjeta, en texto suave para que no compita con él. */
.parte-de {
	color: var(--texto-suave);
	text-decoration: none;
}

.parte-de::before {
	content: "↳ ";
}

.parte-de:hover {
	color: var(--texto);
	text-decoration: underline;
}

/* Las dependencias de la ficha: una detrás de otra, y ninguna partida por
   dentro, que separaría la etiqueta de su identificador. */
.dependencias {
	display: inline-flex;
	flex-wrap: wrap;
	gap: 0.2rem 0.8rem;
}

.dependencia {
	white-space: nowrap;
}

/* El alta de una parte va encima del tablero de su funcionalidad. */
.acciones-partes {
	margin-bottom: 0.9rem;
}

/* Borrar es excepcional y no compite con «Guardar cambios»: enlace rojo
   discreto al final del bloque de editar. */
.accion-peligro {
	color: var(--peligro);
	text-decoration: none;
}

.accion-peligro:hover {
	text-decoration: underline;
}

/* En la tabla de funcionalidades manda el título, como en la lista de tareas. */
.tabla-funcionalidades td:first-child a:not(.id-tarea) {
	color: var(--texto);
	text-decoration: none;
}

.tabla-funcionalidades td:first-child a:not(.id-tarea):hover {
	text-decoration: underline;
}

/* --- la ficha como vista de incidencia ----------------------------------- */

/* A partir de 64 rem, la columna principal y un panel de 18 rem fijo al hacer
   scroll. Por debajo, una sola columna con el panel encima de la descripción.
   El ancho se acota aquí: la ficha ocupa todo el ancho para tener sitio, no
   para estirar el hilo hasta el borde de la pantalla. */
.ficha {
	display: grid;
	gap: 0 2.5rem;
	max-width: 78rem;
}

.ficha > .panel {
	order: -1;
}

@media (min-width: 64rem) {
	.ficha {
		grid-template-columns: minmax(0, 1fr) 18rem;
		align-items: start;
	}

	.ficha > .panel {
		order: 0;
		position: sticky;
		top: 1rem;
	}
}

/* En 18 rem no caben las 10 rem del nombre de cada propiedad. */
.panel .propiedad {
	grid-template-columns: 6.5rem 1fr;
}

.panel h2 {
	font-size: 0.95rem;
}

/* --- el ciclo de la tarea ------------------------------------------------ */

/* Los cinco pasos en fila, cada uno con su nombre y su dueño debajo. Es el
   primer bloque de la ficha: dónde está la tarea y qué pasa ahora. */
.ciclo {
	display: flex;
	flex-wrap: wrap;
	gap: 0.35rem;
	max-width: 78rem;
	margin: 0 0 1.8rem;
	padding: 0;
	list-style: none;
}

.ciclo li {
	flex: 1 1 8rem;
	padding: 0.45rem 0.7rem;
	border-radius: var(--radio);
	border: 1px solid var(--borde);
	color: var(--texto-suave);
}

.paso-nombre {
	display: block;
	color: var(--texto);
	font-weight: 600;
}

.paso-dueno, .paso-ahora {
	display: block;
	font-size: 0.8125rem;
}

/* Lo que ya pasó no se borra, pero deja de pedir atención. */
.ciclo .pasado .paso-nombre {
	color: var(--texto-suave);
	font-weight: 400;
	text-decoration: line-through;
}

/* Una pregunta no se ejecuta: su paso En curso está ahí para que se vea que se
   salta, no para leerlo. */
.ciclo .omitido {
	border-style: dashed;
	opacity: 0.5;
}

/* El paso actual, en el color de quien tiene el turno. Es la única vez que el
   color del turno sale fuera de una etiqueta. */
.ciclo .turno {
	background: var(--turno-fondo);
	border-color: var(--turno);
}

.ciclo .turno .paso-nombre, .ciclo .turno .paso-ahora {
	color: var(--turno);
}

.ciclo .agente {
	background: var(--fondo-hover);
	border-color: var(--acento);
}

.ciclo .agente .paso-nombre, .ciclo .agente .paso-ahora {
	color: var(--acento);
}

.ciclo .paso-ahora {
	margin-top: 0.2rem;
	font-weight: 600;
}

/* En estrecho no caben cinco columnas: los pasos van uno debajo de otro. */
@media (max-width: 48rem) {
	.ciclo {
		flex-direction: column;
	}
}

/* Las preguntas abiertas son lo primero de la ficha, antes del panel. */
.preguntas-arriba {
	display: flex;
	flex-direction: column;
	gap: 0.8rem;
	max-width: 78rem;
	margin-bottom: 1.8rem;
}

.responder-arriba {
	margin: 0.7rem 0 0;
	font-size: 0.85rem;
}

/* Los tres filtros del hilo, encima de él y sin caja: son enlaces. */
.filtro-hilo {
	display: flex;
	flex-wrap: wrap;
	gap: 0.9rem;
	margin-bottom: 0.9rem;
	font-size: 0.85rem;
}

.filtro-hilo a {
	color: var(--texto-suave);
	text-decoration: none;
}

.filtro-hilo a:hover {
	color: var(--texto);
}

.filtro-hilo a[aria-current="page"] {
	color: var(--texto);
	font-weight: 600;
}

/* --- bandeja ------------------------------------------------------------- */

/* Qué es el bloque, debajo de su verbo: el verbo dice qué hacer y esta línea,
   con qué. */
.que-es {
	margin: -0.3rem 0 1rem;
	color: var(--texto-suave);
	font-size: 0.85rem;
}

/* Cada asunto: su línea y debajo la tarjeta que toca. Van separados entre sí
   más que dentro, que es lo que deja leer el bloque de un vistazo. */
.asunto {
	margin-bottom: 1.6rem;
}

.linea-bandeja {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.5rem;
	margin: 0 0 0.5rem;
}

.linea-bandeja .titulo {
	font-weight: 600;
}

/* El número de la bandeja, pegado a la derecha de su entrada. */
.enlace-nav {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.5rem;
}

/* --- Informes ------------------------------------------------------------ */

/* Cada pregunta con su tabla: el hueco entre bloques es lo que las separa,
   porque ninguna lleva caja ni borde exterior. */
.informe {
	margin-top: 2rem;
}

.informe h2 {
	margin: 0 0 0.6rem;
	font-size: 1.05rem;
	font-weight: 600;
}

/* El selector de periodo va justo debajo de la explicación, sin pegarse. */
.filtros-rapidos + .informe {
	margin-top: 1.6rem;
}

/* La barra del ritmo manda en su columna: aquí es el gráfico, no un adorno
   al lado de un título. */
.informe .progreso {
	width: 12rem;
	max-width: 60%;
}

.pie-informes {
	margin-top: 2rem;
	font-size: 0.85rem;
}
`;
