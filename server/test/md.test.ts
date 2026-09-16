import assert from "node:assert/strict";
import { test } from "node:test";
import { crearAgente } from "../src/db/agentes.ts";
import { registrarConsumo } from "../src/db/consumo.ts";
import { crearParte } from "../src/db/funcionalidades.ts";
import { comentarAnalisis, comentarioDeAgente, comentarResultado, preguntar, responder } from "../src/db/hilo.ts";
import { crearProyecto } from "../src/db/proyectos.ts";
import {
	aprobarEjecucion,
	crearHija,
	crearTareaHumana,
	itemIndiceDe,
	leerTarea,
	listarTareas,
	moverTareaHumano,
	preguntasContestadasDesde,
	type Tarea,
	tareasParaTerminalDesde,
	tomarTarea,
} from "../src/db/tareas.ts";
import { documentoTarea } from "../src/md/documento.ts";
import { formatearId, generarCodigo, parsearId } from "../src/md/ids.ts";
import { lineaIndice } from "../src/md/indice.ts";
import { salidaNovedades } from "../src/md/novedades.ts";
import { codigoDe, montar } from "./comun.ts";

/** El identificador visible de una tarea: lo único que ya no se puede escribir a mano. */
const id = (tarea: { codigo: string }): string => formatearId(tarea.codigo);

/** Las fechas son las únicas que no se pueden fijar en la cadena esperada. */
function sinFechas(markdown: string): string {
	return markdown.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<fecha>");
}

type Banco = ReturnType<typeof montar>;

/**
 * Reproduce con las funciones de la base de datos la tarea del ejemplo de
 * «Formato Markdown» del CLAUDE.md: análisis, pregunta P1, respuesta, dos
 * hijas, comentario, resultado y consumo.
 */
function ejemplo(banco: Banco): { padre: Tarea; hija: Tarea; tests: Tarea } {
	const terminal = banco.portatil;
	const padre = crearTareaHumana(banco.db, {
		titulo: "Exportar el listado de clientes a CSV",
		descripcion:
			"Los comerciales necesitan bajarse el listado de clientes filtrado\npara trabajarlo en su hoja de cálculo. Hoy lo copian a mano.",
		usuarioId: banco.ana,
		analisisModelo: "sonnet",
		analisisTerminalId: terminal,
		ejecucionModelo: "opus",
		ejecucionTerminalId: terminal,
	});
	moverTareaHumano(banco.db, { tareaId: padre.id, usuarioId: banco.ana, estado: "prepared" });
	tomarTarea(banco.db, { tareaId: padre.id, fase: "analisis", terminalId: terminal });
	comentarAnalisis(banco.db, {
		tareaId: padre.id,
		terminalId: terminal,
		texto:
			"Hay que añadir un botón en el listado que descargue lo que se ve en\npantalla con los filtros aplicados. Riesgo: listados muy grandes.",
	});
	tomarTarea(banco.db, { tareaId: padre.id, fase: "ejecucion", terminalId: terminal });
	const p1 = preguntar(banco.db, {
		tareaId: padre.id,
		terminalId: terminal,
		pregunta: "¿Qué separador usamos en el CSV?",
		porQueImporta: "la hoja de cálculo de los comerciales está en español\ny abre mal los ficheros separados por coma.",
		opciones: [
			{ texto: "Coma", consecuencia: "es el estándar, pero los comerciales tendrán que importar a mano." },
			{
				texto: "Punto y coma",
				consecuencia: "se abre directamente en su hoja de cálculo; otros programas pueden fallar.",
			},
			{ texto: "No hacer nada", consecuencia: "no se exporta y siguen copiando a mano." },
		],
		recomendacion: "Punto y coma",
	});
	responder(banco.db, {
		preguntaId: p1.id,
		usuarioId: banco.ana,
		opcion: "Punto y coma",
		nota: "si algún día lo usa otro equipo, ya lo cambiaremos.",
	});
	tomarTarea(banco.db, { tareaId: padre.id, fase: "ejecucion", terminalId: terminal });

	const hija = crearHija(banco.db, {
		titulo: "Generar el fichero CSV",
		descripcion: "El fichero en sí.",
		padreId: padre.id,
		terminalId: terminal,
	});
	const tests = crearHija(banco.db, {
		titulo: "Tests de la exportación",
		descripcion: "Cubrir el botón.",
		padreId: padre.id,
		terminalId: terminal,
	});
	comentarResultado(banco.db, {
		tareaId: tests.id,
		terminalId: terminal,
		texto: "Qué se construyó: los tests.\n\nCommit: bbbbbbb",
	});

	comentarioDeAgente(banco.db, {
		tareaId: padre.id,
		terminalId: terminal,
		texto: "Botón añadido y fichero generándose. Faltan los tests.",
	});
	comentarResultado(banco.db, {
		tareaId: padre.id,
		terminalId: terminal,
		texto:
			"Qué se construyó: botón «Exportar CSV» en el listado de clientes,\nrespeta los filtros activos y separa por punto y coma.\n\nCommit: a1b2c3d",
	});

	registrarConsumo(banco.db, {
		tareaId: padre.id,
		fase: "analisis",
		modelo: "sonnet",
		terminalId: terminal,
		tokens: 31500,
		herramientas: 6,
		duracionMs: 87000,
	});
	registrarConsumo(banco.db, {
		tareaId: padre.id,
		fase: "ejecucion",
		modelo: "opus",
		terminalId: terminal,
		tokens: 184600,
		herramientas: 41,
		duracionMs: 1520000,
	});
	registrarConsumo(banco.db, {
		tareaId: hija.id,
		fase: "ejecucion",
		modelo: "opus",
		terminalId: terminal,
		tokens: 46800,
		herramientas: 9,
		duracionMs: 300000,
	});
	return { padre, hija, tests };
}

const documentoEsperado = ({ padre, hija, tests }: { padre: Tarea; hija: Tarea; tests: Tarea }): string => `---
id: ${id(padre)}
proyecto: DEFAULT
titulo: "Exportar el listado de clientes a CSV"
tipo: tarea
estado: done
orden: 2
autoejecucion: true
marcas: []
analisis:
  modelo: sonnet
  terminal: portatil-ana
ejecucion:
  modelo: opus
  terminal: portatil-ana
creada: <fecha>
consumo:
  analisis:
    modelo: sonnet
    tokens: 31500
    herramientas: 6
    duracionMs: 87000
  ejecucion:
    modelo: opus
    tokens: 184600
    herramientas: 41
    duracionMs: 1520000
  totalConHijas:
    tokens: 262900
revision: 19
---

## Descripción

Los comerciales necesitan bajarse el listado de clientes filtrado
para trabajarlo en su hoja de cálculo. Hoy lo copian a mano.

## Hijas

- ${id(hija)} · doing · Generar el fichero CSV
- ${id(tests)} · done · Tests de la exportación

## Hilo

### analisis · sonnet@portatil-ana · <fecha>

Hay que añadir un botón en el listado que descargue lo que se ve en
pantalla con los filtros aplicados. Riesgo: listados muy grandes.

### pregunta · opus@portatil-ana · <fecha> · P1

**¿Qué separador usamos en el CSV?**

Por qué importa: la hoja de cálculo de los comerciales está en español
y abre mal los ficheros separados por coma.

Opciones:
- **Coma**: es el estándar, pero los comerciales tendrán que importar a mano.
- **Punto y coma**: se abre directamente en su hoja de cálculo; otros programas pueden fallar.
- **No hacer nada**: no se exporta y siguen copiando a mano.

Recomendación: Punto y coma.

### respuesta · humano:ana · <fecha> · P1

Opción: **Punto y coma**

Nota: si algún día lo usa otro equipo, ya lo cambiaremos.

### comentario · opus@portatil-ana · <fecha>

Botón añadido y fichero generándose. Faltan los tests.

### resultado · opus@portatil-ana · <fecha>

Qué se construyó: botón «Exportar CSV» en el listado de clientes,
respeta los filtros activos y separa por punto y coma.

Commit: a1b2c3d`;

test("el identificador lleva de cuatro a ocho caracteres y se lee de vuelta", () => {
	assert.equal(formatearId("K7M3XQ"), "T-K7M3XQ");
	assert.equal(formatearId("0042"), "T-0042");
	assert.equal(parsearId("T-0042"), "0042");
	assert.equal(parsearId("T-K7M3XQ"), "K7M3XQ");
	for (const malo of ["T-42", "42", "t-0042", "T-0042 ", "T-abcd", "T-123456789", ""]) {
		assert.equal(
			codigoDe(() => parsearId(malo)),
			"id_invalido",
		);
	}
});

test("un código nuevo son seis caracteres del alfabeto, y no se repiten", () => {
	const codigos = new Set<string>();
	for (let vuelta = 0; vuelta < 100; vuelta += 1) {
		const codigo = generarCodigo();
		assert.match(codigo, /^[23456789A-HJKMNP-Z]{6}$/);
		codigos.add(codigo);
	}
	assert.equal(codigos.size, 100);
});

test("el documento de la tarea del ejemplo sale carácter a carácter", () => {
	const banco = montar();
	try {
		const tareas = ejemplo(banco);
		const completa = leerTarea(banco.db, tareas.padre.id);
		assert.ok(completa);
		assert.equal(sinFechas(documentoTarea(completa)), documentoEsperado(tareas));
	} finally {
		banco.cerrar();
	}
});

test("el documento de una hija lleva su padre y el de una tarea nueva va vacío", () => {
	const banco = montar();
	try {
		const { padre, hija } = ejemplo(banco);
		const documentoHija = sinFechas(documentoTarea(leerTarea(banco.db, hija.id) ?? assert.fail("sin hija")));
		assert.match(documentoHija, new RegExp(`^padre: ${id(padre)}$`, "m"));
		assert.match(documentoHija, /^marcas: \[en marcha\]$/m);

		const nueva = crearTareaHumana(banco.db, { titulo: "Una nueva", descripcion: "d", usuarioId: banco.ana });
		const documentoNueva = sinFechas(documentoTarea(leerTarea(banco.db, nueva.id) ?? assert.fail("sin tarea")));
		assert.equal(
			documentoNueva,
			`---
id: ${id(nueva)}
proyecto: DEFAULT
titulo: "Una nueva"
tipo: tarea
estado: backlog
orden: 1
autoejecucion: true
marcas: []
analisis:
  modelo: ~
  terminal: ~
ejecucion:
  modelo: ~
  terminal: ~
creada: <fecha>
revision: 20
---

## Descripción

d

## Hijas

Ninguna.

## Hilo

Ninguno.`,
		);
	} finally {
		banco.cerrar();
	}
});

test("el proyecto va en el frontmatter justo debajo del id, y no en la línea de índice", () => {
	const banco = montar();
	try {
		const web = crearProyecto(banco.db, { clave: "WEB", nombre: "La web" });
		const suya = crearTareaHumana(banco.db, {
			titulo: "Pintar el tablero",
			descripcion: "d",
			usuarioId: banco.ana,
			proyectoId: web.id,
		});
		assert.match(
			sinFechas(documentoTarea(leerTarea(banco.db, suya.id) ?? assert.fail("sin tarea"))),
			new RegExp(`^id: ${id(suya)}\nproyecto: WEB\ntitulo: "Pintar el tablero"$`, "m"),
		);

		// Sin decir proyecto, la tarea nace en el principal.
		const principal = crearTareaHumana(banco.db, { titulo: "Otra", descripcion: "d", usuarioId: banco.ana });
		assert.match(
			sinFechas(documentoTarea(leerTarea(banco.db, principal.id) ?? assert.fail("sin tarea"))),
			new RegExp(`^id: ${id(principal)}\nproyecto: DEFAULT\n`, "m"),
		);

		// El índice no lo lleva: el agente solo ve tareas de su proyecto.
		assert.equal(
			lineaIndice(itemIndiceDe(banco.db, suya.id)),
			`- ${id(suya)} · backlog · Pintar el tablero · analisis: sin asignar · ejecucion: sin asignar`,
		);
	} finally {
		banco.cerrar();
	}
});

test("una pregunta se ve en el frontmatter y no lleva bloque ni segmento de ejecución", () => {
	const banco = montar();
	try {
		const pregunta = crearTareaHumana(banco.db, {
			titulo: "¿Cuánto se tarda hoy en cerrar el mes?",
			descripcion: "Quiero saberlo antes de pedir nada.",
			usuarioId: banco.ana,
			tipo: "pregunta",
			analisisModelo: "sonnet",
			analisisTerminalId: banco.portatil,
		});
		moverTareaHumano(banco.db, { tareaId: pregunta.id, usuarioId: banco.ana, estado: "prepared" });

		const documento = sinFechas(documentoTarea(leerTarea(banco.db, pregunta.id) ?? assert.fail("sin tarea")));
		assert.match(documento, /^titulo: "¿Cuánto se tarda hoy en cerrar el mes\?"\ntipo: pregunta\nestado: prepared$/m);
		assert.match(documento, /^analisis:\n {2}modelo: sonnet\n {2}terminal: portatil-ana$/m);
		assert.doesNotMatch(documento, /^ejecucion:$/m);

		assert.equal(
			lineaIndice(itemIndiceDe(banco.db, pregunta.id)),
			`- ${id(pregunta)} · prepared · pregunta · ¿Cuánto se tarda hoy en cerrar el mes? · analisis: sonnet@portatil-ana`,
		);

		// Las marcas van después de «pregunta», nunca antes.
		const sinAsignar = crearTareaHumana(banco.db, {
			titulo: "¿Y el cierre de año?",
			descripcion: "d",
			usuarioId: banco.ana,
			tipo: "pregunta",
		});
		moverTareaHumano(banco.db, { tareaId: sinAsignar.id, usuarioId: banco.ana, estado: "prepared" });
		assert.equal(
			lineaIndice(itemIndiceDe(banco.db, sinAsignar.id)),
			`- ${id(sinAsignar)} · prepared · pregunta · sin terminal · ¿Y el cierre de año? · analisis: sin asignar`,
		);
	} finally {
		banco.cerrar();
	}
});

test("la línea de índice pone las marcas entre el estado y el título", () => {
	const banco = montar();
	try {
		const { padre, hija, tests } = ejemplo(banco);
		const suelta = crearTareaHumana(banco.db, {
			titulo: "Migrar el envío de correos a la cola",
			descripcion: "d",
			usuarioId: banco.ana,
		});
		const lineas = listarTareas(banco.db, {}).map(lineaIndice);
		assert.deepEqual(lineas, [
			`- ${id(suelta)} · backlog · Migrar el envío de correos a la cola · analisis: sin asignar · ejecucion: sin asignar`,
			`- ${id(hija)} · doing · en marcha · Generar el fichero CSV · analisis: sonnet · ejecucion: opus@portatil-ana · padre: ${id(padre)}`,
			`- ${id(tests)} · done · Tests de la exportación · analisis: sonnet · ejecucion: opus@portatil-ana · padre: ${id(padre)}`,
			`- ${id(padre)} · done · Exportar el listado de clientes a CSV · analisis: sonnet@portatil-ana · ejecucion: opus@portatil-ana`,
		]);
	} finally {
		banco.cerrar();
	}
});

test("el presupuesto va tras la autoejecución, y pasarse es una marca más", () => {
	const banco = montar();
	try {
		const tarea = crearTareaHumana(banco.db, {
			titulo: "Exportar el listado",
			descripcion: "d",
			usuarioId: banco.ana,
			presupuesto: 200_000,
		});
		const documento = (): string => sinFechas(documentoTarea(leerTarea(banco.db, tarea.id) ?? assert.fail("sin tarea")));

		assert.match(documento(), /^autoejecucion: true\npresupuesto: 200000\nmarcas: \[\]$/m);
		assert.equal(
			lineaIndice(itemIndiceDe(banco.db, tarea.id)),
			`- ${id(tarea)} · backlog · Exportar el listado · analisis: sin asignar · ejecucion: sin asignar`,
		);

		registrarConsumo(banco.db, {
			tareaId: tarea.id,
			fase: "ejecucion",
			modelo: "opus",
			terminalId: banco.portatil,
			tokens: 250_000,
			herramientas: 9,
			duracionMs: 1_000,
		});
		assert.match(documento(), /^marcas: \[sobre presupuesto\]$/m);
		assert.equal(
			lineaIndice(itemIndiceDe(banco.db, tarea.id)),
			`- ${id(tarea)} · backlog · sobre presupuesto · Exportar el listado · analisis: sin asignar · ejecucion: sin asignar`,
		);

		// Sin tope no hay línea en el frontmatter: no diría nada.
		const sinTope = crearTareaHumana(banco.db, { titulo: "Sin tope", descripcion: "d", usuarioId: banco.ana });
		assert.doesNotMatch(
			sinFechas(documentoTarea(leerTarea(banco.db, sinTope.id) ?? assert.fail("sin tarea"))),
			/presupuesto/,
		);
	} finally {
		banco.cerrar();
	}
});

test("novedades lista lo cambiado y las preguntas contestadas, y sin nada solo la revisión", () => {
	const banco = montar();
	try {
		const { padre, hija } = ejemplo(banco);
		const salida = salidaNovedades({
			revision: 190,
			tareas: tareasParaTerminalDesde(banco.db, { terminalId: banco.portatil, revision: 0 }),
			preguntas: preguntasContestadasDesde(banco.db, { terminalId: banco.portatil, revision: 0 }),
		});
		assert.equal(
			salida,
			`revision: 190

## Tareas nuevas o cambiadas

- ${id(hija)} · doing · en marcha · Generar el fichero CSV · analisis: sonnet · ejecucion: opus@portatil-ana · padre: ${id(padre)}

## Preguntas contestadas

- ${id(padre)} · P1 · Punto y coma`,
		);

		assert.equal(salidaNovedades({ revision: 190, tareas: [], preguntas: [] }), "revision: 190");
	} finally {
		banco.cerrar();
	}
});

test("una funcionalidad enseña su rama, su progreso y sus partes; una parte, su padre y sus dependencias", () => {
	const banco = montar();
	try {
		const evolutivo = crearTareaHumana(banco.db, {
			titulo: "Que los comerciales se bajen sus listados",
			descripcion: "Hoy copian los datos a mano y se equivocan.",
			usuarioId: banco.ana,
			tipo: "funcionalidad",
			rama: "evolutivo/csv",
			analisisModelo: "sonnet",
			analisisTerminalId: banco.portatil,
			ejecucionModelo: "opus",
			ejecucionTerminalId: banco.portatil,
		});
		moverTareaHumano(banco.db, { tareaId: evolutivo.id, usuarioId: banco.ana, estado: "prepared" });
		tomarTarea(banco.db, { tareaId: evolutivo.id, fase: "analisis", terminalId: banco.portatil });
		const datos = crearParte(banco.db, {
			titulo: "Sacar los datos del listado",
			descripcion: "Con los filtros puestos.",
			padreId: evolutivo.id,
			terminalId: banco.portatil,
		});
		const boton = crearParte(banco.db, {
			titulo: "Poner el botón de descarga",
			descripcion: "En la pantalla de clientes.",
			padreId: evolutivo.id,
			terminalId: banco.portatil,
			dependeDe: [datos.id],
		});
		comentarAnalisis(banco.db, {
			tareaId: evolutivo.id,
			terminalId: banco.portatil,
			texto: "Dos partes: los datos y el botón.",
		});
		aprobarEjecucion(banco.db, { tareaId: evolutivo.id, usuarioId: banco.ana });
		// La parte que integra la rama la crea el servidor al aprobar: es la última.
		const integrar =
			listarTareas(banco.db, {}).find((item) => item.titulo.startsWith("Integrar la rama")) ??
			assert.fail("sin parte de integración");

		// La funcionalidad: rama, progreso, sin bloque de ejecución y con sus
		// partes en el bloque de hijas, cada una con lo que la precede.
		assert.equal(
			sinFechas(documentoTarea(leerTarea(banco.db, evolutivo.id) ?? assert.fail("sin funcionalidad"))),
			`---
id: ${id(evolutivo)}
proyecto: DEFAULT
titulo: "Que los comerciales se bajen sus listados"
tipo: funcionalidad
estado: doing
orden: 1
autoejecucion: true
rama: evolutivo/csv
marcas: []
partes: 3
partesCerradas: 0
analisis:
  modelo: sonnet
  terminal: portatil-ana
creada: <fecha>
revision: 10
---

## Descripción

Hoy copian los datos a mano y se equivocan.

## Hijas

- ${id(datos)} · prepared · Sacar los datos del listado
- ${id(boton)} · prepared · Poner el botón de descarga · depende de: ${id(datos)}
- ${id(integrar)} · prepared · Integrar la rama \`evolutivo/csv\` en la principal · depende de: ${id(datos)}, ${id(boton)}

## Hilo

### analisis · sonnet@portatil-ana · <fecha>

Dos partes: los datos y el botón.`,
		);

		// La parte: su padre, la rama heredada, de qué depende y la marca de que espera.
		const documentoParte = sinFechas(documentoTarea(leerTarea(banco.db, boton.id) ?? assert.fail("sin parte")));
		assert.match(
			documentoParte,
			new RegExp(
				`^padre: ${id(evolutivo)}\nautoejecucion: true\nrama: evolutivo/csv\ndependeDe: \\[${id(datos)}\\]$`,
				"m",
			),
		);
		assert.match(documentoParte, /^marcas: \[esperando\]$/m);
		assert.match(documentoParte, /^ejecucion:\n {2}modelo: opus$/m);

		assert.equal(
			lineaIndice(itemIndiceDe(banco.db, evolutivo.id)),
			`- ${id(evolutivo)} · doing · funcionalidad 0/3 · Que los comerciales se bajen sus listados · analisis: sonnet@portatil-ana`,
		);
		assert.equal(
			lineaIndice(itemIndiceDe(banco.db, boton.id)),
			`- ${id(boton)} · prepared · esperando · Poner el botón de descarga · analisis: sonnet@portatil-ana · ejecucion: opus@portatil-ana · padre: ${id(evolutivo)}`,
		);
	} finally {
		banco.cerrar();
	}
});

test("el agente va como primera línea del bloque de la fase y entre paréntesis en el índice", () => {
	const banco = montar();
	try {
		const revisor = crearAgente(banco.db, {
			nombre: "revisor",
			instrucciones: "Eres el revisor.",
			modelo: "sonnet",
			terminalId: banco.portatil,
		});
		const suelto = crearAgente(banco.db, { nombre: "redactor", instrucciones: "Eres el redactor.", modelo: "haiku" });
		const tarea = crearTareaHumana(banco.db, {
			titulo: "Exportar el listado",
			descripcion: "d",
			usuarioId: banco.ana,
			analisisAgenteId: revisor.id,
			ejecucionAgenteId: suelto.id,
		});
		const documento = sinFechas(documentoTarea(leerTarea(banco.db, tarea.id) ?? assert.fail("sin tarea")));

		// Modelo y terminal son los del agente: la fase no los elige a mano.
		assert.match(documento, /^analisis:\n {2}agente: revisor\n {2}modelo: sonnet\n {2}terminal: portatil-ana$/m);
		assert.match(documento, /^ejecucion:\n {2}agente: redactor\n {2}modelo: haiku\n {2}terminal: ~$/m);
		assert.equal(
			lineaIndice(itemIndiceDe(banco.db, tarea.id)),
			`- ${id(tarea)} · backlog · Exportar el listado · analisis: sonnet@portatil-ana (revisor) · ejecucion: haiku (redactor)`,
		);

		// Sin agente, la línea no aparece y el índice va como siempre.
		const sinPapel = crearTareaHumana(banco.db, { titulo: "Sin papel", descripcion: "d", usuarioId: banco.ana });
		assert.doesNotMatch(
			sinFechas(documentoTarea(leerTarea(banco.db, sinPapel.id) ?? assert.fail("sin tarea"))),
			/agente:/,
		);
		assert.equal(
			lineaIndice(itemIndiceDe(banco.db, sinPapel.id)),
			`- ${id(sinPapel)} · backlog · Sin papel · analisis: sin asignar · ejecucion: sin asignar`,
		);
	} finally {
		banco.cerrar();
	}
});
