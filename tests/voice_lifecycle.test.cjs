const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(
    path.join(__dirname, "..", "app.js"),
    "utf8",
);

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createHarness(playResults) {
    const documentListeners = new Map();
    const windowListeners = new Map();
    const elementsById = new Map();

    class FakeAudio {
        constructor() {
            this._src = "";
            this.srcHistory = [];
            this.playCallCount = 0;
            this.loadCallCount = 0;
            this.onended = null;
            this.onerror = null;
            this.onplaying = null;
            this.style = {};
        }

        set src(value) {
            this._src = value;
            this.srcHistory.push(value);
        }

        get src() {
            return this._src;
        }

        setAttribute() {}

        removeAttribute(name) {
            if (name === "src") {
                this._src = "";
                this.srcHistory.push("");
            }
        }

        pause() {}

        load() {
            this.loadCallCount += 1;
        }

        play() {
            this.playCallCount += 1;

            const result =
                playResults.shift() || "resolve";

            if (result === "resolve") {
                return Promise.resolve();
            }

            const error = new Error(result);
            error.name = result;
            return Promise.reject(error);
        }
    }

    class FakeButton {
        constructor() {
            this.id = "";
            this.style = {};
            this.className = "";
            this.textContent = "";
            this.onclick = null;
        }

        remove() {
            elementsById.delete(this.id);
        }
    }

    class FakeAudioSession {
        constructor() {
            this.state = "inactive";
            this.type = "auto";
            this.listeners = new Map();
        }

        addEventListener(type, listener) {
            this.listeners.set(type, listener);
        }
    }

    const audio = new FakeAudio();
    const audioSession = new FakeAudioSession();

    const document = {
        visibilityState: "visible",
        body: {
            appendChild(element) {
                if (element.id) {
                    elementsById.set(element.id, element);
                }
            },
        },
        addEventListener(type, listener) {
            documentListeners.set(type, listener);
        },
        createElement(tagName) {
            return tagName === "audio"
                ? audio
                : new FakeButton();
        },
        getElementById(id) {
            return elementsById.get(id) || null;
        },
    };

    const window = {
        addEventListener(type, listener) {
            windowListeners.set(type, listener);
        },
        speechSynthesis: {
            cancel() {},
            resume() {},
            speak() {},
        },
    };

    const context = vm.createContext({
        alert() {},
        clearInterval,
        clearTimeout,
        console,
        document,
        fetch,
        navigator: { audioSession },
        setInterval,
        setTimeout,
        SpeechSynthesisUtterance: class {},
        TextDecoder,
        URL,
        window,
    });

    vm.runInContext(appSource, context, {
        filename: "app.js",
    });

    return {
        audio,
        context,
        document,
        documentListeners,
        elementsById,
        windowListeners,
    };
}

async function testAutomaticResumeSuccess() {
    const harness = createHarness([
        "resolve",
        "resolve",
    ]);

    await vm.runInContext(
        "rearmVoiceFromUserGesture()",
        harness.context,
    );
    vm.runInContext(
        "state.runtime.started = true",
        harness.context,
    );

    harness.document.visibilityState = "hidden";
    harness.documentListeners.get("visibilitychange")();

    assert.equal(
        vm.runInContext(
            "voiceRearmRequired",
            harness.context,
        ),
        true,
    );
    assert.equal(harness.audio.src, "");

    harness.document.visibilityState = "visible";
    harness.documentListeners.get("visibilitychange")();
    harness.windowListeners.get("pageshow")();
    harness.windowListeners.get("focus")();
    await wait(400);

    assert.equal(
        vm.runInContext(
            "voiceRearmRequired",
            harness.context,
        ),
        false,
    );
    assert.equal(harness.audio.playCallCount, 2);
    assert.equal(
        harness.elementsById.has("voice-rearm-button"),
        false,
    );
}

async function testAutomaticResumeFallback() {
    const harness = createHarness([
        "resolve",
        "NotAllowedError",
        "NotAllowedError",
    ]);

    await vm.runInContext(
        "rearmVoiceFromUserGesture()",
        harness.context,
    );
    vm.runInContext(
        "state.runtime.started = true",
        harness.context,
    );

    harness.document.visibilityState = "hidden";
    harness.documentListeners.get("visibilitychange")();
    harness.document.visibilityState = "visible";
    harness.documentListeners.get("visibilitychange")();
    await wait(1650);

    assert.equal(
        vm.runInContext(
            "voiceRearmRequired",
            harness.context,
        ),
        true,
    );
    assert.equal(harness.audio.playCallCount, 3);
    assert.equal(
        harness.elementsById.has("voice-rearm-button"),
        true,
    );
}

async function testOldQueueIsNotReplayed() {
    const harness = createHarness([
        "resolve",
        "resolve",
        "resolve",
    ]);

    await vm.runInContext(
        "rearmVoiceFromUserGesture()",
        harness.context,
    );
    vm.runInContext(
        [
            "state.runtime.started = true;",
            "state.runtime.muteUntil = 0;",
            "speakOnce('queue_test', '停車');",
        ].join("\n"),
        harness.context,
    );
    await wait(20);

    harness.document.visibilityState = "hidden";
    harness.documentListeners.get("visibilitychange")();
    harness.document.visibilityState = "visible";
    harness.documentListeners.get("visibilitychange")();
    await wait(400);

    const stopVoiceUrl =
        "./data/voice/%E5%81%9C%E8%BB%8A.mp3";
    const stopVoiceLoads =
        harness.audio.srcHistory.filter(
            (src) => src === stopVoiceUrl,
        );

    assert.equal(stopVoiceLoads.length, 1);
    assert.equal(
        vm.runInContext(
            "voiceRearmRequired",
            harness.context,
        ),
        false,
    );
}

async function main() {
    await testAutomaticResumeSuccess();
    await testAutomaticResumeFallback();
    await testOldQueueIsNotReplayed();
    console.log("voice lifecycle tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
