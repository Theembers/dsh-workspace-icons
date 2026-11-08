/**
 * dsh-workspace-icons — host side.
 *
 * Provides the REST surface used by the Web client plus the on-disk store:
 *
 *   GET  /api/dsh-workspace-icons/state
 *   GET  /api/dsh-workspace-icons/iconify/search
 *   GET  /api/dsh-workspace-icons/iconify-svg
 *   GET  /api/dsh-workspace-icons/custom-svg
 *   POST /api/dsh-workspace-icons/workspace-icons
 *   POST /api/dsh-workspace-icons/defaults
 *   POST /api/dsh-workspace-icons/settings
 *   POST /api/dsh-workspace-icons/custom-icons
 *   POST /api/dsh-workspace-icons/custom-icons/delete
 *   POST /api/dsh-workspace-icons/iconify/link
 *   POST /api/dsh-workspace-icons/iconify/unlink
 *
 * Every JSON response is `{ ok: true, value }` or
 * `{ ok: false, error: { code, message, hint? } }`. Mutating requests must pass
 * the loopback + custom-header + same-origin check (`isTrustedAction`), exactly
 * like dsh-quick-tasks. State lives in
 * `~/.dsh/dsh-workspace-icons/config.json` (atomic temp-file + rename writes).
 */

import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { IconifyClient, IconifyError, PREFIX_RE, NAME_RE, iconDataUri, normalizeIconifyError } from "./iconify.js";

/** Where users can browse the full Iconify collection list. */
const ICONIFY_BROWSE_URL = "https://icon-sets.iconify.design/";

export const name = "dsh-workspace-icons";

/** Optional services: the plugin must still work when the registry is absent. */
export const inject = ["webServer"];

export const API = "/api/dsh-workspace-icons";

const TRUST_HEADER = "x-dsh-workspace-icons";
const CONFIG_VERSION = 1;

/** Limits from task-1. */
const MAX_CONFIG_BYTES = 512 * 1024;
const MAX_SVG_BYTES = 64 * 1024;
const MAX_CUSTOM_ICONS = 200;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_WORKSPACE_ID_LENGTH = 256;
const MAX_ICON_NAME_LENGTH = 80;
const CUSTOM_ID_RE = /^[A-Za-z0-9_-]{2,80}$/;
const BUILTIN_NAME_RE = /^[a-z0-9-]{1,80}$/;

const ICON_TYPES = new Set(["builtin", "iconify", "custom"]);

/** Settings that accept a boolean. */
export const BOOL_SETTINGS = ["showDefaultWorkspaceIcon", "showDefaultSessionIcon"];


/** A request error with the HTTP status and stable error code to report. */
export class HttpError extends Error {
  /**
   * @param {number} status HTTP status.
   * @param {string} code stable machine-readable code.
   * @param {string} message human-readable (Chinese) message.
   * @param {string} [hint] optional remediation hint.
   */
  constructor(status, code, message, hint) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

function bad(status, code, message, hint) {
  return new HttpError(status, code, message, hint);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function dataDirOf(config) {
  if (config !== null && typeof config === "object" && typeof config.dataDir === "string" && config.dataDir !== "") {
    return config.dataDir;
  }
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, "dsh-workspace-icons");
}

/** The default (empty) persisted configuration. */
export function emptyConfig() {
  return {
    version: CONFIG_VERSION,
    libraries: { iconify: [] },
    customIcons: [],
    workspaceIcons: {},
    defaults: { workspace: null, session: null },
    settings: {
      showDefaultWorkspaceIcon: true,
      showDefaultSessionIcon: true,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* ref validation                                                             */
/* -------------------------------------------------------------------------- */

function badIcon(message, hint) {
  return bad(400, "bad-icon", message, hint);
}

function normalizeBuiltinName(value) {
  if (typeof value !== "string" || !BUILTIN_NAME_RE.test(value)) {
    throw badIcon("内置图标名必须匹配 ^[a-z0-9-]{1,80}$");
  }
  return value;
}

/**
 * Validate and normalize one icon reference.
 *
 * @param {unknown} input raw reference (`null` clears).
 * @param {object} config current configuration (needed for linkage checks).
 * @returns {null | {type: "builtin", name: string} | {type: "iconify", prefix: string, name: string}
 *   | {type: "custom", id: string}}
 */
export function validateRef(input, config) {
  if (input === null) return null;
  if (input === undefined) throw badIcon("缺少图标引用");
  if (typeof input !== "object" || Array.isArray(input)) throw badIcon("图标引用格式不正确");
  const type = input.type;
  if (typeof type !== "string" || !ICON_TYPES.has(type)) {
    throw badIcon(`不支持的图标类型：${type === undefined ? "(缺失)" : String(type)}`);
  }
  switch (type) {
    case "builtin":
      return { type, name: normalizeBuiltinName(input.name) };
    case "iconify": {
      if (typeof input.prefix !== "string" || !PREFIX_RE.test(input.prefix)) {
        throw badIcon("Iconify prefix 必须匹配 ^[a-z0-9-]{1,80}$");
      }
      const linked = config?.libraries?.iconify?.some((entry) => entry?.prefix === input.prefix);
      if (!linked) {
        throw bad(400, "prefix-not-linked", `Iconify 图标库“${input.prefix}”尚未关联`, "请先在设置中关联该图标库");
      }
      if (typeof input.name !== "string" || !NAME_RE.test(input.name)) {
        throw badIcon("Iconify 图标名必须匹配 ^[a-z0-9-]{1,80}$");
      }
      return { type, prefix: input.prefix, name: input.name };
    }
    case "custom": {
      if (typeof input.id !== "string" || !CUSTOM_ID_RE.test(input.id)) {
        throw badIcon("自定义图标 id 格式不正确");
      }
      const exists = config?.customIcons?.some((entry) => entry?.id === input.id);
      if (!exists) {
        throw bad(400, "unknown-custom-icon", `自定义图标“${input.id}”不存在`);
      }
      return { type, id: input.id };
    }
    /* c8 ignore next 2 */
    default:
      throw badIcon(`不支持的图标类型：${String(type)}`);
  }
}

function tryValidateRef(input, config) {
  try {
    return validateRef(input, config);
  } catch {
    return undefined;
  }
}

function normalizeWorkspaceId(value) {
  if (typeof value !== "string") throw bad(400, "bad-workspace", "workspaceId 必须是字符串");
  const id = value.trim();
  if (id === "" || id.length > MAX_WORKSPACE_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(id)) {
    throw bad(400, "bad-workspace", `workspaceId 需为非空字符串（≤ ${MAX_WORKSPACE_ID_LENGTH} 字符）`);
  }
  return id;
}

function normalizeIconName(value) {
  if (typeof value !== "string") throw bad(400, "bad-name", "图标名称必须是字符串");
  const text = value.trim();
  if (text === "" || Array.from(text).length > MAX_ICON_NAME_LENGTH) {
    throw bad(400, "bad-name", `图标名称长度需在 1–${MAX_ICON_NAME_LENGTH} 之间`);
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) throw bad(400, "bad-name", "图标名称不能包含控制字符");
  return text;
}

function normalizeCustomId(value) {
  if (typeof value !== "string" || !CUSTOM_ID_RE.test(value)) {
    throw bad(400, "bad-id", "自定义图标 id 格式不正确");
  }
  return value;
}

function requirePrefix(value) {
  if (typeof value !== "string" || !PREFIX_RE.test(value)) {
    throw bad(400, "bad-prefix", "prefix 必须匹配 ^[a-z0-9-]{1,80}$");
  }
  return value;
}

function requireIconName(value) {
  if (typeof value !== "string" || !NAME_RE.test(value)) {
    throw bad(400, "bad-icon-name", "图标名必须匹配 ^[a-z0-9-]{1,80}$");
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* SVG handling                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Remove active content from an SVG: scripts, foreignObject subtrees, inline
 * event handlers, `javascript:` URLs and HTML data URLs. The result is still
 * the author's SVG, minus the parts that could execute code.
 *
 * @param {string} input raw SVG markup.
 * @returns {string} sanitized markup.
 */
export function sanitizeSvg(input) {
  let svg = String(input).replace(/^\uFEFF/, "");
  // A leading XML declaration or comment is legal SVG but not part of the root element.
  svg = svg.replace(/<\?xml[\s\S]*?\?>/gi, "");
  svg = svg.replace(/<!--[\s\S]*?-->/g, "");
  // Scripts and foreignObject can both carry executable content.
  svg = svg.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  svg = svg.replace(/<\/?script\b[^>]*>/gi, "");
  svg = svg.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, "");
  svg = svg.replace(/<\/?foreignObject\b[^>]*>/gi, "");
  // Inline event handlers (`onload=`, `onclick=`, ...).
  svg = svg.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // URL schemes that can execute.
  svg = svg.replace(/javascript\s*:/gi, "");
  svg = svg.replace(/data\s*:\s*text\/html/gi, "");
  return svg.trim();
}

/** Validate, sanitize and size-check an uploaded SVG. */
function normalizeSvg(input) {
  if (typeof input !== "string" || input.trim() === "") throw bad(400, "bad-svg", "SVG 内容必须是非空字符串");
  const svg = sanitizeSvg(input);
  if (!/^<svg[\s>]/i.test(svg)) throw bad(400, "bad-svg", "SVG 内容必须以 <svg 开头");
  const bytes = Buffer.byteLength(svg, "utf8");
  if (bytes > MAX_SVG_BYTES) {
    throw bad(413, "svg-too-large", `SVG 超过 ${MAX_SVG_BYTES} 字节上限`);
  }
  return svg;
}

/* -------------------------------------------------------------------------- */
/* configuration store                                                        */
/* -------------------------------------------------------------------------- */

function isValidSvgRecord(record) {
  if (record === null || typeof record !== "object") return false;
  if (typeof record.svg !== "string") return false;
  if (!/^<svg[\s>]/i.test(record.svg.trim())) return false;
  return Buffer.byteLength(record.svg, "utf8") <= MAX_SVG_BYTES;
}

/**
 * Normalize a config object read from disk. Returns `null` when the payload is
 * structurally unrecognizable (the caller then backs it up and starts fresh).
 * Individually invalid entries are dropped instead of discarding everything.
 */
export function normalizeLoadedConfig(parsed) {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (hasOwn(parsed, "version") && parsed.version !== CONFIG_VERSION) return null;

  const config = emptyConfig();

  const libraries = parsed.libraries?.iconify;
  if (Array.isArray(libraries)) {
    const seen = new Set();
    for (const raw of libraries) {
      if (raw === null || typeof raw !== "object") continue;
      const prefix = typeof raw.prefix === "string" ? raw.prefix : "";
      if (!PREFIX_RE.test(prefix) || seen.has(prefix)) continue;
      seen.add(prefix);
      config.libraries.iconify.push({
        prefix,
        title: typeof raw.title === "string" && raw.title.trim() !== "" ? raw.title.trim() : prefix,
        total: Number.isFinite(raw.total) ? raw.total : 0,
        linkedAt: typeof raw.linkedAt === "string" ? raw.linkedAt : new Date(0).toISOString(),
      });
    }
  }

  if (Array.isArray(parsed.customIcons)) {
    const seen = new Set();
    for (const raw of parsed.customIcons) {
      if (raw === null || typeof raw !== "object") continue;
      if (config.customIcons.length >= MAX_CUSTOM_ICONS) break;
      if (typeof raw.id !== "string" || !CUSTOM_ID_RE.test(raw.id) || seen.has(raw.id)) continue;
      let name;
      try {
        name = normalizeIconName(raw.name);
      } catch {
        continue;
      }
      if (raw.kind === "svg") {
        if (!isValidSvgRecord(raw)) continue;
        seen.add(raw.id);
        config.customIcons.push({ id: raw.id, name, kind: "svg", svg: raw.svg });
      }
    }
  }

  if (parsed.workspaceIcons !== null && typeof parsed.workspaceIcons === "object" && !Array.isArray(parsed.workspaceIcons)) {
    for (const [key, raw] of Object.entries(parsed.workspaceIcons)) {
      let workspaceId;
      try {
        workspaceId = normalizeWorkspaceId(key);
      } catch {
        continue;
      }
      const ref = tryValidateRef(raw, config);
      if (ref !== undefined && ref !== null) config.workspaceIcons[workspaceId] = ref;
    }
  }

  if (parsed.defaults !== null && typeof parsed.defaults === "object" && !Array.isArray(parsed.defaults)) {
    for (const key of ["workspace", "session"]) {
      if (!hasOwn(parsed.defaults, key)) continue;
      const ref = tryValidateRef(parsed.defaults[key], config);
      if (ref !== undefined) config.defaults[key] = ref;
    }
  }

  if (parsed.settings !== null && typeof parsed.settings === "object" && !Array.isArray(parsed.settings)) {
    for (const key of BOOL_SETTINGS) {
      if (typeof parsed.settings[key] === "boolean") config.settings[key] = parsed.settings[key];
    }
  }

  return config;
}

/**
 * Serialized, atomic config store.
 *
 * All reads and writes go through one promise chain so concurrent requests
 * cannot lose updates. Writes serialize first, enforce the byte cap, then
 * `writeFile` to a same-directory temp file and `rename` it into place.
 */
export function createStore(options = {}) {
  const dataDir = options.dataDir;
  const configPath = join(dataDir, "config.json");
  const logger = options.logger ?? null;
  let snapshot = null;
  let tail = Promise.resolve();

  async function resetCorrupt(reason) {
    const backup = `${configPath}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try {
      await rename(configPath, backup);
      logger?.warn?.(`dsh-workspace-icons: 配置无法识别（${reason}），已备份到 ${backup}`);
    } catch (error) {
      logger?.warn?.("dsh-workspace-icons: 备份损坏配置失败", error);
    }
    return emptyConfig();
  }

  async function readConfigFile() {
    let text;
    try {
      text = await readFile(configPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return emptyConfig();
      throw error;
    }
    if (Buffer.byteLength(text, "utf8") > MAX_CONFIG_BYTES) return resetCorrupt("文件体积超过上限");
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return resetCorrupt("JSON 解析失败");
    }
    const normalized = normalizeLoadedConfig(parsed);
    if (normalized === null) return resetCorrupt("配置结构无法识别");
    return normalized;
  }

  async function load() {
    if (snapshot !== null) return snapshot;
    snapshot = await readConfigFile();
    return snapshot;
  }

  async function save(config) {
    const text = `${JSON.stringify(config, null, 2)}\n`;
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > MAX_CONFIG_BYTES) {
      throw bad(413, "config-too-large", "配置体积超过 512KB 上限", "请删除部分自定义图标或取消关联的图标库");
    }
    await mkdir(dataDir, { recursive: true });
    const tmp = join(dataDir, `.config.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    await writeFile(tmp, text, "utf8");
    try {
      await rename(tmp, configPath);
    } catch (error) {
      await unlink(tmp).catch(() => {});
      throw error;
    }
    snapshot = config;
    return config;
  }

  return {
    dataDir,
    configPath,

    /** Read a private copy of the current config, waiting for pending writes. */
    async read() {
      await tail;
      return clone(await load());
    },

    /** Read-modify-write under the store's lock; `fn` may throw to abort. */
    async mutate(fn) {
      const run = tail.then(async () => {
        const config = clone(await load());
        const value = await fn(config);
        await save(config);
        return value;
      });
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* workspace registry (optional)                                              */
/* -------------------------------------------------------------------------- */

function registryOf(target) {
  if (target === null || typeof target !== "object") return null;
  try {
    if (typeof target.get === "function") {
      const viaGet = target.get("workspaceRegistry");
      if (viaGet !== null && typeof viaGet === "object") return viaGet;
    }
  } catch {
    /* service not available in this context */
  }
  const direct = target.workspaceRegistry;
  return direct !== null && typeof direct === "object" ? direct : null;
}

/* -------------------------------------------------------------------------- */
/* request helpers                                                            */
/* -------------------------------------------------------------------------- */

function parseUrl(request) {
  try {
    return new URL(typeof request.url === "string" && request.url !== "" ? request.url : "/", "http://dsh.local");
  } catch {
    throw bad(400, "bad-request", "无法解析请求 URL");
  }
}

/** Loopback-only, custom-header, same-origin check (mirrors dsh-quick-tasks). */
export function isTrustedAction(request) {
  try {
    const headers = request.headers ?? {};
    const remote = (request.socket && request.socket.remoteAddress) || "";
    const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    if (!loopback) return false;
    if (headers[TRUST_HEADER] !== "1") return false;
    const site = headers["sec-fetch-site"];
    if (site !== undefined && site !== "" && site !== "same-origin") return false;
    const host = headers.host;
    if (typeof host !== "string" || host === "") return false;
    const origin = headers.origin;
    if (origin !== undefined && origin !== "") {
      let originHost;
      try {
        originHost = new URL(origin).host;
      } catch {
        return false;
      }
      if (originHost !== host) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse a JSON request body.
 * @param {import("node:http").IncomingMessage} request
 * @param {number} limit maximum body size in bytes.
 */
export function readJsonBody(request, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      request.destroy?.();
      reject(error);
    };
    request.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        fail(bad(413, "body-too-large", "请求体过大"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (text === "") {
        resolve({});
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        reject(bad(400, "bad-json", "请求体不是合法 JSON"));
        return;
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        reject(bad(400, "bad-json", "请求体必须是 JSON 对象"));
        return;
      }
      resolve(parsed);
    });
    request.on("error", (error) => fail(error));
  });
}

function sendJson(response, statusCode, value, head = false) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  if (head) response.end();
  else response.end(body);
}

function sendSvg(response, svg, cacheControl, head = false) {
  const body = Buffer.from(svg, "utf8");
  response.writeHead(200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
  });
  if (head) response.end();
  else response.end(body);
}

function toHttpError(error, logger) {
  if (error instanceof HttpError) return error;
  if (error instanceof IconifyError) {
    if (error.status === 404) return new HttpError(404, "not-found", "Iconify 上不存在该图标");
    return new HttpError(502, error.code || "iconify-unavailable", error.message, error.hint);
  }
  logger?.warn?.("dsh-workspace-icons: 未预期的错误", error);
  return new HttpError(500, "internal", "插件内部错误");
}

/* -------------------------------------------------------------------------- */
/* service                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Create the host service (route table + handlers) without a Cordis context
 * side effect. `apply()` below wires it to `ctx.webServer`.
 */
export function createService(options = {}) {
  const config = options.config ?? {};
  const logger = options.logger ?? null;
  const dataDir = options.dataDir ?? dataDirOf(config);
  const store = createStore({ dataDir, logger });
  const iconify = new IconifyClient({
    cacheDir: join(dataDir, "cache"),
    fetchImpl: options.fetchImpl ?? config.fetchImpl,
    now: options.now,
    timeoutMs: options.iconifyTimeoutMs ?? config.iconifyTimeoutMs,
    logger,
  });

  /** @type {object | null} registry captured through ctx.inject(["workspaceRegistry"], ...) */
  let injectedRegistry = null;
  const baseCtx = options.ctx ?? null;

  function registry() {
    return injectedRegistry ?? registryOf(baseCtx);
  }

  async function listWorkspaces() {
    const source = registry();
    if (source === null) return [];
    try {
      const raw = typeof source.list === "function" ? await source.list.call(source) : source.workspaces;
      if (raw === null || raw === undefined) return [];
      const rows = Array.isArray(raw) ? raw : [...raw];
      const workspaces = [];
      const seen = new Set();
      for (const workspace of rows) {
        if (workspace === null || typeof workspace !== "object") continue;
        const id = workspace.id ?? workspace.workspaceId ?? workspace.key;
        if (id === undefined || id === null) continue;
        const workspaceId = String(id).trim();
        if (workspaceId === "" || seen.has(workspaceId)) continue;
        seen.add(workspaceId);
        const path = typeof workspace.path === "string" ? workspace.path : "";
        const titleCandidate = workspace.title ?? workspace.name;
        const title = typeof titleCandidate === "string" && titleCandidate.trim() !== "" ? titleCandidate.trim() : path || workspaceId;
        workspaces.push({ workspaceId, title, path });
      }
      return workspaces;
    } catch (error) {
      logger?.warn?.("dsh-workspace-icons: 工作区列表不可用", error);
      return [];
    }
  }

  const handlers = {
    async state() {
      return { config: await store.read(), workspaces: await listWorkspaces() };
    },

    async iconifySearch({ url }) {
      const prefix = requirePrefix(url.searchParams.get("prefix"));
      const query = (url.searchParams.get("q") ?? "").trim();
      const rawLimit = url.searchParams.get("limit");
      let limit = 96;
      if (rawLimit !== null && rawLimit !== "") {
        limit = Number.parseInt(rawLimit, 10);
        if (!Number.isFinite(limit) || limit < 1) throw bad(400, "bad-request", "limit 必须是正整数");
      }
      limit = Math.min(limit, 200);
      const found = await iconify.search(prefix, query, limit);
      // 整页图标一次上游请求取回（Iconify 按 IP 限流，逐个请求会大面积失败）。
      let bundle = null;
      try {
        bundle = await iconify.bundle(prefix, found.icons);
      } catch (error) {
        logger?.warn?.("dsh-workspace-icons: 批量获取图标失败，回退为逐个请求", prefix, error);
      }
      const icons = found.icons.map((name) => ({ name, svg: iconDataUri(bundle, name) }));
      return { prefix: found.prefix, title: found.title, total: found.total, icons };
    },

    async iconifyCollections({ url }) {
      const query = (url.searchParams.get("q") ?? "").trim();
      const rawLimit = url.searchParams.get("limit");
      let limit = 60;
      if (rawLimit !== null && rawLimit !== "") {
        limit = Number.parseInt(rawLimit, 10);
        if (!Number.isFinite(limit) || limit < 1) throw bad(400, "bad-request", "limit 必须是正整数");
      }
      limit = Math.min(limit, 200);
      let collections;
      try {
        collections = await iconify.searchCollections(query, limit);
      } catch (error) {
        throw toHttpError(error, logger);
      }
      return { collections, browseUrl: ICONIFY_BROWSE_URL };
    },

    async iconifySvg({ url, response, head }) {
      const prefix = requirePrefix(url.searchParams.get("prefix"));
      const iconName = requireIconName(url.searchParams.get("name"));
      let svg;
      try {
        svg = await iconify.svg(prefix, iconName);
      } catch (error) {
        throw toHttpError(error, logger);
      }
      sendSvg(response, svg, "public, max-age=86400, immutable", head);
    },

    async customSvg({ url, response, head }) {
      const id = normalizeCustomId(url.searchParams.get("id"));
      const current = await store.read();
      const icon = current.customIcons.find((entry) => entry.id === id);
      if (icon === undefined || icon.kind !== "svg") throw bad(404, "not-found", "自定义图标不存在");
      sendSvg(response, icon.svg, "public, max-age=300", head);
    },

    async workspaceIcons({ body }) {
      if (!hasOwn(body, "icon")) throw bad(400, "bad-request", "缺少 icon 字段（传 null 表示清除）");
      const workspaceId = normalizeWorkspaceId(body.workspaceId);
      return await store.mutate((current) => {
        const icon = validateRef(body.icon, current);
        if (icon === null) delete current.workspaceIcons[workspaceId];
        else current.workspaceIcons[workspaceId] = icon;
        return { workspaceId, icon };
      });
    },

    async defaults({ body }) {
      return await store.mutate((current) => {
        const patch = {};
        let touched = false;
        for (const key of ["workspace", "session"]) {
          if (!hasOwn(body, key)) continue;
          patch[key] = validateRef(body[key], current);
          touched = true;
        }
        if (!touched) throw bad(400, "bad-request", "至少需要提供 workspace 或 session");
        current.defaults = { ...current.defaults, ...patch };
        return { defaults: clone(current.defaults) };
      });
    },

    async settings({ body }) {
      return await store.mutate((current) => {
        const patch = {};
        let touched = false;
        for (const key of BOOL_SETTINGS) {
          if (!hasOwn(body, key)) continue;
          if (typeof body[key] !== "boolean") throw bad(400, "bad-settings", `${key} 必须是布尔值`);
          patch[key] = body[key];
          touched = true;
        }
        if (!touched) throw bad(400, "bad-request", "至少需要提供一个设置项");
        current.settings = { ...current.settings, ...patch };
        return { settings: clone(current.settings) };
      });
    },

    async customIcons({ body }) {
      const iconName = normalizeIconName(body.name);
      const kind = body.kind;
      if (kind !== "svg") throw bad(400, "bad-kind", 'kind 必须是 "svg"');
      return await store.mutate((current) => {
        if (current.customIcons.length >= MAX_CUSTOM_ICONS) {
          throw bad(409, "too-many-icons", `自定义图标数量已达上限（${MAX_CUSTOM_ICONS}）`);
        }
        const id = randomUUID();
        const icon = { id, name: iconName, kind, svg: normalizeSvg(body.svg) };
        current.customIcons.push(icon);
        return { id, icon: clone(icon), customIcons: clone(current.customIcons) };
      });
    },

    async customIconsDelete({ body }) {
      const id = normalizeCustomId(body.id);
      return await store.mutate((current) => {
        const index = current.customIcons.findIndex((entry) => entry.id === id);
        if (index === -1) return { id, removed: false, customIcons: clone(current.customIcons) };
        current.customIcons.splice(index, 1);
        let cleaned = 0;
        for (const [workspaceId, ref] of Object.entries(current.workspaceIcons)) {
          if (ref?.type === "custom" && ref.id === id) {
            delete current.workspaceIcons[workspaceId];
            cleaned += 1;
          }
        }
        for (const key of ["workspace", "session"]) {
          const ref = current.defaults[key];
          if (ref?.type === "custom" && ref.id === id) {
            current.defaults[key] = null;
            cleaned += 1;
          }
        }
        return { id, removed: true, cleaned, customIcons: clone(current.customIcons) };
      });
    },

    async iconifyLink({ body }) {
      const prefix = requirePrefix(body.prefix);
      let collection;
      try {
        collection = await iconify.collection(prefix);
      } catch (error) {
        throw toHttpError(error, logger);
      }
      const title = collection.title !== "" ? collection.title : prefix;
      return await store.mutate((current) => {
        const entry = {
          prefix,
          title,
          total: collection.total,
          linkedAt: new Date().toISOString(),
        };
        const index = current.libraries.iconify.findIndex((item) => item.prefix === prefix);
        if (index === -1) current.libraries.iconify.push(entry);
        else current.libraries.iconify[index] = { ...current.libraries.iconify[index], title, total: entry.total };
        return {
          prefix,
          title,
          total: entry.total,
          linkedAt: current.libraries.iconify.find((item) => item.prefix === prefix)?.linkedAt,
          libraries: clone(current.libraries.iconify),
        };
      });
    },

    async iconifyUnlink({ body }) {
      const prefix = requirePrefix(body.prefix);
      return await store.mutate((current) => {
        const before = current.libraries.iconify.length;
        current.libraries.iconify = current.libraries.iconify.filter((item) => item.prefix !== prefix);
        let cleaned = 0;
        for (const [workspaceId, ref] of Object.entries(current.workspaceIcons)) {
          if (ref?.type === "iconify" && ref.prefix === prefix) {
            delete current.workspaceIcons[workspaceId];
            cleaned += 1;
          }
        }
        for (const key of ["workspace", "session"]) {
          const ref = current.defaults[key];
          if (ref?.type === "iconify" && ref.prefix === prefix) {
            current.defaults[key] = null;
            cleaned += 1;
          }
        }
        return {
          prefix,
          removed: current.libraries.iconify.length !== before,
          cleaned,
          libraries: clone(current.libraries.iconify),
        };
      });
    },
  };

  const routes = [
    { suffix: "/state", method: "GET", raw: false, run: handlers.state },
    { suffix: "/iconify/search", method: "GET", raw: false, run: handlers.iconifySearch },
    { suffix: "/iconify/collections", method: "GET", raw: false, run: handlers.iconifyCollections },
    { suffix: "/iconify-svg", method: "GET", raw: true, run: handlers.iconifySvg },
    { suffix: "/custom-svg", method: "GET", raw: true, run: handlers.customSvg },
    { suffix: "/workspace-icons", method: "POST", raw: false, run: handlers.workspaceIcons },
    { suffix: "/defaults", method: "POST", raw: false, run: handlers.defaults },
    { suffix: "/settings", method: "POST", raw: false, run: handlers.settings },
    { suffix: "/custom-icons", method: "POST", raw: false, run: handlers.customIcons },
    { suffix: "/custom-icons/delete", method: "POST", raw: false, run: handlers.customIconsDelete },
    { suffix: "/iconify/link", method: "POST", raw: false, run: handlers.iconifyLink },
    { suffix: "/iconify/unlink", method: "POST", raw: false, run: handlers.iconifyUnlink },
  ];

  /**
   * One HTTP handler for one route. Errors always become the documented
   * `{ ok: false, error }` envelope.
   */
  function createHandler(route) {
    return async function handler(request, response) {
      const method = String(request.method ?? "GET").toUpperCase();
      const head = method === "HEAD";
      try {
        if (route.method === "POST") {
          if (method !== "POST") throw bad(405, "method-not-allowed", "仅支持 POST");
          if (!isTrustedAction(request)) {
            throw bad(403, "forbidden", "请求未通过同源校验", "请从 DSH 页面内操作");
          }
        } else if (method !== "GET" && method !== "HEAD") {
          throw bad(405, "method-not-allowed", "仅支持 GET");
        }
        const url = parseUrl(request);
        const body = route.method === "POST" ? await readJsonBody(request) : undefined;
        const value = await route.run({ request, response, url, body, head });
        if (route.raw) return;
        sendJson(response, 200, { ok: true, value: value === undefined ? null : value }, head);
      } catch (error) {
        const httpError = toHttpError(error, logger);
        if (response.headersSent === true) {
          try {
            response.end();
          } catch {
            /* connection already gone */
          }
          return;
        }
        const payload = {
          ok: false,
          error: {
            code: httpError.code,
            message: httpError.message,
            ...(httpError.hint === undefined ? {} : { hint: httpError.hint }),
          },
        };
        sendJson(response, httpError.status, payload, head);
      }
    };
  }

  return {
    API,
    dataDir,
    configPath: store.configPath,
    store,
    iconify,
    routes,
    listWorkspaces,
    createHandler,
    /** Attach a registry captured by `ctx.inject(["workspaceRegistry"], ...)`. */
    attachRegistry(value) {
      injectedRegistry = value ?? null;
    },
    get registry() {
      return registry();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Cordis plugin entry                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Cordis plugin entry point.
 *
 * Routes are registered through `ctx.effect()` so they are disposed with the
 * plugin, matching dsh-quick-tasks. `workspaceRegistry` is optional: when the
 * service is missing (or the deployment exposes none) `/state` returns an empty
 * workspace list instead of failing.
 *
 * @param {object} ctx Cordis context (must expose `webServer`).
 * @param {object} [config] plugin config from cordis.patch.yml.
 */
export function apply(ctx, config = {}) {
  const logger = ctx?.logger ?? null;
  const service = createService({ ctx, config, logger });

  if (typeof ctx?.inject === "function") {
    try {
      ctx.inject(["workspaceRegistry"], (scope) => {
        service.attachRegistry(registryOf(scope));
      });
    } catch (error) {
      logger?.warn?.("dsh-workspace-icons: 无法注入 workspaceRegistry", error);
    }
  }

  const disposers = [];
  for (const route of service.routes) {
    const handler = service.createHandler(route);
    const register = () =>
      ctx.webServer.register({
        kind: "exact",
        path: `${API}${route.suffix}`,
        handler,
      });
    const label = `dsh-workspace-icons:${route.suffix}`;
    if (typeof ctx.effect === "function") disposers.push(ctx.effect(register, label));
    else disposers.push(register());
  }
  return { service, disposers };
}

/* -------------------------------------------------------------------------- */
/* test hooks                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Helpers for `scripts/host.test.mjs`. The client never imports this module
 * (only `lib/client.js` is shipped to the browser), so exporting them is safe.
 */
export const __test = {
  API,
  TRUST_HEADER,
  MAX_CONFIG_BYTES,
  MAX_SVG_BYTES,
  MAX_CUSTOM_ICONS,
  MAX_BODY_BYTES,
  HttpError,
  createService,
  createStore,
  emptyConfig,
  normalizeLoadedConfig,
  sanitizeSvg,
  normalizeSvg,
  validateRef,
  isTrustedAction,
  readJsonBody,
  listWorkspacesOf: (service) => service.listWorkspaces(),
};
