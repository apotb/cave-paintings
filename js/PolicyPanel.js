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
        this._search.placeholder = "Search";
        this._search.style.cssText = [
            "position:fixed", "z-index:9999", "display:none",
            "background:#0a0806", "color:#d4c4a8", "border:1px solid #2a2218",
            "font-family:PrimaryFont,monospace"
        ].join(";");
        this._search.addEventListener("input", () => {
            this._query = String(this._search.value || "").trim().toLowerCase();
            this.refresh();
        });
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
        c._hovering = false;
        c._pressing = false;
        const paint = () => {
            const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(scene.uiScale || 1) : 2;
            if (c._pressing) {
                bg.setFillStyle(0x0a0806, 1);
                bg.setStrokeStyle(sw, 0xd4a84b);
            } else if (c._hovering) {
                bg.setFillStyle(0x120e0a, 1);
                bg.setStrokeStyle(sw, 0xffffff);
            } else {
                bg.setFillStyle(0x120e0a, 1);
                bg.setStrokeStyle(sw, 0x2a2218);
            }
        };
        c._paint = paint;
        bg.on("pointerover", () => {
            c._hovering = true;
            paint();
        });
        bg.on("pointerout", () => {
            c._hovering = false;
            c._pressing = false;
            paint();
        });
        bg.on("pointerdown", (p, _x, _y, ev) => {
            ev?.stopPropagation?.();
            if (p?.rightButtonDown?.() || p?.button === 2) return;
            c._pressing = true;
            paint();
        });
        bg.on("pointerup", (p, _x, _y, ev) => {
            ev?.stopPropagation?.();
            const was = c._pressing && c._hovering;
            c._pressing = false;
            paint();
            if (!was || (p?.button && p.button !== 0)) return;
            onClick();
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
        this.layout();
    }

    close(opts = {}) {
        const restore = opts.restore !== false;
        this.visible = false;
        this.root.setVisible(false);
        if (this._search) this._search.style.display = "none";
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
            }
        }
        this._maskGfx.clear();
        this._maskGfx.fillStyle(0xffffff);
        this._maskGfx.fillRect(this._editX, this._editY, this._editW, this._editH);
        const box = [x, y, w, h, s].join(":");
        if (this.visible && this._layoutBox !== box) {
            this._layoutBox = box;
            this.refresh();
        } else {
            this._layoutBox = box;
        }
    }

    _pointerInEdit(pointer) {
        if (!pointer || !this.visible) return false;
        return pointer.x >= this._editX && pointer.x <= this._editX + this._editW
            && pointer.y >= this._editY && pointer.y <= this._editY + this._editH;
    }

    _clipEditHit(area, x, y) {
        if (!Phaser.Geom.Rectangle.Contains(area, x, y)) return false;
        return this._pointerInEdit(this.scene.input.activePointer);
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
        }, { title: "Rename policy", value: cur.name, placeholder: cur.name });
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

    _setAll(allowed) {
        const P = this._P();
        const cur = this._selected();
        if (!P || !cur || cur.builtin || this.kind === "food") return;
        const cat = P.catalog(this._items());
        const ids = [];
        if (this.kind === "weapon") for (const it of cat.weapons) ids.push(it.id);
        else for (const g of cat.armor) for (const it of g.items) ids.push(it.id);
        const libs = P.normalizePolicies(this.settle.policies);
        const idx = libs[this.kind].findIndex((p) => p.id === cur.id);
        if (idx < 0) return;
        libs[this.kind][idx] = P.setItems(cur, ids, allowed);
        this._commit(libs);
    }

    refresh() {
        this.listBody.removeAll(true);
        this.editBody.removeAll(true);
        const P = this._P();
        if (!P) return;
        const rows = this._policies();
        const s = this.scene.uiScale || 1;
        const rowH = this._rowH || Math.round(24 * s);
        const inset = Math.round(6 * s);
        let y = 0;
        for (const p of rows) {
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
            const row = { hovering: false, selected };
            const paint = () => {
                const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(this.scene.uiScale || 1) : 2;
                if (row.selected) {
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
            bg.on("pointerover", () => { row.hovering = true; paint(); });
            bg.on("pointerout", () => { row.hovering = false; paint(); });
            bg.on("pointerup", (pointer, _a, _b, ev) => {
                ev?.stopPropagation?.();
                if (pointer?.button && pointer.button !== 0) return;
                if (this.selectedId === p.id) return;
                this.selectedId = p.id;
                this.refresh();
            });
            paint();
            this.listBody.add([bg, txt]);
            y += rowH + Math.round(2 * s);
        }
        this.listBody.setPosition(this._listX, this._listY);
        this._fillEditor();
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
        const locked = !!policy.builtin;
        let y = 0;
        const matches = (label) => !q || String(label).toLowerCase().includes(q);
        const addListRow = (x, w, state, label, iconKey, onClick) => {
            const colors = this._rowColors(state);
            const bg = scene.add.rectangle(x, y, w, rowH, colors.fill, 1)
                .setOrigin(0, 0)
                .setStrokeStyle(Math.max(1, Math.round(s)), colors.stroke);
            if (!locked) {
                bg.setInteractive({
                    hitArea: new Phaser.Geom.Rectangle(0, 0, w, rowH),
                    hitAreaCallback: (area, lx, ly) => this._clipEditHit(area, lx, ly),
                    useHandCursor: true,
                    cursor: "pointer"
                });
                bg.on("pointerup", (p, _a, _b, ev) => {
                    ev?.stopPropagation?.();
                    if (p?.button && p.button !== 0) return;
                    if (!this._pointerInEdit(p)) return;
                    onClick?.();
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
        const commit = (next) => {
            const libs = P.normalizePolicies(this.settle.policies);
            const idx = libs[this.kind].findIndex((p) => p.id === policy.id);
            if (idx < 0) return;
            libs[this.kind][idx] = next;
            this._commit(libs);
        };
        if (this.kind === "food") {
            for (const g of P.catalog(this._items()).food) {
                if (!matches(g.name)) continue;
                const on = !!policy.groups?.[g.id];
                addListRow(0, innerW, on ? "on" : "off", g.name, null, () => {
                    commit(P.toggleFood(policy, g.id));
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
                    let next = policy;
                    for (const it of group.items || []) {
                        const allowed = P.gearAllowed(next, it.id, group.id);
                        if (allowed !== turnOn) next = P.toggleItem(next, it.id, group.id);
                    }
                    commit(next);
                });
                for (const it of items) {
                    const on = P.gearAllowed(policy, it.id, group.id);
                    addListRow(step, Math.max(iconS + Math.round(24 * s), innerW - step), on ? "on" : "off", it.name, this._iconKey(it.id), () => {
                        commit(P.toggleItem(policy, it.id, group.id));
                    });
                }
            }
        }
        this._contentH = y;
        this._maxScroll = Math.max(0, y - this._editH);
        this._scroll = Math.max(0, Math.min(this._scroll, this._maxScroll));
        this.editBody.setPosition(this._editX, this._editY - this._scroll);
    }

    _bindWheel() {
        this.scene.input.on("wheel", (pointer, _o, _dx, dy) => {
            if (!this.visible || !this.containsPointer(pointer)) return;
            this._scroll = Math.max(0, Math.min(this._maxScroll, this._scroll + Math.sign(dy) * Math.round(24 * (this.scene.uiScale || 1))));
            this.editBody.setPosition(this._editX, this._editY - this._scroll);
        });
    }
}
