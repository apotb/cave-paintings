const { app, BrowserWindow, Menu, protocol, ipcMain, shell, net } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");
const saves = require("./saves");

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

const gameRoot = path.resolve(path.join(__dirname, ".."));

function savesRoot() {
    return path.join(app.getPath("userData"), "save");
}

function resolveGameFile(requestUrl) {
    let u;
    try {
        u = new URL(requestUrl);
    } catch {
        return null;
    }
    if (u.protocol !== `${SCHEME}:`) return null;
    let pathname = decodeURIComponent(u.pathname || "/");
    if (!pathname || pathname === "/") pathname = "/index.html";
    const rel = pathname.replace(/^\/+/, "");
    const target = path.normalize(path.join(gameRoot, rel));
    const inside = path.relative(gameRoot, target);
    if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return null;
    return target;
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
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") app.quit();
    });
}
