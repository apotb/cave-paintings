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

test("puppet lerp keeps walking across late snapshots at high tick speed", () => {
    assert.ok(Party.puppetTeleportPx({ tickSpeed: 20, snapDtMs: 200 }) > 72);
    const mid = Party.puppetLerpXY({
        fromX: 0,
        fromY: 0,
        tx: 40,
        ty: 0,
        snapAt: 1000,
        snapDtMs: 200,
        now: 1100,
        teleportPx: 200,
        moving: true
    });
    assert.equal(mid.x, 20);
    assert.equal(mid.snapped, false);

    const late = Party.puppetLerpXY({
        fromX: 0,
        fromY: 0,
        tx: 40,
        ty: 0,
        snapAt: 1000,
        snapDtMs: 200,
        now: 1400,
        teleportPx: 200,
        moving: true
    });
    assert.ok(late.x > 40, `should extrapolate past the last snap (x=${late.x})`);
    assert.ok(late.x < 90, `should not run away (x=${late.x})`);

    const snap = Party.puppetLerpXY({
        fromX: 0,
        fromY: 0,
        tx: 400,
        ty: 0,
        snapAt: 1000,
        snapDtMs: 200,
        now: 1100,
        teleportPx: 80,
        moving: true
    });
    assert.equal(snap.x, 400);
    assert.equal(snap.snapped, true);

    assert.ok(Party.puppetSnapGapMs(1000, 1800) > 100);
    assert.ok(Party.puppetSnapGapMs(1000, 1800) <= 1250);
});

test("eatTakeQty takes only enough discrete food to reach AUTO_EAT_UNTIL", () => {
    assert.equal(Party.eatTakeQty(800, 1400, 220, 12, { stomach: 1600 }), 3);
    assert.equal(Party.eatTakeQty(600, 1400, 220, 12, { stomach: 1600 }), 4);
    assert.equal(Party.eatTakeQty(1390, 1400, 220, 12, { stomach: 1600 }), 1);
    assert.equal(Party.eatTakeQty(800, 1400, 220, 2, { stomach: 1600 }), 2);
    assert.equal(Party.eatTakeQty(800, 1400, 400, 8, { isMeal: true }), 1);
    assert.equal(Party.eatTakeQty(1400, 1400, 220, 12, { stomach: 1600 }), 1);
});
