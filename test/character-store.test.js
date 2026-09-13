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
