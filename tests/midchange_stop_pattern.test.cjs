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
            state.runtime.midChangePending = true;
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

            midChangeApplyResult = applyMidTrainChange();
        `,
        context,
    );

    assert.equal(
        vm.runInContext("midChangeApplyResult", context),
        true,
        "未適用の途中駅列情変更は一度だけ適用できる。",
    );
    assert.equal(
        vm.runInContext("state.runtime.midChangeAppliedReason", context),
        "reserved-trigger",
        "従来の予約経路は既定の適用理由として記録する。",
    );
    assert.equal(
        vm.runInContext("applyMidTrainChange()", context),
        false,
        "適用済みの途中駅列情変更は再適用しない。",
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

function testMissedReservationFallsBackAtChangeStation200m() {
    const context = createHarness();
    const scheduledDelays = [];
    context.setTimeout = (_callback, delay) => {
        scheduledDelays.push(delay);
        return scheduledDelays.length;
    };

    vm.runInContext(
        `
            state.datasets.dests = ["西所沢", "下山口", "西武球場前"];
            state.datasets.stations = {};
            state.config.trainNo = "1001";
            state.config.type = "各停";
            state.config.dest = "西所沢";
            state.config.cars = 8;
            state.config.direction = "下り";
            state.config.endChange = true;
            state.config.second = {
                trainNo: "2001",
                type: "急行",
                dest: "西武球場前",
                cars: 10,
                changeStation: "西所沢",
            };

            state.runtime.started = true;
            state.runtime.midChangePending = true;
            state.runtime.midChangeApplied = false;
            state.runtime.midChangeArrivalHandled = false;
            state.runtime.guideMidChangeRouteApplied = false;
            state.runtime.passStations = new Set();
            state.runtime.nonPassengerExtraStops = new Set();
            state.runtime.nonPassengerExtraStopsSecond = new Set();
            state.runtime.lastTrainScopedManualSettings = null;

            renderedCount = 0;
            spoken = [];
            renderGuidance = () => { renderedCount += 1; };
            speakOnce = (key, text) => { spoken.push({ key, text }); };
        `,
        context,
    );

    context.changePosition = { name: "西所沢", distance: 201 };
    assert.equal(
        vm.runInContext("processMidTrainChangeAtPosition(changePosition)", context),
        false,
        "変更駅でも200m圏外では補完適用しない。",
    );
    assert.equal(vm.runInContext("state.config.trainNo", context), "1001");

    context.changePosition = { name: "西所沢", distance: 200 };
    assert.equal(
        vm.runInContext("processMidTrainChangeAtPosition(changePosition)", context),
        true,
        "予約イベントを通らなくても変更駅200m圏内で補完適用する。",
    );

    assert.deepEqual(
        JSON.parse(vm.runInContext(`JSON.stringify({
            trainNo: state.config.trainNo,
            type: state.config.type,
            dest: state.config.dest,
            cars: state.config.cars,
            pending: state.runtime.midChangePending,
            applied: state.runtime.midChangeApplied,
            reason: state.runtime.midChangeAppliedReason,
            arrivalHandled: state.runtime.midChangeArrivalHandled,
            routeApplied: state.runtime.guideMidChangeRouteApplied,
            guidePlan: state.runtime.guidePlan,
            terminal: state.runtime.guideTerminalName,
            spoken,
        })`, context)),
        {
            trainNo: "2001",
            type: "急行",
            dest: "西武球場前",
            cars: 10,
            pending: false,
            applied: true,
            reason: "change-station-200m-fallback",
            arrivalHandled: true,
            routeApplied: true,
            guidePlan: ["狭山"],
            terminal: "西武球場前",
            spoken: [
                { key: "midchange_change", text: "列情変更" },
                { key: "midchange_maku", text: "方向幕確認" },
            ],
        },
    );
    assert.deepEqual(scheduledDelays, [20000]);

    context.changePosition = { name: "西所沢", distance: 150 };
    assert.equal(
        vm.runInContext("processMidTrainChangeAtPosition(changePosition)", context),
        false,
        "適用・到着処理済みなら同じ位置で重複実行しない。",
    );
    assert.deepEqual(scheduledDelays, [20000]);
    assert.equal(vm.runInContext("spoken.length", context), 2);
}

function testStartupAfterChangeStationCatchesUpOnce() {
    const context = createHarness();

    vm.runInContext(
        `
            state.datasets.dests = ["西所沢", "下山口", "西武球場前"];
            state.datasets.stations = {};
            state.datasets.navSpots = [{
                kind: "駅",
                name: "下山口",
                lat: 35,
                lng: 139,
                guideSegmentIds: ["狭山"],
            }];
            state.config.trainNo = "1001";
            state.config.type = "各停";
            state.config.dest = "西所沢";
            state.config.cars = 8;
            state.config.direction = "下り";
            state.config.endChange = true;
            state.config.second = {
                trainNo: "2001",
                type: "急行",
                dest: "西武球場前",
                cars: 10,
                changeStation: "西所沢",
            };

            state.runtime.started = true;
            state.runtime.startupMode = true;
            state.runtime.startupFixed = false;
            state.runtime.midChangePending = true;
            state.runtime.midChangeApplied = false;
            state.runtime.guideMidChangeRouteApplied = false;
            state.runtime.passStations = new Set();
            state.runtime.nonPassengerExtraStops = new Set();
            state.runtime.nonPassengerExtraStopsSecond = new Set();
            state.runtime.lastTrainScopedManualSettings = null;

            renderGuidance = () => {};
            speakOnce = () => {};
        `,
        context,
    );

    context.startupPosition = { name: "西所沢", distance: 300 };
    assert.equal(
        vm.runInContext(
            "maybeApplyMidTrainChangeAfterStartupPosition(startupPosition, 35, 139)",
            context,
        ),
        false,
        "開始位置が変更駅そのものなら、変更駅より後とはみなさない。",
    );
    assert.equal(vm.runInContext("state.runtime.midChangePending", context), true);

    context.startupPosition = { name: "下山口", distance: 300 };
    assert.equal(
        vm.runInContext(
            "maybeApplyMidTrainChangeAfterStartupPosition(startupPosition, 35, 139)",
            context,
        ),
        true,
        "途中起動位置が変更駅より後と一意に確認できれば後半列情へ追いつく。",
    );
    assert.deepEqual(
        JSON.parse(vm.runInContext(`JSON.stringify({
            trainNo: state.config.trainNo,
            dest: state.config.dest,
            reason: state.runtime.midChangeAppliedReason,
            routeApplied: state.runtime.guideMidChangeRouteApplied,
            guidePlan: state.runtime.guidePlan,
            terminal: state.runtime.guideTerminalName,
            activeSegment: state.runtime.activeGuideSegmentId,
        })`, context)),
        {
            trainNo: "2001",
            dest: "西武球場前",
            reason: "startup-after-change-station",
            routeApplied: true,
            guidePlan: ["狭山"],
            terminal: "西武球場前",
            activeSegment: "狭山",
        },
    );
    assert.equal(
        vm.runInContext(
            "maybeApplyMidTrainChangeAfterStartupPosition(startupPosition, 35, 139)",
            context,
        ),
        false,
        "途中起動補完も再適用しない。",
    );
}

function testPositionFallbackDoesNotRunBeforeGuidanceStarts() {
    const context = createHarness();

    vm.runInContext(
        `
            state.config.endChange = true;
            state.config.second = {
                trainNo: "2001",
                type: "急行",
                dest: "西武球場前",
                cars: 10,
                changeStation: "西所沢",
            };
            state.runtime.started = false;
            state.runtime.midChangePending = true;
            state.runtime.midChangeApplied = false;
        `,
        context,
    );

    context.changePosition = { name: "西所沢", distance: 100 };
    assert.equal(
        vm.runInContext("processMidTrainChangeAtPosition(changePosition)", context),
        false,
    );
    assert.equal(vm.runInContext("state.runtime.midChangePending", context), true);
    assert.equal(vm.runInContext("state.runtime.midChangeApplied", context), false);
}

testSameTrainNumberUsesNewTypeBasePattern();
testOrdinarySameTrainRestoreIsUnchanged();
testMissedReservationFallsBackAtChangeStation200m();
testStartupAfterChangeStationCatchesUpOnce();
testPositionFallbackDoesNotRunBeforeGuidanceStarts();
console.log("mid-change stop-pattern tests passed");
