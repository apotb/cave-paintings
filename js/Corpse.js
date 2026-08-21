/**
 * Persistent corpse: gray, face-right, rotated -90° CCW. Loot lives in chunk.meta.corpses.
 */
class Corpse extends Phaser.GameObjects.Sprite {
    static TINT_CORPSE = 0x888888;

    /** Cached grayscale sheet for a texture key (`key__gray`). */
    static grayscaleTextureKey(scene, key) {
        if (!scene?.textures || !key) return key;
        const grayKey = `${key}__gray`;
        if (scene.textures.exists(grayKey)) return grayKey;
        const srcTex = scene.textures.get(key);
        if (!srcTex || srcTex.key === "__MISSING") return key;
        const img = srcTex.getSourceImage?.() || srcTex.source?.[0]?.image;
        if (!img || !img.width) return key;
        const w = img.width;
        const h = img.height;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return key;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, w, h);
        const px = imageData.data;
        for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] === 0) continue;
            const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114 + 0.5) | 0;
            px[i] = px[i + 1] = px[i + 2] = g;
        }
        ctx.putImageData(imageData, 0, 0);
        const gray = scene.textures.addCanvas(grayKey, canvas);
        if (!gray) return key;
        const names = typeof srcTex.getFrameNames === "function" ? srcTex.getFrameNames() : [];
        for (const name of names) {
            const f = srcTex.get(name);
            if (!f || f.name === "__BASE") continue;
            if (gray.has(name) || gray.has(String(name))) continue;
            gray.add(name, 0, f.cutX, f.cutY, f.cutWidth, f.cutHeight);
        }
        return grayKey;
    }


    /**
     * @param {Phaser.Scene} scene
     * @param {{ x, y, key, frame?, name?, loot: Object[] }} opts
     * @returns {Corpse|null}
     */
    static spawn(scene, opts) {
        const loot = (opts.loot || []).map(s => cloneItemStack(s)).filter(Boolean);

        const chunk = LivingMob.ensureChunkAt(scene, opts.x, opts.y);
        if (!chunk) return null;
        if (!chunk.meta.corpses) chunk.meta.corpses = [];

        const now = scene.worldMinuteIndex?.() ?? 0;
        const diedAt = opts.diedAt != null && Number.isFinite(Number(opts.diedAt))
            ? Math.round(Number(opts.diedAt))
            : now;
        const stage = opts.stage === "carcass" ? "carcass" : "corpse";
        const entry = {
            id: opts.id || `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            x: opts.x,
            y: opts.y,
            key: opts.key || "human",
            look: opts.look || null,
            frame: opts.frame != null ? opts.frame : 7,
            name: opts.name || "Corpse",
            loot,
            body: opts.body || null,
            bodyPlan: opts.bodyPlan || opts.body?.planId || "human",
            mobId: opts.mobId || null,
            skinned: !!opts.skinned || stage === "carcass",
            playerCorpse: !!opts.playerCorpse,
            diedAt,
            stage
        };
        chunk.meta.corpses.push(entry);
        if (!chunk.isLoaded) return null;
        return new Corpse(scene, entry, chunk);
    }

    /** Soft gray/white sparkle puff when a corpse vanishes. */
    static puffAway(scene, x, y) {
        if (!scene?.add) return;
        const n = Phaser.Math.Between(12, 16);
        const colors = [0xb0b0b0, 0x888888, 0xd8d8d8, 0xffffff, 0x6a6a6a, 0xc4b8a8];
        const baseAngle = Math.random() * Math.PI * 2;
        for (let i = 0; i < n; i++) {
            const size = Phaser.Math.Between(1, 3);
            const p = scene.add.rectangle(x, y, size, size, colors[i % colors.length], 1)
                .setDepth((y || 0) + 30);
            scene.mainLayer?.add(p);

            // Evenly spaced rays from center so paths don't cross
            const angle = baseAngle + (i / n) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.08, 0.08);
            const dist = Phaser.Math.FloatBetween(7, 14);
            const tx = x + Math.cos(angle) * dist;
            const ty = y + Math.sin(angle) * dist;
            const dur = Phaser.Math.Between(900, 1500);

            scene.tweens.add({
                targets: p,
                x: tx,
                y: ty,
                duration: dur,
                ease: "Sine.easeOut"
            });
            // Twinkle, then fade out
            scene.tweens.add({
                targets: p,
                alpha: { from: 1, to: 0.15 },
                duration: Phaser.Math.Between(90, 140),
                yoyo: true,
                repeat: Math.max(3, Math.floor(dur / 160)),
                ease: "Sine.easeInOut",
                onComplete: () => {
                    if (!p.active) return;
                    scene.tweens.add({
                        targets: p,
                        alpha: 0,
                        duration: 280,
                        onComplete: () => p.destroy()
                    });
                }
            });
        }
    }

    /**
     * @param {Phaser.Scene} scene
     * @param {Object} entry
     * @param {Chunk} chunk
     */
    constructor(scene, entry, chunk) {
        const look = entry.look || null;
        const key = typeof PlayerLook !== "undefined"
            ? PlayerLook.resolveTexture(scene, entry.key || "human", look)
            : (entry.key && entry.key !== "player" ? entry.key : "human");
        const frame = entry.frame != null ? entry.frame : 7;
        super(scene, entry.x, entry.y, key, frame);

        this.entry = entry;
        this.chunk = chunk;
        this._colorTexKey = key;

        scene.add.existing(this);
        scene.mainLayer.add(this);
        this.setOrigin(0.5, 0.5);
        this.setRotation(-Math.PI / 2);
        this.applyStageAppearance();
        // Above same-y Things / slightly above blood so pools don't steal hover
        this.setDepth((Number(entry.y) || 0) + 1);

        if (!chunk.corpses?.children) {
            chunk.ensureSpriteGroups?.();
            if (!chunk.corpses) chunk.corpses = new Phaser.GameObjects.Group(scene);
        }
        chunk.corpses.add(this);
        if (!scene.corpses?.children) scene.corpses = scene.add.group();
        scene.corpses.add(this);

        this.on("pointerover", (pointer) => {
            scene.showTooltip(() => this.tooltipText(), pointer.x, pointer.y, this);
        });
        this.on("pointerout", () => {
            if (scene._hoverTarget === this) scene._hoverTarget = null;
            if (scene._tooltipTarget === this) scene.hideTooltip();
        });
        this.on("pointerdown", (pointer) => {
            if (scene.pointerOverWorldUi?.(pointer)) return;
            if (scene.restBlocksWorldUi?.()) return;
            if (!this.inRange()) return;
            const player = scene.player;
            const held = player?.getHeldItem?.();
            // Knife + unskinned corpse (not carcass) → skin, then loot opens
            if (
                held?.toolClass === "knife"
                && !this.entry?.skinned
                && this.entry?.stage !== "carcass"
                && typeof player.beginSkin === "function"
            ) {
                player.beginSkin(this);
                return;
            }
            scene.corpsePanel?.toggle?.(this);
        });

        this.on("destroy", () => {
            if (scene._hoverTarget === this) scene._hoverTarget = null;
            if (scene._tooltipTarget === this) scene.hideTooltip();
            if (scene.corpsePanel?.corpse === this) scene.corpsePanel.close();
            if (chunk.corpses?.children) chunk.corpses.remove(this);
            if (scene.corpses?.children) scene.corpses.remove(this);
        });
    }

    /** Click/hover only on the frame (and opaque pixels), not a padded circle. */
    _setCorpseHitArea() {
        const fr = this.frame;
        const w = Math.max(1, fr?.cutWidth || fr?.width || this.width || 16);
        const h = Math.max(1, fr?.cutHeight || fr?.height || this.height || 16);
        this.setInteractive({
            hitArea: new Phaser.Geom.Rectangle(0, 0, w, h),
            hitAreaCallback: Phaser.Geom.Rectangle.Contains,
            pixelPerfect: true,
            alphaTolerance: 1,
            cursor: "pointer"
        });
        if (this.input) {
            this.input.cursor = "pointer";
            this.input.enabled = true;
        }
    }

    /** Same radius as campfires / world interactions. */
    inRange() {
        const player = this.scene?.player;
        if (!player) return false;
        const pc = typeof player.bodyCenter === "function"
            ? player.bodyCenter()
            : { x: player.x, y: player.y };
        const dx = this.x - pc.x;
        const dy = this.y - pc.y;
        const r = (this.scene.tileSize || 16) * (player.interactionRange || 4);
        return dx * dx + dy * dy <= r * r;
    }

    isCarcass() {
        return this.entry?.stage === "carcass";
    }

    applyStageAppearance() {
        const frame = this.frame?.name;
        if (!this._colorTexKey) this._colorTexKey = this.texture?.key;
        if (this.isCarcass()) {
            this.clearTint();
            const grayKey = Corpse.grayscaleTextureKey(this.scene, this._colorTexKey);
            if (grayKey && this.texture?.key !== grayKey) this.setTexture(grayKey, frame);
        } else {
            if (this._colorTexKey && this.texture?.key !== this._colorTexKey) {
                this.setTexture(this._colorTexKey, frame);
            }
            this.setTint(Corpse.TINT_CORPSE);
        }
        this._setCorpseHitArea();
    }

    tooltipText() {
        const name = this.entry?.name || "Corpse";
        if (this.isCarcass()) return `${name} (carcass)`;
        const lines = [`${name} (corpse)`];
        if (this.entry?.skinned) lines.push("Skinned");
        return lines.join("\n");
    }

    /**
     * Loot granted when finishing a knife skin channel.
     * @returns {{ id: string, min: number, max: number }[]}
     */
    skinLootTable() {
        const id = this.entry?.mobId || "";
        if (id === "deer") {
            const loot = [
                { id: "raw_venison", min: 2, max: 4 },
                { id: "deer_hide", min: 1, max: 1 },
                { id: "brain", min: 1, max: 1 },
                { id: "bone", min: 2, max: 4 }
            ];
            const destroyed = typeof Body !== "undefined" && Body.isBrainDestroyed?.(this.entry?.body);
            return destroyed ? loot.filter((d) => d.id !== "brain") : loot;
        }
        if (id === "boar") {
            const loot = [
                { id: "raw_pork", min: 3, max: 5 },
                { id: "boar_hide", min: 1, max: 1 },
                { id: "brain", min: 1, max: 1 },
                { id: "bone", min: 2, max: 4 }
            ];
            const destroyed = typeof Body !== "undefined" && Body.isBrainDestroyed?.(this.entry?.body);
            return destroyed ? loot.filter((d) => d.id !== "brain") : loot;
        }
        if (id === "human") {
            const loot = [
                { id: "raw_beef", min: 2, max: 4 },
                { id: "brain", min: 1, max: 1 },
                { id: "bone", min: 1, max: 2 }
            ];
            const destroyed = typeof Body !== "undefined" && Body.isBrainDestroyed?.(this.entry?.body);
            return destroyed ? loot.filter((d) => d.id !== "brain") : loot;
        }
        return [{ id: "bone", min: 1, max: 2 }];
    }

    /** Apply skinning: mark skinned and append butcher loot. */
    applySkin() {
        if (!this.entry || this.entry.skinned || this.entry.stage === "carcass") return [];
        this.entry.skinned = true;
        if (!this.entry.loot) this.entry.loot = [];
        const gained = [];
        for (const drop of this.skinLootTable()) {
            const item = this.scene.getItem(drop.id);
            if (!item) continue;
            const lo = Math.max(0, Math.floor(Number(drop.min ?? 1) || 0));
            const hi = Math.max(lo, Math.floor(Number(drop.max ?? lo) || 0));
            let qty = Phaser.Math.Between(lo, hi);
            if (!(qty > 0)) continue;
            const maxStack = Math.max(1, Number(item.maxStack) || 1);
            // Merge into existing plain stacks of the same item (e.g. venison)
            for (const slot of this.entry.loot) {
                if (!(qty > 0) || !slot || slot.id !== item.id) continue;
                if (slot.customName || slot.food || slot.ingredients || slot.toolClass) continue;
                if (slot.quantity >= maxStack) continue;
                const add = Math.min(qty, maxStack - slot.quantity);
                const freshAt = defaultSpoilAt(item, this.scene.worldMinuteIndex?.());
                slot.spoilAt = mergeSpoilAt(slot.quantity, slot.spoilAt, add, freshAt);
                mergeDryInto(slot, slot.quantity, add, 0);
                mergeTempInto(slot, slot.quantity, add, null);
                slot.quantity += add;
                qty -= add;
                gained.push({ id: item.id, quantity: add });
            }
            while (qty > 0) {
                const add = Math.min(qty, maxStack);
                const stack = makeWorldItemStack(item, add, undefined, this.scene.worldMinuteIndex?.());
                this.entry.loot.push(stack);
                gained.push(stack);
                qty -= add;
            }
        }
        // Refresh open loot UI if this corpse is open
        const panel = this.scene.corpsePanel;
        if (panel?.visible && panel.corpse === this) {
            panel.session = (this.entry.loot || []).map((s) => cloneItemStack(s));
            if (!panel.session.length) panel.session = [null];
            panel._rebuildSlots?.();
            panel.refresh?.();
        }
        this.scene.refreshTooltip?.();
        return gained;
    }

    syncToEntry() {
        if (!this.entry) return;
        this.entry.x = this.x;
        this.entry.y = this.y;
    }

    /** Persist dense non-null loot from a session array (may include holes). */
    setLootFromSession(session) {
        this.entry.loot = (session || []).map(s => cloneItemStack(s)).filter(Boolean);
    }

    isEmpty() {
        const loot = this.entry?.loot;
        return !loot || !loot.some(Boolean);
    }

    /** Remove from chunk meta and destroy sprite. */
    removeForever() {
        const scene = this.scene;
        const x = this.x;
        const y = this.y;
        const id = this.entry?.id;
        if (scene.corpsePanel?.corpse === this) scene.corpsePanel.close(true);
        if (this.chunk?.meta?.corpses) {
            const i = this.chunk.meta.corpses.indexOf(this.entry);
            if (i >= 0) this.chunk.meta.corpses.splice(i, 1);
        }
        if (id && scene.netCorpses?.has(id)) scene.netCorpses.delete(id);
        Corpse.puffAway(scene, x, y);
        this.destroy();
    }
}
