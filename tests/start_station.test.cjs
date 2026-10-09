const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
const csv = new TextDecoder("shift_jis").decode(
    fs.readFileSync(path.join(root, "data", "stationdata.csv")),
);
const destinations = JSON.parse(
    fs.readFileSync(path.join(root, "data", "destinations.json"), "utf8"),
);

function createHarness() {
    const stored = new Map();
    const context = vm.createContext({
        console,
        TextDecoder,
        URL,
        navigator: {},
        localStorage: {
            getItem(key) { return stored.get(key) ?? null; },
            setItem(key, value) { stored.set(key, value); },
        },
        document: {
            body: { appendChild() {} },
            head: { appendChild() {} },
            addEventListener() {},
            getElementById() { return null; },
            createElement() { return { style: {}, setAttribute() {}, addEventListener() {} }; },
            visibilityState: "visible",
        },
        window: { addEventListener() {}, speechSynthesis: { cancel() {} } },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
    });
    vm.runInContext(source, context, { filename: "app.js" });
    context.csv = csv;
    context.destinations = destinations;
    vm.runInContext(`
        const parsed = parseStationDataCsv(csv);
        state.datasets.stations = parsed.stations;
        state.datasets.navSpots = parsed.navSpots;
        state.datasets.navGeometry = buildNavGeometryFromStationRows(parseCsvText(csv));
        state.datasets.dests = destinations;
    `, context);
    return context;
}

function read(context, expression) {
    return JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context));
}

function testManualStartStationWorksWithoutGps() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.startStation = "池袋";
        state.config.direction = "下り";
        state.config.type = "特急";
        state.config.dest = "西武秩父";
        state.config.endChange = false;
        return {
            setup: buildOperatingStopSetupFromStation("池袋"),
            route: getSelectedStartGuideContext(),
            includesCrossing: getOperationStationNames().some((name) =>
                state.datasets.navSpots.some((spot) =>
                    spot.kind !== "駅" && spot.name === name)),
        };
    })()`);

    assert.equal(result.setup.traversesTarget, true);
    assert.ok(result.setup.firstCandidates.includes("武蔵丘"));
    assert.equal(result.route.plan.segmentIds[0], "池袋1");
    assert.equal(result.includesCrossing, false);
}

function testStaleFixIsAvailableOnlyForCurrentStationButton() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.direction = "下り";
        state.config.type = "特急";
        state.config.dest = "西武秩父";
        state.config.endChange = false;
        const station = state.datasets.stations["飯能"];
        const oldTime = Date.now() - 86400000;
        rememberMeasuredPosition({
            coords: { latitude: station.lat, longitude: station.lng, accuracy: 20 },
            timestamp: oldTime,
        });
        return {
            savedStation: nearestStationForReference(
                getLastMeasuredPosition().lat, getLastMeasuredPosition().lng,
            ).name,
            savedTime: getLastMeasuredPosition().time,
            fresh: getFreshStartPositionForStation("飯能"),
            setup: buildOperatingStopSetupFromStation("飯能"),
        };
    })()`);

    assert.equal(result.savedStation, "飯能");
    assert.ok(result.savedTime < Date.now() - 10000);
    assert.equal(result.fresh, null);
    assert.equal(result.setup.startSpot, "飯能");
    assert.equal(result.setup.traversesTarget, true);
}

function testFreshInterstationFixCanDetermineActualSegment() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.direction = "下り";
        state.config.dest = "西武秩父";
        state.config.endChange = false;
        const crossing = state.datasets.navSpots.find((spot) =>
            spot.kind === "踏切" && spot.guideSegmentIds.includes("池袋5") &&
            nearestStationForReference(spot.lat, spot.lng)?.name === "吾野"
        );
        if (!crossing) return { crossing: false };
        state.config.startStation = "吾野";
        rememberMeasuredPosition({
            coords: { latitude: crossing.lat, longitude: crossing.lng, accuracy: 20 },
            timestamp: Date.now(),
        });
        return {
            crossing: true,
            expected: buildGuidePlanFromStartSpot(crossing, state.config.dest,
                state.config.direction),
            actual: getSelectedStartGuideContext().plan,
        };
    })()`);

    assert.equal(result.crossing, true, "吾野付近の池袋5側踏切で駅間開始を確認する。");
    assert.deepEqual(result.actual, result.expected);
    assert.equal(result.actual.segmentIds[0], "池袋5");
}

function testCrossingOrderExcludesAlreadyPassedStation() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.direction = "下り";
        state.config.type = "特急";
        state.config.dest = "西武秩父";
        state.config.endChange = false;
        const station = state.datasets.stations["高麗"];
        const crossing = state.datasets.navSpots.find((spot) =>
            spot.kind === "踏切" && spot.name === "高麗2号");
        return {
            station: buildOperatingStopSetupFromPosition(station.lat, station.lng),
            between: buildOperatingStopSetupFromPosition(crossing.lat, crossing.lng),
        };
    })()`);

    assert.ok(result.station.firstCandidates.includes("高麗"));
    assert.ok(!result.between.firstCandidates.includes("高麗"));
    assert.ok(result.between.firstCandidates.includes("武蔵横手"));
}

function testExplicitStaleCurrentLocationStillDisambiguatesInterstation() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.startStation = "高麗";
        state.config.direction = "下り";
        state.config.type = "特急";
        state.config.dest = "西武秩父";
        state.config.endChange = false;
        const crossing = state.datasets.navSpots.find((spot) =>
            spot.kind === "踏切" && spot.name === "高麗2号");
        state.runtime.startStationPosition = {
            stationName: "高麗", lat: crossing.lat, lng: crossing.lng,
            time: Date.now() - 86400000,
        };
        return {
            fresh: getFreshStartPositionForStation("高麗"),
            setup: buildOperatingStopSetupFromStation("高麗"),
            route: getSelectedStartGuideContext().plan,
        };
    })()`);

    assert.equal(result.fresh, null);
    assert.equal(result.setup.startSpot, "高麗2号");
    assert.ok(!result.setup.firstCandidates.includes("高麗"));
    assert.equal(result.route.segmentIds[0], "池袋5");
}

function testStartingAfterScheduledChangeUsesSecondTrainRoute() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.startStation = "西吾野";
        state.config.direction = "下り";
        state.config.dest = "横瀬";
        state.config.endChange = true;
        state.config.second = {
            trainNo: "2001", type: "各停", dest: "西武秩父",
            changeStation: "吾野", source: "settings", operationPlan: null,
        };
        return {
            setup: buildOperatingStopSetupFromStation("西吾野"),
            start: getSelectedStartGuideContext(),
        };
    })()`);

    assert.equal(result.start.afterChange, true);
    assert.equal(result.start.plan.terminalName, "西武秩父");
    assert.deepEqual(result.setup.firstCandidates, []);
    assert.ok(result.setup.secondCandidates.includes("正丸トンネル"));
}

function testGuidanceStartsWithoutGpsInBothModes() {
    const context = createHarness();
    context.setTimeout = () => 1;
    context.setInterval = () => 1;
    const result = read(context, `(() => {
        startGpsWatch = () => {};
        startDelayWatch = () => {};
        requestWakeLock = () => {};
        state.config.startStation = "池袋";
        state.config.direction = "下り";
        state.config.dest = "西武秩父";
        state.config.endChange = false;
        const normalStarted = startGuidance();
        const normalPlan = [...state.runtime.guidePlan];

        state.runtime.started = false;
        state.runtime.undergroundMode = true;
        state.runtime.undergroundSource = "downButton";
        state.config.startStation = "新桜台";
        const undergroundStarted = startGuidance();
        return {
            normalStarted, normalPlan, undergroundStarted,
            undergroundPlan: state.runtime.guidePlan,
            undergroundSegment: state.runtime.activeGuideSegmentId,
        };
    })()`);

    assert.equal(result.normalStarted, true);
    assert.equal(result.normalPlan[0], "池袋1");
    assert.equal(result.undergroundStarted, true);
    assert.equal(result.undergroundPlan[0], "有楽");
    assert.equal(result.undergroundSegment, "有楽");
}

testManualStartStationWorksWithoutGps();
testStaleFixIsAvailableOnlyForCurrentStationButton();
testFreshInterstationFixCanDetermineActualSegment();
testCrossingOrderExcludesAlreadyPassedStation();
testExplicitStaleCurrentLocationStillDisambiguatesInterstation();
testStartingAfterScheduledChangeUsesSecondTrainRoute();
testGuidanceStartsWithoutGpsInBothModes();
console.log("start station tests passed");
