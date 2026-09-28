/**
 * List mod folders without merging or executing them.
 * One bad mod.json becomes that row's error. Other folders still appear.
 */
const path = require("path");

function scanModRoots(roots, fs) {
    const found = [];
    for (const root of roots || []) {
        if (!root || !fs.existsSync(root)) continue;
        let names = [];
        try {
            names = fs.readdirSync(root);
        } catch (_) {
            continue;
        }
        for (const name of names) {
            if (name.startsWith(".")) continue;
            const dir = path.join(root, name);
            let st;
            try { st = fs.statSync(dir); } catch (_) { continue; }
            if (!st.isDirectory()) continue;
            const manifestFile = path.join(dir, "mod.json");
            if (!fs.existsSync(manifestFile)) continue;
            let manifest;
            try {
                manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
            } catch (err) {
                found.push({
                    dir: name,
                    source: "installed",
                    error: `${name}: mod.json ${err.message}`
                });
                continue;
            }
            if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
                found.push({
                    dir: name,
                    source: "installed",
                    error: `${name}: mod.json is not an object`
                });
                continue;
            }
            if (!Array.isArray(manifest.dependencies)) {
                found.push({
                    id: manifest.id,
                    dir: name,
                    source: "installed",
                    name: manifest.name || manifest.id || name,
                    version: manifest.version == null ? "" : String(manifest.version),
                    gameVersion: manifest.gameVersion == null ? "" : String(manifest.gameVersion),
                    dependencies: [],
                    error: `${manifest.id || name}: dependencies must be an array of mod id strings`
                });
                continue;
            }
            found.push({
                id: manifest.id,
                version: manifest.version == null ? "" : String(manifest.version),
                name: manifest.name || manifest.id || name,
                gameVersion: manifest.gameVersion == null ? "" : String(manifest.gameVersion),
                dependencies: Array.isArray(manifest.dependencies) ? manifest.dependencies.slice() : [],
                loadPriority: Number.isFinite(Number(manifest.loadPriority)) ? Number(manifest.loadPriority) : 0,
                dir: name,
                source: "installed",
                error: ""
            });
        }
    }
    const groups = new Map();
    for (const row of found) {
        if (!row.id || row.error) continue;
        if (!groups.has(row.id)) groups.set(row.id, []);
        groups.get(row.id).push(row);
    }
    for (const [id, rows] of groups) {
        if (rows.length < 2) continue;
        const message = `Duplicate mod id "${id}" (${rows.map((row) => row.dir).join(" and ")})`;
        for (const row of rows) row.error = message;
    }
    return found;
}

function readEnabledFile(fs, file) {
    try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8"));
        const ids = Array.isArray(raw.ids) ? raw.ids.filter((id) => typeof id === "string") : [];
        return { ids };
    } catch (_) {
        return { ids: [] };
    }
}

function writeEnabledFile(fs, file, body) {
    const ids = Array.isArray(body && body.ids) ? body.ids.filter((id) => typeof id === "string") : [];
    fs.mkdirSync(require("path").dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ids }, null, 2) + "\n");
    return { ids };
}

module.exports = { scanModRoots, readEnabledFile, writeEnabledFile };
