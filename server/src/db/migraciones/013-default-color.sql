-- El proyecto por defecto se llama `DEFAULT` «Default», y cada proyecto lleva
-- el color de sus siglas.
--
-- `PRI` «Principal» era el nombre del proyecto 1 desde la migración 008. Se
-- renombra aquí en vez de cambiar la 008 para que una base ya en marcha no
-- tenga que reconstruirse: la 008 sigue escribiendo `PRI` y esta lo renombra,
-- así que una base nueva pasa por las dos y acaba igual que una vieja. La
-- condición `clave = 'PRI'` es lo que respeta al que ya le hubiera puesto otra.
UPDATE proyectos SET clave = 'DEFAULT', nombre = 'Default' WHERE id = 1 AND clave = 'PRI';

-- El color de las siglas del proyecto, de los ocho de etiqueta que no son
-- gris, como el de los usuarios. El DEFAULT existe solo porque SQLite exige
-- uno para añadir una columna NOT NULL a una tabla que ya tiene filas: el
-- código escribe siempre el color.
ALTER TABLE proyectos ADD COLUMN color TEXT NOT NULL DEFAULT 'azul'
  CHECK (color IN ('azul', 'verde', 'morado', 'naranja', 'rosa', 'amarillo', 'rojo', 'marron'));

-- Los proyectos que ya existían se reparten los ocho colores por su id, como
-- hizo la migración 004 con los usuarios.
UPDATE proyectos SET color = CASE (id - 1) % 8
  WHEN 0 THEN 'azul'
  WHEN 1 THEN 'verde'
  WHEN 2 THEN 'morado'
  WHEN 3 THEN 'naranja'
  WHEN 4 THEN 'rosa'
  WHEN 5 THEN 'amarillo'
  WHEN 6 THEN 'rojo'
  ELSE 'marron'
END;
