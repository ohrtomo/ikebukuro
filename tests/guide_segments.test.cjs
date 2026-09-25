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
        body: { appendChild() {} },
        head: { appendChild() {} },
        addEventListener() {},
        createElement() {
            return {
                classList: { toggle() {} },
                remove() {},
                removeAttribute() {},
                setAttribute() {},
                style: {},
            };
        },
        getElementById() {
            return null;
        },
        visibilityState: "visible",
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
        SpeechSynthesisUtterance: class {},
        TextDecoder,
        URL,
        alert() {},
        clearInterval,
        clearTimeout,
        console,
        document,
        fetch() {
            throw new Error("案内区間単体試験では fetch を実行しません。");
        },
        navigator: {},
        setInterval,
        setTimeout,
        window,
    });

    vm.runInContext(appSource, context, { filename: "app.js" });
    return context;
}

function evaluateJson(context, source) {
    return JSON.parse(vm.runInContext(`JSON.stringify(${source})`, context));
}

function setDestinations(context) {
    vm.runInContext(
        `
            state.datasets.dests = [
                "池袋", "練馬", "所沢", "西所沢", "飯能", "吾野", "横瀬", "西武秩父",
                "小竹向原", "豊島園", "下山口", "西武球場前", "新宿線直通"
            ];
        `,
        context,
    );
}

function planFromStation(context, stationName, destination, direction) {
    context.planArgs = { stationName, destination, direction };
    return evaluateJson(
        context,
        "buildGuidePlanFromStation(planArgs.stationName, planArgs.destination, planArgs.direction)",
    );
}

function testStationDataGuideSegmentColumn() {
    const context = createHarness();
    context.csvText = new TextDecoder("shift_jis").decode(
        fs.readFileSync(path.join(__dirname, "..", "data", "stationdata.csv")),
    );

    const parsed = evaluateJson(
        context,
        `(() => {
            const data = parseStationDataCsv(csvText);
            return {
                nerima: data.stations["練馬"].guideSegmentIds,
                tokorozawa: data.stations["所沢"].guideSegmentIds,
                agano: data.stations["吾野"].guideSegmentIds,
                nerimaIsStopPattern: Object.prototype.hasOwnProperty.call(
                    data.stations["練馬"].stopPatterns,
                    "案内区間"
                ),
                nerimaHasGuidanceDisabled: Object.prototype.hasOwnProperty.call(
                    data.stations["練馬"],
                    "guidanceDisabled"
                ),
                nerimaIsGuidanceDisabled: data.stations["練馬"].guidanceDisabled,
                spotSegmentIds: data.navSpots.find((spot) => spot.name === "西所沢").guideSegmentIds,
            };
        })()`,
    );

    assert.deepEqual(parsed.nerima, ["池袋1", "池袋2", "有楽", "豊島"]);
    assert.deepEqual(parsed.tokorozawa, ["池袋2", "池袋3"]);
    assert.deepEqual(parsed.agano, ["池袋5", "秩父1"]);
    assert.equal(parsed.nerimaIsStopPattern, false);
    assert.equal(parsed.nerimaHasGuidanceDisabled, true);
    assert.equal(parsed.nerimaIsGuidanceDisabled, false);
    assert.deepEqual(parsed.spotSegmentIds, ["池袋3", "池袋4", "狭山"]);
}

function testGuidanceDisabledColumnIsMetadata() {
    const context = createHarness();
    context.csvText = [
        "種類,名称,緯度,経度,案内区間,案内しない,各停",
        "駅,試験駅,35.0,139.0,池袋1,○,1",
    ].join("\n");

    const parsed = evaluateJson(
        context,
        `(() => {
            const data = parseStationDataCsv(csvText);
            const station = data.stations["試験駅"];
            const spot = data.navSpots.find((item) => item.name === "試験駅");
            return {
                stationDisabled: station.guidanceDisabled,
                spotDisabled: spot.guidanceDisabled,
                disableIsStopPattern: Object.prototype.hasOwnProperty.call(
                    station.stopPatterns,
                    "案内しない"
                ),
                localStopPattern: station.stopPatterns["各停"],
            };
        })()`,
    );

    assert.equal(parsed.stationDisabled, true);
    assert.equal(parsed.spotDisabled, true);
    assert.equal(parsed.disableIsStopPattern, false);
    assert.equal(parsed.localStopPattern, true);
}

function testCrossingsRemainNavSpotsAndGuideStartCandidates() {
    const context = createHarness();
    context.csvText = new TextDecoder("shift_jis").decode(
        fs.readFileSync(path.join(__dirname, "..", "data", "stationdata.csv")),
    );

    const result = evaluateJson(
        context,
        `(() => {
            const data = parseStationDataCsv(csvText);
            const crossing = data.navSpots.find(
                (spot) => spot.kind === "踏切" && spot.name === "池袋2号"
            );
            state.datasets.stations = data.stations;
            state.datasets.navSpots = data.navSpots;
            state.datasets.dests = ["西武秩父"];

            const nearest = findNearestGuideStartSpot(crossing.lat, crossing.lng);
            const plan = buildGuidePlanFromStartSpot(
                nearest,
                "西武秩父",
                "下り"
            );

            state.runtime.activeGuideSegmentId = "池袋1";
            const visibleOnCurrentSegment = isCrossingOnActiveGuideSegment(crossing);
            state.runtime.activeGuideSegmentId = "池袋2";
            const hiddenOnOtherSegment = !isCrossingOnActiveGuideSegment(crossing);

            return {
                crossingCount: data.navSpots.filter((spot) => spot.kind === "踏切").length,
                crossingIsStation: Object.prototype.hasOwnProperty.call(
                    data.stations,
                    "池袋2号"
                ),
                crossingSegments: crossing.guideSegmentIds,
                nearestName: nearest.name,
                plan: plan && plan.segmentIds,
                visibleOnCurrentSegment,
                hiddenOnOtherSegment,
            };
        })()`,
    );

    assert.ok(result.crossingCount > 0, "stationdata.csv の踏切行を読み込む。");
    assert.equal(result.crossingIsStation, false, "踏切を駅判定データへ混在させない。");
    assert.deepEqual(result.crossingSegments, ["池袋1"]);
    assert.equal(result.nearestName, "池袋2号");
    assert.deepEqual(
        result.plan,
        ["池袋1", "池袋2", "池袋3", "池袋4", "池袋5", "秩父1", "秩父2"],
        "踏切を案内開始時の区間判定に使い、行先までの経路を作る。",
    );
    assert.equal(result.visibleOnCurrentSegment, true);
    assert.equal(result.hiddenOnOtherSegment, true);
}

function testGuidePlanBranchesAndTerminals() {
    const context = createHarness();
    setDestinations(context);

    assert.deepEqual(
        planFromStation(context, "池袋", "西武秩父", "下り"),
        {
            segmentIds: ["池袋1", "池袋2", "池袋3", "池袋4", "池袋5", "秩父1", "秩父2"],
            terminalName: "西武秩父",
        },
    );
    assert.deepEqual(
        planFromStation(context, "練馬", "小竹向原", "上り"),
        { segmentIds: ["有楽"], terminalName: "小竹向原" },
    );
    assert.deepEqual(
        planFromStation(context, "練馬", "豊島園", "下り"),
        { segmentIds: ["豊島"], terminalName: "豊島園" },
    );
    assert.deepEqual(
        planFromStation(context, "西所沢", "西武球場前", "下り"),
        { segmentIds: ["狭山"], terminalName: "西武球場前" },
    );
    assert.deepEqual(
        planFromStation(context, "吾野", "西武秩父", "下り"),
        { segmentIds: ["秩父1", "秩父2"], terminalName: "西武秩父" },
    );
    assert.deepEqual(
        planFromStation(context, "池袋", "新宿線直通", "下り"),
        { segmentIds: ["池袋1", "池袋2"], terminalName: "所沢" },
    );
    assert.deepEqual(
        planFromStation(context, "小竹向原", "西武球場前", "下り"),
        {
            segmentIds: ["有楽", "池袋2", "池袋3", "狭山"],
            terminalName: "西武球場前",
        },
        "下り地下起動は小竹向原を仮想的な開始地点として西武球場前までの経路を作る。",
    );
    assert.deepEqual(
        planFromStation(context, "西武球場前", "池袋", "上り"),
        {
            segmentIds: ["狭山", "池袋3", "池袋2", "池袋1"],
            terminalName: "池袋",
        },
    );
    assert.deepEqual(
        planFromStation(context, "西武秩父", "小竹向原", "上り"),
        {
            segmentIds: ["秩父2", "秩父1", "池袋5", "池袋4", "池袋3", "池袋2", "有楽"],
            terminalName: "小竹向原",
        },
    );

    assert.equal(
        planFromStation(context, "池袋", "未登録行先", "下り"),
        null,
    );
}

function testGuidePlanStopsAtItsTerminal() {
    const context = createHarness();
    setDestinations(context);

    vm.runInContext(
        `
            state.config.direction = "下り";
            state.runtime.passStations = new Set();
            applyGuidePlan({
                segmentIds: ["池袋1", "池袋2", "池袋3"],
                terminalName: "所沢",
            });
        `,
        context,
    );

    assert.equal(
        vm.runInContext('findNextStopStationName("練馬")', context),
        "中村橋",
    );
    assert.equal(
        vm.runInContext('findNextStopStationName("所沢")', context),
        null,
        "新宿線直通を所沢終端として扱うため、所沢の先を案内してはならない。",
    );
}

function testGuidanceDisabledStationIsSkippedAsNextVoiceTarget() {
    const context = createHarness();

    vm.runInContext(
        `
            state.config.direction = "下り";
            state.runtime.passStations = new Set();
            state.datasets.stations = {
                "中村橋": { guidanceDisabled: true },
            };
            applyGuidePlan({
                segmentIds: ["池袋1", "池袋2", "池袋3"],
                terminalName: "所沢",
            });
        `,
        context,
    );

    assert.equal(
        vm.runInContext('findNextStopStationName("練馬")', context),
        "富士見台",
        "案内しない設定の駅は、次停車駅の音声案内対象から外す。",
    );
}

function testGuideSegmentIndicatorUsesGpsStatusColor() {
    const context = createHarness();
    const guidanceRoot = {
        _guideSegmentStatus: { textContent: "", style: {} },
    };
    const startRoot = {
        _gpsStatus: { textContent: "", style: {} },
    };
    context.document.getElementById = (id) => {
        if (id === "screen-guidance") return guidanceRoot;
        if (id === "screen-start") return startRoot;
        return null;
    };

    vm.runInContext(
        `
            state.runtime.activeGuideSegmentId = "池袋2";
            state.runtime.lastGpsUpdate = Date.now();
            state.runtime.undergroundMode = false;
            state.runtime.autoUndergroundReady = false;
            setGpsStatus("GPS");
        `,
        context,
    );

    assert.equal(guidanceRoot._guideSegmentStatus.textContent, "池2");
    assert.equal(guidanceRoot._guideSegmentStatus.style.color, "lime");
    assert.equal(startRoot._gpsStatus.textContent, "GPS");
}

function testUndergroundWaitUsesDelayApiToStationName() {
    const context = createHarness();

    vm.runInContext(
        `
            state.config.direction = "上り";
            state.runtime.autoUndergroundReady = true;
            applyGuidePlan({
                segmentIds: ["池袋2", "有楽"],
                terminalName: "小竹向原",
            });
        `,
        context,
    );

    assert.equal(
        vm.runInContext('maybeEnterUndergroundModeFromDelayApi("練馬")', context),
        false,
        "API の行先駅が練馬のままなら地下待機を解除せず、地下モードへも移行しない。",
    );
    assert.equal(vm.runInContext("state.runtime.undergroundMode", context), false);

    assert.equal(
        vm.runInContext('maybeEnterUndergroundModeFromDelayApi("新桜台")', context),
        true,
        "API の行先駅が地下側の新桜台になった時だけ地下モードへ移行する。",
    );
    assert.equal(vm.runInContext("state.runtime.undergroundMode", context), true);
    assert.equal(vm.runInContext("state.runtime.autoUndergroundReady", context), false);
}

function testGuideRouteValidationRejectsUnregisteredDestinations() {
    const context = createHarness();
    setDestinations(context);

    vm.runInContext(
        `
            state.config.dest = "未登録行先";
            state.config.endChange = false;
        `,
        context,
    );
    assert.match(
        vm.runInContext("getGuideRouteValidationError()", context),
        /未登録行先/,
    );

    vm.runInContext(
        `
            state.config.dest = "池袋";
            state.config.endChange = true;
            state.config.second = {
                trainNo: "9999",
                changeStation: "練馬",
                dest: "未登録行先",
            };
        `,
        context,
    );
    assert.match(
        vm.runInContext("getGuideRouteValidationError()", context),
        /途中駅列情変更後/,
    );
}

function testMidChangeRecalculatesFromChangeStation() {
    const context = createHarness();
    setDestinations(context);

    vm.runInContext(
        `
            state.config.direction = "下り";
            state.config.dest = "西武球場前";
        `,
        context,
    );

    assert.equal(
        vm.runInContext('recalculateGuidePlanFromStation("西所沢", state.config.dest)', context),
        true,
    );
    assert.deepEqual(
        evaluateJson(context, "({ plan: state.runtime.guidePlan, terminal: state.runtime.guideTerminalName })"),
        { plan: ["狭山"], terminal: "西武球場前" },
    );
}

function testMidChangeRouteWaitsForChangeStation200mRadius() {
    const context = createHarness();
    setDestinations(context);

    vm.runInContext(
        `
            state.config.direction = "下り";
            state.config.dest = "西武秩父";
            state.config.endChange = true;
            state.config.second = {
                trainNo: "9999",
                changeStation: "西所沢",
                dest: "西武球場前",
            };
            applyGuidePlan({
                segmentIds: ["池袋3", "池袋4", "池袋5", "秩父1", "秩父2"],
                terminalName: "西武秩父",
            });
        `,
        context,
    );

    context.changePosition = { name: "西所沢", distance: 201 };
    assert.equal(
        vm.runInContext("maybeRecalculateGuidePlanAtMidChangeStation(changePosition)", context),
        false,
        "変更駅の200m圏外では後半行先の経路へ切り替えない。",
    );
    assert.deepEqual(
        evaluateJson(context, "state.runtime.guidePlan"),
        ["池袋3", "池袋4", "池袋5", "秩父1", "秩父2"],
    );

    context.changePosition = { name: "西所沢", distance: 200 };
    assert.equal(
        vm.runInContext("maybeRecalculateGuidePlanAtMidChangeStation(changePosition)", context),
        true,
    );
    assert.deepEqual(
        evaluateJson(context, "({ plan: state.runtime.guidePlan, terminal: state.runtime.guideTerminalName })"),
        { plan: ["狭山"], terminal: "西武球場前" },
    );
    assert.equal(
        vm.runInContext("state.runtime.guideMidChangeRouteApplied", context),
        true,
    );
}

function testOneSegmentGpsJumpDoesNotCommitAwayFromBoundary() {
    const context = createHarness();
    context.csvText = new TextDecoder("shift_jis").decode(
        fs.readFileSync(path.join(__dirname, "..", "data", "stationdata.csv")),
    );

    vm.runInContext(
        `
            const parsed = parseStationDataCsv(csvText);
            state.datasets.stations = parsed.stations;
            state.config.direction = "下り";
            applyGuidePlan({
                segmentIds: ["池袋2", "池袋3"],
                terminalName: "西所沢",
            });
        `,
        context,
    );

    // 所沢〜西所沢の途中を一度だけ示しても、境界の所沢から遠ければ池袋2のまま維持する。
    vm.runInContext(
        "updateActiveGuideSegmentFromPosition(35.788, 139.465)",
        context,
    );
    assert.equal(
        vm.runInContext("state.runtime.activeGuideSegmentId", context),
        "池袋2",
    );

    // 実際に所沢の境界へ到達した時だけ、次の池袋3へ進める。
    vm.runInContext(
        `
            const tokorozawa = state.datasets.stations["所沢"];
            updateActiveGuideSegmentFromPosition(tokorozawa.lat, tokorozawa.lng);
        `,
        context,
    );
    assert.equal(
        vm.runInContext("state.runtime.activeGuideSegmentId", context),
        "池袋3",
    );
}

testStationDataGuideSegmentColumn();
testGuidanceDisabledColumnIsMetadata();
testCrossingsRemainNavSpotsAndGuideStartCandidates();
testGuidePlanBranchesAndTerminals();
testGuidePlanStopsAtItsTerminal();
testGuidanceDisabledStationIsSkippedAsNextVoiceTarget();
testGuideSegmentIndicatorUsesGpsStatusColor();
testGuideRouteValidationRejectsUnregisteredDestinations();
testMidChangeRecalculatesFromChangeStation();
testMidChangeRouteWaitsForChangeStation200mRadius();
testOneSegmentGpsJumpDoesNotCommitAwayFromBoundary();
testUndergroundWaitUsesDelayApiToStationName();
console.log("guide segment tests passed");
