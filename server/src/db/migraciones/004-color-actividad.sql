-- Color de usuario y rastro de las acciones humanas.
--
-- El color es de la web: el Markdown del MCP no lo lleva. Son los ocho colores
-- de etiqueta que no son gris; el gris queda para quien no tiene color, es
-- decir agentes y usuarios borrados.
--
-- El DEFAULT existe solo porque SQLite exige uno para añadir una columna
-- NOT NULL a una tabla que ya tiene filas. El código escribe siempre el color,
-- así que nadie se queda con el del DEFAULT.
ALTER TABLE usuarios ADD COLUMN color TEXT NOT NULL DEFAULT 'azul'
  CHECK (color IN ('azul', 'verde', 'morado', 'naranja', 'rosa', 'amarillo', 'rojo', 'marron'));

-- Los usuarios que ya existían se reparten los ocho colores por su id, para
-- que dos usuarios seguidos no salgan del mismo color.
UPDATE usuarios SET color = CASE (id - 1) % 8
  WHEN 0 THEN 'azul'
  WHEN 1 THEN 'verde'
  WHEN 2 THEN 'morado'
  WHEN 3 THEN 'naranja'
  WHEN 4 THEN 'rosa'
  WHEN 5 THEN 'amarillo'
  WHEN 6 THEN 'rojo'
  ELSE 'marron'
END;

-- Toda acción humana desde la web deja rastro de quién la hizo. El hilo ya lo
-- hace con las respuestas y las notas; esto cubre todo lo demás.
--
-- `usuario_nombre` se guarda como texto para que sobreviva al borrado del
-- usuario, igual que el autor del hilo: al borrar, `usuario_id` queda a nulo.
-- `objeto_nombre` es el título de la tarea o el nombre del usuario o terminal
-- en ese momento, para que la lista global se lea sin buscar nada más.
CREATE TABLE actividad (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  usuario_nombre TEXT NOT NULL,
  accion TEXT NOT NULL,
  objeto TEXT NOT NULL CHECK (objeto IN ('tarea', 'usuario', 'terminal')),
  objeto_id INTEGER NOT NULL,
  objeto_nombre TEXT NOT NULL,
  detalle TEXT NOT NULL,
  creado TEXT NOT NULL
) STRICT;

-- La ficha, la página de usuarios y la de terminales leen el rastro de un solo
-- objeto; la lista global lee las últimas por id.
CREATE INDEX actividad_por_objeto ON actividad (objeto, objeto_id, id);
