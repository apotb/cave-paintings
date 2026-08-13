/**
 * Bottom-left fading combat / chat log, plus T-to-type chat input.
 * Chat stack is always up to 10 visual lines above a permanently reserved compose row.
 * While composing, wheel scrollback is capped at 100 visual lines.
 *
 * Colored hit lines are drawn to a single CanvasTexture (not per-segment Phaser.Text).
 * Creating stroked Text objects per color piece was causing multi-frame hitches on every hit.
 */
class CombatLog {
    static COLOR_DEFAULT = "#e8e0d0";
    static COLOR_YOU = "#6ecf6e";
    static COLOR_ENEMY = "#ef5a5a";
    static COLOR_WEAPON = "#f0a040";
    static COLOR_CHAT = "#f0d84a";
    static COLOR_ERROR = "#ef5a5a";
    static STROKE = 3;
    static TEX_KEY = "__combat_log";

    constructor(scene) {
        this.scene = scene;
        this.lines = [];
        /** When false, hit/destroy lines from BodyCombat are skipped (chat/commands still log). */
        this.combatMessages = true;
        /** Max stored visual lines (wrapped); older messages are dropped. */
        this.maxScrollbackLines = 100;
        /** Max on-screen rows; a word-wrapped message counts as multiple. */
        this.visibleLineCap = 10;
        this.fadeMs = 10000;
        this.composing = false;
        this.draft = "";
        this.maxDraftLen = 120;
        this.playerName = "Player";
        /** Visual lines scrolled up from the newest (compose mode only). */
        this.scrollOffset = 0;
        /** Previously sent chat messages (oldest → newest). */
        this.sentHistory = [];
        this.maxSentHistory = 50;
        /** Index into sentHistory while browsing; `sentHistory.length` = live draft. */
        this.historyPos = 0;
        /** Draft stashed when first pressing Up from a fresh line. */
        this._draftStash = "";
        this._layoutDirty = true;
        this._measureKey = "";
        this._lastBlink = 0;
        this._lastFadeLayout = 0;
        this._boundKey = (e) => this._handleGlobalKey(e);
        this._boundWheel = (e) => this._handleWheel(e);

        this._canvas = null;
        this._ctx = null;
        this._logTexture = null;
        this._logImage = null;
        this._canvasW = 0;
        this._canvasH = 0;
        this._spaceWidthCache = 0;
        this._spaceFontSize = 0;

        this.container = scene.add.container(12, scene.scale.height - 20);
        this.container.setScrollFactor(0).setDepth(10000);
        scene.uiLayer?.add(this.container);

        // Always-on capture listener — do NOT toggle Phaser keyboard.enabled (misses keyups
        // while disabled, which breaks JustDown(T) / stuck keys after chat).
        window.addEventListener("keydown", this._boundKey, true);
        scene.events.once("shutdown", () => this.destroy());
        scene.events.once("destroy", () => this.destroy());

        this._ensureCtx();
        this._logImage = scene.add.image(0, 0, CombatLog.TEX_KEY)
            .setOrigin(0, 1)
            .setVisible(false);
        this.container.add(this._logImage);
        // Compose row is painted on the same canvas as the log (same font/align/spacing).
    }

    isComposing() {
        return this.composing;
    }

    /** Max text width so chat stays left of the hotbar. */
    _maxTextWidth() {
        const s = this.scene.uiScale || 1;
        const left = 12;
        const gap = Math.round(12 * s);
        let hotbarLeft = this.scene.scale.width * 0.45;
        const slot0 = this.scene.hotbar?.slots?.[0];
        if (slot0) hotbarLeft = slot0.x;
        return Math.max(Math.round(80 * s), Math.floor(hotbarLeft - left - gap));
    }

    destroy() {
        window.removeEventListener("keydown", this._boundKey, true);
        window.removeEventListener("wheel", this._boundWheel, true);
        this.composing = false;
        if (this.scene?.textures?.exists(CombatLog.TEX_KEY)) {
            this.scene.textures.remove(CombatLog.TEX_KEY);
        }
        this._logTexture = null;
        this._canvas = null;
        this._ctx = null;
    }

    openChat(initialDraft = "") {
        if (this.composing) return;
        if (this.scene.knappingPanel?.visible) return;
        this.composing = true;
        this.draft = String(initialDraft || "");
        this._draftStash = "";
        this.historyPos = this.sentHistory.length;
        this.scrollOffset = 0;
        // Clear Phaser key state (especially the T that opened chat)
        this.scene.input?.keyboard?.resetKeys?.();
        window.addEventListener("wheel", this._boundWheel, { passive: false, capture: true });
        this._layoutDirty = true;
        this._layout();
        this._layoutDirty = false;
    }

    closeChat(send = false) {
        if (!this.composing) return;
        const msg = this.draft.trim();
        this.composing = false;
        this.draft = "";
        this._draftStash = "";
        this.historyPos = this.sentHistory.length;
        this.scrollOffset = 0;
        window.removeEventListener("wheel", this._boundWheel, true);
        this.scene.input?.keyboard?.resetKeys?.();
        if (send && msg) {
            // Both chat and slash commands go into ↑/↓ recall
            this._rememberSent(msg);
            if (msg.startsWith("/")) {
                this._handleCommand(msg);
            } else {
                const name = this.scene.playerName || this.playerName || "Player";
                if (this.scene.isNet && this.scene.net?.connected) {
                    this.scene.net.sendAction({ type: NetProtocol.Actions.CHAT, text: msg });
                } else {
                    this.push(`${name}: ${msg}`, { color: CombatLog.COLOR_CHAT });
                }
                this.scene.player?.showChatBubble?.(msg, this.fadeMs);
            }
        } else {
            this._layoutDirty = true;
            this._layout();
            this._layoutDirty = false;
        }
    }

    /** Slash commands (no speech bubble). */
    _handleCommand(raw) {
        const parts = String(raw).trim().split(/\s+/);
        const cmd = (parts[0] || "").toLowerCase();
        const helpSyntax = {
            debug: "/debug blood|chunks|combat_log|fps|location|melee_slots [show|hide]",
            give: "/give <item> [qty]",
            heal: "/heal",
            help: "/help [command]",
            kms: "/kms",
            regen: "/regen",
            seed: "/seed",
            spawn: "/spawn <mob>",
            tick: "/tick [speed]",
            time: "/time [HH] [MM]",
            tp: "/tp <x> <y>"
        };
        if (cmd === "/help") {
            const topic = (parts[1] || "").toLowerCase().replace(/^\//, "");
            if (topic) {
                const syntax = helpSyntax[topic];
                if (!syntax) {
                    this.pushError(`Unknown command: ${parts[1]} (try /help)`);
                    return;
                }
                this.push(syntax);
                return;
            }
            this.push("Commands:");
            for (const syntax of Object.values(helpSyntax)) {
                this.push(`  ${syntax}`);
            }
            return;
        }
        if (cmd === "/seed") {
            this.push(`World seed: ${worldSeed}`);
            return;
        }
        if (cmd === "/heal") {
            const player = this.scene.player;
            if (!player) {
                this.push("No player to heal.");
                return;
            }
            // Net sessions: server/sim owns hunger — local heal alone is stomped by YOU.
            if (this.scene.isNet && this.scene.net?.connected) {
                this.scene.net.sendAction({
                    type: NetProtocol.Actions.CHAT,
                    text: "/heal"
                });
            }
            player.anatomy?.fullHeal?.();
            player.kc = player.stomach;
            player._malnutritionFed = true;
            player._bodyDead = false;
            player._downed = false;
            player._tendChannel = null;
            player._skinChannel = null;
            player._eatChannel = null;
            player._vomit = null;
            player.capacities = new Capacities(player.anatomy);
            setCreatureProne(player, false);
            player.setVisible(true);
            if (player.body) player.body.enable = true;
            this.scene.deathOverlay?.setVisible(false);
            this.scene.hideChannelBar?.();
            this.scene.healthPanel?.refresh?.();
            this.push("Fully healed.");
            return;
        }
        if (cmd === "/kms") {
            const player = this.scene.player;
            if (!player || player._bodyDead) {
                this.push("You are already dead.");
                return;
            }
            const brain = player.anatomy?.part?.("Brain");
            if (!brain) {
                this.pushError("No brain to destroy.");
                return;
            }
            if (brain.isDead()) {
                this.push("Your brain is already destroyed.");
                return;
            }
            const defs = this.scene.cache?.json?.get?.("injuries") || {};
            const idef = defs.brain_cut || defs.cut || {};
            const dmg = Math.max(0.1, brain.hp(), brain.mhp);
            brain.injure({
                id: idef.id || "brain_cut",
                name: idef.name || "Cut",
                severity: dmg,
                permanent: false,
                bleeding: (Number(idef.bleedRate) || 0) > 0,
                bleedRate: Number(idef.bleedRate) || 0,
                painPerSeverity: Number(idef.painPerSeverity) || 0.04,
                tended: false,
                tendQuality: 0,
                scarPending: false,
                scarSeverity: 0,
                sourceLabel: "magic"
            });
            player.onBodyDamaged?.(null, { damage: dmg, part: brain });
            return;
        }
        if (cmd === "/regen") {
            if (this.scene.isNet && this.scene.net?.connected) {
                // Shared world / LocalSim: server (or sim) regenerates for the session
                this.scene.net.sendAction({
                    type: NetProtocol.Actions.CHAT,
                    text: "/regen"
                });
                this.push("World regenerated.");
                return;
            }
            const n = this.scene.regenChunks?.() ?? 0;
            this.push(`Regenerated world (${n} chunk${n === 1 ? "" : "s"} cleared)`);
            return;
        }
        if (cmd === "/spawn") {
            const id = (parts[1] || "").toLowerCase();
            if (!id) {
                this.pushError("Usage: /spawn <mob>");
                return;
            }
            const def = this.scene.getMob?.(id);
            if (!def) {
                this.pushError(`Unknown mob "${id}".`);
                return;
            }
            const player = this.scene.player;
            if (!player) {
                this.push("No player to spawn at.");
                return;
            }
            // Dedicated MP: server owns wildlife (SNAPSHOT.mobs). Local spawn would freeze.
            if (this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal) {
                this.scene._netSendMove?.(true);
                this.scene.net.sendAction({
                    type: NetProtocol.Actions.CHAT,
                    text: `/spawn ${id}`
                });
                return;
            }
            // Player origin is bottom-left; spawn so feet line up
            const mob = LivingMob.spawn(this.scene, id, player.x, player.y);
            if (!mob) {
                this.pushError(`Failed to spawn ${def.name || id} (chunk not ready?).`);
                return;
            }
            this.push(`Spawned ${def.name || id}`);
            return;
        }
        if (cmd === "/give") {
            const usage = "Usage: /give <item> [qty]";
            const idArg = (parts[1] || "").toLowerCase();
            if (!idArg) {
                this.pushError(usage);
                return;
            }
            let qty = 1;
            if (parts[2] != null && parts[2] !== "") {
                qty = Number(parts[2]);
                if (!Number.isFinite(qty) || qty < 1 || !Number.isInteger(qty)) {
                    this.pushError(usage);
                    return;
                }
                qty = Math.min(9999, qty);
            }
            const items = (this.scene.items?.() || []).filter(Boolean);
            const needle = idArg.replace(/-/g, "_");
            let meta = this.scene.getItem?.(needle)
                || items.find(i => (i.id || "").toLowerCase() === needle)
                || items.find(i => (i.name || "").toLowerCase().replace(/\s+/g, "_") === needle)
                || items.find(i => (i.name || "").toLowerCase() === idArg.replace(/_/g, " "));
            if (!meta?.id) {
                this.pushError(`Unknown item "${parts[1]}".`);
                return;
            }
            const player = this.scene.player;
            if (!player) {
                this.push("No player to give to.");
                return;
            }
            // Dedicated MP: server owns inventory (YOU). Local give alone is stomped.
            if (this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal) {
                this.scene._netSendMove?.(true);
                this.scene.net.sendAction({
                    type: NetProtocol.Actions.CHAT,
                    text: `/give ${meta.id} ${qty}`
                });
                return;
            }
            const remaining = player.gainItem(meta, qty);
            if (remaining > 0) {
                DroppedItem.spawn(this.scene, player.x, player.y, meta, remaining);
            }
            const label = meta.name || meta.id;
            if (remaining > 0) {
                this.push(`Gave ${qty}× ${label} (${remaining} dropped on ground)`);
            } else {
                this.push(`Gave ${qty}× ${label}`);
            }
            return;
        }
        if (cmd === "/debug") {
            const usage = "Usage: /debug blood|chunks|combat_log|fps|location|melee_slots [show|hide]";
            const topic = (parts[1] || "").toLowerCase();
            const action = (parts[2] || "").toLowerCase();
            if (topic === "melee_slots" || topic === "melee-slots") {
                if (action && action !== "show" && action !== "hide") {
                    this.pushError(usage);
                    return;
                }
                const on = action === "show"
                    ? true
                    : action === "hide"
                        ? false
                        : !this.scene.meleeSlots?.debug;
                this.scene.meleeSlots?.setDebug?.(on);
                this.push(on ? "Debug: melee_slots shown" : "Debug: melee_slots hidden");
                return;
            }
            if (topic === "fps") {
                if (action && action !== "show" && action !== "hide") {
                    this.pushError(usage);
                    return;
                }
                const on = action === "show"
                    ? true
                    : action === "hide"
                        ? false
                        : !this.scene._fpsVisible;
                // Chat line first — setFpsMeter(true) runs applyUiScale / layout
                this.push(on ? "Debug: fps shown" : "Debug: fps hidden");
                this.scene.setFpsMeter?.(on);
                return;
            }
            if (topic === "location" || topic === "loc" || topic === "pos") {
                if (action && action !== "show" && action !== "hide") {
                    this.pushError(usage);
                    return;
                }
                const on = action === "show"
                    ? true
                    : action === "hide"
                        ? false
                        : !this.scene._locationDebugVisible;
                this.push(on ? "Debug: location shown" : "Debug: location hidden");
                this.scene.setLocationDebug?.(on);
                return;
            }
            if (topic === "blood") {
                if (action && action !== "show" && action !== "hide") {
                    this.pushError(usage);
                    return;
                }
                const on = action === "show"
                    ? true
                    : action === "hide"
                        ? false
                        : this.scene.bloodDraw === false;
                this.push(on ? "Debug: blood shown" : "Debug: blood hidden");
                this.scene.setBloodDraw?.(on);
                return;
            }
            if (topic === "chunks") {
                if (action && action !== "show" && action !== "hide") {
                    this.pushError(usage);
                    return;
                }
                const on = action === "show"
                    ? true
                    : action === "hide"
                        ? false
                        : !this.scene.chunkDebug;
                this.push(on ? "Debug: chunks shown" : "Debug: chunks hidden");
                this.scene.setChunkDebug?.(on);
                return;
            }
            if (topic === "combat_log" || topic === "combat-log" || topic === "combatlog") {
                if (action && action !== "show" && action !== "hide") {
                    this.pushError(usage);
                    return;
                }
                const on = action === "show"
                    ? true
                    : action === "hide"
                        ? false
                        : !this.combatMessages;
                this.combatMessages = on;
                this.push(on ? "Debug: combat_log shown" : "Debug: combat_log hidden");
                return;
            }
            this.pushError(usage);
            return;
        }
        if (cmd === "/tick") {
            const arg = parts[1];
            if (this.scene.isNet && this.scene.net?.connected) {
                if (arg != null && arg !== "") {
                    const m = Number(arg);
                    if (!Number.isFinite(m) || m < 0) {
                        this.pushError("Usage: /tick [speed]  (1 = normal, 60 ≈ 1 game hour/sec, 0 = pause)");
                        return;
                    }
                }
                this.scene.net.sendAction({
                    type: NetProtocol.Actions.CHAT,
                    text: raw
                });
                return;
            }
            const report = (speed) => {
                const s = Number(speed);
                if (!Number.isFinite(s) || s <= 0) {
                    this.push("Tick speed: paused (0)");
                } else {
                    const delay = Math.max(1, 1000 / s);
                    this.push(`Tick speed: ${s}× (${delay.toFixed(0)} ms / game minute)`);
                }
            };
            if (arg == null || arg === "") {
                report(this.scene.tickSpeed);
                return;
            }
            const m = Number(arg);
            if (!Number.isFinite(m) || m < 0) {
                this.pushError("Usage: /tick [speed]  (1 = normal, 60 ≈ 1 game hour/sec, 0 = pause)");
                return;
            }
            report(this.scene.setTickSpeed?.(m));
            return;
        }
        if (cmd === "/time") {
            if (this.scene.isNet && this.scene.net?.connected) {
                if (parts.length >= 2) {
                    const h = Number(parts[1]);
                    const m = parts[2] != null ? Number(parts[2]) : 0;
                    if (!Number.isFinite(h) || h < 0 || h > 23 || !Number.isFinite(m) || m < 0 || m > 59) {
                        this.pushError("Usage: /time [HH] [MM]");
                        return;
                    }
                }
                this.scene.net.sendAction({
                    type: NetProtocol.Actions.CHAT,
                    text: raw
                });
                return;
            }
            if (parts.length < 2) {
                const h = Math.floor((this.scene.gameMinutes || 0) / 60);
                const m = (this.scene.gameMinutes || 0) % 60;
                this.push(
                    `Day ${this.scene.gameDay}  ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} (${this.scene.tickSpeed ?? 1}×)`
                );
                return;
            }
            const h = Number(parts[1]);
            const m = parts[2] != null ? Number(parts[2]) : 0;
            if (!Number.isFinite(h) || h < 0 || h > 23 || !Number.isFinite(m) || m < 0 || m > 59) {
                this.pushError("Usage: /time [HH] [MM]");
                return;
            }
            if (typeof setHour === "function") {
                this.push(setHour(h, m));
            } else {
                this.scene.gameMinutes = Math.floor(h) * 60 + Math.floor(m);
                this.scene._lightSig = null;
                this.scene.updateClockText?.();
                this.scene.updateTimeTint?.();
                this.push(
                    `Set time to ${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor(m)).padStart(2, "0")}`
                );
            }
            return;
        }
        if (cmd === "/tp" || cmd === "/teleport") {
            const usage = "Usage: /tp <x> <y>  (tile coords, same as /debug location)";
            if (parts.length < 3) {
                this.pushError(usage);
                return;
            }
            const tx = Number(parts[1]);
            const ty = Number(parts[2]);
            if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
                this.pushError(usage);
                return;
            }
            const player = this.scene.player;
            if (!player) {
                this.push("No player to teleport.");
                return;
            }
            const ts = this.scene.tileSize || 16;
            const w = player.displayWidth || player.width || ts;
            // Place sprite so bottom-middle (not bottom-left) lands on (tx, ty)
            const px = tx * ts - w * 0.5;
            const py = ty * ts;
            // Dedicated MP: server owns pose — YOU applies via _netAwaitPoseFromYou.
            if (this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal) {
                this.scene._netAwaitPoseFromYou = true;
                this.scene.net.sendAction({
                    type: NetProtocol.Actions.CHAT,
                    text: `/tp ${tx} ${ty}`
                });
                return;
            }
            player.teleport(px, py);
            this.scene.syncCameraToPlayer?.();
            if (this.scene.isNet && this.scene.net?.connected) {
                // LocalSim: push pose so interest/chunks follow
                if (this.scene.net._pawn) {
                    this.scene.net._pawn.x = px;
                    this.scene.net._pawn.y = py;
                }
                this.scene._netSendMove?.(true);
            }
            this.push(`Teleported to ${tx}, ${ty}`);
            return;
        }
        this.pushError(`Unknown command: ${parts[0]} (try /help)`);
    }

    _rememberSent(msg) {
        const last = this.sentHistory[this.sentHistory.length - 1];
        if (msg === last) return;
        this.sentHistory.push(msg);
        while (this.sentHistory.length > this.maxSentHistory) this.sentHistory.shift();
    }

    _historyUp() {
        if (!this.sentHistory.length) return;
        if (this.historyPos <= 0) return;
        if (this.historyPos >= this.sentHistory.length) {
            this._draftStash = this.draft;
            this.historyPos = this.sentHistory.length;
        }
        this.historyPos -= 1;
        this.draft = this.sentHistory[this.historyPos] ?? "";
        this._layoutDirty = true;
        this._layout();
        this._layoutDirty = false;
    }

    _historyDown() {
        if (this.historyPos >= this.sentHistory.length) return;
        this.historyPos += 1;
        if (this.historyPos >= this.sentHistory.length) {
            this.draft = this._draftStash;
            this.historyPos = this.sentHistory.length;
        } else {
            this.draft = this.sentHistory[this.historyPos] ?? "";
        }
        this._layoutDirty = true;
        this._layout();
        this._layoutDirty = false;
    }

    /** Typing/backspace leaves history browse and edits a live draft. */
    _breakHistoryBrowse() {
        if (this.historyPos !== this.sentHistory.length) {
            this.historyPos = this.sentHistory.length;
            this._draftStash = "";
        }
    }

    _isTextTarget(event) {
        const t = event.target;
        if (!t || !t.tagName) return false;
        const tag = String(t.tagName).toUpperCase();
        return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable;
    }

    _handleGlobalKey(event) {
        if (this._isTextTarget(event)) return;

        if (!this.composing) {
            // T opens chat; / opens with a slash already typed (ignore key-repeat)
            if (
                !event.repeat &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                !this.scene?._gamePaused
            ) {
                if (event.key === "t" || event.key === "T") {
                    event.preventDefault();
                    event.stopPropagation();
                    this.openChat();
                    return;
                }
                if (event.key === "/" || event.code === "Slash") {
                    event.preventDefault();
                    event.stopPropagation();
                    this.openChat("/");
                    return;
                }
            }
            return;
        }

        // Prefer event.code so Enter/Esc stay reliable across layouts
        const code = event.code;
        const key = event.key;

        if (code === "Enter" || code === "NumpadEnter" || key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            this.closeChat(true);
            return;
        }
        if (code === "Escape" || key === "Escape" || key === "Esc") {
            event.preventDefault();
            event.stopPropagation();
            this.closeChat(false);
            return;
        }
        if (
            code === "ArrowUp" ||
            key === "ArrowUp" ||
            event.keyCode === 38
        ) {
            event.preventDefault();
            event.stopImmediatePropagation();
            this._historyUp();
            return;
        }
        if (
            code === "ArrowDown" ||
            key === "ArrowDown" ||
            event.keyCode === 40
        ) {
            event.preventDefault();
            event.stopImmediatePropagation();
            this._historyDown();
            return;
        }
        if (code === "Backspace" || key === "Backspace") {
            event.preventDefault();
            event.stopPropagation();
            this._breakHistoryBrowse();
            this.draft = this.draft.slice(0, -1);
            this._layoutDirty = true;
            return;
        }

        // Printable character (no modifiers)
        if (
            key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
        ) {
            event.preventDefault();
            event.stopPropagation();
            if (this.draft.length < this.maxDraftLen) {
                this._breakHistoryBrowse();
                this.draft += key;
                this._layoutDirty = true;
            }
        }
    }

    _handleWheel(event) {
        if (!this.composing) return;
        event.preventDefault();
        event.stopPropagation();
        const dir = event.deltaY < 0 ? 1 : event.deltaY > 0 ? -1 : 0;
        if (!dir) return;
        // One notch ≈ one visual line; trackpads may send larger deltas
        const steps = Math.max(1, Math.round(Math.abs(event.deltaY) / 100));
        this.scrollOffset += dir * steps;
        this._layoutDirty = true;
        this._layout();
        this._layoutDirty = false;
    }

    /** Compose row pieces (same wrap/font path as log lines). */
    _composeRows(wrapW, fontSize) {
        const blink = Math.floor((this.scene.time?.now || 0) / 500) % 2 === 0 ? "_" : " ";
        return this._wrapSegments(
            [{ text: `${this.draft}${blink}`, color: "#ffffff" }],
            wrapW,
            fontSize
        );
    }

    push(msg, opts = null) {
        // Hit lines only — chat, commands, death/respawn, tending still go through
        if (opts?.combat && !this.combatMessages) return;
        if (!msg && !(opts?.segments?.length)) return;
        const segments = opts?.segments || null;
        const text = segments
            ? segments.map(s => String(s.text ?? "").trim()).filter(Boolean).join(" ")
            : String(msg);
        if (!text) return;
        this.lines.push({
            text,
            color: opts?.color || null,
            segments: segments
                ? segments
                    .map(s => ({
                        text: String(s.text ?? "").trim(),
                        color: s.color || null
                    }))
                    .filter(s => s.text)
                : null,
            t: this.scene.time.now,
            visualLines: 0,
            _wrapKey: "",
            _rows: null
        });
        this._layoutDirty = true;
    }

    /** Command usage / unknown-command style errors. */
    pushError(msg) {
        this.push(msg, { color: CombatLog.COLOR_ERROR });
    }

    _ensureCtx() {
        if (this._logTexture && this._ctx) return this._ctx;
        this._canvas = document.createElement("canvas");
        this._canvas.width = 4;
        this._canvas.height = 4;
        if (this.scene.textures.exists(CombatLog.TEX_KEY)) {
            this.scene.textures.remove(CombatLog.TEX_KEY);
        }
        this._logTexture = this.scene.textures.addCanvas(CombatLog.TEX_KEY, this._canvas);
        // Prefer Phaser's context (same canvas); keeps GL uploads in sync
        this._ctx = this._logTexture.context || this._canvas.getContext("2d");
        this._canvasW = 4;
        this._canvasH = 4;
        if (this._logImage) this._logImage.setTexture(CombatLog.TEX_KEY);
        return this._ctx;
    }

    _setFont(fontSize) {
        const ctx = this._ensureCtx();
        ctx.font = `${fontSize}px monospace`;
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "left";
    }

    _measureChunk(str, fontSize) {
        if (!str) return 0;
        this._setFont(fontSize);
        return this._ctx.measureText(str).width;
    }

    _spaceWidth(fontSize) {
        if (this._spaceFontSize === fontSize && this._spaceWidthCache > 0) {
            return this._spaceWidthCache;
        }
        this._setFont(fontSize);
        const w = this._ctx.measureText(" ").width;
        this._spaceFontSize = fontSize;
        this._spaceWidthCache = Math.max(1, w || this._ctx.measureText("x").width * 0.5);
        return this._spaceWidthCache;
    }

    /**
     * Pack segments into wrapped rows. Pieces in a row are drawn with one space between them.
     * @returns {{text: string, color: string}[][]}
     */
    _wrapSegments(segments, wrapW, fontSize) {
        const rows = [];
        let cur = [];
        let x = 0;
        const spaceW = this._spaceWidth(fontSize);
        const flush = () => {
            if (cur.length) rows.push(cur);
            cur = [];
            x = 0;
        };

        const pushWord = (raw, color) => {
            let text = String(raw ?? "");
            if (!text) return;
            let w = this._measureChunk(text, fontSize);
            if (x > 0 && x + w > wrapW) flush();
            while (text.length > 1 && (w = this._measureChunk(text, fontSize)) > wrapW) {
                let lo = 1;
                let hi = text.length;
                while (lo < hi) {
                    const mid = Math.ceil((lo + hi) / 2);
                    const tw = this._measureChunk(text.slice(0, mid), fontSize);
                    if (tw <= wrapW) lo = mid;
                    else hi = mid - 1;
                }
                const take = Math.max(1, lo);
                cur.push({ text: text.slice(0, take), color });
                flush();
                text = text.slice(take);
            }
            if (!text) return;
            w = this._measureChunk(text, fontSize);
            cur.push({ text, color });
            x += w;
        };

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const color = seg.color || CombatLog.COLOR_DEFAULT;
            const raw = String(seg.text ?? "").trim();
            if (!raw) continue;

            if (cur.length > 0 || x > 0) {
                const nextWord = raw.split(/\s+/)[0] || raw;
                if (x + spaceW + this._measureChunk(nextWord, fontSize) > wrapW) {
                    flush();
                } else {
                    x += spaceW;
                }
            }

            const fullW = this._measureChunk(raw, fontSize);
            if (x + fullW <= wrapW || !/\s/.test(raw)) {
                pushWord(raw, color);
                continue;
            }
            const words = raw.split(/\s+/).filter(Boolean);
            for (let w = 0; w < words.length; w++) {
                if (w > 0) {
                    if (x + spaceW + this._measureChunk(words[w], fontSize) > wrapW) flush();
                    else x += spaceW;
                } else if (cur.length > 0 && x + this._measureChunk(words[w], fontSize) > wrapW) {
                    flush();
                }
                pushWord(words[w], color);
            }
        }
        flush();
        return rows.length ? rows : [[{ text: " ", color: CombatLog.COLOR_DEFAULT }]];
    }

    _rowsForLine(line, wrapW, fontSize) {
        const key = `${wrapW}|${fontSize}`;
        if (line._wrapKey === key && line._rows) return line._rows;
        let rows;
        if (line.segments?.length) {
            rows = this._wrapSegments(line.segments, wrapW, fontSize);
        } else {
            rows = this._wrapSegments(
                [{ text: line.text, color: line.color || CombatLog.COLOR_DEFAULT }],
                wrapW,
                fontSize
            );
        }
        line._wrapKey = key;
        line._rows = rows;
        line.visualLines = rows.length;
        return rows;
    }

    /**
     * Cache wrap heights and drop oldest messages past 100 visual lines.
     */
    _measureAndTrim(wrapW, fontSize, lineH) {
        const key = `${wrapW}|${fontSize}|${lineH}`;
        if (key !== this._measureKey) {
            this._measureKey = key;
            for (const line of this.lines) {
                line.visualLines = 0;
                line._wrapKey = "";
                line._rows = null;
            }
        }
        for (const line of this.lines) {
            if (!line.visualLines) this._rowsForLine(line, wrapW, fontSize);
        }
        let total = 0;
        for (let i = 0; i < this.lines.length; i++) total += this.lines[i].visualLines;
        while (this.lines.length > 0 && total > this.maxScrollbackLines) {
            total -= this.lines[0].visualLines || 1;
            this.lines.shift();
        }
        return total;
    }

    /**
     * Keep the Image's frame/scale in sync with the canvas. A stale 4×4 frame
     * + setDisplaySize was stretching the wrong UV region and shoving text off-screen.
     */
    _resizeCanvas(w, h) {
        this._ensureCtx();
        const cw = Math.max(1, Math.ceil(w));
        const ch = Math.max(1, Math.ceil(h));
        if (this._canvasW !== cw || this._canvasH !== ch) {
            this._canvasW = cw;
            this._canvasH = ch;
            this._logTexture.setSize(cw, ch);
        }
        this._logImage.setTexture(CombatLog.TEX_KEY);
        this._logImage.setOrigin(0, 1);
        this._logImage.setScale(1);
        this._logImage.setDisplaySize(cw, ch);
    }

    _drawStrokedText(ctx, text, x, y, color, alpha) {
        ctx.globalAlpha = alpha;
        ctx.lineWidth = CombatLog.STROKE;
        ctx.strokeStyle = "#000000";
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.strokeText(text, x, y);
        ctx.fillStyle = color || CombatLog.COLOR_DEFAULT;
        ctx.fillText(text, x, y);
    }

    /**
     * Paint messages + compose slot on one canvas.
     * Bottom line is always reserved for the chatting bar (blank when closed) so
     * opening chat never scoots the 10-line stack upward. Max = 10 msgs + 1 compose.
     * @param {{ alpha: number, rows: object[][] }[]} toShow newest first
     * @param {object[][]|null} composeRows
     */
    _paintLog(toShow, composeRows, wrapW, fontSize, lineH) {
        let msgLines = 0;
        for (const m of toShow) msgLines += m.rows.length;
        // Always reserve at least one compose slot so layout height is stable
        const composeLineCount = Math.max(1, composeRows?.length || 0);
        const usedLines = msgLines + composeLineCount;

        if (msgLines <= 0 && !composeRows) {
            // Keep the empty compose slot so combat lines don't jump when T is pressed
            // (still hide when there's truly nothing to show and chat is closed)
            this._logImage.setVisible(false);
            return;
        }

        const pad = CombatLog.STROKE + 1;
        const canvasW = wrapW + pad * 2;
        const canvasH = usedLines * lineH + pad * 2;
        this._resizeCanvas(canvasW, canvasH);
        const ctx = this._ctx;
        // setSize clears the canvas and resets font state
        ctx.clearRect(0, 0, canvasW, canvasH);
        this._setFont(fontSize);

        const ascent = Math.round(fontSize * 0.85);
        const spaceW = this._spaceWidth(fontSize);

        const drawRow = (pieces, fromBottom, alpha) => {
            const baseline = canvasH - pad - fromBottom - (lineH - ascent);
            let x = pad;
            for (let p = 0; p < pieces.length; p++) {
                if (p > 0) x += spaceW;
                const piece = pieces[p];
                this._drawStrokedText(
                    ctx,
                    piece.text,
                    x,
                    baseline,
                    piece.color || CombatLog.COLOR_DEFAULT,
                    alpha
                );
                x += this._measureChunk(piece.text, fontSize);
            }
        };

        // Bottom → top: compose slot first (may be blank), then newest messages
        let fromBottom = 0;
        if (composeRows) {
            for (let r = composeRows.length - 1; r >= 0; r--) {
                drawRow(composeRows[r], fromBottom, 1);
                fromBottom += lineH;
            }
        } else {
            // Empty reserved chatting-bar line
            fromBottom += lineH;
        }
        for (const m of toShow) {
            const rows = m.rows;
            for (let r = rows.length - 1; r >= 0; r--) {
                drawRow(rows[r], fromBottom, m.alpha);
                fromBottom += lineH;
            }
        }

        ctx.globalAlpha = 1;
        this._logTexture.refresh();
        this._logImage.setVisible(true);
    }

    _layout() {
        const s = this.scene.uiScale || 1;
        const lineH = Math.round(14 * s);
        const fontSize = Math.round(11 * s);
        const wrapW = this._maxTextWidth();
        // 10 message lines; compose/chatting bar is a separate 11th slot underneath
        const budget = this.visibleLineCap;
        this.container.setPosition(12, this.scene.scale.height - 16);

        if (!this.composing) this.scrollOffset = 0;

        const composeRows = this.composing ? this._composeRows(wrapW, fontSize) : null;

        const totalVisual = this._measureAndTrim(wrapW, fontSize, lineH);

        // --- Chat stack: up to 10 visual lines, permanently above the compose slot ---
        const now = this.scene.time.now;
        const measured = [];
        for (const line of this.lines) {
            if (!this.composing && now - line.t >= this.fadeMs) continue;
            let alpha = 1;
            if (!this.composing) {
                const age = now - line.t;
                alpha = age > this.fadeMs - 2000
                    ? Phaser.Math.Clamp(1 - (age - (this.fadeMs - 2000)) / 2000, 0, 1)
                    : 1;
            }
            const rows = this._rowsForLine(line, wrapW, fontSize);
            measured.push({ line, visualLines: line.visualLines || 1, alpha, rows });
        }

        const scrollableVisual = this.composing
            ? totalVisual
            : measured.reduce((sum, m) => sum + m.visualLines, 0);
        const maxScroll = Math.max(0, scrollableVisual - budget);
        this.scrollOffset = this.composing
            ? Phaser.Math.Clamp(this.scrollOffset | 0, 0, maxScroll)
            : 0;

        // Walk newest → oldest: skip scrollOffset visual lines, then fill budget.
        // Multi-line messages can be partially visible (no whole-message pop-in).
        const toShow = []; // newest first
        let skip = this.composing ? this.scrollOffset : 0;
        let used = 0;
        for (let i = measured.length - 1; i >= 0; i--) {
            const m = measured[i];
            let rows = m.rows;
            if (!rows?.length) continue;

            if (skip > 0) {
                if (skip >= rows.length) {
                    skip -= rows.length;
                    continue;
                }
                // Newest visual lines are at the end of the wrap — drop those first.
                rows = rows.slice(0, rows.length - skip);
                skip = 0;
            }
            if (!rows.length) continue;

            const room = budget - used;
            if (room <= 0) break;
            if (rows.length > room) {
                // Top of the viewport: keep the newest `room` rows of this message
                // so earlier wrap lines reveal as you scroll further up.
                rows = rows.slice(rows.length - room);
            }

            toShow.push({ line: m.line, alpha: m.alpha, rows, visualLines: rows.length });
            used += rows.length;
            if (used >= budget) break;
        }

        this._paintLog(toShow, composeRows, wrapW, fontSize, lineH);
        this._logImage.setPosition(0, 0);
        this._logImage.setOrigin(0, 1);
    }

    update() {
        const now = this.scene.time?.now || 0;
        if (this.composing) {
            if (this._layoutDirty) {
                this._layout();
                this._layoutDirty = false;
                this._lastBlink = now;
            } else if (now - this._lastBlink >= 500) {
                // Cursor blink — redraw compose row on the shared canvas
                this._layout();
                this._lastBlink = now;
            }
            return;
        }
        if (this._layoutDirty) {
            this._layout();
            this._layoutDirty = false;
            this._lastFadeLayout = now;
            return;
        }
        // Fade alphas: throttle; canvas redraw is cheap (one texture refresh)
        if (this.lines.length && now - this._lastFadeLayout >= 100) {
            this._layout();
            this._lastFadeLayout = now;
        }
    }

    layout() {
        this._layoutDirty = true;
        this._layout();
        this._layoutDirty = false;
    }
}
