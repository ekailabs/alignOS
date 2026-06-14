FROM denoland/deno:alpine
WORKDIR /app
COPY . .
RUN mkdir -p /data && chmod 0777 /data
RUN deno cache main.ts
EXPOSE 8080
VOLUME ["/data"]
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-run=claude,codex,pi", "main.ts"]
