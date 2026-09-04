const { test } = require("node:test");
const assert = require("node:assert/strict");
const Fire = require("../shared/fire");

function defs() {
    return {
        stick: { id: "stick", fuel: { kj: 5, temp: 600 } },
        leaf: { id: "leaf", fuel: { kj: 1, temp: 400 } },
        log: { id: "log", fuel: { kj: 40, temp: 800 } },
        apple: {
            id: "apple",
            cook: { stick_roast: { result: "roasted_apple", minutes: 10, temp: 300 } },
            food: { spoil: 48 }
        },
        roasted_apple: { id: "roasted_apple", food: { spoil: 48 } },
        raw_beef: {
            id: "raw_beef",
            cook: { stick_roast: { result: "roast_beef", minutes: 15, temp: 550 } },
            food: { spoil: 12 }
        },
        roast_beef: { id: "roast_beef", food: { spoil: 36 } },
        sharp_stick: { id: "sharp_stick", cook: { method: "stick_roast" } },
        cracked_coconut: { id: "cracked_coconut", cook: { method: "shell_simmer", temp: 450 } },
        drying_rack: { id: "drying_rack", cook: { method: "smoke_hide" } }
    };
}

function getItem(id) {
    return defs()[id] || null;
}

function pit(extra = {}) {
    return Fire.migrateEntry({
        id: "unlit_campfire",
        fuel: [null, null],
        cook: null,
        catalyst: null,
        simmer: [null, null, null, null],
        cookProgress: 0,
        burnRemaining: 0,
        ...extra
    }, getItem);
}

test("pit ramps toward stick 600, not instantly", () => {
    const e = pit({ fuel: [{ id: "stick", quantity: 8 }, null] });
    assert.equal(Fire.lightPit(e, getItem), true);
    assert.ok(e.pitTemp < 100);
    for (let t = 1; t <= 5; t++) Fire.tickPit(e, getItem, t);
    assert.ok(e.pitTemp < 400, `should still be spinning up after 5 min, got ${e.pitTemp}`);
    for (let t = 6; t <= 20; t++) Fire.tickPit(e, getItem, t);
    assert.ok(e.pitTemp >= 540, `expected >= 540 after 20 min, got ${e.pitTemp}`);
    assert.ok(e.pitTemp < 600, `should not already be 600, got ${e.pitTemp}`);
    assert.equal(Fire.heatBand(e.pitTemp), "hot");
});

test("leaf-only pit never reaches meat temp 550", () => {
    const e = pit({ fuel: [{ id: "leaf", quantity: 30 }, null] });
    Fire.lightPit(e, getItem);
    for (let t = 1; t <= 20; t++) Fire.tickPit(e, getItem, t);
    assert.ok(e.pitTemp <= 405, `leaf cap ~400, got ${e.pitTemp}`);
    assert.ok(e.pitTemp < 550);
});

test("cookRate is 0 below min temp and higher with extra heat", () => {
    assert.equal(Fire.cookRate(400, 550), 0);
    const atGate = Fire.cookRate(550, 550);
    const roaring = Fire.cookRate(800, 550);
    assert.equal(atGate, 1);
    assert.ok(roaring > atGate, `800° should cook faster than 550°, got ${roaring} vs ${atGate}`);
});

test("leaf fire cannot roast meat; stick fire can", () => {
    const leafPit = pit({
        id: "campfire",
        fuel: [{ id: "leaf", quantity: 20 }, null],
        catalyst: { id: "sharp_stick", quantity: 1 },
        cook: { id: "raw_beef", quantity: 1 }
    });
    Fire.lightPit(leafPit, getItem);
    for (let t = 1; t <= 25; t++) {
        Fire.tickPit(leafPit, getItem, t);
        Fire.tickCook(leafPit, getItem, { worldMinute: t });
    }
    assert.equal(leafPit.cook.id, "raw_beef");
    assert.ok((leafPit.cookProgress || 0) < 1);

    const stickPit = pit({
        fuel: [{ id: "stick", quantity: 20 }, null],
        catalyst: { id: "sharp_stick", quantity: 1 },
        cook: { id: "raw_beef", quantity: 1 }
    });
    Fire.lightPit(stickPit, getItem);
    let converted = false;
    for (let t = 1; t <= 80; t++) {
        Fire.tickPit(stickPit, getItem, t);
        const r = Fire.tickCook(stickPit, getItem, { worldMinute: t });
        if (r.converted) {
            converted = true;
            break;
        }
    }
    assert.equal(converted, true);
    assert.equal(stickPit.cook.id, "roast_beef");
});

test("fuel empty → unlit smolder; auto-ignite only when still hot", () => {
    const e = pit({ fuel: [{ id: "leaf", quantity: 1 }, null] });
    Fire.lightPit(e, getItem);
    assert.equal(e.id, "campfire");
    Fire.tickPit(e, getItem, 1);
    assert.equal(e.id, "unlit_campfire");
    e.fuel[0] = { id: "log", quantity: 1 };
    assert.ok(e.pitTemp < Fire.IGNITE_TEMP);
    assert.equal(Fire.tryAutoIgnite(e, getItem, 2), false);
    assert.equal(e.id, "unlit_campfire");

    e.pitTemp = 400;
    e.canIgniteFuel = true;
    e.smolderAt = 1;
    assert.equal(Fire.tryAutoIgnite(e, getItem, 2), true);
    assert.equal(e.id, "campfire");
    assert.ok(e.burnRemaining > 0);

    const cold = pit({ fuel: [null, null] });
    Fire.lightPit(cold, getItem);
    cold.fuel = [null, null];
    cold.burnRemaining = 1;
    cold.id = "campfire";
    cold.pitTemp = 400;
    cold.maxTemp = 600;
    Fire.tickPit(cold, getItem, 10);
    assert.equal(cold.id, "unlit_campfire");
    cold.pitTemp = 20;
    cold.canIgniteFuel = true;
    cold.fuel[0] = { id: "log", quantity: 1 };
    assert.equal(Fire.tryAutoIgnite(cold, getItem, 11), false);
    assert.equal(cold.id, "unlit_campfire");

    for (let t = 11; t <= 10 + Fire.SMOLDER_MINUTES; t++) {
        Fire.tickPit(cold, getItem, t);
    }
    assert.equal(cold.canIgniteFuel, false);
    assert.equal(Fire.tryAutoIgnite(cold, getItem, 10 + Fire.SMOLDER_MINUTES + 1), false);
    assert.equal(cold.id, "unlit_campfire");
});

test("residual heat can finish a roast after the pit goes unlit", () => {
    const e = pit({
        id: "campfire",
        fuel: [null, null],
        burnRemaining: 1,
        pitTemp: 700,
        maxTemp: 600,
        cookTemp: 600,
        canIgniteFuel: true,
        catalyst: { id: "sharp_stick", quantity: 1 },
        cook: { id: "raw_beef", quantity: 1 },
        cookProgress: 14.5,
        roastBarMinutes: 15
    });
    Fire.tickPit(e, getItem, 1);
    assert.equal(e.id, "unlit_campfire");
    const r = Fire.tickCook(e, getItem, { worldMinute: 1 });
    assert.equal(r.converted, true);
    assert.equal(e.cook.id, "roast_beef");
});

test("migrateEntry on a lit old save uses current fuel maxTemp", () => {
    const e = {
        id: "campfire",
        fuel: [{ id: "stick", quantity: 3 }, null],
        cook: null,
        simmer: [null, null, null, null],
        cookProgress: 0,
        burnRemaining: 4
    };
    Fire.migrateEntry(e, getItem);
    assert.equal(e.pitTemp, 600);
    assert.equal(e.maxTemp, 600);
    assert.equal(e.canIgniteFuel, true);

    const cold = {
        id: "unlit_campfire",
        fuel: [null, null],
        cook: null,
        simmer: [null, null, null, null],
        cookProgress: 0,
        burnRemaining: 0
    };
    Fire.migrateEntry(cold, getItem);
    assert.equal(cold.pitTemp, Fire.AMBIENT_TEMP);
    assert.equal(cold.canIgniteFuel, false);
});

test("unlit pit cools slowly, not in a few seconds", () => {
    const e = pit({
        id: "unlit_campfire",
        pitTemp: 800,
        maxTemp: 800,
        canIgniteFuel: true,
        smolderAt: 0
    });
    for (let t = 1; t <= 5; t++) Fire.tickPit(e, getItem, t);
    assert.ok(e.pitTemp > 600, `800° should still be hot after 5s, got ${e.pitTemp}`);
    for (let t = 6; t <= 30; t++) Fire.tickPit(e, getItem, t);
    assert.ok(e.pitTemp > 200, `should still be warm after 30s, got ${e.pitTemp}`);
});

test("cold unlit pit with fuel does not auto-light on tick", () => {
    const e = pit({
        id: "unlit_campfire",
        pitTemp: 20,
        canIgniteFuel: true,
        smolderAt: 0,
        fuel: [{ id: "stick", quantity: 5 }, null]
    });
    Fire.tickPit(e, getItem, 1);
    assert.equal(e.id, "unlit_campfire");
    assert.equal(e.burnRemaining || 0, 0);
    assert.equal(e.fuel[0].quantity, 5);
    assert.equal(Fire.tryAutoIgnite(e, getItem, 1), false);
});

test("idle sip: near max and empty cook burns 1 kj per 4 ticks", () => {
    const e = pit({
        id: "campfire",
        fuel: [{ id: "stick", quantity: 8 }, null],
        pitTemp: 600,
        maxTemp: 600,
        burnRemaining: 5,
        cook: null
    });
    const start = e.burnRemaining;
    for (let t = 1; t <= 4; t++) Fire.tickPit(e, getItem, t);
    assert.ok(Math.abs((start - e.burnRemaining) - 1) < 0.02, `sipped 1 kj in 4 ticks, leftover ${e.burnRemaining}`);
    assert.equal(e.id, "campfire");
});

test("idle sip does not apply while food is in the cook slot", () => {
    const e = pit({
        id: "campfire",
        fuel: [{ id: "stick", quantity: 8 }, null],
        pitTemp: 600,
        maxTemp: 600,
        burnRemaining: 5,
        cook: { id: "raw_beef", quantity: 1 }
    });
    const start = e.burnRemaining;
    Fire.tickPit(e, getItem, 1);
    assert.ok(Math.abs((start - e.burnRemaining) - 1) < 0.02, `full 1 kj with food, leftover ${e.burnRemaining}`);
});

test("idle sip does not apply while heating up", () => {
    const e = pit({
        id: "campfire",
        fuel: [{ id: "stick", quantity: 8 }, null],
        pitTemp: 100,
        maxTemp: 600,
        burnRemaining: 5,
        cook: null
    });
    const start = e.burnRemaining;
    Fire.tickPit(e, getItem, 1);
    assert.ok(Math.abs((start - e.burnRemaining) - 1) < 0.02, `full 1 kj while heating, leftover ${e.burnRemaining}`);
});

test("mergeTemp is quantity-weighted; missing temp is ambient not passthrough", () => {
    assert.equal(Fire.mergeTemp(1, 400, 1, 20), 210);
    assert.equal(Fire.mergeTemp(2, 400, 2, null), 210);
    assert.equal(Fire.mergeTemp(1, 400, 1, undefined), 210);
    const dest = { id: "raw_beef", quantity: 1, temp: 400 };
    Fire.applyMergedStackTemp(dest, 1, 1, null);
    assert.equal(dest.temp, 210);
    const cold = { id: "raw_beef", quantity: 1 };
    Fire.applyMergedStackTemp(cold, 1, 1, 20);
    assert.equal(cold.temp, undefined);
});

test("cook heats stack.temp and result inherits it", () => {
    const e = pit({
        id: "campfire",
        fuel: [{ id: "stick", quantity: 20 }, null],
        pitTemp: 600,
        maxTemp: 600,
        burnRemaining: 5,
        catalyst: { id: "sharp_stick", quantity: 1 },
        cook: { id: "apple", quantity: 1 }
    });
    Fire.tickCook(e, getItem, { worldMinute: 1 });
    assert.ok(e.cook.temp > Fire.AMBIENT_TEMP, `food should heat, got ${e.cook.temp}`);
    assert.equal(e.cookTemp, e.cook.temp);

    const hot = pit({
        id: "campfire",
        fuel: [null, null],
        burnRemaining: 1,
        pitTemp: 700,
        maxTemp: 600,
        cookTemp: 600,
        canIgniteFuel: true,
        catalyst: { id: "sharp_stick", quantity: 1 },
        cook: { id: "raw_beef", quantity: 1, temp: 600 },
        cookProgress: 14.5,
        roastBarMinutes: 15
    });
    Fire.tickPit(hot, getItem, 1);
    const r = Fire.tickCook(hot, getItem, { worldMinute: 1 });
    assert.equal(r.converted, true);
    assert.equal(hot.cook.id, "roast_beef");
    assert.ok(hot.cook.temp > 500, `roast inherits heat, got ${hot.cook.temp}`);
});

test("tickPit heats a simmer vessel, not fuel, a roast stick, or a smoke rack", () => {
    const e = pit({
        id: "campfire",
        fuel: [{ id: "stick", quantity: 5 }, null],
        catalyst: { id: "cracked_coconut", quantity: 1 },
        pitTemp: 500,
        maxTemp: 600,
        burnRemaining: 5
    });
    Fire.tickPit(e, getItem, 1);
    assert.equal(e.fuel[0].temp, undefined);
    assert.ok(e.catalyst.temp > Fire.AMBIENT_TEMP, `shell should heat, got ${e.catalyst.temp}`);

    const stickPit = pit({
        id: "campfire",
        fuel: [{ id: "stick", quantity: 5 }, null],
        catalyst: { id: "sharp_stick", quantity: 1, temp: 400 },
        pitTemp: 500,
        maxTemp: 600,
        burnRemaining: 5
    });
    Fire.tickPit(stickPit, getItem, 1);
    assert.equal(stickPit.catalyst.temp, undefined);

    const rackPit = pit({
        id: "campfire",
        fuel: [{ id: "stick", quantity: 5 }, null],
        catalyst: { id: "drying_rack", quantity: 1 },
        pitTemp: 500,
        maxTemp: 600,
        burnRemaining: 5
    });
    Fire.tickPit(rackPit, getItem, 1);
    assert.equal(rackPit.catalyst.temp, undefined);
});

test("simmer vessel reaches pit temp; ambient spoil cooling must not fight it", () => {
    const e = pit({
        id: "campfire",
        fuel: [{ id: "stick", quantity: 20 }, null],
        catalyst: { id: "cracked_coconut", quantity: 1 },
        pitTemp: 600,
        maxTemp: 600,
        burnRemaining: 40
    });
    for (let t = 1; t <= 80; t++) Fire.tickPit(e, getItem, t);
    assert.equal(e.pitTemp, 600);
    assert.equal(e.catalyst.temp, 600);
});

test("tickStackTemp cools off-fire food and drops the field at ambient", () => {
    const stack = { id: "roast_beef", quantity: 1, temp: 22 };
    for (let i = 0; i < 20; i++) Fire.tickStackTemp(stack);
    assert.equal(stack.temp, undefined);
    assert.equal(Fire.stackShowsTemp(stack), false);
});

test("onCookChanged keeps stack heat when putting food back", () => {
    const e = pit({
        cook: { id: "raw_beef", quantity: 1, temp: 400 }
    });
    Fire.onCookChanged(e, "apple");
    assert.equal(e.cook.temp, 400);
    assert.equal(e.cookTemp, 400);
    assert.equal(e.cookProgress, 0);
});

test("lightBand follows pit heat, including unlit coals", () => {
    assert.equal(Fire.lightBand({ pitTemp: 20 }), "cold");
    assert.equal(Fire.lightRadiusTiles("cold"), 0);
    assert.equal(Fire.lightBand({ pitTemp: 80, id: "unlit_campfire" }), "embers");
    assert.equal(Fire.lightRadiusTiles("embers"), 3);
    assert.equal(Fire.lightBand({ pitTemp: 500, id: "unlit_campfire" }), "hot");
    assert.equal(Fire.lightRadiusTiles("hot"), 9);
    assert.equal(Fire.lightRadiusTiles("roaring"), 9);
});

test("light radius interpolates between stage thresholds", () => {
    assert.equal(Fire.lightRadiusAtTemp(0), 0);
    assert.equal(Fire.lightRadiusAtTemp(20), 0);
    assert.equal(Fire.lightRadiusAtTemp(50), 3);
    assert.equal(Fire.lightRadiusAtTemp(200), 6);
    assert.equal(Fire.lightRadiusAtTemp(400), 9);
    assert.equal(Fire.lightRadiusAtTemp(125), 4.5);
    assert.equal(Fire.lightRadiusAtTemp(300), 7.5);
    assert.ok(Fire.lightRadiusAtTemp(80) > 3);
    assert.ok(Fire.lightRadiusAtTemp(80) < 6);
    assert.ok(Fire.lightRadiusAtTemp(199) < 6);
    assert.ok(Fire.lightRadiusAtTemp(201) > 6);
});

test("light radius caps at the 600°C hot band", () => {
    const at600 = Fire.lightRadiusAtTemp(600);
    const at800 = Fire.lightRadiusAtTemp(800);
    assert.equal(at600, 9);
    assert.equal(at800, at600);
});

test("a just-lit fire lights at least as embers before the pit heats", () => {
    const lit = { pitTemp: 20, id: "campfire", burnRemaining: 8 };
    assert.equal(Fire.lightBand(lit), "embers");
    assert.equal(Fire.lightRadiusForEntry(lit), 3);
    const unlit = { pitTemp: 20, id: "unlit_campfire", burnRemaining: 0 };
    assert.equal(Fire.lightBand(unlit), "cold");
    assert.equal(Fire.lightRadiusForEntry(unlit), 0);
    assert.equal(Fire.lightRadiusForEntry({ pitTemp: Fire.AMBIENT_TEMP, id: "unlit_campfire" }), 0);
});

test("unlit campfires use a 0.1x light radius", () => {
    const hotUnlit = { pitTemp: 500, id: "unlit_campfire", burnRemaining: 0 };
    const hotLit = { pitTemp: 500, id: "campfire", burnRemaining: 8 };
    assert.equal(Fire.lightRadiusForEntry(hotLit), Fire.lightRadiusAtTemp(500));
    assert.equal(
        Fire.lightRadiusForEntry(hotUnlit),
        Fire.lightRadiusAtTemp(500) * Fire.UNLIT_LIGHT_MUL
    );
    assert.equal(Fire.UNLIT_LIGHT_MUL, 0.1);
});
