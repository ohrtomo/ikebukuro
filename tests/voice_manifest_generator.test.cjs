const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (process.platform !== "win32") {
    console.log("voice_manifest_generator.test.cjs: Windows PowerShell 5.1 がないため省略しました。");
} else {
    const projectDirectory = path.join(__dirname, "..");
    const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "voice-manifest-test-"));
    const toolsDirectory = path.join(fixtureDirectory, "tools");
    const voiceDirectory = path.join(fixtureDirectory, "data", "voice");
    const manifestPath = path.join(fixtureDirectory, "data", "voice-manifest.json");
    const scriptPath = path.join(toolsDirectory, "generate-voice-manifest.ps1");
    const launcherPath = path.join(fixtureDirectory, "音声キャッシュ更新.cmd");

    function runGenerator(args = []) {
        return spawnSync("powershell.exe", [
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", scriptPath,
            ...args,
        ], {
            cwd: fixtureDirectory,
            encoding: "utf8",
            timeout: 30000,
        });
    }

    function readManifest() {
        return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    }

    function expectedVersion() {
        const combinedHash = createHash("sha256");
        const files = fs.readdirSync(voiceDirectory)
            .filter((name) => name.toLowerCase().endsWith(".mp3"))
            .sort();

        for (const name of files) {
            const nameBytes = Buffer.from(name, "utf8");
            const lengthBytes = Buffer.alloc(4);
            lengthBytes.writeUInt32LE(nameBytes.length);
            combinedHash.update(lengthBytes);
            combinedHash.update(nameBytes);
            combinedHash.update(
                createHash("sha256")
                    .update(fs.readFileSync(path.join(voiceDirectory, name)))
                    .digest(),
            );
        }

        return `sha256-${combinedHash.digest("hex")}`;
    }

    try {
        fs.mkdirSync(toolsDirectory);
        fs.mkdirSync(voiceDirectory, { recursive: true });
        fs.copyFileSync(
            path.join(projectDirectory, "tools", "generate-voice-manifest.ps1"),
            scriptPath,
        );
        fs.copyFileSync(
            path.join(projectDirectory, "音声キャッシュ更新.cmd"),
            launcherPath,
        );
        fs.writeFileSync(path.join(voiceDirectory, "A.mp3"), "first");
        fs.writeFileSync(path.join(voiceDirectory, "停車.mp3"), "second");
        fs.writeFileSync(path.join(voiceDirectory, "ignore.txt"), "ignored");

        let result = runGenerator();
        assert.equal(result.status, 0, result.stderr || result.stdout);
        const initialManifest = readManifest();
        assert.equal(initialManifest.version, expectedVersion());
        assert.deepEqual(initialManifest.files, ["A.mp3", "停車.mp3"]);

        const unchangedTimestamp = new Date("2000-01-01T00:00:00.000Z");
        fs.utimesSync(manifestPath, unchangedTimestamp, unchangedTimestamp);
        result = runGenerator();
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.equal(readManifest().version, initialManifest.version);
        assert.equal(fs.statSync(manifestPath).mtimeMs, unchangedTimestamp.getTime());

        result = spawnSync("cmd.exe", ["/d", "/c", launcherPath], {
            cwd: fixtureDirectory,
            encoding: "utf8",
            input: "\r\n",
            timeout: 30000,
        });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.equal(readManifest().version, initialManifest.version);
        assert.equal(fs.statSync(manifestPath).mtimeMs, unchangedTimestamp.getTime());

        fs.writeFileSync(path.join(voiceDirectory, "B.mp3"), "third");
        result = runGenerator();
        assert.equal(result.status, 0, result.stderr || result.stdout);
        const addedManifest = readManifest();
        assert.equal(addedManifest.version, expectedVersion());
        assert.notEqual(addedManifest.version, initialManifest.version);
        assert.deepEqual(addedManifest.files, ["A.mp3", "B.mp3", "停車.mp3"]);

        fs.writeFileSync(path.join(voiceDirectory, "B.mp3"), "replacement");
        result = runGenerator();
        assert.equal(result.status, 0, result.stderr || result.stdout);
        const replacedManifest = readManifest();
        assert.equal(replacedManifest.version, expectedVersion());
        assert.notEqual(replacedManifest.version, addedManifest.version);

        fs.unlinkSync(path.join(voiceDirectory, "B.mp3"));
        result = runGenerator();
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.equal(readManifest().version, initialManifest.version);

        result = runGenerator(["-Version", "legacy-test"]);
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.equal(readManifest().version, "legacy-test");
        const manualManifest = fs.readFileSync(manifestPath);
        result = runGenerator(["-Version", "legacy-test"]);
        assert.notEqual(result.status, 0);
        assert.deepEqual(fs.readFileSync(manifestPath), manualManifest);

        fs.writeFileSync(manifestPath, "{invalid json");
        result = runGenerator();
        assert.notEqual(result.status, 0);
        assert.equal(fs.readFileSync(manifestPath, "utf8"), "{invalid json");

        result = spawnSync("cmd.exe", ["/d", "/c", launcherPath], {
            cwd: fixtureDirectory,
            encoding: "utf8",
            input: "\r\n",
            timeout: 30000,
        });
        assert.notEqual(result.status, 0);
        assert.equal(fs.readFileSync(manifestPath, "utf8"), "{invalid json");

        console.log("voice_manifest_generator.test.cjs: ダブルクリック用起動ファイル、自動版番号、無変更、追加・差替え・削除、手動指定、破損時の保全を確認しました。");
    } finally {
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
    }
}
