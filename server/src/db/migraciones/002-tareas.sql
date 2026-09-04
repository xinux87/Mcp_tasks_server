-- Tareas, su hilo de comentarios, sus preguntas y su consumo de tokens.
--
-- Las marcas de la tarea (`bloqueada`, `sin terminal`, `en marcha`,
-- `análisis listo`) NO se guardan: se derivan al leer con `marcasDe`.
--
-- La columna `revision` de `tareas` y `preguntas` guarda la revisión global
-- con la que se escribió la fila. Es lo que permite a `novedades` devolver
-- solo lo que cambió desde la última revisión que conoce el terminal.
CREATE TABLE tareas (
  id INTEGER PRIMARY KEY,
  titulo TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('backlog', 'prepared', 'doing', 'done', 'finished')),
  orden INTEGER NOT NULL,
  padre_id INTEGER REFERENCES tareas(id),
  autoejecucion INTEGER NOT NULL DEFAULT 1 CHECK (autoejecucion IN (0, 1)),
  ejecucion_aprobada INTEGER NOT NULL DEFAULT 0 CHECK (ejecucion_aprobada IN (0, 1)),
  analisis_hecho INTEGER NOT NULL DEFAULT 0 CHECK (analisis_hecho IN (0, 1)),
  analisis_modelo TEXT,
  analisis_terminal_id INTEGER REFERENCES terminales(id),
  ejecucion_modelo TEXT,
  ejecucion_terminal_id INTEGER REFERENCES terminales(id),
  en_marcha_terminal_id INTEGER REFERENCES terminales(id),
  creada_por_usuario_id INTEGER REFERENCES usuarios(id),
  creada_por_terminal_id INTEGER REFERENCES terminales(id),
  creada TEXT NOT NULL,
  actualizada TEXT NOT NULL,
  revision INTEGER NOT NULL
) STRICT;

-- El kanban se lee siempre por columna y orden; `novedades` filtra por revisión.
CREATE INDEX tareas_por_columna ON tareas (estado, orden);
CREATE INDEX tareas_por_revision ON tareas (revision);
CREATE INDEX tareas_por_padre ON tareas (padre_id);

CREATE TABLE preguntas (
  id INTEGER PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id),
  numero INTEGER NOT NULL,
  pregunta TEXT NOT NULL,
  por_que_importa TEXT NOT NULL,
  opciones_json TEXT NOT NULL,
  recomendacion TEXT NOT NULL,
  respuesta_opcion TEXT,
  respuesta_nota TEXT,
  respondida_por_usuario_id INTEGER REFERENCES usuarios(id),
  respondida_en TEXT,
  creada TEXT NOT NULL,
  revision INTEGER NOT NULL,
  UNIQUE (tarea_id, numero)
) STRICT;

-- Contar preguntas abiertas es lo que decide la marca `bloqueada`.
CREATE INDEX preguntas_por_tarea ON preguntas (tarea_id, respuesta_opcion);
CREATE INDEX preguntas_por_revision ON preguntas (revision);

CREATE TABLE comentarios (
  id INTEGER PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('analisis', 'pregunta', 'respuesta', 'avance', 'resultado', 'nota')),
  autor TEXT NOT NULL,
  texto TEXT NOT NULL,
  pregunta_id INTEGER REFERENCES preguntas(id),
  creado TEXT NOT NULL,
  revision INTEGER NOT NULL
) STRICT;

CREATE INDEX comentarios_por_tarea ON comentarios (tarea_id, id);

CREATE TABLE consumo (
  id INTEGER PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id),
  fase TEXT NOT NULL CHECK (fase IN ('analisis', 'ejecucion')),
  modelo TEXT NOT NULL,
  terminal_id INTEGER NOT NULL REFERENCES terminales(id),
  tokens INTEGER NOT NULL,
  herramientas INTEGER NOT NULL,
  duracion_ms INTEGER NOT NULL,
  creado TEXT NOT NULL
) STRICT;

CREATE INDEX consumo_por_tarea ON consumo (tarea_id, fase);
