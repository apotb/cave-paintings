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
        // Skip empty mob-style corpses; player death only spawns when loot exists
        if (!loot.length) return null;

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
        if (scene.corpsePanel?.corpse === this) scene.corpsePanel.close(true);
        if (this.chunk?.meta?.corpses) {
            const i = this.chunk.meta.corpses.indexOf(this.entry);
            if (i >= 0) this.chunk.meta.corpses.splice(i, 1);
        }
        this.destroy();
    }
}
