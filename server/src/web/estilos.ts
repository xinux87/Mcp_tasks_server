/**
 * La hoja de estilos entera, como constante. No hay archivos estáticos en
 * disco: así el Dockerfile no tiene que copiar nada más que `src/`. La sirve
 * `GET /static/app.css`.
 *
 * El diseño es el de «Diseño visual» en CLAUDE.md: el puesto de mando de quien
 * dirige agentes. Un único color de señal (`--turno`) para lo que espera por el
 * humano, otro (`--acento`) para las acciones, y lo demás neutro. `--acento`
 * es solo relleno: todo texto en color de acento usa `--acento-texto`.
 *
 * El tema tiene tres estados y tres bloques, que redefinen los mismos tokens:
 * `:root` es la paleta clara, `@media (prefers-color-scheme: dark)` acotado a
 * `:root:not([data-tema="claro"])` sigue al sistema, y `:root[data-tema="oscuro"]`
 * manda sobre los dos. Ningún color se define fuera de los tokens y de la tabla
 * de nueve colores.
 */
export const CSS = `:root {
	color-scheme: light;

	/* Los tokens de CLAUDE.md, en tres escalas: superficies, tinta y líneas,
	   más la señal con sus tintes. Nada más define color. En claro el negro es
	   la tinta y los dos vivos se oscurecen donde son texto: el verde chillón
	   sobre papel no llega a 4,5:1. La página es el papel; la barra y las
	   columnas, el lienzo; las tarjetas, blancas encima. */
	--fondo: #fbfbf6;
	--fondo-lateral: #f0f2ea;
	--superficie: #ffffff;
	--hueco: #f4f5ef;
	--campo: #f2f3ec;
	--fondo-hover: rgba(13, 15, 12, 0.05);
	--fondo-hover-2: rgba(13, 15, 12, 0.09);
	--texto: #0d0f0c;
	--texto-suave: #5c6357;
	--texto-terciario: #858b80;
	--borde: #e2e5db;
	--borde-fuerte: #d3d7cc;
	--borde-suave: #ebede5;
	--acento: #39f26f;
	--acento-texto: #0a7d37;
	--acento-tinte: #dcfbe5;
	--sobre-acento: #0d0f0c;
	--turno: #b34800;
	--turno-fondo: #ffe8d6;
	--sobre-turno: #fbfbf6;
	--peligro: #c92626;
	--peligro-tinte: #fde5e3;

	/* Sombras en vez de bordes: un anillo de 1 px del color de línea y, según
	   cuánto se levanta la pieza, una sombra suave en capas. */
	--sombra-filete: 0 0 0 1px var(--borde);
	--sombra-boton: 0 0 0 1px var(--borde-fuerte), 0 1px 2px rgba(13, 15, 12, 0.05);
	--sombra-tarjeta: 0 0 0 1px var(--borde), 0 1px 2px rgba(13, 15, 12, 0.04), 0 4px 12px rgba(13, 15, 12, 0.04);
	--sombra-elevada: 0 0 0 1px var(--borde), 0 2px 4px rgba(13, 15, 12, 0.05), 0 8px 20px rgba(13, 15, 12, 0.07);
	--sombra-flotante: 0 0 0 1px var(--borde), 0 6px 12px rgba(13, 15, 12, 0.06), 0 24px 48px rgba(13, 15, 12, 0.14);

	/* Medidas: chip, control, tarjeta y ventana; 15 rem de barra lateral. */
	--radio-chip: 6px;
	--radio: 8px;
	--radio-tarjeta: 10px;
	--radio-ventana: 14px;
	--lateral: 15rem;
	--ancho-contenido: 64rem;

	/* Movimiento: salida rápida y frenada larga, de 100 a 200 ms. */
	--suave: cubic-bezier(0.23, 1, 0.32, 1);
	--suave-enlace: cubic-bezier(0.16, 1, 0.3, 1);

	--mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}

/* Sin elegir tema se sigue al sistema; con «claro» puesto, no. */
@media (prefers-color-scheme: dark) {
	:root:not([data-tema="claro"]) {
		color-scheme: dark;

		--fondo: #0d0f0c;
		--fondo-lateral: #131611;
		--superficie: #1a1d18;
		--hueco: #151813;
		--campo: #1f231d;
		--fondo-hover: rgba(241, 243, 236, 0.05);
		--fondo-hover-2: rgba(241, 243, 236, 0.09);
		--texto: #f1f3ec;
		--texto-suave: #a9b0a4;
		--texto-terciario: #767d71;
		--borde: #262a24;
		--borde-fuerte: #343a32;
		--borde-suave: #1e221c;
		--acento: #39f26f;
		--acento-texto: #39f26f;
		--acento-tinte: rgba(57, 242, 111, 0.14);
		--sobre-acento: #0d0f0c;
		--turno: #ff7a1a;
		--turno-fondo: rgba(255, 122, 26, 0.16);
		--sobre-turno: #0d0f0c;
		--peligro: #ff5c5c;
		--peligro-tinte: rgba(255, 92, 92, 0.14);

		--sombra-boton: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 1px 2px rgba(0, 0, 0, 0.3);
		--sombra-tarjeta: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 1px 2px rgba(0, 0, 0, 0.25), 0 2px 6px rgba(0, 0, 0, 0.25);
		--sombra-elevada: 0 0 0 1px rgba(255, 255, 255, 0.12), 0 2px 10px rgba(0, 0, 0, 0.35);
		--sombra-flotante: 0 0 0 1px rgba(255, 255, 255, 0.14), 0 8px 28px rgba(0, 0, 0, 0.5);
	}
}

/* Elegido a mano: gana al sistema, esté como esté. */
:root[data-tema="oscuro"] {
	color-scheme: dark;

	--fondo: #0d0f0c;
	--fondo-lateral: #131611;
	--superficie: #1a1d18;
	--hueco: #151813;
	--campo: #1f231d;
	--fondo-hover: rgba(241, 243, 236, 0.05);
	--fondo-hover-2: rgba(241, 243, 236, 0.09);
	--texto: #f1f3ec;
	--texto-suave: #a9b0a4;
	--texto-terciario: #767d71;
	--borde: #262a24;
	--borde-fuerte: #343a32;
	--borde-suave: #1e221c;
	--acento: #39f26f;
	--acento-texto: #39f26f;
	--acento-tinte: rgba(57, 242, 111, 0.14);
	--sobre-acento: #0d0f0c;
	--turno: #ff7a1a;
	--turno-fondo: rgba(255, 122, 26, 0.16);
	--sobre-turno: #0d0f0c;
	--peligro: #ff5c5c;
	--peligro-tinte: rgba(255, 92, 92, 0.14);

	--sombra-boton: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 1px 2px rgba(0, 0, 0, 0.3);
	--sombra-tarjeta: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 1px 2px rgba(0, 0, 0, 0.25), 0 2px 6px rgba(0, 0, 0, 0.25);
	--sombra-elevada: 0 0 0 1px rgba(255, 255, 255, 0.12), 0 2px 10px rgba(0, 0, 0, 0.35);
	--sombra-flotante: 0 0 0 1px rgba(255, 255, 255, 0.14), 0 8px 28px rgba(0, 0, 0, 0.5);
}

/* --- base ---------------------------------------------------------------- */

* {
	box-sizing: border-box;
}

body {
	margin: 0;
	background: var(--fondo);
	color: var(--texto);
	/* Inter solo si está instalada: no se sirve ninguna fuente. */
	font-family: "Inter", -apple-system, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
	font-size: 14px;
	line-height: 1.5;
	letter-spacing: -0.01em;
	font-feature-settings: "cv11", "ss01";
	-webkit-font-smoothing: antialiased;
}

a {
	color: var(--acento-texto);
	text-underline-offset: 0.15em;
	transition: color 120ms var(--suave-enlace);
}

h1, h2, h3 {
	line-height: 1.25;
	margin: 0 0 0.6rem;
	font-weight: 600;
}

/* El título de página, suelto o dentro de «cabeceraPagina», es el mismo. */
h1 {
	font-size: 1.375rem;
	letter-spacing: -0.02em;
}

h2 {
	font-size: 1rem;
	margin-top: 1.8rem;
}

h3 {
	font-size: 0.875rem;
}

/* Las instrucciones de un agente son el texto que lee un modelo: se escriben
   en la misma tipografía en la que se leerán. */
code, pre, textarea.codigo {
	font-family: var(--mono);
	font-size: 0.88em;
	letter-spacing: 0;
}

pre {
	background: var(--hueco);
	box-shadow: var(--sombra-filete);
	border-radius: var(--radio-tarjeta);
	padding: 0.7rem 0.9rem;
	overflow-x: auto;
}

/* Las cifras se alinean por columnas en todo lo que se compara de un vistazo. */
.edad, .tokens, .uso-cifra, .hora, .numero, .progreso-texto, .contador, .id-tarea {
	font-variant-numeric: tabular-nums;
}

/* Ids y contadores, en la monoespaciada: se leen carácter a carácter. */
.id-tarea, .contador {
	font-family: var(--mono);
	font-size: 0.92em;
	letter-spacing: 0;
}

a.id-tarea {
	text-decoration: none;
}

a.id-tarea:hover {
	text-decoration: underline;
}

::placeholder {
	color: var(--texto-terciario);
	opacity: 1;
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
	font-size: 0.8125rem;
	border-right: 1px solid var(--borde);
	overflow-y: auto;
	z-index: 20;
}

.lateral .marca {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.25rem 0.5rem 1rem;
	color: var(--texto);
	font-size: 0.875rem;
	font-weight: 700;
	text-decoration: none;
}

/* El icono se incrusta en línea, así que su tamaño lo pone la hoja: 20 px
   junto al nombre, y 40 px sobre él en la tarjeta de entrada. */
.marca svg {
	flex: none;
	width: 20px;
	height: 20px;
}

/* El selector de proyecto y la búsqueda, debajo del nombre: ocupan el ancho de
   la barra y sus botones solo se ven sin JavaScript, que es quien los esconde. */
.selector-proyecto,
.buscador {
	display: flex;
	align-items: center;
	gap: 0.3rem;
}

.selector-proyecto {
	margin: 0 0 0.4rem;
}

.buscador {
	margin: 0 0 1.1rem;
}

.buscador input {
	flex: 1;
	min-width: 0;
}

/* El selector de proyecto es el control del espacio de trabajo: el «select»
   nativo, sin su aspecto, con el nombre en negrita y un chevron pintado por el
   contenedor. Al pasar por encima se le ve el filete de un control. */
.espacio {
	position: relative;
	flex: 1;
	min-width: 0;
}

.espacio::after {
	content: "";
	position: absolute;
	top: 50%;
	right: 0.75rem;
	width: 6px;
	height: 6px;
	border-right: 1.5px solid var(--texto-suave);
	border-bottom: 1.5px solid var(--texto-suave);
	transform: translateY(-70%) rotate(45deg);
	pointer-events: none;
}

.espacio select {
	appearance: none;
	max-width: none;
	padding: 0 1.8rem 0 0.5rem;
	background: none;
	box-shadow: none;
	color: var(--texto);
	font-size: 0.875rem;
	font-weight: 600;
	text-overflow: ellipsis;
	cursor: pointer;
}

.espacio select:hover {
	background: var(--fondo-hover);
	box-shadow: var(--sombra-filete);
}

/* El color del proyecto elegido, delante de su nombre: el icono del espacio. */
.espacio .punto {
	position: absolute;
	top: 50%;
	left: 0.55rem;
	margin-top: -4px;
	pointer-events: none;
}

.espacio:has(.punto) select {
	padding-left: 1.4rem;
}

.bloque {
	margin-bottom: 1.1rem;
}

/* El título de un bloque de navegación: pequeño y suave, nunca en mayúsculas. */
.bloque h2 {
	margin: 0 0 0.2rem;
	padding: 0 0.5rem;
	color: var(--texto-suave);
	font-size: 0.75rem;
	font-weight: 500;
}

/* Una fila de 32 px por entrada, con el número de la bandeja a la derecha. */
.enlace-nav {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
	height: 32px;
	padding: 0 0.6rem;
	border-radius: var(--radio);
	color: var(--texto);
	font-weight: 500;
	text-decoration: none;
	transition: background-color 120ms var(--suave);
}

.enlace-nav:hover {
	background: var(--fondo-hover);
}

/* La entrada activa: un punto más de fondo que al pasar por encima, y en negrita. */
.enlace-nav[aria-current="page"] {
	background: var(--fondo-hover-2);
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

/* Tres radios como un grupo de píldoras: el rótulo encima y, debajo, el grupo
   sobre un fondo hundido que pinta «::before» detrás de los tres. Lo marcado
   sale hacia fuera, y el foco se ve aunque el radio esté escondido. */
fieldset.tema {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 2px;
	margin: auto 0 0.6rem;
	padding: 0;
	border: 0;
	box-shadow: none;
}

fieldset.tema::before {
	content: "";
	grid-row: 2;
	grid-column: 1 / -1;
	margin: -2px;
	border-radius: var(--radio);
	background: var(--fondo-hover);
}

fieldset.tema legend {
	float: left;
	grid-row: 1;
	grid-column: 1 / -1;
	margin: 0 0 0.3rem;
	padding: 0 0.5rem;
	color: var(--texto-suave);
	font-size: 0.75rem;
	font-weight: 500;
}

fieldset.tema label {
	position: relative;
	grid-row: 2;
	display: flex;
	align-items: center;
	justify-content: center;
	height: 26px;
	margin: 0;
	border-radius: var(--radio-chip);
	color: var(--texto-suave);
	font-size: 0.78125rem;
	font-weight: 500;
	cursor: pointer;
	transition: background-color 120ms var(--suave), color 120ms var(--suave);
}

fieldset.tema label:nth-of-type(1) { grid-column: 1; }
fieldset.tema label:nth-of-type(2) { grid-column: 2; }
fieldset.tema label:nth-of-type(3) { grid-column: 3; }

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
	background: var(--superficie);
	box-shadow: var(--sombra-boton);
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

.marca-entrada svg {
	display: block;
	width: 40px;
	height: 40px;
	margin: 0 0 0.6rem;
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
	font-size: 0.78125rem;
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
	color: var(--texto-terciario);
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
	font-size: 0.8125rem;
}

/* El hueco entre etiquetas lo pone el contenedor; la regla del final de la
   hoja quita el margen propio de «.insignia» aquí para no sumar los dos. */
.etiquetas {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.3rem 0.25rem;
	margin-top: 0.6rem;
}

/* --- etiquetas y chips --------------------------------------------------- */

/* Sin clase de color, la etiqueta es gris: es el color de lo que no tiene. El
   margen separa dos etiquetas seguidas donde no hay un contenedor con hueco. */
.insignia {
	display: inline-flex;
	align-items: center;
	height: 22px;
	margin-right: 0.25rem;
	padding: 0 0.45rem;
	border-radius: var(--radio-chip);
	background: var(--fondo-hover);
	color: var(--texto-suave);
	font-size: 0.71875rem;
	font-weight: 500;
	line-height: 1;
	letter-spacing: 0;
	white-space: nowrap;
	vertical-align: middle;
}

.chip {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	height: 22px;
	padding: 0 0.5rem 0 3px;
	border-radius: 999px;
	background: var(--fondo-hover);
	color: var(--texto-suave);
	font-size: 0.75rem;
	font-weight: 500;
	line-height: 1;
	white-space: nowrap;
	vertical-align: middle;
}

/* El círculo de la inicial se tiñe del propio texto del chip: así funciona
   con los nueve colores y en los dos modos sin repetir ninguna paleta. */
.chip .inicial {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 16px;
	height: 16px;
	border-radius: 50%;
	background: color-mix(in srgb, currentColor 22%, transparent);
	font-size: 0.625rem;
	font-weight: 700;
	line-height: 1;
}

.chip .terminal {
	color: var(--texto-suave);
}

/* Los nueve colores, reteñidos para el mundo negro. Van después de «.insignia»
   y «.chip»
   porque tienen la misma especificidad y aquí manda el último que gana. */

.color-gris { background: #e6e8e0; color: #0d0f0c; }
.color-marron { background: #eee0d2; color: #4a2c14; }
.color-naranja { background: #ffe0c2; color: #5a2600; }
.color-amarillo { background: #fff3b8; color: #4a3d00; }
.color-verde { background: #b6f5c9; color: #0a4a22; }
.color-azul { background: #d3ecf5; color: #123c4a; }
.color-morado { background: #e6dcf7; color: #3a1f66; }
.color-rosa { background: #f9dcea; color: #5a1a3f; }
.color-rojo { background: #ffd6d6; color: #6a1010; }

/* Los nueve en oscuro, dos veces: siguiendo al sistema y elegido a mano. Las
   dos listas son la misma, y el selector de raíz las hace ganar a las de
   arriba sin depender del orden de la hoja. */
@media (prefers-color-scheme: dark) {
	:root:not([data-tema="claro"]) .color-gris { background: #2a2f28; color: #f1f3ec; }
	:root:not([data-tema="claro"]) .color-marron { background: #3a2a1e; color: #e0b48a; }
	:root:not([data-tema="claro"]) .color-naranja { background: #3d2a08; color: #ffb366; }
	:root:not([data-tema="claro"]) .color-amarillo { background: #3a3308; color: #ffe066; }
	:root:not([data-tema="claro"]) .color-verde { background: #0b4a24; color: #39f26f; }
	:root:not([data-tema="claro"]) .color-azul { background: #1d3a45; color: #8fd9ff; }
	:root:not([data-tema="claro"]) .color-morado { background: #33224a; color: #c9a6ff; }
	:root:not([data-tema="claro"]) .color-rosa { background: #4a1f38; color: #ff9ad1; }
	:root:not([data-tema="claro"]) .color-rojo { background: #4a1414; color: #ff8a8a; }
}

:root[data-tema="oscuro"] .color-gris { background: #2a2f28; color: #f1f3ec; }
:root[data-tema="oscuro"] .color-marron { background: #3a2a1e; color: #e0b48a; }
:root[data-tema="oscuro"] .color-naranja { background: #3d2a08; color: #ffb366; }
:root[data-tema="oscuro"] .color-amarillo { background: #3a3308; color: #ffe066; }
:root[data-tema="oscuro"] .color-verde { background: #0b4a24; color: #39f26f; }
:root[data-tema="oscuro"] .color-azul { background: #1d3a45; color: #8fd9ff; }
:root[data-tema="oscuro"] .color-morado { background: #33224a; color: #c9a6ff; }
:root[data-tema="oscuro"] .color-rosa { background: #4a1f38; color: #ff9ad1; }
:root[data-tema="oscuro"] .color-rojo { background: #4a1414; color: #ff8a8a; }

/* La señal: lo que espera por el humano, con el verbo de lo que le toca. Va
   después de los nueve colores porque no es uno de ellos, es el único color de
   turno, y va en macizo: es lo que hay que ver antes que nada. */
.insignia.turno {
	background: var(--turno);
	color: var(--sobre-turno);
	font-weight: 600;
}

/* --- avisos, cajas y texto secundario ------------------------------------ */

.aviso {
	margin: 0 0 1.4rem;
	padding: 0.6rem 0.8rem;
	border-radius: var(--radio);
	border-left: 3px solid var(--peligro);
	background: var(--peligro-tinte);
	color: var(--texto);
}

.caja {
	margin: 0 0 1.4rem;
	padding: 1rem 1.1rem;
	border-radius: var(--radio-tarjeta);
	background: var(--superficie);
	box-shadow: var(--sombra-tarjeta);
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
	font-size: 0.78125rem;
	white-space: nowrap;
}

/* Pegada a una etiqueta y delante del título, en la lista: que no se toquen. */
.insignia + .edad {
	margin-right: 0.35rem;
}

.edad-peligro {
	color: var(--peligro);
}

.pequeno {
	font-size: 0.8125rem;
}

.en-linea {
	display: inline;
	margin: 0;
}

/* Cuántas cosas hay. En una columna es un dato más y va en texto suave. */
.contador {
	color: var(--texto-suave);
	font-size: 0.78125rem;
	font-weight: 400;
}

/* De quién es el turno mientras la tarea está en esa columna. Va en su propia
   línea, debajo del rótulo: se lee si se busca, no compite con el nombre. */
.dueno-columna {
	margin: -0.4rem 0 0.6rem;
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

/* Un identificador no se parte; su tipografía va con las cifras, arriba. */
.id-tarea {
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
	font-size: 0.8125rem;
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

/* Filas de 40 px separadas por la línea suave; la cabecera, pequeña y suave
   sobre la línea normal. */
th, td {
	height: 40px;
	text-align: left;
	padding: 0.4rem 0.6rem;
	border-bottom: 1px solid var(--borde-suave);
	vertical-align: middle;
	transition: background-color 120ms var(--suave);
}

thead th {
	height: 32px;
	border-bottom-color: var(--borde);
	color: var(--texto-suave);
	font-size: 0.75rem;
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

/* Un grupo de campos es una caja plana: el filete y nada más. El rótulo va
   dentro, flotado, para que el filete no tenga que partirse a su paso. */
fieldset {
	margin: 0 0 1rem;
	padding: 0.8rem 1rem 0.3rem;
	border: 0;
	border-radius: var(--radio-tarjeta);
	box-shadow: var(--sombra-filete);
}

legend {
	float: left;
	width: 100%;
	margin: 0 0 0.7rem;
	padding: 0;
	color: var(--texto-suave);
	font-size: 0.8125rem;
	font-weight: 500;
}

legend + * {
	clear: both;
}

label {
	display: block;
	margin: 0 0 0.9rem;
}

label > span {
	display: block;
	margin-bottom: 0.3rem;
	color: var(--texto-suave);
	font-size: 0.8125rem;
	font-weight: 500;
}

/* La ayuda de un campo va debajo de su control, no encima como el rótulo. */
label > span.ayuda {
	margin: 0.3rem 0 0;
	font-size: 0.75rem;
	font-weight: 400;
}

/* Un desplegable de varias opciones se lee como una lista: sitio a los lados
   de cada opción y el alto que pida el atributo «size». */
select[multiple] {
	height: auto;
	padding: 0.3rem;
}

/* Los controles no llevan borde: el fondo del campo y su filete. Miden 32 px
   salvo el texto largo, que pide el alto que haga falta. */
input[type="text"], input[type="search"], input[type="password"], input[type="number"], textarea, select {
	width: 100%;
	max-width: 34rem;
	height: 32px;
	padding: 0 0.65rem;
	font: inherit;
	font-size: 0.8125rem;
	color: var(--texto);
	background: var(--campo);
	border: 0;
	border-radius: var(--radio);
	box-shadow: var(--sombra-filete);
	transition: box-shadow 120ms var(--suave);
}

input[type="text"]:hover, input[type="search"]:hover, input[type="password"]:hover, input[type="number"]:hover, textarea:hover, select:hover {
	box-shadow: 0 0 0 1px var(--borde-fuerte);
}

/* Un número de una o dos cifras no necesita el ancho de un campo de texto. */
input[type="number"] {
	max-width: 6rem;
}

input[type="text"]:focus, input[type="search"]:focus, input[type="password"]:focus, input[type="number"]:focus, textarea:focus, select:focus {
	outline: 2px solid var(--acento);
	outline-offset: 0;
}

textarea {
	height: auto;
	min-height: 6rem;
	padding: 0.5rem 0.65rem;
	line-height: 1.5;
	resize: vertical;
}

input[type="checkbox"], input[type="radio"] {
	margin-right: 0.4rem;
	accent-color: var(--acento);
}

/* Las opciones de una pregunta son las filas de una sola tarjeta, separadas
   por la línea suave; la elegida se tiñe del acento. */
.opciones {
	margin: 0 0 1rem;
	border-radius: var(--radio-tarjeta);
	background: var(--superficie);
	box-shadow: var(--sombra-filete);
	overflow: hidden;
}

label.opcion {
	margin: 0;
	padding: 0.65rem 0.9rem;
	cursor: pointer;
	transition: background-color 120ms var(--suave);
}

label.opcion + label.opcion {
	border-top: 1px solid var(--borde-suave);
}

label.opcion:hover {
	background: var(--fondo-hover);
}

label.opcion:has(:checked) {
	background: var(--acento-tinte);
}

label.opcion .consecuencia {
	display: block;
	margin: 0.2rem 0 0 1.4rem;
	color: var(--texto-suave);
	font-size: 0.8125rem;
}

/* La recomendada, como píldora teñida del acento detrás del texto. */
.recomendada {
	display: inline-flex;
	align-items: center;
	height: 20px;
	margin-left: 0.5rem;
	padding: 0 0.45rem;
	border-radius: var(--radio-chip);
	background: var(--acento-tinte);
	color: var(--acento-texto);
	font-size: 0.71875rem;
	font-weight: 500;
	white-space: nowrap;
	vertical-align: middle;
}

/* Botones de 32 px: el secundario es una pieza de la superficie con su sombra
   de botón; el hover se pinta encima con el fondo de hover. */
button, .boton {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0.4rem;
	height: 32px;
	padding: 0 0.8rem;
	font: inherit;
	font-size: 0.8125rem;
	font-weight: 500;
	color: var(--texto);
	background-color: var(--superficie);
	border: 0;
	border-radius: var(--radio);
	box-shadow: var(--sombra-boton);
	text-decoration: none;
	white-space: nowrap;
	cursor: pointer;
	transition: background-color 120ms var(--suave), box-shadow 120ms var(--suave), filter 120ms var(--suave);
}

button:hover, .boton:hover {
	background-image: linear-gradient(var(--fondo-hover), var(--fondo-hover));
}

button.principal, .boton.principal {
	background-color: var(--acento);
	color: var(--sobre-acento);
	font-weight: 600;
}

button.principal:hover, .boton.principal:hover {
	background-image: none;
	filter: brightness(0.94);
}

button.peligro, .boton.peligro {
	color: var(--peligro);
	background: none;
	box-shadow: none;
}

button.peligro:hover, .boton.peligro:hover {
	background: var(--peligro-tinte);
}

button.enlace {
	height: auto;
	padding: 0;
	color: var(--texto-suave);
	background: none;
	box-shadow: none;
	font-size: 0.8125rem;
	font-weight: 400;
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
	background: none;
	box-shadow: none;
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

/* El hilo se lee como una conversación, sin cajas: cada mensaje se separa del
   anterior con una regla fina y nada más. */
.comentario {
	padding: 0.8rem 0 0;
	border-top: 1px solid var(--borde-suave);
}

.comentario > header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.35rem 0.5rem;
	margin-bottom: 0.4rem;
	color: var(--texto-suave);
	font-size: 0.8125rem;
}

/* La fecha cierra la cabecera por la derecha. */
.comentario > header .fecha {
	margin-left: auto;
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

/* El token y su enlace son una línea larguísima: se parte en vez de
   desplazarse, para verla entera, y se selecciona de una pasada. */
.bloque-codigo.token code {
	font-size: 1.05rem;
	white-space: pre-wrap;
	word-break: break-all;
	user-select: all;
}

.uso {
	margin: 0;
	padding: 0;
	list-style: none;
	font-size: 0.8125rem;
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

/* Un bloque copiable: el botón del bloque flota sobre la esquina del código,
   que le deja sitio con su propio relleno, y cada línea lleva el suyo pegado a
   la derecha. Los bloques salen aquí, en el hilo y en la página del token. */
.bloque-codigo {
	position: relative;
	margin: 0.8rem 0;
}

.bloque-codigo pre {
	margin: 0;
	padding-right: 5.5rem;
}

.bloque-codigo > .copiar {
	position: absolute;
	top: 0.45rem;
	right: 0.45rem;
}

/* Cada línea es una fila: el código estirado a la izquierda, que es lo que
   empuja el botón al borde derecho. */
.bloque-codigo .linea {
	display: flex;
	align-items: flex-start;
	gap: 0.6rem;
}

.bloque-codigo .linea code {
	flex: 1;
}

.copiar-linea {
	flex: none;
	position: sticky;
	right: 0;
	padding: 0 0.2rem;
	min-width: 1.4rem;
	height: auto;
	border: 0;
	border-radius: var(--radio-chip);
	background: var(--hueco);
	box-shadow: none;
	color: var(--texto-suave);
	font-size: 0.95em;
	line-height: inherit;
	cursor: pointer;
}

.copiar-linea:hover {
	color: var(--acento-texto);
}

/* Sin portapapeles no hay nada que copiar con un botón: se esconden todos, los
   de ahora y los que lleguen con un fragmento recargado. */
.sin-portapapeles .copiar {
	display: none;
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

/* Cada columna es un hueco del lienzo: las tarjetas blancas se levantan sobre
   él con su sombra. */
.columna {
	min-width: 0;
	padding: 0.6rem;
	border-radius: var(--radio-tarjeta);
	background: var(--fondo-lateral);
}

.columna h2 {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.4rem;
	margin: 0 0 0.6rem;
	padding: 0 0.15rem;
	font-size: 0.8125rem;
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
	gap: 0.5rem;
	min-height: 3rem;
}

.tarjeta {
	padding: 0.55rem 0.65rem;
	background: var(--superficie);
	border-radius: var(--radio-tarjeta);
	box-shadow: var(--sombra-tarjeta);
	font-size: 0.8125rem;
	cursor: grab;
	transition: box-shadow 150ms var(--suave);
}

.tarjeta:hover {
	box-shadow: var(--sombra-elevada);
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

/* La última línea: quién la trabaja a la izquierda y los tokens al otro
   extremo, que es la cifra que dice si la tarea se ha ido de madre. */
.tarjeta .pie {
	display: flex;
	align-items: center;
	gap: 0.4rem;
}

/* Los agentes de la tarjeta: un círculo por fase con la inicial de su modelo.
   El nombre entero y su terminal van en el título y en la ficha; aquí lo que
   hace falta es ver de un vistazo si hay alguien puesto. */
.agentes {
	display: inline-flex;
	gap: 0.2rem;
}

.agentes .agente {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 20px;
	height: 20px;
	border-radius: 50%;
	background: var(--fondo-hover-2);
	color: var(--texto);
	font-size: 0.6875rem;
	font-weight: 600;
}

/* Una fase sin modelo es un círculo hueco: se ve el sitio vacío. */
.agentes .agente.vacio {
	background: none;
	border: 1px dashed var(--borde-fuerte);
	color: var(--texto-suave);
	font-weight: 400;
}

.tarjeta .pie .tokens {
	margin-left: auto;
	color: var(--texto-suave);
	font-size: 0.75rem;
	white-space: nowrap;
}

/* La misma señal que la etiqueta, pero visible de lejos: de un vistazo se ve
   cuáles de todo el tablero esperan por el humano. Es un filete por dentro,
   delante de la sombra de la tarjeta. */
.tarjeta.espera {
	box-shadow: inset 3px 0 0 var(--turno), var(--sombra-tarjeta);
}

.tarjeta.espera:hover {
	box-shadow: inset 3px 0 0 var(--turno), var(--sombra-elevada);
}

/* El hueco que SortableJS deja donde caería la tarjeta. */
.tarjeta.arrastrando {
	outline: 1px dashed var(--borde-fuerte);
	opacity: 0.45;
	box-shadow: none;
}

/* La tarjeta que va con el puntero: la única que flota. */
.tarjeta.sortable-chosen, .tarjeta.sortable-drag {
	box-shadow: var(--sombra-flotante);
}

.aviso-tablero {
	margin-bottom: 0.9rem;
}

/* Aviso de la ficha mientras la recarga espera a que se envíe lo escrito. */
.aviso-recarga {
	position: fixed;
	top: 0;
	left: 50%;
	transform: translateX(-50%);
	padding: 0.5rem 0.9rem;
	background: var(--superficie);
	border-radius: 0 0 var(--radio-tarjeta) var(--radio-tarjeta);
	box-shadow: 0 0 0 1px var(--acento), var(--sombra-flotante);
	z-index: 30;
}

/* Carriles por funcionalidad */

/* Agrupados, el tablero y la lista son una franja por funcionalidad más
   «Sueltas»: la misma cabecera de ancho completo y, debajo, las columnas de
   siempre en el tablero y la tabla de sus partes en la lista. */
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
	font-size: 0.9375rem;
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
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--texto);
		font-weight: 700;
		text-decoration: none;
	}

	.lateral {
		width: min(15rem, 82vw);
		transform: translateX(-100%);
		transition: transform 200ms var(--suave);
		box-shadow: var(--sombra-flotante);
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
	font-size: 0.8125rem;
	font-weight: 500;
}

/* El pequeño es para lo que va dentro de otra pieza: «Copiar» sobre el
   código, «Ir» y «Buscar» junto a su campo cuando no hay JavaScript. */
button.pequeno, .boton.pequeno {
	height: 28px;
	padding: 0 0.6rem;
	font-size: 0.78125rem;
}

/* La acción de una fila de terminales es un enlace discreto y no un botón: con
   diez columnas, el relleno de un botón por fila es justo el ancho que hace
   que la última columna no quepa. La confirmación que abre sí lleva botón. */
.accion-fila {
	color: var(--peligro);
	font-size: 0.8125rem;
	text-decoration: none;
	white-space: nowrap;
}

.accion-fila:hover {
	text-decoration: underline;
}

/* Rotar un token no destruye nada: no lleva el rojo de revocar. */
.accion-fila.neutra {
	color: var(--acento-texto);
}

/* Las dos acciones de la fila de un terminal, una debajo de otra si no caben:
   la última columna es estrecha y «Rotar token» no puede partirse. */
.acciones-terminal {
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
	white-space: nowrap;
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
	border: 1px dashed var(--borde-fuerte);
	border-radius: 999px;
	color: var(--texto-suave);
	font-size: 0.75rem;
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
	padding-left: 0.3rem;
	padding-right: 0.3rem;
}

/* Los agentes en paralelo se cambian en la propia fila: el número es de una
   cifra, así que el campo ocupa lo justo y el botón va a su lado. */
.cambio-agentes {
	display: flex;
	flex-wrap: nowrap;
	align-items: center;
	gap: 0.3rem;
	margin: 0;
}

.cambio-agentes input {
	width: 3.5rem;
}

.celda-cuenta {
	min-width: 6.5rem;
	overflow-wrap: anywhere;
}

.celda-uso {
	min-width: 9.5rem;
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
	font-size: 0.75rem;
}

/* --- usuarios ------------------------------------------------------------ */

.tabla-usuarios {
	min-width: 34rem;
}

/* --- actividad ----------------------------------------------------------- */

.dia h2 {
	margin: 1.6rem 0 0.2rem;
	color: var(--texto-suave);
	font-size: 0.75rem;
	font-weight: 500;
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
	border-bottom: 1px solid var(--borde-suave);
}

.acto:last-child {
	border-bottom: none;
}

.acto .frase {
	color: var(--texto-suave);
}

.acto .detalle {
	font-size: 0.8125rem;
}

/* La hora se va al extremo: la columna que se lee de un vistazo. */
.acto .hora {
	margin-left: auto;
	padding-left: 0.6rem;
	color: var(--texto-suave);
	font-size: 0.78125rem;
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

/* Los conmutadores —Lista | Tablero, filtros rápidos, pestañas del proyecto y
   filtros del hilo— son un grupo de píldoras de 28 px sobre un fondo hundido.
   La puesta sale hacia fuera: superficie y sombra de botón. */
.vistas, .filtros-rapidos, .filtro-hilo {
	display: inline-flex;
	flex-wrap: wrap;
	gap: 2px;
	padding: 2px;
	border-radius: var(--radio);
	background: var(--fondo-hover);
}

.vistas a, .boton-filtro, .filtro-hilo a {
	display: inline-flex;
	align-items: center;
	height: 28px;
	padding: 0 0.7rem;
	border-radius: var(--radio-chip);
	color: var(--texto-suave);
	font-size: 0.8125rem;
	font-weight: 500;
	text-decoration: none;
	white-space: nowrap;
	transition: background-color 120ms var(--suave), color 120ms var(--suave);
}

.vistas a:hover, .boton-filtro:hover, .filtro-hilo a:hover {
	background: var(--fondo-hover);
	color: var(--texto);
}

/* El puesto: pulsarlo otra vez lo quita en los filtros rápidos. */
.vistas a[aria-current="page"], .boton-filtro[aria-current="true"], .filtro-hilo a[aria-current="page"] {
	background: var(--superficie);
	box-shadow: var(--sombra-boton);
	color: var(--texto);
	font-weight: 600;
}

/* Suelto, fuera de un grupo («Por columnas»), es un botón secundario. */
:not(.filtros-rapidos) > .boton-filtro {
	height: 32px;
	background: var(--superficie);
	box-shadow: var(--sombra-boton);
	color: var(--texto);
}

:not(.filtros-rapidos) > .boton-filtro:hover {
	background-image: linear-gradient(var(--fondo-hover), var(--fondo-hover));
}

.filtros .quitar {
	padding-bottom: 0.45rem;
	color: var(--texto-suave);
	font-size: 0.8125rem;
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

/* El grupo de las cerradas se pliega; el triángulo no debe empujar el rótulo. */
.grupo summary {
	cursor: pointer;
	font-size: 1rem;
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

label.opcion .que {
	font-weight: 500;
}

label.casilla .detalle, label.opcion .consecuencia {
	grid-column: 2;
	margin: 0.1rem 0 0;
	color: var(--texto-suave);
	font-size: 0.8125rem;
	font-weight: 400;
}

/* Va dentro del texto de la opción, no debajo. */
label.opcion .recomendada {
	display: inline-flex;
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
	border-bottom: 1px solid var(--borde-suave);
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
	font-size: 0.78125rem;
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

/* «Añadir subtarea»: una sola línea, el título y el botón al lado. */
.anadir-subtarea {
	display: flex;
	gap: 0.5rem;
	margin: 0 0 1.4rem;
}

.anadir-subtarea input {
	flex: 1;
	min-width: 0;
}

/* El orden de ejecución: una fila por ola, con su rótulo delante y las
   partes que pueden ir a la vez como tarjetas mínimas una al lado de otra. */
.olas {
	margin: 0 0 1.4rem;
	padding: 0;
	list-style: none;
}

.olas > li {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-start;
	gap: 0.5rem 1rem;
	padding: 0.6rem 0;
	border-bottom: 1px solid var(--borde-suave);
}

.olas > li:last-child {
	border-bottom: none;
}

.rotulo-ola {
	flex: 0 0 4rem;
	padding-top: 0.7rem;
	color: var(--texto-suave);
	font-size: 0.8125rem;
	font-variant-numeric: tabular-nums;
}

.olas .filas {
	flex: 1;
	min-width: 0;
	margin: 0;
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

/* Lo ancho de dentro (el tablero de las partes) se desplaza en su envoltorio:
   la columna no crece por él ni se sale del contenido. */
.ficha > .principal {
	min-width: 0;
}

@media (min-width: 64rem) {
	.ficha {
		grid-template-columns: minmax(0, 1fr) 20rem;
		align-items: start;
	}

	.ficha > .panel {
		order: 0;
		position: sticky;
		top: 1rem;
	}
}

/* El panel de la ficha es una tarjeta: lo que se consulta, levantado sobre la
   página. Lo plegado de dentro es una caja plana, no otra tarjeta. */
.ficha > .panel {
	margin-bottom: 1.8rem;
	padding: 1rem 1.1rem;
	border-radius: var(--radio-tarjeta);
	background: var(--superficie);
	box-shadow: var(--sombra-tarjeta);
}

.panel > :first-child {
	margin-top: 0;
}

.panel > :last-child {
	margin-bottom: 0;
}

.panel .caja {
	padding: 0.7rem 0.9rem;
	background: none;
	box-shadow: var(--sombra-filete);
}

/* En el panel no caben las 10 rem del nombre de cada propiedad. */
.panel .propiedad {
	grid-template-columns: 6.5rem 1fr;
}

/* El consumo del panel, en chips: una fila por fase (modelo, tokens,
   herramientas y duración) y debajo el total con hijas, con su barra cuando
   hay presupuesto. */
.consumo {
	display: flex;
	flex-direction: column;
	gap: 0.6rem;
	margin: 0 0 1.4rem;
}

.consumo-fase {
	display: grid;
	gap: 0.3rem;
}

.consumo-nombre {
	color: var(--texto-suave);
	font-size: 0.78125rem;
}

.chips-consumo {
	display: flex;
	flex-wrap: wrap;
	gap: 0.3rem;
}

.chip-consumo {
	padding: 0 0.5rem;
	font-variant-numeric: tabular-nums;
}

.consumo-total {
	display: flex;
	font-variant-numeric: tabular-nums;
	flex-wrap: wrap;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.3rem 0.6rem;
	margin: 0;
	padding-top: 0.6rem;
	border-top: 1px solid var(--borde-suave);
}

.consumo-barra {
	width: 100%;
}

.panel h2 {
	font-size: 0.875rem;
}

/* --- el ciclo de la tarea ------------------------------------------------ */

/* Los cinco pasos como una línea de puntos unidos por un filete, con el nombre
   de cada columna debajo. Es el primer bloque de la ficha: dónde está la tarea
   y qué pasa ahora. No son cinco cajas: una caja por paso pesaba más que el
   dato. */
.ciclo {
	position: relative;
	display: flex;
	max-width: 78rem;
	margin: 0 0 1.8rem;
	padding: 0;
	list-style: none;
}

/* El filete va del primer punto al último, no de borde a borde: con cinco
   pasos iguales, sus centros caen en el 10% y en el 90%. */
.ciclo::before {
	content: "";
	position: absolute;
	top: 7px;
	left: 10%;
	right: 10%;
	border-top: 1px solid var(--borde);
}

.ciclo li {
	position: relative;
	flex: 1 1 0;
	min-width: 0;
	text-align: center;
	color: var(--texto-suave);
}

/* El punto de cada paso, por encima del filete que los une. */
.ciclo .punto {
	position: relative;
	display: block;
	width: 16px;
	height: 16px;
	margin: 0 auto 0.4rem;
	border: 1px solid var(--borde-fuerte);
	border-radius: 50%;
	background: var(--fondo);
	box-shadow: none;
}

.paso-nombre {
	display: block;
	color: var(--texto);
	font-weight: 600;
	font-size: 0.8125rem;
}

/* Lo que ya pasó no se borra, pero deja de pedir atención. */
.ciclo .pasado .punto {
	background: var(--texto-suave);
	border-color: var(--texto-suave);
}

.ciclo .pasado .paso-nombre {
	color: var(--texto-suave);
	font-weight: 400;
}

/* Una pregunta no se ejecuta: su paso En curso está ahí para que se vea que se
   salta, no para leerlo. */
.ciclo .omitido {
	opacity: 0.5;
}

.ciclo .omitido .punto {
	border-style: dashed;
}

/* El paso actual, en el color de quien tiene el turno, con un halo que lo
   separa del resto de la línea. Es la única vez que el color del turno sale
   fuera de una etiqueta. */
.ciclo .turno .punto {
	background: var(--turno);
	border-color: var(--turno);
	box-shadow: 0 0 0 4px var(--turno-fondo);
}

.ciclo .turno .paso-nombre {
	color: var(--turno);
}

.ciclo .agente .punto {
	background: var(--acento);
	border-color: var(--acento);
	box-shadow: 0 0 0 4px var(--fondo-hover);
}

.ciclo .agente .paso-nombre {
	color: var(--acento-texto);
}

/* Qué pasa ahora, como píldora debajo del nombre del paso actual. */
.paso-ahora {
	display: inline-block;
	margin-top: 0.3rem;
	padding: 0.05rem 0.5rem;
	border-radius: 999px;
	background: var(--turno-fondo);
	color: var(--turno);
	font-size: 0.75rem;
	font-weight: 600;
}

.ciclo .agente .paso-ahora {
	background: var(--fondo-hover);
	color: var(--acento-texto);
}

/* En estrecho no caben cinco columnas: los pasos van uno debajo de otro, y
   entonces el filete que los unía en fila no une nada. */
@media (max-width: 48rem) {
	.ciclo {
		flex-direction: column;
		gap: 0.5rem;
	}

	.ciclo::before {
		display: none;
	}

	.ciclo li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		text-align: left;
	}

	.ciclo .punto {
		margin: 0;
	}

	.paso-ahora {
		margin-top: 0;
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
	font-size: 0.8125rem;
}

/* Los tres filtros del hilo, encima de él: el grupo de píldoras de siempre. */
.filtro-hilo {
	margin-bottom: 0.9rem;
}

/* --- bandeja ------------------------------------------------------------- */

/* Qué es el bloque, debajo de su verbo: el verbo dice qué hacer y esta línea,
   con qué. */
.que-es {
	margin: -0.3rem 0 1rem;
	color: var(--texto-suave);
	font-size: 0.8125rem;
}

/* Cada pendiente es una sola tarjeta: su cabecera y, debajo, lo que hay que
   hacer. El filete de la izquierda es el mismo de la tarjeta del tablero: todo
   lo que hay aquí espera por el humano. */
.item {
	display: block;
	margin-bottom: 1rem;
	border-radius: var(--radio-tarjeta);
	background: var(--superficie);
	box-shadow: inset 3px 0 0 var(--turno), var(--sombra-tarjeta);
}

.cabecera-item {
	padding: 0 0.9rem 0 1.1rem;
	border-bottom: 1px solid var(--borde-suave);
}

.cabecera-item .titulo {
	font-weight: 600;
}

/* Un bloque sin cuerpo —«Define»— no deja un borde suelto debajo del título. */
.item > .cabecera-item:last-child {
	border-bottom: none;
}

.cuerpo-item {
	padding: 0.2rem 0.9rem 0.9rem 1.1rem;
}

/* El primer mensaje del cuerpo ya está separado por el borde de la cabecera. */
.cuerpo-item > .comentario:first-child {
	border-top: none;
}

/* Las partes por aprobar, separadas del análisis que las explica. */
.cuerpo-item > .filas {
	margin: 0.8rem 0;
}

/* Las dos salidas de un resultado, en una sola fila: pedir otra iteración
   escribiendo qué falta, o finalizar. */
.pie-item {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.6rem;
	margin-top: 0.8rem;
}

/* El campo se lleva el hueco que quede; los botones, lo suyo. */
.pie-item .iterar {
	display: flex;
	flex: 1;
	min-width: 16rem;
	gap: 0.4rem;
	margin: 0;
}

.pie-item .iterar input {
	flex: 1;
	min-width: 0;
}


/* --- Informes ------------------------------------------------------------ */

/* Cada pregunta con su tabla: el hueco entre bloques es lo que las separa,
   porque ninguna lleva caja ni borde exterior. */
.informe {
	margin-top: 2rem;
}

.informe h2 {
	margin: 0 0 0.6rem;
	font-size: 1rem;
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
	font-size: 0.75rem;
}

/* --- el tipo manda en el formulario de tarea ------------------------------- */

/* Una pregunta solo tiene fase de análisis, una funcionalidad no tiene
   autoejecución y no es parte de ninguna otra. El servidor ya lo ignora al
   guardar; esto lo esconde en el momento en que se elige el tipo, sin
   JavaScript. */
form:has(select[name="tipo"] option[value="pregunta"]:checked) fieldset[data-fase="ejecucion"],
form:has(select[name="tipo"] option[value="pregunta"]:checked) label[data-casilla="autoejecucion"],
form:has(select[name="tipo"] option[value="funcionalidad"]:checked) label[data-casilla="autoejecucion"],
form:has(select[name="tipo"] option[value="funcionalidad"]:checked) label:has(select[name="padre"]) {
	display: none;
}

/* --- hilo como chat ------------------------------------------------------ */

/* El corte de cada vuelta: una línea fina con «Iteración n» en medio. No es un
   mensaje, así que no lleva caja ni chip. */
.iteracion {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	color: var(--texto-suave);
	font-size: 0.75rem;
	font-weight: 500;
}

.iteracion::before, .iteracion::after {
	content: "";
	flex: 1;
	border-top: 1px solid var(--borde);
}

/* El humano y el agente escriben en la misma columna: esto es un hilo de
   trabajo, no una conversación con burbujas a cada lado. Lo que los distingue
   es el chip de quien firma —el del agente lleva su terminal detrás— y una
   banda suave en lo que escribe la persona, sangrada a los lados para que
   sobresalga del texto. */
.comentario.humano {
	margin: 0 -16px;
	padding: 0.8rem 16px;
	border-top: none;
	border-radius: var(--radio-tarjeta);
	background: var(--hueco);
}

/* El cuadro de escribir cierra el hilo, pegado al último mensaje. */
.hilo:has(+ .comentar) {
	margin-bottom: 0.8rem;
}

/* Y se queda pegado al fondo de la ventana mientras se recorre el hilo: en una
   tarea con veinte mensajes, escribir no obliga a volver abajo. */
.comentar {
	position: sticky;
	bottom: 0;
	z-index: 2;
	display: flex;
	flex-direction: column;
	gap: 0.6rem;
	margin: 0 0 1.6rem;
	padding-top: 0.8rem;
	border-top: 1px solid var(--borde);
	background: var(--fondo);
}

.comentar textarea {
	width: 100%;
	max-width: none;
}

/* En estrecho la pantalla es toda del hilo: un cuadro fijo se comería media. */
@media (max-width: 48rem) {
	.comentar {
		position: static;
	}
}

.comentar .acciones {
	justify-content: flex-end;
}

/* Hecha la tarea, el único botón pide otra iteración y el cuadro lo dice debajo. */
.comentar .silencio {
	margin: 0;
	text-align: right;
	font-size: 0.8125rem;
}

/* --- «Ahora mismo» en terminales ----------------------------------------- */

/* Qué trabaja cada terminal, encima de la tabla: una tarjeta por terminal vivo
   y una línea por fase tomada. Contesta si está pasando algo o si el bucle se
   ha muerto, que mirando solo la columna «Conectado» había que adivinarlo. */
.ahora-rejilla {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(26rem, 100%), 1fr));
	gap: 0.8rem;
	margin-bottom: 1.6rem;
}

.ahora-terminal {
	padding: 0.8rem 0.9rem;
	border-radius: var(--radio-tarjeta);
	background: var(--superficie);
	box-shadow: var(--sombra-tarjeta);
}

.ahora-cabecera {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 0.4rem;
	margin: 0 0 0.5rem;
}

.ahora-terminal > p:last-child {
	margin: 0;
}

/* Dentro de la tarjeta del terminal las filas no llevan otra tarjeta. */
.filas.ahora-fases {
	margin: 0;
	background: none;
	box-shadow: none;
}

.filas.ahora-fases > li {
	padding: 0;
}

/* --- «Configuración», desplegable en la barra lateral ------------------- */

/* El título del bloque es el propio summary: se lee como los rótulos de
   bloque, pequeño y suave, y se pulsa para abrirlo. */
details.bloque > summary {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	height: 32px;
	padding: 0 0.6rem;
	border-radius: var(--radio);
	color: var(--texto-suave);
	font-weight: 500;
	cursor: pointer;
	list-style: none;
	transition: background-color 120ms var(--suave);
}

details.bloque > summary::-webkit-details-marker {
	display: none;
}

/* El triángulo nativo no se deja alinear en una fila flexible: un chevron
   pintado que gira al abrir. */
details.bloque > summary::before {
	content: "";
	width: 5px;
	height: 5px;
	border-right: 1.5px solid currentColor;
	border-bottom: 1.5px solid currentColor;
	transform: rotate(-45deg);
	transition: transform 150ms var(--suave);
}

details.bloque[open] > summary::before {
	transform: rotate(45deg);
}

details.bloque > summary:hover {
	background: var(--fondo-hover);
}

/* --- la página del proyecto ---------------------------------------------- */

/* Las pestañas Resumen | Informes | Actividad: el mismo control segmentado de
   Lista | Tablero, solo tan ancho como sus tres enlaces. */
.pestanas {
	width: fit-content;
	margin: 0 0 1.6rem;
}

/* La descripción renderizada como frase de propósito trae sus párrafos. */
.proposito > :first-child {
	margin-top: 0;
}

.proposito > :last-child {
	margin-bottom: 0;
}

/* --- el punto de color y el que late -------------------------------------- */

/* Un círculo de 8 px del color fuerte de su clase «.color-*», que es el del
   texto: la sombra por dentro lo rellena y tapa el tinte que pone la clase de
   fondo, en los dos modos y sin pelearse con la tabla de nueve colores. Sin
   clase toma el color de lo que lo rodea, como dentro de una etiqueta. */
.punto {
	display: inline-block;
	flex: none;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	box-shadow: inset 0 0 0 4px currentColor;
	vertical-align: middle;
}

.insignia .punto {
	margin-right: 0.35rem;
}

/* «Agente trabajando»: lo único de la página que está pasando ahora. Quien
   pide menos movimiento lo tiene quieto por la regla general de arriba. */
.latido {
	animation: latido 1.6s ease-in-out infinite;
}

@keyframes latido {
	0%, 100% {
		transform: scale(1);
		opacity: 1;
	}

	50% {
		transform: scale(0.6);
		opacity: 0.4;
	}
}

/* --- la fila de tarea ------------------------------------------------------ */

/* Una lista de filas es una tarjeta: las filas se separan por la línea suave y
   se iluminan al pasar por encima. La usan la lista, la bandeja, las subtareas,
   el orden de ejecución y «Ahora mismo». */
.filas {
	margin: 0 0 1.4rem;
	padding: 0;
	list-style: none;
	border-radius: var(--radio-tarjeta);
	background: var(--superficie);
	box-shadow: var(--sombra-tarjeta);
}

.filas > li {
	padding: 0 0.8rem;
	transition: background-color 120ms var(--suave);
}

.filas > li + li {
	border-top: 1px solid var(--borde-suave);
}

.filas > li:hover {
	background: var(--fondo-hover);
}

.filas > li:first-child {
	border-radius: var(--radio-tarjeta) var(--radio-tarjeta) 0 0;
}

.filas > li:last-child {
	border-radius: 0 0 var(--radio-tarjeta) var(--radio-tarjeta);
}

.filas > li:only-child {
	border-radius: var(--radio-tarjeta);
}

/* 44 px: punto, id, título en una línea y, al borde derecho, la píldora, los
   agentes, los tokens y la edad. Todo lo demás guarda su ancho; solo el título
   cede, con puntos suspensivos. */
.fila-tarea {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	min-height: 44px;
	min-width: 0;
}

.fila-tarea > * {
	flex: none;
}

.fila-tarea > .titulo {
	flex: 0 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.estado-fila {
	display: inline-flex;
	align-items: center;
	gap: 0.45rem;
	color: var(--texto-suave);
	font-size: 0.78125rem;
}

/* El nombre del estado, donde va, ocupa siempre lo mismo: los ids se alinean. */
.nombre-estado {
	min-width: 4.6rem;
}

.fila-tarea .progreso-texto {
	margin: 0;
	white-space: nowrap;
}

.fila-tarea .derecha {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	margin-left: auto;
	padding-left: 0.6rem;
}

.fila-tarea .derecha .insignia {
	margin-right: 0;
}

/* Tokens y edad en su columna: alineados a la derecha y con ancho fijo, para
   que de una fila a otra se comparen de un vistazo. */
.fila-tarea .tokens {
	min-width: 4.5rem;
	color: var(--texto-suave);
	font-size: 0.75rem;
	text-align: right;
	white-space: nowrap;
}

.fila-tarea .hueco-edad {
	min-width: 3.2rem;
	text-align: right;
}

/* En estrecho la derecha baja a su propia línea en vez de comerse el título. */
@media (max-width: 48rem) {
	.fila-tarea {
		flex-wrap: wrap;
		gap: 0.3rem 0.6rem;
		padding: 0.5rem 0;
	}

	.fila-tarea .derecha {
		flex-wrap: wrap;
		margin-left: 0;
		padding-left: 0;
	}
}

/* --- la tarjeta de aprobación ---------------------------------------------- */

/* Una pregunta abierta es una tarjeta: de qué tarea es, la pregunta de
   título, por qué importa, las opciones y las acciones a la derecha. En la
   bandeja ya va dentro de la tarjeta del pendiente y no lleva otra. */
.pregunta-abierta {
	padding: 0.9rem 1.1rem 1rem;
	border-top: none;
	border-radius: var(--radio-tarjeta);
	background: var(--superficie);
	box-shadow: var(--sombra-tarjeta);
}

.cuerpo-item .pregunta-abierta {
	padding: 0.8rem 0 0;
	border-radius: 0;
	background: none;
	box-shadow: none;
}

.pregunta-abierta > header .titulo {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.pregunta-titulo {
	margin: 0.3rem 0 0.2rem;
	font-size: 0.9375rem;
}

.pregunta-titulo strong {
	font-weight: 600;
}

.por-que {
	margin: 0 0 0.9rem;
	color: var(--texto-suave);
}

.pregunta-abierta .responder {
	margin: 0;
	padding: 0;
	border: 0;
}

.pregunta-abierta fieldset {
	margin: 0;
	padding: 0;
	box-shadow: none;
}

/* El rótulo del grupo es para los lectores: a la vista ya lo dice la tarjeta. */
.pregunta-abierta legend {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
}

.pregunta-abierta textarea {
	max-width: none;
	min-height: 4rem;
}

.acciones-respuesta {
	justify-content: flex-end;
}
`;
