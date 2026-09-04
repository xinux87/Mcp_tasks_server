# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## El problema que resuelve

Trabajando con Claude Code hoy:

- **No hay una interfaz donde se vea con claridad** una tarea pedida y lo que queda pendiente de ella.
- **Una tarea humana acaba en varias preguntas del agente** que hacen referencia a muchos archivos, y el humano no puede contestarlas sin abrir el repositorio.
- **Cada nueva tarea exige un comando nuevo** en un terminal.

## Qué es el proyecto

Un sistema para gestionar visualmente las tareas y cómo se está trabajando en ellas. Tiene dos entregables:

1. **El servidor MCP**, programado en Node y publicado como imagen Docker. Guarda las tareas con su hilo de comentarios y sirve la web.
2. **El plugin de Claude Code**, que define cómo conectarse a ese servidor y arranca el bucle del agente.

## Cómo se construye este proyecto

El desarrollo de este repositorio se hace con dos modelos y dos papeles separados. Es el mismo reparto de fases que implementa la herramienta: un modelo define, otro ejecuta.

### Papeles

| Papel | Modelo | Qué hace | Qué no hace |
|---|---|---|---|
| **Definición y detalle** | **Claude Fable 5.1** (`claude-fable-5-1`), la sesión principal | Mantiene este archivo. Convierte cada bloque de trabajo en un encargo cerrado. Revisa lo entregado, ejecuta la verificación e integra. Resuelve las dudas técnicas y lleva al humano las de negocio. | No escribe código de producción, salvo correcciones puntuales al revisar. |
| **Ejecución** | **Claude Opus 5** (`claude-opus-5`), un subagente por encargo, lanzado con la herramienta Agent y `model: "opus"` | Escribe el código y los tests del encargo, ejecuta la batería y devuelve un informe: qué hizo, qué archivos tocó, resultado de la verificación y dudas. | No cambia definiciones de este archivo. Si una no le cuadra, lo reporta y se decide en la sesión principal. |

### Formato de un encargo

Cada encargo que se pasa a un subagente lleva, en este orden:

1. **Objetivo** en una frase.
2. **Contexto**: qué secciones de este archivo debe leer antes de empezar.
3. **Archivos** que crea o toca, y cuáles no debe tocar.
4. **Criterios de aceptación** verificables, uno por línea.
5. **Comando de verificación** que tiene que pasar antes de devolver el informe.

### Reglas

- **Encargos independientes van en paralelo**; los que tocan los mismos archivos, en serie.
- **Nada se da por hecho por el informe del subagente.** La sesión principal vuelve a ejecutar la verificación antes de integrar.
- **Un encargo se cierra con su verificación en verde.** Si no pasa, vuelve al mismo subagente con el error, no se parchea desde la sesión principal.
- **Las dudas de negocio se llevan al humano** con el formato de pregunta de la herramienta: qué se decide, por qué importa, opciones con consecuencia y recomendación. Las técnicas las resuelve la sesión principal y las anota aquí si cambian una definición.

## Cómo funciona

- **Un agente corre de forma continua** con acceso al repositorio en local. No espera comandos del humano.
- **Revisa periódicamente el servidor.** Si hay tareas asignadas a su terminal, las analiza o las ejecuta según la fase. Si hay respuestas a sus preguntas, continúa la tarea que estaba bloqueada.
- **Cada tarea tiene dos modelos asignados:** uno que la analiza y otro que la ejecuta. El agente lanza cada fase con el modelo indicado, en el terminal que el humano haya elegido.
- **Los subagentes reportan al servidor** el estado de la ejecución a través del MCP. Cada uno trabaja sobre una tarea hija de la principal.
- **El humano lo gestiona todo desde la web:** define tareas, las asigna, contesta preguntas, revisa el resultado y las da por cerradas.

## Tareas

### Campos

- `id` con la forma `T-0042` (cuatro cifras como mínimo, correlativo), `titulo`, `descripcion`, `estado`, `orden` (posición dentro de su columna), `padre` (opcional, para tareas hijas).
- `analisis`: `modelo` y `terminal` que la analizan.
- `ejecucion`: `modelo` y `terminal` que la ejecutan.
- `autoejecucion`: activada por defecto. Con ella, la ejecución arranca sola cuando el análisis termina sin preguntas abiertas. Desactivada, la tarea espera en `prepared` a que el humano apruebe el análisis.
- `ejecucionAprobada`: la pone el humano desde la web cuando `autoejecucion` está desactivada y el análisis le vale. Es lo que desbloquea la ejecución en ese caso.
- `bloqueada`: hay una pregunta sin contestar.
- `consumo`: tokens gastados en la tarea, desglosados por fase y por modelo. Ver «Consumo de tokens».
- `comentarios[]`: el hilo de la tarea.

### Estados

Son las columnas del kanban, en este orden. Cada columna tiene un dueño: quien decide que la tarea sale de ella.

| Estado | Dueño | Qué pasa aquí | Cómo sale |
|---|---|---|---|
| `backlog` | humano | El humano termina de decidir la tarea: título, descripción, prioridad, modelos y terminales de cada fase. **El agente no la ve.** | El humano la pasa a `prepared` cuando la da por definida. |
| `prepared` | agente de análisis | La tarea está lista para trabajar. El terminal de análisis la toma, el modelo de análisis escribe el comentario `analisis` y hace las preguntas que necesite. | Con `autoejecucion` activada, pasa sola a `doing` cuando el análisis está hecho y no quedan preguntas abiertas. Desactivada, se queda en `prepared` hasta que el humano apruebe el análisis. |
| `doing` | agente de ejecución | El terminal de ejecución la ejecuta con el modelo de ejecución. Los subagentes crean tareas hijas. Puede hacer preguntas; mientras estén abiertas no se construye lo que gobiernan. | El agente escribe el comentario `resultado` con lo construido y el commit, y la tarea pasa a `done`. |
| `done` | humano | Ejecución terminada. El humano revisa el resultado. | A `finished` si lo acepta. A `doing` con una `nota` de qué falta si lo rechaza. |
| `finished` | nadie | Aceptada. Archivada y de solo lectura. | No sale. Se archiva, no se borra. |

### Marcas sobre la tarea

No son columnas ni se guardan: se derivan del estado de la tarea al leerla. Se muestran como etiqueta sobre la tarjeta, en cualquier estado:

- **`bloqueada`**: tiene al menos una pregunta sin respuesta. Es la marca que el humano tiene que atender.
- **`sin terminal`**: la fase que toca (análisis en `prepared` sin análisis hecho, ejecución en el resto) no tiene terminal asignado. Cualquier terminal puede tomarla.
- **`en marcha`**: un terminal la ha tomado con `tomar_tarea` y todavía no ha escrito el comentario que cierra esa fase.
- **`análisis listo`**: está en `prepared`, el análisis está hecho, no hay preguntas abiertas, `autoejecucion` está desactivada y el humano aún no ha aprobado.

La fase que toca en una tarea es «análisis» mientras está en `prepared` sin comentario `analisis`, y «ejecución» desde que lo tiene. El análisis se da por hecho con el primer comentario `analisis`.

### Vueltas atrás

Solo las hace el humano y siempre dejan un comentario `nota` explicando por qué:

- De `prepared` a `backlog`, para repensarla. El análisis existente se conserva en el hilo.
- De `done` a `doing`, cuando el resultado no vale.

El agente nunca mueve una tarea hacia atrás. Si no puede seguir, pregunta o la deja bloqueada.

### Qué se puede editar en cada estado

- En `backlog` se edita todo.
- Al salir de `backlog` la descripción y las asignaciones se congelan. Cualquier cambio posterior va como comentario `nota` al hilo, para que el agente lo lea en contexto y no se pierda qué se pidió al principio.
- El orden dentro de una columna se puede cambiar siempre. Es la prioridad: el agente toma primero la tarea más alta de `prepared` que esté asignada a su terminal.

### Hilo de comentarios

Cada tarea tiene un único hilo, abierto hasta que llega a `finished`. Cada iteración sobre la tarea es un comentario en ese hilo:

| Tipo | Quién lo escribe | Contenido |
|---|---|---|
| `analisis` | modelo de análisis | qué hay que hacer, plan, riesgos |
| `pregunta` | agente o subagente | pregunta con opciones, consecuencias y recomendación |
| `respuesta` | humano | la opción elegida y una nota libre |
| `avance` | agente o subagente | en qué punto va la ejecución |
| `resultado` | modelo de ejecución | qué se construyó y el commit |
| `nota` | humano | cualquier indicación durante la tarea, incluidas las vueltas atrás |

Los comentarios se añaden, nunca se editan ni se borran. El hilo es lo que se ve en la web y lo que el agente lee con `leer_tarea`.

El autor lo compone el servidor, nunca el que escribe: para un agente es el modelo asignado a la fase que toca y el nombre del terminal autenticado (`opus@portatil-xinux`); para una persona, su nombre de usuario en la web (`humano:xinux`).

### Tareas hijas

Un agente crea tareas por dos motivos distintos, y van a columnas distintas:

- **Hija de trabajo**: un subagente la crea para dejar visible su parte de la ejecución. Nace directamente en `doing`, colgando de la tarea padre, con las mismas asignaciones. Termina con su propio `resultado` y pasa a `done`; la acepta el humano al aceptar la padre.
- **Propuesta**: el agente descubre algo que habría que hacer y que no es parte de la tarea actual. Nace en `backlog`, para que el humano decida.

### Consumo de tokens

Cada tarea guarda cuántos tokens ha costado. Lo reporta el plugin, no el modelo: el modelo no sabe con precisión lo que consume, y un dato autoinformado no sirve para comparar.

- **Se guarda por fase y por modelo**: tokens totales, llamadas a herramientas y duración. La suma de la tarea es la de sus fases.
- **Las hijas suman a la padre.** La ficha muestra el consumo propio y el total con hijas, por separado.
- **Cada fase corre como un subagente propio.** Cuando el subagente termina, Claude Code entrega al agente del bucle un aviso con los tokens totales, las llamadas a herramientas y la duración de ese subagente. El bucle reenvía esas cifras con `reportar_consumo`. Si una fase se retoma tras una pregunta, el nuevo consumo se suma al anterior.
- **Lo que gasta el bucle mientras espera** (llamadas a `novedades`, lecturas de índice) se atribuye al terminal, no a ninguna tarea. Así el coste de una tarea es solo el de trabajarla.
- **El dato sale de la herramienta, no de una estimación del modelo.** El bucle copia la cifra que le da Claude Code; nunca la calcula ni la redondea.
- **El desglose en entrada, salida y caché no está en ese aviso.** Existe en la transcripción de la sesión, pero su formato es interno y no está documentado. Se descarta por ahora; si hiciera falta, sería un campo opcional que solo se rellena cuando se pueda leer de forma estable.

## Formato Markdown

El servidor es el único que escribe el formato. Los agentes envían contenido (texto de un comentario, campos de una pregunta) y el servidor lo coloca en el documento con su cabecera. Así ningún agente puede romper la estructura y todos los documentos se leen igual.

### Documento de una tarea

Es lo que devuelve `leer_tarea`. Frontmatter YAML con los campos, y después el cuerpo en tres bloques fijos: descripción, hijas e hilo.

```markdown
---
id: T-0042
titulo: Exportar el listado de clientes a CSV
estado: doing
orden: 3
padre: T-0040
autoejecucion: true
marcas: [bloqueada, en marcha]
analisis:
  modelo: sonnet
  terminal: portatil-xinux
ejecucion:
  modelo: opus
  terminal: portatil-xinux
creada: 2026-09-04T08:30:00Z
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
revision: 187
---

## Descripción

Los comerciales necesitan bajarse el listado de clientes filtrado
para trabajarlo en su hoja de cálculo. Hoy lo copian a mano.

## Hijas

- T-0043 · doing · Generar el fichero CSV
- T-0044 · done · Tests de la exportación

## Hilo

### analisis · sonnet@portatil-xinux · 2026-09-04T08:35:00Z

Hay que añadir un botón en el listado que descargue lo que se ve en
pantalla con los filtros aplicados. Riesgo: listados muy grandes.

### pregunta · opus@portatil-xinux · 2026-09-04T09:10:00Z · P1

**¿Qué separador usamos en el CSV?**

Por qué importa: la hoja de cálculo de los comerciales está en español
y abre mal los ficheros separados por coma.

Opciones:
- **Coma**: es el estándar, pero los comerciales tendrán que importar a mano.
- **Punto y coma**: se abre directamente en su hoja de cálculo; otros programas pueden fallar.
- **No hacer nada**: no se exporta y siguen copiando a mano.

Recomendación: Punto y coma.

### respuesta · humano:xinux · 2026-09-04T12:00:00Z · P1

Opción: **Punto y coma**

Nota: si algún día lo usa otro equipo, ya lo cambiaremos.

### avance · opus@portatil-xinux · 2026-09-04T12:20:00Z

Botón añadido y fichero generándose. Faltan los tests.

### resultado · opus@portatil-xinux · 2026-09-04T13:05:00Z

Qué se construyó: botón «Exportar CSV» en el listado de clientes,
respeta los filtros activos y separa por punto y coma.

Commit: a1b2c3d
```

Convenciones del documento:

- **Cabecera de cada comentario**: `### tipo · autor · fecha`, y un identificador `P<n>` al final solo en preguntas y respuestas, para saber qué respuesta contesta a qué pregunta.
- **Autor**: `modelo@terminal` cuando escribe un agente, `humano:<usuario>` cuando escribe una persona.
- **Fechas** en ISO 8601 y UTC, en el frontmatter y en el hilo.
- **`marcas`** solo lista las activas. Si no hay ninguna, el campo va vacío.
- **`revision`** es la revisión global del servidor en el momento de la lectura. El agente la guarda para la siguiente llamada a `novedades`.
- **La descripción se muestra tal como la escribió el humano**, sin tocar. Es el bloque congelado al salir de `backlog`.

### Línea de índice

Es lo que devuelven `listar_tareas` y `novedades` por cada tarea. Una línea, sin cuerpo:

```markdown
- T-0042 · doing · bloqueada · Exportar el listado de clientes a CSV · analisis: sonnet@portatil-xinux · ejecucion: opus@portatil-xinux
```

Las marcas van entre el estado y el título, separadas por `·`. Si no hay marcas, no aparece nada en esa posición.

### Salida de `novedades`

```markdown
revision: 190

## Tareas nuevas o cambiadas

- T-0042 · doing · bloqueada · Exportar el listado de clientes a CSV · analisis: sonnet@portatil-xinux · ejecucion: opus@portatil-xinux
- T-0045 · prepared · sin terminal · Migrar el envío de correos a la cola

## Preguntas contestadas

- T-0042 · P1 · Punto y coma
```

Si no hay novedades, la salida es solo la línea `revision: <n>`. El agente decide con este índice qué tareas leer enteras con `leer_tarea`.

### Contenido de una pregunta

`preguntar` recibe los campos por separado y el servidor los coloca en el comentario con el formato de arriba:

- `pregunta`: una frase, en negrita en el documento.
- `porQueImporta`: un párrafo.
- `opciones[]`: cada una con `texto` y `consecuencia`. Debe incluir la de no hacer nada.
- `recomendacion`: el `texto` de una de las opciones.

La respuesta del humano guarda el `texto` de la opción elegida, nunca su posición.

## La web

- **Vista kanban** con las cinco columnas de estado y **vista lista** con las mismas tareas. Se puede filtrar por terminal, modelo y marca.
- **Ficha de tarea** con su hilo de comentarios, sus asignaciones, sus tareas hijas y su consumo de tokens.
- **Gestión simple de usuarios.**
- **Terminales conectados** con su nombre, cuenta de origen, uso disponible y consumo acumulado del bucle.

## El servidor MCP

- **Guarda las tareas** y las expone por API. Los agentes las consultan y las actualizan a través del MCP.
- **Devuelve archivos Markdown.** Es el formato de intercambio en ambas direcciones: sencillo de leer y escribir para el agente, y con el menor coste de cómputo posible.
- **Todo el trabajo queda visible.** Cada tarea que ejecute un agente o un subagente debe reflejarse en el servidor, de modo que su estado y su resultado se puedan consultar desde la web.

## Transporte

HTTP con streaming (Streamable HTTP de MCP). El servidor corre en Docker y los plugins se conectan por red. No hay modo stdio.

El servidor MCP no guarda estado entre peticiones. La identidad del terminal viaja en el bearer token de cada petición, así que los agentes no la pasan en cada llamada y un reinicio del servidor no rompe ninguna sesión. Las respuestas del MCP van en modo JSON, sin abrir flujos de eventos, porque todas las operaciones son de petición y respuesta.

## Autenticación

- **Bearer token.** El plugin envía el token en la cabecera `Authorization: Bearer <token>` de cada petición HTTP al servidor MCP.
- **Cada token pertenece a un terminal.** El usuario crea el terminal en la web, con su nombre y su cuenta de origen, y la web le entrega el token una sola vez. Revocar el token desconecta ese terminal y solo ese.
- **El servidor guarda el token cifrado con hash**, nunca en claro. Con cada petición busca el hash y obtiene el terminal y el usuario dueño.
- **Sin token válido el servidor rechaza la petición** antes de que llegue al MCP.
- **El plugin guarda el token en su configuración local**, nunca en el repositorio.

## Terminales conectados

Cada terminal que se conecta al servidor se identifica con:

- **Nombre** del terminal.
- **Cuenta de origen** de la sesión.
- **Uso disponible** en esa cuenta. Lo reporta el plugin leyéndolo de la sesión local de Claude Code; el servidor solo lo recibe y lo muestra, nunca lo calcula.

Verificado contra la documentación de Claude Code:

- **El uso disponible solo está en la entrada de la statusline.** Claude Code pasa a la statusline un JSON con `rate_limits`, con tres ventanas (`five_hour`, `seven_day`, `spend_limit`), cada una con `used_percentage` y `resets_at`. Los hooks no reciben ese dato y no existe ninguna variable de entorno con él.
- **Solo existe para cuentas Pro o Max**, y solo a partir de la primera respuesta de la API. Una sesión con clave de API no tiene `rate_limits`; para ella el plugin reporta solo el coste estimado de sesión (`cost.total_cost_usd`).
- **Por eso el plugin incluye un script de statusline** que reenvía ese JSON al servidor con `reportar_uso` y después pinta la línea de estado. El usuario lo configura una vez como `statusLine` en sus settings; un plugin no puede imponerlo.
- **La cuenta de origen no se puede leer de forma documentada.** El correo está en las credenciales locales, cuyo formato es interno e inestable. El usuario la escribe, junto con el nombre del terminal, al crear el terminal en la web. El plugin no la conoce: el servidor la obtiene del token.
- **El uso disponible que muestra la web** es, por ventana, el porcentaje que queda y cuándo se reinicia.

## Operaciones del MCP

Todas devuelven Markdown. Las listas devuelven un índice de una línea por elemento, nunca el contenido completo, para mantener bajo el consumo de contexto.

### Terminal

| Operación | Quién la llama | Entrada | Salida |
|---|---|---|---|
| `registrar_terminal` | el plugin al arrancar la sesión | nada; el terminal sale del token | nombre del terminal, cuenta y revisión actual; marca el terminal como conectado |
| `reportar_consumo` | el bucle, al terminar cada subagente de fase | id de tarea, fase, modelo, tokens totales, llamadas a herramientas, duración | confirmación; el servidor suma al consumo de la tarea y al de sus ancestros |

### API HTTP, fuera del MCP

| Ruta | Quién la llama | Entrada | Efecto |
|---|---|---|---|
| `POST /api/uso` | el script de statusline del plugin, con cada actualización | el JSON que Claude Code pasa a la statusline, tal cual | guarda `uso_json` del terminal autenticado por bearer. Es telemetría: no sube la revisión |

Va por HTTP plano y no por MCP porque quien la llama es un script de shell, no un agente.

### Bucle del agente

| Operación | Quién la llama | Entrada | Salida |
|---|---|---|---|
| `novedades` | el agente, en cada vuelta del bucle | última revisión que conoce | tareas en `prepared` o `doing` asignadas a este terminal, o sin terminal, nuevas o cambiadas desde esa revisión; preguntas contestadas; y la revisión actual |

Es la única llamada que hace el agente mientras espera. Si no hay novedades, devuelve solo la revisión actual. Las tareas en `backlog` nunca aparecen.

### Tareas

| Operación | Quién la llama | Entrada | Salida |
|---|---|---|---|
| `listar_tareas` | agente | filtro opcional por estado y terminal | índice: id, estado, título, marcas, asignaciones |
| `leer_tarea` | agente | id | el Markdown completo de la tarea, hilo incluido |
| `tomar_tarea` | agente | id, fase (`analisis` o `ejecucion`) | marca el terminal como responsable de esa fase y activa `en marcha`; en `ejecucion` la tarea pasa a `doing` |
| `comentar_tarea` | agente o subagente | id, tipo, texto en Markdown, estado opcional | añade el comentario al hilo; cambia el estado si se indica |
| `crear_tarea` | agente o subagente | título, descripción, clase (`hija` o `propuesta`), id de padre si es hija | id de la nueva tarea |

### Preguntas

| Operación | Quién la llama | Entrada | Salida |
|---|---|---|---|
| `preguntar` | agente o subagente | id de tarea, pregunta, por qué importa, opciones con su consecuencia, recomendación | añade un comentario `pregunta` al hilo y marca la tarea `bloqueada` |

La respuesta del humano llega por `novedades` y queda como comentario `respuesta` en el hilo. No hay operación para leerla aparte.

## Reglas

### Tareas

- **El humano asigna modelo y terminal para cada fase.** Si una fase no tiene terminal asignado, cualquier terminal puede tomarla con `tomar_tarea`.
- **`tomar_tarea` falla si esa fase ya tiene otro terminal** responsable. No hay robo silencioso de tareas.
- **Pasar a `doing` exige análisis y cero preguntas abiertas.** Si el análisis deja preguntas, la tarea se queda en `prepared` y bloqueada hasta que se contesten.
- **`autoejecucion` es un botón de la tarea, activado por defecto.** Con él, el paso de `prepared` a `doing` lo hace el agente. Sin él, lo hace el humano desde la web.
- **Pasar a `done` se hace con un comentario `resultado`** que diga qué se construyó y el commit.
- **`finished` solo lo pone el humano.** Una tarea `finished` se archiva, no se borra.
- **El agente solo mueve tareas hacia delante.** Las vueltas atrás son del humano.

### Preguntas

- **Una pregunta se entiende sin abrir el repositorio.** Sin rutas de archivo, sin códigos internos, sin referencias a secciones de otros documentos. Criterio: ¿podría contestarla alguien que conoce el negocio y no ha visto el código?
- **Lleva opciones cerradas, cada una con su consecuencia**, incluida la de no hacer nada, y una recomendación del agente. El humano elige una opción y puede añadir una nota libre.
- **La respuesta se guarda por el texto de la opción, no por su índice.** Un índice se rompe en silencio al reordenar y deja escrita una decisión que nadie tomó.
- **Mientras una pregunta está abierta, la tarea sigue bloqueada** y el agente no construye lo que esa pregunta gobierna. Puede seguir con otras tareas.
- **Solo se pregunta en directo lo destructivo o irreversible.** Todo lo demás va al servidor.

### Señal de novedad

- **Un contador de revisión global** que sube con cada escritura de contenido: tareas, comentarios, preguntas, respuestas, consumo, y altas o revocaciones de usuarios y terminales. Toda escritura de ese tipo pasa por `enTransaccionConRevision`.
- **La telemetría de los terminales no sube la revisión.** `conectado_en`, `ultima_revision` y `uso_json` se escriben en su propia transacción, sin tocar el contador. Si lo subieran, cada vuelta del bucle de cada terminal sería una novedad para todos y la señal dejaría de significar nada. La web refresca esa telemetría por su cuenta.
- **`novedades` es de solo lectura respecto a la revisión.** Llamarla dos veces seguidas sin que nadie escriba contenido devuelve la misma revisión.
- **Cada terminal recuerda la última revisión que ha visto** y la pasa a `novedades`. El servidor devuelve lo que cambió desde entonces.
- **Nunca un booleano que se consume al leer.** Si el humano contesta entre la lectura y el borrado, esa respuesta se perdería sin que nadie lo notara.

## Stack del servidor

Criterio: el mínimo de piezas que cubra MCP, API, web y persistencia en un solo proceso, sin compilaciones nativas en Docker y con la menor superficie de mantenimiento. Todo verificado contra la documentación oficial a fecha de septiembre de 2026.

### Decisiones

| Pieza | Elección | Por qué |
|---|---|---|
| Runtime | **Node 24 LTS** | LTS con soporte hasta 2028. Ejecuta TypeScript directamente por eliminación de tipos, lo que evita un paso de build en desarrollo y en tests. |
| Lenguaje | **TypeScript 7**, `strict`, ESM | El SDK de MCP v2 exige TypeScript 6 o superior; la versión publicada es la 7. Solo sintaxis borrable: sin `enum` ni `namespace`, para que Node lo ejecute sin transpilar. |
| MCP | **`@modelcontextprotocol/server` v2** | SDK oficial, alineado con la especificación 2026-07-28. Se usa `createMcpHandler` con fábrica por petición: no guarda nada entre peticiones y recibe el `authInfo` que le pasa el middleware de autenticación. Las herramientas se registran con `registerTool` y esquemas Zod. El modo de respuesta JSON imprime un aviso del SDK en stderr al crear el handler; es esperado. |
| HTTP y web | **Hono** sobre `@hono/node-server` | Trabaja con `Request` y `Response` estándar, que es justo lo que expone el handler del SDK v2, sin adaptadores. Trae JSX para renderizar HTML en servidor, cookies firmadas, `bearerAuth` y `streamSSE`. Un solo framework para el MCP, la API y la web. |
| Validación | **Zod v4** | Es lo que el SDK usa para los esquemas de herramientas. Se reutiliza para la API y los formularios. |
| Persistencia | **SQLite con `node:sqlite`**, modo WAL | Integrado en Node 24, sin módulo nativo ni compilación en la imagen Docker. Un archivo en un volumen. Escrituras síncronas y en transacción, que es lo que pide la regla «escribir confirma». |
| Acceso a datos | **SQL a mano con sentencias preparadas**, sin ORM | El esquema cabe en una pantalla. Migraciones como archivos SQL numerados aplicados con `PRAGMA user_version`. |
| Interfaz web | **HTML renderizado en servidor** con JSX de Hono, **htmx** para las interacciones y **SortableJS** para arrastrar tarjetas en el kanban | Sin bundler ni framework de cliente. El servidor es dueño del estado; el navegador solo pide fragmentos. |
| Actualización en vivo | **SSE** en un endpoint que emite el número de revisión | Es la misma señal de novedad que usan los agentes. Cuando cambia, htmx recarga el fragmento afectado. La telemetría de terminales no mueve la revisión, así que la vista de terminales conectados se refresca por intervalo, no por SSE. |
| Markdown en la web | **markdown-it** con HTML crudo desactivado | Renderiza el hilo sin permitir etiquetas incrustadas, que es la única fuente de inyección posible. |
| Autenticación web | Cookie de sesión firmada, contraseñas con **scrypt** de `node:crypto` | Sin dependencias. Gestión simple de usuarios: alta, baja, cambio de contraseña, tokens de terminal. |
| Tests | **`node:test`** con archivos `.ts` ejecutados directamente | Sin framework de tests. Las pruebas del MCP usan `@modelcontextprotocol/client` contra la app en memoria, sin abrir puerto. |
| Lint y formato | **Biome** | Una sola herramienta, sin configuración de ESLint y Prettier. |
| Distribución | **Docker multi-stage** sobre `node:24-slim`, usuario sin privilegios, volumen en `/data` | Imagen pequeña, sin toolchain de compilación. |

Descartado y por qué:

- **Express**: necesita el adaptador de Node para el SDK v2 y no renderiza HTML sin un motor de plantillas aparte.
- **better-sqlite3**: es excelente, pero obliga a compilar un módulo nativo en la imagen. Solo si `node:sqlite` se queda corto.
- **SPA con React o similar**: añade bundler, API JSON paralela y estado duplicado en cliente para una interfaz de kanban y listas.
- **Sesiones MCP con estado**: el SDK las soporta, pero atan la identidad a un proceso vivo. El token por terminal da lo mismo sin estado.

### Un solo proceso, un solo puerto

| Ruta | Qué sirve | Autenticación |
|---|---|---|
| `/mcp` | El endpoint MCP para los agentes | Bearer token del terminal |
| `/api/uso` | Recibe el JSON de la statusline | Bearer token del terminal |
| `/eventos` | SSE con la revisión actual, para la web | Cookie de sesión |
| `/` y el resto | La web | Cookie de sesión |
| `/salud` | Comprobación de vida para Docker | Ninguna |

### Estructura del repositorio

```
server/                    # el servidor, un paquete npm
  src/
    main.ts                # arranque: config, base de datos, app, puerto
    app.ts                 # la app Hono: monta mcp, api, web y eventos
    config.ts              # variables de entorno
    db/                    # apertura, migraciones y consultas SQL
    mcp/                   # una herramienta por archivo, más el handler
    md/                    # render del documento de tarea, índice y novedades
    web/                   # páginas y fragmentos JSX, rutas, sesión
    auth/                  # tokens de terminal, contraseñas, cookies
  test/                    # node:test, un archivo por módulo
  Dockerfile
  compose.yaml
plugin/                    # el plugin de Claude Code, sin dependencias
  .claude-plugin/plugin.json
  .mcp.json
  skills/tareas/SKILL.md   # arranca el bucle del agente
  scripts/statusline.sh    # reenvía el uso al servidor
```

### Variables de entorno del servidor

| Variable | Para qué | Por defecto |
|---|---|---|
| `PORT` | Puerto de escucha | `3000` |
| `DATA_DIR` | Carpeta de la base de datos | `/data` |
| `BASE_URL` | URL pública, para enlaces y validación de host | obligatoria |
| `SESSION_SECRET` | Firma de la cookie de sesión | obligatoria |
| `ADMIN_PASSWORD` | Contraseña del primer usuario, solo en el primer arranque | obligatoria si no hay usuarios |

### Comandos

Los que tendrá el paquete `server/` cuando exista el esqueleto. Actualizar esta tabla si cambian.

Todos se ejecutan dentro de `server/`.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Arranca con recarga al guardar; lee `.env` si existe |
| `npm test` | Typechequea los tests con `tsconfig.test.json` y ejecuta todos |
| `node --test test/tareas.test.ts` | Un solo archivo de tests, sin el typecheck previo |
| `node --test --test-name-pattern="tomar" "test/**/*.test.ts"` | Solo los tests cuyo nombre encaja |
| `npm run typecheck` | Comprueba tipos de `src/` sin emitir |
| `npm run lint` | Biome: lint y formato |
| `npm run build` | Emite JavaScript a `dist/` para la imagen |
| `npm run cli -- crear-usuario <nombre>` | Crea un usuario; la contraseña sale de `ADMIN_PASSWORD` |
| `npm run cli -- crear-terminal <usuario> <nombre> <cuenta>` | Crea un terminal e imprime su token una sola vez |
| `docker compose up --build` | Levanta el servidor con su volumen |

`node --test` toma patrones glob, no directorios: `node --test test/` falla. Los tests viven fuera de `rootDir`, por eso tienen su propio `tsconfig.test.json`.

## El plugin de Claude Code

Define cómo conectarse al servidor MCP y arranca el bucle del agente. Su configuración son dos valores que se piden al activarlo: la URL del servidor y el token del terminal, creado antes en la web. Al iniciar registra el terminal y llama a `novedades` hasta que haya trabajo que hacer. El uso disponible lo envía aparte el script de statusline. Cuando llega una tarea, lanza la fase que toque como subagente con el modelo asignado, y al terminar reporta el consumo de tokens de ese subagente.

Verificado contra la documentación de Claude Code:

- **El servidor se declara en el archivo `.mcp.json` del plugin** con `type: "http"`, la `url` y un bloque `headers` con la cabecera `Authorization: Bearer ...`. Tanto la URL como las cabeceras admiten expansión `${VAR}` y `${VAR:-valor}`.
- **La URL y el token se piden al usuario al activar el plugin** declarándolos en `userConfig` dentro de `plugin.json`, con el token marcado como `sensitive`. Se guardan en los settings del usuario, nunca en el repositorio, y se referencian como `${user_config.<clave>}`.
- **El plugin puede incluir hooks, skills y agentes.** Eventos de hook disponibles: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `StopFailure`, `PreToolUse` y `PostToolUse`.
- **No puede incluir un comando de bucle propio.** El bucle se arranca con una skill del plugin que el usuario invoca una vez al abrir el terminal, y esa skill se mantiene viva con el mecanismo de bucle de Claude Code.
- **OAuth existe pero no se usa.** Si se declarase, tendría prioridad sobre la cabecera bearer.
