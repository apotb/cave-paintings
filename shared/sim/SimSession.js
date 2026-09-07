/**
 * In-process sim host: interest chunks, YOU/EVENT flush, snapshots.
 * Used by LocalSim (browser SP) and GameServer (WebSocket MP).
 * Transport is a send(playerId, type, payload) callback — sync function calls.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        const Protocol = require("../protocol");
        module.exports = factory(Protocol);
    } else {
        root.SimSession = factory(root.NetProtocol);
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Protocol) {
    class SimSession {
        /**
         * @param {{ sim: object, send: function, onEvent?: function }} opts
         */
        constructor(opts) {
            this.sim = opts.sim;
            this._send = opts.send;
            this.onEvent = opts.onEvent || null;
            /** @type {Set<string>} */
            this._connected = new Set();
            /** @type {Map<string, Set<string>>} */
            this._known = new Map();
            this._snapAcc = 0;
        }

        addPlayer(playerId, name, character, opts) {
            const pawn = this.sim.addPlayer(playerId, name, character, opts);
            this._connected.add(playerId);
            this._known.set(playerId, new Set());
            return pawn;
        }

        welcomePayload(playerId, extras = {}) {
            const sim = this.sim;
            return {
                playerId,
                characterId: playerId,
                seed: sim.seed,
                worldName: extras.worldName || sim.worldName || "World",
                clock: {
                    gameDay: sim.gameDay,
                    gameMinutes: sim.gameMinutes,
                    tickSpeed: sim.tickSpeed,
                    baseTickSpeed: Number.isFinite(sim.baseTickSpeed)
                        ? sim.baseTickSpeed
                        : sim.tickSpeed
                },
                spawn: sim.spawn,
                motd: extras.motd || "",
                you: sim.youPayload(playerId),
                wanderers: [...sim.wanderers.values()]
                    .map((w) => sim._publicWanderer(w))
                    .filter(Boolean),
                local: !!extras.local,
                firstSpawn: !!extras.firstSpawn
            };
        }

        afterJoin(playerId) {
            this.syncChunks(playerId, true);
            this.flushYou(playerId);
        }

        removePlayer(playerId, opts) {
            this._connected.delete(playerId);
            this._known.delete(playerId);
            return this.sim.removePlayer(playerId, opts);
        }

        setMove(playerId, move) {
            this.sim.setMove(playerId, move || {});
        }

        handleAction(playerId, action) {
            if (!this._connected.has(playerId)) return;
            if (action?.type === Protocol.Actions.RESYNC) {
                this._known.set(playerId, new Set());
                this.syncChunks(playerId, true);
                this.flushYou(playerId);
                return;
            }
            this.sim.handleAction(playerId, action);
            this.flushYou(playerId);
            this.flushEvents();
        }

        tick(dtMs) {
            this.sim.tick(dtMs);
            this.flushEvents();
            this._snapAcc += dtMs;
            const snapEvery = 1000 / (Protocol.SNAPSHOT_HZ || 15);
            if (this._snapAcc >= snapEvery) {
                this._snapAcc %= snapEvery;
                for (const id of this._connected) {
                    this.syncChunks(id, false);
                    const snap = this.sim.snapshotFor(id);
                    if (snap) this._send(id, Protocol.Types.SNAPSHOT, snap);
                }
            }
        }

        syncChunks(playerId, force = false) {
            const p = this.sim.players.get(playerId);
            if (!p) return;
            let known = this._known.get(playerId);
            if (!known) {
                known = new Set();
                this._known.set(playerId, known);
            }
            const keys = this.sim.interestChunkKeys(p.x, p.y, this.sim.interestRadius(p));
            for (const key of keys) {
                if (!force && known.has(key)) continue;
                known.add(key);
                const [cx, cy] = key.split(",").map(Number);
                this._send(playerId, Protocol.Types.CHUNK, this.sim.chunkPayload(cx, cy));
            }
        }

        flushYou(playerId) {
            const you = this.sim.youPayload(playerId);
            if (you) this._send(playerId, Protocol.Types.YOU, you);
        }

        flushEvents() {
            const events = this.sim.drainEvents();
            let worldRegen = false;
            for (const ev of events) {
                if (ev.kind === "world_regen") worldRegen = true;
                try {
                    this.onEvent?.(ev);
                } catch (_) {}
                if (ev.to) {
                    if (this._connected.has(ev.to)) {
                        this._send(ev.to, Protocol.Types.EVENT, ev);
                    }
                } else {
                    for (const id of this._connected) {
                        if (ev.except && id === ev.except) continue;
                        this._send(id, Protocol.Types.EVENT, ev);
                    }
                }
            }
            for (const id of this.sim.drainYouDirty()) {
                if (this._connected.has(id)) this.flushYou(id);
            }
            if (worldRegen) {
                for (const id of this._connected) {
                    this._known.set(id, new Set());
                    this.syncChunks(id, true);
                    this.flushYou(id);
                }
            }
        }
    }

    return SimSession;
});
