#!/usr/bin/env node
/**
 * 把 client-src/*.js 内联成单文件 lib/client.js。
 *
 * 约束：client-src 下的文件不是 ESM，不能使用 import/export。
 *   - builtin-icons.js : 函数体，return Icon[]
 *   - styles.js        : 函数体，return CSS 字符串
 *   - shared.js        : 函数体，入参 (React, BUILTIN_ICONS, STYLES)，return 共享 API
 *   - 模块文件          : 整体是一个函数表达式 (ctx, shared, React, ReactDOM) => cleanup
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (name) => fs.readFileSync(path.join(root, "client-src", name), "utf8");

const MODULES = [
  ["hierarchy.js", "__hierarchy"],
  ["overlay-workspaces.js", "__overlayWorkspaces"],
  ["rename-icon.js", "__renameIcon"],
  ["session-icon.js", "__sessionIcon"],
  ["settings-panel.js", "__settingsPanel"],
];

const modules = MODULES.map(([file, variable]) => `    const ${variable} = (\n${src(file).trim()}\n    );\n`).join("\n");

const output = `/**
 * dsh-workspace-icons 浏览器侧入口（由 scripts/build-client.mjs 生成，请勿直接编辑）。
 * 不是 ESM：运行时由宿主注入 window.__ModuleLoader__.load。
 */
window.__ModuleLoader__.load({
  id: "dsh-workspace-icons",
  factory: function (require) {
    const React = require("react");
    const ReactDOM = require("react-dom/client");

    const BUILTIN_ICONS = (function () {
${src("builtin-icons.js").trim()}
    })();

    const STYLES = (function () {
${src("styles.js").trim()}
    })();

    const shared = (function (React, BUILTIN_ICONS, STYLES) {
${src("shared.js").trim()}
    })(React, BUILTIN_ICONS, STYLES);

${modules}

    function apply(ctx) {
      shared.registerLocale(ctx);
      shared.injectStyles();
      shared.start();
      // 暴露给自动化测试 / 排障使用（只读调试入口，不参与业务逻辑）。
      try {
        window.__dshWorkspaceIcons = shared;
      } catch {
        /* ignore */
      }
      const cleanups = [];
      const run = (moduleFactory, label) => {
        try {
          const cleanup = moduleFactory(ctx, shared, React, ReactDOM);
          if (typeof cleanup === "function") cleanups.push(cleanup);
        } catch (error) {
          console.warn("[dsh-workspace-icons] " + label + " 初始化失败", error);
        }
      };
      run(__hierarchy, "hierarchy");
      run(__overlayWorkspaces, "workspace overlay");
      run(__renameIcon, "rename icon");
      run(__sessionIcon, "session icon");
      run(__settingsPanel, "settings panel");
      ctx.effect(() => () => {
        for (const cleanup of cleanups.reverse()) {
          try {
            cleanup();
          } catch (error) {
            console.warn("[dsh-workspace-icons] cleanup failed", error);
          }
        }
        cleanups.length = 0;
        shared.stop();
      }, "dsh-workspace-icons: dispose");
    }

    return {
      name: "dsh-workspace-icons",
      inject: ["slots", "locale"],
      apply,
    };
  },
});
`;

const target = path.join(root, "lib", "client.js");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, output);
console.log(`built ${path.relative(root, target)} (${output.length} bytes)`);
