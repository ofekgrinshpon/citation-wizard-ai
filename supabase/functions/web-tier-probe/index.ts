Deno.serve(async () => {
  const key = Deno.env.get("PERPLEXITY_API_KEY");
  const out: Record<string, unknown> = { key_present: !!key, key_len: key ? key.length : 0, key_prefix: key ? key.slice(0, 4) : null };
  if (key) {
    for (const model of ["sonar", "llama-3.1-sonar-small-128k-online"]) {
      try {
        const r = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 8 }),
        });
        out[model] = { status: r.status, body: (await r.text()).slice(0, 400) };
      } catch (e) { out[model] = { error: String(e) }; }
    }
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
});
