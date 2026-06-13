const card = JSON.parse(await Deno.readTextFile(new URL("./agent-card.json", import.meta.url)));
const port = Number(Deno.env.get("PORT") ?? "8080");
Deno.serve({ port, hostname: "0.0.0.0" }, (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/.well-known/agent-card.json") return Response.json(card);
  return Response.json({ agent: "ping", reply: "pong", at: new Date().toISOString() });
});
