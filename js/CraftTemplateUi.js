/**
 * HTML overlays for forming template save/load (settlement name-prompt cousin).
 */
const CraftTemplateUi = {
    _root: null,
    _stack: [],
    _onKey: null,
    _worldPointerLocked: false,
    _inputWasEnabled: true,
    _scene: null,
    _onChange: null,

    isOpen() {
        return this._stack.length > 0;
    },

    closeAll() {
        while (this._stack.length) this._pop(false);
        this._teardown();
    },

    handleEsc() {
        if (!this._stack.length) return;
        const top = this._stack[this._stack.length - 1];
        top?.onEsc?.();
    },

    promptName(scene, opts = {}) {
        this._scene = scene;
        this._onChange = opts.onChange || null;
        const s = scene?.uiScale || 1;
        const fontPx = typeof pixelUiFontSize === "function" ? pixelUiFontSize(16, s) : Math.round(16 * s);
        const stroke = Math.max(2, Math.round(2 * s));
        const pad = Math.round(16 * s);
        const padX = Math.round(18 * s);
        const maxLen = Number(opts.maxLength) > 0
            ? Math.floor(Number(opts.maxLength))
            : ((typeof CraftTemplates !== "undefined" && CraftTemplates.NAME_MAX) || 24);

        const wrap = this._makeDimmer(s);
        const box = this._makeBox(s, stroke, pad, padX);
        const label = document.createElement("div");
        label.textContent = String(opts.title || "Name this template");
        label.style.cssText = this._labelCss(fontPx, s);

        const input = document.createElement("input");
        input.maxLength = maxLen;
        input.placeholder = String(opts.placeholder || "").trim();
        input.value = "";
        if (opts.value != null && String(opts.value).trim()) {
            input.value = String(opts.value).trim().slice(0, maxLen);
        }
        input.style.cssText = [
            "width:100%",
            "box-sizing:border-box",
            "background:#0a0806",
            "color:#d4c4a8",
            "border:1px solid #2a2218",
            `padding:${Math.round(6 * s)}px ${Math.round(8 * s)}px`,
            "font-family:PrimaryFont,monospace",
            `font-size:${fontPx}px`
        ].join(";");

        const row = document.createElement("div");
        row.style.cssText = [
            "display:flex",
            "justify-content:space-between",
            "align-items:center",
            `margin-top:${Math.round(10 * s)}px`,
            "width:100%"
        ].join(";");

        const finish = (ok) => {
            const top = this._stack[this._stack.length - 1];
            if (top !== layer) return;
            const raw = (input.value || "").trim();
            if (ok) {
                if (!raw) {
                    input.focus();
                    return;
                }
                opts.onOk?.(raw);
                return;
            }
            this._popLayer(layer);
            opts.onCancel?.();
        };

        const cancelBtn = this._mkBtn("Cancel", s, fontPx, stroke, () => finish(false));
        const okBtn = this._mkBtn(String(opts.confirm || "Save"), s, fontPx, stroke, () => finish(true));
        row.appendChild(cancelBtn);
        if (opts.reset != null && opts.reset !== false) {
            const resetValue = String(opts.resetValue != null ? opts.resetValue : input.placeholder || "");
            const resetBtn = this._mkBtn(String(opts.reset === true ? "Reset" : opts.reset), s, fontPx, stroke, () => {
                input.value = resetValue;
                try { input.focus(); } catch (_) {}
            });
            row.appendChild(resetBtn);
        }
        row.appendChild(okBtn);

        for (const ev of ["keydown", "keyup", "keypress"]) {
            input.addEventListener(ev, (e) => {
                e.stopPropagation();
                if (ev !== "keydown") return;
                if (e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter") {
                    e.preventDefault();
                    finish(true);
                }
                if (e.key === "Escape" || e.code === "Escape" || e.key === "Esc") {
                    e.preventDefault();
                    finish(false);
                }
            });
        }

        box.appendChild(label);
        box.appendChild(input);
        box.appendChild(row);
        wrap.appendChild(box);
        wrap.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            if (e.target === wrap) finish(false);
            else if (e.target === box || e.target === label) input.focus();
        });

        const layer = {
            el: wrap,
            onEsc: () => finish(false),
            focus: () => { try { input.focus(); } catch (_) {} }
        };
        this._push(layer);
        setTimeout(() => input.focus(), 0);
        return {
            input,
            close: () => this._popLayer(layer)
        };
    },

    confirm(scene, opts = {}) {
        this._scene = scene;
        const s = scene?.uiScale || 1;
        const fontPx = typeof pixelUiFontSize === "function" ? pixelUiFontSize(16, s) : Math.round(16 * s);
        const stroke = Math.max(2, Math.round(2 * s));
        const pad = Math.round(16 * s);
        const padX = Math.round(18 * s);

        const wrap = this._makeDimmer(s);
        wrap.style.zIndex = "10001";
        const box = this._makeBox(s, stroke, pad, padX);
        const label = document.createElement("div");
        label.textContent = String(opts.title || "Are you sure?");
        label.style.cssText = this._labelCss(fontPx, s);

        const row = document.createElement("div");
        row.style.cssText = [
            "display:flex",
            "justify-content:space-between",
            "align-items:center",
            `margin-top:${Math.round(10 * s)}px`,
            "width:100%"
        ].join(";");

        const finish = (ok) => {
            this._popLayer(layer);
            if (ok) opts.onYes?.();
            else opts.onNo?.();
        };

        row.appendChild(this._mkBtn("Cancel", s, fontPx, stroke, () => finish(false)));
        row.appendChild(this._mkBtn(String(opts.confirm || "OK"), s, fontPx, stroke, () => finish(true)));
        box.appendChild(label);
        box.appendChild(row);
        wrap.appendChild(box);
        wrap.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            if (e.target === wrap) finish(false);
        });

        const layer = {
            el: wrap,
            onEsc: () => finish(false),
            onEnter: () => finish(true)
        };
        this._push(layer);
        return { close: () => this._popLayer(layer) };
    },

    showLoadList(scene, opts = {}) {
        this.closeAll();
        this._scene = scene;
        this._onChange = opts.onChange || null;
        const s = scene?.uiScale || 1;
        const fontPx = typeof pixelUiFontSize === "function" ? pixelUiFontSize(16, s) : Math.round(16 * s);
        const stroke = Math.max(2, Math.round(2 * s));
        const pad = Math.round(16 * s);
        const padX = Math.round(18 * s);

        const wrap = this._makeDimmer(s);
        const box = this._makeBox(s, stroke, pad, padX);
        box.style.minWidth = `${Math.round(280 * s)}px`;
        box.style.maxWidth = `${Math.round(420 * s)}px`;
        const title = document.createElement("div");
        title.textContent = String(opts.title || "Load template");
        title.style.cssText = this._labelCss(fontPx, s);

        const list = document.createElement("div");
        list.style.cssText = [
            `max-height:${Math.round(240 * s)}px`,
            "overflow-y:auto",
            `margin-top:${Math.round(8 * s)}px`
        ].join(";");

        const rows = Array.isArray(opts.rows) ? opts.rows : [];
        if (!rows.length) {
            const empty = document.createElement("div");
            empty.textContent = "No templates";
            empty.style.cssText = [
                "color:#8a7a66",
                "font-family:PrimaryFont,monospace",
                `font-size:${fontPx}px`,
                `padding:${Math.round(8 * s)}px 0`
            ].join(";");
            list.appendChild(empty);
        } else {
            for (const row of rows) {
                list.appendChild(this._loadRow(row, s, fontPx, stroke, opts));
            }
        }

        const closeRow = document.createElement("div");
        closeRow.style.cssText = [
            "display:flex",
            "justify-content:flex-end",
            `margin-top:${Math.round(10 * s)}px`
        ].join(";");
        closeRow.appendChild(this._mkBtn("Close", s, fontPx, stroke, () => {
            this._popLayer(layer);
            opts.onClose?.();
        }));

        box.appendChild(title);
        box.appendChild(list);
        box.appendChild(closeRow);
        wrap.appendChild(box);
        wrap.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            if (e.target === wrap) {
                this._popLayer(layer);
                opts.onClose?.();
            }
        });

        const layer = {
            el: wrap,
            onEsc: () => {
                this._popLayer(layer);
                opts.onClose?.();
            }
        };
        this._push(layer);
        return { close: () => this._popLayer(layer) };
    },

    _loadRow(row, s, fontPx, stroke, opts) {
        const wrap = document.createElement("div");
        wrap.style.cssText = [
            "display:flex",
            "align-items:center",
            "justify-content:space-between",
            `gap:${Math.round(8 * s)}px`,
            `padding:${Math.round(4 * s)}px 0`,
            "border-bottom:1px solid #2a2218"
        ].join(";");

        const name = document.createElement("button");
        name.type = "button";
        name.textContent = String(row.name || "");
        const canLoad = !!row.canLoad;
        name.style.cssText = [
            "flex:1",
            "text-align:left",
            "background:transparent",
            `color:${canLoad ? "#d4c4a8" : "#6a5a45"}`,
            "border:none",
            "padding:0",
            `cursor:${canLoad ? "pointer" : "default"}`,
            "font-family:PrimaryFont,monospace",
            `font-size:${fontPx}px`,
            "outline:none"
        ].join(";");
        if (canLoad) {
            name.addEventListener("mouseenter", () => { name.style.color = "#ffffff"; });
            name.addEventListener("mouseleave", () => { name.style.color = "#d4c4a8"; });
            name.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                opts.onLoad?.(row);
            });
        } else {
            name.title = String(row.needLabel || "Need more clay");
        }

        const meta = document.createElement("div");
        meta.textContent = String(row.costLabel || row.needLabel || "");
        meta.style.cssText = [
            "color:#8a7a66",
            "font-family:PrimaryFont,monospace",
            `font-size:${fontPx}px`,
            "white-space:nowrap"
        ].join(";");

        const del = this._mkBtn("X", s, fontPx, stroke, () => opts.onDelete?.(row));
        del.style.padding = `${Math.round(2 * s)}px ${Math.round(8 * s)}px`;

        wrap.appendChild(name);
        if (meta.textContent) wrap.appendChild(meta);
        wrap.appendChild(del);
        return wrap;
    },

    _makeDimmer() {
        const wrap = document.createElement("div");
        wrap.style.cssText = [
            "position:fixed", "inset:0", "z-index:10000",
            "display:flex", "align-items:center", "justify-content:center",
            "background:rgba(8,6,4,0.55)",
            "pointer-events:auto"
        ].join(";");
        return wrap;
    },

    _makeBox(s, stroke, pad, padX) {
        const box = document.createElement("div");
        box.style.cssText = [
            "background:#120e0a",
            `border:${stroke}px solid #2a2218`,
            `padding:${pad}px ${padX}px`,
            `min-width:${Math.round(220 * s)}px`
        ].join(";");
        return box;
    },

    _labelCss(fontPx, s) {
        return [
            "color:#d4c4a8",
            "font-family:PrimaryFont,monospace",
            `margin-bottom:${Math.round(8 * s)}px`,
            `font-size:${fontPx}px`
        ].join(";");
    },

    _mkBtn(text, s, fontPx, stroke, fn) {
        const BG = "#120e0a";
        const BG_PRESS = "#0a0806";
        const OUTLINE = "#2a2218";
        const OUTLINE_HOVER = "#ffffff";
        const OUTLINE_PRESS = "#d4a84b";
        const b = document.createElement("button");
        b.textContent = text;
        b.type = "button";
        b.tabIndex = -1;
        let hovering = false;
        let pressing = false;
        const paint = () => {
            b.style.background = pressing ? BG_PRESS : BG;
            b.style.borderColor = pressing ? OUTLINE_PRESS : (hovering ? OUTLINE_HOVER : OUTLINE);
        };
        b.style.cssText = [
            "background:" + BG,
            "color:#d4c4a8",
            `border:${stroke}px solid ${OUTLINE}`,
            `padding:${Math.round(4 * s)}px ${Math.round(10 * s)}px`,
            "cursor:pointer",
            "font-family:PrimaryFont,monospace",
            `font-size:${fontPx}px`,
            "outline:none",
            "appearance:none",
            "-webkit-appearance:none"
        ].join(";");
        b.addEventListener("mouseenter", () => { hovering = true; paint(); });
        b.addEventListener("mouseleave", () => { hovering = false; pressing = false; paint(); });
        b.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            pressing = true;
            paint();
        });
        b.addEventListener("mouseup", (e) => {
            e.stopPropagation();
            const was = pressing;
            pressing = false;
            paint();
            if (was && hovering) fn?.();
        });
        return b;
    },

    _ensureRoot() {
        if (this._root) return this._root;
        const root = document.createElement("div");
        root.id = "craft-template-ui";
        document.body.appendChild(root);
        this._root = root;
        this._onKey = (e) => {
            if (!this._stack.length) return;
            const isEsc = e.key === "Escape" || e.code === "Escape" || e.key === "Esc";
            const isEnter = e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter";
            const tag = e.target && e.target.tagName ? String(e.target.tagName).toUpperCase() : "";
            if (e.type === "keydown" && isEsc) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();
                if (e.repeat) return;
                this.handleEsc();
                return;
            }
            if (e.type === "keydown" && isEnter && tag !== "INPUT") {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();
                if (e.repeat) return;
                const top = this._stack[this._stack.length - 1];
                top?.onEnter?.();
                return;
            }
            if (tag !== "INPUT") {
                e.stopPropagation();
            }
        };
        window.addEventListener("keydown", this._onKey, true);
        window.addEventListener("keyup", this._onKey, true);
        return root;
    },

    _push(layer) {
        this._ensureRoot();
        this._root.appendChild(layer.el);
        this._stack.push(layer);
        this._lockWorldPointer();
        this._scene?.input?.keyboard?.resetKeys?.();
        try { this._scene?.game?.canvas?.blur?.(); } catch (_) {}
        this._onChange?.(true);
    },

    _popLayer(layer) {
        const i = this._stack.indexOf(layer);
        if (i < 0) return;
        this._stack.splice(i, 1);
        try { layer.el.remove(); } catch (_) {}
        if (!this._stack.length) this._teardown();
        else this._onChange?.(true);
    },

    _pop(notify) {
        const layer = this._stack.pop();
        if (!layer) return;
        try { layer.el.remove(); } catch (_) {}
        if (!this._stack.length) this._teardown();
        else if (notify !== false) this._onChange?.(true);
    },

    _teardown() {
        this._unlockWorldPointer();
        if (this._onKey) {
            window.removeEventListener("keydown", this._onKey, true);
            window.removeEventListener("keyup", this._onKey, true);
            this._onKey = null;
        }
        if (this._root) {
            try { this._root.remove(); } catch (_) {}
            this._root = null;
        }
        this._stack = [];
        const cb = this._onChange;
        this._onChange = null;
        cb?.(false);
        this._scene?.input?.keyboard?.resetKeys?.();
    },

    _lockWorldPointer() {
        const scene = this._scene;
        if (!scene || this._worldPointerLocked) return;
        this._worldPointerLocked = true;
        this._inputWasEnabled = scene.input ? scene.input.enabled !== false : true;
        if (scene.input) scene.input.enabled = false;
        scene._hoverTarget = null;
        scene.hideWorldTooltip?.();
        scene.input?.setDefaultCursor?.("default");
        try {
            if (scene.game?.canvas) scene.game.canvas.style.cursor = "default";
        } catch (_) {}
    },

    _unlockWorldPointer() {
        if (!this._worldPointerLocked) return;
        this._worldPointerLocked = false;
        if (this._scene?.input) this._scene.input.enabled = this._inputWasEnabled !== false;
        this._inputWasEnabled = true;
    }
};
