/**
 * Camp Assign screen: combat, care, gear policies, food, and medicine carry.
 */
class AssignPanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.settle = null;
        this._pauseWhileOpen = false;
        this._scroll = 0;
        this._contentH = 0;
        this._maxScroll = 0;
        this._menu = null;
        this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(16100).setVisible(false);
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
        this.title = scene.add.text(0, 0, "Assign", {
            fontFamily: PIXEL_UI_FONT, fontSize: "16px", color: "#d4c4a8"
        }).setOrigin(0, 0.5);
        this.closeBtn = this._chrome("Close", () => this.close());
        this.pauseBtn = makePauseGameButton(scene, () => {
            this._pauseWhileOpen = !this._pauseWhileOpen;
            this.pauseBtn._checked = this._pauseWhileOpen;
            this.pauseBtn._paint?.();
            this._syncPause();
        }, false);
        this.body = scene.add.container(0, 0);
        this.menu = scene.add.container(0, 0);
        this._maskGfx = scene.make.graphics({ x: 0, y: 0, add: false });
        this.body.setMask(new Phaser.Display.Masks.BitmapMask(scene, this._maskGfx));
        this.root.add([this.dim, this.frame, this.title, this.pauseBtn, this.closeBtn, this.body, this.menu]);
        this._bindWheel();
    }

    _chrome(label, onClick) {
        return this._button(0, 0, 64, 22, label, onClick);
    }

    open(settle) {
        if (!settle) return;
        this.settle = settle;
        this.visible = true;
        this._scroll = 0;
        this.root.setVisible(true);
        const panel = this.scene.settlementPanel;
        if (panel?.root) panel.root.setVisible(false);
        this.layout();
        this.refresh();
        this._syncPause();
    }

    close(opts = {}) {
        const restore = opts.restore !== false;
        this.visible = false;
        this.settle = null;
        this.root.setVisible(false);
        this._closeMenu();
        this.scene.hideTooltip?.();
        this._syncPause();
        const panel = this.scene.settlementPanel;
        if (restore && panel?.visible && panel.settle) {
            panel.root.setVisible(true);
            panel.layout();
        }
    }

    handleEsc() {
        if (!this.visible) return false;
        if (this._menu) {
            this._closeMenu();
            return true;
        }
        this.close();
        return true;
    }

    containsPointer(pointer) {
        if (!this.visible || this.root?.visible === false || !pointer || !this.frame) return false;
        const b = this.frame.getBounds();
        return pointer.x >= b.x && pointer.x <= b.right && pointer.y >= b.y && pointer.y <= b.bottom;
    }

    hoverObjAt(pointer) {
        if (!pointer || !this.visible || this.root?.visible === false) return null;
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

    _syncPause() {
        const scene = this.scene;
        const should = !!(this.visible && this._pauseWhileOpen && scene._isSingleplayerSession?.());
        if (!should && scene.researchTreePanel?.visible && scene.researchTreePanel._pauseWhileOpen) return;
        if (!should && scene.schedulePanel?.visible && scene.schedulePanel._pauseWhileOpen) return;
        if (!should && scene.policyPanel?.visible) return;
        scene._setWorldSimFrozen?.(should);
    }

    layout() {
        const scene = this.scene;
        const s = scene.uiScale || 1;
        const W = scene.scale.width;
        const H = scene.scale.height;
        const margin = Math.round(16 * s);
        const pad = Math.round(12 * s);
        const titleH = Math.round(36 * s);
        const gap = Math.round(8 * s);
        const bottom = Math.round(12 * s);
        this.dim.setSize(W, H);
        if (this.dim.input?.hitArea?.setSize) this.dim.input.hitArea.setSize(W, H);
        const cellS = Math.round(20 * s);
        const scheduleW = pad + Math.round(56 * s) + cellS * 24 + Math.round(4 * s) + Math.max(4, Math.round(5 * s)) + pad;
        const box = Math.round(22 * s);
        const colGap = Math.round(6 * s);
        const armor = this._armorLayout(s, box);
        const numW = Math.max(this._textWidth("20", 12) + Math.round(10 * s), box);
        const countW = box + numW;
        const nameMin = Math.round(88 * s);
        const weaponMin = box + colGap + Math.round(72 * s);
        const foodMin = Math.round(72 * s);
        const edge = Math.max(4, Math.round((typeof pixelUiStroke === "function" ? pixelUiStroke(s) : 2) + 2));
        const contentNeed = edge * 2 + box * 2 + nameMin + weaponMin + countW * 2 + armor.w + foodMin + colGap * 7;
        const w = Math.max(1, Math.min(W - margin * 2, Math.max(scheduleW, pad * 2 + contentNeed)));
        const people = this.visible ? this._people().length : 0;
        const rowH = Math.round(22 * s) + Math.round(12 * s);
        const headH = Math.round(18 * s);
        const bodyTop = titleH + gap;
        const rowsH = people ? rowH * people : Math.round(28 * s);
        const h = Math.max(1, Math.min(H - margin * 2, bodyTop + headH + rowsH + bottom));
        const x = Math.round(Math.max(margin, (W - w) / 2));
        const y = Math.round(Math.max(margin, (H - h) / 2));
        this.frame.setPosition(x, y).setSize(w, h);
        if (this.frame.input?.hitArea?.setSize) this.frame.input.hitArea.setSize(w, h);
        this._font(this.title, 16);
        this._font(this.closeBtn._txt, 12);
        const closeW = Math.max(Math.round(64 * s), Math.ceil((this.closeBtn._txt.width || 48) + 16 * s));
        const closeH = Math.round(22 * s);
        this.closeBtn._bg.setSize(closeW, closeH);
        if (this.closeBtn._bg.input?.hitArea?.setSize) {
            this.closeBtn._bg.input.hitArea.setSize(closeW, closeH);
        }
        this.title.setPosition(x + pad, y + titleH / 2);
        this.closeBtn.setPosition(x + w - pad - closeW / 2, y + titleH / 2);
        const pause = closeH;
        this.pauseBtn.setPosition(this.closeBtn.x - closeW / 2 - Math.round(8 * s) - pause / 2, y + titleH / 2);
        this.pauseBtn._w = pause;
        this.pauseBtn._h = pause;
        this.pauseBtn._bg.setSize(pause, pause);
        if (this.pauseBtn._bg.input?.hitArea?.setSize) this.pauseBtn._bg.input.hitArea.setSize(pause, pause);
        this.pauseBtn._checked = !!this._pauseWhileOpen;
        this.pauseBtn._paint?.();
        this._bodyX = x + pad;
        this._bodyY = y + bodyTop;
        this._bodyW = w - pad * 2;
        this._bodyH = h - bodyTop - bottom;
        const clip = Math.max(2, Math.round(typeof pixelUiStroke === "function" ? pixelUiStroke(s) : 2));
        this._maskGfx.clear();
        this._maskGfx.fillStyle(0xffffff);
        this._maskGfx.fillRect(
            this._bodyX - clip,
            this._bodyY - clip,
            this._bodyW + clip * 2,
            this._bodyH + clip * 2
        );
        this._sig = null;
        if (this.visible) this.refresh();
    }

    _font(obj, px) {
        if (!obj) return;
        const s = this.scene.uiScale || 1;
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(obj, px, s);
        else obj.setFontSize(`${Math.round(px * s)}px`);
    }

    _textWidth(label, px) {
        if (!this._probe || !this._probe.scene) {
            this._probe = this.scene.add.text(0, 0, "", {
                fontFamily: PIXEL_UI_FONT,
                fontSize: "8px"
            }).setVisible(false);
        }
        this._font(this._probe, px);
        this._probe.setText(String(label || ""));
        return Math.ceil(this._probe.width || 0);
    }

    _fitText(txt, maxW) {
        this._font(txt, 12);
        const width = Math.ceil(txt.width || 0);
        if (width > maxW && width > 0) txt.setScale(maxW / width);
        else txt.setScale(1);
    }

    _armorColumns() {
        // Head, torso, legs, feet, back, plus the two waist slots a garment can grant.
        let n = 7;
        for (const pawn of (this.visible ? this._people() : [])) {
            const waist = pawn?.equipment?.waist;
            const count = 5 + (Array.isArray(waist) ? waist.length : 0);
            if (count > n) n = count;
        }
        return n;
    }

    _armorLayout(s, box) {
        const slots = this._armorColumns();
        const iconGap = Math.round(2 * s);
        const iconsW = slots * box + Math.max(0, slots - 1) * iconGap;
        const btnW = Math.round(80 * s);
        const gap = Math.round(6 * s);
        return { slots, iconGap, iconsW, btnW, w: iconsW + gap + btnW, gap };
    }

    _metrics() {
        const s = this.scene.uiScale || 1;
        const gap = Math.round(6 * s);
        const edge = Math.max(4, Math.round((typeof pixelUiStroke === "function" ? pixelUiStroke(s) : 2) + 2));
        let box = Math.round(22 * s);
        const numW = Math.max(this._textWidth("20", 12) + Math.round(10 * s), Math.round(22 * s));
        let countW = box + numW;
        const inner = Math.max(1, (this._bodyW || 0) - edge * 2);
        const gaps = gap * 7;
        const armor = this._armorLayout(s, box);
        const natural = box * 2 + countW * 2 + armor.w + gaps;
        if (natural > inner) {
            const fit = inner / natural;
            box = Math.max(8, Math.floor(box * fit));
            countW = Math.max(box + 8, Math.floor(countW * fit));
        }
        const armorFit = this._armorLayout(s, box);
        const fixed = box * 2 + countW * 2 + armorFit.w;
        const flex = Math.max(0, inner - fixed - gaps);
        const weights = { name: 1.3, weapon: 1.6, food: 1.1 };
        const sum = Object.values(weights).reduce((n, w) => n + w, 0);
        const share = (k) => Math.floor(flex * weights[k] / sum);
        const cols = {};
        let x = edge;
        const put = (key, w) => {
            cols[key] = { x, w };
            x += w + gap;
        };
        put("combat", box);
        put("care", box);
        put("name", share("name"));
        const weaponW = share("weapon");
        const weaponGap = Math.min(Math.round(4 * s), Math.max(0, weaponW - box));
        const iconSlot = Math.min(box, Math.max(0, weaponW - weaponGap));
        cols.weapon = {
            x,
            w: weaponW,
            iconX: x,
            btnX: x + iconSlot + (iconSlot && weaponW > iconSlot ? weaponGap : 0),
            btnW: Math.max(1, weaponW - iconSlot - (iconSlot && weaponW > iconSlot ? weaponGap : 0))
        };
        x += weaponW + gap;
        put("arrows", countW);
        cols.armor = {
            x,
            w: armorFit.w,
            iconsX: x,
            iconsW: armorFit.iconsW,
            iconGap: armorFit.iconGap,
            slots: armorFit.slots,
            btnX: x + armorFit.iconsW + gap,
            btnW: armorFit.btnW
        };
        x += armorFit.w + gap;
        put("food", share("food") + Math.max(0, flex - share("name") - share("weapon") - share("food")));
        put("carry", countW);
        const overflow = (cols.carry.x + cols.carry.w) - (edge + inner);
        if (overflow > 0) cols.carry.w = Math.max(8, cols.carry.w - overflow);
        return {
            s,
            gap,
            box,
            cols,
            btnH: box,
            icon: box,
            portrait: box,
            armorSlots: armorFit.slots,
            rowH: box + Math.round(10 * s),
            headH: Math.round(18 * s)
        };
    }

    _people() {
        const list = this.scene.settlementSys?.settlersOf?.(this.settle?.id) || [];
        return list.filter((p) => p && !p.dead && p.role !== "companion" && p.role !== "player");
    }

    _assign(pawn) {
        const P = this._P();
        if (!P) return null;
        const id = pawn.pawnId || pawn.id;
        return P.resolveAssign(this.settle?.assigns?.[id], this.settle?.policies);
    }

    _write(pawn, patch, opts = {}) {
        const P = this._P();
        if (!P || !this.settle || !pawn) return;
        if (!this.settle.assigns) this.settle.assigns = {};
        const id = String(pawn.pawnId || pawn.id || "");
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const prev = this.settle.assigns?.[id] || pawn.assign || {};
        const next = S?.setAssign
            ? S.setAssign(this.settle, id, { ...prev, ...patch })
            : P.resolveAssign({ ...prev, ...patch }, this.settle.policies);
        if (!S?.setAssign) this.settle.assigns[id] = next;
        if (S?.rememberAssign) S.rememberAssign(pawn, next);
        else pawn.assign = { ...next };
        this.scene.settlementSys?.bumpWorkCache?.();
        this.scene.settlementSys?.sendNet?.("setAssign", {
            settlementId: this.settle.id,
            pawnId: id,
            assign: next
        });
        if (!opts.keepMenu) this.refresh();
    }

    _item(id) {
        return (typeof DataStore !== "undefined" && DataStore.itemsById?.[id]) || null;
    }

    _tex(key) {
        if (!key || !this.scene.textures.exists(key)) return null;
        try { this.scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST); } catch (_) { /* already set */ }
        return key;
    }

    _stackTex(stack) {
        if (!stack?.id) return null;
        const scene = this.scene;
        const meta = scene.getItem?.(stack.id) || this._item(stack.id) || { id: stack.id, key: stack.id };
        if (typeof carriedStackIconKey === "function") {
            const key = this._tex(carriedStackIconKey(scene, stack, meta));
            if (key) return key;
        }
        return this._tex(meta.key) || this._tex(stack.id);
    }

    _itemTex(id) {
        // No blade yet. The tip is diorite, the same default as a blade knap.
        if (id === "arrow" && typeof ensureArrowTexture === "function") {
            const stone = (typeof Stone !== "undefined" && Stone.iconStone)
                ? Stone.iconStone("arrow")
                : "diorite";
            const key = this._tex(ensureArrowTexture(this.scene, stone));
            if (key) return key;
        }
        return this._stackTex({ id });
    }

    _isWeapon(stack) {
        if (!stack?.id) return false;
        const def = this.scene.getItem?.(stack.id) || this._item(stack.id);
        return !!(def?.weapon);
    }

    _shownWeapon(pawn) {
        const slots = pawn?.inventory || [];
        if (this._isWeapon(slots[0])) return slots[0];
        const held = slots[pawn?.hotbarIndex];
        if (this._isWeapon(held)) return held;
        return null;
    }

    _icon(stack, x, y, size) {
        const key = this._stackTex(stack);
        if (!key) return null;
        return this.scene.add.image(x, y, key).setOrigin(0, 0.5).setDisplaySize(size, size);
    }

    _signature() {
        const people = this._people();
        const bits = [];
        for (const pawn of people) {
            const id = pawn.pawnId || pawn.id;
            const assign = this.settle?.assigns?.[id] || {};
            const worn = pawn.equipment || {};
            const pieces = [worn.head, worn.torso, worn.legs, worn.feet, worn.back]
                .concat(worn.waist || [])
                .map((s) => s?.id || "")
                .join(",");
            const pose = this._portraitPose(pawn);
            bits.push([
                id,
                pawn.displayName?.() || pawn.name || "",
                pawn.inventory?.[0]?.id || "",
                pieces,
                assign.weaponPolicyId,
                assign.armorPolicyId,
                assign.foodPolicyId,
                assign.combat,
                assign.care,
                assign.medicineCount,
                assign.medicineType,
                assign.arrowCount,
                pose?.key || "",
                pose?.frame ?? "",
                pose?.rotation || 0
            ].join(":"));
        }
        const names = ["weapon", "armor", "food"].map((kind) => (
            (this.settle?.policies?.[kind] || []).map((p) => `${p.id}=${p.name}`).join(",")
        ));
        return `${bits.join("|")}|${names.join("|")}|${Math.round(this._bodyW)}|${this.scene.uiScale || 1}`;
    }

    refresh() {
        if (!this.visible || this.root?.visible === false) return;
        // A gear change in the same frame as a slider release used to rebuild
        // the rows and drop the popup. Leave it up until it is closed on purpose.
        if (this._sliderTrack) return;
        const sig = this._signature();
        if (sig === this._sig) return;
        this._sig = sig;
        this.body.removeAll(true);
        this._closeMenu();
        const P = this._P();
        const people = this._people();
        const m = this._metrics();
        const heads = [
            ["name", "Name"],
            ["weapon", "Weapon"],
            ["arrows", "Arrows"],
            ["armor", "Armor"],
            ["food", "Food"],
            ["carry", "Carry"]
        ];
        let y = 0;
        for (const [key, label] of heads) {
            if (!label) continue;
            const txt = this.scene.add.text(m.cols[key].x, y, label, {
                fontFamily: PIXEL_UI_FONT, fontSize: "12px", color: "#e6c15a"
            }).setOrigin(0, 0);
            this._font(txt, 12);
            this.body.add(txt);
        }
        y += m.headH;
        if (!people.length) {
            const empty = this.scene.add.text(0, y, "No settlers at this camp.", {
                fontFamily: PIXEL_UI_FONT, fontSize: "13px", color: "#8a7a62"
            });
            this._font(empty, 13);
            this.body.add(empty);
        }
        for (const pawn of people) {
            const assign = this._assign(pawn) || {};
            this._row(pawn, assign, y, m, P);
            y += m.rowH;
        }
        this._contentH = y;
        this._maxScroll = Math.max(0, y - this._bodyH);
        this._scroll = Math.max(0, Math.min(this._scroll, this._maxScroll));
        this.body.setPosition(this._bodyX, this._bodyY - this._scroll);
    }

    /**
     * Standing sheet, facing down, including while asleep.
     * Only someone who cannot walk is turned: right-facing frame, 90° counter-clockwise.
     */
    _portraitPose(pawn) {
        const key = this._standingTexKey(pawn);
        if (!key) return null;
        if (!this._portraitLaying(pawn)) {
            return { key, frame: this._sheetFrame(key, 1, 0), rotation: 0 };
        }
        if (typeof ensureLyingTexture === "function") {
            const baked = ensureLyingTexture(this.scene, key, 3, 7);
            if (baked && this.scene.textures.exists(baked)) {
                return { key: baked, frame: null, rotation: 0 };
            }
        }
        return { key, frame: this._sheetFrame(key, 7, 1), rotation: -Math.PI / 2 };
    }

    /**
     * Incapable of Moving: the Moving capacity at or below 15%.
     * Sleep, pain shock, and the bed's prone flag do not count.
     */
    _portraitLaying(pawn) {
        if (!pawn || pawn.dead || pawn.isBodyDead?.()) return false;
        const cap = pawn.capacities;
        if (typeof cap?.isImmobile === "function") return !!cap.isImmobile();
        if (typeof cap?.moving === "function") {
            const moving = Number(cap.moving());
            return Number.isFinite(moving) && moving <= 0.15;
        }
        return !!pawn.isImmobile?.();
    }

    _standingTexKey(pawn) {
        const scene = this.scene;
        if (!pawn || !scene?.textures?.exists) return null;
        let key = pawn.texture?.key || "";
        const bakedLie = typeof key === "string" && key.includes("__lieq");
        if ((pawn._lieTexKey && key === pawn._lieTexKey) || bakedLie) {
            const src = pawn._lieSrcKey;
            if (src && scene.textures.exists(src)) key = src;
            else if (bakedLie) {
                const cut = key.indexOf("__lieq");
                const stripped = cut > 0 ? key.slice(0, cut) : "";
                if (stripped && scene.textures.exists(stripped)) key = stripped;
            }
        }
        const look = pawn.look || pawn.bio?.look;
        if ((!key || !scene.textures.exists(key)) && look && typeof PlayerLook !== "undefined") {
            key = PlayerLook.ensure(scene, look, { body: pawn.anatomy || pawn.body || null });
        }
        if (!key || !scene.textures.exists(key)) return null;
        return key;
    }

    _sheetFrame(key, prefer, fallback) {
        const tex = this.scene.textures.get?.(key);
        if (!tex?.has) return prefer;
        if (tex.has(prefer) || tex.has(String(prefer))) return prefer;
        if (tex.has(fallback) || tex.has(String(fallback))) return fallback;
        return 0;
    }

    _row(pawn, assign, y, m, P) {
        const scene = this.scene;
        const mid = y + m.rowH / 2;
        const btnY = mid - m.btnH / 2;
        const cols = m.cols;
        const combatTip = P?.COMBAT_LABEL?.[assign.combat] || "Fight";
        this.body.add(this._iconButton(cols.combat.x, btnY, m.box, m.box, {
            tex: assign.combat || "fight",
            tip: combatTip
        }, () => this._openCombatMenu(pawn, assign, cols.combat.x, btnY + m.box)));
        this.body.add(this._iconButton(cols.care.x, btnY, m.box, m.box, this._careSpec(assign.care), () => {
            this._openCareMenu(pawn, assign, cols.care.x, btnY + m.box);
        }));
        const pose = this._portraitPose(pawn);
        const portraitW = pose ? m.portrait + Math.round(6 * m.s) : 0;
        if (pose) {
            const img = (pose.frame == null
                ? scene.add.image(cols.name.x + m.portrait / 2, mid, pose.key)
                : scene.add.image(cols.name.x + m.portrait / 2, mid, pose.key, pose.frame)
            ).setDisplaySize(m.portrait, m.portrait).setOrigin(0.5, 0.5);
            if (pose.rotation) img.setRotation(pose.rotation);
            try { scene.textures.get(pose.key).setFilter(Phaser.Textures.FilterMode.NEAREST); } catch (_) { /* already set */ }
            this.body.add(img);
        }
        const name = scene.add.text(cols.name.x + portraitW, mid, String(pawn.displayName?.() || pawn.name || "?"), {
            fontFamily: PIXEL_UI_FONT, color: "#d4c4a8"
        }).setOrigin(0, 0.5);
        this._fitText(name, Math.max(8, cols.name.w - portraitW));
        this.body.add(name);

        const weapon = this._shownWeapon(pawn);
        if (weapon) {
            const icon = this._icon(weapon, cols.weapon.iconX, mid, m.icon);
            if (icon) this.body.add(icon);
        }
        const wPolicy = P?.policyById(this.settle?.policies?.weapon, assign.weaponPolicyId);
        this.body.add(this._button(cols.weapon.btnX, btnY, cols.weapon.btnW, m.btnH, wPolicy?.name || "Anything", () => {
            this._openPolicyMenu(pawn, "weapon", assign.weaponPolicyId, cols.weapon.btnX, btnY + m.btnH, cols.weapon.btnW);
        }));
        const arrows = assign.arrowCount ?? 20;
        const arrowBtn = this._iconButton(cols.arrows.x, btnY, cols.arrows.w, m.box, {
            item: "arrow",
            label: String(arrows),
            tip: `Arrows ${arrows}`
        }, () => this._openSlider(pawn, cols.arrows.x, btnY + m.box, {
            title: "Arrows",
            item: "arrow",
            min: 0,
            max: P?.ARROW_MAX ?? 20,
            value: arrows,
            field: "arrowCount",
            countLabel: arrowBtn._count
        }));
        this.body.add(arrowBtn);

        let ax = cols.armor.iconsX;
        const step = m.icon + (cols.armor.iconGap || Math.round(2 * m.s));
        const eq = pawn.equipment || {};
        const worn = [eq.head, eq.torso, eq.legs, eq.feet, eq.back].concat(eq.waist || []);
        const slots = cols.armor.slots || worn.length;
        for (let i = 0; i < slots; i++) {
            const piece = worn[i];
            if (!piece?.id) continue;
            const icon = this._icon(piece, ax + i * step, mid, m.icon);
            if (icon) this.body.add(icon);
        }
        const aPolicy = P?.policyById(this.settle?.policies?.armor, assign.armorPolicyId);
        this.body.add(this._button(cols.armor.btnX, btnY, cols.armor.btnW, m.btnH, aPolicy?.name || "Anything", () => {
            this._openPolicyMenu(pawn, "armor", assign.armorPolicyId, cols.armor.btnX, btnY + m.btnH, cols.armor.btnW);
        }));

        const fPolicy = P?.policyById(this.settle?.policies?.food, assign.foodPolicyId);
        this.body.add(this._button(cols.food.x, btnY, cols.food.w, m.btnH, fPolicy?.name || "Anything", () => {
            this._openPolicyMenu(pawn, "food", assign.foodPolicyId, cols.food.x, btnY + m.btnH, cols.food.w);
        }));

        const medN = assign.medicineCount ?? 0;
        const medTip = `${P?.MEDICINE_LABEL?.[assign.medicineType] || "Any"} × ${medN}`;
        const carryBtn = this._iconButton(cols.carry.x, btnY, cols.carry.w, m.box, {
            ...this._medicineSpec(assign.medicineType),
            label: String(medN),
            tip: medTip
        }, () => this._openCarryMenu(pawn, assign, cols.carry.x, btnY + m.box, {
            countLabel: carryBtn._count
        }));
        this.body.add(carryBtn);
    }

    _bestCareName() {
        return this._item("poultice")?.name || "Poultice";
    }

    _careSpec(care) {
        if (care === "none") return { mark: "x", tip: "No medicine" };
        if (care === "leaf") return { item: "leaf_cord", tip: "Leaf cord" };
        return { item: "poultice", tip: this._bestCareName() };
    }

    _medicineSpec(type) {
        if (type === "leaf_cord") return { item: "leaf_cord" };
        if (type === "poultice") return { item: "poultice" };
        return { items: ["leaf_cord", "poultice"] };
    }

    _iconButton(x, y, w, h, spec, onClick) {
        const scene = this.scene;
        const bg = scene.add.rectangle(0, 0, w, h, 0x120e0a, 1)
            .setInteractive({ useHandCursor: true, cursor: "pointer" });
        const c = scene.add.container(x + w / 2, y + h / 2, [bg]);
        c._bg = bg;
        c._hovering = false;
        c._pressing = false;
        c._selected = !!spec?.selected;
        const inset = Math.max(2, Math.round(((typeof pixelUiStroke === "function" ? pixelUiStroke(scene.uiScale || 1) : 2) / 2) + 1));
        const iconSize = Math.max(4, Math.min(Math.round(h * 0.72), h - inset * 2, w - inset * 2));
        const addImg = (key, ix) => {
            const tex = this._tex(key);
            if (!tex) return;
            c.add(scene.add.image(ix, 0, tex).setDisplaySize(iconSize, iconSize));
        };
        if (spec?.label != null) {
            const face = spec.tex || spec.item;
            const iconX = -w / 2 + inset + iconSize / 2;
            if (face) addImg(spec.tex || this._itemTex(spec.item), iconX);
            else if (spec.items) {
                const a = this._itemTex(spec.items[0]);
                const b = this._itemTex(spec.items[1]);
                const step = Math.max(2, Math.round(iconSize * 0.45));
                if (a) addImg(a, iconX);
                if (b) addImg(b, iconX + step);
            }
            const num = scene.add.text(w / 2 - inset, 0, String(spec.label), {
                fontFamily: PIXEL_UI_FONT, color: "#d4c4a8"
            }).setOrigin(1, 0.5);
            num._fitMax = Math.max(8, w - iconSize - inset * 3);
            this._font(num, 12);
            this._fitText(num, num._fitMax);
            c.add(num);
            c._count = num;
        } else if (spec?.tex) {
            addImg(spec.tex, 0);
        } else if (spec?.item) {
            addImg(this._itemTex(spec.item), 0);
        } else if (spec?.items) {
            const a = this._itemTex(spec.items[0]);
            const b = this._itemTex(spec.items[1]);
            if (a) addImg(a, -iconSize * 0.28);
            if (b) addImg(b, iconSize * 0.28);
        } else if (spec?.mark === "x") {
            const mark = scene.add.text(0, 0, "×", {
                fontFamily: PIXEL_UI_FONT, color: "#e15d5d"
            }).setOrigin(0.5);
            this._font(mark, 16);
            c.add(mark);
        }
        const paint = () => {
            const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(scene.uiScale || 1) : 2;
            if (c._pressing || c._selected) {
                bg.setFillStyle(c._pressing ? 0x0a0806 : 0x120e0a, 1);
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
        bg.on("pointerover", (p) => {
            c._hovering = true;
            paint();
            if (spec?.tip) scene.showTooltip?.(() => spec.tip, p.x, p.y, bg);
        });
        bg.on("pointerout", (pointer) => {
            const b = bg.getBounds?.();
            if (b && pointer && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y)) return;
            c._hovering = false;
            c._pressing = false;
            paint();
            if (scene._tooltipTarget === bg) scene.hideTooltip?.();
        });
        bg.on("pointerdown", (p, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (p?.rightButtonDown?.() || p?.button === 2) return;
            c._pressing = true;
            paint();
        });
        bg.on("pointerup", (p, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = c._pressing && c._hovering;
            c._pressing = false;
            paint();
            if (!was || (p?.button && p.button !== 0)) return;
            onClick?.();
        });
        paint();
        return c;
    }

    _menuAt(x, y) {
        this._closeMenu();
        const menu = this.scene.add.container(this._bodyX + x, this._bodyY - this._scroll + y + Math.round(4 * (this.scene.uiScale || 1)));
        this.menu.add(menu);
        this._menu = menu;
        return menu;
    }

    _pawnKey(pawn) {
        return String(pawn?.pawnId || pawn?.id || "");
    }

    _sameMenu(kind, pawn) {
        return this._menuKind === kind && this._menuPawn === this._pawnKey(pawn);
    }

    _rememberMenu(kind, pawn) {
        this._menuKind = kind;
        this._menuPawn = this._pawnKey(pawn);
    }

    _openCombatMenu(pawn, assign, x, y) {
        if (this._sameMenu("combat", pawn)) {
            this._closeMenu();
            return;
        }
        const menu = this._menuAt(x, y);
        const s = this.scene.uiScale || 1;
        const rowH = Math.round(24 * s);
        const rowW = Math.round(88 * s);
        const options = [
            { id: "fight", tex: "fight", label: "Fight" },
            { id: "neutral", tex: "neutral", label: "Neutral" },
            { id: "flee", tex: "flee", label: "Flee" }
        ];
        this._popupBack(menu, rowW, options.length * rowH, false);
        options.forEach((opt, i) => {
            menu.add(this._choiceRow(0, i * rowH, rowW, rowH, opt, assign.combat === opt.id, () => {
                this._write(pawn, { combat: opt.id });
            }, true));
        });
        this._rowDividers(menu, rowW, rowH, options.length);
        this._popupStroke(menu, rowW, options.length * rowH);
        this._rememberMenu("combat", pawn);
    }

    _openCareMenu(pawn, assign, x, y) {
        if (this._sameMenu("care", pawn)) {
            this._closeMenu();
            return;
        }
        const menu = this._menuAt(x, y);
        const s = this.scene.uiScale || 1;
        const rowH = Math.round(24 * s);
        const rowW = Math.round(110 * s);
        const options = [
            { id: "none", mark: "x", label: "None" },
            { id: "leaf", item: "leaf_cord", label: "Leaf cord" },
            { id: "best", item: "poultice", label: this._bestCareName() }
        ];
        this._popupBack(menu, rowW, options.length * rowH, false);
        options.forEach((opt, i) => {
            menu.add(this._choiceRow(0, i * rowH, rowW, rowH, opt, assign.care === opt.id, () => {
                this._write(pawn, { care: opt.id });
            }, true));
        });
        this._rowDividers(menu, rowW, rowH, options.length);
        this._popupStroke(menu, rowW, options.length * rowH);
        this._rememberMenu("care", pawn);
    }

    _artCenterShift(key) {
        if (!key) return 0;
        if (!this._artShift) this._artShift = Object.create(null);
        if (key in this._artShift) return this._artShift[key];
        let shift = 0;
        try {
            const tex = this.scene.textures.get(key);
            const src = tex?.getSourceImage?.() || tex?.source?.[0]?.image;
            const w = src?.width || 0;
            const h = src?.height || 0;
            if (w && h && typeof document !== "undefined") {
                const canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext("2d", { willReadFrequently: true });
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(src, 0, 0);
                const data = ctx.getImageData(0, 0, w, h).data;
                let minY = h;
                let maxY = -1;
                for (let py = 0; py < h; py++) {
                    for (let px = 0; px < w; px++) {
                        if (data[(py * w + px) * 4 + 3] < 20) continue;
                        if (py < minY) minY = py;
                        if (py > maxY) maxY = py;
                    }
                }
                if (maxY >= 0) shift = (minY + maxY + 1) / 2 - h / 2;
            }
        } catch (_) { shift = 0; }
        this._artShift[key] = shift;
        return shift;
    }

    _choiceRow(x, y, w, h, spec, selected, onClick, framed) {
        const scene = this.scene;
        const bg = scene.add.rectangle(0, 0, w, h, 0x120e0a, 1)
            .setInteractive({ useHandCursor: true, cursor: "pointer" });
        const c = scene.add.container(x + w / 2, y + h / 2, [bg]);
        c._bg = bg;
        c._hovering = false;
        c._selected = !!selected;
        const icon = Math.round(h * 0.7);
        const lift = Math.round(scene.uiScale || 1);
        const placeIcon = (key, ix, size) => {
            const frame = scene.textures.get(key).get();
            const frameH = frame?.height || size;
            const art = this._artCenterShift(key) * (size / frameH);
            c.add(scene.add.image(ix, Math.round(-lift - art), key).setDisplaySize(size, size));
        };
        const tex = spec.tex || (spec.item ? this._itemTex(spec.item) : null);
        if (spec.items) {
            const a = this._itemTex(spec.items[0]);
            const b = this._itemTex(spec.items[1]);
            if (a) placeIcon(a, -w / 2 + h * 0.38, icon * 0.8);
            if (b) placeIcon(b, -w / 2 + h * 0.72, icon * 0.8);
        } else if (tex && this._tex(tex)) {
            placeIcon(tex, -w / 2 + h * 0.55, icon);
        } else if (spec.mark === "x") {
            const mark = scene.add.text(0, 0, "×", {
                fontFamily: PIXEL_UI_FONT, color: "#e15d5d"
            });
            this._font(mark, 14);
            const cx = -w / 2 + h * 0.55;
            if (typeof placeUiTextInkCentered === "function") placeUiTextInkCentered(mark, cx, -lift);
            else mark.setOrigin(0.5).setPosition(cx, -lift);
            c.add(mark);
        }
        const label = scene.add.text(-w / 2 + h + Math.round(4 * (scene.uiScale || 1)), 0, spec.label, {
            fontFamily: PIXEL_UI_FONT, color: "#d4c4a8"
        }).setOrigin(0, 0.5);
        this._fitText(label, w - h - Math.round(8 * (scene.uiScale || 1)));
        c.add(label);
        const sw0 = typeof pixelUiStroke === "function" ? pixelUiStroke(scene.uiScale || 1) : 2;
        const outline = framed
            ? scene.add.rectangle(0, 0, Math.max(1, w - sw0 * 2), Math.max(1, h - sw0 * 2), 0x000000, 0).setVisible(false)
            : null;
        if (outline) c.add(outline);
        const paint = () => {
            const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(scene.uiScale || 1) : 2;
            const hot = c._pressing || c._selected;
            bg.setFillStyle(c._pressing ? 0x0a0806 : 0x120e0a, 1);
            if (outline) {
                const show = hot || c._hovering;
                outline.setVisible(show);
                if (show) outline.setStrokeStyle(sw, hot ? 0xd4a84b : 0xffffff);
            } else if (hot) {
                bg.setStrokeStyle(sw, 0xd4a84b);
            } else if (c._hovering) {
                bg.setStrokeStyle(sw, 0xffffff);
            } else {
                bg.setStrokeStyle(sw, 0x2a2218);
            }
        };
        bg.on("pointerover", () => { c._hovering = true; paint(); });
        bg.on("pointerout", () => { c._hovering = false; c._pressing = false; paint(); });
        bg.on("pointerdown", (p, _a, _b, ev) => {
            ev?.stopPropagation?.();
            if (p?.button === 2) return;
            c._pressing = true;
            paint();
        });
        bg.on("pointerup", (p, _a, _b, ev) => {
            ev?.stopPropagation?.();
            const was = c._pressing;
            c._pressing = false;
            paint();
            if (was && !(p?.button && p.button !== 0)) onClick?.();
        });
        paint();
        return c;
    }

    _openCarryMenu(pawn, assign, x, y, opts = {}) {
        if (!opts.reopen && this._sameMenu("carry", pawn)) {
            this._closeMenu();
            return;
        }
        const P = this._P();
        const menu = this._menuAt(x, y);
        const s = this.scene.uiScale || 1;
        const rowH = Math.round(24 * s);
        const rowW = Math.round(120 * s);
        const types = [
            { id: "any", items: ["leaf_cord", "poultice"], label: "Any" },
            { id: "leaf_cord", item: "leaf_cord", label: "Leaf cord" },
            { id: "poultice", item: "poultice", label: "Poultice" }
        ];
        const sliderY = types.length * rowH + Math.round(6 * s);
        const sliderH = Math.round(22 * s);
        const menuH = sliderY + sliderH + Math.round(4 * s);
        this._popupBack(menu, rowW, menuH, false);
        types.forEach((opt, i) => {
            menu.add(this._choiceRow(0, i * rowH, rowW, rowH, opt, assign.medicineType === opt.id, () => {
                this._write(pawn, { medicineType: opt.id }, { keepMenu: true });
                assign.medicineType = opt.id;
                this._openCarryMenu(pawn, assign, x, y, { reopen: true, countLabel: opts.countLabel });
            }, true));
        });
        this._rowDividers(menu, rowW, rowH, types.length);
        this._addSlider(menu, pawn, 0, sliderY, rowW, {
            min: 0,
            max: P?.MEDICINE_MAX ?? 5,
            value: assign.medicineCount ?? 0,
            field: "medicineCount",
            countLabel: opts.countLabel
        });
        this._popupStroke(menu, rowW, menuH);
        this._rememberMenu("carry", pawn);
    }

    _openSlider(pawn, x, y, spec) {
        const kind = spec.menuKind || spec.field || "slider";
        if (this._sameMenu(kind, pawn)) {
            this._closeMenu();
            return;
        }
        const menu = this._menuAt(x, y);
        const s = this.scene.uiScale || 1;
        const w = Math.round(140 * s);
        const titleY = Math.round(4 * s);
        const sliderY = Math.round(20 * s);
        const h = sliderY + Math.round(22 * s) + Math.round(4 * s);
        this._popupBack(menu, w, h);
        const title = this.scene.add.text(Math.round(6 * s), titleY, spec.title, {
            fontFamily: PIXEL_UI_FONT, color: "#e6c15a"
        }).setOrigin(0, 0);
        this._font(title, 12);
        menu.add(title);
        this._addSlider(menu, pawn, 0, sliderY, w, spec);
        this._rememberMenu(kind, pawn);
    }

    _popupBack(menu, w, h, stroke = true) {
        const scene = this.scene;
        const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(scene.uiScale || 1) : 2;
        const bg = scene.add.rectangle(0, 0, w, h, 0x120e0a, 1)
            .setOrigin(0, 0)
            .setInteractive();
        if (stroke) bg.setStrokeStyle(sw, 0x2a2218);
        menu.add(bg);
        return bg;
    }

    _popupStroke(menu, w, h) {
        const scene = this.scene;
        const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(scene.uiScale || 1) : 2;
        const border = scene.add.rectangle(0, 0, w, h, 0x000000, 0)
            .setOrigin(0, 0)
            .setStrokeStyle(sw, 0x2a2218);
        menu.add(border);
        return border;
    }

    _rowDividers(menu, w, rowH, count) {
        const scene = this.scene;
        const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(scene.uiScale || 1) : 2;
        for (let i = 1; i < count; i++) {
            menu.add(scene.add.rectangle(0, i * rowH, w, Math.max(1, sw), 0x2a2218, 1).setOrigin(0, 0.5));
        }
    }

    _addSlider(menu, pawn, x, y, w, spec) {
        const scene = this.scene;
        const s = scene.uiScale || 1;
        const h = Math.round(22 * s);
        const pad = Math.round(8 * s);
        const numW = Math.round(22 * s);
        const trackW = Math.max(8, w - pad * 2 - numW);
        const track = scene.add.rectangle(x + pad, y + h / 2, trackW, Math.max(4, Math.round(4 * s)), 0x3a3228, 1)
            .setOrigin(0, 0.5);
        const hit = scene.add.rectangle(x + pad, y + h / 2, trackW, h, 0x000000, 0.001)
            .setOrigin(0, 0.5)
            .setInteractive({ useHandCursor: true, cursor: "pointer" });
        const handleW = Math.max(6, Math.round(6 * s));
        const handle = scene.add.rectangle(0, y + h / 2, handleW, h - Math.round(4 * s), 0xd4c4a8, 1)
            .setOrigin(0.5, 0.5);
        const num = scene.add.text(x + w - pad, y + h / 2, String(spec.value), {
            fontFamily: PIXEL_UI_FONT, color: "#d4c4a8"
        }).setOrigin(1, 0.5);
        this._font(num, 12);
        menu.add([track, handle, hit, num]);
        const place = (value) => {
            const t = spec.max === spec.min ? 0 : (value - spec.min) / (spec.max - spec.min);
            handle.setPosition(track.x + t * trackW, y + h / 2);
            num.setText(String(value));
            const label = spec.countLabel;
            if (label?.active) {
                label.setText(String(value));
                if (label._fitMax) this._fitText(label, label._fitMax);
            }
        };
        place(spec.value);
        const valueAt = (pointer) => {
            const bounds = hit.getBounds();
            const span = bounds.width || trackW;
            const t = Math.max(0, Math.min(1, (pointer.x - bounds.left) / span));
            return spec.min + Math.round(t * (spec.max - spec.min));
        };
        hit.on("pointerdown", (p, _a, _b, ev) => {
            ev?.stopPropagation?.();
            const value = valueAt(p);
            place(value);
            this._slider = { pawn, field: spec.field, value, place };
        });
        hit.on("pointerup", (_p, _a, _b, ev) => {
            ev?.stopPropagation?.();
        });
        this._sliderTrack = { pawn, field: spec.field, valueAt, place, menu };
    }

    _button(x, y, w, h, label, onClick, framed, checked) {
        const scene = this.scene;
        const s = scene.uiScale || 1;
        const bg = scene.add.rectangle(0, 0, w, h, 0x120e0a, 1)
            .setInteractive({ useHandCursor: true, cursor: "pointer" });
        const txt = scene.add.text(0, 0, String(label), {
            fontFamily: PIXEL_UI_FONT, color: checked ? "#e6c15a" : "#d4c4a8"
        }).setOrigin(0.5);
        this._fitText(txt, Math.max(8, w - Math.round(8 * s)));
        const c = scene.add.container(x + w / 2, y + h / 2, [bg, txt]);
        c._bg = bg;
        c._txt = txt;
        c._hovering = false;
        c._pressing = false;
        const sw0 = typeof pixelUiStroke === "function" ? pixelUiStroke(scene.uiScale || 1) : 2;
        const outline = framed
            ? scene.add.rectangle(0, 0, Math.max(1, w - sw0 * 2), Math.max(1, h - sw0 * 2), 0x000000, 0).setVisible(false)
            : null;
        if (outline) c.add(outline);
        const paint = () => {
            const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(scene.uiScale || 1) : 2;
            if (outline) {
                bg.setFillStyle(c._pressing ? 0x0a0806 : 0x120e0a, 1);
                const show = c._pressing || c._hovering;
                outline.setVisible(show);
                if (show) outline.setStrokeStyle(sw, c._pressing ? 0xd4a84b : 0xffffff);
                return;
            }
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
        bg.on("pointerout", () => { c._hovering = false; c._pressing = false; paint(); });
        bg.on("pointerdown", (p, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (p?.rightButtonDown?.() || p?.button === 2) return;
            c._pressing = true;
            paint();
        });
        bg.on("pointerup", (p, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = c._pressing && c._hovering;
            c._pressing = false;
            paint();
            if (!was || (p?.button && p.button !== 0)) return;
            onClick?.();
        });
        paint();
        return c;
    }

    _openPolicyMenu(pawn, kind, currentId, x, y, width) {
        if (this._sameMenu(kind, pawn)) {
            this._closeMenu();
            return;
        }
        const P = this._P();
        const list = this.settle?.policies?.[kind] || [];
        const s = this.scene.uiScale || 1;
        const rowH = Math.round(24 * s);
        const menuW = Math.max(Math.round(140 * s), width || 0);
        const menu = this._menuAt(x, y);
        const count = list.length + 1;
        this._popupBack(menu, menuW, count * rowH, false);
        let row = 0;
        const add = (label, fn) => {
            menu.add(this._button(0, row * rowH, menuW, rowH, label, fn, true));
            row++;
        };
        const key = kind === "weapon" ? "weaponPolicyId" : kind === "armor" ? "armorPolicyId" : "foodPolicyId";
        for (const policy of list) {
            const selected = policy.id === currentId;
            menu.add(this._button(0, row * rowH, menuW, rowH, policy.name, () => {
                this._write(pawn, { [key]: policy.id });
            }, true, selected));
            row++;
        }
        add("Edit policy...", () => {
            this._closeMenu();
            this.scene.policyPanel?.open?.(this.settle, kind, currentId);
        });
        this._rowDividers(menu, menuW, rowH, count);
        this._popupStroke(menu, menuW, count * rowH);
        this.menu.add(menu);
        this._menu = menu;
        this._rememberMenu(kind, pawn);
    }

    _closeMenu() {
        const drag = this._slider;
        this._slider = null;
        this._sliderTrack = null;
        this._menuKind = null;
        this._menuPawn = null;
        this.menu?.removeAll?.(true);
        this._menu = null;
        const tip = this.scene._tooltipTarget;
        const pointer = this.scene.input?.activePointer;
        const tipBounds = tip?.active ? tip.getBounds?.() : null;
        const keepTip = !!(tipBounds && pointer && Phaser.Geom.Rectangle.Contains(tipBounds, pointer.x, pointer.y));
        if (!keepTip) this.scene.hideTooltip?.();
        if (drag) this._write(drag.pawn, { [drag.field]: drag.value }, { keepMenu: true });
    }

    _bindWheel() {
        this.scene.input.on("wheel", (pointer, _o, _dx, dy) => {
            if (!this.visible || !this.containsPointer(pointer)) return;
            this._scroll = Math.max(0, Math.min(this._maxScroll, this._scroll + Math.sign(dy) * 28));
            this.body.setPosition(this._bodyX, this._bodyY - this._scroll);
            this._closeMenu();
        });
        this.scene.input.on("pointermove", (pointer) => {
            const drag = this._slider;
            if (!drag || !pointer?.isDown || !this._sliderTrack) return;
            const value = this._sliderTrack.valueAt(pointer);
            drag.value = value;
            drag.place(value);
        });
        this.scene.input.on("pointerup", () => {
            const drag = this._slider;
            if (!drag) return;
            this._slider = null;
            this._write(drag.pawn, { [drag.field]: drag.value }, { keepMenu: true });
            this._sig = this._signature();
        });
    }
}
