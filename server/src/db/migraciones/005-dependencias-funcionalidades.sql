-- Dependencias entre tareas y funcionalidades como evolutivos.
--
-- Tres cambios sobre `tareas`: la columna `rama` (la rama de git en la que se
-- trabaja, que una funcionalidad fija y sus partes heredan), un `tipo` nuevo,
-- `funcionalidad`, e ids que no se reutilizan. Lo primero es un `ADD COLUMN`;
-- lo demás no, porque SQLite no sabe cambiar ni un CHECK ni la clave primaria:
-- hay que reconstruir la tabla entera.
--
-- La reconstrucción es la de la documentación de SQLite: tabla nueva con otro
-- nombre, copia de las filas conservando los ids, `DROP` de la vieja y
-- `RENAME` de la nueva. Las referencias de `preguntas`, `comentarios` y
-- `consumo` siguen nombrando a `tareas` y vuelven a encontrarla al renombrar,
-- porque ninguna nombra a `tareas_nueva`.
--
-- El runner abre una transacción alrededor de este archivo y apaga las claves
-- foráneas mientras corre, que es lo que pide ese procedimiento: entre el DROP
-- y el RENAME las hijas apuntan a una tabla que no existe. Al terminar, el
-- propio runner comprueba con `PRAGMA foreign_key_check` que no quedó ninguna
-- referencia rota. Aplazarlas con `defer_foreign_keys` no vale: el DROP borra
-- implícitamente las filas de `tareas` y esa infracción se cuenta igual.

ALTER TABLE tareas ADD COLUMN rama TEXT;

CREATE TABLE tareas_nueva (
  -- AUTOINCREMENT: un id nunca se reutiliza. Sin él, borrar la última tarea de
  -- backlog libera su número y la siguiente lo hereda, y un id ya citado en un
  -- hilo, en la actividad o en un commit cambiaría de dueño en silencio.
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'tarea' CHECK (tipo IN ('tarea', 'pregunta', 'funcionalidad')),
  rama TEXT,
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

INSERT INTO tareas_nueva (
  id, titulo, descripcion, tipo, rama, estado, orden, padre_id, autoejecucion, ejecucion_aprobada,
  analisis_hecho, analisis_modelo, analisis_terminal_id, ejecucion_modelo, ejecucion_terminal_id,
  en_marcha_terminal_id, creada_por_usuario_id, creada_por_terminal_id, creada, actualizada, revision
)
SELECT
  id, titulo, descripcion, tipo, rama, estado, orden, padre_id, autoejecucion, ejecucion_aprobada,
  analisis_hecho, analisis_modelo, analisis_terminal_id, ejecucion_modelo, ejecucion_terminal_id,
  en_marcha_terminal_id, creada_por_usuario_id, creada_por_terminal_id, creada, actualizada, revision
FROM tareas;

DROP TABLE tareas;
ALTER TABLE tareas_nueva RENAME TO tareas;

-- Los índices se van con la tabla vieja: se vuelven a crear tal cual estaban.
CREATE INDEX tareas_por_columna ON tareas (estado, orden);
CREATE INDEX tareas_por_revision ON tareas (revision);
CREATE INDEX tareas_por_padre ON tareas (padre_id);

-- Qué tareas tienen que estar `done` o `finished` antes de que otra se pueda
-- tomar. Sirve para ordenar las partes de una funcionalidad y para cualquier
-- tarea suelta. La clave primaria impide repetir la misma pareja.
CREATE TABLE dependencias (
  tarea_id INTEGER NOT NULL REFERENCES tareas(id),
  depende_de_id INTEGER NOT NULL REFERENCES tareas(id),
  PRIMARY KEY (tarea_id, depende_de_id)
) STRICT;

-- La clave primaria ya sirve para «de qué depende esta tarea»; este índice es
-- para la pregunta contraria: a quién libera una tarea al cerrarse.
CREATE INDEX dependencias_por_dependida ON dependencias (depende_de_id);
