/**
 * El JavaScript de cliente entero, como constante. No hay archivos estáticos
 * en disco: lo sirve `GET /static/app.js` como módulo ES. Es lo único que
 * corre en el navegador, aparte de SortableJS.
 *
 * Hace tres cosas, y ninguna más:
 *
 * 1. Refresco en vivo: escucha `/eventos` (SSE con la revisión global) y,
 *    según la vista, recarga el fragmento del tablero, recarga la página o
 *    muestra un aviso.
 * 2. Arrastre del kanban con SortableJS, que envía `POST /tareas/:id/orden`.
 * 3. Recarga por intervalo de la vista de terminales, que no mueve la
 *    revisión porque su telemetría no es contenido.
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
	if (elTablero() === null) {
		return;
	}
	let respuesta;
	try {
		respuesta = await fetch("/tareas/kanban/tablero" + consultaActual(), {
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

/** Las vueltas atrás del humano exigen una nota que explique por qué. */
function notaObligatoria(origen, destino) {
	if (origen === "prepared" && destino === "backlog") {
		return "Volver a backlog es repensar la tarea. Nota: por qué vuelve.";
	}
	if (origen === "done" && destino === "doing") {
		return "Devolver a doing rechaza el resultado. Nota: qué falta.";
	}
	return null;
}

/** Posición de la tarjeta dentro de su columna, empezando en 1. */
function posicionDe(columna, tarjeta) {
	return Array.prototype.indexOf.call(columna.children, tarjeta) + 1;
}

async function enviarOrden(id, estado, orden, nota) {
	const datos = new URLSearchParams();
	datos.set("estado", estado);
	datos.set("orden", String(orden));
	datos.set("nota", nota);
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
	const pregunta = notaObligatoria(origen, destino);
	if (pregunta !== null) {
		const escrita = window.prompt(pregunta);
		// Cancelar no mueve nada: el tablero vuelve a como está en el servidor.
		if (escrita === null || escrita.trim() === "") {
			await recargarTablero();
			return;
		}
		nota = escrita;
	}
	const mensaje = await enviarOrden(id, destino, posicionDe(columna, tarjeta), nota);
	// El servidor manda: se repinta siempre, salga bien o mal.
	await recargarTablero();
	if (mensaje !== null) {
		avisarEnTablero(mensaje);
	}
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
			group: "tareas",
			animation: 150,
			ghostClass: "arrastrando",
			onStart: function () {
				arrastrando = true;
			},
			onEnd: alSoltar,
		});
	}
}

// --- refresco en vivo --------------------------------------------------------

function alSubirLaRevision() {
	if (elTablero() !== null) {
		if (arrastrando) {
			pendiente = true;
			return;
		}
		void recargarTablero();
		return;
	}
	if (vista === "lista") {
		recargarPagina();
		return;
	}
	if (vista === "ficha") {
		avisarRecarga();
	}
}

function escucharEventos() {
	if (typeof EventSource !== "function" || !Number.isFinite(revision)) {
		return;
	}
	// Si la conexión se cae, el navegador reconecta solo: no hay nada que hacer.
	const fuente = new EventSource("/eventos");
	fuente.addEventListener("revision", function (evento) {
		const numero = Number.parseInt(evento.data, 10);
		if (!Number.isFinite(numero) || numero <= revision) {
			return;
		}
		revision = numero;
		alSubirLaRevision();
	});
}

// --- arranque ----------------------------------------------------------------

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
