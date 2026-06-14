const has = (haystack: string, needle: string, message: string) => {
  if (!haystack.includes(needle)) {
    throw new Error(
      `${message}: missing ${JSON.stringify(needle)} in ${
        JSON.stringify(haystack)
      }`,
    );
  }
};

Deno.test("codex backend includes local owner style examples in the prompt", async () => {
  const dir = await Deno.makeTempDir();
  const codexPath = `${dir}/codex`;
  const argsPath = `${dir}/codex.args`;
  const promptPath = `${dir}/codex.prompt`;
  const knowledgePath = `${dir}/knowledge.json`;
  const runnerPath = `${dir}/runner.ts`;

  await Deno.writeTextFile(
    codexPath,
    [
      "#!/bin/sh",
      ': > "$CODEX_ARGS_FILE"',
      "i=0",
      'for arg in "$@"; do',
      "  i=$((i + 1))",
      '  printf \'%s=%s\\n\' "$i" "$arg" >> "$CODEX_ARGS_FILE"',
      "done",
      'printf \'%s\' "${3-}" > "$CODEX_PROMPT_FILE"',
      "printf 'codex answer\\n'",
      "",
    ].join("\n"),
  );
  await Deno.chmod(codexPath, 0o755);

  await Deno.writeTextFile(
    knowledgePath,
    JSON.stringify({
      pairs: [
        {
          prompt: "start broad, then name the boundary conditions",
          output: "example output",
        },
        {
          prompt: "compress it and call out scale limits",
          output: "example output",
        },
      ],
      chains: [],
      style_profile: null,
    }),
  );

  const draftUrl = new URL("./draft.ts", import.meta.url).href;
  await Deno.writeTextFile(
    runnerPath,
    `
      import { infer } from ${JSON.stringify(draftUrl)};

      const task = {
        id: "task-1",
        contextId: "ctx-1",
        status: { state: "submitted", timestamp: new Date().toISOString() },
        artifacts: [],
        history: [{
          role: "user",
          parts: [{ kind: "text", text: "How should we design a multi-tenant agent routing layer?" }],
          messageId: "msg-1",
        }],
        from: { display: "Peer" },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      console.log(await infer(task, ""));
    `,
  );

  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-env",
      "--allow-read",
      "--allow-run=codex",
      "--allow-write",
      runnerPath,
    ],
    env: {
      ALIGN_DRAFT_BACKEND: "codex",
      ALIGN_KNOWLEDGE: knowledgePath,
      CODEX_ARGS_FILE: argsPath,
      CODEX_PROMPT_FILE: promptPath,
      PATH: `${dir}:${Deno.env.get("PATH") ?? ""}`,
    },
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await child.output();
  const out = new TextDecoder().decode(stdout).trim();
  if (code !== 0) {
    throw new Error(new TextDecoder().decode(stderr));
  }
  if (out !== "codex answer") {
    throw new Error(`expected fake codex answer, got ${JSON.stringify(out)}`);
  }

  const args = await Deno.readTextFile(argsPath);
  has(args, "1=exec\n", "codex should run through noninteractive exec");
  has(
    args,
    "2=--skip-git-repo-check\n",
    "codex should skip repo checks in TEE",
  );

  const prompt = await Deno.readTextFile(promptPath);
  has(
    prompt,
    "Here is how the owner tends to write",
    "prompt should include local style context",
  );
  has(
    prompt,
    "start broad, then name the boundary conditions",
    "prompt should include local owner prompt examples",
  );
  has(
    prompt,
    "compress it and call out scale limits",
    "prompt should include multiple owner prompt examples",
  );
  has(
    prompt,
    "How should we design a multi-tenant agent routing layer?",
    "prompt should include the inbound question",
  );
});
