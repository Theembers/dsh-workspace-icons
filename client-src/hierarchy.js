// 侧栏「工作区 / 会话」层级样式（纯 DOM overlay）。
//
// 契约见 client-src/CONTRACT.md：
//   - 本文件不是 ESM，整体是一个函数表达式：(ctx, shared, React, ReactDOM) => cleanup。
//   - 不能用 import/export/JSX，用 React.createElement。
//   - 返回值 cleanup 必须幂等、可重复调用。
//
// 背景：DSH 0.2.2 的工作区浏览器把「工作区行」和它的「会话行」放在同一个
// groupSection 里，二者的 padding-inline-start 完全相同（都只受
// --dsh-workspace-indent 影响，而这个变量只表示「工作区套工作区」的嵌套深度）。
// 于是视觉上工作区和它下面的会话是平级的，层级关系不清晰。
//
// 本模块给会话行额外加一级缩进，并给工作区行加一条左侧竖线，
// 让「工作区 → 会话」形成可读的两级结构：
//   - 会话行：padding-inline-start = 基础缩进 + 14px
//   - 工作区行：保持原缩进，并绘制一条引导竖线（--dsh-workspace-tree-line）
// 只改 CSS 变量与 class，不改 DOM 结构，卸载时完全还原。
function (ctx, shared, React, ReactDOM) {
  void ctx;
  void shared;
  void React;
  void ReactDOM;

  var GROUP_SELECTOR = 'div[class*="groupSection"]';
  var ROW_SELECTOR = 'div[role="treeitem"]';
  var WORKSPACE_PREFIX = "workspace:";
  var SESSION_PREFIX = "session:";

  var CLASS_GROUP = "dwi-tree-group";
  var CLASS_SESSION = "dwi-tree-session";
  var CLASS_SESSION_LAST = "dwi-tree-session-last";
  var CLASS_WORKSPACE = "dwi-tree-workspace";

  var DEBOUNCE_MS = 80;

  // 会话相对工作区多缩进一级（一级 = 12px，再加 2px 让层级更明显）。
  var SESSION_STEP = 14;

  // 竖线画在工作区文件夹图标的水平中心。
  // 宿主给工作区行留了 3px 透明左边框 + 9px padding，再是 16px 宽的图标槽，
  // 所以图标中心 = 边框盒左缘 + 3 + 9 + 8 = +20px。LINE_LEFT 就是这个偏移量。
  var LINE_LEFT = 20;

  // 宿主每一行都带 3px 透明左边框（给激活指示器预留）。
  // 绝对定位伪元素的包含块是行的 **padding box**，也就是「边框盒 + 左边框宽度」，
  // 比我们算图标位置时用的「边框盒」右移了这么多 —— 不减掉的话线会整体右偏 3px。
  var rowBorderLeft = 3;

  if (typeof document === "undefined") return function () {};

  var stopped = false;
  var timer = null;
  var selfMutating = false;
  var observer = null;

  function report(error) {
    try {
      console.warn("[dsh-workspace-icons] hierarchy:", error);
    } catch (_) {}
  }

  /* ---------------------------------------------------------------- 调度 */

  function schedule() {
    if (stopped || timer !== null) return;
    timer = setTimeout(function () {
      timer = null;
      if (stopped) return;
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(function () {
          if (!stopped) safeScan();
        });
      } else {
        safeScan();
      }
    }, DEBOUNCE_MS);
  }

  function safeScan() {
    try {
      scan();
    } catch (error) {
      report(error);
    }
  }

  /* ------------------------------------------------------------ DOM 变更 */

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

  function onMutations(records) {
    if (stopped || selfMutating) return;
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (!record || record.type !== "childList") continue;
      var target = record.target;
      // 我们只改属性与 class，不改结构；结构性变更才需要重扫。
      var relevant = record.addedNodes.length > 0 || record.removedNodes.length > 0;
      if (relevant) {
        schedule();
        return;
      }
    }
  }

  /* -------------------------------------------------------------- 装饰 */

  // 宿主把「工作区行」和「会话行」放在同一个 groupSection 里。
  // 我们按 groupSection 逐个处理：第一个 workspace 行是组头，
  // 其后的 session 行都是该组的子会话。
  function scan() {
    if (stopped) return;
    var groups = document.querySelectorAll(GROUP_SELECTOR);
    for (var i = 0; i < groups.length; i++) {
      decorateGroup(groups[i]);
    }
    // 清掉已经不在任何 group 里的残留标记。
    cleanupOrphans();
  }

  function rowKeyOf(row) {
    return row.getAttribute("data-row-key") || "";
  }

  function decorateGroup(group) {
    // 宿主的 groupSection 里，每一行都被包在 span._root_xxx 里，
    // 所以不能只看 groupSection 的直接子级，要取所有后代行。
    var rows = group.querySelectorAll(ROW_SELECTOR);
    var depth = parseDepth(group);
    var lastSession = null;

    // 量一次行的左边框宽度（伪元素的包含块从 padding box 起算，要减掉它）。
    measureRowBorder(rows);

    // 先摘掉上一次扫描留下的「末行」标记，末尾再按当前顺序重新标。
    var stale = group.querySelectorAll("." + CLASS_SESSION_LAST);
    for (var s0 = 0; s0 < stale.length; s0++) stale[s0].classList.remove(CLASS_SESSION_LAST);

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      // 只处理属于本组的行：向上找到最近的 groupSection 必须是自己。
      if (closestGroup(row) !== group) continue;
      var key = rowKeyOf(row);
      if (key.indexOf(SESSION_PREFIX) === 0) {
        decorateSession(row, group, depth);
        lastSession = row;
      } else if (key.indexOf(WORKSPACE_PREFIX) === 0) {
        // 「未分组」bucket 的 row-key 是 "workspace:"（无 id）。
        if (key.length > WORKSPACE_PREFIX.length) {
          decorateWorkspace(row, group, depth);
        }
      }
    }

    // 末行不再向下延伸：否则线会拖进下一组的间距里。
    if (lastSession) {
      beginSelfMutation();
      try {
        lastSession.classList.add(CLASS_SESSION_LAST);
      } finally {
        endSelfMutation();
      }
    }
  }

  // 读取会话行实际的 border-left 宽度：宿主的行左边框宽度决定了绝对定位伪元素
  // 的包含块原点，必须按实际值补偿。只量一条会话行即可（同组行样式一致）。
  function measureRowBorder(rows) {
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (rowKeyOf(row).indexOf(SESSION_PREFIX) !== 0) continue;
      try {
        var width = parseFloat(getComputedStyle(row).borderLeftWidth);
        if (isFinite(width) && width >= 0) {
          rowBorderLeft = width;
          return;
        }
      } catch (error) {
        /* 忽略：沿用默认值 */
      }
      return;
    }
  }

  // 找到该行所属的 groupSection（跳过嵌套的子组）。
  function closestGroup(row) {
    var node = row.parentElement;
    while (node) {
      if (node.matches && node.matches(GROUP_SELECTOR)) return node;
      node = node.parentElement;
    }
    return null;
  }

  // groupSection 上的 --dsh-workspace-indent 表示工作区套工作区的嵌套深度。
  function parseDepth(group) {
    // 只认宿主写在 groupSection 上的缩进（工作区套工作区的嵌套深度）。
    var raw = group.style && group.style.getPropertyValue("--dsh-workspace-indent");
    if (!raw) return 0;
    var value = parseFloat(raw);
    if (!isFinite(value) || value < 0) return 0;
    return value / 12;
  }

  function decorateWorkspace(row, group, depth) {
    beginSelfMutation();
    try {
      row.classList.add(CLASS_WORKSPACE);
      row.classList.remove(CLASS_SESSION);
      group.classList.add(CLASS_GROUP);
      group.setAttribute("data-dwi-depth", String(depth));
      // 工作区行自己的缩进是「组缩进」，不能被会话行继承的值污染。
      row.style.setProperty("--dsh-workspace-indent", depth * 12 + "px");
      // 会话行上的竖线位置：工作区图标的水平中心（边框盒左缘 + LINE_LEFT），
      // 再按嵌套深度整体右移。--dwi-row-border 用来补偿伪元素包含块的起点偏移。
      group.style.setProperty("--dwi-line-left", depth * 12 + LINE_LEFT + "px");
      group.style.setProperty("--dwi-row-border", rowBorderLeft + "px");
    } finally {
      endSelfMutation();
    }
  }

  function decorateSession(row, group, depth) {
    beginSelfMutation();
    try {
      row.classList.add(CLASS_SESSION);
      row.classList.remove(CLASS_WORKSPACE);
      // 相对于宿主自己的缩进再多一级，让会话明确归属于上方的工作区。
      // 注意：宿主的 sessionRow 也会读同一个 --dsh-workspace-indent 变量，
      // 所以这里必须基于「组本身的缩进」而不是行上残留的值来计算。
      var base = depth * 12;
      row.style.setProperty("--dsh-workspace-indent", base + SESSION_STEP + "px");
      group.classList.add(CLASS_GROUP);
    } finally {
      endSelfMutation();
    }
  }

  // 移除已经不存在的行上残留的 class / 内联变量。
  function cleanupOrphans() {
    var sessions = document.querySelectorAll("." + CLASS_SESSION);
    for (var i = 0; i < sessions.length; i++) {
      var row = sessions[i];
      if (row.closest(GROUP_SELECTOR)) continue;
      beginSelfMutation();
      try {
        row.classList.remove(CLASS_SESSION);
        row.classList.remove(CLASS_SESSION_LAST);
        row.classList.remove(CLASS_WORKSPACE);
        row.style.removeProperty("--dsh-workspace-indent");
      } finally {
        endSelfMutation();
      }
    }
    var groups = document.querySelectorAll("." + CLASS_GROUP);
    for (var j = 0; j < groups.length; j++) {
      var group = groups[j];
      if (group.querySelector("." + CLASS_SESSION) || group.querySelector("." + CLASS_WORKSPACE)) continue;
      beginSelfMutation();
      try {
        group.classList.remove(CLASS_GROUP);
        group.removeAttribute("data-dwi-depth");
        group.style.removeProperty("--dwi-line-left");
        group.style.removeProperty("--dwi-row-border");
      } finally {
        endSelfMutation();
      }
    }
  }

  /* -------------------------------------------------------------入口卸载 */

  function cleanup() {
    if (stopped) return;
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (observer) {
      try {
        observer.disconnect();
      } catch (error) {
        report(error);
      }
      observer = null;
    }
    try {
      var rows = document.querySelectorAll(
        "." + CLASS_SESSION + ", ." + CLASS_SESSION_LAST + ", ." + CLASS_WORKSPACE
      );
      for (var i = 0; i < rows.length; i++) {
        rows[i].classList.remove(CLASS_SESSION);
        rows[i].classList.remove(CLASS_SESSION_LAST);
        rows[i].classList.remove(CLASS_WORKSPACE);
        rows[i].style.removeProperty("--dsh-workspace-indent");
      }
      var groups = document.querySelectorAll("." + CLASS_GROUP);
      for (var j = 0; j < groups.length; j++) {
        groups[j].classList.remove(CLASS_GROUP);
        groups[j].removeAttribute("data-dwi-depth");
        groups[j].style.removeProperty("--dwi-line-left");
        groups[j].style.removeProperty("--dwi-row-border");
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
  safeScan();

  return cleanup;
}
