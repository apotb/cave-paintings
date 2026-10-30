/**
 * Bio of the controlled pawn, a settler selected from the world, or the open corpse.
 * Left-anchored like Equipment. Wanderers stay on their hover tip.
 */
class BioPanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this._sig = "";
        this.container = scene.add.container(0, 0).setVisible(false).setDepth(50);
        scene.uiLayer.add(this.container);
        this.bg = scene.add.graphics();
        this.bg.setInteractive(new Phaser.Geom.Rectangle(0, 0, 8, 8), Phaser.Geom.Rectangle.Contains);
        this.container.add(this.bg);
        this.bars = scene.add.graphics();
        this.container.add(this.bars);
        this.texts = scene.add.container(0, 0);
        this.container.add(this.texts);
        this.bootBtn = scene.add.image(0, 0, "boot").setOrigin(0.5, 0.5).setVisible(false);
        if (typeof lockPixelHit === "function") lockPixelHit(this.bootBtn, "boot", { useHandCursor: true });
        else this.bootBtn.setInteractive({ useHandCursor: true });
        this.bootBtn.on("pointerover", (p) => {
            if (!this._bootPressed) this.bootBtn.setTexture("boot_hover");
            const name = this._pawnName();
            this.scene.showTooltip?.(() => `Banish ${name}`, p.x, p.y, this.bootBtn);
        });
        this.bootBtn.on("pointerout", () => {
            if (!this._bootPressed) this.bootBtn.setTexture("boot");
            if (this.scene._tooltipTarget === this.bootBtn) this.scene.hideTooltip?.();
        });
        this.bootBtn.on("pointerdown", (pointer) => {
            if (pointer?.button != null && pointer.button !== 0) return;
            this._bootPressed = true;
            this.bootBtn.setTexture("boot_open");
            this._askBanish();
        });
        const releaseBoot = () => this._releaseBootPress();
        scene.input.on("pointerup", releaseBoot);
        scene.input.on("pointerupoutside", releaseBoot);
        window.addEventListener("pointerup", releaseBoot, true);
        window.addEventListener("pointercancel", releaseBoot, true);
        scene.events.once("shutdown", () => {
            scene.input?.off("pointerup", releaseBoot);
            scene.input?.off("pointerupoutside", releaseBoot);
            window.removeEventListener("pointerup", releaseBoot, true);
            window.removeEventListener("pointercancel", releaseBoot, true);
        });
        this.container.add(this.bootBtn);
        this._bootPressed = false;
        this.infoBtn = scene.add.image(0, 0, "info").setOrigin(0.5, 0.5).setVisible(false);
        if (typeof lockPixelHit === "function") lockPixelHit(this.infoBtn, "info", { useHandCursor: true });
        else this.infoBtn.setInteractive({ useHandCursor: true });
        this.infoBtn.on("pointerover", () => {
            if (!this.scene.statsPanel?.visible) this.infoBtn.setTexture("info_hover");
        });
        this.infoBtn.on("pointerout", () => this._paintInfo());
        this.infoBtn.on("pointerdown", (pointer) => {
            if (pointer?.button != null && pointer.button !== 0) return;
            pointer?.event?.stopPropagation?.();
            this.scene.statsPanel?.toggle?.(this._subject());
            this._paintInfo();
        });
        this.container.add(this.infoBtn);
        this._showInfo = false;
        this._rows = [];
        this._bounds = new Phaser.Geom.Rectangle(0, 0, 8, 8);
    }

    toggle() {
        if (this.visible) this.close();
        else this.open();
    }

    open() {
        if (this.scene.knappingPanel?.visible || this.scene.clayFormingPanel?.visible) return;
        if (typeof isHudTextOpen === "function" && isHudTextOpen(this.scene)) return;
        const scene = this.scene;
        const keep = !!scene.focusPawn;
        if (keep) scene._retainFocus = true;
        try {
            if (scene.craftMenuVisible) scene.closeCraftMenu();
            if (scene.equipmentPanel?.visible) scene.equipmentPanel.close();
            if (scene.healthPanel?.visible) scene.healthPanel.close();
            if (scene.settlementPanel?.visible) scene.settlementSys?.closePanel?.();
        } finally {
            if (keep) scene._retainFocus = false;
        }
        this.visible = true;
        this.container.setVisible(true);
        this._sig = "";
        this.refresh();
        this.layout();
        this.scene.bioBtn?.setTexture("bio_open");
    }

    close() {
        const viewingCorpse = !!this._viewingCorpse || !!this._pinnedCorpse;
        this._viewingCorpse = null;
        this._pinnedCorpse = null;
        this.visible = false;
        this.container.setVisible(false);
        this.scene.statsPanel?.close?.();
        if (this.scene._tooltipTarget && this.texts?.list?.includes?.(this.scene._tooltipTarget)) {
            this.scene.hideTooltip?.();
        }
        const btn = this.scene.bioBtn;
        if (btn) {
            const hovering = typeof pointerHitsInteractive === "function"
                && pointerHitsInteractive(btn, this.scene.input.activePointer);
            btn.setTexture(hovering ? "bio_hover" : "bio");
        }
        if (this.scene._tooltipTarget === this.bootBtn || this.scene._tooltipTarget === this.infoBtn) {
            this.scene.hideTooltip?.();
        }
        if (!viewingCorpse) this.scene.partySys?.releaseSettlerFocus?.();
    }

    containsPointer(pointer) {
        if (!this.visible || !pointer) return false;
        const b = this._bounds;
        return !!(b && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y));
    }

    /** Keep bio on a dead human after their pawn is gone. */
    pinCorpse(corpse) {
        if (!corpse?.entry) return;
        this._pinnedCorpse = corpse;
        this._sig = "";
        if (this.visible) this.refresh();
    }

    _selectedCorpse() {
        const pinned = this._pinnedCorpse;
        if (pinned?.entry && pinned.active !== false) return pinned;
        const panel = this.scene.corpsePanel;
        const corpse = panel?.visible ? panel.corpse : null;
        if (!corpse?.entry) return null;
        // A downed human's view goes inactive the instant they die, one step
        // before the panel follows onto the corpse. Still their bio.
        if (corpse.active || corpse.entry.downedLiving) return corpse;
        return null;
    }

    _pawn() {
        if (this._selectedCorpse()) return null;
        const focus = this.scene.focusPawn;
        if (focus?.active && !focus.isBodyDead?.()) return focus;
        return this.scene.player || null;
    }

    /** Whoever the sheet is showing, so the stat window reads the same body. */
    _subject() {
        const corpse = this._selectedCorpse();
        if (corpse?.entry) {
            return {
                bio: corpse.entry.bio || null,
                anatomy: corpse.entry.anatomy || corpse.anatomy || null,
                x: corpse.x,
                y: corpse.y,
                hunger: corpse.entry.hunger
            };
        }
        return this._pawn();
    }

    _pawnName() {
        const pawn = this._pawn();
        return pawn?.displayName?.() || pawn?.pawnName || pawn?.name || "them";
    }

    /** Companions and your settlers. The leader stays. Wanderers and other camps stay. */
    _canBanish(pawn) {
        const scene = this.scene;
        if (!pawn || pawn.isBodyDead?.()) return false;
        if (pawn === scene.leader || pawn.role === "leader") return false;
        if ((scene.party || []).includes(pawn)) return true;
        if (pawn.role === "settler") {
            if (scene.partySys?.settlerIsForeign?.(pawn)) return false;
            return true;
        }
        return false;
    }

    _stackLabel(stack) {
        if (!stack?.id) return "";
        const scene = this.scene;
        let name = "";
        if (typeof Stone !== "undefined" && Stone.displayName) {
            name = Stone.displayName(stack, (id) => scene.getItem?.(id)) || "";
        }
        if (!name) name = stack.customName || scene.getItem?.(stack.id)?.name || stack.id;
        const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
        return qty > 1 ? `${name} x${qty}` : name;
    }

    _carriedLines(pawn) {
        const lines = [];
        const push = (stack) => {
            const label = this._stackLabel(stack);
            if (!label) return;
            const iconSrc = typeof stackIconDataUrl === "function"
                ? stackIconDataUrl(this.scene, stack)
                : (typeof itemIconDataUrl === "function" ? itemIconDataUrl(this.scene, stack.id) : null);
            lines.push({ label, iconSrc });
        };
        for (const stack of pawn?.inventory || []) push(stack);
        for (const stack of pawn?.overflow || []) push(stack);
        const eq = pawn?.equipment || {};
        for (const key of ["head", "torso", "legs", "feet", "back"]) push(eq[key]);
        for (const stack of eq.waist || []) push(stack);
        return lines;
    }

    _releaseBootPress() {
        if (!this._bootPressed) return;
        this._bootPressed = false;
        this._paintBoot();
    }

    _paintBoot() {
        const btn = this.bootBtn;
        if (!btn?.visible) return;
        if (this._bootPressed) {
            btn.setTexture("boot_open");
            return;
        }
        const hovering = typeof pointerHitsInteractive === "function"
            && pointerHitsInteractive(btn, this.scene.input?.activePointer);
        btn.setTexture(hovering ? "boot_hover" : "boot");
    }

    _paintInfo() {
        const btn = this.infoBtn;
        if (!btn?.visible) return;
        if (this.scene.statsPanel?.visible) {
            btn.setTexture("info_open");
            return;
        }
        const hovering = typeof pointerHitsInteractive === "function"
            && pointerHitsInteractive(btn, this.scene.input?.activePointer);
        btn.setTexture(hovering ? "info_hover" : "info");
    }

    _askBanish() {
        const pawn = this._pawn();
        if (!this._canBanish(pawn)) return;
        if (this.scene._tooltipTarget === this.bootBtn) this.scene.hideTooltip?.();
        const name = this._pawnName();
        const lines = this._carriedLines(pawn);
        const finishLook = () => this._paintBoot();
        const ui = typeof CraftTemplateUi !== "undefined" ? CraftTemplateUi : null;
        if (!ui?.confirm) {
            finishLook();
            return;
        }
        ui.confirm(this.scene, {
            title: `Are you sure you want to banish ${name}?`,
            lead: lines.length ? "The following items will be lost:" : "",
            lines,
            confirm: "Banish",
            onYes: () => {
                finishLook();
                this._sendBanish(pawn);
            },
            onNo: finishLook
        });
    }

    _sendBanish(pawn) {
        const scene = this.scene;
        if (!pawn || !this._canBanish(pawn)) return;
        const pawnId = pawn.pawnId || pawn.id;
        if (!pawnId) return;
        if (scene.simAuth?.() && scene.net?.sendAction && typeof NetProtocol !== "undefined") {
            scene.net.sendAction({ type: NetProtocol.Actions.BANISH, pawnId });
            return;
        }
        scene.partySys?.onBanished?.({ pawnId, heading: { x: 1, y: 0 } });
    }

    refresh() {
        if (!this.visible) return;
        const corpse = this._selectedCorpse();
        if (this._viewingCorpse && !corpse) {
            this.close();
            return;
        }
        const pawn = corpse ? null : this._pawn();
        const bio = corpse ? (corpse.entry.bio || null) : (pawn?.bio || null);
        const name = corpse
            ? (corpse.entry.name || "Corpse")
            : (pawn?.displayName?.() || pawn?.pawnName || "You");
        this._viewingCorpse = corpse || null;
        const id = corpse ? (corpse.entry.id || "") : (pawn?.pawnId || pawn?.id || "");
        const scale = this.scene.uiScale || 1;
        const struct = this._structSig(id, name, bio, scale);
        if (struct !== this._sig) {
            this._sig = struct;
            this._progressSig = this._progressSigOf(bio);
            this._rebuild(name, bio);
            this.layout();
            return;
        }
        const progress = this._progressSigOf(bio);
        if (progress === this._progressSig) return;
        this._progressSig = progress;
        this._syncSkillProgress(bio);
    }

    /** Identity of the sheet. Experience is separate so a tick of XP does not rebuild the rows. */
    _structSig(id, name, bio, scale) {
        const S = typeof Skills !== "undefined" ? Skills : null;
        const parts = [id || "", name, scale];
        if (!bio || !S) return parts.join("|");
        parts.push(bio.gender, bio.age, bio.childhood, bio.adulthood, (bio.traits || []).join(","));
        for (const id of S.SKILL_IDS) parts.push(S.incapable(bio, id) ? "x" : ".");
        return parts.join("|");
    }

    _progressSigOf(bio) {
        const S = typeof Skills !== "undefined" ? Skills : null;
        const parts = [];
        if (bio && S) {
            for (const id of S.SKILL_IDS) {
                const row = bio.skills?.[id];
                parts.push(
                    Math.floor(Number(row?.level) || 0),
                    Math.round(Number(row?.xp) || 0),
                    Math.floor(Number(row?.passion) || 0)
                );
            }
        }
        const pawn = this._pawn();
        if (typeof Needs !== "undefined") {
            for (const def of Needs.DEFS) parts.push(Math.round(Needs.level(pawn?.needs, def.id) * 1000));
        }
        return parts.join(",");
    }

    /** One 8×8 row of needs.png. Cropping the sheet and then scaling it squashes every icon into a dash. */
    _needIconFrame(def) {
        const tex = this.scene.textures.get("needs");
        const name = `need:${def.id}`;
        if (!tex.has(name)) {
            const crop = Needs.iconCrop(def.icon);
            tex.add(name, 0, crop.x, crop.y, crop.w, crop.h);
        }
        return name;
    }

    _makeNeedRows() {
        const rows = [];
        const api = typeof Needs !== "undefined" ? Needs : null;
        if (!api) return rows;
        for (const def of api.DEFS) {
            let icon = null;
            if (this.scene.textures?.exists("needs")) {
                icon = this.scene.add.image(0, 0, "needs", this._needIconFrame(def)).setOrigin(0, 0);
                this.texts.add(icon);
            }
            rows.push({ def, icon, hit: null });
        }
        return rows;
    }

    _syncSkillProgress(bio) {
        const S = typeof Skills !== "undefined" ? Skills : null;
        const skills = this._block?.skills || [];
        if (!S) return;
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
        this.layout();
        const target = this.scene._tooltipTarget;
        const needHits = this._block?.needRows || [];
        if (target && (
            skills.some((row) => row.hit === target)
            || needHits.some((row) => row.hit === target)
        )) this.scene.refreshTooltip?.();
    }

    _font(size) {
        const s = this.scene.uiScale || 1;
        return typeof pixelUiFontSize === "function" ? pixelUiFontSize(size, s) : Math.round(size * s);
    }

    _text(value, color, size) {
        const t = this.scene.add.text(0, 0, value, {
            fontFamily: typeof PIXEL_UI_FONT !== "undefined" ? PIXEL_UI_FONT : "monospace",
            fontSize: `${this._font(size || 8)}px`,
            color: color || "#e8e0d0"
        }).setOrigin(0, 0);
        if (typeof crispUiText === "function") crispUiText(t);
        this.texts.add(t);
        return t;
    }

    _hit(obj, tip) {
        if (!obj || !tip || obj._bioTip) return;
        obj._bioTip = true;
        obj.setInteractive({ useHandCursor: true });
        const read = typeof tip === "function" ? tip : () => tip;
        obj.on("pointerover", (p) => {
            this.scene.showTooltip?.(() => read(), p.x, p.y, obj);
        });
        obj.on("pointerout", () => {
            if (this.scene._tooltipTarget === obj) this.scene.hideTooltip?.();
        });
    }

    _rebuild(name, bio) {
        this.texts.removeAll(true);
        const S = typeof Skills !== "undefined" ? Skills : null;
        const cat = S ? S.catalogs() : { backstories: [], traits: [] };
        const block = {
            name: this._text(name, "#f4f0e6", 16),
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
        this._block = block;
        block.needRows = this._makeNeedRows();
        this._showInfo = !!(bio && S);
        if (!bio || !S) {
            block.meta = this._text("No record yet", "#8a8070", 8);
            return;
        }
        block.meta = this._text(`${S.genderLabel(bio.gender)}, age ${bio.age}`, "#f2ead8", 8);
        const child = S.titleOf(cat.backstories, bio.childhood);
        const adult = S.titleOf(cat.backstories, bio.adulthood);
        const childDef = (cat.backstories || []).find((row) => row.id === bio.childhood);
        const adultDef = (cat.backstories || []).find((row) => row.id === bio.adulthood);
        block.childLabel = this._text("Childhood", "#9a9186", 8);
        block.childTitle = this._text(child, "#f2ead8", 8);
        this._hit(block.childTitle, S.backstoryTip(childDef, name));
        block.adultLabel = this._text("Adulthood", "#9a9186", 8);
        block.adultTitle = this._text(adult, "#f2ead8", 8);
        this._hit(block.adultTitle, S.backstoryTip(adultDef, name));
        block.traitsHead = this._text("Traits", "#d4c45a", 8);
        const traits = Array.isArray(bio.traits) ? bio.traits : [];
        if (!traits.length) {
            block.traits.push(this._text("None", "#8a8478", 8));
        } else {
            for (const id of traits) {
                const def = (cat.traits || []).find((row) => row.id === id);
                const line = this._text(def?.title || "Unknown", "#f2ead8", 8);
                this._hit(line, def ? S.traitTip(def, name) : "Unknown");
                block.traits.push(line);
            }
        }
        const incapable = S.SKILL_IDS.filter((id) => S.incapable(bio, id));
        block.incapHead = this._text("Incapable of", "#d4c45a", 8);
        if (!incapable.length) {
            block.incaps.push(this._text("None", "#8a8478", 8));
        } else {
            for (const id of incapable) {
                const line = this._text(S.labelOf(id), "#8a8478", 8);
                this._hit(line, S.incapableTip(bio, id));
                block.incaps.push(line);
            }
        }
        for (const id of S.SKILL_IDS) {
            const off = S.incapable(bio, id);
            const level = S.effectiveLevel(bio, id);
            const row = bio.skills?.[id] || { level: 0, xp: 0, passion: 0 };
            const label = this._text(S.labelOf(id), off ? "#6a6058" : "#ffffff", 8);
            const num = off ? null : this._text(String(level), "#ffffff", 8);
            const trained = Math.max(0, Math.floor(Number(row.level) || 0));
            const xp = off ? 0 : Math.max(0, Number(row.xp) || 0);
            block.skills.push({
                label,
                num,
                tip: S.skillTip(bio, id),
                passion: off ? 0 : S.passionOf(bio, id),
                xp,
                trained,
                shown: off ? 0 : level,
                frac: off || level == null ? 0 : S.levelProgress(level, trained, xp),
                off
            });
        }
    }

    layout() {
        const s = this.scene.uiScale || 1;
        const btn = this.scene.bioBtn;
        if (!btn) return;
        const pad = Math.round(8 * s);
        const gap = Math.round(4 * s);
        const sectionGap = Math.round(12 * s);
        const indent = Math.round(8 * s);
        const b = this._block;
        const labelW = Math.max(b?.childLabel?.width || 0, b?.adultLabel?.width || 0);
        const valueX = pad + labelW + Math.round(10 * s);
        let y = pad;
        if (b?.name) {
            b.name.setPosition(pad, y);
            y += b.name.height + gap;
        }
        if (b?.meta) {
            b.meta.setPosition(pad, y);
            y += b.meta.height + sectionGap;
        }
        const colTop = y;
        const placeLine = (obj, x) => {
            if (!obj) return;
            obj.setPosition(x, y);
            y += obj.height + gap;
        };
        if (b?.childLabel) {
            b.childLabel.setPosition(pad, y);
            b.childTitle?.setPosition(valueX, y);
            y += Math.max(b.childLabel.height, b.childTitle?.height || 0) + gap;
        }
        if (b?.adultLabel) {
            b.adultLabel.setPosition(pad, y);
            b.adultTitle?.setPosition(valueX, y);
            y += Math.max(b.adultLabel.height, b.adultTitle?.height || 0) + sectionGap;
        }
        placeLine(b?.traitsHead, pad);
        for (const line of b?.traits || []) placeLine(line, pad + indent);
        if (b?.traitsHead) y += sectionGap - gap;
        placeLine(b?.incapHead, pad);
        for (const line of b?.incaps || []) placeLine(line, pad + indent);
        const leftEnd = y;

        const skills = b?.skills || [];
        const bodyH = this._font(8);
        const barH = Math.max(bodyH, skills.reduce((n, row) => Math.max(n, row.label?.height || 0), 0));
        const rowH = barH + Math.max(2, Math.round(2 * s)) + Math.round(6 * s);
        const nameW = skills.reduce((n, row) => Math.max(n, row.label?.width || 0), 0);
        const numW = skills.reduce((n, row) => Math.max(n, row.num?.width || this._font(8)), 0);
        const starR = Math.max(3, Math.round(3.5 * s));
        const starGap = Math.round(starR * 2 + 2 * s);
        const starSlot = starGap * 2;
        const leftInner = Math.max(
            (b?.name?.width || 0),
            b?.meta?.width || 0,
            labelW + Math.round(10 * s) + Math.max(b?.childTitle?.width || 0, b?.adultTitle?.width || 0),
            (b?.traitsHead?.width || 0),
            ...(b?.traits || []).map((t) => indent + (t.width || 0)),
            (b?.incapHead?.width || 0),
            ...(b?.incaps || []).map((t) => indent + (t.width || 0))
        );
        const skillX = pad + leftInner + Math.round(18 * s);
        const numRight = skillX + nameW + Math.round(8 * s) + (skills.length ? starSlot + numW : 0);
        this.bars.clear();
        const barPad = Math.max(2, Math.round(2 * s));
        skills.forEach((row, i) => {
            const sy = colTop + i * rowH;
            row.label.setPosition(skillX, sy);
            const barW = Math.max(8, nameW) + barPad * 2;
            const barX = skillX - barPad;
            const barY = sy - barPad;
            if (row.num) {
                row.num.setPosition(numRight - row.num.width, sy);
                this.bars.fillStyle(0x2a2a2a, 1);
                this.bars.fillRect(barX, barY, barW, barH + barPad * 2);
                const frac = row.frac || 0;
                this.bars.fillStyle(0x5a5a5a, 1);
                this.bars.fillRect(barX, barY, Math.max(0, Math.round(barW * frac)), barH + barPad * 2);
                const starBase = numRight - numW - Math.round(4 * s);
                for (let n = 0; n < (row.passion || 0); n++) {
                    this._star(starBase - starR - n * starGap, sy + bodyH / 2, starR);
                }
            }
            const lineW = Math.max(barW, numRight - barX);
            const hitY = row.num ? barY : sy;
            const hitH = row.num ? barH + barPad * 2 : barH;
            let hit = row.hit?.active ? row.hit : null;
            if (!hit) {
                hit = this.scene.add.rectangle(0, 0, lineW, hitH, 0x000000, 0.001).setOrigin(0, 0);
                this.texts.add(hit);
                row.hit = hit;
                this._hit(hit, () => row.tip);
            }
            hit.setPosition(barX, hitY);
            hit.setSize(lineW, hitH);
            if (hit.input?.hitArea?.setTo) hit.input.hitArea.setTo(0, 0, lineW, hitH);
        });
        const skillEnd = skills.length ? colTop + skills.length * rowH : colTop;
        const needRows = b?.needRows || [];
        const needApi = typeof Needs !== "undefined" ? Needs : null;
        const needIcon = Math.max(8, Math.round(12 * s));
        const needGapY = Math.max(2, Math.round(3 * s));
        const needRowH = needIcon + needGapY;
        const needsTop = leftEnd + (needRows.length ? sectionGap : 0);
        const needsH = needRows.length * needRowH;
        if (needRows.length && needApi) {
            const iconGap = Math.round(3 * s);
            const barW = Math.max(Math.round(40 * s), Math.min(leftInner, Math.round(96 * s)) - needIcon);
            const pawn = this._pawn();
            needRows.forEach((row, i) => {
                const y = needsTop + i * needRowH;
                const x = pad;
                if (row.icon) {
                    row.icon.setPosition(x, y);
                    row.icon.setDisplaySize(needIcon, needIcon);
                }
                const barX = x + needIcon + iconGap;
                this.bars.fillStyle(0x000000, 0.6);
                this.bars.fillRect(barX - 1, y - 1, barW + 2, needIcon + 2);
                this.bars.fillStyle(0x222222, 0.85);
                this.bars.fillRect(barX, y, barW, needIcon);
                const fillW = Math.floor(barW * needApi.level(pawn?.needs, row.def.id));
                if (fillW > 0) {
                    this.bars.fillStyle(row.def.color, 1);
                    this.bars.fillRect(barX, y, fillW, needIcon);
                }
                const hitW = needIcon + iconGap + barW;
                let hit = row.hit?.active ? row.hit : null;
                if (!hit) {
                    hit = this.scene.add.rectangle(0, 0, hitW, needIcon, 0x000000, 0.001).setOrigin(0, 0);
                    this.texts.add(hit);
                    row.hit = hit;
                    this._hit(hit, () => needApi.tooltip(this._pawn()?.needs, row.def.id));
                }
                hit.setPosition(x, y);
                hit.setSize(hitW, needIcon);
                if (hit.input?.hitArea?.setTo) hit.input.hitArea.setTo(0, 0, hitW, needIcon);
            });
        }
        const showBoot = this._canBanish(this._pawn());
        const showInfo = !!this._showInfo;
        const bootScale = Math.max(2, Math.round(2 * s));
        const bootPx = 16 * bootScale;
        const contentRight = skills.length ? numRight : pad + leftInner;
        const headerGap = Math.round(6 * s);
        let headerW = 0;
        if (showInfo) headerW += bootPx;
        if (showBoot) headerW += (headerW ? headerGap : 0) + bootPx;
        if (headerW) headerW += headerGap;
        const nameEnd = pad + (b?.name?.width || 0) + headerW;
        const w = Math.round(Math.max(contentRight, nameEnd) + pad);
        const headerY = pad + bootPx / 2;
        let headerRight = w - pad;
        if (this.infoBtn) {
            this.infoBtn.setVisible(showInfo);
            if (showInfo) {
                this.infoBtn.setScale(bootScale);
                this.infoBtn.setPosition(headerRight - bootPx / 2, headerY);
                if (this.infoBtn.input) this.infoBtn.input.enabled = true;
                else this.infoBtn.setInteractive({ useHandCursor: true });
                headerRight -= bootPx + headerGap;
                this._paintInfo();
            } else if (this.infoBtn.input) {
                this.infoBtn.input.enabled = false;
            }
        }
        if (this.bootBtn) {
            this.bootBtn.setVisible(!!showBoot);
            if (showBoot) {
                this.bootBtn.setScale(bootScale);
                this.bootBtn.setPosition(headerRight - bootPx / 2, headerY);
                if (this.bootBtn.input) this.bootBtn.input.enabled = true;
                else this.bootBtn.setInteractive({ useHandCursor: true });
                this._paintBoot();
            } else if (this.bootBtn.input) {
                this.bootBtn.input.enabled = false;
            }
        }
        const h = Math.round(Math.max(leftEnd, skillEnd, needsTop + needsH) + pad);
        const margin = Math.round(4 * s);
        let left = btn.x + btn.displayWidth / 2 + margin;
        if (left + w > this.scene.scale.width - margin) {
            left = Math.max(margin, this.scene.scale.width - w - margin);
        }
        const top = Phaser.Math.Clamp(
            (this.scene.scale.height - h) / 2,
            margin,
            Math.max(margin, this.scene.scale.height - h - margin)
        );
        this.container.setPosition(Math.round(left), Math.round(top));
        this._bounds.setTo(left, top, w, h);
        const hit = new Phaser.Geom.Rectangle(0, 0, w, h);
        if (!this.bg.input) this.bg.setInteractive(hit, Phaser.Geom.Rectangle.Contains);
        else this.bg.input.hitArea = hit;
        this.bg.clear();
        this.bg.fillStyle(0x16130f, 0.96);
        this.bg.fillRect(0, 0, w, h);
        this.bg.lineStyle(Math.max(2, Math.round(2 * s)), 0x000000, 1);
        this.bg.strokeRect(0, 0, w, h);
    }

    _star(x, y, r) {
        const pts = [];
        for (let i = 0; i < 10; i++) {
            const a = -Math.PI / 2 + i * Math.PI / 5;
            const rad = i % 2 === 0 ? r : r * 0.42;
            pts.push(new Phaser.Geom.Point(x + Math.cos(a) * rad, y + Math.sin(a) * rad));
        }
        this.bars.fillStyle(0xe6c15a, 1);
        this.bars.fillPoints(pts, true);
    }
}
