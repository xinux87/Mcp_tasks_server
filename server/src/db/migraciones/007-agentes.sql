-- Cuántos subagentes lanza a la vez el bucle de un terminal.
--
-- Depende de la máquina y de la cuenta, así que lo fija el humano por terminal.
-- Los que ya existen quedan a 1, que es el comportamiento de siempre: una
-- tarea por vuelta.

ALTER TABLE terminales ADD COLUMN agentes INTEGER NOT NULL DEFAULT 1 CHECK (agentes >= 1);
