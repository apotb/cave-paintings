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
            frame: e.frame,
            name: e.name,
            loot: e.loot,
            body: e.body || null,
            bodyPlan: e.bodyPlan || e.body?.planId || "human",
            mobId: e.mobId || null,
            skinned: !!e.skinned
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
            // Dedicated net corpses are owned by snapshots/events — keep them
            // across chunk unload so a kill doesn't vanish when streaming reloads.
            if (corpse?.entry?.netSync) {
                this.corpses.remove(corpse);
                continue;
            }
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
                    // Same RNG stream as tiles — pebbles then one-time natural mobs
                    this.populatePebbles(rand);
                    this.populateNaturalMobs(rand);
                    this.isGenerated = true;
                    resolve();
                }
            };
            slice();
        });
    }

    /**
     * Seed-deterministic pebbles on empty tiles adjacent to any rock (plains,
     * hills, mountains). Ambient hill/mountain pebbles spawn in generateTile.
     * Writes meta.lootableThings only. In-chunk neighbors only.
     */
    populatePebbles(rand) {
        const cs = this.scene.chunkSize;
        const ts = this.scene.tileSize;
        const chunkOx = this.x * this.px();
        const chunkOy = this.y * this.px();
        const PEBBLE_CHANCE = 0.05;
        const blockedGround = new Set(["water", "ice"]);

        const occupied = new Set();
        const markOccupied = (entry) => {
            if (!entry) return;
            const lx = Math.round((entry.x - ts / 2 - chunkOx) / ts);
            const ly = Math.round((entry.y - ts - chunkOy) / ts);
            if (lx >= 0 && ly >= 0 && lx < cs && ly < cs) occupied.add(`${lx},${ly}`);
        };
        for (const t of this.meta.things || []) markOccupied(t);
        for (const t of this.meta.lootableThings || []) markOccupied(t);

        const tileAt = (lx, ly) => {
            if (lx < 0 || ly < 0 || lx >= cs || ly >= cs) return null;
            return this.meta.tiles[lx + ly * cs];
        };

        const dirs = [
            [-1, -1], [0, -1], [1, -1],
            [-1, 0],           [1, 0],
            [-1, 1],  [0, 1],  [1, 1]
        ];

        for (const entry of this.meta.things || []) {
            if (entry?.id !== "rock") continue;
            const lx = Math.round((entry.x - ts / 2 - chunkOx) / ts);
            const ly = Math.round((entry.y - ts - chunkOy) / ts);

            for (const [dx, dy] of dirs) {
                const nx = lx + dx;
                const ny = ly + dy;
                const key = `${nx},${ny}`;
                if (occupied.has(key)) continue;
                const tile = tileAt(nx, ny);
                if (!tile || blockedGround.has(tile)) continue;
                if (rand() >= PEBBLE_CHANCE) continue;

                const tx = chunkOx + nx * ts;
                const ty = chunkOy + ny * ts;
                this.addLootableThing(tx, ty, "pebbles");
                occupied.add(key);
            }
        }
    }

    /**
     * Seed-deterministic passive spawns (Minecraft-style). Writes meta.mobs only;
     * sprites are created later in makeMobs(). Never runs again for this chunk.
     */
    populateNaturalMobs(rand) {
        // Dedicated MP: wildlife is server-authoritative. LocalSim SP seeds chunk meta.
        if (this.scene.isNet && !this.scene.net?.isLocal) return;
        if (!this.meta.mobs) this.meta.mobs = [];
        const rules = (this.scene.mobsData?.() || []).filter(m => m?.id && m.spawn);
        if (!rules.length) return;

        const cs = this.scene.chunkSize;
        const ts = this.scene.tileSize;
        const chunkOx = this.x * this.px();
        const chunkOy = this.y * this.px();

        // Tile keys occupied by trees/rocks/bushes/etc.
        const blocked = new Set();
        const markBlocked = (entry) => {
            if (!entry) return;
            const lx = Math.round((entry.x - ts / 2 - chunkOx) / ts);
            const ly = Math.round((entry.y - ts - chunkOy) / ts);
            if (lx >= 0 && ly >= 0 && lx < cs && ly < cs) blocked.add(`${lx},${ly}`);
        };
        for (const t of this.meta.things || []) markBlocked(t);
        for (const t of this.meta.lootableThings || []) markBlocked(t);

        for (const def of rules) {
            const sp = def.spawn;
            const allow = new Set(sp.tiles || []);
            const minCand = Math.max(1, Math.floor(Number(sp.minCandidates) || 4));
            const chance = Number(sp.chunkChance);
            if (!(chance > 0) || !allow.size) continue;

            const candidates = [];
            for (let cy = 0; cy < cs; cy++) {
                for (let cx = 0; cx < cs; cx++) {
                    const key = this.meta.tiles[cx + cy * cs];
                    if (!allow.has(key)) continue;
                    if (blocked.has(`${cx},${cy}`)) continue;
                    candidates.push({ cx, cy });
                }
            }
            if (candidates.length < minCand) continue;
            if (rand() >= chance) continue;

            let packMin = Math.max(1, Math.floor(Number(sp.packMin) || 1));
            let packMax = Math.max(packMin, Math.floor(Number(sp.packMax) || packMin));
            packMax = Math.min(packMax, candidates.length);
            packMin = Math.min(packMin, packMax);
            const pack = packMin + Math.floor(rand() * (packMax - packMin + 1));
            // Prefer packing near an anchor (Minecraft-style tight groups)
            const packRadius = Math.max(1, Math.floor(Number(sp.packRadius) || 2));

            // Shuffle, pick anchor, then take nearest remaining within radius (fallback: nearest overall)
            for (let i = candidates.length - 1; i > 0; i--) {
                const j = Math.floor(rand() * (i + 1));
                const tmp = candidates[i];
                candidates[i] = candidates[j];
                candidates[j] = tmp;
            }
            const picks = [];
            const anchor = candidates[0];
            picks.push(anchor);
            const rest = candidates.slice(1).map((c) => ({
                c,
                d: Math.abs(c.cx - anchor.cx) + Math.abs(c.cy - anchor.cy)
            }));
            rest.sort((a, b) => a.d - b.d || a.c.cx - b.c.cx || a.c.cy - b.c.cy);
            const used = new Set([`${anchor.cx},${anchor.cy}`]);
            // Prefer tiles within packRadius, then fill with next-nearest
            for (const e of rest) {
                if (picks.length >= pack) break;
                if (e.d > packRadius) continue;
                picks.push(e.c);
                used.add(`${e.c.cx},${e.c.cy}`);
            }
            for (const e of rest) {
                if (picks.length >= pack) break;
                const k = `${e.c.cx},${e.c.cy}`;
                if (used.has(k)) continue;
                picks.push(e.c);
                used.add(k);
            }

            for (const { cx, cy } of picks) {
                const tx = chunkOx + cx * ts;
                const ty = chunkOy + cy * ts;
                const x = tx;
                const y = ty + ts;
                this.meta.mobs.push({
                    id: def.id,
                    x,
                    y,
                    homeX: x,
                    homeY: y
                });
                blocked.add(`${cx},${cy}`);
            }
        }
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
            // Uncommon flint on gravel shores (~3%)
            if (randValue < 0.03) this.addLootableThing(tx, ty, 'flint');
        } else if (elevation < -0.19) {
            if (river < 0.005) {
                key = 'water';
            } else if (river < 0.0065) {
                key = 'gravel';
                if (randValue < 0.03) this.addLootableThing(tx, ty, 'flint');
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
                else if (randValue < 0.212) this.addLootableThing(tx, ty, 'apple_tree');
            } else {
                key = 'sand';
                if (randValue < 0.05) this.addThing(tx, ty, 'cactus');
                else if (randValue < 0.055) this.addLootableThing(tx, ty, 'flowering_cactus');
                else if (randValue < 0.056) this.addThing(tx, ty, 'rock');
            }
        } else if (elevation < 0.25) {
            if (randValue < 0.07) this.addThing(tx, ty, 'rock');
            if (temperature < -0.25) {
                key = 'snow_hill';
                if (randValue >= 0.07) {
                    if (randValue < 0.13) this.addThing(tx, ty, 'snow_tree');
                    else if (randValue < 0.14) this.addLootableThing(tx, ty, 'sticks', 'stick', 3);
                    else if (randValue < 0.144) this.addLootableThing(tx, ty, 'pebbles');
                    else if (randValue < 0.1455) this.addLootableThing(tx, ty, 'flint'); // rare ~0.15%
                }
            } else if (temperature < 0.25) {
                key = 'grass_hill';
                if (randValue >= 0.07) {
                    if (randValue < 0.15) this.addThing(tx, ty, 'tree');
                    else if (randValue < 0.165) this.addLootableThing(tx, ty, 'sticks');
                    else if (randValue < 0.175) this.addLootableThing(tx, ty, 'leaves');
                    else if (randValue < 0.205) this.addThing(tx, ty, 'bush');
                    else if (randValue < 0.2075) this.addLootableThing(tx, ty, 'blueberry_bush');
                    else if (randValue < 0.211) this.addLootableThing(tx, ty, 'pebbles');
                    else if (randValue < 0.2125) this.addLootableThing(tx, ty, 'flint'); // rare ~0.15%
                }
            } else {
                key = 'sand_hill';
                // randValue >= 0.07 when no rock
                if (randValue >= 0.07 && randValue < 0.12) this.addLootableThing(tx, ty, 'cactus');
                else if (randValue >= 0.12 && randValue < 0.125) this.addLootableThing(tx, ty, 'flowering_cactus');
                else if (randValue >= 0.125 && randValue < 0.13) this.addLootableThing(tx, ty, 'pebbles');
                else if (randValue >= 0.13 && randValue < 0.1315) this.addLootableThing(tx, ty, 'flint'); // rare ~0.15%
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
            else if (randValue < 0.06) this.addLootableThing(tx, ty, 'pebbles');
            else if (randValue < 0.064) this.addLootableThing(tx, ty, 'flint'); // sparse ~0.4% (still > hills)
        } else if (elevation < 0.7) {
            key = 'mountain';
            if (randValue < 0.012) this.addLootableThing(tx, ty, 'pebbles');
            else if (randValue < 0.016) this.addLootableThing(tx, ty, 'flint'); // sparse ~0.4%
        } else {
            key = 'snow_mountain';
            if (randValue < 0.012) this.addLootableThing(tx, ty, 'pebbles');
            else if (randValue < 0.016) this.addLootableThing(tx, ty, 'flint'); // sparse ~0.4%
        }

        this.meta.tiles[cx + cy * this.scene.chunkSize] = key;
    }

    addThing(tileX, tileY, id) {
        // Reserved for the spawn sign — never place natural Things at origin
        if (tileX === 0 && tileY === 0) return;
        this.meta.things.push({
            x: tileX + this.scene.tileSize / 2,
            y: tileY + this.scene.tileSize,
            id
        });
    }

    addLootableThing(tileX, tileY, id) {
        // Reserved for the spawn sign — never place natural lootables at origin
        if (tileX === 0 && tileY === 0) return;
        const x = tileX + this.scene.tileSize / 2;
        const y = tileY + this.scene.tileSize;
        this.meta.lootableThings.push({
            x,
            y,
            id,
            uid: `lt_${Math.round(x)}_${Math.round(y)}_${id}`
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
                if (meta.id === "rock") {
                    this.scene.wireRockKnapping?.(thing);
                } else if (meta.id === "sign") {
                    thing.entry = meta;
                    if (meta.spawnHint && this.scene._spawnSignTooltip) {
                        meta.tooltip = this.scene._spawnSignTooltip();
                    }
                    this.scene.wireThingTooltip?.(thing);
                }
            }
            this.things.add(thing);
        }
        if (!this.meta.lootableThings) this.meta.lootableThings = [];
        const dedicated = !!(this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal);
        for (const entry of this.meta.lootableThings) {
            // Dedicated: server owns regrow. Local catch-up desynced harvested bushes.
            if (!dedicated) this.scene.applyDueLootableRegrow?.(entry);
            if (entry.gone) continue;
            if (!entry?.id) continue;
            this.things.add(new LootableThing(this.scene, entry, this));
        }
        this.scene.markLightDirty?.();
        return Promise.resolve();
    }

    async makeMobs() {
        // Dedicated MP: server owns wildlife (SimCreature); show snapshot puppets only.
        if (this.scene.isNet && !this.scene.net?.isLocal) {
            return Promise.resolve();
        }
        if (!this.meta.mobs) this.meta.mobs = [];
        const live = this.scene.mobs?.getChildren() || [];
        for (const entry of this.meta.mobs) {
            if (!entry?.id) continue;
            if (live.some(m => m.entry === entry)) continue;
            // Stable id for MOB_DEATH sync (server WorldGen may omit uid)
            if (!entry.uid) {
                entry.uid = `mob-${this.x},${this.y}-${Math.round(entry.x)}-${Math.round(entry.y)}`;
            }
            new LivingMob(this.scene, entry, this);
        }
        return Promise.resolve();
    }

    async makeDrops() {
        // Dedicated MP: ground loot from snapshots. LocalSim SP uses chunk meta + snapshots.
        if (this.scene.isNet && !this.scene.net?.isLocal) return Promise.resolve();
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
        // Dedicated MP: corpses from server snapshots (same as drops/mobs).
        if (this.scene.isNet && !this.scene.net?.isLocal) return Promise.resolve();
        if (!this.meta.corpses) this.meta.corpses = [];
        // Empty corpses despawn when the last item is taken (CorpsePanel → removeForever)
        const live = this.corpses?.getChildren() || [];
        for (const entry of this.meta.corpses) {
            if (!entry) continue;
            if (live.some(c => c.entry === entry)) continue;
            new Corpse(this.scene, entry, this);
        }
        return Promise.resolve();
    }
}
