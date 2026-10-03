/**
 * SimWorld prototype methods (players).
 * Installed onto SimWorld.prototype. Method bodies are unchanged.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory;
    } else {
        root.SimWorldMixins = root.SimWorldMixins || {};
        root.SimWorldMixins.players = factory;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ctx) {
    "use strict";
    const {
        Protocol, Look, rng, Spoil, Durability, Apparel, Chop, Place, Sleep, Hunger, Path, Hide, Carry, Fire, Party, Settlement, StorageFilter, FuelFilter, CavemanNames, CorpseDecay, GameMath, DataStore, BodyHealing, Hediffs, BodyCombat, BodyMod, Capacities, HeadlessAI, SimCreatureMod, WorldGen, SettlerWork, mulberry32, hash2D, uuid, Body, createAI, PartyAI, WandererStrollAI, NeutralAnimalAI, createPlayerCreature, createMobCreature, feetToBodyCenter, CS, TS, CHUNK_PX, SPEED, SPRINT, MELEE_RANGE, INTEREST, SIM_CHUNKS, DROP_LIFE_MS, HARVEST_RANGE_TILES, BLOCKED, _research, _contentApi, _actionsApi, _kindsApi, _forming, _dig, _defGeneration, thingDefs, mobDefs, itemDefs, chunkKey, worldToChunk, emptyInv, dedupeCorpses
    } = ctx;
    return {

    /**
     * Missing `mods` means a base-game save. A missing id warns and leaves world
     * content in place. A hash mismatch warns only when every saved id is loaded.
     */
    _contentLoadWarnings(data) {
        if (!data || !Array.isArray(data.mods)) return [];
        const content = _contentApi();
        const loaded = content?.simMods?.() || [];
        const loadedIds = new Set(loaded.map((mod) => mod?.id).filter(Boolean));
        const missing = [];
        for (const mod of data.mods) {
            if (!mod?.id) continue;
            if (loadedIds.has(mod.id)) continue;
            const version = mod.version == null ? "" : String(mod.version);
            missing.push(`${mod.id}@${version}`);
        }
        if (missing.length) {
            return missing.map((label) =>
                `Missing mod ${label}. World content from that mod is left in place.`
            );
        }
        const savedHash = data.contentHash == null ? "" : String(data.contentHash);
        let current = "";
        if (content?.isFinalized?.() && typeof content.simHash === "function") {
            current = content.simHash();
        }
        if (savedHash === current) return [];
        return [
            `Saved simulation content does not match the loaded mods (saved hash ${savedHash}, loaded hash ${current}). World content is left in place.`
        ];
    },

    _contentIdentity() {
        const content = _contentApi();
        if (content?.isFinalized?.() && typeof content.simHash === "function") {
            return {
                mods: (content.simMods?.() || []).map((mod) => ({
                    id: mod.id,
                    version: mod.version
                })),
                contentHash: content.simHash()
            };
        }
        return { mods: [], contentHash: "" };
    },

    _pickSpawn() {
        // Origin tile foot — sign goes here; players scatter in radius 4
        this.spawn = { x: TS / 2, y: TS };
    },

    _registerChunkMobs(c) {
        this._ensureMobUids(c);
        if (!c || !Array.isArray(c.mobs)) return;
        for (const entry of c.mobs) {
            if (!entry?.uid || this.mobs.has(entry.uid)) continue;
            const def = mobDefs().get(entry.id) || this.dataStore.getMob(entry.id);
            const creature = createMobCreature(
                entry,
                def,
                this.dataStore,
                this._creatureCtx()
            );
            createAI(creature, creature.aiType);
            this.mobs.set(entry.uid, creature);
        }
    },

    _ensureMobUids(c) {
        if (!c || !Array.isArray(c.mobs)) return;
        for (const m of c.mobs) {
            if (!m || m.uid) continue;
            m.uid = `mob-${c.cx},${c.cy}-${Math.round(m.x)}-${Math.round(m.y)}`;
        }
    },

    _ensureLootableUids(c) {
        if (!c || !Array.isArray(c.lootableThings)) return;
        const seen = new Set();
        for (const e of c.lootableThings) {
            if (!e) continue;
            if (!e.uid) {
                e.uid = `lt_${Math.round(Number(e.x) || 0)}_${Math.round(Number(e.y) || 0)}_${e.id || "x"}`;
            }
            if (seen.has(e.uid)) e.uid = `${e.uid}_${uuid().slice(0, 6)}`;
            seen.add(e.uid);
        }
    },

    /**
     * Persist a mob into chunk meta and spawn an authoritative SimCreature.
     * @returns {object|null} chunk mob entry
     */
    _spawnMobAt(kind, x, y) {
        const idKey = String(kind || "").toLowerCase();
        const def = mobDefs().get(idKey) || this.dataStore.getMob(idKey);
        if (!def) return null;
        const wx = Number(x);
        const wy = Number(y);
        if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null;

        const uid = `mob-${uuid()}`;
        const { cx, cy } = worldToChunk(wx, wy);
        const c = this._ensureChunk(cx, cy);
        if (!Array.isArray(c.mobs)) c.mobs = [];
        const entry = {
            uid,
            id: def.id,
            x: wx,
            y: wy,
            homeX: wx,
            homeY: wy
        };
        c.mobs.push(entry);
        const creature = createMobCreature(
            entry,
            def,
            this.dataStore,
            this._creatureCtx()
        );
        createAI(creature, creature.aiType);
        this.mobs.set(uid, creature);
        this.pushEvent({ kind: "mob", op: "add", entry, cx, cy });
        return entry;
    },

    _trySpawnMob(p, action = {}) {
        const kind = String(action.kind || action.id || "human").toLowerCase();
        if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
            p.x = action.x;
            p.y = action.y;
            p.poseAuth = true;
        }
        const x = Number.isFinite(action.x) ? action.x : p.x;
        const y = Number.isFinite(action.y) ? action.y : p.y;
        const entry = this._spawnMobAt(kind, x, y);
        if (!entry) {
            this.announceCmd(`Unknown mob "${kind}".`, { to: p.id });
            return;
        }
        const label = mobDefs().get(entry.id)?.name || entry.id;
        this.announceCmd(`Spawned ${label}`, { to: p.id });
    },

    _findSpawnClearing() {
        // Keep world spawn anchored at origin (matches client 0,0 sign).
        // Players use _pickRandomSpawnPose for first join / respawn.
        this.spawn = { x: TS / 2, y: TS };
        // Touch neighborhood so tiles/things exist for spawn picks
        for (let ty = -4; ty <= 4; ty++) {
            for (let tx = -4; tx <= 4; tx++) {
                const x = tx * TS + TS / 2;
                const y = ty * TS + TS;
                this.isBlocked(x, y);
            }
        }
        this._ensureSpawnSign();
    },

    /** Origin welcome sign — same tile as the Phaser SP sign (0, 0). */
    _ensureSpawnSign() {
        const def = thingDefs().get("sign");
        if (!def) return;
        const made = this._makeThingEntry(def, 0, 0);
        if (!made?.entry) return;
        made.entry.spawnHint = true;
        this._setThingOnTile(0, 0, made.entry, { lootable: !!made.lootable });
    },

    /**
     * Random free tile in [-radius, radius]² around origin (same as SceneMain).
     * Skips water/ice/things and the origin sign tile.
     */
    _pickRandomSpawnPose(radius = 4) {
        const candidates = [];
        for (let ty = -radius; ty <= radius; ty++) {
            for (let tx = -radius; tx <= radius; tx++) {
                if (tx === 0 && ty === 0) continue;
                const x = tx * TS + TS / 2;
                const y = ty * TS + TS;
                if (this.isBlocked(x, y)) continue;
                candidates.push({ x, y });
            }
        }
        if (!candidates.length) {
            return { x: this.spawn.x, y: this.spawn.y };
        }
        return candidates[Math.floor(this.rng() * candidates.length)];
    },

    toSaveData() {
        this._flushOnlinePoses();
        const chunks = {};
        for (const [key, c] of this.chunks) {
            chunks[key] = {
                x: c.cx,
                y: c.cy,
                tiles: c.tiles,
                things: c.things,
                lootableThings: c.lootableThings,
                drops: c.drops,
                mobs: c.mobs,
                corpses: c.corpses,
                bloodStains: c.bloodStains
            };
        }
        return {
            v: 1,
            genVersion: 2,
            seed: this.seed,
            spawn: this.spawn,
            clock: {
                gameDay: this.gameDay,
                gameMinutes: this.gameMinutes,
                tickSpeed: Number.isFinite(this.baseTickSpeed) ? this.baseTickSpeed : this.tickSpeed
            },
            poses: this.poses || {},
            directorCd: this._directorCdToSave(),
            wanderers: [...this.wanderers.values()]
                .filter((w) => w && !w.dead)
                .map((w) => this._publicWanderer(w)),
            settlements: this.settlements || [],
            researchSpentByOwner: this.researchSpentByOwner && typeof this.researchSpentByOwner === "object"
                ? { ...this.researchSpentByOwner }
                : {},
            settlers: (this.settlers || []).filter((s) => s && !s.dead).map((s) => this._persistSettler(s)),
            chunks,
            modData: this.modData && typeof this.modData === "object" && !Array.isArray(this.modData)
                ? { ...this.modData }
                : {},
            ...this._contentIdentity()
        };
    },

    saveAll() {
        this.persist?.save?.(this.toSaveData());
        // Characters are client-owned — do not persist player gear on the world
    },

    savePlayer(_p) {
        // no-op: ephemeral sessions
    },

    playerToJSON(p) {
        return {
            id: p.id,
            name: p.name,
            worldSeed: this.seed,
            x: p.x,
            y: p.y,
            facing: p.facing,
            kc: p.kc,
            saturation: p.saturation,
            stomach: p.stomach,
            inventory: p.inventory,
            overflow: p.overflow,
            equipment: p.equipment,
            hotbarIndex: p.hotbarIndex,
            body: p.body || null,
            hp: p.hp,
            mhp: p.mhp
        };
    },

    /**
     * Join with optional client character snapshot (Terraria-style).
     * @param {string} playerId
     * @param {string} displayName
     * @param {object|null} character
     * @param {{ silentJoin?: boolean }} [opts]
     */
    addPlayer(playerId, displayName, character = null, opts = {}) {
        const existing = this.players.get(playerId);
        if (existing) {
            if (character && typeof character === "object") {
                this._applyCharacterSnapshot(existing, character);
            }
            existing.connected = true;
            existing.poseAuth = false;
            existing._joinGraceUntil = Date.now() + 4000;
            this._ensurePlayerCreature(existing);
            this._placeNewCompanionsNearLeader(existing);
            this._interestLoad(existing.x, existing.y, this.interestRadius(existing));
            this._restorePawnSleep(existing, existing);
            for (const m of existing.party || []) this._restorePawnSleep(existing, m);
            this._sanitizeSleepOccupants();
            this._applyRestClock();
            this._reconcilePartyAndSettlers(existing);
            this._youDirty.add(playerId);
            this._ensureDirectorCd(existing.id, (existing.party?.length || 0) + 1);
            this._rememberOwnerName(existing);
            return existing;
        }
        const p = this._freshPawn(playerId, displayName);
        if (character && typeof character === "object") {
            this._applyCharacterSnapshot(p, character);
        }
        // Occupied sleepers are snapped to the bunk in `_restorePawnSleep`.
        this._restoreLogoutPose(p);
        this._placeNewCompanionsNearLeader(p);
        p.connected = true;
        p.poseAuth = false;
        p._joinGraceUntil = Date.now() + 4000;
        this.players.set(playerId, p);
        this._ensurePlayerCreature(p);
        this._interestLoad(p.x, p.y, this.interestRadius(p));
        this._restorePawnSleep(p, p);
        for (const m of p.party || []) this._restorePawnSleep(p, m);
        this._sanitizeSleepOccupants();
        this._applyRestClock();
        this._reconcilePartyAndSettlers(p);
        this._youDirty.add(playerId);
        this._ensureDirectorCd(p.id, (p.party?.length || 0) + 1);
        if (!opts.silentJoin) {
            this.pushEvent({ kind: "chat", text: `${p.name} joined`, system: true });
        }
        this._rememberOwnerName(p);
        return p;
    },

    /** Keep each camp's leader label on the owner's main character name. */
    _rememberOwnerName(p) {
        if (!p?.id) return;
        const name = String(p.name || "").trim().slice(0, 24);
        if (!name) return;
        for (const s of this.settlements || []) {
            if (s?.ownerId === p.id) s.ownerName = name;
        }
    },

    /**
     * Camps for the wire. `ownerOnline` is live presence only — it stays off
     * the saved settlement so a logout cannot freeze someone as online.
     */
    _publicSettlements() {
        const out = [];
        for (const s of this.settlements || []) {
            if (!s) continue;
            const owner = s.ownerId ? this.players.get(s.ownerId) : null;
            const online = !!(owner && owner.connected);
            if (online && owner.name) {
                const name = String(owner.name).trim().slice(0, 24);
                if (name) s.ownerName = name;
            }
            if ("ownerOnline" in s) delete s.ownerOnline;
            out.push({
                ...s,
                ownerName: s.ownerName || "",
                ownerOnline: online
            });
        }
        return out;
    },

    /** Rejoin: restore last logout pose for this character on this world. */
    _restoreLogoutPose(p) {
        if (!p?.id || !this.poses) return;
        const saved = this.poses[p.id];
        if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return;
        this._interestLoad(saved.x, saved.y, this.interestRadius(p));
        let x = saved.x;
        let y = saved.y;
        if (this.isBlocked(x, y) && !saved.resting) {
            const near = this._findOpenNear(x, y, 6);
            if (near) {
                x = near.x;
                y = near.y;
            }
        }
        p.x = x;
        p.y = y;
        if (typeof saved.facing === "string" && saved.facing) p.facing = saved.facing;
        if (saved.lastSleep) p.lastSleep = saved.lastSleep;
        if (typeof saved.resting === "boolean") p._resting = !!saved.resting;
    },

    /**
     * Character-saved companion x,y is the last world, not this one.
     * Keep this-world logout poses; cluster anyone new beside the leader.
     */
    _placeNewCompanionsNearLeader(p) {
        if (!p) return;
        Party.placeJoinParty(p, p.party, this.poses, {
            tileSize: TS,
            findOpen: (x, y) => this._findOpenNear(x, y, 4)
        });
        for (const m of p.party || []) {
            if (m?.creature) {
                m.creature.x = m.x;
                m.creature.y = m.y;
            }
        }
    },

    /** Snapshot every connected pawn into poses so crash/restart keeps rejoin spots. */
    _flushOnlinePoses() {
        if (!this.poses || typeof this.poses !== "object") this.poses = {};
        for (const p of this.players.values()) {
            if (!p?.id || !p.connected) continue;
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
            this.poses[p.id] = {
                x: p.x,
                y: p.y,
                facing: p.facing || "down",
                resting: !!p._resting,
                lastSleep: p.lastSleep || null
            };
            for (const m of p.party || []) {
                if (!m?.id || !Number.isFinite(m.x)) continue;
                this.poses[m.id] = {
                    x: m.x,
                    y: m.y,
                    facing: m.facing || "down",
                    resting: !!m._resting,
                    lastSleep: m.lastSleep || null
                };
            }
        }
    },

    _findOpenNear(wx, wy, radiusTiles = 4) {
        const r = Math.max(1, Math.floor(Number(radiusTiles) || 1));
        for (let rad = 0; rad <= r; rad++) {
            for (let dy = -rad; dy <= rad; dy++) {
                for (let dx = -rad; dx <= rad; dx++) {
                    if (rad > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
                    const x = wx + dx * TS;
                    const y = wy + dy * TS;
                    this._interestLoad(x, y, 1);
                    if (!this.isBlocked(x, y)) return { x, y };
                }
            }
        }
        return null;
    },

    _saveLogoutPose(p) {
        if (!p?.id) return;
        if (!this.poses || typeof this.poses !== "object") this.poses = {};
        this.poses[p.id] = {
            x: p.x,
            y: p.y,
            facing: p.facing || "down",
            resting: !!p._resting,
            lastSleep: p.lastSleep || null
        };
        for (const m of p.party || []) {
            if (!m?.id || !Number.isFinite(m.x)) continue;
            this.poses[m.id] = {
                x: m.x,
                y: m.y,
                facing: m.facing || "down",
                resting: !!m._resting,
                lastSleep: m.lastSleep || null
            };
        }
    },

    _applyCharacterSnapshot(p, character) {
        if (character.name) p.name = String(character.name).slice(0, 24);
        if (typeof character.kc === "number") p.kc = character.kc;
        if (typeof character.saturation === "number") p.saturation = character.saturation;
        if (typeof character.stomach === "number") p.stomach = character.stomach;
        if (Array.isArray(character.inventory)) {
            p.inventory = character.inventory.slice(0, 40);
            while (p.inventory.length < 5) p.inventory.push(null);
            for (const s of p.inventory) Hide.migrateStackItemId(s);
        }
        if (character.equipment && typeof character.equipment === "object") {
            p.equipment = {
                head: character.equipment.head ?? null,
                torso: character.equipment.torso ?? null,
                legs: character.equipment.legs ?? null,
                feet: character.equipment.feet ?? null,
                back: character.equipment.back ?? null,
                waist: Array.isArray(character.equipment.waist)
                    ? character.equipment.waist.slice()
                    : []
            };
        }
        if (Array.isArray(character.overflow)) {
            p.overflow = character.overflow.slice(0, 16);
        }
        if (typeof character.hotbarIndex === "number") {
            p.hotbarIndex = Math.max(0, Math.min(p.inventory.length - 1, character.hotbarIndex));
        }
        if (typeof character.hp === "number") p.hp = character.hp;
        if (typeof character.mhp === "number") p.mhp = character.mhp;
        if (character.body !== undefined) p.body = character.body;
        if (character.look) {
            p.look = Look.normalizeLook(character.look);
            if (p.creature) p.creature.look = p.look;
        }
        if (Array.isArray(character.party)) {
            p.party = character.party.map((m) => this._companionFromSnap(p, m));
        }
        if (character.controlId) p.controlId = character.controlId;
        if (character.lastSleep) p.lastSleep = character.lastSleep;
        if (typeof character.resting === "boolean") p._joinRestHint = !!character.resting;
        if (character.techs && typeof character.techs === "object" && !Array.isArray(character.techs)) {
            p.techs = { ...character.techs };
        }
        if (Array.isArray(character.quarantine)) {
            p.quarantine = character.quarantine.filter((s) => s && s.id);
        }
        if (character.techGrantRev != null) {
            p.techGrantRev = Math.max(0, Math.floor(Number(character.techGrantRev) || 0));
        }
        if (p.hp <= 0) {
            p.dead = true;
        }
        this._migratePlayerSpoilLeft(p);
        for (const m of p.party || []) this._migratePlayerSpoilLeft(m);
        this._keepKnownTechs(p);
        this._ensureEquipment(p);
        // Pull before inventory/overflow size sync. That sync drops stacks past
        // the equipped bag size onto the ground, which would lose unknown gear.
        this._pullUnknownGear(p);
        this._syncPlayerInvSize(p);
        this._restoreQuarantine(p);
        this._enforceCarryCap(p);
        for (const m of p.party || []) {
            this._keepKnownTechs(m);
            this._ensureEquipment(m);
            this._pullUnknownGear(m);
            this._syncPlayerInvSize(m);
            this._restoreQuarantine(m);
            this._enforceCarryCap(m);
        }
        if (this.players.has(p.id) || p.creature) {
            this._ensurePlayerCreature(p);
        }
    },

    _freshPawn(id, name) {
        const pose = this._pickRandomSpawnPose(4);
        return {
            id,
            name: name || "Player",
            x: pose.x,
            y: pose.y,
            facing: "down",
            vx: 0,
            vy: 0,
            moveX: 0,
            moveY: 0,
            sprint: false,
            kc: 1200,
            saturation: 0,
            stomach: 1600,
            hunger: 2000,
            inventory: emptyInv(5),
            overflow: [],
            equipment: { head: null, torso: null, legs: null, feet: null, back: null, waist: [] },
            hotbarIndex: 0,
            hp: 100,
            mhp: 100,
            body: null,
            dead: false,
            prone: false,
            attackTimer: 0,
            attackMax: 0,
            attackAngle: 0,
            /** Latest aim while a swing is busy — autofire must not drop attacks to RTT. */
            pendingAttackAngle: null,
            eatChannel: null,
            vomitRemainingMs: 0,
            vomitDripAccMs: 0,
            connected: true,
            viewChunks: INTEREST,
            poseAuth: false,
            lastInputMs: 0,
            look: Look.normalizeLook(null),
            party: [],
            controlId: id,
            ownerId: id,
            techs: Object.create(null),
            techGrantRev: 0,
            quarantine: []
        };
    },

    _knownItem(id) {
        return !!(id && itemDefs().get(id));
    },

    _knownTechMap(techs) {
        const out = Object.create(null);
        if (!techs || typeof techs !== "object" || Array.isArray(techs)) return out;
        const research = _research();
        for (const [id, on] of Object.entries(techs)) {
            if (!on || !id) continue;
            if (research?.techById?.(id)) out[id] = true;
        }
        return out;
    },

    _keepKnownTechs(p) {
        if (!p) return;
        p.techs = this._knownTechMap(p.techs);
    },

    /**
     * Unknown gear leaves active slots so it cannot be swung as unarmed fallback.
     * Call before inventory and overflow size sync, which drops extra stacks.
     */
    _pullUnknownGear(p) {
        if (!p) return;
        const bin = Array.isArray(p.quarantine) ? p.quarantine.filter((s) => s && s.id) : [];
        const pull = (stack) => {
            if (!stack?.id) return stack || null;
            if (this._knownItem(stack.id)) return stack;
            bin.push(stack);
            return null;
        };
        if (Array.isArray(p.inventory)) p.inventory = p.inventory.map((s) => pull(s));
        if (Array.isArray(p.overflow)) {
            const next = [];
            for (const s of p.overflow) {
                if (!s) continue;
                const kept = pull(s);
                if (kept) next.push(kept);
            }
            p.overflow = next;
        }
        const eq = p.equipment;
        if (eq && typeof eq === "object") {
            for (const key of ["head", "torso", "legs", "feet", "back"]) {
                eq[key] = pull(eq[key]);
            }
            if (Array.isArray(eq.waist)) {
                const waist = [];
                for (const s of eq.waist) {
                    if (!s) continue;
                    const kept = pull(s);
                    if (kept) waist.push(kept);
                }
                eq.waist = waist;
            }
        }
        p.quarantine = bin;
    },

    /** Stacks whose defs exist again move into empty inventory slots. */
    _restoreQuarantine(p) {
        if (!p) return;
        if (!Array.isArray(p.inventory)) p.inventory = emptyInv(5);
        const bin = Array.isArray(p.quarantine) ? p.quarantine : [];
        const stay = [];
        for (const stack of bin) {
            if (!stack?.id) continue;
            if (!this._knownItem(stack.id)) {
                stay.push(stack);
                continue;
            }
            const meta = itemDefs().get(stack.id);
            const maxStack = Math.max(1, Math.floor(Number(meta?.maxStack) || 99));
            let qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
            while (qty > 0) {
                const idx = p.inventory.findIndex((s) => !s);
                if (idx < 0) {
                    stay.push({ ...stack, quantity: qty });
                    qty = 0;
                    break;
                }
                const take = Math.min(maxStack, qty);
                p.inventory[idx] = { ...stack, quantity: take };
                qty -= take;
            }
        }
        p.quarantine = stay;
    },

    _companionFromSnap(owner, m) {
        const id = m.id || uuid();
        const rec = {
            id,
            name: m.name || CavemanNames.generate(),
            x: Number.isFinite(m.x) ? m.x : owner.x + 16,
            y: Number.isFinite(m.y) ? m.y : owner.y,
            facing: m.facing || "down",
            kc: m.kc ?? 800,
            saturation: m.saturation ?? 0,
            stomach: m.stomach ?? 1600,
            inventory: this._clonePersistSlots(
                Array.isArray(m.inventory) ? m.inventory : emptyInv(5),
                5
            ),
            overflow: this._clonePersistSlots(m.overflow),
            equipment: this._clonePersistEquipment(m.equipment),
            hotbarIndex: m.hotbarIndex || 0,
            hp: m.hp ?? 100,
            mhp: m.mhp ?? 100,
            body: m.body || null,
            look: Look.normalizeLook(m.look),
            dead: false,
            ownerId: owner.id,
            leaderId: owner.id,
            role: "companion",
            lastSleep: m.lastSleep || null,
            _resting: false,
            _joinRestHint: !!m.resting,
            techs: m.techs && typeof m.techs === "object" && !Array.isArray(m.techs)
                ? { ...m.techs }
                : Object.create(null),
            quarantine: Array.isArray(m.quarantine) ? m.quarantine.filter((s) => s && s.id) : []
        };
        this._restoreLogoutPose(rec);
        this._ensureCompanionCreature(owner, rec);
        return rec;
    },

    _ensureCompanionCreature(owner, rec) {
        if (!rec) return null;
        let creature = this.creatures.get(rec.id);
        if (!creature) {
            creature = createPlayerCreature(
                {
                    id: rec.id,
                    name: rec.name,
                    x: rec.x,
                    y: rec.y,
                    facing: rec.facing,
                    inventory: rec.inventory,
                    equipment: rec.equipment,
                    hotbarIndex: rec.hotbarIndex,
                    body: rec.body,
                    look: rec.look
                },
                this.dataStore,
                this._creatureCtx()
            );
            creature.ownerId = owner.id;
            creature.leaderId = owner.id;
            creature.role = "companion";
            creature.faction = Party.partyFactionId(owner.id);
            this.creatures.set(rec.id, creature);
        }
        rec.creature = creature;
        creature.x = rec.x;
        creature.y = rec.y;
        this._sharePawnGear(rec, creature);
        creature.hotbarIndex = rec.hotbarIndex ?? 0;
        creature.ownerId = owner.id;
        creature.leaderId = owner.id;
        creature.role = "companion";
        creature.homeSettlementId = rec.homeSettlementId || null;
        creature.faction = Party.partyFactionId(owner.id);
        this._bindPartyAI(creature);
        if (!creature.homeSettlementId && creature.ai) {
            creature.ai._idleWanderState = null;
            creature.ai._idleWanderDest = null;
            creature.ai._path = null;
        }
        return creature;
    },

    /**
     * WandererStrollAI extends PartyAI, so `instanceof PartyAI` stays true after
     * recruit and they keep strolling until relog. Require the exact class.
     */
    _bindPartyAI(creature) {
        if (!creature) return null;
        if (creature.ai && creature.ai.constructor === PartyAI) return creature.ai;
        creature.walkDest = null;
        creature.setDesiredVel?.(0, 0);
        creature.vx = 0;
        creature.vy = 0;
        creature.ai = new PartyAI(creature);
        return creature.ai;
    },

    _clonePersistStack(stack) {
        if (!stack || typeof stack !== "object" || !stack.id) return null;
        try {
            return JSON.parse(JSON.stringify(stack));
        } catch (_) {
            return {
                id: stack.id,
                quantity: Math.max(1, Math.floor(Number(stack.quantity) || 1))
            };
        }
    },

    _clonePersistSlots(slots, minLen = 0) {
        const src = Array.isArray(slots) ? slots : [];
        const out = src.map((s) => this._clonePersistStack(s));
        while (out.length < minLen) out.push(null);
        return out;
    },

    _clonePersistEquipment(eq) {
        const e = eq && typeof eq === "object" ? eq : {};
        return {
            head: this._clonePersistStack(e.head),
            torso: this._clonePersistStack(e.torso),
            legs: this._clonePersistStack(e.legs),
            feet: this._clonePersistStack(e.feet),
            back: this._clonePersistStack(e.back),
            waist: Array.isArray(e.waist) ? e.waist.map((s) => this._clonePersistStack(s)) : []
        };
    },

    _slotsWithItems(...bags) {
        let fallback = null;
        for (const bag of bags) {
            if (!Array.isArray(bag)) continue;
            if (!fallback) fallback = bag;
            if (bag.some((s) => s && s.id)) return bag;
        }
        return fallback;
    },

    _emptyEquipment() {
        return { head: null, torso: null, legs: null, feet: null, back: null, waist: [] };
    },

    _equipmentHasItems(eq) {
        if (!eq || typeof eq !== "object") return false;
        for (const key of ["head", "torso", "legs", "feet", "back"]) {
            if (eq[key]?.id) return true;
        }
        return Array.isArray(eq.waist) && eq.waist.some((s) => s && s.id);
    },

    _equipmentWithItems(...eqs) {
        let fallback = null;
        for (const eq of eqs) {
            if (!eq || typeof eq !== "object") continue;
            if (!fallback) fallback = eq;
            if (this._equipmentHasItems(eq)) return eq;
        }
        return fallback;
    },

    /** Keep rec and creature on the same filled bags. Empty snapshots must not wipe loot. */
    _sharePawnGear(rec, creature) {
        if (!rec) return;
        const inv = this._slotsWithItems(rec.inventory, creature?.inventory) || rec.inventory || emptyInv(5);
        const over = this._slotsWithItems(rec.overflow, creature?.overflow) || rec.overflow || [];
        const eq = this._equipmentWithItems(rec.equipment, creature?.equipment)
            || rec.equipment
            || this._emptyEquipment();
        rec.inventory = inv;
        rec.overflow = over;
        rec.equipment = eq;
        if (!creature) return;
        creature.inventory = inv;
        creature.overflow = over;
        creature.equipment = eq;
        creature.hotbarIndex = rec.hotbarIndex ?? creature.hotbarIndex ?? 0;
    },

    /**
     * Character saves still list people after drop-off. Join would spawn them
     * as empty companions AND as settlers, then ticks copy the empty bags over.
     */
    _reconcilePartyAndSettlers(p) {
        if (!p) return;
        const parked = new Map();
        for (const s of this.settlers || []) {
            if (s?.id) parked.set(String(s.id), s);
        }
        if (!parked.size) return;
        const keep = [];
        for (const m of p.party || []) {
            if (!m?.id) continue;
            const rec = parked.get(String(m.id));
            if (!rec) {
                keep.push(m);
                continue;
            }
            this._sharePawnGear(rec, m);
            const creature = rec.creature || m.creature || this.creatures.get(rec.id);
            if (creature) this._sharePawnGear(rec, creature);
            rec.creature = creature || rec.creature;
        }
        p.party = keep;
    },

    _settlerFromSnap(snap) {
        if (!snap?.id) return null;
        const rec = {
            id: snap.id,
            name: snap.name,
            look: snap.look,
            x: snap.x,
            y: snap.y,
            facing: snap.facing || "down",
            kc: snap.kc ?? 1200,
            saturation: snap.saturation ?? 0,
            stomach: snap.stomach ?? 1600,
            inventory: this._clonePersistSlots(
                Array.isArray(snap.inventory) ? snap.inventory : emptyInv(5),
                5
            ),
            overflow: this._clonePersistSlots(snap.overflow),
            equipment: this._clonePersistEquipment(snap.equipment),
            hotbarIndex: snap.hotbarIndex || 0,
            body: snap.body || null,
            hp: snap.hp ?? 100,
            mhp: snap.mhp ?? 100,
            ownerId: snap.ownerId || null,
            homeSettlementId: snap.homeSettlementId || null,
            role: "settler",
            lastSleep: snap.lastSleep || null,
            resting: !!snap.resting,
            _resting: !!snap.resting
        };
        for (const s of rec.inventory) Hide.migrateStackItemId(s);
        for (const s of rec.overflow) Hide.migrateStackItemId(s);
        this._ensureEquipment(rec);
        this._syncPlayerInvSize(rec);
        this._migratePlayerSpoilLeft(rec);
        return rec;
    },

    /** Full pawn for world save. `_publicSettler` is the lean net pose. */
    _persistSettler(s) {
        if (!s) return null;
        const c = s.creature || this.creatures.get(s.id);
        return {
            id: s.id,
            name: s.name,
            look: s.look,
            x: s.x,
            y: s.y,
            facing: s.facing || "down",
            kc: s.kc,
            saturation: s.saturation,
            stomach: s.stomach,
            inventory: this._clonePersistSlots(
                this._slotsWithItems(s.inventory, c?.inventory) || emptyInv(5),
                5
            ),
            overflow: this._clonePersistSlots(this._slotsWithItems(s.overflow, c?.overflow)),
            equipment: this._clonePersistEquipment(
                this._equipmentWithItems(s.equipment, c?.equipment)
            ),
            hotbarIndex: s.hotbarIndex || 0,
            body: (c?.anatomy && c.anatomy.toJSON()) || s.body || null,
            hp: s.hp ?? 100,
            mhp: s.mhp ?? 100,
            ownerId: s.ownerId || null,
            homeSettlementId: s.homeSettlementId || null,
            role: "settler",
            lastSleep: s.lastSleep || null,
            resting: !!(s._resting || s.resting)
        };
    },

    _publicSettler(s) {
        if (!s) return null;
        const c = s.creature || this.creatures.get(s.id);
        const motion = this._poseMotion(s);
        return {
            id: s.id,
            name: s.name,
            x: s.x,
            y: s.y,
            facing: s.facing,
            vx: motion.vx,
            vy: motion.vy,
            moving: motion.moving,
            look: s.look,
            ownerId: s.ownerId,
            homeSettlementId: s.homeSettlementId,
            role: "settler",
            dead: !!s.dead,
            prone: !!(s.dead || s.prone || s._resting || this._creatureIsProne(c)),
            resting: !!s._resting,
            injured: !!(typeof Sleep !== "undefined" && Sleep.injuredForAutofill
                ? Sleep.injuredForAutofill(c?.anatomy || s.anatomy)
                : false),
            restRot: s.lastSleep?.rot,
            lastSleep: s.lastSleep || null,
            attacking: !(s.dead || s.prone || s._resting || this._creatureIsProne(c)) && (s.attackTimer || 0) > 0,
            attackAngle: !(s.dead || s.prone || s._resting || this._creatureIsProne(c)) && (s.attackTimer || 0) > 0
                ? (s.attackAngle ?? null)
                : null,
            attackProgress: !(s.dead || s.prone || s._resting || this._creatureIsProne(c))
                && (s.attackTimer || 0) > 0
                && (s.attackMax || c?.attackMax || 0) > 0
                ? 1 - (s.attackTimer || 0) / (s.attackMax || c?.attackMax || 1)
                : 0,
            attackArt: !(s.dead || s.prone || s._resting || this._creatureIsProne(c)) && (s.attackTimer || 0) > 0
                ? (s.attackArt || null)
                : null,
            channel: SettlerWork.publicChannel?.(s) || null,
            activity: (typeof s._settlerAct === "string" && s._settlerAct)
                ? s._settlerAct
                : null,
            hostile: this._settlerCampHostile(s),
            kc: Number(s.kc) || 0,
            saturation: Number(s.saturation) || 0,
            stomach: Number(s.stomach) || 1600,
            inventory: this._clonePersistSlots(
                this._slotsWithItems(s.inventory, c?.inventory) || [],
                5
            ),
            overflow: this._clonePersistSlots(this._slotsWithItems(s.overflow, c?.overflow)),
            equipment: this._clonePersistEquipment(
                this._equipmentWithItems(s.equipment, c?.equipment)
            ),
            hotbarIndex: s.hotbarIndex ?? 0
        };
    },

    _ensureSettlerCreature(rec) {
        if (!rec) return null;
        let creature = this.creatures.get(rec.id);
        if (!creature) {
            creature = createPlayerCreature(
                {
                    id: rec.id,
                    name: rec.name,
                    x: rec.x,
                    y: rec.y,
                    facing: rec.facing,
                    inventory: rec.inventory,
                    equipment: rec.equipment,
                    hotbarIndex: rec.hotbarIndex,
                    body: rec.body,
                    look: rec.look
                },
                this.dataStore,
                this._creatureCtx()
            );
            this.creatures.set(rec.id, creature);
        }
        rec.creature = creature;
        creature.x = rec.x;
        creature.y = rec.y;
        this._sharePawnGear(rec, creature);
        creature.hotbarIndex = rec.hotbarIndex ?? 0;
        creature.ownerId = rec.ownerId;
        creature.leaderId = rec.ownerId;
        creature.role = "settler";
        creature.homeSettlementId = rec.homeSettlementId;
        creature.faction = Party.partyFactionId(rec.ownerId);
        creature._resting = !!(rec._resting || rec.resting);
        creature._restWalk = rec._restWalk || null;
        creature._wadeWater = !!rec._wadeWater;
        creature.lastSleep = rec.lastSleep || creature.lastSleep;
        creature._chopIgnoreUid = rec._chopIgnoreUid || null;
        creature._pathIgnoreUid = rec._pathIgnoreUid || null;
        this._bindPartyAI(creature);
        return creature;
    },

    _pawnFromSave(saved, displayName) {
        const p = {
            ...this._freshPawn(saved.id, displayName || saved.name),
            x: saved.x,
            y: saved.y,
            facing: saved.facing || "down",
            kc: saved.kc ?? 1200,
            saturation: saved.saturation ?? 0,
            stomach: saved.stomach ?? 1600,
            inventory: Array.isArray(saved.inventory) ? saved.inventory : emptyInv(5),
            overflow: Array.isArray(saved.overflow) ? saved.overflow : [],
            equipment: saved.equipment || { head: null, torso: null, legs: null, feet: null, back: null, waist: [] },
            hotbarIndex: saved.hotbarIndex || 0,
            hp: saved.hp ?? 100,
            mhp: saved.mhp ?? 100,
            body: saved.body || null,
            dead: !!(saved.hp != null && saved.hp <= 0)
        };
        // Stale pose from a previous world seed / water / void → random near origin
        const seedMismatch = saved.worldSeed == null || saved.worldSeed !== this.seed;
        if (seedMismatch || this.isBlocked(p.x, p.y)) {
            const pose = this._pickRandomSpawnPose(4);
            p.x = pose.x;
            p.y = pose.y;
            p.dead = false;
            if (p.hp <= 0) p.hp = p.mhp;
        }
        return p;
    },

    removePlayer(playerId, { save = false } = {}) {
        const p = this.players.get(playerId);
        if (!p) return null;
        this._cancelChannels(p);
        p.connected = false;
        this._vacatePawn(p);
        for (const m of p.party || []) this._vacatePawn(m);
        this._sanitizeSleepOccupants();
        this._applyRestClock();
        this._saveLogoutPose(p);
        const finalYou = this.youPayload(playerId);
        this._clearPlayerCampfireAttend(playerId);
        this._clearPvpOwner(p.id);
        this.players.delete(playerId);
        this.creatures.delete(playerId);
        for (const m of p.party || []) {
            this.creatures.delete(m.id);
        }
        if (p.creature) p.creature = null;
        this.pushEvent({ kind: "chat", text: `${p.name} left`, system: true });
        // Persist pose immediately so rejoin works before the next autosave.
        try {
            this.saveAll();
        } catch (e) {
            console.warn("[world] logout pose save failed", e);
        }
        return finalYou;
    },

    _clearEatChannel(pawn) {
        if (!pawn?.eatChannel) return;
        pawn.eatChannel = null;
        this._pushEatChannelEvent(pawn, { progress: 0, done: true, cancelled: true });
        this._dirtyPawnOwner(pawn);
    },

    _interruptEatsForControl(session, controlId) {
        if (!session || !controlId) return;
        for (const m of this._ownedPawns(session)) {
            if (!m) continue;
            const c = m.creature || this.creatures.get(m.id);
            if (c?.ai?.eatSeek?.id === controlId) c.ai.eatSeek = null;
            const ch = m.eatChannel;
            if (!ch) continue;
            if (m.id === controlId || ch.fromId === controlId) this._clearEatChannel(m);
        }
    },

    _cancelControlRestWalk(session, controlId) {
        if (!session || !controlId) return;
        const pawn = this._ownedPawns(session).find((m) => m && m.id === controlId);
        if (!pawn?._restWalk) return;
        pawn._restWalk = null;
        const c = pawn.creature || this.creatures.get(pawn.id);
        if (c) {
            c._restWalk = null;
            c.setDesiredVel?.(0, 0);
        }
        this._dirtyPawnOwner(pawn);
    },

    _setControlId(p, pawnId, { allowDead = false } = {}) {
        if (!p || pawnId == null) return false;
        if (pawnId !== p.id) {
            const mem = (p.party || []).find((m) => m.id === pawnId);
            if (!mem) return false;
            if (!allowDead && mem.dead) return false;
        }
        const prev = p.controlId;
        p.controlId = pawnId;
        if (prev !== pawnId) {
            this._interruptEatsForControl(p, pawnId);
            this._cancelControlRestWalk(p, pawnId);
        }
        return true;
    },

    _cancelChannels(p) {
        if (!p) return;
        const wasTending = !!p.tendChannel;
        this._clearEatChannel(p);
        p.tendChannel = null;
        p.tending = false;
        p._workChannel = null;
        p.attackTimer = 0;
        p.attackArt = null;
        if (wasTending) {
            this._pushTendChannelEvent(p, { progress: 0, done: true, cancelled: true });
            this._dirtyPawnOwner(p);
        }
    },

    _isVomiting(p) {
        return Number(p?.vomitRemainingMs) > 0;
    },

    _clearVomit(p) {
        if (!p) return;
        p.vomitRemainingMs = 0;
        p.vomitDripAccMs = 0;
        const creature = p.creature || this.creatures.get(p.id);
        if (creature) {
            creature._vomitRemainingMs = 0;
            creature._vomitDripAccMs = 0;
        }
    },

    _starvePlayer(p, kc) {
        if (!p) return;
        const lose = Math.max(0, Number(kc) || 0);
        if (!(lose > 0)) return;
        p.saturation = Number(p.saturation) || 0;
        p.kc = Number(p.kc) || 0;
        p.saturation -= lose;
        if (p.saturation < 0) {
            p.kc = Math.max(0, p.kc + p.saturation);
            p.saturation = 0;
        }
    },

    _vomitOrigin(p) {
        const creature = p?.creature || this.creatures.get(p?.id);
        const c = creature?.bodyCenter?.() || { x: p.x, y: p.y };
        const ts = TS;
        let dx = 0;
        let dy = 0;
        if (p.facing === "right") dx = 1;
        else if (p.facing === "left") dx = -1;
        else if (p.facing === "down") dy = 1;
        else dy = -1;
        const dist = ts * 0.4;
        return {
            x: c.x + dx * dist,
            y: c.y + dy * dist - (dy === 0 ? ts * 0.15 : 0),
            facing: p.facing || "down"
        };
    },

    _beginPlayerVomit(creature, remainingMs) {
        const pawn = this._findOwnedPawn(creature?.id);
        if (!pawn || pawn.dead) return;
        pawn.eatChannel = null;
        pawn.pendingAttackAngle = null;
        pawn.vomitRemainingMs = Math.max(1, Number(remainingMs) || 8000);
        pawn.vomitDripAccMs = 0;
        const session = this._sessionOfPawn(pawn);
        if (session && pawn === session) {
            session.moveX = 0;
            session.moveY = 0;
            session.sprint = false;
        }
        this._vomitDrip(pawn, { start: true });
        this._dirtyPawnOwner(pawn);
    },

    _vomitDrip(p, opts = {}) {
        this._starvePlayer(p, 0.04 * (Number(p.stomach) || 1600));
        const origin = this._vomitOrigin(p);
        this.pushEvent({
            kind: "vomit",
            playerId: this._sessionOfPawn(p)?.id || p.id,
            pawnId: p.id,
            x: origin.x,
            y: origin.y,
            facing: origin.facing,
            remainingMs: Math.max(0, Number(p.vomitRemainingMs) || 0),
            drip: !opts.start
        });
        this._dirtyPawnOwner(p);
    },

    _tickPlayerVomit(p, dtMs) {
        if (!this._isVomiting(p)) return;
        p.vomitRemainingMs -= dtMs;
        p.vomitDripAccMs = (Number(p.vomitDripAccMs) || 0) + dtMs;
        while (p.vomitDripAccMs >= 2500) {
            p.vomitDripAccMs -= 2500;
            if (p.vomitRemainingMs > 0) this._vomitDrip(p);
        }
        if (!(p.vomitRemainingMs > 0)) {
            this._clearVomit(p);
            this._youDirty.add(p.id);
        }
    },
    };
});
