const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cavePaintings", {
    diskSaves: true,
    list: (kind) => ipcRenderer.invoke("saves:list", kind),
    get: (kind, id) => ipcRenderer.invoke("saves:get", kind, id),
    put: (kind, record) => ipcRenderer.invoke("saves:put", kind, record),
    remove: (kind, id) => ipcRenderer.invoke("saves:remove", kind, id),
    getOptions: () => ipcRenderer.sendSync("saves:options:get"),
    putOptions: (opts) => ipcRenderer.invoke("saves:options:put", opts),
    openFolder: () => ipcRenderer.invoke("saves:openFolder"),
    quit: () => ipcRenderer.invoke("app:quit"),
    setFullscreen: (on) => ipcRenderer.invoke("app:setFullscreen", !!on),
    isFullscreen: () => ipcRenderer.invoke("app:isFullscreen"),
    onFullscreen: (cb) => {
        if (typeof cb !== "function") return () => {};
        const fn = (_event, on) => cb(!!on);
        ipcRenderer.on("app:fullscreen", fn);
        return () => ipcRenderer.removeListener("app:fullscreen", fn);
    }
});
