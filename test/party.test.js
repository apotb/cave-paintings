const { test } = require("node:test");
const assert = require("node:assert/strict");
const Party = require("../shared/party");

test("placeJoinParty clusters members with no world pose next to the leader", () => {
    const leader = { id: "p1", x: 80, y: 96 };
    const members = [
        { id: "c1", x: 9000, y: 8000, facing: "up" },
        { id: "c2", x: -4000, y: 12 }
    ];
    Party.placeJoinParty(leader, members, {}, { tileSize: 16 });
    assert.equal(members[0].x, 96);
    assert.equal(members[0].y, 96);
    assert.equal(members[1].x, 112);
    assert.equal(members[1].y, 96);
});

test("placeJoinParty keeps this-world logout poses", () => {
    const leader = { id: "p1", x: 80, y: 96 };
    const members = [
        { id: "old", x: 9000, y: 8000 },
        { id: "new", x: 1, y: 2 }
    ];
    Party.placeJoinParty(leader, members, {
        old: { x: 320, y: 400, facing: "left" }
    }, { tileSize: 16 });
    assert.equal(members[0].x, 9000);
    assert.equal(members[0].y, 8000);
    assert.equal(members[1].x, 96);
    assert.equal(members[1].y, 96);
});
