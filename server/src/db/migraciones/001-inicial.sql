-- Revisión global del servidor: sube con cada escritura que cambie estado
-- visible. Una única fila, garantizada por el CHECK.
CREATE TABLE revision (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  valor INTEGER NOT NULL
) STRICT;
INSERT INTO revision (id, valor) VALUES (1, 0);

CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  hash_password TEXT NOT NULL,
  creado TEXT NOT NULL
) STRICT;

CREATE TABLE terminales (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  nombre TEXT NOT NULL,
  cuenta TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  conectado_en TEXT,
  ultima_revision INTEGER,
  uso_json TEXT,
  creado TEXT NOT NULL,
  revocado_en TEXT
) STRICT;
