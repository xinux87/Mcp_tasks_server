-- Proyectos: un repositorio que se trabaja desde una o varias carpetas
-- locales, cada una con su terminal.
--
-- Las tareas viven en un proyecto y los terminales trabajan para un proyecto.
-- Todo lo que ya existe cuelga del proyecto 1, `PRI` «Principal»: para quien
-- tiene un solo repositorio nada cambia.
--
-- Las dos columnas nuevas entran con `ADD COLUMN`, no reconstruyendo las
-- tablas: SQLite solo prohíbe añadir una columna con `REFERENCES` cuando las
-- claves foráneas están encendidas, y el runner las apaga mientras migra. El
-- `DEFAULT 1` es lo que permite además que sea `NOT NULL` con filas ya
-- escritas, y es el valor con el que se quedan todas.
--
-- `actividad` sí se reconstruye, porque su `objeto` lleva un `CHECK` y SQLite
-- no sabe cambiarlo: tabla nueva, copia, `DROP`, `RENAME` e índices, el mismo
-- procedimiento de las migraciones 005 y 006.

CREATE TABLE proyectos (
  id INTEGER PRIMARY KEY,
  -- De dos a seis caracteres, mayúsculas y cifras, empieza por letra. La forma
  -- la comprueba el código, que es quien da el error con su código de regla.
  clave TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  -- URL del remote de git. Si está, se comprueba al registrar un terminal.
  repositorio TEXT,
  rama_principal TEXT NOT NULL DEFAULT 'main',
  -- El comando que tiene que pasar la parte que integra la rama. Opcional.
  verificacion TEXT,
  creado TEXT NOT NULL
) STRICT;

-- El proyecto donde cae todo lo que no dice otra cosa. No se borra nunca.
INSERT INTO proyectos (id, clave, nombre, creado)
VALUES (1, 'PRI', 'Principal', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

ALTER TABLE tareas ADD COLUMN proyecto_id INTEGER NOT NULL REFERENCES proyectos(id) DEFAULT 1;
ALTER TABLE terminales ADD COLUMN proyecto_id INTEGER NOT NULL REFERENCES proyectos(id) DEFAULT 1;

-- La carpeta local en la que trabaja el terminal, tal como la reporta al
-- registrarse. Es informativa: se enseña en la lista de terminales.
ALTER TABLE terminales ADD COLUMN ruta TEXT;

-- El tablero se lee siempre dentro de un proyecto: el índice lo encabeza.
DROP INDEX tareas_por_columna;
CREATE INDEX tareas_por_columna ON tareas (proyecto_id, estado, orden);

-- El rastro de las acciones humanas admite ahora un objeto más: el proyecto.
CREATE TABLE actividad_nueva (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  usuario_nombre TEXT NOT NULL,
  accion TEXT NOT NULL,
  objeto TEXT NOT NULL CHECK (objeto IN ('tarea', 'usuario', 'terminal', 'proyecto')),
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
