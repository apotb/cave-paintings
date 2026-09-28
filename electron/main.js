const { app, BrowserWindow, Menu, protocol, ipcMain, shell, net } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const saves = require("./saves");
const modsPath = require("./modsPath");
const modList = require("./modList");

const PRODUCT = "Cave Paintings";
const SCHEME = "app";
const HOST = "game";

protocol.registerSchemesAsPrivileged([
    {
        scheme: SCHEME,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true
        }
    }
]);

app.setName(PRODUCT);
app.setPath("userData", path.join(app.getPath("appData"), PRODUCT));

// Must be registered before any window loads. macOS `activate` can create
// the window before `whenReady` finishes registering the rest of the IPC.
ipcMain.on("app:version", (event) => {
    event.returnValue = app.getVersion();
});

const gameRoot = path.resolve(path.join(__dirname, ".."));

function savesRoot() {
    return path.join(app.getPath("userData"), "save");
}

function modRoots() {
    const userMods = path.join(app.getPath("userData"), "mods");
    const repoMods = path.join(gameRoot, "mods");
    return { userMods, repoMods, packaged: app.isPackaged };
}

function resolveGameFile(requestUrl) {
    const roots = modRoots();
    return modsPath.resolveGameFile(requestUrl, {
        gameRoot,
        scheme: SCHEME,
        packaged: roots.packaged,
        userMods: roots.userMods,
        repoMods: roots.repoMods
    });
}

function listMods() {
    const { userMods, repoMods, packaged } = modRoots();
    const roots = packaged ? [userMods] : [repoMods, userMods];
    return modList.scanModRoots(roots, fs);
}

function enabledModsFile() {
    return path.join(app.getPath("userData"), "mods-enabled.json");
}

function readEnabledMods() {
    return modList.readEnabledFile(fs, enabledModsFile());
}

function writeEnabledMods(body) {
    return modList.writeEnabledFile(fs, enabledModsFile(), body);
}

function modDirById(id) {
    const { userMods, repoMods, packaged } = modRoots();
    const roots = packaged ? [userMods] : [repoMods, userMods];
    let match = null;
    for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        for (const name of fs.readdirSync(root)) {
            const dir = path.join(root, name);
            const manifestFile = path.join(dir, "mod.json");
            if (!fs.existsSync(manifestFile)) continue;
            let manifest;
            try {
                manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
            } catch (_) {
                continue;
            }
            if (manifest.id !== id) continue;
            if (match) throw new Error(`Duplicate mod id "${id}"`);
            match = dir;
        }
    }
    return match;
}

function readModFile(id, rel) {
    const dir = modDirById(id);
    if (!dir) throw new Error("not found");
    const parts = modsPath.safeRelative(rel);
    if (!parts) throw new Error("not found");
    const file = modsPath.insideRoot(dir, path.join(dir, ...parts));
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error("not found");
    return fs.readFileSync(file, "utf8");
}

function registerProtocol() {
    protocol.handle(SCHEME, (request) => {
        const file = resolveGameFile(request.url);
        if (!file) return new Response("Not found", { status: 404 });
        return net.fetch(pathToFileURL(file).toString()).catch(() => {
            return new Response("Not found", { status: 404 });
        });
    });
}

function registerSaveIpc() {
    const wrap = (fn) => async (_evt, ...args) => {
        try {
            return await fn(...args);
        } catch (e) {
            throw new Error(e && e.message ? e.message : String(e));
        }
    };
    ipcMain.handle("saves:list", wrap((kind) => saves.list(savesRoot(), kind)));
    ipcMain.handle("saves:get", wrap((kind, id) => saves.get(savesRoot(), kind, id)));
    ipcMain.handle("saves:put", wrap((kind, record) => saves.put(savesRoot(), kind, record)));
    ipcMain.handle("saves:remove", wrap((kind, id) => saves.remove(savesRoot(), kind, id)));
    ipcMain.on("saves:options:get", (event) => {
        try {
            event.returnValue = saves.readOptions(savesRoot());
        } catch (e) {
            event.returnValue = saves.defaultOptions();
        }
    });
    ipcMain.handle("saves:options:put", wrap((opts) => saves.writeOptions(savesRoot(), opts)));
    ipcMain.handle("mods:list", wrap(() => listMods()));
    ipcMain.handle("mods:read", wrap((id, rel) => readModFile(id, rel)));
    ipcMain.handle("mods:enabled:get", wrap(() => readEnabledMods()));
    ipcMain.handle("mods:enabled:set", wrap((body) => writeEnabledMods(body)));
    ipcMain.handle("mods:openFolder", wrap(async () => {
        const dir = modRoots().userMods;
        await fs.promises.mkdir(dir, { recursive: true });
        const err = await shell.openPath(dir);
        if (err) throw new Error(err);
        return dir;
    }));
    ipcMain.handle("saves:openFolder", wrap(async () => {
        const dir = await saves.ensureRoot(savesRoot());
        const err = await shell.openPath(dir);
        if (err) throw new Error(err);
        return dir;
    }));
    ipcMain.handle("app:quit", () => {
        app.quit();
    });
    ipcMain.handle("app:setFullscreen", (_evt, on) => {
        applyFullscreen(!!on);
        return isWindowFullscreen();
    });
    ipcMain.handle("app:isFullscreen", () => isWindowFullscreen());
}

let mainWindow = null;

function isWindowFullscreen() {
    return !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen());
}

function applyFullscreen(on) {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;
    const want = !!on;
    if (win.isFullScreen() === want) return;
    // macOS native fullscreen is animated. Apply on the next turn so a
    // renderer click/rebuild cannot abort the transition (that also bricks
    // the green traffic-light button).
    setImmediate(() => {
        if (win.isDestroyed() || win.isFullScreen() === want) return;
        win.setFullScreen(want);
    });
}

function installMenu() {
    const viewMenu = !app.isPackaged ? {
        label: "View",
        submenu: [
            { role: "reload" },
            { role: "forceReload" }
        ]
    } : null;
    if (process.platform === "darwin") {
        Menu.setApplicationMenu(Menu.buildFromTemplate([
            { role: "appMenu" },
            { role: "editMenu" },
            ...(viewMenu ? [viewMenu] : []),
            { role: "windowMenu" }
        ]));
        return;
    }
    Menu.setApplicationMenu(viewMenu ? Menu.buildFromTemplate([viewMenu]) : null);
}

function persistFullscreen(on) {
    const cur = saves.readOptions(savesRoot());
    if (!!cur.fullscreen === !!on) return;
    saves.writeOptions(savesRoot(), { ...cur, fullscreen: !!on }).catch(() => {});
}

let appQuitting = false;

function syncFullscreen(win, on) {
    if (appQuitting || win?._cpClosing || !win || win.isDestroyed()) return;
    persistFullscreen(on);
    try {
        if (!win.webContents.isDestroyed()) win.webContents.send("app:fullscreen", !!on);
    } catch (_) {}
}

function createWindow() {
    const icon = path.join(gameRoot, "build", "icon.png");
    const startFullscreen = !!saves.readOptions(savesRoot()).fullscreen;
    const win = new BrowserWindow({
        width: 1280,
        height: 720,
        minWidth: 640,
        minHeight: 480,
        backgroundColor: "#1a1510",
        title: PRODUCT,
        icon,
        fullscreenable: true,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false
        },
        show: false
    });
    win.once("ready-to-show", () => {
        win.show();
        if (startFullscreen) {
            setTimeout(() => {
                if (!win.isDestroyed() && !win.isFullScreen()) win.setFullScreen(true);
            }, 50);
        }
    });
    win.webContents.on("before-input-event", (event, input) => {
        if (input.type === "keyDown" && input.key === "F11") {
            applyFullscreen(!win.isFullScreen());
            event.preventDefault();
        }
    });
    win.on("enter-full-screen", () => syncFullscreen(win, true));
    win.on("leave-full-screen", () => syncFullscreen(win, false));
    win.on("close", () => { win._cpClosing = true; });
    win.webContents.setWindowOpenHandler(({ url }) => {
        try {
            const u = new URL(url);
            if (u.protocol === "https:" || u.protocol === "http:") {
                shell.openExternal(url);
            }
        } catch (_) {}
        return { action: "deny" };
    });
    win.loadURL(`${SCHEME}://${HOST}/index.html`);
    mainWindow = win;
    win.on("closed", () => {
        if (mainWindow === win) mainWindow = null;
    });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    });

    app.whenReady().then(async () => {
        registerProtocol();
        registerSaveIpc();
        await saves.ensureRoot(savesRoot());
        installMenu();
        createWindow();
    });

    app.on("before-quit", () => { appQuitting = true; });
    app.on("activate", () => {
        if (!app.isReady()) return;
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") app.quit();
    });
}
