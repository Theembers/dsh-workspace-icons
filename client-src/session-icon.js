// 侧栏会话默认图标 —— 用与 IM 插件相同的「标题内伪元素」手法绘制。
//
// 为什么不用 `sidebar.session.row.leading` slot：
// 宿主在该 slot 里渲染的容器位于标题**左侧 22px**（实测：宿主 slot 容器 left=-246，
// 标题 left=-224）。而 IM 插件（@xmanrui/dsh-im）的渠道 logo 是画在**标题 span 内部**
// 的 ::before 伪元素上（left=-224）。两者不同源，导致 GUI 会话与微信渠道会话的图标
// 左右错开 22px，缩进对不齐。
//
// 这里改用与 IM 一致的做法：在会话标题 span 上挂 attribute + CSS 伪元素，
// 图标落在与渠道 logo 完全相同的坐标，缩进自然对齐。
// IM 会话（有渠道 logo）不再叠加图标，避免双图标。
function (ctx, shared, React, ReactDOM) {
  void ctx;
  void React;
  void ReactDOM;

  const CHANNEL_ATTR = "data-dsh-im-session-channel";
  const TITLE_ATTR = "data-dsh-im-session-text";
  const OWN_ATTR = "data-dwi-session-icon";
  const OWN_TITLE_ATTR = "data-dwi-session-icon-text";
  const OWN_ATTR_TEXT = "data-dwi-session-icon-text-value";
  const STYLE_ID = "dwi-session-icon-style";

  const ROW_SELECTOR = '[role="treeitem"][aria-selected]';

  function hasClassPart(element, part) {
    if (!element || !element.classList) return false;
    return [...element.classList].some((token) => token.split(/[_-]/u).includes(part));
  }

  /** 与 IM 插件 titleOf() 同构：只认结构稳定的标题 span。 */
  function titleOf(row) {
    if (!row || !row.matches || !row.matches(ROW_SELECTOR)) return null;
    if (row.closest("input, textarea, [contenteditable]:not([contenteditable='false'])")) return null;
    let title;
    if (row.tagName === "DIV" && hasClassPart(row, "sessionRow")) {
      title = [...row.children].find((child) => child.tagName === "SPAN" && hasClassPart(child, "title"));
    }
    if (!title) return null;
    // 标题正在编辑 / 被搜索高亮拆成多节点时不要覆盖，避免吞掉用户输入。
    return title.childNodes.length === 1 && title.firstChild.nodeType === 3 ? title : null;
  }

  /** 取图标的可渲染 URL（builtin / iconify / custom 全部走 mask）。 */
  function iconUrl(icon) {
    const value = shared.normalizeRef ? shared.normalizeRef(icon) : null;
    if (!value) return null;
    if (value.type === "custom") return shared.customSvgUrl(value.id);
    if (value.type === "builtin") return shared.builtinDataUri(shared.builtinIcon(value.name));
    if (value.type === "iconify") return shared.iconifySvgUrl(value.prefix, value.name);
    return null;
  }

  function install(document) {
    const view = document.defaultView;
    if (!document.body || !document.head || !view || !view.MutationObserver) return () => {};

    const owned = new Map();
    const queued = new Set();
    let scheduled = false;
    let closed = false;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
[${OWN_ATTR}][${OWN_TITLE_ATTR}] {
  position: relative;
  text-overflow: clip !important;
  overflow: hidden;
  /* 标题本体文字透明，替换文字改由 ::after 绘制。
     注意：不要在这里改 color —— 宿主行有自己的文字色（label-primary），
     覆盖它会让会话标题比别的行深或浅，替换文字也会跟着跑偏。 */
  -webkit-text-fill-color: transparent;
}
/* 图标用 mask 上色：颜色取宿主侧栏图标自己用的 label-tertiary，
   既不随选中态变深，也和主题里的其它侧栏图标保持一致。
   （直接把 SVG 塞进 background-image 的话，SVG 里的 currentColor 会解析成黑色，
   图标就会显得比文字深一大截。） */
[${OWN_ATTR}][${OWN_TITLE_ATTR}]::before {
  content: "";
  position: absolute;
  inset-inline-start: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  background-color: var(--dsw-alias-label-tertiary, currentColor);
  -webkit-mask-image: var(--dwi-session-icon);
  mask-image: var(--dwi-session-icon);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  text-indent: 0;
  pointer-events: none;
}
[${OWN_ATTR}][${OWN_TITLE_ATTR}]::after {
  content: attr(${OWN_ATTR_TEXT}) / "";
  position: absolute;
  inset: 0;
  inset-inline-start: 22px;
  -webkit-text-fill-color: currentColor;
  text-indent: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  pointer-events: none;
}
/* 宿主滚动标题时会挂这些 marquee 钩子，让替换文本整体移动而不是被裁切。 */
[${OWN_ATTR}][${OWN_TITLE_ATTR}]:is([data-scrolled], [data-clipped])::after {
  inset-inline-end: auto;
  width: max-content;
  overflow: visible;
  text-overflow: clip;
}
`;
    document.head.appendChild(style);

    const restore = (title) => {
      const previous = owned.get(title);
      if (!previous) return;
      owned.delete(title);
      for (const [attribute, value] of previous) {
        if (value === null) title.removeAttribute(attribute);
        else title.setAttribute(attribute, value);
      }
    };

    const update = (row) => {
      const title = row.isConnected ? titleOf(row) : null;
      for (const marked of row.querySelectorAll("[" + OWN_ATTR + "]")) {
        if (marked !== title) restore(marked);
      }
      if (!title) return;

      const icon = shared.sessionIcon();
      if (!icon) {
        restore(title);
        return;
      }

      // IM 渠道会话已经带渠道 logo，不再叠加默认图标（与需求一致：优先级低）。
      const imChannel = title.getAttribute(CHANNEL_ATTR);
      const imText = title.getAttribute(TITLE_ATTR);
      if (imChannel || imText) {
        restore(title);
        return;
      }

      const text = (title.textContent || "").trim();
      if (!text) {
        restore(title);
        return;
      }
      // 兜底：标题前缀形如「微信 · xxx」也算 IM 会话。
      if (shared.isImSession && shared.isImSession(null, text)) {
        restore(title);
        return;
      }

      const url = iconUrl(icon);
      if (!url) {
        restore(title);
        return;
      }

      if (!owned.has(title)) {
        owned.set(title, [OWN_ATTR, OWN_TITLE_ATTR, OWN_ATTR_TEXT].map((attribute) => [
          attribute,
          title.getAttribute(attribute),
        ]));
      }
      title.setAttribute(OWN_ATTR, "1");
      title.setAttribute(OWN_TITLE_ATTR, text);
      title.setAttribute(OWN_ATTR_TEXT, text);
      title.style.setProperty("--dwi-session-icon", 'url("' + url + '")');
    };

    const schedule = () => {
      if (closed || scheduled || !queued.size) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (closed) return;
        const rows = [...queued];
        queued.clear();
        for (const row of rows) {
          try {
            update(row);
          } catch {
            for (const marked of row.querySelectorAll("[" + OWN_ATTR + "]")) restore(marked);
          }
        }
      });
    };

    const collect = (node, descendants = false) => {
      const element = node.nodeType === 1 ? node : node.parentElement;
      if (!element) return;
      const row = element.closest(ROW_SELECTOR);
      if (row) queued.add(row);
      if (descendants) {
        for (const child of element.querySelectorAll(ROW_SELECTOR)) queued.add(child);
        const marked = [...element.querySelectorAll("[" + OWN_ATTR + "]")];
        if (owned.has(element)) marked.push(element);
        for (const title of marked) {
          const owner = title.closest(ROW_SELECTOR);
          if (owner) queued.add(owner);
          else restore(title);
        }
      }
      schedule();
    };

    const observer = new view.MutationObserver((records) => {
      if (closed) return;
      for (const record of records) {
        collect(record.target, record.type === "attributes");
        if (record.type !== "childList") continue;
        for (const node of record.addedNodes) collect(node, true);
        for (const node of record.removedNodes) {
          if (node.nodeType !== 1 || node.isConnected) continue;
          if (owned.has(node)) restore(node);
          for (const title of node.querySelectorAll("[" + OWN_ATTR + "]")) restore(title);
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      // 也盯 IM 插件挂的渠道属性：IM 可能比我们晚一步命中同一个标题，
      // 那时要立刻把我们的标记撤掉，避免两套伪元素叠在同一个标题上。
      attributeFilter: ["class", "role", "aria-selected", "contenteditable", CHANNEL_ATTR, TITLE_ATTR],
    });

    collect(document.body, true);

    // 默认图标 / 开关变化时重新应用（设置面板改动会 emit store 事件）。
    let unsubscribe = null;
    if (typeof shared.subscribe === "function") {
      unsubscribe = shared.subscribe(() => {
        if (closed) return;
        for (const row of document.querySelectorAll(ROW_SELECTOR)) queued.add(row);
        schedule();
      });
    }

    return () => {
      closed = true;
      observer.disconnect();
      queued.clear();
      if (typeof unsubscribe === "function") {
        try {
          unsubscribe();
        } catch (error) {
          /* ignore */
        }
        unsubscribe = null;
      }
      for (const title of [...owned.keys()]) {
        restore(title);
        title.style.removeProperty("--dwi-session-icon");
      }
      style.remove();
    };
  }

  let stop = null;
  try {
    stop = install(typeof document !== "undefined" ? document : null);
  } catch (error) {
    console.warn("[dsh-workspace-icons] 会话默认图标安装失败", error);
  }

  return function cleanup() {
    if (typeof stop === "function") {
      const fn = stop;
      stop = null;
      try {
        fn();
      } catch (error) {
        console.warn("[dsh-workspace-icons] 会话默认图标卸载失败", error);
      }
    }
  };
}
