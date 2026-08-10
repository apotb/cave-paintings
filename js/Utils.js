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
 * Spoil duration in game minutes for a fresh item (from food.spoil hours).
 * @param   {Object} item   Item definition from Items.json.
 * @return  {Number|null}   Minutes, or null if not spoilable.
 */
function spoilDurationMinutes(item) {
    const hours = item?.food?.spoil;
    if (!hours || hours <= 0) return null;
    return Math.round(hours * 60);
}

/** @deprecated Use spoilDurationMinutes */
function defaultSpoilMinutes(item) {
    return spoilDurationMinutes(item);
}

/**
 * Absolute world-minute index when a fresh item should spoil.
 * @param {Object} item
 * @param {number} now  scene.worldMinuteIndex()
 * @returns {number|null}
 */
function defaultSpoilAt(item, now) {
    const dur = spoilDurationMinutes(item);
    if (dur == null || now == null) return null;
    return Math.round(now) + dur;
}

/**
 * Remaining game minutes until spoilAt (0 if due/past).
 */
function remainingSpoilMinutes(spoilAt, now) {
    if (spoilAt == null || now == null) return null;
    return Math.max(0, Math.round(spoilAt) - Math.round(now));
}

/**
 * Quantity-weighted average of two absolute spoilAt timestamps.
 * Equivalent to averaging remaining times (now cancels out).
 */
function mergeSpoilAt(countA, atA, countB, atB) {
    if (atA == null && atB == null) return null;
    if (atA == null) return atB;
    if (atB == null) return atA;
    const total = countA + countB;
    if (total <= 0) return Math.round(atA);
    return Math.round((countA * atA + countB * atB) / total);
}

/** @deprecated Use mergeSpoilAt */
function mergeSpoilMinutes(countA, minutesA, countB, minutesB) {
    return mergeSpoilAt(countA, minutesA, countB, minutesB);
}

/**
 * Derive crafted item weights from recipe ingredients (recursive).
 * Mutates items in place. Skips REQUIRE_THING; divides by QUANTITY.
 * Items with weightFixed keep their authored weight.
 * @param {Object[]} items
 */
function resolveCraftedWeights(items) {
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
            if (k === "REQUIRE_THING") continue;
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
            if (k === "REQUIRE_THING") continue;
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
 * Build an inventory/equipment stack object, attaching spoilAt when applicable.
 * @param {Object} item
 * @param {number} quantity
 * @param {number|null|undefined} spoilAt  absolute world minute; omit to use now+duration
 * @param {number|null} now  worldMinuteIndex(); required when spoilAt is omitted for spoilable items
 */
function makeItemStack(item, quantity, spoilAt = undefined, now = null) {
    const stack = { id: item.id, quantity };
    let at = spoilAt;
    if (at === undefined) {
        at = defaultSpoilAt(item, now);
        // Dynamic meal stacks may carry food.spoil without meta.food
        if (at == null && now != null && item?.food?.spoil > 0) {
            at = Math.round(now) + Math.round(item.food.spoil * 60);
        }
    }
    if (at != null) stack.spoilAt = at;
    return stack;
}

/**
 * Migrate legacy spoilMinutes (remaining) → spoilAt, or assign fresh spoilAt if missing.
 * @param {Object|null} stack
 * @param {number} now
 * @param {Function} [getItem]
 */
function migrateStackSpoil(stack, now, getItem = null) {
    if (!stack || now == null) return stack;
    if (stack.spoilAt != null) {
        if (stack.spoilMinutes != null) delete stack.spoilMinutes;
        return stack;
    }
    if (stack.spoilMinutes != null) {
        stack.spoilAt = Math.round(now) + Math.round(stack.spoilMinutes);
        delete stack.spoilMinutes;
        return stack;
    }
    const meta = getItem ? getItem(stack.id) : null;
    const foodSpoil = stack.food?.spoil ?? meta?.food?.spoil;
    if (foodSpoil > 0) {
        stack.spoilAt = Math.round(now) + Math.round(foodSpoil * 60);
    }
    return stack;
}

/**
 * If stack is due to spoil at/before now, return a rot stack (or strip timer).
 * @returns {{ stack: Object|null, changed: boolean }}
 */
function spoilStackIfDue(stack, now, rotItem) {
    if (!stack || stack.spoilAt == null) return { stack, changed: false };
    if (Math.round(now) < Math.round(stack.spoilAt)) return { stack, changed: false };
    if (!rotItem) {
        delete stack.spoilAt;
        return { stack, changed: true };
    }
    return { stack: { id: rotItem.id, quantity: stack.quantity }, changed: true };
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

const SIMMER_INGREDIENTS = new Set(["apple", "blueberry", "raw_beef", "raw_venison"]);
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

    const hasBeef = unique.includes("raw_beef");
    const hasVenison = unique.includes("raw_venison");
    const hasMeat = hasBeef || hasVenison;
    const hasApple = unique.includes("apple");
    const hasBlue = unique.includes("blueberry");

    if (hasMeat) {
        kind = "stew";
        spoilHours = 36;
        // Label by meat type; mixed meats → generic "Meat"
        const meatLabel = hasBeef && hasVenison
            ? "Meat"
            : hasVenison
                ? "Venison"
                : "Beef";
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
    let key = meta?.key || stack.id;
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
    let key = meta?.key || stack.id;
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
        food: { kc: info.kc, kcFull: info.kc, spoil: info.spoilHours },
        weight: info.weight,
        kind: info.kind,
        fillTint: info.fillTint,
        ingredients: ingredientIds.filter(Boolean).slice()
    };
    if (now != null && info.spoilHours > 0) {
        stack.spoilAt = Math.round(now) + Math.round(info.spoilHours * 60);
    }
    return stack;
}

/** Deep-enough clone of an inventory/equipment/loot stack. */
function cloneItemStack(stack) {
    if (!stack) return null;
    const out = { id: stack.id, quantity: stack.quantity };
    if (stack.spoilAt != null) out.spoilAt = stack.spoilAt;
    if (stack.spoilMinutes != null) out.spoilMinutes = stack.spoilMinutes;
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
        || stack.weight != null
        || stack.kind
        || stack.fillTint != null
        || knap
    );
    if (!hasExtras) return null;
    return {
        customName: stack.customName,
        food: stack.food ? { ...stack.food } : undefined,
        ingredients: stack.ingredients ? stack.ingredients.slice() : undefined,
        weight: stack.weight,
        kind: stack.kind,
        fillTint: stack.fillTint,
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
    );
}

/** Quality band → damage multiplier (matches knapped tool bands). */
function knapQualityMult(quality) {
    return { crude: 0.65, rough: 0.95, fine: 1.35 }[quality] || 1;
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
    ));
}

/**
 * Remaining campfire burn time in game minutes (1 kj ≈ 1 minute).
 * Includes the unit already pulled into the fire plus fuel still in slots.
 * @param {Function} getItem  scene.getItem bound or equivalent
 * @param {Array} fuelSlots   [stack|null, stack|null]
 * @param {Number} burnRemaining  minutes left on the currently burning unit
 */
function campfireBurnMinutes(getItem, fuelSlots, burnRemaining = 0) {
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
 * Lay down like a corpse (right-facing, -90°) without gray tint.
 * Toggles origin between standing (0,1) and prone (0.5, 0.5), preserving world position.
 * @param {Phaser.GameObjects.Sprite} sprite
 * @param {boolean} prone
 */
function setCreatureProne(sprite, prone) {
    if (!sprite) return;
    const want = !!prone;
    if (!!sprite._prone === want) {
        if (want) {
            sprite.anims?.stop?.();
            if (sprite.texture?.frameTotal > 7) sprite.setFrame(7);
            sprite.setRotation(-Math.PI / 2);
            sprite.clearTint?.();
        }
        return;
    }

    const w = sprite.width || 16;
    const h = sprite.height || 16;

    if (want) {
        // bottom-left origin → center
        sprite.x += w * 0.5;
        sprite.y -= h * 0.5;
        sprite.setOrigin(0.5, 0.5);
        sprite.setRotation(-Math.PI / 2);
        sprite.anims?.stop?.();
        if (sprite.texture?.frameTotal > 7) sprite.setFrame(7);
        sprite.clearTint?.();
        sprite._prone = true;
    } else {
        sprite.setRotation(0);
        sprite.x -= w * 0.5;
        sprite.y += h * 0.5;
        sprite.setOrigin(0, 1);
        sprite._prone = false;
    }
}

/**
 * Shared jab curve for player + mob unarmed/weapon thrusts.
 * @returns {Number} 0..1 (extend then retract)
 */
function meleeThrustCurve(progress) {
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

/** Short segment around the fist for hit tests. */
function unarmedHitSegment(sprite, angle) {
    if (!sprite) return null;
    const c = { x: sprite.x, y: sprite.y };
    return {
        a: { x: c.x - Math.cos(angle) * 3, y: c.y - Math.sin(angle) * 3 },
        b: { x: c.x + Math.cos(angle) * 3, y: c.y + Math.sin(angle) * 3 }
    };
}

function meleeSegmentHitsRect(ax, ay, bx, by, box, radius = 0) {
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