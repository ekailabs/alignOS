// One image, many persona skills — pick which via the SKILL env. Each skill serves an A2A
// agent card (with tag keywords the mesh router matches against) and answers POST / {question}.
const SKILL = Deno.env.get("SKILL") ?? "albi";
const PORT = Number(Deno.env.get("PORT") ?? "8080");

type Skill = { card: Record<string, unknown>; answer: (q: string) => unknown };

function responseFor(owner: string, domains: string[], question: string) {
  const focus = domains.join(", ");
  return {
    owner,
    domains,
    question,
    answer:
      question.trim().length > 0
        ? `${owner} is the right person for ${focus}. They can help think through: ${question}`
        : `Ask ${owner} about ${focus}.`,
  };
}

const SKILLS: Record<string, Skill> = {
  albi: {
    card: {
      name: "albi",
      description: "Ask Albi about GTM, PMF, and product development.",
      version: "1.0.0",
      protocolVersion: "0.2.0",
      capabilities: { streaming: false },
      skills: [{
        id: "gtm-pmf-product",
        name: "GTM, PMF, Product Development",
        description: "Go-to-market, product-market fit, startup growth, and product development advice.",
        tags: [
          "albi",
          "gtm",
          "go-to-market",
          "pmf",
          "product-market-fit",
          "product",
          "product-development",
          "startup",
          "growth",
          "launch",
          "positioning",
          "customers",
        ],
        examples: [
          "ask Albi how to find PMF",
          "what is the right GTM motion for this product?",
          "how should we prioritize product development?",
        ],
      }],
    },
    answer: (q) => responseFor("Albi", ["GTM", "PMF", "Product Development"], q),
  },
  andrew: {
    card: {
      name: "andrew",
      description: "Ask Andrew about confidential compute, privacy, and security.",
      version: "1.0.0",
      protocolVersion: "0.2.0",
      capabilities: { streaming: false },
      skills: [{
        id: "confidential-compute-privacy-security",
        name: "Confidential Compute, Privacy, Security",
        description: "TEEs, enclaves, dstack/Phala, attestation, privacy, and security architecture.",
        tags: [
          "andrew",
          "confidential-compute",
          "confidential-computing",
          "tee",
          "enclave",
          "privacy",
          "security",
          "attestation",
          "dstack",
          "phala",
          "kms",
          "trusted-execution-environment",
        ],
        examples: [
          "ask Andrew how remote attestation works",
          "what privacy guarantees do TEEs provide?",
          "how should we secure this confidential compute deployment?",
        ],
      }],
    },
    answer: (q) => responseFor("Andrew", ["Confidential Compute", "Privacy", "Security"], q),
  },
  shashank: {
    card: {
      name: "shashank",
      description: "Ask Shashank about system design and agent infrastructure.",
      version: "1.0.0",
      protocolVersion: "0.2.0",
      capabilities: { streaming: false },
      skills: [{
        id: "system-design-agent-infra",
        name: "System Design, Agent Infra",
        description: "Distributed systems, agent infrastructure, routing, orchestration, and architecture.",
        tags: [
          "shashank",
          "system-design",
          "systems-design",
          "agent-infra",
          "agent-infrastructure",
          "agents",
          "distributed-systems",
          "architecture",
          "infra",
          "routing",
          "orchestration",
          "scalability",
        ],
        examples: [
          "ask Shashank how to design the agent routing layer",
          "what infra do we need for multi-agent orchestration?",
          "how should this system scale?",
        ],
      }],
    },
    answer: (q) => responseFor("Shashank", ["System Design", "Agent Infra"], q),
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
