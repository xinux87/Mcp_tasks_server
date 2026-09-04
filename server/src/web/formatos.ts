/** Rellena a dos cifras: 7 → `07`. */
function dosCifras(valor: number): string {
	return String(valor).padStart(2, "0");
}

/** Lo que se escribe donde no hay dato. */
export const SIN_DATO = "—";

/**
 * Helper único de fechas de la web: `2026-09-04 12:00`, en hora local del
 * servidor. Las fechas se guardan en ISO 8601 UTC; aquí se traducen a la hora
 * de quien mira el servidor, que es lo legible.
 */
export function fechaLegible(valor: string | Date | null): string {
	if (valor === null) {
		return SIN_DATO;
	}
	const fecha = typeof valor === "string" ? new Date(valor) : valor;
	if (Number.isNaN(fecha.getTime())) {
		return SIN_DATO;
	}
	const dia = `${fecha.getFullYear()}-${dosCifras(fecha.getMonth() + 1)}-${dosCifras(fecha.getDate())}`;
	return `${dia} ${dosCifras(fecha.getHours())}:${dosCifras(fecha.getMinutes())}`;
}

/**
 * Duración en milisegundos como texto: `1 m 25 s`, `2 h 5 m 3 s`, `40 s`. El
 * consumo se reporta en milisegundos y nadie lee milisegundos.
 */
export function duracionLegible(ms: number): string {
	const segundosTotales = Math.max(0, Math.round(ms / 1000));
	const horas = Math.floor(segundosTotales / 3600);
	const minutos = Math.floor((segundosTotales % 3600) / 60);
	const segundos = segundosTotales % 60;
	if (horas > 0) {
		return `${horas} h ${minutos} m ${segundos} s`;
	}
	if (minutos > 0) {
		return `${minutos} m ${segundos} s`;
	}
	return `${segundos} s`;
}

/** Miles separados por punto: 262900 → `262.900`. Los tokens se cuentan en cientos de miles. */
export function numeroLegible(valor: number): string {
	return String(Math.trunc(valor)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Una fase como `modelo@terminal`, con «sin asignar» cuando no hay ninguno de los dos. */
export function faseLegible(modelo: string | null, terminal: string | null): string {
	if (modelo !== null && terminal !== null) {
		return `${modelo}@${terminal}`;
	}
	if (modelo !== null) {
		return modelo;
	}
	if (terminal !== null) {
		return `@${terminal}`;
	}
	return "sin asignar";
}
