-- Presupuesto de tokens: el tope que el humano le pone a una tarea o a una
-- funcionalidad, en tokens.
--
-- Nulo es lo que tenían todas hasta ahora: sin tope y sin marca. Superarlo no
-- frena a nadie, solo pone la marca derivada `sobre presupuesto`; por eso la
-- columna no lleva más regla que la de no admitir un tope negativo.

ALTER TABLE tareas ADD COLUMN presupuesto INTEGER CHECK (presupuesto IS NULL OR presupuesto >= 0);
