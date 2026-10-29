/**
 * Details window. Stats is the list on the left and sources on the right.
 * Humans also have a Bio tab with the same sheet as the in-world bio panel.
 * Same shell as the research tree: opaque frame, dimmed world, pause, and close.
 */
class StatsPanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.pawn = null;
        this.page = "stats";
        this.selected = null;
        this._scroll = 0;
        this._bioScroll = 0;
        this._pauseWhileOpen = true;
        this._sizeSig = "";
        this._bioSig = "";
        this._bioProgress = "";
        this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(16200).setVisible(false);
        scene.uiLayer?.add(this.root);
        this._build();
        scene.input.on("wheel", (_p, _over, _dx, dy) => {
            if (!this.visible) return;
            const ptr = scene.input.activePointer;
            const step = dy * 0.4;
            if (this.page === "bio") {
                const b = this._bioBounds;
                if (!b || ptr.x < b.x || ptr.x > b.x + b.w || ptr.y < b.y || ptr.y > b.y + b.h) return;
                this._bioScroll = Math.max(0, Math.min(this._maxBioScroll(), this._bioScroll + step));
                this._placeBio();
                return;
            }
            const b = this._listBounds;
            if (!b || ptr.x < b.x || ptr.x > b.x + b.w || ptr.y < b.y || ptr.y > b.y + b.h) return;
            this._scroll = Math.max(0, Math.min(this._maxScroll(), this._scroll + step));
            this._placeRows();
        });
    }

    _build() {
        const scene = this.scene;
        this.dim = scene.add.rectangle(0, 0, 800, 600, 0x080604, 0.72)
            .setOrigin(0, 0)
            .setInteractive({ cursor: "default" });
        this.frame = scene.add.rectangle(0, 0, 800, 600, 0x120e0a, 1)
            .setOrigin(0, 0)
            .setStrokeStyle(2, 0x2a2218)
            .setInteractive({ cursor: "default" });
        this.listBg = scene.add.rectangle(0, 0, 10, 10, 0x0e0c0a, 1)
            .setOrigin(0, 0)
            .setInteractive({ cursor: "default" });
        this.divider = scene.add.rectangle(0, 0, 2, 10, 0x2a2218, 1).setOrigin(0, 0);
        this.portrait = scene.add.sprite(0, 0, "human", 1).setOrigin(0.5, 0.5).setVisible(false);
        this.title = scene.add.text(0, 0, "Details", {
            fontFamily: typeof PIXEL_UI_FONT !== "undefined" ? PIXEL_UI_FONT : "monospace",
            fontSize: "16px",
            color: "#d4c4a8"
        }).setOrigin(0, 0.5);
        this.closeBtn = this._btn("Close", () => this.close());
        this.pauseBtn = makePauseGameButton(scene, () => this._togglePause(), true);
        this.left = scene.add.container(0, 0);
        this.right = scene.add.container(0, 0);
        this.tabGfx = scene.add.graphics();
        this.tabStats = this._makeTab("stats", "Stats");
        this.tabBio = this._makeTab("bio", "Bio");
        this.bioRoot = scene.add.container(0, 0).setVisible(false);
        this.bioBars = scene.add.graphics();
        this.bioTexts = scene.add.container(0, 0);
        this.bioRoot.add([this.bioBars, this.bioTexts]);
        this._maskGfx = scene.make.graphics({ x: 0, y: 0, add: false });
        this._detailMaskGfx = scene.make.graphics({ x: 0, y: 0, add: false });
        this._bioMaskGfx = scene.make.graphics({ x: 0, y: 0, add: false });
        this.left.setMask(new Phaser.Display.Masks.BitmapMask(scene, this._maskGfx));
        this.right.setMask(new Phaser.Display.Masks.BitmapMask(scene, this._detailMaskGfx));
        this.bioRoot.setMask(new Phaser.Display.Masks.BitmapMask(scene, this._bioMaskGfx));
        this.root.add([
            this.dim, this.frame, this.listBg, this.divider,
            this.left, this.right, this.bioRoot,
            this.portrait, this.title, this.pauseBtn, this.closeBtn,
            this.tabGfx, this.tabStats.txt, this.tabStats.hit, this.tabBio.txt, this.tabBio.hit
        ]);
        this.dim.on("pointerup", (p) => {
            if (!this.visible || (p?.button && p.button !== 0)) return;
            const b = this.frame.getBounds();
            if (b && !Phaser.Geom.Rectangle.Contains(b, p.x, p.y)) this.close();
        });
        this._rows = [];
        this._detail = [];
        this._bioHits = [];
        this._tabSpecs = [];
        this._listH = 0;
        this._viewH = 0;
        this._bioH = 0;
        this._bioViewH = 0;
    }

    _makeTab(id, label) {
        const scene = this.scene;
        const txt = scene.add.text(0, 0, label, {
            fontFamily: typeof PIXEL_UI_FONT !== "undefined" ? PIXEL_UI_FONT : "monospace",
            fontSize: "14px",
            color: "#a89880"
        }).setOrigin(0.5, 0.5);
        const hit = scene.add.rectangle(0, 0, 10, 10, 0x000000, 0.001).setOrigin(0, 0);
        hit.setInteractive({ useHandCursor: true });
        hit._tabId = id;
        hit._hover = false;
        hit.on("pointerover", () => {
            hit._hover = true;
            this._paintTabs();
        });
        hit.on("pointerout", () => {
            hit._hover = false;
            this._paintTabs();
        });
        hit.on("pointerup", (p) => {
            if (p?.button && p.button !== 0) return;
            this._setPage(id);
        });
        return { id, txt, hit };
    }

    toggle(pawn) {
        if (this.visible) this.close();
        else this.open(pawn);
    }

    open(pawn) {
        this.pawn = pawn || null;
        this.page = "stats";
        this.selected = null;
        this._bioScroll = 0;
        this._bioSig = "";
        this._bioProgress = "";
        this.visible = true;
        this.root.setVisible(true);
        this.scene.hideTooltip?.();
        this.scene.uiLayer?.bringToTop?.(this.root);
        this._sizeSig = "";
        this.refresh();
        this._syncPause();
        this.scene.bioPanel?._paintInfo?.();
    }

    close() {
        if (!this.visible && !this.root.visible) return;
        this.visible = false;
        this.root.setVisible(false);
        this.pawn = null;
        this.scene.hideTooltip?.();
        this._syncPause();
        this.scene.bioPanel?._paintInfo?.();
    }

    handleEsc() {
        if (!this.visible) return false;
        this.close();
        return true;
    }

    containsPointer(pointer) {
        if (!this.visible || !pointer) return false;
        return pointer.x >= 0 && pointer.x <= this.scene.scale.width
            && pointer.y >= 0 && pointer.y <= this.scene.scale.height;
    }

    /** The control under the cursor, or the dim so nothing behind the window can take the hover. */
    hoverObjAt(pointer) {
        if (!this.containsPointer(pointer)) return null;
        if (this._over(this.pauseBtn?._bg, pointer)) return this.pauseBtn._bg;
        if (this._over(this.closeBtn?._bg, pointer)) return this.closeBtn._bg;
        for (let i = (this._tabSpecs || []).length - 1; i >= 0; i--) {
            const spec = this._tabSpecs[i];
            if (spec.hidden) continue;
            if (this._over(spec.hit, pointer)) return spec.hit;
        }
        if (this.page === "bio") {
            const view = this._bioBounds;
            const inView = view && pointer.x >= view.x && pointer.x <= view.x + view.w
                && pointer.y >= view.y && pointer.y <= view.y + view.h;
            if (inView) {
                for (let i = this._bioHits.length - 1; i >= 0; i--) {
                    const hit = this._bioHits[i];
                    if (this._over(hit, pointer)) return hit;
                }
            }
            return this.dim;
        }
        const b = this._listBounds;
        if (b && pointer.x >= b.x && pointer.x <= b.x + b.w && pointer.y >= b.y && pointer.y <= b.y + b.h) {
            for (let i = this._rows.length - 1; i >= 0; i--) {
                const row = this._rows[i];
                if (!row.pick) continue;
                if (this._over(row.hit, pointer)) return row.hit;
            }
        }
        return this.dim;
    }

    _over(obj, pointer) {
        if (!obj?.active || obj.visible === false) return false;
        const bounds = obj.getBounds?.();
        return !!(bounds && Phaser.Geom.Rectangle.Contains(bounds, pointer.x, pointer.y));
    }

    _setPage(page) {
        if (page === "bio" && !this._hasBioTab()) page = "stats";
        if (page === this.page) return;
        this.page = page;
        this.scene.hideTooltip?.();
        this._sizeSig = "";
        this.refresh();
    }

    refresh() {
        if (!this.visible) return;
        if (this.page === "bio" && !this._hasBioTab()) this.page = "stats";
        const m = this._metrics();
        this._sizeSig = `${m.W}x${m.H}:${m.s}:${this.page}`;
        if (this.page === "bio") {
            this._refreshBio();
            this.layout();
            return;
        }
        this._clear(this.left);
        this._clear(this.right);
        this._rows = [];
        this._detail = [];
        const entries = this._entries();
        if (this.selected && !entries.some((row) => row.id === this.selected)) {
            this.selected = null;
        }
        this.highlight = this.scene.add.rectangle(0, 0, 10, 10, 0xe6c15a, 1).setOrigin(0, 0);
        this.left.add(this.highlight);
        this._opts = this._statOpts();
        let y = 0;
        let group = "";
        let stripeAt = 0;
        for (const entry of entries) {
            if (entry.group !== group) {
                group = entry.group;
                stripeAt = 0;
                const head = this._text(group, "#8a7a62", 12);
                const band = Math.max(Math.round(20 * m.s), head.height);
                head.setOrigin(0, 0.5);
                this.left.add(head);
                this._rows.push({ obj: head, y, pick: false, band });
                y += band;
            }
            const on = entry.id === this.selected;
            const color = on ? "#1a120c" : "#d4c4a8";
            const line = this._text(entry.label, color, 12);
            line.setOrigin(0, 0.5);
            line.setX(Math.round(8 * m.s));
            const value = this._text(this._statValue(entry), color, 12);
            value.setOrigin(1, 0.5);
            const band = Math.max(Math.round(20 * m.s), line.height, value.height);
            let stripe = null;
            if (stripeAt % 2 === 1) {
                stripe = this.scene.add.rectangle(0, y, 10, band, 0x262017, 1).setOrigin(0, 0);
                this.left.add(stripe);
            }
            stripeAt++;
            const choose = (p) => {
                if (p?.button && p.button !== 0) return;
                this.selected = entry.id;
                this.refresh();
            };
            const hit = this.scene.add.rectangle(0, y, 10, band, 0x000000, 0.001)
                .setOrigin(0, 0);
            hit.setInteractive({ useHandCursor: true });
            hit.on("pointerdown", choose);
            this.left.add(hit);
            this.left.add(line);
            this.left.add(value);
            this._rows.push({ obj: line, value, hit, stripe, band, y, pick: true, id: entry.id });
            y += band;
        }
        this.left.bringToTop(this.highlight);
        for (const row of this._rows) {
            if (row.obj) this.left.bringToTop(row.obj);
            if (row.value) this.left.bringToTop(row.value);
            if (row.hit) this.left.bringToTop(row.hit);
        }
        this._listH = y;
        const picked = entries.find((row) => row.id === this.selected);
        this._paintDetail(picked, m);
        this.layout();
    }

    layout() {
        if (!this.visible) return;
        const m = this._metrics();
        const sig = `${m.W}x${m.H}:${m.s}:${this.page}`;
        if (sig !== this._sizeSig) {
            this.refresh();
            return;
        }
        const scene = this.scene;
        this.dim.setSize(m.W, m.H);
        if (this.dim.input?.hitArea?.setSize) this.dim.input.hitArea.setSize(m.W, m.H);
        this.frame.setPosition(m.pad, m.pad).setSize(m.frameW, m.frameH);
        this.frame.setStrokeStyle(typeof pixelUiStroke === "function" ? pixelUiStroke(m.s) : 2, 0x2a2218);
        const headerY = m.pad + m.titleRow / 2;
        const name = this._title();
        this.title.setText(name);
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(this.title, 16, m.s);
        const shown = this._syncPortrait();
        const icon = Math.round(16 * m.s);
        const gap = Math.round(6 * m.s);
        let titleX = m.pad + Math.round(14 * m.s);
        if (shown) {
            this.portrait.setScale(m.s);
            this.portrait.setPosition(titleX + icon / 2, headerY);
            titleX += icon + gap;
        }
        this.title.setPosition(titleX, headerY);
        const closeW = Math.round(52 * m.s);
        const closeH = Math.round(22 * m.s);
        this.closeBtn.setPosition(m.pad + m.frameW - Math.round(40 * m.s), headerY);
        this._fitBtnHit(this.closeBtn, closeW, closeH);
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(this.closeBtn._txt, 12, m.s);
        const sp = !!scene._isSingleplayerSession?.();
        if (this.pauseBtn) {
            this.pauseBtn.setVisible(sp);
            this.pauseBtn._checked = !!this._pauseWhileOpen;
            const pauseSide = closeH;
            const pauseGap = Math.round(8 * m.s);
            this.pauseBtn.setPosition(
                this.closeBtn.x - closeW / 2 - pauseGap - pauseSide / 2,
                headerY
            );
            this._sizeCheckBtn(this.pauseBtn, pauseSide, pauseSide);
        }
        this._layoutTabs(m);
        const statsOn = this.page !== "bio";
        this.listBg.setVisible(statsOn);
        this.divider.setVisible(statsOn);
        this.left.setVisible(statsOn);
        this.right.setVisible(statsOn);
        this.bioRoot.setVisible(!statsOn);
        const top = m.pad + m.header;
        if (!statsOn) {
            this._layoutBioFrame(m, top);
            return;
        }
        const listH = Math.max(40, m.frameH - m.header - m.inset);
        this.listBg.setPosition(m.pad, top).setSize(m.listW, listH);
        if (this.listBg.input?.hitArea?.setSize) this.listBg.input.hitArea.setSize(m.listW, listH);
        this.divider.setPosition(m.pad + m.listW, top).setSize(m.div, listH);
        this.left.setPosition(m.pad + m.inset, top);
        this.right.setPosition(m.pad + m.listW + m.div + m.inset, top);
        this._viewH = listH;
        this._listInnerW = Math.max(8, m.listW - m.inset * 2);
        this._listBounds = { x: m.pad, y: top, w: m.listW, h: listH };
        const picked = this._rows.find((row) => row.id === this.selected);
        if (picked) {
            const rowH = picked.band || picked.obj?.height || 0;
            if (picked.y < this._scroll) this._scroll = picked.y;
            else if (picked.y + rowH > this._scroll + this._viewH) {
                this._scroll = picked.y + rowH - this._viewH;
            }
        }
        this._scroll = Math.max(0, Math.min(this._maxScroll(), this._scroll));
        this._maskGfx.clear();
        this._maskGfx.fillStyle(0xffffff, 1);
        this._maskGfx.fillRect(m.pad, top, m.listW, listH);
        this._detailMaskGfx.clear();
        this._detailMaskGfx.fillStyle(0xffffff, 1);
        this._detailMaskGfx.fillRect(
            m.pad + m.listW + m.div,
            top,
            Math.max(1, m.frameW - m.listW - m.div),
            listH
        );
        this._placeRows();
    }

    _metrics() {
        const s = this.scene.uiScale || 1;
        const W = this.scene.scale.width;
        const H = this.scene.scale.height;
        const pad = Math.round(18 * s);
        const frameW = Math.max(200, W - pad * 2);
        const frameH = Math.max(180, H - pad * 2);
        const titleRow = Math.round(36 * s);
        const tabH = Math.round(26 * s);
        const header = titleRow + tabH;
        const inset = Math.round(12 * s);
        const listW = Math.max(Math.round(220 * s), Math.round(frameW * 0.34));
        const div = Math.max(1, Math.round(2 * s));
        const detailW = Math.max(40, frameW - listW - div - inset * 2);
        return { s, W, H, pad, frameW, frameH, titleRow, tabH, header, inset, listW, div, detailW };
    }

    _maxScroll() {
        return Math.max(0, this._listH - this._viewH);
    }

    _placeRows() {
        let hi = null;
        const right = this._listInnerW || 10;
        const valueX = Math.max(0, right - Math.round(8 * (this.scene.uiScale || 1)));
        for (const row of this._rows) {
            const top = row.y - this._scroll;
            if (row.band) {
                const mid = top + row.band / 2;
                if (typeof placeUiText === "function") placeUiText(row.obj, row.obj.x, mid, 0, 0.5);
                else row.obj.setY(mid);
                if (row.value) {
                    if (typeof placeUiText === "function") placeUiText(row.value, valueX, mid, 1, 0.5);
                    else row.value.setPosition(valueX, mid);
                }
            } else {
                row.obj.setY(top);
            }
            if (row.hit) {
                row.hit.setPosition(0, top);
                row.hit.setSize(right, row.band || row.obj.height || 0);
            }
            if (row.stripe) {
                row.stripe.setPosition(0, top);
                row.stripe.setSize(right, row.band || 0);
            }
            if (row.id === this.selected) hi = row;
        }
        if (!this.highlight) return;
        if (!hi) {
            this.highlight.setVisible(false);
            return;
        }
        this.highlight.setVisible(true);
        this.highlight.setPosition(0, hi.y - this._scroll);
        this.highlight.setSize(right, hi.band || hi.obj.height || 0);
    }

    _syncPortrait() {
        const key = this._portraitKey();
        if (!key || !this.scene.textures?.exists(key)) {
            this.portrait?.setVisible(false);
            return false;
        }
        if (this.portrait.texture?.key !== key) this.portrait.setTexture(key, 1);
        else this.portrait.setFrame(1);
        try {
            this.scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
        } catch (_) { /* texture already filtered */ }
        this.portrait.setVisible(true);
        return true;
    }

    _portraitKey() {
        const scene = this.scene;
        const pawn = this.pawn;
        const direct = pawn?.texture?.key;
        if (direct && scene.textures?.exists(direct)) return direct;
        const look = pawn?.look || pawn?.bio?.look;
        if (look && typeof PlayerLook !== "undefined") {
            const baked = PlayerLook.ensure(scene, look);
            if (baked && scene.textures?.exists(baked)) return baked;
        }
        const corpse = scene.bioPanel?._selectedCorpse?.();
        const corpseKey = corpse?.texture?.key;
        if (corpseKey && scene.textures?.exists(corpseKey)) return corpseKey;
        if (scene.textures?.exists("human")) return "human";
        return null;
    }

    _title() {
        const p = this.pawn;
        const named = p?.displayName?.() || p?.pawnName || (typeof p?.name === "string" ? p.name : "");
        if (named) return named;
        const fromBio = this.scene.bioPanel?._pawnName?.();
        if (fromBio && fromBio !== "them") return fromBio;
        const corpseName = this.scene.bioPanel?._selectedCorpse?.()?.entry?.name;
        if (corpseName) return corpseName;
        return "Details";
    }

    /** Humans, and anyone who already has a bio record, get the Bio tab. */
    _hasBioTab() {
        const p = this.pawn;
        if (!p) return false;
        const plan = p.anatomy?.planId || p.bodyPlan || p.def?.bodyPlan || p.entry?.bodyPlan;
        if (plan === "human") return true;
        return !!p.bio;
    }

    _sheetName() {
        const titled = this._title();
        return titled && titled !== "Details" ? titled : "them";
    }

    _subjectBio() {
        return this.pawn?.bio || null;
    }

    _layoutTabs(m) {
        const s = m.s;
        const showBio = this._hasBioTab();
        this.tabBio.txt.setVisible(showBio);
        this.tabBio.hit.setVisible(showBio);
        if (this.tabBio.hit.input) this.tabBio.hit.input.enabled = showBio;
        const tabs = showBio ? [this.tabStats, this.tabBio] : [this.tabStats];
        const gap = Math.round(4 * s);
        const padX = Math.round(14 * s);
        const slack = Math.round(4 * s);
        const border = Math.max(1, Math.round(s));
        let x = m.pad + Math.round(12 * s);
        const baseY = m.pad + m.titleRow;
        const specs = [];
        for (const tab of tabs) {
            if (typeof applyPixelUiFont === "function") applyPixelUiFont(tab.txt, 12, s);
            const w = Math.max(Math.round(72 * s), Math.ceil(tab.txt.width) + padX * 2);
            const active = this.page === tab.id;
            const h = active ? m.tabH : Math.max(border * 3, m.tabH - slack);
            const y = baseY + (m.tabH - h);
            tab.hit.setPosition(x, y);
            tab.hit.setSize(w, h);
            if (tab.hit.input?.hitArea?.setSize) tab.hit.input.hitArea.setSize(w, h);
            else if (tab.hit.input?.hitArea?.setTo) tab.hit.input.hitArea.setTo(0, 0, w, h);
            tab.txt.setPosition(x + w / 2, baseY + m.tabH / 2);
            specs.push({
                id: tab.id,
                hit: tab.hit,
                txt: tab.txt,
                x, y, w, h,
                active,
                hover: !!tab.hit._hover
            });
            x += w + gap;
        }
        this._tabSpecs = specs;
        this._tabBaseline = { x: m.pad, y: m.pad + m.header - border, w: m.frameW };
        this._tabBorder = border;
        this._paintTabs();
    }

    _paintTabs() {
        const g = this.tabGfx;
        if (!g) return;
        g.clear();
        const border = this._tabBorder || 1;
        const base = this._tabBaseline;
        if (base) {
            g.fillStyle(0x2a2218, 1);
            g.fillRect(base.x, base.y, base.w, border);
        }
        const specs = this._tabSpecs || [];
        const draw = (spec) => {
            const hover = !!spec.hit?._hover;
            const fill = spec.active ? 0x120e0a : (hover ? 0x1a1510 : 0x0c0a08);
            g.fillStyle(fill, 1);
            g.fillRect(spec.x, spec.y, spec.w, spec.h);
            g.fillStyle(0x2a2218, 1);
            g.fillRect(spec.x, spec.y, spec.w, border);
            g.fillRect(spec.x, spec.y, border, spec.h);
            g.fillRect(spec.x + spec.w - border, spec.y, border, spec.h);
            if (!spec.active) g.fillRect(spec.x, spec.y + spec.h - border, spec.w, border);
            else if (base) {
                g.fillStyle(fill, 1);
                g.fillRect(spec.x + border, base.y, Math.max(1, spec.w - border * 2), border);
            }
            spec.txt?.setColor(spec.active ? "#f4f0e6" : (hover ? "#d4c4a8" : "#a89880"));
        };
        for (const spec of specs) if (!spec.active) draw(spec);
        for (const spec of specs) if (spec.active) draw(spec);
    }

    _refreshBio() {
        const bio = this._subjectBio();
        this._bioSig = this._bioStructSig(bio);
        this._bioProgress = this._bioProgressSig(bio);
        this._paintBio(bio);
    }

    /** Live skill XP while the Bio tab is open. A level or backstory change rebuilds the sheet. */
    syncBio() {
        if (!this.visible || this.page !== "bio") return;
        const bio = this._subjectBio();
        if (this._bioStructSig(bio) !== this._bioSig) {
            this._sizeSig = "";
            this.refresh();
            return;
        }
        const progress = this._bioProgressSig(bio);
        if (progress === this._bioProgress) return;
        this._bioProgress = progress;
        this._syncBioSkills(bio);
    }

    _bioStructSig(bio) {
        const S = typeof Skills !== "undefined" ? Skills : null;
        const parts = [this._sheetName(), this.scene.uiScale || 1];
        if (!bio || !S) return parts.join("|");
        parts.push(bio.gender, bio.age, bio.childhood, bio.adulthood, (bio.traits || []).join(","));
        for (const id of S.SKILL_IDS) parts.push(S.incapable(bio, id) ? "x" : ".");
        return parts.join("|");
    }

    _bioProgressSig(bio) {
        const S = typeof Skills !== "undefined" ? Skills : null;
        if (!bio || !S) return "";
        const parts = [];
        for (const id of S.SKILL_IDS) {
            const row = bio.skills?.[id];
            parts.push(
                Math.floor(Number(row?.level) || 0),
                Math.round(Number(row?.xp) || 0),
                Math.floor(Number(row?.passion) || 0)
            );
        }
        return parts.join(",");
    }

    _bioText(value, color, size) {
        const t = this._text(value, color, size);
        this.bioTexts.add(t);
        return t;
    }

    _bioTip(obj, tip) {
        if (!obj || !tip) return;
        obj.setInteractive({ useHandCursor: true });
        const read = typeof tip === "function" ? tip : () => tip;
        obj.on("pointerover", (p) => {
            const view = this._bioBounds;
            if (view && (p.x < view.x || p.x > view.x + view.w || p.y < view.y || p.y > view.y + view.h)) return;
            this.scene.showTooltip?.(() => read(), p.x, p.y, obj);
        });
        obj.on("pointerout", () => {
            if (this.scene._tooltipTarget === obj) this.scene.hideTooltip?.();
        });
        this._bioHits.push(obj);
    }

    _paintBio(bio) {
        if (this._bioHits.includes(this.scene._tooltipTarget)) this.scene.hideTooltip?.();
        this.bioTexts.removeAll(true);
        this.bioBars.clear();
        this._bioHits = [];
        const S = typeof Skills !== "undefined" ? Skills : null;
        const name = this._sheetName();
        const cat = S ? S.catalogs() : { backstories: [], traits: [] };
        const block = {
            meta: null,
            childLabel: null,
            childTitle: null,
            adultLabel: null,
            adultTitle: null,
            traitsHead: null,
            traits: [],
            incapHead: null,
            incaps: [],
            skills: []
        };
        this._bioBlock = block;
        if (!bio || !S) {
            block.meta = this._bioText("No record yet", "#8a8070", 12);
            return;
        }
        block.meta = this._bioText(`${S.genderLabel(bio.gender)}, age ${bio.age}`, "#f2ead8", 12);
        const child = S.titleOf(cat.backstories, bio.childhood);
        const adult = S.titleOf(cat.backstories, bio.adulthood);
        const childDef = (cat.backstories || []).find((row) => row.id === bio.childhood);
        const adultDef = (cat.backstories || []).find((row) => row.id === bio.adulthood);
        block.childLabel = this._bioText("Childhood", "#9a9186", 12);
        block.childTitle = this._bioText(child, "#f2ead8", 12);
        this._bioTip(block.childTitle, S.backstoryTip(childDef, name));
        block.adultLabel = this._bioText("Adulthood", "#9a9186", 12);
        block.adultTitle = this._bioText(adult, "#f2ead8", 12);
        this._bioTip(block.adultTitle, S.backstoryTip(adultDef, name));
        block.traitsHead = this._bioText("Traits", "#d4c45a", 12);
        const traits = Array.isArray(bio.traits) ? bio.traits : [];
        if (!traits.length) {
            block.traits.push(this._bioText("None", "#8a8478", 12));
        } else {
            for (const id of traits) {
                const def = (cat.traits || []).find((row) => row.id === id);
                const line = this._bioText(def?.title || "Unknown", "#f2ead8", 12);
                this._bioTip(line, def ? S.traitTip(def, name) : "Unknown");
                block.traits.push(line);
            }
        }
        const incapable = S.SKILL_IDS.filter((id) => S.incapable(bio, id));
        block.incapHead = this._bioText("Incapable of", "#d4c45a", 12);
        if (!incapable.length) {
            block.incaps.push(this._bioText("None", "#8a8478", 12));
        } else {
            for (const id of incapable) {
                const line = this._bioText(S.labelOf(id), "#8a8478", 12);
                this._bioTip(line, S.incapableTip(bio, id));
                block.incaps.push(line);
            }
        }
        for (const id of S.SKILL_IDS) {
            const off = S.incapable(bio, id);
            const level = S.effectiveLevel(bio, id);
            const row = bio.skills?.[id] || { level: 0, xp: 0, passion: 0 };
            const label = this._bioText(S.labelOf(id), off ? "#6a6058" : "#ffffff", 12);
            const num = off ? null : this._bioText(String(level), "#ffffff", 12);
            const trained = Math.max(0, Math.floor(Number(row.level) || 0));
            const xp = off ? 0 : Math.max(0, Number(row.xp) || 0);
            const skill = {
                label,
                num,
                tip: S.skillTip(bio, id),
                passion: off ? 0 : S.passionOf(bio, id),
                xp,
                trained,
                shown: off ? 0 : level,
                frac: off || level == null ? 0 : S.levelProgress(level, trained, xp),
                off,
                hit: null
            };
            block.skills.push(skill);
        }
    }

    _syncBioSkills(bio) {
        const S = typeof Skills !== "undefined" ? Skills : null;
        const skills = this._bioBlock?.skills || [];
        if (!S || !bio) return;
        let i = 0;
        for (const id of S.SKILL_IDS) {
            const row = skills[i++];
            if (!row) break;
            const off = S.incapable(bio, id);
            const level = S.effectiveLevel(bio, id);
            const stored = bio.skills?.[id] || { level: 0, xp: 0, passion: 0 };
            const trained = Math.max(0, Math.floor(Number(stored.level) || 0));
            const xp = off ? 0 : Math.max(0, Number(stored.xp) || 0);
            row.tip = S.skillTip(bio, id);
            row.passion = off ? 0 : S.passionOf(bio, id);
            row.xp = xp;
            row.trained = trained;
            row.shown = off ? 0 : level;
            row.frac = off || level == null ? 0 : S.levelProgress(level, trained, xp);
            row.off = off;
            if (row.num && level != null) row.num.setText(String(level));
        }
        this._placeBio();
        const target = this.scene._tooltipTarget;
        if (target && skills.some((row) => row.hit === target)) this.scene.refreshTooltip?.();
    }

    _layoutBioFrame(m, top) {
        const h = Math.max(40, m.frameH - m.header - m.inset);
        const w = Math.max(40, m.frameW - m.inset * 2);
        const x = m.pad + m.inset;
        this.bioRoot.setPosition(x, top);
        this._bioViewH = h;
        this._bioViewW = w;
        this._bioBounds = { x, y: top, w, h };
        this._bioScroll = Math.max(0, Math.min(this._maxBioScroll(), this._bioScroll));
        this._bioMaskGfx.clear();
        this._bioMaskGfx.fillStyle(0xffffff, 1);
        this._bioMaskGfx.fillRect(x, top, w, h);
        this._placeBio();
    }

    _maxBioScroll() {
        return Math.max(0, (this._bioH || 0) - (this._bioViewH || 0));
    }

    _placeBio() {
        const s = this.scene.uiScale || 1;
        const b = this._bioBlock;
        if (!b) return;
        const viewW = this._bioViewW || 200;
        const margin = Math.round(14 * s);
        const gap = Math.round(6 * s);
        const sectionGap = Math.round(14 * s);
        const indent = Math.round(10 * s);
        const colGap = Math.round(28 * s);
        const labelW = Math.max(b.childLabel?.width || 0, b.adultLabel?.width || 0);
        const valueGap = Math.round(12 * s);
        const maxLeft = Math.min(
            Math.round(320 * s),
            Math.max(Math.round(160 * s), Math.floor(viewW * 0.5) - colGap)
        );
        const valueWrap = Math.max(40, maxLeft - labelW - valueGap);
        const lineWrap = Math.max(40, maxLeft - indent);
        if (b.childTitle) b.childTitle.setWordWrapWidth(valueWrap);
        if (b.adultTitle) b.adultTitle.setWordWrapWidth(valueWrap);
        for (const line of b.traits || []) line.setWordWrapWidth(lineWrap);
        for (const line of b.incaps || []) line.setWordWrapWidth(lineWrap);
        if (b.meta) b.meta.setWordWrapWidth(Math.max(40, maxLeft));

        const leftW = Math.max(
            b.meta?.width || 0,
            b.childLabel ? labelW + valueGap + (b.childTitle?.width || 0) : 0,
            b.adultLabel ? labelW + valueGap + (b.adultTitle?.width || 0) : 0,
            b.traitsHead?.width || 0,
            ...(b.traits || []).map((t) => indent + (t.width || 0)),
            b.incapHead?.width || 0,
            ...(b.incaps || []).map((t) => indent + (t.width || 0))
        );

        let localY = 0;
        const metaY = localY;
        if (b.meta) {
            localY += b.meta.height;
            if (b.childLabel || b.traitsHead || b.incapHead || (b.skills || []).length) localY += sectionGap;
        }
        const colTop = localY;
        const childY = localY;
        if (b.childLabel) localY += Math.max(b.childLabel.height, b.childTitle?.height || 0) + gap;
        const adultY = localY;
        if (b.adultLabel) localY += Math.max(b.adultLabel.height, b.adultTitle?.height || 0) + sectionGap;
        const traitTops = [];
        const traitsHeadY = localY;
        if (b.traitsHead) localY += b.traitsHead.height + gap;
        for (const line of b.traits || []) {
            traitTops.push(localY);
            localY += line.height + gap;
        }
        if (b.traitsHead) localY += sectionGap - gap;
        const incapHeadY = localY;
        if (b.incapHead) localY += b.incapHead.height + gap;
        const incapTops = [];
        for (const line of b.incaps || []) {
            incapTops.push(localY);
            localY += line.height + gap;
        }
        const leftEnd = localY;

        const skills = b.skills || [];
        const fontPx = typeof pixelUiFontSize === "function" ? pixelUiFontSize(12, s) : Math.round(12 * s);
        const barH = Math.max(fontPx, skills.reduce((n, row) => Math.max(n, row.label?.height || 0), 0));
        const rowH = barH + Math.max(2, Math.round(2 * s)) + Math.round(8 * s);
        const nameW = skills.reduce((n, row) => Math.max(n, row.label?.width || 0), 0);
        const numW = skills.reduce((n, row) => Math.max(n, row.num?.width || fontPx), 0);
        const starR = Math.max(3, Math.round(4 * s));
        const starGap = Math.round(starR * 2 + 2 * s);
        const starSlot = starGap * 2;
        const skillsBlockW = nameW + Math.round(8 * s) + starSlot + numW;
        const beside = !skills.length || margin + leftW + colGap + skillsBlockW <= viewW - margin;
        const skillXLocal = beside ? leftW + colGap : 0;
        const originY = beside ? colTop : leftEnd + (leftEnd > 0 ? sectionGap : 0);
        const barPad = Math.max(2, Math.round(2 * s));
        const contentLeft = skills.length ? Math.min(0, skillXLocal - barPad) : 0;
        const contentH = Math.max(leftEnd, skills.length ? originY + skills.length * rowH : originY);
        const shiftX = margin - contentLeft;
        const oy = margin - (this._bioScroll || 0);
        const valueX = shiftX + labelW + valueGap;

        if (b.meta) b.meta.setPosition(shiftX, metaY + oy);
        if (b.childLabel) {
            b.childLabel.setPosition(shiftX, childY + oy);
            b.childTitle?.setPosition(valueX, childY + oy);
        }
        if (b.adultLabel) {
            b.adultLabel.setPosition(shiftX, adultY + oy);
            b.adultTitle?.setPosition(valueX, adultY + oy);
        }
        if (b.traitsHead) b.traitsHead.setPosition(shiftX, traitsHeadY + oy);
        (b.traits || []).forEach((line, i) => line.setPosition(shiftX + indent, traitTops[i] + oy));
        if (b.incapHead) b.incapHead.setPosition(shiftX, incapHeadY + oy);
        (b.incaps || []).forEach((line, i) => line.setPosition(shiftX + indent, incapTops[i] + oy));

        this.bioBars.clear();
        const skillX = shiftX + skillXLocal;
        skills.forEach((row, i) => {
            const sy = originY + i * rowH + oy;
            row.label.setPosition(skillX, sy);
            const barW = Math.max(8, nameW) + barPad * 2;
            const barX = skillX - barPad;
            const barY = sy - barPad;
            const numRight = skillX + nameW + Math.round(8 * s) + starSlot + numW;
            if (row.num) {
                row.num.setPosition(numRight - row.num.width, sy);
                this.bioBars.fillStyle(0x2a2a2a, 1);
                this.bioBars.fillRect(barX, barY, barW, barH + barPad * 2);
                this.bioBars.fillStyle(0x5a5a5a, 1);
                this.bioBars.fillRect(barX, barY, Math.max(0, Math.round(barW * (row.frac || 0))), barH + barPad * 2);
                const starBase = numRight - numW - Math.round(4 * s);
                for (let n = 0; n < (row.passion || 0); n++) {
                    this._bioStar(starBase - starR - n * starGap, sy + fontPx / 2, starR);
                }
            }
            const lineW = Math.max(barW, (row.num ? numRight : skillX + nameW) - barX);
            const hitY = row.num ? barY : sy;
            const hitH = row.num ? barH + barPad * 2 : barH;
            let hit = row.hit?.active ? row.hit : null;
            if (!hit) {
                hit = this.scene.add.rectangle(0, 0, lineW, hitH, 0x000000, 0.001).setOrigin(0, 0);
                this.bioTexts.add(hit);
                row.hit = hit;
                this._bioTip(hit, () => row.tip);
            }
            hit.setPosition(barX, hitY);
            hit.setSize(lineW, hitH);
            if (hit.input?.hitArea?.setSize) hit.input.hitArea.setSize(lineW, hitH);
            else if (hit.input?.hitArea?.setTo) hit.input.hitArea.setTo(0, 0, lineW, hitH);
        });
        this._bioH = contentH + margin;
        const clamped = Math.max(0, Math.min(this._maxBioScroll(), this._bioScroll));
        if (clamped !== this._bioScroll) {
            this._bioScroll = clamped;
            this._placeBio();
        }
    }

    _bioStar(x, y, r) {
        const pts = [];
        for (let i = 0; i < 10; i++) {
            const a = -Math.PI / 2 + i * Math.PI / 5;
            const rad = i % 2 === 0 ? r : r * 0.42;
            pts.push(new Phaser.Geom.Point(x + Math.cos(a) * rad, y + Math.sin(a) * rad));
        }
        this.bioBars.fillStyle(0xe6c15a, 1);
        this.bioBars.fillPoints(pts, true);
    }

    _entries() {
        const S = typeof Skills !== "undefined" ? Skills : null;
        const rows = [];
        const caps = this._caps();
        const body = [
            ["consciousness", "Consciousness"],
            ["moving", "Moving"],
            ["manipulation", "Manipulation"],
            ["pain", "Pain"],
            ["breathing", "Breathing"],
            ["bloodPumping", "Blood pumping"],
            ["bloodFiltration", "Blood filtration"],
            ["digestion", "Digestion"],
            ["sight", "Sight"],
            ["hearing", "Hearing"],
            ["talking", "Talking"],
            ["eating", "Eating"],
            ["bloodLoss", "Blood loss"]
        ];
        const catalog = S?.STAT_ROWS || [];
        for (const row of catalog) {
            if (row.group === "Combat") rows.push(row);
        }
        for (const [id, label] of body) {
            rows.push({ group: "Body", id: `cap:${id}`, label, cap: id });
        }
        for (const row of catalog) {
            if (row.group === "Body") rows.push(row);
        }
        for (const row of catalog) {
            if (row.group === "Hunger" || row.group === "Work") rows.push(row);
        }
        if (!caps) return catalog.slice();
        return rows;
    }

    _caps() {
        const body = this.pawn?.anatomy;
        if (!body || typeof Capacities === "undefined") return null;
        return this.pawn.capacities || new Capacities(body);
    }

    _statOpts() {
        const S = typeof Skills !== "undefined" ? Skills : null;
        const opts = S?.workOpts?.(this.scene, this.pawn) || {};
        if (typeof BodyCombat !== "undefined") {
            const attacks = BodyCombat.collectAttacks?.(this.pawn) || [];
            opts.attacks = attacks.map((a) => ({
                name: a.name,
                damage: a.damage,
                cooldown: a.cooldown,
                weightMultiplier: a.def?.weightMultiplier
            }));
        }
        return opts;
    }

    _statValue(entry) {
        if (!entry) return "";
        if (entry.cap) {
            const value = this._caps()?.[entry.cap]?.();
            return Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 1000) / 10}%` : "—";
        }
        const S = typeof Skills !== "undefined" ? Skills : null;
        return S?.describeStat?.(this.pawn, entry.id, this._opts || this._statOpts())?.valueText || "";
    }

    _paintDetail(entry, m) {
        const s = m?.s || this.scene.uiScale || 1;
        const wrap = m?.detailW || 320;
        const topGap = Math.round(14 * s);
        if (!entry) {
            const prompt = this._text("Click a stat to see more details", "#f4f0e6", 16);
            prompt.setWordWrapWidth(wrap);
            prompt.setPosition(0, topGap);
            this.right.add(prompt);
            this._detail.push(prompt);
            return;
        }
        const title = this._text(entry.label, "#f4f0e6", 16);
        title.setPosition(0, topGap);
        this.right.add(title);
        this._detail.push(title);
        let y = topGap + title.height + Math.round(10 * s);
        if (entry.cap) {
            const shown = this._statValue(entry);
            const caps = this._caps();
            const sentence = this._text("How this part of the body is working.", "#8a7a62", 12);
            sentence.setWordWrapWidth(wrap);
            sentence.setPosition(0, y);
            this.right.add(sentence);
            this._detail.push(sentence);
            y += sentence.height + Math.round(10 * s);
            const lines = caps?.explain?.(entry.cap) || [];
            for (const line of lines) {
                const t = this._text(line, "#d4c4a8", 12);
                t.setWordWrapWidth(wrap);
                t.setPosition(0, y);
                this.right.add(t);
                this._detail.push(t);
                y += t.height + Math.round(3 * s);
            }
            y += Math.round(12 * s);
            const fin = this._text(shown, "#f4f0e6", 16);
            fin.setPosition(0, y);
            this.right.add(fin);
            this._detail.push(fin);
            return;
        }
        const S = typeof Skills !== "undefined" ? Skills : null;
        const opts = this._opts || this._statOpts();
        const report = S?.describeStat?.(this.pawn, entry.id, opts);
        const sentence = this._text(report?.sentence || "", "#8a7a62", 12);
        sentence.setWordWrapWidth(wrap);
        sentence.setPosition(0, y);
        this.right.add(sentence);
        this._detail.push(sentence);
        y += sentence.height + Math.round(10 * s);
        for (const line of report?.lines || []) {
            if (line.blank) {
                y += Math.round(16 * s);
                continue;
            }
            const t = this._text(`${line.label}: ${line.value}`, "#d4c4a8", 12);
            t.setWordWrapWidth(wrap);
            t.setPosition(0, y);
            this.right.add(t);
            this._detail.push(t);
            y += t.height + Math.round(3 * s);
        }
        if (report?.rangeTable) return;
        y += Math.round(12 * s);
        const fin = this._text(report?.valueText || "", "#f4f0e6", 16);
        fin.setPosition(0, y);
        this.right.add(fin);
        this._detail.push(fin);
    }

    _text(value, color, size) {
        const s = this.scene.uiScale || 1;
        const font = typeof pixelUiFontSize === "function" ? pixelUiFontSize(size, s) : Math.round(size * s);
        const t = this.scene.add.text(0, 0, value, {
            fontFamily: typeof PIXEL_UI_FONT !== "undefined" ? PIXEL_UI_FONT : "monospace",
            fontSize: `${font}px`,
            color: color || "#d4c4a8"
        }).setOrigin(0, 0);
        if (typeof crispUiText === "function") crispUiText(t);
        return t;
    }

    _clear(container) {
        container.removeAll(true);
    }

    _togglePause() {
        if (!this.scene._isSingleplayerSession?.()) return;
        this._pauseWhileOpen = !this._pauseWhileOpen;
        if (this.pauseBtn) {
            this.pauseBtn._checked = this._pauseWhileOpen;
            this.pauseBtn._paint?.();
        }
        this._syncPause();
    }

    _syncPause() {
        const scene = this.scene;
        const should = !!(
            this.visible
            && this._pauseWhileOpen
            && scene._isSingleplayerSession?.()
        );
        if (!should && scene.researchTreePanel?.visible && scene.researchTreePanel._pauseWhileOpen) return;
        if (!should && scene.schedulePanel?.visible && scene.schedulePanel._pauseWhileOpen) return;
        if (!should && scene.resourceSummaryPanel?.visible && scene.resourceSummaryPanel._pauseWhileOpen) return;
        scene._setWorldSimFrozen?.(should);
    }

    _btn(label, onClick) {
        const scene = this.scene;
        const bg = scene.add.rectangle(0, 0, 52, 22, 0x120e0a, 1)
            .setInteractive({ useHandCursor: true });
        const txt = scene.add.text(0, 0, label, {
            fontFamily: typeof PIXEL_UI_FONT !== "undefined" ? PIXEL_UI_FONT : "monospace",
            fontSize: "14px",
            color: "#d4c4a8"
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
        bg.on("pointerover", () => { c._hovering = true; paint(); });
        bg.on("pointerout", () => {
            c._hovering = false;
            c._pressing = false;
            paint();
        });
        bg.on("pointerdown", (p) => {
            if (p?.button && p.button !== 0) return;
            c._pressing = true;
            paint();
        });
        bg.on("pointerup", (p) => {
            const was = c._pressing;
            c._pressing = false;
            paint();
            if (was) onClick?.(p);
        });
        paint();
        return c;
    }

    _sizeCheckBtn(c, w, h) {
        if (!c) return;
        c._w = w;
        c._h = h;
        c._bg.setSize(w, h);
        if (c._bg.input?.hitArea?.setSize) c._bg.input.hitArea.setSize(w, h);
        else if (c._bg.input?.hitArea?.setTo) c._bg.input.hitArea.setTo(0, 0, w, h);
        c._paint?.();
    }

    _fitBtnHit(btn, w, h) {
        const bg = btn?._bg;
        if (!bg) return;
        bg.setSize(w, h);
        if (bg.input?.hitArea?.setSize) bg.input.hitArea.setSize(w, h);
        else if (bg.input?.hitArea?.setTo) bg.input.hitArea.setTo(0, 0, w, h);
    }

}
