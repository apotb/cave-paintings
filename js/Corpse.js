/**
 * Persistent corpse: gray, face-right, rotated -90° CCW. Loot lives in chunk.meta.corpses.
 */
class Corpse extends Phaser.GameObjects.Sprite {
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

        const entry = {
            id: opts.id || `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            x: opts.x,
            y: opts.y,
            key: opts.key || "player",
            frame: opts.frame != null ? opts.frame : 7,
            name: opts.name || "Corpse",
            loot,
            body: opts.body || null,
            bodyPlan: opts.bodyPlan || opts.body?.planId || "human"
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
        const key = entry.key || "player";
        const frame = entry.frame != null ? entry.frame : 7;
        super(scene, entry.x, entry.y, key, frame);

        this.entry = entry;
        this.chunk = chunk;

        scene.add.existing(this);
        scene.mainLayer.add(this);
        this.setOrigin(0.5, 0.5);
        this.setRotation(-Math.PI / 2);
        this.setTint(0x888888);
        this.setDepth(entry.y);

        if (!chunk.corpses) chunk.corpses = scene.add.group();
        chunk.corpses.add(this);
        if (!scene.corpses) scene.corpses = scene.add.group();
        scene.corpses.add(this);

        this.setInteractive({ cursor: "pointer", pixelPerfect: false });
        this.on("pointerover", (pointer) => {
            const name = entry.name || "Corpse";
            scene.showTooltip(`${name} (corpse)`, pointer.x, pointer.y, this);
        });
        this.on("pointerout", () => {
            if (scene._hoverTarget === this) scene._hoverTarget = null;
            if (scene._tooltipTarget === this) scene.hideTooltip();
        });
        this.on("pointerdown", () => {
            if (!this.inRange()) return;
            scene.corpsePanel?.toggle?.(this);
        });

        this.on("destroy", () => {
            if (scene._hoverTarget === this) scene._hoverTarget = null;
            if (scene._tooltipTarget === this) scene.hideTooltip();
            if (scene.corpsePanel?.corpse === this) scene.corpsePanel.close();
            chunk.corpses?.remove(this);
            scene.corpses?.remove(this);
        });
    }

    /** Same radius as campfires / world interactions. */
    inRange() {
        const player = this.scene?.player;
        if (!player) return false;
        const dx = this.x - player.x;
        const dy = this.y - player.y;
        const r = (this.scene.tileSize || 16) * (player.interactionRange || 4);
        return dx * dx + dy * dy <= r * r;
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
        return !(this.entry.loot && this.entry.loot.length);
    }

    /** Remove from chunk meta and destroy sprite. */
    removeForever() {
        const scene = this.scene;
        const x = this.x;
        const y = this.y;
        if (scene.corpsePanel?.corpse === this) scene.corpsePanel.close(true);
        if (this.chunk?.meta?.corpses) {
            const i = this.chunk.meta.corpses.indexOf(this.entry);
            if (i >= 0) this.chunk.meta.corpses.splice(i, 1);
        }
        Corpse.puffAway(scene, x, y);
        this.destroy();
    }
}
