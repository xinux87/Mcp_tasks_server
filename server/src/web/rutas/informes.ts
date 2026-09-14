import type { Context, Hono } from "hono";
import { html, raw } from "hono/html";
import {
	ciclo,
	costePorModelo,
	devoluciones,
	type FiltroInforme,
	interrupcionesPorModelo,
	primeraTransicion,
	ritmo,
} from "../../db/informes.ts";
import { barraProgreso } from "../componentes.ts";
import { duracion, fechaLegible, SIN_DATO, tokensAbreviados } from "../formatos.ts";
import { type Html, pagina, type RespuestaHtml } from "../plantilla.ts";
import { type DependenciasWeb, usuarioActual } from "../sesion.ts";
import { NOMBRE_FASE } from "../vocabulario.ts";
import { navProyectos, prefijo, proyectoActual } from "./proyectos.ts";

/** Los periodos que se ofrecen. `todo` no acota: es la única sin días. */
const PERIODOS: readonly { valor: string; texto: string; dias: number | null }[] = [
	{ valor: "7", texto: "7 días", dias: 7 },
	{ valor: "30", texto: "30 días", dias: 30 },
	{ valor: "90", texto: "90 días", dias: 90 },
	{ valor: "todo", texto: "Todo", dias: null },
];

/** Un mes es lo que se mira por defecto: lo bastante para que haya tareas cerradas. */
const POR_DEFECTO = "30";

const DIA_MS = 24 * 60 * 60 * 1000;

/** Desde cuándo cuenta el periodo elegido, en ISO 8601 UTC. `todo` no tiene desde. */
function desdeDe(valor: string, ahora: Date): string | undefined {
	const periodo = PERIODOS.find((candidato) => candidato.valor === valor);
	return periodo?.dias === null || periodo?.dias === undefined
		? undefined
		: new Date(ahora.getTime() - periodo.dias * DIA_MS).toISOString();
}

/** Los cuatro enlaces del periodo, con el puesto marcado. Ninguno quita nada: siempre hay uno. */
function selectorPeriodo(elegido: string, urlBase: string): Html {
	return html`<nav class="filtros-rapidos" aria-label="Periodo">
			${PERIODOS.map(
				(periodo) =>
					html`<a class="boton-filtro" href="${urlBase}?dias=${periodo.valor}"${periodo.valor === elegido ? raw(' aria-current="true"') : ""}>${periodo.texto}</a>`,
			)}
		</nav>`;
}

/** Una tabla con su pregunta por título, o el hueco cuando el periodo no tiene datos. */
function bloque(pregunta: string, cabeceras: Html, filas: readonly Html[]): Html {
	return html`<section class="informe">
			<h2>${pregunta}</h2>
			${
				filas.length === 0
					? html`<p class="silencio">Sin datos en este periodo.</p>`
					: html`<div class="tabla-envuelta">
						<table>
							<thead><tr>${cabeceras}</tr></thead>
							<tbody>${filas}</tbody>
						</table>
					</div>`
			}
		</section>`;
}

/** Un modelo sin asignar se enseña como tal, no como una celda vacía. */
function modeloLegible(modelo: string | null): Html {
	return modelo === null ? html`<span class="silencio">sin asignar</span>` : html`${modelo}`;
}

/** Una tasa como porcentaje entero. Sin tasa que dar, la raya. */
function porcentaje(tasa: number | null): Html {
	return tasa === null ? html`<span class="silencio">${SIN_DATO}</span>` : html`${Math.round(tasa * 100)} %`;
}

/** Un número con un decimal: las medias por tarea, que casi nunca son enteras. */
function conDecimal(valor: number | null): Html {
	return valor === null ? html`<span class="silencio">${SIN_DATO}</span>` : html`${valor.toFixed(1).replace(".", ",")}`;
}

function tablaCoste(db: DependenciasWeb["db"], filtro: FiltroInforme): Html {
	const filas = costePorModelo(db, filtro).map(
		(fila) => html`<tr>
			<td>${NOMBRE_FASE[fila.fase]}</td>
			<td>${fila.modelo}</td>
			<td class="numero">${fila.tareas}</td>
			<td class="numero">${tokensAbreviados(fila.tokens)}</td>
			<td class="numero">${tokensAbreviados(fila.tokensPorTarea)}</td>
			<td class="numero">${conDecimal(fila.herramientasPorTarea)}</td>
			<td class="numero">${duracion(fila.duracionMediaMs)}</td>
		</tr>`,
	);
	const cabeceras = html`<th>Fase</th><th>Modelo</th><th class="numero">Tareas</th><th class="numero">Tokens</th>
		<th class="numero">Tokens/tarea</th><th class="numero">Herramientas/tarea</th><th class="numero">Duración media</th>`;
	return bloque("¿Qué cuesta cada modelo?", cabeceras, filas);
}

function tablaInterrupciones(db: DependenciasWeb["db"], filtro: FiltroInforme): Html {
	const filas = interrupcionesPorModelo(db, filtro).map(
		(fila) => html`<tr>
			<td>${fila.modelo}</td>
			<td class="numero">${fila.preguntas}</td>
			<td class="numero">${fila.tareas}</td>
			<td class="numero">${conDecimal(fila.preguntasPorTarea)}</td>
		</tr>`,
	);
	const cabeceras = html`<th>Modelo</th><th class="numero">Preguntas</th><th class="numero">Tareas</th>
		<th class="numero">Preguntas/tarea</th>`;
	return bloque("¿Cuánto interrumpe cada modelo?", cabeceras, filas);
}

function tablaCiclo(db: DependenciasWeb["db"], filtro: FiltroInforme): Html {
	const filas = ciclo(db, filtro).map(
		(fila) => html`<tr>
			<td>${modeloLegible(fila.modelo)}</td>
			<td class="numero">${fila.tareas}</td>
			<td class="numero">${duracion(fila.cicloMs)}</td>
			<td class="numero">${fila.revisionMs === null ? html`<span class="silencio">${SIN_DATO}</span>` : duracion(fila.revisionMs)}</td>
		</tr>`,
	);
	const cabeceras = html`<th>Modelo de ejecución</th><th class="numero">Tareas hechas</th>
		<th class="numero">Ciclo mediano</th><th class="numero">Revisión mediana</th>`;
	return bloque("¿Dónde se atasca el flujo?", cabeceras, filas);
}

function tablaDevoluciones(db: DependenciasWeb["db"], filtro: FiltroInforme): Html {
	const filas = devoluciones(db, filtro).map(
		(fila) => html`<tr>
			<td>${modeloLegible(fila.modelo)}</td>
			<td class="numero">${fila.entradas}</td>
			<td class="numero">${fila.devoluciones}</td>
			<td class="numero">${porcentaje(fila.tasa)}</td>
		</tr>`,
	);
	const cabeceras = html`<th>Modelo de ejecución</th><th class="numero">Entradas en hechas</th>
		<th class="numero">Devoluciones</th><th class="numero">Tasa</th>`;
	return bloque("¿Qué modelo entrega resultados que no valen?", cabeceras, filas);
}

/**
 * El ritmo: una fila por semana con la barra de la tarjeta como gráfico. El
 * máximo de la barra es la semana más alta del periodo, así que lo que se ve
 * es la forma de la serie y no un valor absoluto.
 */
function tablaRitmo(db: DependenciasWeb["db"], filtro: FiltroInforme): Html {
	const semanas = ritmo(db, filtro);
	const maximo = Math.max(1, ...semanas.map((semana) => semana.tareas));
	const filas = semanas.map(
		(semana) => html`<tr>
			<td>${semana.semana}</td>
			<td>${barraProgreso(semana.tareas, maximo, "")}</td>
		</tr>`,
	);
	return bloque("Ritmo", html`<th>Semana</th><th>Tareas hechas</th>`, filas);
}

/** `GET /informes` y `GET /p/:clave/informes`: las cuatro preguntas y el ritmo. */
export function registrarRutasInformes(app: Hono, deps: DependenciasWeb): void {
	const paginaInformes = (c: Context): RespuestaHtml => {
		const acotado = proyectoActual(c);
		const pedido = c.req.query("dias") ?? POR_DEFECTO;
		const elegido = PERIODOS.some((periodo) => periodo.valor === pedido) ? pedido : POR_DEFECTO;
		const filtro: FiltroInforme = { proyectoId: acotado?.id, desde: desdeDe(elegido, new Date()) };
		const desdeCuando = primeraTransicion(deps.db);

		const cuerpo = html`${selectorPeriodo(elegido, `${prefijo(acotado)}/informes`)}
			${tablaCoste(deps.db, filtro)}
			${tablaInterrupciones(deps.db, filtro)}
			${tablaCiclo(deps.db, filtro)}
			${tablaDevoluciones(deps.db, filtro)}
			${tablaRitmo(deps.db, filtro)}
			<p class="silencio pie-informes">
				${
					desdeCuando === null
						? html`Todavía no hay transiciones registradas.`
						: html`Transiciones registradas desde ${fechaLegible(desdeCuando)}.`
				}
			</p>`;

		return c.html(
			pagina({
				...navProyectos(c, deps.db),
				titulo: "Informes",
				proposito: "Qué cuesta cada modelo, cuánto interrumpe y dónde se atasca el flujo.",
				migas:
					acotado === undefined
						? undefined
						: [{ texto: acotado.clave, href: `/p/${acotado.clave}/tareas` }, { texto: "Informes" }],
				usuario: usuarioActual(c),
				vista: "informes",
				cuerpo,
			}),
		);
	};

	app.get("/informes", paginaInformes);
	app.get("/p/:clave/informes", paginaInformes);
}
