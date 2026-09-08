/**
 * Settlement overlay: people, jobs, stock, destroy.
 */
class SettlementPanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.settle = null;
        this.tab = "people";
        this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(15100).setVisible(false);
        scene.uiLayer?.add(this.root);
        this._rows = [];
        this._stockRows = [];
        this._scroll = 0;
        this._contentH = 0;
        this._viewW = 0;
        this._viewH = 0;
        this._maxScroll = 0;
        this._bodyX = 10;
        this._bodyY = 62;
        this._tabsLeft = 0;
        this._tabsRight = 0;
        this._scrollDrag = null;
        this._refreshing = false;
        this._contentSigVal = null;
        this._build();
        this._bindScroll();
    }

    _build() {
        const scene = this.scene;
        this.bg = scene.add.rectangle(0, 0, 280, 260, 0x120e0a, 0.94)
            .setStrokeStyle(2, 0x2a2218)
            .setOrigin(0, 0)
            .setInteractive({ cursor: "default" });
        this.title = scene.add.text(0, 0, "Camp", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#d4c4a8"
        }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
        this.title.on("pointerdown", () => {
            if (!this.settle) return;
            const current = this.settle.name || "Camp";
            scene.settlementSys?._showNamePrompt?.((name) => {
                scene.settlementSys.rename(this.settle, name);
            }, {
                title: "Rename your settlement",
                confirm: "Rename",
                placeholder: current,
                value: current
            });
        });
        this.destroyBtn = this._btn(0, 0, "Destroy", () => {
            if (this.settle) scene.settlementSys?.promptDestroy(this.settle);
        });
        this.closeBtn = this._btn(0, 0, "Close", () => scene.settlementSys?.closePanel());
        this.tabPeople = this._btn(0, 0, "People", () => this._setTab("people"));
        this.tabJobs = this._btn(0, 0, "Jobs", () => this._setTab("jobs"));
        this.tabStock = this._btn(0, 0, "Stock", () => this._setTab("stock"));
        this.tabResearch = this._btn(0, 0, "Research", () => this._setTab("research"));
        this.body = scene.add.container(10, 64);
        this._maskGfx = scene.make.graphics({ x: 0, y: 0, add: false });
        // Bitmap mask (not stencil) so job/people tooltips are not washed out.
        this.body.setMask(new Phaser.Display.Masks.BitmapMask(scene, this._maskGfx));
        this.scrollTrack = scene.add.rectangle(0, 0, 5, 100, 0x3a2e26, 1).setOrigin(0, 0).setVisible(false);
        this.scrollThumb = scene.add.rectangle(0, 0, 5, 20, 0x8a7260, 1).setOrigin(0, 0).setVisible(false);
        this.root.add([
            this.bg, this.title, this.destroyBtn, this.closeBtn,
            this.tabPeople, this.tabJobs, this.tabStock, this.tabResearch, this.body,
            this.scrollTrack, this.scrollThumb
        ]);
    }

    _bindScroll() {
        const scene = this.scene;
        this.scrollThumb.setInteractive({ useHandCursor: false, cursor: "default" });
        this.scrollThumb.on("pointerdown", (p) => {
            this._scrollDrag = { startY: p.y, startScroll: this._scroll };
        });
        scene.input.on("pointerup", () => { this._scrollDrag = null; });
        scene.input.on("pointermove", (p) => {
            if (!this.visible || !this.root.visible || !this._scrollDrag || this._maxScroll <= 0) return;
            const travel = Math.max(1, this._viewH - this.scrollThumb.height);
            const dy = p.y - this._scrollDrag.startY;
            this._setScroll(this._scrollDrag.startScroll + (dy / travel) * this._maxScroll);
        });
        scene.input.on("wheel", (pointer, _over, _dx, dy) => {
            if (!this.visible || !this.root.visible || this._maxScroll <= 0) return;
            const p = pointer || scene.input.activePointer;
            if (!this._pointerInBody(p)) return;
            const step = Math.round(22 * (scene.uiScale || 1));
            this._setScroll(this._scroll + (dy > 0 ? step : -step));
        });
    }

    _pointerInBody(pointer) {
        if (!pointer || !this.visible || !this.root?.visible) return false;
        const x = this.root.x + this._bodyX;
        const y = this.root.y + this._bodyY;
        return pointer.x >= x && pointer.x <= x + this._viewW
            && pointer.y >= y && pointer.y <= y + this._viewH;
    }

    _setScroll(y) {
        this._scroll = Phaser.Math.Clamp(y, 0, this._maxScroll);
        this.body.setY(this._bodyY - this._scroll);
        this._layoutScrollbar();
    }

    _layoutScrollbar() {
        const s = this.scene.uiScale || 1;
        const need = this._maxScroll > 0.5;
        this.scrollTrack.setVisible(need);
        this.scrollThumb.setVisible(need);
        if (!need) return;
        const barW = Math.max(4, Math.round(5 * s));
        const trackH = this._viewH;
        const thumbH = Math.max(16 * s, trackH * (this._viewH / Math.max(this._contentH, 1)));
        const travel = Math.max(1, trackH - thumbH);
        const t = this._maxScroll > 0 ? this._scroll / this._maxScroll : 0;
        const x = this._bodyX + this._viewW - barW;
        this.scrollTrack.setPosition(x, this._bodyY).setSize(barW, trackH);
        this.scrollThumb.setPosition(x, this._bodyY + travel * t).setSize(barW, thumbH);
        if (this.scrollThumb.input?.hitArea?.setSize) {
            this.scrollThumb.input.hitArea.setSize(this.scrollThumb.width, this.scrollThumb.height);
        }
    }

    _refreshMask() {
        const wx = this.root.x + this._bodyX;
        const wy = this.root.y + this._bodyY;
        this._maskGfx.clear();
        this._maskGfx.fillStyle(0xffffff, 1);
        this._maskGfx.fillRect(wx, wy, this._viewW, this._viewH);
    }

    _btn(x, y, label, onClick, clip = false) {
        const scene = this.scene;
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;
        const bg = scene.add.rectangle(0, 0, 64, 22, BG, 1)
            .setInteractive({ useHandCursor: true });
        const txt = scene.add.text(0, 0, label, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "14px",
            color: "#d4c4a8"
        }).setOrigin(0.5);
        const c = scene.add.container(x, y, [bg, txt]);
        c._bg = bg;
        c._txt = txt;
        c._label = label;
        c._clip = !!clip;
        c._hovering = false;
        c._pressing = false;
        c._selected = false;
        const strokeW = () => (typeof pixelUiStroke === "function"
            ? pixelUiStroke(scene.uiScale || 1) : 2);
        const inClip = (pointer) => !c._clip || this._pointerInBody(pointer);
        const paint = () => {
            const sw = strokeW();
            if (c._pressing) {
                bg.setFillStyle(BG_PRESS, 1);
                bg.setStrokeStyle(sw, OUTLINE_PRESS);
            } else if (c._selected) {
                bg.setFillStyle(BG, 1);
                bg.setStrokeStyle(sw, OUTLINE_PRESS);
            } else if (c._hovering) {
                bg.setFillStyle(BG, 1);
                bg.setStrokeStyle(sw, OUTLINE_HOVER);
            } else {
                bg.setFillStyle(BG, 1);
                bg.setStrokeStyle(sw, OUTLINE);
            }
        };
        c._paint = paint;
        bg.on("pointerover", (pointer) => {
            if (!inClip(pointer)) return;
            c._hovering = true;
            paint();
        });
        bg.on("pointerout", () => {
            c._hovering = false;
            c._pressing = false;
            paint();
        });
        bg.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const ev = pointer?.event || event;
            const ctrlRight = !!(c._ctrlClick && pointer.rightButtonDown() && ev?.ctrlKey);
            if ((pointer.rightButtonDown() && !ctrlRight) || !inClip(pointer)) return;
            c._pressing = true;
            paint();
        });
        bg.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = c._pressing && c._hovering && inClip(pointer);
            c._pressing = false;
            paint();
            if (was) onClick?.(pointer);
        });
        paint();
        return c;
    }

    _fitBtnHit(btn, w, h) {
        const bg = btn?._bg;
        if (!bg) return;
        bg.setSize(w, h);
        if (bg.input?.hitArea?.setSize) bg.input.hitArea.setSize(w, h);
        else if (bg.input?.hitArea?.setTo) bg.input.hitArea.setTo(0, 0, w, h);
    }

    _syncTabs() {
        const set = (btn, on) => {
            if (!btn) return;
            btn._selected = on;
            btn._paint?.();
        };
        set(this.tabPeople, this.tab === "people");
        set(this.tabJobs, this.tab === "jobs");
        set(this.tabStock, this.tab === "stock");
        set(this.tabResearch, this.tab === "research");
    }

    _setTab(tab) {
        this.tab = tab;
        this._scroll = 0;
        this._contentSigVal = null;
        this._syncTabs();
        this.layout();
    }

    open(settle) {
        this.settle = settle;
        this.visible = true;
        this._scroll = 0;
        this._contentSigVal = null;
        this.root.setVisible(true);
        this.layout();
        this._syncTabs();
    }

    close() {
        this.visible = false;
        this.settle = null;
        this.root.setVisible(false);
        this.scrollTrack.setVisible(false);
        this.scrollThumb.setVisible(false);
        this.scene.settlementSys?._drawRange?.(null, false);
    }

    layout() {
        const scene = this.scene;
        const s = scene.uiScale || 1;
        if (typeof applyPixelUiFont === "function") {
            applyPixelUiFont(this.title, 16, s);
            applyPixelUiFont(this.destroyBtn._txt, 12, s);
            applyPixelUiFont(this.closeBtn._txt, 12, s);
            applyPixelUiFont(this.tabPeople._txt, 12, s);
            applyPixelUiFont(this.tabJobs._txt, 12, s);
            applyPixelUiFont(this.tabStock._txt, 12, s);
            applyPixelUiFont(this.tabResearch._txt, 12, s);
        }
        const tabY = Math.round(44 * s);
        const tabH = Math.round(22 * s);
        const tabGap = Math.round(8 * s);
        const tabPad = Math.round(6 * s);
        let tabLeft = tabPad;
        for (const tab of [this.tabPeople, this.tabJobs, this.tabStock, this.tabResearch]) {
            const tw = Math.round((
                tab === this.tabPeople ? 64
                : tab === this.tabJobs ? 48
                : tab === this.tabStock ? 54
                : 78
            ) * s);
            this._fitBtnHit(tab, tw, tabH);
            tab.setPosition(tabLeft + tw / 2, tabY);
            tabLeft += tw + tabGap;
        }
        const peopleW = this.tabPeople._bg.width;
        const researchW = this.tabResearch._bg.width;
        this._tabsLeft = this.tabPeople.x - peopleW / 2;
        this._tabsRight = this.tabResearch.x + researchW / 2;
        const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(s) : 2;
        const w = this._tabsRight + Math.max(tabPad, sw);
        const h = Math.round(260 * s);
        this.bg.setSize(w, h);
        if (this.bg.input?.hitArea?.setSize) {
            this.bg.input.hitArea.setSize(this.bg.width, this.bg.height);
        } else if (this.bg.input?.hitArea?.setTo) {
            this.bg.input.hitArea.setTo(0, 0, this.bg.width, this.bg.height);
        }
        this.root.setPosition(Math.round(16 * s), Math.round((scene.scale.height - h) / 2));
        const headerY = Math.round(18 * s);
        this.title.setPosition(Math.round(12 * s), headerY);
        const closeW = Math.round(52 * s);
        const destW = Math.round(64 * s);
        const headerBtnH = Math.round(22 * s);
        this._fitBtnHit(this.destroyBtn, destW, headerBtnH);
        this._fitBtnHit(this.closeBtn, closeW, headerBtnH);
        this.closeBtn.setPosition(this._tabsRight - closeW / 2, headerY);
        this.destroyBtn.setPosition(
            this.closeBtn.x - closeW / 2 - tabGap - destW / 2,
            headerY
        );
        this._bodyX = this._tabsLeft;
        this._bodyY = Math.round(62 * s);
        this._viewW = this._tabsRight - this._tabsLeft + sw;
        this._viewH = h - this._bodyY - Math.round(8 * s);
        this.body.setPosition(this._bodyX, this._bodyY);
        this.bg.setStrokeStyle(sw, 0x2a2218);
        this.destroyBtn._paint?.();
        this.closeBtn._paint?.();
        this._syncTabs();
        this._contentSigVal = null;
        if (this.visible && this.settle) this.refresh();
        else {
            this._maxScroll = Math.max(0, this._contentH - this._viewH);
            this._refreshMask();
            this._setScroll(this._scroll);
        }
    }

    _clearBody() {
        this.body.removeAll(true);
        this._rows = [];
        this._stockRows = [];
    }

    _contentSig() {
        const tab = this.tab || "people";
        const id = this.settle?.id || "";
        const sys = this.scene.settlementSys;
        const layout = `${this._viewW}x${this._viewH}:${this.scene.uiScale || 1}`;
        if (tab === "jobs") {
            const here = sys?.settlersOf?.(this.settle.id) || [];
            const jobs = here.map((p) => {
                const pid = p.pawnId || p.id;
                try {
                    return `${pid}:${JSON.stringify(this.settle.jobs?.[pid] || {})}`;
                } catch (_) {
                    return String(pid);
                }
            }).join("|");
            return `jobs:${id}:${jobs}:${layout}`;
        }
        if (tab === "stock") {
            const items = sys?.localStockItems?.(this.settle) || [];
            return `stock:${id}:${items.join(",")}:${layout}`;
        }
        if (tab === "research") {
            const R = typeof Research !== "undefined" ? Research : null;
            const circles = sys?.paintingCirclesInRange?.(this.settle) || [];
            const pts = R?.pointsBreakdown
                ? R.pointsBreakdown(circles.map((t) => t.entry || t), { settle: this.settle })
                : { total: 0 };
            return `research:${id}:${pts.total}:${pts.spent || 0}:${layout}`;
        }
        const party = (this.scene.party || []).filter((p) => p && !p.isBodyDead?.());
        const here = sys?.settlersOf?.(this.settle.id) || [];
        const ids = (list) => list.map((p) => p.pawnId || p.id).join(",");
        return `people:${id}:${ids(party)}:${ids(here)}:${layout}`;
    }

    _pointerStillOn(obj, pointer) {
        if (!obj || !pointer) return false;
        const b = obj.getBounds?.();
        return !!(b && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y));
    }

    _restoreHoverTip() {
        const scene = this.scene;
        const p = scene.input?.activePointer;
        if (!p || !this.visible) return;
        const visit = (obj) => {
            if (!obj?.active) return false;
            if (obj.input?.enabled && this._pointerStillOn(obj, p)) {
                obj.emit("pointerover", p);
                return true;
            }
            const kids = obj.list;
            if (Array.isArray(kids)) {
                for (let i = kids.length - 1; i >= 0; i--) {
                    if (visit(kids[i])) return true;
                }
            }
            return false;
        };
        visit(this.body);
    }

    refresh() {
        if (!this.visible || !this.settle) return;
        const scene = this.scene;
        const s = scene.uiScale || 1;
        this.title.setText(this.settle.name || "Camp");
        const sig = this._contentSig();
        if (sig === this._contentSigVal && this.body.list?.length) {
            this._syncTabs();
            this._refreshMask();
            return;
        }
        this._contentSigVal = sig;
        this._refreshing = true;
        this._clearBody();
        let contentH = 0;
        if (this.tab === "jobs") contentH = this._fillJobs(s);
        else if (this.tab === "stock") contentH = this._fillStock(s);
        else if (this.tab === "research") contentH = this._fillResearch(s);
        else contentH = this._fillPeople(s);
        this._contentH = Math.max(contentH, 1);
        this._maxScroll = Math.max(0, this._contentH - this._viewH);
        this._setScroll(Math.min(this._scroll, this._maxScroll));
        this._refreshMask();
        this._syncTabs();
        this._refreshing = false;
        this._restoreHoverTip();
    }

    _label(text, x, y, size = 12, wrapW = 0) {
        const t = this.scene.add.text(x, y, text, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(size, this.scene.uiScale || 1)}px`,
            color: "#d4c4a8",
            wordWrap: wrapW > 0 ? { width: wrapW } : undefined
        });
        this.body.add(t);
        return t;
    }

    _rowLabel(text, x, y, rowH, size = 12) {
        const t = this._label(text, x, y + rowH / 2, size);
        t.setOrigin(0, 0.5);
        return t;
    }

    _peopleDivider(y, w, sc) {
        const g = this.scene.add.graphics();
        const stroke = Math.max(1, Math.round(sc));
        g.lineStyle(stroke, 0x6a5a4a, 1);
        g.lineBetween(0, 0, w, 0);
        g.setPosition(0, Math.round(y));
        this.body.add(g);
        return stroke;
    }

    _fillPeople(sc) {
        const scene = this.scene;
        const sys = scene.settlementSys;
        const party = (scene.party || []).filter((p) => p && !p.isBodyDead?.());
        const here = sys.settlersOf(this.settle.id);
        const barW = Math.max(4, Math.round(5 * sc));
        const innerW = Math.max(120, Math.round(this._viewW - barW - 4 * sc));
        const gap = Math.round(6 * sc);
        const colW = Math.max(80, Math.floor((innerW - gap) / 2));
        const rowH = Math.round(24 * sc);
        let y = 0;
        this._rowLabel("Party", 0, y, rowH, 12);
        y += rowH;
        y = this._fillPeopleGrid(party, y, colW, gap, rowH, sc, "party");
        y += Math.round(8 * sc);
        this._peopleDivider(y, innerW, sc);
        this._rowLabel("Here", 0, y, rowH, 12);
        y += rowH;
        if (!here.length) {
            this._rowLabel("(none)", Math.round(8 * sc), y, rowH, 12);
            y += rowH;
        } else {
            y = this._fillPeopleGrid(here, y, colW, gap, rowH, sc, "here");
        }
        return y + 8 * sc;
    }

    _fillPeopleGrid(list, y0, colW, gap, rowH, sc, kind) {
        const scene = this.scene;
        const sys = scene.settlementSys;
        const P = typeof Party !== "undefined" ? Party : { CAP: 6 };
        const others = kind === "here"
            ? sys.owned().filter((s) => s.id !== this.settle.id)
            : [];
        const partyFull = (scene.party?.length || 0) >= (P.CAP || 6);
        const btnW = Math.round(40 * sc);
        const btnH = Math.round(20 * sc);
        const btnGap = Math.round(4 * sc);
        let y = y0;
        for (let i = 0; i < list.length; i++) {
            const p = list[i];
            const col = i % 2;
            if (col === 0 && i > 0) y += rowH;
            const x = col * (colW + gap);
            const name = p.displayName?.() || p.pawnName || "?";
            const isLeader = p === scene.leader;
            const controlled = !!(p.isControlled?.() || p === scene.player);
            const showSend = kind === "here" && others[0];
            const showDrop = kind === "party" && !isLeader;
            const showTake = kind === "here";
            let btns = 0;
            if (showDrop || showTake) btns += 1;
            if (showSend) btns += 1;
            const btnsW = btns ? btns * btnW + Math.max(0, btns - 1) * btnGap : 0;
            const crownW = (isLeader && kind === "party") ? Math.round(12 * sc) : 0;
            const nameMax = Math.max(24, colW - btnsW - crownW - Math.round(6 * sc));
            const label = this._rowLabel(name, x, y, rowH, 12);
            if (controlled) label.setColor("#b8ffb8");
            if (label.width > nameMax) {
                let cut = name;
                while (cut.length > 1 && label.width > nameMax) {
                    cut = cut.slice(0, -1);
                    label.setText(`${cut}…`);
                }
            }
            if (isLeader && kind === "party" && scene.textures?.exists("leader")) {
                const crown = scene.add.image(
                    x + Math.min(label.width, nameMax) + Math.round(3 * sc),
                    y + rowH / 2,
                    "leader"
                ).setOrigin(0, 0.5).setScale(sc);
                this.body.add(crown);
            }
            const hitW = Math.max(8, colW - btnsW);
            const hit = scene.add.zone(x, y, hitW, rowH).setOrigin(0, 0);
            hit.setInteractive({ useHandCursor: true, cursor: "pointer" });
            hit.on("pointerover", (pointer) => {
                if (!this._pointerInBody(pointer)) return;
                scene.showTooltip(() => this._personActionTip(p), pointer.x, pointer.y, hit);
            });
            hit.on("pointerout", (pointer) => {
                if (this._refreshing) return;
                if (this._pointerStillOn(hit, pointer)) return;
                if (scene._tooltipTarget === hit) scene.hideTooltip?.();
            });
            this.body.add(hit);
            let bx = x + colW - btnW / 2;
            const by = y + rowH / 2;
            const addBtn = (text, fn, dim) => {
                const b = this._btn(bx, by, text, fn, true);
                b._bg.setSize(btnW, btnH);
                if (b._bg.input?.hitArea?.setSize) b._bg.input.hitArea.setSize(btnW, btnH);
                if (typeof applyPixelUiFont === "function") applyPixelUiFont(b._txt, 10, sc);
                if (dim) b.setAlpha(0.4);
                b._paint?.();
                this.body.add(b);
                bx -= btnW + btnGap;
                return b;
            };
            if (showSend) addBtn("Send", () => sys.transfer(p, others[0]));
            if (showDrop) addBtn("Drop", () => sys.dropOff(p, this.settle));
            if (showTake) addBtn("Take", () => sys.pickUp(p, this.settle), partyFull);
        }
        if (list.length) y += rowH;
        return y;
    }

    _personActionTip(p) {
        if (!p || p.isBodyDead?.()) return "";
        const controlled = !!(p.isControlled?.() || p === this.scene.player);
        let text = "";
        if (!controlled) {
            text = this.scene.partySys?.activityTooltip?.(p) || "";
            if (!text) {
                if (p.partyAI?.assistTarget && !p.partyAI.assistTarget.isBodyDead?.()) text = "Fighting";
                else text = "Idle";
            }
        }
        const rows = this.scene.partySys?.heldTooltipRows?.(p);
        if (rows?.length) return { text, rows };
        return text;
    }

    _fillJobs(sc) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const jobs = S?.JOBS || ["doctor", "cook", "chop", "leather", "gather", "haul"];
        const here = this.scene.settlementSys.settlersOf(this.settle.id);
        if (!here.length) {
            this._label("Drop people off to assign jobs.", 0, 0, 12);
            return 24 * sc;
        }

        const scene = this.scene;
        const nJobs = jobs.length;
        const cellS = Math.round(20 * sc);
        const rowH = cellS;
        const nameW = Math.round(56 * sc);
        const colX = [nameW];
        for (let i = 0; i < nJobs; i++) colX.push(colX[i] + cellS);
        const gridW = colX[nJobs];
        const headerH = Math.round(32 * sc);
        const yHi = Math.round(8 * sc);
        const yLo = Math.round(21 * sc);
        const stroke = Math.max(1, Math.round(sc));
        const line = 0x2a2218;
        const headerBg = 0x1a1510;
        const cellBg = 0x120e0a;
        const cellHover = 0x2a2218;
        const cellPress = 0x0a0806;

        const headerFill = scene.add.rectangle(0, 0, gridW, headerH, headerBg, 1).setOrigin(0, 0);
        this.body.add(headerFill);

        for (let i = 0; i < nJobs; i++) {
            const j = jobs[i];
            const hx = colX[i] + cellS / 2;
            const hy = (i % 2 === 0) ? yHi : yLo;
            const hit = scene.add.rectangle(colX[i], 0, cellS, headerH, headerBg, 0)
                .setOrigin(0, 0)
                .setInteractive({ useHandCursor: true, cursor: "pointer" });
            hit.on("pointerover", (pointer) => {
                if (!this._pointerInBody(pointer)) return;
                const text = S?.jobTooltip ? S.jobTooltip(j) : j;
                scene.showTooltip(() => text, pointer.x, pointer.y, hit);
            });
            hit.on("pointerout", (pointer) => {
                if (this._refreshing) return;
                if (this._pointerStillOn(hit, pointer)) return;
                if (scene._tooltipTarget === hit) scene.hideTooltip?.();
            });
            this.body.add(hit);
            const ht = this._label(S?.jobLabel?.(j) || j, hx, hy, 10);
            ht.setOrigin(0.5, 0.5);
        }

        for (let r = 0; r < here.length; r++) {
            const p = here[r];
            const rowY = headerH + r * rowH;
            const name = (p.displayName?.() || "?").slice(0, 8);
            const nt = this._label(name, Math.round(4 * sc), rowY + rowH / 2, 11);
            nt.setOrigin(0, 0.5);
            if (p.isControlled?.() || p === scene.player) nt.setColor("#b8ffb8");
            const jobRow = S ? S.jobsFor(this.settle, p.pawnId) : {};
            for (let i = 0; i < nJobs; i++) {
                const j = jobs[i];
                const pri = jobRow[j] || 0;
                const cellX = colX[i];
                const bg = scene.add.rectangle(cellX, rowY, cellS, rowH, cellBg, 1)
                    .setOrigin(0, 0)
                    .setInteractive({ useHandCursor: true });
                const txt = scene.add.text(cellX + cellS / 2, rowY + rowH / 2, pri ? String(pri) : "–", {
                    fontFamily: PIXEL_UI_FONT,
                    fontSize: `${pixelUiFontSize(11, sc)}px`,
                    color: "#d4c4a8"
                }).setOrigin(0.5);
                if (typeof applyPixelUiFont === "function") applyPixelUiFont(txt, 11, sc);
                let hovering = false;
                let pressing = false;
                const paint = () => {
                    if (pressing) bg.setFillStyle(cellPress, 1);
                    else if (hovering) bg.setFillStyle(cellHover, 1);
                    else bg.setFillStyle(cellBg, 1);
                };
                bg.on("pointerover", (pointer) => {
                    if (!this._pointerInBody(pointer)) return;
                    hovering = true;
                    paint();
                });
                bg.on("pointerout", () => {
                    hovering = false;
                    pressing = false;
                    paint();
                });
                bg.on("pointerdown", (pointer) => {
                    if (!this._pointerInBody(pointer)) return;
                    pressing = true;
                    paint();
                });
                bg.on("pointerup", (pointer) => {
                    const was = pressing && hovering;
                    pressing = false;
                    paint();
                    if (!was || !this._pointerInBody(pointer)) return;
                    const right = !!(pointer.rightButtonReleased?.() || pointer.button === 2);
                    const next = S
                        ? (right ? S.cyclePriority(pri) : S.raisePriority(pri))
                        : 0;
                    S?.setJob(this.settle, p.pawnId, j, next);
                    this.scene.settlementSys?.bumpWorkCache?.();
                    this.scene.settlementSys?.sendNet("setJobs", {
                        settlementId: this.settle.id,
                        pawnId: p.pawnId,
                        jobs: this.settle.jobs?.[p.pawnId]
                    });
                    this.refresh();
                });
                this.body.add(bg);
                this.body.add(txt);
            }
        }

        const rows = here.length;
        const gridH = headerH + rowH * rows;
        const g = scene.add.graphics();
        g.lineStyle(stroke, line, 1);
        const bodyH = rowH * rows;
        g.strokeRect(stroke / 2, headerH + stroke / 2, gridW - stroke, bodyH - stroke);
        for (let i = 0; i < nJobs; i++) {
            g.lineBetween(colX[i], headerH, colX[i], gridH);
        }
        for (let r = 1; r < rows; r++) {
            const y = headerH + r * rowH;
            g.lineBetween(0, y, gridW, y);
        }
        this.body.add(g);
        return gridH + 8 * sc;
    }

    _ensurePaintingsUiIcon() {
        if (typeof ensurePaintingsUiIcon === "function") {
            return ensurePaintingsUiIcon(this.scene) || this._itemIconKey("painting_circle");
        }
        return this._itemIconKey("painting_circle");
    }

    _itemIconKey(itemId) {
        if (!itemId) return null;
        const def = this.scene.getItem?.(itemId) || { id: itemId, key: itemId };
        if (typeof Place !== "undefined" && Place.itemIconKey) {
            const key = Place.itemIconKey(
                def,
                (id) => this.scene.getThing?.(id),
                (k) => this.scene.textures.exists(k)
            );
            if (key && this.scene.textures.exists(key)) return key;
        }
        if (def?.key && this.scene.textures.exists(def.key)) return def.key;
        if (this.scene.textures.exists(itemId)) return itemId;
        return null;
    }

    _fillStock(sc) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const scene = this.scene;
        const sys = scene.settlementSys;
        const items = sys?.localStockItems?.(this.settle) || [];
        const settle = this.settle;
        settle.stock = S ? S.normalizeStock(settle.stock) : (settle.stock || {});
        let y = 0;
        const wrapW = Math.max(80, this._viewW - Math.round(12 * sc));
        const header = this._label("Set desired amount to store", 0, y, 11, wrapW);
        y += Math.max(18 * sc, Math.round(header.height + 6 * sc));
        if (!items.length) {
            this._label("Nothing gatherable in range.", 0, y, 11);
            return y + 18 * sc;
        }
        const btnW = Math.round(24 * sc);
        const btnH = Math.round(16 * sc);
        const plusRight = Math.max(
            btnW * 2 + Math.round(8 * sc),
            Math.round((this._tabsRight || 0) - this._bodyX)
        );
        const plusX = plusRight - btnW / 2;
        const minusX = plusX - Math.round(32 * sc);
        const iconS = Math.round(16 * sc);
        const iconGap = Math.round(4 * sc);
        const textX = iconS + iconGap;
        this._stockRows = [];
        for (const id of items) {
            const meta = scene.getItem?.(id);
            const name = meta?.name || id;
            const midY = y + 8 * sc;
            const iconKey = this._itemIconKey(id);
            if (iconKey) {
                const icon = scene.add.image(iconS / 2, midY, iconKey)
                    .setDisplaySize(iconS, iconS);
                this.body.add(icon);
            }
            const label = this._label(`${name}  0/0`, textX, midY, 11);
            label.setOrigin(0, 0.5);
            const minus = this._btn(minusX, midY, "–", (pointer) => {
                this._nudgeStock(settle, id, -this._stockStep(pointer));
            }, true);
            const plus = this._btn(plusX, midY, "+", (pointer) => {
                this._nudgeStock(settle, id, this._stockStep(pointer));
            }, true);
            this._fitBtnHit(minus, btnW, btnH);
            this._fitBtnHit(plus, btnW, btnH);
            minus._ctrlClick = true;
            plus._ctrlClick = true;
            minus._paint?.();
            plus._paint?.();
            this.body.add(minus);
            this.body.add(plus);
            const row = { id, name, label, minus, plus };
            this._stockRows.push(row);
            this._paintStockRow(row);
            y += 22 * sc;
        }
        this._restoreStockHover();
        return y + 8 * sc;
    }

    refreshStockLive() {
        if (!this.visible || this.tab !== "stock" || !this.settle) return;
        const items = this.scene.settlementSys?.localStockItems?.(this.settle) || [];
        const rows = this._stockRows || [];
        const ids = new Set(items);
        if (items.length !== rows.length || rows.some((r) => !ids.has(r.id))) {
            this.refresh();
            return;
        }
        for (const row of rows) this._paintStockRow(row);
    }

    _restoreStockHover() {
        const pointer = this.scene.input?.activePointer;
        if (!pointer || !this._pointerInBody(pointer)) return;
        for (const row of this._stockRows || []) {
            for (const b of [row.minus, row.plus]) {
                const bg = b?._bg;
                if (!bg?.getBounds) continue;
                const over = Phaser.Geom.Rectangle.Contains(bg.getBounds(), pointer.x, pointer.y);
                if (over) {
                    b._hovering = true;
                    b._paint?.();
                    this.scene._hoverTarget = bg;
                }
            }
        }
    }

    _paintStockRow(row) {
        if (!row?.label || !this.settle) return;
        const have = this.scene.settlementSys?.countBaskets(this.settle, row.id) || 0;
        const want = this.settle.stock[row.id] || 0;
        row.label.setText(`${row.name}  ${have}/${want}`);
    }

    _stockStep(pointer) {
        const ev = pointer?.event;
        const keys = this.scene?.player?.keys;
        const shift = !!(ev?.shiftKey || keys?.SHIFT?.isDown);
        const ctrl = !!(ev?.ctrlKey || ev?.metaKey || keys?.CTRL?.isDown);
        if (shift) return 100;
        if (ctrl) return 10;
        return 1;
    }

    _nudgeStock(settle, id, delta) {
        if (!settle || !id) return;
        const next = Math.max(0, Math.min(9999, (settle.stock[id] || 0) + delta));
        settle.stock[id] = next;
        this.scene.settlementSys?.sendNet("setStock", { settlementId: settle.id, stock: settle.stock });
        const row = (this._stockRows || []).find((r) => r.id === id);
        if (row) this._paintStockRow(row);
        else this.refresh();
    }

    _researchEntries() {
        const circles = this.scene.settlementSys?.paintingCirclesInRange?.(this.settle) || [];
        return circles.map((t) => t.entry || t).filter(Boolean);
    }

    _fillResearch(sc) {
        const R = typeof Research !== "undefined" ? Research : null;
        if (!R) {
            this._label("Research is unavailable.", 0, 0, 12);
            return 24 * sc;
        }
        R.ensureTechs(this.settle);
        const pts = R.pointsBreakdown
            ? R.pointsBreakdown(this._researchEntries(), { settle: this.settle })
            : { paintings: 0, tokens: 0, books: 0, spent: 0, total: 0 };
        const wrapW = Math.max(80, this._viewW - Math.round(12 * sc));
        const rowH = Math.round(22 * sc);
        const iconS = Math.round(16 * sc);
        const iconGap = Math.round(4 * sc);
        const textX = iconS + iconGap;
        let y = 0;
        const head = this._label(`Research points: ${pts.total}`, 0, y, 12);
        y += Math.round(head.height + 10 * sc);
        const spent = Math.max(0, Math.floor(Number(pts.spent) || 0));
        const rows = [
            ...((R.currencies && R.currencies()) || [
                { id: "paintings", name: "Paintings", icon: "painting_circle" },
                { id: "tokens", name: "Tokens", icon: "null" },
                { id: "books", name: "Books", icon: "null" }
            ]),
            { id: "spent", name: "Research", icon: R.UI_SCIENCE_KEY || "science" }
        ];
        for (const row of rows) {
            const midY = y + rowH / 2;
            let iconKey = null;
            if (row.id === "paintings") {
                iconKey = this._ensurePaintingsUiIcon();
            } else if (row.id === "spent") {
                const key = row.icon || "science";
                iconKey = this.scene.textures.exists(key) ? key : null;
            } else {
                iconKey = this._itemIconKey(row.icon || "null");
            }
            if (iconKey) {
                const icon = this.scene.add.image(iconS / 2, midY, iconKey)
                    .setDisplaySize(iconS, iconS);
                this.body.add(icon);
            }
            this._rowLabel(row.name, textX, y, rowH, 12);
            const n = row.id === "spent" ? String(spent) : String(pts[row.id] ?? 0);
            const val = this._label(n, wrapW, midY, 12);
            val.setOrigin(1, 0.5);
            if (row.id === "spent") {
                const minus = this._label("-", wrapW, midY, 12);
                minus.setOrigin(1, 0.5);
                minus.setX(wrapW - (val.displayWidth || 0));
            }
            y += rowH;
        }
        y += Math.round(14 * sc);
        const bw = Math.round(188 * sc);
        const bh = Math.round(24 * sc);
        const btn = this._btn(wrapW / 2, y + bh / 2, "Open Research Menu", () => {
            this.scene.researchTreePanel?.open(this.settle);
        }, true);
        btn._bg.setSize(bw, bh);
        this._fitBtnHit(btn, bw, bh);
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(btn._txt, 12, sc);
        this.body.add(btn);
        return y + bh + 8 * sc;
    }

    _tryUnlock(tech) {
        if (!tech || !this.settle) return;
        const R = typeof Research !== "undefined" ? Research : null;
        if (!R) return;
        const entries = this._researchEntries();
        const pts = R.pointsBreakdown
            ? R.pointsBreakdown(entries, { settle: this.settle })
            : { total: R.availableTotal(entries, this.settle) };
        if (!R.canUnlock(this.settle, tech.id, pts.total)) return;
        this.scene.settlementSys?.sendNet("unlockTech", {
            settlementId: this.settle.id,
            techId: tech.id
        });
        R.unlock(this.settle, tech.id);
        const tree = this.scene.researchTreePanel;
        if (tree?.settle && tree.settle !== this.settle) R.unlock(tree.settle, tech.id);
        this._contentSigVal = null;
        if (tree) tree._sig = null;
        this.refresh();
        tree?.refresh?.();
    }

    hoverObjAt(pointer) {
        if (!pointer || !this.visible || !this._pointerInBody(pointer)) return null;
        const visit = (obj) => {
            if (!obj?.active) return null;
            const kids = obj.list;
            if (Array.isArray(kids)) {
                for (let i = kids.length - 1; i >= 0; i--) {
                    const hit = visit(kids[i]);
                    if (hit) return hit;
                }
            }
            if (obj.input?.enabled) {
                const b = obj.getBounds?.();
                if (b && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y)) return obj;
            }
            return null;
        };
        return visit(this.body);
    }

    containsPointer(pointer) {
        if (!this.visible || !this.root?.visible || !pointer) return false;
        const b = this.bg.getBounds();
        return Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y);
    }
}
