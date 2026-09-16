import type { DatabaseSync } from "node:sqlite";
import { ErrorDeRegla } from "../errores.ts";
import { type Actor, registrarActividad } from "./actividad.ts";
import { ahora, enTransaccion, entero, idInsertado, sentencia, texto, textoOpcional } from "./base.ts";
import { type ColorUsuario, colorElegido, esColorUsuario } from "./colores.ts";

/**
 * Proyectos: un repositorio que se trabaja desde una o varias carpetas
 * locales, cada una con su terminal. Las tareas viven en un proyecto y los
 * terminales trabajan para un proyecto.
 *
 * Nada de lo que pasa aquí sube la revisión global: ningún agente ve un
 * proyecto hasta que registra su terminal.
 */

/** Donde cae todo lo que no dice otra cosa. Lo crea la migración y no se borra. */
export const PROYECTO_PRINCIPAL = 1;

export type Proyecto = {
	id: number;
	/** `DEFAULT`, `WEB`, `API2`. Se fija al crear y no se cambia. */
	clave: string;
	nombre: string;
	descripcion: string;
	/** URL del remote de git, ya normalizada. Opcional. */
	repositorio: string | null;
	/** Rama desde la que salen las ramas de las funcionalidades. `main` por defecto. */
	ramaPrincipal: string;
	/** Comando que tiene que pasar la parte que integra la rama. Opcional. */
	verificacion: string | null;
	/** El color de las siglas del proyecto en su chip. */
	color: ColorUsuario;
	creado: string;
};

const COLUMNAS = "id, clave, nombre, descripcion, repositorio, rama_principal, verificacion, color, creado";

function comoProyecto(fila: Record<string, unknown>): Proyecto {
	return {
		id: entero(fila, "id"),
		clave: texto(fila, "clave"),
		nombre: texto(fila, "nombre"),
		descripcion: texto(fila, "descripcion"),
		repositorio: textoOpcional(fila, "repositorio"),
		ramaPrincipal: texto(fila, "rama_principal"),
		verificacion: textoOpcional(fila, "verificacion"),
		color: color(fila),
		creado: texto(fila, "creado"),
	};
}

/** El color de la fila, que la columna guarda con `CHECK`: nunca es otra cosa. */
function color(fila: Record<string, unknown>): ColorUsuario {
	const valor = texto(fila, "color");
	if (!esColorUsuario(valor)) {
		throw new Error(`el proyecto tiene un color que no existe: ${valor}`);
	}
	return valor;
}

/** De dos a ocho caracteres, mayúsculas y cifras, empezando por letra. */
export function esClaveDeProyecto(valor: string): boolean {
	return /^[A-Z][A-Z0-9]{1,7}$/.test(valor);
}

/**
 * Dos URLs de git que solo difieren en los espacios de alrededor, la barra
 * final o el sufijo `.git` son el mismo repositorio. Vacío es `null`: el
 * proyecto que no dice repositorio no comprueba nada.
 */
export function normalizarRepositorio(valor: string | null | undefined): string | null {
	if (valor === null || valor === undefined) {
		return null;
	}
	const limpio = valor
		.trim()
		.replace(/\/+$/, "")
		.replace(/\.git$/, "")
		.replace(/\/+$/, "");
	return limpio === "" ? null : limpio;
}

/** Un texto opcional de formulario: vacío es «no hay». */
function opcional(valor: string | null | undefined): string | null {
	const limpio = valor?.trim() ?? "";
	return limpio === "" ? null : limpio;
}

// --- lectura -----------------------------------------------------------------

/** Todos los proyectos, por orden de alta. El principal es siempre el primero. */
export function listarProyectos(db: DatabaseSync): Proyecto[] {
	return sentencia(db, `SELECT ${COLUMNAS} FROM proyectos ORDER BY id`).all().map(comoProyecto);
}

export function buscarProyectoPorId(db: DatabaseSync, id: number): Proyecto | undefined {
	const fila = sentencia(db, `SELECT ${COLUMNAS} FROM proyectos WHERE id = ?`).get(id);
	return fila === undefined ? undefined : comoProyecto(fila);
}

export function buscarProyectoPorClave(db: DatabaseSync, clave: string): Proyecto | undefined {
	const fila = sentencia(db, `SELECT ${COLUMNAS} FROM proyectos WHERE clave = ?`).get(clave.trim().toUpperCase());
	return fila === undefined ? undefined : comoProyecto(fila);
}

/** Como `buscarProyectoPorClave`, pero una clave que no existe es un error de regla. */
export function exigirProyectoPorClave(db: DatabaseSync, clave: string): Proyecto {
	const proyecto = buscarProyectoPorClave(db, clave);
	if (proyecto === undefined) {
		throw new ErrorDeRegla("proyecto_inexistente", `No existe ningún proyecto con la clave «${clave}».`);
	}
	return proyecto;
}

/** Lo mismo por id. Lo usa la edición de una tarea al cambiarla de proyecto. */
export function exigirProyectoPorId(db: DatabaseSync, id: number): Proyecto {
	const proyecto = buscarProyectoPorId(db, id);
	if (proyecto === undefined) {
		throw new ErrorDeRegla("proyecto_inexistente", `No existe el proyecto ${id}.`);
	}
	return proyecto;
}

/** Cuántas filas de una tabla apuntan al proyecto. Es lo que impide borrarlo. */
function cuantas(conexion: DatabaseSync, tabla: "tareas" | "terminales", proyectoId: number): number {
	const fila = sentencia(conexion, `SELECT COUNT(*) AS total FROM ${tabla} WHERE proyecto_id = ?`).get(proyectoId);
	if (fila === undefined) {
		throw new Error("COUNT(*) no devolvió ninguna fila");
	}
	return entero(fila, "total");
}

// --- escritura ---------------------------------------------------------------

export type NuevoProyecto = {
	clave: string;
	nombre: string;
	descripcion?: string;
	repositorio?: string | null;
	ramaPrincipal?: string | null;
	verificacion?: string | null;
	/** Sin elegirlo, el menos usado entre los proyectos. */
	color?: string;
	/** Sin actor no se escribe actividad, como en el resto de altas. */
	actor?: Actor;
};

/**
 * Crea un proyecto. La clave se fija aquí y no se cambia nunca: va en las URLs
 * de la web, en el chip de las tarjetas y en el frontmatter.
 */
export function crearProyecto(db: DatabaseSync, datos: NuevoProyecto): Proyecto {
	const clave = datos.clave.trim().toUpperCase();
	const nombre = datos.nombre.trim();
	if (!esClaveDeProyecto(clave)) {
		throw new ErrorDeRegla(
			"clave_invalida",
			"La clave del proyecto son de dos a ocho caracteres, mayúsculas y cifras, empezando por letra.",
		);
	}
	if (nombre === "") {
		throw new ErrorDeRegla("nombre_vacio", "El proyecto necesita un nombre.");
	}
	return enTransaccion(db, (conexion) => {
		if (buscarProyectoPorClave(conexion, clave) !== undefined) {
			throw new ErrorDeRegla("clave_repetida", `Ya hay un proyecto con la clave «${clave}».`);
		}
		const cambios = sentencia(
			conexion,
			`INSERT INTO proyectos (clave, nombre, descripcion, repositorio, rama_principal, verificacion, color, creado)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			clave,
			nombre,
			datos.descripcion?.trim() ?? "",
			normalizarRepositorio(datos.repositorio),
			opcional(datos.ramaPrincipal) ?? "main",
			opcional(datos.verificacion),
			colorElegido(conexion, datos.color, "proyectos"),
			ahora(),
		);
		const creado = buscarProyectoPorId(conexion, idInsertado(cambios.lastInsertRowid));
		if (creado === undefined) {
			throw new Error("no se pudo releer el proyecto recién creado");
		}
		if (datos.actor !== undefined) {
			registrarActividad(conexion, {
				actor: datos.actor,
				accion: "alta_proyecto",
				objeto: "proyecto",
				objetoId: creado.id,
				objetoNombre: creado.nombre,
				detalle: `clave ${creado.clave}`,
			});
		}
		return creado;
	});
}

export type EdicionProyecto = {
	proyectoId: number;
	nombre: string;
	descripcion?: string;
	repositorio?: string | null;
	ramaPrincipal?: string | null;
	verificacion?: string | null;
	color?: string;
	actor?: Actor;
};

/** `repositorio: ninguno → https://…`, o nada si el campo se quedó igual. */
function cambioDeTexto(nombre: string, antes: string | null, despues: string | null): string | null {
	if (antes === despues) {
		return null;
	}
	return `${nombre}: ${antes ?? "ninguno"} → ${despues ?? "ninguno"}`;
}

/**
 * Edita un proyecto. La clave no está: se fija al crearlo y no se cambia,
 * porque es lo que va en las URLs ya compartidas.
 */
export function editarProyecto(db: DatabaseSync, datos: EdicionProyecto): Proyecto {
	const nombre = datos.nombre.trim();
	if (nombre === "") {
		throw new ErrorDeRegla("nombre_vacio", "El proyecto necesita un nombre.");
	}
	return enTransaccion(db, (conexion) => {
		const antes = exigirProyectoPorId(conexion, datos.proyectoId);
		const despues: Proyecto = {
			...antes,
			nombre,
			descripcion: datos.descripcion?.trim() ?? antes.descripcion,
			repositorio: datos.repositorio === undefined ? antes.repositorio : normalizarRepositorio(datos.repositorio),
			ramaPrincipal: datos.ramaPrincipal === undefined ? antes.ramaPrincipal : (opcional(datos.ramaPrincipal) ?? "main"),
			verificacion: datos.verificacion === undefined ? antes.verificacion : opcional(datos.verificacion),
			color: datos.color === undefined ? antes.color : colorElegido(conexion, datos.color, "proyectos"),
		};
		sentencia(
			conexion,
			`UPDATE proyectos
				SET nombre = ?, descripcion = ?, repositorio = ?, rama_principal = ?, verificacion = ?, color = ?
				WHERE id = ?`,
		).run(
			despues.nombre,
			despues.descripcion,
			despues.repositorio,
			despues.ramaPrincipal,
			despues.verificacion,
			despues.color,
			antes.id,
		);
		const cambios = [
			antes.nombre === despues.nombre ? null : `nombre: «${antes.nombre}» → «${despues.nombre}»`,
			// Una descripción entera no cabe en una línea de actividad.
			antes.descripcion === despues.descripcion ? null : "descripción",
			cambioDeTexto("repositorio", antes.repositorio, despues.repositorio),
			cambioDeTexto("rama principal", antes.ramaPrincipal, despues.ramaPrincipal),
			cambioDeTexto("verificación", antes.verificacion, despues.verificacion),
			cambioDeTexto("color", antes.color, despues.color),
		].filter((cambio) => cambio !== null);
		// Guardar sin tocar nada no es una acción: no deja rastro.
		if (datos.actor !== undefined && cambios.length > 0) {
			registrarActividad(conexion, {
				actor: datos.actor,
				accion: "editar_proyecto",
				objeto: "proyecto",
				objetoId: antes.id,
				objetoNombre: despues.nombre,
				detalle: cambios.join("; "),
			});
		}
		return despues;
	});
}

/**
 * Borra un proyecto vacío. El principal no se borra nunca: es donde caen las
 * cosas por defecto y donde están las de quien nunca creó otro.
 */
export function borrarProyecto(db: DatabaseSync, proyectoId: number, actor?: Actor): Proyecto {
	return enTransaccion(db, (conexion) => {
		const proyecto = exigirProyectoPorId(conexion, proyectoId);
		if (proyecto.id === PROYECTO_PRINCIPAL) {
			throw new ErrorDeRegla(
				"proyecto_principal",
				"El proyecto principal no se borra: es donde caen las tareas y los terminales que no dicen otro.",
			);
		}
		const tareas = cuantas(conexion, "tareas", proyecto.id);
		if (tareas > 0) {
			throw new ErrorDeRegla(
				"proyecto_con_tareas",
				`El proyecto tiene ${tareas} ${tareas === 1 ? "tarea" : "tareas"}: bórralas o pásalas a otro proyecto.`,
			);
		}
		const terminales = cuantas(conexion, "terminales", proyecto.id);
		if (terminales > 0) {
			throw new ErrorDeRegla(
				"proyecto_con_terminales",
				`El proyecto tiene ${terminales} ${terminales === 1 ? "terminal" : "terminales"}: bórralos primero.`,
			);
		}
		// El rastro se firma antes de borrar: después ya no habría nombre que copiar.
		if (actor !== undefined) {
			registrarActividad(conexion, {
				actor,
				accion: "baja_proyecto",
				objeto: "proyecto",
				objetoId: proyecto.id,
				objetoNombre: proyecto.nombre,
			});
		}
		sentencia(conexion, "DELETE FROM proyectos WHERE id = ?").run(proyecto.id);
		return proyecto;
	});
}
