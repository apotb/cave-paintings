const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Body } = require("../shared/body/Body");
const Look = require("../shared/look");
const { loadDefs, bodyCtx } = require("./helpers/load");

loadDefs();

function makeHuman() {
    const owner = { kind: "player", name: "T" };
    owner.anatomy = new Body(bodyCtx(), "human", owner);
    return owner;
}

function flags(body) {
    return Look.missingVisuals(body);
}

function coversFrame(rects, frame) {
    const x0 = (frame % 3) * 16;
    const y0 = Math.floor(frame / 3) * 16;
    return rects.some((r) => r.x < x0 + 16 && r.x + r.w > x0 && r.y < y0 + 16 && r.y + r.h > y0);
}

function rectInFrame(rects, frame, side) {
    const x0 = (frame % 3) * 16;
    const y0 = Math.floor(frame / 3) * 16;
    const wantX = side === "right" ? x0 + 8 : x0;
    return rects.some((r) => r.x === wantX && r.y === y0 && r.w === 8 && r.h === 16);
}

function fullFrame(rects, frame) {
    const x0 = (frame % 3) * 16;
    const y0 = Math.floor(frame / 3) * 16;
    return rects.some((r) => r.x === x0 && r.y === y0 && r.w === 16 && r.h === 16);
}

test("an intact body hides nothing", () => {
    const owner = makeHuman();
    const m = flags(owner.anatomy);
    assert.deepEqual(m, {
        head: false,
        leftArm: false,
        rightArm: false,
        leftLeg: false,
        rightLeg: false,
        leftFoot: false,
        rightFoot: false
    });
    assert.equal(Look.missingSuffix(m), "");
    assert.equal(Look.visualEraseRects("arms", m).length, 0);
    assert.equal(Look.visualEraseRects("pants", m).length, 0);
    assert.equal(Look.visualEraseRects("shoes", m).length, 0);
    assert.equal(Look.hidesWholePart("head", m), false);
    assert.equal(Look.hidesWholePart("shirt", m), false);
});

test("a destroyed head or neck hides the head, and the torso does not", () => {
    const head = makeHuman();
    head.anatomy.part("Head").destroy();
    assert.equal(flags(head.anatomy).head, true);
    assert.equal(Look.hidesWholePart("head", flags(head.anatomy)), true);
    assert.equal(Look.hidesWholePart("eyes", flags(head.anatomy)), true);
    assert.equal(Look.hidesWholePart("shirt", flags(head.anatomy)), false);
    assert.equal(Look.missingSuffix(flags(head.anatomy)), "H");

    const neck = makeHuman();
    neck.anatomy.part("Neck").destroy();
    assert.equal(flags(neck.anatomy).head, true);
    assert.equal(flags(neck.anatomy).leftArm, false);

    const torso = makeHuman();
    torso.anatomy.part("Torso").destroy();
    const t = flags(torso.anatomy);
    assert.equal(t.head, false);
    assert.equal(t.leftArm, false);
    assert.equal(t.rightArm, false);
    assert.equal(t.leftLeg, false);
    assert.equal(t.rightLeg, false);
    assert.equal(t.leftFoot, false);
    assert.equal(t.rightFoot, false);
    assert.equal(Look.missingSuffix(t), "");
});

test("a destroyed shoulder or arm hides that arm; a hand or finger does not", () => {
    const shoulder = makeHuman();
    shoulder.anatomy.part("Left Shoulder").destroy();
    assert.equal(flags(shoulder.anatomy).leftArm, true);
    assert.equal(flags(shoulder.anatomy).rightArm, false);

    const arm = makeHuman();
    arm.anatomy.part("Right Arm").destroy();
    assert.equal(flags(arm.anatomy).rightArm, true);
    assert.equal(flags(arm.anatomy).leftArm, false);
    assert.equal(Look.missingSuffix(flags(arm.anatomy)), "Ra");

    const hand = makeHuman();
    hand.anatomy.part("Left Hand").destroy();
    hand.anatomy.part("Right Index Finger").destroy();
    const h = flags(hand.anatomy);
    assert.equal(h.leftArm, false);
    assert.equal(h.rightArm, false);
});

test("a destroyed leg hides that leg and its shoe; a foot hides only the shoe", () => {
    const leg = makeHuman();
    leg.anatomy.part("Left Leg").destroy();
    const l = flags(leg.anatomy);
    assert.equal(l.leftLeg, true);
    assert.equal(l.leftFoot, true);
    assert.equal(l.rightLeg, false);
    assert.equal(l.rightFoot, false);
    assert.equal(Look.missingSuffix(l), "Ll");

    const foot = makeHuman();
    foot.anatomy.part("Right Foot").destroy();
    foot.anatomy.part("Left Big Toe").destroy();
    const f = flags(foot.anatomy);
    assert.equal(f.rightFoot, true);
    assert.equal(f.rightLeg, false);
    assert.equal(f.leftFoot, false);
    assert.equal(f.leftLeg, false);
    assert.equal(Look.missingSuffix(f), "Rf");
});

test("saved body JSON reports the same missing limbs", () => {
    const owner = makeHuman();
    owner.anatomy.part("Neck").destroy();
    owner.anatomy.part("Left Arm").destroy();
    owner.anatomy.part("Right Foot").destroy();
    const fromBody = flags(owner.anatomy);
    const fromJson = flags(owner.anatomy.toJSON());
    assert.deepEqual(fromJson, fromBody);
    assert.equal(fromJson.head, true);
    assert.equal(fromJson.leftArm, true);
    assert.equal(fromJson.rightFoot, true);
    assert.equal(fromJson.rightLeg, false);
});

test("front and back frames drop the matching side", () => {
    const m = {
        head: false,
        leftArm: true,
        rightArm: false,
        leftLeg: true,
        rightLeg: false,
        leftFoot: true,
        rightFoot: false
    };
    const arms = Look.visualEraseRects("arms", m);
    const pants = Look.visualEraseRects("pants", m);
    const shoes = Look.visualEraseRects("shoes", m);
    // Facing the camera (frame 1): screen-right is the character's left.
    assert.equal(rectInFrame(arms, 1, "right"), true);
    assert.equal(rectInFrame(arms, 1, "left"), false);
    assert.equal(rectInFrame(pants, 1, "right"), true);
    assert.equal(rectInFrame(shoes, 1, "right"), true);
    // Facing away (frame 10): screen-left is the character's left.
    assert.equal(rectInFrame(arms, 10, "left"), true);
    assert.equal(rectInFrame(arms, 10, "right"), false);
    assert.equal(rectInFrame(pants, 10, "left"), true);
});

test("the side-view pose hides the visible arm, and a single leg stays", () => {
    const leftArm = {
        head: false,
        leftArm: true,
        rightArm: false,
        leftLeg: true,
        rightLeg: false,
        leftFoot: true,
        rightFoot: false
    };
    const arms = Look.visualEraseRects("arms", leftArm);
    const pants = Look.visualEraseRects("pants", leftArm);
    const shoes = Look.visualEraseRects("shoes", leftArm);
    // Facing left: the drawn arm is the left arm.
    assert.equal(fullFrame(arms, 4), true);
    // Frame 7 is the right-facing idle used for downed and dead bodies.
    assert.equal(coversFrame(arms, 7), false);
    assert.equal(coversFrame(pants, 4), false);
    assert.equal(coversFrame(pants, 7), false);
    assert.equal(coversFrame(shoes, 7), false);

    const rightArm = { ...leftArm, leftArm: false, rightArm: true, leftLeg: false, leftFoot: false };
    const rightArms = Look.visualEraseRects("arms", rightArm);
    assert.equal(fullFrame(rightArms, 7), true);
    assert.equal(coversFrame(rightArms, 4), false);

    const bothLegs = {
        head: false,
        leftArm: false,
        rightArm: false,
        leftLeg: true,
        rightLeg: true,
        leftFoot: true,
        rightFoot: true
    };
    assert.equal(fullFrame(Look.visualEraseRects("pants", bothLegs), 7), true);
    assert.equal(fullFrame(Look.visualEraseRects("shoes", bothLegs), 7), true);

    const bothFeet = {
        head: false,
        leftArm: false,
        rightArm: false,
        leftLeg: false,
        rightLeg: false,
        leftFoot: true,
        rightFoot: true
    };
    assert.equal(coversFrame(Look.visualEraseRects("pants", bothFeet), 7), false);
    assert.equal(fullFrame(Look.visualEraseRects("shoes", bothFeet), 7), true);
});
