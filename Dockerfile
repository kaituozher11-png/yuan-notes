FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ARG DEBIAN_MIRROR=http://mirrors.tuna.tsinghua.edu.cn
RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
    libreoffice poppler-utils fonts-noto-cjk ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server ./server
COPY --from=builder /app/dist ./dist
RUN useradd --system --uid 10001 --create-home yingxing \
    && mkdir -p /app/data && chown -R yingxing:yingxing /app/data
USER yingxing
ENV PORT=4174 YINGXING_BIND_HOST=0.0.0.0 YINGXING_DATA_DIR=/app/data YINGXING_PUBLIC=1
EXPOSE 4174
CMD ["node", "server/index.js"]
