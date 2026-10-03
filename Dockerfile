# syntax=docker/dockerfile:1

# ---- build ---------------------------------------------------------------
FROM node:24-alpine AS build
ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# Fetch dependencies from the lockfile alone so this layer is cached
# until dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline \
 && pnpm --filter @builder/web build \
 && pnpm --filter @builder/db deploy --prod /out/db

# ---- runtime -------------------------------------------------------------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    PACKAGES_DIR=/packages
WORKDIR /app

# Next.js standalone server: only the files the server actually needs.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./web
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./web/apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./web/apps/web/public
# Migration runner with its production dependencies.
COPY --from=build --chown=node:node /out/db ./db
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/entrypoint

# Unprivileged "node" user of the base image.
USER 1000:1000
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint"]
