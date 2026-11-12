-- Por qué cuelga una tarea de su padre.
--
-- `parte` es un trozo del plan de la madre: lo crea su análisis al
-- descomponerla, o el humano desde la ficha o el formulario. `hija` es una hija
-- de trabajo que un ejecutor cuelga sobre la marcha. Nulo, una tarea sin padre.
-- Hasta ahora solo una funcionalidad tenía partes y se sabía por su tipo; desde
-- que cualquier tarea se descompone hace falta decirlo en la fila.
--
-- Las hijas de una funcionalidad son todas partes: una funcionalidad nunca ha
-- admitido hijas de trabajo. El resto de tareas con padre son hijas de trabajo.

ALTER TABLE tareas ADD COLUMN clase TEXT CHECK (clase IS NULL OR clase IN ('parte', 'hija'));

UPDATE tareas SET clase = 'parte'
	WHERE padre_id IN (SELECT id FROM tareas WHERE tipo = 'funcionalidad');

UPDATE tareas SET clase = 'hija'
	WHERE padre_id IS NOT NULL AND clase IS NULL;
