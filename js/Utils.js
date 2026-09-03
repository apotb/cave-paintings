/**
 * Returns the SceneMain object.
 * @return  {Player}        Player object.
 */
function getScene() {
    return game.scene.scenes[0];
}

/**
 * Returns the player object.
 * @return  {Player}        Player object.
 */
function getPlayer() {
    return getScene().player;
}

/**
 * Returns the number of chunks.
 * @return  {Number}        Number of chunks.
 */
function numChunks() {
    return Object.values(getScene().chunks).length;
}

/**
 * ( ͡° ͜ʖ ͡°)
 */
function superChunkLoadingMachine() {
    const player = getScene().player;
    player.speed = 3.5 * 30;
    player.keys.S.isDown = true;
}

/**
 * Debug: set the in-game clock (keeps the current day).
 * @param {Number} hour    0–23
 * @param {Number} [minute=0]  0–59
 */
function setHour(hour, minute = 0) {
    const scene = getScene();
    const h = ((Math.floor(hour) % 24) + 24) % 24;
    const m = Phaser.Math.Clamp(Math.floor(minute), 0, 59);
    if (scene.isNet && scene.net?.connected) {
        scene.net.sendAction({
            type: NetProtocol.Actions.CHAT,
            text: `/time ${h} ${m}`
        });
        return `Requesting Day ${scene.gameDay} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}…`;
    }
    scene.gameMinutes = h * 60 + m;
    scene._lightSig = null; // force veil redraw
    scene.updateClockText();
    scene.updateTimeTint();
    return scene.clockText?.text ?? `${h}:${m}`;
}

/**
 * Debug: set world clock tick speed (spoilage, campfires, plant regrow, etc.).
 * @param {Number} [mult]  Omit to read current. 1 = normal, 60 ≈ 1 game hour/sec, 0 = pause.
 * @returns {Number|String}
 * @example setTickSpeed(60)
 * @example setTickSpeed(1)
 */
function setTickSpeed(mult) {
    const scene = getScene();
    if (mult == null || mult === "") {
        return scene.tickSpeed ?? 1;
    }
    const m = Number(mult);
    if (!Number.isFinite(m) || m < 0) {
        return `Invalid speed "${mult}". Use setTickSpeed(1) for normal, 0 to pause.`;
    }
    if (scene.isNet && scene.net?.connected) {
        scene.net.sendAction({
            type: NetProtocol.Actions.CHAT,
            text: `/tick ${m}`
        });
        return `Requesting tick speed ${m}×…`;
    }
    const speed = scene.setTickSpeed(m);
    if (speed === 0) return "Tick speed: paused (0)";
    const delay = Math.max(1, 1000 / speed);
    return `Tick speed: ${speed}× (${delay.toFixed(0)} ms / game minute)`;
}

/**
 * Debug: apply a cut/bruise to a body part (default: random limb).
 * @param {Number} [severity=8]
 * @param {String} [partName] e.g. "Left Arm"
 * @param {"cut"|"bruise"} [type="cut"]
 * @example injureMe(12, "Torso")
 */
function injureMe(severity = 8, partName = null, type = "cut") {
    const scene = getScene();
    const player = scene.player;
    if (!player?.anatomy) return "No player anatomy";
    const defs = scene.cache.json.get("injuries") || {};
    const idef = type === "bruise" ? defs.bruise : defs.cut;
    let part = partName ? player.anatomy.part(partName) : player.anatomy.rollLimb();
    if (!part) return `Unknown part "${partName}"`;
    const dmg = Math.max(0.1, Number(severity) || 8);
    part.injure({
        id: idef?.id || type,
        name: idef?.name || type,
        severity: dmg,
        permanent: false,
        bleeding: (Number(idef?.bleedRate) || 0) > 0,
        bleedRate: Number(idef?.bleedRate) || 0,
        painPerSeverity: Number(idef?.painPerSeverity) || 0.0125,
        tended: false,
        tendQuality: 0,
        scarPending: false,
        scarSeverity: 0
    });
    player.onBodyDamaged?.(null, { damage: dmg, part });
    scene.combatLog?.push(`Debug: ${dmg} ${idef?.name || type} on ${part.name}`);
    return `${part.name}: ${part.hp().toFixed(1)}/${Number(part.mhp).toFixed(1)}`;
}

/**
 * Debug: add an item to the player inventory.
 * @param {String} [id]       Item id from Items.json (omit to list ids)
 * @param {Number} [amount=1]
 * @returns {String}
 * @example giveItem("apple", 5)
 * @example giveItem("sharp_stick")
 */
function giveItem(id, amount = 1) {
    const scene = getScene();
    const all = (scene.items() || []).filter(i => i?.id);
    if (id == null || id === "") {
        return all.map(i => i.id).join(", ");
    }
    const item = scene.getItem(id);
    if (!item) {
        return `Unknown item "${id}". Try giveItem() for a list.`;
    }
    const n = Math.max(1, Math.floor(Number(amount) || 1));
    // Bypass encumbrance for debug: temporarily raise strength
    const player = scene.player;
    const prev = player.strength;
    player.strength = Math.max(prev, 9999);
    const left = player.gainItem(item, n);
    player.strength = prev;
    scene.hotbar.dirty = true;
    const got = n - left;
    if (got <= 0) return `Could not add ${item.name} (inventory full?)`;
    if (left > 0) return `Gave ${got}× ${item.name} (${left} left over)`;
    return `Gave ${got}× ${item.name}`;
}

/**
 * Debug: spawn a damageable dummy in front of the player (for weapon tests).
 * @example spawnDummy()
 */
function spawnDummy() {
    const scene = getScene();
    const player = scene.player;
    const c = player.bodyCenter();
    const face = player.facing;
    let dx = 0, dy = 24;
    if (face === "right") { dx = 24; dy = 0; }
    else if (face === "left") { dx = -24; dy = 0; }
    else if (face === "up") { dx = 0; dy = -24; }

    const dummy = new Mob(scene, c.x + dx, c.y + dy, "rock");
    dummy.hp = 40;
    dummy.mhp = 40;
    dummy.setOrigin(0.5, 0.5);
    dummy.setDepth(dummy.y);
    scene.add.existing(dummy);
    scene.physics.add.existing(dummy);
    scene.mainLayer.add(dummy);
    scene.damageables.add(dummy);
    dummy.onDeath = () => {
        scene.damageables.remove(dummy, true, true);
    };
    return `Dummy ${dummy.hp} HP at (${Math.round(dummy.x)}, ${Math.round(dummy.y)})`;
}

/**
 * Round up to the nearest even number.
 * @param   {Number} num    Number to round up.
 * @return  {Number}        The rounded number.
 */
function roundUpToEven(num) {
    let x = Math.ceil(num);
    return (x % 2 === 0) ? x : x + 1;
}

/** Yoster (PrimaryFont) is an 8px-cell pixel face — other sizes warp stems. */
const PIXEL_UI_FONT = "PrimaryFont";
const PIXEL_FONT_CELL = 8;

function pixelUiFontSize(basePx, scale) {
    const cell = PIXEL_FONT_CELL;
    const raw = Math.max(cell, (Number(basePx) || cell) * (Number(scale) || 1));
    return Math.max(cell, Math.round(raw / cell) * cell);
}

/**
 * Draw Yoster at a snapped pixel size (scale 1). extraScale is only for
 * world HUD under camera zoom (pass 1/worldZoom) — never bake GUI scale into
 * GameObject.scale or the glyphs go bilinear-soft.
 */
function applyPixelUiFont(text, basePx, uiScale, extraScale = 1) {
    if (!text) return 1;
    const px = pixelUiFontSize(basePx, uiScale);
    const extraN = Number(extraScale);
    const extra = Number.isFinite(extraN) && extraN !== 0 ? extraN : 1;
    const sizeStr = `${px}px`;
    const curSize = String(text.style?.fontSize ?? "");
    const fontChanged = curSize !== sizeStr && curSize !== String(px);
    const familyChanged = text.style?.fontFamily !== PIXEL_UI_FONT;
    const scaleChanged = Math.abs((text.scaleX || 1) - extra) > 1e-6
        || Math.abs((text.scaleY || 1) - extra) > 1e-6;
    if (familyChanged) text.setFontFamily?.(PIXEL_UI_FONT);
    if (fontChanged) text.setFontSize(sizeStr);
    if (scaleChanged) text.setScale(extra);
    crispUiText(text);
    text._pixelUiCrisp = px;
    return extra;
}

/** Screen-sized glyphs in the zoomed world camera: rasterize at GUI size, scale 1/zoom. */
function applyPixelUiWorldFont(text, basePx, scene) {
    const s = scene?.uiScale || 1;
    const zoom = scene?.worldZoom || scene?.cameras?.main?.zoom || 1;
    return applyPixelUiFont(text, basePx, s, 1 / zoom);
}

function clampTextureWrap(texture) {
    if (!texture || typeof Phaser === "undefined") return texture;
    const gl = texture.manager?.game?.renderer?.gl;
    if (!gl) return texture;
    for (const src of texture.source || []) {
        const glTex = src?.glTexture;
        if (!glTex?.webGLTexture) continue;
        if (glTex.wrapS === gl.CLAMP_TO_EDGE && glTex.wrapT === gl.CLAMP_TO_EDGE) continue;
        glTex.wrapS = gl.CLAMP_TO_EDGE;
        glTex.wrapT = gl.CLAMP_TO_EDGE;
        try {
            gl.activeTexture(gl.TEXTURE0);
            const current = gl.getParameter(gl.TEXTURE_BINDING_2D);
            gl.bindTexture(gl.TEXTURE_2D, glTex.webGLTexture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            if (current) gl.bindTexture(gl.TEXTURE_2D, current);
        } catch (_) {}
    }
    return texture;
}

/** Phaser uses REPEAT on power-of-two images; UV 1.0 then wraps the opposite edge in. */
function hookPixelTextureClamp(scene) {
    const mgr = scene?.textures;
    if (!mgr || mgr._clampWrapHooked) return;
    mgr._clampWrapHooked = true;
    const apply = (key, texture) => {
        try {
            clampTextureWrap(texture || (mgr.exists(key) ? mgr.get(key) : null));
        } catch (_) {}
    };
    try {
        for (const key of mgr.getTextureKeys()) apply(key);
    } catch (_) {}
    mgr.on("addtexture", (key, texture) => apply(key, texture));
}

function crispUiText(text) {
    if (!text) return text;
    text.setFontFamily?.(PIXEL_UI_FONT);
    if (text.context) text.context.imageSmoothingEnabled = false;
    try { text.setResolution?.(1); } catch (_) {}
    const tex = text.texture;
    if (tex?.setFilter && typeof Phaser !== "undefined") {
        tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    return text;
}

/** Place UI text so the glyph quad’s top-left sits on whole pixels. */
function placeUiText(text, x, y, originX = 0, originY = 0) {
    if (!text) return text;
    text.setOrigin(originX, originY);
    const w = text.displayWidth || text.width || 0;
    const h = text.displayHeight || text.height || 0;
    const left = Math.round(x - w * originX);
    const top = Math.round(y - h * originY);
    text.setPosition(left + w * originX, top + h * originY);
    return text;
}

/**
 * Center a label on the opaque ink of the glyph, not the font’s metrics box.
 * Needed for symbols like ↺/↻ whose em-box is taller/wider than the stroke.
 */
function placeUiTextInkCentered(text, cx, cy) {
    if (!text) return text;
    text.setOrigin(0, 0);
    const dw = text.width || 0;
    const dh = text.height || 0;
    const fallback = () => {
        text.setPosition(Math.round(cx - dw / 2), Math.round(cy - dh / 2));
        return text;
    };
    const canvas = text.canvas;
    const ctx = text.context;
    if (!canvas || !ctx || !dw || !dh) return fallback();
    const cw = canvas.width;
    const ch = canvas.height;
    if (!cw || !ch) return fallback();
    let data;
    try {
        data = ctx.getImageData(0, 0, cw, ch).data;
    } catch (_) {
        return fallback();
    }
    let minX = cw;
    let minY = ch;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
            if (data[(y * cw + x) * 4 + 3] < 40) continue;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    }
    if (maxX < 0) return fallback();
    const sx = dw / cw;
    const sy = dh / ch;
    const inkCx = (minX + maxX + 1) / 2 * sx;
    const inkCy = (minY + maxY + 1) / 2 * sy;
    text.setPosition(Math.round(cx - inkCx), Math.round(cy - inkCy));
    return text;
}

/**
 * Mulberry32 pseudorandom number generator
 * @param  {Number} a  The seed value (32-bit integer)
 * @return {Function}  A function that, when called, returns a
 *                     deterministic pseudorandom float in [0, 1)
 * @see https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript
 */
function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

/**
 * Returns a hash code from a string
 * @param  {String} str The string to hash.
 * @return {Number}    A 32bit integer
 * @see http://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
 */
function hashCode(str) {
    let hash = 0;
    for (let i = 0, len = str.length; i < len; i++) {
        let chr = str.charCodeAt(i);
        hash = (hash << 5) - hash + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}

/**
 * Thomas Wang's 32-bit integer hash functions
 * @param  {Number} x    The X coordinate
 * @param  {Number} y    The Y coordinate
 * @param  {Number} seed A world seed to offset results
 * @return {Number}      A 32-bit unsigned integer
 * @see http://web.archive.org/web/20071223173210/http://www.cris.com/~Ttwang/tech/inthash.htm
 */
function hash2D(x, y, seed) {
    let h = x * 374761393 + y * 668265263 + seed * 0x9e3779b1;
    h = (h ^ (h >> 13)) * 1274126177;
    h ^= h >> 16;
    return h >>> 0;
}

/**
 * Formats a number of hours into "Xd Yh" or "Xh".
 * @param   {Number} hours  The number of hours.
 * @return  {String}        A formatted string (e.g. "5d 3h", "12h").
 */
function formatHours(hours) {
    const h = Math.max(0, Math.floor(hours));
    if (h === 0) return "<1h";
    const d = Math.floor(h / 24);
    const remH = h % 24;
    if (d > 0) return `${d}d${remH ? ` ${remH}h` : ""}`;
    return `${remH}h`;
}

/**
 * Amount to move on a quick-transfer (right-click).
 * Default 1; Shift = whole stack; Ctrl = half (at least 1).
 * @param {number} quantity
 * @param {Phaser.Input.Pointer|null} pointer
 * @param {Phaser.Scene|null} scene
 */
function quickMoveAmount(quantity, pointer = null, scene = null) {
    const q = Math.max(0, Math.floor(Number(quantity) || 0));
    if (q <= 0) return 0;
    const ev = pointer?.event;
    const shift = !!(ev?.shiftKey || scene?.player?.keys?.SHIFT?.isDown);
    const ctrl = !!(ev?.ctrlKey || scene?.player?.keys?.CTRL?.isDown);
    if (shift) return q;
    if (ctrl) return Math.max(1, Math.floor(q / 2));
    return 1;
}

/**
 * Derive crafted item weights from recipe ingredients (recursive).
 * Mutates items in place. Skips REQUIRE_THING; divides by QUANTITY.
 * Items with weightFixed keep their authored weight.
 * @param {Object[]} items
 */
function resolveCraftedWeights(items) {
    if (typeof Carry !== "undefined" && Carry.resolveCraftedWeights) {
        Carry.resolveCraftedWeights(items);
        return;
    }
    if (!Array.isArray(items)) return;
    const byId = new Map();
    for (const item of items) {
        if (item?.id) byId.set(item.id, item);
    }
    const resolving = new Set();
    const resolved = new Map();

    function weightOf(id) {
        if (resolved.has(id)) return resolved.get(id);
        const item = byId.get(id);
        if (!item) {
            console.warn(`resolveCraftedWeights: missing item "${id}"`);
            resolved.set(id, 0);
            return 0;
        }
        if (!item.recipe || item.weightFixed) {
            const w = Number(item.weight) || 0;
            resolved.set(id, w);
            return w;
        }
        if (resolving.has(id)) {
            console.warn(`resolveCraftedWeights: cycle at "${id}"`);
            const w = Number(item.weight) || 0;
            resolved.set(id, w);
            return w;
        }
        resolving.add(id);
        let quantity = 1;
        let sum = 0;
        for (const [k, v] of Object.entries(item.recipe)) {
            if (k === "QUANTITY") {
                quantity = +v || 1;
                continue;
            }
            if (typeof Carry !== "undefined" && Carry.isRecipeMetaKey) {
                if (Carry.isRecipeMetaKey(k)) continue;
            } else if (k === "REQUIRE_THING") continue;
            if (v && typeof v === "object" && v.hideStage) {
                const stage = String(v.hideStage);
                const qty = +v.qty || 1;
                let n = 0;
                let hideSum = 0;
                for (const other of items) {
                    if (other?.hide?.stage === stage && !other.recipe) {
                        hideSum += Number(other.weight) || 0;
                        n += 1;
                    }
                }
                if (n) sum += (hideSum / n) * qty;
                continue;
            }
            const qty = (v && typeof v === "object") ? (+v.qty || 1) : (+v || 1);
            sum += weightOf(k) * qty;
        }
        resolving.delete(id);
        const w = Math.round((sum / Math.max(1, quantity)) * 100) / 100;
        item.weight = w;
        resolved.set(id, w);
        return w;
    }

    for (const item of items) {
        if (item?.id) weightOf(item.id);
    }
}

/**
 * Derive crafted item fuel.kj from recipe ingredients (recursive).
 * Mutates items in place. Skips REQUIRE_THING; divides by QUANTITY.
 * Authored fuel.kj on a craftable (or fuelFixed) is an override; otherwise inherit.
 * Adds fuel when the derived sum > 0.
 * @param {Object[]} items
 */
function resolveCraftedFuel(items) {
    if (typeof Carry !== "undefined" && Carry.resolveCraftedFuel) {
        Carry.resolveCraftedFuel(items);
        return;
    }
    if (!Array.isArray(items)) return;
    const byId = new Map();
    for (const item of items) {
        if (item?.id) byId.set(item.id, item);
    }
    const resolving = new Set();
    const resolved = new Map();

    function hasKjOverride(item) {
        return !!(item.fuelFixed || (item.fuel && Object.prototype.hasOwnProperty.call(item.fuel, "kj")));
    }

    function fuelKjOf(id) {
        if (resolved.has(id)) return resolved.get(id);
        const item = byId.get(id);
        if (!item) {
            console.warn(`resolveCraftedFuel: missing item "${id}"`);
            resolved.set(id, 0);
            return 0;
        }
        if (!item.recipe || hasKjOverride(item)) {
            const kj = Number(item.fuel?.kj) || 0;
            resolved.set(id, kj);
            return kj;
        }
        if (resolving.has(id)) {
            console.warn(`resolveCraftedFuel: cycle at "${id}"`);
            const kj = Number(item.fuel?.kj) || 0;
            resolved.set(id, kj);
            return kj;
        }
        resolving.add(id);
        let quantity = 1;
        let sum = 0;
        for (const [k, v] of Object.entries(item.recipe)) {
            if (k === "QUANTITY") {
                quantity = +v || 1;
                continue;
            }
            if (typeof Carry !== "undefined" && Carry.isRecipeMetaKey) {
                if (Carry.isRecipeMetaKey(k)) continue;
            } else if (k === "REQUIRE_THING") continue;
            if (v && typeof v === "object" && v.hideStage) {
                const stage = String(v.hideStage);
                const qty = +v.qty || 1;
                let n = 0;
                let hideSum = 0;
                for (const other of items) {
                    if (other?.hide?.stage === stage && !other.recipe) {
                        hideSum += Number(other.fuel?.kj) || 0;
                        n += 1;
                    }
                }
                if (n) sum += (hideSum / n) * qty;
                continue;
            }
            const qty = (v && typeof v === "object") ? (+v.qty || 1) : (+v || 1);
            sum += fuelKjOf(k) * qty;
        }
        resolving.delete(id);
        const kj = Math.round(sum / Math.max(1, quantity));
        if (kj > 0) {
            if (!item.fuel) item.fuel = {};
            item.fuel.kj = kj;
        }
        resolved.set(id, kj);
        return kj;
    }

    for (const item of items) {
        if (item?.id) fuelKjOf(item.id);
    }
}

/**
 * Day/night keyframes (minutes from midnight).
 * - darkness: black veil (night / low sun). Keep day near 0.
 * - wash: warm/cool tint strength. Colors should be fairly deep — pale washes bleach the scene.
 */
const TIME_TINT_KEYS = [
    { t: 0,    color: 0x0a1020, darkness: 0.94, wash: 0.00 }, // night
    { t: 300,  color: 0x0a1020, darkness: 0.94, wash: 0.00 }, // 05:00
    { t: 360,  color: 0xa85830, darkness: 0.28, wash: 0.22 }, // 06:00 dawn
    { t: 420,  color: 0xb87048, darkness: 0.10, wash: 0.14 }, // 07:00
    { t: 540,  color: 0x8898a8, darkness: 0.02, wash: 0.05 }, // 09:00 morning
    { t: 660,  color: 0xc8c0b0, darkness: 0.00, wash: 0.02 }, // 11:00
    { t: 840,  color: 0xc8c0b0, darkness: 0.00, wash: 0.02 }, // 14:00 day
    { t: 1020, color: 0xb87838, darkness: 0.06, wash: 0.12 }, // 17:00
    { t: 1050, color: 0xc86820, darkness: 0.10, wash: 0.20 }, // 17:30 golden
    { t: 1080, color: 0xb05018, darkness: 0.16, wash: 0.18 }, // 18:00
    { t: 1140, color: 0x804028, darkness: 0.34, wash: 0.12 }, // 19:00 evening
    { t: 1200, color: 0x483868, darkness: 0.58, wash: 0.08 }, // 20:00
    { t: 1230, color: 0x1a2038, darkness: 0.80, wash: 0.03 }, // 20:30
    { t: 1260, color: 0x0a1020, darkness: 0.94, wash: 0.00 }, // 21:00 night
    { t: 1440, color: 0x0a1020, darkness: 0.94, wash: 0.00 }
];

/**
 * Stick-roast (or other method) recipe for an input item id.
 * @param {Function} getItem
 * @param {String} inputId
 * @param {String} method  e.g. "stick_roast"
 * @returns {{ result: string, minutes: number }|null}
 */
function getCookRecipe(getItem, inputId, method) {
    if (!inputId || !method) return null;
    const recipe = getItem(inputId)?.cook?.[method];
    if (!recipe?.result || !(recipe.minutes > 0)) return null;
    return recipe;
}

const SIMMER_INGREDIENTS = new Set(["apple", "blueberry", "raw_beef", "raw_venison", "raw_pork"]);
const SIMMER_MINUTES_PER_SLOT = 5;

function isSimmerIngredient(itemId) {
    return SIMMER_INGREDIENTS.has(itemId);
}

/**
 * Name/stats for a coconut shell simmer dish from ingredient item ids.
 * @param {Function} getItem
 * @param {String[]} ingredientIds
 * @param {Object} coconutMeta  cracked coconut item def
 * @returns {{ name: string, kind: string, kc: number, spoilHours: number, weight: number, fillTint: number }}
 */
function getSimmerDishInfo(getItem, ingredientIds, coconutMeta) {
    const ids = (ingredientIds || []).filter(Boolean);
    const unique = [...new Set(ids)];

    let kind = "mash";
    let name = "Simmered Meal";
    let spoilHours = 24;

    const meats = [];
    if (unique.includes("raw_beef")) meats.push("Beef");
    if (unique.includes("raw_venison")) meats.push("Venison");
    if (unique.includes("raw_pork")) meats.push("Pork");
    const hasMeat = meats.length > 0;
    const hasApple = unique.includes("apple");
    const hasBlue = unique.includes("blueberry");

    if (hasMeat) {
        kind = "stew";
        spoilHours = 36;
        const meatLabel = meats.length > 1 ? "Meat" : meats[0];
        if (hasApple && hasBlue) name = "Hunter's Stew";
        else if (hasApple) name = `Apple and ${meatLabel} Stew`;
        else if (hasBlue) {
            name = `Blueberry and ${meatLabel} Stew`;
            spoilHours = 24;
        } else name = `${meatLabel} Stew`;
    } else if (unique.length === 1 && unique[0] === "blueberry") {
        kind = "mash";
        name = "Blueberry Mash";
        spoilHours = 12;
    } else if (unique.length === 1 && unique[0] === "apple") {
        kind = "simmered";
        name = "Simmered Apples";
        spoilHours = 48;
    } else if (hasBlue && hasApple) {
        kind = "tart";
        name = "Blueberry-Apple Tart";
        spoilHours = 24;
    }

    let kc = 0;
    let weight = Number(coconutMeta?.weight ?? 0);
    for (const id of ids) {
        // Cooking concentrates ingredients: +50% kcal vs raw
        kc += Number(getItem(id)?.food?.kc ?? 0) * 1.5;
        // Water cooks off: ingredient weight counts at half
        weight += Number(getItem(id)?.weight ?? 0) * 0.5;
    }
    // Full coconut is part of the meal (vessel flesh / milk)
    kc += Number(coconutMeta?.food?.kc ?? 0);
    kc = Math.round(kc);
    weight = Math.round(weight * 100) / 100;

    const fillTint = mixIngredientFillTint(getItem, ids);
    return { name, kind, kc, spoilHours, weight, fillTint };
}

const COCONUT_SHELL_KEY = "cracked_coconut";
const COCONUT_FILL_KEY = "cracked_coconut_overlay";

function parseFillColor(c) {
    if (c == null) return null;
    if (typeof c === "number" && Number.isFinite(c)) return c >>> 0;
    if (typeof c === "string") {
        const hex = c.trim().replace(/^#/, "");
        if (/^[0-9a-fA-F]{6}$/.test(hex)) return parseInt(hex, 16);
    }
    return null;
}

/** Average ingredient fillColor values into one Phaser tint. */
function mixIngredientFillTint(getItem, ingredientIds) {
    let r = 0, g = 0, b = 0, n = 0;
    for (const id of ingredientIds || []) {
        const v = parseFillColor(getItem(id)?.fillColor);
        if (v == null) continue;
        r += (v >> 16) & 255;
        g += (v >> 8) & 255;
        b += v & 255;
        n += 1;
    }
    if (!n) return 0xffffff;
    return ((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)) >>> 0;
}

function mealFillTint(stack, getItem) {
    if (stack?.fillTint != null) return stack.fillTint >>> 0;
    if (stack?.ingredients?.length) return mixIngredientFillTint(getItem, stack.ingredients);
    return null;
}

function stackIconKey(meta, stack, scene) {
    if (typeof Place !== "undefined" && Place.itemIconKey && scene?.getThing) {
        const key = Place.itemIconKey(
            meta,
            (id) => scene.getThing(id),
            (k) => scene.textures?.exists?.(k)
        );
        if (key) return key;
    }
    return meta?.key || stack?.id || "";
}

/**
 * Draw stack icon; meals use shell + tinted fill overlay.
 * @param {Phaser.GameObjects.Image} base
 * @param {Phaser.GameObjects.Image|null} overlay
 */
function syncStackIcon(base, overlay, stack, meta, getItem, textures, scale) {
    if (!stack) {
        base.setVisible(false);
        if (overlay) overlay.setVisible(false);
        return;
    }
    const tint = mealFillTint(stack, getItem);
    if (tint != null && overlay && textures.exists(COCONUT_FILL_KEY) && textures.exists(COCONUT_SHELL_KEY)) {
        base.setTexture(COCONUT_SHELL_KEY).setScale(scale).clearTint().setVisible(true);
        overlay.setTexture(COCONUT_FILL_KEY)
            .setScale(scale)
            .setPosition(base.x, base.y)
            .setTint(tint)
            .setVisible(true);
        return;
    }
    // Knapped tools: silhouette cut from the pebble/flint sprite
    let key = stackIconKey(meta, stack, base.scene);
    if (stack.knapIconData && typeof Knapping !== "undefined") {
        const scene = base.scene;
        const knapKey = Knapping.ensureToolTexture(scene, stack);
        if (knapKey && textures.exists(knapKey)) key = knapKey;
    } else if (stack.knapIcon && textures.exists(stack.knapIcon)) {
        key = stack.knapIcon;
    }
    if (textures.exists(key)) {
        base.setTexture(key).setScale(scale).clearTint().setVisible(true);
    } else {
        base.setVisible(false);
    }
    if (overlay) overlay.setVisible(false).clearTint();
}

/** Drag ghost: shell + optional tinted fill (Container). */
function createStackDragIcon(scene, x, y, stack, meta, scale) {
    const tint = mealFillTint(stack, id => scene.getItem(id));
    if (tint != null && scene.textures.exists(COCONUT_FILL_KEY)) {
        const shell = scene.add.image(0, 0, COCONUT_SHELL_KEY).setOrigin(0.5, 0.5).setScale(scale);
        const fill = scene.add.image(0, 0, COCONUT_FILL_KEY).setOrigin(0.5, 0.5).setScale(scale).setTint(tint);
        const cont = scene.add.container(x, y, [shell, fill]).setDepth(1000).setAlpha(0.9);
        scene.uiLayer.add(cont);
        return cont;
    }
    let key = stackIconKey(meta, stack, scene);
    if (stack?.knapIconData && typeof Knapping !== "undefined") {
        const knapKey = Knapping.ensureToolTexture(scene, stack);
        if (knapKey) key = knapKey;
    } else if (stack?.knapIcon && scene.textures.exists(stack.knapIcon)) {
        key = stack.knapIcon;
    }
    if (!scene.textures.exists(key)) return null;
    const img = scene.add.image(x, y, key)
        .setOrigin(0.5, 0.5)
        .setScale(scale)
        .setDepth(1000)
        .setAlpha(0.9);
    scene.uiLayer.add(img);
    return img;
}

/** Max simmer ingredients shown as corner badges on a cooked meal. */
const INGREDIENT_BADGE_MAX = 4;

/**
 * Create pooled images for ingredient corner badges (parent via addFn).
 * @param {Phaser.Scene} scene
 * @param {(img: Phaser.GameObjects.Image) => void} addFn
 * @param {Number} [max]
 * @returns {Phaser.GameObjects.Image[]}
 */
function createIngredientBadges(scene, addFn, max = INGREDIENT_BADGE_MAX) {
    const badges = [];
    for (let i = 0; i < max; i++) {
        const img = scene.add.image(0, 0, "")
            .setOrigin(1, 1)
            .setVisible(false);
        addFn(img);
        badges.push(img);
    }
    return badges;
}

/**
 * Show meal ingredient icons along the bottom of a slot, right → left.
 * @param {Phaser.GameObjects.Image[]} badges
 * @param {Number} rightX   bottom-right anchor (same corner as stack qty)
 * @param {Number} bottomY
 * @param {Number} uiScale
 * @param {Object|null} stack
 * @param {(id: string) => Object|undefined} getItem
 * @param {Phaser.Textures.TextureManager} textures
 */
function syncIngredientBadges(badges, rightX, bottomY, uiScale, stack, getItem, textures) {
    const ids = stack?.ingredients;
    if (!Array.isArray(ids) || !ids.length) {
        for (const b of badges) b.setVisible(false);
        return;
    }
    const s = uiScale || 1;
    const badgeScale = 1 * s;
    const step = 5 * s;
    for (let i = 0; i < badges.length; i++) {
        const badge = badges[i];
        const id = ids[i];
        if (!id) {
            badge.setVisible(false);
            continue;
        }
        const meta = getItem(id);
        const texKey = meta?.key || id;
        if (!textures.exists(texKey)) {
            badge.setVisible(false);
            continue;
        }
        badge.setTexture(texKey)
            .setScale(badgeScale)
            .setPosition(rightX - i * step, bottomY)
            .setVisible(true);
    }
}

function destroyIngredientBadges(badges) {
    if (!badges) return;
    for (const b of badges) b.destroy();
}

/**
 * Build a coconut_meal inventory stack from simmer ingredients.
 */
function makeCoconutMealStack(getItem, ingredientIds, coconutMeta, now = null) {
    const mealMeta = getItem("coconut_meal");
    const info = getSimmerDishInfo(getItem, ingredientIds, coconutMeta);
    const stack = {
        id: mealMeta?.id || "coconut_meal",
        quantity: 1,
        customName: info.name,
        food: {
            kc: info.kc,
            kcFull: info.kc,
            spoil: info.spoilHours,
            satietyRatio: Number(mealMeta?.food?.satietyRatio) || 0.3
        },
        weight: info.weight,
        kind: info.kind,
        fillTint: info.fillTint,
        ingredients: ingredientIds.filter(Boolean).slice()
    };
    if (info.spoilHours > 0) {
        // Campfire cook slot is world-owned (spoilAt); callers without `now` get spoilLeft.
        if (now != null) {
            stack.spoilAt = Math.round(now) + Math.round(info.spoilHours * 60);
        } else {
            stack.spoilLeft = Math.round(info.spoilHours * 60);
        }
    }
    return stack;
}

function mergeDryInto(dest, destCount, addCount, addProgress) {
    if (typeof Hide !== "undefined" && Hide.applyMergedDryProgress) {
        Hide.applyMergedDryProgress(dest, destCount, addCount, addProgress);
    }
}

function mergeSoakInto(dest, destCount, addCount, addProgress) {
    if (typeof Hide !== "undefined" && Hide.applyMergedSoakProgress) {
        Hide.applyMergedSoakProgress(dest, destCount, addCount, addProgress);
    }
}

function mergeTempInto(dest, destCount, addCount, addTemp) {
    if (typeof Fire !== "undefined") Fire.applyMergedStackTemp(dest, destCount, addCount, addTemp);
}

/** Deep-enough clone of an inventory/equipment/loot stack. */
function cloneItemStack(stack) {
    if (!stack) return null;
    const id = (typeof Hide !== "undefined" && Hide.canonicalItemId)
        ? Hide.canonicalItemId(stack.id)
        : stack.id;
    const out = { id, quantity: stack.quantity };
    if (stack.spoilLeft != null) out.spoilLeft = stack.spoilLeft;
    if (stack.spoilAt != null) out.spoilAt = stack.spoilAt;
    if (stack.spoilMinutes != null) out.spoilMinutes = stack.spoilMinutes;
    if (stack.durability != null) out.durability = stack.durability;
    if (stack.dryProgress != null) out.dryProgress = stack.dryProgress;
    if (stack.soakProgress != null) out.soakProgress = stack.soakProgress;
    if (stack.soakDoneAt != null) out.soakDoneAt = stack.soakDoneAt;
    if (typeof Fire !== "undefined") Fire.copyStackTemp(stack, out);
    const extras = mealStackExtras(stack);
    if (extras) Object.assign(out, extras);
    return out;
}

/** Clone stack-level meal/food/knap fields for drop/transfer. */
function mealStackExtras(stack) {
    if (!stack) return null;
    const knap = knapStackExtras(stack);
    const hasExtras = !!(
        stack.customName
        || stack.food
        || stack.ingredients?.length
        || (Number(stack.weight) > 0 && !knap)
        || stack.kind
        || stack.fillTint != null
        || stack.durability != null
        || stack.dryProgress != null
        || stack.soakProgress != null
        || stack.soakDoneAt != null
        || (stack.temp != null && Number(stack.temp) > 20)
        || knap
    );
    if (!hasExtras) return null;
    return {
        customName: stack.customName,
        food: stack.food ? { ...stack.food } : undefined,
        ingredients: stack.ingredients ? stack.ingredients.slice() : undefined,
        weight: knap ? undefined : (Number(stack.weight) > 0 ? stack.weight : undefined),
        kind: stack.kind,
        fillTint: stack.fillTint,
        durability: stack.durability,
        dryProgress: stack.dryProgress,
        soakProgress: stack.soakProgress,
        soakDoneAt: stack.soakDoneAt,
        ...(stack.temp != null && Number(stack.temp) > 20 ? { temp: stack.temp } : {}),
        ...(knap || {})
    };
}

/** Knapped tool instance fields (unique stats — do not merge stacks). */
function knapStackExtras(stack) {
    if (
        !stack?.toolClass
        && stack?.knapDamage == null
        && !stack?.knapMaterial
        && !stack?.knapIconData
        && !stack?.knapQuality
        && !stack?.tooltipExtra
    ) {
        return null;
    }
    const out = {};
    if (stack.toolClass) out.toolClass = stack.toolClass;
    if (stack.sharpness != null) out.sharpness = stack.sharpness;
    if (stack.knapDamage != null) out.knapDamage = stack.knapDamage;
    if (stack.knapMaterial) out.knapMaterial = stack.knapMaterial;
    if (stack.knapQuality) out.knapQuality = stack.knapQuality;
    if (stack.tooltipExtra) out.tooltipExtra = stack.tooltipExtra;
    if (stack.knapIconData) out.knapIconData = stack.knapIconData;
    return out;
}

/** True if a ground drop / stack carries meal or food-override data. */
function hasStackExtras(dropOrStack) {
    return !!(
        dropOrStack?.customName
        || dropOrStack?.food
        || dropOrStack?.ingredients?.length
        || dropOrStack?.stackWeight != null
        || dropOrStack?.kind
        || dropOrStack?.fillTint != null
        || dropOrStack?.toolClass
        || dropOrStack?.knapDamage != null
        || dropOrStack?.knapIconData
        || dropOrStack?.knapQuality
        || dropOrStack?.durability != null
        || dropOrStack?.temp != null
    );
}

/** Quality band → damage multiplier (matches knapped tool bands). */
function knapQualityMult(quality) {
    return { crude: 0.65, rough: 0.95, fine: 1.35 }[quality] || 1;
}

/** Quality band → channel duration (skin / flesh / station craft). Rough is baseline. */
function knapQualityDurationScale(quality) {
    return { crude: 1.25, rough: 1.0, fine: 0.8 }[quality] || 1;
}

/** Flint punches faster than pebble (inverse of the 1.25 combat/chop mult). */
function knapMaterialDurationScale(material) {
    return material === "flint" ? 0.8 : 1;
}

/** Clone weapon meta with tip-quality scaled point damage (tipped spears). */
function weaponMetaWithKnapQuality(meta, stack) {
    if (!meta?.weapon || !stack?.knapQuality) return meta;
    const mult = knapQualityMult(stack.knapQuality);
    if (mult === 1) return meta;
    const attacks = (meta.weapon.attacks || []).map((a) => {
        if (a.id !== "point_stab") return { ...a };
        const dmg = Math.round((Number(a.damage) || 0) * mult * 10) / 10;
        return { ...a, damage: dmg };
    });
    return { ...meta, weapon: { ...meta.weapon, attacks } };
}

function isSpecialStack(stack) {
    return !!(stack && (
        stack.customName
        || stack.food
        || stack.ingredients?.length
        || stack.toolClass
        || stack.knapDamage != null
        || stack.knapIconData
        || stack.durability != null
    ));
}

/**
 * Bottom-of-slot remaining bar (durability or meal leftover). Hidden at 100%.
 * Uses the slot's own origin so hotbar (0,1), campfire (0.5,0.5), and corpse (0,0) all work.
 * Sizes are in source pixels of the slot art (4px strip, 4px inset) so world-scaled
 * panels (campfire / storage / corpse) match the hotbar instead of rounding to world pixels.
 */
function drawSlotConditionBar(gfx, slot, frac) {
    if (!gfx) return;
    gfx.clear();
    if (!slot?.visible || frac == null || !(frac < 1)) return;
    const t = Math.max(0, Math.min(1, frac));
    const slotW = slot.displayWidth;
    const slotH = slot.displayHeight;
    if (!(slotW > 0) || !(slotH > 0)) return;
    const src = slot.width || 64;
    const px = slotW / src;
    const barH = 4 * px;
    const inset = 4 * px;
    const left = slot.x - slotW * (slot.originX ?? 0);
    const top = slot.y - slotH * (slot.originY ?? 0);
    const x = left + inset;
    const maxW = Math.max(0, slotW - inset * 2);
    const y = top + slotH - barH - (gfx.parentContainer ? 0 : 1);
    const h = gfx.parentContainer ? barH : barH + 1;
    const color = (typeof Durability !== "undefined" && Durability.rampBarFillColor)
        ? Durability.rampBarFillColor(t)
        : 0x3CB043;
    if (maxW <= 0) return;
    gfx.fillStyle(color, 1);
    gfx.fillRect(x, y, maxW * t, h);
}

/**
 * Remaining campfire burn time in game minutes (1 kj ≈ 1 minute).
 * Includes the unit already pulled into the fire plus fuel still in slots.
 * @param {Function} getItem  scene.getItem bound or equivalent
 * @param {Array} fuelSlots   [stack|null, stack|null]
 * @param {Number} burnRemaining  minutes left on the currently burning unit
 */
function campfireBurnMinutes(getItem, fuelSlots, burnRemaining = 0, entry = null) {
    if (typeof Fire !== "undefined" && entry) return Fire.burnMinutes(entry, getItem);
    let kj = Math.max(0, burnRemaining || 0);
    for (const stack of fuelSlots || []) {
        if (!stack) continue;
        const item = getItem(stack.id);
        const per = Number(item?.fuel?.kj ?? 0);
        if (per > 0) kj += per * stack.quantity;
    }
    return kj;
}

/**
 * World tint for a given game clock (minutes since midnight).
 * @returns {{ color: number, darkness: number, wash: number }}
 */
function getTimeOfDayTint(minutes) {
    const t = ((minutes % 1440) + 1440) % 1440;
    const keys = TIME_TINT_KEYS;
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
    const a = keys[i];
    const b = keys[Math.min(i + 1, keys.length - 1)];
    const span = b.t - a.t;
    const u = span <= 0 ? 0 : (t - a.t) / span;
    const lerp = (x, y) => x + (y - x) * u;

    const ar = (a.color >> 16) & 255, ag = (a.color >> 8) & 255, ab = a.color & 255;
    const br = (b.color >> 16) & 255, bg = (b.color >> 8) & 255, bb = b.color & 255;

    return {
        color: (Math.round(lerp(ar, br)) << 16)
            | (Math.round(lerp(ag, bg)) << 8)
            | Math.round(lerp(ab, bb)),
        darkness: lerp(a.darkness ?? 0, b.darkness ?? 0),
        wash: lerp(a.wash ?? 0, b.wash ?? 0)
    };
}

/**
 * Standing click tests use a tall AABB from the feet. While lying, x/y is the
 * body center and that same box covers a whole extra tile (90°/270° lean-tos).
 */
function creaturePointerHit(sprite, worldX, worldY) {
    if (!sprite?.active) return false;
    const x = Number(sprite.x) || 0;
    const y = Number(sprite.y) || 0;
    if (sprite._resting || sprite._prone) {
        const w = Math.max(4, (Number(sprite.displayWidth) || 16) * 0.45);
        const h = Math.max(4, (Number(sprite.displayHeight) || 16) * 0.45);
        return Math.abs(worldX - x) <= w && Math.abs(worldY - y) <= h;
    }
    const hs = (Number(sprite.hitboxSize) || 8) + 4;
    return Math.abs(worldX - x) < hs && Math.abs(worldY - y) < hs * 2;
}

/**
 * Resting pawns and the pawn you control are click-through so world Things
 * under them (campfire, basket, bench) can be hovered and opened.
 */
function syncCreatureInputHit(sprite) {
    if (!sprite) return;
    const self = sprite.scene?.player === sprite;
    if (sprite._resting || self) {
        if (sprite.input) sprite.input.enabled = false;
        return;
    }
    if (sprite.input) sprite.input.enabled = true;
}

/**
 * Arcade writes sprite += (body.pos - prevFrame). If prevFrame still has the
 * pre-restore body, that delta is one hitbox (~8px) and the pawn pops half a
 * tile when you take control.
 */
function syncPawnPhysicsPose(sprite) {
    if (!sprite) return;
    const body = sprite.body;
    if (!body) return;
    body.updateFromGameObject?.();
    if (body.prev?.copy && body.position) body.prev.copy(body.position);
    if (body.prevFrame?.copy && body.position) body.prevFrame.copy(body.position);
    if (body.autoFrame?.copy && body.position) body.autoFrame.copy(body.position);
}

/**
 * Standing pose is feet / origin (0,1). A leftover centered origin with
 * `_prone === false` (or the reverse) is the half-tile pop on party switch.
 */
function ensureStandingFeetOrigin(sprite) {
    if (!sprite || sprite._resting) return;
    if (sprite._prone || sprite._downed || sprite.isIncapacitated?.() || sprite.isImmobile?.()) {
        return;
    }
    const w = Number(sprite.width) || 16;
    const h = Number(sprite.height) || 16;
    if (sprite.originX === 0.5 && sprite.originY === 0.5) {
        sprite.x -= w * 0.5;
        sprite.y += h * 0.5;
    }
    if (sprite.originX !== 0 || sprite.originY !== 1) sprite.setOrigin(0, 1);
    if (sprite.rotation) sprite.setRotation(0);
    sprite._prone = false;
    sprite._physX = sprite.x;
    sprite._physY = sprite.y;
    syncPawnPhysicsPose(sprite);
}

/**
 * Lay down like a corpse (right-facing, -90°) without gray tint.
 * Toggles origin between standing (0,1) and prone (0.5, 0.5), preserving world position.
 * @param {Phaser.GameObjects.Sprite} sprite
 * @param {boolean} prone
 */
function setCreatureProne(sprite, prone) {
    if (!sprite) return;
    const want = !!prone;
    if (sprite._resting && !want) return;
    if (!!sprite._prone === want) {
        if (want) {
            sprite.anims?.stop?.();
            if (sprite.texture?.frameTotal > 7) sprite.setFrame(7);
            sprite.setRotation(-Math.PI / 2);
            sprite.clearTint?.();
        } else if (sprite.scaleX !== 1 || sprite.scaleY !== 1) {
            sprite.setScale(1);
        }
        return;
    }

    const w = sprite.width || 16;
    const h = sprite.height || 16;

    if (want) {
        // bottom-left origin → center
        if (sprite.originX !== 0.5 || sprite.originY !== 0.5) {
            sprite.x += w * 0.5;
            sprite.y -= h * 0.5;
            sprite.setOrigin(0.5, 0.5);
        }
        sprite.setRotation(-Math.PI / 2);
        sprite.anims?.stop?.();
        if (sprite.texture?.frameTotal > 7) sprite.setFrame(7);
        sprite.clearTint?.();
        sprite._prone = true;
        if (sprite.body) {
            sprite.body.moves = false;
            sprite.setVelocity?.(0, 0);
        }
    } else {
        sprite.setRotation(0);
        if (sprite.originX === 0.5 && sprite.originY === 0.5) {
            sprite.x -= w * 0.5;
            sprite.y += h * 0.5;
        }
        sprite.setOrigin(0, 1);
        sprite._prone = false;
        if (sprite.body && !sprite._resting) sprite.body.moves = true;
    }
    sprite._physX = sprite.x;
    sprite._physY = sprite.y;
    syncPawnPhysicsPose(sprite);
    syncCreatureInputHit(sprite);
}

/**
 * Lie in a lean-to: centered origin, facing along the bed, scaled down.
 */
function setCreatureRest(sprite, resting, rot) {
    if (!sprite) return;
    const want = !!resting;
    const ang = typeof Sleep !== "undefined" ? Sleep.restRotation(rot) : -Math.PI / 2;
    const scale = want && typeof Sleep !== "undefined" ? Sleep.SCALE : 1;
    const w = sprite.width || 16;
    const h = sprite.height || 16;

    if (!want) {
        if (!sprite._resting) {
            if (sprite.scaleX !== 1 || sprite.scaleY !== 1) sprite.setScale(1);
            return;
        }
        sprite.setScale(1);
        sprite._resting = false;
        if (sprite.body && !sprite._downed && !sprite.isIncapacitated?.() && !sprite.isImmobile?.()) {
            sprite.body.moves = true;
        }
        if (sprite._downed || sprite.isIncapacitated?.() || sprite.isImmobile?.()) {
            sprite.setRotation(-Math.PI / 2);
            sprite._prone = true;
            syncCreatureInputHit(sprite);
            return;
        }
        setCreatureProne(sprite, false);
        return;
    }

    if (sprite.originX !== 0.5 || sprite.originY !== 0.5) {
        sprite.x += w * 0.5;
        sprite.y -= h * 0.5;
        sprite.setOrigin(0.5, 0.5);
    }
    sprite.anims?.stop?.();
    if (sprite.texture?.frameTotal > 7) sprite.setFrame(7);
    sprite.setRotation(ang);
    sprite.setScale(scale);
    sprite.clearTint?.();
    sprite._prone = true;
    sprite._resting = true;
    if (sprite.body) {
        sprite.body.moves = false;
        sprite.setVelocity?.(0, 0);
    }
    syncCreatureInputHit(sprite);
}

/**
 * Keep a sleeper on their slot as body-center (not feet), and stop Arcade from
 * ejecting party members out of the solid lean-to.
 */
function pinRestingCreature(sprite, scene) {
    if (!sprite?._resting) return;
    const sc = scene || sprite.scene;
    const spec = sprite.lastSleep;
    const lean = spec?.uid ? sc?.findLeanToByUid?.(spec.uid) : null;
    const entry = lean?.entry;
    const rot = spec?.rot ?? entry?.rot;
    setCreatureRest(sprite, true, rot);
    if (entry && typeof Sleep !== "undefined") {
        const def = sc?.getThing?.(entry.id) || lean?.meta;
        const pos = Sleep.sleeperWorldPos(entry, spec.slot, sc?.tileSize || 16, def);
        if (typeof sprite.teleport === "function") sprite.teleport(pos.x, pos.y);
        else sprite.setPosition?.(pos.x, pos.y);
        if (sprite.body) {
            sprite.body.moves = false;
            sprite.body.setVelocity?.(0, 0);
            sprite.body.reset?.(pos.x, pos.y);
        }
        sprite._physX = pos.x;
        sprite._physY = pos.y;
    } else if (sprite.body) {
        sprite.body.moves = false;
        sprite.setVelocity?.(0, 0);
    }
    syncCreatureInputHit(sprite);
    sprite.syncSortDepth?.();
}

function pawnIgnoresThing(pawn, thing) {
    return typeof Sleep !== "undefined" && !!Sleep.ignoresThingCollision?.(pawn, thing);
}

function indexThingSprite(scene, thing) {
    if (!scene || !thing) return;
    unindexThingSprite(scene, thing);
    const cells = scene._thingCells || (scene._thingCells = new Map());
    const ts = scene.tileSize || 16;
    const tb = thing.body;
    const left = tb ? tb.left : thing.x;
    const right = tb ? tb.right : thing.x;
    const top = tb ? tb.top : thing.y;
    const bottom = tb ? tb.bottom : thing.y;
    const x0 = Math.floor(left / ts);
    const x1 = Math.floor(right / ts);
    const y0 = Math.floor(top / ts);
    const y1 = Math.floor(bottom / ts);
    const keys = [];
    for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
            const key = `${tx},${ty}`;
            keys.push(key);
            let arr = cells.get(key);
            if (!arr) {
                arr = [];
                cells.set(key, arr);
            }
            arr.push(thing);
        }
    }
    thing._cellKeys = keys;
}

function unindexThingSprite(scene, thing) {
    const keys = thing?._cellKeys;
    if (!keys || !scene?._thingCells) {
        if (thing) thing._cellKeys = null;
        return;
    }
    for (let i = 0; i < keys.length; i++) {
        const arr = scene._thingCells.get(keys[i]);
        if (!arr) continue;
        const idx = arr.indexOf(thing);
        if (idx >= 0) arr.splice(idx, 1);
        if (!arr.length) scene._thingCells.delete(keys[i]);
    }
    thing._cellKeys = null;
}

function forThingsNearAabb(scene, left, right, top, bottom, fn) {
    const cells = scene?._thingCells;
    if (!cells || !cells.size) {
        const things = scene?._things?.getChildren?.();
        if (!things) return false;
        for (let i = 0; i < things.length; i++) {
            if (fn(things[i])) return true;
        }
        return false;
    }
    const ts = scene.tileSize || 16;
    const pad = ts;
    const x0 = Math.floor((left - pad) / ts);
    const x1 = Math.floor((right + pad) / ts);
    const y0 = Math.floor((top - pad) / ts);
    const y1 = Math.floor((bottom + pad) / ts);
    for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
            const arr = cells.get(`${tx},${ty}`);
            if (!arr) continue;
            for (let i = 0; i < arr.length; i++) {
                if (fn(arr[i])) return true;
            }
        }
    }
    return false;
}

function overlappingThingSprite(pawn) {
    const body = pawn?.body;
    const scene = pawn?.scene;
    if (!body || !scene) return null;
    let hit = null;
    forThingsNearAabb(scene, body.left, body.right, body.top, body.bottom, (t) => {
        const tb = t?.body;
        if (!tb || !tb.enable || pawnIgnoresThing(pawn, t)) return false;
        if (body.right > tb.left && body.left < tb.right
            && body.bottom > tb.top && body.top < tb.bottom) {
            hit = t;
            return true;
        }
        return false;
    });
    return hit;
}

function pawnPoseHitsThing(pawn, x, y) {
    return pawnPoseBlocked(pawn, x, y, 0);
}

function pawnTileBlocked(pawn, x, y) {
    const scene = pawn?.scene;
    if (!scene?.worldToTile) return false;
    const { tx, ty } = scene.worldToTile(x, y - 1);
    const key = scene._tileKeyAt?.(tx, ty);
    if (!key) return false;
    if (typeof Place !== "undefined" && Place.BLOCKED && Place.BLOCKED[key]) {
        if ((key === "water" || key === "ice") && typeof Party !== "undefined" && Party.traversesWater?.(pawn)) {
            return false;
        }
        return true;
    }
    return false;
}

/** True if the 8×8 body at (x,y), grown by `pad`, hits a Thing or blocked tile. */
function pawnPoseBlocked(pawn, x, y, pad = 0) {
    const body = pawn?.body;
    const scene = pawn?.scene;
    if (!body || !scene) return false;
    const p = Math.max(0, Number(pad) || 0);
    const dx = x - pawn.x;
    const dy = y - pawn.y;
    const left = body.left + dx - p;
    const right = body.right + dx + p;
    const top = body.top + dy - p;
    const bottom = body.bottom + dy + p;
    if (pawnTileBlocked(pawn, x, y)) return true;
    let hit = false;
    forThingsNearAabb(scene, left, right, top, bottom, (t) => {
        const tb = t?.body;
        if (!tb || !tb.enable || pawnIgnoresThing(pawn, t)) return false;
        if (right > tb.left && left < tb.right && bottom > tb.top && top < tb.bottom) {
            hit = true;
            return true;
        }
        return false;
    });
    return hit;
}

function findFreePawnPose(pawn, maxR = 80) {
    if (!pawn?.body) return null;
    const ox = pawn.x;
    const oy = pawn.y;
    const step = 4;
    const reach = Math.max(step, Number(maxR) || 80);
    for (let r = step; r <= reach; r += step) {
        const n = Math.max(8, Math.round(r));
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const x = ox + Math.cos(a) * r;
            const y = oy + Math.sin(a) * r;
            if (!pawnPoseBlocked(pawn, x, y, 2)) return { x, y };
        }
    }
    const scene = pawn.scene;
    if (!scene?.worldToTile || !scene?.tileCenter) return null;
    const ts = scene.tileSize || 16;
    const start = scene.worldToTile(ox, oy - 1);
    const seen = new Set();
    const q = [{ tx: start.tx, ty: start.ty, d: 0 }];
    seen.add(`${start.tx},${start.ty}`);
    const maxD = Math.max(2, Math.ceil(reach / ts));
    const nbs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (q.length) {
        const c = q.shift();
        const pos = scene.tileCenter(c.tx, c.ty);
        if (pos && !pawnPoseBlocked(pawn, pos.x, pos.y, 2)) return pos;
        if (c.d >= maxD) continue;
        for (let i = 0; i < nbs.length; i++) {
            const ntx = c.tx + nbs[i][0];
            const nty = c.ty + nbs[i][1];
            const k = `${ntx},${nty}`;
            if (seen.has(k)) continue;
            seen.add(k);
            q.push({ tx: ntx, ty: nty, d: c.d + 1 });
        }
    }
    return null;
}

function teleportPawnPose(pawn, x, y) {
    if (!pawn) return;
    if (typeof pawn.teleport === "function") pawn.teleport(x, y);
    else {
        pawn.setPosition?.(x, y);
        pawn._physX = x;
        pawn._physY = y;
    }
    pawn.body?.reset?.(x, y);
}

/** Pop the Arcade body into open space — never into a gap between two solids. */
function nudgePawnOutOfThing(pawn, thing) {
    const tb = thing?.body;
    const body = pawn?.body;
    if (!tb || !body) return false;
    const pad = 3;
    const hw = (body.right - body.left) * 0.5;
    const hh = (body.bottom - body.top) * 0.5;
    const offX = pawn.x - body.center.x;
    const offY = pawn.y - body.center.y;
    const tcx = (tb.left + tb.right) * 0.5;
    const tcy = (tb.top + tb.bottom) * 0.5;
    const opts = [
        { x: tb.left - hw - pad + offX, y: pawn.y },
        { x: tb.right + hw + pad + offX, y: pawn.y },
        { x: pawn.x, y: tb.top - hh - pad + offY },
        { x: pawn.x, y: tb.bottom + hh + pad + offY }
    ];
    opts.sort((a, b) =>
        Math.hypot(b.x - tcx, b.y - tcy) - Math.hypot(a.x - tcx, a.y - tcy)
    );
    for (let i = 0; i < opts.length; i++) {
        const o = opts[i];
        if (pawnPoseBlocked(pawn, o.x, o.y, 2)) continue;
        teleportPawnPose(pawn, o.x, o.y);
        return true;
    }
    const free = findFreePawnPose(pawn, 80);
    if (!free) return false;
    teleportPawnPose(pawn, free.x, free.y);
    return true;
}

/**
 * Arcade corner snag: both axes blocked, velocity never moves them.
 * Commit a short free step, then return that heading.
 */
function slidePawnAroundThings(pawn, nx, ny, dist, scramble, side) {
    if (!pawn?.body) return null;
    const s = side >= 0 ? 1 : -1;
    const step = Math.max(2, Number(dist) || 4);
    let dirs = scramble
        ? [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ]
        : [
            [-ny * s, nx * s],
            [ny * s, -nx * s],
            [nx, ny],
            [nx, 0], [0, ny],
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];
    if (scramble) {
        dirs = dirs.slice();
        for (let i = dirs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = dirs[i];
            dirs[i] = dirs[j];
            dirs[j] = tmp;
        }
    }
    for (let i = 0; i < dirs.length; i++) {
        const dx = dirs[i][0];
        const dy = dirs[i][1];
        if (!(Math.abs(dx) + Math.abs(dy) > 0)) continue;
        const len = Math.hypot(dx, dy) || 1;
        const sx = dx / len;
        const sy = dy / len;
        const px = pawn.x + sx * step;
        const py = pawn.y + sy * step;
        if (pawnPoseHitsThing(pawn, px, py)) continue;
        teleportPawnPose(pawn, px, py);
        return { nx: sx, ny: sy };
    }
    return null;
}

function sleepZzzHostPos(host) {
    if (!host) return null;
    if (host.root && host.spr) {
        return {
            x: Number(host.root.x) + Number(host.spr.x || 0),
            y: Number(host.root.y) + Number(host.spr.y || 0)
        };
    }
    if (typeof host.bodyCenter === "function") {
        const c = host.bodyCenter();
        if (c) return c;
    }
    if (!Number.isFinite(host.x) || !Number.isFinite(host.y)) return null;
    return { x: host.x, y: host.y };
}

function sleepZzzIsResting(host) {
    if (!host) return false;
    if (host.root) return !!(host.resting && !host.dead && host.root.active);
    return !!(host._resting && host.active && !host.isBodyDead?.() && !host._bodyDead);
}

function sleepHealIsInjured(host) {
    if (!host) return false;
    if (typeof host.injured === "boolean") return !!host.injured;
    const body = host.anatomy;
    if (typeof Sleep !== "undefined" && Sleep.injuredForAutofill) {
        return !!Sleep.injuredForAutofill(body);
    }
    return false;
}

function sleepFxHostWidth(host) {
    const spr = host?.spr || host;
    const w = Number(spr?.displayWidth) || Number(spr?.width) || 16;
    return Math.max(8, w);
}

function clearSleepZzz(host) {
    const st = host?._zzz;
    if (!st) return;
    for (const b of st.bits || []) {
        try { b.obj?.destroy?.(); } catch (_) {}
    }
    host._zzz = null;
}

function clearSleepHealFx(host) {
    const st = host?._healFx;
    if (!st) return;
    for (const b of st.bits || []) {
        try { b.obj?.destroy?.(); } catch (_) {}
    }
    host._healFx = null;
}

function clearSleepFx(host) {
    clearSleepZzz(host);
    clearSleepHealFx(host);
}

function _tickSleepFxBits(st, dt) {
    if (!st?.bits) return;
    for (let i = st.bits.length - 1; i >= 0; i--) {
        const b = st.bits[i];
        const obj = b.obj;
        if (!obj?.active) {
            st.bits.splice(i, 1);
            continue;
        }
        b.t += dt;
        const k = Math.min(1, b.t / b.life);
        const ease = 1 - (1 - k) * (1 - k);
        obj.setPosition(b.x0 + b.dx * ease, b.y0 + b.dy * ease);
        obj.setAlpha(1 - k * k);
        obj.setDepth(52);
        if (k >= 1) {
            obj.destroy();
            st.bits.splice(i, 1);
        }
    }
}

/**
 * Comic z z z drifting off a sleeper. Call every frame; starts/stops itself.
 */
function tickSleepZzz(host, scene, delta) {
    const resting = sleepZzzIsResting(host);
    let st = host?._zzz;
    if (!resting && !st?.bits?.length) {
        if (host) host._zzz = null;
        return;
    }
    const pos = sleepZzzHostPos(host);
    const dt = Math.max(0, Number(delta) || 16);
    if (resting && pos) {
        if (!st) st = host._zzz = { wait: 80, seq: 0, bits: [] };
        st.wait -= dt;
        if (st.wait <= 0 && st.bits.length < 3) {
            st.wait = 780 + Math.random() * 360;
            _spawnSleepZ(host, scene, st, pos);
        }
    }
    _tickSleepFxBits(st, dt);
    if (!resting && !st.bits.length) host._zzz = null;
}

function tickSleepHealFx(host, scene, delta) {
    const resting = sleepZzzIsResting(host);
    const injured = resting && sleepHealIsInjured(host);
    let st = host?._healFx;
    if (!injured && !st?.bits?.length) {
        if (host) host._healFx = null;
        return;
    }
    const pos = sleepZzzHostPos(host);
    const dt = Math.max(0, Number(delta) || 16);
    if (injured && pos) {
        if (!st) st = host._healFx = { wait: 120, seq: 0, bits: [] };
        st.wait -= dt;
        if (st.wait <= 0 && st.bits.length < 3) {
            st.wait = 700 + Math.random() * 320;
            _spawnSleepPlus(host, scene, st, pos);
        }
    }
    _tickSleepFxBits(st, dt);
    if (!injured && !st?.bits?.length) host._healFx = null;
}

function _spawnSleepGlyph(scene, ch, color, x0, y0, n, host) {
    if (!scene?.add?.text) return null;
    const zoom = scene.worldZoom || scene.cameras?.main?.zoom || 1;
    const dpr = window.devicePixelRatio || 1;
    const font = pixelUiFontSize(16, 1);
    const txt = scene.add.text(x0, y0, ch, {
        fontFamily: PIXEL_UI_FONT,
        fontSize: `${font}px`,
        color,
        stroke: "#000000",
        strokeThickness: 2,
        align: "center"
    }).setOrigin(0.5, 1);
    txt.setResolution(Math.max(2, zoom * dpr * 2));
    if (txt.context) txt.context.imageSmoothingEnabled = true;
    try {
        txt.texture?.setFilter?.(Phaser.Textures.FilterMode.LINEAR);
    } catch (_) {}
    const size = [0.62, 0.76, 0.96][n];
    txt.setScale(size / zoom);
    const above = !!scene.isPartyWorldHud?.(host);
    if (typeof scene._placeWorldHud === "function") {
        scene._placeWorldHud(txt, above ? 52 : ((host?.y | 0) + 42), above);
    } else if (above && typeof scene._liftAboveVeil === "function") {
        scene._liftAboveVeil(txt, 52);
    } else {
        scene.mainLayer?.add(txt);
        scene._uiCam?.ignore(txt);
        txt.setDepth(52);
    }
    return txt;
}

function _spawnSleepZ(host, scene, st, pos) {
    const n = (st.seq || 0) % 3;
    st.seq = (st.seq || 0) + 1;
    const x0 = pos.x + 2 + n * 0.6;
    const y0 = pos.y - 4;
    const txt = _spawnSleepGlyph(scene, "z", "#b7c2d4", x0, y0, n, host);
    if (!txt) return;
    st.bits.push({
        obj: txt,
        t: 0,
        life: 2100 + n * 220,
        x0,
        y0,
        dx: 3 + n * 1.4 + Math.random() * 1.2,
        dy: -(6 + n * 2.2 + Math.random() * 1.5)
    });
}

function _spawnSleepPlus(host, scene, st, pos) {
    const n = (st.seq || 0) % 3;
    st.seq = (st.seq || 0) + 1;
    const half = sleepFxHostWidth(host) * 0.5;
    const x0 = pos.x + (Math.random() * 2 - 1) * half;
    const y0 = pos.y;
    const txt = _spawnSleepGlyph(scene, "+", "#4ee05a", x0, y0, n, host);
    if (!txt) return;
    st.bits.push({
        obj: txt,
        t: 0,
        life: 2100 + n * 220,
        x0,
        y0,
        dx: (Math.random() * 2 - 1) * 1.4,
        dy: -(7 + n * 2.4 + Math.random() * 1.6)
    });
}

/**
 * Canonical net/sim pose is always standing (feet / origin 0,1).
 * Prone sprites store world x,y at body center — convert back before sending.
 */
function creatureFeetPose(sprite) {
    if (!sprite) return { x: 0, y: 0 };
    const w = sprite.width || 16;
    const h = sprite.height || 16;
    if (sprite._prone) {
        return {
            x: sprite.x - w * 0.5,
            y: sprite.y + h * 0.5
        };
    }
    return { x: sprite.x, y: sprite.y };
}

/**
 * Prone pose for net puppets (sprite is a child of a world-positioned container).
 * Container stays at feet; pass feetAnchored so the sprite shifts to body center.
 * Blood and the laid-out body then share the same world point.
 * @param {Phaser.GameObjects.Sprite} sprite
 * @param {boolean} prone
 * @param {{ feetAnchored?: boolean }} [opts]
 */
function setPuppetProne(sprite, prone, opts = {}) {
    if (!sprite) return;
    const want = !!prone;
    const rest = !!(want && opts.resting);
    const ang = rest && typeof Sleep !== "undefined"
        ? Sleep.restRotation(opts.restRot)
        : -Math.PI / 2;
    const scale = rest && typeof Sleep !== "undefined" ? Sleep.SCALE : 1;
    const w = sprite.displayWidth || sprite.width || 16;
    const h = sprite.displayHeight || sprite.height || 16;
    // Feet-anchored puppets (mobs): shift to geometric body center while prone
    const localX = opts.feetAnchored ? w * 0.5 : 0;
    const localY = opts.feetAnchored ? -h * 0.5 : 0;
    if (!!sprite._prone === want && !!sprite._resting === rest) {
        if (want) {
            sprite.anims?.stop?.();
            if (sprite.texture?.frameTotal > 7) sprite.setFrame(7);
            sprite.setRotation(ang);
            sprite.setScale(scale);
            sprite.clearTint?.();
            sprite.setOrigin(0.5, 0.5);
            sprite.setPosition(localX, localY);
        }
        return;
    }
    if (want) {
        sprite.setOrigin(0.5, 0.5);
        sprite.setPosition(localX, localY);
        sprite.setRotation(ang);
        sprite.setScale(scale);
        sprite.anims?.stop?.();
        if (sprite.texture?.frameTotal > 7) sprite.setFrame(7);
        sprite.clearTint?.();
        sprite._prone = true;
        sprite._resting = rest;
    } else {
        sprite.setRotation(0);
        sprite.setScale(1);
        sprite.setOrigin(0, 1);
        sprite.setPosition(0, 0);
        sprite._prone = false;
        sprite._resting = false;
    }
}

/**
 * Shared jab curve for player + mob unarmed/weapon thrusts.
 * @returns {Number} 0..1 (extend then retract)
 */
function meleeThrustCurve(progress) {
    if (typeof MeleeMath !== "undefined" && MeleeMath.meleeThrustCurve) {
        return MeleeMath.meleeThrustCurve(progress);
    }
    const peak = 0.4;
    if (progress <= peak) {
        const t = progress / peak;
        return 1 - (1 - t) * (1 - t);
    }
    const t = (progress - peak) / (1 - peak);
    return (1 - t) * (1 - t);
}

/** Place unarmed fist sprite along aim using the shared thrust curve. */
function placeUnarmedThrustSprite(sprite, cx, cy, angle, range, progress, depthY) {
    if (!sprite) return;
    const thrust = meleeThrustCurve(progress);
    const hold = 3;
    const dist = hold + (Number(range) || 4) * thrust;
    sprite.setPosition(
        cx + Math.cos(angle) * dist,
        cy + Math.sin(angle) * dist
    );
    sprite.setRotation(angle + Math.PI / 2);
    if (depthY != null) sprite.setDepth(depthY + 1);
}

/** Y-sort a sleeper between the leaf floor (lean.y) and stick frame (lean.y + 2). */
function sleepSortDepth(sprite, leanTo, slot) {
    const leanY = Number(leanTo?.y);
    const spriteY = Number(sprite?.y) || 0;
    const base = Number.isFinite(leanY) ? leanY : spriteY + 16;
    return base + 1 + (Number(slot) || 0) * 0.01;
}

/** Short segment around the fist for hit tests. */
function unarmedHitSegment(sprite, angle) {
    if (typeof MeleeMath !== "undefined" && MeleeMath.unarmedHitSegment) {
        return MeleeMath.unarmedHitSegment(sprite, angle);
    }
    if (!sprite) return null;
    const c = { x: sprite.x, y: sprite.y };
    return {
        a: { x: c.x - Math.cos(angle) * 3, y: c.y - Math.sin(angle) * 3 },
        b: { x: c.x + Math.cos(angle) * 3, y: c.y + Math.sin(angle) * 3 }
    };
}

function meleeSegmentHitsRect(ax, ay, bx, by, box, radius = 0) {
    if (typeof MeleeMath !== "undefined" && MeleeMath.meleeSegmentHitsRect) {
        return MeleeMath.meleeSegmentHitsRect(ax, ay, bx, by, box, radius);
    }
    const left = box.left - radius;
    const right = box.right + radius;
    const top = box.top - radius;
    const bottom = box.bottom + radius;
    if (ax >= left && ax <= right && ay >= top && ay <= bottom) return true;
    if (bx >= left && bx <= right && by >= top && by <= bottom) return true;
    const edges = [
        [left, top, right, top],
        [right, top, right, bottom],
        [right, bottom, left, bottom],
        [left, bottom, left, top]
    ];
    for (const [ex1, ey1, ex2, ey2] of edges) {
        if (meleeSegmentsIntersect(ax, ay, bx, by, ex1, ey1, ex2, ey2)) return true;
    }
    return false;
}

function meleeSegmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    if (typeof MeleeMath !== "undefined" && MeleeMath.meleeSegmentsIntersect) {
        return MeleeMath.meleeSegmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy);
    }
    const abx = bx - ax, aby = by - ay;
    const cdx = dx - cx, cdy = dy - cy;
    const den = abx * cdy - aby * cdx;
    if (Math.abs(den) < 1e-8) return false;
    const acx = cx - ax, acy = cy - ay;
    const t = (acx * cdy - acy * cdx) / den;
    const u = (acx * aby - acy * abx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function meleeDistPointToSegment(px, py, ax, ay, bx, by) {
    if (typeof MeleeMath !== "undefined" && MeleeMath.meleeDistPointToSegment) {
        return MeleeMath.meleeDistPointToSegment(px, py, ax, ay, bx, by);
    }
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    if (len2 <= 1e-8) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * abx + (py - ay) * aby) / len2;
    t = Phaser.Math.Clamp(t, 0, 1);
    return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/**
 * Melee swing length in ms. Matches the old frame timer at 144Hz
 * (`frames = cooldownSec * 60`, real duration = frames / 144).
 * @param {number} cooldownSec
 * @param {number} [scale=1]
 */
function meleeAttackDurationMs(cooldownSec, scale = 1) {
    if (typeof MeleeMath !== "undefined" && MeleeMath.meleeAttackDurationMs) {
        return MeleeMath.meleeAttackDurationMs(cooldownSec, scale);
    }
    const REF_FPS = 144;
    const cd = Number(cooldownSec);
    const sc = Number(scale);
    const sec = (Number.isFinite(cd) ? cd : 2) * (Number.isFinite(sc) && sc > 0 ? sc : 1);
    const ms = sec * (60 / REF_FPS) * 1000;
    // Former floor was 8 frames @ 144Hz
    return Math.max((8 / REF_FPS) * 1000, ms);
}

/** Unarmed / melee segment vs a damageable target. */
function meleeSegmentHitsTarget(a, b, radius, target) {
    if (typeof MeleeMath !== "undefined" && MeleeMath.meleeSegmentHitsTarget) {
        return MeleeMath.meleeSegmentHitsTarget(a, b, radius, target);
    }
    if (typeof target.hurtbox === "function") {
        return meleeSegmentHitsRect(a.x, a.y, b.x, b.y, target.hurtbox(0), radius);
    }
    let tx, ty, rad;
    if (typeof target.bodyCenter === "function") {
        const bc = target.bodyCenter();
        tx = bc.x; ty = bc.y;
        rad = Math.max(target.width, target.height) * 0.5;
    } else if (target.body) {
        tx = target.body.center.x;
        ty = target.body.center.y;
        rad = Math.max(target.body.width, target.body.height) * 0.55;
    } else {
        tx = target.x;
        ty = target.y;
        rad = 10;
    }
    return meleeDistPointToSegment(tx, ty, a.x, a.y, b.x, b.y) <= rad + radius;
}

/**
 * Set move velocity; on ice, accelerate toward the target instead of snapping
 * (reversing takes time — you slide).
 * @param {Phaser.Physics.Arcade.Sprite} sprite
 * @param {number} targetVx
 * @param {number} targetVy
 * @param {number} delta  ms
 * @param {Phaser.Scene} scene
 */
function applyEntityVelocity(sprite, targetVx, targetVy, delta, scene) {
    if (!sprite) return;
    if (sprite._prone || sprite._downed || sprite.isIncapacitated?.() || sprite.isImmobile?.()) {
        sprite._iceVx = 0;
        sprite._iceVy = 0;
        sprite.setVelocity?.(0, 0);
        return;
    }
    const onIce = !!scene?._isIceAt?.(sprite.x, sprite.y - 1);
    if (!onIce) {
        sprite._iceVx = targetVx;
        sprite._iceVy = targetVy;
        sprite.setVelocity(targetVx, targetVy);
        return;
    }

    const dt = Math.min(Math.max(Number(delta) || 16, 0), 50) / 1000;
    let vx = sprite._iceVx;
    let vy = sprite._iceVy;
    if (vx == null || vy == null) {
        vx = sprite.body?.velocity?.x ?? 0;
        vy = sprite.body?.velocity?.y ?? 0;
    }

    // Fast response while steering; long coast after releasing keys
    const steering = Math.hypot(targetVx, targetVy) > 0.5;
    const maxAccel = steering ? 200 : 45;
    const dvx = targetVx - vx;
    const dvy = targetVy - vy;
    const err = Math.hypot(dvx, dvy);
    const maxStep = maxAccel * dt;
    if (err <= maxStep || err < 0.5) {
        vx = targetVx;
        vy = targetVy;
    } else {
        vx += (dvx / err) * maxStep;
        vy += (dvy / err) * maxStep;
    }

    // Snap tiny residuals so you eventually stop
    if (Math.hypot(vx, vy) < 1 && Math.hypot(targetVx, targetVy) < 0.5) {
        vx = 0;
        vy = 0;
    }

    sprite._iceVx = vx;
    sprite._iceVy = vy;
    sprite.setVelocity(vx, vy);
}