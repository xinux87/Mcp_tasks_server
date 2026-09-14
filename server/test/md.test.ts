import assert from "node:assert/strict";
import { test } from "node:test";
import { registrarConsumo } from "../src/db/consumo.ts";
import { crearParte } from "../src/db/funcionalidades.ts";
import { comentarAnalisis, comentarAvance, comentarResultado, preguntar, responder } from "../src/db/hilo.ts";
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
	tareasParaTerminalDesde,
	tomarTarea,
} from "../src/db/tareas.ts";
import { documentoTarea } from "../src/md/documento.ts";
import { formatearId, parsearId } from "../src/md/ids.ts";
import { lineaIndice } from "../src/md/indice.ts";
import { salidaNovedades } from "../src/md/novedades.ts";
import { codigoDe, montar } from "./comun.ts";

/** Las fechas son las únicas que no se pueden fijar en la cadena esperada. */
function sinFechas(markdown: string): string {
	return markdown.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<fecha>");
}

type Banco = ReturnType<typeof montar>;

/**
 * Reproduce con las funciones de la base de datos la tarea del ejemplo de
 * «Formato Markdown» del CLAUDE.md: análisis, pregunta P1, respuesta, dos
 * hijas, avance, resultado y consumo.
 */
function ejemplo(banco: Banco): { padre: number; hija: number } {
	const terminal = banco.portatil;
	const padre = crearTareaHumana(banco.db, {
		titulo: "Exportar el listado de clientes a CSV",
		descripcion:
			"Los comerciales necesitan bajarse el listado de clientes filtrado\npara trabajarlo en su hoja de cálculo. Hoy lo copian a mano.",
		usuarioId: banco.xinux,
		analisisModelo: "sonnet",
		analisisTerminalId: terminal,
		ejecucionModelo: "opus",
		ejecucionTerminalId: terminal,
	});
	moverTareaHumano(banco.db, { tareaId: padre.id, usuarioId: banco.xinux, estado: "prepared" });
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
		usuarioId: banco.xinux,
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

	comentarAvance(banco.db, {
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
	return { padre: padre.id, hija: hija.id };
}

const DOCUMENTO_ESPERADO = `---
id: T-0001
proyecto: PRI
titulo: "Exportar el listado de clientes a CSV"
tipo: tarea
estado: done
orden: 2
autoejecucion: true
marcas: []
analisis:
  modelo: sonnet
  terminal: portatil-xinux
ejecucion:
  modelo: opus
  terminal: portatil-xinux
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

- T-0002 · doing · Generar el fichero CSV
- T-0003 · done · Tests de la exportación

## Hilo

### analisis · sonnet@portatil-xinux · <fecha>

Hay que añadir un botón en el listado que descargue lo que se ve en
pantalla con los filtros aplicados. Riesgo: listados muy grandes.

### pregunta · opus@portatil-xinux · <fecha> · P1

**¿Qué separador usamos en el CSV?**

Por qué importa: la hoja de cálculo de los comerciales está en español
y abre mal los ficheros separados por coma.

Opciones:
- **Coma**: es el estándar, pero los comerciales tendrán que importar a mano.
- **Punto y coma**: se abre directamente en su hoja de cálculo; otros programas pueden fallar.
- **No hacer nada**: no se exporta y siguen copiando a mano.

Recomendación: Punto y coma.

### respuesta · humano:xinux · <fecha> · P1

Opción: **Punto y coma**

Nota: si algún día lo usa otro equipo, ya lo cambiaremos.

### avance · opus@portatil-xinux · <fecha>

Botón añadido y fichero generándose. Faltan los tests.

### resultado · opus@portatil-xinux · <fecha>

Qué se construyó: botón «Exportar CSV» en el listado de clientes,
respeta los filtros activos y separa por punto y coma.

Commit: a1b2c3d`;

test("los identificadores llevan cuatro cifras como mínimo y se leen de vuelta", () => {
	assert.equal(formatearId(42), "T-0042");
	assert.equal(formatearId(1), "T-0001");
	assert.equal(formatearId(123456), "T-123456");
	assert.equal(parsearId("T-0042"), 42);
	assert.equal(parsearId("T-123456"), 123456);
	for (const malo of ["T-42", "42", "t-0042", "T-0042 ", "T-abcd", ""]) {
		assert.equal(
			codigoDe(() => parsearId(malo)),
			"id_invalido",
		);
	}
});

test("el documento de la tarea del ejemplo sale carácter a carácter", () => {
	const banco = montar();
	try {
		const { padre } = ejemplo(banco);
		const completa = leerTarea(banco.db, padre);
		assert.ok(completa);
		assert.equal(sinFechas(documentoTarea(completa)), DOCUMENTO_ESPERADO);
	} finally {
		banco.cerrar();
	}
});

test("el documento de una hija lleva su padre y el de una tarea nueva va vacío", () => {
	const banco = montar();
	try {
		const { hija } = ejemplo(banco);
		const documentoHija = sinFechas(documentoTarea(leerTarea(banco.db, hija) ?? assert.fail("sin hija")));
		assert.match(documentoHija, /^padre: T-0001$/m);
		assert.match(documentoHija, /^marcas: \[en marcha\]$/m);

		const nueva = crearTareaHumana(banco.db, { titulo: "Una nueva", descripcion: "d", usuarioId: banco.xinux });
		const documentoNueva = sinFechas(documentoTarea(leerTarea(banco.db, nueva.id) ?? assert.fail("sin tarea")));
		assert.equal(
			documentoNueva,
			`---
id: T-0004
proyecto: PRI
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
			usuarioId: banco.xinux,
			proyectoId: web.id,
		});
		assert.match(
			sinFechas(documentoTarea(leerTarea(banco.db, suya.id) ?? assert.fail("sin tarea"))),
			/^id: T-0001\nproyecto: WEB\ntitulo: "Pintar el tablero"$/m,
		);

		// Sin decir proyecto, la tarea nace en el principal.
		const principal = crearTareaHumana(banco.db, { titulo: "Otra", descripcion: "d", usuarioId: banco.xinux });
		assert.match(
			sinFechas(documentoTarea(leerTarea(banco.db, principal.id) ?? assert.fail("sin tarea"))),
			/^id: T-0002\nproyecto: PRI\n/m,
		);

		// El índice no lo lleva: el agente solo ve tareas de su proyecto.
		assert.equal(
			lineaIndice(itemIndiceDe(banco.db, suya.id)),
			"- T-0001 · backlog · Pintar el tablero · analisis: sin asignar · ejecucion: sin asignar",
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
			usuarioId: banco.xinux,
			tipo: "pregunta",
			analisisModelo: "sonnet",
			analisisTerminalId: banco.portatil,
		});
		moverTareaHumano(banco.db, { tareaId: pregunta.id, usuarioId: banco.xinux, estado: "prepared" });

		const documento = sinFechas(documentoTarea(leerTarea(banco.db, pregunta.id) ?? assert.fail("sin tarea")));
		assert.match(documento, /^titulo: "¿Cuánto se tarda hoy en cerrar el mes\?"\ntipo: pregunta\nestado: prepared$/m);
		assert.match(documento, /^analisis:\n {2}modelo: sonnet\n {2}terminal: portatil-xinux$/m);
		assert.doesNotMatch(documento, /^ejecucion:$/m);

		assert.equal(
			lineaIndice(itemIndiceDe(banco.db, pregunta.id)),
			"- T-0001 · prepared · pregunta · ¿Cuánto se tarda hoy en cerrar el mes? · analisis: sonnet@portatil-xinux",
		);

		// Las marcas van después de «pregunta», nunca antes.
		const sinAsignar = crearTareaHumana(banco.db, {
			titulo: "¿Y el cierre de año?",
			descripcion: "d",
			usuarioId: banco.xinux,
			tipo: "pregunta",
		});
		moverTareaHumano(banco.db, { tareaId: sinAsignar.id, usuarioId: banco.xinux, estado: "prepared" });
		assert.equal(
			lineaIndice(itemIndiceDe(banco.db, sinAsignar.id)),
			"- T-0002 · prepared · pregunta · sin terminal · ¿Y el cierre de año? · analisis: sin asignar",
		);
	} finally {
		banco.cerrar();
	}
});

test("la línea de índice pone las marcas entre el estado y el título", () => {
	const banco = montar();
	try {
		ejemplo(banco);
		crearTareaHumana(banco.db, {
			titulo: "Migrar el envío de correos a la cola",
			descripcion: "d",
			usuarioId: banco.xinux,
		});
		const lineas = listarTareas(banco.db, {}).map(lineaIndice);
		assert.deepEqual(lineas, [
			"- T-0004 · backlog · Migrar el envío de correos a la cola · analisis: sin asignar · ejecucion: sin asignar",
			"- T-0002 · doing · en marcha · Generar el fichero CSV · analisis: sonnet · ejecucion: opus@portatil-xinux · padre: T-0001",
			"- T-0003 · done · Tests de la exportación · analisis: sonnet · ejecucion: opus@portatil-xinux · padre: T-0001",
			"- T-0001 · done · Exportar el listado de clientes a CSV · analisis: sonnet@portatil-xinux · ejecucion: opus@portatil-xinux",
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
			usuarioId: banco.xinux,
			presupuesto: 200_000,
		});
		const documento = (): string => sinFechas(documentoTarea(leerTarea(banco.db, tarea.id) ?? assert.fail("sin tarea")));

		assert.match(documento(), /^autoejecucion: true\npresupuesto: 200000\nmarcas: \[\]$/m);
		assert.equal(
			lineaIndice(itemIndiceDe(banco.db, tarea.id)),
			"- T-0001 · backlog · Exportar el listado · analisis: sin asignar · ejecucion: sin asignar",
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
			"- T-0001 · backlog · sobre presupuesto · Exportar el listado · analisis: sin asignar · ejecucion: sin asignar",
		);

		// Sin tope no hay línea en el frontmatter: no diría nada.
		const sinTope = crearTareaHumana(banco.db, { titulo: "Sin tope", descripcion: "d", usuarioId: banco.xinux });
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
		ejemplo(banco);
		const salida = salidaNovedades({
			revision: 190,
			tareas: tareasParaTerminalDesde(banco.db, { terminalId: banco.portatil, revision: 0 }),
			preguntas: preguntasContestadasDesde(banco.db, { terminalId: banco.portatil, revision: 0 }),
		});
		assert.equal(
			salida,
			`revision: 190

## Tareas nuevas o cambiadas

- T-0002 · doing · en marcha · Generar el fichero CSV · analisis: sonnet · ejecucion: opus@portatil-xinux · padre: T-0001

## Preguntas contestadas

- T-0001 · P1 · Punto y coma`,
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
			usuarioId: banco.xinux,
			tipo: "funcionalidad",
			rama: "evolutivo/csv",
			analisisModelo: "sonnet",
			analisisTerminalId: banco.portatil,
			ejecucionModelo: "opus",
			ejecucionTerminalId: banco.portatil,
		});
		moverTareaHumano(banco.db, { tareaId: evolutivo.id, usuarioId: banco.xinux, estado: "prepared" });
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
		aprobarEjecucion(banco.db, { tareaId: evolutivo.id, usuarioId: banco.xinux });

		// La funcionalidad: rama, progreso, sin bloque de ejecución y con sus
		// partes en el bloque de hijas, cada una con lo que la precede.
		assert.equal(
			sinFechas(documentoTarea(leerTarea(banco.db, evolutivo.id) ?? assert.fail("sin funcionalidad"))),
			`---
id: T-0001
proyecto: PRI
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
  terminal: portatil-xinux
creada: <fecha>
revision: 10
---

## Descripción

Hoy copian los datos a mano y se equivocan.

## Hijas

- T-0002 · prepared · Sacar los datos del listado
- T-0003 · prepared · Poner el botón de descarga · depende de: T-0002
- T-0004 · prepared · Integrar la rama \`evolutivo/csv\` en la principal · depende de: T-0002, T-0003

## Hilo

### analisis · sonnet@portatil-xinux · <fecha>

Dos partes: los datos y el botón.`,
		);

		// La parte: su padre, la rama heredada, de qué depende y la marca de que espera.
		const documentoParte = sinFechas(documentoTarea(leerTarea(banco.db, boton.id) ?? assert.fail("sin parte")));
		assert.match(documentoParte, /^padre: T-0001\nautoejecucion: true\nrama: evolutivo\/csv\ndependeDe: \[T-0002\]$/m);
		assert.match(documentoParte, /^marcas: \[esperando\]$/m);
		assert.match(documentoParte, /^ejecucion:\n {2}modelo: opus$/m);

		assert.equal(
			lineaIndice(itemIndiceDe(banco.db, evolutivo.id)),
			"- T-0001 · doing · funcionalidad 0/3 · Que los comerciales se bajen sus listados · analisis: sonnet@portatil-xinux",
		);
		assert.equal(
			lineaIndice(itemIndiceDe(banco.db, boton.id)),
			"- T-0003 · prepared · esperando · Poner el botón de descarga · analisis: sonnet@portatil-xinux · ejecucion: opus@portatil-xinux · padre: T-0001",
		);
	} finally {
		banco.cerrar();
	}
});
