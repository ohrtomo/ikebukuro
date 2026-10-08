const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stationCsv = new TextDecoder("shift_jis").decode(
    fs.readFileSync(path.join(root, "data", "stationdata.csv")),
);
const destinations = JSON.parse(
    fs.readFileSync(path.join(root, "data", "destinations.json"), "utf8"),
);

function createHarness() {
    const context = vm.createContext({
        console,
        TextDecoder,
        URL,
        document: {
            body: { appendChild() {} },
            head: { appendChild() {} },
            addEventListener() {},
            getElementById() { return null; },
            createElement() { return { style: {}, setAttribute() {}, addEventListener() {} }; },
            visibilityState: "visible",
        },
        window: { addEventListener() {}, speechSynthesis: { cancel() {} } },
        navigator: {},
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
    });
    vm.runInContext(appSource, context, { filename: "app.js" });
    context.stationCsv = stationCsv;
    context.destinations = destinations;
    vm.runInContext(`
        const parsed = parseStationDataCsv(stationCsv);
        state.datasets.stations = parsed.stations;
        state.datasets.navSpots = parsed.navSpots;
        state.datasets.dests = destinations;
    `, context);
    return context;
}

function read(context, expression) {
    return JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context));
}

function testSetupUsesOnlyTraversedSegmentsAndScheduledPassStations() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.direction = "下り";
        state.config.type = "特急";
        state.config.dest = "西武秩父";
        state.config.trainNo = "1001";
        state.config.endChange = false;
        const full = buildOperatingStopSetupFromPosition(
            state.datasets.stations["池袋"].lat,
            state.datasets.stations["池袋"].lng,
        );
        state.config.dest = "飯能";
        const short = buildOperatingStopSetupFromPosition(
            state.datasets.stations["所沢"].lat,
            state.datasets.stations["所沢"].lng,
        );
        return { full, short };
    })()`);

    assert.equal(result.full.traversesTarget, true);
    assert.ok(result.full.firstCandidates.includes("武蔵丘"));
    assert.ok(result.full.firstCandidates.includes("正丸トンネル"));
    assert.ok(!result.full.firstCandidates.includes("横瀬"), "特急停車駅は候補に出さない。");
    assert.ok(!result.full.firstCandidates.includes("西武秩父"), "行先は候補に出さない。");
    assert.equal(result.short.traversesTarget, false);
    assert.deepEqual(result.short.firstCandidates, []);
}

function testMidChangeUsesSeparateTrainPatternsAndPhaseStations() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.direction = "下り";
        state.config.type = "特急";
        state.config.dest = "横瀬";
        state.config.trainNo = "1001";
        state.config.endChange = true;
        state.config.second = {
            trainNo: "2001", type: "各停", dest: "西武秩父",
            changeStation: "吾野", source: "settings", operationPlan: null,
        };
        return buildOperatingStopSetupFromPosition(
            state.datasets.stations["飯能"].lat,
            state.datasets.stations["飯能"].lng,
        );
    })()`);

    assert.equal(result.traversesTarget, true);
    assert.ok(result.firstCandidates.includes("武蔵丘"));
    assert.ok(!result.firstCandidates.includes("正丸トンネル"));
    assert.deepEqual(result.secondCandidates, ["正丸トンネル"]);
}

function testMidChangeLastInterstationStillCountsAsFirstPhaseSegment() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.direction = "下り";
        state.config.type = "特急";
        state.config.dest = "横瀬";
        state.config.trainNo = "1001";
        state.config.endChange = true;
        state.config.second = {
            trainNo: "2001", type: "各停", dest: "西武秩父",
            changeStation: "武蔵丘", source: "settings", operationPlan: null,
        };
        return buildOperatingStopSetupFromPosition(
            state.datasets.stations["東飯能"].lat,
            state.datasets.stations["東飯能"].lng,
        );
    })()`);

    assert.equal(result.traversesTarget, true);
    assert.deepEqual(result.firstCandidates, ["東飯能"]);
    assert.ok(!result.firstCandidates.includes("武蔵丘"));
}

function testStartingBeyondChangeStationUsesOnlyRemainingSecondPhase() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.direction = "下り";
        state.config.type = "特急";
        state.config.dest = "横瀬";
        state.config.trainNo = "1001";
        state.config.endChange = true;
        state.config.second = {
            trainNo: "2001", type: "各停", dest: "西武秩父",
            changeStation: "吾野", source: "settings", operationPlan: null,
        };
        return buildOperatingStopSetupFromPosition(
            state.datasets.stations["正丸"].lat,
            state.datasets.stations["正丸"].lng,
        );
    })()`);

    assert.equal(result.traversesTarget, true);
    assert.deepEqual(result.firstCandidates, []);
    assert.deepEqual(result.secondCandidates, ["正丸トンネル"]);
}

function testOperatingStopAndDirectChangeClassifications() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.type = "特急";
        state.runtime.passStations = new Set(["武蔵丘", "東飯能"]);
        state.runtime.operatingStops = new Set(["武蔵丘"]);
        state.runtime.operatingStopBaseStations = new Set(["武蔵丘"]);
        state.runtime.passStations.delete("武蔵丘");
        const startup = getStopGuidanceClassification("武蔵丘");

        applyDirectOperationAdjustment({
            passStations: [], manualPlatforms: {},
            operatingStops: ["武蔵丘", "東飯能"],
        });
        const added = getStopGuidanceClassification("東飯能");

        applyDirectOperationAdjustment({
            passStations: ["武蔵丘"], manualPlatforms: {},
            operatingStops: ["東飯能"],
        });
        const changedToPass = getStopGuidanceClassification("武蔵丘");

        applyDirectOperationAdjustment({
            passStations: [], manualPlatforms: {},
            operatingStops: ["東飯能"],
        });
        const changedToStop = getStopGuidanceClassification("武蔵丘");
        return { startup, added, changedToPass, changedToStop };
    })()`);

    assert.equal(result.startup.isOperatingStop, true);
    assert.equal(result.startup.isExtraStop, false);
    assert.equal(result.added.isOperatingStop, true);
    assert.equal(result.added.isExtraStop, true);
    assert.equal(result.changedToPass.isExtraPass, true);
    assert.equal(result.changedToPass.isOperatingStop, false);
    assert.equal(result.changedToStop.isExtraStop, false);
    assert.equal(result.changedToStop.isOperatingStop, false);
}

function testBuildPassListUsesSelectedOperatingStopWithoutRestoringUncheckedOldOne() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.type = "特急";
        state.config.trainNo = "1001";
        state.runtime.operatingStops = new Set(["武蔵丘"]);
        state.runtime.operatingStopBaseStations = new Set(["武蔵丘"]);
        buildPassStationList({ restoreTrainScopedManualSettings: false });
        const selected = getStopGuidanceClassification("武蔵丘");

        state.runtime.lastTrainScopedManualSettings = {
            trainNo: "1001", passStations: Array.from(state.runtime.passStations),
            operatingStops: ["武蔵丘"], manualPlatforms: {}, platformChanges: [],
        };
        state.runtime.operatingStops = new Set();
        state.runtime.operatingStopBaseStations = new Set();
        buildPassStationList();
        const unchecked = getStopGuidanceClassification("武蔵丘");
        return { selected, unchecked };
    })()`);

    assert.equal(result.selected.isStop, true);
    assert.equal(result.selected.isExtraStop, false);
    assert.equal(result.selected.isOperatingStop, true);
    assert.equal(result.unchecked.isStop, false);
    assert.equal(result.unchecked.isOperatingStop, false);
}

function testArrivalWordsKeepSTrainTimingAndTemporaryStopDifference() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.type = "特急";
        state.config.cars = 10;
        state.config.direction = "下り";
        state.config.endChange = false;
        state.runtime.started = true;
        state.runtime.speedKmh = 0;
        state.runtime.passStations = new Set(["東飯能"]);
        state.runtime.operatingStops = new Set(["武蔵丘"]);
        state.runtime.operatingStopBaseStations = new Set(["武蔵丘"]);
        spoken = [];
        speakOnce = (key, text) => { spoken.push(text); };
        updateRouteLock = () => {};
        maybeHandleMidChangeArrival = () => false;
        maybeShowDepartureForNearbyStopStation = () => {};
        otherSpeaks = () => {};
        findNextStopStationName = () => null;

        state.runtime.prevStationName = "武蔵丘";
        state.runtime.prevStationDistance = 401;
        maybeSpeak({ name: "武蔵丘", distance: 400 });
        maybeSpeak({ name: "武蔵丘", distance: 200 });
        const planned = [...spoken];

        spoken.length = 0;
        applyDirectOperationAdjustment({
            passStations: [], manualPlatforms: {},
            operatingStops: ["武蔵丘", "東飯能"],
        });
        state.runtime.prevStationName = "東飯能";
        state.runtime.prevStationDistance = 401;
        maybeSpeak({ name: "東飯能", distance: 400 });
        maybeSpeak({ name: "東飯能", distance: 200 });
        const temporary = [...spoken];
        return { planned, temporary };
    })()`);

    assert.ok(result.planned.includes("武蔵丘、停車、10両"));
    assert.ok(result.planned.includes("停車、10両"));
    assert.equal(result.planned.filter((word) =>
        word === "運転停車、ドア扱い注意").length, 1);
    assert.ok(result.temporary.includes("東飯能、臨時停車、10両"));
    assert.ok(result.temporary.includes("臨時停車、10両"));
    assert.equal(result.temporary.filter((word) =>
        word === "運転停車、ドア扱い注意").length, 1);
}

function testScheduledChangeSwitchesToSecondOperatingStops() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.trainNo = "1001";
        state.config.type = "特急";
        state.config.dest = "横瀬";
        state.config.direction = "下り";
        state.config.endChange = true;
        state.config.second = {
            trainNo: "2001", type: "各停", dest: "西武秩父",
            cars: 10, changeStation: "吾野", source: "settings", operationPlan: null,
        };
        state.runtime.midChangePending = true;
        state.runtime.operatingStops = new Set(["武蔵丘"]);
        state.runtime.operatingStopBaseStations = new Set(["武蔵丘"]);
        state.runtime.operatingStopsSecond = new Set(["正丸トンネル"]);
        state.runtime.passStations = new Set(["正丸トンネル"]);
        state.runtime.nonPassengerExtraStopsSecond = new Set();
        renderGuidance = () => {};
        speakOnce = () => {};
        const applied = applyMidTrainChange("test");
        return {
            applied,
            operatingStops: Array.from(state.runtime.operatingStops),
            isPass: state.runtime.passStations.has("正丸トンネル"),
            classification: getStopGuidanceClassification("正丸トンネル"),
        };
    })()`);

    assert.equal(result.applied, true);
    assert.deepEqual(result.operatingStops, ["正丸トンネル"]);
    assert.equal(result.isPass, false);
    assert.equal(result.classification.isOperatingStop, true);
    assert.equal(result.classification.isExtraStop, false);
}

function testEarlyMidChangeKeepsFirstPhaseOperatingStopUntilChangeStation() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.trainNo = "1001";
        state.config.type = "特急";
        state.config.dest = "横瀬";
        state.config.direction = "下り";
        state.config.endChange = true;
        state.config.second = {
            trainNo: "2001", type: "各停", dest: "西武秩父",
            cars: 10, changeStation: "吾野", source: "settings", operationPlan: null,
        };
        applyGuidePlan({ segmentIds: ["池袋5", "秩父1"], terminalName: "横瀬" });
        state.runtime.midChangePending = true;
        state.runtime.operatingStops = new Set(["高麗"]);
        state.runtime.operatingStopBaseStations = new Set(["高麗"]);
        state.runtime.operatingStopsSecond = new Set(["正丸トンネル"]);
        state.runtime.passStations = new Set(["正丸トンネル"]);
        state.runtime.nonPassengerExtraStopsSecond = new Set();
        renderGuidance = () => {};
        speakOnce = () => {};
        const applied = applyMidTrainChange("early-trigger");
        return {
            applied,
            operatingStops: Array.from(state.runtime.operatingStops).sort(),
            highPass: state.runtime.passStations.has("高麗"),
            highGuidance: getStopGuidanceClassification("高麗"),
        };
    })()`);

    assert.equal(result.applied, true);
    assert.deepEqual(result.operatingStops, ["正丸トンネル", "高麗"].sort());
    assert.equal(result.highPass, false);
    assert.equal(result.highGuidance.isOperatingStop, true);
    assert.equal(result.highGuidance.isExtraStop, false);
}

function testFirstPhaseOperatingStopClearsAfterChangeStationRouteSwitch() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.trainNo = "1001";
        state.config.type = "特急";
        state.config.dest = "横瀬";
        state.config.direction = "下り";
        state.config.endChange = true;
        state.config.second = {
            trainNo: "2001", type: "各停", dest: "西武秩父",
            cars: 10, changeStation: "吾野", source: "settings", operationPlan: null,
        };
        applyGuidePlan({ segmentIds: ["池袋5", "秩父1"], terminalName: "横瀬" });
        state.runtime.started = true;
        state.runtime.midChangePending = true;
        state.runtime.operatingStops = new Set(["高麗"]);
        state.runtime.operatingStopBaseStations = new Set(["高麗"]);
        state.runtime.operatingStopsSecond = new Set(["正丸トンネル"]);
        state.runtime.nonPassengerExtraStopsSecond = new Set();
        renderGuidance = () => {};
        speakOnce = () => {};
        applyMidTrainChange("early-trigger");
        const switched = maybeRecalculateGuidePlanAtMidChangeStation({
            name: "吾野", distance: 150,
        });
        return {
            switched,
            operatingStops: Array.from(state.runtime.operatingStops),
            baseStations: Array.from(state.runtime.operatingStopBaseStations),
        };
    })()`);

    assert.equal(result.switched, true);
    assert.deepEqual(result.operatingStops, ["正丸トンネル"]);
    assert.deepEqual(result.baseStations, ["正丸トンネル"]);
}

function testOperationReservationAppliesAllFourTransitions() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.trainNo = "1001";
        state.config.type = "特急";
        state.config.dest = "横瀬";
        state.config.direction = "下り";
        state.config.endChange = true;
        state.config.second = {
            trainNo: "2001", type: "特急", dest: "西武秩父",
            cars: 10, changeStation: "飯能", source: "operation-control",
            operationPlan: {
                passStations: ["武蔵丘"],
                manualPlatforms: {},
                comparisonStops: {
                    "飯能": true, "東飯能": false,
                    "武蔵丘": true, "高麗": true,
                },
                nonPassengerExtraStops: [],
                operatingStops: ["飯能", "東飯能"],
                routeStations: ["飯能", "東飯能", "武蔵丘", "高麗",
                    "武蔵横手", "東吾野", "吾野", "西吾野", "正丸",
                    "正丸トンネル", "芦ヶ久保", "横瀬", "西武秩父"],
                terminalName: "西武秩父",
            },
        };
        state.runtime.midChangePending = true;
        renderGuidance = () => {};
        speakOnce = () => {};
        const applied = applyMidTrainChange("test-operation");
        return {
            applied,
            normalOperating: getStopGuidanceClassification("飯能"),
            temporaryOperating: getStopGuidanceClassification("東飯能"),
            operatingToPass: getStopGuidanceClassification("武蔵丘"),
            operatingToStop: getStopGuidanceClassification("高麗"),
        };
    })()`);

    assert.equal(result.applied, true);
    assert.equal(result.normalOperating.isOperatingStop, true);
    assert.equal(result.normalOperating.isExtraStop, false);
    assert.equal(result.temporaryOperating.isOperatingStop, true);
    assert.equal(result.temporaryOperating.isExtraStop, true);
    assert.equal(result.operatingToPass.isOperatingStop, false);
    assert.equal(result.operatingToPass.isExtraPass, true);
    assert.equal(result.operatingToStop.isOperatingStop, false);
    assert.equal(result.operatingToStop.isExtraStop, false);
}

testSetupUsesOnlyTraversedSegmentsAndScheduledPassStations();
testMidChangeUsesSeparateTrainPatternsAndPhaseStations();
testMidChangeLastInterstationStillCountsAsFirstPhaseSegment();
testStartingBeyondChangeStationUsesOnlyRemainingSecondPhase();
testOperatingStopAndDirectChangeClassifications();
testBuildPassListUsesSelectedOperatingStopWithoutRestoringUncheckedOldOne();
testArrivalWordsKeepSTrainTimingAndTemporaryStopDifference();
testScheduledChangeSwitchesToSecondOperatingStops();
testEarlyMidChangeKeepsFirstPhaseOperatingStopUntilChangeStation();
testFirstPhaseOperatingStopClearsAfterChangeStationRouteSwitch();
testOperationReservationAppliesAllFourTransitions();
console.log("operating stop tests passed");
