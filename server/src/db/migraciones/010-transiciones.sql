-- Transiciones de estado: cuándo pasó cada tarea de una columna a otra.
--
-- `estado_desde` dice cuándo entró la tarea en la columna en la que está, y
-- nada más. Para medir el tiempo de ciclo y las devoluciones hace falta el
-- historial entero, que hasta ahora se perdía en cada movimiento.
--
-- Empieza vacía: el pasado no está escrito en ninguna parte y no se inventa.
-- Los informes dicen desde qué fecha tienen datos, que es la transición más
-- antigua de esta tabla.
--
-- La escribe `cambiarEstado`, el único sitio que cambia `estado`, y la
-- creación de la tarea con `de` a nulo. Nada más.
CREATE TABLE transiciones (
  id INTEGER PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id),
  de TEXT,
  a TEXT NOT NULL,
  creado TEXT NOT NULL
) STRICT;

-- El historial de una tarea se lee entero y en orden; los informes agrupan por
-- estado de destino dentro de un periodo.
CREATE INDEX transiciones_por_tarea ON transiciones (tarea_id, id);
CREATE INDEX transiciones_por_fecha ON transiciones (a, creado);
