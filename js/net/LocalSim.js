/**
 * In-browser world session for Singleplayer — same NetClient surface as WebSocket MP.
 * Persists worlds via WorldStore; characters stay in CharacterStore (client-owned).
 */
class LocalSim {
    /**
     * @param {{ world: object, character: object }} opts
     */
    constructor(opts) {
        this.isLocal = true;
        this.connected = false;
        this.playerId = null;
        this.handlers = {};
        this._buffering = true;
        this._queue = [];
        this.world = opts.world;
        this.character = opts.character;
        this.scene = null;
        this._pawn = null;
        this._knownChunks = new Set();
        this._inflightChunks = new Set();
        this._interestBusy = false;
        this._interestAgain = false;
        this._interestForce = false;
        this._interestCx = null;
        this._interestCy = null;
        this._interestR = null;
        this._tickTimer = null;
        this._snapAcc = 0;
        this._minuteAcc = 0;
        this._lastTick = 0;
        this._persistTimer = null;
        this._closed = false;
        this._paused = false;
        /** @type {Promise<void>} */
        this._persistTail = Promise.resolve();
    }

    on(type, fn) {
        if (!this.handlers[type]) this.handlers[type] = [];
        this.handlers[type].push(fn);
    }

    off(type, fn) {
        const list = this.handlers[type];
        if (!list) return;
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
    }

    emit(type, payload) {
        for (const fn of this.handlers[type] || []) {
            try {
                fn(payload);
            } catch (e) {
                console.error(e);
            }
        }
    }

    _dispatch(type, payload) {
        if (this._buffering && type !== NetProtocol.Types.WELCOME && type !== NetProtocol.Types.REJECT) {
            this._queue.push({ type, payload });
            if (this._queue.length > 500) this._queue.shift();
            return;
        }
        this.emit(type, payload);
    }

    flushAndListen() {
        this._buffering = false;
        const q = this._queue;
        this._queue = [];
        for (const { type, payload } of q) this.emit(type, payload);
    }

    /** SceneMain calls this after create so we can generate chunks with Chunk APIs. */
    attachScene(scene) {
        this.scene = scene;
        this._kickInterest(true);
    }

    async connect() {
        this._closed = false;
        this.connected = true;
        this._buffering = true;
        this._queue = [];

        if (this.world.seed == null) {
            let seed = (typeof WorldStore !== "undefined" && WorldStore.randomSeed)
                ? WorldStore.randomSeed()
                : ((typeof crypto !== "undefined" && crypto.getRandomValues)
                    ? (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0)
                    : ((Math.random() * 0x100000000) >>> 0));
            if (typeof WorldStore !== "undefined" && WorldStore.findPlayableSeed) {
                seed = WorldStore.findPlayableSeed(seed);
            } else if (typeof noise !== "undefined" && typeof octaveNoise2D === "function") {
                while (true) {
                    noise.seed(seed);
                    const elevation = octaveNoise2D(0, 0, 2, 0.5, 2.5, 0);
                    const river = Math.abs(octaveNoise2D(0, 0, 3, 1.2, 0.7, 2));
                    if (elevation > -0.2 && elevation < 0.25 && river > 0.005) break;
                    seed = (seed + 1) >>> 0;
                }
            }
            this.world.seed = seed;
            await WorldStore.put(this.world);
        }
        if (typeof noise !== "undefined") noise.seed(this.world.seed);
        if (typeof worldSeed !== "undefined") worldSeed = this.world.seed;

        const char = this.character;
        this.playerId = char.id;
        const savedPose = this.world.poses?.[char.id];
        const hasPose = Number.isFinite(savedPose?.x) && Number.isFinite(savedPose?.y);
        // Temporary stand-in; SceneMain.ensureSpawnSign picks a free tile like respawn
        const spawnX = this.world.spawn?.x ?? 8;
        const spawnY = this.world.spawn?.y ?? 16;
        this._pawn = {
            id: char.id,
            name: char.name || "Player",
            x: hasPose ? savedPose.x : spawnX,
            y: hasPose ? savedPose.y : spawnY,
            facing: hasPose && savedPose.facing ? savedPose.facing : "down",
            moveX: 0,
            moveY: 0,
            sprint: false,
            kc: char.kc ?? 1200,
            saturation: char.saturation ?? 0,
            stomach: char.stomach ?? 1600,
            inventory: Array.isArray(char.inventory)
                ? JSON.parse(JSON.stringify(char.inventory))
                : CharacterStore.emptyInv(5),
            equipment: char.equipment
                ? JSON.parse(JSON.stringify(char.equipment))
                : { head: null, torso: null, legs: null, feet: null, waist: [] },
            hotbarIndex: char.hotbarIndex || 0,
            hp: char.hp ?? 100,
            mhp: char.mhp ?? 100,
            body: char.body ? JSON.parse(JSON.stringify(char.body)) : null,
            look: typeof Look !== "undefined"
                ? Look.normalizeLook(char.look)
                : (char.look || null),
            dead: false,
            viewChunks: 6,
            poseAuth: true
        };

        if (!this.world.clock) {
            this.world.clock = { gameDay: 1, gameMinutes: 8 * 60, tickSpeed: 1 };
        }

        const welcome = {
            playerId: this.playerId,
            characterId: this.playerId,
            seed: this.world.seed,
            worldName: this.world.name || "World",
            clock: { ...this.world.clock },
            spawn: this.world.spawn,
            motd: "",
            you: this._youPayload(),
            local: true,
            /** No logout pose yet — client should run pickRandomSpawnTile. */
            firstSpawn: !hasPose
        };

        this._dispatch(NetProtocol.Types.WELCOME, welcome);
        this._lastTick = performance.now();
        this._tickTimer = setInterval(() => this._tick(), 1000 / 60);
        this._persistTimer = setInterval(() => this._persistWorld(), 30000);

        return welcome;
    }

    /** Freeze world clock / hunger ticks (singleplayer pause menu). */
    setPaused(paused) {
        const on = !!paused;
        if (this._paused === on) return;
        this._paused = on;
        if (on) {
            if (this._tickTimer) {
                clearInterval(this._tickTimer);
                this._tickTimer = null;
            }
            return;
        }
        if (this._closed || !this.connected || this._tickTimer) return;
        this._lastTick = performance.now();
        this._tickTimer = setInterval(() => this._tick(), 1000 / 60);
    }

    auth() {
        // connect() already authed from character snapshot
    }

    send(_type, _payload) {
        // unused — sendMove/sendAction used instead
    }

    sendMove(move) {
        if (!this.connected || !this._pawn) return;
        const p = this._pawn;
        if (Number.isFinite(move.px) && Number.isFinite(move.py)) {
            p.x = move.px;
            p.y = move.py;
            p.poseAuth = true;
        }
        if (move.facing) p.facing = move.facing;
        p.sprint = !!move.sprint;
        if (Number.isFinite(move.viewChunks)) {
            p.viewChunks = Math.max(3, Math.min(24, Math.floor(move.viewChunks)));
        }
        const len = Math.hypot(move.x || 0, move.y || 0);
        if (len > 0) {
            p.moveX = move.x / len;
            p.moveY = move.y / len;
        } else {
            p.moveX = 0;
            p.moveY = 0;
        }
        this._kickInterest(false);
    }

    sendAction(action) {
        if (!this.connected || !this._pawn) return;
        const type = action?.type;
        const p = this._pawn;
        if (type === NetProtocol.Actions.RESYNC) {
            this._knownChunks.clear();
            this._inflightChunks.clear();
            this._interestCx = null;
            this._interestCy = null;
            this._interestR = null;
            this._kickInterest(true);
            this._dispatch(NetProtocol.Types.YOU, this._youPayload());
            return;
        }
        if (type === NetProtocol.Actions.HOTBAR) {
            const i = Number(action.index);
            if (Number.isInteger(i) && i >= 0 && i < p.inventory.length) p.hotbarIndex = i;
            this._dispatch(NetProtocol.Types.YOU, this._youPayload());
            return;
        }
        if (type === NetProtocol.Actions.CHAT) {
            const text = String(action.text || "").slice(0, 200);
            if (!text) return;
            if (text.startsWith("/")) {
                this._runCommand(text);
                return;
            }
            this._dispatch(NetProtocol.Types.EVENT, {
                kind: "chat",
                text: `<${p.name}> ${text}`,
                from: p.id
            });
            return;
        }
        if (type === NetProtocol.Actions.DROP) {
            // SP ground loot is client-authored (DroppedItem → chunk.meta); ignore.
            return;
        }
        if (type === NetProtocol.Actions.SPAWN_DROP) {
            // Same — client already spawned into the live scene.
            return;
        }
        if (type === NetProtocol.Actions.PICKUP) {
            // Client handles local pickup for SP drops.
            return;
        }
        if (type === NetProtocol.Actions.ATTACK) {
            p.attackTimer = 833;
            p.attackAngle = Number(action.angle) || 0;
            p.attackArt = this._attackArtForPlayer(p);
            this._dispatch(NetProtocol.Types.EVENT, {
                kind: "attack",
                playerId: p.id,
                x: p.x,
                y: p.y,
                angle: p.attackAngle,
                facing: p.facing,
                art: p.attackArt
            });
            return;
        }
        if (type === NetProtocol.Actions.DIE) {
            p.dead = true;
            p.hp = 0;
            p.inventory = [null, null, null, null, null];
            p.equipment = { head: null, torso: null, legs: null, feet: null, waist: [] };
            p.hotbarIndex = 0;
            this._dispatch(NetProtocol.Types.YOU, this._youPayload());
            return;
        }
        if (type === NetProtocol.Actions.RESPAWN) {
            p.dead = false;
            p.hp = p.mhp;
            p.kc = 1200;
            p.saturation = 0;
            this._dispatch(NetProtocol.Types.YOU, this._youPayload());
        }
    }

    _runCommand(text) {
        const parts = text.trim().split(/\s+/);
        const cmd = (parts[0] || "").toLowerCase();
        const p = this._pawn;
        if (!p) return;

        const chat = (msg) => {
            this._dispatch(NetProtocol.Types.EVENT, {
                kind: "chat",
                text: msg,
                system: true
            });
        };

        if (cmd === "/heal" || cmd === "/h") {
            p.hp = p.mhp;
            p.dead = false;
            p.kc = p.stomach;
            p.body = null;
            this._dispatch(NetProtocol.Types.YOU, this._youPayload());
            return;
        }

        if (cmd === "/regen") {
            this._regenWorld(p);
            return;
        }

        if (cmd === "/tick") {
            if (!this.world.clock) {
                this.world.clock = { gameDay: 1, gameMinutes: 8 * 60, tickSpeed: 1 };
            }
            const arg = parts[1];
            if (arg == null || arg === "") {
                chat(`Tick speed: ${this.world.clock.tickSpeed ?? 1}×`);
                return;
            }
            const m = Number(arg);
            if (!Number.isFinite(m) || m < 0) {
                chat("Usage: /tick [speed]  (1 = normal, 60 ≈ 1 game hour/sec, 0 = pause)");
                return;
            }
            this.world.clock.tickSpeed = m;
            this._minuteAcc = 0;
            this._sendSnapshot();
            chat(`${p.name} set tick speed to ${m}×.`);
            return;
        }

        if (cmd === "/time") {
            if (!this.world.clock) {
                this.world.clock = { gameDay: 1, gameMinutes: 8 * 60, tickSpeed: 1 };
            }
            const clock = this.world.clock;
            if (parts.length < 2) {
                const h = Math.floor((clock.gameMinutes || 0) / 60);
                const m = (clock.gameMinutes || 0) % 60;
                chat(
                    `Day ${clock.gameDay || 1}  ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} (${clock.tickSpeed ?? 1}×)`
                );
                return;
            }
            const h = Number(parts[1]);
            const m = parts[2] != null ? Number(parts[2]) : 0;
            if (!Number.isFinite(h) || h < 0 || h > 23 || !Number.isFinite(m) || m < 0 || m > 59) {
                chat("Usage: /time [HH] [MM]");
                return;
            }
            clock.gameMinutes = Math.floor(h) * 60 + Math.floor(m);
            this._minuteAcc = 0;
            this._sendSnapshot();
            chat(
                `${p.name} set the time to ${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor(m)).padStart(2, "0")}`
            );
            return;
        }

        if (cmd === "/tp" || cmd === "/teleport") {
            // Client already teleports locally for LocalSim; keep pawn in sync if asked.
            const usage = "Usage: /tp <x> <y>  (tile coords)";
            if (parts.length < 3) {
                chat(usage);
                return;
            }
            const tx = Number(parts[1]);
            const ty = Number(parts[2]);
            if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
                chat(usage);
                return;
            }
            const ts = 16;
            // Bottom-middle of the 16px human sprite (origin is bottom-left)
            p.x = tx * ts - ts / 2;
            p.y = ty * ts;
            this._dispatch(NetProtocol.Types.YOU, this._youPayload());
            chat(`Teleported to ${tx}, ${ty}`);
            return;
        }

        chat(`Unknown command: ${cmd}`);
    }

    /** Wipe stored chunks with the same seed; client clears visuals via world_regen + RESYNC. */
    _regenWorld(byPlayer) {
        const seed = (this.world.seed >>> 0) || 0;
        this.world.seed = seed;
        this.world.chunks = {};
        this._knownChunks.clear();
        if (typeof noise !== "undefined") noise.seed(this.world.seed);
        if (typeof worldSeed !== "undefined") worldSeed = this.world.seed;

        this._dispatch(NetProtocol.Types.EVENT, {
            kind: "world_regen",
            seed: this.world.seed,
            by: byPlayer?.name || "Player"
        });
        this._persistWorld();
    }

    _tryDrop(action) {
        const p = this._pawn;
        const held = p.inventory[p.hotbarIndex];
        if (!held?.id) return;
        const amount = Math.max(1, Math.floor(Number(action.amount) || 1));
        const qty = Math.min(amount, held.quantity || 1);
        held.quantity = (held.quantity || 1) - qty;
        if (held.quantity <= 0) p.inventory[p.hotbarIndex] = null;
        const clock = this.world.clock || { gameDay: 1, gameMinutes: 8 * 60 };
        const now = (Number(clock.gameDay) || 1) * 1440 + (Number(clock.gameMinutes) || 0);
        this._spawnDrop({
            id: held.id,
            quantity: qty,
            x: Number.isFinite(action.x) ? action.x : p.x,
            y: Number.isFinite(action.y) ? action.y : p.y,
            food: held.food,
            customName: held.customName,
            spoilAt: spoilAtForWorld(held, now)
        });
        this._dispatch(NetProtocol.Types.YOU, this._youPayload());
    }

    _spawnDrop(action) {
        if (!this.world.chunks) this.world.chunks = {};
        const ts = NetProtocol.TILE_SIZE || 16;
        const cs = NetProtocol.CHUNK_SIZE || 8;
        const px = cs * ts;
        const x = Number(action.x) || this._pawn.x;
        const y = Number(action.y) || this._pawn.y;
        const cx = Math.floor(x / px);
        const cy = Math.floor(y / px);
        const key = `${cx},${cy}`;
        if (!this.world.chunks[key]) {
            this.world.chunks[key] = {
                x: cx,
                y: cy,
                tiles: null,
                things: [],
                lootableThings: [],
                drops: [],
                mobs: [],
                corpses: [],
                bloodStains: []
            };
        }
        const c = this.world.chunks[key];
        if (!c.drops) c.drops = [];
        c.drops.push({
            uid: (crypto.randomUUID && crypto.randomUUID()) || `d-${Date.now()}`,
            id: action.id,
            quantity: Math.max(1, Math.floor(Number(action.quantity) || 1)),
            x,
            y,
            food: action.food,
            customName: action.customName,
            spoilAt: action.spoilAt
        });
    }

    _pullFromScene() {
        const pl = this.scene?.player;
        if (!pl || !this._pawn) return;
        this.syncPawnFromClient({
            inventory: pl.inventory,
            equipment: pl.equipment,
            hotbarIndex: pl.hotbarIndex,
            kc: pl.kc,
            saturation: pl.saturation,
            stomach: pl.stomach,
            body: pl.anatomy?.toJSON?.() ?? null,
            hp: pl.hp,
            mhp: pl.mhp,
            x: pl.x,
            y: pl.y,
            facing: pl.facing
        });
    }

    /** Persist current pawn pose on the world (first spawn / logout). */
    rememberPose() {
        this._saveLogoutPose();
    }

    _saveLogoutPose() {
        const p = this._pawn;
        if (!p || !this.world) return;
        if (!this.world.poses || typeof this.world.poses !== "object") {
            this.world.poses = {};
        }
        this.world.poses[p.id] = {
            x: p.x,
            y: p.y,
            facing: p.facing || "down"
        };
    }

    _youPayload() {
        const p = this._pawn;
        if (!p) return null;
        return {
            id: p.id,
            name: p.name,
            x: p.x,
            y: p.y,
            facing: p.facing,
            kc: p.kc,
            saturation: p.saturation,
            stomach: p.stomach,
            inventory: p.inventory,
            equipment: p.equipment,
            hotbarIndex: p.hotbarIndex,
            body: p.body,
            hp: p.hp,
            mhp: p.mhp,
            dead: p.dead,
            look: p.look || null
        };
    }

    _interestRadius() {
        const floor = NetProtocol.INTEREST_CHUNKS || 6;
        const view = this._pawn?.viewChunks ?? floor;
        return Math.max(floor, Math.min(24, view + 1));
    }

    _kickInterest(force) {
        if (force) this._interestForce = true;
        if (this._interestBusy) {
            this._interestAgain = true;
            return;
        }
        if (!this._pawn) return;
        const ts = NetProtocol.TILE_SIZE || 16;
        const cs = NetProtocol.CHUNK_SIZE || 8;
        const px = cs * ts;
        const cx = Math.floor(this._pawn.x / px);
        const cy = Math.floor(this._pawn.y / px);
        const r = this._interestRadius();
        if (!this._interestForce
            && cx === this._interestCx
            && cy === this._interestCy
            && r === this._interestR) {
            return;
        }
        this._syncInterest(!!this._interestForce);
    }

    _yieldFrame() {
        return new Promise((resolve) => {
            if (this.scene?.time?.delayedCall) this.scene.time.delayedCall(0, resolve);
            else setTimeout(resolve, 0);
        });
    }

    async _syncInterest(force) {
        if (!this._pawn) return;
        if (this._interestBusy) {
            this._interestAgain = true;
            if (force) this._interestForce = true;
            return;
        }
        this._interestBusy = true;
        this._interestForce = false;
        const ts = NetProtocol.TILE_SIZE || 16;
        const cs = NetProtocol.CHUNK_SIZE || 8;
        const px = cs * ts;
        const cx0 = Math.floor(this._pawn.x / px);
        const cy0 = Math.floor(this._pawn.y / px);
        const r = this._interestRadius();
        this._interestCx = cx0;
        this._interestCy = cy0;
        this._interestR = r;
        try {
            for (let cx = cx0 - r; cx <= cx0 + r; cx++) {
                for (let cy = cy0 - r; cy <= cy0 + r; cy++) {
                    const key = `${cx},${cy}`;
                    if (!force && this._knownChunks.has(key)) continue;
                    if (this._inflightChunks.has(key)) continue;
                    this._inflightChunks.add(key);
                    const existed = !!(this.world.chunks?.[key]?.tiles);
                    const payload = await this._ensureChunkPayload(cx, cy);
                    this._inflightChunks.delete(key);
                    if (!payload) continue;
                    this._knownChunks.add(key);
                    this._dispatch(NetProtocol.Types.CHUNK, payload);
                    if (!existed) await this._yieldFrame();
                }
            }
        } finally {
            this._interestBusy = false;
            if (this._interestAgain) {
                this._interestAgain = false;
                this._kickInterest(false);
            }
        }
    }

    async _ensureChunkPayload(cx, cy) {
        if (!this.world.chunks) this.world.chunks = {};
        const key = `${cx},${cy}`;
        let meta = this.world.chunks[key];
        if (meta?.tiles) {
            return {
                x: cx,
                y: cy,
                tiles: meta.tiles,
                things: meta.things || [],
                lootableThings: meta.lootableThings || [],
                drops: meta.drops || [],
                mobs: meta.mobs || [],
                corpses: meta.corpses || [],
                bloodStains: meta.bloodStains || []
            };
        }
        // Generate via live SceneMain Chunk when available
        if (this.scene && typeof Chunk === "function") {
            const chunk = new Chunk(this.scene, cx, cy, meta || undefined);
            await chunk.generate();
            meta = {
                x: cx,
                y: cy,
                tiles: chunk.meta.tiles,
                things: chunk.meta.things || [],
                lootableThings: chunk.meta.lootableThings || [],
                drops: chunk.meta.drops || [],
                mobs: chunk.meta.mobs || [],
                corpses: chunk.meta.corpses || [],
                bloodStains: chunk.meta.bloodStains || []
            };
            this.world.chunks[key] = meta;
            return {
                x: cx,
                y: cy,
                tiles: meta.tiles,
                things: meta.things,
                lootableThings: meta.lootableThings,
                drops: meta.drops,
                mobs: meta.mobs,
                corpses: meta.corpses,
                bloodStains: meta.bloodStains
            };
        }
        return null;
    }

    _tick() {
        if (!this.connected || this._closed || this._paused) return;
        const now = performance.now();
        const dtMs = Math.min(100, now - this._lastTick);
        this._lastTick = now;
        const clock = this.world.clock;
        const rawSpeed = Number(clock.tickSpeed);
        const speed = Number.isFinite(rawSpeed) && rawSpeed >= 0 ? rawSpeed : 1;
        this._minuteAcc += dtMs * speed;
        while (this._minuteAcc >= 1000) {
            this._minuteAcc -= 1000;
            clock.gameMinutes = (clock.gameMinutes || 0) + 1;
            if (clock.gameMinutes >= 1440) {
                clock.gameMinutes = 0;
                clock.gameDay = (clock.gameDay || 1) + 1;
            }
            // Light hunger tick (pull client vitals first so eating isn't overwritten)
            if (this._pawn && !this._pawn.dead) {
                this._pullFromScene();
                const fed =
                    (Number(this._pawn.kc) > 0) || (Number(this._pawn.saturation) > 0);
                let tick = 2000 / (24 * 60);
                const caps = this.scene?.player?.capacities;
                if (caps?.hungerRateFactor) tick *= caps.hungerRateFactor() || 1;
                this._pawn.saturation -= tick;
                if (this._pawn.saturation < 0) {
                    this._pawn.kc = Math.max(0, this._pawn.kc + this._pawn.saturation);
                    this._pawn.saturation = 0;
                }
                // Don't pull again — hunger just mutated the pawn
                this._dispatch(NetProtocol.Types.YOU, this._youPayload());
                // Hint client fed-state for the minute that just drained (optional; SceneMain also sets)
                if (this.scene?.player) {
                    this.scene.player._malnutritionFed = fed;
                }
            }
        }
        this._snapAcc += dtMs;
        if (this._snapAcc >= 1000 / (NetProtocol.SNAPSHOT_HZ || 15)) {
            this._snapAcc = 0;
            this._sendSnapshot();
        }
    }

    _sendSnapshot() {
        const p = this._pawn;
        if (!p) return;
        const drops = [];
        const r = this._interestRadius();
        const ts = NetProtocol.TILE_SIZE || 16;
        const cs = NetProtocol.CHUNK_SIZE || 8;
        const px = cs * ts;
        const cx0 = Math.floor(p.x / px);
        const cy0 = Math.floor(p.y / px);
        for (let cx = cx0 - r; cx <= cx0 + r; cx++) {
            for (let cy = cy0 - r; cy <= cy0 + r; cy++) {
                const c = this.world.chunks?.[`${cx},${cy}`];
                if (!c?.drops) continue;
                for (const d of c.drops) {
                    drops.push({
                        uid: d.uid,
                        id: d.id,
                        quantity: d.quantity || 1,
                        x: d.x,
                        y: d.y,
                        food: d.food,
                        customName: d.customName,
                        spoilAt: d.spoilAt,
                        toolClass: d.toolClass,
                        sharpness: d.sharpness,
                        knapDamage: d.knapDamage,
                        knapMaterial: d.knapMaterial,
                        knapQuality: d.knapQuality,
                        tooltipExtra: d.tooltipExtra,
                        knapIconData: d.knapIconData,
                        durability: d.durability,
                        ingredients: d.ingredients,
                        kind: d.kind,
                        fillTint: d.fillTint,
                        weight: d.weight
                    });
                }
            }
        }
        this._dispatch(NetProtocol.Types.SNAPSHOT, {
            clock: { ...this.world.clock },
            players: [{
                id: p.id,
                name: p.name,
                x: p.x,
                y: p.y,
                facing: p.facing,
                sprint: p.sprint,
                dead: p.dead,
                prone: !!(p.dead || p.prone),
                attacking: (p.attackTimer || 0) > 0,
                attackAngle: p.attackAngle ?? null,
                attackArt: (p.attackTimer || 0) > 0 ? (p.attackArt || null) : null,
                look: p.look || null
            }],
            drops,
            mobs: [],
            youId: p.id
        });
        if (p.attackTimer > 0) p.attackTimer -= 1000 / (NetProtocol.SNAPSHOT_HZ || 15);
    }

    async _persistWorld() {
        // Serialize persists so the 30s timer can't overlap Save and Quit / close.
        this._persistTail = this._persistTail.then(
            () => this._persistWorldNow(),
            () => this._persistWorldNow()
        );
        return this._persistTail;
    }

    async _persistWorldNow() {
        if (!this.world?.id) return;
        try {
            if (!this._closed) {
                this._pullFromScene();
                this._saveLogoutPose();
            }
            // Only flush live scene chunks while the play scene is still up.
            const scene = this.scene;
            let sceneLive = false;
            try {
                sceneLive = !!(scene?.sys && scene.sys.settings && scene.sys.isActive());
            } catch (_) {
                sceneLive = false;
            }
            if (sceneLive && scene.chunks) {
                for (const chunk of Object.values(scene.chunks)) {
                    if (!chunk?.isGenerated || !chunk.meta?.tiles) continue;
                    try {
                        chunk.flushMobs?.();
                        chunk.flushDrops?.();
                    } catch (e) {
                        console.warn("[LocalSim] chunk flush failed", e);
                        continue;
                    }
                    const key = `${chunk.x},${chunk.y}`;
                    this.world.chunks[key] = {
                        x: chunk.x,
                        y: chunk.y,
                        tiles: chunk.meta.tiles,
                        things: chunk.meta.things || [],
                        lootableThings: chunk.meta.lootableThings || [],
                        drops: chunk.meta.drops || [],
                        mobs: chunk.meta.mobs || [],
                        corpses: chunk.meta.corpses || [],
                        bloodStains: chunk.meta.bloodStains || []
                    };
                }
            }
            await WorldStore.put(this.world);
        } catch (e) {
            console.warn("[LocalSim] persist failed", e);
        }
    }

    /**
     * Best-effort swing art for remotes (LocalSim has no SimCreature combat).
     * Uses scene item defs + held stack when available.
     */
    _attackArtForPlayer(p) {
        const idx = p.hotbarIndex | 0;
        const stack = Array.isArray(p.inventory) ? p.inventory[idx] : null;
        if (!stack) return { unarmed: true, range: 4, max: 833 };
        const meta = this.scene?.getItem?.(stack.id) || null;
        let weapon = meta?.weapon;
        let key = meta?.key || meta?.id || stack.id;
        let knapSilhouette = false;
        let knapIconData = stack.knapIconData || null;
        if (stack.toolClass && Number(stack.knapDamage) > 0 && typeof Knapping !== "undefined") {
            const knap = Knapping.weaponMetaFromStack(meta || { id: stack.id, name: stack.id }, stack);
            if (knap?.weapon?.type === "melee") {
                weapon = knap.weapon;
                key = stack.knapIcon || knap.key || key;
                knapSilhouette = !!weapon.knapSilhouette;
            }
        }
        if (weapon?.type !== "melee") {
            return { unarmed: true, range: 4, max: 833 };
        }
        // Offhand/unarmed verbs still look like fists — LocalSim can't know pickAttack;
        // prefer weapon art when a melee weapon is held.
        return {
            unarmed: false,
            key,
            itemId: stack.id,
            range: Number(weapon.range) || 12,
            knapSilhouette,
            knapIconData,
            max: 833
        };
    }

    /**
     * Apply player inventory/vitals from SceneMain back into the session pawn
     * so YOU / character save stay correct for client-authoritative SP gear.
     */
    syncPawnFromClient(partial) {
        if (!this._pawn || !partial) return;
        const p = this._pawn;
        if (Array.isArray(partial.inventory)) p.inventory = partial.inventory;
        if (partial.equipment) p.equipment = partial.equipment;
        if (typeof partial.hotbarIndex === "number") p.hotbarIndex = partial.hotbarIndex;
        if (typeof partial.kc === "number") p.kc = partial.kc;
        if (typeof partial.saturation === "number") p.saturation = partial.saturation;
        if (typeof partial.stomach === "number") p.stomach = partial.stomach;
        if (typeof partial.hp === "number") p.hp = partial.hp;
        if (typeof partial.mhp === "number") p.mhp = partial.mhp;
        if (partial.body !== undefined) p.body = partial.body;
        if (partial.look) p.look = partial.look;
        if (typeof partial.x === "number") p.x = partial.x;
        if (typeof partial.y === "number") p.y = partial.y;
        if (typeof partial.facing === "string" && partial.facing) p.facing = partial.facing;
    }

    async close() {
        if (this._closed) {
            await this._persistTail;
            return;
        }
        this._closed = true;
        this.connected = false;
        if (this._tickTimer) clearInterval(this._tickTimer);
        if (this._persistTimer) clearInterval(this._persistTimer);
        this._tickTimer = null;
        this._persistTimer = null;
        try {
            this._pullFromScene();
            this._saveLogoutPose();
            const you = this._youPayload();
            if (you) {
                this.emit(NetProtocol.Types.SESSION_END, { reason: "disconnect", you });
            }
            // Wait for any in-flight timer persist, then write a final snapshot.
            await this._persistWorld();
        } finally {
            this.scene = null;
            this._pawn = null;
        }
        this.emit("close", {});
    }
}
