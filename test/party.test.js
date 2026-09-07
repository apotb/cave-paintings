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

test("ownerEngagedWithWild allows nearby hostiles unless another session owns aggro", () => {
    const wild = { id: "b1", hostile: true };
    assert.equal(Party.ownerEngagedWithWild("p1", wild), true);
    wild.aggroOwnerId = "p2";
    assert.equal(Party.ownerEngagedWithWild("p1", wild, { otherOwnerIds: new Set(["p2"]) }), false);
    assert.equal(Party.ownerEngagedWithWild("p2", wild, { otherOwnerIds: new Set(["p1"]) }), true);
    assert.equal(Party.ownerEngagedWithWild("p1", wild, { lastHitMob: wild, otherOwnerIds: new Set(["p2"]) }), true);
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

test("followWantSprint latches so a follower does not flicker on the sprint ring", () => {
    const ts = 16;
    const ring = (Party.FOLLOW_SPRINT - 0.4) * ts;
    assert.equal(Party.followWantSprint(ring, false, { tileSize: ts }), false);
    assert.equal(Party.followWantSprint(ring, true, { tileSize: ts }), true);
    assert.equal(Party.followWantSprint((Party.FOLLOW_SPRINT + 0.2) * ts, false, { tileSize: ts }), true);
    assert.equal(
        Party.followWantSprint((Party.FOLLOW_SPRINT_DROP - 0.1) * ts, true, { tileSize: ts }),
        false
    );
});

test("followWantSprint matches a sprinting leader at catch range", () => {
    const ts = 16;
    const justPastCatch = (Party.FOLLOW_CATCH + 0.1) * ts;
    assert.equal(
        Party.followWantSprint(justPastCatch, false, { tileSize: ts, leaderSprinting: true }),
        true
    );
    assert.equal(
        Party.followWantSprint(justPastCatch, false, { tileSize: ts, leaderSprinting: false }),
        false
    );
});

test("companionFollowLabel uses you for the leader and Waiting with no follow target", () => {
    const leader = { name: "Tester", isBodyDead: () => false };
    const og = { name: "Og", displayName: () => "Og", isBodyDead: () => false };
    const buddy = { name: "Buddy" };
    assert.equal(Party.companionFollowLabel({ follow: leader, leader, self: buddy }), "Following you");
    assert.equal(Party.companionFollowLabel({ follow: og, leader, self: buddy }), "Following Og");
    assert.equal(Party.companionFollowLabel({ follow: null, leader, self: buddy }), "Waiting");
    assert.equal(
        Party.companionFollowLabel({
            follow: leader,
            leader,
            self: buddy,
            leaderDead: true
        }),
        "Waiting"
    );
    assert.equal(
        Party.companionFollowLabel({
            follow: og,
            leader,
            self: buddy,
            leaderDead: true
        }),
        "Following Og"
    );
});
