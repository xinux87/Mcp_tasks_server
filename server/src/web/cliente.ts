/**
 * El JavaScript de cliente entero, como constante. No hay archivos estáticos
 * en disco: lo sirve `GET /static/app.js` como módulo ES. Es lo único que
 * corre en el navegador, aparte de SortableJS.
 *
 * Hace siete cosas, y ninguna más:
 *
 * 1. Refresco en vivo: escucha `/eventos` (SSE con la revisión global) y,
 *    según la vista, recarga el fragmento del tablero, recarga la página o
 *    muestra un aviso.
 * 2. Arrastre del kanban con SortableJS, que envía `POST /tareas/:id/orden`.
 * 3. Recarga por intervalo de la vista de terminales, que no mueve la
 *    revisión porque su telemetría no es contenido.
 * 4. Despliega la barra lateral en móvil, alternando la clase
 *    `lateral-abierta` en el `<body>`.
 * 5. Copia al portapapeles cualquier bloque de código, entero o línea a línea.
 * 6. Navega al cambiar el selector de proyecto de la barra lateral, y esconde
 *    su botón «Ir», que solo hace falta sin JavaScript.
 * 7. El conmutador de tema: marca el radio que toca al cargar y, al cambiarlo,
 *    guarda la preferencia en el navegador y la aplica en el acto.
 *
 * Escrito sin acentos graves ni interpolaciones para que quepa tal cual en
 * esta plantilla de TypeScript. Nunca escribe `innerHTML` con nada que no
 * venga del servidor, y no usa `eval` ni `Function`.
 */
export const CLIENTE_JS = `// Cliente de MCP Tareas. Servido desde src/web/cliente.ts.

const cuerpo = document.body;
const vista = cuerpo.dataset.vista || "";

/** Última revisión conocida. Sin el atributo, esta página no se refresca sola. */
let revision = Number.parseInt(cuerpo.dataset.revision || "", 10);

/** Hay un arrastre en curso: el tablero no se puede sustituir ahora mismo. */
let arrastrando = false;

/** Llegó una revisión nueva mientras se arrastraba: se recarga al soltar. */
let pendiente = false;

/** Promesa de la carga de SortableJS, para no pedirlo dos veces. */
let cargaSortable = null;

/** La conexión SSE abierta, o null mientras la pestaña no está visible. */
let fuenteEventos = null;

/** Temporizador del aviso del tablero, que se borra solo a los pocos segundos. */
let temporizadorAviso = 0;

function elTablero() {
	return document.getElementById("tablero");
}

/** La query string actual: el fragmento se recarga con los mismos filtros. */
function consultaActual() {
	return window.location.search || "";
}

// --- avisos ------------------------------------------------------------------

/** Mensaje de un movimiento rechazado, en la zona de aviso del tablero. */
function avisarEnTablero(mensaje) {
	const zona = document.getElementById("aviso-tablero");
	if (zona === null) {
		return;
	}
	zona.textContent = mensaje;
	zona.hidden = false;
	window.clearTimeout(temporizadorAviso);
	temporizadorAviso = window.setTimeout(function () {
		zona.textContent = "";
		zona.hidden = true;
	}, 8000);
}

/**
 * Vuelve a pedir la misma página con un GET. No se usa reload() porque una
 * página pintada como respuesta a un POST (un 422 con su aviso) volvería a
 * enviar el formulario.
 */
function recargarPagina() {
	window.location.assign(window.location.pathname + window.location.search);
}

/**
 * Aviso fijo de la ficha. No se recarga sola porque la ficha tiene
 * formularios y el humano puede estar escribiendo una nota.
 */
function avisarRecarga() {
	if (document.getElementById("aviso-recarga") !== null) {
		return;
	}
	const caja = document.createElement("div");
	caja.id = "aviso-recarga";
	caja.className = "aviso-recarga";
	caja.setAttribute("role", "status");
	caja.appendChild(document.createTextNode("Hay cambios en esta tarea. "));
	// Un enlace de verdad: recargar es ir otra vez a la misma dirección.
	const enlace = document.createElement("a");
	enlace.href = window.location.pathname + window.location.search;
	enlace.textContent = "Recargar";
	caja.appendChild(enlace);
	cuerpo.appendChild(caja);
}

// --- tablero -----------------------------------------------------------------

/**
 * Sustituye el fragmento del tablero por el que sirve el servidor. El HTML
 * viene entero de /tareas/kanban/tablero: es lo único que se pasa por
 * innerHTML, y se hace sobre un <template> que no ejecuta nada.
 */
async function recargarTablero() {
	const actual = elTablero();
	if (actual === null) {
		return;
	}
	// El propio fragmento dice de dónde salió: el tablero de la ficha de una
	// funcionalidad solo trae sus partes, y su dirección no es la de la página.
	const fuente = actual.dataset.fuente || "/tareas/kanban/tablero" + consultaActual();
	let respuesta;
	try {
		respuesta = await fetch(fuente, {
			headers: { accept: "text/html" },
			credentials: "same-origin",
		});
	} catch (error) {
		return;
	}
	if (!respuesta.ok) {
		return;
	}
	const texto = await respuesta.text();
	const plantilla = document.createElement("template");
	plantilla.innerHTML = texto;
	const nuevo = plantilla.content.querySelector("#tablero");
	if (nuevo === null) {
		return;
	}
	// Se vuelve a mirar cuál es el tablero de ahora: entre la petición y la
	// respuesta puede haber entrado otra recarga.
	const vigente = elTablero();
	if (vigente === null) {
		return;
	}
	vigente.replaceWith(nuevo);
	const marca = Number.parseInt(nuevo.dataset.revision || "", 10);
	if (Number.isFinite(marca) && (!Number.isFinite(revision) || marca > revision)) {
		revision = marca;
	}
	iniciarArrastre();
}

// --- arrastre ----------------------------------------------------------------

/** Carga SortableJS a demanda: solo hace falta donde hay tablero. */
function cargarSortable() {
	if (window.Sortable !== undefined) {
		return Promise.resolve(window.Sortable);
	}
	if (cargaSortable !== null) {
		return cargaSortable;
	}
	cargaSortable = new Promise(function (resolver, rechazar) {
		const etiqueta = document.createElement("script");
		etiqueta.src = "/static/sortable.min.js";
		etiqueta.addEventListener("load", function () {
			resolver(window.Sortable);
		});
		etiqueta.addEventListener("error", function () {
			rechazar(new Error("no se pudo cargar SortableJS"));
		});
		document.head.appendChild(etiqueta);
	});
	return cargaSortable;
}

/** Las vueltas atrás del humano exigen un comentario que explique por qué. */
function comentarioObligatorio(origen, destino) {
	if (origen === "prepared" && destino === "backlog") {
		return "Devolver a por definir es repensar la tarea. Comentario: por qué vuelve.";
	}
	if (origen === "done" && destino === "doing") {
		return "Pedir otra iteración. Comentario: qué falta.";
	}
	return null;
}

/** Posición de la tarjeta dentro de su columna, empezando en 1. */
function posicionDe(columna, tarjeta) {
	return Array.prototype.indexOf.call(columna.children, tarjeta) + 1;
}

/**
 * El ámbito de una columna: la franja donde se soltó la tarjeta si el tablero
 * va por carriles, y el tablero entero si no. El de una funcionalidad solo
 * enseña sus partes, y una franja solo las suyas: en los dos casos la posición
 * que se ve es entre hermanas, y el servidor la traduce a la de la columna.
 */
function ambitoDe(columna) {
	const franja = columna.closest(".franja");
	return franja === null ? elTablero() : franja;
}

async function enviarOrden(columna, id, estado, orden, nota) {
	const datos = new URLSearchParams();
	datos.set("estado", estado);
	datos.set("orden", String(orden));
	datos.set("nota", nota);
	const ambito = ambitoDe(columna);
	const padre = ambito === null ? "" : ambito.dataset.padre || "";
	if (padre !== "") {
		datos.set("padre", padre);
	}
	// Sin funcionalidad, el ámbito es el tablero de un proyecto, si lo hay: la
	// posición es entre sus tareas.
	const tablero = elTablero();
	const proyecto = padre !== "" || tablero === null ? "" : tablero.dataset.proyecto || "";
	if (proyecto !== "") {
		datos.set("proyecto", proyecto);
	}
	let respuesta;
	try {
		respuesta = await fetch("/tareas/" + encodeURIComponent(id) + "/orden", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			credentials: "same-origin",
			body: datos.toString(),
		});
	} catch (error) {
		return "No se pudo hablar con el servidor. El tablero vuelve a como está guardado.";
	}
	if (respuesta.status === 204) {
		return null;
	}
	if (respuesta.status === 422 || respuesta.status === 404) {
		let cuerpoJson = null;
		try {
			cuerpoJson = await respuesta.json();
		} catch (error) {
			cuerpoJson = null;
		}
		if (cuerpoJson !== null && typeof cuerpoJson.mensaje === "string") {
			return cuerpoJson.mensaje;
		}
	}
	return "No se pudo mover la tarea (" + respuesta.status + ").";
}

async function alSoltar(evento) {
	arrastrando = false;
	const tarjeta = evento.item;
	const columna = evento.to;
	const origen = evento.from.dataset.estado || "";
	const destino = columna.dataset.estado || "";
	const id = tarjeta.dataset.id || "";
	const movida = origen !== destino || evento.oldIndex !== evento.newIndex;
	if (!movida) {
		if (pendiente) {
			pendiente = false;
			await recargarTablero();
		}
		return;
	}
	pendiente = false;
	if (id === "" || destino === "") {
		await recargarTablero();
		return;
	}
	let nota = "";
	const pregunta = comentarioObligatorio(origen, destino);
	if (pregunta !== null) {
		const escrita = window.prompt(pregunta);
		// Cancelar no mueve nada: el tablero vuelve a como está en el servidor.
		if (escrita === null || escrita.trim() === "") {
			await recargarTablero();
			return;
		}
		nota = escrita;
	}
	const mensaje = await enviarOrden(columna, id, destino, posicionDe(columna, tarjeta), nota);
	// El servidor manda: se repinta siempre, salga bien o mal.
	await recargarTablero();
	if (mensaje !== null) {
		avisarEnTablero(mensaje);
	}
}

/**
 * A qué grupo de SortableJS pertenece una columna. Agrupado por funcionalidad
 * hay uno por franja, así que una tarjeta no se puede soltar en otra: cambiar
 * una tarea de funcionalidad no es una prioridad, es una edición, y va por la
 * ficha.
 */
function grupoDe(columna) {
	const franja = columna.closest(".franja");
	if (franja === null) {
		return "tareas";
	}
	return "franja-" + (franja.dataset.padre || "sueltas");
}

/** Una instancia de SortableJS por columna. Se rehace al sustituir el tablero. */
function iniciarArrastre() {
	const zona = elTablero();
	if (zona === null || window.Sortable === undefined) {
		return;
	}
	const columnas = zona.querySelectorAll(".tarjetas");
	for (const columna of columnas) {
		new window.Sortable(columna, {
			group: grupoDe(columna),
			animation: 150,
			ghostClass: "arrastrando",
			onStart: function () {
				arrastrando = true;
			},
			onEnd: alSoltar,
		});
	}
}

// --- barra lateral en móvil --------------------------------------------------

/**
 * Por debajo de 48 rem la barra lateral está fuera de la pantalla y el botón
 * de la cabecera la trae. La clase vive en el <body> y no en el HTML que
 * sirve el servidor: quien la abre es siempre el navegador.
 */
function prepararLateral() {
	const boton = document.getElementById("alternar-lateral");
	const panel = document.getElementById("lateral");
	if (boton === null || panel === null) {
		return;
	}
	function cerrar() {
		cuerpo.classList.remove("lateral-abierta");
	}
	boton.addEventListener("click", function (evento) {
		// Sin esto, el mismo clic llegaría al documento y cerraría lo recién abierto.
		evento.stopPropagation();
		cuerpo.classList.toggle("lateral-abierta");
	});
	document.addEventListener("keydown", function (evento) {
		if (evento.key === "Escape") {
			cerrar();
		}
	});
	// Pulsar fuera del panel lo cierra: es lo que se espera de un panel encima.
	document.addEventListener("click", function (evento) {
		if (!cuerpo.classList.contains("lateral-abierta") || panel.contains(evento.target)) {
			return;
		}
		cerrar();
	});
}

// --- tema --------------------------------------------------------------------

/** Lo guardado, o "sistema" cuando no hay nada o el almacén no deja leer. */
function temaGuardado() {
	try {
		const valor = window.localStorage.getItem("tema");
		return valor === "claro" || valor === "oscuro" ? valor : "sistema";
	} catch (error) {
		return "sistema";
	}
}

/** Pone o quita el atributo del que cuelga la paleta. Sin él manda el sistema. */
function aplicarTema(valor) {
	if (valor === "sistema") {
		delete document.documentElement.dataset.tema;
		return;
	}
	document.documentElement.dataset.tema = valor;
}

/**
 * Los tres radios de la barra lateral. El servidor no sabe qué tema quiere
 * quien mira (es del navegador, no del usuario), así que pinta "Sistema"
 * marcado y aquí se corrige con lo que haya guardado. Cambiarlo se ve en el
 * acto: el atributo del <html> es lo único que decide la paleta.
 */
function prepararTema() {
	const radios = document.querySelectorAll('input[name="tema"]');
	if (radios.length === 0) {
		return;
	}
	const actual = temaGuardado();
	for (const radio of radios) {
		radio.checked = radio.value === actual;
		radio.addEventListener("change", function () {
			if (!radio.checked) {
				return;
			}
			try {
				if (radio.value === "sistema") {
					window.localStorage.removeItem("tema");
				} else {
					window.localStorage.setItem("tema", radio.value);
				}
			} catch (error) {
				// Sin almacén el tema no persiste, pero la página sí cambia.
			}
			aplicarTema(radio.value);
		});
	}
}

// --- selector de proyecto ----------------------------------------------------

/**
 * El desplegable de la barra lateral ya lleva en cada opción su destino, así
 * que sin JavaScript basta con enviar el formulario. Con él sobra el botón:
 * cambiar la opción lo envía.
 *
 * Se envía el formulario y no se salta a la opción: el paso por /ir es lo
 * que recuerda que se han elegido todos los proyectos, que es una vista que
 * ninguna ruta va a escribir después.
 */
function prepararSelectorProyecto() {
	const select = document.getElementById("ir-proyecto");
	if (select === null) {
		return;
	}
	const formulario = select.closest("form");
	if (formulario === null) {
		return;
	}
	const boton = formulario.querySelector("button");
	if (boton !== null) {
		boton.hidden = true;
	}
	select.addEventListener("change", function () {
		if (select.value !== "") {
			formulario.submit();
		}
	});
}

// --- copiar bloques de comandos ----------------------------------------------

/**
 * Lo que copia un botón: su línea si está en una, y el bloque entero si es el
 * del bloque. El texto sale de los <code>, nunca del <pre>, que además lleva
 * dentro los propios botones.
 */
function textoDelBoton(boton) {
	const linea = boton.closest(".linea");
	if (linea !== null) {
		const codigo = linea.querySelector("code");
		return codigo === null ? "" : codigo.textContent || "";
	}
	const bloque = boton.closest(".bloque-codigo");
	if (bloque === null) {
		return "";
	}
	const codigos = bloque.querySelectorAll("code");
	return Array.prototype.map
		.call(codigos, function (codigo) {
			return codigo.textContent || "";
		})
		.join("\\n");
}

/** El aviso de dos segundos, que deja el botón como estaba. */
function avisarCopia(boton, texto) {
	if (boton.dataset.original === undefined) {
		boton.dataset.original = boton.textContent;
	}
	boton.textContent = texto;
	window.setTimeout(function () {
		boton.textContent = boton.dataset.original;
	}, 2000);
}

/**
 * Los botones de copiar: uno por bloque de código y otro por cada línea de un
 * bloque de varias. Un solo listener en el documento, porque los bloques
 * también llegan dentro del hilo de una tarea y de un tablero recargado.
 *
 * Sin API de portapapeles (una red local por http no es un contexto seguro, y
 * ahí no existe) se esconden todos con una clase en el <html>: el texto se
 * sigue pudiendo seleccionar a mano, y un botón que no hace nada engaña.
 */
function prepararCopias() {
	const portapapeles = window.navigator.clipboard;
	if (portapapeles === undefined || typeof portapapeles.writeText !== "function") {
		document.documentElement.classList.add("sin-portapapeles");
		return;
	}
	document.addEventListener("click", function (evento) {
		const destino = evento.target;
		if (destino === null || typeof destino.closest !== "function") {
			return;
		}
		const boton = destino.closest(".copiar");
		if (boton === null) {
			return;
		}
		portapapeles.writeText(textoDelBoton(boton)).then(
			function () {
				avisarCopia(boton, boton.dataset.hecho || "Copiado");
			},
			function () {
				avisarCopia(boton, boton.dataset.fallo || "No se pudo");
			},
		);
	});
}

// --- refresco en vivo --------------------------------------------------------

function alSubirLaRevision() {
	if (elTablero() !== null) {
		if (arrastrando) {
			pendiente = true;
			return;
		}
		void recargarTablero();
		// La ficha de una funcionalidad tiene tablero y además hilo: el tablero
		// se repinta solo y de lo demás avisa, como cualquier otra ficha.
		if (vista !== "ficha") {
			return;
		}
	}
	// La lista, las funcionalidades y la bandeja se vuelven a pedir enteras: lo
	// que enseñan es lo que está pendiente, y eso cambia solo.
	if (vista === "lista" || vista === "funcionalidades" || vista === "bandeja") {
		recargarPagina();
		return;
	}
	if (vista === "ficha") {
		avisarRecarga();
	}
}

/**
 * Solo la pestaña visible mantiene la conexión abierta. El navegador admite
 * seis conexiones por servidor: cada pestaña en segundo plano se quedaba con
 * una para siempre y las peticiones nuevas hacían cola. Al volver no hay que
 * comprobar nada, porque el primer evento de la conexión nueva trae la
 * revisión actual y dispara el refresco de siempre si subió.
 */
function escucharEventos() {
	if (typeof EventSource !== "function" || !Number.isFinite(revision)) {
		return;
	}
	function abrir() {
		if (fuenteEventos !== null) {
			return;
		}
		// Si la conexión se cae, el navegador reconecta solo: no hay nada que hacer.
		fuenteEventos = new EventSource("/eventos");
		fuenteEventos.addEventListener("revision", function (evento) {
			const numero = Number.parseInt(evento.data, 10);
			if (!Number.isFinite(numero) || numero <= revision) {
				return;
			}
			revision = numero;
			alSubirLaRevision();
		});
	}
	function cerrar() {
		if (fuenteEventos === null) {
			return;
		}
		fuenteEventos.close();
		fuenteEventos = null;
	}
	document.addEventListener("visibilitychange", function () {
		if (document.visibilityState === "visible") {
			abrir();
			return;
		}
		cerrar();
	});
	// Una pestaña abierta en segundo plano no conecta hasta que se mira.
	if (document.visibilityState === "visible") {
		abrir();
	}
}

// --- arranque ----------------------------------------------------------------

prepararTema();
prepararLateral();
prepararSelectorProyecto();
prepararCopias();
escucharEventos();

if (elTablero() !== null) {
	cargarSortable().then(iniciarArrastre, function () {
		avisarEnTablero("No se pudo cargar el arrastre. La lista sigue funcionando.");
	});
}

// La telemetría de los terminales no sube la revisión, así que esa vista se
// refresca por intervalo y no por SSE.
if (vista === "terminales") {
	window.setTimeout(recargarPagina, 30000);
}
`;
