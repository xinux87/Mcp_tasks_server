-- Agentes: un papel escrito en Markdown que se asigna a la fase de una tarea.
--
-- Quién es, cómo trabaja y con qué modelo. Se define una vez y se asigna por
-- fase; cuando el bucle lanza esa fase, el texto del agente es el contexto del
-- subagente. Así un terminal tiene N agentes distintos apuntando a él.
--
-- Las dos columnas de `tareas` entran con `ADD COLUMN`, como las de la
-- migración 008: SQLite solo prohíbe añadir una columna con `REFERENCES`
-- cuando las claves foráneas están encendidas, y el runner las apaga mientras
-- migra. Son anulables, así que las tareas de antes se quedan sin papel y
-- siguen funcionando con su modelo y su terminal.
--
-- `actividad` sí se reconstruye, porque su `objeto` lleva un `CHECK` y SQLite
-- no sabe cambiarlo: tabla nueva, copia, `DROP`, `RENAME` e índice, el mismo
-- procedimiento de la migración 008.

CREATE TABLE agentes (
  id INTEGER PRIMARY KEY,
  -- Minúsculas, cifras y guiones, de dos a treinta, empieza por letra. La
  -- forma la comprueba el código, que es quien da el error con su regla.
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT NOT NULL DEFAULT '',
  -- El Markdown del papel, tal como se le habla al subagente.
  instrucciones TEXT NOT NULL,
  modelo TEXT NOT NULL,
  -- Sin terminal, el agente corre en cualquiera. Borrar el terminal lo deja a nulo.
  terminal_id INTEGER REFERENCES terminales(id),
  creado TEXT NOT NULL,
  actualizado TEXT NOT NULL
) STRICT;

-- Borrar el agente las pone a nulo: la tarea conserva el modelo y el terminal
-- que le copió al asignarlo y sigue funcionando sin papel.
ALTER TABLE tareas ADD COLUMN analisis_agente_id INTEGER REFERENCES agentes(id);
ALTER TABLE tareas ADD COLUMN ejecucion_agente_id INTEGER REFERENCES agentes(id);

-- El rastro de las acciones humanas admite ahora un objeto más: el agente.
CREATE TABLE actividad_nueva (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  usuario_nombre TEXT NOT NULL,
  accion TEXT NOT NULL,
  objeto TEXT NOT NULL CHECK (objeto IN ('tarea', 'usuario', 'terminal', 'proyecto', 'agente')),
  objeto_id INTEGER NOT NULL,
  objeto_nombre TEXT NOT NULL,
  detalle TEXT NOT NULL,
  creado TEXT NOT NULL
) STRICT;

INSERT INTO actividad_nueva (id, usuario_id, usuario_nombre, accion, objeto, objeto_id, objeto_nombre, detalle, creado)
SELECT id, usuario_id, usuario_nombre, accion, objeto, objeto_id, objeto_nombre, detalle, creado FROM actividad;

DROP TABLE actividad;
ALTER TABLE actividad_nueva RENAME TO actividad;

-- El índice se va con la tabla vieja: se vuelve a crear tal cual estaba.
CREATE INDEX actividad_por_objeto ON actividad (objeto, objeto_id, id);
