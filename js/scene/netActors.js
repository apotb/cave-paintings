/**
 * SceneMain prototype methods (netActors).
 * Installed onto SceneMain.prototype. Method bodies are unchanged.
 */
(function (root) {
    "use strict";
    root.SceneMainNetActors = {

    _netApplyChunk(meta) {
        if (!meta || !this.isNet) return;
        const corpses = (meta.corpses || []).filter((e) => e && (!e.id || !this._goneCorpseIds?.has(e.id)));
        const key = this.getKey(meta.x, meta.y);
        const existing = this.chunks[key];
        if (existing?.isLoaded) return;
        // Prefer local client blood VFX over empty server bloodStains arrays
        const mergeBlood = (serverList, localList) => {
            const local = Array.isArray(localList) ? localList : [];
            const server = Array.isArray(serverList) ? serverList : [];
            if (!server.length) return local;
            if (!local.length) return server;
            return local.concat(server);
        };
        if (existing && !existing.isGenerated) {
            // Prefer server terrain when we haven't finished local gen
            const prevBlood = existing.meta?.bloodStains;
            existing.meta = {
                tiles: meta.tiles,
                things: meta.things || [],
                lootableThings: meta.lootableThings || [],
                mobs: meta.mobs || [],
                drops: meta.drops || [],
                bloodStains: mergeBlood(meta.bloodStains, prevBlood),
                corpses,
                wanderers: meta.wanderers || []
            };
            existing.isGenerated = !!(meta.tiles && meta.tiles.some((t) => !!t));
            return;
        }
        if (existing) return;
        const chunk = new Chunk(this, meta.x, meta.y, {
            tiles: meta.tiles,
            things: meta.things || [],
            lootableThings: meta.lootableThings || [],
            mobs: meta.mobs || [],
            drops: meta.drops || [],
            bloodStains: meta.bloodStains || [],
            corpses,
            wanderers: meta.wanderers || []
        });
        chunk.isGenerated = !!(meta.tiles && meta.tiles.some((t) => !!t));
        this.chunks[key] = chunk;
    },

    _netRemoteKey(playerId, pawnId = null) {
        if (pawnId && playerId && pawnId !== playerId) return `${playerId}:${pawnId}`;
        return playerId;
    },

    _netRemoveRemotesForOwner(ownerId) {
        if (!ownerId || !this.remotePlayers) return;
        for (const [id, entry] of [...this.remotePlayers]) {
            if (id === ownerId || entry.ownerId === ownerId) {
                if (typeof clearSleepFx === "function") clearSleepFx(entry);
                else if (typeof clearSleepZzz === "function") clearSleepZzz(entry);
                this._netDestroyRemote(entry);
                this.remotePlayers.delete(id);
            }
        }
    },

    _netMakeRemote(rp) {
        const zoom = this.worldZoom || 3;
        const s = this.uiScale || 1;
        const root = this.add.container(rp.x, rp.y);
        this.mainLayer.add(root);

        const lookKey = typeof PlayerLook !== "undefined"
            ? PlayerLook.ensure(this, rp.look)
            : "human";
        const spr = this.add.sprite(0, 0, lookKey, 1).setOrigin(0, 1);
        root.add(spr);

        const nameStroke = Math.max(2, Math.round(3 * s));
        const name = this.add.text(8, -18, rp.name || "?", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(8, s)}px`,
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: nameStroke,
            align: "center"
        }).setOrigin(0.5, 1);
        if (typeof applyPixelUiWorldFont === "function") applyPixelUiWorldFont(name, 8, this);
        else {
            name.setResolution(zoom * (window.devicePixelRatio || 1));
            name.setScale(1 / zoom);
        }
        const ownerId = rp.ownerId || rp.id;
        this._placeWorldHud(name, 60, this.isPartyWorldHud({ ownerId }));

        const bubble = this.add.text(8, -30, "", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(16, s)}px`,
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: nameStroke,
            align: "center",
            wordWrap: { width: Math.round(140 * s), useAdvancedWrap: true }
        }).setOrigin(0.5, 1).setVisible(false);
        if (typeof applyPixelUiWorldFont === "function") applyPixelUiWorldFont(bubble, 16, this);
        else {
            bubble.setResolution(zoom * (window.devicePixelRatio || 1));
            bubble.setScale(1 / zoom);
        }
        this._placeWorldHud(bubble, 61, this.isPartyWorldHud({ ownerId }));

        if (typeof PlayerLook !== "undefined") PlayerLook.play(spr, rp.facing || "down", false);
        else if (this.anims.exists("idle-down")) spr.play("idle-down", true);

        const fistColor = typeof PlayerLook !== "undefined"
            ? PlayerLook.fistColor(rp.look)
            : 0xff8900;
        const fist = this.add.rectangle(0, 0, 4, 10, fistColor, 1)
            .setOrigin(0.5, 1)
            .setVisible(false);
        root.add(fist);

        const entry = {
            root,
            spr,
            name,
            bubble,
            fist,
            bubbleUntil: 0,
            x: rp.x,
            y: rp.y,
            fromX: rp.x,
            fromY: rp.y,
            tx: rp.x,
            ty: rp.y,
            snapAt: performance.now(),
            snapDt: 1000 / (NetProtocol.SNAPSHOT_HZ || 15),
            facing: rp.facing || "down",
            vx: rp.vx || 0,
            vy: rp.vy || 0,
            serverMoving: !!rp.moving,
            moving: !!rp.moving,
            stillMs: 0,
            animKey: null,
            displayName: rp.name || "?",
            ownerId: rp.ownerId || rp.id,
            attackTimer: 0,
            attackMax: 0,
            attackAngle: 0,
            prone: !!(rp.prone || rp.dead),
            resting: !!rp.resting,
            lastSleep: rp.lastSleep || null,
            restRot: rp.restRot ?? rp.lastSleep?.rot,
            look: rp.look || null,
            tex: spr.texture?.key
        };
        this._setRemoteSortDepth(entry);
        return entry;
    },

    _netStampRemotePose(entry, pose) {
        if (!entry || !pose) return;
        entry.fromX = entry.x;
        entry.fromY = entry.y;
        const prevTx = Number.isFinite(entry.tx) ? entry.tx : entry.x;
        const prevTy = Number.isFinite(entry.ty) ? entry.ty : entry.y;
        entry.snapDist = Math.hypot(pose.x - prevTx, pose.y - prevTy);
        entry.tx = pose.x;
        entry.ty = pose.y;
        entry.snapAt = performance.now();
        entry.snapDt = 1000 / (NetProtocol.SNAPSHOT_HZ || 15);
        if (typeof pose.moving === "boolean") entry.serverMoving = pose.moving;
        if (Number.isFinite(pose.vx)) entry.vx = pose.vx;
        if (Number.isFinite(pose.vy)) entry.vy = pose.vy;
    },

    _netApplySnapshot(snap) {
        if (!snap || !this.isNet) return;
        if (snap.clock) this._netApplyClock(snap.clock);
        const selfId = this._netPlayerId || this.net?.playerId;
        const seen = new Set();
        for (const rp of snap.players || []) {
            if (!rp?.id) continue;
            if (rp.id === selfId) {
                this.partySys?.applyNetPoses?.(rp);
                continue;
            }
            seen.add(rp.id);
            let entry = this.remotePlayers.get(rp.id);
            if (!entry) {
                entry = this._netMakeRemote(rp);
                this.remotePlayers.set(rp.id, entry);
            } else {
                this._netStampRemotePose(entry, rp);
            }
            entry.facing = rp.facing || "down";
            entry.displayName = rp.name || entry.displayName || "?";
            entry.name.setText(entry.displayName);
            if (rp.look && typeof Look !== "undefined" && !Look.looksEqual(entry.look, rp.look)) {
                if (typeof PlayerLook !== "undefined") {
                    PlayerLook.apply(entry.spr, rp.look);
                    entry.tex = entry.spr.texture?.key;
                    entry.animKey = null;
                    if (entry.fist) entry.fist.setFillStyle(PlayerLook.fistColor(rp.look), 1);
                }
                entry.look = rp.look;
            }
            entry.ownerId = rp.id;
            entry.pawnId = rp.id;
            entry.dead = !!rp.dead;
            const nColor = this.partySys?.nameColorFor?.({
                ownerId: rp.id,
                hostile: !!rp.hostile
            }) || "#ffffff";
            entry.name.setColor(nColor);
            entry.spr.setAlpha(1);
            entry.prone = !!(rp.prone || rp.dead);
            entry.resting = !!rp.resting;
            entry.injured = !!rp.injured;
            entry.eatChannel = rp.eatChannel && typeof rp.eatChannel.progress === "number"
                ? rp.eatChannel
                : (rp.tendChannel && typeof rp.tendChannel.progress === "number"
                    ? rp.tendChannel
                    : null);
            entry.restRot = rp.restRot ?? rp.lastSleep?.rot;
            entry.lastSleep = rp.lastSleep || null;
            // Dead players leave a corpse — no translucent ghost puppet
            entry.root.setVisible(!rp.dead);
            entry.name?.setVisible(!rp.dead);
            if (rp.dead) entry.bubble?.setVisible(false);
            if (rp.dead || rp.prone) {
                this._netClearRemoteAttack(entry);
            } else if (rp.attacking && Number.isFinite(rp.attackAngle)) {
                // Keep / start remote swing from snapshot if event was missed
                if (!(entry.attackTimer > 0)) {
                    this._netStartRemoteAttack(entry, rp.attackAngle, rp.facing, rp.attackArt);
                } else {
                    entry.attackAngle = rp.attackAngle;
                    if (rp.attackArt) entry.attackArt = rp.attackArt;
                }
            }
            for (const mem of rp.party || []) {
                if (!mem?.id) continue;
                const mid = `${rp.id}:${mem.id}`;
                seen.add(mid);
                let mEntry = this.remotePlayers.get(mid);
                if (!mEntry) {
                    mEntry = this._netMakeRemote({
                        ...mem,
                        ownerId: rp.id,
                        name: mem.name,
                        look: mem.look,
                        x: mem.x,
                        y: mem.y,
                        facing: mem.facing
                    });
                    this.remotePlayers.set(mid, mEntry);
                } else {
                    this._netStampRemotePose(mEntry, mem);
                }
                mEntry.facing = mem.facing || "down";
                mEntry.displayName = mem.name || mEntry.displayName;
                mEntry.name.setText(mEntry.displayName);
                mEntry.ownerId = rp.id;
                mEntry.pawnId = mem.id;
                mEntry.dead = !!mem.dead;
                mEntry.name.setColor(this.partySys?.nameColorFor?.({
                    ownerId: rp.id,
                    hostile: !!mem.hostile
                }) || "#ffffff");
                mEntry.prone = !!(mem.prone || mem.dead);
                mEntry.resting = !!mem.resting;
                mEntry.injured = !!mem.injured;
                mEntry.eatChannel = mem.eatChannel && typeof mem.eatChannel.progress === "number"
                    ? mem.eatChannel
                    : (mem.tendChannel && typeof mem.tendChannel.progress === "number"
                        ? mem.tendChannel
                        : null);
                mEntry.restRot = mem.restRot ?? mem.lastSleep?.rot;
                mEntry.lastSleep = mem.lastSleep || null;
                mEntry.root.setVisible(!mem.dead);
                mEntry.name?.setVisible(!mem.dead);
                if (mem.dead) mEntry.bubble?.setVisible(false);
                if (mem.look && typeof Look !== "undefined" && !Look.looksEqual(mEntry.look, mem.look)) {
                    if (typeof PlayerLook !== "undefined") {
                        PlayerLook.apply(mEntry.spr, mem.look);
                        mEntry.tex = mEntry.spr.texture?.key;
                    }
                    mEntry.look = mem.look;
                }
                if (mem.dead || mem.prone) {
                    this._netClearRemoteAttack(mEntry);
                } else if (mem.attacking && Number.isFinite(mem.attackAngle)) {
                    if (!(mEntry.attackTimer > 0)) {
                        this._netStartRemoteAttack(mEntry, mem.attackAngle, mem.facing, mem.attackArt);
                    } else {
                        mEntry.attackAngle = mem.attackAngle;
                        if (mem.attackArt) mEntry.attackArt = mem.attackArt;
                    }
                }
            }
        }
        for (const [id, entry] of this.remotePlayers) {
            if (!seen.has(id)) {
                if (typeof clearSleepFx === "function") clearSleepFx(entry);
                else if (typeof clearSleepZzz === "function") clearSleepZzz(entry);
                this._netDestroyRemote(entry);
                this.remotePlayers.delete(id);
            }
        }
        this._netApplyMobs(snap.mobs || []);
        this._netApplyDrops(snap.drops || []);
        this._netApplyCorpses(snap.corpses || []);
        this._netApplyCampfires(snap.campfires || []);
        this._netApplyStorages(snap.storages || []);
        this._netApplyWanderers(snap.wanderers || []);
        this._netApplySettlers(snap);
    },

    _netApplySettlers(snap) {
        const sys = this.settlementSys;
        if (!sys) return;
        if (Array.isArray(snap.settlements)) {
            sys.list = snap.settlements.map((s) =>
                (typeof Settlement !== "undefined" ? Settlement.ensureSettlement(s) : s)
            );
            sys.rebindOpenPanels?.();
        }
        const incoming = snap.settlers || [];
        const seen = new Set();
        const oid = sys.ownerId();
        for (const row of incoming) {
            if (!row?.id) continue;
            const partyHit = (this.party || []).find((p) => p && p.pawnId === row.id);
            if (partyHit && partyHit.role !== "settler") continue;
            if (partyHit && partyHit.role === "settler") {
                this.party = (this.party || []).filter((p) => p !== partyHit);
                if (!this.settlers) this.settlers = [];
                if (!this.settlers.includes(partyHit)) this.settlers.push(partyHit);
            }
            seen.add(row.id);
            let pawn = (this.settlers || []).find((p) => p.pawnId === row.id);
            if (!pawn && this.partySys) {
                pawn = sys._spawnSettlerPawn({
                    id: row.id,
                    name: row.name,
                    look: row.look,
                    x: row.x,
                    y: row.y,
                    facing: row.facing,
                    inventory: row.inventory,
                    overflow: row.overflow,
                    equipment: row.equipment,
                    hotbarIndex: row.hotbarIndex,
                    homeSettlementId: row.homeSettlementId,
                    ownerId: row.ownerId,
                    kc: row.kc,
                    saturation: row.saturation,
                    stomach: row.stomach
                });
            }
            if (!pawn) continue;
            pawn.ownerId = row.ownerId || pawn.ownerId;
            pawn.homeSettlementId = row.homeSettlementId || null;
            pawn.role = "settler";
            if (typeof syncCreatureInputHit === "function") syncCreatureInputHit(pawn);
            pawn._netFromX = pawn.x;
            pawn._netFromY = pawn.y;
            pawn._netTx = row.x;
            pawn._netTy = row.y;
            {
                const now = performance.now();
                pawn._netSnapDt = (typeof Party !== "undefined" && Party.puppetSnapGapMs)
                    ? Party.puppetSnapGapMs(pawn._netSnapAt, now)
                    : 1000 / ((typeof NetProtocol !== "undefined" && NetProtocol.SNAPSHOT_HZ) || 15);
                pawn._netSnapAt = now;
            }
            pawn._netMoving = !!row.moving;
            pawn._netProne = !!row.prone;
            if (row.lastSleep) pawn.lastSleep = row.lastSleep;
            if (typeof row.resting === "boolean") {
                pawn._resting = !!row.resting;
                if (pawn._resting) {
                    pawn._netMoving = false;
                    pawn._netSnapDist = 0;
                    if (typeof pinRestingCreature === "function") {
                        pinRestingCreature(pawn, this);
                    } else {
                        setCreatureRest?.(pawn, true, row.lastSleep?.rot ?? row.restRot);
                    }
                } else {
                    setCreatureRest?.(pawn, false);
                }
            }
            if (typeof row.injured === "boolean") pawn.injured = !!row.injured;
            const prevCh = pawn._netWorkChannel;
            if (row.channel && typeof row.channel.progress === "number") {
                pawn._netWorkChannel = {
                    kind: row.channel.kind || null,
                    progress: row.channel.progress,
                    itemId: row.channel.itemId || prevCh?.itemId || null,
                    uid: row.channel.uid || prevCh?.uid || null,
                    pigmentId: row.channel.pigmentId || prevCh?.pigmentId || null,
                    patientId: row.channel.patientId || prevCh?.patientId || null,
                    patientName: row.channel.patientName || prevCh?.patientName || null
                };
                pawn._netEating = pawn._netWorkChannel.kind === "eat";
            } else {
                pawn._netWorkChannel = null;
                pawn._netEating = false;
            }
            if (typeof row.activity === "string" && row.activity) {
                const keepChop = !!(
                    row.attacking
                    && row.activity === "Idle"
                    && pawn._settlerAct
                    && /^Chopping/i.test(pawn._settlerAct)
                );
                if (!keepChop) {
                    pawn._settlerAct = row.activity;
                    if (pawn.partyAI) pawn.partyAI._settlerAct = row.activity;
                }
            } else if (!row.moving && !row.attacking && !row.channel) {
                // Chop swings skip the work tick, so a snapshot can omit activity
                // for a frame. Clearing here strobes the hover tip (name vs name+job).
                pawn._settlerAct = null;
                if (pawn.partyAI) pawn.partyAI._settlerAct = null;
            }
            this._netApplySettlerGear(pawn, row);
            if (typeof row.kc === "number") pawn.kc = row.kc;
            if (typeof row.saturation === "number") pawn.saturation = row.saturation;
            if (typeof row.stomach === "number") pawn.stomach = row.stomach;
            if (row.facing) pawn.facing = row.facing;
            this._applyPawnNetAttack(pawn, row);
            if (row.ownerId && row.ownerId !== oid) {
                pawn.faction = `party:${row.ownerId}`;
            }
            const youName = this.player?.pawnName
                || this.player?.displayName?.()
                || this.playerName
                || "";
            const attackingYou = typeof row.activity === "string"
                && !!youName
                && row.activity === `Attacking ${youName}`;
            const hostile = !!row.hostile || attackingYou;
            if (pawn.hostile !== hostile) {
                pawn.hostile = hostile;
                pawn.syncNameLabel?.();
            }
        }
        this.settlers = (this.settlers || []).filter((p) => {
            if (!p) return false;
            if ((this.party || []).some((m) => m && m.pawnId === p.pawnId)) return false;
            if (seen.has(p.pawnId)) return true;
            if (this.partySys?.wanderers?.some((w) => w.pawnId === p.pawnId)) return false;
            if (incoming.length && p.ownerId && p.ownerId !== oid) {
                p.destroy?.();
                return false;
            }
            return true;
        });
    },

    /**
     * Dedicated puppet melee. Attack events start a fresh swing even if the
     * last pose is still up. Snapshots must not restart the same swing, and
     * must not freeze the spear out waiting for attacking to drop (chops and
     * assists chain faster than 15 Hz).
     */
    _beginPawnNetSwing(pawn, angle, art) {
        if (!pawn || pawn._netProne || pawn._prone || pawn._downed) return;
        pawn._netAttacking = true;
        pawn._netSwingDone = false;
        if (pawn.isAttacking?.()) pawn._endAttack?.();
        pawn.startMeleeAttack?.(null, {
            silentNet: true,
            angle: Number(angle) || 0,
            art: art || null
        });
    },

    _applyPawnNetAttack(pawn, row) {
        if (!pawn || !row) return;
        if (row.prone) {
            pawn._netAttacking = false;
            pawn._netSwingDone = false;
            if (pawn.isAttacking?.()) pawn._endAttack?.();
            return;
        }
        if (row.attacking && Number.isFinite(row.attackAngle)) {
            pawn._netAttacking = true;
            if (!pawn.isAttacking?.() && !pawn._netSwingDone) {
                this._beginPawnNetSwing(pawn, row.attackAngle, row.attackArt || null);
            } else if (pawn.isAttacking?.()) {
                pawn.attackAngle = row.attackAngle;
            }
            return;
        }
        pawn._netAttacking = false;
        pawn._netSwingDone = false;
        if (pawn.isAttacking?.()) pawn._endAttack?.();
    },

    /**
     * Copy sim-authored bags onto a settler puppet. Snapshots are pose-only
     * besides this; without it hover tooltips stay empty while the sim carries loot.
     * Present empty arrays (stash/dump) apply; omitted fields do not wipe.
     */
    _netApplySettlerGear(pawn, row) {
        if (!pawn || !row) return;
        if (typeof NetProtocol === "undefined" || !NetProtocol.applyNetPawnGear) return;
        const sig = this.partySys?._gearSig?.(row.inventory, row.equipment, row.hotbarIndex, row.overflow);
        NetProtocol.applyNetPawnGear(pawn, row, (s) => this._cloneSaveStack(s), sig);
    },

    _netApplyWanderers(list) {
        const sys = this.partySys;
        if (!sys) return;
        const incoming = list || [];
        if (!incoming.length && this._netWandererGraceUntil && performance.now() < this._netWandererGraceUntil) {
            return;
        }
        const seen = new Set();
        for (const w of list || []) {
            if (!w?.id) continue;
            if ((this.party || []).some((p) => p && p.pawnId === w.id)) continue;
            if ((this.settlers || []).some((p) => p && p.pawnId === w.id)) continue;
            seen.add(w.id);
            let pawn = sys.wanderers.find((p) => p.pawnId === w.id);
            if (!pawn) {
                const leftover = (this.settlers || []).find((p) => p.pawnId === w.id);
                if (leftover) pawn = sys.releaseSettlerAsWanderer(leftover, w.heading);
            }
            if (!pawn) {
                pawn = sys.spawnWanderer({
                    id: w.id,
                    name: w.name,
                    look: w.look,
                    x: w.x,
                    y: w.y,
                    facing: w.facing,
                    heading: w.heading,
                    inventory: w.inventory,
                    hostile: w.hostile,
                    recruitLocked: w.recruitLocked,
                    refusedBy: w.refusedBy
                });
                pawn._netFromX = w.x;
                pawn._netFromY = w.y;
                pawn._netTx = w.x;
                pawn._netTy = w.y;
                pawn._netSnapAt = performance.now();
                pawn._netSnapDt = 1000 / ((typeof NetProtocol !== "undefined" && NetProtocol.SNAPSHOT_HZ) || 15);
                pawn._netMoving = typeof w.moving === "boolean"
                    ? w.moving
                    : !!(w.heading && (Math.abs(w.heading.x) + Math.abs(w.heading.y) > 0));
                pawn._netProne = !!w.prone;
                if (w.heading) pawn.heading = w.heading;
            } else {
                if (pawn._netTx == null) {
                    pawn.x = w.x;
                    pawn.y = w.y;
                }
                const prevTx = Number.isFinite(pawn._netTx) ? pawn._netTx : pawn.x;
                const prevTy = Number.isFinite(pawn._netTy) ? pawn._netTy : pawn.y;
                pawn._netSnapDist = Math.hypot(w.x - prevTx, w.y - prevTy);
                pawn._netFromX = pawn.x;
                pawn._netFromY = pawn.y;
                pawn._netTx = w.x;
                pawn._netTy = w.y;
                const now = performance.now();
                pawn._netSnapDt = (typeof Party !== "undefined" && Party.puppetSnapGapMs)
                    ? Party.puppetSnapGapMs(pawn._netSnapAt, now)
                    : 1000 / ((typeof NetProtocol !== "undefined" && NetProtocol.SNAPSHOT_HZ) || 15);
                pawn._netSnapAt = now;
                pawn._netMoving = typeof w.moving === "boolean"
                    ? w.moving
                    : !!(w.heading && (Math.abs(Number(w.heading.x)) + Math.abs(Number(w.heading.y)) > 0));
                pawn._netProne = !!w.prone;
                pawn.facing = w.prone ? "right" : (w.facing || pawn.facing);
                pawn.heading = w.heading || pawn.heading;
                pawn.hostile = !!w.hostile;
                pawn.recruitLocked = !!w.recruitLocked;
                pawn.refusedBy = new Set(w.refusedBy || []);
                if (w.prone && pawn.isAttacking?.()) pawn._endAttack?.();
                else if (w.attacking && Number.isFinite(w.attackAngle) && !pawn.isAttacking?.()) {
                    pawn.startMeleeAttack?.(null, {
                        silentNet: true,
                        angle: w.attackAngle
                    });
                }
            }
        }
        sys.wanderers = sys.wanderers.filter((p) => {
            if (seen.has(p.pawnId)) return true;
            p.destroy?.();
            return false;
        });
    },

    /**
     * Apply authoritative world clock from the listen server.
     * @param {{ gameDay?: number, gameMinutes?: number, day?: number, minutes?: number, tickSpeed?: number }} clock
     * @param {{ catchUp?: boolean }} [opts]
     */
    _netApplyClock(clock, opts = {}) {
        if (!clock || !this.isNet) return;
        const day = Number(clock.gameDay ?? clock.day);
        const mins = Number(clock.gameMinutes ?? clock.minutes);
        if (!Number.isFinite(day) || !Number.isFinite(mins)) return;

        const prevIdx = this.worldMinuteIndex();
        this.gameDay = Math.max(1, Math.floor(day));
        this.gameMinutes = ((Math.floor(mins) % 1440) + 1440) % 1440;

        if (clock.tickSpeed != null && Number.isFinite(Number(clock.tickSpeed))) {
            this.tickSpeed = Math.max(0, Number(clock.tickSpeed));
            if (clock.baseTickSpeed != null && Number.isFinite(Number(clock.baseTickSpeed))) {
                this._baseTickSpeed = Math.max(0, Number(clock.baseTickSpeed));
            }
        }

        this.updateClockText();
        if (this.lightGfx && this.worldMinuteIndex() !== prevIdx) this.updateTimeTint();

        if (opts.catchUp === false) return;

        // Drive local minute systems when the shared clock advances
        let steps = this.worldMinuteIndex() - prevIdx;
        if (steps <= 0) return;
        const cap = this.tickSpeed > 1 ? 60 : 8;
        if (steps > cap) steps = 1; // huge jump: snap once, don't melt CPU
        for (let i = 0; i < steps; i++) {
            // LocalSim skips hungerTick; still refresh the fed snapshot each minute
            // so malnutrition (and /heal's sticky flag) advances correctly.
            if (this.simAuth() && this.player) {
                this._forEachHungerPawn((p) => {
                    p._malnutritionFed =
                        (Number(p.kc) > 0) || (Number(p.saturation) > 0);
                });
            }
            this.tickBodySystems();
            this.tickBloodStains();
        }
    },
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
