# CLAUDE.md

Guía para Claude Code en este repositorio. **Este archivo manda**; `README.md` es el resumen para quien llega y se actualiza cuando cambia una pieza o el ciclo de una tarea. Aquí van las reglas y su porqué; el detalle que ya se lee en `server/src/` (SQL de las tablas, colores en hex, CSS) vive en el código.

## Qué es

Trabajando con Claude Code no hay dónde ver una tarea y lo que queda de ella, las preguntas del agente citan archivos que el humano no puede contestar sin abrir el repositorio, y cada tarea nueva exige un comando en un terminal.

Este proyecto lo resuelve con dos entregables:

1. **El servidor MCP**, en Node, publicado como imagen Docker. Guarda las tareas con su hilo y sirve la web.
2. **La conexión del terminal**: dos comandos y la skill `/tareas`, que hace una vuelta del bucle. El plugin de Claude Code es opcional y solo reporta el uso de la cuenta.

Un agente corre en bucle con el repositorio en local, sin esperar comandos. Consulta el servidor, analiza o ejecuta las tareas de su terminal lanzando cada fase como subagente con el modelo asignado, reporta estado y consumo por el MCP y pregunta lo que necesita. El humano lo gestiona todo desde la web: define, asigna, contesta, revisa y cierra.

## Cómo se construye este proyecto

Dos modelos, dos papeles: el mismo reparto que implementa la herramienta.

| Papel | Modelo | Hace | No hace |
|---|---|---|---|
| **Definición** | Claude Fable 5.1 (`claude-fable-5-1`), la sesión principal | Mantiene este archivo, convierte cada bloque de trabajo en un encargo cerrado, revisa, ejecuta la verificación e integra. Resuelve las dudas técnicas y lleva al humano las de negocio. | Código de producción, salvo correcciones puntuales al revisar. |
| **Ejecución** | Claude Opus 5 (`claude-opus-5`), un subagente por encargo (Agent con `model: "opus"`) | Código y tests del encargo, ejecuta la batería y devuelve un informe: qué hizo, archivos tocados, verificación y dudas. | Cambiar definiciones de este archivo: si una no le cuadra, lo reporta. |

**Un encargo lleva**, en este orden: objetivo en una frase; secciones de este archivo que leer; archivos que crea o toca y cuáles no; criterios de aceptación verificables, uno por línea; comando de verificación.

**Reglas**:
- Encargos independientes en paralelo; los que tocan los mismos archivos, en serie.
- Nada se da por hecho por el informe: la sesión principal repite la verificación antes de integrar.
- Un encargo se cierra en verde. Si falla, vuelve al mismo subagente con el error; no se parchea desde la sesión principal.
- Las dudas de negocio van al humano como pregunta (qué se decide, por qué importa, opciones con consecuencia, recomendación). Las técnicas se resuelven aquí y se anotan en este archivo si cambian una definición.

## Tareas

### Campos

- **`id`**: `T-` y seis caracteres al azar de `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (sin `0 1 I L O`). No es correlativo: un número que sube cuenta y ordena lo que no debe. Es global, no por proyecto, para que un commit nunca quede ambiguo. Las tareas antiguas conservan su número (`T-0042`), así que se acepta `T-` más de cuatro a ocho caracteres de `[0-9A-Z]`. Por dentro la fila tiene `tareas.id` (`AUTOINCREMENT`, nunca se reutiliza, lo que enlazan las demás tablas); el código va en `tareas.codigo` y es lo único que ven la web, el Markdown y los agentes.
- `proyecto` (obligatorio), `titulo`, `descripcion`, `estado`, `orden` (posición en su columna: es la prioridad), `padre`, `clase` (`parte`, `hija` o nulo; ver «Tareas hijas»).
- `tipo`: `tarea` (por defecto en el modelo), `pregunta` o `funcionalidad`.
- `dependeDe[]`, `rama` (una funcionalidad la fija y sus partes la heredan).
- `analisis` y `ejecucion`: `agente`, `modelo` y `terminal` de cada fase.
- `autoejecucion` (activada por defecto) y `ejecucionAprobada` (la pone el humano cuando la autoejecución está desactivada).
- `estadoDesde`, `presupuesto` (tokens, opcional), `consumo` (por fase y modelo), `comentarios[]`.
- `en_marcha_terminal_id` y `en_marcha_desde`: qué terminal tiene la fase tomada y desde cuándo.

### Estados

Las columnas del kanban, en orden. Cada una tiene un dueño: quien decide que la tarea sale.

| Estado | Dueño | Qué pasa | Cómo sale |
|---|---|---|---|
| `backlog` | humano | Se termina de definir. El agente no la ve. | El humano la pasa a `prepared`. |
| `prepared` | agente de análisis | El terminal de análisis la toma y escribe el comentario `analisis`, con las preguntas que necesite. | Con `autoejecucion`, sola a `doing` cuando hay análisis y ninguna pregunta abierta. Sin ella, o si el análisis creó partes, espera a que el humano apruebe. |
| `doing` | agente de ejecución | Se ejecuta con el modelo de ejecución. Puede preguntar; lo que una pregunta gobierna no se construye mientras esté abierta. | Comentario `resultado` con lo construido y el commit: pasa a `done`. |
| `done` | humano | Revisa el resultado. | A `finished` si lo acepta; a `doing` con un comentario si pide otra iteración. |
| `finished` | nadie | Aceptada, de solo lectura. | No sale. |

La fase que toca es «análisis» mientras la tarea está en `prepared` sin comentario `analisis`, y «ejecución» desde que lo tiene.

**Reglas del ciclo**:
- Modelos por defecto: `fable` analiza y `opus` ejecuta. Es lo que trae el alta de la web y la reserva del bucle cuando una fase llega sin modelo o con uno desconocido.
- Si una fase no tiene terminal, la toma cualquier terminal del proyecto. `tomar_tarea` falla si la fase ya la tiene otro: no hay robo silencioso.
- El modelo queda fijado al tomar la fase: el bucle lo pasa a `tomar_tarea`, y con uno distinto del asignado falla con `modelo_no_coincide`. Así autor y consumo cuentan lo mismo.
- Pasar a `doing` exige análisis y cero preguntas abiertas. A `done`, un `resultado`. `finished` solo lo pone el humano.
- **El agente solo mueve hacia delante.** Las vueltas atrás son del humano y siempre llevan comentario: de `prepared` a `backlog` (el análisis queda en el hilo, pero se repite al volver a salir) y de `done` a `doing` (otra iteración, desde el cuadro de comentar).
- **Edición**: en `backlog` se edita todo (`solo_en_backlog` fuera). Al salir, descripción y asignaciones se congelan y los cambios van como comentario. El orden se cambia siempre.

### Marcas

No se guardan: se derivan al leer (`marcasDe`) y salen como etiqueta en tarjeta, fila, ficha, bandeja y frontmatter.

- **`bloqueada`**: alguna pregunta sin respuesta.
- **`sin terminal`**: en `prepared` o `doing`, la fase que toca no tiene terminal.
- **`en marcha`**: un terminal tomó la fase y no ha escrito el comentario que la cierra. La web le pone edad (`en marcha 12 min`); el frontmatter no.
- **`parada`**: lleva en marcha más de `FASE_PARADA_HORAS` (seis). Probablemente el subagente murió. Avisa; no libera ni frena nada.
- **`análisis listo`**: en `prepared`, con análisis, sin preguntas abiertas, sin aprobar, y con `autoejecucion` desactivada o la tarea descompuesta.
- **`esperando`**: en `prepared` con alguna dependencia que no está `done` ni `finished`. No se puede tomar ni sale en `novedades`.
- **`sobre presupuesto`**: el consumo con hijas supera `presupuesto`. Avisa; no frena.

### Hilo de comentarios

Un hilo por tarea, abierto hasta `finished`. Los comentarios se añaden; nunca se editan ni se borran.

| Tipo | Lo escribe | Contenido |
|---|---|---|
| `analisis` | modelo de análisis | qué hay que hacer, plan, riesgos |
| `pregunta` | agente o subagente | pregunta con opciones, consecuencias y recomendación |
| `respuesta` | humano | opción elegida (por su texto) y nota libre |
| `resultado` | modelo de ejecución | qué se construyó y el commit |
| `comentario` | cualquiera | mensaje libre |

El autor lo compone el servidor: `modelo@terminal` para un agente (el modelo de la fase que toca y el terminal del token) y `humano:<usuario>` para una persona. `servidor` en los mensajes automáticos.

**El hilo es un chat** y cada vuelta es una iteración:
- Un `comentario` del humano en una tarea `doing` es trabajo para su terminal de ejecución: si es posterior al último mensaje del agente, el bucle retoma la ejecución con él, como tras una `respuesta`. Se deriva del hilo, sin campo.
- El agente puede contestar sin trabajar, con un `comentario`; la tarea sigue en `doing`. Solo el terminal con la fase en marcha escribe comentarios de agente; el humano puede comentar en cualquier estado salvo `finished`.
- **En `done`, comentar es pedir otra iteración**: escribe el comentario y devuelve la tarea a `doing` en la misma transacción. No hay comentario «solo de constancia»: si el resultado vale, se finaliza.
- Un comentario vacío no se guarda (`comentario_vacio`).
- Las iteraciones se cuentan con las transiciones `done → doing`: la ficha dice «Iteración 3» y el hilo pinta un separador en cada vuelta.
- Límite aceptado: un comentario escrito mientras el subagente trabaja no lo ve ese subagente; se recoge en la siguiente iteración.

### Tareas hijas

Un agente crea tareas por tres motivos (`crear_tarea` con `clase`):

- **`hija`** (hija de trabajo): un subagente deja visible su parte de la ejecución. Nace en `doing` colgando de la madre con sus asignaciones, termina con su `resultado` y se acepta al aceptar la madre. No cuelga de una tarea descompuesta.
- **`propuesta`**: algo descubierto que no es de la tarea actual. Nace en `backlog`, sin padre, de tipo `tarea` o `funcionalidad`. En la base su `clase` es nula.
- **`parte`**: un trozo del plan, creado por el análisis de la madre o por el humano. Ver «Tareas descompuestas».

Una hija o parte hereda el proyecto de su madre; una propuesta, el del terminal.

### Dependencias

- Satisfecha cuando la tarea de la que se depende está `done` o `finished` (basta `done`: esperar a la revisión del humano lo haría cuello de botella).
- Sin satisfacer: marca `esperando`, `tomar_tarea` falla con `esperando_dependencias` en las dos fases.
- Se fijan en `backlog` y se congelan. Sin autodependencia ni ciclos (`dependencia_ciclica`), sin cruzar proyectos (`dependencia_otro_proyecto`).
- La ficha enseña «Depende de» y «Bloquea a» (`dependientesDe`). El MCP solo expone `dependeDe`.

### Tareas descompuestas

Cualquier tarea puede descomponerse en partes con dependencias, que se construyen y validan por separado. **Una tarea está descompuesta** si es de tipo `funcionalidad` o tiene alguna hija de clase `parte`; ese predicado gobierna todas las reglas siguientes.

- **Las partes las crea el análisis** de la madre en `prepared` (`crear_tarea` clase `parte`, solo su terminal de análisis: si no, `solo_desde_descomposicion`), antes del comentario `analisis`, que con autoejecución movería la madre. Nacen en `backlog` y heredan rama, modelos, terminales y agentes. Pueden depender de hermanas. El humano también añade partes desde la ficha (`POST /tareas/:id/subtareas`, solo título; en `backlog`, `prepared` o en `doing` sin fase en marcha, si no `en_ejecucion`; en `done` o `finished`, `padre_invalido`) o con el campo «Subtarea de» del formulario (`exigirPadre`: cualquier tarea abierta del proyecto que no sea pregunta, ni ella misma ni una de sus descendientes; si no, `padre_invalido`).
- **La descomposición la aprueba siempre el humano**, porque multiplica el coste: con partes, el análisis deja la madre en `prepared` con `análisis listo` aunque haya autoejecución. `aprobarDescomposicion` pasa la madre a `doing` y sus partes de `backlog` a `prepared`. Con preguntas abiertas falla con `tarea_bloqueada`.
- **Sin ejecución propia**: `tomar_tarea` en ejecución, un `resultado` de agente o colgar una hija de trabajo fallan con `sin_ejecucion_propia`, y `novedades` no la ofrece en `doing`.
- **Se cierra sola** cuando su última parte pasa a `finished`, en la misma transacción (`cerrarPadreSiProcede`): pasa a `done` con un `resultado` de autor `servidor` que lista cada parte con su commit. Las hijas de trabajo no cuentan. Borrar la última parte pendiente también la cierra.
- **Rama**: si la madre tiene `rama` y no tiene padre, al aprobar se crea la parte «Integrar la rama `<rama>` en la principal», que depende de todas: fusiona sin fast-forward, pasa la verificación del proyecto y cita el commit de fusión. Los agentes de las partes crean la rama desde la principal si no existe.
- **Sin límite de profundidad**: una parte puede descomponerse en su propio análisis.
- **Una funcionalidad** es lo que pide el humano en lenguaje de negocio, sin decir cómo. Además de lo anterior: el análisis exige al menos una parte (`sin_partes`; si no es viable, pregunta); sus modelos y terminales son los valores por defecto de sus partes; tiene página propia, carriles en el tablero y la etiqueta «Funcionalidad 3/7». `partesCerradas` cuenta las partes `finished`.
- **En la web** el bloque se titula «Tareas 2/5» en una funcionalidad y «Subtareas 2/5» en una tarea. La ficha de una tarea descompuesta es el tablero de sus partes (sin chip de proyecto, que ya está en el panel; si no caben las cinco columnas, se desplaza en horizontal), con «Aprobar descomposición» mientras está `análisis listo`, y con dos partes o más el bloque «Orden de ejecución»: olas calculadas de las dependencias (lo de la misma ola puede ir a la vez), una función pura en `src/web/`.
- **La skill** descompone una tarea grande antes de escribir el análisis. Cada parte lleva en su descripción «Qué entrega», «Cómo se comprueba» y «Depende de»; el `analisis` de la madre es el plan de conjunto. Una respuesta del humano que fija arquitectura se anota en el repositorio (ADR, CHANGELOG, o el mensaje del commit) en la primera parte que la toque; para saberlo, una parte con padre lee también el hilo de la madre.

### Tareas que son preguntas

`tipo: pregunta`: la salida es una respuesta escrita, no código.
- Solo tiene análisis: el comentario `analisis` es la respuesta y la pasa directamente a `done`. Ejecución, autoejecución y aprobación no aplican (el formulario las esconde con CSS y el servidor las ignora).
- Puede preguntar a su vez con `preguntar`.
- Se responde en llano, sin rutas ni códigos internos; lo descubierto de paso va como propuesta.
- **Es el tipo por defecto en el formulario de alta**: lo más frecuente es preguntar algo al agente.

### Preguntas del agente

- Se entienden sin abrir el repositorio: sin rutas, códigos internos ni referencias a otros documentos. Criterio: ¿la contestaría alguien que conoce el negocio y no ha visto el código?
- Opciones cerradas con su consecuencia, incluida la de no hacer nada, y una recomendación.
- La respuesta se guarda por el texto de la opción, nunca por su índice: un índice se rompe en silencio al reordenar.
- Solo se pregunta en directo lo destructivo o irreversible; lo demás va al servidor.

### Consumo de tokens

- Lo reporta el bucle, no el modelo: al terminar cada subagente de fase, Claude Code le da tokens totales, llamadas a herramientas y duración, y el bucle los copia sin tocar en `reportar_consumo`. Una fase retomada suma.
- Se guarda por fase y modelo; las hijas suman a sus ancestros. La ficha enseña el propio y el total con hijas.
- Lo que gasta el bucle esperando es del terminal, no de ninguna tarea.
- Reportar consumo sube la revisión global pero no la de la tarea, para que el agente no reciba su propia tarea como novedad.
- Sin desglose entrada/salida/caché: solo está en la transcripción, con formato interno.

### Borrar una tarea

Del humano, desde la web o el CLI, en cualquier estado y con confirmación (no hay herramienta MCP). Se lleva su hilo, su consumo, sus transiciones y sus dependencias en los dos sentidos; quedan el rastro de actividad y el número interno, que no se reparte de nuevo. Una tarea con hijas no se borra (`con_hijas`). Una tarea en marcha sí: el humano manda, y el agente se entera al escribir (`tarea_inexistente`). La confirmación dice cuántos comentarios se pierden, qué terminal la trabaja y qué tareas dejan de esperarla.

## Proyectos

Un proyecto es un repositorio que se trabaja desde una o varias carpetas, cada una con su terminal. Sin él, una tarea `sin terminal` la tomaba el primer terminal que la viera, fuera o no de su repositorio.

- **Campos** (`proyectos`): `clave` (dos a ocho mayúsculas y cifras, empieza por letra, fija; `clave_invalida`, `clave_repetida`), `nombre`, `descripcion`, `repositorio` (URL del remote, opcional; se compara sin espacios, sin `.git` ni barra final), `rama_principal` (`main`), `verificacion` (comando de la parte de integración, opcional), `color` (de los ocho de usuario; sin elegir, el menos usado). El proyecto 1 es `DEFAULT` «Default» y recoge todo lo anterior.
- **Un terminal pertenece a un solo proyecto**, elegido en el alta y fijo: una máquina con tres repositorios tiene tres terminales.
- `registrar_terminal` recibe `ruta` y `repositorio` opcionales. Si el proyecto y el terminal tienen repositorio y no coinciden, falla con `proyecto_no_coincide` y el bucle para esa vuelta. Devuelve `proyecto`, `rama principal` y `verificacion`.
- **`novedades`, `listar_tareas` y `tomar_tarea` se acotan al proyecto del terminal** (`otro_proyecto`); `leer_tarea` y `leer_agente` no. Los agentes no saben que hay proyectos: sale del token.
- Una tarea nace en el proyecto que se está viendo y no cambia desde la web. La base lo permite solo en `backlog` y sin padre, hijas ni dependencias (`no_cambia_de_proyecto`), y pone sus terminales a nulo.
- `orden` es global por columna; el tablero de un proyecto reordena «entre las del proyecto» con `reordenar(..., entre: { proyectoId })`.
- Se borra solo vacío (`proyecto_con_tareas`, `proyecto_con_terminales`); el 1 nunca (`proyecto_principal`).
- Crear, editar y borrar dejan rastro y no suben la revisión.
- **En la web**: las vistas acotadas van bajo `/p/:clave/…` (clave inexistente: 404); las rutas sin prefijo son la vista cruzada de todos los proyectos, con chip de proyecto en cada línea. Cada página acotada escribe la cookie `proyecto` (preferencia, sin firmar); la navegación apunta al recordado, o a `DEFAULT` sin cookie, o a la vista cruzada si se eligió «Todos los proyectos» (`todos`). La ficha sigue en `/tareas/T-…` porque el id es global.
- **La página del proyecto**, `/p/:clave`, con tres pestañas: **Resumen** (propiedades, «Ahora mismo» con sus terminales, «Funcionalidades en curso» y «Espera por ti» con los recuentos de la bandeja acotada), **Informes** (`/p/:clave/informes`) y **Actividad** (`/p/:clave/actividad`, `actividadDeProyecto`). Las vistas cruzadas `/informes` y `/actividad` se enlazan desde la lista de proyectos.

## Agentes

Un agente es un papel escrito en Markdown (quién es, cómo trabaja, qué mira) con un modelo y, opcionalmente, un terminal. Se asigna a la fase de una tarea, y el bucle pone su texto en el prompt del subagente.

- **Campos** (`agentes`): `nombre` (minúsculas y guiones, dos a treinta, empieza por letra; `nombre_invalido`, `nombre_repetido`), `descripcion`, `instrucciones`, `modelo` (`fable`, `opus`, `sonnet`, `haiku`), `terminal_id` opcional. Las tareas lo enlazan en `analisis_agente_id` y `ejecucion_agente_id`.
- **Asignar un agente copia su modelo y su terminal a la fase**, y la fase sigue mandando en `tomar_tarea`, el autor y el consumo. Editar el agente después no cambia lo copiado; las instrucciones sí, porque se leen al lanzar. Con agente, el formulario bloquea modelo y terminal, y el servidor los copia aunque lleguen otros.
- **El bucle carga el papel** con `leer_agente` y lo pone al principio del prompt bajo «Quién eres». Si el agente ya no existe, lanza sin papel y lo dice.
- **Se borra siempre**, con confirmación de a cuántas fases está asignado; esas fases conservan modelo y terminal. Crear, editar y borrar dejan rastro y no suben la revisión.
- **Skills del subagente**: un subagente arranca sin skills cargadas pero conserva la herramienta `Skill`, y hereda `CLAUDE.md` y las herramientas MCP. El bucle copia al prompt la lista de skills de su sesión («Skills disponibles», `nombre: descripción`, sin `tareas`) y le dice que invoque las que apliquen. Un papel puede exigir skills en su texto. No se precarga nada ni el servidor guarda skills.
- **En la web**: `/agentes` (lista con fases asignadas), alta y edición en página aparte, y la ficha `/agentes/:id` con el papel renderizado y «Tareas trabajadas» (las veinte últimas que lo tienen asignado, con fase, estado, tokens de la fase y devoluciones). Es sobre la asignación actual: borrar el agente borra su historial.

## Formato Markdown

El servidor es el único que escribe el formato: los agentes envían contenido y el servidor lo coloca. Así nadie rompe la estructura.

### Documento de una tarea (`leer_tarea`)

Frontmatter YAML y tres bloques fijos: `## Descripción`, `## Hijas` y `## Hilo`.

```markdown
---
id: T-K7M3XQ
proyecto: DEFAULT
titulo: "Exportar el listado de clientes a CSV"
tipo: tarea
estado: done
orden: 3
padre: T-0040
autoejecucion: true
presupuesto: 200000
marcas: []
analisis:
  agente: revisor
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
  totalConHijas:
    tokens: 262900
revision: 187
---

## Descripción

Los comerciales necesitan bajarse el listado filtrado.

## Hijas

- T-0043 · doing · Generar el fichero CSV · depende de: T-0044

## Hilo

### pregunta · opus@portatil-ana · 2026-09-04T09:10:00Z · P1

**¿Qué separador usamos en el CSV?**

Por qué importa: la hoja de cálculo está en español y abre mal la coma.

Opciones:
- **Coma**: es el estándar, pero hay que importar a mano.
- **Punto y coma**: se abre directamente; otros programas pueden fallar.
- **No hacer nada**: siguen copiando a mano.

Recomendación: Punto y coma.

### respuesta · humano:ana · 2026-09-04T12:00:00Z · P1

Opción: **Punto y coma**

Nota: si lo usa otro equipo, ya lo cambiaremos.

### resultado · opus@portatil-ana · 2026-09-04T13:05:00Z

Qué se construyó: botón «Exportar CSV» que respeta los filtros.

Commit: a1b2c3d
```

- Cabecera de comentario `### tipo · autor · fecha`, con `P<n>` al final solo en preguntas y respuestas.
- Fechas en ISO 8601 UTC. `titulo` entre comillas dobles escapado como JSON; el resto sin comillas.
- Campos opcionales solo cuando existen: `padre`, `presupuesto`, `rama`, `dependeDe: [T-0041]`, `agente:` de cada fase, `consumo`, y `partes`/`partesCerradas` en una tarea descompuesta. Un modelo o terminal que falta es `~`. Una fase retomada con otro modelo une los modelos con `+`.
- `marcas` como lista en línea, `[]` sin ninguna. Sin hijas, `Ninguna.`; sin comentarios, `Ninguno.`
- La descripción va tal como la escribió el humano. `revision` es la global en el momento de leer.

### Línea de índice (`listar_tareas`, `novedades`)

```markdown
- T-0042 · doing · bloqueada · Exportar el listado de clientes a CSV · analisis: sonnet@portatil-ana (revisor) · ejecucion: opus@portatil-ana
```

- Tras el estado y antes de las marcas: `pregunta`, `funcionalidad 3/7` o `subtareas 2/7`. Ninguna de las tres lleva segmento `ejecucion:`.
- Agente entre paréntesis tras la fase. Fase vacía: `analisis: sin asignar`; con un solo dato: `analisis: sonnet` o `analisis: @portatil-ana`.
- Una parte acaba en `padre: T-0050`. Sin proyecto: el agente solo ve el suyo.

### `novedades`

```markdown
revision: 190

## Tareas nuevas o cambiadas

- T-0045 · prepared · sin terminal · Migrar el envío de correos · analisis: sin asignar · ejecucion: sin asignar

## Preguntas contestadas

- T-0042 · P1 · Punto y coma
```

Sin novedades, solo la línea `revision`.

### Otras salidas

- `preguntar` recibe `pregunta`, `porQueImporta`, `opciones[]` (`texto`, `consecuencia`; incluye no hacer nada) y `recomendacion` (el `texto` de una opción).
- `leer_agente` devuelve frontmatter (`nombre`, `modelo`, `terminal` o `~`, `actualizado`) y las instrucciones como cuerpo; `agente_inexistente` si no existe.

## Operaciones del MCP

Todas devuelven Markdown; las listas, un índice de una línea por elemento.

| Operación | Entrada | Efecto |
|---|---|---|
| `registrar_terminal` | `ruta`, `repositorio` opcionales | marca el terminal conectado y guarda la ruta; devuelve nombre, cuenta, `agentes`, proyecto, rama principal, verificación y revisión |
| `novedades` | `revision` opcional (sin ella, la que el servidor guardó para el terminal, o 0) | tareas de `prepared` y `doing` de este terminal o sin terminal, cambiadas desde esa revisión, y preguntas contestadas. Nunca `backlog`, `esperando` ni descompuestas en `doing`. Guarda la revisión como última vista |
| `listar_tareas` | filtro por estado y terminal | índice |
| `leer_tarea` | id | documento completo |
| `tomar_tarea` | id, fase, `modelo` opcional | toma la fase (`en marcha`); en ejecución pasa a `doing`. Errores: `modelo_no_coincide`, `esperando_dependencias`, `sin_ejecucion_propia`, `otro_proyecto` |
| `comentar_tarea` | id, tipo, texto, estado opcional | añade al hilo; cambia el estado si se indica |
| `crear_tarea` | título, descripción, clase, padre, `tipo` (propuesta), `dependeDe` (parte) | id nuevo |
| `preguntar` | id y campos de la pregunta | comentario `pregunta`; la tarea queda `bloqueada` |
| `reportar_consumo` | id, fase, modelo, tokens, herramientas, duración | suma a la tarea y a sus ancestros |
| `leer_agente` | nombre | el papel |

Fuera del MCP, `POST /api/uso` (bearer del terminal) recibe tal cual el JSON de la statusline y lo guarda como `uso_json`. Es telemetría: no sube la revisión.

## Señal de novedad

- **Un contador de revisión global** sube con cada escritura de contenido (tareas, comentarios, preguntas, respuestas, consumo, altas, bajas y revocaciones de usuarios y terminales). Toda escritura así pasa por `enTransaccionConRevision`.
- **La telemetría no la sube**: `conectado_en`, `ultima_revision` y `uso_json` se escriben aparte. Si no, cada vuelta de cada bucle sería novedad para todos.
- `novedades` no sube la revisión; dos llamadas seguidas sin escrituras devuelven la misma.
- Nunca un booleano que se consume al leer: una respuesta entre la lectura y el borrado se perdería.

## La web

La web es el puesto de mando de quien dirige agentes: qué espera por él y en qué punto del ciclo está cada tarea. Las acciones llaman a `src/db/` (la web no reimplementa reglas). Un `ErrorDeRegla` en un POST repinta la página de origen con el mensaje y 422; lo que sale bien redirige (POST, redirección, GET). Las rutas están en `src/web/rutas/`; Hono resuelve por orden de registro (`/tareas/kanban` antes que `/tareas/:id`).

### Principios

1. **El color dice de quién es el turno.** Solo `--turno` (ámbar) marca lo que espera por el humano: contador de la bandeja, etiqueta de turno y paso actual del ciclo cuando es suyo. El acento de acciones y enlaces es otro (`--acento`, verde).
2. **Cada pantalla dice para qué sirve** en una frase bajo el título, desde el punto de vista del humano. Sin mayúsculas en rótulos, sin puntos medios como separador, sin nombres internos.
3. **El ciclo se ve.** La ficha enseña los cinco pasos con quién tiene el turno; la bandeja se ordena por lo que el humano tiene que hacer.

### Vocabulario

El nombre visible es **TABO Tasks** (el paquete, la imagen y el plugin conservan sus nombres técnicos). La web habla en castellano llano y **ningún nombre interno llega a la pantalla**; todo pasa por `src/web/vocabulario.ts`. Valores de formulario, URLs, clases CSS y el Markdown del MCP siguen con los internos.

| Interno | En la web |
|---|---|
| `backlog` / `prepared` / `doing` / `done` / `finished` | Por definir / Preparada / En curso / Hecha / Cerrada (columnas en plural) |
| `bloqueada` / `sin terminal` / `en marcha` / `análisis listo` / `esperando` / `sobre presupuesto` / `parada` | Pregunta abierta / Sin terminal / Agente trabajando / Por aprobar / Espera a otra tarea / Sobre presupuesto / Fase parada |
| tipos `pregunta` / `funcionalidad` | Pregunta / Funcionalidad 3/7 |
| comentarios y fases | Análisis, Pregunta, Respuesta, Resultado, Comentario; Análisis, Ejecución |
| dueño de columna | tú / el agente / nadie |
| `prepared → backlog` | Devolver a por definir |

**La etiqueta de turno** se pinta en `--turno` cuando le toca al humano, con el verbo de la bandeja: «Contesta» (`bloqueada`), «Aprueba» (`análisis listo`), «Revisa» (`done`). `backlog` no la lleva.

### Aspecto

- Estilo en `src/web/estilos.ts`, componentes en `componentes.ts`, esqueleto en `plantilla.ts`, icono en `icono.ts`. **Ningún estilo en línea en las plantillas.** La referencia visual es **Beautiful UI** (beautifului.dev, MIT, componentes para interfaces de agentes): se adopta su sistema (tokens en tres escalas, densidad, radios, sombras, movimiento y patrones de componente) y se conserva la identidad TABO (negros, naranja de turno, verde de acento, icono). No se copia su CSS ni su marcado: se transcribe a tokens y clases propios. Lo que la referencia no cubre se decide aquí. Decidido el 12 de noviembre de 2026; sustituye al lienzo «Puesto de mando» de Claude Design.
- **Tokens en tres escalas**, definidos en `:root` y en los dos bloques oscuros: superficies (página, lateral, tarjeta, hueco para campos y código, y dos niveles de hover), tinta (principal, suave, terciaria) y líneas (normal, fuerte, suave); cada color de señal con su tinte (`--acento`/`--acento-tinte`, `--turno`/`--turno-fondo`, `--peligro`/`--peligro-tinte`). Radios: chip 6 px, control 8 px, tarjeta 10 px, ventana 14 px, píldora 999. **Sombras en vez de bordes**: `--sombra-filete` (anillo de 1 px del color de línea) en cajas y campos, `--sombra-tarjeta` (anillo más sombra suave en capas) en tarjetas, `--sombra-boton` y `--sombra-flotante` (menús y panel móvil). Los bordes de 1 px quedan para separar filas y secciones.
- **Tipografía**: pila del sistema con Inter delante si está instalada (no se sirve ninguna fuente), 14 px de base, `letter-spacing: -0.01em`, escala 13 (secundario), 12,5 (meta), 12 (pie) y 11,5 (píldoras); rótulos en 500 o 600, nunca en mayúsculas; cifras con `tabular-nums`, ids y contadores en monoespaciada. Densidad: filas de navegación de 32 px, filas de tarea de 44 px, controles de 32 px, píldoras de 22 px.
- **Movimiento**: `--suave: cubic-bezier(.23, 1, .32, 1)`, de 100 a 200 ms, en hover, foco y al plegar y desplegar (`grid-template-rows` de `0fr` a `1fr`); nada se anima con JavaScript; `prefers-reduced-motion` lo apaga.
- **Patrones**: la **fila de tarea** (punto de estado, id, título, píldora, cifra a la derecha y chevron si despliega, con `<details>`) en bandeja, lista, subtareas y «Ahora mismo»; la **tarjeta de aprobación** (pregunta, por qué importa, opciones como filas con radio y la recomendada marcada, nota y acciones) para las preguntas abiertas; el **hilo como traza** (cabecera de cada comentario en una línea con chip de autor, tipo teñido y fecha; separador de iteración); los **chips de consumo** (modelo · tokens · herramientas · duración); el **punto que late** en «Agente trabajando»; el **selector de proyecto como control de espacio de trabajo** (icono, nombre y chevron) en la barra; las píldoras de estado y de marca **teñidas** (tinte de fondo y texto del color), salvo la de turno, que sigue maciza: es la única señal.
- Paleta de negros, naranja vivo y verde chillón; el oscuro es el tema principal. Todo color sale de los tokens de `:root` o de los nueve colores de etiqueta (`.color-<nombre>`). Enlaces y texto de acento usan `--acento-texto`; `--acento` es solo relleno.
- Tema Claro, Oscuro o Sistema, guardado en `localStorage` (`tema`) y aplicado antes de pintar por un `<script>` mínimo en el `<head>`: el único JavaScript en línea.
- Colores semánticos: estados `backlog` gris, `prepared` azul, `doing` amarillo, `done` verde, `finished` marrón. Marcas `bloqueada` rojo, `en marcha` morado, `análisis listo` rosa, y naranja el resto. Comentarios `analisis` azul, `pregunta` rojo, `respuesta` verde, `resultado` morado, `comentario` gris. Tipo `pregunta` rosa, `funcionalidad` azul.
- **Usuarios**: cada uno tiene uno de los ocho colores que no son gris (`src/db/colores.ts`; sin elegir, el menos usado) y se enseña siempre como chip con su inicial (`chipUsuario`). El color se lee al pintar, no se guarda en el hilo; un usuario borrado o un agente sale en gris. Cambiarlo no sube la revisión.
- Barra lateral con marca, selector de proyecto, búsqueda (`?q=` sobre la lista del proyecto recordado), «Bandeja» con su contador, «Tareas», «Funcionalidades», «Proyecto» y el `<details>` «Configuración» (Proyectos, Agentes, Terminales, Usuarios; abierto solo si la vista activa es una de ellas). Abajo, tema y usuario. Por debajo de 48 rem se pliega tras un botón «☰».
- Cada página empieza con `cabeceraPagina`: migas, título, frase de propósito, etiquetas y acciones a la derecha. Lista, tablero y ficha van a todo el ancho.

### Pantallas

- **Bandeja** (`GET /`, todos los proyectos): cuatro bloques siempre, con contador y «Nada pendiente.» si están vacíos: **Contesta** (preguntas abiertas, contestables desde aquí), **Aprueba** (análisis o descomposiciones listos, con el análisis y sus partes), **Revisa** (todo lo `done`, con el resultado, «Pedir otra iteración» y «Finalizar») y **Define** (más de siete días en `backlog`, solo enlace). Cada pendiente es una tarjeta con chip de proyecto, id, título, autor y edad; dentro de cada bloque, lo más antiguo primero. El contador de pendientes (los tres primeros bloques) sale en la barra y en el `<title>`: `(3) TABO Tasks`. Los formularios llevan `volver` (ruta relativa que empieza por `/` y no por `//`).
- **Tareas**: dos vistas de lo mismo, lista (`/tareas`) y tablero (`/tareas/kanban`), con el conmutador «Lista | Tablero». **Agrupadas por funcionalidad por defecto** (`?agrupar=no` las da por columnas): una franja o sección por funcionalidad con tareas visibles (primero `doing`, luego `prepared`, `backlog`, `done`; las `finished` no) y al final «Sueltas». Una tarea va a la franja de su funcionalidad antepasada más cercana. Arrastrar reordena dentro de la franja (`entre: { padreId }`), nunca entre franjas.
- **Filtros**: tres conmutadores rápidos `?rapido=espera|en-marcha|sin-terminal` y búsqueda `?q=` (`LIKE` sobre `lower()`, que solo pliega ASCII; `ponytail: FTS5 unicode61 cuando la búsqueda se quede corta`). Viven en `listarTareas`. Los demás filtros solo por URL, sin desplegables.
- **Tarjeta**: id, una sola etiqueta (la de turno, o la primera de `parada`, `en marcha`, `sin terminal`, `esperando`, `sobre presupuesto`; el tipo aparte), edad en columna, título, progreso de hijas (`<progress class="progreso">`), chips de los agentes de cada fase y tokens (`tokensAbreviados`: `980`, `184 k`, `1,2 M`; con presupuesto, `184 k / 200 k`). Filete `--turno` si espera por el humano. Hijas, cerradas y tokens con hijas vienen en el índice en una sola consulta (CTE recursiva), nunca una por tarjeta. La columna Cerradas enseña las diez más recientes. La fila de la lista lleva la misma etiqueta única que la tarjeta.
- **Arrastre** (`POST /tareas/:id/orden`): misma columna es `reordenar`; otra columna es `moverTareaHumano` y luego `reordenar`, pidiendo nota si la transición la exige. Responde 204 o `{ codigo, mensaje }` con 422/404, y el tablero se recarga. SortableJS se carga solo donde hay tablero.
- **Ficha** (`/tareas/:id`): cabecera con estado, etiqueta de turno, tipo, iteración y edad; el ciclo de cinco pasos (`pasosDelCiclo`) con la frase de qué pasa ahora; las preguntas abiertas arriba con su formulario; propiedades, consumo y acciones excepcionales (devolver, editar, borrar como `<details>`) en un panel a la derecha desde 64 rem; descripción, subtareas, hilo y actividad. El hilo se filtra con `?hilo=preguntas|comentarios` y acaba en el cuadro de comentar, fijo al fondo. Cualquier `T-…` en Markdown enlaza a su ficha.
- **Edad en columna** (`estado_desde`, la escribe `cambiarEstado`): `12 min`, `5 h`, `3 d` en tarjeta, lista y ficha. En `--peligro` una pregunta abierta de más de un día o un `done` de más de tres. No en `backlog` ni `finished`.
- **Fases paradas**: con fase en marcha, la ficha ofrece «Liberar la fase» (`POST /tareas/:id/liberar`): pone a nulo el terminal y la hora, escribe un comentario de `servidor` con quién la libera y quién la tenía, deja rastro `liberar_fase` y sube la revisión. No cambia el estado. Sin fase en marcha, `sin_fase_en_marcha`. El bucle no cambia: una fase liberada se toma como una sin tomar.
- **Formulario de tarea**: título, tipo (`pregunta` por defecto), descripción, rama, «Subtarea de», dependencias, presupuesto, autoejecución y las dos fases (agente, modelo, terminal). El proyecto no se elige: el de la URL o el recordado.
- **Informes** (`?dias=7|30|90|todo`, 30 por defecto): ¿qué cuesta cada modelo?, ¿cuánto interrumpe?, ¿dónde se atasca el flujo? (ciclo mediano `prepared → done` y revisión mediana `done → finished`) y ¿qué modelo entrega resultados que no valen? (devoluciones `done → doing`), más el ritmo de llegadas a `done` (por día los últimos catorce con 7 o 30 días; por semana con más). Una función por tabla en `src/db/informes.ts`, cada una una sentencia SQL; las funcionalidades quedan fuera. Salen de la tabla `transiciones`, que escribe solo `cambiarEstado` y la creación, y no reconstruye el pasado: el pie dice desde cuándo hay datos.
- **Presupuesto**: opcional, editable en `backlog`, no se hereda. Marca `sobre presupuesto`, fila en la ficha y «184 600 de 200 000» en el consumo.
- **Terminales**: la franja «Ahora mismo» (por terminal: conectado o no, sus fases en marcha con edad, o «En reposo»; una sola consulta, refresco por intervalo) y la tabla con dueño, uso disponible por ventana, agentes en paralelo, revocar, rotar y borrar.
- **Actividad**, **Usuarios**, **Proyectos** y **Agentes**: listas con alta y edición en página aparte y confirmaciones en página aparte, para que todo funcione sin JavaScript.

### Refresco en vivo

`GET /eventos` emite la revisión por SSE consultando la base cada segundo. Lista, tablero, ficha y bandeja llevan `data-revision` y se recargan con GET (nunca `reload()`, que reenviaría un POST) cuando sube. Si hay texto sin enviar en un campo, no recargan: avisan «Hay cambios en esta tarea» y recargan al vaciarse o enviarse. **Solo la pestaña visible mantiene la conexión**: HTTP/1.1 limita a seis conexiones por servidor y cada pestaña ocupaba una.

### Avisos fuera de la web

Con `AVISOS_URL`, cada aviso es un `POST` de texto plano (frase y enlace a la ficha con `BASE_URL`), el formato que acepta ntfy. Avisan solo los agentes: una pregunta nueva, una tarea que pasa a `done` (no una funcionalidad al cerrarse) y un análisis o descomposición que espera aprobación. Se envía después de confirmar la transacción, desde la herramienta MCP; nunca lanza (fallo o cinco segundos: una línea en stderr). `src/avisos.ts`, `crearAvisador`.

### Actividad: quién hizo qué

Toda acción humana deja rastro en `actividad` con el usuario, en la misma transacción, con `registrarActividad`: crear, editar (solo los campos que cambiaron; sin cambios, sin fila), mover, aprobar, responder, comentar, liberar, y las altas, bajas y cambios de usuarios, terminales, proyectos y agentes. Las acciones y su detalle están en `fraseDeAccion`. Reglas:
- Nunca sube la revisión por sí sola.
- `usuario_nombre` y `objeto_nombre` se guardan como texto, para sobrevivir al borrado.
- El CLI y el primer arranque firman `cli` y `arranque`; sin actor no se escribe (los tests).
- Reordenar no deja rastro. Los agentes no escriben actividad: ya está en el hilo.
- Los ids de usuario y terminal se reciclan, así que el rastro de un objeto empieza en su última alta (`actividadDe`, `altaPor`).

### Sesión y seguridad

- Login con usuario y contraseña (scrypt); cookie firmada con `SESSION_SECRET`, `HttpOnly`, `SameSite=Lax`, treinta días. Error de login: 401.
- Toda la web exige sesión salvo `/login`, `/salud`, `/skill.md` y `/terminales/conectar?token=` con un token válido.
- Se rechaza cualquier POST con `Sec-Fetch-Site: cross-site`; no hay tokens CSRF aparte.
- El Markdown se renderiza con markdown-it con HTML crudo desactivado: es la única entrada de terceros que llega al navegador.
- Usuarios: no se borra el último (`ultimo_usuario`) ni uno con terminales (`usuario_con_terminales`). Borrar sube la revisión; cambiar contraseña o color no.

## Terminales

Cada terminal tiene nombre, cuenta de origen (la escribe el usuario en el alta: no se puede leer de forma documentada), proyecto, agentes en paralelo y uso disponible.

- **Autenticación**: bearer token por terminal, entregado una sola vez y guardado con hash. Sin token válido, la petición no llega al MCP. Revocar desconecta ese terminal y solo ese.
- **Agentes en paralelo** (`terminales.agentes`, entero ≥ 1, `agentes_invalido`): el bucle lo lee en `registrar_terminal` y en cada vuelta lanza hasta ese número de subagentes a la vez. El servidor no lo impone: un subagente caído bloquearía el terminal entero. Cambiarlo deja rastro y no sube la revisión.
- **Uso disponible**: solo existe en el JSON que Claude Code pasa a la statusline (`rate_limits`, tres ventanas con `used_percentage` y `resets_at`), solo en cuentas Pro o Max y tras la primera respuesta. Con clave de API, solo `cost.total_cost_usd`. Por eso el plugin trae una statusline que lo reenvía a `/api/uso` como mucho una vez por minuto. La web enseña lo que queda y cuándo se reinicia.
- **Direcciones**: `BASE_URL`, las de `DIRECCIONES` o, sin ella, las IPv4 privadas detectadas con el puerto de `PORT` (dentro de Docker son las del contenedor: para eso existe `DIRECCIONES`). Todas se admiten en `Host`, además de `localhost`; el resto lo frena la protección contra DNS rebinding.
- **Tutorial de conexión**: la página «Terminal creado» enseña el token una vez, su enlace de conexión y el tutorial con las direcciones y el token puestos. `GET /terminales/conectar` es el mismo tutorial con `<token>` de marcador; con `?token=` válido no exige sesión (el enlace es un secreto y caduca al revocar o rotar). Los comandos del tutorial se verifican contra la documentación de Claude Code; no se inventan.
- **Rotar** (`POST /terminales/:id/rotar`): token nuevo para el mismo terminal, que conserva historial y consumo. No revoca. Un revocado no se rota (`terminal_revocado`). Deja rastro y no sube la revisión. En la máquina, se repite `claude mcp add`.
- **Borrar**: en cualquier estado. Sus tareas pierden la referencia (y las en marcha quedan libres); el consumo y el rastro se conservan. Sube la revisión, porque cambia quién puede tomar tareas.

## Conexión en dos comandos

En la carpeta del repositorio:

```
claude mcp add --transport http --scope local tareas <url>/mcp --header "Authorization: Bearer <token>"
curl -fsSL <url>/skill.md --create-dirs -o ~/.claude/skills/tareas/SKILL.md
```

Y en la sesión de Claude Code, `/loop 2m /tareas`: una vuelta cada dos minutos, que sin novedades cuesta una llamada (sin intervalo, `/loop` tiende a media hora en reposo).

- El servidor sirve la skill en `GET /skill.md` (`text/markdown`, sin sesión); la copia canónica es `server/src/skill/SKILL.md` y el `Dockerfile` la copia a `dist/skill/`.
- La skill no depende del plugin. Nombra las herramientas con los dos prefijos posibles: `mcp__tareas__*` (servidor con `claude mcp add`) y `mcp__plugin_mcp-tareas_tareas__*` (plugin).
- La skill llama a `novedades` sin `revision`: la recuerda el servidor, así que compactar el contexto o reanudar la sesión no pierde nada.
- El ámbito local es por carpeta: un terminal por carpeta, con el token en `~/.claude.json` y nunca en el repositorio (`--scope project` lo escribiría en `.mcp.json`).
- El bucle reporta su `ruta` y su remote `origin` en `registrar_terminal`; con `proyecto_no_coincide` lo dice y termina la vuelta sin tocar nada.

## El plugin (opcional)

Solo hace lo que un archivo de texto no puede: reportar el uso de la cuenta. Verificado contra la documentación de Claude Code:

- Declara el servidor en `.mcp.json` (`type: "http"`, `url`, cabecera bearer) con la URL y el token pedidos al activarlo en `userConfig` (el token `sensitive`), referenciados como `${user_config.<clave>}`. Se guardan solo en `~/.claude/settings.json`: un plugin configura un terminal por máquina; otra carpeta usa `claude mcp add` local, que gana por precedencia.
- Un hook `SessionStart` vuelca URL y token a `~/.claude/mcp-tareas/config` (permisos 600; en hooks llegan como `CLAUDE_PLUGIN_OPTION_<CLAVE>`) y copia la statusline a `~/.claude/mcp-tareas/statusline.sh`, una ruta estable que va en `statusLine.command`: la carpeta del plugin cambia con cada versión. Un plugin no puede imponer la statusline.
- No lleva la skill ni un comando de bucle. Si guarda estado, en `${CLAUDE_PLUGIN_DATA}`, nunca en `${CLAUDE_PLUGIN_ROOT}`.
- Se instala desde el catálogo del repositorio (`.claude-plugin/marketplace.json`, nombre `mcp-tareas-marketplace`, apunta a `./plugin`): `claude plugin marketplace add xinux87/Mcp_tasks_server` y `claude plugin install mcp-tareas@mcp-tareas-marketplace`. `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` existe por si hace falta forzar HTTPS. Cambiar valores: `/plugin` → Installed, o `install … --config token_terminal=<token>`. Desarrollo: `claude --plugin-dir <clon>/plugin`.
- `xinux87` es la única referencia a una persona en el repositorio; los ejemplos usan `ana`, `portatil-ana` y `ana@ejemplo.com`.

## Stack del servidor

El mínimo de piezas que cubra MCP, API, web y persistencia en un solo proceso y un solo puerto, sin compilaciones nativas en Docker.

| Pieza | Elección |
|---|---|
| Runtime | Node 24 LTS, que ejecuta TypeScript por eliminación de tipos |
| Lenguaje | TypeScript 7, `strict`, ESM; solo sintaxis borrable (sin `enum` ni `namespace`) |
| MCP | `@modelcontextprotocol/server` v2, `createMcpHandler` con fábrica por petición, sin estado, respuestas JSON (el aviso del SDK en stderr es esperado). Streamable HTTP, sin stdio |
| HTTP y web | Hono sobre `@hono/node-server`; plantillas `hono/html` con escape automático, sin JSX |
| Validación | Zod v4 |
| Persistencia | `node:sqlite` en WAL, SQL a mano sin ORM. Migraciones SQL numeradas con `PRAGMA user_version`; el runner apaga las claves foráneas y comprueba `foreign_key_check` al terminar |
| Cliente | Un solo `cliente.ts` servido en `/static/app.js`, CSS desde `estilos.ts`, SortableJS desde `node_modules`. Sin bundler, framework de cliente ni htmx |
| Markdown | markdown-it (trae sus tipos) |
| Tests | `node:test` sobre `.ts`; el MCP se prueba con `@modelcontextprotocol/client` contra la app en memoria |
| Lint | Biome |
| Imagen | Docker multi-stage sobre `node:24-slim`, usuario sin privilegios, volumen en `/data` |

Descartados: Express (adaptador y motor de plantillas aparte), better-sqlite3 (módulo nativo), una SPA (bundler y estado duplicado), sesiones MCP con estado (atan la identidad a un proceso).

| Ruta | Autenticación |
|---|---|
| `/mcp`, `/api/uso` | Bearer del terminal |
| `/eventos` y la web | Cookie de sesión |
| `/salud`, `/skill.md` | Ninguna |

### Estructura

```
server/
  src/
    main.ts  app.ts  config.ts  cli.ts  avisos.ts
    db/          # migraciones y consultas; aquí viven las reglas
    mcp/         # una herramienta por archivo, más el handler
    md/          # documento de tarea, índice y novedades
    web/         # rutas, plantillas, componentes, vocabulario, CSS y cliente
    auth/  api/
    skill/SKILL.md
  test/          # node:test, un archivo por módulo
plugin/          # opcional: hook SessionStart y statusline
.claude-plugin/marketplace.json
```

### Variables de entorno

| Variable | Para qué | Por defecto |
|---|---|---|
| `PORT` | Puerto (en `compose.yaml`, el publicado; dentro, siempre 3000) | `3000`, `9917` en local |
| `DATA_DIR` | Carpeta de la base | `/data` |
| `BASE_URL` | URL pública | obligatoria |
| `SESSION_SECRET` | Firma de la cookie | obligatoria |
| `ADMIN_PASSWORD` | Contraseña del primer usuario | obligatoria sin usuarios |
| `DIRECCIONES` | URLs base adicionales, separadas por comas | IPs privadas detectadas |
| `DATOS` | Solo `compose`: carpeta del anfitrión montada en `/data` (uid 1000) | volumen `datos`; `./datos` en el despliegue |
| `AVISOS_URL` | Destino de los avisos | sin avisos |
| `FASE_PARADA_HORAS` | Umbral de la marca `parada` | `6` |

### Comandos

Dentro de `server/`:

| Comando | Qué hace |
|---|---|
| `npm run dev` | Arranca con recarga; lee `.env` |
| `npm test` | Typecheck de los tests (`tsconfig.test.json`) y todos los tests |
| `node --test test/tareas.test.ts` | Un archivo, sin typecheck |
| `node --test --test-name-pattern="tomar" "test/**/*.test.ts"` | Por nombre (`node --test` toma globs, no directorios) |
| `npm run typecheck` / `npm run lint` / `npm run build` | Tipos de `src/`, Biome, JavaScript a `dist/` |
| `npm run cli -- crear-usuario <nombre>` | Usuario con la contraseña de `ADMIN_PASSWORD` |
| `npm run cli -- crear-terminal <usuario> <nombre> <cuenta> [clave]` | Terminal en ese proyecto (`DEFAULT` si no se da); imprime el token una vez |
| `npm run cli -- crear-proyecto <clave> <nombre>` | Proyecto |
| `docker compose up --build -d` | Contenedor local en el 9917; necesita `server/.env` con `SESSION_SECRET` y `ADMIN_PASSWORD` |

### Publicar una versión

Es una acción hacia fuera: solo cuando el humano dice «publica la imagen y haz push». Hasta entonces, commits locales y el contenedor local.

1. **El número sale de `git tag -l | sort -V | tail -1`**, nunca de memoria: otra sesión puede haber publicado.
2. **La versión va en seis sitios**: `server/package.json`, `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `server/Dockerfile` (`org.opencontainers.image.version`), `docker-compose.yml` de la raíz (`VERSION:-X.Y.Z`) y el README; `server/compose.yaml` la cita en un comentario. Se comprueba con `git grep` de la anterior.
3. **Verificación**: `npm run lint && npm run typecheck && npm test` en `server/`, y `claude plugin validate ./plugin --strict && claude plugin validate . --strict`.
4. Commit «Versión X.Y.Z: …» y etiqueta anotada `vX.Y.Z`.
5. Imagen multi-arquitectura desde `server/` con el builder `mcp-tareas` y la sesión de `docker login -u xinux87` que abre el humano: `docker buildx build --builder mcp-tareas --platform linux/amd64,linux/arm64 -t xinux87/mcp-tareas-server:X.Y.Z -t xinux87/mcp-tareas-server:latest --push .`
6. `git push origin main` y `git push origin vX.Y.Z`, en ese orden.
7. En un servidor desplegado: `VERSION=X.Y.Z` en su `.env` y `docker compose pull && docker compose up -d`; las migraciones corren solas. Si cambió la skill, cada terminal la vuelve a bajar y relanza `/loop 2m /tareas`.
