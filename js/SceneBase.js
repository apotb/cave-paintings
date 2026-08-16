class SceneBase extends Phaser.Scene {
    constructor(config) {
        super(config || { key: "SceneBase" });
    }

    loadImage(key, type='tiles', path=null) {
        path = path || key;
        this.load.image(key, `assets/${type}/${path}.png`);
    }

    preload() {
        // SceneMain used to assign the Load UI button to this.load, which clobbers
        // Phaser's LoaderPlugin and breaks the next SceneMain boot. Restore if needed.
        if (this.sys?.load && this.load !== this.sys.load) {
            this.load = this.sys.load;
        }
        // Second Play → Leave → Play: textures/json already live in the game caches.
        if (this.cache?.json?.exists?.("items") && this.cache?.json?.exists?.("structures") && this.textures?.exists("grass") && this.textures?.exists("slot")) {
            return;
        }
        // Data
        this.load.json("items", "data/Items.json");
        this.load.json("things", "data/Things.json");
        this.load.json("structures", "data/Structures.json");
        this.load.json("bodyPlans", "data/BodyPlans.json");
        this.load.json("injuries", "data/Injuries.json");
        this.load.json("hediffs", "data/Hediffs.json");
        // Queue thing textures once JSON arrives (spritesheet if `anim`, else image)
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

        // Player part sheets (composited at runtime); Human mob uses assets/mobs/human.png
        if (typeof PlayerLook !== "undefined") PlayerLook.loadParts(this);

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
            "help",
            "help_hover",
            "help_open",
            "help_alt",
            "help_alt_hover",
            "help_alt_open",
            "health",
            "health_hover",
            "health_open",
            "status2",
            "leader"
        ];
        for (const ui of uis) {
            this.loadImage(ui, 'ui');
        }

        // Health doll part masks (black silhouettes in status_parts/)
        const statusParts = [
            "Brain", "Head", "Heart", "Jaw", "Tongue", "Nose",
            "Left_Eye", "Right_Eye", "Left_Ear", "Right_Ear",
            "Neck", "Torso", "Waist", "Spine", "Ribcage", "Sternum", "Stomach", "Liver", "Pelvis", "Skull",
            "Left_Lung", "Right_Lung", "Left_Kidney", "Right_Kidney",
            "Left_Shoulder", "Right_Shoulder", "Left_Clavicle", "Right_Clavicle",
            "Left_Arm", "Right_Arm", "Left_Humerus", "Right_Humerus", "Left_Radius", "Right_Radius",
            "Left_Hand", "Right_Hand",
            "Left_Thumb", "Right_Thumb", "Left_Index_Finger", "Right_Index_Finger",
            "Left_Middle_Finger", "Right_Middle_Finger", "Left_Ring_Finger", "Right_Ring_Finger",
            "Left_Pinky_Finger", "Right_Pinky_Finger",
            "Left_Leg", "Right_Leg", "Left_Femur", "Right_Femur", "Left_Tibia", "Right_Tibia",
            "Left_Foot", "Right_Foot",
            "Left_Big_Toe", "Right_Big_Toe", "Left_Second_Toe", "Right_Second_Toe",
            "Left_Middle_Toe", "Right_Middle_Toe", "Left_Fourth_Toe", "Right_Fourth_Toe",
            "Left_Little_Toe", "Right_Little_Toe"
        ];
        for (const part of statusParts) {
            this.loadImage(`status_part_${part}`, "ui", `status_parts/${part}`);
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
            "raw_venison",
            "roasted_venison",
            "coconut",
            "cactus_flower",
            "blueberries",
            "leaf_cord",
            "sharp_stick",
            "wooden_spear",
            "stone_spear",
            "flint_spear",
            "stick_frame",
            "leaf_wrap",
            "leaf_loincloth",
            "leaf_sandals",
            "leaf_pouch",
            "hide_pouch",
            "hide_bundle",
            "hide_tunic",
            "hide_loincloth",
            "leather_pouch",
            "leather_pack",
            "leather_tunic",
            "leather_kilt",
            "cracked_coconut",
            "cracked_coconut_overlay",
            "rot",
            "pebble",
            "flint",
            "deer_hide",
            "deer_hide_fleshed",
            "deer_hide_dry",
            "deer_hide_soaked",
            "deer_hide_dehaired",
            "deer_hide_brained",
            "deer_leather",
            "brain",
            "bone",
            "stick",
            "log",
            "lean_to"
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
        const want = (typeof Hide !== "undefined" && Hide.canonicalItemId)
            ? Hide.canonicalItemId(id)
            : id;
        return this.items().find(i => i?.id === want);
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