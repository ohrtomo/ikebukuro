const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(
    path.join(__dirname, "..", "app.js"),
    "utf8",
);

function createHarness() {
    const document = {
        visibilityState: "visible",
        head: { appendChild() {} },
        body: { appendChild() {} },
        addEventListener() {},
        createElement() {
            return {
                style: {},
                setAttribute() {},
                removeAttribute() {},
                remove() {},
            };
        },
        getElementById() {
            return null;
        },
    };

    const window = {
        addEventListener() {},
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
        fetch() {
            throw new Error("fetch must not run in this unit test");
        },
        navigator: {},
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

    return context;
}

function testSameTrainNumberUsesNewTypeBasePattern() {
    const context = createHarness();

    vm.runInContext(
        `
            state.datasets.stations = {
                "変更後は通過": { stopPatterns: { "変更前": true, "変更後": false } },
                "変更後は停車": { stopPatterns: { "変更前": false, "変更後": true } },
                "手動通過": { stopPatterns: { "変更前": true, "変更後": true } },
                "手動停車": { stopPatterns: { "変更前": false, "変更後": false } },
                "共通通過": { stopPatterns: { "変更前": false, "変更後": false } },
                "共通停車": { stopPatterns: { "変更前": true, "変更後": true } },
            };

            state.config.trainNo = "1234";
            state.config.type = "変更前";
            state.config.dest = "池袋";
            state.config.cars = 10;
            state.config.endChange = true;
            state.config.second = {
                trainNo: "1234",
                type: "変更後",
                dest: "飯能",
                cars: 8,
            };

            state.runtime.passStations = new Set([
                "変更後は停車",
                "手動通過",
                "共通通過",
            ]);
            state.runtime.manualPlatforms = { "共通停車": "2" };
            state.runtime.platformChanges = new Set(["共通停車"]);
            state.runtime.nonPassengerExtraStops = new Set();
            state.runtime.nonPassengerExtraStopsSecond = new Set();
            state.runtime.lastTrainScopedManualSettings = {
                trainNo: "1234",
                passStations: [
                    "変更後は停車",
                    "手動通過",
                    "共通通過",
                ],
                manualPlatforms: { "以前の設定": "9" },
                platformChanges: ["以前の設定"],
            };

            renderGuidance = () => {};
            speakOnce = () => {};

            applyMidTrainChange();
        `,
        context,
    );

    const passStations = JSON.parse(
        vm.runInContext(
            "JSON.stringify(Array.from(state.runtime.passStations).sort())",
            context,
        ),
    );

    assert.deepEqual(
        passStations,
        ["共通通過", "変更後は通過", "手動通過"].sort(),
    );
    assert.equal(
        vm.runInContext("state.config.type", context),
        "変更後",
    );
    assert.deepEqual(
        JSON.parse(
            vm.runInContext(
                "JSON.stringify(state.runtime.manualPlatforms)",
                context,
            ),
        ),
        { "共通停車": "2" },
    );
}

function testOrdinarySameTrainRestoreIsUnchanged() {
    const context = createHarness();

    vm.runInContext(
        `
            state.datasets.stations = {
                "標準通過": { stopPatterns: { "種別": false } },
                "手動通過": { stopPatterns: { "種別": true } },
                "手動停車": { stopPatterns: { "種別": false } },
            };

            state.config.trainNo = "1234";
            state.config.type = "種別";
            state.runtime.lastTrainScopedManualSettings = {
                trainNo: "1234",
                passStations: ["標準通過", "手動通過"],
                manualPlatforms: { "手動停車": "3" },
                platformChanges: ["手動停車"],
            };

            buildPassStationList();
        `,
        context,
    );

    assert.deepEqual(
        JSON.parse(
            vm.runInContext(
                "JSON.stringify(Array.from(state.runtime.passStations).sort())",
                context,
            ),
        ),
        ["標準通過", "手動通過"].sort(),
    );
    assert.deepEqual(
        JSON.parse(
            vm.runInContext(
                "JSON.stringify(state.runtime.manualPlatforms)",
                context,
            ),
        ),
        { "手動停車": "3" },
    );
}

testSameTrainNumberUsesNewTypeBasePattern();
testOrdinarySameTrainRestoreIsUnchanged();
console.log("mid-change stop-pattern tests passed");
