const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const workerSource = fs.readFileSync(
    path.join(__dirname, "..", "sw.js"),
    "utf8",
);
const origin = "https://app.test";


class FakeCache {
    constructor() {
        this.entries = new Map();
    }

    async match(request) {
        const url = getRequestUrl(request);
        const response = this.entries.get(url);

        return response ? response.clone() : undefined;
    }

    async put(request, response) {
        this.entries.set(
            getRequestUrl(request),
            response.clone(),
        );
    }
}


class FakeCacheStorage {
    constructor() {
        this.cacheByName = new Map();
    }

    async open(name) {
        if (!this.cacheByName.has(name)) {
            this.cacheByName.set(name, new FakeCache());
        }

        return this.cacheByName.get(name);
    }

    async keys() {
        return [...this.cacheByName.keys()];
    }

    async delete(name) {
        return this.cacheByName.delete(name);
    }
}


function getRequestUrl(request) {
    if (typeof request === "string") {
        return new URL(request, origin).href;
    }

    return request.url;
}


function createNetwork() {
    const state = {
        manifest: {
            version: "test-v1",
            files: ["A.mp3", "B.mp3"],
        },
        assets: new Map([
            ["A.mp3", Uint8Array.from([1, 2, 3, 4, 5])],
            ["B.mp3", Uint8Array.from([6, 7, 8])],
        ]),
        requests: [],
    };

    return {
        state,
        async fetch(request) {
            const url = new URL(getRequestUrl(request));
            state.requests.push({
                url: url.href,
                cache: request.cache,
            });

            if (url.pathname === "/data/voice-manifest.json") {
                return new Response(JSON.stringify(state.manifest), {
                    status: 200,
                    headers: {
                        "Content-Type": "application/json",
                    },
                });
            }

            if (url.pathname.startsWith("/data/voice/")) {
                const name = decodeURIComponent(
                    url.pathname.slice("/data/voice/".length),
                );
                const bytes = state.assets.get(name);

                if (!bytes) {
                    return new Response("not found", { status: 404 });
                }

                return new Response(bytes, {
                    status: 200,
                    headers: {
                        "Content-Type": "audio/mpeg",
                    },
                });
            }

            return new Response("not found", { status: 404 });
        },
    };
}


function createHarness() {
    const listeners = new Map();
    const cacheStorage = new FakeCacheStorage();
    const network = createNetwork();
    const self = {
        location: {
            href: `${origin}/sw.js`,
            origin,
        },
        clients: {
            async claim() {},
        },
        addEventListener(type, listener) {
            listeners.set(type, listener);
        },
    };

    const context = vm.createContext({
        Array,
        Boolean,
        Date,
        Error,
        Headers,
        JSON,
        Map,
        Math,
        Number,
        Object,
        Promise,
        RegExp,
        Request,
        Response,
        Set,
        String,
        URL,
        caches: cacheStorage,
        console,
        fetch: (request) => network.fetch(request),
        self,
    });

    vm.runInContext(workerSource, context, { filename: "sw.js" });

    return {
        cacheStorage,
        listeners,
        network,
    };
}


async function synchronize(harness) {
    const statuses = [];
    const tasks = [];
    const messageListener = harness.listeners.get("message");

    assert.ok(messageListener, "Service Workerのmessageハンドラーが必要です。");

    messageListener({
        data: { type: "VOICE_CACHE_SYNC" },
        ports: [{
            postMessage(status) {
                statuses.push(JSON.parse(JSON.stringify(status)));
            },
        }],
        waitUntil(task) {
            tasks.push(task);
        },
    });

    await Promise.all(tasks);
    return statuses;
}


async function requestFromWorker(harness, url, headers = undefined) {
    const fetchListener = harness.listeners.get("fetch");
    let responsePromise = null;

    assert.ok(fetchListener, "Service Workerのfetchハンドラーが必要です。");

    fetchListener({
        request: new Request(url, { headers }),
        respondWith(response) {
            responsePromise = Promise.resolve(response);
        },
    });

    assert.ok(responsePromise, "録音音声リクエストはService Workerで処理される必要があります。");
    return responsePromise;
}


function lastStatus(statuses) {
    assert.ok(statuses.length > 0, "音声キャッシュの状態通知が必要です。");
    return statuses.at(-1);
}


async function activeCacheInfo(cacheStorage) {
    const metaCache = await cacheStorage.open("ikebukuro-voice-meta");
    const response = await metaCache.match(
        `${origin}/__ikebukuro_voice_cache_meta__`,
    );

    assert.ok(response, "有効な音声キャッシュ情報が必要です。");
    return response.json();
}


async function testServiceWorkerVoiceCacheLifecycle() {
    const harness = createHarness();

    const initialStatuses = await synchronize(harness);
    const initialReady = lastStatus(initialStatuses);

    assert.equal(initialReady.phase, "ready");
    assert.equal(initialReady.version, "test-v1");
    assert.equal(initialReady.completed, 2);
    assert.equal(initialReady.total, 2);
    assert.ok(
        harness.network.state.requests.some(
            (request) =>
                request.url.endsWith("/data/voice-manifest.json") &&
                request.cache === "no-store",
        ),
        "マニフェストはHTTPキャッシュを使わず確認する必要があります。",
    );

    const firstVoiceUrl = `${origin}/data/voice/A.mp3?voiceVersion=test-v1`;
    const firstVoiceResponse = await requestFromWorker(
        harness,
        firstVoiceUrl,
    );

    assert.equal(firstVoiceResponse.status, 200);
    assert.deepEqual(
        [...new Uint8Array(await firstVoiceResponse.arrayBuffer())],
        [1, 2, 3, 4, 5],
    );

    const rangeResponse = await requestFromWorker(
        harness,
        firstVoiceUrl,
        { Range: "bytes=1-3" },
    );

    assert.equal(rangeResponse.status, 206);
    assert.equal(rangeResponse.headers.get("Content-Range"), "bytes 1-3/5");
    assert.deepEqual(
        [...new Uint8Array(await rangeResponse.arrayBuffer())],
        [2, 3, 4],
    );

    harness.network.state.manifest = {
        version: "test-v2",
        files: ["A.mp3", "C.mp3"],
    };
    harness.network.state.assets = new Map([
        ["A.mp3", Uint8Array.from([9, 9, 9])],
        ["C.mp3", Uint8Array.from([10, 11])],
    ]);

    const updatedStatuses = await synchronize(harness);
    const updatedReady = lastStatus(updatedStatuses);

    assert.equal(updatedReady.phase, "ready");
    assert.equal(updatedReady.version, "test-v2");
    assert.equal(updatedReady.completed, 2);
    assert.equal(updatedReady.total, 2);
    assert.equal(
        harness.cacheStorage.cacheByName.has("ikebukuro-voice-vtest-v1"),
        false,
        "新しい一式を有効化した後は旧音声キャッシュを削除する必要があります。",
    );
    assert.equal(
        harness.cacheStorage.cacheByName.has("ikebukuro-voice-vtest-v2"),
        true,
    );

    const currentInfo = await activeCacheInfo(harness.cacheStorage);
    assert.equal(currentInfo.version, "test-v2");

    const updatedVoiceResponse = await requestFromWorker(
        harness,
        `${origin}/data/voice/A.mp3?voiceVersion=test-v2`,
    );

    assert.deepEqual(
        [...new Uint8Array(await updatedVoiceResponse.arrayBuffer())],
        [9, 9, 9],
    );

    const removedVoiceResponse = await requestFromWorker(
        harness,
        `${origin}/data/voice/B.mp3?voiceVersion=test-v2`,
    );

    assert.equal(removedVoiceResponse.status, 404);

    harness.network.state.manifest = {
        version: "test-v3",
        files: ["A.mp3", "Missing.mp3"],
    };

    const failedStatuses = await synchronize(harness);
    const failedStatus = lastStatus(failedStatuses);

    assert.equal(failedStatus.phase, "failed");
    assert.equal(
        harness.cacheStorage.cacheByName.has("ikebukuro-voice-vtest-v3"),
        false,
        "不完全な新版は残さない必要があります。",
    );
    assert.equal(
        (await activeCacheInfo(harness.cacheStorage)).version,
        "test-v2",
        "新版の取得失敗時は旧版を有効なまま保つ必要があります。",
    );

    harness.network.state.manifest = {
        version: "test-v2",
        files: ["A.mp3", "C.mp3", "D.mp3"],
    };
    harness.network.state.assets.set("D.mp3", Uint8Array.from([12]));

    const sameVersionStatuses = await synchronize(harness);
    const sameVersionStatus = lastStatus(sameVersionStatuses);

    assert.equal(sameVersionStatus.phase, "failed");
    assert.match(sameVersionStatus.error, /バージョンを更新/);
    assert.equal(
        (await activeCacheInfo(harness.cacheStorage)).version,
        "test-v2",
    );

    let nonVoiceRequestWasIntercepted = false;
    harness.listeners.get("fetch")({
        request: new Request("https://train.seibuapp.jp/trains"),
        respondWith() {
            nonVoiceRequestWasIntercepted = true;
        },
    });
    assert.equal(
        nonVoiceRequestWasIntercepted,
        false,
        "列車情報APIなど録音音声以外の通信をService Workerで処理してはいけません。",
    );
}


testServiceWorkerVoiceCacheLifecycle()
    .then(() => {
        console.log("voice_service_worker.test.cjs: 音声キャッシュの保存・更新・保全を確認しました。");
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
