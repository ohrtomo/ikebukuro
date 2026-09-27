const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(
    path.join(__dirname, "..", "app.js"),
    "utf8",
);
const stylesSource = fs.readFileSync(
    path.join(__dirname, "..", "styles.css"),
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

    vm.runInContext(appSource, context, { filename: "app.js" });
    return context;
}

function readJson(context, expression) {
    return JSON.parse(
        vm.runInContext(`JSON.stringify(${expression})`, context),
    );
}

function configureStations(context) {
    vm.runInContext(
        `
            state.datasets.types = ["急行", "各停", "回送"];
            state.datasets.dests = ["池袋", "所沢", "小手指"];
            state.datasets.stations = {
                "秋津": {
                    stopPatterns: { "急行": false, "各停": true, "回送": false },
                },
                "所沢": {
                    stopPatterns: { "急行": true, "各停": true, "回送": false },
                },
                "小手指": {
                    stopPatterns: { "急行": true, "各停": true, "回送": false },
                },
            };
        `,
        context,
    );
}

function testDownPresetBuildsDeadheadAfterTokorozawa() {
    const context = createHarness();

    vm.runInContext(
        `
            preset = buildTokorozawaKotesashiDeadheadPreset({
                trainNo: "1001",
                direction: "下り",
                type: "急行",
                dest: "所沢",
                cars: 10,
            });
        `,
        context,
    );

    assert.deepEqual(
        readJson(context, "preset"),
        {
            first: {
                trainNo: "1001",
                type: "急行",
                dest: "所沢",
                cars: 10,
            },
            second: {
                trainNo: "1001",
                type: "回送",
                cars: 10,
                dest: "小手指",
                changeStation: "所沢",
                source: "tokorozawa-kotesashi-deadhead",
                operationPlan: null,
            },
            presetExtraStopsMode: "second",
            presetExtraStops: ["所沢", "小手指"],
        },
    );
}

function testUpPresetBuildsDeadheadBeforeTokorozawa() {
    const context = createHarness();

    vm.runInContext(
        `
            preset = buildTokorozawaKotesashiDeadheadPreset({
                trainNo: "1002",
                direction: "上り",
                type: "急行",
                dest: "池袋",
                cars: 8,
            });
        `,
        context,
    );

    assert.deepEqual(
        readJson(context, "preset"),
        {
            first: {
                trainNo: "1002",
                type: "回送",
                cars: 8,
                dest: "所沢",
            },
            second: {
                trainNo: "1002",
                type: "急行",
                dest: "池袋",
                cars: 8,
                changeStation: "所沢",
                source: "tokorozawa-kotesashi-deadhead",
                operationPlan: null,
            },
            presetExtraStopsMode: "first",
            presetExtraStops: ["所沢", "小手指"],
        },
    );
}

function testDownChangeUsesPlainDeadheadAndOnlyTwoPresetStops() {
    const context = createHarness();
    configureStations(context);

    vm.runInContext(
        `
            preset = buildTokorozawaKotesashiDeadheadPreset({
                trainNo: "1001",
                direction: "下り",
                type: "急行",
                dest: "所沢",
                cars: 10,
            });
            Object.assign(state.config, preset.first, {
                direction: "下り",
                endChange: true,
            });
            state.config.second = { ...preset.second };
            state.runtime.nonPassengerExtraStops = new Set();
            state.runtime.nonPassengerExtraStopsSecond = new Set(
                preset.presetExtraStops,
            );
            // 秋津を手動停車させていた状態でも、プリセット後半へは持ち越さない。
            state.runtime.passStations = new Set();
            state.runtime.midChangePending = true;
            state.runtime.midChangeApplied = false;
            renderGuidance = () => {};
            speakOnce = () => {};

            applied = applyMidTrainChange("test-deadhead-down");
        `,
        context,
    );

    assert.equal(vm.runInContext("applied", context), true);
    assert.deepEqual(
        readJson(context, `({
            trainNo: state.config.trainNo,
            type: state.config.type,
            dest: state.config.dest,
            tokorozawaStop: !state.runtime.passStations.has("所沢"),
            kotesashiStop: !state.runtime.passStations.has("小手指"),
            akitsuStop: !state.runtime.passStations.has("秋津"),
        })`),
        {
            trainNo: "1001",
            type: "回送",
            dest: "小手指",
            tokorozawaStop: true,
            kotesashiStop: true,
            akitsuStop: false,
        },
        "下り切替後は区分なし回送・小手指行きとし、所沢・小手指だけを停車扱いにする。",
    );
}

function testUpChangeRestoresRequestedTrainAfterTokorozawa() {
    const context = createHarness();
    configureStations(context);

    vm.runInContext(
        `
            preset = buildTokorozawaKotesashiDeadheadPreset({
                trainNo: "1002",
                direction: "上り",
                type: "急行",
                dest: "池袋",
                cars: 8,
            });
            Object.assign(state.config, preset.first, {
                direction: "上り",
                endChange: true,
            });
            state.config.second = { ...preset.second };
            state.runtime.nonPassengerExtraStops = new Set(
                preset.presetExtraStops,
            );
            state.runtime.nonPassengerExtraStopsSecond = new Set();
            buildPassStationList({
                restoreTrainScopedManualSettings: false,
            });
            beforeChange = {
                type: state.config.type,
                dest: state.config.dest,
                tokorozawaStop: !state.runtime.passStations.has("所沢"),
                kotesashiStop: !state.runtime.passStations.has("小手指"),
                akitsuStop: !state.runtime.passStations.has("秋津"),
            };

            state.runtime.midChangePending = true;
            state.runtime.midChangeApplied = false;
            renderGuidance = () => {};
            speakOnce = () => {};
            applied = applyMidTrainChange("test-deadhead-up");
        `,
        context,
    );

    assert.deepEqual(
        readJson(context, "beforeChange"),
        {
            type: "回送",
            dest: "所沢",
            tokorozawaStop: true,
            kotesashiStop: true,
            akitsuStop: false,
        },
    );
    assert.equal(vm.runInContext("applied", context), true);
    assert.deepEqual(
        readJson(context, `({
            trainNo: state.config.trainNo,
            type: state.config.type,
            dest: state.config.dest,
        })`),
        {
            trainNo: "1002",
            type: "急行",
            dest: "池袋",
        },
        "上りは所沢まで区分なし回送とし、所沢から入力列車へ戻す。",
    );
}

function testShortcutUiIsAdjacentAndKeepsManualModeAvailable() {
    assert.match(
        appSource,
        /id:\s*"tokorozawaKotesashiDeadhead"/,
    );
    assert.match(appSource, /"所-指回送"/);
    assert.match(
        appSource,
        /class:\s*"row endchange-row"[\s\S]*endChange[\s\S]*tokorozawaKotesashiDeadhead/,
        "通常列情変更と所-指回送を同じ行に置く。",
    );
    assert.match(
        appSource,
        /endChange\.disabled\s*=\s*true/,
        "プリセット中は通常列情変更の二重編集を防止する。",
    );
    assert.match(
        appSource,
        /endChange\.checked\s*=\s*endChangeCheckedBeforeDeadheadPreset/,
        "プリセット取消時は元の通常列情変更編集へ戻す。",
    );
    assert.match(
        stylesSource,
        /\.endchange-row\s*\{[^}]*display:\s*flex/s,
    );
}

testDownPresetBuildsDeadheadAfterTokorozawa();
testUpPresetBuildsDeadheadBeforeTokorozawa();
testDownChangeUsesPlainDeadheadAndOnlyTwoPresetStops();
testUpChangeRestoresRequestedTrainAfterTokorozawa();
testShortcutUiIsAdjacentAndKeepsManualModeAvailable();
console.log("Tokorozawa-Kotesashi deadhead preset tests passed");
