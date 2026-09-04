import assert from "node:assert/strict";
import { test } from "node:test";
import { registrarConsumo } from "../src/db/consumo.ts";
import { comentarAnalisis, comentarAvance, comentarResultado, preguntar, responder } from "../src/db/hilo.ts";
import {
	crearHija,
	crearTareaHumana,
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
titulo: "Exportar el listado de clientes a CSV"
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
titulo: "Una nueva"
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
			"- T-0002 · doing · en marcha · Generar el fichero CSV · analisis: sonnet · ejecucion: opus@portatil-xinux",
			"- T-0003 · done · Tests de la exportación · analisis: sonnet · ejecucion: opus@portatil-xinux",
			"- T-0001 · done · Exportar el listado de clientes a CSV · analisis: sonnet@portatil-xinux · ejecucion: opus@portatil-xinux",
		]);
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

- T-0002 · doing · en marcha · Generar el fichero CSV · analisis: sonnet · ejecucion: opus@portatil-xinux

## Preguntas contestadas

- T-0001 · P1 · Punto y coma`,
		);

		assert.equal(salidaNovedades({ revision: 190, tareas: [], preguntas: [] }), "revision: 190");
	} finally {
		banco.cerrar();
	}
});
