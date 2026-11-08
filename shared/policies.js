/**
 * Settlement assign policies. Phaser-free.
 * Weapon, armor, and food allow-lists, plus the one next gear step.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Policies = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const KINDS = ["weapon", "armor", "food"];
    const COMBAT = ["fight", "flee", "neutral"];
    const CARE = ["none", "leaf", "best"];
    const MEDICINE_TYPES = ["any", "leaf_cord", "poultice"];
    const FOOD_GROUPS = ["raw", "roasted", "meals", "human"];
    const ARMOR_SLOTS = ["head", "torso", "legs", "feet", "back", "waist"];
    const ARMOR_SLOT_NAMES = {
        head: "Head",
        torso: "Torso",
        legs: "Legs",
        feet: "Feet",
        back: "Back",
        waist: "Waist"
    };
    const ARROW_MAX = 20;
    const MEDICINE_MAX = 5;
    const FLEE_TILES = 8;
    const HUMAN_IDS = { raw_human_flesh: true, roasted_human_flesh: true };
    const GRADE_RANK = { fine: 3, rough: 2, crude: 1 };

    function partyApi() {
        if (typeof Party !== "undefined" && Party.meleeDamageOf) return Party;
        if (typeof module === "object" && module.exports) {
            try { return require("./party"); } catch (_) { return null; }
        }
        return null;
    }

    function rangedApi() {
        if (typeof Ranged !== "undefined" && Ranged.baseDamage) return Ranged;
        if (typeof module === "object" && module.exports) {
            try { return require("./ranged"); } catch (_) { return null; }
        }
        return null;
    }

    function storageApi() {
        if (typeof StorageFilter !== "undefined" && StorageFilter.leafCategory) return StorageFilter;
        if (typeof module === "object" && module.exports) {
            try { return require("./storageFilter"); } catch (_) { return null; }
        }
        return null;
    }

    function uid() {
        return `p${Math.random().toString(36).slice(2, 10)}`;
    }

    function clampName(name) {
        return String(name || "").trim().slice(0, 24);
    }

    function nameKey(name) {
        return clampName(name).toLowerCase();
    }

    function policyNameTaken(list, name, exceptId) {
        const key = nameKey(name);
        if (!key) return false;
        return (list || []).some((p) => p && p.id !== exceptId && nameKey(p.name) === key);
    }

    function uniquePolicyName(list, desired) {
        const base = clampName(desired) || "Policy";
        if (!policyNameTaken(list, base)) return base;
        for (let n = 2; n < 100; n++) {
            const suffix = ` ${n}`;
            const room = Math.max(1, 24 - suffix.length);
            const candidate = clampName(`${base.slice(0, room).trimEnd()}${suffix}`);
            if (!policyNameTaken(list, candidate)) return candidate;
        }
        return base;
    }

    function uniq(list) {
        const out = [];
        const seen = new Set();
        for (const v of list || []) {
            const s = String(v || "");
            if (!s || seen.has(s)) continue;
            seen.add(s);
            out.push(s);
        }
        return out;
    }

    function defOf(stack, getItem) {
        if (!stack) return null;
        if (stack.weapon || stack.equip || stack.food || stack.bandage) return stack;
        const id = stack.id || stack;
        return typeof getItem === "function" ? getItem(id) : null;
    }

    function boolMap(raw, keys, fallback) {
        const out = {};
        for (const k of keys) {
            if (raw && typeof raw[k] === "boolean") out[k] = raw[k];
            else out[k] = !!fallback[k];
        }
        return out;
    }

    function foodBuiltin(id, name, groups, blockRawHuman) {
        return {
            id,
            name,
            builtin: true,
            groups,
            blockRawHuman: !!blockRawHuman,
            offCategories: [],
            offItems: [],
            onItems: []
        };
    }

    function defaultFoodPolicies() {
        const all = { raw: true, roasted: true, meals: true, human: true };
        return [
            foodBuiltin("anything", "Anything", all, false),
            foodBuiltin("no_raw", "No raw", { raw: false, roasted: true, meals: true, human: true }, true),
            foodBuiltin("no_human", "No human meat", { raw: true, roasted: true, meals: true, human: false }, false),
            foodBuiltin("prepared", "Prepared only", { raw: false, roasted: true, meals: true, human: true }, true)
        ];
    }

    function gearBuiltin(id, name, offCategories) {
        return {
            id,
            name,
            builtin: true,
            groups: null,
            blockRawHuman: false,
            offCategories: offCategories || [],
            offItems: [],
            onItems: []
        };
    }

    function defaultGearPolicies() {
        return [gearBuiltin("anything", "Anything", [])];
    }

    function defaultWeaponPolicies() {
        return [
            gearBuiltin("melee", "Melee", ["ranged"]),
            gearBuiltin("ranged", "Ranged", ["melee"])
        ];
    }

    function defaultPolicies() {
        return {
            weapon: defaultWeaponPolicies(),
            armor: defaultGearPolicies(),
            food: defaultFoodPolicies()
        };
    }

    function normalizePolicy(raw, kind) {
        const builtinFood = kind === "food" ? defaultFoodPolicies().find((p) => p.id === raw?.id) : null;
        const builtinWeapon = kind === "weapon" ? defaultWeaponPolicies().find((p) => p.id === raw?.id) : null;
        const builtinGear = kind === "armor" && raw?.id === "anything";
        const builtin = !!(raw?.builtin || builtinFood || builtinWeapon || builtinGear);
        const base = builtinFood || builtinWeapon || (builtinGear ? defaultGearPolicies()[0] : null);
        const groups = kind === "food"
            ? boolMap(raw?.groups || base?.groups, FOOD_GROUPS, base?.groups || { raw: true, roasted: true, meals: true, human: true })
            : null;
        const locked = !!(builtin && base);
        return {
            id: String(raw?.id || base?.id || uid()),
            name: locked ? base.name : (clampName(raw?.name) || "Policy"),
            builtin,
            groups,
            blockRawHuman: kind === "food" ? !!(raw?.blockRawHuman || base?.blockRawHuman) : false,
            offCategories: locked ? uniq(base.offCategories) : uniq(raw?.offCategories),
            offItems: locked ? uniq(base.offItems) : uniq(raw?.offItems),
            onItems: locked ? [] : uniq(raw?.onItems).filter((id) => !(raw?.offItems || []).map(String).includes(id))
        };
    }

    function normalizeList(raw, kind) {
        const defaults = kind === "food"
            ? defaultFoodPolicies()
            : (kind === "weapon" ? defaultWeaponPolicies() : defaultGearPolicies());
        const byDefault = new Map(defaults.map((d) => [d.id, d]));
        const list = Array.isArray(raw) ? raw : [];
        const out = [];
        const seen = new Set();
        for (const p of list) {
            if (!p || !p.id || seen.has(String(p.id))) continue;
            const id = String(p.id);
            const def = byDefault.get(id);
            if (def) {
                const row = normalizePolicy({ ...def, ...p, id: def.id, builtin: true }, kind);
                out.push(row);
                seen.add(row.id);
                continue;
            }
            if (id === "anything") continue;
            const row = normalizePolicy({ ...p, builtin: false }, kind);
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            out.push(row);
        }
        for (const def of defaults) {
            if (seen.has(def.id)) continue;
            const row = normalizePolicy({ ...def, id: def.id, builtin: true }, kind);
            out.push(row);
            seen.add(row.id);
        }
        return out;
    }

    function movePolicy(kind, policies, id, toIndex) {
        const libs = normalizePolicies(policies);
        const list = (libs[kind] || []).slice();
        const from = list.findIndex((p) => p && p.id === id);
        if (from < 0) return libs;
        const to = Math.max(0, Math.min(list.length - 1, toIndex | 0));
        if (from === to) return libs;
        const [row] = list.splice(from, 1);
        list.splice(to, 0, row);
        libs[kind] = list;
        return libs;
    }

    function normalizePolicies(raw) {
        const src = raw && typeof raw === "object" ? raw : {};
        return {
            weapon: normalizeList(src.weapon, "weapon"),
            armor: normalizeList(src.armor, "armor"),
            food: normalizeList(src.food, "food")
        };
    }

    function policyById(list, id) {
        return (list || []).find((p) => p && p.id === id) || null;
    }

    function defaultAssign() {
        return {
            weaponPolicyId: "melee",
            armorPolicyId: "anything",
            foodPolicyId: "anything",
            combat: "fight",
            care: "best",
            medicineCount: 0,
            medicineType: "any",
            arrowCount: ARROW_MAX
        };
    }

    function normalizeAssign(raw) {
        const base = defaultAssign();
        const src = raw && typeof raw === "object" ? raw : {};
        const combat = COMBAT.includes(src.combat) ? src.combat : base.combat;
        const care = CARE.includes(src.care) ? src.care : base.care;
        const medicineType = MEDICINE_TYPES.includes(src.medicineType) ? src.medicineType : base.medicineType;
        const medicineCount = Math.max(0, Math.min(MEDICINE_MAX, Math.floor(Number(src.medicineCount) || 0)));
        const arrowCount = Math.max(0, Math.min(ARROW_MAX, Math.floor(Number(src.arrowCount))));
        return {
            weaponPolicyId: String(src.weaponPolicyId || base.weaponPolicyId),
            armorPolicyId: String(src.armorPolicyId || base.armorPolicyId),
            foodPolicyId: String(src.foodPolicyId || base.foodPolicyId),
            combat,
            care,
            medicineCount,
            medicineType,
            arrowCount: Number.isFinite(Number(src.arrowCount)) ? arrowCount : base.arrowCount
        };
    }

    function assignFromOrder(libs) {
        const row = defaultAssign();
        if (libs?.weapon?.[0]?.id) row.weaponPolicyId = libs.weapon[0].id;
        if (libs?.armor?.[0]?.id) row.armorPolicyId = libs.armor[0].id;
        if (libs?.food?.[0]?.id) row.foodPolicyId = libs.food[0].id;
        return row;
    }

    function resolveAssign(raw, policies) {
        const libs = normalizePolicies(policies);
        const row = raw == null ? assignFromOrder(libs) : normalizeAssign(raw);
        if (!policyById(libs.weapon, row.weaponPolicyId)) row.weaponPolicyId = libs.weapon[0]?.id || "melee";
        if (!policyById(libs.armor, row.armorPolicyId)) row.armorPolicyId = libs.armor[0]?.id || "anything";
        if (!policyById(libs.food, row.foodPolicyId)) row.foodPolicyId = libs.food[0]?.id || "anything";
        return row;
    }

    function gearAllowed(policy, itemId, category) {
        if (!policy || !itemId) return true;
        const id = String(itemId);
        if ((policy.onItems || []).includes(id)) return true;
        if ((policy.offItems || []).includes(id)) return false;
        if (category && (policy.offCategories || []).includes(category)) return false;
        return true;
    }

    function itemAllowed(policy, itemId, category) {
        return gearAllowed(policy, itemId, category);
    }

    function isHumanId(id) {
        return !!HUMAN_IDS[String(id || "")];
    }

    function ingredientId(entry) {
        if (!entry) return "";
        if (typeof entry === "string") return entry;
        return String(entry.id || "");
    }

    function hasHumanIngredient(stack) {
        const lists = [];
        if (Array.isArray(stack?.ingredients)) lists.push(stack.ingredients);
        if (Array.isArray(stack?.food?.ingredients)) lists.push(stack.food.ingredients);
        for (const list of lists) {
            for (const entry of list) {
                if (isHumanId(ingredientId(entry))) return true;
            }
        }
        return false;
    }

    function foodGroup(stack, getItem) {
        if (!stack) return null;
        const id = String(stack.id || "");
        if (isHumanId(id) || hasHumanIngredient(stack)) {
            if (id === "raw_human_flesh") return "humanRaw";
            if (id === "roasted_human_flesh") return "humanRoasted";
            return "humanMeal";
        }
        const SF = storageApi();
        const def = defOf(stack, getItem);
        let leaf = "";
        if (SF?.leafCategory) {
            const roast = SF.roastResultIds ? SF.roastResultIds([def].filter(Boolean)) : null;
            leaf = SF.leafCategory(def || { id }, roast) || "";
        }
        if (leaf === "food/raw" || (!leaf && def?.food && !SF)) return "raw";
        if (leaf === "food/roasted") return "roasted";
        if (leaf === "food/meals") return "meals";
        if (def?.food) {
            if (SF?.isPreparedFood && SF.isPreparedFood(stack, def)) {
                return leaf === "food/meals" ? "meals" : "roasted";
            }
            return "raw";
        }
        return null;
    }

    function foodPolicyOf(policyOrAssign, policies) {
        if (!policyOrAssign) return defaultFoodPolicies()[0];
        if (policyOrAssign.groups) return policyOrAssign;
        if (policyOrAssign.foodPolicyId) {
            const libs = normalizePolicies(policies);
            return policyById(libs.food, policyOrAssign.foodPolicyId) || libs.food[0];
        }
        return policyOrAssign;
    }

    function foodAllows(policy, stack, getItem, policies) {
        const group = foodGroup(stack, getItem);
        if (!group) return true;
        const p = foodPolicyOf(policy, policies) || defaultFoodPolicies()[0];
        const human = group === "humanRaw" || group === "humanRoasted" || group === "humanMeal";
        if (p.blockRawHuman && group === "humanRaw") return false;
        if (human) {
            if (p.groups && p.groups.human === false) return false;
            if (group === "humanRaw" && p.blockRawHuman) return false;
            return p.groups ? p.groups.human !== false : true;
        }
        if (!p.groups) return true;
        return !!p.groups[group];
    }

    function medicineMatches(type, itemId) {
        if (type === "leaf_cord") return itemId === "leaf_cord";
        if (type === "poultice") return itemId === "poultice";
        return itemId === "leaf_cord" || itemId === "poultice";
    }

    function medicineAllowed(care, itemId) {
        if (!itemId) return false;
        if (care === "none") return false;
        if (care === "leaf") return itemId === "leaf_cord";
        return itemId === "leaf_cord" || itemId === "poultice";
    }

    function bandageScore(meta) {
        const b = meta?.bandage;
        if (!b) return -1;
        return (Number(b.tendQuality) || 0) * 1000
            + (Number(b.tendQualityMax) || 0) * 10
            + (Number(b.batchSeverity) || 0);
    }

    function isBow(stack, getItem) {
        if (!stack) return false;
        const R = rangedApi();
        if (R?.bowStats && R.bowStats(stack)) return true;
        const meta = defOf(stack, getItem);
        return meta?.weapon?.type === "ranged";
    }

    function weaponScore(stack, getItem) {
        if (!stack?.id) return 0;
        if (isBow(stack, getItem)) {
            const R = rangedApi();
            const d = R?.baseDamage ? R.baseDamage(stack) : 0;
            return d > 0 ? d : 0;
        }
        const P = partyApi();
        if (P?.meleeDamageOf) return Number(P.meleeDamageOf(stack, getItem)) || 0;
        return 0;
    }

    function isWeapon(stack, getItem) {
        if (!stack?.id) return false;
        if (isBow(stack, getItem)) return true;
        const meta = defOf(stack, getItem);
        return !!(meta && meta.weapon);
    }

    function armorSlotOf(stack, getItem) {
        const meta = defOf(stack, getItem);
        const slot = meta?.equip?.slot;
        return ARMOR_SLOTS.includes(slot) ? slot : null;
    }

    function armorScore(stack, getItem) {
        const meta = defOf(stack, getItem);
        const a = meta?.equip?.armor || {};
        return (Number(a.sharp) || 0) + (Number(a.blunt) || 0);
    }

    function arrowGrade(stack) {
        return GRADE_RANK[stack?.knapQuality] || 0;
    }

    function arrowKey(stack) {
        if (!stack || stack.id !== "arrow") return "";
        return [stack.knapMaterial || "", stack.stone || "", stack.knapQuality || ""].join("|");
    }

    function sameArrow(a, b) {
        return !!a && !!b && a.id === "arrow" && b.id === "arrow" && arrowKey(a) === arrowKey(b);
    }

    function qtyOf(stack) {
        return Math.max(0, Math.floor(Number(stack?.quantity) || 0));
    }

    function maxStack(stack, getItem) {
        const meta = defOf(stack, getItem);
        const n = Math.floor(Number(meta?.maxStack) || 0);
        return n > 0 ? n : 99;
    }

    function selfSlots(pawn) {
        const out = [];
        const inv = pawn?.inventory || [];
        for (let i = 0; i < inv.length; i++) {
            if (inv[i]?.id) out.push({ stack: inv[i], place: "inv", index: i, self: true, reserved: false });
        }
        const over = pawn?.overflow || [];
        for (let i = 0; i < over.length; i++) {
            if (over[i]?.id) out.push({ stack: over[i], place: "overflow", index: i, self: true, reserved: false });
        }
        return out;
    }

    function countArrows(pawn) {
        let n = 0;
        for (const row of selfSlots(pawn)) {
            if (row.stack.id === "arrow") n += qtyOf(row.stack) || 1;
        }
        return n;
    }

    function countMedicine(pawn, type) {
        let n = 0;
        for (const row of selfSlots(pawn)) {
            if (medicineMatches(type, row.stack.id)) n += qtyOf(row.stack) || 1;
        }
        return n;
    }

    function emptyInv(pawn) {
        const inv = pawn?.inventory || [];
        for (let i = 0; i < inv.length; i++) {
            if (!inv[i]) return i;
        }
        return -1;
    }

    function wornSlots(pawn) {
        const eq = pawn?.equipment || {};
        const out = [];
        for (const slot of ["head", "torso", "legs", "feet", "back"]) {
            out.push({ slot, index: 0, stack: eq[slot] || null, equipSlot: slot });
        }
        const waist = Array.isArray(eq.waist) ? eq.waist : [];
        for (let i = 0; i < waist.length; i++) {
            out.push({ slot: "waist", index: i, stack: waist[i] || null, equipSlot: `waist:${i}` });
        }
        return out;
    }

    function campSources(sources) {
        return (sources || []).filter((s) => s && s.stack?.id && !s.self && !s.reserved);
    }

    function hasArrow(pawn, sources, arrowCount) {
        if (countArrows(pawn) > 0) return true;
        if (!(arrowCount > 0)) return false;
        return campSources(sources).some((s) => s.stack.id === "arrow")
            || selfSlots(pawn).some((s) => s.stack.id === "arrow");
    }

    function blocksCombat(assign) {
        const combat = normalizeAssign(assign).combat;
        return combat === "flee" || combat === "neutral";
    }

    function nextGear(pawn, sources, assign, policies, getItem) {
        const libs = normalizePolicies(policies);
        const row = resolveAssign(assign, libs);
        const weaponPolicy = policyById(libs.weapon, row.weaponPolicyId) || libs.weapon[0];
        const armorPolicy = policyById(libs.armor, row.armorPolicyId) || libs.armor[0];
        const list = []
            .concat(selfSlots(pawn))
            .concat(sources || []);

        for (const worn of wornSlots(pawn)) {
            if (!worn.stack?.id) continue;
            const slot = armorSlotOf(worn.stack, getItem);
            if (!slot) continue;
            if (gearAllowed(armorPolicy, worn.stack.id, slot)) continue;
            return { op: "stash", from: { place: "equip", equipSlot: worn.equipSlot, index: worn.index }, stack: worn.stack };
        }

        const hand = pawn?.inventory?.[0] || null;
        if (hand && isWeapon(hand, getItem) && !gearAllowed(weaponPolicy, hand.id, weaponCategory(hand, getItem))) {
            return { op: "stash", from: { place: "inv", index: 0 }, stack: hand };
        }

        for (const worn of wornSlots(pawn)) {
            const slot = worn.slot;
            const wornScore = worn.stack?.id ? armorScore(worn.stack, getItem) : -1;
            let best = null;
            let bestScore = worn.stack?.id ? wornScore : -1;
            for (const src of list) {
                if (!src?.stack?.id || src.reserved) continue;
                if (armorSlotOf(src.stack, getItem) !== slot) continue;
                if (!gearAllowed(armorPolicy, src.stack.id, slot)) continue;
                if (worn.stack && src.self && src.place === "equip") continue;
                const score = armorScore(src.stack, getItem);
                if (worn.stack) {
                    if (!(score > wornScore)) continue;
                    if (best && !(score > bestScore)) continue;
                } else if (best && !(score > bestScore)) continue;
                best = src;
                bestScore = score;
            }
            if (!worn.stack && best) return equipOrFetch(best, worn.equipSlot);
            if (worn.stack && best && bestScore > wornScore) {
                return { op: "stash", from: { place: "equip", equipSlot: worn.equipSlot, index: worn.index }, stack: worn.stack };
            }
        }

        let bestWeapon = null;
        let bestW = -1;
        const arrowsOk = hasArrow(pawn, sources, row.arrowCount);
        const considerWeapon = (src) => {
            if (!src?.stack?.id || src.reserved) return;
            if (!isWeapon(src.stack, getItem)) return;
            if (!gearAllowed(weaponPolicy, src.stack.id, weaponCategory(src.stack, getItem))) return;
            if (isBow(src.stack, getItem) && !arrowsOk) return;
            const score = weaponScore(src.stack, getItem);
            if (!(score > bestW)) return;
            bestW = score;
            bestWeapon = src;
        };
        for (const src of list) considerWeapon(src);
        const slot0 = pawn?.inventory?.[0] || null;
        const slot0IsBest = !!(bestWeapon && bestWeapon.self && bestWeapon.place === "inv" && bestWeapon.index === 0);
        if (bestWeapon && !slot0IsBest) {
            if (slot0 && !(bestWeapon.self && bestWeapon.place === "inv")) {
                const hole = emptyInv(pawn);
                if (hole < 0) {
                    /* no room to slide the occupant aside */
                } else {
                    return { op: "slide", from: 0, to: hole };
                }
            } else if (bestWeapon.self && bestWeapon.place === "inv" && bestWeapon.index !== 0) {
                return { op: "swap", a: 0, b: bestWeapon.index };
            } else if (bestWeapon.self && bestWeapon.place === "overflow") {
                const hole = emptyInv(pawn);
                if (slot0 && hole < 0) {
                    /* leave it */
                } else if (slot0) {
                    return { op: "slide", from: 0, to: hole };
                } else {
                    return { op: "moveIn", from: bestWeapon, to: 0 };
                }
            } else if (!slot0) {
                return equipOrFetch(bestWeapon, null, 0);
            }
        }

        if (slot0 && isBow(slot0, getItem) && row.arrowCount > 0) {
            const have = countArrows(pawn);
            if (have < row.arrowCount) {
                const need = row.arrowCount - have;
                const held = selfSlots(pawn).filter((s) => s.stack.id === "arrow");
                const heldStack = held[0] || null;
                const room = heldStack
                    ? Math.max(0, maxStack(heldStack.stack, getItem) - (qtyOf(heldStack.stack) || 1))
                    : 0;
                if (heldStack && room > 0) {
                    const src = campSources(sources)
                        .filter((s) => sameArrow(s.stack, heldStack.stack))
                        .sort((a, b) => qtyOf(b.stack) - qtyOf(a.stack))[0];
                    if (src) {
                        return {
                            op: "fetch",
                            source: src,
                            qty: Math.min(need, room, qtyOf(src.stack) || 1),
                            into: "merge",
                            merge: heldStack,
                            claimKey: src.claimKey || null
                        };
                    }
                }
                if (!heldStack || room <= 0) {
                    const hole = emptyInv(pawn);
                    if (hole >= 0) {
                        const piles = campSources(sources).filter((s) => s.stack.id === "arrow");
                        piles.sort((a, b) => arrowGrade(b.stack) - arrowGrade(a.stack));
                        const src = piles[0];
                        if (src) {
                            return {
                                op: "fetch",
                                source: src,
                                qty: Math.min(need, maxStack(src.stack, getItem), qtyOf(src.stack) || 1),
                                into: "slot",
                                slot: hole,
                                claimKey: src.claimKey || null
                            };
                        }
                    }
                }
            }
        }

        if (!pawn?.onMedicineJob) {
            const have = countMedicine(pawn, row.medicineType);
            if (have > row.medicineCount) {
                const extra = have - row.medicineCount;
                const piles = selfSlots(pawn).filter((s) => medicineMatches(row.medicineType, s.stack.id));
                const src = piles[piles.length - 1];
                if (src) {
                    return {
                        op: "stash",
                        from: { place: src.place, index: src.index },
                        stack: src.stack,
                        qty: Math.min(extra, qtyOf(src.stack) || 1)
                    };
                }
            } else if (have < row.medicineCount) {
                const hole = emptyInv(pawn);
                if (hole >= 0) {
                    const piles = campSources(sources).filter((s) => {
                        const meta = defOf(s.stack, getItem);
                        return meta?.bandage && medicineMatches(row.medicineType, s.stack.id);
                    });
                    piles.sort((a, b) => bandageScore(defOf(b.stack, getItem)) - bandageScore(defOf(a.stack, getItem)));
                    const src = piles[0];
                    if (src) {
                        const need = row.medicineCount - have;
                        return {
                            op: "fetch",
                            source: src,
                            qty: Math.min(need, qtyOf(src.stack) || 1),
                            into: "slot",
                            slot: hole,
                            claimKey: src.claimKey || null
                        };
                    }
                }
            }
        }
        return null;
    }

    function equipOrFetch(src, equipSlot, invSlot) {
        if (src.self) {
            return {
                op: "equip",
                from: { place: src.place, index: src.index },
                equipSlot: equipSlot || null,
                invSlot: invSlot == null ? null : invSlot,
                stack: src.stack
            };
        }
        return {
            op: "fetch",
            source: src,
            qty: Math.min(qtyOf(src.stack) || 1, src.stack.id === "arrow" ? ARROW_MAX : (qtyOf(src.stack) || 1)),
            into: equipSlot ? "equip" : "slot",
            equipSlot: equipSlot || null,
            slot: invSlot == null ? 0 : invSlot,
            claimKey: src.claimKey || null
        };
    }

    function weaponCategory(stack, getItem) {
        if (!stack?.id) return null;
        if (isBow(stack, getItem)) return "ranged";
        const meta = defOf(stack, getItem);
        return meta?.weapon ? "melee" : null;
    }

    function catalog(items) {
        const list = (items || []).filter((it) => it && it.id);
        const weapons = [];
        const melee = [];
        const ranged = [];
        const armor = ARMOR_SLOTS.map((slot) => ({ id: slot, name: ARMOR_SLOT_NAMES[slot], items: [] }));
        const bySlot = Object.fromEntries(armor.map((g) => [g.id, g]));
        for (const def of list) {
            if (def.weapon) {
                const row = { id: def.id, name: def.name || def.id };
                weapons.push(row);
                if (def.weapon.type === "ranged") ranged.push(row);
                else melee.push(row);
            }
            const slot = def.equip?.slot;
            if (slot && bySlot[slot]) bySlot[slot].items.push({ id: def.id, name: def.name || def.id });
        }
        weapons.sort((a, b) => a.name.localeCompare(b.name));
        melee.sort((a, b) => a.name.localeCompare(b.name));
        ranged.sort((a, b) => a.name.localeCompare(b.name));
        for (const g of armor) g.items.sort((a, b) => a.name.localeCompare(b.name));
        return {
            weapons,
            weaponGroups: [
                { id: "melee", name: "Melee", items: melee },
                { id: "ranged", name: "Ranged", items: ranged }
            ].filter((g) => g.items.length),
            armor: armor.filter((g) => g.items.length),
            food: FOOD_GROUPS.map((id) => ({
                id,
                name: id === "raw" ? "Raw" : id === "roasted" ? "Roasted" : id === "meals" ? "Meals" : "Human meat"
            }))
        };
    }

    function toggleItem(policy, itemId, category) {
        const next = normalizePolicy(policy, policy?.groups ? "food" : "weapon");
        if (next.builtin) return next;
        const id = String(itemId || "");
        if (!id) return next;
        const off = new Set(next.offItems);
        if (off.has(id)) off.delete(id);
        else off.add(id);
        next.offItems = [...off];
        if (category && off.has(id)) {
            next.offCategories = next.offCategories.filter((c) => c !== category);
        }
        return next;
    }

    function setItems(policy, itemIds, allowed) {
        const next = normalizePolicy(policy, policy?.groups ? "food" : "weapon");
        if (next.builtin) return next;
        const off = new Set(next.offItems);
        for (const id of itemIds || []) {
            if (allowed) off.delete(id);
            else off.add(String(id));
        }
        next.offItems = [...off];
        if (allowed) next.offCategories = [];
        return next;
    }

    function toggleFood(policy, group) {
        const next = normalizePolicy(policy, "food");
        if (next.builtin) return next;
        if (!FOOD_GROUPS.includes(group)) return next;
        next.groups[group] = !next.groups[group];
        next.blockRawHuman = false;
        return next;
    }

    function createPolicy(kind, policies) {
        const libs = normalizePolicies(policies);
        const copy = kind === "food"
            ? policyById(libs.food, "anything")
            : (policyById(libs[kind], "anything") || {
                offCategories: [],
                offItems: [],
                onItems: [],
                groups: null
            });
        const row = normalizePolicy({
            ...copy,
            id: uid(),
            name: uniquePolicyName(libs[kind], "New policy"),
            builtin: false
        }, kind);
        libs[kind] = libs[kind].concat(row);
        return { policies: libs, id: row.id };
    }

    function duplicatePolicy(kind, policies, id) {
        const libs = normalizePolicies(policies);
        const src = policyById(libs[kind], id) || libs[kind][0];
        const row = normalizePolicy({
            ...src,
            id: uid(),
            name: uniquePolicyName(libs[kind], `Copy of ${src.name}`),
            builtin: false,
            blockRawHuman: false
        }, kind);
        libs[kind] = libs[kind].concat(row);
        return { policies: libs, id: row.id };
    }

    function renamePolicy(kind, policies, id, name) {
        const libs = normalizePolicies(policies);
        const src = policyById(libs[kind], id);
        if (!src || src.builtin) return libs;
        const next = clampName(name);
        if (!next || policyNameTaken(libs[kind], next, src.id)) return libs;
        src.name = next;
        return libs;
    }

    function deletePolicy(kind, policies, id) {
        const libs = normalizePolicies(policies);
        const src = policyById(libs[kind], id);
        if (!src || src.builtin) return { policies: libs, removed: false };
        libs[kind] = libs[kind].filter((p) => p.id !== id);
        return { policies: libs, removed: true };
    }

    function cycleCombat(combat) {
        const i = COMBAT.indexOf(combat);
        return COMBAT[(i + 1) % COMBAT.length] || "fight";
    }

    function cycleCare(care) {
        const i = CARE.indexOf(care);
        return CARE[(i + 1) % CARE.length] || "best";
    }

    function cycleMedicine(type) {
        const i = MEDICINE_TYPES.indexOf(type);
        return MEDICINE_TYPES[(i + 1) % MEDICINE_TYPES.length] || "any";
    }

    const COMBAT_LABEL = { fight: "Fight", flee: "Flee", neutral: "Neutral" };
    const CARE_LABEL = { none: "None", leaf: "Leaf cord", best: "Poultice" };
    const MEDICINE_LABEL = { any: "Any", leaf_cord: "Leaf cord", poultice: "Poultice" };

    return {
        KINDS,
        COMBAT,
        CARE,
        MEDICINE_TYPES,
        FOOD_GROUPS,
        ARMOR_SLOTS,
        ARROW_MAX,
        MEDICINE_MAX,
        FLEE_TILES,
        COMBAT_LABEL,
        CARE_LABEL,
        MEDICINE_LABEL,
        defaultPolicies,
        normalizePolicies,
        defaultAssign,
        normalizeAssign,
        resolveAssign,
        movePolicy,
        policyById,
        gearAllowed,
        itemAllowed,
        foodGroup,
        foodAllows,
        medicineMatches,
        medicineAllowed,
        weaponScore,
        armorScore,
        armorSlotOf,
        isWeapon,
        isBow,
        blocksCombat,
        countArrows,
        countMedicine,
        nextGear,
        catalog,
        toggleItem,
        setItems,
        toggleFood,
        createPolicy,
        duplicatePolicy,
        renamePolicy,
        policyNameTaken,
        deletePolicy,
        cycleCombat,
        cycleCare,
        cycleMedicine,
        sameArrow,
        arrowGrade
    };
});
