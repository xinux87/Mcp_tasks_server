# Plan de mejora a partir de paperclip

Comparación de **paperclip** (https://github.com/paperclipai/paperclip) con **MCP Tareas**, y qué conviene traerse. Escrito el 16 de septiembre de 2026.

---

## 1. Resumen

1. **Paperclip** es un *control plane* para «empresas» de agentes: organigrama, objetivos, presupuesto mensual por agente, rutinas, aprobaciones, artefactos, tienda de skills y varias empresas por instancia.
2. Su unidad de trabajo es un *issue* al estilo Linear: estado por categoría, prioridad 0-4, etiquetas, proyecto, hito, bloqueadores, un único asignado.
3. Sus agentes son procesos que el servidor despierta con *heartbeats*; el servidor arranca y para el CLI, guarda el `session id` y lo reanuda en la siguiente llamada.
4. **MCP Tareas** es un tablero de cinco columnas donde cada tarea tiene dos fases (análisis y ejecución), cada una con su modelo, su terminal y, opcionalmente, su papel de agente.
5. Nuestro bucle no lo arranca el servidor: corre **dentro** de la sesión de Claude Code del humano, con `/loop 2m /tareas`, y el servidor solo responde preguntas.
6. Lo que compartimos: hilo por tarea como única memoria visible, preguntas con opciones al humano, subtareas, dependencias, consumo medido, y una bandeja de «esto espera por ti».
7. Lo que ellos tienen y nosotros no, y merece mirarse: el «ahora mismo» (qué agente está corriendo y desde cuándo), el panel de propiedades con «Bloquea a», la barra de progreso de subtareas en la ficha, la búsqueda global y el vigilante de trabajo parado.
8. **Se descarta multi-empresa y organigrama**: aquí un proyecto es un repositorio y un terminal es una carpeta; una jerarquía de agentes con jefes no decide nada que el orden de la columna no decida ya.
9. **Se descarta el presupuesto mensual por agente y la tienda de skills**: el presupuesto aquí es por tarea y en tokens, que es la unidad que se puede atribuir; una tienda de skills duplicaría `~/.claude/skills`, que ya existe en la máquina donde corre el agente.
10. **Se descartan los plugins de paperclip y las *status cards***: nuestro plugin es opcional y solo reporta uso de cuenta, y una tarjeta de resumen escrita por un modelo cada quince minutos es gasto recurrente para contar lo que la bandeja cuenta gratis.

---

## Parte 1: Interfaz

### 1.1 Comparación pantalla a pantalla

| Pantalla | Paperclip | MCP Tareas | Quién lo hace mejor |
|---|---|---|---|
| **Bandeja / Inbox** | Tres pantallas que se solapan: `Inbox`, `WhatNeedsMe` y `DecisionQueuePage`, más `Approvals` aparte. Contador en la navegación. | Una sola: `GET /` con cuatro bloques (Contesta, Aprueba, Revisa, Define), contador en la barra y en el título de la pestaña, y la acción se hace desde la propia línea. | **Nosotros.** Una pantalla con verbos por bloque es más clara que cuatro listas parecidas. No hay nada que copiar. |
| **Dashboard** | Tarjetas por agente con su último *run* («Finished 2d ago», «failed after 1 hour 5 minutes», el id del run y su resultado), cuatro KPIs (agentes activos, tareas en curso, gasto del mes, aprobaciones pendientes) y cuatro gráficas de barras de 14 días. | No existe. Informes contesta preguntas distintas (coste por modelo, tiempo de ciclo, devoluciones). | **Ellos, en una cosa**: el «ahora mismo». No sabemos de un vistazo qué está corriendo, en qué terminal ni desde cuándo. El resto de su dashboard son cifras que nuestros informes dan mejor. |
| **Tablero y lista** | Cuatro vistas de lo mismo (lista, tablero, árbol, columnas), filtros, ordenación, prioridad 0-4 con flecha en cada fila, etiquetas. | Lista y tablero, agrupados por funcionalidad por defecto, tres conmutadores rápidos, búsqueda, barra de progreso y tokens en cada tarjeta. | **Nosotros.** Agrupar por funcionalidad y enseñar el consumo en la tarjeta dice más que una flecha de prioridad. Cuatro vistas de lo mismo es indecisión, no funcionalidad. |
| **Ficha de tarea** | Panel de propiedades a la derecha con Status, Priority, Labels, Assignee, Project, Parent, **Blocked by**, **Blocking**, **Sub-tasks** (con chips y un bloque «3/3 done · 0 in progress · 0 blocked» con barra), Related, Reviewers, Approvers, Monitor, Workspace, **Branch**. | Panel de propiedades con Estado, Proyecto, Tipo, Análisis, Ejecución, Autoejecución, Padre, Orden, Creada, Revisión, y «Depende de» con la etiqueta de estado de cada una. Hijas como lista con su etiqueta. | **Ellos, en tres detalles**: «Blocking» (quién me espera), el recuento y la barra de las subtareas, y la rama en las propiedades. Lo demás (Reviewers, Approvers, Monitor) es burocracia que aquí hace el humano solo. |
| **Agentes** | `Agents`, `AgentDetail` con pestañas de instrucciones, herramientas, *runs*, y el run en vivo con su log. | `GET /agentes`: lista de papeles y su edición. Nada sobre qué han hecho. | **Ellos.** Un papel sin historial no se puede juzgar: no se sabe si ese revisor sirve o estorba. |
| **Informes / Costes** | `Costs` y el KPI «Month Spend» en euros, con presupuesto y auto-pausa al 100 %. Gráficas diarias de 14 días. | Cuatro tablas que contestan cuatro preguntas (qué cuesta cada modelo, cuánto interrumpe, dónde se atasca, qué se devuelve) y el ritmo semanal. | **Nosotros en el fondo, ellos en la forma.** Nuestras preguntas son mejores; su ventana de 14 días por día se lee mejor que nuestro ritmo por semana cuando llevas poco tiempo. |
| **Actividad / Timeline** | `Timeline` con las mutaciones recientes. | `GET /actividad`: las últimas cien acciones humanas agrupadas por día, con chip de quién. | **Nosotros.** La suya mezcla lo que hacen los agentes con lo que hace la persona; la nuestra responde «quién hizo qué» sin ruido. |
| **Búsqueda** | Pantalla `Search` propia y lupa en la cabecera, a mano en toda la aplicación. | `?q=` dentro de la lista y del tablero, acotada al proyecto que se está viendo. | **Ellos.** Buscar un `T-` que citaron en un commit obliga hoy a estar en la vista correcta. |

### 1.2 Mejoras propuestas, por orden

**I-1. «Bloquea a» en las propiedades de la ficha.** *(pequeño)*

- **Qué cambia**: debajo de «Depende de», una fila «Bloquea a» con las tareas que declaran depender de esta, cada una con su etiqueta de estado y enlace. Si no hay ninguna, «ninguna».
- **Por qué**: hoy la dependencia solo se ve desde el lado que espera. Cuando el humano se pregunta si vale la pena desbloquear una tarea, la respuesta es cuántas hay detrás, y eso no se ve en ninguna pantalla. Es lo que paperclip pone como «Blocking» y lo que nosotros ya calculamos: `dependientesDe` existe en `server/src/db/dependencias.ts` y hoy solo se usa en la confirmación de borrado.
- **CLAUDE.md**: «Diseño visual › Pantallas › Ficha» (la lista de filas de propiedades) y «Dependencias» (una frase: la ficha enseña las dos direcciones).

**I-2. Progreso de hijas en la ficha, con recuento.** *(pequeño)*

- **Qué cambia**: la cabecera del bloque Hijas pasa de «Hijas» a «Hijas 2/5» con la misma `<progress class="progreso">` que ya usan la tarjeta y la fila, y debajo el desglose en texto suave: «3 hechas · 1 en curso · 1 bloqueada».
- **Por qué**: la tarjeta del tablero ya lo enseña y la ficha no, que es donde el humano decide si acepta el resultado de una tarea padre. Paperclip pone exactamente ese bloque encima de la lista de subtareas.
- **Coste real**: `progresoDe` en `server/src/web/rutas/kanban.ts` toma un `ItemIndice`; la ficha tiene las hijas como índice, así que es reutilizarlo, no escribirlo.
- **CLAUDE.md**: «Diseño visual › Pantallas › Ficha» y «Un tablero que se lee de un vistazo › La tarjeta y la fila» (donde vive la regla del `<progress>`).

**I-3. La rama en las propiedades.** *(pequeño)*

- **Qué cambia**: fila «Rama» en el bloque de propiedades cuando la tarea tiene `rama`, en monoespaciada, y la misma fila en la ficha de una funcionalidad.
- **Por qué**: la rama gobierna dónde va el commit y hoy solo se ve editando la tarea en `backlog`. Cuando el humano revisa una tarea `done` necesita saber en qué rama mirar. Paperclip la pone en el panel (`Branch`) por lo mismo.
- **CLAUDE.md**: «Diseño visual › Pantallas › Ficha».

**I-4. Buscar desde cualquier sitio.** *(pequeño)*

- **Qué cambia**: en la barra lateral, debajo del selector de proyecto, un `<form method="get" action="/tareas">` con un `<input type="search" name="q">` y el botón escondido, como ya se hace con `GET /ir`. Envía a la lista cruzada del proyecto recordado, o a `/tareas` sin prefijo si está puesto «Todos los proyectos».
- **Por qué**: hoy hay que llegar primero a la vista correcta. No añade pantalla ni ruta ni JavaScript: reusa `?q=`, que ya vive en `listarTareas`.
- **Ojo**: la búsqueda usa `LIKE` sobre `lower()`, que solo pliega ASCII. Eso ya está anotado en CLAUDE.md como limitación conocida y esta mejora la hace más visible; si molesta, el salto a FTS5 es otra tarea.
- **CLAUDE.md**: «Diseño visual › Esqueleto» (qué hay en la barra lateral) y «Un tablero que se lee de un vistazo › Filtros de un clic y búsqueda».

**I-5. «Ahora mismo» en la página de Terminales.** *(medio)*

- **Qué cambia**: encima de la tabla de terminales, una franja de tarjetas, una por terminal, con: nombre y proyecto, si está conectado, las tareas que tiene en marcha con su fase, su modelo y **desde hace cuánto** (`12 min`, `2 h`), y su última revisión vista. Un terminal sin nada en marcha dice «en reposo desde hace 5 min».
- **Por qué**: es lo único del dashboard de paperclip que nosotros no cubrimos. Contesta la pregunta de «¿está pasando algo o se ha muerto el bucle?», que hoy solo se responde mirando la columna «Conectado» y adivinando. Y es la base del vigilante de la Parte 2.
- **Qué falta para poder hacerlo**: la marca `en marcha` no guarda cuándo se tomó la fase. Hace falta una columna `tareas.en_marcha_desde TEXT`, que escribe `tomar_tarea` y borra el comentario que cierra la fase. Va junto con **F-2**; son el mismo cambio de esquema y tienen que ir en el mismo encargo o en serie.
- **No es un dashboard nuevo.** Se descarta crear una pantalla `/dashboard`: repetiría los contadores de la bandeja y las cifras de los informes en una tercera versión.
- **CLAUDE.md**: «Terminales conectados», «Marcas sobre la tarea» (`en marcha` pasa a tener edad), «Diseño visual › Pantallas › Terminales», y «Edad en columna» (la función de formato ya existe).

**I-6. La ficha de un agente enseña lo que ha hecho.** *(medio)*

- **Qué cambia**: `GET /agentes/:id` (hoy solo existe `/editar`) con el papel renderizado, las fases que lo llevan ahora mismo, y una tabla de las últimas veinte tareas que trabajó con su fase, su estado final, su consumo y si fue devuelta.
- **Por qué**: los papeles solo sirven si se pueden comparar. Con esto se ve si un revisor está haciendo que las tareas se devuelvan más, que es la pregunta 4 de los informes aplicada a un papel en vez de a un modelo.
- **Consecuencia**: hay que poder saber qué agente trabajó cada fase después. Hoy `tareas.analisis_agente_id` se pone a nulo al borrar el agente y el consumo no guarda el agente, así que la tabla se calcula sobre las tareas vivas que lo tienen asignado. Es suficiente y no añade columnas; si algún día hace falta el histórico, sería un campo en `consumo`.
- **CLAUDE.md**: «Agentes › En la web».

**I-7. El ritmo, por día y de 14 días.** *(pequeño)*

- **Qué cambia**: el bloque «ritmo» de los informes pasa de semanas a los últimos 14 días, una barra por día, con la misma `<progress>`. La tabla semanal se queda para periodos de 90 días o «todo».
- **Por qué**: con pocas semanas de datos el gráfico semanal tiene tres barras y no dice nada. Paperclip usa 14 días en las cuatro gráficas del dashboard por esa razón.
- **CLAUDE.md**: «Saber qué cuesta y qué rinde › Informes» (el párrafo del ritmo).

### 1.3 Evaluado y descartado

- **Prioridad explícita 0-4.** Contradice frontalmente «El orden dentro de una columna se puede cambiar siempre. Es la prioridad» (CLAUDE.md › Qué se puede editar en cada estado). Un campo de prioridad y un orden arrastrable dan dos verdades que se contradicen en cuanto alguien arrastra una tarjeta «Low» por encima de una «High». **Se descarta**, y si algún día se quisiera, habría que quitar el arrastre para reordenar, no añadir el campo encima.
- **Etiquetas.** Ya hay cuatro ejes de clasificación (proyecto, funcionalidad, tipo y estado). Un quinto de texto libre se llena de sinónimos en un mes.
- **Reviewers y Approvers como campos.** El revisor es siempre el humano y la aprobación ya es `autoejecucion` más la columna Hechas. Un campo con un nombre dentro no cambia quién hace el trabajo.
- **Pantalla de Dashboard.** Ver I-5.
- **Modo oscuro por defecto y el aspecto de paperclip.** Ya tenemos tema claro, oscuro y sistema, y una paleta decidida. Nada que copiar.
- **Status cards.** Resúmenes escritos por un modelo cada pocos minutos. Gasto recurrente para contar lo que la bandeja cuenta mirando la base de datos.

---

## Parte 2: Funcionalidades

### 2.1 Las skills del agente padre en el subagente

Es lo que más preocupa: el bucle corre en una sesión de Claude Code que tiene sus skills (`~/.claude/skills`, las del proyecto, las de plugins), su `CLAUDE.md` y sus servidores MCP; cada fase se lanza como subagente con la herramienta `Agent` y `subagent_type: general-purpose`. ¿Qué le llega?

#### Lo verificado

De https://code.claude.com/docs/en/sub-agents, sección «What loads at startup», literal:

> «Each subagent starts with a fresh, isolated context window. It doesn't see your conversation history, **the skills you've already invoked**, or the files Claude has already read.»

y la lista de lo que sí contiene su contexto inicial:

> «**CLAUDE.md files**: every level of the CLAUDE.md hierarchy the main conversation loads, including `~/.claude/CLAUDE.md`, project rules, `CLAUDE.local.md`, and managed policy files. The built-in Explore and Plan agents skip this.»
>
> «**Preloaded skills**: full content of any skill named in the agent's `skills` field. **Built-in agents don't preload skills.**»

Sobre herramientas y MCP, misma página, sección «Available tools»:

> «Subagents inherit the built-in tools and MCP tools available in the main conversation, narrowed by two filters: the first removes a short list of tools from every subagent, and the second reduces the built-in tool set for subagents that run in the background, which is the default.»

y, para los que corren en segundo plano (que es el caso por defecto en una sesión interactiva):

> «a background subagent keeps every MCP tool but only these built-in tools: `Read`, `Grep`, `Glob`, `Bash`, `PowerShell`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`, `TodoWrite`, **`Skill`**, `ToolSearch`, …»

Sobre el campo `skills` del frontmatter de un agente personalizado, misma página, «Preload skills into subagents»:

> «The full content of each listed skill is injected into the subagent's context at startup. This field controls which skills are preloaded, not which skills the subagent can access: **without it, the subagent can still discover and invoke project, user, and plugin skills through the Skill tool during execution.** To prevent a subagent from invoking skills entirely, omit `Skill` from the `tools` list or add it to `disallowedTools`.»

De https://code.claude.com/docs/en/skills, tabla de descubrimiento y sección de directorios añadidos:

> «Personal | `~/.claude/skills/<skill-name>/SKILL.md` | All your projects on this machine»
> «Project | `.claude/skills/<skill-name>/SKILL.md` | Sessions in this repository.»
> «When you add a directory with `--add-dir` or `/add-dir`, Claude Code loads the skills in that directory's `.claude/skills/`, along with its `.claude/commands/` and `.claude/agents/`.»

y sobre cuándo se carga el cuerpo de una skill:

> «In a regular session, skill descriptions are loaded into context so Claude knows what's available, but full skill content only loads when invoked. Subagents with preloaded skills work differently: the full skill content is injected at startup.»

De https://code.claude.com/docs/en/plugins-reference:

> «Plugin agents support `name`, `description`, `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, **`skills`**, `memory`, `background`, `omitClaudeMd`, and `isolation` frontmatter fields.»
> «For security reasons, plugin-shipped agents don't support `hooks`, `mcpServers`, or `permissionMode`.»

De https://code.claude.com/docs/en/cli-reference, sobre `--add-dir`:

> «Add additional working directories for Claude to read and edit files. Grants file access; Claude Code doesn't discover most `.claude/` configuration from these directories.»

Nótese la tensión aparente con la página de skills: la referencia del CLI dice «most», y la página de skills nombra la excepción (skills, commands y agents de ese directorio sí se cargan). Se toma como buena la más específica.

#### Qué se deduce

1. **El `CLAUDE.md` del repositorio sí llega al subagente.** Toda la jerarquía, incluido `~/.claude/CLAUDE.md`. Esa parte de la preocupación no se cumple.
2. **Las herramientas MCP sí llegan.** Es lo que hace que el subagente pueda llamar a `comentar_tarea` hoy; funciona, así que está comprobado en la práctica además de en la documentación.
3. **Lo que no llega es el *contenido* de las skills que el padre ya había invocado.** El subagente arranca sin ellas.
4. **Pero el subagente conserva la herramienta `Skill` y puede invocarlas él.** La documentación lo dice con todas las letras y la lista de herramientas de un subagente en segundo plano incluye `Skill`. Es decir: no están cargadas, pero están a mano.
5. **El campo `skills` no sirve con `subagent_type: general-purpose`**: «Built-in agents don't preload skills». Para precargar hay que definir un agente propio en `.claude/agents/`.
6. **No documentado**: si el subagente recibe en su contexto la *lista* de descripciones de skills disponibles, o solo la herramienta. La documentación dice que puede «discover and invoke», pero no describe el formato. Por prudencia, el prompt debe nombrar la skill, no confiar en que la descubra.
7. **No documentado tampoco**: pasar `skills` por llamada en la herramienta `Agent`. El esquema de la herramienta en esta sesión acepta `description`, `prompt`, `subagent_type`, `model` e `isolation`, y nada más; eso es una observación del esquema, no una afirmación de la documentación.
8. **Paperclip resuelve lo mismo por fuera**: su adaptador `claude_local` «creates a temporary directory with symlinks to Paperclip skills and passes it via `--add-dir`» (`docs/adapters/claude-local.md`). Puede hacerlo porque **es él quien arranca el CLI**. Nosotros no arrancamos nada: el bucle vive dentro de una sesión que ya existe, así que esa vía no está disponible sin cambiar el modelo de conexión entero.

#### Las opciones

**(a) El papel del agente nombra sus skills y el prompt le manda invocarlas.** El bloque «Quién eres» que ya se pega en el prompt dice, además de quién es, «Antes de escribir código, invoca la skill `ponytail`». El subagente la invoca con la herramienta `Skill` y su contenido entra en su contexto igual que entraría en el del padre.

- *Piezas nuevas*: ninguna en el servidor. `agentes.instrucciones` es texto libre y ya se copia entero.
- *Consecuencia*: depende de que el subagente obedezca una instrucción del prompt. En la práctica es lo mismo de lo que ya dependen las cinco reglas del prompt y el formato del `resultado`.
- *Coste*: cero. Es escribir dos líneas en el papel del agente.
- *Refinamiento opcional*: un campo `agentes.skills TEXT` con los nombres separados por comas, para que la web lo pinte como campo propio y `leer_agente` lo devuelva en el frontmatter; el bucle lo traduce a una línea del prompt. Pequeño, y solo si se quiere que se vea en la lista de agentes.

**(b) Agentes personalizados en `.claude/agents/` con `skills:` precargadas.** El bucle lanzaría `subagent_type: revisor` en vez de `general-purpose`.

- *Consecuencia*: el contenido está garantizado, no pedido. A cambio, el papel deja de vivir solo en el servidor: hay un archivo por agente en cada repositorio, que hay que mantener sincronizado con la tabla `agentes`. Eso contradice «Un agente es un papel escrito en Markdown… **Se define una vez en el servidor**» (CLAUDE.md › Agentes): habría que cambiar esa frase o aceptar dos fuentes de verdad.
- *Además*: el contenido precargado «consumes tokens on every turn within that subagent». Una skill larga se paga en cada vuelta del subagente, no una vez.
- *Coste*: medio si los archivos se escriben a mano; grande si el servidor los genera (haría falta que alguien los escriba en el disco del terminal, y el servidor no toca el disco de nadie).

**(c) El servidor guarda las skills y las sirve, como paperclip.** O el papel lleva rutas locales y el bucle las lee con `Read` y las pega.

- *Consecuencia*: duplica `~/.claude/skills`, que ya existe en la máquina donde corre el agente, y obliga a sincronizarlo. Con rutas locales en el papel, además, un papel que es global al servidor pasa a depender de cómo esté montada una máquina concreta, lo que rompe «Los agentes no saben que hay proyectos» y el principio de que el papel se escribe en llano.
- *Coste*: grande.

#### Recomendación

**(a), y (b) solo si (a) falla en la práctica.** Motivos: no añade ninguna pieza, no cambia ninguna decisión escrita, y aprovecha que el subagente **sí** tiene la herramienta `Skill`, que es el hecho que cambia el problema. La preocupación de partida —«el subagente no tiene las skills del padre»— es cierta solo en el sentido de que no vienen cargadas; no en el sentido de que no pueda usarlas.

Lo que hay que tocar es la skill del bucle, `server/src/skill/SKILL.md`: hoy el bloque «Quién eres» se pega tal cual y nada dice al subagente que puede invocar skills. Bastan dos frases en las tres plantillas de prompt: que tiene la herramienta `Skill` disponible, y que invoque las que su papel le nombre antes de empezar.

**Lo que no hay que hacer**: poner `omitClaudeMd` ni restringir `tools` en ningún sitio. Hoy el subagente hereda el `CLAUDE.md` del repositorio, que es justo lo que queremos, y la herencia de herramientas MCP es lo que le permite escribir en el hilo.

### 2.2 El resto, por orden

**F-1. Vigilante de fases paradas.** *(medio)* — **recomendado**

- **Qué cambia**: columna `tareas.en_marcha_desde`, marca derivada **`parada`** cuando una fase lleva en marcha más de N horas (N por variable de entorno, 6 por defecto), y en la ficha un botón «Liberar la fase» que pone `en_marcha_terminal_id` a nulo y deja un `comentario` del servidor diciendo quién la tenía y desde cuándo.
- **Por qué**: hoy, si el subagente muere, la tarea se queda «en marcha» para siempre y ningún terminal la vuelve a tomar. CLAUDE.md ya reconoce el problema al justificar por qué se puede borrar una tarea en marcha («una fase que se queda en marcha porque el subagente murió dejaba la tarea imposible de borrar»): borrarla es la única salida que hay hoy, y es demasiado. Paperclip tiene tres mecanismos para esto (*task watchdog*, *silent active-run watchdog*, *liveness recovery*); nosotros necesitamos el más barato de los tres.
- **Lo que no se hace**: un agente vigilante que lea el hilo y decida si el «hecho» era verdad. Eso es gasto de modelo para una decisión que el humano toma en dos segundos mirando la bandeja.
- **Contradice**: nada. Complementa «Edad en columna», que enseña el problema pero no lo suelta.
- **CLAUDE.md**: «Marcas sobre la tarea» (marca nueva), «Diseño visual › Qué color lleva cada cosa» (naranja, como `sin terminal`), «Rutas» (`POST /tareas/:id/liberar`), «Variables de entorno del servidor».

**F-2. Duración del run en marcha.** *(pequeño, va con F-1 e I-5)*

- **Qué cambia**: la tarjeta, la fila y la ficha enseñan, junto a la marca `en marcha`, desde hace cuánto (`en marcha 12 min`). Mismo formato que la edad en columna.
- **Por qué**: es lo que hace útil la marca. Paperclip lo pone en cada tarjeta de agente del dashboard («failed after 1 hour 5 minutes»).
- **CLAUDE.md**: «Edad en columna» (una frase más) y «Marcas sobre la tarea».

**F-3. Las skills en el papel del agente.** *(pequeño)* — ver 2.1.

**F-4. El presupuesto frena, opcionalmente.** *(medio)* — **duda de negocio, ver 5.1**

- **Qué cambia**: `tomar_tarea` falla con `sobre_presupuesto` si la tarea tiene presupuesto y su consumo con hijas ya lo supera. El humano lo desbloquea subiendo el presupuesto o quitándolo.
- **Contradice**: «No frena a nadie: el humano decide qué hacer con el aviso» (CLAUDE.md › Saber qué cuesta y qué rinde › Presupuesto). Habría que cambiar esa frase. Paperclip sí frena: sus agentes se auto-pausan al 100 % del presupuesto mensual.
- **Consecuencia si se hace**: una tarea que se pasa se queda a medias hasta que el humano la mire. Es exactamente el comportamiento que se quería evitar al escribir esa frase, así que es decisión suya, no técnica.

**F-5. Artefactos en el resultado.** *(descartado, con alternativa de coste cero)*

- Paperclip sube archivos (`register_deliverable`, adjuntos, *work products*) porque sus revisores «often cannot access the agent's disk». **Aquí el humano tiene el repositorio delante**: el commit ya es el artefacto y las rutas del repositorio se abren en su editor.
- **Lo que sí conviene**: una frase en la plantilla del prompt de ejecución para que el `resultado` cite, además del commit, qué archivos ver si lo construido es visual. Coste cero, y evita montar almacenamiento de archivos, límites de tamaño y el problema de servir binarios subidos por un agente.

**F-6. Reanudar la sesión del subagente entre iteraciones.** *(descartado)*

- Paperclip «persists Claude Code session IDs between heartbeats» y reanuda la conversación. Nosotros relanzamos un subagente nuevo por iteración con el documento entero de la tarea en el prompt.
- **Por qué se descarta**: su propia documentación describe el precio —un transcript corrupto («poisoned `previous_message_id`») deja la tarea varada para siempre y hacen falta tres salvaguardas (rotar sesión, no persistir el id, limpiar la fila) para no perderla. Y sobre todo, mover el estado a un transcript opaco contradice «Todo el trabajo queda visible» y «El hilo es lo que se ve en la web y lo que el agente lee»: lo que el subagente recordaría no estaría en la web.
- **Lo que ya tenemos y basta**: el hilo completo en el prompt. Cuesta tokens de entrada, que es un coste conocido y medido, en vez de un estado invisible.

**F-7. Rutinas programadas.** *(descartado)*

- Paperclip tiene `Routines` con cron. Nosotros ya tenemos el reloj: `/loop 2m /tareas` lo pone Claude Code, y para lo programado de verdad existe `/schedule` en la máquina del humano. Un cron en el servidor solo serviría para **crear** tareas repetidas, y eso son tres clics al mes.

**F-8. Revisión y aprobación como pasos explícitos.** *(ya lo tenemos)*

- `autoejecucion`, la marca `análisis listo`, la columna Hechas y la bandeja son eso mismo, con menos piezas que su `Approvals` + `ApprovalDetail` + Reviewers + Approvers.

**F-9. Checkout atómico.** *(ya lo tenemos)*

- `tomar_tarea` con `fase_tomada` es exactamente su reclamo de tarea. Nada que hacer.

**F-10. Mención a un agente en un comentario.** *(descartado)*

- La regla del hilo como chat ya hace que un comentario del humano en una tarea `doing` sea un turno para su terminal de ejecución. Una sintaxis `@agente` añadiría una forma de dirigirse a alguien en un sistema donde solo hay un destinatario posible por tarea.

---

## 3. Orden de ejecución

Siete encargos. **E1, E4, E5 y E6 son independientes** y pueden ir en paralelo. **E2 → E3 → E7** van en serie: los tres tocan el esquema o `server/src/web/rutas/tareas.ts`. E1 también toca `rutas/tareas.ts`, así que o va antes que E2 o se integra antes de lanzarlo.

Todos verifican con el mismo comando, desde `server/`: `npm test`.

### E1 · La ficha dice quién espera y cuánto queda

1. **Objetivo**: la ficha enseña «Bloquea a», el progreso de las hijas con recuento y la rama.
2. **Contexto**: CLAUDE.md › «Dependencias», «Diseño visual › Pantallas › Ficha», «Un tablero que se lee de un vistazo › La tarjeta y la fila».
3. **Archivos**: toca `server/src/web/rutas/tareas.ts` y, si hace falta exportar `progresoDe`, `server/src/web/rutas/kanban.ts`. No toca el esquema ni `src/mcp/`.
4. **Criterios de aceptación**:
   - La ficha de una tarea de la que depende otra enseña una fila «Bloquea a» con su id enlazado y su etiqueta de estado.
   - Sin dependientes, la fila dice «ninguna».
   - El bloque Hijas lleva `2/5`, una `<progress class="progreso">` y el desglose en texto suave.
   - La fila «Rama» aparece solo cuando la tarea tiene rama.
   - Ningún estilo en línea en las plantillas.
5. **Verificación**: `cd server && npm test`.

### E2 · Cuándo se tomó la fase, y soltarla

1. **Objetivo**: saber desde cuándo está en marcha cada fase y poder liberarla.
2. **Contexto**: CLAUDE.md › «Marcas sobre la tarea», «Edad en columna», «Operaciones del MCP › Tareas», «Rutas», «Variables de entorno del servidor».
3. **Archivos**: migración nueva en `server/src/db/migraciones/`, `server/src/db/tareas.ts`, `server/src/db/consultas.ts`, `server/src/mcp/tomar-tarea.ts`, `server/src/mcp/comentar-tarea.ts`, `server/src/web/rutas/tareas.ts`, `server/src/web/formatos.ts` si hace falta. No toca `src/web/rutas/terminales.ts` (es E3).
4. **Criterios de aceptación**:
   - `tomar_tarea` escribe `en_marcha_desde`; el comentario que cierra la fase lo deja a nulo.
   - Una fase en marcha desde hace más del umbral lleva la marca derivada `parada`, en naranja, en tarjeta, fila, ficha, bandeja y frontmatter.
   - `POST /tareas/:id/liberar` quita el terminal en marcha, deja un `comentario` del servidor con quién la tenía y desde cuándo, y sube la revisión.
   - La marca `en marcha` enseña su edad donde ya se enseña la edad en columna.
   - El umbral sale de una variable de entorno con 6 horas por defecto.
5. **Verificación**: `cd server && npm test`.

### E3 · «Ahora mismo» en Terminales

1. **Objetivo**: ver de un vistazo qué está trabajando cada terminal y desde cuándo.
2. **Contexto**: CLAUDE.md › «Terminales conectados», «Diseño visual › Pantallas › Terminales». Depende de E2.
3. **Archivos**: `server/src/web/rutas/terminales.ts`, `server/src/db/consultas.ts` para la consulta, `server/src/web/estilos.ts` para la franja de tarjetas.
4. **Criterios de aceptación**:
   - Una tarjeta por terminal, con proyecto, conexión, tareas en marcha (id enlazado, fase, modelo, edad) y última revisión.
   - Un terminal sin nada en marcha dice «en reposo» con la edad de su última conexión.
   - Una sola consulta para toda la franja, no una por terminal.
5. **Verificación**: `cd server && npm test`.

### E4 · Buscar desde la barra lateral

1. **Objetivo**: buscar tareas desde cualquier pantalla.
2. **Contexto**: CLAUDE.md › «Diseño visual › Esqueleto», «Un tablero que se lee de un vistazo › Filtros de un clic y búsqueda», y cómo funciona `GET /ir`.
3. **Archivos**: `server/src/web/plantilla.ts`, `server/src/web/estilos.ts`. No toca `rutas/`.
4. **Criterios de aceptación**:
   - Un `<form method="get">` en la barra lateral que lleva a la lista del proyecto recordado con `?q=`.
   - Funciona sin JavaScript.
   - Con «Todos los proyectos» puesto, busca en la vista cruzada.
5. **Verificación**: `cd server && npm test`.

### E5 · El ritmo por día

1. **Objetivo**: el ritmo se lee con pocas semanas de datos.
2. **Contexto**: CLAUDE.md › «Saber qué cuesta y qué rinde › Informes».
3. **Archivos**: `server/src/db/informes.ts`, `server/src/web/rutas/informes.ts`.
4. **Criterios de aceptación**:
   - Con periodo de 7 o 30 días, el ritmo es por día sobre los últimos 14; con 90 o «todo», por semana.
   - Una sola sentencia SQL por función; nada se agrega en la ruta.
   - Sin datos, dice «Sin datos en este periodo.».
5. **Verificación**: `cd server && npm test`.

### E6 · Las skills llegan al subagente

1. **Objetivo**: que un papel pueda pedir skills y que el subagente sepa que puede invocarlas.
2. **Contexto**: CLAUDE.md › «Agentes», y la sección 2.1 de este plan.
3. **Archivos**: `server/src/skill/SKILL.md`. Opcionalmente `server/src/db/agentes.ts`, `server/src/mcp/leer-agente.ts` y `server/src/web/rutas/agentes.ts` si se añade el campo `skills`.
4. **Criterios de aceptación**:
   - Las tres plantillas de prompt dicen al subagente que tiene la herramienta `Skill` y que invoque las skills que su papel le nombre, antes de empezar.
   - El paso 4 del bucle no cambia de forma: sigue siendo `leer_agente` y pegar el cuerpo.
   - Si se añade el campo: `leer_agente` lo devuelve en el frontmatter, la web lo edita y borrar el agente no rompe nada.
5. **Verificación**: `cd server && npm test`.

### E7 · La ficha de un agente

1. **Objetivo**: ver qué ha hecho un papel antes de asignarlo otra vez.
2. **Contexto**: CLAUDE.md › «Agentes › En la web», «Saber qué cuesta y qué rinde». Después de E2 si se quiere enseñar ahí lo que tiene en marcha.
3. **Archivos**: `server/src/web/rutas/agentes.ts`, `server/src/db/agentes.ts`.
4. **Criterios de aceptación**:
   - `GET /agentes/:id` con el papel renderizado, las fases asignadas y las últimas veinte tareas con fase, estado, consumo y devoluciones.
   - El nombre del agente en la ficha de una tarea enlaza aquí, no a la edición.
   - Un agente sin tareas dice «Todavía no ha trabajado ninguna tarea.».
5. **Verificación**: `cd server && npm test`.

---

## 4. Lo que se descarta en bloque, y por qué

| De paperclip | Por qué no |
|---|---|
| Multi-empresa | Aquí la unidad es el proyecto, y ya existe. Otra capa por encima no decide nada. |
| Organigrama y jerarquía de agentes | Un agente es un papel, no un empleado. Quién manda ya está escrito: el humano es dueño de cuatro de las cinco columnas. |
| Presupuesto mensual por agente | El presupuesto aquí es por tarea y en tokens, que es lo que se puede atribuir a un trabajo concreto. |
| Tienda de skills y `SkillStudio` | Las skills viven en la máquina donde corre el agente y ya se gestionan con las herramientas de Claude Code. |
| Plugins de terceros | Nuestro plugin es opcional y hace una sola cosa. |
| Workspaces, pipelines, cases, goals | Capas de gestión que aquí resuelven la funcionalidad, la rama y el hilo. |
| `BoardChat` / Conference Room | Un chat con el conjunto de agentes. Aquí la conversación es por tarea, que es donde se puede guardar. |
| Artefactos subidos | El humano tiene el repositorio; el commit es el artefacto. |

---

## 5. Dudas de negocio para el humano

### 5.1 ¿El presupuesto frena o solo avisa?

**Por qué importa**: hoy una tarea puede pasarse del presupuesto y seguir gastando hasta que alguien mire la bandeja. Frenarla corta el gasto, pero la deja a medias y convierte al humano en el que tiene que ir a desbloquearla, que es justo el cuello de botella que este producto intenta estrechar.

**Opciones**:

- **Solo avisa (como ahora)**: cero trabajo. El gasto de una tarea desbocada solo se detiene cuando alguien lo ve. Un fin de semana puede salir caro.
- **Frena al tomar la fase**: `tomar_tarea` falla si ya está por encima. Una fase en curso termina lo que estaba haciendo; ninguna nueva arranca. Es el corte más barato y el que menos trabajo tira a la basura. Contradice la frase «No frena a nadie» de CLAUDE.md, que habría que cambiar.
- **Frena y además avisa por `AVISOS_URL`**: lo anterior más un aviso al móvil. Un poco más de trabajo, y el humano se entera sin tener la web abierta.

**Recomendación**: **Frena al tomar la fase**, y el aviso después si el freno resulta molesto en la práctica.

### 5.2 ¿Prioridad explícita, o seguimos con el orden de la columna?

**Por qué importa**: paperclip pone una prioridad de cinco niveles en cada tarjeta. Nosotros usamos la posición en la columna. Con veinte tareas en Preparadas, arrastrar es incómodo; con un campo, hay dos verdades que se contradicen en cuanto alguien arrastra.

**Opciones**:

- **No hacer nada**: el orden sigue siendo la prioridad. Es coherente y ya funciona. Con muchas tareas, reordenar cuesta.
- **Prioridad de tres niveles sin arrastre**: se quita el arrastre para reordenar y el orden se deriva de la prioridad más la fecha. Una verdad sola, pero se pierde el gesto que hoy se usa a diario.
- **Prioridad y arrastre a la vez**: lo que hace paperclip. Dos verdades. Cuando no coinciden, nadie sabe cuál gana.

**Recomendación**: **No hacer nada** hasta que reordenar duela de verdad; y si duele, la segunda, no la tercera.

### 5.3 ¿Los informes hablan de dinero?

**Por qué importa**: «Month Spend $0.00» es la cifra que un jefe entiende. Nosotros medimos tokens, que es exacto y no caduca; el dinero exige una tabla de precios por modelo que hay que mantener y que envejece sola.

**Opciones**:

- **Seguir con tokens**: cero mantenimiento, cero riesgo de mentir. Nadie sabe cuánto es en euros sin hacer la cuenta.
- **Precios por variable de entorno**: una línea por modelo, y los informes añaden una columna de coste. Si nadie la actualiza, la web enseña un número falso con toda la confianza del mundo.
- **Precios editables desde la web**, con la fecha de la última actualización a la vista: más trabajo, pero el número lleva su fecha y se sabe si es viejo.

**Recomendación**: **Seguir con tokens** por ahora; la tercera opción el día que haya que enseñarle esto a alguien que paga.

### 5.4 ¿Una fase parada se libera sola?

**Por qué importa**: si el subagente muere, la tarea se queda en marcha para siempre. Liberarla sola la devuelve al circuito; liberarla sola **mal** puede lanzar dos subagentes sobre el mismo trabajo si el primero seguía vivo.

**Opciones**:

- **No hacer nada**: la única salida sigue siendo borrar la tarea, que se lleva el hilo por delante.
- **Marca `parada` y botón de liberar** (lo de F-1): el humano ve el problema y decide. Nada se libera solo. Es una acción manual más.
- **Liberación automática a las N horas**: se arregla solo. Riesgo de duplicar trabajo si la fase seguía viva y solo iba lenta; una ejecución larga de verdad puede pasar de seis horas.

**Recomendación**: **Marca y botón**. Si resulta que siempre se pulsa el botón, se automatiza después con el umbral ya calibrado con datos reales.

### 5.5 ¿Dónde se declaran las skills de un agente?

**Por qué importa**: es la decisión de la sección 2.1. Cambia si el papel sigue siendo una sola cosa guardada en el servidor o pasa a tener también un archivo en cada repositorio.

**Opciones**:

- **En el texto del papel** (opción (a)): cero piezas nuevas. El servidor sigue siendo la única fuente. Depende de que el subagente obedezca el prompt, como ya depende para todo lo demás.
- **Campo `skills` en el agente**: lo mismo, pero se ve en la web y en el frontmatter de `leer_agente`. Una columna, un campo de formulario y una línea de frontmatter más.
- **Agentes personalizados en `.claude/agents/`** (opción (b)): garantizado, pero el papel vive en dos sitios y hay que sincronizarlos; contradice «Se define una vez en el servidor».
- **No hacer nada**: los subagentes siguen sin skills salvo que se acuerden de invocarlas por su cuenta. Heredan el `CLAUDE.md`, así que las reglas del proyecto sí les llegan; lo que se pierde es lo que aporta una skill concreta.

**Recomendación**: **En el texto del papel**, y el campo propio solo cuando haya tres o cuatro papeles usándolo y se quiera verlo en la lista.
