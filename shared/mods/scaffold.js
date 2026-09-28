/**
 * New-mod id, mod.json, and a one-file zip.
 * Node + browser UMD. Does not touch the disk.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.ModScaffold = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const MOD_ID_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
    const DESC_MAX = 160;
    const REASONS = {
        name: "Enter a display name.",
        author: "Enter an author.",
        version: "Enter a version.",
        idEmpty: "Enter an internal name.",
        idDigit: "Internal name cannot start with a number.",
        idShape: "Internal name must be lowercase letters, digits, and underscores, with at least one dot.",
        duplicateId: "A mod with this id already exists.",
        duplicateDir: "A folder with this name already exists.",
        gameVersion: "Game version is unavailable."
    };

    function slugSegment(text) {
        return String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    function suggestId(author, name) {
        const a = slugSegment(author);
        const n = slugSegment(name);
        if (!a && !n) return "";
        return `${a}.${n}`;
    }

    function resolvedId(fields) {
        const typed = String(fields && fields.internal || "").trim();
        if (typed) return typed;
        return suggestId(fields && fields.author, fields && fields.name);
    }

    function idProblem(id) {
        const text = String(id || "").trim();
        if (!text) return REASONS.idEmpty;
        if (MOD_ID_RE.test(text)) return "";
        const parts = text.split(".");
        if (parts.some((part) => /^[0-9]/.test(part))) return REASONS.idDigit;
        return REASONS.idShape;
    }

    function formProblem(fields) {
        const src = fields || {};
        if (!String(src.name || "").trim()) return REASONS.name;
        if (!String(src.author || "").trim()) return REASONS.author;
        if (!String(src.version || "").trim()) return REASONS.version;
        return idProblem(resolvedId(src));
    }

    function cleanDescription(text) {
        return String(text || "").replace(/[\r\n]+/g, " ").trim().slice(0, DESC_MAX);
    }

    function gameVersionSpec(version) {
        const text = String(version || "").trim();
        if (!/^\d+\.\d+\.\d+$/.test(text)) return "";
        return `>=${text}`;
    }

    function buildManifest(fields) {
        const src = fields || {};
        const description = cleanDescription(src.description);
        const manifest = {
            id: String(src.id || resolvedId(src)).trim(),
            name: String(src.name || "").trim(),
            author: String(src.author || "").trim()
        };
        if (description) manifest.description = description;
        manifest.version = String(src.version || "").trim();
        manifest.gameVersion = String(src.gameVersion || "").trim();
        manifest.dependencies = [];
        manifest.loadPriority = 0;
        return manifest;
    }

    function manifestText(manifest) {
        return JSON.stringify(manifest, null, 2) + "\n";
    }

    function duplicateProblem(id, rows) {
        for (const row of rows || []) {
            if (row && row.id === id) return REASONS.duplicateId;
        }
        for (const row of rows || []) {
            if (row && row.dir === id) return REASONS.duplicateDir;
        }
        return "";
    }

    function utf8(text) {
        return new TextEncoder().encode(String(text));
    }

    function crc32(bytes) {
        let crc = ~0;
        for (let i = 0; i < bytes.length; i++) {
            crc ^= bytes[i];
            for (let bit = 0; bit < 8; bit++) {
                const mask = -(crc & 1);
                crc = (crc >>> 1) ^ (0xedb88320 & mask);
            }
        }
        return (~crc) >>> 0;
    }

    function u16(n) {
        return Uint8Array.of(n & 255, (n >> 8) & 255);
    }

    function u32(n) {
        return Uint8Array.of(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255);
    }

    function concat(parts) {
        let len = 0;
        for (const part of parts) len += part.length;
        const out = new Uint8Array(len);
        let offset = 0;
        for (const part of parts) {
            out.set(part, offset);
            offset += part.length;
        }
        return out;
    }

    function zipStore(entries) {
        const locals = [];
        const centrals = [];
        let offset = 0;
        const date = ((2026 - 1980) << 9) | (9 << 5) | 28;
        for (const entry of entries || []) {
            const name = String(entry && entry.name || "");
            if (!name || name.includes("\\") || name.startsWith("/") || name.split("/").includes("..")) {
                throw new Error("Bad zip path");
            }
            const data = typeof entry.text === "string" ? utf8(entry.text) : entry.data;
            const nameBytes = utf8(name);
            const crc = crc32(data);
            const local = concat([
                u32(0x04034b50),
                u16(20),
                u16(0),
                u16(0),
                u16(0),
                u16(date),
                u32(crc),
                u32(data.length),
                u32(data.length),
                u16(nameBytes.length),
                u16(0),
                nameBytes,
                data
            ]);
            locals.push(local);
            centrals.push(concat([
                u32(0x02014b50),
                u16(20),
                u16(20),
                u16(0),
                u16(0),
                u16(0),
                u16(date),
                u32(crc),
                u32(data.length),
                u32(data.length),
                u16(nameBytes.length),
                u16(0),
                u16(0),
                u16(0),
                u16(0),
                u32(0),
                u32(offset),
                nameBytes
            ]));
            offset += local.length;
        }
        const central = concat(centrals);
        const end = concat([
            u32(0x06054b50),
            u16(0),
            u16(0),
            u16(centrals.length),
            u16(centrals.length),
            u32(central.length),
            u32(offset),
            u16(0)
        ]);
        return concat(locals.concat([central, end]));
    }

    function modZip(manifest) {
        return zipStore([{
            name: `${manifest.id}/mod.json`,
            text: manifestText(manifest)
        }]);
    }

    return {
        MOD_ID_RE,
        DESC_MAX,
        REASONS,
        slugSegment,
        suggestId,
        resolvedId,
        idProblem,
        formProblem,
        cleanDescription,
        gameVersionSpec,
        buildManifest,
        manifestText,
        duplicateProblem,
        crc32,
        zipStore,
        modZip
    };
});
