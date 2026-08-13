/**
 * Networked play scene — server-authoritative world with client prediction.
 */
class SceneNet extends Phaser.Scene {
    constructor() {
        super({ key: "SceneNet" });
    }

    init(data) {
        this.net = data.net;
        this.welcome = data.welcome;
        this.displayName = data.displayName;
    }

    preload() {
        this.load.json("items", "data/Items.json");
        this.load.json("things", "data/Things.json");
        this.load.json("mobs", "data/Mobs.json");
        if (typeof PlayerLook !== "undefined") PlayerLook.loadParts(this);

        this.load.once("filecomplete-json-things", (_key, _type, data) => {
            for (const t of data) {
                if (!t?.key) continue;
                const loads = (typeof Place !== "undefined" && Place.thingImageLoads)
                    ? Place.thingImageLoads(t)
                    : [{ key: t.key, path: `assets/things/${t.key}.png` }];
                for (const load of loads) {
                    if (load.spritesheet) {
                        this.load.spritesheet(load.key, load.path, {
                            frameWidth: load.frameWidth ?? 16,
                            frameHeight: load.frameHeight ?? 16
                        });
                    } else {
                        this.load.image(load.key, load.path);
                    }
                }
            }
        });

        this.load.once("filecomplete-json-mobs", (_key, _type, data) => {
            for (const m of data) {
                if (!m?.key || m.key === "player") continue;
                if (this.textures.exists(m.key)) continue;
                const path = `assets/mobs/${m.key}.png`;
                if (m.anim) {
                    this.load.spritesheet(m.key, path, {
                        frameWidth: m.anim.frameWidth ?? 16,
                        frameHeight: m.anim.frameHeight ?? 16
                    });
                } else {
                    this.load.image(m.key, path);
                }
            }
        });

        this.load.spritesheet("water", "assets/tiles/water.png", {
            frameWidth: 16,
            frameHeight: 16
        });
        for (const tile of [
            "sand", "grass", "bridge", "ice", "road", "snow", "snow_beach",
            "grass_hill", "sand_hill", "snow_hill", "mesa", "mountain",
            "snow_mountain", "gravel"
        ]) {
            this.load.image(tile, `assets/tiles/${tile}.png`);
        }

        for (const item of [
            "apple", "blueberry", "blueberries", "roasted_apple",
            "raw_beef", "roast_beef", "raw_venison", "roasted_venison", "coconut",
            "flint", "pebble", "deer_hide", "deer_hide_fleshed", "deer_hide_dry",
            "deer_hide_soaked", "deer_hide_dehaired", "deer_hide_brained", "deer_leather",
            "brain", "bone", "stick", "log", "hide_pouch"
        ]) {
            this.load.image(item, `assets/items/${item}.png`);
        }
    }

    create() {
        this.tileSize = NetProtocol.TILE_SIZE;
        this.chunkSize = NetProtocol.CHUNK_SIZE;
        this.chunkPx = this.chunkSize * this.tileSize;
        this.chunks = new Map();
        this.tileGrid = new Map(); // "tx,ty" -> tile key (for local collision)
        this.remotePlayers = new Map();
        this.mobSprites = new Map();
        this.dropSprites = new Map();
        this.groundLayer = this.add.layer().setDepth(0);
        this.mainLayer = this.add.layer().setDepth(1);
        this.uiLayer = this.add.layer().setDepth(100);

        this.WALK_SPEED = 80;
        this.SPRINT = 1.55;
        this.BLOCKED = new Set(["water", "ice"]);
        this._serverX = 0;
        this._serverY = 0;
        this._moveInput = { x: 0, y: 0, sprint: false };

        this._ensureAnims();

        const you = this.welcome?.you || {};
        this.playerId = this.welcome?.playerId;
        this.pawn = {
            x: you.x || 0,
            y: you.y || 0,
            facing: you.facing || "down",
            inventory: you.inventory || [],
            hotbarIndex: you.hotbarIndex || 0,
            kc: you.kc ?? 1200,
            saturation: you.saturation ?? 0,
            stomach: you.stomach ?? 1600,
            hp: you.hp ?? 100,
            mhp: you.mhp ?? 100,
            dead: !!you.dead,
            name: you.name || this.displayName,
            eating: !!you.eatChannel,
            look: you.look || null
        };
        this._serverX = this.pawn.x;
        this._serverY = this.pawn.y;

        const lookKey = typeof PlayerLook !== "undefined"
            ? PlayerLook.ensure(this, this.pawn.look)
            : "human";
        this.playerSprite = this.add.sprite(this.pawn.x, this.pawn.y, lookKey, 0);
        this.playerSprite.setOrigin(0, 1);
        this.mainLayer.add(this.playerSprite);
        this.cameras.main.startFollow(this.playerSprite, true, 0.2, 0.2);
        this.cameras.main.setZoom(3);
        this.cameras.main.setRoundPixels(true);

        this.cursors = this.input.keyboard.createCursorKeys();
        this.keys = this.input.keyboard.addKeys("W,A,S,D,SHIFT,SPACE,E,Q,F,ONE,TWO,THREE,FOUR,FIVE");
        this.chatOpen = false;

        this.hud = this.add.text(12, 12, "", {
            fontFamily: "monospace",
            fontSize: "12px",
            color: "#ffffff",
            backgroundColor: "#00000088",
            padding: { x: 6, y: 4 }
        }).setScrollFactor(0).setDepth(200);
        this.uiLayer.add(this.hud);

        this.logLines = [];
        this.logText = this.add.text(12, this.scale.height - 120, "", {
            fontFamily: "monospace",
            fontSize: "12px",
            color: "#e0d0c0",
            backgroundColor: "#00000066",
            padding: { x: 6, y: 4 },
            wordWrap: { width: 420 }
        }).setScrollFactor(0).setDepth(200).setOrigin(0, 1);
        this.uiLayer.add(this.logText);

        this.channelBar = this.add.graphics().setScrollFactor(0).setDepth(201);
        this.uiLayer.add(this.channelBar);
        this._channelProg = null;

        this._bindNet();
        this.net.flushAndListen();
        this.net.sendAction({ type: NetProtocol.Actions.RESYNC });
        this._pushLog(this.welcome?.motd || "Connected.");
        this._refreshHud();

        this.input.keyboard.on("keydown-ENTER", () => this._promptChat());
    }

    _ensureAnims() {
        if (typeof PlayerLook !== "undefined") {
            PlayerLook.ensure(this, this.pawn?.look);
        }
        if (this.textures.exists("deer") && !this.anims.exists("deer-walk-down")) {
            const ranges = { down: [0, 2], left: [3, 5], right: [6, 8], up: [9, 11] };
            for (const [dir, [start, end]] of Object.entries(ranges)) {
                this.anims.create({
                    key: `deer-walk-${dir}`,
                    frames: this.anims.generateFrameNumbers("deer", { start, end }),
                    frameRate: 5,
                    repeat: -1,
                    yoyo: true
                });
                this.anims.create({
                    key: `deer-idle-${dir}`,
                    frames: [{ key: "deer", frame: start + 1 }],
                    frameRate: 10
                });
            }
        }
    }

    _bindNet() {
        const net = this.net;
        net.on(NetProtocol.Types.CHUNK, (payload) => this._applyChunk(payload));
        net.on(NetProtocol.Types.SNAPSHOT, (payload) => this._applySnapshot(payload));
        net.on(NetProtocol.Types.YOU, (payload) => this._applyYou(payload));
        net.on(NetProtocol.Types.EVENT, (payload) => this._applyEvent(payload));
        net.on("close", () => {
            this._pushLog("Disconnected from server.");
        });
    }

    _pushLog(line) {
        this.logLines.push(line);
        if (this.logLines.length > 8) this.logLines.shift();
        this.logText.setText(this.logLines.join("\n"));
        this.logText.y = this.scale.height - 12;
    }

    _refreshHud() {
        const p = this.pawn;
        const inv = (p.inventory || [])
            .map((s, i) => {
                const mark = i === p.hotbarIndex ? ">" : " ";
                if (!s) return `${mark}${i + 1}:-`;
                return `${mark}${i + 1}:${s.id}×${s.quantity || 1}`;
            })
            .join("  ");
        this.hud.setText(
            [
                `${p.name}  HP ${Math.ceil(p.hp)}/${p.mhp}${p.dead ? " DEAD" : ""}`,
                `Hunger ${Math.ceil(p.kc)}/${p.stomach}  Sat ${Math.ceil(p.saturation)}`,
                inv,
                "WASD move | Space attack | E pickup | Q drop | 1-5 hotbar | Enter chat | /heal"
            ].join("\n")
        );
    }

    /** Stats / inventory only — never hard-snap pose (that caused spasms). */
    _applyYou(you) {
        if (!you) return;
        Object.assign(this.pawn, {
            inventory: you.inventory,
            hotbarIndex: you.hotbarIndex,
            kc: you.kc,
            saturation: you.saturation,
            stomach: you.stomach,
            hp: you.hp,
            mhp: you.mhp,
            dead: you.dead,
            name: you.name,
            eating: !!you.eatChannel
        });
        if (you.eatChannel) this._channelProg = you.eatChannel.progress;
        else if (this._channelProg != null && !you.eatChannel) this._channelProg = null;
        // Hard snap only on death/respawn or huge desync
        if (typeof you.x === "number" && typeof you.y === "number") {
            const dist = Math.hypot(you.x - this.pawn.x, you.y - this.pawn.y);
            if (you.dead || dist > 64) {
                this.pawn.x = you.x;
                this.pawn.y = you.y;
                this._serverX = you.x;
                this._serverY = you.y;
                this.playerSprite.setPosition(you.x, you.y);
            }
        }
        this._refreshHud();
    }

    _applyChunk(meta) {
        if (!meta) return;
        const key = `${meta.x},${meta.y}`;
        this._destroyChunkVisual(key);
        const container = this.add.container(0, 0);
        this.groundLayer.add(container);
        const ts = this.tileSize;
        const cs = this.chunkSize;
        const ox = meta.x * this.chunkPx;
        const oy = meta.y * this.chunkPx;

        // Clear old tile keys for this chunk
        for (let ly = 0; ly < cs; ly++) {
            for (let lx = 0; lx < cs; lx++) {
                this.tileGrid.delete(`${ox + lx * ts},${oy + ly * ts}`);
            }
        }

        for (let i = 0; i < (meta.tiles || []).length; i++) {
            const lx = i % cs;
            const ly = (i / cs) | 0;
            const tile = meta.tiles[i] || "grass";
            const wx = ox + lx * ts;
            const wy = oy + ly * ts;
            this.tileGrid.set(`${wx},${wy}`, tile);
            const keyTex = this.textures.exists(tile) ? tile : "grass";
            const img = this.add.image(wx, wy, keyTex, 0).setOrigin(0, 0);
            container.add(img);
        }
        for (const t of [...(meta.things || []), ...(meta.lootableThings || [])]) {
            const tex = this.textures.exists(t.id) ? t.id : null;
            if (!tex) continue;
            const img = this.add.image(t.x, t.y, tex).setOrigin(0.5, 1);
            container.add(img);
        }
        this.chunks.set(key, { meta, container });
        this._refreshDrops(meta);
        this._ensureAnims();
    }

    _destroyChunkVisual(key) {
        const prev = this.chunks.get(key);
        if (prev?.container) prev.container.destroy(true);
        this.chunks.delete(key);
    }

    _refreshDrops(meta) {
        const prefix = `${meta.x},${meta.y}:`;
        for (const [id, spr] of [...this.dropSprites.entries()]) {
            if (id.startsWith(prefix)) {
                spr.destroy();
                this.dropSprites.delete(id);
            }
        }
        (meta.drops || []).forEach((d, i) => {
            const id = `${prefix}${i}`;
            let tex = d.id;
            if (!this.textures.exists(tex) && tex === "blueberry" && this.textures.exists("blueberries")) {
                tex = "blueberries";
            }
            if (!this.textures.exists(tex)) tex = "apple";
            const spr = this.add.image(d.x, d.y, tex)
                .setOrigin(0.5, 0.5)
                .setScale(0.75);
            this.mainLayer.add(spr);
            this.dropSprites.set(id, spr);
        });
    }

    _tileAt(wx, wy) {
        const ts = this.tileSize;
        const tx = Math.floor(wx / ts) * ts;
        const ty = Math.floor(wy / ts) * ts;
        return this.tileGrid.get(`${tx},${ty}`) || null;
    }

    _isBlockedLocal(wx, wy) {
        const tile = this._tileAt(wx, wy);
        if (tile && this.BLOCKED.has(tile)) return true;
        return false;
    }

    _reconcileLocal(sx, sy, facing, dead) {
        this._serverX = sx;
        this._serverY = sy;
        this.pawn.facing = facing || this.pawn.facing;
        this.pawn.dead = !!dead;
        const dx = sx - this.pawn.x;
        const dy = sy - this.pawn.y;
        const dist = Math.hypot(dx, dy);
        if (dead || dist > 48) {
            this.pawn.x = sx;
            this.pawn.y = sy;
            this.playerSprite.setPosition(sx, sy);
            return;
        }
        // Soft pull toward server — avoid fighting prediction
        if (dist > 2) {
            this.pawn.x += dx * 0.18;
            this.pawn.y += dy * 0.18;
        }
    }

    _applySnapshot(snap) {
        if (!snap) return;
        const seen = new Set();
        for (const rp of snap.players || []) {
            seen.add(rp.id);
            if (rp.id === this.playerId) {
                this._reconcileLocal(rp.x, rp.y, rp.facing, rp.dead);
                continue;
            }
            let entry = this.remotePlayers.get(rp.id);
            if (!entry) {
                const lookKey = typeof PlayerLook !== "undefined"
                    ? PlayerLook.ensure(this, rp.look)
                    : "human";
                const spr = this.add.sprite(rp.x, rp.y, lookKey, 0).setOrigin(0, 1);
                spr.setTint(0xa0c0ff);
                this.mainLayer.add(spr);
                const label = this.add.text(rp.x, rp.y - 18, rp.name || "?", {
                    fontFamily: "monospace",
                    fontSize: "10px",
                    color: "#cde"
                }).setOrigin(0.5, 1);
                this.mainLayer.add(label);
                entry = { spr, label, x: rp.x, y: rp.y, tx: rp.x, ty: rp.y };
                this.remotePlayers.set(rp.id, entry);
            }
            entry.tx = rp.x;
            entry.ty = rp.y;
            entry.facing = rp.facing || "down";
            entry.dead = rp.dead;
            entry.label.setText(rp.name || "?");
            entry.spr.setAlpha(1);
            // Dead players leave a corpse — no translucent ghost puppet
            entry.spr.setVisible(!rp.dead);
            entry.label.setVisible(!rp.dead);
        }
        for (const [id, entry] of this.remotePlayers) {
            if (!seen.has(id)) {
                entry.spr.destroy();
                entry.label.destroy();
                this.remotePlayers.delete(id);
            }
        }
        if (snap.drops) {
            for (const spr of this.dropSprites.values()) spr.destroy();
            this.dropSprites.clear();
            snap.drops.forEach((d, i) => {
                const id = `snap:${i}`;
                let tex = d.id;
                if (tex === "blueberry" && !this.textures.exists(tex) && this.textures.exists("blueberries")) {
                    tex = "blueberries";
                }
                if (!this.textures.exists(tex)) tex = "apple";
                const spr = this.add.image(d.x, d.y, tex).setOrigin(0.5).setScale(0.75);
                this.mainLayer.add(spr);
                this.dropSprites.set(id, spr);
            });
        }
        if (snap.mobs) {
            const seenM = new Set();
            for (const m of snap.mobs) {
                seenM.add(m.id);
                let entry = this.mobSprites.get(m.id);
                const tex = this.textures.exists(m.kind) ? m.kind
                    : (this.textures.exists("deer") ? "deer" : null);
                if (!entry) {
                    let spr;
                    if (tex) {
                        spr = this.add.sprite(m.x, m.y, tex, 1).setOrigin(0, 1);
                        const idleKey = `${tex}-idle-down`;
                        if (this.anims.exists(idleKey)) spr.play(idleKey, true);
                    } else {
                        spr = this.add.circle(m.x, m.y, 5, 0x88aa55);
                    }
                    this.mainLayer.add(spr);
                    entry = { spr, x: m.x, y: m.y, tx: m.x, ty: m.y, kind: m.kind, facing: "down" };
                    this.mobSprites.set(m.id, entry);
                }
                entry.tx = m.x;
                entry.ty = m.y;
                entry.kind = m.kind;
            }
            for (const [id, entry] of this.mobSprites) {
                if (!seenM.has(id)) {
                    entry.spr.destroy();
                    this.mobSprites.delete(id);
                }
            }
        }
    }

    _applyEvent(ev) {
        if (!ev) return;
        if (ev.kind === "chat" && ev.text) this._pushLog(ev.text);
        if (ev.kind === "damage" && ev.targetId === this.playerId) {
            this._pushLog(`You took ${ev.amount} damage.`);
        }
        if (ev.kind === "channel" && ev.playerId === this.playerId) {
            this._channelProg = ev.done ? null : ev.progress;
        }
        if (ev.kind === "player_left") {
            const e = this.remotePlayers.get(ev.playerId);
            if (e) {
                e.spr.destroy();
                e.label.destroy();
                this.remotePlayers.delete(ev.playerId);
            }
        }
    }

    _promptChat() {
        if (this.chatOpen) return;
        this.chatOpen = true;
        const text = window.prompt("Chat / command", "");
        this.chatOpen = false;
        if (text == null || text === "") return;
        this.net.sendAction({ type: NetProtocol.Actions.CHAT, text });
    }

    _drawChannel() {
        this.channelBar.clear();
        if (this._channelProg == null) return;
        const w = 80;
        const h = 8;
        const x = this.scale.width / 2 - w / 2;
        const y = this.scale.height / 2 + 40;
        this.channelBar.fillStyle(0x000000, 0.6);
        this.channelBar.fillRect(x - 1, y - 1, w + 2, h + 2);
        this.channelBar.fillStyle(0x222222, 0.9);
        this.channelBar.fillRect(x, y, w, h);
        this.channelBar.fillStyle(0x7ec850, 1);
        this.channelBar.fillRect(x, y, w * Phaser.Math.Clamp(this._channelProg, 0, 1), h);
    }

    _lerpRemotes(dt) {
        const t = Math.min(1, dt * 12);
        for (const entry of this.remotePlayers.values()) {
            entry.x = Phaser.Math.Linear(entry.x, entry.tx, t);
            entry.y = Phaser.Math.Linear(entry.y, entry.ty, t);
            entry.spr.setPosition(entry.x, entry.y);
            entry.label.setPosition(entry.x + 8, entry.y - 18);
            const moving = Math.hypot(entry.tx - entry.x, entry.ty - entry.y) > 0.4;
            const facing = entry.facing || "down";
            if (typeof PlayerLook !== "undefined") PlayerLook.play(entry.spr, facing, moving);
            else entry.spr.play(moving ? `walk-${facing}` : `idle-${facing}`, true);
        }
        for (const entry of this.mobSprites.values()) {
            const mdx = entry.tx - entry.x;
            const mdy = entry.ty - entry.y;
            entry.x = Phaser.Math.Linear(entry.x, entry.tx, t);
            entry.y = Phaser.Math.Linear(entry.y, entry.ty, t);
            entry.spr.setPosition(entry.x, entry.y);
            const tex = entry.kind && this.textures.exists(entry.kind) ? entry.kind : null;
            if (!tex || !entry.spr.play) continue;
            const moving = Math.hypot(mdx, mdy) > 0.35;
            if (moving) {
                entry.facing = Math.abs(mdx) > Math.abs(mdy)
                    ? (mdx > 0 ? "right" : "left")
                    : (mdy > 0 ? "down" : "up");
            }
            const facing = entry.facing || "down";
            const key = `${tex}-${moving ? "walk" : "idle"}-${facing}`;
            if (this.anims.exists(key)) entry.spr.play(key, true);
        }
    }

    update(_t, delta) {
        if (!this.net?.connected) return;
        const dt = Math.min(delta, 50) / 1000;
        this._lerpRemotes(dt);

        if (this.pawn.dead) {
            if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) {
                this.net.sendAction({ type: NetProtocol.Actions.RESPAWN });
            }
            this.hud.setText("You died. Press Space to respawn at world spawn.");
            this._drawChannel();
            return;
        }

        let x = 0;
        let y = 0;
        if (this.cursors.left.isDown || this.keys.A.isDown) x -= 1;
        if (this.cursors.right.isDown || this.keys.D.isDown) x += 1;
        if (this.cursors.up.isDown || this.keys.W.isDown) y -= 1;
        if (this.cursors.down.isDown || this.keys.S.isDown) y += 1;
        if (x !== 0 && y !== 0) {
            const inv = 1 / Math.SQRT2;
            x *= inv;
            y *= inv;
        }
        const sprint = this.keys.SHIFT.isDown;
        let facing = this.pawn.facing;
        if (x !== 0 || y !== 0) {
            if (Math.abs(x) > Math.abs(y)) facing = x > 0 ? "right" : "left";
            else facing = y > 0 ? "down" : "up";
        }
        this.pawn.facing = facing;
        this._moveInput = { x, y, sprint };

        this.net.sendMove({ x, y, sprint, facing });

        // Client prediction (matches server SPEED / SPRINT / eat slow)
        let speed = this.WALK_SPEED * (sprint ? this.SPRINT : 1);
        if (this.pawn.eating || this._channelProg != null) speed *= 0.5;
        const nx = this.pawn.x + x * speed * dt;
        const ny = this.pawn.y + y * speed * dt;
        if (!this._isBlockedLocal(nx, this.pawn.y)) this.pawn.x = nx;
        if (!this._isBlockedLocal(this.pawn.x, ny)) this.pawn.y = ny;
        this.playerSprite.setPosition(this.pawn.x, this.pawn.y);
        if (typeof PlayerLook !== "undefined") {
            PlayerLook.play(this.playerSprite, facing, x !== 0 || y !== 0);
        }

        if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) {
            const pointer = this.input.activePointer;
            const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
            const angle = Math.atan2(world.y - this.pawn.y, world.x - this.pawn.x);
            const held = this.pawn.inventory?.[this.pawn.hotbarIndex];
            const foodIds = new Set([
                "apple", "blueberry", "roasted_apple", "raw_beef", "roast_beef",
                "raw_venison", "roasted_venison", "cracked_coconut", "coconut_meal"
            ]);
            if (held && (held.food?.kc > 0 || foodIds.has(held.id))) {
                this.net.sendAction({ type: NetProtocol.Actions.USE });
            } else {
                this.net.sendAction({ type: NetProtocol.Actions.ATTACK, angle });
            }
        }
        if (Phaser.Input.Keyboard.JustDown(this.keys.E) || Phaser.Input.Keyboard.JustDown(this.keys.F)) {
            this.net.sendAction({ type: NetProtocol.Actions.PICKUP });
        }
        if (Phaser.Input.Keyboard.JustDown(this.keys.Q)) {
            this.net.sendAction({
                type: NetProtocol.Actions.DROP,
                amount: this.keys.SHIFT.isDown ? 99 : 1,
                x: this.player?.x,
                y: this.player?.y,
                stack: this.player?.getHeldItem?.()
                    ? {
                        id: this.player.getHeldItem().id,
                        quantity: this.player.getHeldItem().quantity
                    }
                    : null
            });
        }
        const hotKeys = [this.keys.ONE, this.keys.TWO, this.keys.THREE, this.keys.FOUR, this.keys.FIVE];
        for (let i = 0; i < hotKeys.length; i++) {
            if (Phaser.Input.Keyboard.JustDown(hotKeys[i])) {
                this.net.sendAction({ type: NetProtocol.Actions.HOTBAR, index: i });
            }
        }

        this._drawChannel();
    }

    shutdown() {
        this.net?.close();
    }
}
