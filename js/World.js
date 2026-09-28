const NOISE_SCALE = 6000;

function _freshWorldSeed() {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        return crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
    }
    return (Math.random() * 0x100000000) >>> 0;
}

let worldSeed = _freshWorldSeed();
while (true) {
    noise.seed(worldSeed);
    const elevation = octaveNoise2D(0, 0, 2, 0.5, 2.5, 0);
    // const temperature = octaveNoise2D(0, 0, 3, 0.2, 4.2, 1);
    const river = Math.abs(octaveNoise2D(0, 0, 3, 1.2, 0.7, 2));
    if (elevation > -0.2 && elevation < 0.25 && river > 0.005) break;
    worldSeed = (worldSeed + 1) >>> 0;
}

function octaveNoise2D(x, y, octaves=1, persistence=1.0, lacunarity=1.0, seed=0) {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    const rand = mulberry32(seed);
    x += rand() * 1337;
    y += rand() * 1337;

    for (let i = 0; i < octaves; i++) {
        total += noise.perlin2(x * frequency, y * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }

    return total / maxValue;
}

/** Tile texture key from WorldGen (no decor roll). */
function tileKeyFromNoise(px, py) {
    return WorldGen.generateTileKey(px, py, () => 1).key;
}

class Chunk {
    constructor(scene, x, y, meta) {
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.things = null;
        this.mobs = null;
        this.drops = null;
        this.corpses = null;
        this.isLoaded = false;
        this.isGenerated = false;
        this.meta = meta || {
            tiles: new Array(scene.chunkSize * scene.chunkSize),
            things: [],
            lootableThings: [],
            mobs: [],
            drops: [],
            bloodStains: [],
            corpses: []
        };
        if (!this.meta.mobs) this.meta.mobs = [];
        if (!this.meta.drops) this.meta.drops = [];
        if (!this.meta.bloodStains) this.meta.bloodStains = [];
        if (!this.meta.corpses) this.meta.corpses = [];
    }

    toJSON() {
        this.flushMobs();
        this.flushDrops();
        const bloodStains = (this.meta.bloodStains || []).map(e => ({
            x: e.x,
            y: e.y,
            radius: e.radius,
            lifeMinutes: e.lifeMinutes,
            kind: e.kind || "blood",
            color: e.color,
            alpha: e.alpha
        }));
        const corpses = (this.meta.corpses || []).map(e => ({
            id: e.id,
            x: e.x,
            y: e.y,
            key: e.key,
            look: e.look || null,
            frame: e.frame,
            name: e.name,
            loot: e.loot,
            body: e.body || null,
            bodyPlan: e.bodyPlan || e.body?.planId || "human",
            mobId: e.mobId || null,
            skinned: !!e.skinned,
            playerCorpse: !!e.playerCorpse,
            diedAt: e.diedAt != null ? e.diedAt : undefined,
            stage: e.stage || "corpse"
        }));
        return {
            x: this.x,
            y: this.y,
            tiles: this.meta.tiles,
            things: this.meta.things,
            lootableThings: this.meta.lootableThings,
            mobs: this.meta.mobs,
            drops: this.meta.drops,
            bloodStains,
            corpses,
            wanderers: this.meta.wanderers || []
        };
    }

    seed() {
        return hash2D(this.x, this.y, worldSeed);
    }

    px() {
        return this.scene.chunkPx();
    }

    ensureSpriteGroups() {
        if (this.things) return;
        // `scene.add.group()` puts the Group on the Scene update list even when
        // runChildUpdate is false. After exploring, those groups never left
        // (profiler: updateList 571 → 2700 and did not shrink on return).
        this.things = new Phaser.GameObjects.Group(this.scene);
        this.mobs = new Phaser.GameObjects.Group(this.scene);
        this.drops = new Phaser.GameObjects.Group(this.scene);
        this.corpses = new Phaser.GameObjects.Group(this.scene);
    }

    unload() {
        this._loadGen = (this._loadGen || 0) + 1;
        if (!this.isLoaded) {
            this._destroyThingSprites();
            return;
        }
        this.isLoaded = false;
        this.scene._untrackLoadedChunk?.(this);
        if (this.rt) {
            if (typeof this.scene.recycleChunkRt === "function") this.scene.recycleChunkRt(this.rt);
            else this.rt.destroy();
            this.rt = null;
        }
        this.scene.dropChunkPaint?.(this);
        this._destroyThingSprites();
        this._clearBloodSprites();
        this.flushMobs();
        this.flushDrops();
        for (const mob of this.mobs?.getChildren?.().slice() || []) {
            this.scene.damageables?.remove(mob);
            this.scene.mobs?.remove(mob);
            mob.destroy();
        }
        this.mobs?.clear(false, false);
        for (const drop of this.drops?.getChildren?.().slice() || []) {
            if (typeof drop.persistDestroy === "function") drop.persistDestroy();
            else drop.destroy();
        }
        this.drops?.clear(false, false);
        for (const corpse of this.corpses?.getChildren?.().slice() || []) {
            // Dedicated net corpses are owned by snapshots/events — keep them
            // across chunk unload so a kill doesn't vanish when streaming reloads.
            if (corpse?.entry?.netSync) {
                this.corpses.remove(corpse);
                continue;
            }
            this.scene.corpses?.remove(corpse);
            corpse.destroy();
        }
        this.corpses?.clear(false, false);
        this.scene.markLightDirty?.();
    }

    _destroyThingSprites() {
        const kids = this.things?.getChildren?.() || [];
        for (const thing of kids.slice()) {
            try { thing.destroy(); } catch (_) {}
        }
        this.things?.clear(false, false);
    }

    _loadStillCurrent(gen) {
        return this.isLoaded && gen === (this._loadGen || 0);
    }

    async load() {
        if (this.isLoaded) return;
        const gen = this._loadGen || 0;
        this.isLoaded = true;
        this.ensureSpriteGroups();
        this.scene._trackLoadedChunk?.(this);
        await this.generate();
        if (!this._loadStillCurrent(gen)) return;
        this.render();
        if (!this._loadStillCurrent(gen)) return;
        await this.makeThings();
        if (!this._loadStillCurrent(gen)) {
            this._destroyThingSprites();
            return;
        }
        await this.makeBloodStains();
        if (!this._loadStillCurrent(gen)) return;
        await this.makeMobs();
        if (!this._loadStillCurrent(gen)) return;
        this.scene.partySys?.loadChunkWanderers?.(this);
        await this.makeDrops();
        if (!this._loadStillCurrent(gen)) return;
        await this.makeCorpses();
        if (!this._loadStillCurrent(gen)) return;
    }

    _clearBloodSprites() {
        for (const e of this.meta.bloodStains || []) {
            e._sprite = null;
        }
        if (this._bloodSprites) {
            for (const s of this._bloodSprites) s?.destroy?.();
            this._bloodSprites = [];
        }
        this._bloodGfx?.destroy?.();
        this._bloodGfx = null;
        this._bloodRt?.destroy?.();
        this._bloodRt = null;
    }

    async makeBloodStains() {
        if (!this.meta.bloodStains) this.meta.bloodStains = [];
        if (this.meta.bloodStains.length) {
            this.scene.rebuildBloodGfx?.(this);
        }
        return Promise.resolve();
    }

    flushMobs() {
        this.mobs?.children?.each(mob => {
            if (typeof mob.syncToEntry === "function") mob.syncToEntry({ forceBody: true });
        });
    }

    flushDrops() {
        this.drops?.children?.each(drop => {
            if (typeof drop.syncToEntry === "function") drop.syncToEntry();
        });
    }

    generate() {
        // SimWorld owns terrain. Chunk tiles arrive as CHUNK payloads.
        return Promise.resolve();
    }

    async render() {
        if (typeof this.scene.enqueueChunkPaint === "function") {
            this.scene.enqueueChunkPaint(this);
            return;
        }
        await this._paintGround();
    }

    _paintGround() {
        if (!this.isLoaded) return Promise.resolve();
        this.rt = typeof this.scene.allocChunkRt === "function"
            ? this.scene.allocChunkRt(this.x * this.px(), this.y * this.px())
            : this.scene.make.renderTexture({
                x: this.x * this.px(),
                y: this.y * this.px(),
                width: this.px(),
                height: this.px(),
                add: false
            }).setOrigin(0).setDepth(0).setVisible(false);

        const cs = this.scene.chunkSize;
        const ts = this.scene.tileSize;
        for (let i = cs * cs - 1; i >= 0; i--) {
            const key = this.meta.tiles[i];
            if (!key || key === "water") continue;
            const x = i % cs;
            const y = (i / cs) | 0;
            this.rt.draw(key, x * ts, y * ts);
        }
        const layer = this.scene.groundLayer;
        layer.add(this.rt);
        this.rt.setVisible(true);
        // Paint is queued and often runs after makeThings. A later add() would
        // cover floor decals (clay) even though they are already in the layer.
        // Keep the tile RT just above the water backdrop, under drops/decals.
        const list = layer.list;
        if (Array.isArray(list)) {
            const i = list.indexOf(this.rt);
            if (i >= 0) list.splice(i, 1);
            const water = this.scene._waterSprite;
            const wi = water ? list.indexOf(water) : -1;
            list.splice(Math.max(0, wi + 1), 0, this.rt);
        }
        return Promise.resolve();
    }

    async makeThings() {
        for (const meta of this.meta.things) {
            if (typeof this.scene._spawnThingSprite === "function") {
                this.scene._spawnThingSprite(this, meta, false);
                continue;
            }
            let thing;
            if (meta.id === 'campfire' || meta.id === 'unlit_campfire') {
                thing = new Campfire(this.scene, meta);
            } else if (this.scene.getThing(meta.id)?.craftStation) {
                thing = new CraftStation(this.scene, meta);
            } else if (
                (typeof Research !== "undefined" && Research.isPaintingCircle?.(this.scene.getThing(meta.id), meta))
                || Array.isArray(meta.slots)
                || this.scene.getThing(meta.id)?.storage
            ) {
                thing = Storage.create(this.scene, meta);
            } else {
                thing = new Thing(this.scene, meta.x, meta.y, meta.id, meta);
                if (meta.id === "sign") {
                    if (meta.spawnHint && this.scene._spawnSignTooltip) {
                        meta.tooltip = this.scene._spawnSignTooltip();
                    }
                    this.scene.wireThingTooltip?.(thing);
                }
            }
            this.things.add(thing);
        }
        if (!this.meta.lootableThings) this.meta.lootableThings = [];
        for (const entry of this.meta.lootableThings) {
            if (entry.gone) continue;
            if (!entry?.id) continue;
            this.things.add(new LootableThing(this.scene, entry, this));
        }
        this.scene.markLightDirty?.();
        return Promise.resolve();
    }

    async makeMobs() {
        // SimWorld owns wildlife. Snapshot puppets live in scene.netMobs.
        return Promise.resolve();
    }

    async makeDrops() {
        // Ground loot comes from snapshots.
        return Promise.resolve();
    }

    async makeCorpses() {
        // Corpses come from snapshots.
        return Promise.resolve();
    }
}
