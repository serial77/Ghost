FROM node:22-alpine AS codex-builder

RUN npm install -g @openai/codex@0.114.0

FROM n8nio/n8n:2.11.3

USER root

COPY --from=codex-builder /usr/local/bin/codex /usr/local/bin/codex
COPY --from=codex-builder /usr/local/lib/node_modules /usr/local/lib/node_modules

RUN mkdir -p /opt/ghost/bin && chmod 755 /opt/ghost/bin \
 && ln -sf /usr/local/lib/node_modules/@openai/codex/bin/codex.js /usr/local/bin/codex

USER node