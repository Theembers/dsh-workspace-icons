# dsh-workspace-icons 客户端模块契约（给实现者）

## 构建

```bash
cd ~/.dsh-space/plugins/dsh-workspace-icons
node scripts/build-client.mjs     # client-src/*.js -> lib/client.js
node --check lib/client.js
```

`lib/client.js` 是生成物，**不要手改**；只改 `client-src/`。`shared.js`、`styles.js`、`builtin-icons.js` 由 Lead 维护；teammate 只改自己名下的 4 个模块文件，避免写冲突。

客户端运行环境：浏览器，`window.__ModuleLoader__.load({id, factory(require){...}})`。factory 里可用 `React`、`ReactDOM`（react-dom/client）；**不能**用 import/export，也不能 require 相对文件。所有模块由 build 脚本内联。

## 模块契约

`client-src/<name>.js` 的内容整体是一个函数表达式：

```js
function (ctx, shared, React, ReactDOM) {
  // 初始化：注册 slot / observer / 监听
  return function cleanup() { /* 必须幂等、可重复调用 */ };
}
```

- `ctx`：Cordis 客户端插件上下文。典型 API：`ctx.slots.inject(slotName, () => ctx.slots.register({...}, Component))`、`ctx.effect(fn, label)`、`ctx.locale`。
- `shared`：共享层，见下。
- `React`、`ReactDOM`（`ReactDOM.createRoot`）。
- 抛错会被 build 出来的 entry 捕获并 console.warn，不会拖垮整个插件，但该模块失效。
- 不要使用 JSX（没有转译）。用 `React.createElement`。

## shared API（完整定义见 client-src/shared.js）

数据/状态：

- `shared.NS` = `"dsh-workspace-icons"`；`shared.API` = `"/api/dsh-workspace-icons"`
- `shared.t(key, fallback?)` 取文案（zh/en）；`shared.registerLocale(ctx)` 已由 entry 调用
- `shared.start()` / `shared.stop()` 已由 entry 调用：拉取 `/state`，focus/visibility/20s 刷新
- `shared.useStore()` → `{config, workspaces}`（React hook，数据变化自动重渲染；未加载时 null）
- `shared.currentData()` / `shared.refresh()` → Promise
- `shared.workspaceById(id)` → `{workspaceId,title,path}` 或 null
- `shared.workspaceSpecificIcon(id)` → 该工作区单独配置的 ref 或 null
- `shared.workspaceIconFor(id)` → 生效图标（单独配置 → 默认），可能 null
- `shared.defaultWorkspaceIcon()` / `shared.sessionIcon()` → ref 或 null
- `shared.isImSession(sessionId, titleText)` → boolean（id 前缀 `dsh-im-session-` 或标题前缀 `微信 · ` / `WeChat · ` …）
- `shared.sameRef(a,b)` / `shared.iconKey(ref)` / `shared.iconLabel(ref)` / `shared.normalizeRef(ref)`
- `shared.setWorkspaceIcon(workspaceId, ref|null, {keepalive?})` → Promise；成功会本地即时更新 store
- `shared.setDefaults({workspace?,session?})`、`shared.setSettings({showDefaultWorkspaceIcon?,showDefaultSessionIcon?})`
- `shared.addCustomIcon({name, kind:"svg", svg})`、`shared.deleteCustomIcon(id)`
- `shared.linkIconify(prefix)`、`shared.unlinkIconify(prefix)`、`shared.searchIconify(prefix,q,limit)` → `{prefix,title,total,icons:[name]}`
- `shared.errorText(error)`

渲染：

- `<shared.IconGlyph icon={ref} size={16} />`（React 组件；ref 为 null 时返回 null）
- `shared.glyphElement(ref, size)` → 原生 DOM 节点（overlay 用）
- `shared.injectStyles()` 已调用，样式类见 client-src/styles.js（全部以 `dwi-` 开头）
- `<shared.IconPicker value onChange allowFollowDefault allowClear initialTab />`
  - `onChange(ref|null)`；内置/自定义/图标库三个 tab；会自行加载库与搜索
  - 在重命名弹窗里用 `allowFollowDefault`（null = 跟随默认）
  - 在设置面板里用 `allowClear`（null = 清除/未设置）

配置数据结构（服务端返回）：

```json
{
  "config": {
    "version": 1,
    "libraries": { "iconify": [{"prefix":"lucide","title":"Lucide","total":2029,"linkedAt":"..."}] },
    "customIcons": [{"id":"ci_xxx","name":"rocket","kind":"svg","svg":"<svg…>"}],
    "workspaceIcons": { "<workspaceId>": {"type":"builtin","name":"rocket"} },
    "defaults": { "workspace": ref|null, "session": ref|null },
    "settings": { "showDefaultWorkspaceIcon": true, "showDefaultSessionIcon": true }
  },
  "workspaces": [{"workspaceId":"…","title":"…","path":"…"}]
}
```

ref 形态：`{type:"builtin",name}` / `{type:"iconify",prefix,name}` / `{type:"custom",id}`。

## 已确认的 DSH DOM / slot 事实（0.2.2-rc.1）

- 工作区行：`div[role="treeitem"][data-row-key="workspace:<workspaceId>"]`；内部结构：`span[class*="slot"][class*="folder"]`（原生 folder svg）→ `span[class*="chevron"]` → `span[class*="projectText"] > span[class*="title"]` → `span[class*="rowActions"]`。
- 原生工作区没有 icon slot。用 MutationObserver + DOM 装饰：给 folder span 加 **attribute** `data-dwi-folder-host="1"`（CSS 隐藏其直接 svg），追加 `span.dwi-workspace-icon`（内含 `shared.glyphElement(ref, 16)`）。标记必须用 attribute 而不是 class —— 宿主 React 每次重渲染都会重写 folder 槽的 className，class 会被冲掉、原生文件夹图标就会闪一下。同一行图标未变化时不要重建（用 `data-icon-key` 比较，避免 observer 自触发循环）。
- 会话行 leading slot：`ctx.slots.inject("sidebar.session.row.leading", () => ctx.slots.register({ name:"sidebar.session.row.leading", id:"dsh-workspace-icons-session", order:50, locale: shared.NS }, SessionIcon))`；owner props 只有 `{sessionId}`；archived/blank 或展示运行状态点时不渲染。
- 会话标题 DOM：从组件根节点 `closest('[role="treeitem"]')`，再找 `[class*="title"]` 的 textContent。IM 标题形如 `微信 · 标题`。
- 重命名弹窗：`div[role="dialog"][aria-label="重命名工作区"]`（英文 `Rename workspace`）。body 内 `input[data-modal-autofocus]`；footer 是 dialog 内最后一个按钮组（取消 + 重命名）。**没有 slot**。
  - 取 workspaceId：input 元素上找 `__reactFiber$*` key，沿 `.return` 向上找 `memoizedProps.request?.action === "rename"`，取 `request.workspaceId`；再找 `memoizedProps.workspaceId`。
  - 兜底：弹窗打开瞬间记录 input.value，用 `shared.currentData().workspaces` 中 `title === 初始值` 唯一匹配。
  - 提交：捕获 footer 最后一个按钮（主按钮）的 click（capture 阶段）或 input 的 Enter，调 `shared.setWorkspaceIcon(wsId, draftRef, {keepalive:true})`。取消/Escape/关闭不提交。仅在 draft 与初始值不同时提交。
  - 注入容器：input 之后插入 `div.dwi-rename-section`；用 `ReactDOM.createRoot` 渲染 `shared.IconPicker`；弹窗移除时 unmount + 清理状态。
- 设置页：
  - 设置页收口在「设置」面板：`ctx.slots.inject("settings.section", () => ctx.slots.register({name:"settings.section", id:"dsh-workspace-icons", order:100, locale: shared.NS, label: () => shared.t("panel.title"), inject: () => ({ t: shared.t })}, SettingsPanel))`
  - 同 id 的导航图标：`ctx.slots.inject("settings.section.icon", () => ctx.slots.register({name:"settings.section.icon", id:"dsh-workspace-icons", order:100, locale: shared.NS, label: () => shared.t("panel.title")}, SettingsNavIcon))`
  - 注意：宿主设置 shell 的内容容器是 `._xxx_options{overflow-y:auto}`，面板根节点用 `height:100%;overflow:auto` 即可在面板内滚动。
  - 面板根节点必须 `height:100%;min-height:0`，滚动放内部（用 `.dwi-page`）。

## 验收

- `node scripts/build-client.mjs && node --check lib/client.js` 通过。
- 逻辑健壮：多次初始化/卸载不重复注入；observer 幂等；所有 async 错误被捕获并显示，不 throw 到全局。
- 之后由 verifier 在真实 DSH web 实例上验证，因此选择器/结构改动需严格依据上面事实。
