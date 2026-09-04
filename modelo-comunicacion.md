# Modelo de comunicación — mesa de decisiones

Punto de partida para la herramienta. Define **qué se intercambia** y **para qué**, no cómo se transporta.

## Para qué sirve

El humano responsable es el cuello de botella del proyecto por diseño: hay mucho trabajo que solo avanza con una decisión suya, y él no puede estar delante todo el tiempo. Este canal existe para que **su tiempo se gaste en decidir y no en estar disponible**.

Invierte tres cosas de una pregunta hecha en directo: es **asíncrono** (no exige que esté), **persistente** (la decisión se puede consultar tres meses después) y **desordenado** (contesta lo que quiere, cuando tiene el contexto).

## Las cuatro entidades

| Entidad | Dirección | Qué es |
|---|---|---|
| **Tema** | Claude → humano | Una decisión pendiente, con su contexto y sus opciones |
| **Respuesta** | humano → Claude | La opción elegida, más una nota libre |
| **Ejecución** | Claude → humano | En qué punto está esa decisión y qué se construyó |
| **Encargo** | humano → Claude | Algo que el humano pide; Claude lo analiza y lo asume |

Una **pregunta** del humano es un encargo cuya salida es una respuesta escrita, no código.

## Campos

**Tema** — `id`, `severidad` (`dinero` · `bloquea` · `info`), `titulo`, `pregunta`, `porQueImporta`, `opciones[]` (cada una con **su consecuencia**, incluida la de no hacer nada), `recomendacion`, `donde` (opcional: dónde leer más, nunca dónde hay que leer para poder decidir).

**Respuesta** — `temaId`, `opcion`, `nota`, `ts`.

**Ejecución** — `temaId`, `fase` (`esperando` · `curso` · `hecho`), `que` (qué se construyó, en llano), `commit`, `respuesta` (opcional: contestación a lo que el humano preguntó en su nota), `ts`.

**Encargo** — `texto`, `estado` (`nueva` · `analizada` · `curso` · `hecha`), `analisis`, `commit`, `ts`.

## Dos ejes, no uno

**Decisión** (la escribe el humano: sin contestar → contestado) y **ejecución** (la escribe Claude: esperando → en marcha → terminado) son ejes **separados**. Una decisión puede estar contestada y sin empezar; fundirlos en un «hecho» esconde exactamente lo que hay que ver.

- **«En marcha» se marca antes de empezar.** Puesta al terminar no informa de nada.
- **«Terminado» = construido Y medido.** Sin batería en verde, sigue en marcha, con la línea diciendo qué falta.

## Señal de novedad

Dos contadores: uno de **revisiones** que sube con cada escritura, y una **marca de agua** de hasta dónde se ha leído. Hay novedades cuando el primero supera al segundo.

Nunca un booleano que se consume al leerlo: si el humano contesta entre la lectura y el borrado, esa respuesta se pierde y nadie se entera.

## Ciclo

```
tema publicado → el humano responde → Claude lee
   → marca «en marcha» → ejecuta y mide → registra en CHANGELOG citando la decisión
   → marca «terminado» con qué se construyó y el commit
   → el humano lo retira de la vista (se archiva, no se borra)
```

## Reglas del canal

1. **Un tema se entiende sin abrir el repositorio.** Sin códigos internos, sin números de comprobación, sin secciones de otros documentos. Criterio: *¿podría decidirlo alguien que conoce el negocio y no ha visto el código?*
2. **Si toca dinero, se dice en la primera línea.**
3. **Un silencio no es un sí.** Mientras un tema esté abierto se mide, se censa y se cierra deuda que no dependa de él; no se construye lo que ese tema gobierna.
4. **La opción se guarda por su texto**, no por su índice: un índice se rompe en silencio al reordenar y deja escrita una decisión que nadie tomó.
5. **Un tema decidido se archiva, no se borra** — es el registro de por qué el sistema es como es. Un encargo que ya no se quiere sí se borra.
6. **Escribir confirma.** Nada se da por guardado sin respuesta; lo que falla se deshace, contador incluido.
7. **Solo se pregunta en directo lo destructivo o irreversible.** Todo lo demás va al canal.
8. **La mesa apunta; no cuenta.** Los recuentos viven en el informe de su fase.
