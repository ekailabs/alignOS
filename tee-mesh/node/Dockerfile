FROM denoland/deno:alpine
WORKDIR /app
COPY . .
RUN deno cache main.ts
EXPOSE 8080
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "main.ts"]
