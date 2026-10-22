/**
 * Player-facing clock strings. Military is 00–23 with a leading zero.
 * AM/PM drops the hour's leading zero: 13:45 → 1:45 PM, midnight → 12:00 AM.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.ClockFormat = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    function formatHourMinute(hour, minute, ampm) {
        let h = Math.floor(Number(hour));
        let m = Math.floor(Number(minute));
        if (!Number.isFinite(h)) h = 0;
        if (!Number.isFinite(m)) m = 0;
        h = ((h % 24) + 24) % 24;
        m = ((m % 60) + 60) % 60;
        const mm = String(m).padStart(2, "0");
        if (!ampm) return `${String(h).padStart(2, "0")}:${mm}`;
        const suffix = h >= 12 ? "PM" : "AM";
        let h12 = h % 12;
        if (h12 === 0) h12 = 12;
        return `${h12}:${mm} ${suffix}`;
    }

    function formatMinutes(totalMinutes, ampm) {
        let mins = Math.floor(Number(totalMinutes) || 0);
        mins = ((mins % 1440) + 1440) % 1440;
        return formatHourMinute(Math.floor(mins / 60), mins % 60, ampm);
    }

    function formatDayClock(day, totalMinutes, ampm) {
        const d = Math.max(1, Math.floor(Number(day) || 1));
        return `Day ${d}  ${formatMinutes(totalMinutes, ampm)}`;
    }

    /**
     * Rewrite military times inside known /time lines. Other text is left alone,
     * including a player typing "13:45" in chat.
     */
    function presentClockText(text, ampm) {
        if (!ampm || text == null) return text;
        return String(text).replace(
            /(Day \d+\s+|set the time to |Set time to |Requesting Day \d+\s+)([01]\d|2[0-3]):([0-5]\d)/g,
            (_, prefix, hh, mm) => prefix + formatHourMinute(Number(hh), Number(mm), true)
        );
    }

    return {
        formatHourMinute,
        formatMinutes,
        formatDayClock,
        presentClockText
    };
});
