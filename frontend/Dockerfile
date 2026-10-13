# syntax=docker/dockerfile:1

# JibonJori frontend image (R-025): build the SPA, then serve it as static files
# with the strict CSP from `nginx.conf`. There is no API container any more - the
# browser calls Supabase directly - so this image is a pure static server.
#
# The two required Supabase values are *public* build-time configuration, not
# secrets: the anon key is designed to ship in client bundles and is constrained
# by row level security. Vite inlines `VITE_*` values into the bundle, so they
# must be present when `npm run build` runs and cannot be injected at container
# start. Pass them as build args:
#
#   docker build \
#     --build-arg VITE_SUPABASE_URL=https://<ref>.supabase.co \
#     --build-arg VITE_SUPABASE_ANON_KEY=<anon-key> \
#     -t jibonjori-web .
#
# The `service_role` key must NEVER be passed here. It is not needed by the
# client and would be inlined into a bundle any visitor can read.

FROM node:22-bookworm-slim AS build

WORKDIR /app

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_GOOGLE_MAPS_API_KEY
ARG VITE_YOUTUBE_VIDEO_IDS

# Dependency layer first so a source-only change does not reinstall packages.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY vite.config.ts tailwind.config.js postcss.config.js index.html ./
COPY src ./src
COPY public ./public

# `npm run build` typechecks first, so a type error fails the image build.
RUN VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
    VITE_SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON_KEY" \
    VITE_GOOGLE_MAPS_API_KEY="$VITE_GOOGLE_MAPS_API_KEY" \
    VITE_YOUTUBE_VIDEO_IDS="$VITE_YOUTUBE_VIDEO_IDS" \
    npm run build

# Fail the image build rather than ship a bundle that cannot reach any backend.
RUN test -n "$VITE_SUPABASE_URL" && grep -rqs "$VITE_SUPABASE_URL" dist || \
    { echo "the built bundle does not contain VITE_SUPABASE_URL" >&2; exit 1; }

FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

STOPSIGNAL SIGQUIT

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
