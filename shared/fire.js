/**
 * Vintage Story–style campfire heat: pit temp, food temp, smolder, cook gates.
 * Phaser-free (Node + browser UMD).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Fire = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const AMBIENT_TEMP = 20;
    /** Calibrated so 20→550 on a stick fire is ~20 game minutes (not 3). */
    const HEAT_DT = 3;
    /**
     * Cooling uses a much smaller step. HEAT_DT on the VS curve drops 800→20 in ~5
     * ticks; this keeps embers for roughly the smolder window (~2 minutes).
     */
    const COOL_DT = 1;
    const SMOLDER_MINUTES = 120;
    const SIMMER_MINUTES_PER_SLOT = 5;
    const SIMMER_TEMP = 450;
    const DEFAULT_FUEL_TEMP = 600;
    const DEFAULT_COOK_TEMP = 300;
    /** Coals this hot can catch new fuel without a firestarter. VS uses a 2-hour
     *  smolder flag with no °C cutoff; we also require this temperature. */
    const IGNITE_TEMP = 200;
    const NEAR_MAX_DELTA = 50;
    const IDLE_SIP_MUL = 4;
    const LIT_ID = "campfire";
    const UNLIT_ID = "unlit_campfire";
    /** Night-veil punch radii. Caps at the 600°C ("hot") reach so roaring
     *  800° fuel does not light a much larger area. */
    const LIGHT_RADIUS = { cold: 0, embers: 3, warm: 6, hot: 9, roaring: 9 };
    /** Unlit coals still glow with pit heat, but as a tiny ember pool. */
    const UNLIT_LIGHT_MUL = 0.1;

    const BANDS = [
        { id: "cold", max: 50, label: "Cold", color: "#9aa4b0" },
        { id: "embers", max: 200, label: "Embers", color: "#c45c28" },
        { id: "warm", max: 400, label: "Warm", color: "#e09040" },
        { id: "hot", max: 650, label: "Hot", color: "#e8a040" },
        { id: "roaring", max: Infinity, label: "Roaring", color: "#ff5a28" }
    ];

    /** Radius at each band's lower bound so light lerps toward the next stage.
     *  Cold starts at ambient (20°C), not 0°C — pits cool to ambient, so a 0°C
     *  stop would leave unlit fires stuck with a leftover glow. */
    const LIGHT_STOPS = [];
    {
        let lo = AMBIENT_TEMP;
        for (const b of BANDS) {
            LIGHT_STOPS.push({ temp: lo, radius: LIGHT_RADIUS[b.id] || 0 });
            if (!Number.isFinite(b.max)) break;
            lo = b.max;
        }
    }
    const EMBERS_TEMP = BANDS[0].max;

    function clamp(n, lo, hi) {
        return Math.max(lo, Math.min(hi, n));
    }

    function roundTemp(t) {
        return Math.round((Number(t) || 0) * 100) / 100;
    }

    function changeTemperature(fromTemp, toTemp, dt) {
        let from = Number(fromTemp);
        const to = Number(toTemp);
        if (!Number.isFinite(from)) from = AMBIENT_TEMP;
        if (!Number.isFinite(to)) return roundTemp(from);
        let step = Number(dt);
        if (!(step > 0)) return roundTemp(from);
        const diff = Math.abs(from - to);
        step = step + step * (diff / 28);
        if (diff < step || diff < 1) return roundTemp(to);
        if (from > to) step = -step;
        return roundTemp(from + step);
    }

    function heatBand(temp) {
        const t = Number(temp);
        const n = Number.isFinite(t) ? t : AMBIENT_TEMP;
        for (const b of BANDS) {
            if (n < b.max) return b.id;
        }
        return "roaring";
    }

    function bandInfo(id) {
        return BANDS.find((b) => b.id === id) || BANDS[0];
    }

    function heatLabel(id) {
        return bandInfo(id).label;
    }

    function heatColor(id) {
        return bandInfo(id).color;
    }

    function formatTemp(temp) {
        const n = Number(temp);
        const deg = Math.round(Number.isFinite(n) ? n : AMBIENT_TEMP);
        return `${deg}°C`;
    }

    function fuelProps(item) {
        const kj = Number(item?.fuel?.kj) || 0;
        if (!(kj > 0)) return null;
        let temp = Number(item?.fuel?.temp);
        if (!(temp > 0)) temp = DEFAULT_FUEL_TEMP;
        return { kj, temp };
    }

    function peekFuel(entry, getItem) {
        const slots = entry?.fuel;
        if (!Array.isArray(slots)) return null;
        for (let i = 0; i < slots.length; i++) {
            const stack = slots[i];
            if (!stack?.id || !(stack.quantity > 0)) continue;
            const props = fuelProps(typeof getItem === "function" ? getItem(stack.id) : null);
            if (!props) continue;
            return { i, stack, kj: props.kj, temp: props.temp };
        }
        return null;
    }

    function hasFuel(entry, getItem) {
        return !!peekFuel(entry, getItem);
    }

    function isBurning(entry) {
        return !!(entry && entry.id === LIT_ID && (entry.burnRemaining || 0) > 0);
    }

    function smolderExpired(entry, worldMinute) {
        if (entry?.smolderAt == null || worldMinute == null) return false;
        return Math.round(Number(worldMinute)) - Math.round(Number(entry.smolderAt)) >= SMOLDER_MINUTES;
    }

    function isHotEnoughToIgnite(entry) {
        return (Number(entry?.pitTemp) || 0) >= IGNITE_TEMP;
    }

    function isSmoldering(entry, worldMinute) {
        if (!entry || isBurning(entry)) return false;
        if (!entry.canIgniteFuel) return false;
        if (smolderExpired(entry, worldMinute)) return false;
        if (!isHotEnoughToIgnite(entry)) return false;
        return true;
    }

    function displayBand(entry, worldMinute) {
        if (isBurning(entry)) return heatBand(entry.pitTemp);
        if (isSmoldering(entry, worldMinute)) return "embers";
        return "cold";
    }

    function lightBand(entry) {
        const t = Number(entry?.pitTemp);
        const n = Number.isFinite(t) ? t : AMBIENT_TEMP;
        // A live flame lights the night even before the pit itself has crossed 50°C.
        if (isBurning(entry) && !(n > 50)) return "embers";
        if (!(n > 50)) return "cold";
        return heatBand(n);
    }

    function lightRadiusTiles(band) {
        const n = LIGHT_RADIUS[band];
        return n > 0 ? n : 0;
    }

    function lightRadiusAtTemp(temp) {
        let t = Number(temp);
        if (!Number.isFinite(t)) t = AMBIENT_TEMP;
        const stops = LIGHT_STOPS;
        if (!(stops.length > 0)) return 0;
        if (t <= stops[0].temp) return 0;
        for (let i = 0; i < stops.length - 1; i++) {
            const a = stops[i];
            const b = stops[i + 1];
            if (t <= b.temp) {
                const span = b.temp - a.temp;
                const u = span > 0 ? (t - a.temp) / span : 1;
                return a.radius + (b.radius - a.radius) * u;
            }
        }
        return stops[stops.length - 1].radius;
    }

    function lightRadiusForEntry(entry) {
        let t = Number(entry?.pitTemp);
        if (!Number.isFinite(t)) t = AMBIENT_TEMP;
        // Live flame at least reaches the embers threshold so a just-lit pit glows.
        if (isBurning(entry)) t = Math.max(t, EMBERS_TEMP);
        let r = lightRadiusAtTemp(t);
        if (!isBurning(entry) && r > 0) r *= UNLIT_LIGHT_MUL;
        return r;
    }

    function hasCookInput(entry) {
        if (entry?.cook?.id) return true;
        return hasSimmerContents(entry);
    }

    function isIdleSip(entry) {
        if (!isBurning(entry)) return false;
        const pit = Number(entry.pitTemp);
        const max = Number(entry.maxTemp);
        if (!Number.isFinite(pit) || !Number.isFinite(max)) return false;
        if (Math.abs(pit - max) >= NEAR_MAX_DELTA) return false;
        if (hasCookInput(entry)) return false;
        return true;
    }

    function burnMinutes(entry, getItem) {
        if (!entry) return 0;
        const mul = isIdleSip(entry) ? IDLE_SIP_MUL : 1;
        let mins = Math.max(0, Number(entry.burnRemaining) || 0) * mul;
        for (const stack of entry.fuel || []) {
            if (!stack?.id || !(stack.quantity > 0)) continue;
            const props = fuelProps(typeof getItem === "function" ? getItem(stack.id) : null);
            if (!props) continue;
            mins += props.kj * stack.quantity * mul;
        }
        return mins;
    }

    function stackTemp(stack) {
        const t = Number(stack?.temp);
        return Number.isFinite(t) ? t : AMBIENT_TEMP;
    }

    function applyStackTemp(stack, temp) {
        if (!stack) return;
        const t = roundTemp(temp);
        if (!(t > AMBIENT_TEMP)) {
            delete stack.temp;
            return;
        }
        stack.temp = t;
    }

    function copyStackTemp(from, to) {
        if (!to) return;
        if (from?.temp != null && Number(from.temp) > AMBIENT_TEMP) to.temp = from.temp;
        else delete to.temp;
    }

    function stackShowsTemp(stack) {
        return stack?.temp != null && Number(stack.temp) > AMBIENT_TEMP;
    }

    function mergeTemp(countA, tempA, countB, tempB) {
        const tA = tempA == null || !Number.isFinite(Number(tempA))
            ? AMBIENT_TEMP
            : Number(tempA);
        const tB = tempB == null || !Number.isFinite(Number(tempB))
            ? AMBIENT_TEMP
            : Number(tempB);
        const total = countA + countB;
        if (total <= 0) return Math.round(tA);
        return Math.round((countA * tA + countB * tB) / total);
    }

    function applyMergedStackTemp(dest, destCount, addCount, addTemp) {
        if (!dest) return dest;
        applyStackTemp(dest, mergeTemp(destCount, dest.temp, addCount, addTemp));
        return dest;
    }

    function tickStackTemp(stack) {
        if (!stack || stack.temp == null) return false;
        const before = stack.temp;
        applyStackTemp(stack, changeTemperature(stack.temp, AMBIENT_TEMP, COOL_DT));
        return stack.temp !== before || (before != null && stack.temp == null);
    }

    function catalystMethod(entry, getItem) {
        const id = entry?.catalyst?.id;
        if (!id || typeof getItem !== "function") return null;
        return getItem(id)?.cook?.method || null;
    }

    function roastRecipe(getItem, inputId, method) {
        if (!inputId || !method || typeof getItem !== "function") return null;
        const recipe = getItem(inputId)?.cook?.[method];
        if (!recipe?.result || !(recipe.minutes > 0)) return null;
        const temp = Number(recipe.temp);
        return {
            result: recipe.result,
            minutes: recipe.minutes,
            temp: temp > 0 ? temp : DEFAULT_COOK_TEMP
        };
    }

    function simmerTempOf(entry, getItem) {
        const t = Number(typeof getItem === "function"
            ? getItem(entry?.catalyst?.id)?.cook?.temp
            : 0);
        return t > 0 ? t : SIMMER_TEMP;
    }

    function cookRate(foodTemp, minTemp) {
        if (!(minTemp > 0) || !(foodTemp >= minTemp)) return 0;
        return clamp(foodTemp / minTemp, 1, 30);
    }

    function heatTowardPit(fromTemp, pitTemp, minTemp) {
        const pit = Number.isFinite(Number(pitTemp)) ? Number(pitTemp) : AMBIENT_TEMP;
        let cur = Number(fromTemp);
        if (!Number.isFinite(cur)) cur = AMBIENT_TEMP;
        if (cur < pit) {
            const boost = 1 + clamp((pit - cur) / 30, 0, 1.6);
            let dt = HEAT_DT * boost;
            if (minTemp > 0 && cur >= minTemp) dt /= 11;
            return changeTemperature(cur, pit, dt);
        }
        return changeTemperature(cur, pit, COOL_DT);
    }

    function ensureSlots(entry) {
        if (!entry) return entry;
        if (!Array.isArray(entry.fuel)) entry.fuel = [null, null];
        while (entry.fuel.length < 2) entry.fuel.push(null);
        if (entry.cook === undefined) entry.cook = null;
        if (entry.catalyst === undefined) entry.catalyst = null;
        if (!Array.isArray(entry.simmer)) entry.simmer = [null, null, null, null];
        while (entry.simmer.length < 4) entry.simmer.push(null);
        if (entry.simmer.length > 4) entry.simmer.length = 4;
        if (entry.cookProgress == null) entry.cookProgress = 0;
        if (entry.burnRemaining == null) {
            entry.burnRemaining = 0;
            delete entry.burnProgress;
        }
        return entry;
    }

    function migrateEntry(entry, getItem) {
        if (!entry) return entry;
        ensureSlots(entry);
        if (entry.pitTemp == null) {
            if (entry.id === LIT_ID && ((entry.burnRemaining || 0) > 0 || peekFuel(entry, getItem))) {
                const burning = peekFuel(entry, getItem);
                const t = burning?.temp || DEFAULT_FUEL_TEMP;
                entry.pitTemp = t;
                entry.maxTemp = t;
                entry.canIgniteFuel = true;
            } else {
                entry.pitTemp = AMBIENT_TEMP;
                entry.maxTemp = AMBIENT_TEMP;
                entry.canIgniteFuel = false;
            }
        }
        if (entry.cookTemp == null) entry.cookTemp = AMBIENT_TEMP;
        if (entry.maxTemp == null) entry.maxTemp = AMBIENT_TEMP;
        if (entry.canIgniteFuel == null) entry.canIgniteFuel = entry.id === LIT_ID;
        seedStackTempsFromEntry(entry);
        return entry;
    }

    function seedStackTempsFromEntry(entry) {
        if (!entry) return;
        if (entry.cook && entry.cook.temp == null) {
            const leftover = Number(entry.cookTemp);
            if (Number.isFinite(leftover) && leftover > AMBIENT_TEMP) {
                applyStackTemp(entry.cook, leftover);
            }
        }
        mirrorCookTemp(entry);
    }

    function simmerFoodTemp(entry) {
        let min = Infinity;
        for (const s of entry?.simmer || []) {
            if (!s || !isSimmerIngredient(s.id)) continue;
            min = Math.min(min, stackTemp(s));
        }
        return min === Infinity ? AMBIENT_TEMP : min;
    }

    function mirrorCookTemp(entry) {
        if (!entry) return AMBIENT_TEMP;
        if (entry.cook?.id) entry.cookTemp = stackTemp(entry.cook);
        else if (hasSimmerContents(entry)) entry.cookTemp = simmerFoodTemp(entry);
        else if (entry.cookTemp == null) entry.cookTemp = AMBIENT_TEMP;
        return entry.cookTemp;
    }

    function igniteFuel(entry, getItem) {
        const found = peekFuel(entry, getItem);
        if (!found) return false;
        found.stack.quantity = Math.max(0, Math.floor(Number(found.stack.quantity) || 1) - 1);
        if (!(found.stack.quantity > 0)) entry.fuel[found.i] = null;
        entry.burnRemaining = found.kj;
        entry.maxTemp = found.temp;
        entry.id = LIT_ID;
        entry.canIgniteFuel = true;
        delete entry.smolderAt;
        return true;
    }

    function tryAutoIgnite(entry, getItem, worldMinute) {
        migrateEntry(entry, getItem);
        if (isBurning(entry)) return false;
        if (!isSmoldering(entry, worldMinute)) return false;
        return igniteFuel(entry, getItem);
    }

    function lightPit(entry, getItem) {
        migrateEntry(entry, getItem);
        if (isBurning(entry)) {
            entry.id = LIT_ID;
            entry.canIgniteFuel = true;
            return true;
        }
        entry.canIgniteFuel = true;
        return igniteFuel(entry, getItem);
    }

    /** Cooking tools sitting in the pit take on pit heat. Fuel does not — its
     *  authored temp is burn heat, not a live stack temperature. */
    function heatHoldings(entry) {
        if (!entry?.catalyst?.id) return;
        const pit = Number(entry.pitTemp);
        if (!(pit > AMBIENT_TEMP)) return;
        applyStackTemp(entry.catalyst, heatTowardPit(stackTemp(entry.catalyst), pit, 0));
    }

    function beginSmolder(entry, worldMinute) {
        entry.burnRemaining = 0;
        entry.id = UNLIT_ID;
        entry.canIgniteFuel = true;
        if (entry.smolderAt == null && worldMinute != null) {
            entry.smolderAt = Math.round(Number(worldMinute));
        }
    }

    function tickPit(entry, getItem, worldMinute) {
        migrateEntry(entry, getItem);
        const idBefore = entry.id;
        const wasLit = idBefore === LIT_ID;
        const remainBefore = entry.burnRemaining || 0;
        const fuelBefore = (entry.fuel || []).map((s) => (s?.id ? `${s.id}:${s.quantity || 0}` : "")).join("|");
        const tempBefore = entry.pitTemp;
        const igniteBefore = !!entry.canIgniteFuel;
        const radiusBefore = lightRadiusForEntry(entry);

        if ((entry.burnRemaining || 0) > 0) {
            const sip = isIdleSip(entry);
            entry.burnRemaining -= sip ? (1 / IDLE_SIP_MUL) : 1;
            if (entry.burnRemaining < 0) entry.burnRemaining = 0;
        }

        if ((entry.burnRemaining || 0) <= 0) {
            if (wasLit) {
                // Still in a burn cycle: pull the next unit, or go to embers.
                if (!igniteFuel(entry, getItem)) beginSmolder(entry, worldMinute);
            } else if (isSmoldering(entry, worldMinute)) {
                // Cold unlit pits must not catch just because fuel is sitting in a slot.
                igniteFuel(entry, getItem);
            }
        }

        if (isBurning(entry)) {
            const toward = entry.maxTemp;
            const dt = (entry.pitTemp > toward) ? COOL_DT : HEAT_DT;
            entry.pitTemp = changeTemperature(entry.pitTemp, toward, dt);
        } else {
            // Same tick the fire dies, keep residual heat so cooking can finish (VS cools after heatInput).
            if (!wasLit) {
                entry.pitTemp = changeTemperature(entry.pitTemp, AMBIENT_TEMP, COOL_DT);
            }
            if (entry.canIgniteFuel && (smolderExpired(entry, worldMinute) || !isHotEnoughToIgnite(entry))) {
                entry.canIgniteFuel = false;
                delete entry.smolderAt;
            }
        }

        heatHoldings(entry);

        const fuelAfter = (entry.fuel || []).map((s) => (s?.id ? `${s.id}:${s.quantity || 0}` : "")).join("|");
        const radiusAfter = lightRadiusForEntry(entry);
        return {
            changed: entry.id !== idBefore
                || fuelAfter !== fuelBefore
                || entry.pitTemp !== tempBefore
                || (entry.burnRemaining || 0) !== remainBefore
                || !!entry.canIgniteFuel !== igniteBefore,
            litChanged: entry.id !== idBefore,
            lightChanged: entry.id !== idBefore
                || Math.round(radiusBefore * 100) !== Math.round(radiusAfter * 100)
        };
    }

    function isSimmerIngredient(itemId) {
        return itemId === "apple"
            || itemId === "blueberry"
            || itemId === "raw_beef"
            || itemId === "raw_venison"
            || itemId === "raw_pork";
    }

    function simmerFilledCount(entry) {
        let n = 0;
        for (const s of entry?.simmer || []) {
            if (s && isSimmerIngredient(s.id)) n += 1;
        }
        return n;
    }

    function hasSimmerContents(entry) {
        return !!(entry?.simmer || []).some((s) => !!s);
    }

    function simmerCanAdvance(entry, getItem) {
        if (catalystMethod(entry, getItem) !== "shell_simmer") return false;
        let filled = 0;
        for (const s of entry?.simmer || []) {
            if (!s) continue;
            if (!isSimmerIngredient(s.id)) return false;
            filled += 1;
        }
        return filled >= 2;
    }

    function makeResultStack(resultMeta, quantity, worldMinute, inheritTemp) {
        const stack = { id: resultMeta.id, quantity: quantity || 1 };
        const spoilHours = Number(resultMeta.food?.spoil);
        if (spoilHours > 0 && worldMinute != null) {
            stack.spoilAt = Math.round(Number(worldMinute)) + Math.round(spoilHours * 60);
        }
        applyStackTemp(stack, inheritTemp);
        return stack;
    }

    function heatCookSlot(entry, minTemp) {
        const foodTemp = heatTowardPit(stackTemp(entry.cook), entry.pitTemp, minTemp);
        applyStackTemp(entry.cook, foodTemp);
        entry.cookTemp = stackTemp(entry.cook);
        return entry.cookTemp;
    }

    function heatSimmerSlots(entry, minTemp) {
        const pit = entry.pitTemp;
        for (const s of entry.simmer || []) {
            if (!s || !isSimmerIngredient(s.id)) continue;
            applyStackTemp(s, heatTowardPit(stackTemp(s), pit, minTemp));
        }
        entry.cookTemp = simmerFoodTemp(entry);
        return entry.cookTemp;
    }

    function applyCookProgress(entry, need, rate) {
        if (rate > 0) {
            entry.cookProgress = (entry.cookProgress || 0) + rate;
            return entry.cookProgress >= need;
        }
        if ((entry.cookProgress || 0) > 0) {
            entry.cookProgress -= 1;
            if (entry.cookProgress <= 0) {
                entry.cookProgress = 0;
                return false;
            }
        }
        return false;
    }

    function isCookAdvancing(entry, getItem) {
        migrateEntry(entry, getItem);
        const method = catalystMethod(entry, getItem);
        const simmerActive = method === "shell_simmer"
            || hasSimmerContents(entry)
            || ((entry.cookProgress || 0) > 0 && (entry.simmerBarMinutes || 0) > 0);
        if (simmerActive) {
            if (!simmerCanAdvance(entry, getItem)) return false;
            return simmerFoodTemp(entry) >= simmerTempOf(entry, getItem);
        }
        const cook = entry?.cook;
        if (!cook?.id || !method) return false;
        const recipe = roastRecipe(getItem, cook.id, method);
        if (!recipe) return false;
        return stackTemp(cook) >= recipe.temp;
    }

    function tickCook(entry, getItem, opts = {}) {
        migrateEntry(entry, getItem);
        const method = catalystMethod(entry, getItem);
        const simmerActive = method === "shell_simmer"
            || hasSimmerContents(entry)
            || ((entry.cookProgress || 0) > 0 && (entry.simmerBarMinutes || 0) > 0);
        if (simmerActive) return tickShellSimmer(entry, getItem, opts);

        const cook = entry.cook;
        if (!cook?.id) {
            entry.cookTemp = heatTowardPit(entry.cookTemp, AMBIENT_TEMP, 0);
            if (!(entry.cookTemp > AMBIENT_TEMP)) entry.cookTemp = AMBIENT_TEMP;
            return { changed: false, converted: false, rate: 0 };
        }

        const recipe = method ? roastRecipe(getItem, cook.id, method) : null;
        if (!recipe) {
            heatCookSlot(entry, 0);
            return { changed: false, converted: false, rate: 0 };
        }

        const foodTemp = heatCookSlot(entry, recipe.temp);
        const rate = cookRate(foodTemp, recipe.temp);
        entry.roastBarMinutes = recipe.minutes;
        const done = applyCookProgress(entry, recipe.minutes, rate);
        if (rate <= 0 && (entry.cookProgress || 0) <= 0) {
            delete entry.roastBarMinutes;
        }

        if (!done) {
            return { changed: true, converted: false, rate, method };
        }

        const resultMeta = typeof getItem === "function" ? getItem(recipe.result) : null;
        delete entry.roastBarMinutes;
        if (!resultMeta) {
            entry.cookProgress = 0;
            return { changed: true, converted: false, rate, method };
        }
        const inherit = stackTemp(cook);
        const make = typeof opts.makeResult === "function"
            ? opts.makeResult
            : makeResultStack;
        entry.cook = make(resultMeta, cook.quantity || 1, opts.worldMinute);
        applyStackTemp(entry.cook, inherit);
        entry.cookTemp = stackTemp(entry.cook);
        entry.cookProgress = 0;
        return { changed: true, converted: true, rate, method };
    }

    function tickShellSimmer(entry, getItem, opts) {
        const can = simmerCanAdvance(entry, getItem);
        const minTemp = simmerTempOf(entry, getItem);
        const foodTemp = heatSimmerSlots(entry, can ? minTemp : 0);
        if (!can) {
            if ((entry.cookProgress || 0) > 0) {
                entry.cookProgress -= 1;
                if (entry.cookProgress <= 0) {
                    entry.cookProgress = 0;
                    delete entry.simmerBarMinutes;
                }
                return { changed: true, converted: false, rate: 0, method: "shell_simmer" };
            }
            delete entry.simmerBarMinutes;
            return { changed: false, converted: false, rate: 0, method: "shell_simmer" };
        }

        const filled = simmerFilledCount(entry);
        const need = filled * SIMMER_MINUTES_PER_SLOT;
        entry.simmerBarMinutes = need;
        const rate = cookRate(foodTemp, minTemp);
        const done = applyCookProgress(entry, need, rate);
        if (!done) {
            return { changed: true, converted: false, rate, method: "shell_simmer" };
        }
        const inherit = simmerFoodTemp(entry);
        entry.cookProgress = 0;
        delete entry.simmerBarMinutes;
        if (typeof opts.finishSimmer === "function") {
            opts.finishSimmer(entry);
        }
        applyStackTemp(entry.catalyst, inherit);
        entry.cookTemp = stackTemp(entry.catalyst);
        return { changed: true, converted: true, rate, method: "shell_simmer" };
    }

    function onCookChanged(entry, prevId) {
        if (!entry) return;
        if (!entry.cook || entry.cook.id !== prevId) {
            entry.cookProgress = 0;
            delete entry.roastBarMinutes;
        }
        entry.cookTemp = stackTemp(entry.cook);
    }

    return {
        AMBIENT_TEMP,
        HEAT_DT,
        COOL_DT,
        SMOLDER_MINUTES,
        SIMMER_MINUTES_PER_SLOT,
        SIMMER_TEMP,
        IGNITE_TEMP,
        NEAR_MAX_DELTA,
        IDLE_SIP_MUL,
        LIT_ID,
        UNLIT_ID,
        LIGHT_RADIUS,
        LIGHT_STOPS,
        UNLIT_LIGHT_MUL,
        changeTemperature,
        heatBand,
        heatLabel,
        heatColor,
        formatTemp,
        displayBand,
        lightBand,
        lightRadiusTiles,
        lightRadiusAtTemp,
        lightRadiusForEntry,
        fuelProps,
        peekFuel,
        hasFuel,
        hasCookInput,
        isBurning,
        isSmoldering,
        isIdleSip,
        isCookAdvancing,
        burnMinutes,
        cookRate,
        roastRecipe,
        catalystMethod,
        simmerFilledCount,
        simmerCanAdvance,
        simmerFoodTemp,
        hasSimmerContents,
        isSimmerIngredient,
        stackTemp,
        applyStackTemp,
        copyStackTemp,
        stackShowsTemp,
        mergeTemp,
        applyMergedStackTemp,
        tickStackTemp,
        ensureSlots,
        migrateEntry,
        igniteFuel,
        tryAutoIgnite,
        lightPit,
        tickPit,
        tickCook,
        onCookChanged,
        makeResultStack
    };
});
