FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY packages/capability-registry/package.json ./packages/capability-registry/
COPY packages/experience-compiler/package.json ./packages/experience-compiler/
COPY packages/experience-schema/package.json ./packages/experience-schema/
COPY packages/live-patch/package.json ./packages/live-patch/
COPY packages/telemetry-contract/package.json ./packages/telemetry-contract/
COPY packages/viewer-integration/package.json ./packages/viewer-integration/
RUN npm ci
COPY tsconfig*.json ./
COPY apps ./apps
COPY packages ./packages
COPY migrations ./migrations
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/worker/package.json ./apps/worker/
COPY --from=build /app/packages ./packages
RUN npm ci --omit=dev
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
