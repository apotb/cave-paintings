/**
 * Browser WebSocket client for Cave Paintings multiplayer.
 * Also the duck-typed interface LocalSim implements for singleplayer.
 */
class NetClient {
    constructor() {
        this.ws = null;
        this.url = null;
        this.handlers = {};
        this.connected = false;
        this.playerId = null;
        this._moveAcc = 0;
        /** Queue world messages until the play scene attaches handlers. */
        this._buffering = true;
        this._queue = [];
        this.isLocal = false;
    }

    on(type, fn) {
        if (!this.handlers[type]) this.handlers[type] = [];
        this.handlers[type].push(fn);
    }

    off(type, fn) {
        const list = this.handlers[type];
        if (!list) return;
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
    }

    /** Drop play-scene listeners so a reused SceneMain does not stack them. */
    clearHandlers() {
        this.handlers = {};
    }

    /** Call after play scene registers handlers so buffered chunks/events apply. */
    flushAndListen() {
        this._buffering = false;
        const q = this._queue;
        this._queue = [];
        for (const { type, payload } of q) this.emit(type, payload);
    }

    emit(type, payload) {
        for (const fn of this.handlers[type] || []) {
            try {
                fn(payload);
            } catch (e) {
                console.error(e);
            }
        }
        for (const fn of this.handlers["*"] || []) {
            try {
                fn(type, payload);
            } catch (e) {
                console.error(e);
            }
        }
    }

    _dispatch(type, payload) {
        if (this._buffering && type !== NetProtocol.Types.WELCOME && type !== NetProtocol.Types.REJECT) {
            this._queue.push({ type, payload });
            if (this._queue.length > 500) this._queue.shift();
            return;
        }
        this.emit(type, payload);
    }

    connect(url, authPayload = null) {
        this.close();
        this.url = url;
        this.isLocal = false;
        this._buffering = true;
        this._queue = [];
        return new Promise((resolve, reject) => {
            let settled = false;
            const ws = new WebSocket(url);
            this.ws = ws;
            ws.onopen = () => {
                this.connected = true;
                if (authPayload) this.auth(authPayload);
            };
            ws.onmessage = (ev) => {
                const msg = NetProtocol.parse(ev.data);
                if (!msg) return;
                if (msg.type === NetProtocol.Types.WELCOME) {
                    this.playerId = msg.payload?.playerId;
                    this._dispatch(msg.type, msg.payload);
                    if (!settled) {
                        settled = true;
                        resolve(msg.payload);
                    }
                    return;
                }
                if (msg.type === NetProtocol.Types.REJECT) {
                    this._dispatch(msg.type, msg.payload);
                    if (!settled) {
                        settled = true;
                        reject(new Error(msg.payload?.reason || "Rejected"));
                    }
                    this.close();
                    return;
                }
                this._dispatch(msg.type, msg.payload);
            };
            ws.onerror = () => {
                if (!settled) {
                    settled = true;
                    reject(new Error("Could not connect"));
                }
            };
            ws.onclose = () => {
                this.connected = false;
                this.emit("close", {});
                if (!settled) {
                    settled = true;
                    reject(new Error("Connection closed"));
                }
            };
        });
    }

    /**
     * @param {{ playerId?: string, displayName?: string, password?: string, characterId?: string, character?: object }} opts
     */
    auth(opts = {}) {
        const {
            playerId,
            displayName,
            password,
            characterId,
            character
        } = opts;
        this.send(NetProtocol.Types.AUTH, {
            protocol: NetProtocol.PROTOCOL_VERSION,
            playerId: characterId || playerId,
            characterId: characterId || playerId,
            displayName: displayName || character?.name || "Player",
            password: password || "",
            character: character || null
        });
    }

    send(type, payload) {
        if (!this.ws || this.ws.readyState !== 1) return;
        this.ws.send(NetProtocol.encode(type, payload));
    }

    sendMove(move) {
        this.send(NetProtocol.Types.INPUT_MOVE, move);
    }

    sendAction(action) {
        this.send(NetProtocol.Types.INPUT_ACTION, action);
    }

    close() {
        if (this.ws) {
            try {
                this.ws.close();
            } catch (_) {}
        }
        this.ws = null;
        this.connected = false;
    }

    static defaultPlayerId() {
        const key = "cp_player_id";
        let id = localStorage.getItem(key);
        if (!id) {
            id = (crypto.randomUUID && crypto.randomUUID()) ||
                `p-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            localStorage.setItem(key, id);
        }
        return id;
    }

    static wsUrlFromHostPort(hostPort) {
        let hp = String(hostPort || "").trim();
        if (!hp) hp = "127.0.0.1:21826";
        if (hp.startsWith("ws://") || hp.startsWith("wss://")) return hp;
        if (hp.startsWith("http://")) return "ws://" + hp.slice(7);
        if (hp.startsWith("https://")) return "wss://" + hp.slice(8);
        // Bare host:port — HTTPS game pages must use wss (mixed content blocks ws://)
        const secure =
            typeof location !== "undefined" && location.protocol === "https:";
        return `${secure ? "wss" : "ws"}://${hp}`;
    }

    /**
     * Open WebSocket only (no AUTH). Used by the menu to verify a server is reachable
     * before character select. Closes the socket on success, failure, or abort.
     * @returns {Promise<true> & { abort: () => void }}
     */
    static probe(url) {
        let abortFn = () => {};
        const promise = new Promise((resolve, reject) => {
            let settled = false;
            let ws;
            try {
                ws = new WebSocket(url);
            } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
                return;
            }
            const done = (ok, err) => {
                if (settled) return;
                settled = true;
                try {
                    ws.close();
                } catch (_) {}
                if (ok) resolve(true);
                else reject(err || new Error("Could not connect"));
            };
            abortFn = () => {
                clearTimeout(timer);
                done(false, Object.assign(new Error("aborted"), { name: "AbortError" }));
            };
            const timer = setTimeout(() => done(false, new Error("Connection timed out")), 8000);
            ws.onopen = () => {
                clearTimeout(timer);
                done(true);
            };
            ws.onerror = () => {
                clearTimeout(timer);
                done(false, new Error("Could not connect"));
            };
            ws.onclose = () => {
                clearTimeout(timer);
                if (!settled) done(false, new Error("Connection closed"));
            };
        });
        promise.abort = () => abortFn();
        return promise;
    }
}
