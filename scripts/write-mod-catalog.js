/**
 * Browser dev server cannot readdir. Write mods/catalog.json before `serve`.
 * Discovery only. Electron does not read this file.
 */
const fs = require("fs");
const path = require("path");

const modsDir = path.join(__dirname, "..", "mods");
fs.mkdirSync(modsDir, { recursive: true });

const mods = [];
for (const name of fs.readdirSync(modsDir)) {
    if (name.startsWith(".")) continue;
    const dir = path.join(modsDir, name);
    let st;
    try { st = fs.statSync(dir); } catch (_) { continue; }
    if (!st.isDirectory()) continue;
    const manifestFile = path.join(dir, "mod.json");
    if (!fs.existsSync(manifestFile)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    if (!manifest.id) throw new Error(`${name}: mod.json is missing id`);
    mods.push({ id: manifest.id, dir: name });
}

mods.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const file = path.join(modsDir, "catalog.json");
fs.writeFileSync(file, JSON.stringify({ mods }, null, 2) + "\n");
console.log(`wrote ${path.relative(path.join(__dirname, ".."), file)} (${mods.length} mod${mods.length === 1 ? "" : "s"})`);
