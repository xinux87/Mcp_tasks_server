/**
 * El icono de TABO Tasks, como constantes. Es un tablero: fondo negro
 * redondeado, tarjetas en el verde de la marca y una en el naranja, la que
 * espera por ti. No hay archivos en disco, como con el CSS y el JavaScript:
 * `estaticos.ts` los sirve en `/static/icono.svg` y `/static/favicon.svg`, y la
 * plantilla incrusta `MARCA` en línea para que no cueste una petición.
 *
 * Los dos llevan `viewBox` y ninguna medida: el tamaño lo pone la hoja de
 * estilos (`.marca svg` a 20 px, `.marca-entrada svg` a 40 px).
 */

/** La marca: ocho tarjetas en tres columnas. Va junto al nombre. */
export const MARCA = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="0" y="0" width="64" height="64" rx="14" fill="#0d0f0c"></rect>
<rect x="9" y="13" width="13" height="10" rx="2.5" fill="#39f26f"></rect>
<rect x="9" y="27" width="13" height="10" rx="2.5" fill="#39f26f"></rect>
<rect x="9" y="41" width="13" height="10" rx="2.5" fill="#39f26f" opacity="0.4"></rect>
<rect x="25.5" y="13" width="13" height="10" rx="2.5" fill="#ff7a1a"></rect>
<rect x="25.5" y="27" width="13" height="10" rx="2.5" fill="#39f26f" opacity="0.4"></rect>
<rect x="42" y="13" width="13" height="10" rx="2.5" fill="#39f26f"></rect>
<rect x="42" y="27" width="13" height="10" rx="2.5" fill="#39f26f"></rect>
<rect x="42" y="41" width="13" height="10" rx="2.5" fill="#39f26f"></rect></svg>`;

/** El favicon: la misma idea con cuatro tarjetas grandes, legible a 16 px. */
export const FAVICON = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="64" height="64" rx="14" fill="#0d0f0c"></rect>
<rect x="11" y="12" width="19" height="16" rx="4" fill="#ff7a1a"></rect>
<rect x="11" y="34" width="19" height="16" rx="4" fill="#39f26f" opacity="0.45"></rect>
<rect x="34" y="12" width="19" height="16" rx="4" fill="#39f26f"></rect>
<rect x="34" y="34" width="19" height="16" rx="4" fill="#39f26f"></rect></svg>`;
