-- `nota` del humano y `avance` del agente se funden en `comentario`.
--
-- El hilo es un chat: el mensaje libre es uno solo, lo escriba quien lo
-- escriba. `comentarios.tipo` lleva `CHECK`, así que hay que reconstruir la
-- tabla; las claves foráneas las apaga el runner mientras corre y comprueba
-- `PRAGMA foreign_key_check` al terminar.

CREATE TABLE comentarios_nueva (
  id INTEGER PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('analisis', 'pregunta', 'respuesta', 'resultado', 'comentario')),
  autor TEXT NOT NULL,
  texto TEXT NOT NULL,
  pregunta_id INTEGER REFERENCES preguntas(id),
  creado TEXT NOT NULL,
  revision INTEGER NOT NULL
) STRICT;

INSERT INTO comentarios_nueva (id, tarea_id, tipo, autor, texto, pregunta_id, creado, revision)
SELECT id, tarea_id,
  CASE WHEN tipo IN ('nota', 'avance') THEN 'comentario' ELSE tipo END,
  autor, texto, pregunta_id, creado, revision
FROM comentarios;

DROP TABLE comentarios;
ALTER TABLE comentarios_nueva RENAME TO comentarios;

-- El índice se va con la tabla vieja: se vuelve a crear tal cual estaba.
CREATE INDEX comentarios_por_tarea ON comentarios (tarea_id, id);

-- `actividad.accion` no tiene `CHECK`: basta con renombrar la acción.
UPDATE actividad SET accion = 'comentario' WHERE accion = 'nota';
