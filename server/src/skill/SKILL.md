---
name: tareas
description: Una vuelta del bucle del agente de tareas. Sincroniza con el servidor MCP, y si hay tareas para este terminal las analiza o las ejecuta con un subagente cada una y reporta su consumo. Se arranca con /loop 2m /tareas.
argument-hint: "[id de tarea opcional]"
allowed-tools:
  - Agent
  - Read
  - Grep
  - Glob
  - Bash(git remote get-url origin)
  - mcp__tareas__registrar_terminal
  - mcp__tareas__novedades
  - mcp__tareas__listar_tareas
  - mcp__tareas__leer_tarea
  - mcp__tareas__tomar_tarea
  - mcp__tareas__comentar_tarea
  - mcp__tareas__crear_tarea
  - mcp__tareas__preguntar
  - mcp__tareas__reportar_consumo
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
Code: el usuario arranca con `/loop 2m /tareas` y cada disparo vuelve a invocar
esta skill.

Si `$ARGUMENTS` trae un id de tarea (`T-0042`), salta la sincronización y trabaja
solo esa tarea, empezando por el paso 3.

## Nombres de las herramientas

El servidor MCP se llama `tareas`, y el prefijo de sus herramientas depende de
cómo esté declarado en esta sesión:

- Declarado con `claude mcp add` (lo normal): `mcp__tareas__`.
- Traído por el plugin `mcp-tareas`: `mcp__plugin_mcp-tareas_tareas__`.

Busca en tu lista de herramientas cuál de los dos prefijos existe y usa ese en
todas las llamadas, también en las que copies dentro de los prompts de los
subagentes. Si están los dos, el de `claude mcp add` (`mcp__tareas__`) es el que
gana. Son las mismas nueve herramientas con otro nombre:

| Operación | Herramienta |
|---|---|
| Registrar el terminal | `mcp__tareas__registrar_terminal` |
| Pedir novedades | `mcp__tareas__novedades` |
| Listar tareas | `mcp__tareas__listar_tareas` |
| Leer una tarea entera | `mcp__tareas__leer_tarea` |
| Tomar una fase | `mcp__tareas__tomar_tarea` |
| Comentar en el hilo | `mcp__tareas__comentar_tarea` |
| Crear una tarea | `mcp__tareas__crear_tarea` |
| Preguntar al humano | `mcp__tareas__preguntar` |
| Reportar consumo | `mcp__tareas__reportar_consumo` |

Cualquier herramienta puede devolver un **resultado de error** con la forma
`<codigo>: <mensaje>` (por ejemplo `fase_tomada: Otro terminal es el
responsable…`). Significa que lo pedido no es posible con el estado actual de
la tarea. No repitas la misma llamada: lee el código y actúa según la tabla de
abajo o termina la vuelta diciendo qué pasó.

---

## Paso 1. Sincronizar con el servidor

1. **¿Es la primera vuelta de esta sesión?** Mira tu propio contexto: si todavía
   no has llamado a `registrar_terminal` en esta conversación, lo es.

   Si lo es, llama a `registrar_terminal` con dos campos que ya conoces, sin
   preguntar a nadie:
   - `ruta`: el directorio de trabajo de esta sesión, el que te dice tu propio
     entorno. Tal cual, en absoluto.
   - `repositorio`: la URL del remote `origin`, si esa carpeta es un repositorio
     git. Se saca con Bash: `git remote get-url origin`. Si el comando falla
     (no es un repositorio, o no hay `origin`), **omite el campo**; no inventes
     una URL ni mandes el error como valor.

   El terminal sale del token, no se manda. La respuesta trae el nombre del
   terminal, la cuenta, sus `agentes`, su `proyecto`, su `rama principal`, su
   `verificacion` si la tiene, y la revisión actual. **Apunta el nombre del
   terminal**, lo necesitas en el paso 3 para saber qué tareas son tuyas, y
   apunta también:
   - **`agentes`**: cuántas tareas puedes trabajar a la vez en una vuelta. Si no
     viene esa línea, es 1.
   - **`proyecto`**: el repositorio en el que trabaja este terminal, para tu
     línea de cierre.
   - **`rama principal`** y **`verificacion`**: van al prompt de ejecución de
     cualquier tarea con rama, y sobre todo al de la parte que integra.

   Todo eso vale para toda la sesión: cambiarlo en la web se nota en la
   siguiente.

   Si `registrar_terminal` devuelve el error `proyecto_no_coincide`, esta sesión
   está abierta en la carpeta equivocada: el terminal de este token es de otro
   repositorio. Dilo en una línea y termina la vuelta ahí mismo. No llames a
   `novedades` y no reintentes: hasta que alguien abra la sesión en la carpeta
   buena o cambie el token, cada vuelta acabará igual.

2. Llama a `novedades` **sin pasar `revision`**. La última que vio este terminal
   la recuerda el servidor y la actualiza al responderte, así que cada vuelta
   trae solo lo que ha cambiado desde la anterior. No hay nada que guardar entre
   vueltas: ni en tu contexto, que `/loop` puede compactar, ni en ningún archivo.

Si `registrar_terminal` o `novedades` fallan, di el error en una línea y termina
la vuelta. No reintentes dentro de la misma vuelta: la siguiente llega sola. La
única excepción: si `novedades` falla porque el terminal no está registrado,
llama a `registrar_terminal` y reintenta `novedades` una vez.

## Paso 2. Si no hay nada, no hagas nada

La salida de `novedades` sin novedades es solo la línea `revision: <n>`. En ese
caso: di «sin novedades» y **termina el turno**. Nada de `listar_tareas`, nada de leer archivos del repositorio, nada de resúmenes. Esta
es la vuelta que más veces se ejecuta y tiene que costar lo mínimo.

Si hay una sección `## Preguntas contestadas`, esas tareas sí cuentan como
trabajo: van al paso 3 aunque no aparezcan en `## Tareas nuevas o cambiadas`.

Y una tarea en `doing` que llega en `## Tareas nuevas o cambiadas` hay que
leerla: puede traer un comentario nuevo del humano, que es un turno que te toca
atender.

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
| `doing`, `ejecucion.terminal` es este terminal, sin marca `bloqueada`, y el último mensaje del hilo escrito por un humano (`respuesta` o `comentario`, autor `humano:…`) es posterior al último mensaje escrito por un agente (autor `modelo@terminal`, de cualquier tipo) | Candidata a **ejecución (retomar)**, con esos mensajes del humano en contexto. |
| Marca `esperando` | **Nada.** Delante hay otra tarea que todavía no está hecha. Cuando se cierre, esta llegará sola por `novedades`. |
| `doing` sin mensaje nuevo del humano, o `done`, o `finished` | **Nada.** |

El hilo es un chat: esa regla de «lo último lo ha dicho el humano» es la que hace
que se retome igual tras una respuesta a una pregunta que tras un comentario
suelto del humano.

Una **funcionalidad en `doing`** no es trabajo de ningún agente: lo que se
ejecuta son sus partes, que llegan solas por `novedades` como tareas normales.
Y una funcionalidad con la marca `análisis listo` está esperando a que el humano
apruebe su descomposición: tampoco se toca.

Una tarea con `tipo: pregunta` **solo tiene fase de análisis**: su frontmatter
no lleva bloque `ejecucion:` y su línea de índice tampoco. Al escribir el
comentario `analisis` el servidor la pasa él solo a `done`: no la ejecutes
después ni le cambies el estado a mano.

**Hasta `agentes` tareas por vuelta.** Es el número que apuntaste al registrar
el terminal; con `agentes: 1`, una sola. Si salen más candidatas que ese número,
quédate con las primeras en el orden de la salida de `novedades`: ese orden es la
prioridad que ha puesto el humano. Las demás esperan a la vuelta siguiente.

## Paso 4. Tomar las fases y lanzar los subagentes

1. Para **cada** candidata, llama a `tomar_tarea` con el id, la fase (`analisis`
   o `ejecucion`) y `modelo`: el modelo con el que vas a lanzar su subagente en
   el punto 2, que es el del frontmatter de esa fase o, si viene vacío o no lo
   reconoces, el de reserva (`fable` para análisis, `opus` para ejecución). Si
   la fase no tenía modelo asignado, el que mandes queda fijado ahí, y así firma
   los comentarios y cuadra con el consumo.
   - Si devuelve el error `fase_tomada`, esa fase ya tiene otro terminal
     responsable: no insistas con ella. Descártala y sigue con las demás; si no
     queda ninguna, di que estaban tomadas y termina la vuelta.
   - Si devuelve `modelo_no_coincide`, la fase ya tiene otro modelo asignado:
     usa el que diga el mensaje, tanto para volver a llamar a `tomar_tarea` como
     para lanzar el subagente.
   - `tomar_tarea` con fase `ejecucion` pasa la tarea a `doing` ella sola. No
     cambies el estado a mano.
2. Lanza un subagente por cada tarea que hayas tomado, **todos en un mismo
   bloque de llamadas a Agent**, para que corran a la vez. Cada uno:
   - `subagent_type`: `general-purpose`.
   - `model`: el del frontmatter de la fase que toca. El mapeo es directo:
     `opus` → `opus`, `sonnet` → `sonnet`, `haiku` → `haiku`, `fable` → `fable`.
     Si el campo viene vacío o con un valor que no reconoces, usa `fable` para
     análisis y `opus` para ejecución, y dilo en tu línea de cierre.
   - `prompt`: la plantilla que corresponda, de las tres de más abajo, con los
     huecos rellenos con los de **esa** tarea.
3. Espera a que terminen todos. No lances más subagentes de los que te permite
   `agentes`: con 1 es uno solo, y hasta la vuelta siguiente no hay otro.

## Paso 5. Reportar el consumo

Cuando un subagente termina, Claude Code te entrega un aviso de finalización con
sus **tokens totales**, sus **llamadas a herramientas** y su **duración**. Llama
a `reportar_consumo` **una vez por subagente**, con:

- el id de la tarea que trabajó,
- la fase (`analisis` o `ejecucion`),
- el modelo con el que lo lanzaste,
- y esas tres cifras **copiadas tal cual de su aviso**.

No las estimes, no las redondees, no las calcules, y no sumes las de varios
subagentes: cada tarea carga con lo suyo. Si el aviso no trae alguna de las tres,
manda las que sí trae y dilo en tu línea de cierre; un número inventado es peor
que un hueco.

Después, cierra el turno con **una línea**, con una tarea por frase: qué tarea
trabajaste, en qué fase, con qué modelo y cómo acabó.

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
      `mcp__tareas__comentar_tarea` con
      id = << ID >>, tipo = `analisis` y un texto en Markdown con:
        - Qué hay que hacer, en prosa, sin listar archivos uno a uno.
        - El plan, en pasos numerados.
        - Los riesgos: qué se puede romper y qué no está claro.

   b) Si necesitas una decisión del humano: llama a
      `mcp__tareas__preguntar` con
      id = << ID >>, `pregunta` (una frase), `porQueImporta` (un párrafo),
      `opciones[]` (cada una con `texto` y `consecuencia`, incluida la de no
      hacer nada) y `recomendacion` (el `texto` de una de las opciones).
      La pregunta deja la tarea bloqueada; no escribas también el análisis.

4. Si de paso descubres trabajo que NO es parte de esta tarea, créalo con
   `mcp__tareas__crear_tarea` con clase `propuesta`. Nace en
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
   `mcp__tareas__preguntar` con id = << ID >>, `pregunta`,
   `porQueImporta`, `opciones[]` (con la de no hacer nada) y `recomendacion`, y
   termina ahí. La funcionalidad queda bloqueada hasta que contesten.
3. Si no hace falta, crea cada parte con
   `mcp__tareas__crear_tarea`, clase = `parte`,
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
4. Cierra con `mcp__tareas__comentar_tarea` con id = << ID >>,
   tipo = `analisis` y un texto que resuma la descomposición: qué hace cada
   parte, en qué orden van y qué riesgos ves.

Las partes nacen en backlog: las revisa el humano y las aprueba él. No las
muevas de columna ni las ejecutes. Si la funcionalidad tiene `rama`, el
servidor añade al aprobar la parte que integra esa rama en la principal: esa no
la crees tú.

5. Si de paso descubres trabajo que NO es de esta funcionalidad, créalo con
   `mcp__tareas__crear_tarea` con clase `propuesta`, y con
   `tipo` = `funcionalidad` si lo que descubres es grande.

## Reglas

<< COPIA AQUÍ LAS CINCO REGLAS DE ARRIBA, ENTERAS >>

Cuando termines, resume en tres líneas en cuántas partes la dejaste o qué
preguntaste.
```

## Plantilla del prompt de ejecución

Copia esto, rellena los huecos entre `<< >>` y bórralos. El bloque «Lo que te ha
dicho el humano desde tu último mensaje» solo va cuando estás retomando una
tarea; si no, bórralo entero. `<< RAMA PRINCIPAL >>` y `<< VERIFICACION >>`
son las líneas que apuntaste al registrar el terminal, no algo que tengas que
averiguar en el repositorio.

```text
Eres el agente de EJECUCIÓN de la tarea << ID >> en el servidor de tareas.
Implementas lo que dice el análisis y lo dejas terminado y comiteado.

## La tarea

Título: << TÍTULO >>

Documento completo tal como lo devolvió leer_tarea, hilo y análisis incluidos:

<< PEGA AQUÍ LA SALIDA ENTERA DE leer_tarea >>

## Lo que te ha dicho el humano desde tu último mensaje  << SOLO AL RETOMAR; SI NO, BORRA ESTE BLOQUE >>

<< COPIA AQUÍ, EN ORDEN Y CON SU FECHA, CADA MENSAJE DEL HUMANO POSTERIOR AL
   ÚLTIMO MENSAJE DEL AGENTE:
   - por cada `respuesta`: la pregunta << Pn >>, la opción elegida por su texto
     (nunca por su posición) y la nota del humano, o «ninguna»;
   - por cada `comentario`: el texto tal cual. >>

Las decisiones que ahí se toman ya están tomadas: constrúyelas así y no vuelvas
a preguntar por ellas.

Si lo que te dice el humano es una pregunta o una duda que no exige cambiar
código, contéstale: llama a `mcp__tareas__comentar_tarea` con
id = << ID >>, tipo = `comentario` y tu respuesta, y termina el turno sin
escribir `resultado`. La tarea sigue en `doing` esperando su siguiente mensaje.
Si exige trabajo, hazlo y ciérralo con `resultado` como siempre: cada iteración
cierra con el suyo.

## Si la tarea tiene `rama`  << SOLO SI EL FRONTMATTER TRAE `rama`; SI NO, BORRA ESTE BLOQUE >>

La rama principal de este repositorio es << RAMA PRINCIPAL >>.

Todo tu trabajo va en la rama << RAMA >>: si no existe, créala desde
<< RAMA PRINCIPAL >>; y haz ahí todos tus commits. No fusiones nada con la
principal.

Si esta tarea es la de «Integrar la rama << RAMA >> en la principal», entonces
es justo lo contrario y es todo lo que tienes que hacer: fusiona esa rama en
<< RAMA PRINCIPAL >> sin fast-forward (`--no-ff`), comprueba el resultado y cita
el commit de la fusión en el `resultado`. La verificación que tiene que pasar es
<< VERIFICACION, O «la que encuentres en el repositorio» >>.

## Qué tienes que hacer

1. Trabaja en el repositorio en << RUTA DEL REPOSITORIO >>. Sigue el plan del
   análisis. Si el análisis se equivoca en algo, arréglalo y dilo en un
   `comentario`.
2. Cuenta lo que vas haciendo cuando haya algo que contar: llama a
   `mcp__tareas__comentar_tarea` con tipo = `comentario` y dos
   o tres líneas. No comentes cada archivo que tocas.
3. Si repartes el trabajo en partes que merecen verse por separado, crea cada
   una con `mcp__tareas__crear_tarea`, clase = `hija`,
   padre = << ID >>. Nacen en doing con las mismas asignaciones y cada una cierra
   con su propio `resultado`.
4. Si necesitas una decisión del humano, llama a
   `mcp__tareas__preguntar` con id = << ID >>, `pregunta`,
   `porQueImporta`, `opciones[]` (con la de no hacer nada) y `recomendacion`.
   La tarea queda bloqueada: para de construir lo que esa pregunta gobierna,
   termina lo que no dependa de ella y acaba tu turno. No cierres la tarea.
5. Cuando esté hecho: haz commit y llama a
   `mcp__tareas__comentar_tarea` con
   id = << ID >>, tipo = `resultado`, estado = `done` y un texto con:
        - Qué se construyó, en prosa y desde el punto de vista de quien lo pidió.
        - El commit.
   Sin commit no hay `resultado`.

## Reglas

<< COPIA AQUÍ LAS CINCO REGLAS DE ARRIBA, ENTERAS >>

Cuando termines, resume en tres líneas qué construiste, qué commit dejaste y qué
quedó abierto.
```
