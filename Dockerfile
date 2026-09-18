# Debian-based (not Alpine): Playwright's bundled Chromium (src/lib/reports/pdf.ts) needs glibc and
# a set of shared libraries that `playwright install --with-deps` knows how to install on Debian/
# Ubuntu, not on musl-based Alpine.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `prisma generate` only reads prisma/schema.prisma — it never actually connects — but
# prisma.config.ts's env("DIRECT_DATABASE_URL") validates the var is set just to load the config.
# Any well-formed value works at build time; the real one is supplied at runtime via the platform's
# env vars.
ENV DIRECT_DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate
RUN npm run build

# Runtime: next.config.ts's `output: "standalone"` means .next/standalone already carries the
# minimal node_modules subset the built app actually needs — no `npm ci` here.
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# System libraries Chromium needs to actually launch (fonts for report rendering too, since
# generateReport's PDF is a real page render, not just plain text).
RUN npx --yes playwright@1.63.0 install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 3000
# Migrations run as the platform's release/pre-deploy command (`npm run db:migrate:deploy`), not
# here — that needs DIRECT_DATABASE_URL's elevated role and should run once per deploy, not once per
# container replica.
CMD ["node", "server.js"]
