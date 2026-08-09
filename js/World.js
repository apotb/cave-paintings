const NOISE_SCALE = 6000;

let worldSeed = Date.now();
while (true) {
    noise.seed(worldSeed);
    const elevation = octaveNoise2D(0, 0, 2, 0.5, 2.5, 0);
    // const temperature = octaveNoise2D(0, 0, 3, 0.2, 4.2, 1);
    const river = Math.abs(octaveNoise2D(0, 0, 3, 1.2, 0.7, 2));
    if (elevation > -0.2 && elevation < 0.25 && river > 0.005) break;
    worldSeed++;
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

class Chunk {
    constructor(scene, x, y, meta) {
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.things = this.scene.add.group();
        this.mobs = this.scene.add.group();
        this.drops = this.scene.add.group();
        this.corpses = this.scene.add.group();
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
            lifeMinutes: e.lifeMinutes
        }));
        const corpses = (this.meta.corpses || []).map(e => ({
            id: e.id,
            x: e.x,
            y: e.y,
            key: e.key,
            frame: e.frame,
            name: e.name,
            loot: (e.loot || []).map(s => cloneItemStack(s)).filter(Boolean),
            body: e.body || null,
            bodyPlan: e.bodyPlan || e.body?.planId || "human"
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
            corpses
        };
    }

    seed() {
        return hash2D(this.x, this.y, worldSeed);
    }

    px() {
        return this.scene.chunkPx();
    }

    unload() {
        if (!this.isLoaded) return;
        this.isLoaded = false;
        if (this.rt) {
            this.rt.destroy();
            this.rt = null;
        }
        this.things.children.each(thing => thing.destroy());
        this._clearBloodSprites();
        this.flushMobs();
        this.flushDrops();
        for (const mob of this.mobs.getChildren().slice()) {
            this.scene.damageables?.remove(mob);
            this.scene.mobs?.remove(mob);
            mob.destroy();
        }
        this.mobs.clear(false, false);
        for (const drop of this.drops.getChildren().slice()) {
            if (typeof drop.persistDestroy === "function") drop.persistDestroy();
            else drop.destroy();
        }
        this.drops.clear(false, false);
        for (const corpse of this.corpses.getChildren().slice()) {
            this.scene.corpses?.remove(corpse);
            corpse.destroy();
        }
        this.corpses.clear(false, false);
        this.scene.markLightDirty?.();
    }

    async load() {
        if (this.isLoaded) return;
        this.isLoaded = true;
        await this.generate();
        await this.render();
        await this.makeThings();
        await this.makeBloodStains();
        await this.makeMobs();
        await this.makeDrops();
        await this.makeCorpses();
    }

    _clearBloodSprites() {
        for (const e of this.meta.bloodStains || []) {
            e._sprite = null;
        }
        if (this._bloodSprites) {
            for (const s of this._bloodSprites) s?.destroy?.();
            this._bloodSprites = [];
        }
        this._bloodGfx?.destroy();
        this._bloodGfx = null;
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
        if (this.isGenerated) return Promise.resolve();

        const rand = mulberry32(this.seed());
        const cs = this.scene.chunkSize;
        const ts = this.scene.tileSize;

        const BUDGET_MS = 0.001;
        let i = cs * cs - 1;
        return new Promise(resolve => {
            const slice = () => {
                const start = performance.now();
                while (i >= 0 && (performance.now() - start) < BUDGET_MS) {
                    const x = i % cs;
                    const y = (i / cs) | 0;
                    const tx = this.x * this.px() + x * ts;
                    const ty = this.y * this.px() + y * ts;
                    this.generateTile(x, y, tx, ty, rand);
                    i--;
                }
                if (i >= 0) this.scene.time.delayedCall(0, slice);
                else {
                    this.isGenerated = true;
                    resolve();
                }
            };
            slice();
        });
    }

    generateTile(cx, cy, tx, ty, rand) {
        const inv = 1 / NOISE_SCALE;
        const nx = tx * inv;
        const ny = ty * inv;
        const elevation = octaveNoise2D(nx, ny, 2, 0.5, 2.5, 0);
        const temperature = octaveNoise2D(nx, ny, 3, 0.2, 4.2, 1);
        const river = Math.abs(octaveNoise2D(nx, ny, 3, 1.2, 0.7, 2));

        const randValue = rand();
        let key = '';

        if (river < 0.005) {
            key = 'water';
        } else if (elevation < -0.2) {
            if (temperature < -0.4) {
                key = 'ice';
            } else {
                key = 'water';
            }
        } else if (river < 0.0065 && elevation < 0.14) {
            key = 'gravel';
        } else if (elevation < -0.19) {
            if (river < 0.005) {
                key = 'water';
            } else if (river < 0.0065) {
                key = 'gravel';
            } else if (temperature < -0.25) {
                key = 'snow_beach';
            } else {
                key = 'sand';
                if (randValue < 0.05) this.addThing(tx, ty, 'palm_tree');
                else if (randValue < 0.065) this.addLootableThing(tx, ty, 'coconut_tree');
                else if (randValue < 0.07) this.addLootableThing(tx, ty, 'sticks');
            }
        } else if (elevation < 0.15) {
            if (temperature < -0.25) {
                key = 'snow';
                if (randValue < 0.1) this.addThing(tx, ty, 'snow_tree');
                else if (randValue < 0.12) this.addLootableThing(tx, ty, 'sticks');
                else if (randValue < 0.14) this.addThing(tx, ty, 'snow_bush');
            } else if (temperature < 0.25) {
                key = 'grass';
                if (randValue < 0.10) this.addThing(tx, ty, 'tree');
                else if (randValue < 0.15) this.addThing(tx, ty, 'bush');
                else if (randValue < 0.18) this.addLootableThing(tx, ty, 'sticks');
                else if (randValue < 0.185) this.addThing(tx, ty, 'rock');
                else if (randValue < 0.19) this.addLootableThing(tx, ty, 'blueberry_bush');
                else if (randValue < 0.21) this.addLootableThing(tx, ty, 'leaves');
                else if (randValue < 0.211) this.addLootableThing(tx, ty, 'apple_tree');
            } else {
                key = 'sand';
                if (randValue < 0.05) this.addThing(tx, ty, 'cactus');
                else if (randValue < 0.055) this.addLootableThing(tx, ty, 'flowering_cactus');
                else if (randValue < 0.056) this.addThing(tx, ty, 'rock');
            }
        } else if (elevation < 0.25) {
            if (randValue < 0.1) this.addThing(tx, ty, 'rock');
            if (temperature < -0.25) {
                key = 'snow_hill';
                if (randValue >= 0.1) {
                    if (randValue < 0.13) this.addThing(tx, ty, 'snow_tree');
                    else if (randValue < 0.14) this.addLootableThing(tx, ty, 'sticks', 'stick', 3);
                }
            } else if (temperature < 0.25) {
                key = 'grass_hill';
                if (randValue >= 0.1) {
                    if (randValue < 0.15) this.addThing(tx, ty, 'tree');
                    else if (randValue < 0.165) this.addLootableThing(tx, ty, 'sticks');
                    else if (randValue < 0.19) this.addThing(tx, ty, 'bush');
                    else if (randValue < 0.1925) this.addLootableThing(tx, ty, 'blueberry_bush');
                }
            } else {
                key = 'sand_hill';
                if (randValue >= 0.1) {
                    if (randValue < 0.02) this.addLootableThing(tx, ty, 'cactus');
                    else if (randValue < 0.025) this.addLootableThing(tx, ty, 'flowering_cactus');
                }
            }
        } else if (elevation < 0.55) {
            if (temperature < -0.25) {
                key = 'snow_mountain';
            } else if (temperature < 0.25) {
                key = 'mountain';
            } else {
                key = 'mesa';
            }
            if (randValue < 0.05) this.addThing(tx, ty, 'rock');
        } else if (elevation < 0.7) {
            key = 'mountain';
        } else {
            key = 'snow_mountain';
        }

        this.meta.tiles[cx + cy * this.scene.chunkSize] = key;
    }

    addThing(tileX, tileY, id) {
        this.meta.things.push({
            x: tileX + this.scene.tileSize / 2,
            y: tileY + this.scene.tileSize,
            id
        });
    }

    addLootableThing(tileX, tileY, id) {
        this.meta.lootableThings.push({
            x: tileX + this.scene.tileSize / 2,
            y: tileY + this.scene.tileSize,
            id
        });
    }

    async render() {
        this.rt = this.scene.make.renderTexture({
            x: this.x * this.px(),
            y: this.y * this.px(),
            width: this.px(),
            height: this.px(),
            add: false
        }).setOrigin(0).setDepth(0).setVisible(false);

        const cs = this.scene.chunkSize;
        const ts = this.scene.tileSize;

        const BUDGET_MS = 0.001;
        let i = cs * cs - 1;
        return new Promise(resolve => {
            const slice = () => {
                if (!this.rt) return;
                const start = performance.now();
                while (i >= 0 && (performance.now() - start) < BUDGET_MS) {
                    const x = i % cs, y = (i / cs) | 0;
                    const key = this.meta.tiles[i];
                    if (key && key !== 'water') this.rt.draw(key, x * ts, y * ts);
                    i--;
                }
                if (i >= 0) this.scene.time.delayedCall(0, slice);
                else {
                    this.scene.groundLayer.add(this.rt);
                    this.rt.setVisible(true);
                    resolve();
                }
            };
            slice();

        });
    }

    async makeThings() {
        for (const meta of this.meta.things) {
            let thing;
            if (meta.id === 'campfire' || meta.id === 'unlit_campfire') {
                thing = new Campfire(this.scene, meta);
            } else {
                thing = new Thing(this.scene, meta.x, meta.y, meta.id);
            }
            this.things.add(thing);
        }
        if (!this.meta.lootableThings) this.meta.lootableThings = [];
        for (const entry of this.meta.lootableThings) {
            // Catch up regrows that came due while this chunk was unloaded
            this.scene.applyDueLootableRegrow?.(entry);
            if (entry.gone) continue;
            if (!entry?.id) continue;
            this.things.add(new LootableThing(this.scene, entry, this));
        }
        this.scene.markLightDirty?.();
        return Promise.resolve();
    }

    async makeMobs() {
        if (!this.meta.mobs) this.meta.mobs = [];
        const live = this.scene.mobs?.getChildren() || [];
        for (const entry of this.meta.mobs) {
            if (!entry?.id) continue;
            if (live.some(m => m.entry === entry)) continue;
            new LivingMob(this.scene, entry, this);
        }
        return Promise.resolve();
    }

    async makeDrops() {
        if (!this.meta.drops) this.meta.drops = [];
        const live = this.scene.droppedItems?.getChildren() || [];
        for (const entry of this.meta.drops) {
            if (!entry?.id || !(entry.quantity > 0)) continue;
            if (live.some(d => d.entry === entry)) continue;
            new DroppedItem(this.scene, entry, this);
        }
        return Promise.resolve();
    }

    async makeCorpses() {
        if (!this.meta.corpses) this.meta.corpses = [];
        // Drop empty corpse entries
        this.meta.corpses = this.meta.corpses.filter(e => e?.loot?.length);
        const live = this.corpses?.getChildren() || [];
        for (const entry of this.meta.corpses) {
            if (!entry?.loot?.length) continue;
            if (live.some(c => c.entry === entry)) continue;
            new Corpse(this.scene, entry, this);
        }
        return Promise.resolve();
    }
}
