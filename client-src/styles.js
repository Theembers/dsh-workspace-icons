// 全局样式：由 client.js 在 apply() 时注入到 <head>，卸载时随页面生命周期失效。
return `
.dwi-glyph{display:inline-block;flex:none;vertical-align:middle}
.dwi-glyph-img{object-fit:contain;display:block}
.dwi-glyph-mask{display:inline-block;flex:none}

/* ---------------- 侧栏工作区图标（DOM overlay） ---------------- */
/* 用 attribute 而不是 class 标记：宿主的 React 每次重渲染都会重写 folder 槽的
   className（active 时加 folderActive），class 会被冲掉、原生文件夹图标就会闪一下。 */
[data-dwi-folder-host="1"]{position:relative;display:inline-flex!important}
[data-dwi-folder-host="1"] > svg{visibility:hidden}
/* 宿主默认 display:none 隐藏 folder 槽，hover 时还会再藏一次（为了露出 chevron）；
   工作区图标需要常驻可见，因此两个状态都强制显示。 */
[class*="projectRow"] [class*="folder"][data-dwi-folder-host="1"]{display:inline-flex!important}
.dwi-workspace-icon{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
/* 工作区图标沿用宿主 folder 槽的颜色（currentColor，见 shared.maskStyle）：
   普通工作区是 label-tertiary 的灰，当前工作区会像宿主的 folder 图标一样高亮。
   不要在这里按选中态改颜色，否则会和宿主自己的图标不一致。 */
.dwi-workspace-icon .dwi-glyph{opacity:.95}

/* ---------------- 侧栏会话默认图标 ---------------- */
/* 图标由 session-icon.js 通过 attribute + 伪元素绘制在会话标题 span 内部，
   与 IM 插件的渠道 logo 占同一坐标，保证 GUI 会话与 IM 会话缩进完全对齐。
   规则本体在 session-icon.js 注入的 <style> 里，这里只做兜底注释说明。 */

/* ---------------- 重命名弹窗注入 ---------------- */
.dwi-rename-section{margin-top:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:8px}
.dwi-rename-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.dwi-rename-head strong{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dwi-rename-hint{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dwi-rename-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dwi-rename-preview{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dwi-rename-preview .dwi-glyph{margin:0}
.dwi-rename-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dwi-rename-picker{max-height:280px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1);padding:8px}

/* ---------------- 通用按钮/输入 ---------------- */
.dwi-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1;padding:7px 10px;border-radius:8px;cursor:pointer;white-space:nowrap}
.dwi-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dwi-btn:disabled{opacity:.45;cursor:not-allowed}
.dwi-btn-primary{border-color:transparent;background:var(--dsw-alias-state-business-primary,#3b82f6);color:#fff}
.dwi-btn-primary:hover{filter:brightness(.96);background:var(--dsw-alias-state-business-primary,#3b82f6)}
.dwi-btn-danger{border-color:transparent;background:transparent;color:var(--dsw-alias-state-error,#dc2626);padding:6px 8px}
.dwi-btn-danger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dwi-input{appearance:none;width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:8px 10px;outline:none}
.dwi-input:focus{border-color:var(--dsw-alias-state-business-primary,#3b82f6)}
.dwi-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dwi-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0}
.dwi-error{color:var(--dsw-alias-state-error,#dc2626);font-size:12px;margin:0;overflow-wrap:anywhere}

/* ---------------- 图标选择器 ---------------- */
.dwi-picker{display:flex;flex-direction:column;gap:8px;min-width:0}
.dwi-tabs{display:flex;align-items:center;gap:2px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-layer-2)}
.dwi-tab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:5px 10px;border-radius:7px;cursor:pointer;flex:1}
.dwi-tab:hover{color:var(--dsw-alias-label-primary)}
.dwi-tab.is-active{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.dwi-picker-body{min-height:180px;max-height:300px;overflow:auto;border-radius:8px}
.dwi-grid{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:4px}
.dwi-icon-btn{appearance:none;border:1px solid transparent;background:transparent;border-radius:8px;display:flex;align-items:center;justify-content:center;padding:6px;cursor:pointer;color:var(--dsw-alias-label-secondary);min-width:0}
.dwi-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dwi-icon-btn.is-selected{border-color:var(--dsw-alias-state-business-primary,#3b82f6);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dwi-picker-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px;flex-wrap:wrap}
.dwi-current{display:inline-flex;align-items:center;gap:5px;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dwi-current-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px}
.dwi-picker-actions{display:flex;align-items:center;gap:6px}
.dwi-lib{display:flex;flex-direction:column;gap:8px}
.dwi-lib-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dwi-chip{display:inline-flex;align-items:center;gap:2px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:3px 4px 3px 9px;border-radius:999px}
.dwi-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dwi-chip.is-active{border-color:var(--dsw-alias-state-business-primary,#3b82f6);color:var(--dsw-alias-label-primary)}
.dwi-chip-label{appearance:none;border:0;background:none;color:inherit;font:inherit;font-size:12px;padding:2px 0;cursor:pointer;line-height:1.4}
.dwi-chip-close{appearance:none;border:0;background:none;color:inherit;font:inherit;font-size:13px;line-height:1;width:18px;height:18px;border-radius:999px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;opacity:.55}
.dwi-chip-close:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover)}
.dwi-chip-close:disabled{opacity:.35;cursor:not-allowed}
.dwi-link-row{display:flex;align-items:center;gap:6px}
.dwi-link-row .dwi-input{flex:1;min-width:0}

/* ---------------- 设置面板 ---------------- */
.dwi-page{width:100%;height:100%;min-height:0;overflow:auto;color:var(--dsw-alias-label-primary);background:transparent;font-size:14px;line-height:1.55}
.dwi-content{width:100%;padding:16px 0 24px;box-sizing:border-box;display:flex;flex-direction:column;gap:16px}
.dwi-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:4px}
.dwi-title{margin:0;font-size:18px;font-weight:650;letter-spacing:.01em}
.dwi-subtitle{margin:4px 0 0;font-size:13px;color:var(--dsw-alias-label-secondary)}
.dwi-head-actions{display:flex;align-items:center;gap:8px;flex:none}
.dwi-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:16px;display:flex;flex-direction:column;gap:12px}
.dwi-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dwi-card-title{margin:0;font-size:14px;font-weight:620}
.dwi-section-hint{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.dwi-row{display:flex;align-items:center;gap:12px;min-height:44px;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.dwi-row:first-of-type{border-top:0;padding-top:0}
.dwi-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.dwi-row-name{font-size:13px;font-weight:560;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dwi-row-path{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dwi-row-icon{width:30px;height:30px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);flex:none}
.dwi-row-actions{display:flex;align-items:center;gap:6px;flex:none}
.dwi-inline-picker{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);padding:10px;margin:4px 0 2px}
.dwi-switch-row{display:flex;align-items:center;justify-content:space-between;gap:16px}
.dwi-switch{position:relative;display:inline-flex;flex:none;width:38px;height:22px;border-radius:999px;background:var(--dsw-alias-border-l3,#d4d4d8);transition:background .16s ease;cursor:pointer;border:0;padding:0}
.dwi-switch::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .16s ease}
.dwi-switch.is-on{background:var(--dsw-alias-state-business-primary,#3b82f6)}
.dwi-switch.is-on::after{transform:translateX(16px)}
.dwi-badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 8px;flex:none}
.dwi-custom-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
.dwi-custom-card{display:flex;align-items:center;gap:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:7px 8px;min-width:0}
.dwi-custom-card .dwi-name{flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dwi-divider{height:1px;background:var(--dsw-alias-border-l1);margin:2px 0}
.dwi-form{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dwi-form .dwi-input{flex:1;min-width:140px}
.dwi-footer-note{font-size:11px;color:var(--dsw-alias-label-tertiary);text-align:center;padding-top:4px}
.dwi-file{display:none}
.dwi-file-label{display:inline-flex;align-items:center;gap:6px;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;padding:7px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dwi-file-label:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dwi-loading{padding:40px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.dwi-empty{padding:18px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px;border:1px dashed var(--dsw-alias-border-l2);border-radius:9px}
.dwi-catalog-list{display:flex;flex-direction:column;gap:4px;max-height:320px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:6px;background:var(--dsw-alias-bg-layer-1)}
.dwi-catalog-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:6px}
.dwi-catalog-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dwi-catalog-row.is-linked{opacity:.75}
.dwi-catalog-name{display:flex;align-items:baseline;gap:8px;min-width:0;flex:1}
.dwi-catalog-name code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:1px 5px}
.dwi-catalog-title{font-size:13px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dwi-catalog-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.dwi-link{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary));text-decoration:underline;cursor:pointer}

/* ---- 侧栏「工作区 → 会话」层级样式 -------------------------------------
   宿主把工作区行和会话行放在同一个 groupSection 里，缩进相同，视觉平级。
   这里给会话行多一级缩进，并给工作区行加一条引导竖线，形成两级结构。 */
/* 工作区 / 会话的层级样式。
   宿主把工作区行与它的会话行放在同一个 groupSection 里，缩进完全相同，
   视觉上完全平级。这里给会话多缩进一级，并在会话行最前面画一段竖线。 */
.dwi-tree-group{position:relative}
/* 竖线画在每条会话行自己身上，横向位置取 --dwi-line-left（= 上方工作区图标的水平中心）。
   位置由 hierarchy.js 按嵌套深度算成常量，不量 DOM。
   两处补偿：① 盒子宽 2px，用渐变只把中间 1px 涂成线的颜色——
   1px 宽的盒子会被 Chromium 按整像素对齐绘制，只能落在 27.5 / 28.5 这种半像素位置，
   改用 2px 盒子 + 渐变后，线可以精确落在图标中心（28px）；
   ② 绝对定位伪元素的包含块是行的 padding box（含宿主那 3px 透明左边框），
   要减掉 --dwi-row-border，否则线会整体右偏 3px。 */
.dwi-tree-session{position:relative}
/* 每行只向下多画 2px 去盖住行间空隙：相邻两段正好首尾相接、不重叠。
   重叠会让半透明颜色叠加变深，看起来像一节一节加深的虚线。 */
.dwi-tree-session::before{content:"";position:absolute;left:calc(var(--dwi-line-left,20px) - var(--dwi-row-border,3px) - 1px);top:0;height:calc(100% + 2px);width:2px;background:linear-gradient(to right,transparent 25%,var(--dsw-alias-border-l2,rgba(127,127,127,.24)) 25% 75%,transparent 75%);pointer-events:none}
/* 本组最后一条会话不再向下延伸，免得线拖进下一组的间距。 */
.dwi-tree-session-last::before{height:100%}
.dwi-tree-workspace{position:relative}
/* 工作区行文字略微加重，让父节点更醒目（宿主标题在 span.title 里）。 */
.dwi-tree-workspace [class*="projectText"] > [class*="title"]{font-weight:500}

`;
