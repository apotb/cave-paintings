/**
 * electron-builder rejects a 4th numeric version part (0.4.3.1).
 * Loaded with node -r before the builder CLI so a hotfix still packs.
 * Windows product versions are four numbers; the 4th part is that hotfix.
 */
const path = require("path");
const Module = require("module");

const FOUR_PART = /^\d+\.\d+\.\d+\.\d+$/;

function fourPart(version) {
    const text = String(version == null ? "" : version).trim();
    return FOUR_PART.test(text) ? text : "";
}

function patchSemver(semver) {
    const origValid = semver.valid;
    const origClean = semver.clean;
    semver.valid = function (version, options) {
        const four = fourPart(version);
        if (four) return four;
        return origValid(version, options);
    };
    semver.clean = function (version, options) {
        const four = fourPart(version);
        if (four) return four;
        return origClean(version, options);
    };
}

const semverPath = require.resolve("semver", {
    paths: [path.dirname(require.resolve("app-builder-lib/package.json"))]
});
patchSemver(require(semverPath));

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    const exported = origLoad.apply(this, arguments);
    const proto = exported && exported.AppInfo && exported.AppInfo.prototype;
    if (!proto || proto.__cpFourPart || typeof proto.getVersionInWeirdWindowsForm !== "function") {
        return exported;
    }
    const origWindows = proto.getVersionInWeirdWindowsForm;
    proto.getVersionInWeirdWindowsForm = function (isSetBuildNumber) {
        const parts = String(this.version || "").split(".");
        if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) return parts.join(".");
        return origWindows.call(this, isSetBuildNumber);
    };
    proto.__cpFourPart = true;
    return exported;
};
