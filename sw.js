/*
 * 録音音声専用のService Worker。
 *
 * data/voice のMP3だけをCache Storageで管理する。
 * 列車情報API、GPS、stationdata.csvなど、鮮度が必要な通信には介入しない。
 */
"use strict";

const VOICE_CACHE_PREFIX = "ikebukuro-voice-v";
const VOICE_CACHE_META_NAME = "ikebukuro-voice-meta";
const VOICE_CACHE_META_URL = new URL(
    "./__ikebukuro_voice_cache_meta__",
    self.location.href,
).href;
const VOICE_MANIFEST_URL = new URL(
    "./data/voice-manifest.json",
    self.location.href,
).href;
const VOICE_DIRECTORY_URL = new URL(
    "./data/voice/",
    self.location.href,
);

const VOICE_CACHE_SYNC_MESSAGE = "VOICE_CACHE_SYNC";
const VOICE_CACHE_STATUS_MESSAGE = "VOICE_CACHE_STATUS";
const VOICE_CACHE_VERSION_QUERY = "voiceVersion";
const VOICE_CACHE_DOWNLOAD_CONCURRENCY = 4;

let voiceCacheSyncPromise = null;
let lastVoiceCacheStatus = null;


self.addEventListener("activate", (event) => {
    // 初回登録時は現在のページも制御対象にして、保存完了後の音声要求を
    // 同じService Workerから返せるようにする。更新版は既存ページが
    // 終了するまで待機するため、案内中の音声キャッシュは切り替わらない。
    event.waitUntil(self.clients.claim());
});


self.addEventListener("message", (event) => {
    if (
        !event.data ||
        event.data.type !== VOICE_CACHE_SYNC_MESSAGE
    ) {
        return;
    }

    const port = event.ports && event.ports[0];
    const task = synchronizeVoiceCache((status) => {
        postVoiceCacheStatus(port, status);
    });

    if (typeof event.waitUntil === "function") {
        event.waitUntil(task);
    }
});


self.addEventListener("fetch", (event) => {
    if (!isManagedVoiceRequest(event.request)) {
        return;
    }

    event.respondWith(
        respondWithCachedVoice(event.request),
    );
});


function isManagedVoiceRequest(request) {
    if (!request || request.method !== "GET") {
        return false;
    }

    const url = new URL(request.url);

    return (
        url.origin === self.location.origin &&
        url.pathname.startsWith(VOICE_DIRECTORY_URL.pathname)
    );
}


function createVoiceCacheStatus(phase, details = {}) {
    const status = {
        type: VOICE_CACHE_STATUS_MESSAGE,
        phase,
        version: String(details.version || ""),
        completed: Number(details.completed) || 0,
        total: Number(details.total) || 0,
        error: String(details.error || ""),
    };

    lastVoiceCacheStatus = status;
    return status;
}


function postVoiceCacheStatus(port, status) {
    if (!port || typeof port.postMessage !== "function") {
        return;
    }

    port.postMessage(status);
}


async function synchronizeVoiceCache(reportStatus) {
    if (voiceCacheSyncPromise) {
        if (lastVoiceCacheStatus) {
            reportStatus(lastVoiceCacheStatus);
        }

        const result = await voiceCacheSyncPromise;
        reportStatus(result);
        return result;
    }

    // 前回完了時の ready 状態を、今回の同期中に参加した別ページへ
    // 誤って返さないようにする。
    lastVoiceCacheStatus = null;
    voiceCacheSyncPromise = performVoiceCacheSynchronization(
        reportStatus,
    );

    try {
        return await voiceCacheSyncPromise;
    } finally {
        voiceCacheSyncPromise = null;
    }
}


async function performVoiceCacheSynchronization(reportStatus) {
    let activeInfo = null;
    let activeCacheIsComplete = false;

    try {
        activeInfo = await readActiveVoiceCacheInfo();
        activeCacheIsComplete =
            !!activeInfo &&
            await isVoiceCacheComplete(activeInfo);
    } catch (error) {
        const status = createVoiceCacheStatus("failed", {
            error: getErrorMessage(error),
        });

        reportStatus(status);
        return status;
    }

    reportStatus(
        createVoiceCacheStatus("checking", {
            version: activeCacheIsComplete
                ? activeInfo.version
                : "",
            completed: activeCacheIsComplete
                ? activeInfo.urls.length
                : 0,
            total: activeCacheIsComplete
                ? activeInfo.urls.length
                : 0,
        }),
    );

    let manifestInfo;

    try {
        const manifest = await fetchVoiceManifest();
        manifestInfo = normalizeVoiceManifest(manifest);
    } catch (error) {
        // 通信が一時的に使えない、または新版のマニフェストに不備があっても、
        // すでに全件照合済みの版があればその版を使える。キャッシュが無い
        // 端末だけを失敗扱いにする。
        if (activeCacheIsComplete) {
            const status = createVoiceCacheStatus("ready", {
                version: activeInfo.version,
                completed: activeInfo.urls.length,
                total: activeInfo.urls.length,
            });

            reportStatus(status);
            return status;
        }

        const status = createVoiceCacheStatus("failed", {
            error: getErrorMessage(error),
        });

        reportStatus(status);
        return status;
    }

    if (activeCacheIsComplete && activeInfo.version === manifestInfo.version) {
        if (!sameUrlList(activeInfo.urls, manifestInfo.urls)) {
            const status = createVoiceCacheStatus("failed", {
                version: manifestInfo.version,
                total: manifestInfo.urls.length,
                error: "音声ファイルを更新した場合は、音声キャッシュのバージョンを更新してください。",
            });

            reportStatus(status);
            return status;
        }

        try {
            await deleteStaleVoiceCaches(activeInfo.cacheName);
        } catch (error) {
            // 現行版は完全であるため、古い版の掃除に失敗しても案内開始は
            // 妨げない。次回のオンライン起動時に再試行する。
            console.warn("[VOICE CACHE] 古い音声キャッシュを削除できませんでした。", error);
        }

        const status = createVoiceCacheStatus("ready", {
            version: activeInfo.version,
            completed: activeInfo.urls.length,
            total: activeInfo.urls.length,
        });

        reportStatus(status);
        return status;
    }

    const cacheName =
        `${VOICE_CACHE_PREFIX}${manifestInfo.version}`;

    reportStatus(
        createVoiceCacheStatus("downloading", {
            version: manifestInfo.version,
            completed: 0,
            total: manifestInfo.urls.length,
        }),
    );

    let cacheWasActivated = false;

    try {
        // 以前の失敗で残った同一版の不完全キャッシュを再利用しない。
        // 新版は必ず全件を保存・照合してから有効化する。
        await caches.delete(cacheName);

        const cache = await caches.open(cacheName);

        const completed = await cacheVoiceAssets(
            cache,
            manifestInfo.urls,
            (count) => {
                reportStatus(
                    createVoiceCacheStatus("downloading", {
                        version: manifestInfo.version,
                        completed: count,
                        total: manifestInfo.urls.length,
                    }),
                );
            },
        );

        const nextInfo = {
            version: manifestInfo.version,
            cacheName,
            urls: manifestInfo.urls,
        };

        if (!await isVoiceCacheComplete(nextInfo)) {
            throw new Error("録音音声の全件照合に失敗しました。");
        }

        // 新版が完全にそろった時点でだけ有効版を切り替える。
        await writeActiveVoiceCacheInfo(nextInfo);
        cacheWasActivated = true;

        try {
            await deleteStaleVoiceCaches(cacheName);
        } catch (error) {
            // 新版はすでに有効化済みなので、古い版の掃除は次回に回す。
            console.warn("[VOICE CACHE] 古い音声キャッシュを削除できませんでした。", error);
        }

        const status = createVoiceCacheStatus("ready", {
            version: manifestInfo.version,
            completed,
            total: manifestInfo.urls.length,
        });

        reportStatus(status);
        return status;
    } catch (error) {
        // 不完全な新版を残さず、旧版は削除しない。
        if (!cacheWasActivated) {
            try {
                await caches.delete(cacheName);
            } catch (cleanupError) {
                console.warn("[VOICE CACHE] 不完全な音声キャッシュを削除できませんでした。", cleanupError);
            }
        }

        const status = createVoiceCacheStatus("failed", {
            version: manifestInfo.version,
            total: manifestInfo.urls.length,
            error: getErrorMessage(error),
        });

        reportStatus(status);
        return status;
    }
}


async function fetchVoiceManifest() {
    const response = await fetch(
        new Request(VOICE_MANIFEST_URL, {
            cache: "no-store",
        }),
    );

    if (!response.ok) {
        throw new Error(
            `音声マニフェストを取得できませんでした。 (${response.status})`,
        );
    }

    return response.json();
}


function normalizeVoiceManifest(manifest) {
    if (
        !manifest ||
        typeof manifest !== "object" ||
        !/^[A-Za-z0-9._-]+$/.test(String(manifest.version || "")) ||
        !Array.isArray(manifest.files) ||
        manifest.files.length === 0
    ) {
        throw new Error("音声マニフェストの形式が正しくありません。");
    }

    const names = [];
    const seen = new Set();

    for (const entry of manifest.files) {
        const name = typeof entry === "string"
            ? entry
            : entry && entry.name;
        const normalizedName = String(name || "").trim();

        if (
            !normalizedName ||
            normalizedName.includes("/") ||
            normalizedName.includes("\\") ||
            !normalizedName.toLowerCase().endsWith(".mp3") ||
            seen.has(normalizedName)
        ) {
            throw new Error("音声マニフェストに不正なファイル名があります。");
        }

        seen.add(normalizedName);
        names.push(normalizedName);
    }

    names.sort();

    return {
        version: String(manifest.version),
        urls: names.map((name) => createVersionedVoiceUrl(
            name,
            String(manifest.version),
        )),
    };
}


function createVersionedVoiceUrl(fileName, version) {
    const url = new URL(
        `./data/voice/${encodeURIComponent(fileName)}`,
        self.location.href,
    );

    url.searchParams.set(
        VOICE_CACHE_VERSION_QUERY,
        version,
    );

    return url.href;
}


async function cacheVoiceAssets(cache, urls, onProgress) {
    let completed = 0;
    const pendingUrls = [];

    for (const url of urls) {
        const existing = await cache.match(url);

        if (existing && existing.ok) {
            completed += 1;
        } else {
            pendingUrls.push(url);
        }
    }

    onProgress(completed);

    const workerCount = Math.min(
        VOICE_CACHE_DOWNLOAD_CONCURRENCY,
        pendingUrls.length,
    );

    const workers = Array.from(
        { length: workerCount },
        async () => {
            while (pendingUrls.length > 0) {
                const url = pendingUrls.shift();

                if (!url) {
                    return;
                }

                const response = await fetch(
                    new Request(url, {
                        cache: "reload",
                    }),
                );

                if (!response.ok) {
                    throw new Error(
                        `録音音声を取得できませんでした。 (${response.status})`,
                    );
                }

                await cache.put(url, response.clone());
                completed += 1;
                onProgress(completed);
            }
        },
    );

    // どれか一つが失敗しても、他の並列取得が完了するまで待つ。
    // その後にキャッシュを削除すれば、削除後に別ワーカーが書き戻す
    // 競合を避けられる。
    const results = await Promise.all(
        workers.map((worker) => worker.then(
            () => ({ ok: true }),
            (error) => ({ ok: false, error }),
        )),
    );
    const failure = results.find((result) => !result.ok);

    if (failure) {
        throw failure.error;
    }

    return completed;
}


async function readActiveVoiceCacheInfo() {
    const metaCache = await caches.open(VOICE_CACHE_META_NAME);
    const response = await metaCache.match(VOICE_CACHE_META_URL);

    if (!response) {
        return null;
    }

    try {
        const value = await response.json();
        const version = String((value && value.version) || "");
        const cacheName = String((value && value.cacheName) || "");
        const urls = Array.isArray(value && value.urls)
            ? value.urls.map((url) => String(url)).sort()
            : [];

        if (
            !value ||
            typeof value !== "object" ||
            !/^[A-Za-z0-9._-]+$/.test(version) ||
            cacheName !== `${VOICE_CACHE_PREFIX}${version}` ||
            urls.length === 0 ||
            new Set(urls).size !== urls.length ||
            !urls.every((url) => isVersionedVoiceUrl(url, version))
        ) {
            return null;
        }

        return {
            version,
            cacheName,
            urls,
        };
    } catch (error) {
        return null;
    }
}


async function writeActiveVoiceCacheInfo(info) {
    const metaCache = await caches.open(VOICE_CACHE_META_NAME);
    const payload = {
        version: info.version,
        cacheName: info.cacheName,
        urls: info.urls,
        updatedAt: new Date().toISOString(),
    };

    await metaCache.put(
        VOICE_CACHE_META_URL,
        new Response(JSON.stringify(payload), {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
            },
        }),
    );
}


async function isVoiceCacheComplete(info) {
    if (
        !info ||
        !info.cacheName ||
        !Array.isArray(info.urls) ||
        info.urls.length === 0
    ) {
        return false;
    }

    const cache = await caches.open(info.cacheName);

    for (const url of info.urls) {
        const response = await cache.match(url);

        if (!response || !response.ok) {
            return false;
        }
    }

    return true;
}


async function deleteStaleVoiceCaches(activeCacheName) {
    const cacheNames = await caches.keys();

    await Promise.all(
        cacheNames
            .filter((name) =>
                name.startsWith(VOICE_CACHE_PREFIX) &&
                name !== activeCacheName,
            )
            .map((name) => caches.delete(name)),
    );
}


function sameUrlList(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
        return false;
    }

    if (a.length !== b.length) {
        return false;
    }

    const sortedA = [...a].sort();
    const sortedB = [...b].sort();

    return sortedA.every((url, index) => url === sortedB[index]);
}


function isVersionedVoiceUrl(value, version) {
    try {
        const url = new URL(String(value));

        return (
            url.origin === self.location.origin &&
            url.pathname.startsWith(VOICE_DIRECTORY_URL.pathname) &&
            url.pathname.toLowerCase().endsWith(".mp3") &&
            url.searchParams.get(VOICE_CACHE_VERSION_QUERY) === version
        );
    } catch (error) {
        return false;
    }
}


async function respondWithCachedVoice(request) {
    const activeInfo = await readActiveVoiceCacheInfo();

    if (!activeInfo) {
        return new Response("録音音声を準備中です。", {
            status: 503,
            statusText: "Voice cache is not ready",
        });
    }

    const cache = await caches.open(activeInfo.cacheName);
    const response = await cache.match(request);

    if (!response) {
        // 準備完了後の音声要求はネットワークへ逃がさない。
        // MP3が存在しない文節は、既存app.js側で合成音声へフォールバックする。
        return new Response("録音音声がキャッシュにありません。", {
            status: 404,
            statusText: "Voice asset is not in the active cache",
        });
    }

    const rangeHeader = request.headers.get("range");

    if (!rangeHeader) {
        return response;
    }

    return createRangeResponse(response, rangeHeader);
}


async function createRangeResponse(response, rangeHeader) {
    const bytes = await response.arrayBuffer();
    const total = bytes.byteLength;
    const range = parseSingleByteRange(rangeHeader, total);

    if (!range) {
        return new Response(null, {
            status: 416,
            statusText: "Range Not Satisfiable",
            headers: {
                "Content-Range": `bytes */${total}`,
            },
        });
    }

    const headers = new Headers();
    const contentType = response.headers.get("Content-Type");

    if (contentType) {
        headers.set("Content-Type", contentType);
    } else {
        headers.set("Content-Type", "audio/mpeg");
    }

    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${total}`);
    headers.set("Content-Length", String(range.end - range.start + 1));

    return new Response(
        bytes.slice(range.start, range.end + 1),
        {
            status: 206,
            statusText: "Partial Content",
            headers,
        },
    );
}


function parseSingleByteRange(rangeHeader, total) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(
        String(rangeHeader || "").trim(),
    );

    if (!match || total <= 0) {
        return null;
    }

    const [, startText, endText] = match;
    let start;
    let end;

    if (!startText) {
        const suffixLength = Number(endText);

        if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
            return null;
        }

        start = Math.max(total - suffixLength, 0);
        end = total - 1;
    } else {
        start = Number(startText);
        end = endText ? Number(endText) : total - 1;

        if (
            !Number.isInteger(start) ||
            !Number.isInteger(end) ||
            start < 0 ||
            start >= total
        ) {
            return null;
        }

        end = Math.min(end, total - 1);
    }

    if (end < start) {
        return null;
    }

    return { start, end };
}


function getErrorMessage(error) {
    if (error && error.message) {
        return String(error.message);
    }

    return "録音音声の準備に失敗しました。";
}
