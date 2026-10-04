/**
 * SceneMain prototype methods (netEvents).
 * Installed onto SceneMain.prototype. Method bodies are unchanged.
 */
(function (root) {
    "use strict";
    root.SceneMainNetEvents = {

    _netApplyEvent(ev) {
        if (!ev || !this.isNet) return;
        if (ev.kind === "world_regen" && ev.seed != null) {
            this._netOnWorldRegen(ev.seed);
            if (typeof ModKinds !== "undefined") ModKinds.dispatchEvent(this, ev);
            return;
        }
        if (ev.kind === "chat" && ev.text) {
            const selfId = this._netPlayerId || this.net?.playerId;
            const text = String(ev.text);
            const isJoin = / joined\.?$/.test(text);
            const isLeave = / left\.?$/.test(text);
            const isPlayerChat = !!(ev.from || /^<.+>\s/.test(text));
            const isSettleNews = / has been founded$/.test(text)
                || / has been destroyed!$/.test(text)
                || / was renamed to /.test(text);
            const yellow = isJoin || isLeave || isPlayerChat;
            const color = isSettleNews
                ? (CombatLog.COLOR_SETTLER || "#7ec8ff")
                : (yellow ? CombatLog.COLOR_CHAT : null);
            if (!(isJoin && this.net?.isLocal)) {
                if (ev.segments?.length) {
                    this.combatLog?.push?.(text, { segments: ev.segments });
                } else {
                    this.combatLog?.push?.(text, color ? { color } : null);
                }
            }
            if (ev.from && ev.from !== selfId) {
                this._netShowRemoteBubble(ev.from, text);
            }
        }
        if (ev.kind === "death") {
            const selfId = this._netPlayerId || this.net?.playerId;
            if (ev.text) {
                const msg = String(ev.text).replace(/\.+$/, "");
                if (ev.playerId === selfId) {
                    this._pendingDeathText = msg;
                    if (this.player?._bodyDead || this.deathOverlay?.visible) {
                        this._applyDeathMessage(msg);
                    }
                }
            }
            if (ev.playerId) {
                if (ev.playerId === selfId) this.partySys?.clearPvpAggro?.();
                else this.partySys?.clearPvpAggro?.(ev.playerId);
            }
        }
        if (ev.kind === "channel" && (ev.channel === "eat" || ev.channel === "tend")) {
            const selfId = this._netPlayerId || this.net?.playerId;
            if (ev.playerId === selfId && this.simAuth()) {
                const pawn = this._pawnByNetId(ev.pawnId) || this.player;
                if (ev.done || ev.cancelled) {
                    if (ev.channel === "eat" && pawn?._eatChannel?.serverAuth) pawn._eatChannel = null;
                    if (ev.channel === "tend" && pawn?._tendChannel?.serverAuth) pawn._tendChannel = null;
                    this._applyPawnChannelVisual(pawn, null, ev.channel);
                } else if (typeof ev.progress === "number") {
                    this._applyPawnChannelVisual(pawn, {
                        progress: ev.progress,
                        itemId: ev.itemId,
                        patientId: ev.patientId,
                        patientName: ev.patientName
                    }, ev.channel);
                }
            }
        }
        if (ev.kind === "party_death") {
            const pawn = (this.party || []).find((p) => p.pawnId === ev.pawnId);
            if (pawn) this.partySys?.onMemberDied?.(pawn, null, { spawn: false });
        }
        if (ev.kind === "player_left") {
            this.partySys?.clearPvpAggro?.(ev.playerId);
            this._netRemoveRemotesForOwner(ev.playerId);
        }
        if (ev.kind === "attack") {
            const selfId = this._netPlayerId || this.net?.playerId;
            if (ev.playerId && ev.playerId !== selfId) {
                const key = this._netRemoteKey(ev.playerId, ev.pawnId);
                let entry = this.remotePlayers.get(key);
                if (!entry) {
                    entry = this._netMakeRemote({
                        id: key,
                        name: "?",
                        x: ev.x ?? 0,
                        y: ev.y ?? 0,
                        facing: ev.facing || "down"
                    });
                    this.remotePlayers.set(key, entry);
                    entry.ownerId = ev.playerId;
                    entry.pawnId = ev.pawnId || ev.playerId;
                }
                this._netStartRemoteAttack(entry, Number(ev.angle) || 0, ev.facing, ev.art);
            } else if (
                ev.playerId === selfId
                && ev.pawnId
                && ev.pawnId !== this.player?.pawnId
                && this.simAuth()
            ) {
                // Dedicated puppets: start the swing at the server pose.
                // LocalSim SP already plays companion attacks in PartyAI — echoing
                // `_pawn` x/y here snapped them onto the focused member.
                const pawn = this._pawnByNetId?.(ev.pawnId)
                    || (this.party || []).find((p) => p.pawnId === ev.pawnId)
                    || (this.settlers || []).find((p) => p.pawnId === ev.pawnId);
                if (pawn) {
                    if (!(pawn._netProne || pawn._prone || pawn._downed)) {
                        this._beginPawnNetSwing(pawn, ev.angle, ev.art);
                    }
                }
            } else if (ev.wandererId || (ev.uid && this.partySys?.wanderers?.some?.((p) => p.pawnId === ev.uid))) {
                const wid = ev.wandererId || ev.uid;
                const pawn = this.partySys?.wanderers?.find?.((p) => p.pawnId === wid);
                if (pawn) {
                    if (Number.isFinite(ev.x) && Number.isFinite(ev.y)) {
                        pawn.x = ev.x;
                        pawn.y = ev.y;
                        pawn._netTx = ev.x;
                        pawn._netTy = ev.y;
                    }
                    if (!(pawn._netProne || pawn._prone || pawn._downed)) {
                        pawn.startMeleeAttack?.(null, {
                            silentNet: true,
                            angle: Number(ev.angle) || 0,
                            art: ev.art || null
                        });
                    }
                }
            } else if (!ev.playerId && ev.uid && this.netMobs) {
                const puppet = this.netMobs.get(ev.uid);
                if (puppet && !puppet.prone) {
                    this._netStartRemoteAttack(puppet, Number(ev.angle) || 0, ev.facing, ev.art);
                }
            }
        }
        if (ev.kind === "combat_log") {
            this.combatLog?.push?.(ev.text, {
                combat: !!ev.combat,
                segments: ev.segments || null,
                color: ev.color || null
            });
            if (ev.deflected && ev.spark) {
                this.spawnApparelDeflectSpark?.(ev.spark.x, ev.spark.y);
            }
        }
        if (ev.kind === "pvp_hit") {
            this.partySys?.onPvpHit?.(ev);
        }
        if (ev.kind === "pvp_clear") {
            const selfId = this._netPlayerId || this.net?.playerId;
            if (ev.ownerId && ev.ownerId !== selfId) {
                this.partySys?.clearPvpAggro?.(ev.ownerId);
            } else if (ev.ownerId === selfId) {
                this.partySys?.clearPvpAggro?.();
            }
        }
        if (ev.kind === "recruit") {
            this.partySys?.onRecruitResult?.(ev);
        }
        if (ev.kind === "vomit") {
            this._netApplyVomitEvent(ev);
        }
        if (ev.kind === "bleed") {
            this._netApplyBleedFx(ev);
        }
        if (ev.kind === "damage" && ev.amount != null) {
            const amt = Math.round(Number(ev.amount) || 0);
            if (amt > 0) {
                this.combatLog?.push?.(`Hit for ${amt}`, {
                    color: CombatLog.COLOR_WEAPON
                });
            }
        }
        if (ev.kind === "lootable") {
            this._netApplyLootableEvent(ev);
        }
        if (ev.kind === "chop") {
            this._netApplyChopEvent(ev);
        }
        if (ev.kind === "dig") {
            this._netApplyDigEvent(ev);
        }
        if (ev.kind === "corpse") {
            this._netApplyCorpseEvent(ev);
        }
        if (ev.kind === "mob") {
            this._netApplyMobEvent(ev);
        }
        if (ev.kind === "campfire") {
            this._netApplyCampfireEvent(ev);
        }
        if (ev.kind === "storage") {
            this._netApplyStorageEvent(ev);
            this.settlementSys?.bumpWorkCache?.();
        }
        if (ev.kind === "thing_set") {
            this._netApplyThingSet(ev);
        }
        if (typeof ModKinds !== "undefined") ModKinds.dispatchEvent(this, ev);
    },

    onEvent(kind, fn) {
        if (typeof ModKinds !== "undefined") ModKinds.onEvent("scene", kind, fn);
    },

    /**
     * Dedicated MP: server cues vomit lock + spray. Each client paints local stains.
     */
    _netApplyVomitEvent(ev) {
        if (!ev || !this.simAuth()) return;
        const selfId = this._netPlayerId || this.net?.playerId;
        if (ev.playerId === selfId && !ev.drip) {
            const remaining = Number(ev.remainingMs);
            this.player?.startVomit?.({
                remainingMs: remaining > 0 ? remaining : undefined,
                fromServer: true
            });
        }
        const x = Number(ev.x);
        const y = Number(ev.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
            this.spawnVomitStain?.(x, y, { facing: ev.facing || "down" });
        }
    },

    _pawnByNetId(id) {
        if (!id) return null;
        if (this.player?.pawnId === id) return this.player;
        const partyHit = (this.party || []).find((p) => p && p.pawnId === id);
        if (partyHit) return partyHit;
        return (this.settlers || []).find((p) => p && p.pawnId === id) || null;
    },

    /**
     * World-space channel bar on an uncontrolled pawn, or the HUD bar when you
     * control them. Sim-authored eat/tend never open a local `_eatChannel`.
     */
    _applyPawnChannelVisual(pawn, data, kind = "eat") {
        if (!pawn) return;
        const live = data && typeof data.progress === "number";
        if (live) {
            if (kind === "eat") pawn._netEating = true;
            pawn._netWorkChannel = {
                kind,
                progress: Phaser.Math.Clamp(data.progress, 0, 1),
                itemId: data.itemId || pawn._netWorkChannel?.itemId || null,
                uid: data.uid || pawn._netWorkChannel?.uid || null,
                pigmentId: data.pigmentId || pawn._netWorkChannel?.pigmentId || null,
                patientId: data.patientId || pawn._netWorkChannel?.patientId || null,
                patientName: data.patientName || pawn._netWorkChannel?.patientName || null
            };
        } else {
            if (kind === "eat") pawn._netEating = false;
            if (pawn._netWorkChannel?.kind === kind) pawn._netWorkChannel = null;
        }
        if (pawn.isControlled?.()) {
            pawn._hideOwnChannelBar?.();
            const localCh = kind === "tend" ? pawn._tendChannel : pawn._eatChannel;
            if (live && !localCh) {
                if (kind === "eat") pawn._netEating = false;
                if (pawn._netWorkChannel?.kind === kind) pawn._netWorkChannel = null;
            }
            if (live && localCh) this.showChannelBar?.(pawn._netWorkChannel.progress);
            else if (
                !pawn._eatChannel
                && !pawn._tendChannel
                && !pawn._skinChannel
                && !pawn._fleshChannel
                && !pawn._brainChannel
                && !pawn._craftChannel
            ) {
                this.hideChannelBar?.();
            }
            return;
        }
        pawn.syncPawnChannelBar?.();
    },

    _applyPawnEatVisual(pawn, eat) {
        this._applyPawnChannelVisual(pawn, eat, "eat");
    },

    _netApplyYouVomit(you, pawn = null) {
        const target = pawn || this.leader || this.player;
        if (!you || !target || !this.simAuth()) return;
        const remaining = Number(you.vomit?.remainingMs);
        if (remaining > 0) {
            if (!target.isVomiting?.()) {
                target.startVomit?.({
                    remainingMs: remaining,
                    fromServer: true
                });
            } else if (target._vomit) {
                target._vomit.fromServer = true;
                target._vomit.remainingMs = remaining;
            }
            return;
        }
        if (target._vomit?.fromServer) target._vomit = null;
    },

    /**
     * Dedicated MP: server cues bleed FX; each client paints local random stains.
     * Patterns intentionally differ per client.
     */
    _netApplyBleedFx(ev) {
        if (!ev || this.bloodDraw === false) return;
        if (!this.simAuth()) return;
        const x = Number(ev.x);
        const y = Number(ev.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const n = Math.max(1, Math.min(4, Math.floor(Number(ev.n) || 1)));
        const burst = ev.burst !== false;

        const paint = () => {
            // Prefer a live corpse sprite (death swap), else the event's bodyCenter.
            // Do not re-derive from puppets — standing offsets on center-anchored
            // prone poses were painting pools a body-height above the victim.
            const anchor = this._netBleedAnchor(ev, x, y);
            if (typeof BodyHealing?.spawnBleedFxAt === "function") {
                BodyHealing.spawnBleedFxAt(this, anchor.x, anchor.y, 1, burst);
            } else {
                const ang = Math.random() * Math.PI * 2;
                const dist = (0.08 + Math.random() * 0.45) * (this.tileSize || 16);
                this.spawnBloodStain?.(
                    anchor.x + Math.cos(ang) * dist,
                    anchor.y + Math.sin(ang) * dist
                );
            }
        };

        if (burst || !this.time?.delayedCall) {
            for (let i = 0; i < n; i++) paint();
            return;
        }
        const tickSpeed = Math.max(0.05, Number(this.tickSpeed) || 1);
        const minuteMs = Math.max(80, 1000 / tickSpeed);
        for (let i = 0; i < n; i++) {
            const delay = Math.floor(((i + 0.5) / n) * minuteMs * (0.7 + Math.random() * 0.5));
            this.time.delayedCall(Math.min(delay, minuteMs - 1), paint);
        }
    },

    /**
     * World point for bleed FX. Server already sent bodyCenter() at emit time.
     * Pin to a corpse when the bleeder has died so delayed drips track the body.
     */
    _netBleedAnchor(ev, fallbackX, fallbackY) {
        const pinned = this._netBleedCorpsePin(ev, fallbackX, fallbackY);
        if (pinned) return pinned;
        return { x: fallbackX, y: fallbackY };
    },

    /** Snap bleed FX to a nearby corpse (same owner death / same spot). */
    _netBleedCorpsePin(ev, x, y) {
        if (!this.netCorpses?.size && !this.corpses?.getChildren) return null;
        const remote = ev.ownerId ? this.remotePlayers?.get(ev.ownerId) : null;
        const ownerDead = !!(remote && (remote.root && !remote.root.visible));
        // Only snap when the bleeder is gone / dead, or a corpse sits on the point
        const maxDist = ownerDead ? 40 : 10;
        const maxD = maxDist * maxDist;
        let best = null;
        let bestD = maxD;
        const consider = (spr) => {
            if (!spr?.active) return;
            const dx = spr.x - x;
            const dy = spr.y - y;
            const d = dx * dx + dy * dy;
            if (d <= bestD) {
                bestD = d;
                best = spr;
            }
        };
        if (this.netCorpses) {
            for (const spr of this.netCorpses.values()) consider(spr);
        }
        if (this.corpses?.getChildren) {
            for (const spr of this.corpses.getChildren()) consider(spr);
        }
        return best ? { x: best.x, y: best.y } : null;
    },

    /** Spawn/remove wildlife from dedicated server (chunk meta + puppets). */
    _netApplyMobEvent(ev) {
        if (!ev || !this.simAuth()) return;
        if (ev.op === "remove" && ev.uid) {
            const puppet = this.netMobs?.get(ev.uid);
            if (puppet) {
                puppet.root?.destroy?.(true);
                this.netMobs.delete(ev.uid);
            }
            this._netRemoveLivingMobByUid(ev.uid);
            // Strip from chunk meta so it won't reappear on reload
            for (const chunk of Object.values(this.chunks || {})) {
                const list = chunk?.meta?.mobs;
                if (!Array.isArray(list)) continue;
                const i = list.findIndex((m) => m?.uid === ev.uid);
                if (i >= 0) list.splice(i, 1);
            }
            return;
        }
        if (ev.op === "add" && ev.entry?.id) {
            const entry = ev.entry;
            if (!entry.uid) return;
            const chunk = LivingMob.ensureChunkAt(this, entry.x, entry.y - 1);
            if (!chunk) return;
            if (!chunk.meta.mobs) chunk.meta.mobs = [];
            if (!chunk.meta.mobs.some((m) => m?.uid === entry.uid)) {
                chunk.meta.mobs.push(entry);
            }
            // Dedicated: presentation via snapshot puppets — do not spawn LivingMob
        }
    },

    _netFindLivingMobByUid(uid) {
        if (!uid || !this.mobs) return null;
        for (const m of this.mobs.getChildren()) {
            if (m?.entry?.uid === uid) return m;
        }
        return null;
    },

    _netRemoveLivingMobByUid(uid) {
        const mob = this._netFindLivingMobByUid(uid);
        if (!mob) return;
        if (mob.chunk?.meta?.mobs && mob.entry) {
            const i = mob.chunk.meta.mobs.indexOf(mob.entry);
            if (i >= 0) mob.chunk.meta.mobs.splice(i, 1);
        }
        mob.chunk?.mobs?.remove(mob);
        this.damageables?.remove(mob);
        this.mobs?.remove(mob);
        mob._dead = true;
        mob.destroy();
    },

    /** Drop a corpse id from client chunk copies so a reload cannot revive it. */
    _dropCorpseFromChunkMeta(id) {
        if (!id) return;
        for (const chunk of Object.values(this.chunks || {})) {
            const list = chunk?.meta?.corpses;
            if (!Array.isArray(list)) continue;
            for (let i = list.length - 1; i >= 0; i--) {
                if (list[i]?.id === id) list.splice(i, 1);
            }
        }
    },

    /** Immediate corpse add/remove from dedicated server (before next snapshot). */
    _netApplyCorpseEvent(ev) {
        if (!ev || !this.simAuth()) return;
        if (!this.netCorpses) this.netCorpses = new Map();
        if (ev.op === "remove" && ev.id) {
            if (!this._goneCorpseIds) this._goneCorpseIds = new Set();
            this._goneCorpseIds.add(ev.id);
            let spr = this.netCorpses.get(ev.id);
            if (!spr) {
                for (const chunk of Object.values(this.chunks || {})) {
                    const kids = chunk?.corpses?.getChildren?.() || [];
                    spr = kids.find((s) => s?.entry?.id === ev.id);
                    if (spr) break;
                }
            }
            this.netCorpses.delete(ev.id);
            if (this.corpsePanel?.corpse === spr) this.corpsePanel.close(true);
            if (spr?.active) {
                Corpse.puffAway?.(this, spr.x, spr.y);
                spr.destroy();
            }
            this._dropCorpseFromChunkMeta(ev.id);
            return;
        }
        if ((ev.op === "loot" || ev.op === "skin" || ev.op === "carcass") && ev.entry?.id) {
            const spr = this.netCorpses.get(ev.entry.id);
            if (ev.op === "skin") {
                const bx = Number.isFinite(spr?.x) ? spr.x : Number(ev.entry.x);
                const by = Number.isFinite(spr?.y) ? spr.y : Number(ev.entry.y);
                Corpse.bloodBurst?.(this, bx, by);
            }
            if (spr?.entry) {
                if (ev.op === "skin" || ev.op === "carcass" || ev.entry.skinned != null) {
                    spr.entry.skinned = !!ev.entry.skinned || ev.op === "carcass";
                }
                if (ev.op === "carcass" || ev.entry.stage) {
                    spr.entry.stage = ev.entry.stage || "carcass";
                    if (ev.entry.diedAt != null) spr.entry.diedAt = ev.entry.diedAt;
                    spr.applyStageAppearance?.();
                    if (this.player?._skinChannel?.corpse === spr) {
                        this.player._cancelSkin?.();
                    }
                }
                if (Array.isArray(ev.entry.loot)) {
                    const loot = ev.entry.loot
                        .map((s) => (typeof cloneItemStack === "function" ? cloneItemStack(s) : s))
                        .filter(Boolean);
                    spr.entry.loot = loot;
                    if (this.corpsePanel?.visible && this.corpsePanel.corpse === spr) {
                        this.corpsePanel.syncFromEntry?.();
                        if (ev.op === "carcass") this.corpsePanel._showCorpseHealth?.();
                    }
                }
                this.refreshTooltip?.();
            }
            return;
        }
        if (ev.op === "add" && ev.entry?.id) {
            // Upsert only — never full-reconcile from a single event (that wiped
            // other corpses and lost new ones to in-flight empty snapshots).
            this._netUpsertCorpse(ev.entry, { pending: true });
        }
    },

    _lootableEventMatch(e, ev) {
        if (!e) return false;
        if (ev.uid && e.uid) return e.uid === ev.uid;
        const dx = Math.abs(Number(e.x) - Number(ev.x));
        const dy = Math.abs(Number(e.y) - Number(ev.y));
        if (dx >= 1.5 || dy >= 1.5) return false;
        if (ev.removed || ev.gone) {
            return !ev.id || e.id === ev.id || e.regrowId === ev.id;
        }
        if (ev.respawn) {
            return !ev.id || e.id === ev.id || e.regrowId === ev.id;
        }
        // Transform: same pose is enough (id on the wire is the new id)
        return true;
    },

    /** Apply server harvest / regrow to a loaded chunk's lootableThings. */
    _netApplyLootableEvent(ev) {
        if (!ev || !this.simAuth()) return;
        const keys = [];
        if (Number.isInteger(ev.cx) && Number.isInteger(ev.cy)) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    keys.push(this.getKey(ev.cx + dx, ev.cy + dy));
                }
            }
        }
        let chunk = this.chunks[this.getKey(ev.cx, ev.cy)];
        let list = chunk?.meta?.lootableThings;
        let entry = null;
        const match = (e) => this._lootableEventMatch(e, ev);
        for (const k of keys) {
            const c = this.chunks[k];
            const lst = c?.meta?.lootableThings;
            if (!Array.isArray(lst)) continue;
            const found = lst.find(match);
            if (found) {
                chunk = c;
                list = lst;
                entry = found;
                break;
            }
        }
        if (!chunk?.meta) return;
        if (!Array.isArray(chunk.meta.lootableThings)) chunk.meta.lootableThings = [];
        if (!list) list = chunk.meta.lootableThings;
        const live = (chunk.things?.getChildren?.() || []).find(
            (t) => t?.entry && (entry ? t.entry === entry : match(t.entry))
        ) || null;

        const stamp = (e) => {
            if (ev.uid && e && !e.uid) e.uid = ev.uid;
        };

        if (ev.removed) {
            if (entry) {
                const i = list.indexOf(entry);
                if (i >= 0) list.splice(i, 1);
            }
            if (live?.active) live.destroy();
            this.hideTooltip?.();
            this.markLightDirty?.();
            return;
        }

        if (ev.respawn) {
            if (!entry) {
                entry = {
                    id: ev.id,
                    x: ev.x,
                    y: ev.y,
                    uid: ev.uid || null
                };
                list.push(entry);
            } else {
                entry.id = ev.id;
                stamp(entry);
                delete entry.gone;
                delete entry.regrowAt;
                delete entry.regrowId;
            }
            if (live && typeof live.morph === "function") {
                live.morph(entry.id);
            } else if (chunk.isLoaded && !live) {
                chunk.things.add(new LootableThing(this, entry, chunk));
            }
            this.markLightDirty?.();
            return;
        }

        // Don't invent a second copy in the wrong chunk if the original isn't loaded
        if (!entry) return;
        stamp(entry);
        if (ev.id != null) entry.id = ev.id;
        if (ev.gone) {
            entry.gone = true;
            if (ev.regrowId) entry.regrowId = ev.regrowId;
            if (ev.regrowAt != null) entry.regrowAt = ev.regrowAt;
            if (live?.active) live.destroy();
        } else {
            delete entry.gone;
            if (ev.regrowId) entry.regrowId = ev.regrowId;
            else delete entry.regrowId;
            if (ev.regrowAt != null) entry.regrowAt = ev.regrowAt;
            else delete entry.regrowAt;
            if (live && typeof live.morph === "function" && live.meta?.id !== entry.id) {
                live.morph(entry.id);
            }
        }
        this.hideTooltip?.();
        this.markLightDirty?.();
    },

    choppableThingsNear(wx, wy, rangePx) {
        const r = Number(rangePx);
        const range = Number.isFinite(r) && r > 0 ? r : 48;
        const r2 = range * range;
        const out = [];
        for (const chunk of Object.values(this.chunks || {})) {
            const kids = chunk.things?.getChildren?.() || [];
            for (const t of kids) {
                if (!t?.active || t.entry?.gone) continue;
                const def = this.getThing(t.entry?.id) || t.meta;
                if (typeof Chop === "undefined" || !Chop.stillChoppable?.(def, t.entry)) continue;
                const dx = t.x - wx;
                const dy = t.y - wy;
                if (dx * dx + dy * dy <= r2) out.push(t);
            }
        }
        return out;
    },

    aimHitsChoppableTrunk(center, angle) {
        if (typeof Chop === "undefined" || !center) return false;
        const seg = Chop.aimSegment(center.x, center.y, angle, Chop.AIM_REACH);
        const trees = this.choppableThingsNear(center.x, center.y, Chop.AIM_REACH + 16);
        for (const t of trees) {
            const hs = t.hitboxSize || t.meta?.hitboxSize || 5;
            if (Chop.trunkHitsSegment(seg, t.x, t.y, hs, Chop.HIT_RADIUS)) return true;
        }
        return false;
    },

    diggableThingsNear(wx, wy, rangePx) {
        const r = Number(rangePx);
        const range = Number.isFinite(r) && r > 0 ? r : 48;
        const r2 = range * range;
        const out = [];
        for (const chunk of Object.values(this.chunks || {})) {
            const kids = chunk.things?.getChildren?.() || [];
            for (const t of kids) {
                if (!t?.active || t.entry?.gone) continue;
                const def = this.getThing(t.entry?.id) || t.meta;
                if (typeof Dig === "undefined" || !Dig.stillDiggable?.(def, t.entry)) continue;
                const dx = t.x - wx;
                const dy = t.y - wy;
                if (dx * dx + dy * dy <= r2) out.push(t);
            }
        }
        return out;
    },

    aimHitsDiggableTile(center, angle) {
        if (typeof Dig === "undefined" || !center) return false;
        const seg = Dig.aimSegment(center.x, center.y, angle, Dig.AIM_REACH);
        const patches = this.diggableThingsNear(center.x, center.y, Dig.AIM_REACH + 16);
        for (const t of patches) {
            if (Dig.trunkHitsSegment(seg, t.x, t.y, Dig.HITBOX, Dig.HIT_RADIUS)) return true;
        }
        return false;
    },

    applyLocalChop(thing, frac, actor) {
        const entry = thing?.entry;
        if (!entry || typeof Chop === "undefined") return null;
        const def = this.getThing(entry.id) || thing.meta;
        if (!Chop.isChoppable(def)) return null;
        const result = Chop.applyChop(entry, frac);
        const who = actor || this.player;
        who?.noteChopProgress?.(thing, result.progress, false);
        if (!result.felled) return result;
        const drops = Chop.rollDrops(def, () => Math.random());
        const piles = Chop.scatterFellPiles(drops, entry.x, entry.y, () => Math.random());
        Chop.fellToStump(entry, def);
        if (typeof thing.morph === "function") thing.morph(entry.id);
        for (const p of piles) {
            const meta = this.getItem(p.id);
            if (meta && p.quantity > 0) {
                DroppedItem.spawn(this, p.x, p.y, meta, p.quantity, undefined, null, true);
            }
        }
        who?.noteChopProgress?.(thing, 1, true);
        this.hideTooltip?.();
        this.markLightDirty?.();
        this.settlementSys?.bumpWorkCache?.();
        return result;
    },

    applyLocalDig(thing, frac, actor) {
        const entry = thing?.entry;
        if (!entry || typeof Dig === "undefined") return null;
        const def = this.getThing(entry.id) || thing.meta;
        if (!Dig.isDiggable(def)) return null;
        const result = Dig.applyDig(entry, def, frac);
        thing._syncDigHole?.();
        const itemId = def.diggable?.item;
        if (itemId && result.give > 0) {
            const meta = this.getItem(itemId);
            if (meta) DroppedItem.spawn(this, entry.x, entry.y, meta, result.give);
        }
        if (result.done) {
            const drops = Dig.rollDrops?.(def, () => Math.random()) || [];
            const piles = Dig.scatterDrops?.(drops, entry.x, entry.y, () => Math.random()) || [];
            for (const p of piles) {
                const meta = this.getItem(p.id);
                if (meta && p.quantity > 0) {
                    DroppedItem.spawn(this, p.x, p.y, meta, p.quantity, undefined, null, true);
                }
            }
            entry.gone = true;
            const chunk = thing.chunk || this.getChunkAtWorld?.(entry.x, entry.y - 1);
            for (const name of ["things", "lootableThings"]) {
                const lst = chunk?.meta?.[name];
                if (!Array.isArray(lst)) continue;
                const i = lst.indexOf(entry);
                if (i >= 0) lst.splice(i, 1);
            }
            if (thing?.active) thing.destroy();
            this.hideTooltip?.();
            this.markLightDirty?.();
            this.settlementSys?.bumpWorkCache?.();
        }
        return result;
    },

    _chopEventMatch(e, ev) {
        if (!e) return false;
        if (ev.uid && e.uid && e.uid === ev.uid) return true;
        if (ev.uid && e.uid && e.uid !== ev.uid) return false;
        const x = Number(ev.x);
        const y = Number(ev.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        return Math.abs(Number(e.x) - x) < 1.5 && Math.abs(Number(e.y) - y) < 1.5;
    },

    _netApplyChopEvent(ev) {
        if (!ev || !this.simAuth()) return;
        const x = Number(ev.x);
        const y = Number(ev.y);
        const keys = [];
        if (Number.isInteger(ev.cx) && Number.isInteger(ev.cy)) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    keys.push(this.getKey(ev.cx + dx, ev.cy + dy));
                }
            }
        }
        if (Number.isFinite(x) && Number.isFinite(y)) {
            keys.push(this.getKey(
                Math.floor(x / this.chunkPx()),
                Math.floor((y - 1) / this.chunkPx())
            ));
        }
        const match = (e) => this._chopEventMatch(e, ev);
        let chunk = null;
        let entry = null;
        let listName = ev.list === "lootable" ? "lootableThings" : "things";
        const lists = listName === "lootableThings"
            ? ["lootableThings", "things"]
            : ["things", "lootableThings"];
        for (const k of keys) {
            const c = this.chunks[k];
            if (!c?.meta) continue;
            for (const name of lists) {
                const lst = c.meta[name];
                if (!Array.isArray(lst)) continue;
                const found = lst.find(match);
                if (found) {
                    chunk = c;
                    entry = found;
                    listName = name;
                    break;
                }
            }
            if (entry) break;
        }
        if (entry) {
            if (ev.felled) {
                if (ev.id) entry.id = ev.id;
                entry.chopProgress = 1;
                delete entry.regrowAt;
                delete entry.regrowId;
                delete entry.gone;
            } else if (ev.chopProgress != null) {
                entry.chopProgress = ev.chopProgress;
            }
            if (ev.lastChopAt != null) entry.lastChopAt = ev.lastChopAt;
            else if (!ev.felled) entry.lastChopAt = Date.now();
            const live = (chunk.things?.getChildren?.() || []).find(
                (t) => t?.entry === entry || (t?.entry && match(t.entry))
            ) || null;
            if (ev.felled && live && typeof live.morph === "function" && ev.id) {
                live.morph(ev.id);
            }
            const selfId = this._netPlayerId || this.net?.playerId;
            if (ev.playerId && ev.playerId === selfId) {
                this.player?.noteChopProgress?.(live, ev.chopProgress, !!ev.felled);
            }
        } else {
            const selfId = this._netPlayerId || this.net?.playerId;
            if (ev.playerId && ev.playerId === selfId && ev.felled) {
                this.player?.noteChopProgress?.(null, 1, true);
            }
        }
        if (ev.felled) {
            this.hideTooltip?.();
            this.markLightDirty?.();
            this.settlementSys?.bumpWorkCache?.();
        }
    },

    _netApplyDigEvent(ev) {
        if (!ev || !this.simAuth()) return;
        const x = Number(ev.x);
        const y = Number(ev.y);
        const keys = [];
        if (Number.isInteger(ev.cx) && Number.isInteger(ev.cy)) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    keys.push(this.getKey(ev.cx + dx, ev.cy + dy));
                }
            }
        }
        if (Number.isFinite(x) && Number.isFinite(y)) {
            keys.push(this.getKey(
                Math.floor(x / this.chunkPx()),
                Math.floor((y - 1) / this.chunkPx())
            ));
        }
        const match = (e) => this._chopEventMatch(e, ev);
        let chunk = null;
        let entry = null;
        let listName = "things";
        for (const k of keys) {
            const c = this.chunks[k];
            if (!c?.meta) continue;
            for (const name of ["things", "lootableThings"]) {
                const lst = c.meta[name];
                if (!Array.isArray(lst)) continue;
                const found = lst.find(match);
                if (found) {
                    chunk = c;
                    entry = found;
                    listName = name;
                    break;
                }
            }
            if (entry) break;
        }
        if (entry) {
            if (ev.digProgress != null) entry.digProgress = ev.digProgress;
            if (ev.digTaken != null) entry.digTaken = ev.digTaken;
            if (ev.lastDigAt != null) entry.lastDigAt = ev.lastDigAt;
            else entry.lastDigAt = Date.now();
            const live = (chunk.things?.getChildren?.() || []).find(
                (t) => t?.entry === entry || (t?.entry && match(t.entry))
            ) || null;
            live?._syncDigHole?.();
            if (ev.dug) {
                entry.gone = true;
                const lst = chunk.meta?.[listName];
                if (Array.isArray(lst)) {
                    const i = lst.indexOf(entry);
                    if (i >= 0) lst.splice(i, 1);
                }
                if (live?.active) live.destroy();
                this.hideTooltip?.();
                this.markLightDirty?.();
                this.settlementSys?.bumpWorkCache?.();
            }
        }
    },
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
