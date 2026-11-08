// 设置面板（挂到「设置」的 settings.section，不再占侧栏入口）。
//
// 面板覆盖：工作区默认图标与逐工作区图标、会话默认图标与开关、内置图标一览、
// Iconify 图标库关联/解除/搜索、自定义图标（SVG）新增与删除。
// 所有异步操作都有 busy / 成功 / 失败反馈；失败信息统一走 shared.errorText。
// 同一时刻只允许一个展开的 IconPicker；卸载时清理 observer / timer 与异步回写。
function (ctx, shared, React, ReactDOM) {
  const h = React.createElement;

  function isZh() {
    try {
      const lang = (typeof document !== "undefined" && document.documentElement && document.documentElement.lang) || "";
      if (String(lang).toLowerCase().split("-")[0] === "zh") return true;
      if (lang) return false;
      const nav = (typeof navigator !== "undefined" && navigator.language) || "";
      return String(nav).toLowerCase().split("-")[0] === "zh";
    } catch (error) {
      return true;
    }
  }

  // 补几处 shared.DICT 里没有的纯 UI 文案；优先跟随 DSH 界面语言。
  function text(zh, en) {
    return isZh() ? zh : en;
  }

  function validPrefix(value) {
    return /^[a-z0-9-]{2,60}$/.test(String(value || "").trim().toLowerCase());
  }

  // 只读预览格（内置图标一览 / Iconify 搜索结果）：不可点击，仅展示。
  function GlyphTile(props) {
    const title = props && props.title ? String(props.title) : "";
    return h(
      "div",
      {
        className: "dwi-icon-btn",
        title: title || undefined,
        "aria-label": title || undefined,
        role: "img",
      },
      h(shared.IconGlyph, { icon: props.icon, size: props.size || 20, url: props.url }),
    );
  }

  // 设置导航图标：内置 palette 图标，颜色跟随 currentColor，
  // 由宿主在选中/active 态设置的文字颜色自动生效。
  function SettingsNavIcon(props) {
    const size = props && typeof props.size === "number" ? props.size : 18;
    return h(
      "span",
      {
        className: "dwi-panellist-icon",
        "aria-hidden": "true",
        style: {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          flex: "none",
          color: "currentColor",
        },
      },
      h(shared.IconGlyph, { icon: { type: "builtin", name: "palette" }, size: size }),
    );
  }

  function SettingsPanel(props) {
    const t = props && typeof props.t === "function" ? props.t : shared.t;
    const data = shared.useStore();
    const config = (data && data.config) || {};
    const settings = config.settings || {};
    const defaults = config.defaults || {};
    const libraries = (config.libraries && config.libraries.iconify) || [];
    const customIcons = config.customIcons || [];
    const workspaces = (data && data.workspaces) || [];
    const builtinIcons = shared.BUILTIN_ICONS || [];

    const [picker, setPicker] = React.useState(null);
    const [busy, setBusy] = React.useState("");
    const [status, setStatus] = React.useState(null);
    const [customName, setCustomName] = React.useState("");
    const [svgText, setSvgText] = React.useState("");
    const [svgFileName, setSvgFileName] = React.useState("");
    const [searchPrefix, setSearchPrefix] = React.useState("");
    const [searchQuery, setSearchQuery] = React.useState("");
    const [searchResults, setSearchResults] = React.useState(null);
    const [searchBusy, setSearchBusy] = React.useState(false);
    const [searchError, setSearchError] = React.useState("");
    const [catalogQuery, setCatalogQuery] = React.useState("");
    const [catalogResults, setCatalogResults] = React.useState(null);
    const [catalogBusy, setCatalogBusy] = React.useState(false);
    const [catalogError, setCatalogError] = React.useState("");

    const aliveRef = React.useRef(true);
    const busyRef = React.useRef("");

    const libraryKey = libraries
      .map((library) => (library && library.prefix ? library.prefix : ""))
      .filter(Boolean)
      .join("|");

    // 统一异步执行器：全局同一时刻只跑一个操作，成功/失败都落到 status。
    const run = async (key, task, okText) => {
      if (busyRef.current) return false;
      busyRef.current = key;
      if (aliveRef.current) {
        setBusy(key);
        setStatus(null);
      }
      try {
        await task();
        if (aliveRef.current) {
          const message = okText === null ? null : typeof okText === "string" ? okText : t("status.saved");
          if (message) setStatus({ kind: "ok", text: message });
        }
        return true;
      } catch (error) {
        if (aliveRef.current) setStatus({ kind: "error", text: shared.errorText(error) });
        return false;
      } finally {
        busyRef.current = "";
        if (aliveRef.current) setBusy("");
      }
    };

    // 首次挂载：entry 已调用 shared.start()，这里兜底一次（refresh 自带去重）。
    React.useEffect(() => {
      aliveRef.current = true;
      if (!shared.currentData()) run("load", () => shared.refresh(), null);
      return () => {
        aliveRef.current = false;
      };
    }, []);

    // 已关联图标库变化时，把搜索前缀收敛到仍存在的库。
    React.useEffect(() => {
      setSearchPrefix((prev) => {
        const list = libraryKey ? libraryKey.split("|") : [];
        if (prev && list.indexOf(prev) >= 0) return prev;
        return list[0] || "";
      });
    }, [libraryKey]);

    // Iconify 搜索：输入防抖 + 卸载/切换取消。
    React.useEffect(() => {
      if (!searchPrefix) {
        setSearchResults(null);
        setSearchError("");
        setSearchBusy(false);
        return undefined;
      }
      let cancelled = false;
      const timer = setTimeout(async () => {
        if (cancelled) return;
        if (aliveRef.current) {
          setSearchBusy(true);
          setSearchError("");
        }
        try {
          const value = await shared.searchIconify(searchPrefix, searchQuery.trim(), 64);
          if (!cancelled && aliveRef.current) setSearchResults(value);
        } catch (error) {
          if (!cancelled && aliveRef.current) {
            setSearchResults(null);
            setSearchError(shared.errorText(error));
          }
        } finally {
          if (!cancelled && aliveRef.current) setSearchBusy(false);
        }
      }, searchQuery ? 300 : 0);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }, [searchPrefix, searchQuery]);

    // Iconify 图标库目录：列出所有可用前缀（按图标数排序），支持按前缀/名称/作者搜索。
    React.useEffect(() => {
      let cancelled = false;
      const timer = setTimeout(async () => {
        if (cancelled) return;
        if (aliveRef.current) {
          setCatalogBusy(true);
          setCatalogError("");
        }
        try {
          const value = await shared.searchIconifyCollections(catalogQuery.trim(), 80);
          if (!cancelled && aliveRef.current) setCatalogResults(value);
        } catch (error) {
          if (!cancelled && aliveRef.current) {
            setCatalogResults(null);
            setCatalogError(shared.errorText(error));
          }
        } finally {
          if (!cancelled && aliveRef.current) setCatalogBusy(false);
        }
      }, catalogQuery ? 300 : 0);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }, [catalogQuery]);

    const togglePicker = (key) => setPicker((prev) => (prev === key ? null : key));

    const refresh = () => {
      run("refresh", () => shared.refresh(), null);
    };

    const applyDefaultWorkspace = async (ref) => {
      const ok = await run("workspace-default", () => shared.setDefaults({ workspace: ref || null }));
      if (ok && aliveRef.current) setPicker(null);
    };

    const applyWorkspaceIcon = async (workspaceId, ref) => {
      const ok = await run("workspace:" + workspaceId, () => shared.setWorkspaceIcon(workspaceId, ref || null));
      if (ok && aliveRef.current) setPicker(null);
    };

    const applySessionIcon = async (ref) => {
      const ok = await run("session-default", () => shared.setDefaults({ session: ref || null }));
      if (ok && aliveRef.current) setPicker(null);
    };

    const showDefaultSessionIcon = settings.showDefaultSessionIcon !== false;

    const toggleSessionEnabled = () => {
      const next = !showDefaultSessionIcon;
      run("session-enabled", () => shared.setSettings({ showDefaultSessionIcon: next }));
    };

    // 只从目录列表关联：每行直接带上自己的 prefix。
    const linkLibrary = async (prefix) => {
      const normalized = String(prefix || "").trim().toLowerCase();
      if (!validPrefix(normalized)) return;
      const ok = await run("library-link:" + normalized, () => shared.linkIconify(normalized));
      if (ok && aliveRef.current) setSearchQuery("");
    };

    const unlinkLibrary = async (prefix) => {
      const ok = await run("library-unlink:" + prefix, () => shared.unlinkIconify(prefix));
      if (ok && aliveRef.current) {
        setSearchResults(null);
        // 解除的正是当前搜索范围的库时，清掉选择，避免指向一个已不存在的库。
        if (prefix === searchPrefix) setSearchPrefix("");
      }
    };

    const onPickSvgFile = (event) => {
      const input = event && event.target;
      const file = input && input.files && input.files[0];
      if (!file) return;
      if (typeof FileReader !== "function") {
        setStatus({ kind: "error", text: text("当前环境不支持读取本地文件。", "FileReader is unavailable in this environment.") });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (!aliveRef.current) return;
        const content = typeof reader.result === "string" ? reader.result : "";
        setSvgText(content);
        setSvgFileName(file.name);
        setCustomName((prev) => (String(prev || "").trim() ? prev : file.name.replace(/\.svg$/i, "")));
        if (input) input.value = "";
      };
      reader.onerror = () => {
        if (!aliveRef.current) return;
        const fallback = new Error(text("读取文件失败", "Failed to read the file"));
        setStatus({ kind: "error", text: shared.errorText(reader.error || fallback) });
        if (input) input.value = "";
      };
      try {
        reader.readAsText(file);
      } catch (error) {
        setStatus({ kind: "error", text: shared.errorText(error) });
      }
    };

    const addSvgIcon = async () => {
      const name = String(customName || "").trim();
      const svg = String(svgText || "").trim();
      if (!name || !svg) return;
      if (svg.indexOf("<svg") < 0) {
        setStatus({ kind: "error", text: text("这个文件看起来不是 SVG。", "This file does not look like an SVG.") });
        return;
      }
      const ok = await run("custom-add-svg", () => shared.addCustomIcon({ name: name, kind: "svg", svg: svg }));
      if (ok && aliveRef.current) {
        setSvgText("");
        setSvgFileName("");
        setCustomName("");
      }
    };

    const removeCustomIcon = async (id) => {
      await run("custom-delete:" + id, () => shared.deleteCustomIcon(id));
    };

    const header = h(
      "header",
      { className: "dwi-head" },
      h(
        "div",
        null,
        h("h2", { className: "dwi-title" }, t("panel.title")),
        h("p", { className: "dwi-subtitle" }, t("panel.subtitle")),
      ),
      h(
        "div",
        { className: "dwi-head-actions" },
        busy ? h("span", { className: "dwi-muted" }, t("status.loading")) : null,
        h(
          "button",
          { type: "button", className: "dwi-btn", disabled: Boolean(busy), onClick: refresh },
          t("panel.refresh"),
        ),
      ),
    );

    const statusNode = status
      ? h(
        "p",
        {
          className: status.kind === "error" ? "dwi-error" : "dwi-muted",
          role: status.kind === "error" ? "alert" : "status",
        },
        status.text,
      )
      : null;

    // 数据还没到：只显示头部 + 加载/失败状态。
    if (!data) {
      return h(
        "div",
        { className: "dwi-page", style: { height: "100%", minHeight: 0 } },
        h(
          "div",
          { className: "dwi-content" },
          header,
          statusNode,
          h(
            "div",
            { className: "dwi-loading" },
            status && status.kind === "error"
              ? h(
                "p",
                { className: "dwi-muted" },
                text(
                  "读取失败，可点右上角「刷新」重试。",
                  "Could not load the configuration. Use “Refresh” at the top right to retry.",
                ),
              )
              : t("panel.loading"),
          ),
        ),
      );
    }

    // ------------------------------------------------------------------
    // 工作区图标
    // ------------------------------------------------------------------
    const defaultWorkspaceIcon = shared.defaultWorkspaceIcon();
    const defaultWorkspaceRow = h(
      "div",
      { className: "dwi-row" },
      h(
        "span",
        { className: "dwi-row-icon" },
        defaultWorkspaceIcon
          ? h(shared.IconGlyph, { icon: defaultWorkspaceIcon, size: 18 })
          : h("span", { className: "dwi-muted" }, "—"),
      ),
      h(
        "div",
        { className: "dwi-row-main" },
        h("span", { className: "dwi-row-name" }, t("panel.workspace.default")),
        h("span", { className: "dwi-row-path" }, t("panel.workspace.defaultHint")),
      ),
      h(
        "div",
        { className: "dwi-row-actions" },
        defaultWorkspaceIcon
          ? h(
            "button",
            { type: "button", className: "dwi-btn", disabled: Boolean(busy), onClick: () => applyDefaultWorkspace(null) },
            t("picker.clear"),
          )
          : null,
        h(
          "button",
          {
            type: "button",
            className: "dwi-btn",
            disabled: Boolean(busy),
            onClick: () => togglePicker("workspace-default"),
          },
          picker === "workspace-default" ? t("common.cancel") : t("picker.choose"),
        ),
      ),
    );

    const workspaceItems = workspaces.map((workspace) => {
      const workspaceId = workspace && workspace.workspaceId;
      const specific = shared.workspaceSpecificIcon(workspaceId);
      const effective = shared.workspaceIconFor(workspaceId);
      const itemKey = "workspace:" + workspaceId;
      const isOpen = picker === itemKey;
      return h(
        React.Fragment,
        { key: workspaceId },
        h(
          "div",
          { className: "dwi-row" },
          h(
            "span",
            { className: "dwi-row-icon" },
            effective
              ? h(shared.IconGlyph, { icon: effective, size: 18 })
              : h("span", { className: "dwi-muted" }, "—"),
          ),
          h(
            "div",
            { className: "dwi-row-main" },
            h(
              "span",
              { className: "dwi-row-name", title: workspace.title || "" },
              workspace.title || t("common.unknown"),
              !specific
                ? h("span", { className: "dwi-muted", style: { marginLeft: 6 } }, "· " + t("panel.workspace.followDefault"))
                : null,
            ),
            h("span", { className: "dwi-row-path", title: workspace.path || "" }, workspace.path || ""),
          ),
          h(
            "div",
            { className: "dwi-row-actions" },
            specific
              ? h(
                "button",
                {
                  type: "button",
                  className: "dwi-btn",
                  disabled: Boolean(busy),
                  onClick: () => applyWorkspaceIcon(workspaceId, null),
                },
                t("picker.clear"),
              )
              : null,
            h(
              "button",
              {
                type: "button",
                className: "dwi-btn",
                disabled: Boolean(busy),
                onClick: () => togglePicker(itemKey),
              },
              isOpen ? t("common.cancel") : t("picker.choose"),
            ),
          ),
        ),
        isOpen
          ? h(
            "div",
            { className: "dwi-inline-picker" },
            h(shared.IconPicker, {
              value: specific,
              allowFollowDefault: true,
              onChange: (ref) => applyWorkspaceIcon(workspaceId, ref),
            }),
          )
          : null,
      );
    });

    const workspaceCard = h(
      "section",
      { className: "dwi-card" },
      h(
        "div",
        { className: "dwi-card-head" },
        h("h3", { className: "dwi-card-title" }, t("panel.workspace.section")),
        workspaces.length ? h("span", { className: "dwi-badge" }, String(workspaces.length)) : null,
      ),
      h("p", { className: "dwi-section-hint" }, t("panel.workspace.hint")),
      h("div", { className: "dwi-divider" }),
      h("div", null, defaultWorkspaceRow),
      picker === "workspace-default"
        ? h(
          "div",
          { className: "dwi-inline-picker" },
          h(shared.IconPicker, {
            value: defaultWorkspaceIcon,
            allowClear: true,
            onChange: (ref) => applyDefaultWorkspace(ref),
          }),
        )
        : null,
      h("div", { className: "dwi-divider" }),
      workspaceItems.length
        ? h("div", null, workspaceItems)
        : h("div", { className: "dwi-empty" }, text("没有可显示的工作区。", "No workspaces to show.")),
    );

    // ------------------------------------------------------------------
    // 会话图标
    // ------------------------------------------------------------------
    const sessionDefault = shared.normalizeRef(defaults.session);
    const sessionDefaultRow = h(
      "div",
      { className: "dwi-row" },
      h(
        "span",
        { className: "dwi-row-icon" },
        sessionDefault
          ? h(shared.IconGlyph, { icon: sessionDefault, size: 18 })
          : h("span", { className: "dwi-muted" }, "—"),
      ),
      h(
        "div",
        { className: "dwi-row-main" },
        h("span", { className: "dwi-row-name" }, t("panel.session.default")),
        h(
          "span",
          { className: "dwi-row-path" },
          showDefaultSessionIcon
            ? t("panel.session.defaultHint")
            : text("开关关闭时不会显示。", "Hidden while the switch is off."),
        ),
      ),
      h(
        "div",
        { className: "dwi-row-actions" },
        sessionDefault
          ? h(
            "button",
            { type: "button", className: "dwi-btn", disabled: Boolean(busy), onClick: () => applySessionIcon(null) },
            t("picker.clear"),
          )
          : null,
        h(
          "button",
          {
            type: "button",
            className: "dwi-btn",
            disabled: Boolean(busy),
            onClick: () => togglePicker("session-default"),
          },
          picker === "session-default" ? t("common.cancel") : t("picker.choose"),
        ),
      ),
    );

    const sessionCard = h(
      "section",
      { className: "dwi-card" },
      h(
        "div",
        { className: "dwi-card-head" },
        h("h3", { className: "dwi-card-title" }, t("panel.session.section")),
      ),
      h(
        "div",
        { className: "dwi-switch-row" },
        h(
          "div",
          { className: "dwi-row-main" },
          h("span", { className: "dwi-row-name" }, t("panel.session.enable")),
          h(
            "span",
            { className: "dwi-row-path" },
            showDefaultSessionIcon ? text("当前已开启", "Currently on") : text("当前已关闭", "Currently off"),
          ),
        ),
        h("button", {
          type: "button",
          className: "dwi-switch" + (showDefaultSessionIcon ? " is-on" : ""),
          role: "switch",
          "aria-checked": showDefaultSessionIcon ? "true" : "false",
          "aria-label": t("panel.session.enable"),
          disabled: Boolean(busy),
          onClick: toggleSessionEnabled,
        }),
      ),
      h("div", { className: "dwi-divider" }),
      h("div", null, sessionDefaultRow),
      picker === "session-default"
        ? h(
          "div",
          { className: "dwi-inline-picker" },
          h(shared.IconPicker, {
            value: sessionDefault,
            allowClear: true,
            onChange: (ref) => applySessionIcon(ref),
          }),
        )
        : null,
      h("p", { className: "dwi-section-hint" }, t("panel.session.hint")),
    );

    // ------------------------------------------------------------------
    // 图标库（内置 / Iconify 关联与搜索）
    // ------------------------------------------------------------------
    // 已关联的图标库 = 底部的库标签：点标签名切换搜索范围，点 × 解除关联。
    // （不再单独开一块「已关联的图标库」，解除关联只在这里做。）
    const linkedPrefixButtons = libraries.length
      ? h(
        "div",
        { className: "dwi-lib-row" },
        libraries.map((library) =>
          h(
            "span",
            {
              key: library.prefix,
              className: "dwi-chip" + (library.prefix === searchPrefix ? " is-active" : ""),
              title: (library.title || library.prefix) + (library.total ? " · " + library.total : ""),
            },
            h(
              "button",
              {
                type: "button",
                className: "dwi-chip-label",
                title: library.title || library.prefix,
                onClick: () => setSearchPrefix(library.prefix),
              },
              library.title || library.prefix,
            ),
            h(
              "button",
              {
                type: "button",
                className: "dwi-chip-close",
                "aria-label": t("panel.library.unlink") + " " + (library.title || library.prefix),
                title: t("panel.library.unlink"),
                disabled: Boolean(busy),
                onClick: () => unlinkLibrary(library.prefix),
              },
              "×",
            ),
          ),
        ),
      )
      : null;

    let searchBody = null;
    if (!libraries.length) {
      searchBody = h("p", { className: "dwi-muted" }, t("panel.library.none"));
    } else if (searchBusy) {
      searchBody = h("p", { className: "dwi-muted" }, t("picker.loading"));
    } else if (searchError) {
      searchBody = h("p", { className: "dwi-error" }, searchError);
    } else if (searchResults && searchResults.icons && searchResults.icons.length) {
      searchBody = h(
        "div",
        { className: "dwi-picker-body" },
        h(
          "div",
          { className: "dwi-grid" },
          searchResults.icons.map((item) => {
            const name = typeof item === "string" ? item : item.name;
            const svg = typeof item === "string" ? "" : item.svg || "";
            return h(GlyphTile, {
              key: name,
              icon: { type: "iconify", prefix: searchPrefix, name: name },
              title: name,
              url: svg || shared.iconifySvgUrl(searchPrefix, name),
            });
          }),
        ),
      );
    } else {
      searchBody = h("p", { className: "dwi-muted" }, t("panel.library.empty"));
    }

    // 图标库目录：可搜索的前缀清单，一键关联。
    const linkedPrefixes = libraries.map((library) => library && library.prefix).filter(Boolean);
    const catalogRows = (catalogResults && catalogResults.collections) || [];
    const catalogBody = catalogBusy
      ? h("p", { className: "dwi-muted" }, t("picker.loading"))
      : catalogError
        ? h("p", { className: "dwi-error" }, catalogError)
        : catalogRows.length
          ? h(
            "div",
            { className: "dwi-catalog-list" },
            catalogRows.map((collection) => {
              const isLinked = linkedPrefixes.indexOf(collection.prefix) !== -1;
              return h(
                "div",
                { className: "dwi-catalog-row" + (isLinked ? " is-linked" : ""), key: collection.prefix },
                h(
                  "span",
                  { className: "dwi-catalog-name" },
                  h("code", null, collection.prefix),
                  h("span", { className: "dwi-catalog-title" }, collection.title),
                ),
                h(
                  "span",
                  { className: "dwi-catalog-meta" },
                  collection.total ? collection.total + " " + t("panel.library.icons") : "",
                  collection.author ? " · " + collection.author : "",
                ),
                isLinked
                  ? h("span", { className: "dwi-badge" }, t("panel.library.linkedBadge"))
                  : h(
                    "button",
                    {
                      type: "button",
                      className: "dwi-btn dwi-btn-primary",
                      disabled: Boolean(busy),
                      onClick: () => linkLibrary(collection.prefix),
                    },
                    t("panel.library.link"),
                  ),
              );
            }),
          )
          : h("p", { className: "dwi-muted" }, t("panel.library.noMatch"));

    const libraryCard = h(
      "section",
      { className: "dwi-card" },
      h(
        "div",
        { className: "dwi-card-head" },
        h("h3", { className: "dwi-card-title" }, t("panel.library.section")),
        h("span", { className: "dwi-badge" }, t("panel.library.builtin") + " · " + builtinIcons.length),
      ),
      h("p", { className: "dwi-section-hint" }, t("panel.library.hint")),
      h(
        "div",
        { className: "dwi-picker-body" },
        h(
          "div",
          { className: "dwi-grid" },
          builtinIcons.map((icon) =>
            h(GlyphTile, {
              key: icon.name,
              icon: { type: "builtin", name: icon.name },
              title: icon.name,
            }),
          ),
        ),
      ),
      h("div", { className: "dwi-divider" }),
      h(
        "p",
        { className: "dwi-section-hint" },
        t("panel.library.catalogHint"),
        " ",
        h(
          "a",
          {
            className: "dwi-link",
            href: (catalogResults && catalogResults.browseUrl) || "https://icon-sets.iconify.design/",
            target: "_blank",
            rel: "noreferrer noopener",
          },
          t("panel.library.browse"),
        ),
      ),
      h(
        "div",
        { className: "dwi-form" },
        h("input", {
          className: "dwi-input",
          type: "search",
          value: catalogQuery,
          placeholder: t("panel.library.catalogSearch"),
          onChange: (event) => setCatalogQuery(event.target.value),
        }),
      ),
      catalogBody,
      h("div", { className: "dwi-divider" }),
      h(
        "div",
        { className: "dwi-row-main" },
        h("span", { className: "dwi-row-name" }, t("panel.library.linked")),
        h("span", { className: "dwi-row-path" }, t("panel.library.linkedHint")),
      ),
      linkedPrefixButtons,
      h(
        "div",
        { className: "dwi-form" },
        h("input", {
          className: "dwi-input",
          type: "search",
          value: searchQuery,
          placeholder: t("panel.library.search"),
          onChange: (event) => setSearchQuery(event.target.value),
        }),
      ),
      searchBody,
    );

    // ------------------------------------------------------------------
    // 自定义图标
    // ------------------------------------------------------------------
    const customGrid = customIcons.length
      ? h(
        "div",
        { className: "dwi-custom-grid" },
        customIcons.map((icon) => {
          const ref = { type: "custom", id: icon.id };
          return h(
            "div",
            { className: "dwi-custom-card", key: icon.id },
            h(shared.IconGlyph, { icon: ref, size: 20 }),
            h("span", { className: "dwi-name", title: icon.name || "" }, icon.name || t("common.unknown")),
            h(
              "button",
              {
                type: "button",
                className: "dwi-btn dwi-btn-danger",
                disabled: Boolean(busy),
                onClick: () => removeCustomIcon(icon.id),
              },
              t("panel.custom.delete"),
            ),
          );
        }),
      )
      : h("div", { className: "dwi-empty" }, t("panel.custom.none"));

    const customCard = h(
      "section",
      { className: "dwi-card" },
      h(
        "div",
        { className: "dwi-card-head" },
        h("h3", { className: "dwi-card-title" }, t("panel.custom.section")),
        h("span", { className: "dwi-badge" }, String(customIcons.length)),
      ),
      h("p", { className: "dwi-section-hint" }, t("panel.custom.hint")),
      customGrid,
      h("div", { className: "dwi-divider" }),
      h(
        "div",
        { className: "dwi-form" },
        h("input", {
          className: "dwi-input",
          type: "text",
          value: customName,
          placeholder: t("panel.custom.name"),
          onChange: (event) => setCustomName(event.target.value),
        }),
        h("input", {
          id: "dwi-custom-svg",
          className: "dwi-file",
          type: "file",
          accept: ".svg,image/svg+xml",
          onChange: onPickSvgFile,
        }),
        h(
          "label",
          {
            className: "dwi-file-label",
            htmlFor: "dwi-custom-svg",
            title: svgFileName || t("panel.custom.svg"),
          },
          svgFileName || t("panel.custom.svg"),
        ),
        h(
          "button",
          {
            type: "button",
            className: "dwi-btn dwi-btn-primary",
            disabled: Boolean(busy) || !svgText || !String(customName || "").trim(),
            onClick: addSvgIcon,
          },
          t("panel.custom.addSvg"),
        ),
      ),
    );

    return h(
      "div",
      { className: "dwi-page", style: { height: "100%", minHeight: 0 } },
      h(
        "div",
        { className: "dwi-content" },
        header,
        statusNode,
        workspaceCard,
        sessionCard,
        libraryCard,
        customCard,
        h(
          "p",
          { className: "dwi-footer-note" },
          text(
            "配置保存在 ~/.dsh/dsh-workspace-icons/config.json；图标库与自定义图标对所有工作区生效。",
            "Configuration lives in ~/.dsh/dsh-workspace-icons/config.json; libraries and custom icons apply to every workspace.",
          ),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // slot 注册：收口到「设置」页（settings.section + 同名导航图标）
  // ------------------------------------------------------------------
  const disposers = [];

  const register = (slotName, factory) => {
    try {
      const stop = ctx.slots.inject(slotName, factory);
      if (typeof stop === "function") disposers.push(stop);
    } catch (error) {
      console.warn("[dsh-workspace-icons] " + slotName + " 注册失败", error);
    }
  };

  const sectionOptions = {
    name: "settings.section",
    id: "dsh-workspace-icons",
    order: 100,
    locale: shared.NS,
    label: () => shared.t("panel.title"),
    inject: () => ({ t: shared.t }),
  };

  register("settings.section", () => ctx.slots.register(sectionOptions, SettingsPanel));

  register(
    "settings.section.icon",
    () =>
      ctx.slots.register(
        {
          name: "settings.section.icon",
          id: "dsh-workspace-icons",
          order: 100,
          locale: shared.NS,
          label: () => shared.t("panel.title"),
        },
        SettingsNavIcon,
      ),
  );

  return function cleanup() {
    while (disposers.length) {
      const stop = disposers.pop();
      try {
        stop();
      } catch (error) {
        console.warn("[dsh-workspace-icons] slot 卸载失败", error);
      }
    }
  };
}
