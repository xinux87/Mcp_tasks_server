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

`README.md` cuenta esto mismo de una ojeada, para quien llega al repositorio. Se mantiene: cuando cambie una pieza o el ciclo de una tarea, se actualiza ahí también. Este archivo manda; el README es el resumen.

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

- `id` con la forma `T-0042` (cuatro cifras como mínimo, correlativo), `titulo`, `descripcion`, `estado`, `orden` (posición dentro de su columna), `padre` (opcional, para tareas hijas). **Un id nunca se reutiliza**, ni aunque se borre la tarea con el id más alto: ya puede estar citado en un hilo, en la actividad o en un commit. La tabla lleva `AUTOINCREMENT` por eso. **El id es global, no por proyecto**: `T-0042` identifica una tarea en cualquier repositorio y un commit ya escrito nunca queda ambiguo.
- `proyecto`: la clave del proyecto al que pertenece, obligatoria. Ver «Proyectos».
- `tipo`: `tarea` (por defecto), `pregunta` o `funcionalidad`. Ver «Tareas que son preguntas» y «Funcionalidades».
- `dependeDe[]`: tareas que tienen que estar `done` o `finished` antes de que esta se pueda tomar. Ver «Dependencias».
- `rama`: rama de git en la que se trabaja la tarea, opcional. Una funcionalidad la fija y sus partes la heredan.
- `analisis`: `modelo` y `terminal` que la analizan.
- `ejecucion`: `modelo` y `terminal` que la ejecutan.
- `autoejecucion`: activada por defecto. Con ella, la ejecución arranca sola cuando el análisis termina sin preguntas abiertas. Desactivada, la tarea espera en `prepared` a que el humano apruebe el análisis.
- `ejecucionAprobada`: la pone el humano desde la web cuando `autoejecucion` está desactivada y el análisis le vale. Es lo que desbloquea la ejecución en ese caso.
- `bloqueada`: hay una pregunta sin contestar.
- `estadoDesde`: cuándo entró en su estado actual. Solo la web la enseña, como edad en columna. Ver «La web › Edad en columna».
- `presupuesto`: tope de tokens, opcional. Superarlo pone la marca `sobre presupuesto`. Ver «La web › Saber qué cuesta y qué rinde».
- `consumo`: tokens gastados en la tarea, desglosados por fase y por modelo. Ver «Consumo de tokens».
- `comentarios[]`: el hilo de la tarea.

### Estados

Son las columnas del kanban, en este orden. Cada columna tiene un dueño: quien decide que la tarea sale de ella.

| Estado | Dueño | Qué pasa aquí | Cómo sale |
|---|---|---|---|
| `backlog` | humano | El humano termina de decidir la tarea: título, descripción, prioridad, modelos y terminales de cada fase. **El agente no la ve.** | El humano la pasa a `prepared` cuando la da por definida. |
| `prepared` | agente de análisis | La tarea está lista para trabajar. El terminal de análisis la toma, el modelo de análisis escribe el comentario `analisis` y hace las preguntas que necesite. | Con `autoejecucion` activada, pasa sola a `doing` cuando el análisis está hecho y no quedan preguntas abiertas. Desactivada, se queda en `prepared` hasta que el humano apruebe el análisis. |
| `doing` | agente de ejecución | El terminal de ejecución la ejecuta con el modelo de ejecución. Los subagentes crean tareas hijas. Puede hacer preguntas; mientras estén abiertas no se construye lo que gobiernan. | El agente escribe el comentario `resultado` con lo construido y el commit, y la tarea pasa a `done`. |
| `done` | humano | Ejecución terminada. El humano revisa el resultado. | A `finished` si lo acepta. A `doing` con un `comentario` que dice qué falta si pide otra iteración. |
| `finished` | nadie | Aceptada. Archivada y de solo lectura. | No sale. Se archiva, no se borra. |

### Marcas sobre la tarea

No son columnas ni se guardan: se derivan del estado de la tarea al leerla. Se muestran como etiqueta sobre la tarjeta, en cualquier estado:

- **`bloqueada`**: tiene al menos una pregunta sin respuesta. Es la marca que el humano tiene que atender.
- **`sin terminal`**: solo en `prepared` y `doing`. La fase que toca (análisis en `prepared` sin análisis hecho, ejecución en el resto) no tiene terminal asignado. Cualquier terminal puede tomarla.
- **`en marcha`**: un terminal la ha tomado con `tomar_tarea` y todavía no ha escrito el comentario que cierra esa fase.
- **`análisis listo`**: está en `prepared`, el análisis está hecho, no hay preguntas abiertas, `autoejecucion` está desactivada y el humano aún no ha aprobado. En una funcionalidad significa que la descomposición está lista para revisar.
- **`esperando`**: solo en `prepared`. Tiene alguna dependencia que todavía no está `done` ni `finished`. Ningún terminal puede tomarla y `novedades` no la ofrece.
- **`sobre presupuesto`**: tiene `presupuesto` y su consumo con hijas lo supera. Es un aviso al humano; no frena a nadie.

La fase que toca en una tarea es «análisis» mientras está en `prepared` sin comentario `analisis`, y «ejecución» desde que lo tiene. El análisis se da por hecho con el primer comentario `analisis`.

### Vueltas atrás

Solo las hace el humano y siempre dejan un `comentario` explicando por qué:

- De `prepared` a `backlog`, para repensarla. El comentario de análisis se conserva en el hilo, pero la tarea vuelve a necesitar análisis y aprobación al salir de nuevo de `backlog`: se repite porque la descripción puede haber cambiado.
- De `done` a `doing`, cuando el resultado no vale: es pedir otra iteración, y se hace desde el cuadro de comentar de la ficha. Ver «El hilo como chat».

El agente nunca mueve una tarea hacia atrás. Si no puede seguir, pregunta o la deja bloqueada.

### Qué se puede editar en cada estado

- En `backlog` se edita todo.
- Al salir de `backlog` la descripción y las asignaciones se congelan. Cualquier cambio posterior va como `comentario` al hilo, para que el agente lo lea en contexto y no se pierda qué se pidió al principio.
- El orden dentro de una columna se puede cambiar siempre. Es la prioridad: el agente toma primero la tarea más alta de `prepared` que esté asignada a su terminal.

### Hilo de comentarios

Cada tarea tiene un único hilo, abierto hasta que llega a `finished`. Es una conversación entre el humano y los agentes: cada mensaje es un comentario en ese hilo.

| Tipo | Quién lo escribe | Contenido |
|---|---|---|
| `analisis` | modelo de análisis | qué hay que hacer, plan, riesgos |
| `pregunta` | agente o subagente | pregunta con opciones, consecuencias y recomendación |
| `respuesta` | humano | la opción elegida y una nota libre |
| `resultado` | modelo de ejecución | qué se construyó y el commit |
| `comentario` | cualquiera | el mensaje libre: el humano pide, aclara o corrige; el agente cuenta por dónde va o contesta a lo que no es una decisión |

Los comentarios se añaden, nunca se editan ni se borran. El hilo es lo que se ve en la web y lo que el agente lee con `leer_tarea`.

El autor lo compone el servidor, nunca el que escribe: para un agente es el modelo asignado a la fase que toca y el nombre del terminal autenticado (`opus@portatil-ana`); para una persona, su nombre de usuario en la web (`humano:ana`).

### El hilo como chat

Una tarea rara vez sale bien a la primera: el humano ve el resultado, encuentra cosas y las pide. Decidido el 16 de septiembre de 2026: el hilo funciona como un chat y cada vuelta es una **iteración**. Antes había dos tipos, `nota` del humano y `avance` del agente, y una nota no disparaba nada: el agente solo reaccionaba a las respuestas a sus preguntas. Los dos se funden en `comentario`, y un comentario del humano es un turno que el agente atiende.

- **Un `comentario` del humano en una tarea `doing` es trabajo pendiente para su terminal de ejecución.** La regla se deriva del hilo, sin campo nuevo: si el último comentario del humano es posterior al último mensaje del agente (de cualquier tipo), el agente retoma la ejecución con ese comentario en contexto, igual que retoma tras una `respuesta`. La tarea aparece por `novedades` porque escribir un comentario sube la revisión; es el bucle quien aplica la regla al clasificar.
- **El agente puede contestar sin trabajar.** A un «¿por qué elegiste X?» responde con un `comentario` y la tarea sigue en `doing`, esperando el siguiente mensaje del humano. Solo el terminal que tiene la fase en marcha escribe comentarios de agente; para el humano no hay restricción de estado salvo `finished`, que es de solo lectura.
- **En `done`, el humano elige.** El cuadro de comentar ofrece «Comentar», que solo escribe (para dejar constancia sin reabrir), y «Comentar y pedir otra iteración», que escribe el comentario y devuelve la tarea a `doing` en la misma transacción. Es la vuelta atrás de antes, dicha en el chat: el servidor sigue sin mover nada hacia atrás por su cuenta.
- **Las iteraciones se cuentan, no se guardan.** Iteración 1 es la primera ejecución; cada transición `done → doing` empieza una más. La ficha dice «Iteración 3» junto al estado, y el hilo pinta un separador «Iteración 2», «Iteración 3»… en el punto de cada vuelta, con la fecha de la transición. Sale de la tabla `transiciones`, así que las tareas anteriores a esa tabla cuentan solo desde que existe.
- **Límite conocido.** Un comentario escrito mientras el subagente está trabajando no lo ve ese subagente; cuando escriba su `resultado` la tarea pasa a `done`, el humano ve que falta lo suyo y lo pide con otra iteración. Es una vuelta de más, no un mensaje perdido.
- **Migración.** Los comentarios guardados con tipo `nota` o `avance` pasan a `comentario`, y las filas de actividad con acción `nota` pasan a `comentario`. El Markdown del MCP escribe `### comentario · humano:ana`. `comentar_tarea` acepta `comentario` y deja de aceptar `avance` y `nota`.

### Tareas hijas

Un agente crea tareas por dos motivos distintos, y van a columnas distintas:

- **Hija de trabajo**: un subagente la crea para dejar visible su parte de la ejecución. Nace directamente en `doing`, colgando de la tarea padre, con las mismas asignaciones. Termina con su propio `resultado` y pasa a `done`; la acepta el humano al aceptar la padre.
- **Propuesta**: el agente descubre algo que habría que hacer y que no es parte de la tarea actual. Nace en `backlog`, para que el humano decida. Puede ser de tipo `tarea` o, si lo descubierto es grande, `funcionalidad`.
- **Parte**: la crea el análisis de una funcionalidad al descomponerla. Nace en `backlog` colgando de la funcionalidad, hereda su `rama` y sus modelos y terminales por defecto, y puede depender de otras partes. El humano la revisa antes de aprobar la descomposición.

### Dependencias

Una tarea puede depender de otras: `dependeDe` es una lista de ids. Sirve dentro de una funcionalidad para ordenar sus partes y fuera de ella para cualquier tarea suelta.

- **Una dependencia está satisfecha cuando la tarea de la que se depende está `done` o `finished`.** Basta con `done`: lo construido y medido ya existe, y esperar a que el humano lo acepte convertiría su revisión en cuello de botella.
- **Con alguna dependencia sin satisfacer, la tarea lleva la marca `esperando`**: `tomar_tarea` falla con `esperando_dependencias` y `novedades` no la ofrece. Vale para las dos fases: analizar una parte antes de que exista aquello de lo que depende es analizar a ciegas.
- **Se fijan en `backlog`**, desde la web, el CLI o `crear_tarea`, y se congelan al salir de `backlog` como el resto de asignaciones. Una tarea no puede depender de sí misma ni cerrar un ciclo (`dependencia_ciclica`).
- **En el frontmatter** aparece `dependeDe: [T-0041, T-0043]` solo cuando hay alguna. En el bloque de hijas de la tarea padre, cada línea lleva `depende de: T-0041` cuando toca.

### Funcionalidades

Una funcionalidad es lo que pide el humano en lenguaje de negocio: qué quiere conseguir, para quién y por qué, sin decir cómo. Se marca con `tipo: funcionalidad`. Su «ejecución» son sus partes: es un evolutivo dentro de la plataforma.

| Columna | Qué significa para una funcionalidad | Quién la mueve |
|---|---|---|
| `backlog` | Idea. El humano la redacta, la prioriza y, si quiere, le pone `rama` y los modelos y terminales por defecto de sus partes. | humano |
| `prepared` | **Descomposición.** El modelo de análisis pregunta lo de negocio y crea las partes con `crear_tarea` clase `parte`, con su orden y sus dependencias; después escribe el comentario `analisis` con el resumen de la descomposición. Las partes nacen en `backlog`. La funcionalidad queda con la marca `análisis listo`. | agente de análisis |
| `doing` | **El evolutivo en marcha.** El humano revisa las partes en `backlog` (edita, borra, añade) y aprueba la descomposición: la funcionalidad pasa a `doing` y sus partes en `backlog` pasan a `prepared` con su orden. Desde ahí cada parte sigue el ciclo normal. | el humano al aprobar |
| `done` | Todas las partes están `finished`. El servidor la mueve solo en la misma transacción que cierra la última parte y escribe un comentario `resultado` con autor `servidor` que lista cada parte con su commit. | servidor |
| `finished` | El humano la da por entregada tras verla en el producto. | humano |

- **No tiene fase de ejecución propia** ni `autoejecucion`: la aprobación de la descomposición es siempre del humano, porque es la decisión que más dinero gobierna. En `doing` no se ofrece a ningún terminal.
- **Modelos y terminales de la funcionalidad son los valores por defecto de sus partes.** El análisis de la funcionalidad usa su fase de análisis; sus campos de ejecución no se usan en ella misma, solo se heredan.
- **El análisis exige al menos una parte** (`sin_partes`). Si el agente concluye que no es viable, lo pregunta con `preguntar` en vez de descomponer.
- **Rama.** Si tiene `rama`, las partes la heredan y los agentes de ejecución trabajan en ella: la crean desde la principal si no existe y hacen ahí sus commits. Al aprobar la descomposición, el servidor crea una última parte «Integrar la rama `<rama>` en la principal» que depende de todas las demás; su ejecución fusiona sin fast-forward, pasa la verificación del repositorio y cita el commit de fusión.
- **Partes añadidas después.** En `doing`, el humano puede crear más partes desde la web con la funcionalidad como padre; nacen en `backlog` y él las pasa a `prepared`. Las hijas de trabajo que creen los agentes de una parte cuelgan de la parte, no de la funcionalidad, y no cuentan para cerrarla.
- **Vueltas atrás.** De `prepared` a `backlog` repite el análisis y deja las partes en `backlog` para que el humano las borre o las conserve. De `done` a `doing` con un comentario, cuando lo entregado no vale: el humano crea las partes que falten.
- **En el índice y en el frontmatter** se ve como `tipo: funcionalidad`, y la línea de índice lleva `funcionalidad 3/7` justo después del estado: partes cerradas sobre partes totales. No lleva segmento `ejecucion:`. El frontmatter añade `rama` si la tiene y `partes: 7` y `partesCerradas: 3`.
- **Borrar.** Una tarea se puede borrar desde la web y el CLI esté en la columna que esté, con confirmación. Es lo que permite podar una descomposición antes de aprobarla y también la salida de una tarea que ya no va a ninguna parte. Se lleva por delante su hilo entero, su consumo y sus dependencias en los dos sentidos; se quedan el rastro de actividad, con el título escrito como texto, y el número, que no se vuelve a repartir. **Una tarea con hijas no se borra** (`con_hijas`): primero se borran ellas, que ahora se puede hacer de abajo arriba. **Una tarea que un terminal tiene en marcha también se borra**, en `doing` o donde esté: el humano manda. Se probó frenarla con un error `en_marcha` y se descartó el mismo día: una fase que se queda en marcha porque el subagente murió dejaba la tarea imposible de borrar. El agente se entera al intentar escribir en ella (`tarea_inexistente`) y `novedades` no avisa de borrados: el bucle espera a sus subagentes y no podría actuar antes. La confirmación dice qué se pierde: cuántos comentarios tiene el hilo, qué terminal la está trabajando si la tiene en marcha, y qué tareas dejan de esperarla. Si era la última parte pendiente de una funcionalidad, borrarla la cierra.
- **Una funcionalidad no admite hijas de trabajo** (`funcionalidad_sin_ejecucion`): sin ese corte, una hija colgada por error contaría como parte y la funcionalidad no podría cerrarse. `partesCerradas` cuenta solo las partes `finished`. Aprobar con preguntas abiertas falla con `tarea_bloqueada`.
- **Una parte creada a mano por el humano** con la funcionalidad como padre hereda la rama igual que las que crea el análisis.

### Tareas que son preguntas

Una pregunta del humano es un encargo cuya salida es una respuesta escrita, no código. Se marca con `tipo: pregunta` al crearla o editarla en `backlog`.

- **Solo tiene fase de análisis.** El comentario `analisis` es la respuesta, y al escribirlo la tarea pasa directamente a `done`. No hay fase de ejecución: `autoejecucion`, la aprobación y la asignación de ejecución no aplican y la web no los muestra.
- **Puede preguntar a su vez.** Si para responder hace falta una decisión del humano, el agente usa `preguntar` como en cualquier tarea; la pregunta queda bloqueada en `prepared` y, contestada, el mismo terminal la retoma y escribe la respuesta.
- **Se responde en llano**, desde el punto de vista de quien preguntó, sin rutas de archivo ni códigos internos. Lo que el agente descubra de paso va como propuesta aparte.
- **En el índice y en el frontmatter** se ve como `tipo: pregunta`, y la línea de índice lleva `pregunta` justo después del estado. Una pregunta no lleva segmento `ejecucion:`.

### Consumo de tokens

Cada tarea guarda cuántos tokens ha costado. Lo reporta el plugin, no el modelo: el modelo no sabe con precisión lo que consume, y un dato autoinformado no sirve para comparar.

- **Se guarda por fase y por modelo**: tokens totales, llamadas a herramientas y duración. La suma de la tarea es la de sus fases.
- **Las hijas suman a la padre.** La ficha muestra el consumo propio y el total con hijas, por separado.
- **Cada fase corre como un subagente propio.** Cuando el subagente termina, Claude Code entrega al agente del bucle un aviso con los tokens totales, las llamadas a herramientas y la duración de ese subagente. El bucle reenvía esas cifras con `reportar_consumo`. Si una fase se retoma tras una pregunta, el nuevo consumo se suma al anterior.
- **Lo que gasta el bucle mientras espera** (llamadas a `novedades`, lecturas de índice) se atribuye al terminal, no a ninguna tarea. Así el coste de una tarea es solo el de trabajarla.
- **El dato sale de la herramienta, no de una estimación del modelo.** El bucle copia la cifra que le da Claude Code; nunca la calcula ni la redondea.
- **Reportar consumo sube la revisión global pero no la de la tarea.** Si la subiera, el agente recibiría su propia tarea como novedad justo después de reportar.
- **El desglose en entrada, salida y caché no está en ese aviso.** Existe en la transcripción de la sesión, pero su formato es interno y no está documentado. Se descarta por ahora; si hiciera falta, sería un campo opcional que solo se rellena cuando se pueda leer de forma estable.

## Proyectos

Un proyecto es un repositorio que se trabaja desde una o varias carpetas locales, cada una con su propio agente. Las tareas viven en un proyecto y los terminales trabajan para un proyecto. Sin proyectos, el servidor no sabía en qué repositorio trabajaba cada terminal: la ruta salía del directorio donde se abrió Claude Code y nunca viajaba al servidor, así que con dos repositorios una tarea `sin terminal` la tomaba el primer terminal que la viera, fuera o no el suyo. Decidido el 14 de septiembre de 2026, junto con: ids globales con chip de proyecto, un terminal pertenece a un solo proyecto, y la página de inicio es la bandeja del humano.

### Campos

```sql
CREATE TABLE proyectos (
  id INTEGER PRIMARY KEY,
  clave TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  repositorio TEXT,
  rama_principal TEXT NOT NULL DEFAULT 'main',
  verificacion TEXT,
  creado TEXT NOT NULL
) STRICT;
```

- **`clave`**: de dos a seis caracteres, mayúsculas y cifras, empieza por letra (`PRI`, `WEB`, `API2`). Es lo que va en las URLs de la web, en el chip de las tarjetas y en el frontmatter. Se fija al crear el proyecto y no se cambia (`clave_invalida` si no cumple la forma, `clave_repetida` si ya existe).
- **`repositorio`**: la URL del remote de git, opcional. Si está, el servidor comprueba al registrar un terminal que trabaja en ese repositorio. Se compara sin espacios alrededor y sin el sufijo `.git` ni la barra final.
- **`rama_principal`**: `main` por defecto. Es la rama desde la que se crean las ramas de las funcionalidades y en la que se integran.
- **`verificacion`**: el comando que tiene que pasar la parte «Integrar la rama en la principal», por ejemplo `cd server && npm test`. Opcional; sin él, el agente de integración pasa la verificación que encuentre en el repositorio.
- **`tareas.proyecto_id`** y **`terminales.proyecto_id`**, `INTEGER NOT NULL REFERENCES proyectos(id)`. La migración crea el proyecto `PRI` «Principal» con id 1 y cuelga de él todo lo existente: para quien tiene un solo repositorio nada cambia. El índice `tareas_por_columna` pasa a ser `(proyecto_id, estado, orden)`.
- **`terminales.ruta`**, `TEXT` opcional: la carpeta local en la que trabaja, tal como la reporta el terminal al registrarse. Es informativa; se enseña en la lista de terminales.

### Reglas

- **Un terminal pertenece a un proyecto** y se elige en el alta; no se cambia después: una máquina con tres repositorios tiene tres terminales, uno por carpeta, cada uno con su token. Es lo que ya ocurría de hecho; lo nuevo es que el servidor lo sabe.
- **`registrar_terminal` recibe `ruta` y `repositorio`, opcionales**, que el bucle conoce sin preguntar a nadie: su directorio de trabajo y la URL del remote si es un repositorio git. Guarda la ruta y, si el proyecto tiene `repositorio` y el reportado no coincide, falla con `proyecto_no_coincide` y el bucle para en esa vuelta. Si alguno de los dos no tiene repositorio, no se comprueba nada. Devuelve tras la cuenta las líneas `proyecto: PRI · Principal`, `rama principal: main` y, si la hay, `verificacion: <comando>`; el bucle las apunta y las pasa al prompt de la parte de integración.
- **Una tarea nace en el proyecto de quien la crea.** Desde la web, el del tablero en el que se está; una hija o una parte, el de su padre; una propuesta, el del terminal que la propone. Las clases `hija` y `parte` no reciben proyecto: lo heredan.
- **`novedades`, `listar_tareas` y `tomar_tarea` están acotadas al proyecto del terminal.** `sin terminal` pasa a significar «cualquier terminal de este proyecto». `tomar_tarea` sobre una tarea de otro proyecto falla con `otro_proyecto`. `leer_tarea` no se acota: es de solo lectura y una dependencia puede citar una tarea de otro proyecto.
- **Las dependencias no cruzan proyectos** (`dependencia_otro_proyecto`). Una dependencia entre repositorios es una integración que merece su propia tarea, no una arista.
- **Una tarea cambia de proyecto solo en `backlog`**, desde la edición de la web, y solo si no tiene padre, ni hijas, ni dependencias en ningún sentido (`no_cambia_de_proyecto`). Sus asignaciones de terminal se ponen a nulo, porque un terminal es de un solo proyecto.
- **`orden` sigue siendo global por columna.** El tablero de un proyecto enseña un subconjunto en ese orden y reordena «entre las del proyecto» con el mismo mecanismo que el tablero de una funcionalidad reordena entre hermanas: `reordenar` recibe `entre: { proyectoId }` y coloca la tarjeta justo detrás de la que la precede en esa vista.
- **Un proyecto se borra solo vacío**: sin tareas (`proyecto_con_tareas`) y sin terminales (`proyecto_con_terminales`). El proyecto 1 no se borra nunca (`proyecto_principal`): es donde caen las cosas por defecto.
- **Crear, editar y borrar un proyecto dejan rastro** (`alta_proyecto` con detalle `clave WEB`, `editar_proyecto` con los campos que cambiaron como en `editar_tarea`, `baja_proyecto`) con `objeto = 'proyecto'`, y **no suben la revisión**: ningún agente lo ve hasta que registra su terminal.
- **El CLI y el primer arranque** crean terminales en `PRI` salvo que se dé la clave: `npm run cli -- crear-terminal <usuario> <nombre> <cuenta> [clave]`. Hay también `npm run cli -- crear-proyecto <clave> <nombre>`.

### En el Markdown

- **El frontmatter lleva `proyecto: PRI`** justo debajo de `id`. La línea de índice no lo lleva: el agente solo ve tareas de su proyecto.
- **Los agentes no saben que hay proyectos.** Ninguna herramienta recibe un proyecto: sale del token del terminal. Es lo que permite que el plugin y la skill sigan iguales salvo por las dos líneas nuevas de `registrar_terminal`.

### En la web

- **El proyecto va en la URL, no en una cookie**: `/p/WEB/tareas`, `/p/WEB/tareas/kanban`, `/p/WEB/tareas/nueva` y `/p/WEB/funcionalidades` son las vistas de siempre acotadas a ese proyecto. Los enlaces se comparten y se abren en varias pestañas sin estado escondido. Una clave que no existe es 404.
- **Las rutas sin prefijo son la vista cruzada**: `/tareas`, `/tareas/kanban` y `/funcionalidades` enseñan todos los proyectos, con el chip de la clave en cada fila y tarjeta y un filtro por proyecto. En la vista cruzada el kanban no admite arrastrar entre proyectos; el arrastre reordena la columna global como hasta ahora.
- **La ficha sigue en `/tareas/T-0042`**, porque el id es global. Las migas dicen `WEB › Tareas › T-0042` y el bloque de propiedades lleva la fila Proyecto.
- **Selector de proyecto** en lo alto de la barra lateral, debajo del nombre de la aplicación: un desplegable con «Todos los proyectos» y cada proyecto por su clave y nombre. Cambiarlo lleva a la misma vista en el proyecto elegido. Las entradas Lista, Kanban y Funcionalidades de la navegación apuntan al proyecto de la URL actual, o a la vista cruzada si no hay ninguno.
- **`GET /proyectos`, `POST /proyectos`, `POST /proyectos/:id/editar`, `POST /proyectos/:id/borrar`** en el bloque «Sistema» de la navegación: tabla con clave, nombre, repositorio, rama principal, tareas abiertas, terminales y «Creado por»; alta con los campos de arriba; edición de todo salvo la clave; borrado con confirmación en página aparte.
- **El alta de un terminal pide el proyecto** con un desplegable, `PRI` preseleccionado. La lista de terminales lleva la columna Proyecto y la ruta reportada en texto suave debajo del nombre.
- **El chip de proyecto** es la clave en una etiqueta gris (`etiqueta(clave, "gris", "proyecto")`). No hay color por proyecto: los colores son de los usuarios.

## Formato Markdown

El servidor es el único que escribe el formato. Los agentes envían contenido (texto de un comentario, campos de una pregunta) y el servidor lo coloca en el documento con su cabecera. Así ningún agente puede romper la estructura y todos los documentos se leen igual.

### Documento de una tarea

Es lo que devuelve `leer_tarea`. Frontmatter YAML con los campos, y después el cuerpo en tres bloques fijos: descripción, hijas e hilo.

```markdown
---
id: T-0042
proyecto: PRI
titulo: "Exportar el listado de clientes a CSV"
tipo: tarea
estado: done
orden: 3
padre: T-0040
autoejecucion: true
marcas: []
analisis:
  modelo: sonnet
  terminal: portatil-ana
ejecucion:
  modelo: opus
  terminal: portatil-ana
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

### analisis · sonnet@portatil-ana · 2026-09-04T08:35:00Z

Hay que añadir un botón en el listado que descargue lo que se ve en
pantalla con los filtros aplicados. Riesgo: listados muy grandes.

### pregunta · opus@portatil-ana · 2026-09-04T09:10:00Z · P1

**¿Qué separador usamos en el CSV?**

Por qué importa: la hoja de cálculo de los comerciales está en español
y abre mal los ficheros separados por coma.

Opciones:
- **Coma**: es el estándar, pero los comerciales tendrán que importar a mano.
- **Punto y coma**: se abre directamente en su hoja de cálculo; otros programas pueden fallar.
- **No hacer nada**: no se exporta y siguen copiando a mano.

Recomendación: Punto y coma.

### respuesta · humano:ana · 2026-09-04T12:00:00Z · P1

Opción: **Punto y coma**

Nota: si algún día lo usa otro equipo, ya lo cambiaremos.

### comentario · opus@portatil-ana · 2026-09-04T12:20:00Z

Botón añadido y fichero generándose. Faltan los tests.

### resultado · opus@portatil-ana · 2026-09-04T13:05:00Z

Qué se construyó: botón «Exportar CSV» en el listado de clientes,
respeta los filtros activos y separa por punto y coma.

Commit: a1b2c3d
```

Convenciones del documento:

- **Cabecera de cada comentario**: `### tipo · autor · fecha`, y un identificador `P<n>` al final solo en preguntas y respuestas, para saber qué respuesta contesta a qué pregunta.
- **Autor**: `modelo@terminal` cuando escribe un agente, `humano:<usuario>` cuando escribe una persona.
- **Fechas** en ISO 8601 y UTC, en el frontmatter y en el hilo.
- **`marcas`** solo lista las activas, como lista en línea: `[bloqueada, en marcha]`. Si no hay ninguna, `[]`.
- **`titulo`** va siempre entre comillas dobles, escapado como JSON. El resto de valores van sin comillas.
- **Una fase sin modelo o sin terminal** escribe `~` en el campo que falta.
- **`consumo`** solo aparece si la tarea o sus hijas tienen consumo. Si una fase se retoma con otro modelo, las cifras se suman y los modelos se unen con `+`.
- **Sin hijas**, el bloque dice `Ninguna.`; **sin comentarios**, el hilo dice `Ninguno.`
- **`revision`** es la revisión global del servidor en el momento de la lectura. El agente la guarda para la siguiente llamada a `novedades`.
- **La descripción se muestra tal como la escribió el humano**, sin tocar. Es el bloque congelado al salir de `backlog`.

### Línea de índice

Es lo que devuelven `listar_tareas` y `novedades` por cada tarea. Una línea, sin cuerpo:

```markdown
- T-0042 · doing · bloqueada · Exportar el listado de clientes a CSV · analisis: sonnet@portatil-ana · ejecucion: opus@portatil-ana
```

Las marcas van entre el estado y el título, separadas por `·`. Si no hay marcas, no aparece nada en esa posición. Una tarea de tipo `pregunta` lleva `pregunta` justo después del estado, antes de las marcas, y no lleva segmento `ejecucion:`. Una de tipo `funcionalidad` lleva `funcionalidad 3/7` en esa misma posición, con las partes cerradas sobre el total, y tampoco lleva `ejecucion:`. Una parte lleva `padre: T-0050` como último segmento. Una fase sin modelo ni terminal se escribe `analisis: sin asignar`; con solo uno de los dos, `analisis: sonnet` o `analisis: @portatil-ana`.

### Salida de `novedades`

```markdown
revision: 190

## Tareas nuevas o cambiadas

- T-0042 · doing · bloqueada · Exportar el listado de clientes a CSV · analisis: sonnet@portatil-ana · ejecucion: opus@portatil-ana
- T-0045 · prepared · sin terminal · Migrar el envío de correos a la cola · analisis: sin asignar · ejecucion: sin asignar

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
- **Gestión simple de usuarios.** Cada usuario tiene un color y se enseña siempre como chip con su inicial.
- **Terminales conectados** con su nombre, cuenta de origen, uso disponible y consumo acumulado del bucle.
- **Toda acción humana deja rastro de quién la hizo**: las respuestas y notas en el hilo, y el resto (crear, editar, mover, aprobar, altas, bajas, cambios de color y contraseña) en la actividad, visible en la ficha y en `/actividad`.
- **La página de inicio es la bandeja del humano**: lo que espera por él, de todos los proyectos. Ver «La bandeja del humano».

### La bandeja del humano

Por diseño el humano es el cuello de botella: es dueño de `backlog`, de `done`, de las aprobaciones y de las respuestas. La bandeja es la única pantalla que le dice qué espera por él, sin barrer el kanban buscando etiquetas. Es `GET /` y cruza todos los proyectos. Decidido el 14 de septiembre de 2026.

Cuatro bloques, siempre los cuatro y en este orden, cada uno con su contador en el título y «Nada pendiente.» cuando está vacío. En pantalla se titulan con el verbo que le toca al humano (Contesta, Aprueba, Revisa, Define; ver «Diseño visual › Pantallas › Bandeja»):

1. **Preguntas sin contestar.** Cada tarea con la marca `bloqueada`, y por cada pregunta abierta la misma tarjeta que en el hilo de la ficha: la pregunta en negrita, por qué importa, las opciones como tarjetas seleccionables con la recomendada marcada, la nota y el botón de responder. Se contesta desde aquí sin abrir la ficha. Una funcionalidad bloqueada sale igual.
2. **Por aprobar.** Las tareas con la marca `análisis listo`. Cada una con el comentario `analisis` renderizado y el botón «Aprobar ejecución» o, en una funcionalidad, «Aprobar descomposición» con la lista de sus partes debajo.
3. **Resultados por revisar.** Todo lo que está en `done`, funcionalidades incluidas. Cada una con su último comentario `resultado` renderizado y el botón «Finalizar»; pedir otra iteración exige un comentario y se hace desde la ficha, que va enlazada.
4. **Backlog sin definir.** Las tareas que llevan más de siete días en `backlog`. Solo el enlace, la edad y el proyecto: es lo que el humano se debe a sí mismo.

- **Cada línea lleva el chip de proyecto** y el enlace a la ficha. Dentro de cada bloque, el orden es de más antigua a más nueva en su estado (`estado_desde`): lo que más tiempo lleva esperando va primero.
- **El contador de pendientes** es la suma de los tres primeros bloques; el backlog no cuenta, porque no bloquea a nadie. Sale en la barra lateral, en la entrada «Bandeja», como un número pequeño a la derecha, y en el título de todas las páginas con sesión: `(3) MCP Tareas`. Sin pendientes, ni número ni prefijo. Es una consulta por página: las marcas se calculan ya al listar.
- **Los formularios de la bandeja llevan un campo oculto `volver`** con la ruta a la que redirigir al terminar (`/`). `POST /tareas/:id/responder/P1`, `POST /tareas/:id/aprobar` y `POST /tareas/:id/mover` lo respetan si es una ruta relativa que empieza por `/` y no por `//`; si no viene o no vale, redirigen a la ficha como siempre. Un `ErrorDeRegla` vuelve a pintar la bandeja con el mensaje y 422.
- **Se refresca en vivo** como la lista: `data-revision` en el `<body>` y recarga con GET cuando la revisión sube. Como la lista, nunca se pinta como respuesta a un POST que haya salido bien: se redirige.
- **La entrada «Bandeja»** es la primera del bloque «Tareas» de la navegación, encima de Lista. Es la vista activa cuando la URL es `/`.

### Edad en columna

Jira enseña cuántos días lleva una incidencia en su columna; aquí es lo que distingue una pregunta abierta de hace tres minutos de una de hace tres días, que hoy parecen iguales.

- **Columna `tareas.estado_desde`**, `TEXT NOT NULL`: cuándo entró la tarea en su estado actual. La migración la rellena con `actualizada`, que es una aproximación solo para las tareas que ya existían. **Todo cambio de estado la pone a la hora actual**, por el camino que sea: mover desde la web, `tomar_tarea` en ejecución, `comentar_tarea` con estado, la aprobación de la descomposición (la funcionalidad y sus partes), el cierre automático de una funcionalidad, y la creación. Un comentario sin cambio de estado no la toca. Se escribe en un solo sitio, el que actualice `estado`; no en cada llamador.
- **La edad** se enseña como `12 min`, `5 h` o `3 d` (`formatos.ts`), en texto suave, en la tarjeta del kanban (a la derecha del id) y en la lista, en la columna Actualizada, que pasa a llamarse «En columna» y a enseñar la edad en vez de la fecha; la fecha completa va en el `title`. En la ficha, la fila Estado del bloque de propiedades añade «desde hace 3 d».
- **Se pinta en `--peligro` cuando duele**: una tarea `bloqueada` que lleva más de un día bloqueada (la edad se toma de la pregunta abierta más antigua, no del estado) y una tarea `done` con más de tres días. En `backlog` y `finished` no se enseña edad: no significa nada ahí.
- **El MCP no la expone.** Los agentes no la necesitan: el humano es quien decide con ella.

### La ficha como vista de incidencia

- **Las preguntas abiertas van arriba**, justo debajo de la cabecera y antes de las propiedades, cada una con su formulario de respuesta. El hilo las sigue enseñando en su posición, sin formulario, con un enlace «Responder arriba». El humano llega a la ficha a contestar y no tiene que bajar hasta el final.
- **A partir de 64 rem la ficha tiene dos columnas**: la principal con descripción, hijas, hilo con su cuadro de comentar y actividad, y a la derecha un panel de 18 rem, fijo al hacer scroll, con las propiedades, el consumo y las acciones excepcionales (`<details>` de «Devolver a por definir», editar y borrar). Para eso la ficha pasa a `ancho: "completo"` como el kanban. En estrecho, el panel va encima de la descripción, como hasta ahora.
- **El hilo se filtra** con tres enlaces encima: «Todo», «Preguntas y respuestas» y «Comentarios y resultados». Es un parámetro `?hilo=preguntas|comentarios` en la misma URL, sin JavaScript. El filtro no afecta al cuadro de comentar ni a la actividad.
- **El cuadro de comentar** cierra el hilo, pegado al último mensaje, como en un chat: un `textarea` y el botón «Comentar». En `done` lleva además «Comentar y pedir otra iteración». En `finished` no hay cuadro. Ver «El hilo como chat».
- **Los ids enlazan.** Una regla de markdown-it convierte cualquier `T-0042` del hilo, la descripción y las notas en un enlace a su ficha. Es el «relates to» de Jira sin tabla nueva.

### Un tablero que se lee de un vistazo

Jira pone en cada tarjeta el progreso de las subtareas y agrupa el tablero en carriles por épica. Aquí los datos ya existen; lo que falta es enseñarlos donde se decide. Decidido el 14 de septiembre de 2026.

**La tarjeta y la fila**

- **Progreso de hijas.** Una tarea con hijas enseña `hijas 2/5`: hijas en `done` o `finished` sobre el total, con una barra fina debajo del título. Es un `<progress class="progreso" value="2" max="5">` estilizado, nunca un ancho en línea: la plantilla no lleva estilos en línea. Una funcionalidad ya enseña `funcionalidad 3/7` en su etiqueta; la barra es la misma y cuenta partes `finished`.
- **Consumo.** Cuando la tarea o sus hijas tienen consumo, la tarjeta y la fila enseñan los tokens totales con hijas, abreviados: `980`, `184 k`, `1,2 M` (`tokensAbreviados` en `formatos.ts`: entero por debajo de mil; miles con `k` y sin decimales hasta un millón; millones con una decimal y coma). Es la cifra que dice si una tarea se ha ido de madre.
- **Esos dos datos van en el índice** (`ItemIndice.hijas`, `hijasCerradas`, `tokensConHijas`), calculados en la misma consulta que el resto con una expresión de tabla recursiva para los descendientes: una consulta por vista, nunca una por tarjeta. El MCP no los enseña en la línea de índice: al agente le basta el frontmatter de `leer_tarea`.
- **En la lista** el progreso va en la columna Título, tras las marcas, y el consumo en una columna nueva «Tokens» alineada a la derecha, con `tabular-nums`.

**Filtros de un clic y búsqueda**

- **Tres conmutadores** a la izquierda de los desplegables de la lista y del tablero, como enlaces con aspecto de botón: «Espera por ti» (tareas `bloqueadas`, con `análisis listo` o en `done`: las mismas que llevan la etiqueta), «Agente trabajando» y «Sin terminal». Van en el parámetro `?rapido=espera|en-marcha|sin-terminal`, uno cada vez; el activo lleva `aria-current="true"` y pulsarlo lo quita. Se combinan con los desplegables y con el ámbito del proyecto.
- **Búsqueda por texto** en la misma fila: un `<input type="search" name="q">` dentro del formulario de filtros. Busca en título y descripción con `LIKE` sobre `lower()`, que en SQLite solo pliega ASCII: «Métrica» no encuentra «métrica» si se escribe con mayúscula acentuada. Es una limitación conocida y aceptada hasta que la cantidad de tareas o las quejas la hagan notar; el salto sería FTS5 con un tokenizador `unicode61`, que Node trae compilado. `ponytail: LIKE sobre lower(), FTS5 unicode61 cuando la búsqueda se quede corta.`
- **Los filtros viven en `listarTareas`**: el filtro recibe `rapido` y `q` y la web no vuelve a filtrar en memoria.

**Carriles por funcionalidad**

- **Un conmutador «Agrupar por funcionalidad»** en la fila de filtros del kanban, global y acotado por proyecto, como enlace que añade `?agrupar=funcionalidad` y, activo, «Sin agrupar» que lo quita. Es un parámetro de la URL, así que el refresco en vivo lo conserva.
- **Agrupado, el tablero es una franja por funcionalidad** más una última franja «Sueltas». Cada franja tiene una cabecera de ancho completo con el chip de proyecto (en la vista cruzada), el id, el título enlazado a su ficha, su etiqueta de estado y su progreso; debajo, las cinco columnas con solo sus tareas. Una tarea va a la franja de su antepasada funcionalidad más cercana (una parte, y también las hijas de trabajo de una parte); sin ninguna, a «Sueltas». Las funcionalidades mismas no se pintan como tarjetas en este modo: son las cabeceras.
- **Salen las funcionalidades que tienen alguna tarea visible** con los filtros activos, en este orden: primero las que están en `doing`, luego `prepared`, `backlog` y `done`, y dentro por `orden`. Una funcionalidad `finished` no tiene franja: sus partes están cerradas. «Sueltas» va siempre la última y siempre se pinta, aunque esté vacía.
- **Arrastrar dentro de una franja** reordena entre hermanas, con `entre: { padreId }` como en el tablero de la ficha de la funcionalidad; en «Sueltas», con `entre: { proyectoId }` si el tablero está acotado o global si no. **Entre franjas no se arrastra**: SortableJS lleva un grupo por franja, así que la tarjeta no se suelta en otra. Mover una tarea de funcionalidad no es una prioridad, es una edición, y va por la ficha.
- **Las columnas de cada franja llevan `data-padre`** con el id de la funcionalidad, o nada en «Sueltas», y el cliente lo manda como ya manda `padre` en el tablero de una funcionalidad; el servidor no distingue de dónde viene.
- **La columna Cerradas** dentro de cada franja enseña todas las de esa funcionalidad, no diez: son pocas. En «Sueltas» siguen siendo las diez más recientes con el enlace a la lista.

### Saber qué cuesta y qué rinde

Jira mide velocidad y tiempo de ciclo de personas. Aquí lo que cuesta dinero es el token y lo que cuesta tiempo es el humano, y las dos cosas ya se guardan. Los informes responden a cuatro preguntas que cambian decisiones: qué modelo poner por defecto en cada fase, cuánto interrumpe cada modelo, dónde se atasca el flujo y qué modelo entrega resultados que no valen. Decidido el 14 de septiembre de 2026.

**Transiciones de estado**

Para medir tiempos hace falta saber cuándo cambió de estado cada tarea, y hoy solo queda el último cambio (`estado_desde`).

```sql
CREATE TABLE transiciones (
  id INTEGER PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id),
  de TEXT,
  a TEXT NOT NULL,
  creado TEXT NOT NULL
) STRICT;
CREATE INDEX transiciones_por_tarea ON transiciones (tarea_id, id);
CREATE INDEX transiciones_por_fecha ON transiciones (a, creado);
```

- **La escribe `cambiarEstado`**, el único sitio que cambia `estado`, y la creación con `de` a nulo. Nada más la escribe. Borrar una tarea se lleva sus transiciones.
- **Empieza vacía**: no se reconstruye el pasado, porque no está. Los informes dicen desde qué fecha tienen datos (la transición más antigua).
- **El MCP no la expone** y la web no la enseña como lista: solo la resume en los informes.

**Informes**

- **`GET /informes`** y **`GET /p/:clave/informes`**, entrada «Informes» al final del bloque «Tareas» de la navegación. Un selector de periodo `?dias=7|30|90|todo`, 30 por defecto, como enlaces con el activo marcado. El periodo acota por la fecha del dato de cada tabla: `consumo.creado` en tokens, `comentarios.creado` en preguntas, `transiciones.creado` en ciclo y devolución.
- **Cuatro tablas**, en este orden, cada una con su pregunta como título:
  1. **¿Qué cuesta cada modelo?** Por fase y modelo: tareas trabajadas (distintas), tokens totales, tokens por tarea (media), llamadas a herramientas por tarea y duración media. De `consumo`. Ordenada por fase y después por tokens totales descendentes.
  2. **¿Cuánto interrumpe cada modelo?** Por modelo: preguntas hechas (comentarios `pregunta` cuyo autor empieza por ese modelo), tareas en las que trabajó (distintas en `consumo`) y preguntas por tarea. Un modelo que pregunta mucho entiende mal las descripciones o las descripciones son malas; las dos cosas se ven aquí.
  3. **¿Dónde se atasca el flujo?** Por modelo de ejecución: tareas que llegaron a `done` en el periodo, tiempo de ciclo mediano (de la primera entrada en `prepared` a la entrada en `done`) y tiempo de revisión mediano (de `done` a `finished`, solo las que ya están `finished`). El primero es del agente; el segundo, del humano. Se enseñan como `edad` (`3 d`, `5 h`).
  4. **¿Qué modelo entrega resultados que no valen?** Por modelo de ejecución: entradas en `done` en el periodo, devoluciones (`done → doing`) y la tasa. Una tarea devuelta dos veces cuenta dos.
- **Debajo, el ritmo**: tareas que llegaron a `done` por semana en el periodo, como tabla de dos columnas (semana, tareas) con la barra de progreso de la tarjeta como gráfico, con el máximo como `max`. Sin librería de gráficos.
- **Acotado por proyecto**, cada tabla mira solo sus tareas; en la vista cruzada, todas. El tipo `funcionalidad` queda fuera de todas las tablas: no se ejecuta ni consume, y la 3 y la 4 son de partes y tareas.
- **Las consultas viven en `src/db/informes.ts`**, una función por tabla, cada una una sola sentencia SQL; la web no agrega en memoria. Las medianas se calculan en SQL con `ORDER BY` y `LIMIT/OFFSET` sobre el recuento, o en la función si SQLite lo hace incómodo; en ningún caso en la ruta.
- **Vacío**: cada tabla dice «Sin datos en este periodo.» y el pie de página dice desde cuándo hay transiciones.

**Presupuesto**

- **`tareas.presupuesto INTEGER`** opcional, en tokens. Se edita en `backlog` como el resto de campos, en tareas y funcionalidades; una funcionalidad no lo hereda a sus partes: es el tope del conjunto y se compara con su consumo con hijas.
- **Marca derivada `sobre presupuesto`**, en naranja: hay presupuesto y `tokensConHijas` lo supera. Sale en tarjeta, fila, ficha, bandeja y en el frontmatter (`marcas: [sobre presupuesto]`), como las demás. No frena a nadie: el humano decide qué hacer con el aviso.
- **Donde se enseña**: la tarjeta y la fila pintan `184 k / 200 k` en vez de solo los tokens cuando hay presupuesto; la ficha añade la fila Presupuesto a las propiedades y el consumo enseña «184 600 de 200 000». Los formularios de alta y edición llevan un `<input type="number" min="0" step="1000">` «Presupuesto en tokens», vacío por defecto.
- **En el frontmatter** aparece `presupuesto: 200000` tras `autoejecucion` solo cuando lo hay. `editar_tarea` deja `presupuesto: — → 200 k` en el rastro (o `200 k → —` al quitarlo). Cambiarlo es contenido y sube la revisión como cualquier edición.
- **`marcasDe` recibe los tokens** con hijas y el presupuesto; el índice ya trae `tokensConHijas` y `leerTarea` ya calcula el total con hijas para la ficha.

### Avisos fuera de la web

El contador de la pestaña cubre el caso de tener la web abierta. Para el resto, un aviso por cada cosa que un agente deja esperando al humano, enviado a una URL que él elige. Con un servicio como ntfy llega al móvil sin más código. Sin correo ni push del navegador. Decidido el 14 de septiembre de 2026.

- **Variable `AVISOS_URL`**, opcional. Si falta, no se envía nada y no se avisa de ello. Si está, cada aviso es un `POST` a esa URL con `Content-Type: text/plain; charset=utf-8` y el texto del aviso como cuerpo: dos líneas, la frase y el enlace a la ficha compuesto con `BASE_URL`. Es el formato que ntfy acepta tal cual; cualquier otro receptor recibe texto llano.
- **Tres cosas avisan**, siempre que las provoque un agente:
  - una pregunta nueva (`preguntar`): `T-0042 pregunta: «¿Qué separador usamos en el CSV?»`;
  - una tarea que pasa a `done` (comentario `resultado`, o el `analisis` que cierra una tarea de tipo `pregunta`): `T-0042 hecha: «Exportar el listado de clientes a CSV»`. Una funcionalidad no avisa al cerrarse: se cierra cuando el humano finaliza su última parte, y eso lo hace él;
  - un análisis que se queda esperando aprobación (comentario `analisis` con `autoejecucion` desactivada, o la descomposición de una funcionalidad): `T-0042 análisis listo: «…»` o `T-0050 descomposición lista: «…»`.
  Lo que hace el humano desde la web no avisa: ya lo sabe.
- **Se envía después de confirmar la transacción**, nunca dentro: un receptor caído no puede tumbar una escritura. Lo hace la herramienta MCP que provocó el cambio, no `src/db/`, que no sabe de HTTP. La función que envía no lanza nunca: con fallo o tiempo de espera (cinco segundos) escribe una línea en stderr y sigue. La respuesta al agente no espera al aviso.
- **`src/avisos.ts`** expone `crearAvisador({ url, baseUrl, enviar? })` que devuelve `avisar(evento)`; `enviar` es la función que hace el POST, y los tests le pasan una que apunta. Sin `url`, `avisar` es una función vacía. `app.ts` lo crea y se lo pasa al handler del MCP con el resto de dependencias.
- **`compose.yaml`** pasa `AVISOS_URL` como `DIRECCIONES`: opcional, sin valor por defecto.

### Sesión y seguridad

- **Login con usuario y contraseña** contra la tabla `usuarios`; contraseñas con scrypt. Cookie de sesión firmada con `SESSION_SECRET`, `HttpOnly`, `SameSite=Lax`, treinta días.
- **Toda la web exige sesión** salvo `/login` y `/salud`. Sin sesión, redirección a `/login`.
- **Los formularios son POST con cookie `SameSite=Lax`** y el servidor rechaza cualquier POST cuya cabecera `Sec-Fetch-Site` sea `cross-site`. No hay tokens CSRF aparte.
- **El Markdown del hilo se renderiza con markdown-it y HTML crudo desactivado.** Es la única entrada de terceros que llega al navegador.

### Rutas

| Ruta | Qué es |
|---|---|
| `GET /login`, `POST /login`, `POST /logout` | Sesión |
| `GET /` | La bandeja del humano. Ver «La bandeja del humano» |
| `GET /tareas` | Vista lista: tareas agrupadas por estado en el orden de las columnas, con filtros por estado, terminal y marca. Ocupa todo el ancho, como el kanban (`ancho: "completo"`): una tabla de seis columnas no cabe bien en 60 rem |
| `GET /tareas/kanban` | Vista kanban con las cinco columnas y arrastre entre columnas y dentro de ellas |
| `GET /tareas/nueva`, `POST /tareas` | Crear una tarea en `backlog` |
| `GET /tareas/T-0042` | Ficha: campos, descripción, hijas, hilo con el cuadro de comentar, preguntas abiertas con formulario de respuesta, acciones según estado, consumo |
| `POST /tareas/T-0042/editar` | Solo en `backlog`: título, descripción, asignaciones, `autoejecucion` |
| `POST /tareas/T-0042/mover` | Las transiciones del humano, con comentario cuando es vuelta atrás (es lo que usa el arrastre del tablero) |
| `POST /tareas/T-0042/aprobar` | Aprueba la ejecución cuando `autoejecucion` está desactivada; en una funcionalidad, aprueba la descomposición: pasa a `doing` y sus partes en `backlog` a `prepared` |
| `POST /tareas/T-0042/borrar` | Borra la tarea en cualquier estado, con confirmación en página aparte |
| `GET /funcionalidades` | Las funcionalidades como filas: estado, progreso en partes cerradas sobre total, bloqueadas y esperando, consumo acumulado, rama y quién la creó |
| `GET /tareas/T-0050` de una funcionalidad | Su ficha es su propio tablero: encima la descripción, el hilo de decisiones y el botón de aprobar la descomposición; debajo el kanban solo con sus partes, cada una con sus dependencias |
| `POST /tareas/T-0042/responder/P1` | Guarda la opción elegida por su texto y la nota |
| `POST /tareas/T-0042/comentar` | Comentario del humano en el hilo. Con el campo `iterar` y la tarea en `done`, además la devuelve a `doing` en la misma transacción |
| `POST /tareas/T-0042/orden` | Reordena dentro de la columna, o cambia de columna cuando la transición es del humano |
| `GET /terminales`, `POST /terminales`, `POST /terminales/:id/revocar`, `POST /terminales/:id/rotar`, `POST /terminales/:id/borrar` | Terminales: lista con uso disponible y conexión; alta que enseña el token una sola vez junto con su enlace de conexión y el tutorial; revocación; rotación del token; borrado |
| `GET /p/:clave/tareas`, `GET /p/:clave/tareas/kanban`, `GET /p/:clave/tareas/nueva`, `GET /p/:clave/funcionalidades` | Las mismas vistas acotadas a un proyecto. Ver «Proyectos › En la web» |
| `GET /proyectos`, `POST /proyectos`, `GET /proyectos/:id/editar`, `POST /proyectos/:id/editar`, `GET /proyectos/:id/borrar`, `POST /proyectos/:id/borrar` | Proyectos: lista, alta, edición y borrado con confirmación en página aparte |
| `GET /ir` | Redirige al destino que lleva el selector de proyecto de la barra lateral. Cada opción del `<select>` lleva su destino y la ruta lo valida con `destinoSeguro`: así el selector funciona sin JavaScript, dentro de un `<form method="get">` con botón «Ir» que el cliente esconde |
| `POST /terminales/:id/agentes` | Cambia cuántos agentes en paralelo asume el terminal. Ver «Agentes en paralelo» |
| `GET /terminales/conectar` | El tutorial de conexión. Con `?token=` lleva ese token puesto y no exige sesión; sin él, `<token>` como marcador y sesión como el resto de la web |
| `GET /usuarios`, `POST /usuarios`, `POST /usuarios/:id/borrar`, `POST /usuarios/contrasena` | Usuarios: alta con color, baja (nunca el último) y cambio de la propia contraseña |
| `POST /usuarios/:id/color` | Cambia el color de un usuario |
| `GET /actividad` | Las últimas cien acciones humanas, con quién hizo cada una |
| `GET /informes`, `GET /p/:clave/informes` | Los cuatro informes y el ritmo, con selector de periodo. Ver «Saber qué cuesta y qué rinde» |
| `GET /eventos` | SSE con la revisión actual, para que la lista y el kanban se refresquen |

Las acciones del humano sobre tareas llaman a las funciones de `src/db/`; la web no reimplementa reglas. Un `ErrorDeRegla` en un POST vuelve a pintar la página de origen con el mensaje tal cual y estado 422; una acción que sale bien redirige (POST, redirección, GET). El error de login responde 401 con el formulario.

### Decisiones de la web

- **El nombre visible del proyecto es «MCP Tareas».** La web habla en castellano llano: las columnas se titulan Por definir, Preparadas, En curso, Hechas y Cerradas, y ningún nombre interno (`prepared`, `doing`, `analisis`, `bloqueada`…) llega a la pantalla. El mapa completo está en «Diseño visual › Vocabulario». Los valores de formularios, URLs y clases CSS siguen siendo los internos.
- **El CSS y el JavaScript propio se sirven desde constantes** (`src/web/estilos.ts` en `/static/app.css`, `src/web/cliente.ts` en `/static/app.js`). SortableJS se instala como dependencia npm y se sirve desde `node_modules` en `/static/sortable.min.js`. No hay archivos estáticos en disco ni cambios en el Dockerfile.
- **Arrastrar una tarjeta en el kanban** llama a `POST /tareas/T-0042/orden` con la columna y la posición de destino. Dentro de la misma columna es `reordenar`; a otra columna es `moverTareaHumano` seguido de `reordenar`, y si la transición exige nota el navegador la pide antes de enviar. Una transición no permitida devuelve 422 y el tablero se recarga tal como está en el servidor.
- **Usuarios.** Borrar un usuario es contenido y sube la revisión; cambiar la contraseña no. No se puede borrar el último usuario (`ultimo_usuario`) ni uno con terminales a su nombre (`usuario_con_terminales`): el token quedaría sin dueño. Al borrar, las referencias en tareas y preguntas quedan a nulo; el autor ya está escrito como texto en el hilo.
- **Editar una tarea solo en `backlog`** (`solo_en_backlog`): título, descripción, asignaciones y `autoejecucion`. También `tipo`, `rama`, padre (una funcionalidad) y dependencias (cualquier tarea que no sea ella misma ni cierre un ciclo).
- **Funcionalidades en el kanban y la lista globales.** Aparecen como tarjetas con la etiqueta `funcionalidad 3/7`; sus partes llevan el chip de la funcionalidad y se puede filtrar por ella. Las tareas sueltas siguen existiendo: no todo cuelga de una funcionalidad. La marca `esperando` se pinta en naranja como `sin terminal`, y el tipo `funcionalidad` en azul.
- **`markdown-it` trae sus propios tipos**; no se instala `@types/markdown-it`.
- **Refresco en vivo.** Solo la lista, el kanban y la ficha llevan `data-revision` en el `<body>` y abren la conexión SSE; las demás páginas no la necesitan. La lista se recarga pidiendo la misma dirección con GET, nunca con `reload()`, porque una página pintada como respuesta a un POST reenviaría el formulario. El aviso de la ficha se dispara con cualquier escritura de contenido, porque la revisión es global. **Solo la pestaña visible mantiene la conexión abierta**: al pasar a segundo plano (`visibilitychange` a `hidden`) el cliente la cierra, y al volver la abre de nuevo. Los navegadores limitan a seis las conexiones simultáneas por servidor en HTTP/1.1, y cada pestaña del tablero ocupaba una para siempre: con seis abiertas, cualquier petición nueva se quedaba en cola y la web parecía lenta. No hace falta comprobar nada al volver: el primer evento de la conexión nueva trae la revisión actual y, si subió, dispara el mismo refresco de siempre.
- **SortableJS se carga a demanda** con una etiqueta `<script>` solo donde hay tablero: el resto de páginas no descarga los 45 KB.
- **`POST /tareas/T-0042/orden`** responde 204, o `{ codigo, mensaje }` con 422 (`nota_obligatoria`, `transicion_no_permitida`, `estado_desconocido`, `orden_invalido`) o 404 (`id_invalido`, `tarea_inexistente`). En la columna Cerradas se muestran las diez más recientes y un enlace a la lista completa.
- **Reordenar dentro del tablero de una funcionalidad.** Cuando el tablero está acotado por `padre`, el cliente manda `padre` con la posición y el servidor la interpreta **entre hermanas**: la tarjeta queda justo detrás de la hermana que la precede en esa posición, o justo delante de la primera hermana si se suelta arriba. La columna global se reordena en consecuencia sin mover a las tareas que no son hermanas entre sí. `reordenar` recibe ese ámbito como `entre: { padreId }`; sin él, la posición sigue siendo global. Si una funcionalidad tiene una sola parte en la columna, soltar no cambia nada.
- **Orden de rutas.** Hono resuelve por orden de registro: `GET /tareas/kanban` se registra antes que `GET /tareas/:id`.

### Diseño visual

La web es el puesto de mando de una persona que dirige agentes: lo que le importa es saber qué espera por ella y en qué punto del ciclo está cada tarea. Rediseñada el 14 de septiembre de 2026 con esa idea. Todo el estilo sale de `src/web/estilos.ts`; los componentes reutilizables (etiquetas, chips, cabecera de página, propiedades, pasos del ciclo) de `src/web/componentes.ts`; el esqueleto de página de `src/web/plantilla.ts`; las palabras de `src/web/vocabulario.ts`. Ningún estilo en línea en las plantillas.

**Tres principios**

1. **El color dice de quién es el turno.** Un único color de señal, `--turno` (ámbar), marca todo lo que espera por el humano: el contador de la bandeja, la etiqueta «Espera por ti» de las tarjetas, el paso actual del ciclo cuando es suyo. Ningún otro elemento lo usa. El acento de acciones y enlaces es otro color (`--acento`, verde petróleo) para que la señal no se confunda con un botón. Lo del agente y del servidor queda neutro.
2. **Cada pantalla dice para qué sirve** en una frase debajo del título, en `--texto-suave`, escrita desde el punto de vista del humano («Lo que espera por ti, de todos los proyectos.»). Ningún rótulo en mayúsculas, ningún punto medio como separador de texto, ningún nombre interno.
3. **El ciclo se ve.** La ficha enseña los cinco pasos con su dueño debajo y qué pasa ahora; la bandeja se ordena por lo que el humano tiene que hacer, no por columnas.

**Vocabulario** (`src/web/vocabulario.ts`, un mapa por concepto; nada más traduce)

| Interno | En la web |
|---|---|
| `backlog` | Por definir |
| `prepared` | Preparada (columna: Preparadas) |
| `doing` | En curso |
| `done` | Hecha (columna: Hechas) |
| `finished` | Cerrada (columna: Cerradas) |
| marca `bloqueada` | Pregunta abierta |
| marca `sin terminal` | Sin terminal |
| marca `en marcha` | Agente trabajando |
| marca `análisis listo` | Por aprobar |
| marca `esperando` | Espera a otra tarea |
| marca `sobre presupuesto` | Sobre presupuesto |
| tipo de tarea `pregunta` | Pregunta |
| tipo de tarea `funcionalidad` | Funcionalidad 3/7 |
| comentario `analisis` / `pregunta` / `respuesta` / `resultado` / `comentario` | Análisis / Pregunta / Respuesta / Resultado / Comentario |
| fase `analisis` / `ejecucion` | Análisis / Ejecución |
| dueño de columna | tú / el agente / nadie |
| `done → doing` | Comentar y pedir otra iteración |
| `prepared → backlog` | Devolver a por definir |

Los filtros, los `<option value>`, las URLs (`?estado=prepared`), las clases CSS (`estado-prepared`, `marca-bloqueada`, `tipo-analisis`) y el Markdown del MCP no cambian: solo el texto que ve la persona.

**Esqueleto**

- **Barra lateral** a la izquierda, 15 rem, fondo `--fondo-lateral`. Arriba el nombre de la aplicación y el selector de proyecto. Después la navegación: primero «Bandeja» sola, con el contador de pendientes en `--turno`; luego el bloque «Trabajo» (Tareas, Funcionalidades, Informes, Actividad) y el bloque «Configuración» (Proyectos, Terminales, Usuarios). Los títulos de bloque van en `--texto-suave`, tamaño pequeño, sin mayúsculas. La entrada activa lleva fondo `--fondo-hover` y texto en negrita. La vista activa se deduce de `vista`; «Tareas» está activa en la lista, el tablero, la ficha y el alta.
- **Abajo en la barra**: el conmutador de tema y, debajo, el chip del usuario con el botón «Salir». Ver «Tema».
- **Por debajo de 48 rem** la barra se oculta y aparece una cabecera con el nombre de la aplicación y un botón «☰» que la despliega como panel sobre el contenido; `cliente.ts` alterna la clase `lateral-abierta` en `<body>`. Los `data-vista` y `data-revision` del `<body>` no cambian.
- **Contenido** con ancho máximo de 64 rem y relleno de 2.5 rem arriba, salvo las vistas de tablero, lista y ficha, que ocupan todo el ancho (`ancho: "completo"` en `pagina`).
- **Cada página empieza con `cabeceraPagina`**: migas (`PRI › Tareas › T-0042`), título en 1.75 rem y peso 600, debajo la frase de propósito (`proposito`) en `--texto-suave`, y debajo las etiquetas de estado y marcas cuando las hay; a la derecha las acciones principales como botones. Las páginas sin sesión (login) no tienen barra lateral: una tarjeta centrada de 22 rem con el nombre de la aplicación y el formulario.

**Tema**

- **Tres opciones**: Claro, Oscuro y Sistema, como un grupo de tres botones en la barra lateral (`fieldset.tema` con radios estilizados; el `legend` es «Tema»). Sistema es el valor por defecto y sigue a `prefers-color-scheme`.
- **Se guarda en el navegador** (`localStorage`, clave `tema`, valores `claro` y `oscuro`; Sistema borra la clave). Es una preferencia de quien mira, no del usuario: no toca el servidor ni la revisión.
- **Se aplica antes de pintar**: un `<script>` mínimo en el `<head>`, antes de la hoja de estilos, lee la clave y pone `data-tema="claro|oscuro"` en `<html>`. Sin él la página parpadearía en el tema del sistema al cargar. Es el único JavaScript en línea de la web; no usa `eval` ni `new Function`.
- **En CSS**, `:root` define la paleta clara; `:root[data-tema="oscuro"]` y `@media (prefers-color-scheme: dark) { :root:not([data-tema="claro"]) }` redefinen los mismos tokens. `color-scheme` va con cada bloque (`light`, `dark`), para que los controles nativos y las barras de scroll sigan al tema. Ningún color se define fuera de los tokens y de la tabla de nueve colores.

**Tokens** (variables CSS en `:root`):

| Token | Claro | Oscuro | Para qué |
|---|---|---|---|
| `--fondo` | `#ffffff` | `#1b2027` | el papel: contenido, tarjetas, controles |
| `--fondo-lateral` | `#f4f5f7` | `#14181d` | el suelo: barra lateral, cabeceras de franja, filas alternas |
| `--fondo-hover` | `rgba(28, 36, 48, 0.06)` | `rgba(255, 255, 255, 0.06)` | al pasar, entrada activa, fondo de controles |
| `--texto` | `#1c2430` | `rgba(255, 255, 255, 0.86)` | tinta |
| `--texto-suave` | `rgba(28, 36, 48, 0.62)` | `rgba(255, 255, 255, 0.5)` | rótulos, frases de propósito, metadatos |
| `--borde` | `rgba(28, 36, 48, 0.14)` | `rgba(255, 255, 255, 0.12)` | bordes de tarjeta, tabla y separadores |
| `--acento` | `#0f766e` | `#34b8ab` | enlaces, botón principal, anillo de foco |
| `--turno` | `#b45309` | `#f59e0b` | la señal: lo que espera por el humano |
| `--turno-fondo` | `#fff4e5` | `rgba(245, 158, 11, 0.14)` | fondo suave de la etiqueta «Espera por ti» y del paso actual |
| `--peligro` | `#b91c1c` | `#f87171` | borrar, rechazar, edades que duelen |

Tipografía `"Avenir Next", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif`, una sola familia, 15 px de base, interlineado 1.5. Escala: `h1` 1.75 rem / 600, `h2` 1.2 rem / 600, `h3` 1 rem / 600, texto pequeño 0.8125 rem. Los ids y las cifras van con `font-variant-numeric: tabular-nums`, no en monoespaciada; la monoespaciada es solo para código y comandos. Radio de 4 px en controles y 8 px en tarjetas. Sin sombras salvo la tarjeta del tablero al arrastrar y el panel lateral en móvil. Los controles de formulario no tienen borde propio: fondo `--fondo-hover`, y al enfocar un anillo de 2 px en `--acento`. `prefers-reduced-motion: reduce` apaga toda transición.

**Nueve colores de etiqueta**, fijos e iguales en los dos temas salvo el fondo. Cada uno es una clase `.color-<nombre>`: fondo suave y texto oscuro en claro; fondo oscuro y texto `rgba(255, 255, 255, 0.81)` en oscuro.

| Nombre | Claro (fondo / texto) | Oscuro (fondo) |
|---|---|---|
| `gris` | `#e3e2e0` / `#32302c` | `#373737` |
| `marron` | `#eee0da` / `#442a1e` | `#603b2c` |
| `naranja` | `#fadec9` / `#49290e` | `#854c1d` |
| `amarillo` | `#fdecc8` / `#402c1b` | `#89632a` |
| `verde` | `#dbeddb` / `#1c3829` | `#2b593f` |
| `azul` | `#d3e5ef` / `#183347` | `#28456c` |
| `morado` | `#e8deee` / `#412454` | `#492f64` |
| `rosa` | `#f5e0e9` / `#4c2337` | `#69314c` |
| `rojo` | `#ffe2dd` / `#5d1715` | `#6e3630` |

**Qué color lleva cada cosa**

- Estados: `backlog` gris, `prepared` azul, `doing` amarillo, `done` verde, `finished` marrón.
- Marcas: `bloqueada` rojo, `sin terminal` naranja, `en marcha` morado, `análisis listo` rosa, `esperando` naranja, `sobre presupuesto` naranja.
- Tipos de comentario: `analisis` azul, `pregunta` rojo, `respuesta` verde, `resultado` morado, `comentario` gris.
- Tipo de tarea `pregunta`: rosa.
- Los usuarios eligen entre los ocho que no son gris. El gris es de quien no tiene color: agentes y usuarios borrados.
- **«Espera por ti»** no es una marca guardada: es la etiqueta que la tarjeta, la fila y la ficha pintan en `--turno` sobre `--turno-fondo` (`insignia turno`) cuando la tarea está `done` o lleva `bloqueada` o `análisis listo`: exactamente lo que cuenta el contador de pendientes y lo que filtra el conmutador rápido, que se llama igual, «Espera por ti». `backlog` no la lleva: la columna entera es del humano y marcarla una a una sería ruido. Es lo único que va en ese color además del contador de la bandeja y el paso actual del ciclo.

**Etiquetas y chips** (`src/web/componentes.ts`)

- `etiqueta(texto, color, clase?)` pinta `<span class="insignia estado-prepared color-azul">Preparada</span>`. Estado, marcas y tipos de comentario son etiquetas; el texto sale del vocabulario, las clases `estado-*`, `marca-*` y `tipo-*` llevan el nombre interno para que los tests las encuentren, y el color va siempre en la última clase.
- `pasosDelCiclo(tarea)` pinta el ciclo como `<ol class="ciclo">` con cinco `<li>`: el nombre de la columna, el dueño debajo («tú», «el agente», «nadie») y, en el paso actual (`aria-current="step"`), una frase de qué pasa ahora: «Termina de definirla y pásala a preparadas», «El agente de análisis la está estudiando», «Espera tu respuesta a P1», «Espera tu aprobación del análisis», «El agente la está ejecutando», «Revisa el resultado», «Cerrada». Los pasos pasados van tachados en `--texto-suave`; el actual en `--turno` si el turno es del humano y en `--acento` si es del agente, y su dueño dice a quién le toca de verdad («tú» en una Preparada bloqueada, aunque la columna sea del agente); en los demás pasos el dueño es el de la columna. Una pregunta salta el paso En curso; una funcionalidad dice «Revisa las partes» en Preparada y «Las partes se están trabajando» en En curso.
- `chipUsuario(nombre, color)` es un círculo con la inicial en mayúscula sobre el color y el nombre al lado: `<span class="chip color-azul"><span class="inicial">A</span>ana</span>`. Es la única forma de enseñar a un usuario en la web: navegación, hilo, actividad, listas.
- `chipAutor(autor, colorDe)` traduce el autor de un comentario: `humano:ana` es el chip de ese usuario, con su color actual o gris si ya no existe; `opus@portatil-ana` es un chip gris con la inicial del modelo, el modelo y `@terminal` en texto suave. `colorDe` es la función que devuelve `buscadorDeColor(db)`: lee la tabla de usuarios una vez por página y da el color de un nombre, o `null`.
- Otras ayudas del mismo archivo: `fraseDeAccion(accion)` (la frase en pasado de cada acción del rastro, «movió la tarea»), `selectorDeColor(titulo, elegido)` (las ocho muestras como botones de radio, con «automático» cuando no hay color que respetar), `rotuloColumna`, `filtroSelect` y `accionNuevaTarea` (compartidos por la lista y el kanban) y `buscadorDeCreador(db)` (chip de quien creó la tarea, o el nombre del terminal en gris). `COLORES_USUARIO` se reexporta desde `src/db/colores.ts`: una sola lista.

**Pantallas**

- **Tareas** es una sección con dos vistas de lo mismo, la lista (`/tareas`) y el tablero (`/tareas/kanban`), y se presenta como tal: título «Tareas», frase de propósito («Todas las tareas del proyecto, por columna.»), y en la fila de filtros, a la izquierda del todo, un conmutador de dos enlaces «Lista | Tablero» (`nav.vistas`, el activo con `aria-current="page"`) que cambia de vista conservando los parámetros de filtro. La entrada de navegación es una sola, «Tareas». La palabra «kanban» no aparece en pantalla; la ruta no cambia.
- **Lista**: grupos por columna, cada uno con el rótulo de la columna: la etiqueta de estado con el nombre de la columna en plural («Preparadas»), el dueño en texto suave («la defines tú», «la trabaja el agente», «la revisas tú»; Cerradas no lleva dueño) y el contador. El nombre no se repite fuera de la etiqueta. Tabla sin borde exterior, cabecera en `--texto-suave` sin mayúsculas, filas con borde inferior y fondo `--fondo-hover` al pasar. Columnas: Id, Título (con «Espera por ti» y las marcas como etiquetas, y el progreso de hijas), Análisis, Ejecución, Tokens, Creada por (chip) y En columna. Los filtros son una fila encima, sin caja: el conmutador de vista, los tres conmutadores rápidos, la búsqueda y los desplegables compactos, con sus opciones ya en el vocabulario.
- **Tablero**: columnas sin fondo; la cabecera de cada columna es el mismo rótulo que en la lista. Tarjetas con borde `--borde`, fondo `--fondo`, sombra suave al pasar y al arrastrar; una tarea que espera por el humano lleva un filete de 3 px en `--turno` en el borde izquierdo. Cada tarjeta: id, etiquetas y edad en una línea, título, la barra de progreso cuando hay hijas, y una última línea en texto suave con las fases a la izquierda («análisis sonnet@portatil, ejecución opus@portatil») y los tokens a la derecha. Agrupado por funcionalidad, cada franja lleva su cabecera de ancho completo sobre `--fondo-lateral` y las columnas debajo; ver «Un tablero que se lee de un vistazo».
- **Ficha**: migas `PRI › Tareas › T-0042`, título, y las acciones hacia delante a la derecha (Pasar a preparadas, Aprobar ejecución, Finalizar). Debajo de la cabecera, **el ciclo** (`pasosDelCiclo`) a todo lo ancho. Debajo, las preguntas abiertas con su formulario. Después el bloque de **propiedades**: filas de dos columnas con el nombre en `--texto-suave` y el valor al lado: Estado (nombre legible y la edad), Proyecto, Tipo, Análisis, Ejecución, Autoejecución, Padre, Orden, Creada (chip de quien la creó, o el terminal si fue una propuesta, y la fecha), Revisión. Después Descripción, Hijas (cada una con su etiqueta de estado), Consumo (fases con nombre legible), Hilo con el cuadro de comentar al final, Actividad. La fila Estado añade «Iteración 2» cuando hay más de una. «Devolver a por definir», **Editar** y **Borrar** van al final como `<details>`, porque son excepcionales; pedir otra iteración no lo es y va en el cuadro de comentar. En ancho, propiedades, consumo y `<details>` forman el panel de la derecha; ver «La ficha como vista de incidencia».
- **Bandeja**: título «Bandeja», frase «Lo que espera por ti, de todos los proyectos.» y cuatro bloques con un verbo como título y el contador al lado: «Contesta» (preguntas sin contestar), «Aprueba» (análisis y descomposiciones por aprobar), «Revisa» (resultados en Hechas) y «Define» (más de siete días por definir). Debajo de cada verbo, una línea que dice qué es el bloque. En cada uno, líneas con chip de proyecto, id, título y edad, y debajo la tarjeta que toca (pregunta con formulario, análisis con botón de aprobar, resultado con botón de finalizar). Un bloque vacío dice «Nada pendiente.». Mismos componentes que la ficha: nada se pinta dos veces con dos plantillas.
- **Hilo**: cada comentario es una tarjeta con cabecera de chip del autor, etiqueta del tipo, `P<n>` cuando toca y la fecha; debajo el cuerpo renderizado; el formulario de respuesta dentro de la tarjeta de la pregunta abierta, con las opciones como tarjetas seleccionables y la recomendada marcada.
- **Nueva tarea** y **Editar**: una columna, etiquetas encima de los campos; Análisis y Ejecución como dos tarjetas lado a lado a partir de 48 rem.
- **Terminales**: tabla con chip del dueño, columna «Creado por» y, si está revocado, «Revocado por». El uso disponible se enseña por ventana como barra fina (`data-nivel` de 0 a 10, en rojo con 2 o menos) con el porcentaje disponible y la hora de reinicio; `resets_at` se acepta en segundos desde la época o en ISO 8601. «Revocar» va como enlace rojo discreto en la fila, no como botón: con diez columnas el botón no cabía. La columna «Agentes» lleva el número en un formulario mínimo a `POST /terminales/:id/agentes` (un `<input type="number" min="1">` y un botón «Guardar»), y el alta pide el mismo valor con 1 preseleccionado.
- **La pestaña de la ficha** lleva el título de la tarea; el id se lee en las migas.
- **Usuarios**: tabla con chip, fecha de alta, «Alta por» y acciones. El alta lleva un selector de color con las ocho muestras como botones de radio, con la automática preseleccionada. Cada fila lleva el mismo selector en un formulario a `POST /usuarios/:id/color`.
- **Actividad**: las últimas cien acciones, agrupadas por día; cada línea es chip, frase de la acción, enlace al objeto y hora.
- **Informes**: el selector de periodo como enlaces encima; cuatro tablas con la pregunta como `<h2>`, fases y modelos con nombre legible, cifras con `tabular-nums` alineadas a la derecha; el ritmo debajo con la barra de progreso por semana.
- **Cada pantalla lleva su frase de propósito** bajo el título: Funcionalidades «Lo que has pedido en lenguaje de negocio, y cuánto de cada cosa está hecho.»; Informes «Qué cuesta cada modelo, cuánto interrumpe y dónde se atasca el flujo.»; Actividad «Quién hizo qué, de más reciente a más antiguo.»; Proyectos «Un proyecto es un repositorio; sus terminales y sus tareas cuelgan de él.»; Terminales «Las máquinas donde corren los agentes, con su cuenta y su uso disponible.»; Usuarios «Quién puede entrar en esta web.»; Nueva tarea «Define qué quieres y quién lo analiza y lo ejecuta. Se podrá editar mientras esté por definir.».
- **Confirmaciones** (borrar usuario, revocar terminal), la página del token, 404 y 500 usan el mismo esqueleto con una tarjeta.

### Color de usuario

Cada usuario tiene un color, de los ocho que no son gris: `azul, verde, morado, naranja, rosa, amarillo, rojo, marron`, en ese orden.

- **Columna `usuarios.color`**, `TEXT NOT NULL` con `CHECK` sobre los ocho nombres. La migración da a los usuarios existentes un color por su id: el de la posición `(id - 1) % 8` de la lista.
- **Sin color elegido se asigna el menos usado**; en empate, el primero de la lista. Así lo hacen el CLI y el primer arranque. La lista y el reparto viven en `src/db/colores.ts`.
- **El alta desde la web permite elegirlo**, y `POST /usuarios/:id/color` lo cambia después: cualquier usuario puede cambiar el de cualquiera, como el resto de la gestión de usuarios. Cambiar el color no sube la revisión: ningún agente lo ve.
- **El color se lee al pintar, no se guarda con el comentario.** El hilo sigue guardando el autor como texto (`humano:ana`); la web busca el usuario por nombre al renderizar. Si el usuario se borró, el chip es gris.
- **El Markdown del MCP no cambia.** El color es de la web.

### Actividad: quién hizo qué

Toda acción humana desde la web deja rastro con el usuario que la hizo. El hilo ya lo hace con las respuestas y las notas; la actividad lo hace con todo lo demás y, además, da una línea de tiempo compacta.

```sql
CREATE TABLE actividad (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  usuario_nombre TEXT NOT NULL,
  accion TEXT NOT NULL,
  objeto TEXT NOT NULL CHECK (objeto IN ('tarea', 'usuario', 'terminal', 'proyecto')),
  objeto_id INTEGER NOT NULL,
  objeto_nombre TEXT NOT NULL,
  detalle TEXT NOT NULL,
  creado TEXT NOT NULL
) STRICT;
CREATE INDEX actividad_por_objeto ON actividad (objeto, objeto_id, id);
```

| `accion` | `objeto` | `detalle`, compuesto por el servidor |
|---|---|---|
| `crear_tarea` | tarea | vacío |
| `editar_tarea` | tarea | solo los campos que cambiaron, separados por `; `: `título: «A» → «B»`, `descripción`, `autoejecución: activada → desactivada`, `análisis: sonnet@portatil → opus`, `ejecución: …`, `tipo: tarea → pregunta`. Si no cambió nada, no se escribe fila |
| `mover_tarea` | tarea | `prepared → backlog` |
| `aprobar_ejecucion` | tarea | vacío |
| `responder_pregunta` | tarea | `P1: Punto y coma` |
| `comentario` | tarea | los primeros 80 caracteres del comentario; si pidió otra iteración, precedidos de `otra iteración: ` |
| `alta_usuario` | usuario | `color azul` |
| `baja_usuario` | usuario | vacío |
| `cambiar_password` | usuario | vacío |
| `cambiar_color` | usuario | `verde → azul` |
| `alta_terminal` | terminal | `cuenta ana@ejemplo.com, de ana` |
| `revocar_terminal` | terminal | vacío |
| `rotar_terminal` | terminal | vacío |
| `cambiar_agentes` | terminal | `1 → 3` |
| `baja_terminal` | terminal | vacío |
| `alta_proyecto` | proyecto | `clave WEB` |
| `editar_proyecto` | proyecto | solo los campos que cambiaron, como en `editar_tarea` |
| `baja_proyecto` | proyecto | vacío |

- **Se escribe en la misma transacción que la acción**, desde las funciones de `src/db/` con `registrarActividad` de `src/db/actividad.ts`. Nunca sube la revisión por sí sola: la acción ya lo hace si es contenido, y las que no lo son (contraseña, color) tampoco lo hacen por dejar rastro.
- **`usuario_nombre` se guarda como texto** para que sobreviva al borrado del usuario, igual que el autor del hilo; al borrar, `usuario_id` queda a nulo. `objeto_nombre` es el título de la tarea o el nombre del usuario o terminal en ese momento, para que la lista global se lea sin buscar.
- **El CLI y el primer arranque también dejan rastro**, con `usuario_id` nulo y `usuario_nombre` `cli` o `arranque`. Las funciones de bajo nivel (`crearUsuario`, `crearTerminal`) reciben un actor opcional `{ usuarioId }` o `{ nombre }`; sin actor no escriben actividad, que es lo que hacen los tests que montan la base a mano.
- **Reordenar no deja rastro**: el orden es prioridad, no configuración, y arrastrar produciría una fila por gesto.
- **Los agentes no escriben actividad.** Lo que hacen ya está en el hilo con su autor.
- **Lecturas**: `actividadDe(db, objeto, objetoId)` de la más antigua a la más nueva, `actividadReciente(db, limite)` de la más nueva a la más antigua, y `altaPor(db, objeto, objetoId)` con el nombre de quien dio de alta el objeto. Es lo que enseñan la ficha, las páginas de usuarios y terminales, y `GET /actividad`.
- **El rastro de un objeto empieza en su última alta.** Solo `tareas` lleva `AUTOINCREMENT`: los ids de usuario y de terminal se reciclan en cuanto se borra el más alto, así que un `objeto_id` puede haber sido de dos objetos distintos. `actividadDe` devuelve desde la última alta de ese id, y `altaPor` mira la última, no la primera. Lo de antes sigue en la tabla y sale en `GET /actividad`, que es la línea de tiempo de todo: ahí cada fila lleva su `objeto_nombre` y no hay confusión posible.

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
- **Agentes en paralelo** que asume. Ver el apartado siguiente.

### Agentes en paralelo

Cuántos subagentes lanza a la vez el bucle de ese terminal. Lo fija el humano por terminal, porque depende de la máquina y de la cuenta.

- **Columna `terminales.agentes`**, `INTEGER NOT NULL DEFAULT 1 CHECK (agentes >= 1)`. La migración la añade con `ALTER TABLE`; los terminales existentes quedan a 1.
- **Se elige en el alta y se cambia desde la fila** de la lista con `POST /terminales/:id/agentes`. Un valor que no sea un entero de 1 en adelante falla con `agentes_invalido`. Deja rastro como `cambiar_agentes` y **no sube la revisión**: es configuración del terminal, como rotar el token.
- **El terminal lo lee en `registrar_terminal`**, que devuelve una línea `agentes: 3` tras la cuenta. El bucle lo apunta al arrancar la sesión; cambiarlo desde la web vale a partir de la siguiente sesión de ese terminal. Basta: no merece una línea más en cada `novedades`.
- **En cada vuelta el bucle toma hasta ese número de candidatas**, en el orden en que `novedades` las devuelve, y lanza sus subagentes en un mismo bloque para que corran a la vez. Espera a que terminen todos y reporta el consumo de cada uno con su id y su fase. Con 1, es el comportamiento de siempre.
- **El servidor no lo impone** en `tomar_tarea`: una fase que se quedara en marcha por un subagente caído bloquearía al terminal entero contra un tope que solo el bucle conoce. El bucle es quien lo respeta.

Verificado contra la documentación de Claude Code:

- **El uso disponible solo está en la entrada de la statusline.** Claude Code pasa a la statusline un JSON con `rate_limits`, con tres ventanas (`five_hour`, `seven_day`, `spend_limit`), cada una con `used_percentage` y `resets_at`. Los hooks no reciben ese dato y no existe ninguna variable de entorno con él.
- **Solo existe para cuentas Pro o Max**, y solo a partir de la primera respuesta de la API. Una sesión con clave de API no tiene `rate_limits`; para ella el plugin reporta solo el coste estimado de sesión (`cost.total_cost_usd`).
- **Por eso el plugin incluye un script de statusline** que reenvía ese JSON al servidor por `POST /api/uso`, como mucho una vez por minuto, y después pinta la línea de estado. El usuario lo configura una vez como `statusLine` en sus settings; un plugin no puede imponerlo.
- **La cuenta de origen no se puede leer de forma documentada.** El correo está en las credenciales locales, cuyo formato es interno e inestable. El usuario la escribe, junto con el nombre del terminal, al crear el terminal en la web. El plugin no la conoce: el servidor la obtiene del token.
- **El uso disponible que muestra la web** es, por ventana, el porcentaje que queda y cuándo se reinicia.

### Direcciones del servidor y tutorial de conexión

Un terminal suele estar en otra máquina de la misma red, así que el servidor tiene que saber por qué direcciones se le puede llegar y enseñarlas.

- **Direcciones conocidas**: `BASE_URL`, las que lista la variable `DIRECCIONES` (URLs base separadas por comas, por ejemplo `http://192.168.1.10:3020`), y, si `DIRECCIONES` no está definida, las que el propio proceso detecta en sus interfaces de red: IPv4 de rangos privados (`10/8`, `172.16/12`, `192.168/16`) con el puerto de `PORT`. Dentro de Docker las interfaces detectadas son las del contenedor, no las del anfitrión: por eso existe `DIRECCIONES`, y el tutorial lo advierte.
- **Todas las direcciones conocidas se admiten en la cabecera `Host`**, además de `localhost`. La protección contra DNS rebinding sigue activa para cualquier otro host.
- **La página «Terminal creado»**, además del token, lleva el tutorial de conexión con el token ya puesto: las direcciones del servidor (la de `BASE_URL`, la que el navegador está usando ahora según su cabecera `Host` y las privadas conocidas), la instalación del plugin desde GitHub (`/plugin marketplace add xinux87/Mcp_tasks_server` y `/plugin install`), con la ruta de un clon local y `--plugin-dir` como alternativa de desarrollo, los dos valores que pide al activarse, la alternativa sin plugin con `claude mcp add` por HTTP y cabecera bearer, la configuración de la statusline, el arranque con `/loop /mcp-tareas:tareas`, y cómo comprobar que ha conectado: la fila del terminal pasa a «conectado». Cada bloque es copiable.
- **El mismo tutorial sin token** está siempre en `GET /terminales/conectar`, con `<token>` como marcador, enlazado desde la lista de terminales.
- **Los comandos del tutorial se verifican contra la documentación de Claude Code** cuando se escriben; no se inventan.

### Enlace de conexión y rotación del token

El token solo se puede leer en el momento en que nace: la base de datos guarda su hash. Eso obligaba a copiarlo a mano en la otra máquina y, si se perdía, a crear un terminal nuevo dejando el anterior revocado. Dos añadidos lo resuelven.

- **Enlace de conexión.** `GET /terminales/conectar` acepta `?token=<token>` y pinta el tutorial con ese token y las direcciones ya puestas. Es lo que la página «Terminal creado» ofrece junto al token, para abrirlo directamente en la máquina del terminal.
- **Con un token válido no exige sesión.** El servidor busca el terminal por el hash del token, igual que el bearer del MCP: si existe y no está revocado, sirve la página sin cookie; si no, redirige a `/login` como el resto de la web. Así el enlace se abre en la otra máquina sin dar de alta un usuario allí, y deja de valer en cuanto se revoca o se rota el token, sin nada que caducar aparte. Sin `?token=` la ruta sigue exigiendo sesión y enseña `<token>` como marcador.
- **El enlace es un secreto**: quien lo tiene, tiene el terminal. La web lo advierte donde lo ofrece. No se guarda en ninguna parte ni se puede volver a componer después: dura lo que dure el token.
- **Rotar el token.** `POST /terminales/:id/rotar` da un token nuevo al mismo terminal y deja el anterior sin valor. Conserva el terminal con su nombre, su historial y su consumo; es lo que evita que cada token perdido deje una fila revocada de más. Va en la fila de la lista como enlace discreto junto a «Revocar», con confirmación en página aparte, y acaba en la misma página que el alta: el token una sola vez, su enlace de conexión y el tutorial.
- **Rotar no revoca.** `revocado_en` sigue a nulo: el terminal sigue vivo, lo que cambia es `token_hash`. Un terminal revocado no se rota (`terminal_revocado`).
- **Deja rastro** en la actividad como `rotar_terminal` y no sube la revisión: es configuración del terminal, no contenido.
- **Actualizar el token en la máquina del terminal.** Claude Code no tiene ningún enlace que configure un servidor MCP: `claude-cli://open` abre sesiones, no configuración. Por eso el enlace lleva a la página y de ahí se copia el comando. Con el plugin, se cambia el valor desde `/plugin` → Installed → `mcp-tareas`, o con `claude plugin install mcp-tareas@mcp-tareas-marketplace --config token_terminal=<token>`; sin plugin, se repite `claude mcp add`. El tutorial lo dice en el paso que toca.

### Borrar un terminal

Revocar deja la fila para siempre: es lo correcto para un token comprometido, pero convierte la lista en un cementerio de terminales que ya no existen. Borrar lo quita de la lista del todo.

- **Se puede borrar en cualquier estado**, revocado o no. Borrar uno conectado lo desconecta en el acto, que es lo mismo que revocarlo y además limpia. La confirmación va en página aparte y dice qué se lleva por delante.
- **Sus tareas quedan sin terminal.** Las cuatro referencias de `tareas` (`analisis_terminal_id`, `ejecucion_terminal_id`, `en_marcha_terminal_id`, `creada_por_terminal_id`) pasan a nulo, como al borrar un usuario. Las que estén en `prepared` o `doing` recuperan la marca `sin terminal` y cualquier terminal puede tomarlas; una que estuviera «en marcha» se libera, porque el terminal que la había tomado ya no existe.
- **El consumo se conserva.** Son tokens gastados de verdad y están sumados en la ficha de la tarea: borrarlos falsearía el coste. `consumo.terminal_id` pasa a ser anulable y queda a nulo, que es lo único que impedía borrar la fila del terminal. Nadie lee esa columna: solo se escribe al reportar consumo.
- **El rastro se conserva**, con el nombre del terminal en texto, igual que el de un usuario borrado: `actividad` no tiene clave foránea hacia el objeto.
- **Deja rastro** como `baja_terminal` y **sube la revisión**, como el alta y la revocación: cambia quién puede tomar tareas, y eso los agentes lo ven.
- **Migración.** Reconstruye `consumo` para quitarle el `NOT NULL` de `terminal_id`, con el procedimiento de siempre: claves foráneas apagadas, tabla nueva, copia, `foreign_key_check` al terminar.

## Operaciones del MCP

Todas devuelven Markdown. Las listas devuelven un índice de una línea por elemento, nunca el contenido completo, para mantener bajo el consumo de contexto.

### Terminal

| Operación | Quién la llama | Entrada | Salida |
|---|---|---|---|
| `registrar_terminal` | el plugin al arrancar la sesión | `ruta` y `repositorio` opcionales; el terminal sale del token | nombre del terminal, cuenta, agentes en paralelo, proyecto, rama principal, verificación y revisión actual; marca el terminal como conectado y guarda la ruta. Falla con `proyecto_no_coincide` si el repositorio reportado no es el del proyecto |
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

Es la única llamada que hace el agente mientras espera. Si no hay novedades, devuelve solo la revisión actual. Las tareas en `backlog` nunca aparecen, ni las que llevan la marca `esperando`, ni una funcionalidad en `doing`: esa no tiene nada que un agente pueda hacer.

### Tareas

| Operación | Quién la llama | Entrada | Salida |
|---|---|---|---|
| `listar_tareas` | agente | filtro opcional por estado y terminal | índice: id, estado, título, marcas, asignaciones |
| `leer_tarea` | agente | id | el Markdown completo de la tarea, hilo incluido |
| `tomar_tarea` | agente | id, fase (`analisis` o `ejecucion`), `modelo` opcional | marca el terminal como responsable de esa fase y activa `en marcha`; en `ejecucion` la tarea pasa a `doing`. Si la fase no tenía modelo asignado, queda fijado el recibido; si tenía otro distinto, error `modelo_no_coincide`. Con dependencias sin satisfacer, error `esperando_dependencias`. Una funcionalidad solo admite la fase `analisis` (`funcionalidad_sin_ejecucion`) |
| `comentar_tarea` | agente o subagente | id, tipo, texto en Markdown, estado opcional | añade el comentario al hilo; cambia el estado si se indica |
| `crear_tarea` | agente o subagente | título, descripción, clase (`hija`, `propuesta` o `parte`), id de padre si es hija o parte, `tipo` opcional en una propuesta (`tarea` o `funcionalidad`), `dependeDe` opcional en una parte (ids de otras partes del mismo padre) | id de la nueva tarea. Una parte solo se crea desde el análisis de una funcionalidad en `prepared` por su terminal de análisis (`solo_desde_descomposicion`) |
| `borrar_tarea` | no existe como herramienta MCP | | Borrar es del humano: web y CLI |

### Preguntas

| Operación | Quién la llama | Entrada | Salida |
|---|---|---|---|
| `preguntar` | agente o subagente | id de tarea, pregunta, por qué importa, opciones con su consecuencia, recomendación | añade un comentario `pregunta` al hilo y marca la tarea `bloqueada` |

La respuesta del humano llega por `novedades` y queda como comentario `respuesta` en el hilo. No hay operación para leerla aparte.

## Reglas

### Tareas

- **El humano asigna modelo y terminal para cada fase.** Si una fase no tiene terminal asignado, cualquier terminal puede tomarla con `tomar_tarea`.
- **Modelos por defecto: `fable` analiza y `opus` ejecuta.** Es lo que el alta de la web trae puesto y lo que el bucle usa de reserva cuando una fase llega sin modelo o con uno que no reconoce. Decidido el 16 de septiembre de 2026.
- **Una tarea de tipo `pregunta` solo pide modelo de análisis.** El formulario esconde la ejecución y la autoejecución en cuanto se elige ese tipo (una regla CSS con `:has`, sin JavaScript; la funcionalidad esconde solo la autoejecución), y el servidor las ignora al guardar aunque lleguen.
- **`tomar_tarea` falla si esa fase ya tiene otro terminal** responsable. No hay robo silencioso de tareas.
- **El modelo con el que se trabaja una fase queda fijado al tomarla.** El bucle pasa en `tomar_tarea` el modelo que va a usar, sea el asignado o el de reserva; así el autor de los comentarios y el consumo cuentan lo mismo y la ficha nunca muestra una fase trabajada sin modelo.
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
| HTTP y web | **Hono** sobre `@hono/node-server` | Trabaja con `Request` y `Response` estándar, que es justo lo que expone el handler del SDK v2, sin adaptadores. Trae plantillas `html` con escape automático para renderizar en servidor, cookies firmadas, `bearerAuth` y `streamSSE`. Un solo framework para el MCP, la API y la web. |
| Validación | **Zod v4** | Es lo que el SDK usa para los esquemas de herramientas. Se reutiliza para la API y los formularios. |
| Persistencia | **SQLite con `node:sqlite`**, modo WAL | Integrado en Node 24, sin módulo nativo ni compilación en la imagen Docker. Un archivo en un volumen. Escrituras síncronas y en transacción, que es lo que pide la regla «escribir confirma». |
| Acceso a datos | **SQL a mano con sentencias preparadas**, sin ORM | El esquema cabe en una pantalla. Migraciones como archivos SQL numerados aplicados con `PRAGMA user_version`. El runner apaga las claves foráneas mientras migra y comprueba `PRAGMA foreign_key_check` al terminar: es el procedimiento de SQLite para reconstruir una tabla a la que apuntan otras, porque `PRAGMA foreign_keys` no hace nada dentro de una transacción. |
| Interfaz web | **HTML renderizado en servidor** con las plantillas `html` de Hono (`hono/html`), un único archivo de JavaScript propio para el kanban y el refresco en vivo, y **SortableJS** para arrastrar tarjetas | Sin bundler ni framework de cliente, y sin htmx: lo que hace el cliente cabe en un archivo pequeño y transparente. Sin JSX: Node ejecuta TypeScript por eliminación de tipos y no transforma JSX, y las plantillas `html` escapan sola cada interpolación. El servidor es dueño del estado; el navegador solo pide fragmentos. |
| Actualización en vivo | **SSE** en un endpoint que emite el número de revisión | Es la misma señal de novedad que usan los agentes. El endpoint consulta la revisión en la base de datos cada segundo y emite cuando cambia: sin bus de eventos en memoria, funciona igual con varios procesos. Cuando cambia, la lista y el kanban recargan su fragmento; la ficha, que tiene formularios, muestra un aviso para recargar. La telemetría de terminales no mueve la revisión, así que la vista de terminales conectados se refresca por intervalo, no por SSE. |
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
    web/                   # rutas, sesión, plantillas html y CSS
    auth/                  # tokens de terminal, contraseñas, cookies
  test/                    # node:test, un archivo por módulo
  Dockerfile
  compose.yaml
plugin/                    # el plugin de Claude Code, sin dependencias
  .claude-plugin/plugin.json
  .mcp.json
  hooks/hooks.json         # SessionStart: vuelca URL y token y copia la statusline
  skills/tareas/SKILL.md   # una vuelta del bucle del agente
  scripts/statusline.sh    # reenvía el uso al servidor y pinta la línea
  scripts/guardar-config.sh
  scripts/revision.sh      # lee y guarda la última revisión vista
  README.md                # instalación y arranque
.claude-plugin/marketplace.json   # el catálogo: es lo que permite instalar el plugin desde este repositorio
modelo-comunicacion.md     # el diseño original del hilo y de la señal de novedad; este archivo lo absorbe
LICENSE                    # MIT, la que declara el plugin
```

### Variables de entorno del servidor

| Variable | Para qué | Por defecto |
|---|---|---|
| `PORT` | Puerto de escucha. En `compose.yaml` es el puerto publicado en el anfitrión; dentro del contenedor el proceso escucha siempre en 3000, que es lo que comprueba el `HEALTHCHECK` | `3000`, `9917` en local |
| `DATA_DIR` | Carpeta de la base de datos | `/data` |
| `BASE_URL` | URL pública, para enlaces y validación de host | obligatoria |
| `SESSION_SECRET` | Firma de la cookie de sesión | obligatoria |
| `ADMIN_PASSWORD` | Contraseña del primer usuario, solo en el primer arranque | obligatoria si no hay usuarios |
| `DIRECCIONES` | URLs base adicionales por las que se llega al servidor, separadas por comas; se admiten en `Host` y salen en el tutorial | si falta, se detectan las IPs privadas del proceso |
| `DATOS` | Solo la lee `compose`, no el servidor: carpeta del anfitrión que se monta en `/data`, donde vive `tareas.sqlite`. Con una ruta, la base de datos queda en esa carpeta y se copia con el servidor parado; la escribe el uid 1000 | el volumen `datos` de Docker en `server/compose.yaml`; `./datos` en el `docker-compose.yml` de despliegue |
| `AVISOS_URL` | URL a la que se envía por POST un aviso de texto cuando un agente deja algo esperando al humano. Ver «Avisos fuera de la web» | sin avisos |

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
| `npm run cli -- crear-terminal <usuario> <nombre> <cuenta> [clave]` | Crea un terminal en ese proyecto (`PRI` si no se da) e imprime su token una sola vez |
| `npm run cli -- crear-proyecto <clave> <nombre>` | Crea un proyecto |
| `docker compose up --build` | Levanta el servidor con su volumen. Lee `server/.env`, que no está en el repositorio: sin `SESSION_SECRET` ni `ADMIN_PASSWORD` falla al interpolar, antes de construir nada |

`node --test` toma patrones glob, no directorios: `node --test test/` falla. Los tests viven fuera de `rootDir`, por eso tienen su propio `tsconfig.test.json`.

## El plugin de Claude Code

Define cómo conectarse al servidor MCP y arranca el bucle del agente. Su configuración son dos valores que se piden al activarlo: la URL del servidor y el token del terminal, creado antes en la web. Al iniciar registra el terminal y llama a `novedades` hasta que haya trabajo que hacer. El uso disponible lo envía aparte el script de statusline. Cuando llega una tarea, lanza la fase que toque como subagente con el modelo asignado, y al terminar reporta el consumo de tokens de ese subagente.

Verificado contra la documentación de Claude Code:

- **El servidor se declara en el archivo `.mcp.json` del plugin** con `type: "http"`, la `url` y un bloque `headers` con la cabecera `Authorization: Bearer ...`. Tanto la URL como las cabeceras admiten expansión `${VAR}` y `${VAR:-valor}`.
- **La URL y el token se piden al usuario al activar el plugin** declarándolos en `userConfig` dentro de `plugin.json`, con el token marcado como `sensitive`. Se guardan en los settings del usuario, nunca en el repositorio, y se referencian como `${user_config.<clave>}`.
- **El plugin puede incluir hooks, skills y agentes.** Eventos de hook disponibles: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `StopFailure`, `PreToolUse` y `PostToolUse`.
- **No puede incluir un comando de bucle propio.** La skill del plugin ejecuta una vuelta; la repetición la pone el bucle de Claude Code: `/loop /mcp-tareas:tareas` (o `/loop 2m /mcp-tareas:tareas` con intervalo fijo). Las skills de plugin van siempre con el prefijo del plugin. El bucle solo se dispara mientras Claude Code está abierto y en reposo, y caduca a los siete días de crearlo: hay que relanzarlo.
- **Los nombres de las herramientas llevan el plugin y el servidor.** En Claude Code una herramienta de un servidor MCP empaquetado en un plugin se llama `mcp__plugin_mcp-tareas_tareas__novedades`, no `mcp__tareas__novedades`.
- **Las claves de `userConfig` llegan a los hooks** como variables `CLAUDE_PLUGIN_OPTION_<CLAVE>`; la forma `${user_config.*}` en un comando de hook en modo shell falla. La statusline no recibe ninguna de las dos: por eso un hook `SessionStart` vuelca la URL y el token a `~/.claude/mcp-tareas/config` con permisos 600 y el script de statusline lee ese archivo.
- **El mismo hook copia el script de statusline a `~/.claude/mcp-tareas/statusline.sh`**, y esa es la ruta que va en `statusLine.command` de `~/.claude/settings.json`. La carpeta donde Claude Code instala el plugin lleva la versión dentro (`~/.claude/plugins/cache/<catálogo>/<plugin>/<versión>/`) y cambia con cada actualización; la copia es lo que da una ruta estable y se refresca en cada sesión. El hook localiza el script por su propia ruta (`dirname "$0"`), sin depender de ninguna variable.
- **La última revisión vista se guarda en `${CLAUDE_PLUGIN_DATA}/revision`**, que persiste entre sesiones y actualizaciones del plugin. Nunca en `${CLAUDE_PLUGIN_ROOT}`, que se sobrescribe al actualizar.
- **El plugin se instala desde el catálogo del repositorio**, `.claude-plugin/marketplace.json` en la raíz, que apunta a `./plugin`. La ruta relativa vale también cuando el catálogo se añade desde git: Claude Code lo clona entero y la resuelve contra el clon. El catálogo se registra con el `name` del `marketplace.json` (`mcp-tareas-marketplace`), no con el nombre del repositorio. Validación: `claude plugin validate ./plugin --strict` y `claude plugin validate . --strict`.
- **El repositorio es `xinux87/Mcp_tasks_server` en GitHub, público desde la versión 0.1.0.** En otra máquina: `claude plugin marketplace add xinux87/Mcp_tasks_server` y `claude plugin install mcp-tareas@mcp-tareas-marketplace` (o los mismos comandos con `/plugin` dentro de una sesión). La documentación dice que la forma `owner/repo` clona por SSH y que `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` fuerza HTTPS; comprobado con Claude Code 2.1.268: clona por HTTPS sin la variable, con el credential helper del sistema. Los textos no afirman ninguno de los dos como fijo: dicen que la variable existe por si hace falta. **Publicación**: cada versión lleva una etiqueta `v0.1.0` en git, que es lo que fija `xinux87/Mcp_tasks_server#v0.1.0` al instalar; la imagen Docker lleva la misma versión en `org.opencontainers.image.version` del `Dockerfile`, en `image:` de `compose.yaml` y en `package.json` y `plugin.json`. Los cuatro se suben a la vez. El handle `xinux87` es la cuenta que publica: es la única referencia a una persona que queda en el repositorio; los nombres de ejemplo son `ana`, `portatil-ana` y `ana@ejemplo.com`. Actualizar: `claude plugin update mcp-tareas@mcp-tareas-marketplace`. `claude --plugin-dir <clon>/plugin` queda como vía de desarrollo, sin instalar.
- **Los dos valores se piden al habilitar el plugin.** Para cambiarlos después (por ejemplo tras rotar el token): `/plugin` → Installed → `mcp-tareas`, o `claude plugin install mcp-tareas@mcp-tareas-marketplace --config token_terminal=<token>`. No hace falta desinstalar.
- **OAuth existe pero no se usa.** Si se declarase, tendría prioridad sobre la cabecera bearer.
- **Un token por carpeta, en la misma máquina.** Los valores de `userConfig` se guardan solo en `~/.claude/settings.json`: la documentación dice que los ámbitos de proyecto y local se ignoran para `pluginConfigs`, para que un repositorio clonado no inyecte valores en un plugin. Así que el plugin configura **un** terminal por máquina. Para una segunda carpeta con otro terminal, la vía documentada es declarar el servidor en esa carpeta con ámbito local, que se guarda en `~/.claude.json` para esa ruta, nunca en el repositorio, y gana a los servidores de los plugins en el orden de precedencia (local, project, user, plugin):

  ```
  claude mcp add --transport http --scope local tareas <url>/mcp --header "Authorization: Bearer <token>"
  ```

  El plugin sigue instalado y aporta la skill y el hook; el servidor del plugin y el local se llaman igual (`tareas`) y las herramientas del local llevan el prefijo `mcp__tareas__`, que la skill ya contempla. La statusline sigue reportando el uso al terminal del plugin: el uso es de la cuenta, no de la carpeta, y con enseñarlo en uno basta. `--scope project` queda descartado para esto: escribe el token en el `.mcp.json` del repositorio. Verificado el 14 de septiembre de 2026 contra `code.claude.com/docs/en/plugins-reference` y `code.claude.com/docs/en/mcp`.
- **El bucle reporta al servidor dónde trabaja.** En `registrar_terminal` manda `ruta` (su directorio de trabajo) y `repositorio` (la URL del remote `origin`, si la hay). Si el servidor responde `proyecto_no_coincide`, esa sesión está en la carpeta equivocada: el bucle lo dice y termina la vuelta sin tocar nada. Las líneas `proyecto`, `rama principal` y `verificacion` de la respuesta se apuntan como `agentes`, y las dos últimas van al prompt de la parte de integración.
