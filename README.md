# MCP Tareas

Un tablero para trabajar con agentes de Claude Code sin ir pidiéndoles las cosas por el terminal.
El humano define las tareas en una web, las asigna a un terminal y a un modelo, y contesta desde ahí
las preguntas que le hagan; los agentes las toman solos, las trabajan y devuelven lo que han hecho.

## De qué se compone

| Pieza | Qué es | Dónde |
|---|---|---|
| **Servidor** | Un proceso Node en Docker: guarda las tareas y su hilo, expone las herramientas MCP a los agentes y sirve la web. SQLite en un volumen. | [`server/`](server/) |
| **Plugin** | El plugin de Claude Code que conecta un terminal al servidor, arranca el bucle del agente y reporta el uso de la cuenta. | [`plugin/`](plugin/) ([README](plugin/README.md)) |
| **Catálogo** | Lo que permite instalar ese plugin desde este mismo repositorio. | [`.claude-plugin/`](.claude-plugin/) |

**Una tarea** pasa por cinco columnas: `backlog` (la escribe el humano), `prepared` (un agente la analiza),
`doing` (otro la ejecuta), `done` (el humano revisa) y `finished`. Cada una lleva un hilo de comentarios
donde queda el análisis, las preguntas con sus opciones, las respuestas del humano y el resultado con su
commit, y cuenta los tokens que ha costado. Una **funcionalidad** es una tarea que se descompone en partes;
una **pregunta** es una tarea cuya respuesta es la respuesta misma, sin código.

## Levantarlo

```sh
cd server
printf 'BASE_URL=http://localhost:9917\nSESSION_SECRET=%s\nADMIN_PASSWORD=cambiala\n' "$(openssl rand -hex 32)" > .env
docker compose up --build
```

La web queda en el puerto de `PORT` (9917 en local). Entra, crea un terminal en **Terminales** y sigue el
tutorial de conexión que sale con su token: trae los comandos ya montados para esa máquina.

## Dónde está el detalle

[`CLAUDE.md`](CLAUDE.md) es la definición completa: el modelo de tareas, las reglas, las operaciones del MCP,
la web y el stack, y cómo se construye este repositorio. Manda sobre este archivo; esto es solo el resumen.
