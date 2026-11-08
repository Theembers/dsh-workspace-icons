/**
 * Iconify access for dsh-workspace-icons.
 *
 * Two read-only operations are needed by the host plugin:
 *
 * - collection metadata (`/collection?prefix=...`) to know an icon set's title,
 *   total icon count and its icon names (used by the settings search box), and
 * - one icon SVG (`/{prefix}/{name}.svg`) for the icon previews.
 *
 * Both are cached on disk below the plugin data directory. Collections expire
 * after 24 hours; SVGs after 24 hours as well, but a stale SVG is still served
 * when the network is unavailable, because an outdated icon is much better than
 * a broken one. Timeouts are 10 seconds.
 */

import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const ICONIFY_API = "https://api.iconify.design";

/** Iconify prefix / icon name shape accepted everywhere (task-1: ^[a-z0-9-]{1,80}$). */
export const PREFIX_RE = /^[a-z0-9-]{1,80}$/;
export const NAME_RE = /^[a-z0-9-]{1,80}$/;

export const COLLECTION_TTL_MS = 24 * 60 * 60 * 1000;
/** Iconify 对单个 IP 限流，整页图标必须一次上游请求取回，所以批量上限给足。 */
export const BUNDLE_MAX = 200;
export const BUNDLE_TTL_MS = 24 * 60 * 60 * 1000;
export const SVG_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_TIMEOUT_MS = 10_000;

/** An Iconify failure with the HTTP status this plugin should answer with. */
export class IconifyError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "IconifyError";
    this.code = code;
    this.status = options.status ?? 502;
    this.upstreamStatus = options.upstreamStatus;
    this.hint = options.hint;
  }
}

/**
 * Parse an Iconify `/collection` payload into the flat shape this plugin uses.
 * Icon names can live in `uncategorized`, in per-category lists and in
 * `aliases`; all three are flattened and de-duplicated.
 *
 * @param {string | object} payload raw response text or an already parsed object.
 * @returns {{prefix: string, title: string, total: number, icons: string[]} | null}
 */
export function parseCollection(payload) {
  let data = payload;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;

  const names = new Set();
  const add = (list) => {
    if (!Array.isArray(list)) return;
    for (const name of list) if (typeof name === "string" && NAME_RE.test(name)) names.add(name);
  };
  add(data.uncategorized);
  if (data.categories !== null && typeof data.categories === "object") {
    for (const list of Object.values(data.categories)) add(list);
  }
  if (data.aliases !== null && typeof data.aliases === "object") {
    for (const name of Object.keys(data.aliases)) if (NAME_RE.test(name)) names.add(name);
  }

  const icons = [...names];
  const total = Number.isFinite(data.total) ? data.total : icons.length;
  const title = typeof data.title === "string" && data.title.trim() !== "" ? data.title.trim() : "";
  return {
    prefix: typeof data.prefix === "string" ? data.prefix : "",
    title,
    total,
    icons,
  };
}

/**
 * Parse an Iconify icon bundle (`/{prefix}.json?icons=a,b,c`).
 *
 * @param {string | object} payload raw response text or an already parsed object.
 * @returns {{prefix: string, width: number, height: number, icons: Record<string, string>, aliases: Record<string, string>} | null}
 */
export function parseIconBundle(payload) {
  let data = payload;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;

  const icons = {};
  const rawIcons = data.icons;
  if (rawIcons !== null && typeof rawIcons === "object" && !Array.isArray(rawIcons)) {
    for (const [name, entry] of Object.entries(rawIcons)) {
      if (!NAME_RE.test(name)) continue;
      const body = entry && typeof entry.body === "string" ? entry.body : "";
      if (body === "") continue;
      icons[name] = body;
    }
  }

  const aliases = {};
  const rawAliases = data.aliases;
  if (rawAliases !== null && typeof rawAliases === "object" && !Array.isArray(rawAliases)) {
    for (const [name, entry] of Object.entries(rawAliases)) {
      if (!NAME_RE.test(name)) continue;
      const parent = entry && typeof entry.parent === "string" ? entry.parent : "";
      if (parent === "") continue;
      aliases[name] = parent;
    }
  }

  const width = Number.isFinite(data.width) && data.width > 0 ? data.width : 24;
  const height = Number.isFinite(data.height) && data.height > 0 ? data.height : 24;
  return {
    prefix: typeof data.prefix === "string" ? data.prefix : "",
    width,
    height,
    icons,
    aliases,
  };
}

/**
 * Build a standalone SVG data URI for one icon of a bundle.
 *
 * @param {{width: number, height: number, icons: Record<string, string>, aliases: Record<string, string>}} bundle
 * @param {string} name icon name (an alias resolves to its parent icon).
 * @returns {string | null} data URI, or `null` when the icon is unknown.
 */
export function iconDataUri(bundle, name) {
  if (!bundle || typeof name !== "string" || name === "") return null;
  const body = bundle.icons[name] || bundle.icons[bundle.aliases[name]];
  if (!body) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bundle.width} ${bundle.height}">${body}</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/**
 * Parse the Iconify `/collections` payload (the catalog of every published
 * icon set) into a flat, searchable list.
 *
 * @param {string | object} payload raw response text or an already parsed object.
 * @returns {{prefix: string, title: string, total: number, author: string}[] | null}
 */
export function parseCollections(payload) {
  let data = payload;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;

  const out = [];
  for (const [prefix, entry] of Object.entries(data)) {
    if (!PREFIX_RE.test(prefix)) continue;
    if (entry === null || typeof entry !== "object") continue;
    // A set without a usable name is not a browsable collection; skip it.
    if (typeof entry.name !== "string" || entry.name === "") continue;
    const title = entry.name;
    const total = Number.isFinite(entry.total) ? entry.total : 0;
    const author = typeof entry.author?.name === "string" ? entry.author.name : "";
    out.push({ prefix, title, total, author });
  }
  out.sort((a, b) => b.total - a.total || a.prefix.localeCompare(b.prefix));
  return out;
}

/**
 * Filter the collection catalog by a free-text query (prefix, title or author).
 *
 * @param {{prefix: string, title: string, total: number, author: string}[]} collections
 * @param {string} query
 * @param {number} limit
 */
export function filterCollections(collections, query, limit) {
  const needle = (query || "").trim().toLowerCase();
  const max = Math.min(Math.max(Number.isFinite(limit) ? limit : 60, 1), 200);
  const out = [];
  for (const collection of collections) {
    if (out.length >= max) break;
    if (!needle) {
      out.push(collection);
      continue;
    }
    const haystack = `${collection.prefix} ${collection.title} ${collection.author}`.toLowerCase();
    if (haystack.includes(needle)) out.push(collection);
  }
  return out;
}

/** Map the query string to an ordered name list: prefix matches first, then substrings. */
export function filterIconNames(icons, query, limit) {
  const needle = String(query ?? "").trim().toLowerCase();
  let names = Array.isArray(icons) ? icons : [];
  if (needle !== "") {
    const startsWith = [];
    const contains = [];
    for (const name of names) {
      if (name.startsWith(needle)) startsWith.push(name);
      else if (name.includes(needle)) contains.push(name);
    }
    names = [...startsWith, ...contains];
  }
  return names.slice(0, limit);
}

/** Stable short hash of an icon-name list, used for the on-disk bundle cache. */
function shortHash(names) {
  return createHash("sha1").update(names.join(",")).digest("hex").slice(0, 16);
}

function assertShape(prefix, name) {
  if (typeof prefix !== "string" || !PREFIX_RE.test(prefix)) {
    throw new IconifyError("bad-prefix", "prefix 必须匹配 ^[a-z0-9-]{1,80}$", { status: 400 });
  }
  if (name !== undefined && (typeof name !== "string" || !NAME_RE.test(name))) {
    throw new IconifyError("bad-icon-name", "图标名必须匹配 ^[a-z0-9-]{1,80}$", { status: 400 });
  }
}

/**
 * Iconify API client with an on-disk cache.
 *
 * `cacheDir` is created lazily. `fetchImpl` is injectable so tests (and offline
 * diagnostics) never touch the network.
 */
export class IconifyClient {
  /**
   * @param {object} options
   * @param {string} options.cacheDir directory for cached JSON/SVG files.
   * @param {typeof fetch} [options.fetchImpl]
   * @param {number} [options.timeoutMs]
   * @param {() => number} [options.now] clock injection for TTL tests.
   * @param {{warn?: Function}} [options.logger]
   */
  constructor(options = {}) {
    this.cacheDir = options.cacheDir;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
    this.logger = options.logger ?? null;
  }

  /**
   * Fetch (or read from cache) one collection.
   * @returns {Promise<{prefix: string, title: string, total: number, icons: string[]}>}
   */
  async collection(prefix) {
    assertShape(prefix);
    const file = join(this.cacheDir, `collection-${prefix}.json`);
    const cached = await this.#readCache(file, COLLECTION_TTL_MS);
    if (cached !== null && cached.fresh) {
      const parsed = parseCollection(cached.text);
      if (parsed !== null) return parsed;
    }
    try {
      const text = await this.#request(`/collection?prefix=${encodeURIComponent(prefix)}`);
      const parsed = parseCollection(text);
      if (parsed === null) {
        throw new IconifyError("iconify-bad-payload", "Iconify 返回了无法识别的集合数据");
      }
      await this.#writeCache(file, text);
      return parsed;
    } catch (error) {
      // A stale cache is still useful when the upstream is unreachable.
      if (cached !== null) {
        const parsed = parseCollection(cached.text);
        if (parsed !== null) {
          this.logger?.warn?.("dsh-workspace-icons: 使用过期的 Iconify 集合缓存", prefix, error);
          return parsed;
        }
      }
      throw normalizeIconifyError(error);
    }
  }

  /**
   * Fetch several icons of one collection in a single upstream request.
   *
   * Iconify rate-limits per IP, so asking for one icon per request burns the
   * quota fast: a grid of 96 icons would fail most of the time. The
   * `/{prefix}.json?icons=a,b,c` endpoint returns every requested icon in one
   * payload, which keeps a full page to a single request.
   *
   * @param {string} prefix collection prefix.
   * @param {string[]} names icon names to fetch.
   * @returns {Promise<{prefix: string, width: number, height: number, icons: Record<string, string>, aliases: Record<string, string>}>}
   */
  async bundle(prefix, names) {
    assertShape(prefix);
    const list = [];
    const seen = new Set();
    for (const name of Array.isArray(names) ? names : []) {
      if (typeof name !== "string") continue;
      const clean = name.trim().toLowerCase();
      if (!NAME_RE.test(clean) || seen.has(clean)) continue;
      seen.add(clean);
      list.push(clean);
      if (list.length >= BUNDLE_MAX) break;
    }
    if (!list.length) return { prefix, width: 24, height: 24, icons: {}, aliases: {} };

    const file = join(this.cacheDir, `bundle-${prefix}-${shortHash(list)}.json`);
    const cached = await this.#readCache(file, BUNDLE_TTL_MS);
    if (cached !== null && cached.fresh) {
      const parsed = parseIconBundle(cached.text);
      if (parsed !== null) return parsed;
    }
    try {
      const text = await this.#request(`/${prefix}.json?icons=${encodeURIComponent(list.join(","))}`);
      const parsed = parseIconBundle(text);
      if (parsed === null) {
        throw new IconifyError("iconify-bad-payload", "Iconify 返回了无法识别的图标数据");
      }
      await this.#writeCache(file, text);
      return parsed;
    } catch (error) {
      // A stale bundle is still better than nothing.
      if (cached !== null) {
        const parsed = parseIconBundle(cached.text);
        if (parsed !== null) {
          this.logger?.warn?.("dsh-workspace-icons: 使用过期的 Iconify 图标包缓存", prefix, error);
          return parsed;
        }
      }
      throw normalizeIconifyError(error);
    }
  }

  /**
   * Fetch (or read from cache) one icon SVG.
   * @returns {Promise<string>} the raw SVG markup.
   */
  async svg(prefix, name) {
    assertShape(prefix, name);
    const file = join(this.cacheDir, `svg-${prefix}-${name}.svg`);
    const cached = await this.#readCache(file, SVG_TTL_MS);
    if (cached !== null && cached.fresh && isSvg(cached.text)) return cached.text;
    try {
      const text = await this.#request(`/${prefix}/${name}.svg`);
      if (!isSvg(text)) {
        throw new IconifyError("iconify-bad-payload", "Iconify 返回的内容不是 SVG");
      }
      await this.#writeCache(file, text);
      return text;
    } catch (error) {
      if (cached !== null && isSvg(cached.text)) {
        this.logger?.warn?.("dsh-workspace-icons: 使用过期的 Iconify SVG 缓存", prefix, name, error);
        return cached.text;
      }
      throw normalizeIconifyError(error);
    }
  }

  /**
   * Fetch (or read from cache) the catalog of every published Iconify set.
   * @returns {Promise<{prefix: string, title: string, total: number, author: string}[]>}
   */
  async collections() {
    const file = join(this.cacheDir, "collections.json");
    const cached = await this.#readCache(file, COLLECTION_TTL_MS);
    if (cached !== null && cached.fresh) {
      const parsed = parseCollections(cached.text);
      if (parsed !== null) return parsed;
    }
    try {
      const text = await this.#request("/collections");
      const parsed = parseCollections(text);
      if (parsed === null) {
        throw new IconifyError("iconify-bad-payload", "Iconify 返回了无法识别的图标库目录");
      }
      await this.#writeCache(file, text);
      return parsed;
    } catch (error) {
      if (cached !== null) {
        const parsed = parseCollections(cached.text);
        if (parsed !== null) {
          this.logger?.warn?.("dsh-workspace-icons: 使用过期的 Iconify 图标库目录缓存", error);
          return parsed;
        }
      }
      throw normalizeIconifyError(error);
    }
  }

  /**
   * Search the collection catalog by prefix, title or author.
   * @returns {Promise<{prefix: string, title: string, total: number, author: string}[]>}
   */
  async searchCollections(query, limit) {
    const collections = await this.collections();
    return filterCollections(collections, query, limit);
  }

  /**
   * Search one collection's icon names.
   * @returns {Promise<{prefix: string, title: string, total: number, icons: string[]}>}
   */
  async search(prefix, query, limit) {
    const collection = await this.collection(prefix);
    return {
      prefix: collection.prefix || prefix,
      title: collection.title || prefix,
      total: collection.total,
      icons: filterIconNames(collection.icons, query, limit),
    };
  }

  async #request(path) {
    const url = `${ICONIFY_API}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (typeof timer?.unref === "function") timer.unref();
    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: "application/json, image/svg+xml;q=0.9, */*;q=0.1" },
      });
      if (!response || response.ok !== true) {
        const status = typeof response?.status === "number" ? response.status : 0;
        if (status === 404) {
          throw new IconifyError("not-found", "Iconify 上不存在该图标", { status: 404, upstreamStatus: 404 });
        }
        throw new IconifyError("iconify-unavailable", `Iconify 请求失败（HTTP ${status}）`, {
          status: 502,
          upstreamStatus: status,
          hint: "请检查网络后重试",
        });
      }
      return await response.text();
    } catch (error) {
      if (error instanceof IconifyError) throw error;
      const aborted = error?.name === "AbortError";
      throw new IconifyError(
        "iconify-unavailable",
        aborted ? "Iconify 请求超时" : "无法连接 Iconify",
        { status: 502, hint: "请检查网络后重试" },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async #readCache(file, ttlMs) {
    try {
      const info = await stat(file);
      const text = await readFile(file, "utf8");
      return { text, fresh: this.now() - info.mtimeMs <= ttlMs };
    } catch {
      return null;
    }
  }

  async #writeCache(file, text) {
    const dir = this.cacheDir;
    if (!dir) return;
    try {
      await mkdir(dir, { recursive: true });
      const tmp = join(dir, `.cache-${process.pid}-${randomBytes(4).toString("hex")}.tmp`);
      await writeFile(tmp, text, "utf8");
      try {
        await rename(tmp, file);
      } catch (error) {
        await unlink(tmp).catch(() => {});
        throw error;
      }
    } catch (error) {
      // Caching is best effort; never fail a request because the cache is cold.
      this.logger?.warn?.("dsh-workspace-icons: 写入 Iconify 缓存失败", error);
    }
  }
}

/** Whether a string looks like SVG markup (leading whitespace/BOM tolerated). */
export function isSvg(text) {
  return typeof text === "string" && /^\s*(?:\uFEFF)?<svg[\s>]/i.test(text);
}

/** Convert any thrown error into an {@link IconifyError}. */
export function normalizeIconifyError(error) {
  if (error instanceof IconifyError) return error;
  if (error?.name === "AbortError") {
    return new IconifyError("iconify-unavailable", "Iconify 请求超时", { status: 502, hint: "请检查网络后重试" });
  }
  if (error instanceof SyntaxError) {
    return new IconifyError("iconify-bad-payload", "Iconify 返回了无法解析的数据");
  }
  return new IconifyError("iconify-unavailable", "无法连接 Iconify", {
    status: 502,
    hint: "请检查网络后重试",
  });
}
