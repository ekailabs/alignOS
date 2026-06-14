# Codex-backed TEE node. Codex ships native (glibc) linux binaries, so we use a glibc base
# (node:bookworm) rather than alpine/musl. ca-certificates is required for codex's TLS to
# chatgpt.com; bubblewrap backs codex's sandbox. The Deno binary (the node runtime) is copied
# in from the official deno image. The owner's Codex auth is injected at boot by entrypoint.sh.
FROM denoland/deno:bin AS deno

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates bubblewrap \
 && update-ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deno /deno /usr/local/bin/deno
RUN npm i -g @openai/codex@0.139.0 && npm cache clean --force
WORKDIR /app
COPY . .
RUN mkdir -p /data && chmod 0777 /data
# codex + claude write config under $HOME; /data is the writable CVM volume
ENV HOME=/data
RUN deno cache main.ts
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["sh", "/app/scripts/entrypoint.sh"]
