// ============================================================================
// shared.js —— 客户端共享层（由 scripts/build-client.mjs 内联进 lib/client.js）
// 可用：React（参数）、BUILTIN_ICONS、STYLES（参数）
// 不要在这里使用 import/export。
// ============================================================================

const NS = "dsh-workspace-icons";
const API = "/api/dsh-workspace-icons";

const DICT = {
  zh: {
    "panel.title": "工作区图标",
    "panel.subtitle": "用图标区分工作区性质，并给本地会话加上默认标识",
    "panel.refresh": "刷新",
    "panel.loading": "正在读取配置…",
    "panel.error": "读取失败：{detail}",
    "panel.workspace.section": "工作区图标",
    "panel.workspace.hint": "工作区图标显示在侧栏工作区名称左侧；未单独设置时使用默认图标。也可以在「重命名工作区」弹窗里选择。",
    "panel.workspace.default": "默认工作区图标",
    "panel.workspace.defaultHint": "没有单独设置图标的工作区会使用它。",
    "panel.workspace.followDefault": "跟随默认",
    "panel.workspace.none": "未设置图标",
    "panel.session.section": "会话图标",
    "panel.session.enable": "为本地会话显示默认图标",
    "panel.session.hint": "图标表示会话由当前 DSH 客户端发起。已有 IM 渠道（微信、飞书等）的会话会保留 IM 头像，不再显示此图标。",
    "panel.session.default": "默认会话图标",
    "panel.session.defaultHint": "所有非 IM 渠道的会话都会显示它。",
    "panel.library.section": "图标库",
    "panel.library.hint": "内置图标可直接使用；也可以关联 Iconify 图标库（例如 lucide、tabler、mdi）来扩展可选图标。",
    "panel.library.builtin": "内置图标",
    "panel.library.linked": "已关联的图标库",
    "panel.library.linkedHint": "点标签名切换搜索范围，点 × 解除关联。",
    "panel.library.none": "尚未关联 Iconify 图标库",
    "panel.library.link": "关联图标库",
    "panel.library.linkInSettings": "还没有关联图标库：请到「设置 → 工作区图标 → 图标库」里从官方目录关联。",
    "panel.library.unlink": "解除关联",
    "panel.library.search": "搜索图标…",
    "panel.library.empty": "没有匹配的图标",
    "panel.library.catalogHint": "下面是从 Iconify 官方目录拉取的图标库列表；点击「关联」即可加入。",
    "panel.library.browse": "在 Iconify 官网浏览全部图标库 ↗",
    "panel.library.catalogSearch": "搜索图标库（前缀 / 名称 / 作者）…",
    "panel.library.noMatch": "没有匹配的图标库",
    "panel.library.icons": "个图标",
    "panel.library.linkedBadge": "已关联",
    "panel.custom.section": "自定义图标",
    "panel.custom.hint": "支持上传 SVG（单色效果最佳）；自定义图标可以随时删除。",
    "panel.custom.name": "图标名称",
    "panel.custom.svg": "选择 SVG 文件",
    "panel.custom.addSvg": "添加 SVG 图标",
    "panel.custom.none": "还没有自定义图标",
    "panel.custom.delete": "删除",
    "picker.builtin": "内置",
    "picker.custom": "自定义",
    "picker.library": "图标库",
    "picker.search": "搜索 {prefix} 图标…",
    "picker.none": "无",
    "picker.followDefault": "跟随默认",
    "picker.clear": "清除",
    "picker.current": "当前",
    "picker.choose": "更改图标",
    "picker.chooseTitle": "选择图标",
    "picker.linking": "正在关联…",
    "picker.loading": "加载中…",
    "rename.section": "工作区图标",
    "rename.hint": "用于在侧栏区分工作区",
    "rename.tip": "图标将与名称一起通过「重命名」保存",
    "rename.followDefault": "跟随默认",
    "rename.clear": "清除",
    "rename.preview": "预览",
    "common.cancel": "取消",
    "common.save": "保存",
    "common.delete": "删除",
    "common.add": "添加",
    "common.unknown": "未知",
    "common.workspace": "工作区",
    "status.saved": "已保存",
    "status.saveFailed": "保存失败：{detail}",
    "status.loading": "加载中…",
  },
  en: {
    "panel.title": "Workspace icons",
    "panel.subtitle": "Distinguish workspaces with icons and mark local sessions",
    "panel.refresh": "Refresh",
    "panel.loading": "Loading configuration…",
    "panel.error": "Failed to load: {detail}",
    "panel.workspace.section": "Workspace icons",
    "panel.workspace.hint": "Workspace icons appear left of workspace names in the sidebar. Workspaces without a specific icon use the default icon. You can also pick one in the Rename workspace dialog.",
    "panel.workspace.default": "Default workspace icon",
    "panel.workspace.defaultHint": "Used by workspaces without a specific icon.",
    "panel.workspace.followDefault": "Follow default",
    "panel.workspace.none": "No icon",
    "panel.session.section": "Session icons",
    "panel.session.enable": "Show a default icon on local sessions",
    "panel.session.hint": "The icon marks a session started from this DSH client. Sessions bound to an IM channel (WeChat, Feishu, …) keep their IM avatar instead.",
    "panel.session.default": "Default session icon",
    "panel.session.defaultHint": "Shown on every session without an IM channel.",
    "panel.library.section": "Icon libraries",
    "panel.library.hint": "Built-in icons work out of the box. Link an Iconify collection (for example lucide, tabler, mdi) to add more choices.",
    "panel.library.builtin": "Built-in icons",
    "panel.library.linked": "Linked icon libraries",
    "panel.library.linkedHint": "Click a tag to switch the search scope, click × to unlink.",
    "panel.library.none": "No Iconify library linked yet",
    "panel.library.link": "Link collection",
    "panel.library.linkInSettings": "No collection linked yet: link one from the official catalog in Settings → Workspace Icons → Icon Library.",
    "panel.library.unlink": "Unlink",
    "panel.library.search": "Search icons…",
    "panel.library.empty": "No matching icons",
    "panel.library.catalogHint": "The list below comes from the official Iconify catalog. Click Link to add a set.",
    "panel.library.browse": "Browse all sets on iconify.design ↗",
    "panel.library.catalogSearch": "Search sets (prefix / name / author)…",
    "panel.library.noMatch": "No matching icon set",
    "panel.library.icons": "icons",
    "panel.library.linkedBadge": "Linked",
    "panel.custom.section": "Custom icons",
    "panel.custom.hint": "Upload an SVG (monochrome works best). Custom icons can be deleted at any time.",
    "panel.custom.name": "Icon name",
    "panel.custom.svg": "Choose an SVG file",
    "panel.custom.addSvg": "Add SVG icon",
    "panel.custom.none": "No custom icons yet",
    "panel.custom.delete": "Delete",
    "picker.builtin": "Built-in",
    "picker.custom": "Custom",
    "picker.library": "Library",
    "picker.search": "Search {prefix} icons…",
    "picker.none": "None",
    "picker.followDefault": "Follow default",
    "picker.clear": "Clear",
    "picker.current": "Current",
    "picker.choose": "Change icon",
    "picker.chooseTitle": "Choose an icon",
    "picker.linking": "Linking…",
    "picker.loading": "Loading…",
    "rename.section": "Workspace icon",
    "rename.hint": "Distinguish this workspace in the sidebar",
    "rename.tip": "The icon is saved together with the name via the Rename button",
    "rename.followDefault": "Follow default",
    "rename.clear": "Clear",
    "rename.preview": "Preview",
    "common.cancel": "Cancel",
    "common.save": "Save",
    "common.delete": "Delete",
    "common.add": "Add",
    "common.unknown": "Unknown",
    "common.workspace": "Workspace",
    "status.saved": "Saved",
    "status.saveFailed": "Save failed: {detail}",
    "status.loading": "Loading…",
  },
};

const IM_TITLE_LABELS = [
  "微信", "WeChat", "飞书", "Feishu", "钉钉", "DingTalk", "企业微信", "WeCom",
  "QQ", "Slack", "Telegram", "Discord", "WhatsApp", "iMessage", "Matrix", "AI Office",
];

const BUILTIN_BY_NAME = new Map(BUILTIN_ICONS.map((icon) => [icon.name, icon]));

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------
let localeT = null;

function detectLang() {
  const lang = (typeof document !== "undefined" && document.documentElement && document.documentElement.lang) || "";
  if (lang.toLowerCase().startsWith("zh")) return "zh";
  if (lang) return "en";
  try {
    const nav = navigator.language || "";
    return nav.toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "zh";
  }
}

function t(key, fallback) {
  if (typeof localeT === "function") {
    try {
      const value = localeT(key);
      if (value && value !== key) return value;
    } catch {
      /* fall through */
    }
  }
  const lang = detectLang();
  return (DICT[lang] && DICT[lang][key]) || (DICT.zh && DICT.zh[key]) || fallback || key;
}

function registerLocale(ctx) {
  if (!ctx || !ctx.locale || typeof ctx.locale.register !== "function") return;
  try {
    localeT = ctx.locale.bind(NS);
  } catch {
    localeT = null;
  }
  try {
    ctx.locale.register(NS, DICT);
  } catch {
    /* 已注册或 locale 不可用：退回内置字典 */
  }
}

// ---------------------------------------------------------------------------
// IM detection / icon refs
// ---------------------------------------------------------------------------
function parseImTitle(title) {
  if (typeof title !== "string") return null;
  for (const label of IM_TITLE_LABELS) {
    const prefix = label + " · ";
    if (title.startsWith(prefix) && title.slice(prefix.length).trim()) {
      return { label, title: title.slice(prefix.length) };
    }
  }
  return null;
}

function isImSession(sessionId, titleText) {
  if (typeof sessionId === "string" && sessionId.startsWith("dsh-im-session-")) return true;
  return Boolean(parseImTitle((titleText || "").trim()));
}

function normalizeRef(ref) {
  if (!ref || typeof ref !== "object") return null;
  if (ref.type === "builtin" && typeof ref.name === "string" && BUILTIN_BY_NAME.has(ref.name)) {
    return { type: "builtin", name: ref.name };
  }
  if (ref.type === "iconify" && typeof ref.prefix === "string" && typeof ref.name === "string"
    && /^[a-z0-9-]{2,60}$/.test(ref.prefix) && /^[a-z0-9-]{1,80}$/.test(ref.name)) {
    return { type: "iconify", prefix: ref.prefix, name: ref.name };
  }
  if (ref.type === "custom" && typeof ref.id === "string" && /^[A-Za-z0-9_-]{2,80}$/.test(ref.id)) {
    return { type: "custom", id: ref.id };
  }
  return null;
}

function iconKey(ref) {
  const value = normalizeRef(ref);
  if (!value) return "none";
  if (value.type === "builtin") return "b:" + value.name;
  if (value.type === "iconify") return "i:" + value.prefix + "/" + value.name;
  if (value.type === "custom") return "c:" + value.id;
  return "none";
}

function sameRef(a, b) {
  return iconKey(a) === iconKey(b);
}

function iconLabel(ref) {
  const value = normalizeRef(ref);
  if (!value) return "";
  if (value.type === "builtin") return value.name;
  if (value.type === "iconify") return value.prefix + "/" + value.name;
  const custom = findCustomIcon(value.id);
  return custom ? custom.name : value.id;
}

function findCustomIcon(id) {
  const config = currentData() && currentData().config;
  const list = (config && config.customIcons) || [];
  return list.find((item) => item.id === id) || null;
}

function builtinIcon(name) {
  return BUILTIN_BY_NAME.get(name) || null;
}

// ---------------------------------------------------------------------------
// API / store
// ---------------------------------------------------------------------------
const store = {
  data: null,
  error: null,
  loading: true,
  started: false,
};
const listeners = new Set();

function currentData() {
  return store.data;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch (error) {
      console.warn("[dsh-workspace-icons] listener failed", error);
    }
  }
}

function updateData(mutator) {
  if (!store.data) return;
  const next = mutator(store.data);
  if (!next) return;
  store.data = next;
  emit();
}

async function request(method, path, body, options) {
  const headers = { accept: "application/json" };
  if (method !== "GET") {
    headers["content-type"] = "application/json";
    headers["x-dsh-workspace-icons"] = "1";
  }
  const response = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    keepalive: Boolean(options && options.keepalive),
    signal: options && options.signal,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok || !payload || payload.ok !== true) {
    const message = (payload && payload.error && payload.error.message) || ("HTTP " + response.status);
    throw new Error(message);
  }
  return payload.value;
}

let refreshInflight = null;

async function refresh() {
  if (refreshInflight) return refreshInflight;
  refreshInflight = (async () => {
    try {
      const value = await request("GET", "/state");
      store.data = value;
      store.error = null;
    } catch (error) {
      store.error = error && error.message ? error.message : String(error);
    } finally {
      store.loading = false;
      refreshInflight = null;
      emit();
    }
  })();
  return refreshInflight;
}

let periodicTimer = null;
let onWindowEvent = null;

function start() {
  if (store.started) return;
  store.started = true;
  refresh();
  onWindowEvent = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    refresh();
  };
  try {
    window.addEventListener("focus", onWindowEvent);
    document.addEventListener("visibilitychange", onWindowEvent);
  } catch {
    /* ignore */
  }
  periodicTimer = setInterval(() => {
    try {
      if (document.visibilityState !== "hidden") refresh();
    } catch {
      /* ignore */
    }
  }, 20000);
}

function stop() {
  store.started = false;
  if (periodicTimer) clearInterval(periodicTimer);
  periodicTimer = null;
  try {
    if (onWindowEvent) {
      window.removeEventListener("focus", onWindowEvent);
      document.removeEventListener("visibilitychange", onWindowEvent);
    }
  } catch {
    /* ignore */
  }
  onWindowEvent = null;
}

function useStore() {
  return React.useSyncExternalStore(subscribe, currentData, currentData);
}

// ---------------------------------------------------------------------------
// Effective icons
// ---------------------------------------------------------------------------
function defaultWorkspaceIcon() {
  const data = currentData();
  const config = data && data.config;
  return (config && config.defaults && normalizeRef(config.defaults.workspace)) || null;
}

function workspaceSpecificIcon(workspaceId) {
  const data = currentData();
  const config = data && data.config;
  const map = (config && config.workspaceIcons) || {};
  return normalizeRef(map[workspaceId]);
}

function workspaceIconFor(workspaceId) {
  const specific = workspaceSpecificIcon(workspaceId);
  if (specific) return specific;
  const data = currentData();
  const config = data && data.config;
  const settings = (config && config.settings) || {};
  if (settings.showDefaultWorkspaceIcon === false) return null;
  return defaultWorkspaceIcon();
}

function sessionIcon() {
  const data = currentData();
  const config = data && data.config;
  const settings = (config && config.settings) || {};
  if (settings.showDefaultSessionIcon === false) return null;
  return normalizeRef(config && config.defaults && config.defaults.session);
}

function workspaceById(workspaceId) {
  const data = currentData();
  const list = (data && data.workspaces) || [];
  return list.find((item) => item.workspaceId === workspaceId) || null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
async function setWorkspaceIcon(workspaceId, icon, options) {
  const ref = icon ? normalizeRef(icon) : null;
  const value = await request("POST", "/workspace-icons", { workspaceId, icon: ref }, options);
  updateData((data) => {
    const config = data.config || {};
    const workspaceIcons = Object.assign({}, config.workspaceIcons || {});
    if (ref) workspaceIcons[workspaceId] = ref;
    else delete workspaceIcons[workspaceId];
    return Object.assign({}, data, { config: Object.assign({}, config, { workspaceIcons }) });
  });
  return value;
}

async function setDefaults(patch, options) {
  const body = {};
  if (Object.prototype.hasOwnProperty.call(patch, "workspace")) body.workspace = patch.workspace ? normalizeRef(patch.workspace) : null;
  if (Object.prototype.hasOwnProperty.call(patch, "session")) body.session = patch.session ? normalizeRef(patch.session) : null;
  const value = await request("POST", "/defaults", body, options);
  updateData((data) => {
    const config = data.config || {};
    const defaults = Object.assign({}, config.defaults || {}, body);
    return Object.assign({}, data, { config: Object.assign({}, config, { defaults }) });
  });
  return value;
}

async function setSettings(patch, options) {
  const value = await request("POST", "/settings", patch, options);
  updateData((data) => {
    const config = data.config || {};
    const settings = Object.assign({}, config.settings || {}, patch);
    return Object.assign({}, data, { config: Object.assign({}, config, { settings }) });
  });
  return value;
}

async function addCustomIcon(payload, options) {
  const value = await request("POST", "/custom-icons", payload, options);
  await refresh();
  return value;
}

async function deleteCustomIcon(id, options) {
  const value = await request("POST", "/custom-icons/delete", { id }, options);
  await refresh();
  return value;
}

async function linkIconify(prefix, options) {
  const value = await request("POST", "/iconify/link", { prefix }, options);
  await refresh();
  return value;
}

async function unlinkIconify(prefix, options) {
  const value = await request("POST", "/iconify/unlink", { prefix }, options);
  await refresh();
  return value;
}

async function searchIconifyCollections(query, limit) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("limit", String(limit || 60));
  return request("GET", "/iconify/collections?" + params.toString());
}

async function searchIconify(prefix, query, limit) {
  const params = new URLSearchParams();
  params.set("prefix", prefix);
  if (query) params.set("q", query);
  params.set("limit", String(limit || 96));
  return request("GET", "/iconify/search?" + params.toString());
}

// ---------------------------------------------------------------------------
// Icon rendering helpers
// ---------------------------------------------------------------------------
function builtinDataUri(icon) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + icon.viewBox + '">' + icon.body + "</svg>";
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function iconifySvgUrl(prefix, name) {
  return API + "/iconify-svg?prefix=" + encodeURIComponent(prefix) + "&name=" + encodeURIComponent(name);
}

function customSvgUrl(id) {
  return API + "/custom-svg?id=" + encodeURIComponent(id);
}

function maskStyle(url, size) {
  return {
    width: size + "px",
    height: size + "px",
    // 图标颜色跟随主题（currentColor）。
    backgroundColor: "currentColor",
    WebkitMaskImage: 'url("' + url + '")',
    maskImage: 'url("' + url + '")',
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskSize: "contain",
    maskSize: "contain",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    display: "inline-block",
    flex: "none",
  };
}

function glyphElement(icon, size, url) {
  const value = normalizeRef(icon);
  if (!value) return null;
  if (value.type === "custom") {
    const img = document.createElement("img");
    img.className = "dwi-glyph dwi-glyph-img";
    img.src = customSvgUrl(value.id);
    img.width = size;
    img.height = size;
    img.alt = "";
    img.draggable = false;
    return img;
  }
  const builtin = value.type === "builtin" ? builtinIcon(value.name) : null;
  const source = url || (builtin
    ? builtinDataUri(builtin)
    : iconifySvgUrl(value.prefix, value.name));
  const span = document.createElement("span");
  span.className = "dwi-glyph dwi-glyph-mask";
  span.setAttribute("aria-hidden", "true");
  Object.assign(span.style, maskStyle(source, size));
  return span;
}

function IconGlyph(props) {
  const value = normalizeRef(props && props.icon);
  const size = (props && props.size) || 16;
  // url：调用方已经拿到图标数据时直接用，省掉逐个图标的上游请求。
  const providedUrl = props && typeof props.url === "string" && props.url !== "" ? props.url : "";
  if (!value) return null;
  if (value.type === "custom") {
    return React.createElement("img", {
      className: "dwi-glyph dwi-glyph-img" + (props.className ? " " + props.className : ""),
      src: customSvgUrl(value.id),
      width: size,
      height: size,
      alt: "",
      draggable: false,
    });
  }
  const builtin = value.type === "builtin" ? builtinIcon(value.name) : null;
  const url = providedUrl || (builtin ? builtinDataUri(builtin) : iconifySvgUrl(value.prefix, value.name));
  return React.createElement("span", {
    className: "dwi-glyph dwi-glyph-mask" + (props.className ? " " + props.className : ""),
    style: maskStyle(url, size),
    "aria-hidden": true,
  });
}

function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("dwi-style")) return;
  const style = document.createElement("style");
  style.id = "dwi-style";
  style.textContent = STYLES;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Icon picker (shared by rename dialog + settings panel)
// ---------------------------------------------------------------------------
function IconGridButton(props) {
  return React.createElement("button", {
    type: "button",
    className: "dwi-icon-btn" + (props.selected ? " is-selected" : ""),
    title: props.title || "",
    "aria-label": props.title || "",
    onClick: props.onClick,
  }, React.createElement(IconGlyph, { icon: props.icon, size: props.size || 20, url: props.url }));
}

function IconPicker(props) {
  const data = useStore();
  const config = (data && data.config) || {};
  const customIcons = config.customIcons || [];
  const libraries = (config.libraries && config.libraries.iconify) || [];
  const [tab, setTab] = React.useState(props.initialTab || "builtin");
  const [prefix, setPrefix] = React.useState((libraries[0] && libraries[0].prefix) || "");
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");

  React.useEffect(() => {
    if (tab !== "library" || !prefix) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        setBusy(true);
        setMessage("");
        const value = await searchIconify(prefix, query.trim(), 96);
        if (!cancelled) setResults(value);
      } catch (error) {
        if (!cancelled) setMessage(error && error.message ? error.message : String(error));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, query ? 260 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, prefix, query]);

  const choose = (ref) => {
    if (props.onChange) props.onChange(ref);
    if (props.closeOnPick) props.closeOnPick();
  };

  const tabs = [
    ["builtin", t("picker.builtin", "内置")],
    ["custom", t("picker.custom", "自定义")],
    ["library", t("picker.library", "图标库")],
  ];

  let body = null;
  if (tab === "builtin") {
    body = React.createElement("div", { className: "dwi-grid" },
      BUILTIN_ICONS.map((icon) => React.createElement(IconGridButton, {
        key: icon.name,
        icon: { type: "builtin", name: icon.name },
        title: icon.name,
        selected: sameRef(props.value, { type: "builtin", name: icon.name }),
        onClick: () => choose({ type: "builtin", name: icon.name }),
      })),
    );
  } else if (tab === "custom") {
    body = customIcons.length
      ? React.createElement("div", { className: "dwi-grid" },
        customIcons.map((icon) => {
          const ref = { type: "custom", id: icon.id };
          return React.createElement(IconGridButton, {
            key: icon.id,
            icon: ref,
            title: icon.name,
            selected: sameRef(props.value, ref),
            onClick: () => choose(ref),
          });
        }),
      )
      : React.createElement("p", { className: "dwi-muted" }, t("panel.custom.none", "还没有自定义图标"));
  } else if (tab === "library") {
    const libraryBar = React.createElement("div", { className: "dwi-lib-row" },
      libraries.length
        ? libraries.map((library) => React.createElement("button", {
          key: library.prefix,
          type: "button",
          className: "dwi-chip" + (library.prefix === prefix ? " is-active" : ""),
          onClick: () => setPrefix(library.prefix),
          title: library.title || library.prefix,
        }, library.title || library.prefix))
        : React.createElement("span", { className: "dwi-muted" }, t("panel.library.none", "尚未关联 Iconify 图标库")),
    );
    let content;
    if (!libraries.length) {
      // 关联入口统一收在「设置 → 图标库」的官方目录里，这里只做指引。
      content = React.createElement("p", { className: "dwi-muted" },
        t("panel.library.linkInSettings", "还没有关联图标库：请到「设置 → 工作区图标 → 图标库」里从官方目录关联。"));
    } else {
      content = React.createElement(React.Fragment, null,
        React.createElement("input", {
          className: "dwi-input",
          value: query,
          placeholder: t("picker.search", "搜索 {prefix} 图标…").replace("{prefix}", prefix),
          onChange: (event) => setQuery(event.target.value),
        }),
        busy
          ? React.createElement("p", { className: "dwi-muted" }, t("picker.loading", "加载中…"))
          : (results && results.icons && results.icons.length
            ? React.createElement("div", { className: "dwi-grid" }, results.icons.map((item) => {
              const name = typeof item === "string" ? item : item.name;
              const svg = typeof item === "string" ? "" : item.svg || "";
              return React.createElement(IconGridButton, {
                key: name,
                icon: { type: "iconify", prefix, name },
                title: name,
                url: svg || iconifySvgUrl(prefix, name),
                selected: sameRef(props.value, { type: "iconify", prefix, name }),
                onClick: () => choose({ type: "iconify", prefix, name }),
              });
            }))
            : React.createElement("p", { className: "dwi-muted" }, t("panel.library.empty", "没有匹配的图标"))),
      );
    }
    body = React.createElement("div", { className: "dwi-lib" }, libraryBar, content);
  }

  return React.createElement("div", { className: "dwi-picker" },
    React.createElement("div", { className: "dwi-tabs" }, tabs.map(([id, label]) => React.createElement("button", {
      key: id,
      type: "button",
      className: "dwi-tab" + (tab === id ? " is-active" : ""),
      onClick: () => setTab(id),
    }, label))),
    React.createElement("div", { className: "dwi-picker-body" }, body),
    message ? React.createElement("p", { className: "dwi-error" }, message) : null,
    React.createElement("div", { className: "dwi-picker-foot" },
      React.createElement("span", { className: "dwi-current" },
        React.createElement("span", { className: "dwi-muted" }, t("picker.current", "当前") + "："),
        props.value
          ? React.createElement(React.Fragment, null,
            React.createElement(IconGlyph, { icon: props.value, size: 16 }),
            React.createElement("span", { className: "dwi-current-label" }, iconLabel(props.value)))
          : React.createElement("span", { className: "dwi-muted" }, t("picker.none", "无")),
      ),
      React.createElement("div", { className: "dwi-picker-actions" },
        props.allowFollowDefault
          ? React.createElement("button", { type: "button", className: "dwi-btn", onClick: () => choose(null) },
            t("picker.followDefault", "跟随默认"))
          : null,
        props.allowClear
          ? React.createElement("button", { type: "button", className: "dwi-btn", onClick: () => choose(null) },
            t("picker.clear", "清除"))
          : null,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// misc
// ---------------------------------------------------------------------------
function errorText(error) {
  return error && error.message ? error.message : String(error);
}

return {
  NS,
  API,
  t,
  registerLocale,
  start,
  stop,
  refresh,
  useStore,
  currentData,
  request,
  isImSession,
  parseImTitle,
  normalizeRef,
  subscribe,
  iconKey,
  sameRef,
  iconLabel,
  findCustomIcon,
  builtinIcon,
  defaultWorkspaceIcon,
  workspaceSpecificIcon,
  workspaceIconFor,
  sessionIcon,
  workspaceById,
  setWorkspaceIcon,
  setDefaults,
  setSettings,
  addCustomIcon,
  deleteCustomIcon,
  linkIconify,
  unlinkIconify,
  searchIconify,
  searchIconifyCollections,
  glyphElement,
  IconGlyph,
  IconPicker,
  injectStyles,
  builtinDataUri,
  iconifySvgUrl,
  customSvgUrl,
  errorText,
  BUILTIN_ICONS,
  DICT,
};
