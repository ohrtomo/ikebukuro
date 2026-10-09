const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stationCsvBytes = fs.readFileSync(path.join(root, "data", "stationdata.csv"));
let stationCsv;
try {
    stationCsv = new TextDecoder("utf-8", { fatal: true }).decode(stationCsvBytes);
} catch {
    stationCsv = new TextDecoder("shift_jis").decode(stationCsvBytes);
}

function createHarness(csvText = stationCsv) {
    const warnings = [];
    const document = {
        body: { appendChild() {} },
        head: { appendChild() {} },
        addEventListener() {},
        getElementById() { return null; },
        createElement() {
            return {
                style: {}, attributes: {},
                setAttribute(name, value) { this.attributes[name] = value; },
                addEventListener() {},
            };
        },
        visibilityState: "visible",
    };
    const context = vm.createContext({
        TextDecoder,
        URL,
        console: {
            log: console.log.bind(console),
            error: console.error.bind(console),
            warn(...args) { warnings.push(args); },
        },
        document,
        window: { addEventListener() {}, speechSynthesis: { cancel() {} } },
        navigator: {},
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        fetch() { throw new Error("ナビ線形テストでは通信しません。"); },
    });
    vm.runInContext(appSource, context, { filename: "app.js" });
    context.warnings = warnings;
    context.stationCsv = csvText;
    vm.runInContext(`
        const navTestData = parseStationDataCsv(stationCsv);
        state.datasets.stations = navTestData.stations;
        state.datasets.navSpots = navTestData.navSpots;
        state.datasets.navGeometry = buildNavGeometryFromStationRows(parseCsvText(stationCsv));
    `, context);
    return context;
}

function read(context, expression) {
    return JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context));
}

function findUnusedRankBetween(lines, header, segmentId, beforeName, afterName) {
    const nameIndex = header.indexOf("名称");
    const segmentIndex = header.indexOf("案内区間");
    const rankIndex = header.indexOf("ナビ順");
    const ranks = new Map();
    for (const line of lines.slice(1)) {
        const fields = line.split(",");
        const ids = fields[segmentIndex].split("|");
        if (!ids.includes(segmentId)) continue;
        const cell = fields[rankIndex];
        const rank = ids.length === 1
            ? Number(cell)
            : Number(cell.split("|").find((part) => part.startsWith(`${segmentId}=`))
                ?.split("=")[1]);
        ranks.set(fields[nameIndex], rank);
    }
    const before = ranks.get(beforeName);
    const after = ranks.get(afterName);
    const used = new Set(ranks.values());
    for (let rank = before + 1; rank < after; rank++) {
        if (!used.has(rank)) return rank;
    }
    throw new Error(`${segmentId} の試験用スポットを挿入する順位がありません。`);
}

function testEverySegmentHasValidOrderedGeometry() {
    const context = createHarness();
    const result = read(context, `GUIDE_SEGMENTS.map((segment) => ({
        id: segment.id,
        pointCount: getNavSegmentPoints(segment.id)?.length || 0,
        missing: state.datasets.navSpots
            .filter((spot) => ["駅", "踏切"].includes(spot.kind) &&
                getGuideSegmentIdsForSpot(spot).includes(segment.id))
            .filter((spot) => !state.datasets.navGeometry.segments[segment.id]
                .includes(spot.kind + ":" + spot.name))
            .map((spot) => spot.name),
    }))`);

    assert.equal(result.length, 10);
    for (const segment of result) {
        assert.ok(segment.pointCount >= 2, `${segment.id} の駅順と参照が正しい。`);
        assert.deepEqual(segment.missing, [], `${segment.id} の現行CSVスポットが線形に登録されている。`);
    }
    assert.equal(result.find((segment) => segment.id === "池袋3").pointCount, 7);
    assert.equal(result.find((segment) => segment.id === "有楽").pointCount, 3);
}

function testCsvAloneControlsSpotAdditionAndDeletion() {
    const lines = stationCsv.trimEnd().split(/\r?\n/);
    const header = lines[0].split(",");
    const baselineCount = read(createHarness(), `getNavSegmentPoints("池袋3")?.length`);
    const crossing = Array(header.length).fill("");
    for (const [column, value] of Object.entries({
        "種類": "踏切", "名称": "試験追加踏切", "緯度": "35.786", "経度": "139.476",
        "案内区間": "池袋3", "ナビ順": String(findUnusedRankBetween(
            lines, header, "池袋3", "東村山7号", "所沢3号")),
    })) {
        crossing[header.indexOf(column)] = value;
    }

    const added = createHarness([...lines, crossing.join(",")].join("\r\n"));
    const addedRefs = read(added, `state.datasets.navGeometry.segments["池袋3"]`);
    assert.ok(addedRefs.indexOf("踏切:東村山7号") <
        addedRefs.indexOf("踏切:試験追加踏切"));
    assert.ok(addedRefs.indexOf("踏切:試験追加踏切") <
        addedRefs.indexOf("踏切:所沢3号"));
    assert.equal(read(added, `getNavSegmentPoints("池袋3")?.length`), baselineCount + 1);

    const removed = createHarness(lines.filter((line) =>
        !line.startsWith("踏切,東村山7号,")).join("\r\n"));
    const removedRefs = read(removed, `state.datasets.navGeometry.segments["池袋3"]`);
    assert.ok(!removedRefs.includes("踏切:東村山7号"));
    assert.equal(read(removed, `getNavSegmentPoints("池袋3")?.length`), baselineCount - 1);
}

function testCsvRowReorderingDoesNotChangeGeometry() {
    const lines = stationCsv.trimEnd().split(/\r?\n/);
    const original = createHarness();
    const reordered = createHarness([lines[0], ...lines.slice(1).reverse()].join("\r\n"));
    assert.deepEqual(
        read(reordered, `state.datasets.navGeometry`),
        read(original, `state.datasets.navGeometry`),
    );
}

function testCurveHelperPointUsesCsvWithoutBecomingStartSpot() {
    const lines = stationCsv.trimEnd().split(/\r?\n/);
    const header = lines[0].split(",");
    const baselineCount = read(createHarness(), `getNavSegmentPoints("池袋3")?.length`);
    const helper = Array(header.length).fill("");
    for (const [column, value] of Object.entries({
        "種類": "線形補助点", "緯度": "35.786", "経度": "139.476",
        "案内区間": "池袋3", "ナビ順": String(findUnusedRankBetween(
            lines, header, "池袋3", "東村山7号", "所沢3号")),
        "案内しない": "1",
    })) {
        helper[header.indexOf(column)] = value;
    }
    const context = createHarness([...lines, helper.join(",")].join("\r\n"));
    assert.equal(read(context, `state.datasets.navSpots.some((spot) => spot.kind === "線形補助点")`), false);
    assert.equal(read(context, `getNavSegmentPoints("池袋3")?.length`), baselineCount + 1);
}

function testInvalidNavOrderAffectsOnlyItsSegment() {
    const lines = stationCsv.trimEnd().split(/\r?\n/);
    const header = lines[0].split(",");
    const rankIndex = header.indexOf("ナビ順");
    const changed = lines.map((line) => {
        if (!line.startsWith("踏切,東村山7号,")) return line;
        const fields = line.split(",");
        fields[rankIndex] = "";
        return fields.join(",");
    });
    const context = createHarness(changed.join("\r\n"));
    assert.equal(read(context, `getNavSegmentPoints("池袋3")`), null);
    assert.ok(read(context, `getNavSegmentPoints("池袋2")?.length`) > 2);
    assert.ok(context.warnings.length > 0);
}

function testDuplicateNavOrderIsRejected() {
    const lines = stationCsv.trimEnd().split(/\r?\n/);
    const header = lines[0].split(",");
    const rankIndex = header.indexOf("ナビ順");
    const later = lines.find((line) => line.startsWith("踏切,所沢3号,")).split(",")[rankIndex];
    const changed = lines.map((line) => {
        if (!line.startsWith("踏切,東村山7号,")) return line;
        const fields = line.split(",");
        fields[rankIndex] = later;
        return fields.join(",");
    });
    const context = createHarness(changed.join("\r\n"));
    assert.equal(read(context, `getNavSegmentPoints("池袋3")`), null);
    assert.ok(context.warnings.length > 0);
}

function testConnectedRoutesInBothDirections() {
    const context = createHarness();
    const result = read(context, `(() => {
        const routes = [
            { direction: "下り", ids: ["池袋1", "池袋2", "池袋3", "池袋4", "池袋5", "秩父1", "秩父2"], first: "池袋", last: "西武秩父" },
            { direction: "上り", ids: ["秩父2", "秩父1", "池袋5", "池袋4", "池袋3", "池袋2", "池袋1"], first: "西武秩父", last: "池袋" },
            { direction: "下り", ids: ["有楽", "池袋2", "池袋3", "狭山"], first: "小竹向原", last: "西武球場前" },
            { direction: "上り", ids: ["狭山", "池袋3", "池袋2", "有楽"], first: "西武球場前", last: "小竹向原" },
            { direction: "下り", ids: ["池袋1", "豊島"], first: "池袋", last: "豊島園" },
            { direction: "上り", ids: ["豊島", "池袋1"], first: "豊島園", last: "池袋" },
        ];
        return routes.map((route) => {
            state.config.direction = route.direction;
            applyGuidePlan({ segmentIds: route.ids, terminalName: route.last });
            const path = getNavRoutePath();
            return {
                expectedFirst: route.first,
                expectedLast: route.last,
                first: path?.stations[0]?.name,
                last: path?.stations[path.stations.length - 1]?.name,
                pointCount: path?.points.length || 0,
                monotonic: path?.points.every((point, index) =>
                    index === 0 || point.distance >= path.points[index - 1].distance),
            };
        });
    })()`);

    for (const route of result) {
        assert.equal(route.first, route.expectedFirst);
        assert.equal(route.last, route.expectedLast);
        assert.ok(route.pointCount >= 2);
        assert.equal(route.monotonic, true);
    }
}

function testAllGeometryPointsRemainOrderedWhenMatched() {
    const context = createHarness();
    const result = read(context, `(() => {
        const failures = [];
        for (const direction of ["下り", "上り"]) {
            for (const segment of GUIDE_SEGMENTS) {
                state.config.direction = direction;
                applyGuidePlan({ segmentIds: [segment.id], terminalName: "" });
                const route = getNavRoutePath();
                for (let i = 0; i < route.points.length; i++) {
                    const point = route.points[i];
                    const display = getNavDisplayContext(point.lat, point.lng, 100000 + i * 20000);
                    if (!display || Math.abs(display.distance - point.distance) > 2) {
                        failures.push({ direction, segment: segment.id, point: point.name,
                            expected: point.distance, actual: display?.distance });
                    }
                }
            }
        }
        return failures;
    })()`);

    assert.deepEqual(result, [], "各点を通過するGPSは線路順どおりの位置に投影される。");
}

function testTokorozawaCurveKeepsPhysicalOrder() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.direction = "下り";
        applyGuidePlan({ segmentIds: ["池袋2", "池袋3"], terminalName: "西所沢" });
        const route = getNavRoutePath();
        const akitsu5 = route.spotDistances.get("池袋2|踏切:秋津5号");
        const tokorozawaBefore = route.spotDistances.get("池袋2|駅:所沢");
        const tokorozawaAfter = route.spotDistances.get("池袋3|駅:所沢");
        const higashimurayama7 = route.spotDistances.get("池袋3|踏切:東村山7号");
        const nishiTokorozawa = route.spotDistances.get("池袋3|駅:西所沢");

        const names = ["秋津4号", "秋津5号", "所沢", "東村山7号", "所沢3号"];
        const sampled = names.map((name, index) => {
            const spot = state.datasets.navSpots.find((item) => item.name === name);
            const display = getNavDisplayContext(spot.lat, spot.lng, 100000 + index * 20000);
            return { distance: display.distance, pair: display.stationPair };
        });
        return {
            akitsu5, tokorozawaBefore, tokorozawaAfter,
            higashimurayama7, nishiTokorozawa, sampled,
        };
    })()`);

    assert.ok(result.akitsu5 < result.tokorozawaBefore);
    assert.equal(result.tokorozawaBefore, result.tokorozawaAfter);
    assert.ok(result.tokorozawaAfter < result.higashimurayama7);
    assert.ok(result.higashimurayama7 < result.nishiTokorozawa);
    for (let i = 1; i < result.sampled.length; i++) {
        assert.ok(
            result.sampled[i].distance > result.sampled[i - 1].distance,
            "所沢前後で進行距離が逆転しない。",
        );
    }
    assert.deepEqual(result.sampled[1].pair, { prev: "秋津", next: "所沢" });
    assert.deepEqual(result.sampled[3].pair, { prev: "所沢", next: "西所沢" });
}

function testUpboundAndGuideSegmentSwitch() {
    const context = createHarness();
    const result = read(context, `(() => {
        state.config.direction = "上り";
        applyGuidePlan({ segmentIds: ["池袋3", "池袋2"], terminalName: "秋津" });
        const route = getNavRoutePath();
        const east7 = route.spotDistances.get("池袋3|踏切:東村山7号");
        const station3 = route.spotDistances.get("池袋3|駅:所沢");
        const station2 = route.spotDistances.get("池袋2|駅:所沢");
        const akitsu5 = route.spotDistances.get("池袋2|踏切:秋津5号");

        const tokorozawa = state.datasets.stations["所沢"];
        state.runtime.activeGuideSegmentId = "池袋3";
        const beforeSwitch = getNavDisplayContext(tokorozawa.lat, tokorozawa.lng, 100000);
        state.runtime.activeGuideSegmentId = "池袋2";
        const afterSwitch = getNavDisplayContext(tokorozawa.lat, tokorozawa.lng, 101000);
        return {
            east7, station3, station2, akitsu5,
            beforePair: beforeSwitch.stationPair,
            afterPair: afterSwitch.stationPair,
            beforeDistance: beforeSwitch.distance,
            afterDistance: afterSwitch.distance,
        };
    })()`);

    assert.ok(result.east7 < result.station3);
    assert.equal(result.station3, result.station2);
    assert.ok(result.station2 < result.akitsu5);
    assert.deepEqual(result.beforePair, result.afterPair);
    assert.equal(result.beforeDistance, result.afterDistance);
}

function testNearbyParallelArmDoesNotCauseFarJump() {
    const context = createHarness();
    const result = read(context, `(() => {
        const route = {
            key: "test",
            edges: [
                {
                    a: { lat: 35, lng: 139, distance: 0 },
                    b: { lat: 35.005, lng: 139, distance: 560 },
                    length: 560, segmentId: "池袋3",
                },
                {
                    a: { lat: 35.005, lng: 139.0001, distance: 570 },
                    b: { lat: 35, lng: 139.0001, distance: 1130 },
                    length: 560, segmentId: "池袋3",
                },
            ],
        };
        const previous = {
            pathKey: "test", distance: 100,
            lat: 35.0009, lng: 139, time: 100000,
        };
        return projectPointOnNavRoute(route, 35.0009, 139.00008, null, previous, 101000);
    })()`);

    assert.ok(result.distance < 200, "近い別の腕へ約900m飛び移らない。");
}

function testRenderedCrossingMovesThroughTrainWithoutReversing() {
    const context = createHarness();
    const result = read(context, `(() => {
        const markers = [];
        const track = {
            querySelectorAll() { return []; },
            appendChild(element) { markers.push(element); },
        };
        const root = {
            _navSegNext: {}, _navSegPrev: {}, _navCurrentStation: {},
            _navTrain: {}, _navSpotLayer: track, _navBand2Track: track,
        };
        document.getElementById = (id) => id === "screen-guidance" ? root : null;
        state.config.direction = "下り";
        applyGuidePlan({ segmentIds: ["池袋2", "池袋3"], terminalName: "西所沢" }, "池袋3");
        const crossing = state.datasets.navSpots.find((spot) => spot.name === "東村山7号");
        const station = state.datasets.stations["所沢"];
        const samples = [station, crossing].map((spot, index) => {
            markers.length = 0;
            const display = getNavDisplayContext(spot.lat, spot.lng, 100000 + index * 20000);
            updateNavSpotsOnBand2(spot.lat, spot.lng, display);
            const crossingMarker = markers.find((item) =>
                item.className === "nav-spot nav-spot--crossing" &&
                item.attributes?.["aria-label"] === "踏切 東村山7号");
            return {
                top: crossingMarker ? Number.parseFloat(crossingMarker.style.top) : null,
                stationNames: markers.filter((item) =>
                    item.className === "nav-spot nav-spot--station")
                    .map((item) => item.textContent),
            };
        });
        return samples;
    })()`);

    assert.ok(result[0].top < 50, "所沢では次の踏切が上側に表示される。");
    assert.equal(result[1].top, 50, "踏切通過位置では中央に表示される。");
    assert.ok(!result[0].stationNames.includes("東飯能"), "他区間の駅は表示されない。");
}

async function testLoadDataFetchesOnlyCsvForSpotGeometry() {
    const context = createHarness();
    const requests = [];
    context.fetch = async (url, options) => {
        requests.push({ url, options });
        if (url === "./data/stationdata.csv") {
            return { arrayBuffer: async () => stationCsvBytes };
        }
        return { json: async () => [] };
    };
    await vm.runInContext(`loadData()`, context);
    assert.ok(!requests.some((request) => request.url.includes("nav_geometry")));
    assert.equal(requests.find((request) =>
        request.url === "./data/stationdata.csv").options.cache, "no-store");
    assert.equal(read(context, `getNavSegmentPoints("有楽")?.length`), 3);
}

async function main() {
    testEverySegmentHasValidOrderedGeometry();
    testCsvAloneControlsSpotAdditionAndDeletion();
    testCsvRowReorderingDoesNotChangeGeometry();
    testCurveHelperPointUsesCsvWithoutBecomingStartSpot();
    testInvalidNavOrderAffectsOnlyItsSegment();
    testDuplicateNavOrderIsRejected();
    testConnectedRoutesInBothDirections();
    testAllGeometryPointsRemainOrderedWhenMatched();
    testTokorozawaCurveKeepsPhysicalOrder();
    testUpboundAndGuideSegmentSwitch();
    testNearbyParallelArmDoesNotCauseFarJump();
    testRenderedCrossingMovesThroughTrainWithoutReversing();
    await testLoadDataFetchesOnlyCsvForSpotGeometry();
    console.log("navigation geometry tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
