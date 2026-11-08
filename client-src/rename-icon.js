// 「重命名工作区」弹窗里的工作区图标选择区。
//
// 契约见 client-src/CONTRACT.md：
//   - 本文件不是 ESM，整体是一个函数表达式：(ctx, shared, React, ReactDOM) => cleanup。
//   - 不能用 import/export/JSX，用 React.createElement。
//   - 返回值 cleanup 必须幂等、可重复调用。
//
// 做法：用 MutationObserver 找到 `[role="dialog"]` 且带 `input[data-modal-autofocus]` 的
// 重命名弹窗。理想识别方式是 aria-label（中文「重命名工作区」/ 英文 "Rename workspace"）；
// 语言未知时退回到 React fiber：从 input 向上找 memoizedProps.request.action === "rename"。
// workspaceId 同样先从 fiber 取 request.workspaceId，再退回「用对话框初始标题在
// shared.currentData().workspaces 中做唯一匹配」。取不到 id 就不注入（只 warn 一次）。
//
// 注入内容：input 后面插一个 div.dwi-rename-section，用独立的 ReactDOM root 渲染
// shared.IconPicker（allowFollowDefault：选「跟随默认」= null）。提交时机：
//   - 点 footer 最后一个按钮（「重命名」，capture 阶段，先于宿主 handler）；
//   - input 上按 Enter（capture 阶段，避开输入法 isComposing）。
// 宿主在「标题未改动」时会把「重命名」按钮置灰（renameBlocked 含
// renameTrimmed === storedTitle），只换图标时按钮不会派发 click，因此图标有改动时
// 我们主动把该按钮的 disabled 摘掉，让它成为唯一的提交入口（不再单独提供保存按钮）。
// 取消/Escape/点关闭按钮都不提交。弹窗移除时 unmount 并移除注入节点。
function (ctx, shared, React, ReactDOM) {
  void ctx;

  var DIALOG_SELECTOR = '[role="dialog"]';
  var INPUT_SELECTOR = 'input[data-modal-autofocus]';
  var RENAME_TITLES = ["重命名工作区", "Rename workspace"];
  var SECTION_CLASS = "dwi-rename-section";
  var DEBOUNCE_MS = 60;
  var MAX_FIBER_DEPTH = 60;

  if (typeof document === "undefined") return function () {};

  var stopped = false;
  var state = null;
  var timer = null;
  var retryTimer = null;
  var observer = null;
  var warnedDialogs = typeof WeakSet === "function" ? new WeakSet() : null;
  var initialTitles = typeof WeakMap === "function" ? new WeakMap() : null;

  function report(error) {
    try {
      console.warn("[dsh-workspace-icons] rename icon:", error);
    } catch (_) {}
  }

  /* ---------------------------------------------------------- React fiber */

  function fiberOf(node) {
    if (!node) return null;
    try {
      var keys = Object.keys(node);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key.indexOf("__reactFiber$") === 0 || key.indexOf("__reactInternalInstance$") === 0) {
          return node[key];
        }
      }
    } catch (error) {
      report(error);
    }
    return null;
  }

  // 沿 return 链向上找 request.action === "rename" 的节点，返回 request.workspaceId。
  // 再兜底 memoizedProps.workspaceId（契约里约定的第二选择）。
  // 返回 { id, storedTitle }：request 里同时带 storedTitle（宿主 rename request 的字段）。
  function workspaceFromFiber(input) {
    var node = fiberOf(input);
    var fallback = null;
    for (var depth = 0; node && depth < MAX_FIBER_DEPTH; depth++) {
      var props = node.memoizedProps;
      if (props && typeof props === "object") {
        var request = props.request;
        if (request && request.action === "rename" && typeof request.workspaceId === "string" && request.workspaceId) {
          return {
            id: request.workspaceId,
            storedTitle: typeof request.storedTitle === "string" ? request.storedTitle : null
          };
        }
        if (!fallback && typeof props.workspaceId === "string" && props.workspaceId) {
          fallback = {
            id: props.workspaceId,
            storedTitle: typeof props.storedTitle === "string" ? props.storedTitle : null
          };
        }
      }
      node = node.return;
    }
    return fallback;
  }

  function hasRenameRequest(input) {
    var node = fiberOf(input);
    for (var depth = 0; node && depth < MAX_FIBER_DEPTH; depth++) {
      var props = node.memoizedProps;
      if (props && props.request && props.request.action === "rename"
        && typeof props.request.workspaceId === "string" && props.request.workspaceId) {
        return true;
      }
      node = node.return;
    }
    return false;
  }

  /* -------------------------------------------------------------- 选择器 */

  function isRenameTitle(label) {
    if (!label) return false;
    for (var i = 0; i < RENAME_TITLES.length; i++) {
      if (label === RENAME_TITLES[i]) return true;
    }
    return false;
  }

  function pickDialog() {
    var dialogs = document.querySelectorAll(DIALOG_SELECTOR);
    var candidates = [];
    var i;
    for (i = 0; i < dialogs.length; i++) {
      var dialog = dialogs[i];
      if (!dialog.isConnected) continue;
      var input = dialog.querySelector(INPUT_SELECTOR);
      if (!input) continue;
      candidates.push({ dialog: dialog, input: input });
    }
    if (!candidates.length) return null;
    // 1) 已知语言：aria-label 精确匹配。
    for (i = 0; i < candidates.length; i++) {
      var label = candidates[i].dialog.getAttribute("aria-label");
      if (isRenameTitle(label)) {
        return { dialog: candidates[i].dialog, input: candidates[i].input, titleMatched: true };
      }
    }
    // 2) 未知语言：靠 fiber 上的 workspace rename request 区分（会话重命名也复用
    //    input[data-modal-autofocus]，但 request 里没有 action === "rename"）。
    for (i = 0; i < candidates.length; i++) {
      if (hasRenameRequest(candidates[i].input)) {
        return { dialog: candidates[i].dialog, input: candidates[i].input, titleMatched: false };
      }
    }
    return null;
  }

  function initialTitleOf(input) {
    if (initialTitles && initialTitles.has(input)) return initialTitles.get(input);
    var value = (input && input.value) || "";
    if (initialTitles) initialTitles.set(input, value);
    return value;
  }

  function workspaceIdFromTitle(input) {
    var data = shared.currentData();
    var workspaces = data && data.workspaces;
    if (!workspaces || !workspaces.length) return null;
    var title = initialTitleOf(input).trim();
    if (!title) return null;
    var found = null;
    for (var i = 0; i < workspaces.length; i++) {
      var workspace = workspaces[i];
      if (!workspace || typeof workspace.title !== "string") continue;
      if (workspace.title.trim() !== title) continue;
      if (found) return null; // 重名 → 无法唯一确定
      found = workspace.workspaceId;
    }
    return found || null;
  }

  function resolveWorkspaceId(input) {
    var inputTitle = initialTitleOf(input);
    var fromFiber = workspaceFromFiber(input);
    if (fromFiber) {
      return {
        id: fromFiber.id,
        source: "fiber",
        storedTitle: fromFiber.storedTitle || inputTitle
      };
    }
    var fromTitle = workspaceIdFromTitle(input);
    if (fromTitle) return { id: fromTitle, source: "title", storedTitle: inputTitle };
    return null;
  }

  /* ------------------------------------------------------------ 生命周期 */

  function schedule() {
    if (stopped || timer !== null) return;
    timer = setTimeout(function () {
      timer = null;
      if (!stopped) safeScan();
    }, DEBOUNCE_MS);
  }

  function scheduleRetry() {
    if (stopped || retryTimer !== null) return;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      if (!stopped) safeScan();
    }, 400);
  }

  function safeScan() {
    try {
      scan();
    } catch (error) {
      report(error);
    }
  }

  function scan() {
    if (stopped) return;
    var found = pickDialog();
    if (state) {
      if (!state.dialog.isConnected) {
        teardown();
      } else if (found && found.dialog !== state.dialog) {
        // 旧弹窗被新的重命名弹窗替换。
        teardown();
      }
    }
    if (!state) {
      if (!found) return;
      if (!mount(found)) return;
    }
    ensureSection();
  }

  function mount(found) {
    var resolved = resolveWorkspaceId(found.input);
    if (!resolved) {
      if (!shared.currentData()) {
        // 数据还没加载，刷新一次后重试；仍失败再 warn。
        try {
          shared.refresh().catch(report);
        } catch (error) {
          report(error);
        }
        scheduleRetry();
        return false;
      }
      if (!warnedDialogs || !warnedDialogs.has(found.dialog)) {
        if (warnedDialogs) warnedDialogs.add(found.dialog);
        console.warn("[dsh-workspace-icons] 无法确定重命名弹窗对应的 workspaceId，已跳过图标注入");
      }
      return false;
    }

    var baseline = null;
    var dataReady = !!shared.currentData();
    if (dataReady) {
      try {
        baseline = shared.workspaceSpecificIcon(resolved.id);
      } catch (error) {
        report(error);
      }
    } else {
      try {
        shared.refresh().catch(report);
      } catch (error) {
        report(error);
      }
    }

    state = {
      dialog: found.dialog,
      input: found.input,
      workspaceId: resolved.id,
      storedTitle: resolved.storedTitle,
      baselineRef: baseline,
      draftRef: baseline,
      baselineLoaded: dataReady,
      section: null,
      root: null,
      signature: "",
      saving: false,
      status: "",
      error: ""
    };
    found.dialog.addEventListener("click", onDialogClickCapture, true);
    found.input.addEventListener("keydown", onInputKeyDownCapture, true);
    ensureButtonObserver();
    return true;
  }

  function teardown() {
    var snapshot = state;
    state = null;
    if (!snapshot) return;
    try {
      snapshot.dialog.removeEventListener("click", onDialogClickCapture, true);
    } catch (error) {
      report(error);
    }
    try {
      snapshot.input.removeEventListener("keydown", onInputKeyDownCapture, true);
    } catch (error) {
      report(error);
    }
    if (buttonObserver) {
      try {
        buttonObserver.disconnect();
      } catch (error) {
        report(error);
      }
      buttonObserver = null;
    }
    if (snapshot.root) {
      try {
        snapshot.root.unmount();
      } catch (error) {
        report(error);
      }
      snapshot.root = null;
    }
    if (snapshot.section && snapshot.section.parentNode) {
      try {
        snapshot.section.parentNode.removeChild(snapshot.section);
      } catch (error) {
        report(error);
      }
    }
  }

  function ensureSection() {
    if (!state || stopped) return;
    var dialog = state.dialog;
    if (!dialog.isConnected) {
      teardown();
      return;
    }
    var input = state.input;
    if (!input || !input.isConnected) {
      var nextInput = dialog.querySelector(INPUT_SELECTOR);
      if (!nextInput) return; // React 重渲染的瞬时状态，下次 scan 再补。
      if (input) {
        try {
          input.removeEventListener("keydown", onInputKeyDownCapture, true);
        } catch (error) {
          report(error);
        }
      }
      state.input = nextInput;
      nextInput.addEventListener("keydown", onInputKeyDownCapture, true);
      input = nextInput;
    }

    if (!state.section) {
      var section = document.createElement("div");
      section.className = SECTION_CLASS;
      section.setAttribute("data-dwi-injected", "1");
      state.section = section;
      try {
        state.root = ReactDOM.createRoot(section);
      } catch (error) {
        report(error);
        state.root = null;
        teardown();
        return;
      }
    }

    var parent = input.parentElement;
    if (!parent) return;
    // 被 React 重渲染丢掉或位置不对时补回 input 之后。
    if (state.section.parentNode !== parent || state.section.previousElementSibling !== input) {
      try {
        parent.insertBefore(state.section, input.nextSibling);
      } catch (error) {
        report(error);
        return;
      }
    }

    syncBaselineFromStore();
    render();
  }

  // 弹窗打开时若配置数据尚未加载，数据到达后若用户还没改选择，就把 baseline/draft 跟上。
  function syncBaselineFromStore() {
    if (!state || state.saving || state.baselineLoaded) return;
    if (!shared.currentData()) return;
    var actual = null;
    try {
      actual = shared.workspaceSpecificIcon(state.workspaceId);
    } catch (error) {
      report(error);
      return;
    }
    state.baselineLoaded = true;
    if (shared.sameRef(state.draftRef, state.baselineRef)) {
      state.baselineRef = actual;
      state.draftRef = actual;
    } else {
      state.baselineRef = actual;
    }
    state.signature = "";
  }

  /* -------------------------------------------------------------- 渲染 */

  function render() {
    if (!state || !state.root) return;
    var signature = [
      shared.iconKey(state.draftRef),
      shared.iconKey(state.baselineRef),
      state.saving ? "1" : "0",
      state.error || "",
      state.status || ""
    ].join("|");
    if (signature === state.signature) return;
    state.signature = signature;

    var changed = !shared.sameRef(state.draftRef, state.baselineRef);
    var children = [
      React.createElement("div", { className: "dwi-rename-head", key: "head" },
        React.createElement("strong", null, shared.t("rename.section", "工作区图标")),
        React.createElement("span", { className: "dwi-rename-hint" },
          shared.t("rename.hint", "用于在侧栏区分工作区"))
      ),
      React.createElement("div", { className: "dwi-rename-picker", key: "picker" },
        React.createElement(shared.IconPicker, {
          value: state.draftRef,
          allowFollowDefault: true,
          onChange: onPick
        })
      )
    ];
    if (state.error) {
      children.push(React.createElement("p", {
        className: "dwi-error",
        key: "error",
        role: "alert"
      }, state.error));
    } else if (state.status) {
      children.push(React.createElement("p", { className: "dwi-rename-hint", key: "status" }, state.status));
    }
    if (changed) {
      // 只换图标时宿主会把「重命名」按钮置灰，这里提示用户用该按钮一并提交。
      children.push(React.createElement("p", { className: "dwi-rename-hint", key: "tip" },
        shared.t("rename.tip", "图标将与名称一起通过「重命名」保存")));
    }

    try {
      state.root.render(React.createElement(React.Fragment, null, children));
    } catch (error) {
      report(error);
    }
    syncConfirmButton();
  }

  function onPick(ref) {
    if (!state || state.saving) return;
    var normalized = null;
    if (ref) {
      try {
        normalized = shared.normalizeRef(ref);
      } catch (error) {
        report(error);
        return;
      }
      if (!normalized) return; // 非法引用直接忽略
    }
    state.draftRef = normalized;
    state.status = "";
    state.error = "";
    render();
  }

  /* -------------------------------------------------------------- 提交 */

  function applyFailure(error, workspaceId) {
    report(error);
    if (!state || state.workspaceId !== workspaceId) return;
    state.saving = false;
    var detail = "";
    try {
      detail = shared.errorText(error);
    } catch (_) {
      detail = "";
    }
    var template = "";
    try {
      template = shared.t("status.saveFailed", "保存失败：{detail}");
    } catch (_) {
      template = "保存失败：{detail}";
    }
    state.error = template.replace("{detail}", detail || String(error));
    render();
  }

  // 只改图标时宿主「重命名」按钮是 disabled，宿主 confirmRename 会直接 return，
  // 弹窗不会自行关闭。这里判断标题没变时替宿主把弹窗关掉。
  function closeIfTitleUnchanged() {
    if (!state || !state.dialog || !state.input) return;
    var input = state.input;
    var titleChanged = false;
    try {
      var current = String(input.value || "").trim();
      titleChanged = !!current && current !== String(state.storedTitle || "").trim();
    } catch (error) {
      report(error);
    }
    if (titleChanged) return; // 标题也改了：宿主会正常改名并关闭弹窗。
    var dialog = state.dialog;
    // 点 footer 的「取消」等价于关闭（host 的 closeRename 只做 settleWorkspaceAction）。
    var footer = footerOf(dialog);
    var buttons = footer ? footer.querySelectorAll("button") : [];
    if (buttons.length) {
      try {
        buttons[0].click(); // 第一个是「取消」
        return;
      } catch (error) {
        report(error);
      }
    }
    // 兜底：移除弹窗节点。
    try {
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
    } catch (error) {
      report(error);
    }
  }

  function commit(reason) {
    if (!state || state.saving) return;
    var draft = state.draftRef;
    if (shared.sameRef(draft, state.baselineRef)) return; // 与打开时相同，无需提交
    var payload = draft || null;
    if (payload) {
      try {
        payload = shared.normalizeRef(payload);
      } catch (error) {
        applyFailure(error, state.workspaceId);
        return;
      }
      if (!payload) return;
    }
    var workspaceId = state.workspaceId;
    state.saving = true;
    state.error = "";
    state.status = "";
    render();

    var promise;
    try {
      promise = shared.setWorkspaceIcon(workspaceId, payload, { keepalive: true });
    } catch (error) {
      applyFailure(error, workspaceId);
      return;
    }
    Promise.resolve(promise).then(function () {
      if (!state || state.workspaceId !== workspaceId) return;
      state.saving = false;
      state.baselineRef = payload;
      state.draftRef = payload;
      state.status = shared.t("status.saved", "已保存");
      state.error = "";
      render();
      closeIfTitleUnchanged();
    }).catch(function (error) {
      applyFailure(error, workspaceId);
    });
  }

  /* -------------------------------------------------------------- 监听 */

  function footerOf(dialog) {
    var children = dialog.children;
    for (var i = children.length - 1; i >= 0; i--) {
      var child = children[i];
      if (!child || child.nodeType !== 1) continue;
      if (child.classList && child.classList.contains("footer")) return child;
      var className = typeof child.className === "string" ? child.className : "";
      if (className && className.indexOf("footer") !== -1) return child;
    }
    // 兜底：dialog 内最后一个非注入区按钮的父元素。
    var buttons = dialog.querySelectorAll("button");
    for (var j = buttons.length - 1; j >= 0; j--) {
      var button = buttons[j];
      if (state && state.section && state.section.contains(button)) continue;
      if (button.parentElement) return button.parentElement;
    }
    return null;
  }

  // 找到 footer 里的主按钮（「重命名」）。宿主 Modal 的 footer 是 dialog 的兄弟节点，
  // 结构上带 .footer 类名；这里做多重兜底。
  function confirmButton(dialog) {
    var footer = footerOf(dialog);
    var scope = footer || dialog;
    var buttons = scope.querySelectorAll("button");
    if (!buttons.length) return null;
    // 最后一个按钮就是「重命名」（「取消」在前）。
    return buttons[buttons.length - 1];
  }

  // 宿主在标题未改动时把「重命名」按钮置灰；图标有改动时摘掉 disabled，
  // 让用户点同一个按钮同时保存名称和图标。
  function syncConfirmButton() {
    if (!state || !state.dialog) return;
    var button = confirmButton(state.dialog);
    if (!button) return;
    var changed = !shared.sameRef(state.draftRef, state.baselineRef);
    if (changed) {
      if (button.disabled) {
        button.disabled = false;
        button.removeAttribute("disabled");
        button.setAttribute("data-dwi-enabled", "1");
      }
    } else if (button.getAttribute("data-dwi-enabled") === "1") {
      // 图标回到原样：恢复宿主原本的置灰状态（由 React 重新渲染决定）。
      button.removeAttribute("data-dwi-enabled");
    }
  }

  // 宿主重渲染会把 disabled 重新贴回去，用属性观察器持续把「有图标改动」状态下的按钮点亮。
  var buttonObserver = null;

  function ensureButtonObserver() {
    if (buttonObserver || !state || !state.dialog) return;
    if (typeof MutationObserver !== "function") return;
    try {
      buttonObserver = new MutationObserver(function () {
        syncConfirmButton();
      });
      buttonObserver.observe(state.dialog, {
        attributes: true,
        attributeFilter: ["disabled"],
        subtree: true,
      });
    } catch (error) {
      report(error);
      buttonObserver = null;
    }
  }

  function onDialogClickCapture(event) {
    if (!state) return;
    var target = event.target;
    if (!target || !target.closest) return;
    var button = target.closest("button");
    if (!button) return;
    if (!state.dialog.contains(button)) return;
    if (state.section && state.section.contains(button)) return;
    var footer = footerOf(state.dialog);
    if (!footer || !footer.contains(button)) return;
    var buttons = footer.querySelectorAll("button");
    if (!buttons.length) return;
    // 只认 footer 里最后一个按钮（「重命名」），「取消」不提交。
    if (buttons[buttons.length - 1] !== button) return;
    commit("dialog-confirm");
  }

  function onInputKeyDownCapture(event) {
    if (!state) return;
    if (event.target !== state.input) return;
    if (event.key !== "Enter") return;
    if (event.isComposing || event.keyCode === 229) return;
    commit("enter");
  }

  /* -------------------------------------------------------- observer 过滤 */

  function isInsideSection(node) {
    if (!state || !state.section || !node) return false;
    if (node === state.section) return true;
    if (node.nodeType === 1 && state.section.contains(node)) return true;
    return false;
  }

  function isOwnNode(node) {
    if (!node) return false;
    if (node.nodeType === 3) return true;
    if (node.nodeType !== 1) return false;
    if (state && state.section && (node === state.section || node.contains(state.section))) return true;
    var className = node.getAttribute ? node.getAttribute("class") || "" : "";
    return className.indexOf("dwi-rename-section") !== -1;
  }

  function onMutations(records) {
    if (stopped) return;
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (!record || record.type !== "childList") continue;
      if (isInsideSection(record.target)) continue; // 自己的渲染
      var relevant = false;
      var j;
      for (j = 0; j < record.addedNodes.length; j++) {
        if (!isOwnNode(record.addedNodes[j])) {
          relevant = true;
          break;
        }
      }
      if (!relevant) {
        for (j = 0; j < record.removedNodes.length; j++) {
          var removed = record.removedNodes[j];
          // React 重渲染把注入节点/输入框整个丢掉时，仍要补扫一次把它们补回来。
          if (state && (removed === state.section || removed === state.input)) {
            relevant = true;
            break;
          }
          if (!isOwnNode(removed)) {
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

  /* -------------------------------------------------------------入口卸载 */

  function cleanup() {
    if (stopped) return;
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (observer) {
      try {
        observer.disconnect();
      } catch (error) {
        report(error);
      }
      observer = null;
    }
    teardown();
  }

  var rootNode = document.body || document.documentElement;
  if (rootNode) {
    observer = new MutationObserver(onMutations);
    observer.observe(rootNode, { childList: true, subtree: true });
  }
  safeScan();

  return cleanup;
}
