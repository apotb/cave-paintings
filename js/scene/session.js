/**
 * SceneMain prototype methods (session).
 * Installed onto SceneMain.prototype. Method bodies are unchanged.
 */
(function (root) {
    "use strict";
    root.SceneMainSession = {

    /** Session play (WebSocket MP or LocalSim SP): sync via protocol, character owned client-side. */
    _setupNetPlay() {
        this._netPlayerId = this.welcome?.playerId || this.net?.playerId || this.characterId || this._netPlayerId;
        const you = this.welcome?.you || {};
        if (typeof you.x === "number" && typeof you.y === "number") {
            this.player.teleport(you.x, you.y);
            this.syncCameraToPlayer();
        }
        this._netWandererGraceUntil = performance.now() + 3000;
        if (this.welcome?.wanderers) this._netApplyWanderers(this.welcome.wanderers);
        // First SP entry into a world: let ensureSpawnSign run pickRandomSpawnTile (same as respawn).
        // Dedicated MP / rejoin already have an authoritative pose on YOU.
        this._playerSpawnPlaced = !this.welcome?.firstSpawn;
        this.player.createAnimations?.();
        // Apply join snapshot (SimWorld YOU is the inventory source in both modes)
        this._netForceYouInv = true;
        if (you.inventory || you.kc != null || you.equipment) this._netApplyYou(you);
        this._netForceYouInv = false;
        this.partySys?.applyJoinParty?.(you, this.character, { join: true });
        this._restorePartySleep?.();

        this.net.clearHandlers?.();
        this.net.on(NetProtocol.Types.SNAPSHOT, (payload) => this._netApplySnapshot(payload));
        this.net.on(NetProtocol.Types.EVENT, (payload) => this._netApplyEvent(payload));
        this.net.on(NetProtocol.Types.CHUNK, (payload) => this._netApplyChunk(payload));
        this.net.on(NetProtocol.Types.YOU, (payload) => {
            this._netApplyYou(payload);
            this._scheduleCharacterSave(payload);
        });
        this.net.on(NetProtocol.Types.SESSION_END, (payload) => {
            if (payload?.reason && payload.reason !== "disconnect") {
                this._netDisconnectReason = payload.reason === "kicked"
                    ? "Kicked from server."
                    : String(payload.reason);
            }
            if (payload?.you) this._lastYou = payload.you;
            // Leave flow already saves + awaits LocalSim.close; skip racing another save.
            if (!this._leavingGame && !this._netLeaving) {
                this._saveCharacterNow(payload?.you);
            }
        });
        this.net.on(NetProtocol.Types.REJECT, (payload) => {
            this._netDisconnectReason = payload?.reason || "Kicked from server.";
        });
        if (this._onNetClose) this.net.off("close", this._onNetClose);
        this._onNetClose = () => this._netOnDisconnect();
        this.net.on("close", this._onNetClose);

        // LocalSim needs Chunk helpers from this scene before RESYNC interest
        this.net.attachScene?.(this);

        this.net.flushAndListen();
        this.net.sendAction({ type: NetProtocol.Actions.RESYNC });
        this._bootSettlements?.(this.welcome?.you);
        if (!this._worldBooting) this._netSendMove(true);
        this._onVisSave = () => {
            if (document.visibilityState === "hidden") this._saveCharacterNow();
        };
        document.addEventListener("visibilitychange", this._onVisSave);
        if (this._worldBooting) this._runWorldBoot();
        else this._startCharacterAutosave();
    },

    _startCharacterAutosave() {
        if (this._charSaveTimer || !this.time) return;
        this._charSaveTimer = this.time.addEvent({
            delay: 15000,
            loop: true,
            callback: () => this._saveCharacterNow()
        });
    },

    _bootSettlements(you) {
        const sys = this.settlementSys;
        if (!sys) return;
        const world = {
            settlements: you?.settlements || this.welcome?.you?.settlements || this.welcome?.settlements || [],
            settlers: you?.settlers || this.welcome?.you?.settlers || this.welcome?.settlers || []
        };
        if (world.settlements.length || world.settlers.length) {
            sys.loadFromWorld(world);
            sys.spawnSavedSettlers(world);
        }
    },

    _playerCharacterPartial() {
        const pl = this.leader || this.player;
        if (!pl) return null;
        const extra = this.partySys?.serializeParty?.() || {};
        return {
            name: this.playerName || pl.pawnName || pl.name,
            inventory: pl.inventory,
            overflow: pl.overflow,
            equipment: pl.equipment,
            hotbarIndex: pl.hotbarIndex,
            kc: pl.kc,
            saturation: pl.saturation,
            stomach: pl.stomach,
            body: pl.anatomy?.toJSON?.() ?? null,
            hp: pl.hp,
            mhp: pl.mhp,
            look: pl.look || this.character?.look || null,
            facing: pl.facing,
            x: pl.x,
            y: pl.y,
            controlId: extra.controlId || this.player?.pawnId,
            leaderDead: !!extra.leaderDead,
            party: extra.party || [],
            lastSleep: pl.lastSleep || null,
            resting: !!pl._resting,
            techs: pl.techs && typeof pl.techs === "object" ? { ...pl.techs } : (this.character?.techs || {}),
            techGrantRev: pl.techGrantRev ?? this.character?.techGrantRev ?? 0,
            quarantine: Array.isArray(pl.quarantine)
                ? pl.quarantine
                : (Array.isArray(this._lastYou?.quarantine) ? this._lastYou.quarantine : null)
        };
    },

    _scheduleCharacterSave(you) {
        if (you) this._lastYou = you;
        // Debounce burst YOU updates
        if (this._charSaveSoon || this._charSaveFrozen || this._leavingGame) return;
        this._charSaveSoon = true;
        this._charSaveSoonEvent = this.time?.delayedCall?.(400, () => {
            this._charSaveSoon = false;
            this._charSaveSoonEvent = null;
            if (this._charSaveFrozen || this._leavingGame) return;
            this._saveCharacterNow();
        });
    },

    _cloneSaveStack(s) {
        if (!s) return null;
        if (typeof cloneItemStack === "function") return cloneItemStack(s);
        try {
            return JSON.parse(JSON.stringify(s));
        } catch (_) {
            return { id: s.id, quantity: s.quantity || 1 };
        }
    },

    /** Live gear snapshot for IndexedDB — what is on the hotbar, not a stale YOU. */
    _characterSavePartial() {
        this._flushPendingYouGear?.();
        const raw = this._playerCharacterPartial();
        if (!raw) return null;
        const eq = raw.equipment;
        const cloneEq = (equipment) => {
            if (!equipment || typeof equipment !== "object") return equipment;
            return {
                head: this._cloneSaveStack(equipment.head),
                torso: this._cloneSaveStack(equipment.torso),
                legs: this._cloneSaveStack(equipment.legs),
                feet: this._cloneSaveStack(equipment.feet),
                back: this._cloneSaveStack(equipment.back),
                waist: Array.isArray(equipment.waist)
                    ? equipment.waist.map((s) => this._cloneSaveStack(s))
                    : []
            };
        };
        const cloneParty = (members) => {
            if (!Array.isArray(members)) return members;
            return members.map((m) => ({
                id: m.id,
                name: m.name,
                look: m.look,
                kc: m.kc,
                saturation: m.saturation,
                stomach: m.stomach,
                inventory: Array.isArray(m.inventory)
                    ? m.inventory.map((s) => this._cloneSaveStack(s))
                    : m.inventory,
                overflow: Array.isArray(m.overflow)
                    ? m.overflow.map((s) => this._cloneSaveStack(s))
                    : m.overflow,
                equipment: cloneEq(m.equipment),
                quarantine: Array.isArray(m.quarantine)
                    ? m.quarantine.map((s) => this._cloneSaveStack(s)).filter(Boolean)
                    : (Array.isArray(this._lastYou?.party?.find?.((row) => row?.id === m.id)?.quarantine)
                        ? this._lastYou.party.find((row) => row.id === m.id).quarantine
                            .map((s) => this._cloneSaveStack(s)).filter(Boolean)
                        : []),
                hotbarIndex: m.hotbarIndex,
                body: m.body,
                hp: m.hp,
                mhp: m.mhp,
                facing: m.facing,
                x: m.x,
                y: m.y,
                lastSleep: m.lastSleep || null,
                resting: !!m.resting
            }));
        };
        return {
            ...raw,
            quarantine: Array.isArray(raw.quarantine)
                ? raw.quarantine.map((s) => this._cloneSaveStack(s)).filter(Boolean)
                : raw.quarantine,
            inventory: Array.isArray(raw.inventory)
                ? raw.inventory.map((s) => this._cloneSaveStack(s))
                : raw.inventory,
            overflow: Array.isArray(raw.overflow)
                ? raw.overflow.map((s) => this._cloneSaveStack(s))
                : (raw.overflow || []),
            equipment: cloneEq(eq),
            party: cloneParty(raw.party)
        };
    },

    _inventoryFilledCount(inv) {
        return Array.isArray(inv) ? inv.filter(Boolean).length : -1;
    },

    async _saveCharacterNow(youOverride = null, opts = {}) {
        if (this._worldBooting && !opts.final) return;
        if (!this.characterId || typeof CharacterStore === "undefined") return;
        if (this._charSaveFrozen) return;
        if (this._leavingGame && !opts.final) return;
        // Wait for any in-flight save so leave/quit never skips a write.
        while (this._charSavePromise) {
            await this._charSavePromise;
            if (this._charSaveFrozen) return;
            if (this._leavingGame && !opts.final) return;
        }
        this._charSaveBusy = true;
        this._charSavePromise = (async () => {
            try {
                const live = this._characterSavePartial();
                let base = this.character;
                if (!base) base = await CharacterStore.get(this.characterId);
                if (!base) {
                    base = CharacterStore.defaultCharacter(this.playerName || "Player");
                    base.id = this.characterId;
                }
                const you = youOverride || this._lastYou;
                const pawn = this.leader || this.player;
                const pawnHere = !!(pawn && pawn.scene === this);
                const liveCount = this._inventoryFilledCount(live?.inventory);
                const youCount = this._inventoryFilledCount(you?.inventory);
                // Prefer the hotbar on screen. `_lastYou` is often a stale pawn/YOU
                // from join or hotbar-select and used to revert /give and pickups.
                const useLive = !!(live && Array.isArray(live.inventory)
                    && (pawnHere || liveCount >= youCount));
                const payload = useLive ? live : you;
                const next = payload ? CharacterStore.applyYou(base, payload) : base;
                this.character = await CharacterStore.put(next);
                if (useLive) this._lastYou = { ...(this._lastYou || {}), ...live };
            } catch (e) {
                console.warn("[character save]", e);
            } finally {
                this._charSaveBusy = false;
                this._charSavePromise = null;
            }
        })();
        return this._charSavePromise;
    },

    _netOnDisconnect() {
        if (this._netLeaving || this._netDisconnectHandled || this._leavingGame) return;
        this._netDisconnectHandled = true;
        this._netDisconnectReason = null;
        const disconnected = !this._isSingleplayerSession();
        // Save before menu (SESSION_END may already have written; this covers abrupt close)
        Promise.resolve(this._saveCharacterNow()).finally(() => {
            // Leave already owns the menu transition — don't overwrite it with Disconnected.
            if (this._leavingGame || this._netLeaving) return;
            this._netKickToMenu(disconnected ? { disconnected: true } : {});
        });
    },

    _unbindNetClose() {
        if (this.net && this._onNetClose) {
            try { this.net.off("close", this._onNetClose); } catch (_) {}
        }
        this._onNetClose = null;
    },

    _netKickToMenu(data = {}) {
        if (this._netLeaving || this._leavingGame) return;
        this._netLeaving = true;
        this._unbindNetClose();
        this._teardownCharacterAutosave();
        try {
            this.net?.close();
        } catch (_) {}
        this.scene.start("SceneMenu", data);
    },

    _teardownCharacterAutosave() {
        if (this._charSaveTimer) {
            this._charSaveTimer.remove?.(false);
            this._charSaveTimer = null;
        }
        if (this._charSaveSoonEvent) {
            this._charSaveSoonEvent.remove?.(false);
            this._charSaveSoonEvent = null;
        }
        this._charSaveSoon = false;
        if (this._onVisSave) {
            document.removeEventListener("visibilitychange", this._onVisSave);
            this._onVisSave = null;
        }
    },

    _netApplyYou(you) {
        if (!you || !this.isNet || !this.player) return;
        const youPawn = (this.party || []).find((p) => p.pawnId === you.id)
            || this.leader
            || this.player;
        // SimWorld owns gear. Skip only while dead so a stale YOU cannot refill
        // a corpse dump (the old /kms duplicate).
        const applyGear = !youPawn._bodyDead;
        if (youPawn._bodyDead) {
            this._lastYou = {
                ...you,
                inventory: youPawn.inventory,
                overflow: youPawn.overflow,
                equipment: youPawn.equipment,
                dead: true
            };
        } else {
            this._lastYou = you;
        }
        // Dedicated: honor server death (anatomy / PvP) for the crowned leader
        if (
            you.dead
            && !youPawn._bodyDead
            && this.simAuth()
            && !this.deathOverlay?.visible
        ) {
            youPawn._bodyDead = true;
            youPawn.setVelocity(0, 0);
            // Server already authored the corpse — don't dump a second empty one.
            this.onPlayerDied(null, { spawnCorpse: false });
            return;
        }
        if (this._netAwaitPoseFromYou && typeof you.x === "number" && typeof you.y === "number") {
            youPawn.teleport(you.x, you.y);
            this.syncCameraToPlayer();
            this._netAwaitPoseFromYou = false;
            this._netSendMove(true);
        }
        // Dedicated: stash latest server gear. Knapping UI owns local gear while open;
        // apply as soon as it closes. Craft/campfire stay live so craft grants, /give,
        // and pickup update the hotbar immediately.
        // Do NOT drop YOU forever while `_invSwapGuardUntil` is set — that caused /give,
        // pickup, and eat qty to only appear after relog.
        if (applyGear && (Array.isArray(you.inventory) || you.equipment)) {
            this._pendingYouTarget = youPawn;
            this._pendingYouGear = {
                inventory: Array.isArray(you.inventory) ? you.inventory : null,
                overflow: Array.isArray(you.overflow) ? you.overflow : null,
                equipment: you.equipment || null,
                hotbarIndex: you.hotbarIndex
            };
            this._flushPendingYouGear();
        }
        if (typeof you.kc === "number") youPawn.kc = you.kc;
        if (typeof you.saturation === "number") youPawn.saturation = you.saturation;
        if (typeof you.stomach === "number") youPawn.stomach = you.stomach;
        if (you.techs && typeof you.techs === "object" && !Array.isArray(you.techs)) {
            youPawn.techs = you.techs;
            if (this.player && this.player !== youPawn) this.player.techs = you.techs;
            if (this.leader && this.leader !== youPawn) this.leader.techs = you.techs;
        }
        if (you.techGrantRev != null) {
            youPawn.techGrantRev = you.techGrantRev;
            if (this.player) this.player.techGrantRev = you.techGrantRev;
            if (this.leader) this.leader.techGrantRev = you.techGrantRev;
        }
        if (typeof you.researchSpent === "number") {
            youPawn.researchSpent = you.researchSpent;
            if (this.player) this.player.researchSpent = you.researchSpent;
            if (this.leader) this.leader.researchSpent = you.researchSpent;
        }
        if (this.simAuth()) {
            this._applyPawnChannelVisual(youPawn, you.eatChannel || null, "eat");
            this._applyPawnChannelVisual(youPawn, you.tendChannel || null, "tend");
        }
        if (applyGear && you.body && youPawn.anatomy?.loadJSON) {
            try {
                youPawn.anatomy.loadJSON(you.body);
                youPawn.capacities = new Capacities(youPawn.anatomy);
                youPawn._refreshDownedState?.();
            } catch (_) {}
        }
        this._netApplyYouVomit(you, youPawn);
        // Dedicated: server rest is per-world. Character `resting` is global, so
        // YOU.resting=false must stand you up when this world has no bed.
        // `resting` is always a boolean on YOU, so the old `else if (you.prone)`
        // never ran after stand-up — leftover `_netProne` blocked melee until relog.
        if (youPawn && typeof you.resting === "boolean") {
            if (you.resting) {
                youPawn._resting = true;
                youPawn._netProne = true;
                if (you.lastSleep) youPawn.lastSleep = you.lastSleep;
                if (typeof pinRestingCreature === "function") pinRestingCreature(youPawn, this);
                else setCreatureRest?.(youPawn, true, you.lastSleep?.rot ?? you.restRot);
            } else {
                if (youPawn._resting) {
                    setCreatureRest?.(youPawn, false);
                    youPawn._resting = false;
                }
                youPawn._netProne = !!you.prone;
            }
        } else if (youPawn && typeof you.prone === "boolean" && !youPawn._resting) {
            youPawn._netProne = !!you.prone;
            setCreatureProne(
                youPawn,
                !!you.prone && !youPawn._bodyDead && !you.dead
            );
        }
        if (you.party || you.controlId) {
            this.partySys?.applyJoinParty?.(you, this.character);
        }
        if (Array.isArray(you.settlements) && this.settlementSys) {
            this.settlementSys.mergeOwnedSettlements(you.settlements);
        }
        if (Array.isArray(you.settlers)) {
            for (const row of you.settlers) {
                if (!row?.id) continue;
                if ((this.party || []).some((p) => p && p.pawnId === row.id && p.role !== "settler")) {
                    continue;
                }
                let pawn = (this.settlers || []).find((p) => p && p.pawnId === row.id);
                if (!pawn) pawn = this.settlementSys?._spawnSettlerPawn?.(row);
                if (pawn) this._netApplySettlerGear(pawn, row);
            }
        }
    },

    _sculptUiOpen() {
        return !!(this.knappingPanel?.visible || this.clayFormingPanel?.visible);
    },

    /**
     * True while a UI fully owns local gear and must not be stomped by YOU.
     * Craft is excluded: recipes are clicks only (no local gear edits) — blocking YOU
     * while craft was open hid crafted items until close and spawned phantom overflow drops.
     * Campfire is excluded: transfers wait for the sim event/YOU instead of
     * holding inventory for a second, which used to restore hotbar counts.
     */
    _inventoryUiOwnsGear() {
        return this._sculptUiOpen();
    },

    /**
     * Apply stashed YOU inventory/equipment unless knapping/craft UI owns local gear.
     * Safe to call from update / UI close; no-ops if nothing pending or UI is open.
     */
    _flushPendingYouGear() {
        const pending = this._pendingYouGear;
        const target = this._pendingYouTarget || this.leader || this.player;
        if (!pending || !target || target._bodyDead) return;
        if (target === this.player && this._inventoryUiOwnsGear()) return;
        // Keep the latest YOU stashed during an optimistic hotbar/equip edit so a
        // stale packet cannot snap icons back. Update flushes once the guard ends.
        if (
            target === this.player
            && this.simAuth()
            && performance.now() < (this._invSwapGuardUntil || 0)
        ) {
            return;
        }

        const cloneStack = (s) => {
            if (!s) return null;
            if (typeof cloneItemStack === "function") return cloneItemStack(s);
            try {
                return JSON.parse(JSON.stringify(s));
            } catch (_) {
                return { ...s };
            }
        };

        // Equipment first so pouch/hotbar grants resize inventorySize before
        // we slice the incoming hotbar (gifted pouches used to stay visually
        // equipped with no extra slots until unequip/re-equip).
        if (pending.equipment && target.equipment) {
            const eq = pending.equipment;
            target.equipment = {
                head: cloneStack(eq.head),
                torso: cloneStack(eq.torso),
                legs: cloneStack(eq.legs),
                feet: cloneStack(eq.feet),
                back: cloneStack(eq.back),
                waist: Array.isArray(eq.waist) ? eq.waist.map(cloneStack) : []
            };
            target.syncWaistSlots?.();
            target.recomputeEquipmentEffects?.();
            if (target === this.player && this.equipmentPanel?.visible) {
                this.equipmentPanel.refresh();
                this.equipmentPanel.layout();
            }
        }

        if (Array.isArray(pending.inventory)) {
            const size = target.inventorySize || 5;
            const inv = pending.inventory.slice(0, size).map(cloneStack);
            while (inv.length < size) inv.push(null);
            target.inventory = inv;
            if (typeof pending.hotbarIndex === "number") {
                const hi = Math.max(0, Math.min(
                    (this.hotbar?.size || target.inventorySize || 5) - 1,
                    Math.floor(pending.hotbarIndex)
                ));
                target.hotbarIndex = hi;
                if (target === this.player) {
                    this.hotbar?.setActiveIndex?.(hi, { notifyNet: false });
                }
            }
            if (target === this.player && this.hotbar) {
                this.hotbar.setSize?.(target.inventorySize || size);
                this.hotbar.setOverflowSize?.(target.overflowSize || 0);
                this.hotbar.dirty = true;
                // layout() resyncs icon positions + textures (update alone can miss when
                // called from a net handler while the campfire world UI is open)
                this.hotbar.layout?.();
                this.hotbar.dirty = false;
            }
        }

        if (Array.isArray(pending.overflow)) {
            const cap = Math.max(0, Number(target.overflowSize) || 0);
            const over = pending.overflow.slice(0, cap).map(cloneStack);
            while (over.length < cap) over.push(null);
            target.overflow = over;
            target.syncOverflowSize?.();
            if (target === this.player && this.hotbar) {
                this.hotbar.setOverflowSize?.(target.overflowSize || cap);
                this.hotbar.dirty = true;
                this.hotbar.layout?.();
            }
        }

        this._pendingYouGear = null;
        this._pendingYouTarget = null;
        // Ingredient counts are live in the tooltip fn — don't rebuild slots
        // (that destroys the hover target and flashes the tip every YOU / hunger tick).
        if (this.craftMenuVisible) this.refreshTooltip?.();
    },
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
