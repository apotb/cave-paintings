/**
 * Weapon, armor, and food policy editor. Opened from Assign.
 */
class PolicyPanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.settle = null;
        this.kind = "weapon";
        this.selectedId = null;
        this._scroll = 0;
        this._contentH = 0;
        this._maxScroll = 0;
        this._query = "";
        this._chromeHits = [];
        this._rowHits = [];
        this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(16200).setVisible(false);
        scene.uiLayer?.add(this.root);
        this._build();
    }

    _P() {
        return typeof Policies !== "undefined" ? Policies : null;
    }

    _build() {
        const scene = this.scene;
        this.dim = scene.add.rectangle(0, 0, 800, 600, 0x080604, 0.72).setOrigin(0, 0).setInteractive();
        this.frame = scene.add.rectangle(0, 0, 400, 300, 0x120e0a, 0.98)
            .setOrigin(0, 0).setStrokeStyle(2, 0x2a2218).setInteractive();
        this.title = scene.add.text(0, 0, "Policy", {
            fontFamily: PIXEL_UI_FONT, fontSize: "16px", color: "#d4c4a8"
        }).setOrigin(0, 0.5);
        this.closeBtn = this._chrome("Close", () => this.close());
        this.newBtn = this._chrome("New...", () => this._new());
        this.dupBtn = this._chrome("Duplicate", () => this._dup());
        this.renameBtn = this._chrome("Rename", () => this._rename());
        this.delBtn = this._chrome("Delete", () => this._delete());
        this.allBtn = this._chrome("Allow all", () => this._setAll(true));
        this.noneBtn = this._chrome("Clear all", () => this._setAll(false));
        this.listBody = scene.add.container(0, 0);
        this.editBody = scene.add.container(0, 0);
        this._maskGfx = scene.make.graphics({ x: 0, y: 0, add: false });
        this.editBody.setMask(this._maskGfx.createGeometryMask());
        this.root.add([
            this.dim, this.frame, this.title, this.listBody, this.editBody,
            this.newBtn, this.dupBtn, this.renameBtn, this.delBtn,
            this.allBtn, this.noneBtn, this.closeBtn
        ]);
        this._search = document.createElement("input");
        this._search.type = "text";
        this._search.placeholder = "Search";
        this._search.autocomplete = "off";
        this._search.spellcheck = false;
        this._search.setAttribute("aria-label", "Search");
        this._search.style.cssText = [
            "position:fixed", "z-index:10000", "display:none", "pointer-events:auto",
            "background:#0a0806", "color:#d4c4a8", "caret-color:#d4c4a8",
            "border:1px solid #2a2218", "outline:none",
            "font-family:PrimaryFont,monospace"
        ].join(";");
        const stopGameEvent = (e) => e.stopPropagation();
        for (const ev of ["mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend", "click", "wheel"]) {
            this._search.addEventListener(ev, stopGameEvent);
        }
        for (const ev of ["keydown", "keyup", "keypress"]) {
            this._search.addEventListener(ev, (e) => {
                e.stopPropagation();
                if (e.type === "keydown" && (e.key === "Escape" || e.code === "Escape")) {
                    e.preventDefault();
                    this._search.blur();
                }
            });
        }
        this._search.addEventListener("mousedown", () => {
            if (document.activeElement !== this._search) this._search.focus();
        });
        this._search.addEventListener("focus", () => {
            this._search.style.borderColor = "#d4a84b";
            this._setGameKeys(false);
            try { this.scene.game?.canvas?.blur?.(); } catch (_) {}
        });
        this._search.addEventListener("blur", () => {
            this._search.style.borderColor = "#2a2218";
            this._setGameKeys(true);
        });
        this._search.addEventListener("input", () => {
            this._query = String(this._search.value || "").trim().toLowerCase();
            this.refresh();
        });
        this._onSearchPointerDown = (e) => {
            if (!this.visible || document.activeElement !== this._search) return;
            if (e.target === this._search) return;
            this._search.blur();
        };
        document.addEventListener("pointerdown", this._onSearchPointerDown, true);
        document.body.appendChild(this._search);
        this._bindWheel();
    }

    _font(obj, px) {
        const s = this.scene.uiScale || 1;
        if (!obj) return;
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(obj, px, s);
        else obj.setFontSize(`${Math.round(px * s)}px`);
    }

    _chrome(label, onClick) {
        const scene = this.scene;
        const bg = scene.add.rectangle(0, 0, 72, 22, 0x120e0a, 1)
            .setStrokeStyle(2, 0x2a2218)
            .setInteractive({ useHandCursor: true, cursor: "pointer" });
        const txt = scene.add.text(0, 0, label, {
            fontFamily: PIXEL_UI_FONT, fontSize: "12px", color: "#d4c4a8"
        }).setOrigin(0.5);
        const c = scene.add.container(0, 0, [bg, txt]);
        c._bg = bg;
        c._txt = txt;
        c._onClick = onClick;
        c._hovering = false;
        c._pressing = false;
        c._disabled = false;
        const paint = () => {
            const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(scene.uiScale || 1) : 2;
            if (c._disabled) {
                bg.setFillStyle(0x120e0a, 1);
                bg.setStrokeStyle(sw, 0x2a2218);
                txt.setColor("#6a5a4a");
            } else if (c._pressing) {
                bg.setFillStyle(0x0a0806, 1);
                bg.setStrokeStyle(sw, 0xd4a84b);
                txt.setColor("#d4c4a8");
            } else if (c._hovering) {
                bg.setFillStyle(0x120e0a, 1);
                bg.setStrokeStyle(sw, 0xffffff);
                txt.setColor("#d4c4a8");
            } else {
                bg.setFillStyle(0x120e0a, 1);
                bg.setStrokeStyle(sw, 0x2a2218);
                txt.setColor("#d4c4a8");
            }
        };
        c._paint = paint;
        c._setEnabled = (on) => {
            c._disabled = !on;
            if (!on) {
                c._hovering = false;
                c._pressing = false;
            }
            if (bg.input) {
                bg.input.cursor = on ? "pointer" : "default";
                bg.input.useHandCursor = !!on;
            }
            paint();
        };
        bg._setHover = (on) => {
            if (c._disabled) on = false;
            if (c._hovering === on) return;
            c._hovering = on;
            if (!on) c._pressing = false;
            paint();
        };
        bg.on("pointerdown", (p, _x, _y, ev) => {
            ev?.stopPropagation?.();
            if (c._disabled || p?.rightButtonDown?.() || p?.button === 2) return;
            c._pressing = true;
            paint();
        });
        bg.on("pointerup", (p) => {
            if (c._disabled) return;
            c._pressing = false;
            paint();
            if (p?.button && p.button !== 0) return;
            this._runClick(p, onClick);
        });
        paint();
        return c;
    }

    _items() {
        const fromScene = this.scene?.items?.();
        if (Array.isArray(fromScene) && fromScene.length) return fromScene;
        const store = typeof DataStore !== "undefined" ? DataStore : null;
        const list = store?.itemsList || store?._store?.itemsList || [];
        return Array.isArray(list) ? list : [];
    }

    _getItem(id) {
        if (typeof DataStore !== "undefined" && DataStore.itemsById) return DataStore.itemsById[id] || null;
        return null;
    }

    open(settle, kind, selectedId) {
        if (!settle) return;
        this.settle = settle;
        this.kind = kind || "weapon";
        this.selectedId = selectedId || "anything";
        this.visible = true;
        this._scroll = 0;
        this._query = "";
        this._layoutBox = null;
        if (this._search) this._search.value = "";
        this.root.setVisible(true);
        const assign = this.scene.assignPanel;
        if (assign?.root) assign.root.setVisible(false);
        this.scene.hideTooltip?.();
        this.layout();
    }

    close(opts = {}) {
        const restore = opts.restore !== false;
        this.visible = false;
        this._drag = null;
        this.root.setVisible(false);
        if (this._search) {
            this._search.blur();
            this._search.style.display = "none";
        }
        this.scene.hideTooltip?.();
        const assign = this.scene.assignPanel;
        if (restore && assign?.visible) {
            assign.root.setVisible(true);
            assign.layout();
            assign.refresh();
        }
    }

    handleEsc() {
        if (!this.visible) return false;
        this.close();
        return true;
    }

    containsPointer(pointer) {
        if (!this.visible || !pointer || !this.frame) return false;
        const b = this.frame.getBounds();
        return pointer.x >= b.x && pointer.x <= b.right && pointer.y >= b.y && pointer.y <= b.bottom;
    }

    hoverObjAt(pointer) {
        if (!pointer || !this.visible) return null;
        const hit = this._hitAt(pointer);
        if (hit?.obj) return hit.obj;
        const visit = (obj) => {
            if (!obj?.active || obj === this.dim || obj === this.frame) return null;
            const kids = obj.list;
            if (Array.isArray(kids)) {
                for (let i = kids.length - 1; i >= 0; i--) {
                    const hit = visit(kids[i]);
                    if (hit) return hit;
                }
            }
            if (!obj.input?.enabled) return null;
            const b = obj.getBounds?.();
            if (!b || !Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y)) return null;
            return obj;
        };
        return visit(this.root);
    }

    layout() {
        const scene = this.scene;
        const s = scene.uiScale || 1;
        const W = scene.scale.width;
        const H = scene.scale.height;
        const pad = Math.round(12 * s);
        const gap = Math.round(8 * s);
        const titleH = Math.round(36 * s);
        const btnH = Math.round(22 * s);
        const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(s) : 2;
        const fontPx = typeof pixelUiFontSize === "function" ? pixelUiFontSize(12, s) : Math.round(12 * s);
        this._rowH = Math.max(btnH, fontPx + Math.round(8 * s));
        this._editRowH = Math.max(Math.round(20 * s), fontPx + Math.round(6 * s));
        this._indent = Math.round(16 * s);
        this._markW = Math.round(18 * s);
        this.dim.setSize(W, H);
        if (this.dim.input?.hitArea?.setSize) this.dim.input.hitArea.setSize(W, H);
        const w = Math.min(W - pad * 2, Math.round(860 * s));
        const h = Math.min(H - pad * 2, Math.round(560 * s));
        const x = Math.round((W - w) / 2);
        const y = Math.round((H - h) / 2);
        this.frame.setPosition(x, y).setSize(w, h).setStrokeStyle(sw, 0x2a2218);
        if (this.frame.input?.hitArea?.setSize) this.frame.input.hitArea.setSize(w, h);
        this._font(this.title, 16);
        this.title.setText(this.kind === "food" ? "Food policy" : this.kind === "armor" ? "Armor policy" : "Weapon policy");
        this.title.setPosition(x + pad, y + titleH / 2);
        const buttons = [this.newBtn, this.dupBtn, this.renameBtn, this.delBtn, this.allBtn, this.noneBtn, this.closeBtn];
        let bx = x + w - pad;
        for (let i = buttons.length - 1; i >= 0; i--) {
            const b = buttons[i];
            this._font(b._txt, 12);
            const bw = Math.max(Math.round(64 * s), Math.ceil((b._txt.width || 48) + pad));
            b._bg.setSize(bw, btnH);
            const area = b._bg.input?.hitArea;
            if (area?.setTo) area.setTo(0, 0, bw, btnH);
            bx -= bw;
            b.setPosition(bx + bw / 2, y + titleH / 2);
            bx -= gap;
            b._paint?.();
        }
        this._listX = x + pad;
        this._listY = y + titleH + gap;
        this._listW = Math.round(180 * s);
        this._editX = this._listX + this._listW + gap;
        this._editY = this._listY + btnH + gap;
        this._editW = Math.max(40, x + w - pad - this._editX);
        this._editH = Math.max(40, y + h - pad - this._editY);
        if (this._search) {
            if (!this.visible) {
                this._search.style.display = "none";
            } else {
                const canvas = scene.game.canvas.getBoundingClientRect();
                const sx = canvas.width / Math.max(1, W);
                const sy = canvas.height / Math.max(1, H);
                this._search.style.display = "block";
                this._search.style.left = `${canvas.left + this._editX * sx}px`;
                this._search.style.top = `${canvas.top + this._listY * sy}px`;
                this._search.style.width = `${Math.max(40, this._editW * sx)}px`;
                this._search.style.height = `${Math.round(btnH * sy)}px`;
                this._search.style.fontSize = `${Math.max(8, Math.round(fontPx * sy))}px`;
                this._search.style.boxSizing = "border-box";
                this._search.style.padding = `0 ${Math.round(6 * s * sx)}px`;
                this._searchH = btnH;
            }
        }
        this._maskGfx.clear();
        this._maskGfx.fillStyle(0xffffff);
        this._maskGfx.fillRect(this._editX, this._editY, this._editW, this._editH);
        this._syncChrome();
        this._trackChrome();
        this._paintHover(scene.input?.activePointer);
        const box = [x, y, w, h, s].join(":");
        if (this.visible && this._layoutBox !== box) {
            this._layoutBox = box;
            this.refresh();
        } else {
            this._layoutBox = box;
        }
    }

    _setGameKeys(on) {
        const kb = this.scene?.input?.keyboard;
        if (!kb) return;
        if (on) {
            if (!this._keysOff) return;
            this._keysOff = false;
            kb.enabled = true;
            kb.resetKeys?.();
            return;
        }
        if (this._keysOff) return;
        this._keysOff = true;
        kb.resetKeys?.();
        kb.enabled = false;
    }

    _pointerInSearch(pointer) {
        if (!pointer || !this.visible) return false;
        const h = this._searchH || this._rowH || 0;
        if (!h || !this._editW) return false;
        return pointer.x >= this._editX && pointer.x <= this._editX + this._editW
            && pointer.y >= this._listY && pointer.y <= this._listY + h;
    }

    _pointerInEdit(pointer) {
        if (!pointer || !this.visible) return false;
        return pointer.x >= this._editX && pointer.x <= this._editX + this._editW
            && pointer.y >= this._editY && pointer.y <= this._editY + this._editH;
    }

    _syncChrome() {
        const cur = this.visible ? this._selected() : null;
        const locked = !cur || !!cur.builtin;
        this.renameBtn?._setEnabled?.(!locked);
        this.delBtn?._setEnabled?.(!locked);
    }

    _trackChrome() {
        this._chromeHits = [];
        const buttons = [this.newBtn, this.dupBtn, this.renameBtn, this.delBtn, this.allBtn, this.noneBtn, this.closeBtn];
        for (const b of buttons) {
            if (!b?._bg || b._disabled) continue;
            const w = b._bg.width || 0;
            const h = b._bg.height || 0;
            this._chromeHits.push({
                x: b.x - w / 2,
                y: b.y - h / 2,
                w,
                h,
                obj: b._bg,
                fn: b._onClick
            });
        }
    }

    _hitContains(hit, pointer) {
        if (!hit || !pointer) return false;
        let x = hit.x;
        let y = hit.y;
        if (hit.edit) {
            if (!this._pointerInEdit(pointer)) return false;
            x = this._editX + hit.x;
            y = this._editY - this._scroll + hit.y;
        }
        return pointer.x >= x && pointer.x <= x + hit.w
            && pointer.y >= y && pointer.y <= y + hit.h;
    }

    _hitAt(pointer) {
        if (!this.visible || !pointer) return null;
        const lists = [this._chromeHits, this._rowHits];
        for (const list of lists) {
            if (!list) continue;
            for (let i = list.length - 1; i >= 0; i--) {
                const hit = list[i];
                if (this._hitContains(hit, pointer)) return hit;
            }
        }
        return null;
    }

    _paintHover(pointer) {
        const obj = this.visible && pointer ? (this._hitAt(pointer)?.obj || null) : null;
        if (obj === this._hot) return;
        this._hot?._setHover?.(false);
        obj?._setHover?.(true);
        this._hot = obj;
    }

    _runClick(_pointer, fn) {
        if (!fn || this._ranClick || this._dragMoved || this._drag?.moved) return;
        this._ranClick = true;
        try {
            fn();
        } finally {
            queueMicrotask(() => { this._ranClick = false; });
        }
    }

    _policies() {
        const P = this._P();
        if (!P || !this.settle) return [];
        this.settle.policies = P.normalizePolicies(this.settle.policies);
        return this.settle.policies[this.kind] || [];
    }

    _selected() {
        const P = this._P();
        return P?.policyById(this._policies(), this.selectedId) || this._policies()[0] || null;
    }

    _commit(policies) {
        const P = this._P();
        if (!P || !this.settle) return;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (S?.setPolicies) S.setPolicies(this.settle, this.kind, policies[this.kind]);
        else this.settle.policies = policies;
        this.scene.settlementSys?.bumpWorkCache?.();
        this.scene.settlementSys?.sendNet?.("setPolicies", {
            settlementId: this.settle.id,
            kind: this.kind,
            policies: policies[this.kind]
        });
        this.refresh();
        this.scene.assignPanel?.refresh?.();
    }

    _new() {
        const P = this._P();
        if (!P) return;
        const made = P.createPolicy(this.kind, this.settle.policies);
        this.selectedId = made.id;
        this._commit(made.policies);
    }

    _dup() {
        const P = this._P();
        const cur = this._selected();
        if (!P || !cur) return;
        const made = P.duplicatePolicy(this.kind, this.settle.policies, cur.id);
        this.selectedId = made.id;
        this._commit(made.policies);
    }

    _rename() {
        const cur = this._selected();
        if (!cur || cur.builtin) return;
        this.scene.settlementSys?._showNamePrompt?.((name) => {
            const P = this._P();
            if (!P) return;
            this._commit(P.renamePolicy(this.kind, this.settle.policies, cur.id, name));
        }, {
            title: "Rename policy",
            value: cur.name,
            placeholder: cur.name,
            maxLength: 24,
            confirm: "Rename",
            validate: (name) => {
                const P = this._P();
                const list = P?.normalizePolicies?.(this.settle?.policies)?.[this.kind] || [];
                if (P?.policyNameTaken?.(list, name, cur.id)) return "Name already used";
                return "";
            }
        });
    }

    _delete() {
        const P = this._P();
        const cur = this._selected();
        if (!P || !cur || cur.builtin) return;
        const made = P.deletePolicy(this.kind, this.settle.policies, cur.id);
        if (!made.removed) return;
        this.selectedId = "anything";
        if (this.settle.assigns) {
            const key = this.kind === "weapon" ? "weaponPolicyId"
                : this.kind === "armor" ? "armorPolicyId" : "foodPolicyId";
            for (const id of Object.keys(this.settle.assigns)) {
                if (this.settle.assigns[id]?.[key] === cur.id) {
                    const next = P.resolveAssign({ ...this.settle.assigns[id], [key]: "anything" }, made.policies);
                    this.settle.assigns[id] = next;
                    this.scene.settlementSys?.sendNet?.("setAssign", {
                        settlementId: this.settle.id,
                        pawnId: id,
                        assign: next
                    });
                }
            }
        }
        this._commit(made.policies);
    }

    _withEditable(mutate) {
        const P = this._P();
        const cur = this._selected();
        if (!P || !cur || !this.settle) return;
        let libs = P.normalizePolicies(this.settle.policies);
        let policy = cur;
        if (cur.builtin) {
            const made = P.duplicatePolicy(this.kind, libs, cur.id);
            libs = P.normalizePolicies(made.policies);
            policy = P.policyById(libs[this.kind], made.id);
            if (!policy) return;
            this.selectedId = policy.id;
        }
        const next = mutate(policy);
        if (!next) return;
        const idx = libs[this.kind].findIndex((p) => p.id === policy.id);
        if (idx < 0) return;
        libs[this.kind][idx] = next;
        this._commit(libs);
    }

    _setAll(allowed) {
        const P = this._P();
        if (!P || this.kind === "food") return;
        const cat = P.catalog(this._items());
        const ids = [];
        if (this.kind === "weapon") for (const it of cat.weapons) ids.push(it.id);
        else for (const g of cat.armor) for (const it of g.items) ids.push(it.id);
        this._withEditable((cur) => P.setItems(cur, ids, allowed));
    }

    refresh() {
        this._hot?._setHover?.(false);
        this._hot = null;
        this.listBody.removeAll(true);
        this.editBody.removeAll(true);
        this._rowHits = [];
        const P = this._P();
        if (!P) return;
        const rows = this._policies();
        const s = this.scene.uiScale || 1;
        const rowH = this._rowH || Math.round(24 * s);
        const gap = Math.round(2 * s);
        const inset = Math.round(6 * s);
        this._listInset = inset;
        this._rowStep = rowH + gap;
        this._listRows = [];
        let y = 0;
        rows.forEach((p, index) => {
            const selected = p.id === this.selectedId;
            const bg = this.scene.add.rectangle(0, y, this._listW, rowH, selected ? 0x3a3228 : 0x1a1612, 1)
                .setOrigin(0, 0)
                .setInteractive({ useHandCursor: true, cursor: "pointer" });
            const area = bg.input?.hitArea;
            if (area?.setTo) area.setTo(0, 0, this._listW, rowH);
            const txt = this.scene.add.text(inset, y + rowH / 2, p.name, {
                fontFamily: PIXEL_UI_FONT, color: "#d4c4a8"
            }).setOrigin(0, 0.5);
            this._font(txt, 12);
            const row = { id: p.id, index, bg, txt, h: rowH, hovering: false, selected, dragging: false };
            const paint = () => {
                const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(this.scene.uiScale || 1) : 2;
                if (row.dragging) {
                    bg.setFillStyle(0x2a241c, 1);
                    bg.setStrokeStyle(sw, 0xffffff);
                } else if (row.selected) {
                    bg.setFillStyle(0x3a3228, 1);
                    bg.setStrokeStyle(sw, row.hovering ? 0xffffff : 0xd4a84b);
                } else if (row.hovering) {
                    bg.setFillStyle(0x1a1612, 1);
                    bg.setStrokeStyle(sw, 0xffffff);
                } else {
                    bg.setFillStyle(0x1a1612, 1);
                    bg.setStrokeStyle(sw, 0x2a2218);
                }
            };
            row.paint = paint;
            bg._setHover = (on) => {
                if (this._drag?.moved) return;
                if (row.hovering === on) return;
                row.hovering = on;
                paint();
            };
            const pick = () => {
                if (this.selectedId === p.id) return;
                this.selectedId = p.id;
                this.refresh();
            };
            bg.on("pointerup", (pointer) => {
                if (pointer?.button && pointer.button !== 0) return;
                if (this._drag?.moved || this._dragMoved) return;
                this._runClick(pointer, pick);
            });
            this._rowHits.push({
                x: this._listX,
                y: this._listY + y,
                w: this._listW,
                h: rowH,
                obj: bg,
                fn: pick,
                list: true,
                id: p.id,
                index
            });
            paint();
            this.listBody.add([bg, txt]);
            this._listRows.push(row);
            y += this._rowStep;
        });
        this.listBody.setPosition(this._listX, this._listY);
        this._fillEditor();
        this._syncChrome();
        this._trackChrome();
        this._paintHover(this.scene.input?.activePointer);
        if (this.listBody.parentContainer) this.listBody.parentContainer.bringToTop(this.listBody);
        for (const btn of [this.newBtn, this.dupBtn, this.renameBtn, this.delBtn, this.allBtn, this.noneBtn, this.closeBtn]) {
            if (btn?.parentContainer) btn.parentContainer.bringToTop(btn);
        }
    }

    _rowColors(state) {
        if (state === "on") return { fill: 0x1e3d1a, stroke: 0x5cbf63, text: "#d4e8d0" };
        if (state === "mixed") return { fill: 0x3a3010, stroke: 0xe0c14b, text: "#ead9a0" };
        return { fill: 0x3a1816, stroke: 0xc44c3c, text: "#e8c0b8" };
    }

    _pixelGlyph(g, u, color, cells) {
        g.fillStyle(0x000000, 1);
        for (let i = 0; i < cells.length; i++) {
            const x = cells[i][0] - 3;
            const y = cells[i][1] - 3;
            g.fillRect(x * u - u, y * u - u, 3 * u, 3 * u);
        }
        g.fillStyle(color, 1);
        for (let i = 0; i < cells.length; i++) {
            const x = cells[i][0] - 3;
            const y = cells[i][1] - 3;
            g.fillRect(x * u, y * u, u, u);
        }
    }

    _addStatus(state, cx, cy, sc) {
        const g = this.scene.add.graphics();
        const u = Math.max(1, Math.round(sc));
        g.setPosition(Math.round(cx), Math.round(cy));
        if (state === "on") {
            this._pixelGlyph(g, u, 0x5cbf63, [
                [0, 3], [1, 4], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1]
            ]);
        } else if (state === "mixed") {
            const dash = [];
            for (let x = 0; x <= 6; x++) dash.push([x, 2], [x, 3]);
            this._pixelGlyph(g, u, 0xe0c14b, dash);
        } else {
            const cross = [];
            for (let i = 0; i <= 6; i++) cross.push([i, i], [i, 6 - i]);
            this._pixelGlyph(g, u, 0xc44c3c, cross);
        }
        this.editBody.add(g);
    }

    _iconKey(id) {
        const scene = this.scene;
        // No blade yet. The tip is diorite, the same default as a blade knap.
        if (id === "arrow" && typeof ensureArrowTexture === "function") {
            const stone = (typeof Stone !== "undefined" && Stone.iconStone)
                ? Stone.iconStone("arrow")
                : "diorite";
            const key = ensureArrowTexture(scene, stone);
            if (key && scene.textures.exists(key)) return key;
        }
        const def = scene.getItem?.(id) || null;
        if (typeof Place !== "undefined" && Place.itemIconKey) {
            const key = Place.itemIconKey(
                def || { id },
                (itemId) => scene.getThing?.(itemId),
                (k) => scene.textures.exists(k)
            );
            if (key && scene.textures.exists(key)) return key;
        }
        if (def?.key && scene.textures.exists(def.key)) return def.key;
        if (scene.textures.exists(id)) return id;
        return null;
    }

    _fillEditor() {
        const P = this._P();
        const policy = this._selected();
        if (!P || !policy) return;
        const scene = this.scene;
        const q = this._query;
        const s = scene.uiScale || 1;
        const rowH = Math.round(26 * s);
        const gap = Math.round(3 * s);
        const step = Math.round(16 * s);
        const iconS = Math.round(14 * s);
        const innerW = this._editW;
        let y = 0;
        const matches = (label) => !q || String(label).toLowerCase().includes(q);
        const addListRow = (x, w, state, label, iconKey, onClick) => {
            const colors = this._rowColors(state);
            const bg = scene.add.rectangle(x, y, w, rowH, colors.fill, 1)
                .setOrigin(0, 0)
                .setStrokeStyle(Math.max(1, Math.round(s)), colors.stroke);
            if (onClick) {
                bg.setInteractive({ useHandCursor: true, cursor: "pointer" });
                const area = bg.input?.hitArea;
                if (area?.setTo) area.setTo(0, 0, w, rowH);
                bg.on("pointerup", (p) => {
                    if (p?.button && p.button !== 0) return;
                    if (!this._pointerInEdit(p)) return;
                    this._runClick(p, onClick);
                });
                this._rowHits.push({
                    edit: true,
                    x,
                    y,
                    w,
                    h: rowH,
                    obj: bg,
                    fn: onClick
                });
            }
            this.editBody.add(bg);
            const mid = y + rowH / 2;
            let textX = x + Math.round(6 * s);
            if (iconKey) {
                this.editBody.add(scene.add.image(x + Math.round(10 * s), mid, iconKey).setDisplaySize(iconS, iconS));
                textX = x + Math.round(20 * s);
            }
            const txt = scene.add.text(textX, mid, label, {
                fontFamily: PIXEL_UI_FONT, color: colors.text
            }).setOrigin(0, 0.5);
            this._font(txt, 12);
            this.editBody.add(txt);
            this._addStatus(state, x + w - Math.round(12 * s), mid, s);
            y += rowH + gap;
        };
        if (this.kind === "food") {
            for (const g of P.catalog(this._items()).food) {
                if (!matches(g.name)) continue;
                const on = !!policy.groups?.[g.id];
                addListRow(0, innerW, on ? "on" : "off", g.name, null, () => {
                    this._withEditable((cur) => P.toggleFood(cur, g.id));
                });
            }
        } else {
            const cat = P.catalog(this._items());
            const groups = this.kind === "weapon"
                ? (cat.weaponGroups || [{ id: "melee", name: "Melee", items: cat.weapons }])
                : cat.armor;
            for (const group of groups) {
                const items = (group.items || []).filter((it) => matches(it.name) || matches(group.name));
                if (q && !items.length) continue;
                const flags = (group.items || []).map((it) => P.gearAllowed(policy, it.id, group.id));
                const onCount = flags.filter(Boolean).length;
                const state = !flags.length || onCount === flags.length ? "on" : (onCount ? "mixed" : "off");
                addListRow(0, innerW, state, group.name, null, () => {
                    const turnOn = state !== "on";
                    this._withEditable((cur) => {
                        let next = cur;
                        for (const it of group.items || []) {
                            const allowed = P.gearAllowed(next, it.id, group.id);
                            if (allowed !== turnOn) next = P.toggleItem(next, it.id, group.id);
                        }
                        return next;
                    });
                });
                for (const it of items) {
                    const on = P.gearAllowed(policy, it.id, group.id);
                    addListRow(step, Math.max(iconS + Math.round(24 * s), innerW - step), on ? "on" : "off", it.name, this._iconKey(it.id), () => {
                        this._withEditable((cur) => P.toggleItem(cur, it.id, group.id));
                    });
                }
            }
        }
        this._contentH = y;
        this._maxScroll = Math.max(0, y - this._editH);
        this._scroll = Math.max(0, Math.min(this._scroll, this._maxScroll));
        this.editBody.setPosition(this._editX, this._editY - this._scroll);
    }

    _listHitAt(pointer) {
        const list = this._rowHits;
        if (!list) return null;
        for (let i = list.length - 1; i >= 0; i--) {
            const hit = list[i];
            if (!hit?.list || !this._hitContains(hit, pointer)) continue;
            return hit;
        }
        return null;
    }

    _placeListRow(row, y) {
        if (!row) return;
        row.bg.setPosition(0, y);
        row.txt.setPosition(this._listInset || 0, y + row.h / 2);
    }

    _dragIndex(pointer) {
        const step = this._rowStep || 1;
        const n = this._listRows?.length || 0;
        if (!n) return 0;
        const local = (pointer?.y || 0) - (this._listY || 0);
        return Math.max(0, Math.min(n - 1, Math.floor(local / step)));
    }

    _dragMove(pointer) {
        const drag = this._drag;
        if (!drag || !pointer) return false;
        const dx = pointer.x - drag.x;
        const dy = pointer.y - drag.y;
        if (!drag.moved && dx * dx + dy * dy < 36) return false;
        drag.moved = true;
        const rows = this._listRows || [];
        const from = drag.from;
        const to = this._dragIndex(pointer);
        const ids = rows.map((row) => row.id);
        const order = ids.slice();
        const [id] = order.splice(from, 1);
        order.splice(to, 0, id);
        const step = this._rowStep || 0;
        for (let i = 0; i < order.length; i++) {
            const row = rows.find((entry) => entry.id === order[i]);
            if (!row || row.id === drag.id) continue;
            row.dragging = false;
            this._placeListRow(row, i * step);
            row.paint?.();
        }
        const held = rows.find((entry) => entry.id === drag.id);
        if (held) {
            const y = Math.max(0, Math.min((rows.length - 1) * step, pointer.y - this._listY - held.h / 2));
            held.dragging = true;
            this._placeListRow(held, y);
            held.paint?.();
            this.listBody.bringToTop(held.bg);
            this.listBody.bringToTop(held.txt);
        }
        return true;
    }

    _endDrag(pointer) {
        const drag = this._drag;
        if (!drag) return false;
        this._drag = null;
        if (!drag.moved) return false;
        this._dragMoved = true;
        queueMicrotask(() => { this._dragMoved = false; });
        const to = this._dragIndex(pointer);
        const P = this._P();
        if (P && to !== drag.from) {
            this._commit(P.movePolicy(this.kind, this.settle.policies, drag.id, to));
        } else {
            this.refresh();
        }
        return true;
    }

    _bindWheel() {
        this.scene.input.on("pointerdown", (pointer) => {
            if (!this.visible || !pointer || (pointer.button && pointer.button !== 0)) return;
            if (this._pointerInSearch(pointer)) {
                if (document.activeElement !== this._search) this._search?.focus();
                return;
            }
            if (document.activeElement === this._search) this._search.blur();
            const hit = this._listHitAt(pointer);
            if (!hit) return;
            this._drag = {
                id: hit.id,
                from: hit.index,
                x: pointer.x,
                y: pointer.y,
                moved: false
            };
        });
        this.scene.input.on("pointermove", (pointer) => {
            if (!this.visible) return;
            if (this._drag && this._dragMove(pointer)) return;
            this._paintHover(pointer);
        });
        this.scene.input.on("pointerup", (pointer) => {
            if (!this.visible || !pointer || (pointer.button && pointer.button !== 0)) return;
            if (this._endDrag(pointer)) return;
            const hit = this._hitAt(pointer);
            if (!hit?.fn) return;
            this._runClick(pointer, hit.fn);
        });
        this.scene.input.on("wheel", (pointer, _o, _dx, dy) => {
            if (!this.visible || !this.containsPointer(pointer)) return;
            this._scroll = Math.max(0, Math.min(this._maxScroll, this._scroll + Math.sign(dy) * Math.round(24 * (this.scene.uiScale || 1))));
            this.editBody.setPosition(this._editX, this._editY - this._scroll);
            this._paintHover(pointer);
        });
    }
}
