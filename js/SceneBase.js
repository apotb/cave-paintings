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

        // Player
        this.load.spritesheet("player", "assets/player/player.png", {
            frameWidth: 16,
            frameHeight: 16
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
            "save",
            "save_hover",
            "save_open",
            "load",
            "load_hover",
            "load_open"
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

        // Things
        const things = [
            "tree",
            "cactus",
            "rock",
            "snow_tree",
            "palm_tree",
            "sticks",
            "apple_tree",
            "coconut_tree",
            "flowering_cactus",
            "bush",
            "blueberry_bush",
            "snow_bush",
            "leaves"
        ];
        for (const thing of things) {
            this.loadImage(thing, 'things');
        }

        // Items
        const items = [
            "blueberry",
            "apple",
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
            "cracked_coconut"
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
}