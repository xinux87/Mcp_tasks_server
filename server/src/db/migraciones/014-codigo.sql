-- El identificador visible de una tarea deja de ser su número de fila y pasa a
-- ser un código aleatorio: `T-K7M3XQ`. Un número que sube cuenta las tareas y
-- ordena lo que no debe ordenarse.
--
-- Las tareas que ya existían conservan su número como código, con los mismos
-- cuatro dígitos de siempre: un id ya citado en un hilo, en la actividad o en
-- un commit sigue valiendo. Por dentro la fila sigue teniendo su número, que es
-- lo que enlazan las demás tablas.
--
-- El `DEFAULT ''` es lo que permite añadir la columna sin más; el `UPDATE` la
-- rellena en la misma migración y el índice único garantiza que nadie la deje
-- vacía ni repetida.

ALTER TABLE tareas ADD COLUMN codigo TEXT NOT NULL DEFAULT '';

UPDATE tareas SET codigo = printf('%04d', id);

CREATE UNIQUE INDEX tareas_por_codigo ON tareas (codigo);
