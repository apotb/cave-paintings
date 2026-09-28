/**
 * One Content.boot per process. Prints a JSON report on stdout.
 * CP_MODS_DIR, CP_ENABLED (omit | mods-false | JSON array),
 * CP_EXTRA (JSON packs, simScriptBytesB64 optional),
 * CP_EXEC=1 runs loadSimScripts, CP_AGAIN is a second boot's enabled JSON or "omit",
 * CP_CLIENT_HASH / CP_CLIENT_MODS call acceptJoin after boot.
 */
const path = require("path");
const Content = require("../../shared/mods/content");
const DataStore = require("../../shared/DataStore");

const ROOT = path.resolve(__dirname, "../..");
const modsDir = process.env.CP_MODS_DIR
    ? path.resolve(ROOT, process.env.CP_MODS_DIR)
    : path.join(ROOT, "mods");

function enabledOpt(raw) {
    if (raw == null || raw === "" || raw === "omit") return undefined;
    if (raw === "mods-false") return "mods-false";
    return JSON.parse(raw);
}

function bootOpts(raw) {
    const mode = enabledOpt(raw);
    const opts = { root: ROOT, modsDir };
    if (mode === "mods-false") opts.mods = false;
    else if (mode !== undefined) opts.enabledIds = mode;
    if (process.env.CP_EXTRA) {
        opts.extraPacks = JSON.parse(process.env.CP_EXTRA).map((pack) => {
            if (pack.simScriptBytesB64) {
                pack.simScriptBytes = Buffer.from(pack.simScriptBytesB64, "base64");
                delete pack.simScriptBytesB64;
            }
            return pack;
        });
    }
    return opts;
}

function report() {
    const doc = Content.simDocument();
    const items = (DataStore._store.itemsList || [])
        .map((row) => row && row.id)
        .filter((id) => id && (String(id).startsWith("example.picker") || String(id).startsWith("example.upload")));
    const simBytes = {};
    for (const id of ["example.picker_a", "example.picker_b", "example.picker_ok", "example.upload"]) {
        try {
            simBytes[id] = Content.readSimScriptBytes(id).length;
        } catch (_) {
            simBytes[id] = 0;
        }
    }
    const out = {
        hash: Content.simHash(),
        mods: Content.simMods(),
        items,
        clientScripts: Content.clientScripts().map((row) => row.modId),
        scripts: doc.scripts,
        simBytes,
        ran: globalThis.__cpPickerRan || null,
        finalized: Content.isFinalized()
    };
    if (process.env.CP_CLIENT_HASH) {
        out.accept = Content.acceptJoin({
            hash: process.env.CP_CLIENT_HASH,
            mods: JSON.parse(process.env.CP_CLIENT_MODS || "[]")
        });
    }
    return out;
}

try {
    const first = bootOpts(process.env.CP_ENABLED);
    Content.boot(first);
    const before = Content.simHash();
    const beforeMods = Content.simMods();
    if (process.env.CP_EXEC === "1") Content.loadSimScripts();
    if (process.env.CP_AGAIN != null && process.env.CP_AGAIN !== "") {
        const again = bootOpts(process.env.CP_AGAIN);
        delete again.extraPacks;
        Content.boot(again);
    }
    const body = report();
    body.sameHash = Content.simHash() === before;
    body.sameMods = JSON.stringify(Content.simMods()) === JSON.stringify(beforeMods);
    process.stdout.write(JSON.stringify(body));
} catch (err) {
    process.stderr.write(String(err && err.stack ? err.stack : err));
    process.exit(1);
}
