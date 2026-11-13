-- El código visible deja de ir al azar y pasa a ser incremental por prefijo:
-- `FE` y cinco cifras hexadecimales para una funcionalidad, `US` para una
-- tarea o una pregunta (`FE00001`, `US0002A`). `tareas.codigo` guarda el
-- código completo.
--
-- Cada prefijo tiene su contador en `contadores`, que sube en la transacción
-- del alta: un número nunca se reparte dos veces ni se reutiliza al borrar.
--
-- Las tareas existentes se renumeran por orden de alta (su `id`) dentro de su
-- prefijo; los códigos de antes no se conservan. No hay choque con el índice
-- único durante el `UPDATE`: los de antes eran cuatro cifras o seis caracteres
-- y los nuevos son siete, empezando por letra.

CREATE TABLE contadores (
	prefijo TEXT PRIMARY KEY,
	ultimo INTEGER NOT NULL
) STRICT;

WITH numeradas AS (
	SELECT
		id,
		CASE WHEN tipo = 'funcionalidad' THEN 'FE' ELSE 'US' END AS prefijo,
		ROW_NUMBER() OVER (PARTITION BY tipo = 'funcionalidad' ORDER BY id) AS numero
	FROM tareas
)
UPDATE tareas SET codigo = numeradas.prefijo || printf('%05X', numeradas.numero)
	FROM numeradas
	WHERE numeradas.id = tareas.id;

INSERT INTO contadores (prefijo, ultimo)
	SELECT 'FE', COUNT(*) FROM tareas WHERE tipo = 'funcionalidad'
	UNION ALL
	SELECT 'US', COUNT(*) FROM tareas WHERE tipo <> 'funcionalidad';
