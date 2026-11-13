import { ErrorDeRegla } from "../errores.ts";

/**
 * Forma de un código de tarea: `FE` (funcionalidad) o `US` (tarea o pregunta)
 * y cinco cifras hexadecimales o más, que siguen a seis cuando se agotan. Se
 * acepta en minúsculas y se normaliza a mayúsculas, que es como se guarda.
 */
const FORMA_ID = /^(?:FE|US)[0-9A-F]{5,}$/i;

/**
 * El código normalizado: `us0002a` → `US0002A`. Lanza `ErrorDeRegla` si el
 * formato no es válido, porque quien lo pasa mal es siempre un agente y el
 * mensaje se le enseña tal cual.
 */
export function parsearId(id: string): string {
	const codigo = idONull(id);
	if (codigo === null) {
		throw new ErrorDeRegla("id_invalido", `«${id}» no es un identificador de tarea; tiene la forma US0002A.`);
	}
	return codigo;
}

/**
 * El mismo código, pero `null` cuando no tiene la forma buena. Es lo que
 * necesitan los filtros y los desplegables de la web: un valor que no encaja no
 * es un error del que avisar, simplemente no selecciona nada.
 */
export function idONull(id: string): string | null {
	return FORMA_ID.test(id) ? id.toUpperCase() : null;
}
