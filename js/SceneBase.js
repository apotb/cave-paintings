class SceneBase extends Phaser.Scene {
    constructor() {
        super({ key: "SceneBase" });
    }

    loadImage(key, type='tiles', path=null) {
        path = path || key;
        this.load.image(key, `assets/${type}/${path}.png`);
    }

    preload() {
        // Data
        this.load.json("items", "data/Items.json");
        this.load.json("things", "data/Things.json");
        // Queue thing textures once JSON arrives (spritesheet if `anim`, else image)
        this.load.once("filecomplete-json-things", (_key, _type, data) => {
            for (const t of data) {
                if (!t?.key) continue;
                const path = `assets/things/${t.key}.png`;
                if (t.anim) {
                    this.load.spritesheet(t.key, path, {
                        frameWidth: t.anim.frameWidth ?? 16,
                        frameHeight: t.anim.frameHeight ?? 16
                    });
                } else {
                    this.load.image(t.key, path);
                }
            }
        });

        // Player (before mobs so shared keys like "player" are already queued)
        this.load.spritesheet("player", "assets/player/player.png", {
            frameWidth: 16,
            frameHeight: 16
        });

        this.load.json("mobs", "data/Mobs.json");
        // Queue mob textures (skip keys already queued/loaded, e.g. player)
        this.load.once("filecomplete-json-mobs", (_key, _type, data) => {
            for (const m of data) {
                if (!m?.key) continue;
                if (m.key === "player") continue;
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

        // UI
        const uis = [
            "slot",
            "active_slot",
            "status",
            "bar_icons",
            "craft",
            "craft_hover",
            "craft_open",
            "equipment",
            "equipment_hover",
            "equipment_open",
            "save",
            "save_hover",
            "save_open",
            "load",
            "load_hover",
            "load_open",
            "help",
            "help_hover",
            "help_click"
        ];
        for (const ui of uis) {
            this.loadImage(ui, 'ui');
        }

        // Tiles
        this.load.spritesheet("water", "assets/tiles/water.png", {
            frameWidth: 16,
            frameHeight: 16
        });
        const tiles = [
            "sand",
            "grass",
            "bridge",
            "ice",
            "road",
            "snow",
            "snow_beach",
            "grass_hill",
            "sand_hill",
            "snow_hill",
            "mesa",
            "mountain",
            "snow_mountain",
            "gravel"
        ];
        for (const tile of tiles) {
            this.loadImage(tile, 'tiles');
        }

        // Items
        const items = [
            "blueberry",
            "apple",
            "roasted_apple",
            "raw_beef",
            "roast_beef",
            "coconut",
            "cactus_flower",
            "blueberries",
            "leaf_cord",
            "sharp_stick",
            "wood_spear",
            "stick_frame",
            "leaf_wrap",
            "leaf_loincloth",
            "leaf_sandals",
            "leaf_pouch",
            "cracked_coconut",
            "cracked_coconut_overlay",
            "rot"
        ];
        for (const item of items) {
            this.loadImage(item, 'items');
        }
    }

    create() {}

    update() {
        if (this.isPaused) return;
    }

    items() {
        return this.cache.json.get("items");
    }

    getItem(id) {
        return this.items().find(i => i?.id === id);
    }

    things() {
        return this.cache.json.get("things");
    }

    getThing(id) {
        return this.things().find(i => i?.id === id);
    }

    mobsData() {
        return this.cache.json.get("mobs");
    }

    getMob(id) {
        return this.mobsData()?.find(m => m?.id === id);
    }
}