/**
 * In-browser world session for Singleplayer — same NetClient surface as WebSocket MP.
 * Hosts SimWorld in-process (synchronous SimSession). Persists via WorldStore.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        const NetProtocol = require("../../shared/protocol");
        const SimWorldMod = require("../../shared/sim/SimWorld");
        const SimSession = require("../../shared/sim/SimSession");
        module.exports = factory(NetProtocol, SimWorldMod, SimSession);
    } else {
        root.LocalSim = factory(
            root.NetProtocol,
            { SimWorld: root.SimWorld },
            root.SimSession
        );
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (NetProtocol, SimWorldMod, SimSession) {
    const SimWorld = SimWorldMod.SimWorld || SimWorldMod;

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
            this.session = null;
            this.sim = null;
        this._tickTimer = null;
            this._persistTimer = null;
        this._lastTick = 0;
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

    clearHandlers() {
        this.handlers = {};
    }

    emit(type, payload) {
        for (const fn of this.handlers[type] || []) {
            try {
                fn(payload);
            } catch (e) {
                console.error(e);
            }
        }
            for (const fn of this.handlers["*"] || []) {
                try {
                    fn(type, payload);
                } catch (e) {
                    console.error(e);
                }
            }
    }

    _wireCopy(payload) {
        if (!payload || typeof payload !== "object") return payload;
        try {
            return JSON.parse(JSON.stringify(payload));
        } catch (_) {
            return payload;
        }
    }

    _dispatch(type, payload) {
        // SNAPSHOT already clones public slots/drops. JSON-cloning it 15Hz
        // hitchs SP when a camp is full of baskets and haulers. Settlements
        // are live sim objects — copy those so the client cannot mutate them.
        let data = payload;
        if (type === NetProtocol.Types.SNAPSHOT && payload && typeof payload === "object") {
            if (payload.settlements) {
                data = { ...payload, settlements: this._wireCopy(payload.settlements) };
            }
        } else {
            data = this._wireCopy(payload);
        }
        if (this._buffering && type !== NetProtocol.Types.WELCOME && type !== NetProtocol.Types.REJECT) {
            this._queue.push({ type, payload: data });
            if (this._queue.length > 500) this._queue.shift();
            return;
        }
        this.emit(type, data);
    }

    flushAndListen() {
        this._buffering = false;
        const q = this._queue;
        this._queue = [];
        for (const { type, payload } of q) this.emit(type, payload);
    }

    attachScene(scene) {
        this.scene = scene;
        }

        _send(_playerId, type, payload) {
            this._dispatch(type, payload);
        }

        _mergeSave(blob) {
            if (!blob || !this.world) return;
            const data = this._wireCopy(blob);
            if (!data || typeof data !== "object") return;
            this.world.seed = data.seed;
            this.world.genVersion = data.genVersion ?? 2;
            this.world.spawn = data.spawn;
            this.world.clock = data.clock;
            this.world.poses = data.poses;
            this.world.directorCd = data.directorCd;
            this.world.wanderers = data.wanderers;
            this.world.settlements = data.settlements;
            this.world.settlers = data.settlers;
            this.world.chunks = data.chunks;
        }

        _makePersist() {
            const self = this;
            return {
                load: () => self.world,
                save: (data) => {
                    self._mergeSave(data);
                },
                clearPlayers: () => 0
            };
        }

        async _ensureData() {
            if (typeof DataStore === "undefined") return;
            if (DataStore.isReady()) return;
            if (this.scene) {
                DataStore.initFromPhaserScene(this.scene);
                if (DataStore.isReady()) return;
            }
            if (typeof fetch === "function") {
                const load = (name) => fetch(`data/${name}`).then((r) => {
                    if (!r.ok) throw new Error(`Failed to load data/${name}`);
                    return r.json();
                });
                const [bodyPlans, injuries, hediffs, items, mobs, things, structures] = await Promise.all([
                    load("BodyPlans.json"),
                    load("Injuries.json"),
                    load("Hediffs.json"),
                    load("Items.json"),
                    load("Mobs.json"),
                    load("Things.json"),
                    load("Structures.json").catch(() => null)
                ]);
                DataStore.initFromData({ bodyPlans, injuries, hediffs, items, mobs, things });
                if (structures && typeof Structures !== "undefined") {
                    Structures.loadConfig?.(structures);
                }
                return;
            }
            if (typeof DataStore.loadFromDisk === "function") {
                DataStore.loadFromDisk();
            }
    }

    async connect() {
        this._closed = false;
        this.connected = true;
        this._buffering = true;
        this._queue = [];

            await this._ensureData();

            const persist = this._makePersist();
            const hasChunks = this.world?.chunks && Object.keys(this.world.chunks).length > 0;
            const hasSeed = this.world?.seed != null;
            if (hasSeed && (hasChunks || this.world.genVersion === 2)) {
                this.sim = SimWorld.loadFromData(this.world, {
                    worldName: this.world.name,
                    persist
                });
            } else {
                this.sim = SimWorld.createNew({
                    worldName: this.world?.name || "World",
                    persist
                });
                if (hasSeed) {
                    this.sim.seed = this.world.seed >>> 0;
                    if (typeof WorldGen !== "undefined") WorldGen.applySeed(this.sim.seed);
                }
            }
            this.world.seed = this.sim.seed;

        const char = this.character;
        this.playerId = char.id;
        const savedPose = this.world.poses?.[char.id];
        const hasPose = Number.isFinite(savedPose?.x) && Number.isFinite(savedPose?.y);

            let snap = char;
            if (typeof CharacterStore !== "undefined" && CharacterStore.toJoinSnapshot) {
                snap = CharacterStore.toJoinSnapshot(char) || char;
            }

            this.session = new SimSession({
                sim: this.sim,
                send: (id, type, payload) => this._send(id, type, payload)
            });
            this.session.addPlayer(this.playerId, char.name || "Player", snap, {
                silentJoin: true
            });

            const welcome = this.session.welcomePayload(this.playerId, {
            worldName: this.world.name || "World",
            local: true,
            firstSpawn: !hasPose
            });
        this._dispatch(NetProtocol.Types.WELCOME, welcome);
            this.session.afterJoin(this.playerId);

            this._lastTick = (typeof performance !== "undefined" && performance.now)
                ? performance.now()
                : Date.now();
            // Browser: Phaser SceneMain drives ticks (one loop). Node tests keep a timer.
            this._useSceneTick = typeof window !== "undefined";
            if (!this._useSceneTick) {
                this._tickTimer = setInterval(() => this._tick(), 1000 / 60);
            }
            this._persistTimer = setInterval(() => this._persistWorld(), 30000);

        return welcome;
    }

        _tick() {
            if (this._closed || !this.connected || this._paused || !this.session) return;
            const now = (typeof performance !== "undefined" && performance.now)
                ? performance.now()
                : Date.now();
            const dt = Math.min(100, Math.max(0, now - (this._lastTick || now)));
            this._lastTick = now;
            this.session.tick(dt);
        }

        /** Phaser-driven tick (browser SP). No-ops when paused or using the Node timer. */
        tickFromScene(dtMs) {
            if (!this._useSceneTick) return;
            if (this._closed || !this.connected || this._paused || !this.session) return;
            this.session.tick(Math.min(100, Math.max(0, Number(dtMs) || 0)));
        }

        setPaused(paused) {
            const on = !!paused;
            if (this._paused === on) return;
            this._paused = on;
            if (this._useSceneTick) return;
            if (on) {
                if (this._tickTimer) {
                    clearInterval(this._tickTimer);
                    this._tickTimer = null;
                }
                return;
            }
            if (this._closed || !this.connected || this._tickTimer) return;
            this._lastTick = (typeof performance !== "undefined" && performance.now)
                ? performance.now()
                : Date.now();
            this._tickTimer = setInterval(() => this._tick(), 1000 / 60);
        }

        auth() {}

        send(_type, _payload) {}

    sendMove(move) {
            if (!this.connected || !this.session) return;
            this.session.setMove(this.playerId, move);
    }

    sendAction(action) {
            if (!this.connected || !this.session) return;
            this.session.handleAction(this.playerId, action);
    }

    async _persistWorld() {
        this._persistTail = this._persistTail.then(
            () => this._persistWorldNow(),
            () => this._persistWorldNow()
        );
        return this._persistTail;
    }

    async _persistWorldNow() {
            if (!this.world?.id && !this.world) return;
            try {
                this.sim?.saveAll?.();
                if (this.world) this.world.lastPlayedAt = Date.now();
                if (typeof WorldStore !== "undefined" && WorldStore.put && this.world?.id) {
                    await WorldStore.put(this.world);
                }
        } catch (e) {
            console.warn("[LocalSim] persist failed", e);
        }
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
                let you = null;
                if (this.session && this.playerId) {
                    you = this.session.removePlayer(this.playerId, { save: false });
                }
            if (you) {
                this.emit(NetProtocol.Types.SESSION_END, { reason: "disconnect", you });
            }
            await this._persistWorld();
        } finally {
            this.scene = null;
                this.session = null;
        }
        this.emit("close", {});
    }
}

return LocalSim;
});
