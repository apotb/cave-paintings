const { test } = require("node:test");
const assert = require("node:assert/strict");
const CharacterStore = require("../js/net/CharacterStore");

test("import keeps character id so world poses still match", () => {
    const json = CharacterStore.exportJson({
        id: "5a954225-3be1-4250-8a7d-20618c738aa7",
        name: "3dcrusher",
        inventory: [{ id: "leaf", quantity: 2 }, null, null, null, null],
        overflow: [{ id: "stick", quantity: 1 }],
        controlId: "buddy"
    });
    const c = CharacterStore.importJson(json);
    assert.equal(c.id, "5a954225-3be1-4250-8a7d-20618c738aa7");
    assert.equal(c.controlId, "buddy");
    assert.equal(c.overflow[0].id, "stick");
});

test("rejoin keeps the leader's needs", () => {
    const needs = { rest: 0.42, recreation: 1, beauty: 0.8, comfort: 1 };
    const saved = CharacterStore.applyYou(
        { id: "leader00000001", name: "Leader" },
        { name: "Leader", needs, groundSleep: true, resting: false }
    );
    assert.equal(saved.needs.rest, 0.42);
    assert.equal(saved.groundSleep, true);
    const snap = CharacterStore.toJoinSnapshot(saved);
    assert.equal(snap.needs.rest, 0.42);
    assert.equal(snap.needs.beauty, 0.8);
    assert.equal(snap.groundSleep, true);
    const again = CharacterStore.importJson(CharacterStore.exportJson(saved));
    assert.equal(again.needs.rest, 0.42);
});
