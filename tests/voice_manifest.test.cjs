const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectDirectory = path.join(__dirname, "..");
const manifestPath = path.join(
    projectDirectory,
    "data",
    "voice-manifest.json",
);
const voiceDirectory = path.join(projectDirectory, "data", "voice");
const vercelConfigPath = path.join(projectDirectory, "vercel.json");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const actualFiles = fs.readdirSync(voiceDirectory)
    .filter((name) => name.toLowerCase().endsWith(".mp3"))
    .sort();
const manifestFiles = [...manifest.files].sort();

assert.match(
    manifest.version,
    /^[A-Za-z0-9._-]+$/,
    "音声マニフェストには有効な版番号が必要です。",
);
assert.ok(actualFiles.length > 0, "録音MP3が必要です。");
assert.equal(
    new Set(manifest.files).size,
    manifest.files.length,
    "音声マニフェストに重複ファイル名は指定できません。",
);
assert.deepEqual(
    manifestFiles,
    actualFiles,
    "音声マニフェストは data/voice のMP3と完全に一致する必要があります。",
);

const vercelConfig = JSON.parse(
    fs.readFileSync(vercelConfigPath, "utf8"),
);
const headersBySource = new Map(
    vercelConfig.headers.map((entry) => [entry.source, entry.headers]),
);

for (const source of [
    "/sw.js",
    "/data/voice-manifest.json",
    "/data/voice/(.*)",
]) {
    const headers = headersBySource.get(source);
    const cacheControl = headers && headers.find(
        (header) => header.key.toLowerCase() === "cache-control",
    );

    assert.ok(cacheControl, `${source} にCache-Controlヘッダーが必要です。`);
    assert.match(
        cacheControl.value,
        /no-store/i,
        `${source} は更新確認のため no-store で配信する必要があります。`,
    );
}

console.log(
    `voice_manifest.test.cjs: ${actualFiles.length} 個のMP3と版番号 ${manifest.version} を確認しました。`,
);
