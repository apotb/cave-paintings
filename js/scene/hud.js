/**
 * SceneMain prototype methods (hud).
 * Installed onto SceneMain.prototype. Method bodies are unchanged.
 */
(function (root) {
    "use strict";
    root.SceneMainHud = {

    createBars() {
        // World action bars sit above the time-of-day veil (depth 51 > lightGfx 50)
        // so night/dawn wash can't hide them. Position is world space; postupdate
        // redraws after the player snap so they stay locked to the sprite.
        this._channelBarProgress = null;
        this._chopBarMap = new Map();
        this._chopBarPool = [];
        this.channelBar = this._ensureWorldHudBar(this.channelBar);

        this.painBar = this.add.graphics();
        this.uiLayer.add(this.painBar);

        this.kcBar = this.add.graphics();
        this.uiLayer.add(this.kcBar);

        this.weightBar = this.add.graphics();
        this.uiLayer.add(this.weightBar);

        this.barIcons = this.add.image(0, 0, "bar_icons").setOrigin(0, 0);
        this.uiLayer.add(this.barIcons);

        this.painBarZone = this._makeBarZone(() => {
            const pct = Math.round((this.player.capacities?.pain?.() ?? 0) * 100);
            return `Pain: ${pct}%`;
        });
        this.kcBarZone = this._makeBarZone(() => {
            const kc = Math.ceil(this.player.kc);
            const sat = Math.ceil(this.player.saturation);
            let text = `Hunger: ${kc}/${this.player.stomach} kc`;
            if (sat > 0) text += `\nSatiety: ${sat}`;
            return text;
        });
        this.weightBarZone = this._makeBarZone(() => {
            const weight = this.player.getInventoryWeight();
            const strength = this.player.strength;
            return `Carry: ${weight}/${strength} kg${weight > strength ? " (encumbered)" : ""}`;
        });

        this._lastPain = NaN;
        this._lastKc = NaN;
        this._lastSaturation = NaN;
        this._lastStomach = NaN;
        this._lastWeight = NaN;
        this._lastStrength = NaN;

        this.drawBars();
    },

    _makeBarZone(tooltipFn) {
        const zone = this.add.zone(0, 0, 1, 1).setOrigin(0, 0).setInteractive();
        zone.on("pointerover", p => this.showTooltip(tooltipFn, p.x, p.y, zone));
        zone.on("pointerout", () => this.hideTooltip());
        this.uiLayer.add(zone);
        return zone;
    },

    _setBarZone(zone, x, y, w, h) {
        zone.setPosition(x, y).setSize(w, h);
        if (zone.input && zone.input.hitArea) {
            zone.input.hitArea.setTo(0, 0, w, h);
        }
    },

    drawBars() {
        if (this._leavingGame || !this.painBar?.active || !this.player) return;
        const s = this.uiScale || 1;
        const x = Math.round(24 * s);
        const y = Math.round(8 * s);
        const w = Math.round(300 * s);
        const h = Math.round(16 * s);
        const gap = Math.round(6 * s);
        const border = Math.max(1, Math.round(s));

        if (this.barIcons) {
            this.barIcons.setScale(s).setPosition(Math.round(4 * s), Math.round(8 * s));
        }

        const pain = Phaser.Math.Clamp(this.player.capacities?.pain?.() ?? 0, 0, 1);
        const kc = Math.ceil(this.player.kc);
        const sat = this.player.saturation;
        const stomach = this.player.stomach;
        const weight = this.player.getInventoryWeight();
        const strength = this.player.strength;

        const kcFrac = kc / stomach;
        const satFrac = Phaser.Math.Clamp(sat / stomach, 0, 1);

        // Pain (empty at 0%, fills toward 100%)
        this.painBar.clear();
        this._drawBar(this.painBar, x, y, w, h, pain, 0x000000, 0x222222, 0xD24A43, border);
        // Pain-shock threshold tick (RimWorld default 80%) — inside the bar only
        const shockT = Number(this.player.anatomy?.plan?.painShockThreshold) || 0.8;
        const tickX = x + Math.round(w * Phaser.Math.Clamp(shockT, 0, 1));
        const tickW = Math.max(1, Math.round(s));
        this.painBar.fillStyle(0x444444, 1);
        this.painBar.fillRect(tickX - Math.floor(tickW / 2), y, tickW, h);

        // Hunger (yellow) + satiety overlay (orange)
        const ky = y + h + gap;
        this.kcBar.clear();
        this._drawBar(this.kcBar, x, ky, w, h, kcFrac, 0x000000, 0x222222, 0xE0C14B, border);
        const satW = Math.floor(w * satFrac);
        if (satW > 0) {
            this.kcBar.fillStyle(0xE67E22, 1);
            this.kcBar.fillRect(x, ky, satW, h);
        }

        // Weight
        this.weightBar.clear();
        const wy = y + (h + gap) * 2;
        this.weightBar.fillStyle(0x000000, 0.6).fillRect(x - border, wy - border, w + border * 2, h + border * 2)
            .fillStyle(0x222222, 0.85).fillRect(x, wy, w, h);
        const limit1 = Math.max(1, this.player.strength);
        const limit2 = limit1 * 2;
        const clamped = Math.min(Math.max(0, weight), limit2);
        const width1 = Math.floor(w * Math.min(clamped, limit1) / limit1);
        if (width1 > 0) this.weightBar.fillStyle(0x2ECC71, 1).fillRect(x, wy, width1, h);
        const excess = Math.max(0, clamped - limit1);
        const width2 = Math.floor(w * excess / limit1);
        if (width2 > 0) this.weightBar.fillStyle(0xF39C12, 1).fillRect(x, wy, width2, h);

        this._setBarZone(this.painBarZone, x, y, w, h);
        this._setBarZone(this.kcBarZone, x, ky, w, h);
        this._setBarZone(this.weightBarZone, x, wy, w, h);

        this._lastPain = pain;
        this._lastKc = kc;
        this._lastSaturation = sat;
        this._lastStomach = stomach;
        this._lastWeight = weight;
        this._lastStrength = strength;
    },

    /**
     * Party nametags / crown / channel bars stay readable in the dark.
     * Wanderers and other players stay in the world so the night veil covers them.
     */
    isPartyWorldHud(pawn) {
        if (!pawn) return false;
        if (pawn === this.player || pawn === this.leader) return true;
        if (this.party?.includes(pawn)) return true;
        if (pawn.role === "wanderer") return false;
        const oid = pawn.ownerId || pawn._remote?.ownerId;
        const self = this.leader?.ownerId || this._netPlayerId || this.characterId;
        const parked = pawn.role === "settler"
            || !!pawn.homeSettlementId
            || this.settlers?.includes?.(pawn);
        if (parked) return !oid || !!(self && String(oid) === String(self));
        if (oid && self && String(oid) === String(self)) return true;
        if (pawn.pawnId && this.party?.some((p) => p.pawnId === pawn.pawnId)) return true;
        return false;
    },

    /**
     * World HUD. `aboveVeil` parents into worldHudLayer (depth 200, over the night
     * overlay). Otherwise the object lives in mainLayer and is darkened at night.
     */
    _placeWorldHud(obj, depth = 51, aboveVeil = true) {
        if (!obj) return obj;
        const layer = aboveVeil ? this.worldHudLayer : this.mainLayer;
        if (obj.parentContainer && obj.parentContainer !== layer) {
            obj.parentContainer.remove(obj);
        }
        if (layer && obj.displayList !== layer) {
            obj.displayList?.remove?.(obj);
            layer.add(obj);
            this._uiCam?.ignore(obj);
        } else if (!layer) {
            this.add.existing(obj);
        }
        if (obj.depth !== depth) obj.setDepth(depth);
        return obj;
    },

    /**
     * World HUD above the time-of-day veil. Parent into worldHudLayer
     * so the UI camera never draws a second unzoomed copy at world x/y.
     */
    _liftAboveVeil(obj, depth = 51) {
        return this._placeWorldHud(obj, depth, true);
    },

    _ensureWorldHudBar(existing) {
        const depth = 51;
        if (existing?.active) return this._liftAboveVeil(existing, depth);
        return this._liftAboveVeil(this.add.graphics().setVisible(false), depth);
    },

    /**
     * Drying-rack sprite a pawn is fleshing or brain-tanning, if any.
     */
    _hideWorkRackForPawn(pawn) {
        const local = pawn?._fleshChannel || pawn?._brainChannel;
        if (local?.rack?.active) return local.rack;
        const net = pawn?._netWorkChannel;
        if (!net || (net.kind !== "flesh" && net.kind !== "brain")) return null;
        const uid = net.uid || local?.rack?.entry?.uid;
        return uid ? this.findStorageByUid(uid) : null;
    },

    /**
     * World position for a flesh/brain bar: just above the hanging hide.
     * Returns null when the pawn is not working a rack (eat/tend/craft stay on the pawn).
     */
    _hideWorkBarPos(pawn) {
        const rack = this._hideWorkRackForPawn(pawn);
        if (!rack?.active) return null;
        const hang = rack._hangSpr;
        if (hang?.active) {
            return { x: hang.x, y: hang.y - 2, depthY: rack.y };
        }
        return {
            x: rack.x,
            y: rack.y - (rack.height || 16) - 2,
            depthY: rack.y
        };
    },

    /**
     * Progress 0–1 bar above the player (or hanging hide while scraping/tanning).
     * World-space, scaled 1/zoom so it stays a constant screen size. Redrawn
     * after the render snap in postupdate.
     */
    showChannelBar(progress) {
        this._channelBarProgress = Phaser.Math.Clamp(progress, 0, 1);
        this._drawChannelBar();
    },

    hideChannelBar() {
        this._channelBarProgress = null;
        this.channelBar?.clear();
        this.channelBar?.setVisible(false);
    },

    _drawChannelBar() {
        const player = this.player;
        const frac = this._channelBarProgress;
        if (frac == null || !player?.active) {
            this.hideChannelBar();
            return;
        }

        this.channelBar = this._ensureWorldHudBar(this.channelBar);

        const zoom = this.worldZoom || this.cameras.main?.zoom || 1;
        const w = 40;
        const h = 5;

        const hidePos = this._hideWorkBarPos(player);
        let wx, wy;
        if (hidePos) {
            wx = hidePos.x;
            wy = hidePos.y;
        } else if (player._prone) {
            wx = player.x;
            wy = player.y - Math.round(Math.max(player.width, player.height) * 0.5 + 2);
        } else {
            // Sprite origin is bottom-left — center X, just above top of sprite
            wx = player.x + Math.round(player.width * 0.5);
            wy = player.y - Math.round(player.height + 2);
        }

        // 0–25% red → 25–50% → orange → 50–75% → yellow → 75–90% → green → 90–100% solid green
        const color = this._channelBarFillColor(frac);

        const g = this.channelBar;
        g.clear().setVisible(true);
        g.setScale(1 / zoom);
        g.setPosition(wx, wy);
        // Local draw in screen-pixel units; scale makes them world-sized
        this._drawBar(g, -Math.floor(w / 2), -h, w, h, frac, 0x000000, 0x222222, color, 2);
    },

    showTreeChopBar(thing, frac) {
        if (!thing?.active) return;
        const entry = thing.entry;
        if (entry && frac != null) {
            entry.chopProgress = Phaser.Math.Clamp(Number(frac) || 0, 0, 1);
        }
    },

    hideTreeChopBar(thing) {
        if (!thing) {
            for (const rec of this._chopBarMap?.values?.() || []) {
                rec.gfx?.clear();
                rec.gfx?.setVisible(false);
                if (rec.gfx) this._chopBarPool.push(rec.gfx);
            }
            this._chopBarMap?.clear?.();
            return;
        }
        const key = this._chopBarKey(thing);
        const rec = this._chopBarMap?.get(key);
        if (!rec) return;
        rec.gfx?.clear();
        rec.gfx?.setVisible(false);
        if (rec.gfx) this._chopBarPool.push(rec.gfx);
        this._chopBarMap.delete(key);
    },

    _chopBarKey(thing) {
        return thing?.entry?.uid || thing?.uid || `${Math.round(thing?.x || 0)}:${Math.round(thing?.y || 0)}`;
    },

    _takeChopBarGfx() {
        while (this._chopBarPool.length) {
            const g = this._chopBarPool.pop();
            if (g?.active) return this._ensureWorldHudBar(g);
        }
        return this._ensureWorldHudBar(null);
    },

    _tickTreeChopBars() {
        if (!this._chopBarMap) this._chopBarMap = new Map();
        const view = this.cameras.main?.worldView;
        const pad = 32;
        const seen = new Set();
        for (const chunk of Object.values(this.chunks || {})) {
            const kids = chunk.things?.getChildren?.() || [];
            for (const t of kids) {
                if (!t?.active || t.entry?.gone) continue;
                let frac = (typeof Chop !== "undefined" && Chop.barVisible?.(t.entry, Date.now()))
                    ? (Number(t.entry?.chopProgress) || 0)
                    : 0;
                if (!(frac > 0) || frac >= 1) {
                    frac = 0;
                    const id = t.entry?.id;
                    const isFire = id === "campfire" || id === "unlit_campfire";
                    const panel = this.campfirePanel;
                    const uiOpen = !!(panel?.visible && panel.campfire === t);
                    if (isFire && !uiOpen && typeof Fire !== "undefined" && Fire.cookWorldBarFrac) {
                        frac = Fire.cookWorldBarFrac(t.entry, (itemId) => this.getItem?.(itemId));
                    }
                    if (!(frac > 0) && typeof Dig !== "undefined" && Dig.barVisible?.(t.entry, Date.now())) {
                        frac = Number(t.entry?.digProgress) || 0;
                    }
                }
                if (!(frac > 0)) continue;
                if (frac > 1) frac = 1;
                if (view) {
                    if (t.x < view.x - pad || t.x > view.right + pad) continue;
                    if (t.y < view.y - pad || t.y > view.bottom + pad) continue;
                }
                const key = this._chopBarKey(t);
                seen.add(key);
                this._drawOneChopBar(t, frac, key);
            }
        }
        for (const [key, rec] of this._chopBarMap) {
            if (seen.has(key)) continue;
            rec.gfx?.clear();
            rec.gfx?.setVisible(false);
            if (rec.gfx) this._chopBarPool.push(rec.gfx);
            this._chopBarMap.delete(key);
        }
    },

    _drawOneChopBar(thing, frac, key) {
        let rec = this._chopBarMap.get(key);
        if (!rec) {
            rec = { gfx: this._takeChopBarGfx(), thing };
            this._chopBarMap.set(key, rec);
        } else {
            rec.thing = thing;
        }
        const g = rec.gfx = this._ensureWorldHudBar(rec.gfx);
        const zoom = this.worldZoom || this.cameras.main?.zoom || 1;
        const w = 40;
        const h = 5;
        const color = this._channelBarFillColor(frac);
        g.clear().setVisible(true);
        g.setScale(1 / zoom);
        const frameH = Number(thing.frame?.height) || Number(thing.height) || 16;
        const scaleY = Math.abs(Number(thing.scaleY) || 1) || 1;
        const spriteH = frameH * scaleY;
        let inset = (typeof textureOpaqueTopInset === "function"
            ? textureOpaqueTopInset(this, thing)
            : 0) * scaleY;
        const id = thing?.entry?.id || thing?.meta?.id || "";
        if (!(inset > 0) && /stump/i.test(id)) {
            const visual = Math.max(Number(thing.hitboxSize) || 5, 8);
            inset = Math.max(0, spriteH - visual);
        }
        const barY = (typeof GameMath !== "undefined" && GameMath.worldHudBarY)
            ? GameMath.worldHudBarY(thing.y, spriteH, inset, 2)
            : thing.y - spriteH - 2;
        g.setPosition(thing.x, barY);
        this._drawBar(g, -Math.floor(w / 2), -h, w, h, frac, 0x000000, 0x222222, color, 2);
    },

    /** Smooth tend-bar fill color through the progress thresholds. */
    _channelBarFillColor(frac) {
        if (typeof Durability !== "undefined" && Durability.rampBarFillColor) {
            return Durability.rampBarFillColor(frac);
        }
        return 0x3CB043;
    },

    _drawBar(gfx, x, y, w, h, frac, borderColor, bgColor, fillColor, border=1) {
        // border
        gfx.fillStyle(borderColor, 0.6);
        gfx.fillRect(x - border, y - border, w + border * 2, h + border * 2);
        // background
        gfx.fillStyle(bgColor, 0.85);
        gfx.fillRect(x, y, w, h);
        // fill
        const fillW = Math.floor(w * frac);
        if (fillW > 0) {
            gfx.fillStyle(fillColor, 1.0);
            gfx.fillRect(x, y, fillW, h);
        }
    },

    createStatus() {
        this.status = this.add.image(this.scale.width / 4, this.scale.height - 8, "status");
        this.status.setOrigin(0.5, 1);
        this.uiLayer.add(this.status);
    },

    _tooltipPayload(raw) {
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            return {
                text: raw.text || "",
                rows: Array.isArray(raw.rows) ? raw.rows : null,
                lines: Array.isArray(raw.lines) ? raw.lines : null,
                hunger: raw.hunger && typeof raw.hunger === "object" ? raw.hunger : null
            };
        }
        return { text: raw || "", rows: null, lines: null, hunger: null };
    },

    _splitTooltipText(text) {
        const s = String(text || "");
        const i = s.indexOf("\n");
        if (i < 0) return { head: s, tail: "" };
        return { head: s.slice(0, i), tail: s.slice(i + 1) };
    },

    _hungerSig(h) {
        if (!h) return "";
        return [
            Math.round(Number(h.kc) || 0),
            Math.round(Number(h.sat) || 0),
            Math.round(Number(h.stomach) || 0)
        ].join(":");
    },

    _applyTooltipPayload() {
        const raw = this._tooltipSource ? this._tooltipSource() : "";
        const { text, rows, lines, hunger } = this._tooltipPayload(raw);
        const useHunger = !!hunger;
        const split = useHunger ? this._splitTooltipText(text) : { head: text, tail: "" };
        const head = useHunger ? split.head : text;
        const tail = useHunger ? split.tail : "";
        const gearSig = this._gearRowsSig(rows);
        const linesSig = this._tooltipLinesSig(lines);
        const extraSig = lines?.length ? `L:${linesSig}` : `G:${gearSig}`;
        const hungerSig = this._hungerSig(hunger);
        if (
            this._tooltipDrawn
            && this.tooltipText.text === head
            && (this.tooltipSub?.text || "") === tail
            && extraSig === this._tooltipGearSig
            && hungerSig === this._tooltipHungerSig
        ) {
            return !!(head || tail || this._tooltipGearH || this._tooltipHungerH);
        }
        this.tooltipText.setText(head);
        if (this.tooltipSub) {
            this.tooltipSub.setText(tail);
            this.tooltipSub.setVisible(!!tail);
        }
        if (lines?.length) this._syncTooltipLines(lines, extraSig);
        else this._syncTooltipGear(rows, extraSig);
        this._layoutTooltip(hunger);
        this._tooltipDrawn = true;
        return !!(head || tail || this._tooltipGearH || this._tooltipHungerH);
    },

    _syncTooltipHunger(hunger, sig) {
        this._tooltipHungerSig = sig || "";
        const g = this.tooltipHunger;
        if (!g) {
            this._tooltipHungerH = 0;
            this._tooltipHungerW = 0;
            return;
        }
        g.clear();
        if (!hunger) {
            this._tooltipHungerH = 0;
            this._tooltipHungerW = 0;
            g.setVisible(false);
            return;
        }
        const s = this.uiScale || 1;
        const pad = this._tooltipPadding;
        const nameW = Math.max(0, (this.tooltipText.displayWidth || 0) - pad * 2);
        const w = Math.max(Math.round(80 * s), nameW);
        const h = Math.max(4, Math.round(8 * s));
        const border = Math.max(1, Math.round(s));
        const stomach = Math.max(1, Number(hunger.stomach) || 2000);
        const kcFrac = Phaser.Math.Clamp((Number(hunger.kc) || 0) / stomach, 0, 1);
        const satFrac = Phaser.Math.Clamp((Number(hunger.sat) || 0) / stomach, 0, 1);
        this._drawBar(g, 0, 0, w, h, kcFrac, 0x000000, 0x222222, 0xE0C14B, border);
        const satW = Math.floor(w * satFrac);
        if (satW > 0) {
            g.fillStyle(0xE67E22, 1);
            g.fillRect(0, 0, satW, h);
        }
        this._tooltipHungerW = w;
        this._tooltipHungerH = h;
        g.setVisible(true);
    },

    _layoutTooltip(hunger) {
        const pad = this._tooltipPadding;
        const s = this.uiScale || 1;
        const hungerOn = !!hunger;
        const tail = !!(this.tooltipSub?.text);
        if (hungerOn) {
            this.tooltipText.setPadding({
                left: pad, right: pad, top: pad, bottom: Math.round(2 * s)
            });
            if (this.tooltipSub) {
                this.tooltipSub.setPadding({
                    left: pad, right: pad, top: Math.round(2 * s), bottom: pad
                });
            }
        } else {
            this.tooltipText.setPadding(pad);
            if (this.tooltipSub) this.tooltipSub.setPadding(pad);
        }
        this._syncTooltipHunger(hunger, this._hungerSig(hunger));
        const hasText = !!(this.tooltipText?.text);
        this.tooltipText?.setVisible(hasText);
        const tw = hasText ? (this.tooltipText.displayWidth || 0) : 0;
        const th = hasText ? (this.tooltipText.displayHeight || 0) : 0;
        const sw = tail ? (this.tooltipSub.displayWidth || 0) : 0;
        const sh = tail ? (this.tooltipSub.displayHeight || 0) : 0;
        const gw = this._tooltipGearW || 0;
        const gh = this._tooltipGearH || 0;
        const hw = this._tooltipHungerW || 0;
        const hh = this._tooltipHungerH || 0;
        const gap = Math.round(2 * s);
        let y = th;
        if (this.tooltipHunger) {
            if (hh > 0) this.tooltipHunger.setPosition(pad, y);
            else this.tooltipHunger.setPosition(0, 0);
        }
        if (hh > 0) y += hh;
        if (this.tooltipSub) {
            this.tooltipSub.setPosition(0, tail ? y : 0);
            if (tail) y += sh;
        }
        const gearGap = gh > 0 ? gap : 0;
        if (this.tooltipGear) this.tooltipGear.setPosition(0, y + gearGap);
        const innerW = Math.max(tw, sw, gw, hh > 0 ? hw + pad * 2 : 0);
        const innerH = y + gearGap + gh;
        const boxW = innerW + pad * 2;
        const boxH = innerH + pad * 2;
        this._tooltipBoxW = boxW;
        this._tooltipBoxH = boxH;
        const radius = Math.max(4, Math.round(6 * s));
        this.tooltipBg.clear()
            .fillStyle(0x111111, 1)
            .fillRoundedRect(-pad, -pad, boxW, boxH, radius)
            .lineStyle(1, 0x000000, 1)
            .strokeRoundedRect(-pad, -pad, boxW, boxH, radius);
    },

    _heldStackSig(stack) {
        if (!stack?.id) return "";
        return [
            stack.id,
            stack.quantity || 1,
            stack.knapIcon || "",
            stack.knapIconData ? "k" : "",
            stack.formIcon || "",
            stack.formVoxels ? "f" : "",
            stack.fillTint || "",
            (stack.ingredients || []).map((x) => x?.id || "").join(",")
        ].join(":");
    },

    _gearRowsSig(rows) {
        const list = (rows || []).filter((r) => Array.isArray(r) && r.some((s) => s?.id));
        return list.map((r) => r.map((s) => this._heldStackSig(s)).join(",")).join("|");
    },

    _tooltipLinesSig(lines) {
        return (lines || []).map((l) => `${l?.icon || ""}:${l?.label || ""}:${l?.value ?? ""}:${l?.value2 ?? ""}:${l?.hangMinus ? 1 : 0}`).join("|");
    },

    _clearTooltipGear() {
        this._tooltipGearSig = null;
        this._tooltipGearW = 0;
        this._tooltipGearH = 0;
        this.tooltipGear?.removeAll(true);
    },

    _syncTooltipGear(rows, sig = null) {
        const list = (rows || []).filter((r) => Array.isArray(r) && r.some((s) => s?.id));
        const next = sig != null ? sig : this._gearRowsSig(list);
        if (next === this._tooltipGearSig) return;
        this._clearTooltipGear();
        this._tooltipGearSig = next;
        if (!list.length || !this.tooltipGear) return;

        const s = this.uiScale || 1;
        const scale = 2 * s;
        const icon = 16 * scale;
        const gap = Math.round(4 * s);
        const rowGap = Math.round(3 * s);
        const qtyInset = Math.round(4 * s);
        let y = 0;
        let maxW = 0;
        const getItem = (id) => this.getItem?.(id);

        for (const row of list) {
            let x = this._tooltipPadding;
            for (const stack of row) {
                if (!stack?.id) continue;
                const meta = getItem(stack.id);
                const cx = x + icon / 2;
                const cy = y + icon / 2;
                const base = this.add.image(cx, cy, "slot")
                    .setOrigin(0.5)
                    .setScale(scale);
                const fill = this.add.image(cx, cy, "slot")
                    .setOrigin(0.5)
                    .setScale(scale)
                    .setVisible(false);
                if (typeof syncStackIcon === "function") {
                    syncStackIcon(base, fill, stack, meta, getItem, this.textures, scale);
                } else if (meta?.key && this.textures.exists(meta.key)) {
                    base.setTexture(meta.key).setVisible(true);
                }
                this.tooltipGear.add([base, fill]);
                const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
                if (qty > 1) {
                    const txt = crispUiText(this.add.text(
                        x + icon - qtyInset,
                        y + icon - qtyInset,
                        String(qty),
                        {
                            fontFamily: PIXEL_UI_FONT,
                            fontSize: `${pixelUiFontSize(8, s)}px`,
                            align: "right",
                            color: "#ffffff",
                            stroke: "#000000",
                            strokeThickness: Math.max(2, Math.round(2 * s))
                        }
                    )).setOrigin(1, 1);
                    if (typeof applyPixelUiFont === "function") applyPixelUiFont(txt, 8, s);
                    this.tooltipGear.add(txt);
                }
                x += icon + gap;
            }
            maxW = Math.max(maxW, x);
            y += icon + rowGap;
        }
        this._tooltipGearW = maxW;
        this._tooltipGearH = Math.max(0, y - rowGap);
    },

    _syncTooltipLines(lines, sig = null) {
        const next = sig != null ? sig : `L:${this._tooltipLinesSig(lines)}`;
        if (next === this._tooltipGearSig) return;
        this._clearTooltipGear();
        this._tooltipGearSig = next;
        const list = lines || [];
        if (!list.length || !this.tooltipGear) return;

        const s = this.uiScale || 1;
        const pad = this._tooltipPadding;
        const iconS = Math.round(16 * s);
        const iconGap = Math.round(6 * s);
        const rowH = Math.round(22 * s);
        const valGap = Math.round(16 * s);
        const textX = pad + iconS + iconGap;
        const made = [];
        let y = 0;
        for (const line of list) {
            const midY = y + rowH / 2;
            const iconKey = line?.icon;
            if (iconKey && this.textures.exists(iconKey)) {
                const img = this.add.image(pad + iconS / 2, midY, iconKey)
                    .setDisplaySize(iconS, iconS);
                this.tooltipGear.add(img);
            }
            const label = crispUiText(this.add.text(textX, midY, String(line?.label || ""), {
                fontFamily: PIXEL_UI_FONT,
                fontSize: `${pixelUiFontSize(16, s)}px`,
                color: "#ffffff",
                stroke: "#000000",
                strokeThickness: Math.max(2, Math.round(2 * s))
            })).setOrigin(0, 0.5);
            if (typeof applyPixelUiFont === "function") applyPixelUiFont(label, 16, s);
            const hangMinus = !!line?.hangMinus;
            const rawVal = String(line?.value ?? "");
            const digitStr = hangMinus ? rawVal.replace(/^-/, "") : rawVal;
            const makeVal = (str) => {
                const txt = crispUiText(this.add.text(textX, midY, str, {
                    fontFamily: PIXEL_UI_FONT,
                    fontSize: `${pixelUiFontSize(16, s)}px`,
                    color: "#ffffff",
                    stroke: "#000000",
                    strokeThickness: Math.max(2, Math.round(2 * s))
                })).setOrigin(1, 0.5);
                if (typeof applyPixelUiFont === "function") applyPixelUiFont(txt, 16, s);
                return txt;
            };
            const val = makeVal(digitStr);
            const val2Str = line?.value2 != null ? String(line.value2) : "";
            const val2 = val2Str ? makeVal(val2Str) : null;
            let minus = null;
            if (hangMinus) minus = makeVal("-");
            const kids = [label, val];
            if (minus) kids.push(minus);
            if (val2) kids.push(val2);
            this.tooltipGear.add(kids);
            made.push({ label, val, val2, minus, midY });
            y += rowH;
        }
        let maxLabel = 0;
        let maxVal = 0;
        let maxVal2 = 0;
        let maxMinus = 0;
        for (const row of made) {
            maxLabel = Math.max(maxLabel, row.label.displayWidth || 0);
            maxVal = Math.max(maxVal, row.val.displayWidth || 0);
            if (row.val2) maxVal2 = Math.max(maxVal2, row.val2.displayWidth || 0);
            if (row.minus) maxMinus = Math.max(maxMinus, row.minus.displayWidth || 0);
        }
        const hasVal = made.some((row) => (row.val.text || "").length);
        const hasVal2 = made.some((row) => row.val2 && (row.val2.text || "").length);
        const valX = hasVal ? textX + maxLabel + valGap + maxMinus + maxVal : textX + maxLabel;
        const val2X = hasVal2 ? valX + valGap + maxVal2 : valX;
        for (const row of made) {
            if (hasVal) {
                row.val.setPosition(valX, row.midY);
                if (row.minus) row.minus.setPosition(valX - row.val.displayWidth, row.midY);
            } else {
                row.val.setVisible(false);
            }
            if (row.val2) {
                if (hasVal2) row.val2.setPosition(val2X, row.midY);
                else row.val2.setVisible(false);
            }
        }
        this._tooltipGearW = (hasVal2 ? val2X : valX) + pad;
        this._tooltipGearH = Math.max(0, y);
    },
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
