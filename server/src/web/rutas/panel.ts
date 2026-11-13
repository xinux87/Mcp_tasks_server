import type { Hono } from "hono";
import { html } from "hono/html";
import { altaPor } from "../../db/actividad.ts";
import { listarTerminales } from "../../db/admin.ts";
import { bandejaDe } from "../../db/bandeja.ts";
import type { Proyecto } from "../../db/proyectos.ts";
import { type ItemIndice, listarTareas } from "../../db/tareas.ts";
import {
	barraApilada,
	buscadorDeColor,
	buscadorDeProyecto,
	COLOR_MARCA,
	chipDeAlta,
	edadEnColumna,
	etiqueta,
	filaDeTarea,
	franjaEnMarcha,
	propiedades,
} from "../componentes.ts";
import { tokensConPresupuesto } from "../formatos.ts";
import { type Html, insigniaTipoDeItem } from "../plantilla.ts";
import type { DependenciasWeb } from "../sesion.ts";
import { NOMBRE_MARCA } from "../vocabulario.ts";
import { etiquetaDeTarjeta, funcionalidadDe, ORDEN_FRANJAS, progresoDe } from "./kanban.ts";
import { paginaDeProyecto, paginaSinProyecto, proyectoActual, textoOpcionalLegible } from "./proyectos.ts";

/**
 * El panel del proyecto: el organigrama con su estado, de un vistazo. Todo
 * sale de una sola lectura del índice (la CTE recursiva de `listarTareas`):
 * las cifras, las funcionalidades con sus partes y las sueltas. Nunca una
 * consulta por funcionalidad.
 */

/** Las abiertas en el orden del panel: primero lo que está en marcha. */
function enOrden(items: readonly ItemIndice[]): ItemIndice[] {
	return ORDEN_FRANJAS.flatMap((estado) => items.filter((item) => item.estado === estado));
}

/** El punto que late, sin texto: lo acompaña una cifra. */
const LATIDO = html`<span class="punto latido color-${COLOR_MARCA["en marcha"]}" role="img" aria-label="${NOMBRE_MARCA["en marcha"]}"></span>`;

/** Una tarea del panel: la fila de tarea con su estado al lado, su píldora única, tokens y edad. */
function filaDelPanel(item: ItemIndice): Html {
	return html`<li>${filaDeTarea({
		codigo: item.codigo,
		titulo: item.titulo,
		estado: item.estado,
		nombreEstado: true,
		detras: progresoDe(item),
		derecha: html`${etiquetaDeTarjeta(item)}${insigniaTipoDeItem(item)}
			<span class="tokens">${tokensConPresupuesto(item.tokensConHijas, item.presupuesto)}</span>
			<span class="hueco-edad">${edadEnColumna(item)}</span>`,
	})}</li>`;
}

function filasDelPanel(items: readonly ItemIndice[], vacio: string): Html {
	return items.length === 0
		? html`<p class="silencio">${vacio}</p>`
		: html`<ul class="filas">${items.map(filaDelPanel)}</ul>`;
}

/**
 * Una funcionalidad: en la cabecera, la barra de sus partes, sus preguntas
 * abiertas y sus agentes trabajando (los de todo su árbol); al desplegar, sus
 * partes. `arbol` es todo lo que cuelga de ella a cualquier profundidad.
 */
function filaFuncionalidad(funcionalidad: ItemIndice, arbol: readonly ItemIndice[]): Html {
	const partes = arbol.filter((item) => item.padreId === funcionalidad.id && item.clase === "parte");
	const todo = [funcionalidad, ...arbol];
	const preguntas = todo.reduce((suma, item) => suma + item.preguntasAbiertas, 0);
	const trabajando = todo.filter((item) => item.marcas.includes("en marcha")).length;
	const cabecera = filaDeTarea({
		codigo: funcionalidad.codigo,
		titulo: funcionalidad.titulo,
		estado: funcionalidad.estado,
		nombreEstado: true,
		detras:
			partes.length === 0
				? html``
				: html`<span class="barra-partes">${barraApilada(partes.map((parte) => parte.estado))}</span><span class="progreso-texto">tareas ${funcionalidad.partesCerradas ?? 0}/${funcionalidad.partes ?? 0}</span>`,
		derecha: html`${
			preguntas === 0
				? html``
				: html`<span class="insignia turno">${preguntas} ${preguntas === 1 ? "pregunta abierta" : "preguntas abiertas"}</span>`
		}${
			trabajando === 0
				? html``
				: html`<span class="trabajando" title="${NOMBRE_MARCA["en marcha"]}">${LATIDO}${trabajando}</span>`
		}
			<span class="tokens">${tokensConPresupuesto(funcionalidad.tokensConHijas, funcionalidad.presupuesto)}</span>`,
	});
	return html`<li>
			<details class="desplegable">
				<summary>${cabecera}</summary>
				${filasDelPanel(partes, "Sin tareas todavía.")}
			</details>
		</li>`;
}

/** Una de las cuatro cifras de arriba. */
function cifra(valor: Html | number, rotulo: string, debajo: Html = html``, clase = ""): Html {
	return html`<div class="cifra${clase}">
			<span class="cifra-valor">${valor}</span>
			<span class="cifra-rotulo">${rotulo}</span>
			${debajo}
		</div>`;
}

function panelProyecto(deps: DependenciasWeb, proyecto: Proyecto): Html {
	const { db } = deps;
	const horas = deps.config.FASE_PARADA_HORAS;
	const base = `/p/${proyecto.clave}`;
	const items = listarTareas(db, { proyectoId: proyecto.id }, horas);

	// De qué funcionalidad cuelga cada cosa: se sube por el padre dentro del
	// índice ya leído. Lo que no tiene padre y no está cerrado es una tarea
	// suelta: sus subtareas se ven en su ficha, no aquí.
	const porId = new Map(items.map((item) => [item.id, item]));
	const arboles = new Map<number, ItemIndice[]>();
	const sueltas: ItemIndice[] = [];
	for (const item of items) {
		if (item.tipo === "funcionalidad") {
			continue;
		}
		const cual = funcionalidadDe(item, porId);
		if (cual !== null) {
			arboles.set(cual.id, [...(arboles.get(cual.id) ?? []), item]);
		} else if (item.padreId === null && item.estado !== "finished") {
			sueltas.push(item);
		}
	}
	const funcionalidades = items.filter((item) => item.tipo === "funcionalidad");
	const abiertas = enOrden(funcionalidades);
	const cerradas = funcionalidades.filter((item) => item.estado === "finished");
	// La barra del proyecto: sus tareas y preguntas, sin las funcionalidades
	// (que son la suma de sus partes) ni las hijas de trabajo (que son trozos
	// de la ejecución de otra).
	const tareas = items.filter((item) => item.tipo !== "funcionalidad" && item.clase !== "hija");
	const bandeja = bandejaDe(items);
	const pendientes = bandeja.bloqueadas.length + bandeja.porAprobar.length + bandeja.porRevisar.length;
	const trabajando = items.filter((item) => item.marcas.includes("en marcha")).length;
	const espera = `${base}/tareas?rapido=espera`;
	const terminales = listarTerminales(db).filter((terminal) => terminal.proyectoId === proyecto.id);

	const cifras = html`<section class="cifras" aria-label="El proyecto en cifras">
			${cifra(abiertas.length, "Funcionalidades abiertas")}
			${cifra(
				tareas.filter((item) => item.estado !== "finished").length,
				"Tareas abiertas",
				html`<div class="cifra-barra">${barraApilada(
					tareas.map((item) => item.estado),
					true,
				)}</div>`,
				" cifra-ancha",
			)}
			${cifra(
				pendientes,
				"Espera por ti",
				html`<span class="cifra-desglose">
					<a href="${espera}">Contesta ${bandeja.bloqueadas.length}</a>
					<a href="${espera}">Aprueba ${bandeja.porAprobar.length}</a>
					<a href="${espera}">Revisa ${bandeja.porRevisar.length}</a>
				</span>`,
				pendientes > 0 ? " en-turno" : "",
			)}
			${cifra(trabajando === 0 ? 0 : html`${LATIDO}${trabajando}`, "Agentes trabajando")}
		</section>`;

	const ahora = franjaEnMarcha(
		db,
		horas,
		terminales,
		buscadorDeProyecto(db),
		html`<section class="ahora"><h2>Ahora mismo</h2><p class="silencio">Sin terminales en este proyecto.</p></section>`,
	);

	const organigrama =
		funcionalidades.length === 0 && sueltas.length === 0
			? html`<section class="informe">
					<p class="silencio">Nada todavía. <a href="${base}/tareas/nueva">Crea la primera tarea</a>.</p>
				</section>`
			: html`<section class="informe">
					<h2>Funcionalidades</h2>
					${
						abiertas.length === 0
							? html`<p class="silencio">Ninguna abierta.</p>`
							: html`<ul class="filas">${abiertas.map((item) => filaFuncionalidad(item, arboles.get(item.id) ?? []))}</ul>`
					}
					${
						cerradas.length === 0
							? html``
							: html`<details class="grupo">
								<summary>Cerradas (${cerradas.length})</summary>
								<ul class="filas">${cerradas.map((item) => filaFuncionalidad(item, arboles.get(item.id) ?? []))}</ul>
							</details>`
					}
				</section>
				<section class="informe">
					<h2>Tareas sueltas</h2>
					${filasDelPanel(enOrden(sueltas), "Ninguna.")}
				</section>`;

	const configuracion = html`<details class="caja propiedades-proyecto">
			<summary>Propiedades del proyecto</summary>
			${propiedades([
				{ nombre: "Repositorio", valor: textoOpcionalLegible(proyecto.repositorio) },
				{ nombre: "Rama principal", valor: html`<code>${proyecto.ramaPrincipal}</code>` },
				{ nombre: "Verificación", valor: textoOpcionalLegible(proyecto.verificacion) },
				{ nombre: "Color", valor: etiqueta(proyecto.color, proyecto.color) },
				{ nombre: "Creado por", valor: chipDeAlta(altaPor(db, "proyecto", proyecto.id), buscadorDeColor(db)) },
			])}
		</details>`;

	return html`${cifras}${ahora}${organigrama}${configuracion}`;
}

/** La pestaña «Panel» de la página del proyecto, que es adonde lleva «Proyecto» en la barra. */
export function registrarRutasPanel(app: Hono, deps: DependenciasWeb): void {
	// `exigeProyecto` ya dejó el proyecto en el contexto, o respondió el 404.
	app.get("/p/:clave", (c) => {
		const proyecto = proyectoActual(c);
		if (proyecto === undefined) {
			return paginaSinProyecto(c, deps.db, c.req.param("clave"));
		}
		return paginaDeProyecto(c, deps, proyecto, "panel", panelProyecto(deps, proyecto));
	});
}
