FROM node:24.14.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY scripts/production-operator.mjs ./scripts/production-operator.mjs
USER node
ENV NODE_ENV=production ROBIN_STATE_DIRECTORY=/state
ENTRYPOINT ["node", "scripts/production-operator.mjs", "/config/config.json"]
CMD ["--check"]
