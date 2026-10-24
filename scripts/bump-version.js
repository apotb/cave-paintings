/**
 * Bump the game version in package.json, package-lock.json, and version.json.
 *
 * The first number stays as it is. The bump level picks a later part:
 *   major → 2nd number, and the 3rd resets to 0 (0.4.3 → 0.5.0)
 *   minor → 3rd number (0.4.3 → 0.4.4)
 *   patch → 4th number, added when absent (0.4.3 → 0.4.3.1)
 * A major or minor bump drops a 4th number (0.4.3.2 --minor → 0.4.4).
 *
 * Usage: npm run bump --patch|--minor|--major
 * Does not commit or tag.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LEVELS = ["patch", "minor", "major"];

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fail(msg) {
    console.error(msg);
    process.exit(1);
}

function envFlag(name) {
    const v = process.env[`npm_config_${name}`];
    return v === "true" || v === "";
}

function pickedLevel() {
    const args = process.argv.slice(2).map((s) => String(s).trim().toLowerCase().replace(/^--/, ""));
    const fromArg = args.find((a) => LEVELS.includes(a));
    if (fromArg) return fromArg;
    const fromEnv = LEVELS.filter((l) => envFlag(l));
    if (fromEnv.length > 1) fail("Pick one of --patch, --minor, or --major");
    return fromEnv[0] || "";
}

function bumpVersion(version, level) {
    const text = String(version || "").trim();
    if (!/^\d+(?:\.\d+){1,3}$/.test(text)) {
        fail(`Unsupported version "${text}" (expected 2 to 4 numeric parts)`);
    }
    const parts = text.split(".").map((n) => Number(n));
    if (level === "major") {
        parts[1] += 1;
        parts[2] = 0;
        return parts.slice(0, 3).join(".");
    }
    if (level === "minor") {
        if (parts.length < 3) parts[2] = 0;
        parts[2] += 1;
        return parts.slice(0, 3).join(".");
    }
    if (parts.length < 3) parts[2] = 0;
    if (parts.length < 4) parts[3] = 1;
    else parts[3] += 1;
    return parts.join(".");
}

function replaceVersionFields(text, from, next, times) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`("version"\\s*:\\s*")${escaped}(")`, "g");
    let seen = 0;
    const out = text.replace(re, (full, open, close) => {
        seen += 1;
        return seen <= times ? `${open}${next}${close}` : full;
    });
    if (seen !== times) {
        fail(`found ${seen} version field(s) matching ${from}, expected ${times}`);
    }
    return out;
}

function main() {
    const level = pickedLevel();
    if (!LEVELS.includes(level)) {
        fail("Usage: npm run bump --patch|--minor|--major");
    }

    const pkgPath = path.join(ROOT, "package.json");
    const lockPath = path.join(ROOT, "package-lock.json");
    const verPath = path.join(ROOT, "version.json");
    const from = String(readJson(pkgPath).version || "").trim();
    if (!from) fail("package.json has no version");
    const jsonVer = String(readJson(verPath).version || "").trim();
    if (jsonVer !== from) {
        fail(`version.json (${jsonVer}) does not match package.json (${from})`);
    }
    const lock = readJson(lockPath);
    const lockRoot = lock.packages && lock.packages[""];
    if (String(lock.version || "") !== from || !lockRoot || String(lockRoot.version || "") !== from) {
        fail(`package-lock.json version does not match package.json (${from})`);
    }

    const next = bumpVersion(from, level);
    fs.writeFileSync(pkgPath, replaceVersionFields(fs.readFileSync(pkgPath, "utf8"), from, next, 1));
    fs.writeFileSync(lockPath, replaceVersionFields(fs.readFileSync(lockPath, "utf8"), from, next, 2));
    fs.writeFileSync(verPath, `${JSON.stringify({ version: next }, null, 2)}\n`);
    console.log(`${from} → ${next}`);
}

if (require.main === module) main();

module.exports = { bumpVersion };
