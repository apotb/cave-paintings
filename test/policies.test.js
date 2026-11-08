const { test } = require("node:test");
const assert = require("node:assert/strict");
const Policies = require("../shared/policies");
const Settlement = require("../shared/settlement");
const Party = require("../shared/party");
const { loadDefs, DataStore } = require("./helpers/load");

loadDefs();

function item(id) {
    return DataStore.getItem(id);
}

function src(stack, place = "basket") {
    return {
        stack,
        place,
        index: 0,
        self: false,
        reserved: false,
        claimKey: `${place}:1:0`,
        slots: [stack]
    };
}

function bothWeapons() {
    const libs = Policies.defaultPolicies();
    libs.weapon = [{
        id: "both",
        name: "Both",
        builtin: false,
        offCategories: [],
        offItems: [],
        onItems: []
    }];
    return libs;
}

function pawn(extra = {}) {
    return {
        inventory: extra.inventory || [null, null, null, null],
        overflow: extra.overflow || [],
        equipment: extra.equipment || {
            head: null, torso: null, legs: null, feet: null, back: null, waist: [null]
        },
        ...extra
    };
}

test("new and old camps get Anything policies and a default assign", () => {
    const fresh = Settlement.ensureSettlement({ ownerId: "p" });
    assert.equal(fresh.policies.weapon.map((p) => p.id).join(","), "melee,ranged");
    assert.equal(fresh.policies.weapon[0].name, "Melee");
    assert.equal(fresh.policies.weapon[1].name, "Ranged");
    assert.equal(fresh.policies.armor[0].id, "anything");
    assert.equal(fresh.policies.food.map((p) => p.id).join(","), "anything,no_raw,no_human,prepared");
    const old = Settlement.ensureSettlement({ id: "camp", ownerId: "p" });
    const row = Settlement.assignFor(old, { id: "s1" });
    assert.equal(row.weaponPolicyId, "melee");
    assert.equal(row.armorPolicyId, "anything");
    assert.equal(row.foodPolicyId, "anything");
    assert.equal(row.combat, "fight");
    assert.equal(row.care, "best");
    assert.equal(row.medicineCount, 0);
    assert.equal(row.medicineType, "any");
    assert.equal(row.arrowCount, 20);
});

test("built-in policies cannot be renamed or deleted", () => {
    const libs = Policies.defaultPolicies();
    const renamed = Policies.renamePolicy("food", libs, "no_raw", "Raw ok");
    assert.equal(Policies.policyById(renamed.food, "no_raw").name, "No raw");
    const removed = Policies.deletePolicy("weapon", libs, "melee");
    assert.equal(removed.removed, false);
    assert.ok(Policies.policyById(removed.policies.weapon, "melee"));
    assert.ok(Policies.policyById(removed.policies.weapon, "ranged"));
    const made = Policies.createPolicy("weapon", libs);
    assert.equal(made.policies.weapon.at(-1).builtin, false);
    const gone = Policies.deletePolicy("weapon", made.policies, made.id);
    assert.equal(gone.removed, true);
});

test("dragging a policy keeps that order, and the top one is the default for a new settler", () => {
    const camp = Settlement.ensureSettlement({ ownerId: "p" });
    const made = Policies.createPolicy("weapon", camp.policies);
    camp.policies = made.policies;
    const moved = Policies.movePolicy("weapon", camp.policies, made.id, 0);
    Settlement.setPolicies(camp, "weapon", moved.weapon);
    assert.deepEqual(camp.policies.weapon.map((p) => p.id), [made.id, "melee", "ranged"]);
    const pawn = { id: "new" };
    Settlement.bindPawnAssign(camp, pawn);
    assert.equal(pawn.assign.weaponPolicyId, made.id);
    assert.equal(camp.assigns.new.armorPolicyId, "anything");
    assert.equal(camp.assigns.new.foodPolicyId, "anything");
    Settlement.setAssign(camp, "old", { weaponPolicyId: "ranged" });
    assert.equal(camp.assigns.old.weaponPolicyId, "ranged");
});

test("policy names stay unique, and copies of a default are numbered", () => {
    const libs = Policies.defaultPolicies();
    const first = Policies.duplicatePolicy("weapon", libs, "melee");
    assert.equal(Policies.policyById(first.policies.weapon, first.id).name, "Copy of Melee");
    const second = Policies.duplicatePolicy("weapon", first.policies, "melee");
    assert.equal(Policies.policyById(second.policies.weapon, second.id).name, "Copy of Melee 2");
    const third = Policies.duplicatePolicy("weapon", second.policies, "melee");
    assert.equal(Policies.policyById(third.policies.weapon, third.id).name, "Copy of Melee 3");

    const made = Policies.createPolicy("armor", libs);
    assert.equal(Policies.policyById(made.policies.armor, made.id).name, "New policy");
    const again = Policies.createPolicy("armor", made.policies);
    assert.equal(Policies.policyById(again.policies.armor, again.id).name, "New policy 2");

    const custom = Policies.policyById(again.policies.armor, made.id);
    const blocked = Policies.renamePolicy("armor", again.policies, custom.id, "New policy 2");
    assert.equal(Policies.policyById(blocked.armor, custom.id).name, "New policy");
    const renamed = Policies.renamePolicy("armor", again.policies, custom.id, "Hunters");
    assert.equal(Policies.policyById(renamed.armor, custom.id).name, "Hunters");
    const same = Policies.renamePolicy("armor", renamed, custom.id, "hunters");
    assert.equal(Policies.policyById(same.armor, custom.id).name, "hunters");
    const builtin = Policies.renamePolicy("armor", same, custom.id, "Anything");
    assert.equal(Policies.policyById(builtin.armor, custom.id).name, "hunters");
});

test("deleting a custom policy sends users back to Anything", () => {
    const camp = Settlement.ensureSettlement({ ownerId: "p" });
    const made = Policies.createPolicy("food", camp.policies);
    camp.policies = made.policies;
    Settlement.setAssign(camp, "s1", { foodPolicyId: made.id, combat: "flee" });
    const left = Policies.deletePolicy("food", camp.policies, made.id);
    Settlement.setPolicies(camp, "food", left.policies.food);
    assert.equal(camp.assigns.s1.foodPolicyId, "anything");
    assert.equal(camp.assigns.s1.combat, "flee");
});

test("food policies allow the four groups", () => {
    const libs = Policies.defaultPolicies();
    const by = (id) => Policies.policyById(libs.food, id);
    const raw = { id: "apple", quantity: 1 };
    const roasted = { id: "roasted_apple", quantity: 1 };
    const meal = { id: "coconut_meal", quantity: 1, ingredients: [{ id: "apple" }] };
    const humanRaw = { id: "raw_human_flesh", quantity: 1 };
    const humanRoast = { id: "roasted_human_flesh", quantity: 1 };
    const humanMeal = { id: "meal", quantity: 1, ingredients: [{ id: "raw_human_flesh" }] };
    const allows = (policy, stack) => Policies.foodAllows(policy, stack, item);
    assert.equal(allows(by("anything"), raw), true);
    assert.equal(allows(by("anything"), humanMeal), true);
    assert.equal(allows(by("no_raw"), raw), false);
    assert.equal(allows(by("no_raw"), humanRaw), false);
    assert.equal(allows(by("no_raw"), roasted), true);
    assert.equal(allows(by("no_raw"), humanRoast), true);
    assert.equal(allows(by("no_raw"), humanMeal), true);
    assert.equal(allows(by("no_human"), raw), true);
    assert.equal(allows(by("no_human"), humanRaw), false);
    assert.equal(allows(by("no_human"), humanRoast), false);
    assert.equal(allows(by("no_human"), humanMeal), false);
    assert.equal(allows(by("prepared"), raw), false);
    assert.equal(allows(by("prepared"), roasted), true);
    assert.equal(allows(by("prepared"), humanMeal), true);
    const custom = Policies.toggleFood(Policies.createPolicy("food", libs).policies.food.at(-1), "human");
    assert.equal(allows(custom, humanMeal), false);
    assert.equal(allows(custom, meal), true);
});

test("melee and ranged policies keep the other weapon class", () => {
    const libs = Policies.defaultPolicies();
    const melee = Policies.policyById(libs.weapon, "melee");
    const ranged = Policies.policyById(libs.weapon, "ranged");
    assert.equal(Policies.gearAllowed(melee, "wooden_spear", "melee"), true);
    assert.equal(Policies.gearAllowed(melee, "longbow", "ranged"), false);
    assert.equal(Policies.gearAllowed(ranged, "longbow", "ranged"), true);
    assert.equal(Policies.gearAllowed(ranged, "stone_spear", "melee"), false);
    const spearOnly = Policies.nextGear(pawn(), [
        src({ id: "longbow", quantity: 1 }),
        src({ id: "wooden_spear", quantity: 1 }),
        src({ id: "arrow", quantity: 5 })
    ], { weaponPolicyId: "melee", arrowCount: 20 }, libs, item);
    assert.equal(spearOnly.source.stack.id, "wooden_spear");
    const bowOnly = Policies.nextGear(pawn({
        inventory: [{ id: "arrow", quantity: 1 }, null]
    }), [
        src({ id: "longbow", quantity: 1 }),
        src({ id: "wooden_spear", quantity: 1 })
    ], { weaponPolicyId: "ranged", arrowCount: 20 }, libs, item);
    assert.equal(bowOnly.op, "slide");
});

test("weapon and armor allow lists honor off items", () => {
    const policy = {
        id: "custom",
        offItems: ["longbow", "hide_tunic"],
        offCategories: [],
        onItems: []
    };
    assert.equal(Policies.gearAllowed(policy, "wooden_spear", "weapon"), true);
    assert.equal(Policies.gearAllowed(policy, "longbow", "weapon"), false);
    assert.equal(Policies.gearAllowed(policy, "hide_tunic", "torso"), false);
});

test("gear choice fills armor, keeps slot 0, and skips a bow without arrows", () => {
    const who = pawn();
    who.equipment.waist = [null];
    const pouch = src({ id: "leaf_pouch", quantity: 1 });
    const step = Policies.nextGear(who, [pouch], Policies.defaultAssign(), Policies.defaultPolicies(), item);
    assert.equal(step.op, "fetch");
    assert.equal(step.source.stack.id, "leaf_pouch");
    assert.equal(step.equipSlot, "waist:0");

    const dressed = pawn({
        equipment: { head: null, torso: { id: "hide_tunic", quantity: 1 }, legs: null, feet: null, back: null, waist: [] }
    });
    const worse = Policies.nextGear(dressed, [src({ id: "leaf_wrap", quantity: 1 })], null, null, item);
    assert.equal(worse, null);
    const better = Policies.nextGear(pawn({
        equipment: { head: null, torso: { id: "leaf_wrap", quantity: 1 }, legs: null, feet: null, back: null, waist: [] }
    }), [src({ id: "hide_tunic", quantity: 1 })], null, null, item);
    assert.equal(better.op, "stash");
    assert.equal(better.stack.id, "leaf_wrap");

    const bow = Policies.nextGear(pawn(), [
        src({ id: "longbow", quantity: 1 }),
        src({ id: "wooden_spear", quantity: 1 })
    ], { weaponPolicyId: "both" }, bothWeapons(), item);
    assert.equal(bow.source.stack.id, "wooden_spear");

    const withArrow = pawn({ inventory: [{ id: "arrow", quantity: 1 }, null] });
    const armed = Policies.nextGear(withArrow, [
        src({ id: "longbow", quantity: 1 }),
        src({ id: "stone_spear", quantity: 1 })
    ], { weaponPolicyId: "both" }, bothWeapons(), item);
    assert.equal(armed.op, "slide");

    const full = pawn({
        inventory: [
            { id: "stick", quantity: 1 },
            { id: "stick", quantity: 1 }
        ]
    });
    const stuck = Policies.nextGear(full, [src({ id: "wooden_spear", quantity: 1 })], null, null, item);
    assert.equal(stuck, null);
});

test("arrows top up into the held stack and extras stay", () => {
    const who = pawn({
        inventory: [
            { id: "longbow", quantity: 1 },
            { id: "arrow", quantity: 5, knapQuality: "rough" },
            null
        ]
    });
    const top = Policies.nextGear(who, [
        src({ id: "arrow", quantity: 40, knapQuality: "rough" })
    ], { arrowCount: 20, weaponPolicyId: "both" }, bothWeapons(), item);
    assert.equal(top.op, "fetch");
    assert.equal(top.into, "merge");
    assert.equal(top.qty, 15);

    const extra = pawn({
        inventory: [
            { id: "longbow", quantity: 1 },
            { id: "arrow", quantity: 25 },
            null
        ]
    });
    assert.equal(Policies.nextGear(extra, [], { arrowCount: 20, medicineCount: 0, weaponPolicyId: "both" }, bothWeapons(), item), null);
});

test("medicine restock stashes extras and will not take a full bag's slot", () => {
    const over = pawn({
        inventory: [null, { id: "poultice", quantity: 3 }, null]
    });
    const stash = Policies.nextGear(over, [], { medicineCount: 0, arrowCount: 0 }, null, item);
    assert.equal(stash.op, "stash");
    assert.equal(stash.stack.id, "poultice");
    assert.equal(stash.qty, 3);

    const full = pawn({
        inventory: [
            { id: "stick", quantity: 1 },
            { id: "stick", quantity: 1 }
        ]
    });
    assert.equal(Policies.nextGear(full, [
        src({ id: "poultice", quantity: 2 })
    ], { medicineCount: 2, arrowCount: 0 }, null, item), null);

    const room = pawn({ inventory: [null, null] });
    const fetch = Policies.nextGear(room, [
        src({ id: "leaf_cord", quantity: 4 }),
        src({ id: "poultice", quantity: 4 })
    ], { medicineCount: 2, medicineType: "any", arrowCount: 0 }, null, item);
    assert.equal(fetch.op, "fetch");
    assert.equal(fetch.source.stack.id, "poultice");
    assert.equal(fetch.qty, 2);
});

test("care and combat stance", () => {
    assert.equal(Policies.medicineAllowed("none", "poultice"), false);
    assert.equal(Policies.medicineAllowed("leaf", "poultice"), false);
    assert.equal(Policies.medicineAllowed("leaf", "leaf_cord"), true);
    assert.equal(Policies.medicineAllowed("best", "poultice"), true);
    assert.equal(Policies.blocksCombat({ combat: "fight" }), false);
    assert.equal(Policies.blocksCombat({ combat: "flee" }), true);
    assert.equal(Policies.blocksCombat({ combat: "neutral" }), true);
});

test("auto eat skips food the policy refuses", () => {
    const eater = {
        id: "s",
        x: 0,
        y: 0,
        inventory: [
            { id: "apple", quantity: 1, food: { kc: 20 } },
            { id: "roasted_apple", quantity: 1, food: { kc: 30 } }
        ]
    };
    const policy = Policies.policyById(Policies.defaultPolicies().food, "no_raw");
    const pick = Party.pickAutoEat(eater, [eater], {
        getItem: item,
        allowFood: (stack) => Policies.foodAllows(policy, stack, item)
    });
    assert.equal(pick.stack.id, "roasted_apple");
});
