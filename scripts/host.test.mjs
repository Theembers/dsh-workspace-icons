/**
 * Host-side tests for dsh-workspace-icons.
 *
 * Run with: node --test scripts/host.test.mjs
 *
 * Everything runs against a mock Cordis context and an in-memory HTTP
 * request/response pair, so no DSH process, network access or esbuild is
 * required. The only real I/O is a temporary data directory under the OS tmp
 * dir, removed after each test.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";

import {
  API,
  __test,
  apply,
  emptyConfig,
  normalizeLoadedConfig,
  sanitizeSvg,
  validateRef,
} from "../lib/index.js";
import {
  filterCollections,
  filterIconNames,
  iconDataUri,
  parseCollection,
  parseCollections,
  parseIconBundle,
} from "../lib/iconify.js";

/* -------------------------------------------------------------------------- */
/* mocks                                                                      */
/* -------------------------------------------------------------------------- */

function makeCtx({ registry = null } = {}) {
  const routes = new Map();
  const effects = [];
  const injected = [];
  const warnings = [];
  const ctx = {
    routes,
    effects,
    injected,
    warnings,
    logger: {
      warn: (...args) => warnings.push(args.map((value) => (value instanceof Error ? value.message : String(value))).join(" ")),
      info: () => {},
      error: (...args) => warnings.push(args.map(String).join(" ")),
    },
    webServer: {
      register(route) {
        routes.set(route.path, { ...route });
        return () => routes.delete(route.path);
      },
    },
    effect(callback, label) {
      const disposer = callback();
      effects.push({ label, disposer });
      return disposer;
    },
    inject(deps, callback) {
      injected.push(deps);
      if (registry !== null) {
        callback({
          workspaceRegistry: registry,
          get: (name) => (name === "workspaceRegistry" ? registry : undefined),
        });
      }
      return () => {};
    },
    get(name) {
      return name === "workspaceRegistry" ? registry : undefined;
    },
  };
  return ctx;
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    headersSent: false,
    finished: false,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      for (const [key, value] of Object.entries(headers ?? {})) this.headers[key.toLowerCase()] = value;
      this.headersSent = true;
      return this;
    },
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    write(chunk) {
      if (chunk !== undefined && chunk !== null) this.chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) this.chunks.push(Buffer.from(chunk));
      this.finished = true;
      return this;
    },
  };
}

async function createHost(options = {}) {
  const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), "dsh-workspace-icons-test-")));
  const ctx = makeCtx({ registry: options.registry ?? null });
  const config = { dataDir };
  if (options.fetchImpl !== undefined) config.fetchImpl = options.fetchImpl;
  const { service } = apply(ctx, config);

  const call = async (path, requestOptions = {}) => {
    const method = requestOptions.method ?? "GET";
    const fullPath = path.startsWith(API) ? path : `${API}${path}`;
    const pathname = fullPath.split("?")[0];
    const record = ctx.routes.get(pathname);
    assert.ok(record !== undefined, `route not registered: ${pathname}`);
    const rawBody =
      requestOptions.body === undefined
        ? ""
        : typeof requestOptions.body === "string"
          ? requestOptions.body
          : JSON.stringify(requestOptions.body);
    const request = Readable.from(rawBody === "" ? [] : [Buffer.from(rawBody)]);
    request.method = method;
    request.url = fullPath;
    request.socket = { remoteAddress: requestOptions.remote ?? "127.0.0.1" };
    request.headers = {
      host: "127.0.0.1:52768",
      "sec-fetch-site": "same-origin",
      ...(method === "POST"
        ? { "x-dsh-workspace-icons": "1", "content-type": "application/json" }
        : {}),
      ...(requestOptions.headers ?? {}),
    };
    const response = makeRes();
    await record.handler(request, response);
    const buffer = Buffer.concat(response.chunks);
    const text = buffer.toString("utf8");
    let json = null;
    if (text !== "") {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: response.statusCode, headers: response.headers, json, text, buffer };
  };

  return {
    ctx,
    service,
    call,
    dataDir,
    post: (path, body, extra = {}) => call(path, { method: "POST", body, ...extra }),
    get: (path, extra = {}) => call(path, { method: "GET", ...extra }),
    cleanup: () => rm(dataDir, { recursive: true, force: true }),
  };
}

async function withHost(options, fn) {
  const host = await createHost(options);
  try {
    return await fn(host);
  } finally {
    await host.cleanup();
  }
}

/** A fetch stub keyed by full URL; callers inspect `calls` for cache assertions. */
function staticFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    const target = String(url);
    calls.push(target);
    const entry = typeof routes === "function" ? routes(target) : routes[target];
    if (entry === undefined) return { ok: false, status: 404, text: async () => "not found" };
    const status = entry.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => entry.body ?? "" };
  };
  return { fetchImpl, calls };
}

const DEMO_COLLECTION = {
  prefix: "demo",
  title: "Demo Icons",
  total: 5,
  uncategorized: ["home", "home-outline"],
  categories: { arrows: ["arrow-left", "arrow-right"] },
  aliases: { house: { parent: "home" } },
};

const DEMO_BUNDLE = {
  prefix: "demo",
  width: 24,
  height: 24,
  icons: {
    home: { body: '<path d="M3 12l9-9 9 9" fill="none" stroke="currentColor"/>' },
    "home-outline": { body: '<path d="M4 12l8-8 8 8" fill="none" stroke="currentColor"/>' },
  },
  aliases: { house: { parent: "home" } },
};

const DEMO_URLS = {
  "https://api.iconify.design/collection?prefix=demo": { body: JSON.stringify(DEMO_COLLECTION) },
  "https://api.iconify.design/demo/home.svg": {
    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 12l9-9 9 9"/></svg>',
  },
  // 批量取图：一次请求带回整页图标（逗号被 URL 编码）。
  "https://api.iconify.design/demo.json?icons=home%2Chome-outline": { body: JSON.stringify(DEMO_BUNDLE) },
};

async function seedConfig(dataDir, config) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 12h16"/></svg>';

function seedCustomIcon(index, extra = {}) {
  return {
    id: `seed-${index}`,
    name: `Seed ${index}`,
    kind: "svg",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 12h16"/></svg>',
    ...extra,
  };
}

/* -------------------------------------------------------------------------- */
/* plugin shape + route registration                                          */
/* -------------------------------------------------------------------------- */

test("module exposes the Cordis plugin contract without side effects", () => {
  assert.equal(typeof apply, "function");
  assert.equal(__test.API, "/api/dsh-workspace-icons");
  // Importing the module must not create the data directory on the real host.
  assert.equal(typeof emptyConfig().version, "number");
});

test("apply registers every documented route once, through ctx.effect, kind=exact", async () => {
  await withHost({}, (host) => {
    const expected = [
      "/state",
      "/iconify/search",
      "/iconify/collections",
      "/iconify-svg",
      "/custom-svg",
      "/workspace-icons",
      "/defaults",
      "/settings",
      "/custom-icons",
      "/custom-icons/delete",
      "/iconify/link",
      "/iconify/unlink",
    ];
    assert.equal(host.ctx.routes.size, expected.length);
    for (const suffix of expected) {
      const record = host.ctx.routes.get(`${API}${suffix}`);
      assert.ok(record !== undefined, `missing ${suffix}`);
      assert.equal(record.kind, "exact");
      assert.equal(typeof record.handler, "function");
    }
    assert.equal(host.ctx.effects.length, expected.length);
    assert.equal(host.ctx.effects[0].disposer instanceof Function, true);
    // The injected registry dependency is requested exactly once, optionally.
    assert.deepEqual(host.ctx.injected, [["workspaceRegistry"]]);
    // Disposing an effect removes its route.
    host.ctx.effects[0].disposer();
    assert.equal(host.ctx.routes.has(`${API}/state`), false);
  });
});

/* -------------------------------------------------------------------------- */
/* GET /state                                                                 */
/* -------------------------------------------------------------------------- */

test("GET /state on a fresh data directory returns defaults and creates nothing", async () => {
  await withHost({}, async (host) => {
    const result = await host.get("/state");
    assert.equal(result.status, 200);
    assert.equal(result.json.ok, true);
    assert.deepEqual(result.json.value.config, emptyConfig());
    assert.deepEqual(result.json.value.workspaces, []);
    // A read-only request must not create config.json or a cache directory.
    assert.deepEqual(await readdir(host.dataDir), []);
  });
});

test("GET /state maps registry workspaces (id/title/path) and tolerates gaps", async () => {
  const registry = {
    list: () => [
      { id: "ws-1", title: "First", path: "/tmp/first" },
      { id: "ws-2", path: "/tmp/second" }, // no title
      { workspaceId: "ws-3", title: "Third", path: "/tmp/third" }, // alias field
      { id: "ws-1", title: "duplicate", path: "/tmp/dup" },
      { path: "/tmp/no-id" }, // cannot be targeted, skipped
      { id: "ws-4", title: "No path" },
    ],
  };
  await withHost({ registry }, async (host) => {
    const result = await host.get("/state");
    assert.equal(result.status, 200);
    assert.deepEqual(result.json.value.workspaces, [
      { workspaceId: "ws-1", title: "First", path: "/tmp/first" },
      { workspaceId: "ws-2", title: "/tmp/second", path: "/tmp/second" },
      { workspaceId: "ws-3", title: "Third", path: "/tmp/third" },
      { workspaceId: "ws-4", title: "No path", path: "" },
    ]);
  });
});

test("GET /state unwraps an async registry list and survives an unavailable registry", async () => {
  const asyncRegistry = {
    async list() {
      return [{ id: "aws-1", title: "Async", path: "/tmp/async" }];
    },
  };
  await withHost({ registry: asyncRegistry }, async (host) => {
    const result = await host.get("/state");
    assert.deepEqual(result.json.value.workspaces, [
      { workspaceId: "aws-1", title: "Async", path: "/tmp/async" },
    ]);
  });

  const brokenRegistry = {
    list() {
      throw new Error("registry exploded");
    },
  };
  await withHost({ registry: brokenRegistry }, async (host) => {
    const result = await host.get("/state");
    assert.equal(result.status, 200);
    assert.deepEqual(result.json.value.workspaces, []);
    assert.ok(host.ctx.warnings.some((line) => line.includes("工作区列表不可用")));
  });

  await withHost({}, async (host) => {
    const result = await host.get("/state");
    assert.deepEqual(result.json.value.workspaces, []);
  });
});

test("GET /state uses the registry captured through ctx.inject", async () => {
  const registry = {
    list: () => [{ id: "injected-1", title: "Injected", path: "/tmp/injected" }],
  };
  await withHost({ registry }, async (host) => {
    assert.equal(host.service.registry, registry);
    const result = await host.get("/state");
    assert.deepEqual(result.json.value.workspaces, [
      { workspaceId: "injected-1", title: "Injected", path: "/tmp/injected" },
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* POST /workspace-icons                                                      */
/* -------------------------------------------------------------------------- */

test("POST /workspace-icons persists a builtin ref atomically and re-loads it", async () => {
  await withHost({}, async (host) => {
    const icon = { type: "builtin", name: "rocket" };
    const result = await host.post("/workspace-icons", { workspaceId: "ws-1", icon });
    assert.equal(result.status, 200);
    assert.equal(result.json.ok, true);
    assert.deepEqual(result.json.value, { workspaceId: "ws-1", icon });

    const stored = JSON.parse(await readFile(join(host.dataDir, "config.json"), "utf8"));
    assert.deepEqual(stored.workspaceIcons, { "ws-1": icon });
    assert.equal(stored.version, 1);
    assert.deepEqual(stored.settings, { showDefaultWorkspaceIcon: true, showDefaultSessionIcon: true });

    const files = await readdir(host.dataDir);
    assert.deepEqual(files, ["config.json"], "no temp file left behind");

    // A second service on the same directory sees the persisted value.
    const reloaded = await createHost({ dataDir: host.dataDir });
    try {
      const state = await reloaded.get("/state");
      assert.deepEqual(state.json.value.config.workspaceIcons, { "ws-1": icon });
    } finally {
      // reloaded shares dataDir; do not delete it here.
    }
  });
});

test("POST /workspace-icons with null clears the stored ref", async () => {
  await withHost({}, async (host) => {
    await host.post("/workspace-icons", { workspaceId: "ws-1", icon: { type: "builtin", name: "rocket" } });
    const result = await host.post("/workspace-icons", { workspaceId: "ws-1", icon: null });
    assert.equal(result.status, 200);
    assert.equal(result.json.value.icon, null);
    const state = await host.get("/state");
    assert.deepEqual(state.json.value.config.workspaceIcons, {});
  });
});

test("POST /workspace-icons enforces the trusted-action checks", async () => {
  await withHost({}, async (host) => {
    const body = { workspaceId: "ws-1", icon: { type: "builtin", name: "rocket" } };

    const noHeader = await host.post("/workspace-icons", body, { headers: { "x-dsh-workspace-icons": "0" } });
    assert.equal(noHeader.status, 403);
    assert.equal(noHeader.json.error.code, "forbidden");

    const noHeaderAtAll = await host.post("/workspace-icons", body, {
      headers: { "x-dsh-workspace-icons": "" },
    });
    assert.equal(noHeaderAtAll.status, 403);

    const remote = await host.post("/workspace-icons", body, { remote: "10.0.0.7" });
    assert.equal(remote.status, 403);

    const crossSite = await host.post("/workspace-icons", body, { headers: { "sec-fetch-site": "cross-site" } });
    assert.equal(crossSite.status, 403);

    const badOrigin = await host.post("/workspace-icons", body, {
      headers: { origin: "http://evil.example:52768" },
    });
    assert.equal(badOrigin.status, 403);

    // A same-origin Origin header is accepted.
    const sameOrigin = await host.post("/workspace-icons", body, {
      headers: { origin: "http://127.0.0.1:52768" },
    });
    assert.equal(sameOrigin.status, 200);

    // GET stays reachable without the custom header (the browser loads icons that way).
    const state = await host.get("/state");
    assert.equal(state.status, 200);
  });
});

test("POST /workspace-icons validates references and request bodies", async () => {
  await withHost({}, async (host) => {
    const cases = [
      [{ workspaceId: "ws-1" }, 400, "bad-request"], // missing icon key
      [{ workspaceId: "", icon: null }, 400, "bad-workspace"],
      [{ workspaceId: 7, icon: null }, 400, "bad-workspace"],
      [{ workspaceId: "ws-1", icon: { type: "nope" } }, 400, "bad-icon"],
      [{ workspaceId: "ws-1", icon: { type: "builtin", name: "Rocket" } }, 400, "bad-icon"],
      [{ workspaceId: "ws-1", icon: { type: "iconify", prefix: "demo", name: "home" } }, 400, "prefix-not-linked"],
      [{ workspaceId: "ws-1", icon: { type: "custom", id: "missing-id" } }, 400, "unknown-custom-icon"],
      [{ workspaceId: "ws-1", icon: { type: "emoji", value: "😀" } }, 400, "bad-icon"],
      [{ workspaceId: "ws-1", icon: "rocket" }, 400, "bad-icon"],
    ];
    for (const [body, status, code] of cases) {
      const result = await host.post("/workspace-icons", body);
      assert.equal(result.status, status, JSON.stringify(body));
      assert.equal(result.json.ok, false);
      assert.equal(result.json.error.code, code, JSON.stringify(body));
      assert.equal(typeof result.json.error.message, "string");
    }

    const malformed = await host.post("/workspace-icons", "{not json");
    assert.equal(malformed.status, 400);
    assert.equal(malformed.json.error.code, "bad-json");

    const arrayBody = await host.post("/workspace-icons", "[1,2,3]");
    assert.equal(arrayBody.status, 400);
    assert.equal(arrayBody.json.error.code, "bad-json");

    const emptyBody = await host.post("/workspace-icons", "");
    assert.equal(emptyBody.status, 400);
    assert.equal(emptyBody.json.error.code, "bad-request");

    const oversized = await host.post("/workspace-icons", JSON.stringify({ workspaceId: "ws-1", icon: null, pad: "x".repeat(600 * 1024) }));
    assert.equal(oversized.status, 413);
    assert.equal(oversized.json.error.code, "body-too-large");
  });
});

test("GET routes reject POST with 405 and JSON GET routes reject HEAD bodies", async () => {
  await withHost({}, async (host) => {
    const result = await host.post("/state", {});
    assert.equal(result.status, 405);
    assert.equal(result.json.error.code, "method-not-allowed");

    const head = await host.call("/state", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.text, "");
  });
});

/* -------------------------------------------------------------------------- */
/* defaults + settings                                                        */
/* -------------------------------------------------------------------------- */

test("POST /defaults sets, patches and clears default icons", async () => {
  await withHost({}, async (host) => {
    const first = await host.post("/defaults", {
      workspace: { type: "builtin", name: "compass" },
      session: { type: "builtin", name: "message-circle" },
    });
    assert.equal(first.status, 200);
    assert.deepEqual(first.json.value.defaults, {
      workspace: { type: "builtin", name: "compass" },
      session: { type: "builtin", name: "message-circle" },
    });

    const patch = await host.post("/defaults", { workspace: null });
    assert.equal(patch.status, 200);
    assert.deepEqual(patch.json.value.defaults, {
      workspace: null,
      session: { type: "builtin", name: "message-circle" },
    });

    const bad = await host.post("/defaults", { workspace: { type: "iconify", prefix: "demo", name: "home" } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, "prefix-not-linked");

    const nothing = await host.post("/defaults", {});
    assert.equal(nothing.status, 400);
    assert.equal(nothing.json.error.code, "bad-request");

    const state = await host.get("/state");
    assert.deepEqual(state.json.value.config.defaults, {
      workspace: null,
      session: { type: "builtin", name: "message-circle" },
    });
  });
});

test("POST /settings updates boolean flags", async () => {
  await withHost({}, async (host) => {
    const result = await host.post("/settings", { showDefaultWorkspaceIcon: false });
    assert.equal(result.status, 200);
    assert.deepEqual(result.json.value.settings, {
      showDefaultWorkspaceIcon: false,
      showDefaultSessionIcon: true,
    });

    // 颜色不再是可配置项：带颜色字段的请求按「未提供有效设置」处理。
    const badColor = await host.post("/settings", { workspaceIconColor: "#ff8800" });
    assert.equal(badColor.status, 400);
    assert.equal(badColor.json.error.code, "bad-request");

    const bad = await host.post("/settings", { showDefaultSessionIcon: "no" });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, "bad-settings");

    const nothing = await host.post("/settings", { unrelated: true });
    assert.equal(nothing.status, 400);
    assert.equal(nothing.json.error.code, "bad-request");
  });
});

/* -------------------------------------------------------------------------- */
/* custom icons                                                               */
/* -------------------------------------------------------------------------- */

test("POST /custom-icons adds an SVG icon usable as a workspace ref", async () => {
  await withHost({}, async (host) => {
    const created = await host.post("/custom-icons", { name: " Compass ", kind: "svg", svg: SAMPLE_SVG });
    assert.equal(created.status, 200);
    const id = created.json.value.id;
    assert.match(id, __test.MAX_CUSTOM_ICONS > 0 ? /^[A-Za-z0-9_-]{2,80}$/ : /x/);
    assert.equal(created.json.value.icon.kind, "svg");
    assert.equal(created.json.value.icon.name, "Compass");
    assert.deepEqual(created.json.value.customIcons, [created.json.value.icon]);

    const linked = await host.post("/workspace-icons", { workspaceId: "ws-1", icon: { type: "custom", id } });
    assert.equal(linked.status, 200);
    assert.deepEqual(linked.json.value.icon, { type: "custom", id });

    const state = await host.get("/state");
    assert.equal(state.json.value.config.customIcons.length, 1);
    assert.deepEqual(state.json.value.config.workspaceIcons, { "ws-1": { type: "custom", id } });
  });
});

test("POST /custom-icons sanitizes SVG payloads and enforces size/kind limits", async () => {
  await withHost({}, async (host) => {
    const dirty = [
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">',
      '<script>alert("x")</script>',
      '<foreignObject><body xmlns="http://www.w3.org/1999/xhtml">evil</body></foreignObject>',
      '<a href="javascript:alert(2)"><text>hi</text></a>',
      "</svg>",
    ].join("");
    const created = await host.post("/custom-icons", { name: "Safe", kind: "svg", svg: dirty });
    assert.equal(created.status, 200);
    const icon = created.json.value.icon;
    assert.equal(icon.kind, "svg");
    assert.ok(icon.svg.startsWith("<svg"));
    assert.equal(/<script/i.test(icon.svg), false);
    assert.equal(/foreignObject/i.test(icon.svg), false);
    assert.equal(/\sonload=/i.test(icon.svg), false);
    assert.equal(/javascript:/i.test(icon.svg), false);
    // The harmless ref survives.
    assert.match(icon.svg, /<text>hi<\/text>/);

    const html = await host.post("/custom-icons", { name: "Html", kind: "svg", svg: "<html><body>nope</body></html>" });
    assert.equal(html.status, 400);
    assert.equal(html.json.error.code, "bad-svg");

    const huge = `<svg>${"x".repeat(70 * 1024)}</svg>`;
    const tooLarge = await host.post("/custom-icons", { name: "Huge", kind: "svg", svg: huge });
    assert.equal(tooLarge.status, 413);
    assert.equal(tooLarge.json.error.code, "svg-too-large");

    const badKind = await host.post("/custom-icons", { name: "Bad", kind: "png", value: "x" });
    assert.equal(badKind.status, 400);
    assert.equal(badKind.json.error.code, "bad-kind");

    const badName = await host.post("/custom-icons", { name: "   ", kind: "svg", svg: SAMPLE_SVG });
    assert.equal(badName.status, 400);
    assert.equal(badName.json.error.code, "bad-name");

    // emoji 类型已下线：不再被接受。
    const emojiKind = await host.post("/custom-icons", { name: "Bad", kind: "emoji", value: "😀" });
    assert.equal(emojiKind.status, 400);
    assert.equal(emojiKind.json.error.code, "bad-kind");
  });
});

test("POST /custom-icons enforces the 200 icon cap", async () => {
  await withHost({}, async (host) => {
    const seeded = emptyConfig();
    for (let index = 0; index < __test.MAX_CUSTOM_ICONS; index += 1) seeded.customIcons.push(seedCustomIcon(index));
    await seedConfig(host.dataDir, seeded);

    const rejected = await host.post("/custom-icons", { name: "One more", kind: "svg", svg: SAMPLE_SVG });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.json.error.code, "too-many-icons");

    const state = await host.get("/state");
    assert.equal(state.json.value.config.customIcons.length, __test.MAX_CUSTOM_ICONS);
  });
});

test("POST /custom-icons/delete removes the icon and cleans workspace/default refs", async () => {
  await withHost({}, async (host) => {
    const created = await host.post("/custom-icons", { name: "Temp", kind: "svg", svg: SAMPLE_SVG });
    const id = created.json.value.id;
    const other = await host.post("/custom-icons", { name: "Keep", kind: "svg", svg: SAMPLE_SVG });
    const keepId = other.json.value.id;

    await host.post("/workspace-icons", { workspaceId: "ws-1", icon: { type: "custom", id } });
    await host.post("/workspace-icons", { workspaceId: "ws-2", icon: { type: "custom", id: keepId } });
    await host.post("/defaults", {
      workspace: { type: "custom", id },
      session: { type: "builtin", name: "message-circle" },
    });

    const deleted = await host.post("/custom-icons/delete", { id });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.json.value.removed, true);
    assert.equal(deleted.json.value.cleaned, 2);

    const state = await host.get("/state");
    const config = state.json.value.config;
    assert.deepEqual(config.customIcons.map((icon) => icon.id), [keepId]);
    assert.deepEqual(config.workspaceIcons, { "ws-2": { type: "custom", id: keepId } });
    assert.equal(config.defaults.workspace, null);
    assert.deepEqual(config.defaults.session, { type: "builtin", name: "message-circle" });

    // Deleting again is idempotent.
    const again = await host.post("/custom-icons/delete", { id });
    assert.equal(again.status, 200);
    assert.equal(again.json.value.removed, false);

    const badId = await host.post("/custom-icons/delete", { id: "!" });
    assert.equal(badId.status, 400);
    assert.equal(badId.json.error.code, "bad-id");
  });
});

test("GET /custom-svg serves sanitized SVG with the image content type", async () => {
  await withHost({}, async (host) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="24" height="24"/></svg>';
    const created = await host.post("/custom-icons", { name: "Rect", kind: "svg", svg });
    const id = created.json.value.id;

    const result = await host.get(`/custom-svg?id=${encodeURIComponent(id)}`);
    assert.equal(result.status, 200);
    assert.match(result.headers["content-type"], /^image\/svg\+xml/);
    assert.ok(result.buffer.toString("utf8").startsWith("<svg"));
    assert.equal(/<script/i.test(result.text), false);
    assert.match(result.headers["content-type"], /charset=utf-8/);

    const missing = await host.get("/custom-svg?id=does-not-exist");
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, "not-found");

    const invalid = await host.get("/custom-svg?id=%21");
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.error.code, "bad-id");

    const noSvg = await host.post("/custom-icons", { name: "NoSvg", kind: "svg", svg: "<html/>" });
    assert.equal(noSvg.status, 400);
  });
});

/* -------------------------------------------------------------------------- */
/* Iconify                                                                    */
/* -------------------------------------------------------------------------- */

test("Iconify collection parsing flattens categories, aliases and search order", () => {
  const parsed = parseCollection(JSON.stringify(DEMO_COLLECTION));
  assert.deepEqual(parsed, {
    prefix: "demo",
    title: "Demo Icons",
    total: 5,
    icons: ["home", "home-outline", "arrow-left", "arrow-right", "house"],
  });
  assert.deepEqual(filterIconNames(parsed.icons, "ho", 3), ["home", "home-outline", "house"]);
  assert.deepEqual(filterIconNames(parsed.icons, "arrow", 10), ["arrow-left", "arrow-right"]);
  assert.deepEqual(filterIconNames(parsed.icons, "", 2), ["home", "home-outline"]);
  assert.equal(parseCollection("not json"), null);
  assert.equal(parseCollection("[]"), null);

  // --- Iconify collection catalog (/collections) -----------------------------
  const DEMO_CATALOG = {
    lucide: { name: "Lucide", total: 2029, author: { name: "Lucide Contributors" } },
    tabler: { name: "Tabler Icons", total: 6257, author: { name: "Paweł Kuna" } },
    mdi: { name: "Material Design Icons", total: 7447 },
    broken: { name: 42 },
  };
  const catalog = parseCollections(JSON.stringify(DEMO_CATALOG));
  assert.ok(Array.isArray(catalog));
  // The `broken` entry has a non-string name, so it is skipped as well.
  assert.equal(catalog.length, 3);
  // Sorted by icon count, descending.
  assert.deepEqual(catalog.map((item) => item.prefix), ["mdi", "tabler", "lucide"]);
  assert.equal(catalog[0].title, "Material Design Icons");
  assert.equal(catalog[2].author, "Lucide Contributors");
  // Missing author becomes an empty string, missing title falls back to the prefix.
  assert.equal(catalog[0].author, "");
  assert.equal(parseCollections("not json"), null);
  assert.equal(parseCollections("[]"), null);

  // Catalog search matches prefix, title and author; the limit is respected.
  assert.deepEqual(filterCollections(catalog, "lucide", 10).map((i) => i.prefix), ["lucide"]);
  assert.deepEqual(filterCollections(catalog, "tabler icons", 10).map((i) => i.prefix), ["tabler"]);
  assert.deepEqual(filterCollections(catalog, "kuna", 10).map((i) => i.prefix), ["tabler"]);
  assert.deepEqual(filterCollections(catalog, "zzz", 10), []);
  assert.equal(filterCollections(catalog, "", 2).length, 2);
});

test("icon bundles parse into per-icon bodies and standalone data URIs", () => {
  const bundle = parseIconBundle(JSON.stringify(DEMO_BUNDLE));
  assert.equal(bundle.prefix, "demo");
  assert.equal(bundle.width, 24);
  assert.equal(bundle.height, 24);
  assert.deepEqual(Object.keys(bundle.icons), ["home", "home-outline"]);
  assert.equal(bundle.aliases.house, "home");

  // 直接命中的图标。
  const uri = iconDataUri(bundle, "home");
  assert.match(uri, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.match(decodeURIComponent(uri), /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24">/);
  assert.match(decodeURIComponent(uri), /M3 12l9-9 9 9/);

  // 别名解析到父图标。
  assert.equal(iconDataUri(bundle, "house"), iconDataUri(bundle, "home"));
  // 未知图标没有 data URI。
  assert.equal(iconDataUri(bundle, "nope"), null);
  assert.equal(iconDataUri(null, "home"), null);

  // 坏载荷返回 null。
  assert.equal(parseIconBundle("not json"), null);
  assert.equal(parseIconBundle("[]"), null);
  // 缺 width/height 时回落到 24。
  const fallback = parseIconBundle({ icons: { a: { body: "<path/>" } } });
  assert.equal(fallback.width, 24);
  assert.equal(fallback.height, 24);
  // 空 body 的图标被忽略。
  assert.deepEqual(parseIconBundle({ icons: { a: { body: "" } } }).icons, {});
});

test("POST /iconify/link stores metadata and search filters the cached collection", async () => {
  const { fetchImpl, calls } = staticFetch(DEMO_URLS);
  await withHost({ fetchImpl }, async (host) => {
    const link = await host.post("/iconify/link", { prefix: "demo" });
    assert.equal(link.status, 200);
    assert.equal(link.json.value.prefix, "demo");
    assert.equal(link.json.value.title, "Demo Icons");
    assert.equal(link.json.value.total, 5);
    assert.equal(link.json.value.libraries.length, 1);
    assert.equal(typeof link.json.value.linkedAt, "string");
    assert.equal(calls.length, 1);

    // Linking twice is idempotent (metadata refresh, no duplicate entry).
    const again = await host.post("/iconify/link", { prefix: "demo" });
    assert.equal(again.status, 200);
    assert.equal(again.json.value.libraries.length, 1);

    // Search reads the cached collection, so no extra network call.
    const search = await host.get("/iconify/search?prefix=demo&q=ho&limit=2");
    assert.equal(search.status, 200);
    assert.equal(search.json.value.title, "Demo Icons");
    assert.equal(search.json.value.total, 5);
    assert.deepEqual(search.json.value.icons.map((item) => item.name), ["home", "home-outline"]);
    // 整页图标一次上游请求取回，响应里直接带上可渲染的 data URI。
    assert.equal(typeof search.json.value.icons[0].svg, "string");
    assert.match(search.json.value.icons[0].svg, /^data:image\/svg\+xml/);
    assert.match(decodeURIComponent(search.json.value.icons[0].svg), /M3 12l9-9 9 9/);
    assert.equal(calls.length, 2, "search reuses the cached collection and fetches the icons in one request");
    assert.ok(
      calls.includes("https://api.iconify.design/demo.json?icons=home%2Chome-outline"),
      "icons must be fetched in one batched request",
    );

    const badPrefix = await host.get("/iconify/search?prefix=DEMO");
    assert.equal(badPrefix.status, 400);
    assert.equal(badPrefix.json.error.code, "bad-prefix");

    const badLimit = await host.get("/iconify/search?prefix=demo&limit=0");
    assert.equal(badLimit.status, 400);
    assert.equal(badLimit.json.error.code, "bad-request");

    const state = await host.get("/state");
    assert.deepEqual(state.json.value.config.libraries.iconify.map((entry) => entry.prefix), ["demo"]);
  });
});

test("POST /iconify/link surfaces upstream failures as 502 iconify-unavailable", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => "boom" });
  await withHost({ fetchImpl }, async (host) => {
    const result = await host.post("/iconify/link", { prefix: "demo" });
    assert.equal(result.status, 502);
    assert.equal(result.json.error.code, "iconify-unavailable");
    assert.equal(typeof result.json.error.hint, "string");

    const bad = await host.post("/iconify/link", { prefix: "Not Valid" });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, "bad-prefix");
  });
});

test("GET /iconify-svg proxies, caches, and maps 404", async () => {
  const { fetchImpl, calls } = staticFetch(DEMO_URLS);
  await withHost({ fetchImpl }, async (host) => {
    const first = await host.get("/iconify-svg?prefix=demo&name=home");
    assert.equal(first.status, 200);
    assert.match(first.headers["content-type"], /^image\/svg\+xml/);
    assert.ok(first.text.startsWith("<svg"));
    assert.equal(calls.length, 1);

    const second = await host.get("/iconify-svg?prefix=demo&name=home");
    assert.equal(second.status, 200);
    assert.equal(calls.length, 1, "SVG must be served from cache");

    const missing = await host.get("/iconify-svg?prefix=demo&name=absent");
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, "not-found");

    const badName = await host.get("/iconify-svg?prefix=demo&name=BAD_NAME");
    assert.equal(badName.status, 400);
    assert.equal(badName.json.error.code, "bad-icon-name");

    // Cache files live below <dataDir>/cache.
    const cacheFiles = await readdir(join(host.dataDir, "cache"));
    assert.ok(cacheFiles.some((file) => file.startsWith("svg-demo-home")));
    assert.ok(cacheFiles.some((file) => file.startsWith("collection-demo")) === false);
  });
});

test("POST /iconify/unlink removes the library and cleans dangling refs", async () => {
  const { fetchImpl } = staticFetch(DEMO_URLS);
  await withHost({ fetchImpl }, async (host) => {
    await host.post("/iconify/link", { prefix: "demo" });
    await host.post("/workspace-icons", { workspaceId: "ws-1", icon: { type: "iconify", prefix: "demo", name: "home" } });
    await host.post("/defaults", {
      workspace: { type: "iconify", prefix: "demo", name: "home" },
      session: { type: "builtin", name: "message-circle" },
    });

    const unlinked = await host.post("/iconify/unlink", { prefix: "demo" });
    assert.equal(unlinked.status, 200);
    assert.equal(unlinked.json.value.removed, true);
    assert.equal(unlinked.json.value.cleaned, 2);
    assert.deepEqual(unlinked.json.value.libraries, []);

    const state = await host.get("/state");
    const config = state.json.value.config;
    assert.deepEqual(config.libraries.iconify, []);
    assert.deepEqual(config.workspaceIcons, {});
    assert.equal(config.defaults.workspace, null);
    assert.deepEqual(config.defaults.session, { type: "builtin", name: "message-circle" });

    const again = await host.post("/iconify/unlink", { prefix: "demo" });
    assert.equal(again.status, 200);
    assert.equal(again.json.value.removed, false);
  });
});

/* -------------------------------------------------------------------------- */
/* persistence edge cases                                                     */
/* -------------------------------------------------------------------------- */

test("a corrupt config file is backed up and reset to defaults", async () => {
  await withHost({}, async (host) => {
    await mkdir(host.dataDir, { recursive: true });
    await writeFile(join(host.dataDir, "config.json"), "{ this is not json", "utf8");

    const state = await host.get("/state");
    assert.equal(state.status, 200);
    assert.deepEqual(state.json.value.config, emptyConfig());
    const files = await readdir(host.dataDir);
    assert.ok(files.some((file) => file.startsWith("config.json.corrupt-")), `backup missing: ${files.join(", ")}`);
    assert.ok(host.ctx.warnings.some((line) => line.includes("配置无法识别")));

    // A mutation writes a fresh valid file again.
    const saved = await host.post("/settings", { showDefaultSessionIcon: false });
    assert.equal(saved.status, 200);
    const stored = JSON.parse(await readFile(join(host.dataDir, "config.json"), "utf8"));
    assert.equal(stored.settings.showDefaultSessionIcon, false);
  });

  // An unknown config version is treated as corrupt as well.
  await withHost({}, async (host) => {
    await seedConfig(host.dataDir, { version: 2, customIcons: [] });
    const state = await host.get("/state");
    assert.deepEqual(state.json.value.config, emptyConfig());
    const files = await readdir(host.dataDir);
    assert.ok(files.some((file) => file.startsWith("config.json.corrupt-")));
  });
});

test("valid entries survive a reload while invalid ones are pruned", async () => {
  await withHost({}, async (host) => {
    await seedConfig(host.dataDir, {
      version: 1,
      libraries: {
        iconify: [
          { prefix: "demo", title: "Demo", total: 5, linkedAt: "2026-01-01T00:00:00.000Z" },
          { prefix: "BAD PREFIX", title: "nope" },
        ],
      },
      customIcons: [
        { id: "keep-1", name: "Keep", kind: "svg", svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' },
        { id: "keep-2", name: "Svg", kind: "svg", svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' },
        { id: "!", name: "Bad id", kind: "svg", svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' },
        { id: "keep-3", name: "Bad svg", kind: "svg", svg: "<html/>" },
      ],
      workspaceIcons: {
        "ws-1": { type: "builtin", name: "rocket" },
        "ws-2": { type: "iconify", prefix: "demo", name: "home" },
        "ws-3": { type: "custom", id: "keep-1" },
        "ws-4": { type: "custom", id: "missing" },
        "ws-5": "not-a-ref",
      },
      defaults: { workspace: { type: "custom", id: "keep-2" }, session: null },
      settings: { showDefaultWorkspaceIcon: false, showDefaultSessionIcon: "yes" },
    });

    const state = await host.get("/state");
    const config = state.json.value.config;
    assert.deepEqual(config.libraries.iconify.map((entry) => entry.prefix), ["demo"]);
    assert.deepEqual(config.customIcons.map((icon) => icon.id), ["keep-1", "keep-2"]);
    assert.deepEqual(config.workspaceIcons, {
      "ws-1": { type: "builtin", name: "rocket" },
      "ws-2": { type: "iconify", prefix: "demo", name: "home" },
      "ws-3": { type: "custom", id: "keep-1" },
    });
    assert.deepEqual(config.defaults, { workspace: { type: "custom", id: "keep-2" }, session: null });
    assert.deepEqual(config.settings, { showDefaultWorkspaceIcon: false, showDefaultSessionIcon: true });
  });
});

test("config writes above the 512KB cap fail with 413 and leave the file intact", async () => {
  await withHost({}, async (host) => {
    const seeded = emptyConfig();
    const body = "x".repeat(29_000);
    for (let index = 0; index < 17; index += 1) {
      seeded.customIcons.push({
        id: `bulk-${index}`,
        name: `Bulk ${index}`,
        kind: "svg",
        svg: `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`,
      });
    }
    await seedConfig(host.dataDir, seeded);
    const before = await readFile(join(host.dataDir, "config.json"));
    assert.ok(before.length < __test.MAX_CONFIG_BYTES, `seed file too large: ${before.length}`);

    const tooLargeSvg = `<svg xmlns="http://www.w3.org/2000/svg">${"y".repeat(40_000)}</svg>`;
    const result = await host.post("/custom-icons", { name: "Overflow", kind: "svg", svg: tooLargeSvg });
    assert.equal(result.status, 413);
    assert.equal(result.json.error.code, "config-too-large");

    const after = await readFile(join(host.dataDir, "config.json"));
    assert.equal(after.length, before.length, "failed write must not touch config.json");
    const files = await readdir(host.dataDir);
    assert.deepEqual(files, ["config.json"], "failed write must clean up its temp file");
  });
});

/* -------------------------------------------------------------------------- */
/* unit cover for helpers                                                     */
/* -------------------------------------------------------------------------- */

test("validateRef normalizes every supported reference shape", () => {
  const config = emptyConfig();
  config.libraries.iconify.push({ prefix: "demo", title: "Demo", total: 5, linkedAt: "2026-01-01T00:00:00.000Z" });
  config.customIcons.push({ id: "icon-1", name: "One", kind: "svg", svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' });

  assert.equal(validateRef(null, config), null);
  assert.deepEqual(validateRef({ type: "builtin", name: "rocket" }, config), { type: "builtin", name: "rocket" });
  assert.deepEqual(validateRef({ type: "iconify", prefix: "demo", name: "home" }, config), {
    type: "iconify",
    prefix: "demo",
    name: "home",
  });
  assert.deepEqual(validateRef({ type: "custom", id: "icon-1" }, config), { type: "custom", id: "icon-1" });

  assert.throws(() => validateRef({ type: "builtin", name: "not a name" }, config), /内置图标名/);
  assert.throws(() => validateRef({ type: "iconify", prefix: "other", name: "home" }, config), /尚未关联/);
  // emoji 图标类型已下线。
  assert.throws(() => validateRef({ type: "emoji", value: "🧭" }, config), /不支持的图标类型/);
});

test("sanitizeSvg removes active content but keeps drawing markup", () => {
  const clean = sanitizeSvg(
    [
      "\uFEFF<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\" ONLOAD=\"evil()\">",
      "<script>x()</script>",
      "<foreignObject><iframe/></foreignObject>",
      '<a xlink:href="javascript:alert(1)"><path d="M0 0"/></a>',
      "</svg>",
    ].join(""),
  );
  assert.ok(clean.startsWith("<svg"));
  assert.match(clean, /<path d="M0 0"\/>/);
  assert.equal(/script/i.test(clean), false);
  assert.equal(/foreignObject/i.test(clean), false);
  assert.equal(/onload/i.test(clean), false);
  assert.equal(/javascript:/i.test(clean), false);
});

test("normalizeLoadedConfig rejects unrecognizable payloads", () => {
  assert.equal(normalizeLoadedConfig(null), null);
  assert.equal(normalizeLoadedConfig([]), null);
  assert.equal(normalizeLoadedConfig({ version: 2 }), null);
  const config = normalizeLoadedConfig({});
  assert.deepEqual(config, emptyConfig());
});
