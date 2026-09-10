-- Borrar un terminal del todo, no solo revocarlo.
--
-- Lo único que lo impedía era `consumo.terminal_id NOT NULL`: las cuatro
-- referencias de `tareas` ya son anulables y pasan a nulo al borrar, pero el
-- consumo no se puede tirar (son tokens gastados de verdad, sumados en la
-- ficha de la tarea) ni dejar apuntando a una fila que ya no existe.
--
-- SQLite no sabe quitar un `NOT NULL`: hay que reconstruir la tabla. Nadie
-- apunta a `consumo`, así que basta con el procedimiento de siempre: tabla
-- nueva, copia conservando los ids, `DROP`, `RENAME` e índices. Las claves
-- foráneas las apaga el runner mientras corre y comprueba
-- `PRAGMA foreign_key_check` al terminar.

CREATE TABLE consumo_nueva (
  id INTEGER PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id),
  fase TEXT NOT NULL CHECK (fase IN ('analisis', 'ejecucion')),
  modelo TEXT NOT NULL,
  -- Anulable: queda a nulo al borrar el terminal. Solo se escribe al reportar
  -- consumo; nadie la lee.
  terminal_id INTEGER REFERENCES terminales(id),
  tokens INTEGER NOT NULL,
  herramientas INTEGER NOT NULL,
  duracion_ms INTEGER NOT NULL,
  creado TEXT NOT NULL
) STRICT;

INSERT INTO consumo_nueva (id, tarea_id, fase, modelo, terminal_id, tokens, herramientas, duracion_ms, creado)
SELECT id, tarea_id, fase, modelo, terminal_id, tokens, herramientas, duracion_ms, creado FROM consumo;

DROP TABLE consumo;
ALTER TABLE consumo_nueva RENAME TO consumo;

-- El índice se va con la tabla vieja: se vuelve a crear tal cual estaba.
CREATE INDEX consumo_por_tarea ON consumo (tarea_id, fase);
