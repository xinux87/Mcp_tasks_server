-- Cuándo se tomó la fase que un terminal tiene en marcha.
--
-- Sin esta columna, un subagente que muere a medias deja la tarea «en marcha»
-- para siempre y no hay forma de saber que lleva ahí demasiado. La escribe
-- `tomar_tarea` junto a `en_marcha_terminal_id`, y se pone a nulo donde ese
-- campo se pone a nulo: el comentario que cierra la fase, el borrado del
-- terminal y la liberación desde la ficha.
--
-- Es un `ADD COLUMN` y nada más. Las tareas que ya estaban en marcha se quedan
-- con nulo: no se inventa una fecha que nadie apuntó, así que no reciben la
-- marca `parada` hasta que alguien vuelva a tomarlas.

ALTER TABLE tareas ADD COLUMN en_marcha_desde TEXT;
