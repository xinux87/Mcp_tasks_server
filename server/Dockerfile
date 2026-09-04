# --- build: compila TypeScript a dist/ -------------------------------------
FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

# tsc solo emite .js: los .sql de las migraciones se copian a mano para que
# `import.meta.dirname` los encuentre también desde dist/.
RUN npm run build \
	&& mkdir -p dist/db/migraciones \
	&& cp src/db/migraciones/*.sql dist/db/migraciones/

# --- runtime: solo dependencias de producción ------------------------------
FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
	PORT=3000 \
	DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# El volumen se inicializa con la propiedad que tenga el directorio en la
# imagen, así que el usuario sin privilegios puede escribir la base de datos.
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:3000/salud').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
