FROM node:22-alpine

WORKDIR /app

RUN corepack enable

# Pin ffmpeg / python / deno — require Deno >=2.3 for yt-dlp JS challenges (2025.11+)
ARG YT_DLP_VERSION=2026.08.19
ARG YT_DLP_SHA256=1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6
ARG FFMPEG_VERSION=""

RUN if [ -n "$FFMPEG_VERSION" ]; then apk add --no-cache "ffmpeg=$FFMPEG_VERSION" python3 py3-pip curl deno git nodejs; else apk add --no-cache ffmpeg python3 py3-pip curl deno git nodejs; fi

RUN deno --version && ffmpeg -version | head -n1 && python3 --version && ffmpeg -version | grep -E "version (7\.|8\.|6\.)" || (echo "ffmpeg version below 6.0 — pin update needed" && exit 1)

# Install MinIO
RUN curl -L https://dl.min.io/server/minio/release/linux-amd64/minio -o /usr/local/bin/minio \
  && chmod +x /usr/local/bin/minio

# Install PO token provider (required for LOGIN_REQUIRED — not fallback)
RUN pip install --no-cache-dir --break-system-packages bgutil-ytdlp-pot-provider \
  && python3 -c "import bgutil_ytdlp_pot_provider; print('bgutil plugin ok')" \
  && git clone --single-branch --branch 1.3.2 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-provider

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

COPY api/package.json ./api/

RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm rebuild esbuild

# Replace bundled yt-dlp with pinned version for reproducible anti-bot handling
RUN YT_DLP_DIR=$(find /app/node_modules/.pnpm -path "*/node_modules/youtube-dl-exec" -type d | head -1) \
  && mkdir -p "$YT_DLP_DIR/bin" \
  && curl -L "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp" -o "$YT_DLP_DIR/bin/yt-dlp" \
  && echo "${YT_DLP_SHA256}  $YT_DLP_DIR/bin/yt-dlp" | sha256sum -c - \
  && chmod +x "$YT_DLP_DIR/bin/yt-dlp" \
  && "$YT_DLP_DIR/bin/yt-dlp" --version

COPY . .

RUN pnpm --filter api build

COPY api/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

WORKDIR /app/api

EXPOSE 3000 9000

ENTRYPOINT ["/docker-entrypoint.sh"]
