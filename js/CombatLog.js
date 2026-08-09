/**
 * Bottom-left fading combat / chat log, plus T-to-type chat input.
 * Chat stack is always up to 10 visual lines above a permanently reserved compose row.
 * While composing, wheel scrollback is capped at 100 visual lines.
 */
class CombatLog {
    constructor(scene) {
        this.scene = scene;
        this.lines = [];
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

        this.container = scene.add.container(12, scene.scale.height - 20);
        this.container.setScrollFactor(0).setDepth(10000);
        scene.uiLayer?.add(this.container);

        // Always-on capture listener — do NOT toggle Phaser keyboard.enabled (misses keyups
        // while disabled, which breaks JustDown(T) / stuck keys after chat).
        window.addEventListener("keydown", this._boundKey, true);
        scene.events.once("shutdown", () => this.destroy());
        scene.events.once("destroy", () => this.destroy());

        // One text object per message row; never need more than visibleLineCap
        this._texts = [];
        for (let i = 0; i < this.visibleLineCap; i++) {
            const t = scene.add.text(0, 0, "", {
                fontFamily: "monospace",
                fontSize: `${Math.round(11 * (scene.uiScale || 1))}px`,
                color: "#e8e0d0",
                stroke: "#000000",
                strokeThickness: 3,
                wordWrap: { width: 200, useAdvancedWrap: true }
            }).setOrigin(0, 1);
            this.container.add(t);
            this._texts.push(t);
        }

        // Hidden probe for measuring wrapped height (not in the log container)
        this._probe = scene.add.text(0, 0, "", {
            fontFamily: "monospace",
            fontSize: `${Math.round(11 * (scene.uiScale || 1))}px`,
            wordWrap: { width: 200, useAdvancedWrap: true }
        }).setVisible(false).setActive(false);

        // Compose row — separate from the 10-line chat stack
        this.inputText = scene.add.text(0, 0, "", {
            fontFamily: "monospace",
            fontSize: `${Math.round(11 * (scene.uiScale || 1))}px`,
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: 3,
            wordWrap: { width: 200, useAdvancedWrap: true }
        }).setOrigin(0, 1).setVisible(false);
        this.container.add(this.inputText);
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
    }

    openChat(initialDraft = "") {
        if (this.composing) return;
        this.composing = true;
        this.draft = String(initialDraft || "");
        this._draftStash = "";
        this.historyPos = this.sentHistory.length;
        this.scrollOffset = 0;
        // Clear Phaser key state (especially the T that opened chat)
        this.scene.input?.keyboard?.resetKeys?.();
        window.addEventListener("wheel", this._boundWheel, { passive: false, capture: true });
        this.inputText.setVisible(true);
        this._layoutDirty = true;
        this._refreshInput();
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
        this.inputText.setVisible(false).setText("");
        window.removeEventListener("wheel", this._boundWheel, true);
        this.scene.input?.keyboard?.resetKeys?.();
        if (send && msg) {
            // Both chat and slash commands go into ↑/↓ recall
            this._rememberSent(msg);
            if (msg.startsWith("/")) {
                this._handleCommand(msg);
            } else {
                const name = this.scene.playerName || this.playerName || "Player";
                this.push(`${name}: ${msg}`);
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
        if (cmd === "/help") {
            this.push("Commands:");
            this.push("  /help — list commands");
            this.push("  /tick [speed] — world clock speed (1 = normal, 0 = pause)");
            this.push("  /debug fps|melee_slots|blood [show|hide] — toggle debug overlays");
            return;
        }
        if (cmd === "/debug") {
            const usage = "Usage: /debug fps|melee_slots|blood [show|hide]";
            const topic = (parts[1] || "").toLowerCase();
            const action = (parts[2] || "").toLowerCase();
            if (topic === "melee_slots" || topic === "melee-slots") {
                if (action && action !== "show" && action !== "hide") {
                    this.push(usage);
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
                    this.push(usage);
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
            if (topic === "blood") {
                if (action && action !== "show" && action !== "hide") {
                    this.push(usage);
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
            this.push(usage);
            return;
        }
        if (cmd === "/tick") {
            const arg = parts[1];
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
                this.push("Usage: /tick [speed]  (1 = normal, 60 ≈ 1 game hour/sec, 0 = pause)");
                return;
            }
            report(this.scene.setTickSpeed?.(m));
            return;
        }
        this.push(`Unknown command: ${parts[0]} (try /help)`);
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
        this._refreshInput();
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
        this._refreshInput();
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
                !event.altKey
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
            this._refreshInput();
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
                this._refreshInput();
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

    _refreshInput() {
        const name = this.scene.playerName || this.playerName || "Player";
        const blink = Math.floor((this.scene.time?.now || 0) / 500) % 2 === 0 ? "_" : " ";
        this.inputText.setText(`${name}: ${this.draft}${blink}`);
    }

    push(msg) {
        if (!msg) return;
        this.lines.push({
            text: String(msg),
            t: this.scene.time.now,
            visualLines: 0
        });
        this._layoutDirty = true;
    }

    _visualLinesFor(str, wrapW, fontSize, lineH) {
        this._probe
            .setFontSize(fontSize)
            .setWordWrapWidth(wrapW, true)
            .setText(str || " ");
        const h = Math.max(lineH, this._probe.height || lineH);
        return Math.max(1, Math.round(h / lineH));
    }

    /**
     * Cache wrap heights and drop oldest messages past 100 visual lines.
     */
    _measureAndTrim(wrapW, fontSize, lineH) {
        const key = `${wrapW}|${fontSize}|${lineH}`;
        if (key !== this._measureKey) {
            this._measureKey = key;
            for (const line of this.lines) line.visualLines = 0;
        }
        for (const line of this.lines) {
            if (!line.visualLines) {
                line.visualLines = this._visualLinesFor(line.text, wrapW, fontSize, lineH);
            }
        }
        let total = 0;
        for (let i = 0; i < this.lines.length; i++) total += this.lines[i].visualLines;
        while (this.lines.length > 0 && total > this.maxScrollbackLines) {
            total -= this.lines[0].visualLines || 1;
            this.lines.shift();
        }
        return total;
    }

    _layout() {
        const s = this.scene.uiScale || 1;
        const lineH = Math.round(14 * s);
        const fontSize = Math.round(11 * s);
        const wrapW = this._maxTextWidth();
        const budget = this.visibleLineCap;
        this.container.setPosition(12, this.scene.scale.height - 16);

        // --- Compose row: always reserve 1 line at the bottom (chat sits above it) ---
        let chatBottom = lineH;
        if (this.composing) {
            this._refreshInput();
            this.inputText
                .setVisible(true)
                .setAlpha(1)
                .setFontSize(fontSize)
                .setWordWrapWidth(wrapW, true)
                .setPosition(0, 0);
            chatBottom = Math.max(lineH, this.inputText.height);
        } else {
            this.inputText.setVisible(false).setText("");
            this.scrollOffset = 0;
        }

        const totalVisual = this._measureAndTrim(wrapW, fontSize, lineH);

        // --- Chat stack: up to `budget` visual lines, sitting above the compose row ---
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
            measured.push({ line, visualLines: line.visualLines || 1, alpha });
        }

        const scrollableVisual = this.composing
            ? totalVisual
            : measured.reduce((sum, m) => sum + m.visualLines, 0);
        const maxScroll = Math.max(0, scrollableVisual - budget);
        this.scrollOffset = this.composing
            ? Phaser.Math.Clamp(this.scrollOffset | 0, 0, maxScroll)
            : 0;

        // Walk newest → oldest: skip scrollOffset visual lines, then fill budget
        const toShow = []; // newest first
        let skip = this.composing ? this.scrollOffset : 0;
        let used = 0;
        for (let i = measured.length - 1; i >= 0; i--) {
            const m = measured[i];
            if (skip > 0) {
                if (skip >= m.visualLines) {
                    skip -= m.visualLines;
                    continue;
                }
                skip = 0;
            }
            if (used + m.visualLines > budget) {
                if (used === 0) {
                    toShow.push(m);
                    used += m.visualLines;
                }
                break;
            }
            toShow.push(m);
            used += m.visualLines;
        }

        let y = chatBottom;
        for (let i = 0; i < this._texts.length; i++) {
            const text = this._texts[i];
            const m = toShow[i];
            if (!m) {
                text.setVisible(false);
                continue;
            }
            text.setFontSize(fontSize);
            text.setWordWrapWidth(wrapW, true);
            text.setText(m.line.text).setVisible(true).setAlpha(m.alpha);
            text.setPosition(0, -y);
            y += Math.max(lineH, text.height);
        }
    }

    update() {
        const now = this.scene.time?.now || 0;
        if (this.composing) {
            // Opening chat used to remeasure the whole log every frame — only relayout on change
            if (this._layoutDirty) {
                this._layout();
                this._layoutDirty = false;
                this._lastBlink = now;
            } else if (now - this._lastBlink >= 500) {
                this._refreshInput();
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
        // Fade alphas: throttle; skip if nothing on screen
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
