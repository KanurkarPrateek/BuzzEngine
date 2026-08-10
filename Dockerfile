# Node 24+ runs TypeScript directly via type stripping, so there is no build
# step and no bundler. The app has zero runtime dependencies, which keeps this
# image small and its attack surface close to "just Node".
FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY tsconfig.json ./
COPY src ./src

# State (dedupe memory, post history, rotated X refresh token) must outlive the
# container. Mount a volume or PVC here.
ENV STATE_DIR=/data
RUN mkdir -p /data && chown -R node:node /data /app

USER node
VOLUME ["/data"]

# One-shot by default: exits after a single cycle so an external scheduler
# (Kubernetes CronJob, systemd timer, cron) owns the cadence.
# Set SCHEDULE=1 to run it as a long-lived process instead.
CMD ["node", "src/index.ts"]
