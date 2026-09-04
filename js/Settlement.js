/**
 * Client settlement: claims, parked people, range ring, HUD toggle.
 */
class SettlementSystem {
    constructor(scene) {
        this.scene = scene;
        this.list = [];
        this.hudBtn = null;
        this._rangeGfx = null;
        this._rangeDrawn = null;
        this._stCache = null;
        this._worldCache = null;
        this._chunkList = null;
        this._uidMap = null;
        this._uidMapAt = 0;
        this._nameOverlay = null;
        this._destroyOverlay = null;
        this._onNameKey = null;
        this._pendingPlace = null;
        this._worldPointerLocked = false;
        this._inputWasEnabled = true;
    }

    ownerId() {
        const scene = this.scene;
        return scene.leader?.ownerId || scene.characterId || scene._netPlayerId || null;
    }

    loadFromWorld(world) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        this.list = (world?.settlements || []).map((s) => (S ? S.ensureSettlement(s) : s));
        this.scene.settlers = this.scene.settlers || [];
    }

    persistTo(world) {
        if (!world) return;
        world.settlements = this.list.map((s) => JSON.parse(JSON.stringify(s)));
        const sys = this.scene.partySys;
        world.settlers = (this.scene.settlers || [])
            .filter((p) => p && !p.isBodyDead?.())
            .map((p) => {
                const snap = sys?._pawnSnapshot?.(p) || {
                    id: p.pawnId,
                    name: p.pawnName,
                    x: p.x,
                    y: p.y
                };
                snap.homeSettlementId = p.homeSettlementId || null;
                snap.ownerId = p.ownerId || this.ownerId();
                snap.role = "settler";
                return snap;
            });
    }

    spawnSavedSettlers(world) {
        const scene = this.scene;
        const sys = scene.partySys;
        if (!sys || !Array.isArray(world?.settlers)) return;
        for (const snap of world.settlers) {
            if (!snap?.id) continue;
            if ((scene.party || []).some((p) => p.pawnId === snap.id)) continue;
            if ((scene.settlers || []).some((p) => p?.active && p.pawnId === snap.id)) continue;
            this._spawnSettlerPawn(snap);
        }
    }

    _spawnSettlerPawn(snap) {
        const scene = this.scene;
        const sys = scene.partySys;
        const prev = scene.party?.length;
        const pawn = sys.spawnCompanion({
            id: snap.id,
            name: snap.name,
            look: snap.look,
            x: snap.x,
            y: snap.y,
            facing: snap.facing,
            inventory: snap.inventory,
            overflow: snap.overflow,
            equipment: snap.equipment,
            hotbarIndex: snap.hotbarIndex,
            kc: snap.kc,
            saturation: snap.saturation,
            stomach: snap.stomach,
            body: snap.body,
            lastSleep: snap.lastSleep,
            resting: snap.resting,
            ignoreCap: true
        });
        if (!pawn) return null;
        scene.party = (scene.party || []).filter((p) => p !== pawn);
        pawn.role = "settler";
        pawn.homeSettlementId = snap.homeSettlementId || null;
        if (!scene.settlers) scene.settlers = [];
        scene.settlers.push(pawn);
        scene.partyPanel?.refresh?.();
        return pawn;
    }

    byId(id) {
        return this.list.find((s) => s.id === id) || null;
    }

    byStoneUid(uid) {
        if (!uid) return null;
        return this.list.find((s) => s.stoneUid === uid) || null;
    }

    owned() {
        const oid = this.ownerId();
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        return S ? S.ownedOf(this.list, oid) : this.list.filter((s) => s.ownerId === oid);
    }

    here(pawn) {
        const p = pawn || this.scene.player;
        if (!p) return null;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!S) return null;
        return S.atPoint(this.owned(), p.x, p.y, this.scene.tileSize || 16, this.ownerId());
    }

    settlersOf(settleId) {
        return (this.scene.settlers || []).filter(
            (p) => p && !p.isBodyDead?.() && p.homeSettlementId === settleId
        );
    }

    workClaims(settle) {
        if (!settle?.id) return null;
        if (!this._workClaims) this._workClaims = new Map();
        let c = this._workClaims.get(settle.id);
        if (!c) {
            const S = typeof Settlement !== "undefined" ? Settlement : null;
            c = S?.createWorkClaims ? S.createWorkClaims() : null;
            if (c) this._workClaims.set(settle.id, c);
        }
        return c;
    }

    releaseWork(pawnId, settleId) {
        if (!pawnId || !settleId || !this._workClaims) return;
        this._workClaims.get(settleId)?.release(pawnId);
    }

    orphans() {
        return (this.scene.settlers || []).filter(
            (p) => p && !p.isBodyDead?.() && !p.homeSettlementId
        );
    }

    addedBaskets(settle) {
        return this._stationCache(settle).baskets;
    }

    addedStations(settle, kind) {
        const snap = this._stationCache(settle);
        if (!kind) return snap.stations;
        return snap.byKind[kind] || [];
    }

    lootablesInRange(settle) {
        return this._worldIndex(settle).loot;
    }

    choppablesInRange(settle) {
        return this._worldIndex(settle).chop;
    }

    _nowMs() {
        return this.scene.time?.now || performance.now();
    }

    _chunksFor(settle) {
        if (!settle) return [];
        const now = this._nowMs();
        if (this._chunkList && this._chunkList.id === settle.id && now - this._chunkList.at < 400) {
            return this._chunkList.list;
        }
        const scene = this.scene;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const ts = scene.tileSize || 16;
        const cs = scene.chunkSize || 8;
        const keys = S?.chunkKeysFor?.(settle, ts, cs) || [];
        const list = [];
        for (let i = 0; i < keys.length; i++) {
            const ch = scene.chunks?.[keys[i]];
            if (ch) list.push(ch);
        }
        this._chunkList = { id: settle.id, at: now, list };
        return list;
    }

    _stationCache(settle) {
        if (!settle) return { baskets: [], stations: [], byKind: {} };
        const now = this._nowMs();
        if (this._stCache && this._stCache.id === settle.id && now - this._stCache.at < 180) {
            return this._stCache;
        }
        const uids = new Set(settle.stationUids || []);
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const baskets = [];
        const stations = [];
        const byKind = {};
        this._forEachThing((spr) => {
            const uid = spr?.entry?.uid;
            if (!uid || !uids.has(uid)) return;
            stations.push(spr);
            const k = S ? S.stationKind(spr.entry?.id) : null;
            if (k) {
                if (!byKind[k]) byKind[k] = [];
                byKind[k].push(spr);
            }
            if (spr.entry?.id === "wicker_basket" || spr.meta?.storage?.slots > 1) {
                baskets.push(spr.entry);
            }
        }, settle);
        this._stCache = { id: settle.id, at: now, baskets, stations, byKind };
        return this._stCache;
    }

    _worldIndex(settle) {
        if (!settle) return { loot: [], chop: [], drops: [] };
        const now = this._nowMs();
        if (this._worldCache && this._worldCache.id === settle.id && now - this._worldCache.at < 400) {
            return this._worldCache;
        }
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const ts = this.scene.tileSize || 16;
        const loot = [];
        const chop = [];
        this._forEachThing((t) => {
            if (!t || t.entry?.gone) return;
            if (!S || !S.inRange(settle, t.x, t.y, ts)) return;
            if (t.meta?.lootable) loot.push(t);
            const def = this.scene.getThing?.(t.entry?.id) || t.meta;
            if (typeof Chop !== "undefined" && Chop.stillChoppable?.(def, t.entry)) chop.push(t);
        }, settle);
        this._worldCache = { id: settle.id, at: now, loot, chop, drops: this._collectDrops(settle, S, ts) };
        return this._worldCache;
    }

    bumpWorkCache() {
        this._stCache = null;
        this._worldCache = null;
        this._chunkList = null;
        this._uidMap = null;
    }

    _forEachThing(fn, settle) {
        const chunks = settle
            ? this._chunksFor(settle)
            : (this.scene._loadedChunks || []);
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            if (!chunk) continue;
            const kids = chunk.things?.getChildren?.() || [];
            for (let j = 0; j < kids.length; j++) fn(kids[j]);
        }
    }

    findThingByUid(uid) {
        if (!uid) return null;
        const now = this._nowMs();
        const fresh = this._uidMap && now - (this._uidMapAt || 0) < 400;
        if (fresh) {
            const cached = this._uidMap.get(uid);
            if (!cached) return null;
            if (cached.active && cached.entry?.uid === uid) return cached;
        }
        const map = new Map();
        this._forEachThing((t) => {
            const id = t?.entry?.uid;
            if (id) map.set(id, t);
        });
        this._uidMap = map;
        this._uidMapAt = now;
        const found = map.get(uid);
        return found?.active ? found : null;
    }

    countBaskets(settle, itemId) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!S) return 0;
        return S.countStock(this.addedBaskets(settle), itemId)
            + S.countPawnStock(this.settlersOf(settle.id), itemId)
            + S.countDropStock(this.dropsInRange(settle), itemId);
    }

    _collectDrops(settle, S, ts) {
        if (!S || !settle) return [];
        const out = [];
        const seen = new Set();
        const drops = this.scene.droppedItems?.getChildren?.() || [];
        for (let i = 0; i < drops.length; i++) {
            const d = drops[i];
            if (!d?.active || !(d.quantity > 0)) continue;
            if (!S.inRange(settle, d.x, d.y, ts)) continue;
            out.push(d);
            if (d.entry) seen.add(d.entry);
        }
        const chunks = this._chunksFor(settle);
        for (let i = 0; i < chunks.length; i++) {
            const list = chunks[i]?.meta?.drops;
            if (!list) continue;
            for (let j = 0; j < list.length; j++) {
                const entry = list[j];
                if (!entry || seen.has(entry) || !(entry.quantity > 0)) continue;
                if (!S.inRange(settle, entry.x, entry.y, ts)) continue;
                out.push(entry);
            }
        }
        return out;
    }

    dropsInRange(settle) {
        return this._worldIndex(settle).drops || [];
    }

    localStockItems(settle) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!S) return ["stick", "leaf", "log"];
        if (!settle) return [];
        const ts = this.scene.tileSize || 16;
        const found = new Set();
        const note = (def, entry) => {
            for (const id of S.stockItemsFromThing(def, entry)) found.add(id);
        };
        this._forEachThing((t) => {
            if (!t || t.entry?.gone) return;
            if (!S.inRange(settle, t.x, t.y, ts)) return;
            note(t.meta || this.scene.getThing?.(t.entry?.id), t.entry);
        }, settle);
        const chunks = this._chunksFor(settle);
        for (let i = 0; i < chunks.length; i++) {
            const lists = [chunks[i]?.meta?.things, chunks[i]?.meta?.lootableThings];
            for (let li = 0; li < lists.length; li++) {
                const list = lists[li];
                if (!Array.isArray(list)) continue;
                for (let j = 0; j < list.length; j++) {
                    const entry = list[j];
                    if (!entry || entry.gone) continue;
                    if (!S.inRange(settle, entry.x, entry.y, ts)) continue;
                    note(this.scene.getThing?.(entry.id), entry);
                }
            }
        }
        const drops = this.dropsInRange(settle);
        for (let i = 0; i < drops.length; i++) {
            const id = S.dropItemId(drops[i]);
            if (id) found.add(id);
        }
        return S.filterStockItems(found);
    }

    countItem(settle, itemId) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!S) return 0;
        let n = this.countBaskets(settle, itemId);
        for (const spr of this.addedStations(settle)) {
            const e = spr?.entry;
            if (!e) continue;
            n += S.countInSlots(e.slots, itemId);
            n += S.countInSlots(e.fuel, itemId);
            if (e.cook?.id === itemId) n += S.stackQty(e.cook);
            n += S.countInSlots(e.simmer, itemId);
        }
        return n;
    }

    tryPlace(tx, ty, rot, name) {
        const scene = this.scene;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!S) return null;
        const { x, y } = scene.tileCenter(tx, ty);
        if (!S.canPlace(this.list, x, y, scene.tileSize || 16)) {
            scene.combatLog?.push("Too close to another settlement");
            return null;
        }
        const chunk = scene.getChunkAtWorld(x, y - 1);
        if (!chunk || !chunk.isLoaded) return null;
        const entry = {
            id: "settling_stone",
            x,
            y,
            tx,
            ty,
            rot: typeof Place !== "undefined" ? Place.normalizeRot(rot) : (rot || 0)
        };
        if (typeof Place !== "undefined") Place.ensureSettlementEntry(entry);
        chunk.meta.things.push(entry);
        const spr = new SettlingStone(scene, entry);
        chunk.things.add(spr);
        const settle = S.createSettlement({
            name,
            ownerId: this.ownerId(),
            x,
            y,
            tx,
            ty
        });
        settle.stoneUid = entry.uid;
        this.list.push(settle);
        entry.settlementId = settle.id;
        this.sendNet("found", { tx, ty, rot, name, settlementId: settle.id, stoneUid: entry.uid });
        scene.combatLog?.push(`${settle.name} has been founded`, {
            color: (typeof CombatLog !== "undefined" && CombatLog.COLOR_SETTLER) || "#7ec8ff"
        });
        return { settle, spr };
    }

    promptNameThenPlace(tx, ty, rot) {
        if (this._nameOverlay) return;
        this._pendingPlace = { tx, ty, rot };
        this._showNamePrompt((name) => {
            const scene = this.scene;
            const info = scene._heldPlaceableDef?.();
            if (scene.isNet && scene.net?.connected && !scene.net.isLocal) {
                scene._netSendMove?.(true);
                scene.net.sendAction({
                    type: NetProtocol.Actions.SETTLEMENT,
                    op: "found",
                    tx, ty, rot, name,
                    pawnId: scene.player?.pawnId
                });
                if (info?.held && !(info.held.quantity > 1)) scene.resetPlaceRot?.();
                return;
            }
            const placed = this.tryPlace(tx, ty, rot, name);
            if (placed && info?.held) scene.player?.loseItem?.(info.held, 1);
            if (placed && !(info?.held?.quantity > 0)) scene.resetPlaceRot?.();
            if (placed) this.openPanel(placed.settle);
        }, { placeholder: "Camp" });
    }

    _showNamePrompt(onOk, opts = {}) {
        this._hideNamePrompt();
        const s = this.scene.uiScale || 1;
        const fontPx = typeof pixelUiFontSize === "function" ? pixelUiFontSize(16, s) : Math.round(16 * s);
        const stroke = Math.max(2, Math.round(2 * s));
        const pad = Math.round(16 * s);
        const padX = Math.round(18 * s);
        const wrap = document.createElement("div");
        wrap.style.cssText = [
            "position:fixed", "inset:0", "z-index:10000",
            "display:flex", "align-items:center", "justify-content:center",
            "background:rgba(8,6,4,0.55)",
            "pointer-events:auto"
        ].join(";");
        const box = document.createElement("div");
        box.style.cssText = [
            "background:#120e0a",
            `border:${stroke}px solid #2a2218`,
            `padding:${pad}px ${padX}px`,
            `min-width:${Math.round(220 * s)}px`
        ].join(";");
        const label = document.createElement("div");
        label.textContent = "Name your settlement";
        label.style.cssText = [
            "color:#d4c4a8",
            "font-family:PrimaryFont,monospace",
            `margin-bottom:${Math.round(8 * s)}px`,
            `font-size:${fontPx}px`
        ].join(";");
        const placeholder = String(opts.placeholder || "").trim() || "Camp";
        const input = document.createElement("input");
        input.maxLength = (typeof Settlement !== "undefined" && Settlement.NAME_MAX) || 24;
        input.placeholder = placeholder;
        input.style.cssText = [
            "width:100%",
            "box-sizing:border-box",
            "background:#0a0806",
            "color:#d4c4a8",
            `border:1px solid #2a2218`,
            `padding:${Math.round(6 * s)}px ${Math.round(8 * s)}px`,
            "font-family:PrimaryFont,monospace",
            `font-size:${fontPx}px`
        ].join(";");
        const row = document.createElement("div");
        row.style.cssText = [
            "display:flex",
            "justify-content:space-between",
            "align-items:center",
            `margin-top:${Math.round(10 * s)}px`,
            "width:100%"
        ].join(";");
        const BG = "#120e0a";
        const BG_PRESS = "#0a0806";
        const OUTLINE = "#2a2218";
        const OUTLINE_HOVER = "#ffffff";
        const OUTLINE_PRESS = "#d4a84b";
        const mk = (text, fn) => {
            const b = document.createElement("button");
            b.textContent = text;
            b.type = "button";
            b.tabIndex = -1;
            let hovering = false;
            let pressing = false;
            const paint = () => {
                const fill = pressing ? BG_PRESS : BG;
                const edge = pressing ? OUTLINE_PRESS : (hovering ? OUTLINE_HOVER : OUTLINE);
                b.style.background = fill;
                b.style.borderColor = edge;
            };
            b.style.cssText = [
                "background:" + BG,
                "color:#d4c4a8",
                `border:${stroke}px solid ${OUTLINE}`,
                `padding:${Math.round(4 * s)}px ${Math.round(10 * s)}px`,
                "cursor:pointer",
                "font-family:PrimaryFont,monospace",
                `font-size:${fontPx}px`,
                "outline:none",
                "appearance:none",
                "-webkit-appearance:none"
            ].join(";");
            b.addEventListener("mouseenter", () => { hovering = true; paint(); });
            b.addEventListener("mouseleave", () => { hovering = false; pressing = false; paint(); });
            b.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                pressing = true;
                paint();
            });
            b.addEventListener("mouseup", (e) => {
                e.stopPropagation();
                const was = pressing;
                pressing = false;
                paint();
                if (was && hovering) fn?.();
            });
            return b;
        };
        const finish = (ok) => {
            if (!this._nameOverlay) return;
            const raw = (input.value || "").trim();
            this._hideNamePrompt();
            if (ok) onOk?.(raw || placeholder);
        };
        row.appendChild(mk("Cancel", () => finish(false)));
        row.appendChild(mk("Found", () => finish(true)));
        // Stop bubble so Phaser (window, non-capture) never sees WASD / C / E / etc.
        for (const ev of ["keydown", "keyup", "keypress"]) {
            input.addEventListener(ev, (e) => {
                e.stopPropagation();
                if (ev !== "keydown") return;
                if (e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter") {
                    e.preventDefault();
                    finish(true);
                }
                if (e.key === "Escape" || e.code === "Escape" || e.key === "Esc") {
                    e.preventDefault();
                    finish(false);
                }
            });
        }
        wrap.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            if (e.target === wrap || e.target === box || e.target === label) input.focus();
        });
        // Capture: Esc/Enter always; other keys only when they are not going to the input.
        this._onNameKey = (e) => {
            const isEsc = e.key === "Escape" || e.code === "Escape" || e.key === "Esc";
            const isEnter = e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter";
            const tag = e.target && e.target.tagName ? String(e.target.tagName).toUpperCase() : "";
            if (e.type === "keydown" && (isEsc || isEnter)) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();
                if (e.repeat) return;
                if (isEnter) finish(true);
                else finish(false);
                return;
            }
            if (tag !== "INPUT") {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        window.addEventListener("keydown", this._onNameKey, true);
        window.addEventListener("keyup", this._onNameKey, true);
        box.appendChild(label);
        box.appendChild(input);
        box.appendChild(row);
        wrap.appendChild(box);
        document.body.appendChild(wrap);
        this._nameOverlay = wrap;
        this._lockWorldPointer();
        this.scene.input?.keyboard?.resetKeys?.();
        try { this.scene.game?.canvas?.blur?.(); } catch (_) {}
        setTimeout(() => input.focus(), 0);
    }

    isNaming() {
        return !!(this._nameOverlay || this._destroyOverlay);
    }

    _hideNamePrompt() {
        if (this._onNameKey) {
            window.removeEventListener("keydown", this._onNameKey, true);
            window.removeEventListener("keyup", this._onNameKey, true);
            this._onNameKey = null;
        }
        if (this._nameOverlay) {
            this._nameOverlay.remove();
            this._nameOverlay = null;
        }
        if (this._destroyOverlay) {
            this._destroyOverlay.remove();
            this._destroyOverlay = null;
        }
        this._pendingPlace = null;
        this._unlockWorldPointer();
        this.scene.input?.keyboard?.resetKeys?.();
    }

    _lockWorldPointer() {
        const scene = this.scene;
        if (this._worldPointerLocked) return;
        this._worldPointerLocked = true;
        this._inputWasEnabled = scene.input ? scene.input.enabled !== false : true;
        if (scene.input) scene.input.enabled = false;
        scene._hoverTarget = null;
        scene.hideWorldTooltip?.();
        scene.input?.setDefaultCursor?.("default");
        try {
            if (scene.game?.canvas) scene.game.canvas.style.cursor = "default";
        } catch (_) {}
    }

    _unlockWorldPointer() {
        if (!this._worldPointerLocked) return;
        this._worldPointerLocked = false;
        if (this.scene.input) this.scene.input.enabled = this._inputWasEnabled !== false;
        this._inputWasEnabled = true;
    }

    _domOverlayBtn(text, s, fontPx, stroke) {
        const BG = "#120e0a";
        const BG_PRESS = "#0a0806";
        const OUTLINE = "#2a2218";
        const OUTLINE_HOVER = "#ffffff";
        const OUTLINE_PRESS = "#d4a84b";
        const b = document.createElement("button");
        b.textContent = text;
        b.type = "button";
        b.tabIndex = -1;
        let hovering = false;
        let pressing = false;
        const paint = () => {
            const fill = pressing ? BG_PRESS : BG;
            const edge = pressing ? OUTLINE_PRESS : (hovering ? OUTLINE_HOVER : OUTLINE);
            b.style.background = fill;
            b.style.borderColor = edge;
        };
        b.style.cssText = [
            "background:" + BG,
            "color:#d4c4a8",
            `border:${stroke}px solid ${OUTLINE}`,
            `padding:${Math.round(4 * s)}px ${Math.round(10 * s)}px`,
            "cursor:pointer",
            "font-family:PrimaryFont,monospace",
            `font-size:${fontPx}px`,
            "outline:none",
            "appearance:none",
            "-webkit-appearance:none"
        ].join(";");
        b.addEventListener("mouseenter", () => { hovering = true; paint(); });
        b.addEventListener("mouseleave", () => { hovering = false; pressing = false; paint(); });
        b.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            pressing = true;
            paint();
        });
        b.onActivate = null;
        b.addEventListener("mouseup", (e) => {
            e.stopPropagation();
            const was = pressing;
            pressing = false;
            paint();
            if (was && hovering) b.onActivate?.();
        });
        return b;
    }

    promptDestroy(settle) {
        if (!settle || this._destroyOverlay || this._nameOverlay) return;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const names = this.settlersOf(settle.id).map((p) =>
            S?.pawnDisplayName?.(p) || p.displayName?.() || p.pawnName || "Someone"
        );
        this._showDestroyConfirm(settle, names);
    }

    _showDestroyConfirm(settle, peopleNames) {
        this._hideNamePrompt();
        const s = this.scene.uiScale || 1;
        const fontPx = typeof pixelUiFontSize === "function" ? pixelUiFontSize(16, s) : Math.round(16 * s);
        const smallPx = typeof pixelUiFontSize === "function" ? pixelUiFontSize(14, s) : Math.round(14 * s);
        const stroke = Math.max(2, Math.round(2 * s));
        const pad = Math.round(16 * s);
        const padX = Math.round(18 * s);
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const copy = S?.destroyConfirmCopy
            ? S.destroyConfirmCopy(settle.name, peopleNames)
            : {
                question: `Are you sure you'd like to destroy ${settle.name || "Camp"}?`,
                peopleLead: (peopleNames || []).length
                    ? "The following people will become wanderers:"
                    : "",
                names: peopleNames || []
            };
        const wrap = document.createElement("div");
        wrap.style.cssText = [
            "position:fixed", "inset:0", "z-index:10000",
            "display:flex", "align-items:center", "justify-content:center",
            "background:rgba(8,6,4,0.55)",
            "pointer-events:auto"
        ].join(";");
        const box = document.createElement("div");
        box.style.cssText = [
            "background:#120e0a",
            `border:${stroke}px solid #2a2218`,
            `padding:${pad}px ${padX}px`,
            `min-width:${Math.round(260 * s)}px`,
            `max-width:${Math.round(360 * s)}px`
        ].join(";");
        const question = document.createElement("div");
        question.textContent = copy.question;
        question.style.cssText = [
            "color:#d4c4a8",
            "font-family:PrimaryFont,monospace",
            `font-size:${fontPx}px`,
            "line-height:1.35"
        ].join(";");
        box.appendChild(question);
        if (copy.peopleLead) {
            const lead = document.createElement("div");
            lead.textContent = copy.peopleLead;
            lead.style.cssText = [
                "color:#d4c4a8",
                "font-family:PrimaryFont,monospace",
                `font-size:${smallPx}px`,
                `margin-top:${Math.round(12 * s)}px`,
                "line-height:1.35"
            ].join(";");
            box.appendChild(lead);
            const list = document.createElement("div");
            list.style.cssText = [
                `margin-top:${Math.round(6 * s)}px`,
                `max-height:${Math.round(140 * s)}px`,
                "overflow-y:auto"
            ].join(";");
            for (const n of copy.names) {
                const row = document.createElement("div");
                row.textContent = n;
                row.style.cssText = [
                    "color:#d4c4a8",
                    "font-family:PrimaryFont,monospace",
                    `font-size:${smallPx}px`,
                    `padding:${Math.round(1 * s)}px 0`
                ].join(";");
                list.appendChild(row);
            }
            box.appendChild(list);
        }
        const row = document.createElement("div");
        row.style.cssText = [
            "display:flex",
            "justify-content:space-between",
            "align-items:center",
            `margin-top:${Math.round(14 * s)}px`,
            "width:100%"
        ].join(";");
        const finish = (ok) => {
            if (!this._destroyOverlay) return;
            this._hideNamePrompt();
            if (ok) this.destroySettle(settle);
        };
        const cancelBtn = this._domOverlayBtn("Cancel", s, fontPx, stroke);
        cancelBtn.onActivate = () => finish(false);
        const destroyBtn = this._domOverlayBtn("Destroy", s, fontPx, stroke);
        destroyBtn.onActivate = () => finish(true);
        row.appendChild(cancelBtn);
        row.appendChild(destroyBtn);
        box.appendChild(row);
        wrap.appendChild(box);
        wrap.addEventListener("mousedown", (e) => e.stopPropagation());
        this._onNameKey = (e) => {
            const isEsc = e.key === "Escape" || e.code === "Escape" || e.key === "Esc";
            const isEnter = e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter";
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            if (e.type !== "keydown" || e.repeat) return;
            if (isEnter) finish(true);
            else if (isEsc) finish(false);
        };
        window.addEventListener("keydown", this._onNameKey, true);
        window.addEventListener("keyup", this._onNameKey, true);
        document.body.appendChild(wrap);
        this._destroyOverlay = wrap;
        this._lockWorldPointer();
        this.scene.input?.keyboard?.resetKeys?.();
        try { this.scene.game?.canvas?.blur?.(); } catch (_) {}
    }

    destroySettle(settle) {
        if (!settle) return false;
        if (this.sendNet("destroy", { settlementId: settle.id })) {
            // dedicated: wait for the server's global chat line
        }
        const scene = this.scene;
        const stone = this.findThingByUid(settle.stoneUid);
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const heading = S?.cardinalHeading?.() || { x: 1, y: 0 };
        const pack = this.settlersOf(settle.id);
        for (const p of pack) {
            scene.partySys?.releaseSettlerAsWanderer?.(p, heading);
        }
        scene.leanToPanel?.refresh?.();
        this.list = this.list.filter((s) => s.id !== settle.id);
        if (stone) {
            const chunk = scene.getChunkAtWorld(stone.x, stone.y - 1);
            const list = chunk?.meta?.things;
            if (list) {
                const i = list.indexOf(stone.entry);
                if (i >= 0) list.splice(i, 1);
            }
            stone.destroy();
        }
        scene.settlementPanel?.close?.();
        const dedicated = !!(scene.isNet && scene.net?.connected && !scene.net.isLocal);
        if (!dedicated) {
            scene.combatLog?.push(`${settle.name} has been destroyed!`, {
                color: (typeof CombatLog !== "undefined" && CombatLog.COLOR_SETTLER) || "#7ec8ff"
            });
        }
        return true;
    }

    dropOff(pawn, settle) {
        const scene = this.scene;
        const target = settle || this.here(scene.player);
        if (!target || !pawn) return false;
        if (pawn === scene.leader) {
            scene.combatLog?.push("The leader cannot stay behind");
            return false;
        }
        if (typeof Settlement !== "undefined" && !Settlement.canDropOff(pawn, scene.leader)) {
            scene.combatLog?.push("The leader cannot stay behind");
            return false;
        }
        if (!scene.party?.includes(pawn)) return false;
        if (!this._inRangePawn(pawn, target) && !this._inRangePawn(scene.player, target)) {
            scene.combatLog?.push("Not in settlement range");
            return false;
        }
        const wasControl = scene.player === pawn;
        if (this.sendNet("drop", { pawnId: pawn.pawnId, settlementId: target.id })) {
            /* dedicated */
        }
        pawn.partyAI?.stopWork?.();
        scene.party = scene.party.filter((p) => p !== pawn);
        pawn.role = "settler";
        pawn.homeSettlementId = target.id;
        pawn._netTx = pawn.x;
        pawn._netTy = pawn.y;
        pawn._netFromX = pawn.x;
        pawn._netFromY = pawn.y;
        if (!scene.settlers) scene.settlers = [];
        if (!scene.settlers.includes(pawn)) scene.settlers.push(pawn);
        if (!target.jobs) target.jobs = {};
        if (typeof Settlement !== "undefined") {
            target.jobs[pawn.pawnId] = Settlement.defaultJobs();
        }
        if (wasControl) scene.partySys?.switchControl?.(scene.leader);
        scene.net?._pullFromScene?.();
        scene.partyPanel?.refresh?.();
        scene.settlementPanel?.refresh?.();
        scene.combatLog?.push(`${pawn.displayName?.() || pawn.pawnName} was dropped off at ${target.name}`);
        return true;
    }

    pickUp(pawn, settle) {
        const scene = this.scene;
        const P = typeof Party !== "undefined" ? Party : { CAP: 6 };
        if (!pawn) return false;
        if ((scene.party?.length || 0) >= (P.CAP || 6)) {
            scene.combatLog?.push("Party is full");
            return false;
        }
        this.sendNet("pick", { pawnId: pawn.pawnId });
        scene.partySys?.adoptSettler?.(pawn);
        scene.partyPanel?.refresh?.();
        scene.settlementPanel?.refresh?.();
        scene.combatLog?.push(`${pawn.displayName?.() || pawn.pawnName} joins the traveling party`);
        return true;
    }

    pickOrphan(pawn) {
        if (!pawn || pawn.homeSettlementId) return false;
        return this.pickUp(pawn, null);
    }

    transfer(pawn, dest) {
        const scene = this.scene;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!pawn || !dest || pawn === scene.leader) return false;
        const from = this.byId(pawn.homeSettlementId);
        if (!from || from.id === dest.id) return false;
        const ts = scene.tileSize || 16;
        const walkMax = S?.WALK_TRANSFER_TILES || 96;
        const d = S ? S.distTiles(from.x, from.y, dest.x, dest.y, ts) : 999;
        pawn.homeSettlementId = dest.id;
        this.sendNet("transfer", { pawnId: pawn.pawnId, destId: dest.id });
        if (d > walkMax) {
            pawn.x = dest.x + 12;
            pawn.y = dest.y + 8;
            pawn.setVelocity?.(0, 0);
        }
        scene.settlementPanel?.refresh?.();
        scene.combatLog?.push(`${pawn.displayName?.() || pawn.pawnName} is bound for ${dest.name}`);
        return true;
    }

    _inRangePawn(pawn, settle) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!S || !pawn || !settle) return false;
        return S.inRange(settle, pawn.x, pawn.y, this.scene.tileSize || 16);
    }

    _stationLabel(thing, id) {
        const entryId = thing?.entry?.id || id;
        return thing?.meta?.name
            || this.scene.getThing?.(entryId)?.name
            || entryId
            || "station";
    }

    addStation(thing, settle) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const target = settle || this.here(this.scene.player);
        if (!target || !thing?.entry) return false;
        const id = thing.entry.id;
        if (S && !S.isAddableId(id)) return false;
        const uid = thing.entry.uid;
        if (!uid) return false;
        if (this.list.some((s) => s.id !== target.id && (s.stationUids || []).includes(uid))) {
            this.scene.combatLog?.push("Already added to another settlement");
            return false;
        }
        if (!target.stationUids) target.stationUids = [];
        if (!target.stationUids.includes(uid)) target.stationUids.push(uid);
        this.bumpWorkCache();
        this.sendNet("addStation", { uid, settlementId: target.id });
        this.scene.combatLog?.push(`Added ${this._stationLabel(thing)} to ${target.name}`);
        this.scene.settlementPanel?.refresh?.();
        return true;
    }

    removeStation(uid, settle, thing) {
        const target = settle || this.here(this.scene.player);
        if (!target || !uid) return false;
        target.stationUids = (target.stationUids || []).filter((u) => u !== uid);
        if (target.bills) delete target.bills[uid];
        this.bumpWorkCache();
        this.sendNet("removeStation", { uid, settlementId: target.id });
        this.scene.combatLog?.push(`Removed ${this._stationLabel(thing)} from ${target.name}`);
        this.scene.settlementPanel?.refresh?.();
        return true;
    }

    /** Pickup / destroy: drop the settlement link. Same-tile re-place reuses the uid. */
    unlinkStation(uid, opts = {}) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!S || !uid) return false;
        const hit = S.unlinkStation(this.list, uid);
        if (!hit.length) return false;
        this.bumpWorkCache();
        if (!opts.localOnly) {
            for (const s of hit) this.sendNet("removeStation", { uid, settlementId: s.id });
        }
        const bills = this.scene.billsPanel;
        if (bills?.visible && (bills.uid === uid || bills.thing?.entry?.uid === uid)) bills.close();
        const filt = this.scene.storageFilterPanel;
        if (filt?.visible && filt.thing?.entry?.uid === uid) filt.close();
        this.scene.settlementPanel?.refresh?.();
        return true;
    }

    isAdded(thing, settle) {
        const target = settle || this.here(this.scene.player);
        const uid = thing?.entry?.uid;
        if (!target || !uid) return false;
        return (target.stationUids || []).includes(uid);
    }

    openFromStone(stone) {
        const settle = this.byStoneUid(stone?.entry?.uid);
        if (!settle) return;
        if (settle.ownerId !== this.ownerId()) return;
        const panel = this.scene.settlementPanel;
        if (panel?.visible && panel.settle?.id === settle.id) {
            this.closePanel();
            return;
        }
        this.openPanel(settle);
    }

    openPanel(settle) {
        const scene = this.scene;
        if (scene.knappingPanel?.visible) return;
        if (this.isNaming?.()) return;
        // Side menus exclude each other; world UIs (campfire / basket / lean-to) stay open
        if (scene.craftMenuVisible) scene.closeCraftMenu();
        if (scene.equipmentPanel?.visible) scene.equipmentPanel.close();
        if (scene.healthPanel?.visible) scene.healthPanel.close();
        scene.settlementPanel?.open(settle);
        this._drawRange(settle, true);
        this._paintHud?.();
    }

    closePanel() {
        this.scene.settlementPanel?.close();
        this._drawRange(null, false);
        this._paintHud?.();
    }

    togglePanel() {
        const panel = this.scene.settlementPanel;
        if (panel?.visible) this.closePanel();
        else {
            const s = this.here(this.scene.player);
            if (s) this.openPanel(s);
        }
    }

    _drawRange(settle, on) {
        const scene = this.scene;
        if (!on || !settle) {
            this._rangeGfx?.setVisible(false);
            return;
        }
        const ts = scene.tileSize || 16;
        const r = (settle.radiusTiles || 32) * ts;
        const x = settle.x;
        const y = settle.y - 8;
        const key = `${settle.id}:${x}:${y}:${r}`;
        if (this._rangeGfx && this._rangeDrawn === key) {
            this._rangeGfx.setVisible(true);
            return;
        }
        if (!this._rangeGfx) this._rangeGfx = scene.add.graphics();
        if (this._rangeGfx.displayList !== scene.worldHudLayer
            && typeof scene._liftAboveVeil === "function") {
            scene._liftAboveVeil(this._rangeGfx, 40);
        } else if (this._rangeGfx.displayList !== scene.worldHudLayer) {
            this._rangeGfx.setDepth(40);
            scene.mainLayer?.add(this._rangeGfx);
            scene._uiCam?.ignore(this._rangeGfx);
        }
        this._rangeGfx.clear();
        this._strokeRing(this._rangeGfx, x, y, r, 6, 0x120e0a);
        this._strokeRing(this._rangeGfx, x, y, r, 4, 0xd4a84b);
        this._rangeGfx.setVisible(true);
        this._rangeDrawn = key;
    }

    _strokeRing(gfx, x, y, r, width, color) {
        const n = 48;
        gfx.lineStyle(width, color, 1);
        gfx.beginPath();
        for (let i = 0; i <= n; i++) {
            const a = (i / n) * Math.PI * 2;
            const px = x + Math.cos(a) * r;
            const py = y + Math.sin(a) * r;
            if (i === 0) gfx.moveTo(px, py);
            else gfx.lineTo(px, py);
        }
        gfx.strokePath();
    }

    ensureHud() {
        const scene = this.scene;
        if (this.hudBtn) return;
        const s = scene.uiScale || 1;
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;
        const bg = scene.add.rectangle(0, 0, 160 * s, 28 * s, BG, 1)
            .setStrokeStyle(Math.max(2, Math.round(2 * s)), OUTLINE)
            .setInteractive({ useHandCursor: true });
        const txt = scene.add.text(0, 0, "Camp", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(16, s)}px`,
            color: "#d4c4a8"
        }).setOrigin(0.5);
        this.hudBtn = scene.add.container(0, 0, [bg, txt]).setDepth(15020).setScrollFactor(0);
        this._hudBg = bg;
        this._hudTxt = txt;
        scene.uiLayer?.add(this.hudBtn);
        let hovering = false;
        let pressing = false;
        const strokeOf = () => (typeof pixelUiStroke === "function"
            ? pixelUiStroke(scene.uiScale || 1)
            : Math.max(2, Math.round(2 * (scene.uiScale || 1))));
        const paint = () => {
            const stroke = strokeOf();
            const open = !!scene.settlementPanel?.visible;
            if (pressing) {
                bg.setFillStyle(BG_PRESS, 1);
                bg.setStrokeStyle(stroke, OUTLINE_PRESS);
            } else if (open) {
                bg.setFillStyle(BG, 1);
                bg.setStrokeStyle(stroke, OUTLINE_PRESS);
            } else if (hovering) {
                bg.setFillStyle(BG, 1);
                bg.setStrokeStyle(stroke, OUTLINE_HOVER);
            } else {
                bg.setFillStyle(BG, 1);
                bg.setStrokeStyle(stroke, OUTLINE);
            }
        };
        this._paintHud = paint;
        bg.on("pointerover", () => {
            if (scene._gamePaused) return;
            hovering = true;
            paint();
        });
        bg.on("pointerout", () => { hovering = false; pressing = false; paint(); });
        bg.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (scene._gamePaused) return;
            if (pointer.rightButtonDown()) return;
            pressing = true;
            paint();
        });
        bg.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = pressing;
            pressing = false;
            paint();
            if (scene._gamePaused) return;
            if (was && hovering) this.togglePanel();
        });
        this.hudBtn.setVisible(false);
    }

    layoutHud() {
        this.ensureHud();
        const scene = this.scene;
        const s = scene.uiScale || 1;
        this._hudBg.setSize(160 * s, 28 * s);
        if (this._hudBg.input?.hitArea?.setSize) {
            this._hudBg.input.hitArea.setSize(this._hudBg.width, this._hudBg.height);
        }
        const pad = Math.round(8 * s);
        const clockH = Math.round(
            scene.clockText?.displayHeight
            || scene.clockText?.height
            || pixelUiFontSize(16, s)
        );
        const fpsH = pixelUiFontSize(16, s);
        const fpsBottom = pad + clockH + Math.round(2 * s) + fpsH;
        const hudH = this._hudBg.height || Math.round(28 * s);
        const y = fpsBottom + Math.round(6 * s) + hudH / 2;
        this.hudBtn.setPosition(Math.round(scene.scale.width / 2), Math.round(y));
        this._paintHud?.();
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(this._hudTxt, 16, s);
    }

    interestKeys(into) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!S) return into;
        const ts = this.scene.tileSize || 16;
        const cs = this.scene.chunkSize || 8;
        for (const settle of this.list) {
            if (!this.settlersOf(settle.id).length && !(settle.stationUids || []).length) continue;
            for (const k of S.chunkKeysFor(settle, ts, cs)) into.add(k);
        }
        for (const p of this.scene.settlers || []) {
            if (!p || p.homeSettlementId) continue;
            const cx = Math.floor((p.x || 0) / (cs * ts));
            const cy = Math.floor((p.y || 0) / (cs * ts));
            into.add(`${cx},${cy}`);
        }
        return into;
    }

    rename(settle, name) {
        if (!settle) return;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        settle.name = S ? S.clampName(name) : String(name || "Camp").slice(0, 24);
        this.sendNet("rename", { settlementId: settle.id, name: settle.name });
        this.scene.settlementPanel?.refresh?.();
    }

    canManage(settle) {
        if (!settle) return false;
        return settle.ownerId === this.ownerId();
    }

    canManageThing(thing) {
        const settle = this.here(this.scene.player);
        if (!this.canManage(settle) || !thing?.entry) return false;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (S && !S.isAddableId(thing.entry.id)) return false;
        return this._inRangePawn(this.scene.player, settle)
            && S.inRange(settle, thing.x, thing.y, this.scene.tileSize || 16);
    }

    toggleStation(thing) {
        if (!this.canManageThing(thing)) return false;
        if (this.isAdded(thing)) return this.removeStation(thing.entry.uid, null, thing);
        return this.addStation(thing);
    }

    addBill(settle, stationUid, bill) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!settle || !S) return;
        S.addBill(settle, stationUid, bill);
        this.sendNet("setBills", { settlementId: settle.id, stationUid, bills: S.billsOf(settle, stationUid) });
    }

    openBills(thing) {
        if (!thing?.entry?.uid) return false;
        const settle = this.here(this.scene.player);
        if (!this.canManage(settle) || !this.isAdded(thing)) return false;
        this.scene.billsPanel?.open(settle, thing);
        return true;
    }

    openStorageFilter(thing) {
        if (!thing?.entry?.uid) return false;
        const settle = this.here(this.scene.player);
        if (!this.canManage(settle) || !this.isAdded(thing)) return false;
        this.scene.storageFilterPanel?.open(settle, thing);
        return true;
    }

    hudContains(pointer) {
        if (!this.hudBtn?.visible || !pointer) return false;
        const b = this._hudBg?.getBounds?.();
        return !!(b && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y));
    }

    makeWorldButton(label, onClick) {
        const scene = this.scene;
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;
        const rect = scene.add.rectangle(0, 0, 90, 22, BG, 1)
            .setInteractive({ useHandCursor: true });
        const text = scene.add.text(0, 0, label, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "14px",
            color: "#d4c4a8"
        }).setOrigin(0.5);
        const btn = scene.add.container(0, 0, [rect, text]);
        const ui = { btn, rect, text, _hovering: false, _pressing: false };
        const strokeW = () => (typeof pixelUiWorldStroke === "function"
            ? pixelUiWorldStroke(scene)
            : 2 / (scene.worldZoom || 1));
        const paint = () => {
            const sw = strokeW();
            if (ui._pressing) {
                rect.setFillStyle(BG_PRESS, 1);
                rect.setStrokeStyle(sw, OUTLINE_PRESS);
            } else if (ui._hovering) {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(sw, OUTLINE_HOVER);
            } else {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(sw, OUTLINE);
            }
        };
        ui.paint = paint;
        ui.setLabel = (s) => text.setText(s);
        rect.on("pointerover", () => { ui._hovering = true; paint(); });
        rect.on("pointerout", () => { ui._hovering = false; ui._pressing = false; paint(); });
        rect.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (pointer.rightButtonDown()) return;
            ui._pressing = true;
            paint();
        });
        rect.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = ui._pressing && ui._hovering;
            ui._pressing = false;
            paint();
            if (was) onClick?.();
        });
        paint();
        return ui;
    }

    makeStationButton(onClick) {
        const scene = this.scene;
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;
        const BG_ON = 0x1e3d1a;
        const BG_ON_PRESS = 0x12240f;
        const OUTLINE_ON = 0x5cbf63;
        const OUTLINE_ON_HOVER = 0x9ae08f;
        const size = 28;
        const rect = scene.add.rectangle(0, 0, size, size, BG, 1)
            .setStrokeStyle(2, OUTLINE)
            .setInteractive({ useHandCursor: true });
        const tex = scene.textures.exists("settling_stone") ? "settling_stone" : "__MISSING";
        const icon = scene.add.image(0, 0, tex).setOrigin(0.5);
        const btn = scene.add.container(0, 0, [rect, icon]);
        const ui = {
            btn,
            rect,
            icon,
            _added: false,
            _hovering: false,
            _pressing: false,
            _screenUi: false,
            _side: size
        };
        const strokeW = () => (ui._screenUi
            ? (typeof pixelUiStroke === "function"
                ? pixelUiStroke(scene.uiScale || 1)
                : Math.max(2, Math.round(2 * (scene.uiScale || 1))))
            : (typeof pixelUiWorldStroke === "function"
                ? pixelUiWorldStroke(scene)
                : 2 / (scene.worldZoom || 1)));
        const paint = () => {
            const sw = strokeW();
            if (ui._added) {
                if (ui._pressing) {
                    rect.setFillStyle(BG_ON_PRESS, 1);
                    rect.setStrokeStyle(sw, OUTLINE_PRESS);
                } else if (ui._hovering) {
                    rect.setFillStyle(BG_ON, 1);
                    rect.setStrokeStyle(sw, OUTLINE_ON_HOVER);
                } else {
                    rect.setFillStyle(BG_ON, 1);
                    rect.setStrokeStyle(sw, OUTLINE_ON);
                }
            } else if (ui._pressing) {
                rect.setFillStyle(BG_PRESS, 1);
                rect.setStrokeStyle(sw, OUTLINE_PRESS);
            } else if (ui._hovering) {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(sw, OUTLINE_HOVER);
            } else {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(sw, OUTLINE);
            }
        };
        const layoutIcon = () => {
            const n = ui._side;
            const iw = icon.width || 16;
            const pad = Math.max(4, n * 0.22);
            icon.setScale(Math.max(0.01, (n - pad) / iw));
        };
        ui.paint = paint;
        ui.setScreenUi = (on) => {
            ui._screenUi = !!on;
            paint();
        };
        const tipText = () => ui._added ? "Remove from settlement" : "Add to settlement";
        ui.setAdded = (on) => {
            ui._added = !!on;
            paint();
            if (scene._tooltipTarget === rect) scene.refreshTooltip?.();
        };
        ui.setSize = (side) => {
            const n = Math.max(8, Number(side) || size);
            ui._side = n;
            rect.setSize(n, n);
            if (rect.input) {
                rect.setInteractive({ useHandCursor: true });
                if (rect.input.hitArea?.setTo) rect.input.hitArea.setTo(0, 0, n, n);
                else if (rect.input.hitArea?.setSize) rect.input.hitArea.setSize(n, n);
            }
            layoutIcon();
            paint();
        };
        rect.on("pointerover", (pointer) => {
            ui._hovering = true;
            paint();
            scene.showTooltip?.(tipText, pointer.x, pointer.y, rect);
        });
        rect.on("pointerout", () => {
            ui._hovering = false;
            ui._pressing = false;
            paint();
            if (scene._tooltipTarget === rect) scene.hideTooltip?.();
        });
        rect.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (pointer.rightButtonDown()) return;
            ui._pressing = true;
            paint();
        });
        rect.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = ui._pressing && ui._hovering;
            ui._pressing = false;
            paint();
            if (was) onClick?.();
        });
        layoutIcon();
        paint();
        return ui;
    }

    syncStationButton(ui, thing) {
        if (!ui?.btn) return;
        const ok = this.canManageThing(thing);
        ui.btn.setVisible(ok);
        if (!ok) {
            ui.rect?.disableInteractive?.();
            if (this.scene._tooltipTarget === ui.rect) this.scene.hideTooltip?.();
            return;
        }
        ui.setAdded?.(this.isAdded(thing));
        ui.paint?.();
    }

    /**
     * Center an action button, or [add][action] as a pair when the
     * settlement-stone add control is showing. Add sits to the left.
     */
    placeAddActionRow(ui, actionBtn, opts = {}) {
        const x = Number(opts.x) || 0;
        const y = Number(opts.y) || 0;
        const gap = Number(opts.gap) || 8;
        const addW = Number(opts.addW) || 28;
        const actionW = Number(opts.actionW) || 78;
        const addOn = opts.addOn != null ? !!opts.addOn : !!(ui?.btn?.visible);
        const actionOn = opts.actionOn != null ? !!opts.actionOn : !!actionBtn?.visible;
        if (addOn && actionOn && ui?.btn && actionBtn) {
            const total = addW + gap + actionW;
            ui.btn.setPosition(x - total / 2 + addW / 2, y);
            actionBtn.setPosition(x + total / 2 - actionW / 2, y);
            return;
        }
        if (addOn && ui?.btn) ui.btn.setPosition(x, y);
        if (actionOn && actionBtn) actionBtn.setPosition(x, y);
    }

    sendNet(op, extra = {}) {
        const scene = this.scene;
        if (scene.isNet && scene.net?.connected && !scene.net.isLocal) {
            scene.net.sendAction({
                type: NetProtocol.Actions.SETTLEMENT,
                op,
                ...extra
            });
            return true;
        }
        return false;
    }

    tryRecruitInto(wanderer) {
        const settle = this.here(this.scene.player);
        if (!settle) return false;
        const scene = this.scene;
        const P = typeof Party !== "undefined" ? Party : { CAP: 6 };
        if ((scene.party?.length || 0) < (P.CAP || 6)) return false;
        const sys = scene.partySys;
        const held = scene.player?.getHeldItem?.();
        const meta = held ? scene.getItem(held.id) : null;
        const food = held?.food || meta?.food;
        const holdingFood = !!(food && Number(food.kc ?? 0) > 0);
        const chance = P.recruitChance ? P.recruitChance(holdingFood) : 0.5;
        if (holdingFood) sys._consumeRecruitFood?.(scene.player);
        if (Math.random() >= chance) {
            scene.combatLog?.push(`${wanderer.displayName()} is not interested`);
            return true;
        }
        sys.acceptRecruit?.(wanderer);
        const pawn = (scene.party || []).find((p) => p.pawnId === wanderer.pawnId) || wanderer;
        this.dropOff(pawn, settle);
        return true;
    }

    update() {
        this.ensureHud();
        const settle = this.here(this.scene.player);
        const show = !!settle;
        const hudWas = !!this.hudBtn?.visible;
        this.hudBtn?.setVisible(show);
        if (show !== hudWas) this.scene._layoutFpsMeter?.();
        if (this._hudTxt && settle) {
            const n = settle.name || "Camp";
            const label = n.length > 18 ? `${n.slice(0, 17)}…` : n;
            if (this._hudTxt.text !== label) this._hudTxt.setText(label);
        }
        const panel = this.scene.settlementPanel;
        if (panel?.visible) {
            const open = panel.settle;
            if (!open || !this.byId(open.id) || !this._inRangePawn(this.scene.player, open)) {
                this.closePanel();
            } else {
                this._drawRange(open, true);
                this._stockUiAcc = (this._stockUiAcc || 0) + (this.scene.game?.loop?.delta || 16);
                if (panel.tab === "stock" && this._stockUiAcc > 600) {
                    this._stockUiAcc = 0;
                    panel.refreshStockLive();
                }
            }
        }
        const bills = this.scene.billsPanel;
        if (bills?.visible) {
            const open = bills.settle;
            const thing = bills.thing;
            if (!open || !this.byId(open.id) || !this._inRangePawn(this.scene.player, open)
                || !this.isAdded(thing, open)) {
                bills.close();
            }
        }
        const storageF = this.scene.storageFilterPanel;
        if (storageF?.visible) {
            const open = storageF.settle;
            const thing = storageF.thing;
            if (!open || !this.byId(open.id) || !this._inRangePawn(this.scene.player, open)
                || !this.isAdded(thing, open)) {
                storageF.close();
            }
        }
        // Settlers are ticked from PartySystem.update so they share eat/tend/AI.
    }
}
