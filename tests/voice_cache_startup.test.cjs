const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(
    path.join(__dirname, "..", "app.js"),
    "utf8",
);


function createHarness() {
    const serviceWorkerListeners = new Map();
    const registerCalls = [];
    const postedMessages = [];
    let storagePersistCalls = 0;
    let postWasAfterControl = false;

    const worker = {
        postMessage(message, ports) {
            postedMessages.push(message);
            postWasAfterControl = serviceWorker.controller === worker;

            const port = ports[0];
            queueMicrotask(() => {
                port.postMessage({
                    type: "VOICE_CACHE_STATUS",
                    phase: "checking",
                    version: "",
                    completed: 0,
                    total: 0,
                    error: "",
                });
                port.postMessage({
                    type: "VOICE_CACHE_STATUS",
                    phase: "downloading",
                    version: "test-cache-v1",
                    completed: 1,
                    total: 2,
                    error: "",
                });
                port.postMessage({
                    type: "VOICE_CACHE_STATUS",
                    phase: "ready",
                    version: "test-cache-v1",
                    completed: 2,
                    total: 2,
                    error: "",
                });
            });
        },
    };

    const serviceWorker = {
        controller: null,
        ready: Promise.resolve({ active: worker }),
        register(url, options) {
            registerCalls.push({ url, options });
            setTimeout(() => {
                serviceWorker.controller = worker;
                const listeners = serviceWorkerListeners.get("controllerchange") || [];

                for (const listener of listeners) {
                    listener();
                }
            }, 0);

            return Promise.resolve({ active: worker });
        },
        addEventListener(type, listener) {
            const listeners = serviceWorkerListeners.get(type) || [];
            listeners.push(listener);
            serviceWorkerListeners.set(type, listeners);
        },
        removeEventListener(type, listener) {
            const listeners = serviceWorkerListeners.get(type) || [];
            serviceWorkerListeners.set(
                type,
                listeners.filter((candidate) => candidate !== listener),
            );
        },
    };

    class FakeMessageChannel {
        constructor() {
            this.port1 = {
                onmessage: null,
                close() {},
            };
            this.port2 = {
                postMessage: (data) => {
                    queueMicrotask(() => {
                        if (typeof this.port1.onmessage === "function") {
                            this.port1.onmessage({ data });
                        }
                    });
                },
            };
        }
    }

    const document = {
        addEventListener() {},
        body: { appendChild() {} },
        createElement() {
            return {
                classList: { toggle() {} },
                remove() {},
                removeAttribute() {},
                setAttribute() {},
                style: {},
            };
        },
        getElementById() {
            return null;
        },
        head: { appendChild() {} },
        visibilityState: "visible",
    };

    const window = {
        addEventListener() {},
        isSecureContext: true,
        speechSynthesis: {
            cancel() {},
            resume() {},
            speak() {},
        },
    };

    const context = vm.createContext({
        MessageChannel: FakeMessageChannel,
        SpeechSynthesisUtterance: class {},
        TextDecoder,
        URL,
        alert() {},
        clearInterval,
        clearTimeout,
        console,
        document,
        fetch() {
            throw new Error("音声キャッシュ起動試験ではfetchを直接使用しません。");
        },
        navigator: {
            serviceWorker,
            storage: {
                async persist() {
                    storagePersistCalls += 1;
                    return true;
                },
            },
        },
        setInterval,
        setTimeout,
        window,
    });

    vm.runInContext(appSource, context, { filename: "app.js" });

    return {
        context,
        get postWasAfterControl() {
            return postWasAfterControl;
        },
        postedMessages,
        registerCalls,
        get storagePersistCalls() {
            return storagePersistCalls;
        },
    };
}


async function testVoiceCacheStartupWaitsForController() {
    const harness = createHarness();
    const initialized = await vm.runInContext(
        "initializeVoiceCache()",
        harness.context,
    );

    assert.equal(initialized, true);
    assert.equal(harness.registerCalls.length, 1);
    assert.deepEqual(
        JSON.parse(JSON.stringify(harness.registerCalls[0])),
        {
            url: "./sw.js",
            options: {
                scope: "./",
                updateViaCache: "none",
            },
        },
    );
    assert.equal(
        harness.postWasAfterControl,
        true,
        "この画面を制御するService Workerにだけ音声準備を依頼する必要があります。",
    );
    assert.deepEqual(
        JSON.parse(JSON.stringify(harness.postedMessages)),
        [{ type: "VOICE_CACHE_SYNC" }],
    );
    assert.equal(harness.storagePersistCalls, 1);
    assert.equal(
        vm.runInContext("voiceCacheState.phase", harness.context),
        "ready",
    );
    assert.equal(
        vm.runInContext("voiceCacheState.version", harness.context),
        "test-cache-v1",
    );
    assert.equal(
        vm.runInContext("isVoiceCacheReady()", harness.context),
        true,
    );
    assert.equal(
        vm.runInContext("getVoiceFileUrl('停車')", harness.context),
        "./data/voice/%E5%81%9C%E8%BB%8A.mp3?voiceVersion=test-cache-v1",
    );
}


testVoiceCacheStartupWaitsForController()
    .then(() => {
        console.log("voice_cache_startup.test.cjs: 開始許可前のService Worker制御確認を検証しました。");
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
