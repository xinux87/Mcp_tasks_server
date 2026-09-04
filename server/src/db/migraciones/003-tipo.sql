-- Tipo de la tarea. Una `pregunta` es un encargo cuya salida es una respuesta
-- escrita, no código: solo tiene fase de análisis y el comentario `analisis`
-- la cierra en `done`.
--
-- `ADD COLUMN` no reescribe la tabla: las filas que ya existen leen el valor
-- por defecto, que es `tarea`, así que el CHECK las acepta todas.
ALTER TABLE tareas ADD COLUMN tipo TEXT NOT NULL DEFAULT 'tarea' CHECK (tipo IN ('tarea', 'pregunta'));
