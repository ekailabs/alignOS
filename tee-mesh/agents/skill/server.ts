// One image, many skills — pick which via the SKILL env. Each skill serves an A2A agent
// card (with tag keywords the mesh router matches against) and answers POST / {question}.
const SKILL = Deno.env.get("SKILL") ?? "calc";
const PORT = Number(Deno.env.get("PORT") ?? "8080");

type Skill = { card: Record<string, unknown>; answer: (q: string) => unknown };

const SKILLS: Record<string, Skill> = {
  calc: {
    card: {
      name: "calc", description: "Evaluates simple arithmetic.",
      version: "1.0.0", protocolVersion: "0.2.0", capabilities: { streaming: false },
      skills: [{
        id: "calculate", name: "Calculator",
        description: "Add, subtract, multiply or divide two numbers",
        tags: ["math", "calculate", "arithmetic", "compute", "sum", "add", "plus", "minus",
               "subtract", "multiply", "times", "divide", "divided", "product"],
        examples: ["what is 12 * 8?", "add 5 and 7", "100 divided by 4"],
      }],
    },
    answer: (q) => {
      const w = q.toLowerCase()
        .replace(/\b(plus|add)\b/g, "+").replace(/\b(minus|subtract)\b/g, "-")
        .replace(/\b(times|multiplied by|multiply)\b/g, "*").replace(/\b(divided by|divide|over)\b/g, "/");
      const m = w.match(/(-?\d+(?:\.\d+)?)\s*([-+*/x])\s*(-?\d+(?:\.\d+)?)/);
      if (!m) return { error: "could not parse two numbers and an operator", input: q };
      const a = parseFloat(m[1]), b = parseFloat(m[3]);
      const r = m[2] === "+" ? a + b : m[2] === "-" ? a - b : (m[2] === "*" || m[2] === "x") ? a * b : a / b;
      return { expression: `${a} ${m[2]} ${b}`, result: r };
    },
  },
  weather: {
    card: {
      name: "weather", description: "Reports (canned) current weather for a few cities.",
      version: "1.0.0", protocolVersion: "0.2.0", capabilities: { streaming: false },
      skills: [{
        id: "forecast", name: "Weather",
        description: "Current conditions for a known city",
        tags: ["weather", "forecast", "temperature", "rain", "sunny", "climate", "conditions", "hot", "cold"],
        examples: ["what's the weather in Tokyo?", "forecast for London"],
      }],
    },
    answer: (q) => {
      const data: Record<string, string> = {
        tokyo: "18°C, light rain", london: "11°C, overcast", paris: "15°C, partly cloudy",
        "new york": "9°C, windy", "san francisco": "16°C, foggy", berlin: "12°C, clear",
      };
      const ql = q.toLowerCase();
      const city = Object.keys(data).find((c) => ql.includes(c));
      return city ? { city, conditions: data[city] } : { error: "no weather data for that city", known: Object.keys(data) };
    },
  },
  define: {
    card: {
      name: "define", description: "Defines a few TEE/mesh terms.",
      version: "1.0.0", protocolVersion: "0.2.0", capabilities: { streaming: false },
      skills: [{
        id: "define", name: "Dictionary",
        description: "Define a term",
        tags: ["define", "definition", "meaning", "dictionary", "explain", "glossary", "term"],
        examples: ["define attestation", "what does TEE mean"],
      }],
    },
    answer: (q) => {
      const dict: Record<string, string> = {
        tee: "Trusted Execution Environment — hardware-isolated compute with remote attestation.",
        attestation: "A signed proof of what code is running inside a TEE.",
        mesh: "A network where each node connects to peers directly, with no central hub.",
        gossip: "Epidemic state propagation: nodes periodically exchange views until consistent.",
        entropy: "A measure of disorder or uncertainty in a system.",
      };
      const ql = q.toLowerCase();
      const term = Object.keys(dict).find((t) => new RegExp(`\\b${t}\\b`).test(ql));
      return term ? { term, definition: dict[term] } : { error: "term not in glossary", known: Object.keys(dict) };
    },
  },
};

const skill = SKILLS[SKILL];
if (!skill) throw new Error(`unknown SKILL=${SKILL}; known: ${Object.keys(SKILLS).join(",")}`);

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/.well-known/agent-card.json") return Response.json(skill.card);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const question = (body as { question?: string }).question ?? url.searchParams.get("q") ?? "";
  return Response.json({ skill: SKILL, ...(skill.answer(question) as object) });
});
