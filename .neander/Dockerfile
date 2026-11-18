FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.18.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Bound Next.js page-data workers on builders reporting many host CPUs.
RUN CIRCLE_NODE_TOTAL=2 pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY .neander/entrypoint.sh /entrypoint.sh
USER node
EXPOSE 8080
ENTRYPOINT ["sh", "/entrypoint.sh"]
CMD ["node", "server.js"]
