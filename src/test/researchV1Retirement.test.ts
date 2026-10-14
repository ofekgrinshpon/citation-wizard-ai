import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const entrypointPath = resolve(__dirname, "../../supabase/functions/legal-research-v1/index.ts");
const source = readFileSync(entrypointPath, "utf8");
const serverImport = "https://deno.land/std@0.168.0/http/server.ts";
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const retiredBody = {
  error: "RESEARCH_VERSION_RETIRED",
  code: "RESEARCH_VERSION_RETIRED",
  message: "גרסת המחקר הישנה הוצאה משימוש. יש לרענן את העמוד כדי להשתמש בגרסה העדכנית. הבקשה הזו לא התחילה מחקר ולא צרכה יחידות שימוש.",
  refresh_required: true,
  execution_started: false,
  units_consumed: 0,
};

// Evaluate the complete deployable entrypoint, not a copied or extracted handler.
// Only the HTTP server registration is allowed. Every other module or execution
// boundary fails closed, so these tests cannot reach a real network or database.
function loadEndpoint() {
  const forbidden = (name: string) => vi.fn(() => { throw new Error(`Forbidden V1 retirement effect: ${name}`); });
  const effects = {
    fetch: forbidden("fetch/provider/redirect"),
    createClient: forbidden("client construction"),
    from: forbidden("database/jobs"),
    rpc: forbidden("RPC/credits/refunds"),
    acquireOperationLock: forbidden("lock acquisition"),
    heartbeatOperationLock: forbidden("lock heartbeat"),
    releaseOperationLock: forbidden("lock release"),
    waitUntil: forbidden("background execution"),
    setTimeout: forbidden("watchdog"),
    setInterval: forbidden("background timer"),
    getEnv: forbidden("environment/smoke bypass"),
    jsonParse: forbidden("JSON parsing"),
  };
  let handler: ((req: Request) => Response | Promise<Response>) | undefined;
  const serve = vi.fn((registered: typeof handler) => { handler = registered; });
  const imports: string[] = [];
  runInContext(compiled, createContext({
    exports: {},
    require: (name: string) => {
      imports.push(name);
      if (name !== serverImport) throw new Error(`Forbidden V1 retirement import: ${name}`);
      return { serve };
    },
    Response,
    ...effects,
    Deno: { env: { get: effects.getEnv }, serve },
    EdgeRuntime: { waitUntil: effects.waitUntil },
    JSON: { stringify: JSON.stringify, parse: effects.jsonParse },
  }));
  expect(serve).toHaveBeenCalledTimes(1);
  expect(imports).toEqual([serverImport]);
  expect(handler).toBeTypeOf("function");
  return {
    handle: handler!,
    assertNoEffects: () => {
      for (const effect of Object.values(effects)) expect(effect).not.toHaveBeenCalled();
    },
  };
}

function unreadRequest(method: string, headers: Record<string, string>, body?: string) {
  const req = new Request("https://offline.invalid/functions/v1/legal-research-v1?smoke=1&resume=true", {
    method,
    headers,
    ...(body === undefined || method === "GET" || method === "HEAD" ? {} : { body }),
  });
  const reads = ["json", "text", "arrayBuffer", "blob", "formData", "bytes", "clone", "body", "headers", "url"].map((name) => {
    const read = vi.fn(() => { throw new Error(`Retired endpoint must not inspect request ${name}`); });
    Object.defineProperty(req, name, name === "body" || name === "headers" || name === "url"
      ? { configurable: true, get: read }
      : { configurable: true, value: read });
    return read;
  });
  return {
    req,
    assertUnread: () => {
      expect(req.bodyUsed).toBe(false);
      for (const read of reads) expect(read).not.toHaveBeenCalled();
    },
  };
}

async function expectRetired(response: Response) {
  expect(response.status).toBe(410);
  expect(response.headers.get("content-type")).toBe("application/json");
  for (const [name, value] of Object.entries(corsHeaders)) expect(response.headers.get(name)).toBe(value);
  expect(response.headers.get("location")).toBeNull();
  const body = await response.json();
  expect(body).toEqual(retiredBody);
  expect(body.message).toContain("יש לרענן");
  expect(body.message).not.toMatch(/הוחזר|יוחזר|זוכ|החזר/);
  for (const field of ["credits_refunded", "refunded", "refund_receipt", "job_id", "run_id", "status", "execution_outcome_unknown"])
    expect(body).not.toHaveProperty(field);
}

const credentials: Array<[string, Record<string, string>]> = [
  ["no credentials", {}],
  ["anonymous API key only", { apikey: "fixture-anon" }],
  ["malformed authorization", { authorization: "not-a-valid-token" }],
  ["old signed-in client", { authorization: "Bearer fixture-user", apikey: "fixture-anon" }],
  ["old service/smoke bypass", { authorization: "Bearer fixture-service", "x-smoke-mode": "1", "x-conc-hint": "bypass" }],
];
const oldBodies: Array<[string, string, string]> = [
  ["old answer request", JSON.stringify({ question: "שאלה משפטית", client_request_id: "old-request", mode: "answer" }), "application/json"],
  ["old sources request", JSON.stringify({ question: "שאלה משפטית", mode: "sources_only", attachments: [{ content: "private input" }] }), "application/json"],
  ["smoke/relay probe", JSON.stringify({ smoke_user_id: "00000000-0000-0000-0000-000000000001", relay_probe: true, force: true }), "application/json"],
  ["internal resume/action payload", JSON.stringify({ action: "continue", resume: true, run_id: "old-run", job_id: "old-job", internal: true, skip_credits: true }), "application/json"],
  ["cancel/refund action payload", JSON.stringify({ action: "cancel", refund: true, job_id: "old-job" }), "application/json"],
  ["unknown prior job", JSON.stringify({ job_id: "unknown-prior-job", credit_request_id: "unknown-charge", status: "timed_out", refund: true }), "application/json"],
  ["malformed JSON", "{invalid", "application/json"],
  ["empty body", "", "application/json"],
  ["JSON null", "null", "application/json"],
  ["wrong JSON shape", "[1,true]", "application/json"],
  ["non-JSON body", "question=old&smoke_user_id=fixture", "application/x-www-form-urlencoded"],
  ["oversized legacy question", "x".repeat(100_000), "text/plain"],
];

describe("retired V1 endpoint", () => {
  it.each(credentials)("preserves OPTIONS CORS for %s without reading input or doing work", async (_label, headers) => {
    const endpoint = loadEndpoint();
    const request = unreadRequest("OPTIONS", headers, "{invalid");
    const response = await endpoint.handle(request.req);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    for (const [name, value] of Object.entries(corsHeaders)) expect(response.headers.get(name)).toBe(value);
    endpoint.assertNoEffects();
    request.assertUnread();
  });

  describe.each(credentials)("with %s", (_label, headers) => {
    it.each(["POST", "GET", "HEAD", "PUT", "PATCH", "DELETE", "PROPFIND", "PURGE"])("returns static 410 for %s, with no auth, body, or resource access", async (method) => {
      const endpoint = loadEndpoint();
      const request = unreadRequest(method, headers, "{invalid");
      await expectRetired(await endpoint.handle(request.req));
      endpoint.assertNoEffects();
      request.assertUnread();
    });

    it.each(oldBodies)("does not execute or parse %s", async (_bodyLabel, body, contentType) => {
      const endpoint = loadEndpoint();
      const request = unreadRequest("POST", { ...headers, "content-type": contentType }, body);
      await expectRetired(await endpoint.handle(request.req));
      endpoint.assertNoEffects();
      request.assertUnread();
    });
  });

  it("makes no refund or outcome assertion about unknown prior jobs, including concurrent retries", async () => {
    const endpoint = loadEndpoint();
    const requests = ["running", "done", "error", "timed_out", "unknown"].map((status) => unreadRequest("POST", {}, JSON.stringify({
      job_id: `prior-${status}`, client_request_id: "same-old-request", credit_request_id: "prior-charge", status,
    })));
    const responses = await Promise.all(requests.map(({ req }) => endpoint.handle(req)));
    for (const response of responses) await expectRetired(response);
    for (const request of requests) request.assertUnread();
    endpoint.assertNoEffects();
  });

  it("imports only the existing HTTP server and retains the existing gateway configuration", () => {
    const tree = ts.createSourceFile(entrypointPath, source, ts.ScriptTarget.Latest, true);
    const imports = tree.statements.filter(ts.isImportDeclaration).map((entry) => (entry.moduleSpecifier as ts.StringLiteral).text);
    expect(imports).toEqual([serverImport]);
    const config = readFileSync(resolve(__dirname, "../../supabase/config.toml"), "utf8");
    const section = config.split("[functions.legal-research-v1]")[1]?.split("[")[0];
    expect(section?.trim()).toBe("verify_jwt = false");
  });
});
