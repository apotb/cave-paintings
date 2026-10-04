/**
 * SceneMain prototype methods (netProps).
 * Installed onto SceneMain.prototype. Method bodies are unchanged.
 */
(function (root) {
    "use strict";
    root.SceneMainNetProps = {

    _netDropKey(d) {
        if (d.uid) return String(d.uid);
        return `${d.id}:${Math.round(d.x)}:${Math.round(d.y)}`;
    },

    _netApplyDrops(drops) {
        if (!this.netDrops) this.netDrops = new Map();
        if (!this.droppedItems) this.droppedItems = this.add.group();
        const seen = new Set();
        for (const d of drops) {
            if (!d?.id) continue;
            const key = this._netDropKey(d);
            seen.add(key);
            let spr = this.netDrops.get(key);
            if (!spr || !spr.active) {
                const chunk = LivingMob.ensureChunkAt(this, d.x, d.y - 1);
                if (!chunk) continue;
                const entry = {
                    uid: d.uid || key,
                    id: d.id,
                    x: d.x,
                    y: d.y,
                    quantity: d.quantity || 1,
                    spoilAt: d.spoilAt,
                    food: d.food,
                    customName: d.customName,
                    netSync: true,
                    lifeMs: 1e9
                };
                this._netCopyDropExtras(entry, d);
                // Don't persist into chunk.meta — snapshot owns the list
                spr = new DroppedItem(this, entry, chunk);
                this.netDrops.set(key, spr);
            } else {
                spr.x = d.x;
                spr.y = d.y;
                spr.quantity = d.quantity || 1;
                if (spr.entry) {
                    spr.entry.x = d.x;
                    spr.entry.y = d.y;
                    spr.entry.quantity = spr.quantity;
                    // Server may have lazily spoiled while this drop was out of view
                    if (d.id && d.id !== spr.entry.id) {
                        spr.entry.id = d.id;
                        const meta = this.getItem(d.id);
                            if (meta) {
                            spr.item = meta;
                            const iconKey = (typeof Place !== "undefined" && Place.itemIconKey)
                                ? Place.itemIconKey(meta, (id) => this.getThing(id), (k) => this.textures.exists(k))
                                : meta.key;
                            if (iconKey && this.textures.exists(iconKey)) spr.setTexture(iconKey);
                        }
                    }
                    if (d.spoilAt != null) {
                        spr.entry.spoilAt = d.spoilAt;
                        spr.spoilAt = d.spoilAt;
                    } else {
                        delete spr.entry.spoilAt;
                        delete spr.spoilAt;
                    }
                    if (d.food) {
                        spr.entry.food = d.food;
                        spr.food = { ...d.food };
                    } else {
                        delete spr.entry.food;
                        delete spr.food;
                    }
                    if (d.customName) {
                        spr.entry.customName = d.customName;
                        spr.customName = d.customName;
                    } else {
                        delete spr.entry.customName;
                        delete spr.customName;
                    }
                    this._netCopyDropExtras(spr.entry, d);
                    this._netSyncDropSpriteExtras(spr);
                }
            }
        }
        for (const [key, spr] of [...this.netDrops.entries()]) {
            if (seen.has(key)) continue;
            this.netDrops.delete(key);
            if (spr?.active) {
                if (typeof spr.persistDestroy === "function") spr.persistDestroy();
                else spr.destroy();
            }
        }
        // Remove any leftover local-only drops (no netSync) so they can't desync
        for (const drop of (this.droppedItems?.getChildren?.() || []).slice()) {
            if (!drop?.active) continue;
            if (drop.entry?.netSync) continue;
            if (typeof drop.persistDestroy === "function") drop.persistDestroy();
            else drop.destroy();
        }
    },

    /** Copy tip/knap/meal extras from a net drop payload onto an entry object. */
    _netCopyDropExtras(entry, d) {
        if (!entry || !d) return;
        const assign = (key, val) => {
            if (val != null && val !== "") entry[key] = val;
            else delete entry[key];
        };
        assign("toolClass", d.toolClass);
        assign("sharpness", d.sharpness);
        assign("knapDamage", d.knapDamage);
        assign("knapMaterial", d.knapMaterial);
        assign("knapQuality", d.knapQuality);
        assign("tooltipExtra", d.tooltipExtra);
        assign("knapIconData", d.knapIconData);
        assign("formClass", d.formClass);
        assign("formVoxels", d.formVoxels);
        assign("formStartMass", d.formStartMass);
        assign("formCustom", d.formCustom ? true : null);
        assign("beauty", d.beauty);
        assign("kind", d.kind);
        assign("fillTint", d.fillTint);
        assign("durability", d.durability);
        assign("dryProgress", d.dryProgress);
        assign("soakProgress", d.soakProgress);
        assign("soakDoneAt", d.soakDoneAt);
        assign("temp", d.temp);
        if (d.ingredients) {
            entry.ingredients = Array.isArray(d.ingredients)
                ? d.ingredients.slice()
                : d.ingredients;
        } else {
            delete entry.ingredients;
        }
        if (d.weight != null) entry.weight = d.weight;
        else delete entry.weight;
    },

    /** Mirror entry extras onto the live DroppedItem sprite fields used by tooltips. */
    _netSyncDropSpriteExtras(spr) {
        if (!spr?.entry) return;
        const e = spr.entry;
        spr.toolClass = e.toolClass;
        spr.sharpness = e.sharpness;
        spr.knapDamage = e.knapDamage;
        spr.knapMaterial = e.knapMaterial;
        spr.knapQuality = e.knapQuality;
        spr.tooltipExtra = e.tooltipExtra;
        spr.knapIconData = e.knapIconData;
        spr.formClass = e.formClass;
        spr.formVoxels = e.formVoxels;
        spr.formStartMass = e.formStartMass;
        if (e.formCustom) spr.formCustom = true;
        else delete spr.formCustom;
        spr.beauty = e.beauty;
        spr.kind = e.kind;
        spr.fillTint = e.fillTint;
        spr.durability = e.durability;
        spr.dryProgress = e.dryProgress;
        spr.soakProgress = e.soakProgress;
        spr.soakDoneAt = e.soakDoneAt;
        spr.temp = e.temp;
        spr.ingredients = e.ingredients;
        spr.stackWeight = e.weight;
        if (e.food) spr.food = { ...e.food };
        else delete spr.food;
        if (e.customName) spr.customName = e.customName;
        else delete spr.customName;
    },

    /**
     * Upsert one dedicated-MP corpse sprite. Does not reconcile/remove others.
     * @param {object} c server corpse entry
     * @param {{ pending?: boolean, confirmed?: boolean }} [opts]
     */
    _netUpsertCorpse(c, opts = {}) {
        if (!c?.id) return null;
        if (this._goneCorpseIds?.has(c.id)) return null;
        if (!this.netCorpses) this.netCorpses = new Map();
        if (!this.corpses?.children) this.corpses = this.add.group();
        const loot = Array.isArray(c.loot)
            ? c.loot.map((s) => (typeof cloneItemStack === "function" ? cloneItemStack(s) : s)).filter(Boolean)
            : [];
        let key = c.key || "human";
        if (typeof PlayerLook !== "undefined") {
            key = PlayerLook.resolveTexture(this, key, c.look);
        } else if (!this.textures.exists(key) || key === "player") {
            if (this.textures.exists("human")) key = "human";
            else if (this.textures.exists("deer")) key = "deer";
        }
        const frame = c.frame != null ? c.frame : 7;
        let spr = this.netCorpses.get(c.id);
        if (!spr || !spr.active) {
            const stale = spr;
            const chunk = LivingMob.ensureChunkAt(this, c.x, c.y);
            if (!chunk) return null;
            const entry = {
                id: c.id,
                x: c.x,
                y: c.y,
                key,
                look: c.look || null,
                frame,
                name: c.name || "Corpse",
                loot,
                body: c.body || null,
                bodyPlan: c.bodyPlan || "human",
                mobId: c.mobId || null,
                skinned: !!c.skinned,
                diedAt: c.diedAt,
                stage: c.stage === "carcass" ? "carcass" : "corpse",
                playerCorpse: !!c.playerCorpse,
                netSync: true
            };
            if (opts.pending) {
                entry.pendingServer = true;
                entry.pendingAt = performance.now();
            }
            spr = new Corpse(this, entry, chunk);
            this.netCorpses.set(c.id, spr);
            // Keep meta in sync so chunk reload / tooling can find the corpse
            if (!chunk.meta.corpses) chunk.meta.corpses = [];
            if (!chunk.meta.corpses.some((e) => e?.id === entry.id)) {
                chunk.meta.corpses.push(entry);
            }
            if (stale && this.corpsePanel?.corpse === stale) {
                this.corpsePanel.corpse = spr;
                if (this.corpsePanel.visible) this.corpsePanel.syncFromEntry?.();
            }
            return spr;
        }
        const chunk = LivingMob.ensureChunkAt(this, c.x, c.y);
        if (!chunk) return spr;
        spr.x = c.x;
        spr.y = c.y;
        spr.setDepth((Number(c.y) || 0) + 1);
        if (typeof spr._setCorpseHitArea === "function") spr._setCorpseHitArea();
        else if (spr.input) spr.input.enabled = true;
        // Re-attach to the live chunk group after unload detached netSync corpses
        if (spr.chunk !== chunk) {
            spr.chunk?.corpses?.remove(spr);
            spr.chunk = chunk;
            if (!chunk.corpses?.children) {
                chunk.ensureSpriteGroups?.();
                if (!chunk.corpses) chunk.corpses = new Phaser.GameObjects.Group(this);
            }
            chunk.corpses.add(spr);
        } else if (chunk.corpses?.children && !chunk.corpses.contains(spr)) {
            chunk.corpses.add(spr);
        }
        if (spr.entry) {
            spr.entry.x = c.x;
            spr.entry.y = c.y;
            spr.entry.key = key;
            spr.entry.frame = frame;
            spr.entry.name = c.name || spr.entry.name || "Corpse";
            spr.entry.skinned = !!c.skinned;
            spr.entry.body = c.body != null ? c.body : spr.entry.body;
            spr.entry.bodyPlan = c.bodyPlan || spr.entry.bodyPlan || "human";
            spr.entry.mobId = c.mobId != null ? c.mobId : spr.entry.mobId;
            spr.entry.playerCorpse = !!(c.playerCorpse || spr.entry.playerCorpse);
            spr.entry.loot = loot;
            if (c.diedAt != null) spr.entry.diedAt = c.diedAt;
            if (c.stage) spr.entry.stage = c.stage;
            spr.entry.netSync = true;
            spr.applyStageAppearance?.();
            if (opts.pending) {
                spr.entry.pendingServer = true;
                spr.entry.pendingAt = performance.now();
            } else if (opts.confirmed) {
                delete spr.entry.pendingServer;
                delete spr.entry.pendingAt;
            }
            if (this.corpsePanel?.visible && this.corpsePanel.corpse === spr) {
                this.corpsePanel.syncFromEntry?.();
            }
        }
        return spr;
    },

    _netApplyCorpses(corpses) {
        // Malformed payload (e.g. single object) would iterate keys and wipe everyone
        if (!Array.isArray(corpses)) return;
        if (!this.netCorpses) this.netCorpses = new Map();
        if (!this.corpses?.children) this.corpses = this.add.group();
        const seen = new Set();
        const now = performance.now();
        for (const c of corpses) {
            if (!c?.id) continue;
            if (this._goneCorpseIds?.has(c.id)) continue;
            seen.add(c.id);
            const spr = this._netUpsertCorpse(c, { confirmed: true });
            if (spr?.entry) spr.entry._missedSnaps = 0;
        }
        for (const [id, spr] of [...this.netCorpses.entries()]) {
            if (seen.has(id)) continue;
            // Keep briefly if event spawned it and snapshot hasn't caught up yet
            if (spr?.entry?.pendingServer && now - (spr.entry.pendingAt || 0) < 3000) continue;
            // Don't yank a corpse out from under an open loot UI
            if (this.corpsePanel?.corpse === spr) continue;
            // One empty/partial snapshot (common around player death) must not
            // sparkle-despawn every nearby corpse — require a few consecutive misses.
            const missed = (spr?.entry?._missedSnaps || 0) + 1;
            if (spr?.entry) spr.entry._missedSnaps = missed;
            if (missed < 5) continue;
            this.netCorpses.delete(id);
            if (spr?.active) {
                // Silent — sparkle is reserved for authoritative corpse remove events
                spr.destroy();
            }
        }
        // Strip leftover local-only corpses (e.g. stale client spawn)
        for (const corpse of (this.corpses?.getChildren?.() || []).slice()) {
            if (!corpse?.active) continue;
            if (corpse.entry?.netSync) continue;
            if (this.corpsePanel?.corpse === corpse) continue;
            corpse.destroy();
        }
    },

    _netEnsureMobAnims(tex) {
        if (!tex || !this.textures.exists(tex)) return;
        if (this.anims.exists(`${tex}-walk-down`)) return;
        const dirs = ["down", "left", "right", "up"];
        for (let row = 0; row < 4; row++) {
            const dir = dirs[row];
            const start = row * 3;
            this.anims.create({
                key: `${tex}-walk-${dir}`,
                frames: this.anims.generateFrameNumbers(tex, { start, end: start + 2 }),
                frameRate: 5,
                repeat: -1
            });
            this.anims.create({
                key: `${tex}-idle-${dir}`,
                frames: [{ key: tex, frame: start + 1 }],
                frameRate: 10
            });
        }
    },

    _netMakeMob(m) {
        const kind = m.kind || "deer";
        const def = this.getMob?.(kind);
        const texKey = def?.key || kind;
        const tex = this.textures.exists(texKey) ? texKey
            : (this.textures.exists(kind) ? kind
                : (this.textures.exists("deer") ? "deer" : null));
        const root = this.add.container(m.x, m.y);
        this.mainLayer.add(root);
        let spr;
        if (tex) {
            this._netEnsureMobAnims(tex);
            spr = this.add.sprite(0, 0, tex, 1).setOrigin(0, 1);
            const idle = `${tex}-idle-down`;
            if (this.anims.exists(idle)) spr.play(idle, true);
        } else {
            spr = this.add.circle(0, -4, 5, 0x88aa55);
        }
        root.add(spr);

        const label = m.name || def?.name || kind || "Creature";
        const hitOpts = tex
            ? { cursor: "pointer", pixelPerfect: true }
            : { cursor: "pointer" };
        spr.setInteractive(hitOpts);
        spr.on("pointerover", (pointer) => {
            const live = this.netMobs.get(m.id);
            this.showTooltip(live?.name || label, pointer.x, pointer.y, spr);
        });
        spr.on("pointerout", () => {
            if (this._hoverTarget === spr) this._hoverTarget = null;
            if (this._tooltipTarget === spr) this.hideTooltip();
        });
        spr.on("destroy", () => {
            if (this._hoverTarget === spr) this._hoverTarget = null;
            if (this._tooltipTarget === spr) this.hideTooltip();
        });

        const fistColor = this._netFistColor({ kind, look: m.look });
        const fist = this.add.rectangle(0, 0, 4, 10, fistColor, 1)
            .setOrigin(0.5, 1)
            .setVisible(false);
        root.add(fist);

        const now = performance.now();
        return {
            id: m.id,
            root,
            spr,
            tex,
            kind,
            name: label,
            fist,
            x: m.x,
            y: m.y,
            fromX: m.x,
            fromY: m.y,
            tx: m.x,
            ty: m.y,
            snapAt: now,
            snapDt: 1000 / (NetProtocol.SNAPSHOT_HZ || 15),
            facing: m.facing || "down",
            moving: !!m.moving,
            serverMoving: !!m.moving,
            vx: m.vx || 0,
            vy: m.vy || 0,
            animKey: null,
            facingHoldUntil: 0,
            attackTimer: 0,
            attackMax: 0,
            attackAngle: 0,
            look: m.look || null,
            panic: !!m.panic,
            hostile: !!m.hostile,
            prone: !!m.prone
        };
    },

    _netApplyMobs(mobs) {
        const seen = new Set();
        const now = performance.now();
        const snapDt = 1000 / (NetProtocol.SNAPSHOT_HZ || 15);
        for (const m of mobs) {
            if (!m?.id) continue;
            seen.add(m.id);
            let entry = this.netMobs.get(m.id);
            if (!entry) {
                entry = this._netMakeMob(m);
                this.netMobs.set(m.id, entry);
            } else {
                entry.fromX = entry.x;
                entry.fromY = entry.y;
                entry.tx = m.x;
                entry.ty = m.y;
                const prevAt = entry.snapAt;
                entry.snapAt = now;
                entry.snapDt = (typeof Party !== "undefined" && Party.puppetSnapGapMs)
                    ? Party.puppetSnapGapMs(prevAt, now)
                    : snapDt;
            }
            entry.kind = m.kind || entry.kind;
            if (m.name) entry.name = m.name;
            // Trust server facing — don't invent from lerp error
            if (m.facing) entry.facing = m.facing;
            if (Number.isFinite(m.vx)) entry.vx = m.vx;
            if (Number.isFinite(m.vy)) entry.vy = m.vy;
            if (typeof m.moving === "boolean") entry.serverMoving = m.moving;
            entry.panic = !!m.panic;
            entry.hostile = !!m.hostile;
            entry.state = m.state || entry.state;
            entry.prone = !!m.prone;
            if (m.look) entry.look = m.look;
            if (m.prone) {
                this._netClearRemoteAttack(entry);
            } else if (m.attacking && Number.isFinite(m.attackAngle)) {
                if (!(entry.attackTimer > 0)) {
                    this._netStartRemoteAttack(entry, m.attackAngle, m.facing, m.attackArt);
                } else {
                    entry.attackAngle = m.attackAngle;
                    if (m.attackArt) entry.attackArt = m.attackArt;
                }
            }
        }
        for (const [id, entry] of this.netMobs) {
            if (!seen.has(id)) {
                entry.root.destroy(true);
                this.netMobs.delete(id);
            }
        }
    },

    _netUpdateMobs(delta) {
        const now = performance.now();
        const dt = Math.max(1, delta || 16) / 1000;
        const tileSize = this.tileSize || 16;
        const humanRef = 3.5;
        for (const entry of this.netMobs.values()) {
            const snapDt = entry.snapDt || (1000 / 15);
            const age = now - (entry.snapAt || now);
            let u = snapDt > 0 ? age / snapDt : 1;
            if (u > 1) u = 1 + Math.min(0.15, (u - 1) * 0.25);

            const err = Math.hypot(entry.tx - entry.fromX, entry.ty - entry.fromY);
            const prevX = entry.x;
            const prevY = entry.y;
            const teleport = (typeof Party !== "undefined" && Party.puppetTeleportPx)
                ? Party.puppetTeleportPx({
                    tickSpeed: this.tickSpeed,
                    tileSize,
                    snapDtMs: snapDt,
                    speedTiles: 3.5
                })
                : 72;
            const pose = (typeof Party !== "undefined" && Party.puppetLerpXY)
                ? Party.puppetLerpXY({
                    fromX: entry.fromX,
                    fromY: entry.fromY,
                    tx: entry.tx,
                    ty: entry.ty,
                    snapAt: entry.snapAt,
                    snapDtMs: snapDt,
                    now,
                    teleportPx: teleport,
                    moving: entry.serverMoving !== false && err > 1,
                    heading: null,
                    speedPx: Math.hypot(entry.vx || 0, entry.vy || 0)
                })
                : null;
            if (entry.prone) {
                entry.x = entry.tx;
                entry.y = entry.ty;
                entry.fromX = entry.tx;
                entry.fromY = entry.ty;
            } else if (pose) {
                entry.x = pose.x;
                entry.y = pose.y;
            } else if (err > teleport) {
                entry.x = entry.tx;
                entry.y = entry.ty;
                entry.fromX = entry.tx;
                entry.fromY = entry.ty;
            } else {
                entry.x = entry.fromX + (entry.tx - entry.fromX) * Math.min(1, u);
                entry.y = entry.fromY + (entry.ty - entry.fromY) * Math.min(1, u);
            }

            entry.root.setPosition(entry.x, entry.y);
            this._setRemoteSortDepth(entry);

            if (entry.prone) {
                this._netClearRemoteAttack(entry);
            } else if (entry.attackTimer > 0) {
                entry.attackTimer = Math.max(0, entry.attackTimer - (delta || 16));
                const progress = entry.attackMax > 0
                    ? 1 - entry.attackTimer / entry.attackMax
                    : 1;
                this._netUpdateRemoteAttackSprites(entry, progress);
                if (entry.attackTimer <= 0) {
                    if (entry.fist) entry.fist.setVisible(false);
                    if (entry.weapon) entry.weapon.setVisible(false);
                    entry.attackArt = null;
                }
            } else {
                if (entry.fist?.visible) entry.fist.setVisible(false);
                if (entry.weapon?.visible) entry.weapon.setVisible(false);
            }

            const dx = entry.x - prevX;
            const dy = entry.y - prevY;
            const speedPx = Math.hypot(dx, dy) / dt;
            const tilesPerSec = speedPx / tileSize;
            const serverSpeed = Math.hypot(entry.vx || 0, entry.vy || 0) / tileSize;
            const moveSignal = Math.max(tilesPerSec, serverSpeed);

            // Walk/idle from server intent, with soft hysteresis on visual speed
            if (entry.serverMoving === true || entry.state === "panic" || moveSignal > 0.25) {
                entry.moving = true;
            } else if (entry.serverMoving === false || moveSignal < 0.08) {
                entry.moving = false;
            }

            const tex = entry.tex;
            if (!tex || !entry.spr?.play) continue;
            if (typeof setPuppetProne === "function") {
                if (entry.resting) {
                    setPuppetProne(entry.spr, true, {
                        feetAnchored: true,
                        resting: true,
                        restRot: entry.restRot
                    });
                } else {
                    setPuppetProne(entry.spr, !!entry.prone, { feetAnchored: true });
                }
            }
            if (entry.prone) {
                entry.animKey = null;
                continue;
            }
            const wildlifeFrozen = typeof Party !== "undefined" && Party.mobTimeScale
                ? !(Party.mobTimeScale(this.tickSpeed) > 0)
                : !(Number(this.tickSpeed) > 0);
            if (wildlifeFrozen) {
                entry.moving = false;
                if (entry.spr.anims) {
                    if (typeof entry.spr.anims.pause === "function") {
                        if (entry.spr.anims.isPlaying && !entry.spr.anims.isPaused) {
                            entry.spr.anims.pause();
                        }
                    } else {
                        entry.spr.anims.timeScale = 0;
                    }
                }
                continue;
            }
            if (entry.spr.anims?.isPaused && typeof entry.spr.anims.resume === "function") {
                entry.spr.anims.resume();
            }
            const facing = entry.facing || "down";
            const key = `${tex}-${entry.moving ? "walk" : "idle"}-${facing}`;
            // Only restart anim when the key changes (play every frame kills cadence)
            if (key !== entry.animKey && this.anims.exists(key)) {
                entry.animKey = key;
                entry.spr.play(key, true);
            }
            if (entry.spr.anims) {
                // Match playback to actual travel speed — don't floor panic anims at a
                // full gallop or a limping deer still looks like it's sprinting.
                entry.spr.anims.timeScale = entry.moving
                    ? Phaser.Math.Clamp(
                        Math.max(moveSignal, 0.35) / humanRef,
                        0.2,
                        2.2
                    )
                    : 1;
            }
        }
    },

    _netShowRemoteBubble(playerId, msg) {
        const entry = this.remotePlayers.get(playerId);
        if (!entry || !msg) return;
        const text = String(msg).replace(/^<[^>]+>\s*/, "");
        if (!text) return;
        entry.bubble.setText(text).setVisible(true).setAlpha(1);
        entry.bubbleUntil = (this._chatFadeNow?.() ?? (this.time?.now || 0)) + 10000;
        this._netLayoutRemoteLabels(entry);
    },

    _netDestroyRemote(entry) {
        if (!entry) return;
        entry.name?.destroy?.();
        entry.bubble?.destroy?.();
        entry.channelBar?.destroy?.();
        entry.root?.destroy?.(true);
    },

    /**
     * Lying puppets sort under standing bodies. Sleepers sit just above the
     * lean-to floor (not at the structure's south feet). Net roots are
     * feet-anchored except while resting (body-center).
     */
    _setRemoteSortDepth(entry) {
        if (!entry?.root) return;
        if (typeof applyCreatureSortDepth === "function") {
            applyCreatureSortDepth(entry.root, {
                sprite: entry.spr,
                y: entry.y,
                prone: !!entry.prone,
                resting: !!entry.resting,
                centered: false,
                leanTo: entry.resting
                    ? this.findLeanToByUid?.(entry.lastSleep?.uid)
                    : null,
                slot: entry.lastSleep?.slot,
                height: Number(entry.spr?.height) || 16
            });
            return;
        }
        const y = Number(entry.y) || 0;
        entry.root.setDepth(y | 0);
    },

    _netLayoutRemoteLabels(entry) {
        const spr = entry.spr;
        const nameH = Math.ceil((entry.name.height || 12) * (entry.name.scaleY || 1));
        const resting = !!(entry.resting || spr?._resting);
        const prone = !!(entry.prone || spr?._prone);
        let nameX;
        let nameY;
        if (resting) {
            // Container is sleeper body center; sprite sits at local 0,0.
            nameX = 0;
            nameY = -Math.round(16 * 0.5 + 4);
        } else if (prone) {
            // Container is feet-anchored; sprite is shifted to body center.
            nameX = Math.round((spr.width || 16) * 0.5);
            nameY = -Math.round(Math.max(spr.width || 16, spr.height || 16) * 0.5 + 4);
        } else {
            nameX = Math.round((spr.width || 16) * 0.5);
            nameY = -Math.round((spr.height || 16) + 4);
        }
        const wx = entry.x + nameX;
        const wy = entry.y + nameY;
        const above = this.isPartyWorldHud(entry);
        const underDepth = (entry.y | 0) + 40;
        if (entry.name?.active) {
            this._placeWorldHud(entry.name, above ? 60 : underDepth, above);
            entry.name.setPosition(wx, wy);
        }
        const bubbleOn = entry.bubble?.visible
            && (this._chatFadeNow?.() ?? (this.time?.now || 0)) < entry.bubbleUntil;
        if (entry.bubble?.active) {
            this._placeWorldHud(entry.bubble, above ? 61 : underDepth + 1, above);
            if (bubbleOn) entry.bubble.setPosition(wx, wy - nameH - 2);
        }
        this._netSyncRemoteChannelBar(entry);
    },

    _netSyncRemoteChannelBar(entry) {
        if (!entry) return;
        const eat = entry.eatChannel;
        const live = eat && typeof eat.progress === "number" && !entry.dead;
        if (!live) {
            if (entry.channelBar) {
                entry.channelBar.clear();
                entry.channelBar.setVisible(false);
            }
            return;
        }
        entry.channelBar = this._ensureWorldHudBar(entry.channelBar);
        const frac = Phaser.Math.Clamp(eat.progress, 0, 1);
        const zoom = this.worldZoom || 3;
        const w = 40;
        const h = 5;
        const spr = entry.spr;
        const prone = !!(entry.prone || spr?._prone);
        const lx = prone ? 0 : Math.round((spr?.width || 16) * 0.5);
        const ly = prone
            ? -Math.round(Math.max(spr?.width || 16, spr?.height || 16) * 0.5 + 2)
            : -Math.round((spr?.height || 16) + 2);
        const above = this.isPartyWorldHud(entry);
        this._placeWorldHud(entry.channelBar, above ? 51 : (entry.y | 0) + 41, above);
        const g = entry.channelBar;
        g.clear().setVisible(true);
        g.setScale(1 / zoom);
        g.setPosition(entry.x + lx, entry.y + ly);
        const color = this._channelBarFillColor?.(frac) || 0x80e080;
        this._drawBar(g, -Math.floor(w / 2), -h, w, h, frac, 0x000000, 0x222222, color, 2);
    },

    /** Refresh remote name / chat bubble fonts after GUI scale changes. */
    _netApplyRemoteLabelScale(entry) {
        if (!entry) return;
        const zoom = this.worldZoom || 3;
        if (entry.name?.active) {
            const s = this.uiScale || 1;
            entry.name.setStroke("#000000", Math.max(2, Math.round(3 * s)));
            if (typeof applyPixelUiWorldFont === "function") applyPixelUiWorldFont(entry.name, 8, this);
            else entry.name.setScale(1 / zoom);
        }
        if (entry.bubble?.active) {
            const s = this.uiScale || 1;
            entry.bubble.setStroke("#000000", Math.max(2, Math.round(3 * s)))
                .setWordWrapWidth(Math.round(140 * s), true);
            if (typeof applyPixelUiWorldFont === "function") applyPixelUiWorldFont(entry.bubble, 16, this);
            else entry.bubble.setScale(1 / zoom);
        }
        this._netLayoutRemoteLabels(entry);
    },
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
