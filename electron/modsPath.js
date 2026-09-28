/**
 * Resolve app://game/ files. mods/ is outside the packaged game root.
 * Pure path logic so tests do not launch Electron.
 */
const path = require("path");
const fs = require("fs");

function insideRoot(root, target) {
    const base = path.resolve(root);
    const abs = path.resolve(target);
    const rel = path.relative(base, abs);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return abs;
}

function safeRelative(rest) {
    if (rest == null) return null;
    const text = String(rest).replace(/^[/\\]+/, "");
    if (!text) return [];
    if (path.isAbsolute(text)) return null;
    const parts = text.split(/[/\\]/).filter((seg) => seg !== "");
    if (!parts.length) return null;
    if (parts.some((seg) => seg === ".." || seg === ".")) return null;
    return parts;
}

function resolveModsFile(rest, opts) {
    const parts = safeRelative(rest);
    if (!parts) return null;
    const exists = opts.existsSync || fs.existsSync;
    if (opts.packaged) {
        return insideRoot(opts.userMods, path.join(opts.userMods, ...parts));
    }
    const userFile = insideRoot(opts.userMods, path.join(opts.userMods, ...parts));
    if (userFile && exists(userFile)) return userFile;
    const repoFile = insideRoot(opts.repoMods, path.join(opts.repoMods, ...parts));
    if (repoFile && exists(repoFile)) return repoFile;
    return userFile || repoFile;
}

function resolveGameFile(requestUrl, opts) {
    const raw = String(requestUrl || "");
    if (raw.split(/[/\\]/).includes("..")) return null;
    let u;
    try {
        u = new URL(requestUrl);
    } catch (_) {
        return null;
    }
    const scheme = opts.scheme || "app";
    if (u.protocol !== `${scheme}:`) return null;
    let pathname = decodeURIComponent(u.pathname || "/");
    if (!pathname || pathname === "/") pathname = "/index.html";
    const rel = pathname.replace(/^[/\\]+/, "");
    if (rel === "mods" || rel.startsWith("mods/") || rel.startsWith("mods\\")) {
        const rest = rel.replace(/^mods[/\\]?/, "");
        return resolveModsFile(rest, opts);
    }
    const parts = safeRelative(rel);
    if (!parts) return null;
    return insideRoot(opts.gameRoot, path.join(opts.gameRoot, ...parts));
}

module.exports = {
    insideRoot,
    safeRelative,
    resolveModsFile,
    resolveGameFile
};
