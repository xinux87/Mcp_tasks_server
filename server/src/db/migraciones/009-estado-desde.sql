-- Edad en columna: cuándo entró cada tarea en el estado en el que está.
--
-- Para las tareas que ya existían no hay dato mejor que `actualizada`: es una
-- aproximación, y solo para ellas. De ahí en adelante lo escribe el servidor en
-- cada cambio de estado.
--
-- La columna entra con `ADD COLUMN` y un `DEFAULT ''`, que es lo que permite
-- que sea `NOT NULL` con filas ya escritas, y después un `UPDATE` la rellena.
-- El default se queda: SQLite no sabe quitarlo sin reconstruir la tabla, y
-- reconstruir `tareas` arrastra las seis que la referencian (comentarios,
-- preguntas, consumo, dependencias en los dos sentidos y sus propias hijas)
-- para ganar nada: ninguna inserción la deja al default, todas pasan por
-- `insertarTarea`, que siempre la escribe.

ALTER TABLE tareas ADD COLUMN estado_desde TEXT NOT NULL DEFAULT '';

UPDATE tareas SET estado_desde = actualizada;
