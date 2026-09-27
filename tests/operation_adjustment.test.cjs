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

function configureSayamaStations(context) {
    vm.runInContext(
        `
            state.datasets.types = ["各停", "急行"];
            state.datasets.dests = ["飯能", "西武球場前"];
            state.datasets.stations = {
                "西所沢": {
                    stopPatterns: { "各停": true, "急行": false },
                },
                "下山口": {
                    stopPatterns: { "各停": true, "急行": false },
                },
                "西武球場前": {
                    stopPatterns: { "各停": true, "急行": false },
                },
            };
        `,
        context,
    );
}

function testPreviewUsesChangedTypeAndForcesDestinationStop() {
    const context = createHarness();
    configureSayamaStations(context);

    vm.runInContext(
        `
            state.config.trainNo = "1001";
            state.config.type = "各停";
            state.config.dest = "飯能";
            state.config.direction = "下り";
            state.runtime.passStations = new Set();
            state.runtime.prevStationName = "西所沢";
            applyGuidePlan({
                segmentIds: ["池袋3", "池袋4"],
                terminalName: "飯能",
            });

            baseline = createStopPlanFromPassStations(
                state.runtime.passStations,
            );
            preview = buildOperationAdjustmentPreview({
                trainNo: "2001",
                type: "急行",
                dest: "西武球場前",
                changeStation: "西所沢",
            }, baseline);
        `,
        context,
    );

    assert.deepEqual(
        readJson(context, "preview.routeStations"),
        ["西所沢", "下山口", "西武球場前"],
    );
    assert.deepEqual(
        readJson(context, `({
            nishiTokorozawa: preview.stops["西所沢"],
            shimoyamaguchi: preview.stops["下山口"],
            seibuKyujomae: preview.stops["西武球場前"],
        })`),
        {
            nishiTokorozawa: false,
            shimoyamaguchi: false,
            seibuKyujomae: true,
        },
        "変更後種別の基本停車を反映し、行先駅だけは必ず停車にする。",
    );
}

function testExistingScheduledChangeIsUsedForComparisonBaseline() {
    const context = createHarness();
    configureSayamaStations(context);

    vm.runInContext(
        `
            state.config.trainNo = "1001";
            state.config.type = "各停";
            state.config.dest = "飯能";
            state.config.direction = "下り";
            state.config.endChange = true;
            state.config.second = {
                trainNo: "3001",
                type: "急行",
                dest: "西武球場前",
                cars: 10,
                changeStation: "西所沢",
                source: "settings",
                operationPlan: null,
            };
            state.runtime.passStations = new Set();
            state.runtime.nonPassengerExtraStops = new Set();
            state.runtime.nonPassengerExtraStopsSecond = new Set();
            state.runtime.midChangePending = true;
            state.runtime.midChangeApplied = false;

            projected = buildProjectedOperationBaseline();
        `,
        context,
    );

    assert.equal(vm.runInContext("projected.error", context), null);
    assert.deepEqual(
        readJson(context, `({
            nishiTokorozawa: projected.stops["西所沢"],
            shimoyamaguchi: projected.stops["下山口"],
            seibuKyujomae: projected.stops["西武球場前"],
        })`),
        {
            nishiTokorozawa: false,
            shimoyamaguchi: false,
            seibuKyujomae: false,
        },
        "既存予約は廃棄前に、変更後種別の予定停車状態として比較へ使う。",
    );
}

function testStationsOutsideOldRouteStartAsNotPlannedStops() {
    const context = createHarness();
    configureSayamaStations(context);

    vm.runInContext(
        `
            state.config.trainNo = "1001";
            state.config.type = "各停";
            state.config.dest = "飯能";
            state.config.direction = "下り";
            state.config.endChange = false;
            state.runtime.passStations = new Set();
            applyGuidePlan({
                segmentIds: ["池袋3", "池袋4"],
                terminalName: "飯能",
            });

            projected = buildProjectedOperationBaseline();
        `,
        context,
    );

    assert.deepEqual(
        readJson(context, `({
            nishiTokorozawa: projected.stops["西所沢"],
            shimoyamaguchi: projected.stops["下山口"],
            seibuKyujomae: projected.stops["西武球場前"],
        })`),
        {
            nishiTokorozawa: true,
            shimoyamaguchi: false,
            seibuKyujomae: false,
        },
        "変更前経路に無い支線駅は、種別上の停車駅でも停車予定なしとして比較する。",
    );
}

function testOperationPlanAppliesAtomicallyAndKeepsOldPlanForWords() {
    const context = createHarness();
    configureSayamaStations(context);

    vm.runInContext(
        `
            state.config.trainNo = "1001";
            state.config.type = "各停";
            state.config.dest = "飯能";
            state.config.cars = 10;
            state.config.direction = "下り";
            state.config.endChange = true;
            state.config.second = {
                trainNo: "2001",
                type: "急行",
                dest: "西武球場前",
                cars: 10,
                changeStation: "西所沢",
                source: "operation-control",
                operationPlan: {
                    passStations: ["西所沢", "下山口"],
                    manualPlatforms: { "西武球場前": "2" },
                    comparisonStops: {
                        "西所沢": true,
                        "下山口": false,
                        "西武球場前": false,
                    },
                    nonPassengerExtraStops: [],
                    routeStations: ["西所沢", "下山口", "西武球場前"],
                    terminalName: "西武球場前",
                },
            };
            state.runtime.passStations = new Set();
            state.runtime.manualPlatforms = {};
            state.runtime.midChangePending = true;
            state.runtime.midChangeApplied = false;
            renderGuidance = () => {};
            speakOnce = () => {};

            applied = applyMidTrainChange("test-operation-control");
            nishi = getStopGuidanceClassification("西所沢");
            terminal = getStopGuidanceClassification("西武球場前");
        `,
        context,
    );

    assert.equal(vm.runInContext("applied", context), true);
    assert.deepEqual(
        readJson(context, `({
            trainNo: state.config.trainNo,
            type: state.config.type,
            dest: state.config.dest,
            passStations: Array.from(state.runtime.passStations).sort(),
            manualPlatforms: state.runtime.manualPlatforms,
            operationChangeActive: state.runtime.operationChangeActive,
            reason: state.runtime.midChangeAppliedReason,
        })`),
        {
            trainNo: "2001",
            type: "急行",
            dest: "西武球場前",
            passStations: ["下山口", "西所沢"].sort(),
            manualPlatforms: { "西武球場前": "2" },
            operationChangeActive: true,
            reason: "test-operation-control",
        },
    );
    assert.deepEqual(
        readJson(context, `({
            nishiExtraPass: nishi.isExtraPass,
            nishiExtraStop: nishi.isExtraStop,
            terminalExtraPass: terminal.isExtraPass,
            terminalExtraStop: terminal.isExtraStop,
        })`),
        {
            nishiExtraPass: true,
            nishiExtraStop: false,
            terminalExtraPass: false,
            terminalExtraStop: true,
        },
        "旧予定の停車→通過を臨時通過、旧予定の通過→停車を臨時停車と判定する。",
    );
}

function testPlatformLookupCanUseFutureTrainNumber() {
    const context = createHarness();

    vm.runInContext(
        `
            state.config.dayType = "平日";
            state.config.trainNo = "1001";
            state.datasets.platforms = {
                "平日": {
                    "西所沢": {
                        "1": [1001],
                        "2": [2001],
                    },
                },
            };
        `,
        context,
    );

    assert.equal(
        vm.runInContext('getPlatformForStation("西所沢")', context),
        "1",
    );
    assert.equal(
        vm.runInContext(
            'getPlatformForStationForTrain("西所沢", "2001")',
            context,
        ),
        "2",
        "反映時は現在列番ではなく変更後列番の標準番線を取得する。",
    );
}

function testMaybeSpeakUsesOperationComparisonWords() {
    const context = createHarness();
    configureSayamaStations(context);

    vm.runInContext(
        `
            state.config.type = "急行";
            state.config.cars = 10;
            state.config.direction = "下り";
            state.config.endChange = false;
            state.runtime.started = true;
            state.runtime.speedKmh = 40;
            state.runtime.passStations = new Set(["西所沢"]);
            state.runtime.operationChangeActive = true;
            state.runtime.operationBaselineStops = {
                "西所沢": true,
                "西武球場前": false,
            };
            state.runtime.prevStationName = "西所沢";
            state.runtime.prevStationDistance = 250;

            spoken = [];
            speakOnce = (key, text) => { spoken.push({ key, text }); };
            updateRouteLock = () => {};
            maybeHandleMidChangeArrival = () => false;
            maybeShowDepartureForNearbyStopStation = () => {};
            otherSpeaks = () => {};

            maybeSpeak({ name: "西所沢", distance: 200 });

            state.runtime.prevStationName = "西武球場前";
            state.runtime.prevStationDistance = 401;
            state.runtime.speedKmh = 0;
            maybeSpeak({ name: "西武球場前", distance: 400 });
        `,
        context,
    );

    const spoken = readJson(context, "spoken");
    assert.ok(
        spoken.some((item) => item.text === "急行、臨時通過"),
        "変更前停車・変更後通過は実際の通過案内でも臨時通過とする。",
    );
    assert.ok(
        spoken.some(
            (item) => item.text === "西武球場前、臨時停車、10両",
        ),
        "変更前通過・変更後停車は実際の400m案内でも臨時停車とする。",
    );
}

function testMenuLabelsAndTwoButtonActionRow() {
    assert.match(appSource, /id:\s*"m-operation"\s*\},\s*"運転整理"/);
    assert.doesNotMatch(appSource, /id:\s*"m-stop"/);
    assert.doesNotMatch(appSource, /id:\s*"m-dest"/);
    assert.doesNotMatch(appSource, /id:\s*"m-type"/);
    assert.doesNotMatch(appSource, /id:\s*"m-train"/);
    assert.match(
        appSource,
        /el\("option",\s*\{\s*value:\s*""\s*\},\s*"変更駅を選択"\)/s,
    );
    assert.match(appSource, /"運転整理を設定"/);
    assert.match(appSource, /"取消"/);
    assert.match(
        appSource,
        /cancelButton\.onclick\s*=\s*\(\)\s*=>\s*\{\s*previewState\s*=\s*null;\s*wrap\.remove\(\);/s,
        "取消はランタイム状態を書き換えず、未確定パネルだけを破棄する。",
    );
    assert.match(
        stylesSource,
        /\.operation-action-row\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s,
        "設定と取消は横並びにする。",
    );
}

testPreviewUsesChangedTypeAndForcesDestinationStop();
testExistingScheduledChangeIsUsedForComparisonBaseline();
testStationsOutsideOldRouteStartAsNotPlannedStops();
testOperationPlanAppliesAtomicallyAndKeepsOldPlanForWords();
testPlatformLookupCanUseFutureTrainNumber();
testMaybeSpeakUsesOperationComparisonWords();
testMenuLabelsAndTwoButtonActionRow();
console.log("operation adjustment tests passed");
