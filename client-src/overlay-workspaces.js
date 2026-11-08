// 侧栏「工作区」行图标装饰（纯 DOM overlay）。
//
// 契约见 client-src/CONTRACT.md：
//   - 本文件不是 ESM，整体是一个函数表达式：(ctx, shared, React, ReactDOM) => cleanup。
//   - 不能用 import/export/JSX，用 React.createElement。
//   - 返回值 cleanup 必须幂等、可重复调用。
//
// 做法：DSH 0.2.2 的工作区行没有图标槽位，所以用 MutationObserver 监听 document.body，
// 找到 `div[role="treeitem"][data-row-key="workspace:<workspaceId>"]` 行，把行内
// `span[class*="folder"]` 当作图标宿主（styles.js 用 [data-dwi-folder-host] > svg 隐藏原生文件夹图标），
// 追加 `span.dwi-workspace-icon`，内容由 shared.glyphElement 渲染。
// 图标引用用 `data-icon-key` 缓存，避免观察到自己引起的 DOM 变更后反复重建。
function (ctx, shared, React, ReactDOM) {
  void ctx;

  var ROW_SELECTOR = 'div[role="treeitem"][data-row-key^="workspace:"]';
  var ROW_PREFIX = "workspace:";
  var ICON_CLASS = "dwi-workspace-icon";
  // 宿主每次重渲染都会重写 folder 槽的 className（active 时加 folderActive），
  // 所以标记不能用 class —— React 会把我们加的 class 一起冲掉，导致一瞬间
  // 原生文件夹图标重新露出来。改用自定义 attribute：React 不管理它，能一直留着。
  var HOST_ATTR = "data-dwi-folder-host";
  var ICON_SIZE = 16;

  if (typeof document === "undefined") return function () {};

  var stopped = false;
  var timer = null;
  var safetyTimer = null;
  var selfMutating = false;
  var observer = null;
  var storeRoot = null;
  var storeContainer = null;

  function report(error) {
    try {
      console.warn("[dsh-workspace-icons] workspace overlay:", error);
    } catch (_) {}
  }

  /* ---------------------------------------------------------------- 调度 */

  // 下一帧就扫描，不做几十毫秒的防抖。
  //
  // 原来用 80ms 防抖来合并批量渲染，但切换工作区时宿主会在一次 commit 里
  // 改掉 folder 槽的 className，若我们的标记刚好失效，原生文件夹图标会在这
  // 80ms（≈5 帧）里露出来 —— 就是「先显示默认文件夹图标再变成自定义图标」。
  // 现在标记改成 attribute 后基本不会失效，这里再把延迟压到一帧，彻底不留空窗。
  function schedule() {
    if (stopped || timer !== null) return;
    if (typeof requestAnimationFrame === "function") {
      timer = requestAnimationFrame(function () {
        timer = null;
        if (!stopped) safeScan();
      });
    } else {
      timer = setTimeout(function () {
        timer = null;
        if (!stopped) safeScan();
      }, 0);
    }
  }

  function safeScan() {
    try {
      scan();
    } catch (error) {
      report(error);
    }
  }

  /* ------------------------------------------------------------ DOM 变更 */

  // 自身写 DOM 期间置位，MutationObserver 回调里直接忽略，避免自触发循环。
  function beginSelfMutation() {
    selfMutating = true;
  }

  function endSelfMutation() {
    if (typeof queueMicrotask === "function") {
      queueMicrotask(function () {
        selfMutating = false;
      });
    } else {
      setTimeout(function () {
        selfMutating = false;
      }, 0);
    }
  }

  function isOurNode(node) {
    if (!node || node.nodeType !== 1) return false;
    var className = node.getAttribute ? node.getAttribute("class") || "" : "";
    return className.indexOf(ICON_CLASS) !== -1 || className.indexOf("dwi-glyph") !== -1;
  }

  function onMutations(records) {
    if (stopped || selfMutating) return;
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (!record || record.type !== "childList") continue;
      var target = record.target;
      if (target && target.nodeType === 1 && target.closest && target.closest("." + ICON_CLASS)) {
        continue;
      }
      var relevant = false;
      var j;
      for (j = 0; j < record.addedNodes.length; j++) {
        if (!isOurNode(record.addedNodes[j])) {
          relevant = true;
          break;
        }
      }
      if (!relevant) {
        for (j = 0; j < record.removedNodes.length; j++) {
          if (!isOurNode(record.removedNodes[j])) {
            relevant = true;
            break;
          }
        }
      }
      if (relevant) {
        schedule();
        return;
      }
    }
  }

  /* -------------------------------------------------------------- 装饰 */

  function scan() {
    if (stopped) return;
    // 配置/工作区数据未加载时不擦写图标，等 store 订阅或下一次 observer 触发后再扫。
    if (!shared.currentData()) return;
    var rows = document.querySelectorAll(ROW_SELECTOR);
    for (var i = 0; i < rows.length; i++) {
      decorateRow(rows[i]);
    }
  }

  function findFolderSlot(row) {
    var folder = row.querySelector('span[class*="folder"]');
    if (folder) return folder;
    // 兜底：行内第一个 svg 的直接 span 父节点。
    var svg = row.querySelector("svg");
    if (!svg || !svg.parentElement) return null;
    var parent = svg.parentElement;
    if (parent.tagName !== "SPAN") return null;
    return parent;
  }

  function findExistingIcon(folder) {
    var children = folder.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.classList && child.classList.contains(ICON_CLASS)) return child;
    }
    return null;
  }

  function removeDecoration(folder) {
    var existing = findExistingIcon(folder);
    var hasHost = folder.hasAttribute(HOST_ATTR);
    var hasKey = folder.hasAttribute("data-icon-key");
    if (!existing && !hasHost && !hasKey) return;
    beginSelfMutation();
    try {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      folder.removeAttribute(HOST_ATTR);
      folder.removeAttribute("data-icon-key");
    } finally {
      endSelfMutation();
    }
  }

  function decorateRow(row) {
    var key = row.getAttribute("data-row-key") || "";
    if (key.indexOf(ROW_PREFIX) !== 0) return;
    var workspaceId = key.slice(ROW_PREFIX.length);
    // 「未分组」bucket 的 row-key 是 "workspace:"（无 workspaceId），跳过。
    if (!workspaceId) return;
    var folder = findFolderSlot(row);
    if (!folder) return;

    var ref = null;
    var desiredKey = "none";
    try {
      ref = shared.workspaceIconFor(workspaceId);
      if (ref) {
        desiredKey = shared.iconKey(ref) || "none";
        if (desiredKey === "none") ref = null;
      }
    } catch (error) {
      report(error);
      return;
    }

    var existing = findExistingIcon(folder);
    var hasHost = folder.hasAttribute(HOST_ATTR);
    var currentKey = folder.getAttribute("data-icon-key") || "none";
    if (!ref) {
      removeDecoration(folder);
      return;
    }

    // 同图标不再重建，避免 observer 自触发/闪烁。
    if (existing && existing.firstChild && hasHost && currentKey === desiredKey) {
      return;
    }

    var glyph = null;
    try {
      glyph = shared.glyphElement(ref, ICON_SIZE);
    } catch (error) {
      report(error);
    }
    if (!glyph) {
      removeDecoration(folder);
      return;
    }

    beginSelfMutation();
    try {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      folder.setAttribute(HOST_ATTR, "1");
      folder.setAttribute("data-icon-key", desiredKey);
      var host = document.createElement("span");
      host.className = ICON_CLASS;
      host.setAttribute("data-dwi-injected", "1");
      host.appendChild(glyph);
      folder.appendChild(host);
    } finally {
      endSelfMutation();
    }
  }

  /* -------------------------------------------------- store 数据变化订阅 */

  // 用 shared.useStore 订阅，数据一变就重扫；渲染在脱离文档的容器里，不污染列表 DOM。
  function StoreWatcher(props) {
    var data = shared.useStore();
    React.useEffect(function () {
      props.onChange();
    }, [data]);
    return null;
  }

  function startStoreWatcher() {
    try {
      storeContainer = document.createElement("div");
      storeContainer.setAttribute("data-dwi-injected", "1");
      storeContainer.style.display = "none";
      storeRoot = ReactDOM.createRoot(storeContainer);
      storeRoot.render(React.createElement(StoreWatcher, { onChange: schedule }));
    } catch (error) {
      report(error);
      storeRoot = null;
      // 订阅失败时至少定期补扫，保证数据刷新后行图标能更新。
      if (safetyTimer === null) safetyTimer = setInterval(schedule, 1500);
    }
  }

  /* -------------------------------------------------------------入口卸载 */

  function cleanup() {
    if (stopped) return;
    stopped = true;
    if (timer !== null) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(timer);
      clearTimeout(timer);
      timer = null;
    }
    if (safetyTimer !== null) {
      clearInterval(safetyTimer);
      safetyTimer = null;
    }
    if (observer) {
      try {
        observer.disconnect();
      } catch (error) {
        report(error);
      }
      observer = null;
    }
    if (storeRoot) {
      try {
        storeRoot.unmount();
      } catch (error) {
        report(error);
      }
      storeRoot = null;
    }
    if (storeContainer && storeContainer.parentNode) {
      storeContainer.parentNode.removeChild(storeContainer);
    }
    storeContainer = null;
    try {
      var icons = document.querySelectorAll("." + ICON_CLASS);
      for (var i = 0; i < icons.length; i++) {
        if (icons[i].parentNode) icons[i].parentNode.removeChild(icons[i]);
      }
      var hosts = document.querySelectorAll("[" + HOST_ATTR + "]");
      for (var j = 0; j < hosts.length; j++) {
        hosts[j].removeAttribute(HOST_ATTR);
        hosts[j].removeAttribute("data-icon-key");
      }
    } catch (error) {
      report(error);
    }
  }

  var rootNode = document.body || document.documentElement;
  if (rootNode) {
    observer = new MutationObserver(onMutations);
    observer.observe(rootNode, { childList: true, subtree: true });
  }
  startStoreWatcher();
  safeScan();

  return cleanup;
}
