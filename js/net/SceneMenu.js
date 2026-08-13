/**
 * Title menu — Singleplayer / Multiplayer with client-owned characters (IndexedDB).
 */
class SceneMenu extends Phaser.Scene {
    constructor() {
        super({ key: "SceneMenu" });
    }

    init(data) {
        this._openDisconnected = !!(data && data.disconnected);
    }

    preload() {
        if (typeof PlayerLook !== "undefined") PlayerLook.loadParts(this);
        if (!this.textures.exists("menu-palm")) {
            this.load.image("menu-palm", "assets/things/palm_tree.png");
        }
        if (!this.textures.exists("ui-dice")) {
            this.load.image("ui-dice", "assets/ui/dice.png");
        }
    }

    create() {
        this.cameras.main.setBackgroundColor("#1a1510");
        this.cameras.main.setRoundPixels(true);
        this._dom = [];
        this._phase = "root";
        this._backAction = null;
        this._selectedCharacter = null;
        this._mode = null; // "sp" | "mp"
        this._mpHost = null;
        this._mpPassword = "";
        this._charNext = null;
        this._createFaceIdx = 0;
        this._armedDeleteId = null;
        this._armedDeleteBtn = null;
        this._armedDeleteTimer = null;
        this._mpProbe = null;
        this._mpJoinNet = null;
        this._mpConnectGen = 0;
        this._startingSp = false;
        this._ensurePlayerAnims();
        // Don't let the canvas steal tab/focus from HTML fields
        if (this.game?.canvas) this.game.canvas.tabIndex = -1;
        this._onMenuKeydown = (e) => this._handleMenuEscape(e);
        document.addEventListener("keydown", this._onMenuKeydown, true);
        this._onResize = () => {
            if (this._resizeTimer) clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(() => this._relayout(), 40);
        };
        this.scale.on("resize", this._onResize);
        if (this._openDisconnected) this._phase = "disconnected";
        // Wait for yoster — first paint otherwise falls back to Arial
        this._bootRoot();
    }

    async _ensurePrimaryFont() {
        if (this._primaryFontReady) return;
        if (typeof document === "undefined" || !document.fonts?.load) {
            this._primaryFontReady = true;
            return;
        }
        try {
            await document.fonts.load('36px "PrimaryFont"');
            await document.fonts.ready;
        } catch (_) {}
        this._primaryFontReady = true;
    }

    async _bootRoot() {
        await this._ensurePrimaryFont();
        if (!this.sys?.isActive?.()) return;
        if (this._openDisconnected || this._phase === "disconnected") {
            this._openDisconnected = false;
            this._showDisconnected();
            return;
        }
        this._showRoot();
    }

    /** Force nearest-neighbor on a texture (pixel art). */
    _pixelFilter(key) {
        if (!key || !this.textures.exists(key)) return;
        try {
            this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
        } catch (_) {}
    }

    /**
     * Place a menu sprite/image on the integer pixel grid.
     * Uses top-left origin so floor(x/y) cannot land between texels.
     * @returns {Phaser.GameObjects.Sprite|Phaser.GameObjects.Image}
     */
    _placePixelIcon(obj, centerX, centerY, texScale = 3) {
        const s = Math.max(1, Math.round(Number(texScale) || 1));
        const fw = obj.frame?.realWidth || obj.frame?.width || obj.width || 16;
        const fh = obj.frame?.realHeight || obj.frame?.height || obj.height || 16;
        const dw = fw * s;
        const dh = fh * s;
        obj.setOrigin(0, 0);
        obj.setScale(s);
        obj.setPosition(
            Math.floor(centerX - dw / 2),
            Math.floor(centerY - dh / 2)
        );
        if (obj.texture?.key) this._pixelFilter(obj.texture.key);
        return obj;
    }

    _snapshotDrafts() {
        return {
            host: this.hostInput?.value,
            pass: this.passInput?.value,
            name: this.nameInput?.value,
            worldName: this.worldNameInput?.value,
            seed: this.seedInput?.value,
            renameName: this.renameInput?.value,
            faceIdx: this._createFaceIdx,
            look: this._createLook,
            lookPart: this._createLookPart
        };
    }

    _menuInputKeys() {
        return ["hostInput", "passInput", "nameInput", "worldNameInput", "seedInput", "renameInput"];
    }

    _snapshotDomFocus() {
        const a = document.activeElement;
        for (const key of this._menuInputKeys()) {
            const el = this[key];
            if (el && el === a) {
                return {
                    key,
                    start: el.selectionStart,
                    end: el.selectionEnd
                };
            }
        }
        return null;
    }

    _restoreDomFocus(snap) {
        if (!snap) return;
        const el = this[snap.key];
        if (!el) return;
        el.focus();
        try {
            if (typeof snap.start === "number" && typeof snap.end === "number") {
                el.setSelectionRange(snap.start, snap.end);
            }
        } catch (_) {}
        this._syncKeyboardForDom();
    }

    _anyMenuInputFocused() {
        const a = document.activeElement;
        if (!a) return false;
        return this._menuInputKeys().some((key) => this[key] === a);
    }

    /** Phaser keyboard must stay off while a menu field is focused. */
    _syncKeyboardForDom() {
        const kb = this.input?.keyboard;
        if (!kb) return;
        kb.enabled = !this._anyMenuInputFocused();
    }

    /** Same as the on-screen Back button (capture so focused fields still work). */
    _handleMenuEscape(e) {
        if (e.key !== "Escape" && e.code !== "Escape") return;
        if (e.repeat) return;
        if (!this.sys?.isActive?.()) return;
        if (typeof this._backAction !== "function") return;
        e.preventDefault();
        e.stopPropagation();
        this._backAction();
    }

    /** Rebuild the current menu screen after a window resize. */
    _relayout() {
        if (!this.sys || this.sys.isActive === false) return;
        const gw = this.scale.width;
        const gh = this.scale.height;
        this.cameras.main.setSize(gw, gh);
        this.cameras.main.setViewport(0, 0, gw, gh);
        const focus = this._snapshotDomFocus();
        const drafts = this._snapshotDrafts();
        const phase = this._phase;
        switch (phase) {
            case "root":
                this._showRoot();
                break;
            case "disconnected":
                this._showDisconnected();
                break;
            case "mpHost":
                this._showMpHost({ drafts, relayout: true });
                break;
            case "mpHelp":
                this._showMpHelp();
                break;
            case "mpPassword":
                this._showMpPassword({ drafts, relayout: true });
                break;
            case "characters":
                this._showCharacters({ next: this._charNext });
                break;
            case "createCharacter":
                this._showCreateCharacter({
                    next: this._charNext,
                    drafts,
                    relayout: true
                });
                break;
            case "worlds":
                this._showWorlds();
                break;
            case "createWorld":
                this._showCreateWorld({ drafts, relayout: true });
                break;
            case "rename":
                this._showRename({
                    kind: this._renameKind,
                    id: this._renameId,
                    currentName: this._renameCurrent,
                    maxLen: this._renameMaxLen,
                    drafts,
                    relayout: true
                });
                break;
            default:
                this._showRoot();
                break;
        }
        this._restoreDomFocus(focus);
    }

    _ensurePlayerAnims() {
        // Walk/idle anims are created per baked look in PlayerLook.ensure
    }

    _unbindCreateHslInput() {
        if (this._onHslMove) {
            this.input?.off?.("pointermove", this._onHslMove);
            this.input?.off?.("pointerup", this._onHslUp);
            this.input?.off?.("pointerupoutside", this._onHslUp);
        }
        this._onHslMove = this._onHslUp = null;
        this._hslDrag = null;
    }

    _clear() {
        this._unbindCreateHslInput();
        this._cancelMpProbe();
        this._backAction = null;
        if (this._armedDeleteTimer) {
            clearTimeout(this._armedDeleteTimer);
            this._armedDeleteTimer = null;
        }
        this._armedDeleteId = null;
        this._armedDeleteBtn = null;
        for (const o of this._dom) {
            try {
                o.destroy?.();
            } catch (_) {}
            try {
                o.remove?.();
            } catch (_) {}
        }
        this._dom = [];
        this.children.removeAll(true);
        this.cameras.main.setBackgroundColor("#1a1510");
        this._previewSprite = null;
        this._previewGfx = null;
        this._previewFrame = null;
        this._createSwatches = null;
        this._createHslBars = null;
        this.hostInput = this.passInput = this.nameInput = this.worldNameInput = this.seedInput = this.renameInput = null;
        this._syncKeyboardForDom();
    }

    _track(...nodes) {
        for (const n of nodes) if (n) this._dom.push(n);
        return nodes[0];
    }

    _title(text, yFrac = 0.14) {
        const w = this.scale.width;
        const h = this.scale.height;
        const label = this._track(this.add.text(w / 2, h * yFrac, text, {
            fontFamily: "PrimaryFont",
            fontSize: "36px",
            color: "#e8dcc8"
        }).setOrigin(0.5));
        // If we somehow drew early, swap metrics once the face is ready
        if (!this._primaryFontReady) {
            this._ensurePrimaryFont().then(() => {
                if (!label?.active) return;
                label.setStyle({ fontFamily: "PrimaryFont", fontSize: "36px", color: "#e8dcc8" });
                label.setFontFamily("PrimaryFont");
                label.updateText?.();
            });
        }
        return label;
    }

    _status(yFrac = 0.88) {
        const w = this.scale.width;
        const h = this.scale.height;
        this.status = this._track(this.add.text(w / 2, h * yFrac, "", {
            fontFamily: "monospace",
            fontSize: "13px",
            color: "#c0b0a0",
            align: "center",
            wordWrap: { width: Math.min(520, w - 40) }
        }).setOrigin(0.5));
        return this.status;
    }

    /** Clear status feedback when the user edits a DOM field (e.g. duplicate-name errors). */
    _clearStatusOnInput(el) {
        if (!el) return;
        const clear = () => {
            this.status?.setColor?.("#c0b0a0");
            this.status?.setText("");
        };
        el.addEventListener("input", clear);
        el.addEventListener("change", clear);
    }

    /**
     * Menu button size presets (fixed box so every button of a tier matches).
     * large  — root Singleplayer / Multiplayer
     * medium — Back, Connect, Help, Create, Import, Join, …
     * small  — character / world card actions
     */
    _buttonSizePreset(size) {
        const presets = {
            large: { fontSize: "22px", width: 240, height: 52 },
            medium: { fontSize: "16px", width: 132, height: 38 },
            small: { fontSize: "13px", width: 78, height: 28 }
        };
        if (size === "large" || size === "lg" || size === "hero") return presets.large;
        if (size === "small" || size === "sm" || size === "compact") return presets.small;
        return presets.medium;
    }

    /** Vertical center for stacked medium buttons (index 0 = base). */
    _mediumStackY(baseY, index = 0) {
        const step = this._buttonSizePreset("medium").height + 10;
        return baseY + step * index;
    }

    _button(x, y, label, onClick, opts = {}) {
        const BG = 0x120e0a;       // slightly darker than menu #1a1510
        const BG_PRESS = 0x0a0806; // even darker while pressed
        const OUTLINE = 0x2a2218;  // dark outline
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b; // gold
        const sizeKey = opts.size || (opts.compact ? "small" : "medium");
        const preset = this._buttonSizePreset(sizeKey);
        const fontSize = opts.fontSize || preset.fontSize;
        const bw = Math.max(1, Math.round(Number(opts.width ?? opts.minWidth ?? preset.width) || preset.width));
        const bh = Math.max(1, Math.round(Number(opts.height ?? opts.minHeight ?? preset.height) || preset.height));

        const text = this.add.text(0, 0, label, {
            fontFamily: "PrimaryFont",
            fontSize,
            color: "#d4c4a8"
        }).setOrigin(0.5);

        const rect = this.add.rectangle(0, 0, bw, bh, BG, 1)
            .setStrokeStyle(2, OUTLINE)
            .setInteractive({ useHandCursor: true });

        const root = this.add.container(x, y, [rect, text]);
        let hovering = false;
        let pressing = false;

        const setActive = (on) => {
            opts.onActive?.(on);
        };

        const paint = () => {
            if (opts.armed) {
                rect.setFillStyle(BG_PRESS, 1);
                rect.setStrokeStyle(2, OUTLINE_PRESS);
                text.setColor("#e8d080");
            } else if (pressing) {
                rect.setFillStyle(BG_PRESS, 1);
                rect.setStrokeStyle(2, OUTLINE_PRESS);
                text.setColor("#d4c4a8");
            } else if (hovering) {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(2, OUTLINE_HOVER);
                text.setColor("#d4c4a8");
            } else {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(2, OUTLINE);
                text.setColor("#d4c4a8");
            }
        };

        rect.on("pointerover", () => {
            hovering = true;
            paint();
            setActive(true);
        });
        rect.on("pointerout", () => {
            hovering = false;
            pressing = false;
            paint();
            setActive(false);
            opts.onPointerOut?.();
        });
        rect.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            pressing = true;
            paint();
            setActive(true);
        });
        rect.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const wasPress = pressing;
            pressing = false;
            paint();
            if (wasPress && hovering) onClick?.();
            else if (!hovering) setActive(false);
        });

        this._track(root);
        if (label === "Back") this._backAction = onClick;
        root.btnWidth = bw;
        root.btnHeight = bh;
        root.btnRect = rect;
        root.btnText = text;
        root.setArmed = (on) => {
            opts.armed = !!on;
            paint();
        };
        paint();
        return root;
    }

    _formatLastPlayed(ts) {
        const n = Number(ts);
        if (!Number.isFinite(n) || n <= 0) return "Never played";
        const ago = Date.now() - n;
        if (ago < 60_000) return "just now";
        try {
            return new Date(n).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit"
            });
        } catch {
            return new Date(n).toLocaleString();
        }
    }

    _lastPlayedTs(row) {
        if (row && Object.prototype.hasOwnProperty.call(row, "lastPlayedAt")) {
            const n = Number(row.lastPlayedAt);
            return Number.isFinite(n) && n > 0 ? n : 0;
        }
        const n = Number(row?.updatedAt);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    _lastPlayedLabel(row) {
        const ts = this._lastPlayedTs(row);
        if (!ts) return "Never played";
        return `Last played ${this._formatLastPlayed(ts)}`;
    }

    _formatWorldClock(clock) {
        const day = Math.max(1, Math.floor(Number(clock?.gameDay) || 1));
        let mins = Math.floor(Number(clock?.gameMinutes) || 0);
        if (mins < 0) mins = 0;
        mins = mins % 1440;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        const hh = String(h).padStart(2, "0");
        const mm = String(m).padStart(2, "0");
        return { day: `Day ${day}`, time: `${hh}:${mm}` };
    }

    _clearArmedDelete() {
        if (this._armedDeleteTimer) {
            clearTimeout(this._armedDeleteTimer);
            this._armedDeleteTimer = null;
        }
        if (this._armedDeleteBtn?.active !== false && this._armedDeleteBtn?.btnText) {
            this._armedDeleteBtn.setArmed?.(false);
            this._armedDeleteBtn.btnText.setText("Delete");
        }
        this._armedDeleteId = null;
        this._armedDeleteBtn = null;
    }

    _armDelete(cardId, deleteBtn) {
        if (this._armedDeleteId !== cardId) {
            this._clearArmedDelete();
        }
        this._armedDeleteId = cardId;
        this._armedDeleteBtn = deleteBtn;
        deleteBtn.setArmed?.(true);
        deleteBtn.btnText?.setText("Delete?");
        if (this._armedDeleteTimer) clearTimeout(this._armedDeleteTimer);
        this._armedDeleteTimer = setTimeout(() => {
            this._armedDeleteTimer = null;
            if (this._armedDeleteId !== cardId) return;
            this._clearArmedDelete();
        }, 3000);
    }

    /**
     * Terraria-style select card: icon, title, info, Play/Rename/Favorite, Export/Delete stack.
     * Play = 1 click; double-click empty card area also activates.
     */
    _selectCard(opts) {
        const {
            x,
            y,
            width,
            height,
            cardId,
            iconNode,
            title,
            lines = [],
            onActivate,
            onRename,
            onFavorite,
            favorited = false,
            onExport,
            onDelete,
            onHoverActive
        } = opts;

        const BG = 0x120e0a;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const left = Math.round(x - width / 2);
        const top = Math.round(y - height / 2);
        const pad = 12;
        // Fits 16px sprites at integer scale 3 (48×48)
        const iconSlot = 48;

        const panel = this.add.rectangle(Math.round(x), Math.round(y), width, height, BG, 1)
            .setStrokeStyle(2, OUTLINE)
            .setInteractive({ useHandCursor: true });
        this._track(panel);

        let hovering = false;
        let lastClickAt = 0;
        const paintPanel = () => {
            panel.setStrokeStyle(2, hovering ? OUTLINE_HOVER : OUTLINE);
        };
        panel.on("pointerover", () => {
            hovering = true;
            paintPanel();
            onHoverActive?.(true);
        });
        panel.on("pointerout", () => {
            hovering = false;
            paintPanel();
            onHoverActive?.(false);
        });
        panel.on("pointerup", () => {
            const now = Date.now();
            if (now - lastClickAt < 350) {
                lastClickAt = 0;
                onActivate?.();
            } else {
                lastClickAt = now;
            }
        });

        if (iconNode) {
            // Icons use top-left origin from _placePixelIcon — center inside slot
            const fw = iconNode.frame?.realWidth || iconNode.frame?.width || 16;
            const fh = iconNode.frame?.realHeight || iconNode.frame?.height || 16;
            const s = Math.max(1, Math.round(iconNode.scaleX || 1));
            const cx = left + pad + iconSlot / 2;
            const cy = y;
            iconNode.setPosition(
                Math.floor(cx - (fw * s) / 2),
                Math.floor(cy - (fh * s) / 2)
            );
            if (iconNode.setDepth) iconNode.setDepth(1);
        }

        const sideBtnW = this._buttonSizePreset("small").width;
        const textLeft = left + pad + iconSlot + 10;
        const textRight = left + width - pad - sideBtnW - 10;
        const titleText = this.add.text(textLeft, top + 10, title || "", {
            fontFamily: "PrimaryFont",
            fontSize: "18px",
            color: "#e8dcc8"
        }).setOrigin(0, 0);
        this._track(titleText);

        const info = this.add.text(textLeft, top + 34, (lines || []).join(" / "), {
            fontFamily: "PrimaryFont",
            fontSize: "13px",
            color: "#a89880",
            wordWrap: { width: Math.max(120, textRight - textLeft) }
        }).setOrigin(0, 0);
        this._track(info);

        const playBtn = this._button(0, 0, "Play", () => onActivate?.(), {
            size: "small",
            onActive: onHoverActive
        });
        const renameBtn = this._button(0, 0, "Rename", () => onRename?.(), { size: "small" });
        const favoriteBtn = onFavorite
            ? this._button(0, 0, "Favorite", () => onFavorite?.(!favorited), {
                size: "small",
                armed: !!favorited
            })
            : null;
        const exportBtn = this._button(0, 0, "Export", () => onExport?.(), { size: "small" });
        const deleteBtn = this._button(0, 0, "Delete", () => {
            if (this._armedDeleteId === cardId) {
                this._clearArmedDelete();
                onDelete?.();
                return;
            }
            this._armDelete(cardId, deleteBtn);
        }, { size: "small" });
        if (this._armedDeleteId === cardId) {
            deleteBtn.setArmed?.(true);
            deleteBtn.btnText?.setText("Delete?");
        }

        // Bottom-left actions — 8px under info; Export/Delete stay 6px apart
        const btnY = info.y + info.height + 8 + playBtn.btnHeight / 2;
        playBtn.x = textLeft + playBtn.btnWidth / 2;
        playBtn.y = btnY;
        renameBtn.x = playBtn.x + playBtn.btnWidth / 2 + 8 + renameBtn.btnWidth / 2;
        renameBtn.y = btnY;
        if (favoriteBtn) {
            favoriteBtn.x = renameBtn.x + renameBtn.btnWidth / 2 + 8 + favoriteBtn.btnWidth / 2;
            favoriteBtn.y = btnY;
        }

        // Top-right stack: Export, then Delete
        const sideGap = 6;
        const sideX = left + width - pad - Math.max(exportBtn.btnWidth, deleteBtn.btnWidth) / 2;
        exportBtn.x = sideX;
        exportBtn.y = top + 10 + exportBtn.btnHeight / 2;
        deleteBtn.x = sideX;
        deleteBtn.y = exportBtn.y + exportBtn.btnHeight / 2 + sideGap + deleteBtn.btnHeight / 2;

        return { panel, playBtn, renameBtn, favoriteBtn, exportBtn, deleteBtn, height };
    }

    /**
     * In-game rename screen (no window.prompt). Placeholder ghost text = current name.
     */
    _showRename({
        kind = "character",
        id = null,
        currentName = "",
        maxLen = 24,
        drafts = null,
        relayout = false
    } = {}) {
        if (!id) {
            if (kind === "world") this._showWorlds();
            else this._showCharacters({ next: this._charNext });
            return;
        }
        this._clear();
        this._phase = "rename";
        this._renameKind = kind;
        this._renameId = id;
        this._renameCurrent = currentName || (kind === "world" ? "World" : "Player");
        this._renameMaxLen = maxLen;

        const w = this.scale.width;
        const h = this.scale.height;
        this._title("Rename");
        this._status();

        const typed = drafts?.renameName != null ? drafts.renameName : "";
        this.renameInput = this._domInput(
            w / 2 - 140,
            h * 0.42,
            280,
            this._renameCurrent,
            typed
        );
        this.renameInput.maxLength = maxLen;
        this._clearStatusOnInput(this.renameInput);
        if (!relayout) this.renameInput.focus();

        this._button(w / 2, h * 0.58, "Rename", async () => {
            const raw = (this.renameInput?.value || "").trim();
            const name = (raw || this._renameCurrent).slice(0, this._renameMaxLen);
            try {
                if (this._renameKind === "world") {
                    await WorldStore.rename(this._renameId, name);
                    await this._showWorlds();
                } else {
                    await CharacterStore.rename(this._renameId, name);
                    if (this._selectedCharacter?.id === this._renameId) {
                        this._selectedCharacter = await CharacterStore.get(this._renameId);
                    }
                    await this._showCharacters({ next: this._charNext });
                }
            } catch (e) {
                this.status?.setColor?.("#e06060");
                this.status?.setText(String(e.message || e));
            }
        });
        this._button(w / 2, this._mediumStackY(h * 0.58, 1), "Back", () => {
            if (this._renameKind === "world") this._showWorlds();
            else this._showCharacters({ next: this._charNext });
        });
    }

    _listFooter(y, { onBack, onImport, onCreate }) {
        const w = this.scale.width;
        const gap = this._buttonSizePreset("medium").width + 16;
        this._button(w / 2 - gap, y, "Back", onBack);
        this._button(w / 2, y, "Import", onImport);
        this._button(w / 2 + gap, y, "Create", onCreate);
    }
    _roundArrow(x, y, glyph, onClick) {
        const r = 18;
        const hit = this.add.circle(x, y, r, 0x2a2218, 1)
            .setStrokeStyle(2, 0x6a5a4a)
            .setInteractive({ useHandCursor: true });
        const label = this.add.text(x, y, glyph, {
            fontFamily: "monospace",
            fontSize: "20px",
            color: "#d4c4a8"
        }).setOrigin(0.5);
        hit.on("pointerover", () => {
            hit.setStrokeStyle(2, 0xc4b498);
            label.setColor("#fff0d0");
        });
        hit.on("pointerout", () => {
            hit.setStrokeStyle(2, 0x6a5a4a);
            label.setColor("#d4c4a8");
        });
        hit.on("pointerdown", onClick);
        this._track(hit, label);
        return hit;
    }

    _domInput(x, y, width, placeholder, value, opts = {}) {
        const el = document.createElement("input");
        el.type = opts.type || "text";
        el.placeholder = placeholder;
        el.value = value || "";
        if (opts.autocomplete) el.autocomplete = opts.autocomplete;
        if (opts.maxLength != null) el.maxLength = opts.maxLength;
        el.spellcheck = false;
        el.style.cssText = [
            "position:fixed",
            `left:${x}px`,
            `top:${y}px`,
            `width:${width}px`,
            "padding:8px",
            "font-family:monospace",
            "font-size:14px",
            "background:#2a2218",
            "color:#e8dcc8",
            "border:1px solid #6a5a4a",
            "border-radius:4px",
            "z-index:1000",
            "pointer-events:auto",
            "outline:1px solid #6a5a4a",
            "box-sizing:border-box"
        ].join(";");
        // Keep Phaser from treating clicks/keys on this field as game input
        for (const ev of ["mousedown", "mouseup", "touchstart", "touchend", "pointerdown", "pointerup"]) {
            el.addEventListener(ev, (e) => e.stopPropagation());
        }
        for (const ev of ["keydown", "keyup", "keypress"]) {
            el.addEventListener(ev, (e) => e.stopPropagation());
        }
        el.addEventListener("focus", () => {
            el.style.outline = "2px solid #d4a84b";
            this._syncKeyboardForDom();
            try {
                this.game?.canvas?.blur?.();
            } catch (_) {}
        });
        el.addEventListener("blur", () => {
            el.style.outline = "1px solid #6a5a4a";
            // Next field may focus in the same turn — wait before re-enabling Phaser keys
            this.time?.delayedCall?.(0, () => this._syncKeyboardForDom());
        });
        document.body.appendChild(el);
        this._dom.push(el);
        return el;
    }

    _showRoot() {
        this._clear();
        this._phase = "root";
        const w = this.scale.width;
        const h = this.scale.height;
        this._title("CAVE PAINTINGS");
        this._status();
        this._button(w / 2, h * 0.42, "Singleplayer", () => this._beginSp(), { size: "large" });
        this._button(w / 2, h * 0.42 + 60, "Multiplayer", () => this._beginMp(), { size: "large" });
    }

    _showDisconnected() {
        this._clear();
        this._phase = "disconnected";
        this._mode = "mp";
        const w = this.scale.width;
        const h = this.scale.height;
        this._title("Disconnected");
        this._button(w / 2, h * 0.42, "OK", () => this._beginMp(), { size: "large" });
    }

    async _beginSp() {
        this._mode = "sp";
        await this._showCharacters({ next: "worlds" });
    }

    async _beginMp() {
        this._mode = "mp";
        this._mpPassword = "";
        await this._showMpHost();
    }

    async _showMpHost(opts = {}) {
        this._clear();
        this._phase = "mpHost";
        const w = this.scale.width;
        const h = this.scale.height;
        this._title("Multiplayer");
        this._status();
        const host = opts.drafts?.host
            ?? this._mpHost
            ?? localStorage.getItem("cp_join_host")
            ?? "127.0.0.1:21826";
        this.hostInput = this._domInput(w / 2 - 140, h * 0.40, 280, "", host);
        this._button(w / 2, this._mediumStackY(h * 0.55, 0), "Connect", () => this._probeMultiplayer());
        this._button(w / 2, this._mediumStackY(h * 0.55, 1), "Help", () => this._showMpHelp());
        this._button(w / 2, this._mediumStackY(h * 0.55, 2), "Back", () => this._showRoot());
    }

    /** Inline black/white command chip; keeps surrounding sentence text unchanged. */
    _addCmdLine(x, y, before, command, after, style, wrap) {
        const beforeT = this._track(this.add.text(x, y, before, { ...style }).setOrigin(0, 0));
        const padX = 4;
        const padY = 1;
        const measure = this.add.text(0, 0, command, {
            fontFamily: style.fontFamily || "monospace",
            fontSize: style.fontSize || "15px",
            color: "#ffffff"
        }).setOrigin(0, 0).setVisible(false);
        const cmdW = measure.width;
        const cmdH = measure.height;
        measure.destroy();

        const cmdX = x + beforeT.width;
        const bg = this.add.rectangle(cmdX, y - padY, cmdW + padX * 2, cmdH + padY * 2, 0x000000, 1)
            .setOrigin(0, 0);
        const cmdT = this.add.text(cmdX + padX, y, command, {
            fontFamily: style.fontFamily || "monospace",
            fontSize: style.fontSize || "15px",
            color: "#ffffff"
        }).setOrigin(0, 0);
        cmdT.setDepth((bg.depth || 0) + 1);
        this._track(bg, cmdT);

        const afterX = cmdX + bg.width;
        const firstW = Math.max(40, x + wrap - afterX);
        const probe = this.add.text(0, 0, after, {
            fontFamily: style.fontFamily || "monospace",
            fontSize: style.fontSize || "15px",
            color: style.color || "#c0b0a0"
        }).setOrigin(0, 0).setVisible(false);

        let first = after;
        let rest = "";
        if (probe.width > firstW) {
            // Fit as many words as possible on the same line as the command
            const words = after.split(/(\s+)/);
            first = "";
            rest = after;
            let built = "";
            for (let i = 0; i < words.length; i++) {
                const next = built + words[i];
                probe.setText(next);
                if (probe.width > firstW) break;
                built = next;
                first = built;
                rest = words.slice(i + 1).join("");
            }
            if (!first.trim()) {
                // Nothing fits beside the chip — put all of `after` on the next line
                first = "";
                rest = after;
            }
        }
        probe.destroy();

        let bottom = y + Math.max(beforeT.height, bg.height);
        if (first) {
            const firstT = this._track(this.add.text(afterX, y, first, {
                ...style,
                wordWrap: { width: firstW }
            }).setOrigin(0, 0));
            bottom = Math.max(bottom, y + firstT.height);
        }
        if (rest.trim()) {
            // Hang under "Run" (after the "2. " number), not under the command chip
            const numM = this.add.text(0, 0, before.match(/^\d+\.\s*/)?.[0] || "", { ...style })
                .setVisible(false);
            const hangX = x + numM.width;
            numM.destroy();
            const restT = this._track(this.add.text(hangX, bottom + 2, rest.replace(/^\s+/, ""), {
                ...style,
                wordWrap: { width: Math.max(40, wrap - (hangX - x)) }
            }).setOrigin(0, 0));
            bottom = bottom + 2 + restT.height;
        }
        return bottom;
    }

    _showMpHelp() {
        this._clear();
        this._phase = "mpHelp";
        const w = this.scale.width;
        const h = this.scale.height;
        this._title("Hosting a server");

        const repoUrl = "https://github.com/apotb/cave-paintings";
        const wrap = Math.min(520, w - 48);
        const left = w / 2 - wrap / 2;
        const style = {
            fontFamily: "monospace",
            fontSize: "15px",
            color: "#c0b0a0",
            align: "left",
            lineSpacing: 6,
            wordWrap: { width: wrap }
        };

        let y = h * 0.30;
        const addLine = (text, opts = {}) => {
            const t = this._track(this.add.text(left, y, text, { ...style, ...opts }).setOrigin(0, 0));
            y += t.height + (opts.gapAfter ?? 14);
            return t;
        };

        addLine("1. Use Git to clone the repository:");
        // Indent past the "1. " prefix so the URL sits clearly to the right of the step text
        const numW = (() => {
            const m = this.add.text(0, 0, "1. ", { ...style }).setVisible(false);
            const w = m.width;
            m.destroy();
            return w;
        })();
        const linkIndent = numW + 12;
        const link = this._track(this.add.text(left + linkIndent, y, repoUrl, {
            fontFamily: "monospace",
            fontSize: "15px",
            color: "#d4a84b",
            wordWrap: { width: Math.max(40, wrap - linkIndent) }
        }).setOrigin(0, 0).setInteractive({ useHandCursor: true }));
        link.on("pointerover", () => link.setColor("#ffe08a"));
        link.on("pointerout", () => link.setColor("#d4a84b"));
        link.on("pointerup", () => {
            try {
                window.open(repoUrl, "_blank", "noopener,noreferrer");
            } catch (_) {}
        });
        y += link.height + 18;

        y = this._addCmdLine(
            left, y,
            "2. Run ", "npm install", " when you first clone the repository, or after you update it.",
            style, wrap
        ) + 14;
        y = this._addCmdLine(
            left, y,
            "3. Run ", "npm start", " to start the server.",
            style, wrap
        ) + 14;
        addLine(
            "You are responsible for making the server reachable. Port forward, use a tunnel (ngrok, Cloudflare, etc.), or any similar setup. The address shown on start is a LAN address and is inaccessible unless you are playing LAN on the downloaded client.",
            { gapAfter: 8 }
        );

        this._button(w / 2, Math.min(y + 48, h * 0.88), "Back", () => this._showMpHost());
    }

    _cancelMpProbe() {
        if (this._mpProbe) {
            try {
                this._mpProbe.abort?.();
            } catch (_) {}
            this._mpProbe = null;
        }
        this._mpConnectGen = (this._mpConnectGen || 0) + 1;
        if (this._mpJoinNet) {
            try {
                this._mpJoinNet.close();
            } catch (_) {}
            this._mpJoinNet = null;
        }
    }

    async _probeMultiplayer() {
        const hst = (this.hostInput?.value || "127.0.0.1:21826").trim();
        localStorage.setItem("cp_join_host", hst);
        this._mpHost = hst;
        this._mpPassword = "";
        const url = NetClient.wsUrlFromHostPort(hst);
        this.status?.setColor?.("#c0b0a0");
        this.status?.setText("Connecting…");

        this._cancelMpProbe();
        const gen = this._mpConnectGen;
        const probe = NetClient.probe(url);
        this._mpProbe = probe;
        try {
            await probe;
            if (gen !== this._mpConnectGen || this._phase !== "mpHost") return;
            this._mpProbe = null;
            await this._showCharacters({ next: "join" });
        } catch (e) {
            if (this._mpProbe === probe) this._mpProbe = null;
            if (e?.name === "AbortError" || gen !== this._mpConnectGen) return;
            if (this._phase !== "mpHost") return;
            this.status?.setColor?.("#e06060");
            this.status?.setText(String(e.message || e));
        }
    }

    _isPasswordError(msg) {
        const s = String(msg || "").toLowerCase();
        return s.includes("password");
    }

    async _showMpPassword(opts = {}) {
        this._clear();
        this._phase = "mpPassword";
        const w = this.scale.width;
        const h = this.scale.height;
        this._title("Password");
        this._status();
        this.passInput = this._domInput(
            w / 2 - 140,
            h * 0.40,
            280,
            "",
            opts.drafts?.pass ?? "",
            { type: "password", autocomplete: "current-password" }
        );
        this._clearStatusOnInput(this.passInput);
        if (!opts.relayout) {
            this.time.delayedCall(0, () => this.passInput?.focus?.());
        }
        this._button(w / 2, h * 0.55, "Join", async () => {
            this._mpPassword = this.passInput?.value || "";
            await this._joinMultiplayer();
        });
        this._button(w / 2, this._mediumStackY(h * 0.55, 1), "Back", () => this._showCharacters({ next: "join" }));
    }

    async _showCharacters({ next = null } = {}) {
        this._clear();
        this._phase = "characters";
        this._charNext = next;
        const w = this.scale.width;
        const h = this.scale.height;
        this._title("Characters");
        this._status(0.20);
        this._ensurePlayerAnims();

        let list = [];
        try {
            list = await CharacterStore.list();
        } catch (e) {
            this.status.setText(String(e.message || e));
        }

        const cardW = Math.min(560, w - 48);
        const cardH = 96;
        const gap = 10;
        let y = Math.round(h * 0.26 + cardH / 2);

        for (const c of list.slice(0, 8)) {
            const lookKey = typeof PlayerLook !== "undefined"
                ? PlayerLook.ensure(this, c.look)
                : "human";
            const spr = this.add.sprite(0, 0, lookKey, 1);
            this._placePixelIcon(spr, 0, 0, 3);
            this._track(spr);
            if (typeof PlayerLook !== "undefined") PlayerLook.play(spr, "down", false);

            const activate = async () => {
                this._selectedCharacter = c;
                if (next === "worlds") await this._showWorlds();
                else if (next === "join") await this._joinMultiplayer();
            };

            this._selectCard({
                x: Math.round(w / 2),
                y,
                width: cardW - (cardW % 2),
                height: cardH,
                cardId: `char:${c.id}`,
                iconNode: spr,
                title: c.name || "Player",
                lines: [
                    this._lastPlayedLabel(c)
                ],
                onActivate: activate,
                onRename: () => {
                    this._showRename({
                        kind: "character",
                        id: c.id,
                        currentName: c.name || "Player",
                        maxLen: 24
                    });
                },
                favorited: !!c.favorite,
                onFavorite: async (on) => {
                    try {
                        const row = await CharacterStore.setFavorite(c.id, on);
                        if (this._selectedCharacter?.id === c.id) this._selectedCharacter = row;
                        await this._showCharacters({ next });
                    } catch (e) {
                        this.status?.setText(String(e.message || e));
                    }
                },
                onExport: () => CharacterStore.download(c),
                onDelete: async () => {
                    await CharacterStore.remove(c.id);
                    if (this._selectedCharacter?.id === c.id) this._selectedCharacter = null;
                    await this._showCharacters({ next });
                },
                onHoverActive: (on) => {
                    if (!spr.active) return;
                    if (typeof PlayerLook !== "undefined") PlayerLook.play(spr, "down", on);
                    else spr.setFrame(1);
                }
            });

            y += cardH + gap;
        }

        const footerY = Math.max(y - cardH / 2 + 36, h * 0.90);
        this._listFooter(footerY, {
            onBack: () => {
                if (next === "join") this._showMpHost();
                else this._showRoot();
            },
            onImport: async () => {
                try {
                    const text = await CharacterStore.pickFile();
                    const c = CharacterStore.importJson(text);
                    await CharacterStore.put(c);
                    await this._showCharacters({ next });
                } catch (e) {
                    if (String(e.message) !== "No file") this.status.setText(String(e.message || e));
                }
            },
            onCreate: () => this._showCreateCharacter({ next })
        });
    }

    _createLookNormalized() {
        if (typeof Look !== "undefined") return Look.normalizeLook(this._createLook);
        return this._createLook || {
            head: 0xff00ee,
            eyes: 0x000000,
            arms: 0xff8900,
            shirt: 0x006cff,
            pants: 0xff0000,
            shoes: 0x7a6c47
        };
    }

    _refreshCreatePreview() {
        const spr = this._previewSprite;
        if (!spr?.active || typeof PlayerLook === "undefined") return;
        const look = this._createLookNormalized();
        this._createLook = look;
        PlayerLook.ensure(this, look, { key: PlayerLook.PREVIEW_KEY, replace: true });
        if (spr.texture?.key !== PlayerLook.PREVIEW_KEY) {
            spr.setTexture(PlayerLook.PREVIEW_KEY, 1);
        }
        const facings = ["down", "right", "up", "left"];
        PlayerLook.play(spr, facings[this._createFaceIdx] || "down", true);
        this._paintCreateSwatches();
    }

    _paintCreateSwatches() {
        const look = this._createLookNormalized();
        const part = this._createLookPart || "head";
        for (const row of this._createSwatches || []) {
            const color = look[row.part] >>> 0;
            row.rect.setFillStyle(color, 1);
            row.rect.setStrokeStyle(2, row.part === part ? 0xd4a84b : 0x6a5a4a);
        }
    }

    _syncCreateSliders() {
        this._syncCreateHslFromLook();
    }

    _syncCreateHslFromLook() {
        const L = typeof Look !== "undefined" ? Look : null;
        if (!L) return;
        const look = this._createLookNormalized();
        const part = this._createLookPart || "head";
        const hsl = L.rgbToHsl(look[part]);
        const prev = this._createHsl || hsl;
        // Black/white have no hue — keep the last hue so the rainbow handle doesn't jump.
        this._createHsl = {
            h: hsl.s < 0.001 || hsl.l < 0.001 || hsl.l > 0.999 ? prev.h : hsl.h,
            s: hsl.s,
            l: hsl.l
        };
        this._paintCreateHslBars();
    }

    _copyCreateColor() {
        const look = this._createLookNormalized();
        const part = this._createLookPart || "head";
        const color = look[part] >>> 0;
        this._copiedColor = color;
        const hex = typeof Look !== "undefined" ? Look.css(color) : `#${color.toString(16).padStart(6, "0")}`;
        try {
            navigator.clipboard?.writeText?.(hex);
        } catch (_) {}
    }

    async _pasteCreateColor() {
        let color = this._copiedColor;
        try {
            const text = await navigator.clipboard?.readText?.();
            if (typeof Look !== "undefined" && text) {
                const parsed = Look.parseColor(String(text).trim());
                if (parsed != null) color = parsed;
            }
        } catch (_) {}
        if (color == null) {
            this.status?.setText("Copy a color first.");
            return;
        }
        const part = this._createLookPart || "head";
        this._copiedColor = color >>> 0;
        this._createLook = {
            ...this._createLookNormalized(),
            [part]: color >>> 0
        };
        this._syncCreateHslFromLook();
        this._refreshCreatePreview();
    }

    _applyCreateHsl() {
        const L = typeof Look !== "undefined" ? Look : null;
        if (!L || !this._createHsl) return;
        const part = this._createLookPart || "head";
        const { h, s, l } = this._createHsl;
        this._createLook = {
            ...this._createLookNormalized(),
            [part]: L.hslToRgb(h, s, l)
        };
        this._paintCreateHslBars();
        this._refreshCreatePreview();
    }

    _fillHslBar(g, x, y, w, h, colorAt) {
        g.clear();
        const width = Math.max(1, Math.round(w));
        for (let i = 0; i < width; i++) {
            const t = width <= 1 ? 0 : i / (width - 1);
            g.fillStyle(colorAt(t), 1);
            g.fillRect(x + i, y, 1, h);
        }
        g.lineStyle(2, 0x000000, 1);
        g.strokeRect(x - 1, y - 1, width + 2, h + 2);
    }

    _paintCreateHslBars() {
        const bars = this._createHslBars;
        const L = typeof Look !== "undefined" ? Look : null;
        if (!bars || !L || !this._createHsl) return;
        const { h, s, l } = this._createHsl;
        this._fillHslBar(bars.hue.g, bars.x, bars.hue.y, bars.w, bars.bh, (t) => L.hslToRgb(t * 360, 1, 0.5));
        this._fillHslBar(bars.sat.g, bars.x, bars.sat.y, bars.w, bars.bh, (t) => L.hslToRgb(h, t, l));
        this._fillHslBar(bars.light.g, bars.x, bars.light.y, bars.w, bars.bh, (t) => L.hslToRgb(h, s, t));
        const tHue = Phaser.Math.Clamp(h / 360, 0, 1);
        const tSat = Phaser.Math.Clamp(s, 0, 1);
        const tLight = Phaser.Math.Clamp(l, 0, 1);
        bars.hue.handle.setPosition(Math.round(bars.x + tHue * bars.w), bars.hue.y + bars.bh / 2);
        bars.sat.handle.setPosition(Math.round(bars.x + tSat * bars.w), bars.sat.y + bars.bh / 2);
        bars.light.handle.setPosition(Math.round(bars.x + tLight * bars.w), bars.light.y + bars.bh / 2);
    }

    _hslSetFromPointer(kind, pointer) {
        const bars = this._createHslBars;
        if (!bars || !this._createHsl) return;
        const t = Phaser.Math.Clamp((pointer.worldX - bars.x) / bars.w, 0, 1);
        if (kind === "hue") this._createHsl.h = t * 360;
        else if (kind === "sat") this._createHsl.s = t;
        else this._createHsl.l = t;
        this._applyCreateHsl();
    }

    _bindCreateHslInput() {
        this._unbindCreateHslInput();
        this._onHslMove = (p) => {
            if (!this._hslDrag || !p.isDown) return;
            this._hslSetFromPointer(this._hslDrag, p);
        };
        this._onHslUp = () => { this._hslDrag = null; };
        this.input.on("pointermove", this._onHslMove);
        this.input.on("pointerup", this._onHslUp);
        this.input.on("pointerupoutside", this._onHslUp);
    }

    _makeHslBar(kind, x, y, w, bh) {
        const g = this.add.graphics();
        const hit = this.add.rectangle(x + w / 2, y + bh / 2, w + 8, bh + 10, 0x000000, 0.001)
            .setInteractive({ useHandCursor: true });
        hit.on("pointerdown", (p) => {
            this._hslDrag = kind;
            this._hslSetFromPointer(kind, p);
        });
        const handle = this.add.rectangle(x, y + bh / 2, 5, bh + 8, 0xffffff)
            .setStrokeStyle(2, 0x000000)
            .setDepth(8);
        this._track(g, hit, handle);
        return { g, hit, handle, y };
    }

    _onCreateSliderInput() {
        this._applyCreateHsl();
    }

    _showCreateCharacter({ next = null, drafts = null, relayout = false } = {}) {
        this._clear();
        this._phase = "createCharacter";
        this._charNext = next;
        const w = this.scale.width;
        const h = this.scale.height;
        this._title("New Character");
        this._status(0.94);

        const L = typeof Look !== "undefined" ? Look : null;
        if (drafts?.look) this._createLook = L ? L.normalizeLook(drafts.look) : drafts.look;
        else if (!relayout || !this._createLook) {
            this._createLook = L ? L.normalizeLook(null) : this._createLookNormalized();
        }
        this._createLookPart = drafts?.lookPart || this._createLookPart || "head";

        const facings = ["down", "right", "up", "left"];
        if (typeof drafts?.faceIdx === "number") this._createFaceIdx = drafts.faceIdx;
        else if (!relayout) this._createFaceIdx = 0;

        const previewScale = h < 640 ? 5 : 6;
        const fw = 16;
        const previewH = fw * previewScale;
        const gap = 20;
        const rotateR = 18;
        const swatchH = 22;
        const labelBelow = 16;
        const barH = 16;
        const sliderStep = 26;
        const smallBtnH = this._buttonSizePreset("small").height;
        const nameH = 36;
        const arrowYOff = 10 + rotateR;
        const rowYOff = arrowYOff + rotateR + gap + swatchH / 2;
        const sliderTopOff = rowYOff + swatchH / 2 + labelBelow + gap;
        const copyYOff = sliderTopOff + sliderStep * 2 + barH + gap + smallBtnH / 2;
        const nameYOff = copyYOff + smallBtnH / 2 + gap;
        const contentH = previewH + nameYOff + nameH;

        const titleBottom = Math.round(h * 0.14 + 24);
        const btnH = this._buttonSizePreset("medium").height;
        const btnY = Math.round(h * 0.78);
        const createTop = btnY - btnH / 2;
        const availTop = titleBottom + 12;
        const availBot = createTop - 16;
        const availH = Math.max(contentH, availBot - availTop);
        const footY = Math.round(availTop + (availH - contentH) / 2 + previewH);

        const previewKey = typeof PlayerLook !== "undefined"
            ? PlayerLook.ensure(this, this._createLook, { key: PlayerLook.PREVIEW_KEY, replace: true })
            : "human";
        const spr = this.add.sprite(0, 0, previewKey, 1);
        const footX = Math.floor(w / 2 - (fw * previewScale) / 2);
        spr.setOrigin(0, 1);
        spr.setScale(previewScale);
        spr.setPosition(footX, footY);
        this._pixelFilter(previewKey);
        this._track(spr);
        this._previewSprite = spr;

        const playWalk = () => {
            const facing = facings[this._createFaceIdx];
            if (typeof PlayerLook !== "undefined") PlayerLook.play(spr, facing, true);
        };
        playWalk();

        const arrowY = footY + arrowYOff;
        this._roundArrow(Math.floor(w / 2 - 52), arrowY, "↺", () => {
            this._createFaceIdx = (this._createFaceIdx + 1) % 4;
            playWalk();
        });
        this._roundArrow(Math.floor(w / 2 + 52), arrowY, "↻", () => {
            this._createFaceIdx = (this._createFaceIdx + 3) % 4;
            playWalk();
        });
        this._diceButton(Math.floor(w / 2), arrowY, () => {
            this._createLook = L ? L.randomLook() : this._createLook;
            this._syncCreateHslFromLook();
            this._refreshCreatePreview();
        }, 32);

        const parts = L?.PARTS || ["head", "eyes", "arms", "shirt", "pants", "shoes"];
        const labels = L?.PART_LABELS || {};
        const swatchW = 36;
        const swatchGap = 8;
        const rowW = parts.length * swatchW + (parts.length - 1) * swatchGap;
        const rowX = Math.floor(w / 2 - rowW / 2);
        const rowY = footY + rowYOff;
        this._createSwatches = [];
        parts.forEach((part, i) => {
            const cx = rowX + i * (swatchW + swatchGap) + swatchW / 2;
            const rect = this.add.rectangle(cx, rowY, swatchW, 22, this._createLook[part] >>> 0, 1)
                .setStrokeStyle(2, 0x6a5a4a)
                .setInteractive({ useHandCursor: true });
            const label = this.add.text(cx, rowY + 18, labels[part] || part, {
                fontFamily: "monospace",
                fontSize: "10px",
                color: "#c0b0a0"
            }).setOrigin(0.5, 0);
            rect.on("pointerdown", () => {
                this._createLookPart = part;
                this._paintCreateSwatches();
                this._syncCreateHslFromLook();
            });
            this._track(rect, label);
            this._createSwatches.push({ part, rect });
        });
        this._paintCreateSwatches();

        const sliderW = 280;
        const sliderX = Math.floor(w / 2 - sliderW / 2);
        const sliderTop = footY + sliderTopOff;
        this._createHslBars = {
            x: sliderX,
            w: sliderW,
            bh: barH,
            hue: this._makeHslBar("hue", sliderX, sliderTop, sliderW, barH),
            sat: this._makeHslBar("sat", sliderX, sliderTop + sliderStep, sliderW, barH),
            light: this._makeHslBar("light", sliderX, sliderTop + sliderStep * 2, sliderW, barH)
        };
        this._bindCreateHslInput();
        this._syncCreateHslFromLook();

        const copyY = footY + copyYOff;
        const copyGap = 88;
        this._button(w / 2 - copyGap, copyY, "Copy", () => this._copyCreateColor(), { size: "small" });
        this._button(w / 2 + copyGap, copyY, "Paste", () => this._pasteCreateColor(), { size: "small" });

        const nameVal = drafts?.name != null ? drafts.name : "Player";
        const nameY = footY + nameYOff;
        this.nameInput = this._domInput(w / 2 - 140, nameY, 280, "", nameVal);
        this.nameInput.maxLength = 24;
        this._clearStatusOnInput(this.nameInput);
        if (!relayout) this.nameInput.focus();

        this._button(w / 2, btnY, "Create", async () => {
            try {
                const name = (this.nameInput?.value || "Player").trim() || "Player";
                const c = await CharacterStore.create(name, this._createLookNormalized());
                this._selectedCharacter = c;
                await this._showCharacters({ next: this._charNext });
            } catch (e) {
                this.status?.setText(String(e.message || e));
            }
        });
        this._button(w / 2, this._mediumStackY(btnY, 1), "Back", () => this._showCharacters({ next: this._charNext }));
    }

    async _showWorlds() {
        if (!this._selectedCharacter) {
            await this._showCharacters({ next: "worlds" });
            return;
        }
        this._clear();
        this._phase = "worlds";
        const w = this.scale.width;
        const h = this.scale.height;
        this._title("Worlds");
        this._status(0.20);

        let list = [];
        try {
            list = await WorldStore.list();
        } catch (e) {
            this.status.setText(String(e.message || e));
        }

        const cardW = Math.min(560, w - 48);
        const cardH = 96;
        const gap = 10;
        let y = Math.round(h * 0.26 + cardH / 2);
        const palmKey = this.textures.exists("menu-palm") ? "menu-palm" : null;

        for (const world of list.slice(0, 8)) {
            let icon = null;
            if (palmKey) {
                this._pixelFilter(palmKey);
                icon = this.add.image(0, 0, palmKey);
                this._placePixelIcon(icon, 0, 0, 2);
                this._track(icon);
            }

            this._selectCard({
                x: Math.round(w / 2),
                y,
                width: cardW - (cardW % 2),
                height: cardH,
                cardId: `world:${world.id}`,
                iconNode: icon,
                title: world.name || "World",
                lines: (() => {
                    const clock = this._formatWorldClock(world.clock);
                    return [
                        clock.day,
                        clock.time,
                        this._lastPlayedLabel(world)
                    ];
                })(),
                onActivate: () => this._startSingleplayer(world),
                onRename: () => {
                    this._showRename({
                        kind: "world",
                        id: world.id,
                        currentName: world.name || "World",
                        maxLen: 32
                    });
                },
                favorited: !!world.favorite,
                onFavorite: async (on) => {
                    try {
                        await WorldStore.setFavorite(world.id, on);
                        await this._showWorlds();
                    } catch (e) {
                        this.status?.setText(String(e.message || e));
                    }
                },
                onExport: () => WorldStore.download(world),
                onDelete: async () => {
                    await WorldStore.remove(world.id);
                    await this._showWorlds();
                }
            });

            y += cardH + gap;
        }

        const footerY = Math.max(y - cardH / 2 + 36, h * 0.90);
        this._listFooter(footerY, {
            onBack: () => this._showCharacters({ next: "worlds" }),
            onImport: async () => {
                try {
                    const text = await WorldStore.pickFile();
                    const world = WorldStore.importJson(text);
                    await WorldStore.put(world);
                    await this._showWorlds();
                } catch (e) {
                    if (String(e.message) !== "No file") this.status.setText(String(e.message || e));
                }
            },
            onCreate: () => this._showCreateWorld()
        });
    }

    /** Terrain color for spawn preview (matches generateTile biomes, no trees). */
    _previewTileColor(tx, ty) {
        const inv = 1 / 6000;
        const nx = tx * inv;
        const ny = ty * inv;
        const elevation = octaveNoise2D(nx, ny, 2, 0.5, 2.5, 0);
        const temperature = octaveNoise2D(nx, ny, 3, 0.2, 4.2, 1);
        const river = Math.abs(octaveNoise2D(nx, ny, 3, 1.2, 0.7, 2));
        if (river < 0.005) return 0x3a6ea5;
        if (elevation < -0.2) return temperature < -0.4 ? 0xc8d8e8 : 0x3a6ea5;
        if (river < 0.0065 && elevation < 0.14) return 0x7a7a70;
        if (elevation < -0.19) return temperature < -0.25 ? 0xe8eef2 : 0xc2b280;
        if (elevation < 0.15) {
            if (temperature < -0.25) return 0xeef2f6;
            if (temperature < 0.25) return 0x5a8f4a;
            return 0xc2b280;
        }
        if (elevation < 0.25) {
            if (temperature < -0.25) return 0xdde6ee;
            if (temperature < 0.25) return 0x4a7a3a;
            return 0xb0a070;
        }
        if (elevation < 0.55) {
            if (temperature < -0.25) return 0xd0d8e0;
            if (temperature < 0.25) return 0x6a6a68;
            return 0xa87850;
        }
        if (elevation < 0.7) return 0x6a6a68;
        return 0xd0d8e0;
    }

    _drawSpawnPreview(seed, centerX, centerY) {
        if (this._previewGfx) {
            try {
                this._previewGfx.destroy();
            } catch (_) {}
            this._previewGfx = null;
        }
        if (this._previewFrame) {
            try {
                this._previewFrame.destroy();
            } catch (_) {}
            this._previewFrame = null;
        }

        const s = Number(seed) >>> 0;
        if (typeof noise !== "undefined") noise.seed(s);
        if (typeof worldSeed !== "undefined") worldSeed = s;

        const tiles = 11;
        const px = 10;
        const half = (tiles * px) / 2;
        const worldTs = 16;
        const origin = Math.floor(tiles / 2);

        const frame = this.add.rectangle(centerX, centerY, tiles * px + 8, tiles * px + 8, 0x120e0a, 1)
            .setStrokeStyle(2, 0x2a2218);
        this._track(frame);
        this._previewFrame = frame;

        const g = this.add.graphics();
        const left = centerX - half;
        const top = centerY - half;
        for (let ty = 0; ty < tiles; ty++) {
            for (let tx = 0; tx < tiles; tx++) {
                const wx = (tx - origin) * worldTs;
                const wy = (ty - origin) * worldTs;
                const color = this._previewTileColor(wx, wy);
                g.fillStyle(color, 1);
                g.fillRect(left + tx * px, top + ty * px, px, px);
            }
        }
        // Spawn marker (sign tile at 0,0)
        g.fillStyle(0xe8dcc8, 1);
        g.fillRect(left + origin * px + 3, top + origin * px + 3, px - 6, px - 6);
        this._track(g);
        this._previewGfx = g;
    }

    /** Square button with dice icon (seed reroll). */
    _diceButton(x, y, onClick, size = 36) {
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b; // gold

        const side = Math.max(24, Math.round(size));
        const rect = this.add.rectangle(0, 0, side, side, BG, 1)
            .setStrokeStyle(2, OUTLINE)
            .setInteractive({ useHandCursor: true });

        const icon = this.add.image(0, 0, "ui-dice");
        this._pixelFilter("ui-dice");
        const tw = icon.frame?.realWidth || icon.width || 16;
        const th = icon.frame?.realHeight || icon.height || 16;
        // Largest integer scale that fits, then 2× for readability (keep crisp pixels)
        const texScale = Math.max(1, Math.floor((side - 4) / Math.max(tw, th))) * 2;
        this._placePixelIcon(icon, 0, 0, texScale);

        const root = this.add.container(Math.floor(x), Math.floor(y), [rect, icon]);
        let hovering = false;
        let pressing = false;
        const paint = () => {
            if (pressing) {
                rect.setFillStyle(BG_PRESS, 1);
                rect.setStrokeStyle(2, OUTLINE_PRESS);
            } else if (hovering) {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(2, OUTLINE_HOVER);
            } else {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(2, OUTLINE);
            }
        };
        rect.on("pointerover", () => {
            hovering = true;
            paint();
        });
        rect.on("pointerout", () => {
            hovering = false;
            pressing = false;
            paint();
        });
        rect.on("pointerdown", () => {
            pressing = true;
            paint();
        });
        rect.on("pointerup", () => {
            const was = pressing;
            pressing = false;
            paint();
            if (was && hovering) onClick?.();
        });
        this._track(root);
        return root;
    }

    _showCreateWorld({ drafts = null, relayout = false } = {}) {
        this._clear();
        this._phase = "createWorld";
        const w = this.scale.width;
        const h = this.scale.height;
        this._title("Create");
        this._status();

        let seed;
        if (drafts?.seed != null && Number.isFinite(Number(drafts.seed))) {
            seed = Number(drafts.seed) >>> 0;
        } else {
            seed = WorldStore.findPlayableSeed(WorldStore.randomSeed());
        }

        const previewX = Math.round(w / 2);
        const previewY = Math.round(h * 0.34);
        this._drawSpawnPreview(seed, previewX, previewY);

        const formLeft = w / 2 - 140;
        const formW = 280;
        const nameY = h * 0.52;
        const rowOffset = 44;

        const worldName = drafts?.worldName != null ? drafts.worldName : "New World";
        this.worldNameInput = this._domInput(formLeft, nameY, formW, "", worldName);
        this.worldNameInput.maxLength = 32;
        this._clearStatusOnInput(this.worldNameInput);

        const inputH = this.worldNameInput.offsetHeight || 36;
        const gap = Math.max(4, rowOffset - inputH);
        const diceSize = inputH;
        const seedW = Math.max(120, formW - gap - diceSize);
        const seedY = nameY + rowOffset;

        this.seedInput = this._domInput(formLeft, seedY, seedW, "", String(seed));
        // Right edge of dice = right edge of name box; gap matches name↔seed spacing
        this._diceButton(
            formLeft + formW - diceSize / 2,
            seedY + inputH / 2,
            () => {
                seed = WorldStore.findPlayableSeed(WorldStore.randomSeed());
                if (this.seedInput) this.seedInput.value = String(seed);
                this._drawSpawnPreview(seed, previewX, previewY);
            },
            diceSize
        );

        const refreshPreviewFromInput = () => {
            const raw = Number(this.seedInput?.value);
            if (!Number.isFinite(raw)) return;
            seed = raw >>> 0;
            this._drawSpawnPreview(seed, previewX, previewY);
        };
        this.seedInput.addEventListener("input", refreshPreviewFromInput);
        this.seedInput.addEventListener("change", refreshPreviewFromInput);
        if (!relayout) this.worldNameInput.focus();

        this._button(w / 2, h * 0.72, "Create", async () => {
            try {
                const name = (this.worldNameInput?.value || "New World").trim() || "New World";
                let s = Number(this.seedInput?.value);
                if (!Number.isFinite(s)) s = WorldStore.randomSeed();
                s = WorldStore.findPlayableSeed(s >>> 0);
                await WorldStore.create(name, { seed: s });
                await this._showWorlds();
            } catch (e) {
                this.status?.setText(String(e.message || e));
            }
        });
        this._button(w / 2, this._mediumStackY(h * 0.72, 1), "Back", () => this._showWorlds());
    }

    async _startSingleplayer(world) {
        if (this._startingSp) return;
        const character = this._selectedCharacter;
        if (!character || !world) return;
        this._startingSp = true;
        this.status?.setText("Loading…");
        this._cleanupDomOnly();
        try {
            const freshChar = await CharacterStore.get(character.id) || character;
            const freshWorld = await WorldStore.get(world.id) || world;
            const net = new LocalSim({ world: freshWorld, character: freshChar });
            try {
                const welcome = await net.connect();
                this._clear();
                this.scene.start("SceneMain", {
                    net,
                    welcome,
                    displayName: freshChar.name,
                    characterId: freshChar.id,
                    character: freshChar,
                    localWorldId: freshWorld.id,
                    worldName: freshWorld.name,
                    joinHost: "local"
                });
            } catch (e) {
                await net.close();
                this.status?.setText(String(e.message || e));
                this._startingSp = false;
            }
        } catch (e) {
            this.status?.setText(String(e.message || e));
            this._startingSp = false;
        }
    }

    async _joinMultiplayer() {
        const character = this._selectedCharacter;
        if (!character) {
            this.status?.setText("Pick a character first.");
            return;
        }
        const host = this._mpHost || localStorage.getItem("cp_join_host") || "127.0.0.1:21826";
        const password = this._mpPassword || "";
        this.status?.setColor?.("#c0b0a0");
        this.status?.setText("Connecting…");
        this._cancelMpProbe();
        const gen = this._mpConnectGen;
        const net = new NetClient();
        this._mpJoinNet = net;
        const url = NetClient.wsUrlFromHostPort(host);
        const snap = CharacterStore.toJoinSnapshot(character);
        try {
            const welcome = await net.connect(url, {
                characterId: character.id,
                displayName: character.name,
                password,
                character: snap
            });
            if (gen !== this._mpConnectGen || this._mpJoinNet !== net) {
                try { net.close(); } catch (_) {}
                return;
            }
            this._mpJoinNet = null;
            this._clear();
            this.scene.start("SceneMain", {
                net,
                welcome,
                displayName: character.name,
                characterId: character.id,
                character,
                worldName: welcome?.worldName,
                joinHost: host
            });
        } catch (e) {
            if (this._mpJoinNet === net) this._mpJoinNet = null;
            try { net.close(); } catch (_) {}
            if (e?.name === "AbortError" || gen !== this._mpConnectGen) return;
            const msg = String(e.message || e);
            if (this._isPasswordError(msg)) {
                await this._showMpPassword();
                if (msg.toLowerCase().includes("bad")) {
                    this.status?.setColor?.("#e06060");
                    this.status?.setText(msg);
                }
                return;
            }
            // Only show errors on the screen that started the join
            if (this._phase !== "characters" && this._phase !== "mpPassword") return;
            this.status?.setColor?.("#e06060");
            this.status?.setText(msg);
        }
    }

    _cleanupDomOnly() {
        for (const o of this._dom) {
            if (o && o.tagName) {
                try {
                    o.remove();
                } catch (_) {}
            }
        }
        this._dom = this._dom.filter((o) => o && !o.tagName);
        this.hostInput = this.passInput = this.nameInput = this.worldNameInput = this.seedInput = this.renameInput = null;
        this._syncKeyboardForDom();
    }

    shutdown() {
        if (this._resizeTimer) {
            clearTimeout(this._resizeTimer);
            this._resizeTimer = null;
        }
        if (this._onResize) {
            this.scale.off("resize", this._onResize);
            this._onResize = null;
        }
        this._clear();
        if (this._onMenuKeydown) {
            document.removeEventListener("keydown", this._onMenuKeydown, true);
            this._onMenuKeydown = null;
        }
        if (this.game?.canvas) this.game.canvas.tabIndex = 0;
        if (this.input?.keyboard) this.input.keyboard.enabled = true;
    }
}
