const { test } = require("node:test");
const assert = require("node:assert/strict");
const ClockFormat = require("../shared/clockFormat");

test("military clock keeps a leading zero", () => {
    assert.equal(ClockFormat.formatHourMinute(0, 0, false), "00:00");
    assert.equal(ClockFormat.formatHourMinute(8, 5, false), "08:05");
    assert.equal(ClockFormat.formatHourMinute(13, 45, false), "13:45");
    assert.equal(ClockFormat.formatDayClock(1, 13 * 60 + 45, false), "Day 1  13:45");
});

test("AM/PM drops the hour leading zero and uses 12 for midnight and noon", () => {
    assert.equal(ClockFormat.formatHourMinute(0, 0, true), "12:00 AM");
    assert.equal(ClockFormat.formatHourMinute(0, 30, true), "12:30 AM");
    assert.equal(ClockFormat.formatHourMinute(8, 5, true), "8:05 AM");
    assert.equal(ClockFormat.formatHourMinute(12, 0, true), "12:00 PM");
    assert.equal(ClockFormat.formatHourMinute(13, 45, true), "1:45 PM");
    assert.equal(ClockFormat.formatHourMinute(23, 59, true), "11:59 PM");
    assert.equal(ClockFormat.formatMinutes(13 * 60 + 45, true), "1:45 PM");
    assert.equal(ClockFormat.formatDayClock(3, 13 * 60 + 45, true), "Day 3  1:45 PM");
});

test("presentClockText rewrites /time lines and leaves other chat alone", () => {
    assert.equal(
        ClockFormat.presentClockText("Day 2  13:45", true),
        "Day 2  1:45 PM"
    );
    assert.equal(
        ClockFormat.presentClockText("Ugg set the time to 00:15", true),
        "Ugg set the time to 12:15 AM"
    );
    assert.equal(
        ClockFormat.presentClockText("Server set the time to 12:00", true),
        "Server set the time to 12:00 PM"
    );
    assert.equal(
        ClockFormat.presentClockText("Set time to 08:05", true),
        "Set time to 8:05 AM"
    );
    assert.equal(
        ClockFormat.presentClockText("Requesting Day 4 21:00…", true),
        "Requesting Day 4 9:00 PM…"
    );
    assert.equal(ClockFormat.presentClockText("meet at 13:45", true), "meet at 13:45");
    assert.equal(ClockFormat.presentClockText("Day 2  13:45", false), "Day 2  13:45");
});
