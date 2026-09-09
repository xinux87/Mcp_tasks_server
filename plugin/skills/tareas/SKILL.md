---
name: tareas
description: Una vuelta del bucle del agente de tareas. Sincroniza con el servidor MCP, y si hay una tarea para este terminal la analiza o la ejecuta con un subagente y reporta su consumo. Se arranca con /loop /mcp-tareas:tareas.
argument-hint: "[id de tarea opcional]"
allowed-tools:
  - Agent
  - Read
  - Grep
  - Glob
  - Bash(${CLAUDE_PLUGIN_ROOT}/scripts/revision.sh *)
  - mcp__plugin_mcp-tareas_tareas__registrar_terminal
  - mcp__plugin_mcp-tareas_tareas__novedades
  - mcp__plugin_mcp-tareas_tareas__listar_tareas
  - mcp__plugin_mcp-tareas_tareas__leer_tarea
  - mcp__plugin_mcp-tareas_tareas__tomar_tarea
  - mcp__plugin_mcp-tareas_tareas__comentar_tarea
  - mcp__plugin_mcp-tareas_tareas__crear_tarea
  - mcp__plugin_mcp-tareas_tareas__preguntar
  - mcp__plugin_mcp-tareas_tareas__reportar_consumo
---

# Bucle del agente de tareas

Esto es **una vuelta del bucle**, no el bucle entero. Haz los pasos de abajo una
vez, di en una línea qué pasó y termina el turno. La repetición la pone Claude
Code: el usuario arranca con `/loop /mcp-tareas:tareas` y cada disparo vuelve a
invocar esta skill.

Si `$ARGUMENTS` trae un id de tarea (`T-0042`), salta la sincronización y trabaja
solo esa tarea, empezando por el paso 3.

## Nombres de las herramientas

El servidor MCP `tareas` viene dentro del plugin `mcp-tareas`, así que sus
herramientas se llaman con el prefijo completo del plugin:

| Operación | Herramienta |
|---|---|
| Registrar el terminal | `mcp__plugin_mcp-tareas_tareas__registrar_terminal` |
| Pedir novedades | `mcp__plugin_mcp-tareas_tareas__novedades` |
| Listar tareas | `mcp__plugin_mcp-tareas_tareas__listar_tareas` |
| Leer una tarea entera | `mcp__plugin_mcp-tareas_tareas__leer_tarea` |
| Tomar una fase | `mcp__plugin_mcp-tareas_tareas__tomar_tarea` |
| Comentar en el hilo | `mcp__plugin_mcp-tareas_tareas__comentar_tarea` |
| Crear una tarea | `mcp__plugin_mcp-tareas_tareas__crear_tarea` |
| Preguntar al humano | `mcp__plugin_mcp-tareas_tareas__preguntar` |
| Reportar consumo | `mcp__plugin_mcp-tareas_tareas__reportar_consumo` |

Si el servidor estuviera configurado fuera del plugin, el prefijo sería
`mcp__tareas__`. Busca el que exista en tu lista de herramientas.

Cualquier herramienta puede devolver un **resultado de error** con la forma
`<codigo>: <mensaje>` (por ejemplo `fase_tomada: Otro terminal es el
responsable…`). Significa que lo pedido no es posible con el estado actual de
la tarea. No repitas la misma llamada: lee el código y actúa según la tabla de
abajo o termina la vuelta diciendo qué pasó.

---

## Paso 1. Sincronizar con el servidor

### Dónde vive la revisión

La revisión es lo único que hay que conservar entre vueltas. No la guardes en el
contexto: `/loop` puede compactarlo o la sesión puede reanudarse, y entonces se
pierde y `novedades` devolvería el mundo entero otra vez. Tampoco la guardes en
`${CLAUDE_PLUGIN_ROOT}`: ese directorio es la instalación del plugin y se
sobrescribe en cada actualización. Va a un archivo propio, que gestiona este
script:

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/revision.sh leer
${CLAUDE_PLUGIN_ROOT}/scripts/revision.sh guardar <n>
```

El script escribe en `${CLAUDE_PLUGIN_DATA}/revision`, que Claude Code conserva
entre sesiones y entre actualizaciones del plugin y borra al desinstalar el
plugin. Si esa variable no está definida usa `~/.claude/mcp-tareas/revision`.

### La vuelta

1. **¿Es la primera vuelta de esta sesión?** Mira tu propio contexto: si todavía
   no has llamado a `registrar_terminal` en esta conversación, lo es.

   Si lo es, llama a `registrar_terminal`. No lleva entrada; el terminal sale del
   token. Devuelve el nombre del terminal, la cuenta y la revisión actual.
   **Apunta el nombre del terminal**, lo necesitas en el paso 3 para saber qué
   tareas son tuyas.

   Ahora decide con qué revisión sigues:
   - Si `${CLAUDE_PLUGIN_ROOT}/scripts/revision.sh leer` imprime un número, este
     terminal ya trabajó antes: sigue con ese número.
   - Si no imprime nada, es la primera vez de este terminal: sigue con `0`. Así
     la primera llamada a `novedades` trae todo lo que ya esté asignado a este
     terminal o sin terminal, aunque se creara antes de conectarlo, que es lo
     normal. Es un índice de una línea por tarea: cuesta poco. **No uses la
     revisión que devuelve `registrar_terminal`**: dejaría fuera todo lo
     anterior a este momento.

2. Llama a `novedades` con la última revisión conocida.

3. Guarda con `revision.sh guardar` la revisión nueva que venga en la respuesta.
   **Siempre**, aunque no haya tareas. Si no la guardas, la vuelta siguiente
   vuelve a traer lo mismo.

Si `registrar_terminal` o `novedades` fallan, di el error en una línea y termina
la vuelta. No guardes revisión y no reintentes dentro de la misma vuelta: la
siguiente llega sola. La única excepción: si `novedades` falla porque el terminal
no está registrado, llama a `registrar_terminal` y reintenta `novedades` una vez.

## Paso 2. Si no hay nada, no hagas nada

La salida de `novedades` sin novedades es solo la línea `revision: <n>`. En ese
caso: guarda la revisión, di «sin novedades» y **termina el turno**. Nada de
`listar_tareas`, nada de leer archivos del repositorio, nada de resúmenes. Esta
es la vuelta que más veces se ejecuta y tiene que costar lo mínimo.

Si hay una sección `## Preguntas contestadas`, esas tareas sí cuentan como
trabajo: van al paso 3 aunque no aparezcan en `## Tareas nuevas o cambiadas`.

## Paso 3. Leer y clasificar

Para cada tarea que traiga `novedades`, llama a `leer_tarea` con su id y lee el
documento entero: frontmatter (estado, marcas, `analisis.modelo`,
`analisis.terminal`, `ejecucion.modelo`, `ejecucion.terminal`) y el hilo.

Clasifícala con esta tabla. La fase que toca es «análisis» mientras la tarea está
en `prepared` y **no** tiene ningún comentario `analisis` en el hilo; es
«ejecución» desde que lo tiene.

| Lo que ves en la tarea | Qué haces |
|---|---|
| Marca `bloqueada` | **Nada.** Hay una pregunta sin contestar. Pasa a la siguiente. |
| `prepared`, sin comentario `analisis`, y `analisis.terminal` está vacío (marca `sin terminal`) o es este terminal | Candidata a **análisis**. |
| `prepared`, `tipo: pregunta`, sin comentario `analisis`, y `analisis.terminal` está vacío o es este terminal | Candidata a **análisis**. Es lo único que tiene esa tarea. |
| `prepared`, `tipo: funcionalidad`, sin comentario `analisis`, y `analisis.terminal` está vacío o es este terminal | Candidata a **descomposición**. |
| `prepared`, con comentario `analisis`, sin marca `bloqueada` ni `análisis listo`, y `ejecucion.terminal` está vacío o es este terminal | Candidata a **ejecución**. |
| `prepared` con marca `análisis listo` | **Nada.** `autoejecucion` está desactivada y el humano todavía no ha aprobado el análisis. |
| `doing`, `ejecucion.terminal` es este terminal, y en el hilo hay un comentario `respuesta` posterior a la última `pregunta` | Candidata a **ejecución (retomar)**, con la respuesta en contexto. |
| Marca `esperando` | **Nada.** Delante hay otra tarea que todavía no está hecha. Cuando se cierre, esta llegará sola por `novedades`. |
| `doing` sin respuesta nueva, o `done`, o `finished` | **Nada.** |

Una **funcionalidad en `doing`** no es trabajo de ningún agente: lo que se
ejecuta son sus partes, que llegan solas por `novedades` como tareas normales.
Y una funcionalidad con la marca `análisis listo` está esperando a que el humano
apruebe su descomposición: tampoco se toca.

Una tarea con `tipo: pregunta` **solo tiene fase de análisis**: su frontmatter
no lleva bloque `ejecucion:` y su línea de índice tampoco. Al escribir el
comentario `analisis` el servidor la pasa él solo a `done`: no la ejecutes
después ni le cambies el estado a mano.

**Una tarea por vuelta como máximo.** Si sale más de una candidata, quédate con
la que aparezca más arriba en la salida de `novedades`: ese orden es la prioridad
que ha puesto el humano. Las demás esperan a la vuelta siguiente. Es a propósito:
así el humano ve avance de una en una y el consumo queda bien atribuido.

## Paso 4. Tomar la fase y lanzar el subagente

1. Llama a `tomar_tarea` con el id, la fase (`analisis` o `ejecucion`) y
   `modelo`: el modelo con el que vas a lanzar el subagente en el punto 2, que
   es el del frontmatter de esa fase o, si viene vacío o no lo reconoces, el de
   reserva (`sonnet` para análisis, `opus` para ejecución). Si la fase no tenía
   modelo asignado, el que mandes queda fijado ahí, y así firma los comentarios
   y cuadra con el consumo.
   - Si devuelve el error `fase_tomada`, esa fase ya tiene otro terminal
     responsable: no insistas, di que la tarea está tomada y termina la vuelta.
   - Si devuelve `modelo_no_coincide`, la fase ya tiene otro modelo asignado:
     usa el que diga el mensaje, tanto para volver a llamar a `tomar_tarea` como
     para lanzar el subagente.
   - `tomar_tarea` con fase `ejecucion` pasa la tarea a `doing` ella sola. No
     cambies el estado a mano.
2. Lanza **un** subagente con la herramienta Agent:
   - `subagent_type`: `general-purpose`.
   - `model`: el del frontmatter de la fase que toca. El mapeo es directo:
     `opus` → `opus`, `sonnet` → `sonnet`, `haiku` → `haiku`, `fable` → `fable`.
     Si el campo viene vacío o con un valor que no reconoces, usa `sonnet` para
     análisis y `opus` para ejecución, y dilo en tu línea de cierre.
   - `prompt`: la plantilla que corresponda, de las tres de más abajo, con los
     huecos rellenos.
3. Espera a que termine. No lances dos subagentes en la misma vuelta.

## Paso 5. Reportar el consumo

Cuando el subagente termina, Claude Code te entrega un aviso de finalización con
sus **tokens totales**, sus **llamadas a herramientas** y su **duración**. Llama
a `reportar_consumo` con:

- el id de la tarea,
- la fase (`analisis` o `ejecucion`),
- el modelo con el que lanzaste el subagente,
- y esas tres cifras **copiadas tal cual del aviso**.

No las estimes, no las redondees, no las calcules. Si el aviso no trae alguna de
las tres, manda las que sí trae y dilo en tu línea de cierre; un número inventado
es peor que un hueco.

Después, cierra el turno con **una línea**: qué tarea trabajaste, en qué fase, con
qué modelo y cómo acabó.

---

## Reglas que van dentro del prompt del subagente

Estas cinco reglas van copiadas en los tres prompts. No las resumas.

1. **Una pregunta se entiende sin abrir el repositorio.** Sin rutas de archivo,
   sin nombres de función, sin códigos internos, sin referencias a secciones de
   otros documentos. Criterio: ¿podría contestarla alguien que conoce el negocio
   y no ha visto el código?
2. **Toda pregunta lleva opciones cerradas, cada una con su consecuencia,
   incluida la de no hacer nada, y una recomendación.**
3. **Mientras una pregunta esté abierta, no se construye lo que esa pregunta
   gobierna.** Se puede seguir con lo que no depende de ella.
4. **Solo se pregunta en directo lo destructivo o lo irreversible.** Todo lo
   demás va al servidor con `preguntar`.
5. **El comentario `resultado` cita el commit.** Y el agente nunca mueve una
   tarea hacia atrás: si no puede seguir, pregunta o la deja bloqueada. Las
   vueltas atrás las hace el humano.

---

## Plantilla del prompt de análisis

Copia esto, rellena los huecos entre `<< >>` y bórralos.

```text
Eres el agente de ANÁLISIS de la tarea << ID >> en el servidor de tareas.
Tu trabajo es entender qué hay que hacer y dejarlo escrito. NO escribes código
de producción ni tocas archivos del repositorio.

## La tarea

Título: << TÍTULO >>

Documento completo tal como lo devolvió leer_tarea, hilo incluido:

<< PEGA AQUÍ LA SALIDA ENTERA DE leer_tarea >>

## Qué tienes que hacer

1. Lee el repositorio en << RUTA DEL REPOSITORIO >> lo que necesites para
   entender el alcance real: qué existe ya, qué hay que tocar y qué no.
2. Decide si puedes plantear el trabajo sin decisiones del humano.
3. Termina de UNA de estas dos formas, nunca de las dos:

   a) Si lo tienes claro: llama a
      `mcp__plugin_mcp-tareas_tareas__comentar_tarea` con
      id = << ID >>, tipo = `analisis` y un texto en Markdown con:
        - Qué hay que hacer, en prosa, sin listar archivos uno a uno.
        - El plan, en pasos numerados.
        - Los riesgos: qué se puede romper y qué no está claro.

   b) Si necesitas una decisión del humano: llama a
      `mcp__plugin_mcp-tareas_tareas__preguntar` con
      id = << ID >>, `pregunta` (una frase), `porQueImporta` (un párrafo),
      `opciones[]` (cada una con `texto` y `consecuencia`, incluida la de no
      hacer nada) y `recomendacion` (el `texto` de una de las opciones).
      La pregunta deja la tarea bloqueada; no escribas también el análisis.

4. Si de paso descubres trabajo que NO es parte de esta tarea, créalo con
   `mcp__plugin_mcp-tareas_tareas__crear_tarea` con clase `propuesta`. Nace en
   backlog para que lo decida el humano. No lo hagas tú.

## Si la tarea es de tipo pregunta  << SOLO SI EL FRONTMATTER DICE `tipo: pregunta`; SI NO, BORRA ESTE BLOQUE >>

El comentario `analisis` que escribas es la RESPUESTA al humano, no un plan de
trabajo. Escríbelo en llano y desde su punto de vista: nada de rutas de archivo,
nombres de función ni códigos internos. Criterio: ¿lo entiende alguien que
conoce el negocio y no ha visto el código?

No hay fase de ejecución detrás. Al escribir ese comentario la tarea se cierra
sola y pasa a `done`: no propongas pasos ni esperes a nadie.

Si para responder te hace falta una decisión del humano, usa `preguntar` igual
que en cualquier otra tarea. Y lo que descubras de paso que habría que hacer no
va en la respuesta: va como `crear_tarea` con clase `propuesta`.

## Reglas

<< COPIA AQUÍ LAS CINCO REGLAS DE ARRIBA, ENTERAS >>

Cuando termines, resume en tres líneas qué análisis dejaste o qué preguntaste.
```

## Plantilla del prompt de descomposición

Es la de una funcionalidad. Una descomposición es la fase `analisis` de esa
funcionalidad: se toma con `tomar_tarea` igual que cualquier análisis y se lanza
con el modelo de análisis. Copia esto, rellena los huecos entre `<< >>` y
bórralos.

```text
Eres el agente de DESCOMPOSICIÓN de la funcionalidad << ID >> en el servidor de
tareas. Tu trabajo es partirla en partes que otros agentes puedan ejecutar. NO
escribes código de producción ni tocas archivos del repositorio.

## La funcionalidad

Título: << TÍTULO >>

Documento completo tal como lo devolvió leer_tarea, hilo incluido:

<< PEGA AQUÍ LA SALIDA ENTERA DE leer_tarea >>

## Qué tienes que hacer

1. Lee el repositorio en << RUTA DEL REPOSITORIO >> lo que necesites para saber
   qué existe ya y qué hay que construir de verdad.
2. Si para partirla hace falta una decisión de negocio, llama a
   `mcp__plugin_mcp-tareas_tareas__preguntar` con id = << ID >>, `pregunta`,
   `porQueImporta`, `opciones[]` (con la de no hacer nada) y `recomendacion`, y
   termina ahí. La funcionalidad queda bloqueada hasta que contesten.
3. Si no hace falta, crea cada parte con
   `mcp__plugin_mcp-tareas_tareas__crear_tarea`, clase = `parte`,
   padre = << ID >>:
     - `titulo` en llano, desde el punto de vista de quien pidió la
       funcionalidad.
     - `descripcion` con qué hay que construir y cómo se sabe que está hecho.
     - `dependeDe` con los identificadores de las partes que tienen que ir
       antes, cuando el orden importa. Solo valen partes de esta misma
       funcionalidad.
   Entre tres y diez partes. Cada una tiene que poder ejecutarla un agente en
   una sesión: si una no cabe, pártela; si dos no se entienden por separado,
   júntalas.
4. Cierra con `mcp__plugin_mcp-tareas_tareas__comentar_tarea` con id = << ID >>,
   tipo = `analisis` y un texto que resuma la descomposición: qué hace cada
   parte, en qué orden van y qué riesgos ves.

Las partes nacen en backlog: las revisa el humano y las aprueba él. No las
muevas de columna ni las ejecutes. Si la funcionalidad tiene `rama`, el
servidor añade al aprobar la parte que integra esa rama en la principal: esa no
la crees tú.

5. Si de paso descubres trabajo que NO es de esta funcionalidad, créalo con
   `mcp__plugin_mcp-tareas_tareas__crear_tarea` con clase `propuesta`, y con
   `tipo` = `funcionalidad` si lo que descubres es grande.

## Reglas

<< COPIA AQUÍ LAS CINCO REGLAS DE ARRIBA, ENTERAS >>

Cuando termines, resume en tres líneas en cuántas partes la dejaste o qué
preguntaste.
```

## Plantilla del prompt de ejecución

Copia esto, rellena los huecos entre `<< >>` y bórralos. El bloque «Respuesta
del humano» solo va cuando estás retomando una tarea tras una pregunta
contestada; si no, bórralo entero.

```text
Eres el agente de EJECUCIÓN de la tarea << ID >> en el servidor de tareas.
Implementas lo que dice el análisis y lo dejas terminado y comiteado.

## La tarea

Título: << TÍTULO >>

Documento completo tal como lo devolvió leer_tarea, hilo y análisis incluidos:

<< PEGA AQUÍ LA SALIDA ENTERA DE leer_tarea >>

## Respuesta del humano  << SOLO AL RETOMAR; SI NO, BORRA ESTE BLOQUE >>

Pregunta << Pn >>: << TEXTO DE LA PREGUNTA >>
Opción elegida: << TEXTO DE LA OPCIÓN, NO SU POSICIÓN >>
Nota del humano: << NOTA, O «ninguna» >>

Esa decisión ya está tomada. Constrúyela así y no vuelvas a preguntar por ella.

## Si la tarea tiene `rama`  << SOLO SI EL FRONTMATTER TRAE `rama`; SI NO, BORRA ESTE BLOQUE >>

Todo tu trabajo va en la rama << RAMA >>: si no existe, créala desde la
principal; y haz ahí todos tus commits. No fusiones nada con la principal.

Si esta tarea es la de «Integrar la rama << RAMA >> en la principal», entonces
es justo lo contrario y es todo lo que tienes que hacer: fusiona esa rama en la
principal sin fast-forward (`--no-ff`), pasa la verificación del repositorio
sobre el resultado y cita el commit de la fusión en el `resultado`.

## Qué tienes que hacer

1. Trabaja en el repositorio en << RUTA DEL REPOSITORIO >>. Sigue el plan del
   análisis. Si el análisis se equivoca en algo, arréglalo y dilo en un `avance`.
2. Cuenta lo que vas haciendo cuando haya algo que contar: llama a
   `mcp__plugin_mcp-tareas_tareas__comentar_tarea` con tipo = `avance` y dos o
   tres líneas. No comentes cada archivo que tocas.
3. Si repartes el trabajo en partes que merecen verse por separado, crea cada
   una con `mcp__plugin_mcp-tareas_tareas__crear_tarea`, clase = `hija`,
   padre = << ID >>. Nacen en doing con las mismas asignaciones y cada una cierra
   con su propio `resultado`.
4. Si necesitas una decisión del humano, llama a
   `mcp__plugin_mcp-tareas_tareas__preguntar` con id = << ID >>, `pregunta`,
   `porQueImporta`, `opciones[]` (con la de no hacer nada) y `recomendacion`.
   La tarea queda bloqueada: para de construir lo que esa pregunta gobierna,
   termina lo que no dependa de ella y acaba tu turno. No cierres la tarea.
5. Cuando esté hecho: haz commit y llama a
   `mcp__plugin_mcp-tareas_tareas__comentar_tarea` con
   id = << ID >>, tipo = `resultado`, estado = `done` y un texto con:
        - Qué se construyó, en prosa y desde el punto de vista de quien lo pidió.
        - El commit.
   Sin commit no hay `resultado`.

## Reglas

<< COPIA AQUÍ LAS CINCO REGLAS DE ARRIBA, ENTERAS >>

Cuando termines, resume en tres líneas qué construiste, qué commit dejaste y qué
quedó abierto.
```
