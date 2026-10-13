const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const types = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "data", "types.json"), "utf8",
));
const trainTypeCsv = fs.readFileSync(
    path.join(__dirname, "..", "data", "train_type_conversion.csv"), "utf8",
);
const stationCsv = new TextDecoder("shift_jis").decode(fs.readFileSync(
    path.join(__dirname, "..", "data", "stationdata.csv"),
));

// 設定画面の実際のイベントを実行するための最小DOM。
// select.value は実ブラウザ同様、未登録の値を保持しない。
class Element {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.attributes = {};
        this.style = {};
        this.className = "";
        this._text = "";
        this._value = undefined;
        this.checked = false;
        this.disabled = false;
        const classes = () => this.className.split(/\s+/).filter(Boolean);
        this.classList = {
            contains: (name) => classes().includes(name),
            add: (name) => { this.className = [...new Set([...classes(), name])].join(" "); },
            remove: (name) => { this.className = classes().filter((s) => s !== name).join(" "); },
            toggle: (name, force) => {
                const enabled = force === undefined ? !classes().includes(name) : force;
                this.classList[enabled ? "add" : "remove"](name);
                return enabled;
            },
        };
    }
    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener() {}
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
    set textContent(value) { this._text = String(value); this.children = []; }
    set innerHTML(value) {
        assert.equal(value, "", "このDOMでは内容を消去する操作だけを使用する。");
        this._text = "";
        this.children = [];
    }
    get options() { return this.children.filter((child) => child.tagName === "OPTION"); }
    get value() {
        if (this._value !== undefined) return this._value;
        if (this.tagName === "SELECT") return this.options[0]?.value ?? "";
        return this.attributes.value ?? "";
    }
    set value(value) {
        const text = String(value);
        this._value = this.tagName === "SELECT" && !this.options.some((opt) => opt.value === text)
            ? "" : text;
    }
    matches(selector) {
        const match = selector.match(/^(\w+)?(?:\.([\w-]+)|#([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/);
        assert.ok(match, `未対応のセレクタ: ${selector}`);
        const [, tag, className, id, attr, attrValue] = match;
        return (!tag || this.tagName === tag.toUpperCase()) &&
            (!className || this.classList.contains(className)) &&
            (!id || this.getAttribute("id") === id) &&
            (!attr || (this.getAttribute(attr) !== null &&
                (attrValue === undefined || this.getAttribute(attr) === attrValue)));
    }
    querySelectorAll(selector) {
        return this.children.flatMap((child) => [
            ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
        ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) ?? null; }
}

function createHarness(payload) {
    const alerts = [];
    const requests = [];
    const document = {
        body: new Element("body"), head: new Element("head"),
        visibilityState: "visible", addEventListener() {},
        createElement: (tag) => new Element(tag),
        createTextNode: (text) => {
            const node = new Element("text");
            node.textContent = text;
            return node;
        },
        getElementById(id) { return this.body.querySelector(`#${id}`); },
    };
    const fixedNow = new Date(2026, 9, 11, 12, 0, 0).getTime();
    class FixedDate extends Date {
        constructor(...args) { super(...(args.length ? args : [fixedNow])); }
        static now() { return fixedNow; }
    }
    const context = vm.createContext({
        console, TextDecoder, URL, Date: FixedDate, navigator: {}, document,
        window: { addEventListener() {}, speechSynthesis: { cancel() {} } },
        alert(message) { alerts.push(message); },
        async fetch(url) {
            requests.push(url);
            return { ok: true, async json() { return payload; } };
        },
        setTimeout, clearTimeout, setInterval, clearInterval,
    });
    vm.runInContext(appSource, context, { filename: "app.js" });
    context.fixtureTypes = types;
    context.fixtureTrainTypeCsv = trainTypeCsv;
    context.fixtureStationCsv = stationCsv;
    vm.runInContext(`
        state.datasets.types = fixtureTypes;
        state.datasets.trainTypeConversions = parseTrainTypeConversionCsv(fixtureTrainTypeCsv);
        const stationDataFixture = parseStationDataCsv(fixtureStationCsv);
        state.datasets.referenceOnlyDestinations = stationDataFixture.referenceOnlyDestinations;
        state.datasets.stationNameById = stationDataFixture.stationNameById;
        state.datasets.dests = ["池袋", "所沢", "飯能", "小竹向原"];
        state.datasets.stations = { "池袋": {}, "所沢": {}, "飯能": {}, "小竹向原": {} };
        state.datasets.stationIdMap = { "所沢": "S0140TK", "小竹向原": "S0315KT" };
        state.datasets.trainTable = [{
            "列車番号": "2000", "Unnamed: 1": "2999", "種別": "急行",
            "行先": "池袋", "Unnamed: 4": "飯能",
        }];
    `, context);
    return { context, document, alerts, requests };
}

function payloadFor(detail, direction = "down") {
    return { departure: [{ direction, detail }] };
}

function train(fields = {}) {
    return { trainNo: "2001", trainType: "15", destination: "所沢", departureHms: "120500", ...fields };
}

function testCsvMasters() {
    const harness = createHarness(payloadFor([]));
    const actual = JSON.parse(vm.runInContext(`JSON.stringify((() => {
        const stationData = parseStationDataCsv(fixtureStationCsv);
        const typeRows = parseCsvText(fixtureTrainTypeCsv);
        return {
            referenceOnly: stationData.referenceOnlyDestinations,
            hasThroughStation: !!stationData.stations["元町・中華街"],
            hasThroughNavSpot: stationData.navSpots.some(
                (spot) => spot.name === "元町・中華街"
            ),
            throughIdName: stationData.stationNameById["S7340MC"],
            kotakeNormalId: stationData.stationIdMap["小竹向原"],
            kotakeReferenceIdName: stationData.stationNameById["S5315KT"],
            rinjiStopNames: Object.entries(stationData.stations)
                .filter(([, station]) => station.stopPatterns["臨時"])
                .map(([name]) => name),
            hasLegacyStopPattern: Object.prototype.hasOwnProperty.call(
                stationData.stations["池袋"].stopPatterns, "臨時A"
            ),
            typeCodes: typeRows.map((row) => row.trainType),
            mapped80: typeRows.find((row) => row.trainType === "80")?.案内種別,
            mapped90: typeRows.find((row) => row.trainType === "90")?.案内種別,
        };
    })())`, harness.context));
    for (const name of ["和光市", "（有）池袋", "（副）池袋", "羽田空港", "元町・中華街"]) {
        assert.ok(actual.referenceOnly.includes(name), `${name}を参照専用行先へ登録する。`);
    }
    assert.equal(actual.hasThroughStation, false);
    assert.equal(actual.hasThroughNavSpot, false);
    assert.equal(actual.throughIdName, "元町・中華街");
    assert.equal(actual.kotakeNormalId, "S0315KT");
    assert.equal(actual.kotakeReferenceIdName, "小竹向原");
    assert.deepEqual(actual.rinjiStopNames.sort(),
        ["池袋", "飯能", "西武秩父", "豊島園", "西武球場前", "小竹向原"].sort());
    assert.equal(actual.hasLegacyStopPattern, false);
    assert.equal(actual.typeCodes.length, 99);
    assert.equal(new Set(actual.typeCodes).size, 99);
    assert.equal(actual.mapped80, "臨時");
    assert.equal(actual.mapped90, "回送");
    assert.ok(!types.some((type) => /^(回送|臨時)[A-J]/.test(type)));
}

async function fetchItems(harness, mode = "down") {
    return JSON.parse(JSON.stringify(await harness.context.fetchReferenceDepartures("所沢", mode)));
}

async function openReference(harness, mode = "down", stationName = "所沢") {
    const { context, document } = harness;
    context.getReferenceStationName = async () => stationName;
    context.continueAfterTrainSettings = () => { harness.continued = true; };
    const screen = context.screenSettings();
    document.body.appendChild(screen);
    screen.querySelectorAll("button").find((button) => button.textContent === "参照").onclick();
    const modal = screen.querySelector("#trainRefModal");
    modal.onclick({ target: modal.querySelector(`[data-ref-mode="${mode}"]`) });
    await new Promise(setImmediate);
    assert.match(screen.querySelector(".train-ref-status").textContent, /直近の発車列車/);
    return screen;
}

function executeSettings(screen) {
    const cars = screen.querySelector(".settings-cars-buttons")
        .querySelectorAll("button").find((button) => button.textContent === "8両");
    cars.onclick({ currentTarget: cars });
    screen.querySelector(".settings-actions").querySelector("button").onclick();
}

async function testApiValuesReachGuidanceConfig() {
    const harness = createHarness(payloadFor([train()]));
    const screen = await openReference(harness);
    const item = screen.querySelector(".train-ref-item");
    assert.equal(item.querySelector(".train-ref-type").textContent, "各停");
    assert.equal(item.querySelector(".train-ref-dest").textContent, "所沢");
    item.onclick();
    assert.equal(screen.querySelector("#trainNo").value, "2001");
    assert.equal(screen.querySelector("#type").value, "各停", "表の急行で上書きしない。");
    assert.equal(screen.querySelector("#dest").value, "所沢", "表の飯能で上書きしない。");
    assert.equal(screen.querySelector("#startStation").value, "所沢");
    assert.equal(screen.querySelector("#trainRefModal").classList.contains("active"), false);
    executeSettings(screen);
    const config = JSON.parse(vm.runInContext("JSON.stringify(state.config)", harness.context));
    assert.equal(config.type, "各停");
    assert.equal(config.dest, "所沢");
    assert.equal(config.trainNo, "2001");
    assert.equal(config.direction, "下り");
    assert.equal(config.startStation, "所沢");
    assert.equal(config.cars, 8);
    assert.equal(harness.continued, true);
    assert.deepEqual(harness.alerts, []);
    assert.equal(harness.requests[0],
        "https://train.seibuapp.jp/trainfo-api/ti/v1.0/stations/S0140TK/departures");
}

async function testFallbackIsPerField() {
    const harness = createHarness(payloadFor([
        train({ trainNo: "2001", trainType: "", destination: "所沢" }),
        train({ trainNo: "2003", trainType: "15", destination: "" }),
        train({ trainNo: "2005", trainType: 13, destination: "所沢" }),
        train({ trainNo: "2007", trainType: "13", trainTypeName: "快速", destination: "所沢" }),
        train({ trainNo: "2009", trainType: "4", typeName: "各駅停車" }),
        train({ trainNo: "2011", trainType: "(未定義)", destination: "" }),
    ]));
    const items = await fetchItems(harness);
    assert.deepEqual(items.map(({ trainNo, type, dest }) => ({ trainNo, type, dest })), [
        { trainNo: "2001", type: "急行", dest: "所沢" },
        { trainNo: "2003", type: "各停", dest: "飯能" },
        { trainNo: "2005", type: "急行", dest: "所沢" },
        { trainNo: "2007", type: "快速", dest: "所沢" },
        { trainNo: "2009", type: "各停", dest: "所沢" },
        { trainNo: "2011", type: "急行", dest: "飯能" },
    ]);
    const screen = await openReference(harness);
    screen.querySelectorAll(".train-ref-item")[1].onclick();
    assert.equal(screen.querySelector("#type").value, "各停");
    assert.equal(screen.querySelector("#dest").value, "飯能");
}

async function testCodeMappingAndKeyCompatibility() {
    const harness = createHarness({ "出発": [{ "方向": "下り", details: [
        { "列車番号": "2001", "列車種別": "ＳトレインＡ", "行先駅名": "所沢", "出発時間": "12:05:00" },
        { trainNo: "2003", trainType: 18, toStationName: "所沢", departureTime: "120500" },
        { trainNo: "2005", type: "各駅停車", destinationName: "所沢", departureHms: "120500" },
        train({ trainNo: "2007", trainType: "90" }),
        train({ trainNo: "2008", trainType: "91" }),
        train({ trainNo: "2011", trainType: "1" }),
        train({ trainNo: "2013", trainType: "9" }),
        train({ trainNo: "2015", trainType: "80" }),
        train({ trainNo: "2017", trainType: "19" }),
        train({ trainNo: "2019", trainType: "68" }),
    ] }] });
    const items = await fetchItems(harness);
    assert.deepEqual(items.map((item) => item.type), [
        "SトレA", "SトレB", "各停", "回送", "回送",
        "回送", "特急", "臨時", "拝島ライナー", "ＳトレインＡ副",
    ]);
    assert.ok(items.every((item) => item.dest === "所沢" && item.hms === "12:05:00"));
}

async function testCsvGuidanceTypeOverridesApiName() {
    const harness = createHarness(payloadFor([
        train({ trainType: "15", typeName: "各駅停車" }),
    ]));
    vm.runInContext(`
        state.datasets.trainTypeConversions["15"].guidanceType = "急行";
    `, harness.context);
    const items = await fetchItems(harness);
    assert.equal(items[0].type, "急行", "入力済みCSVの読み替えはAPI名より優先する。");
}

async function testReferenceOnlyDestination() {
    const harness = createHarness(payloadFor([
        train({ trainNo: "2002", trainType: "15", destination: "S7340MC" }),
    ], "up"));
    const screen = await openReference(harness, "up");
    const destinationSelect = screen.querySelector("#dest");
    assert.equal(destinationSelect.options.some((option) =>
        option.value === "元町・中華街"), false,
    "参照前の手動選択肢には出さない。");
    const item = screen.querySelector(".train-ref-item");
    assert.equal(item.querySelector(".train-ref-dest").textContent, "元町・中華街");
    item.onclick();
    assert.equal(destinationSelect.value, "元町・中華街");
    const referenceOption = destinationSelect.options.find((option) =>
        option.value === "元町・中華街");
    assert.equal(referenceOption.getAttribute("disabled"), "");
    assert.equal(harness.context.getGuideTerminalNameForDestination("元町・中華街"),
        "小竹向原", "案内経路だけ小竹向原で終端とする。");
    assert.equal(harness.context.getDestCategory("元町・中華街"), "yuraku");
    const plan = JSON.parse(vm.runInContext(
        'JSON.stringify(buildGuidePlanFromStation("所沢", "元町・中華街", "上り"))',
        harness.context,
    ));
    assert.equal(plan.terminalName, "小竹向原");
    assert.ok(plan.segmentIds.includes("有楽"));
    executeSettings(screen);
    const config = JSON.parse(vm.runInContext("JSON.stringify(state.config)", harness.context));
    assert.equal(config.dest, "元町・中華街", "表示上の行先名は維持する。");
    assert.equal(harness.continued, true);
    assert.deepEqual(harness.alerts, []);
}

async function testSameNameReferenceDestinationUsesStationId() {
    const harness = createHarness(payloadFor([
        train({
            trainNo: "2002", destination: "池袋",
            toStationId: "S5304YI",
        }),
    ], "up"));
    const items = await fetchItems(harness, "up");
    assert.equal(items[0].dest, "（有）池袋", "同名駅はAPIの駅IDで区別する。");
}

async function testUnregisteredOrMissingValuesCannotReusePreviousInputs() {
    for (const detail of [
        train({ trainType: "19", destination: "元町・中華街" }),
        train({ trainNo: "9999", trainType: "999", destination: "" }),
    ]) {
        const harness = createHarness(payloadFor([detail]));
        const screen = await openReference(harness);
        screen.querySelector("#type").value = "急行";
        screen.querySelector("#dest").value = "飯能";
        const item = screen.querySelector(".train-ref-item");
        if (detail.trainType === "19") {
            assert.equal(item.querySelector(".train-ref-type").textContent, "拝島ライナー");
            assert.equal(item.querySelector(".train-ref-dest").textContent, "元町・中華街");
        }
        item.onclick();
        assert.equal(screen.querySelector("#type").value, "");
        assert.equal(screen.querySelector("#dest").value,
            detail.trainType === "19" ? "元町・中華街" : "");
        if (detail.trainType === "19") {
            assert.match(harness.alerts[0], /種別「拝島ライナー」.*手動/);
        }
        executeSettings(screen);
        assert.equal(harness.alerts.at(-1), "種別を選択してください。");
        assert.equal(harness.continued, undefined);
    }
}

async function testFilteringDedupeSortingAndLimitStayUnchanged() {
    const details = Array.from({ length: 25 }, (_, i) => train({
        trainNo: String(4001 + 2 * i), departureHms: `12${String(1 + i).padStart(2, "0")}00`,
    })).reverse();
    const harness = createHarness({ departures: [
        { direction: "down", detail: [...details, details[0], train({ trainNo: "4000" })] },
        { direction: "up", detail: [train({ trainNo: "9000", departureHms: "120000" })] },
    ] });
    const down = await fetchItems(harness, "down");
    assert.equal(down.length, 20);
    assert.equal(down[0].trainNo, "4001");
    assert.equal(down[1].trainNo, "4003");
    assert.equal(down[5].trainNo, "4009", "同時刻は列車番号順に表示する。");
    assert.equal(down[4].trainNo, "4000", "表にない列車はAPI方向を使う。");
    assert.equal(new Set(down.map((item) => `${item.trainNo}_${item.hms}`)).size, 20);
    const up = await fetchItems(harness, "up");
    assert.deepEqual(up.map((item) => item.trainNo), ["9000"]);
    const underground = await fetchItems(harness, "underground");
    assert.equal(underground[0].trainNo, "9000", "地下はAPI方向で絞り込まない。");
    const screen = await openReference(harness, "up");
    screen.querySelector(".train-ref-item").onclick();
    assert.equal(screen.querySelector("button[data-dir=\"上り\"]").classList.contains("active-selected"), true);
}

async function testManualSearchRemainsTableBased() {
    const harness = createHarness(payloadFor([train()]));
    const screen = await openReference(harness);
    screen.querySelector(".train-ref-item").onclick();
    screen.querySelectorAll("button").find((button) => button.textContent === "検索").onclick();
    assert.equal(screen.querySelector("#type").value, "急行");
    assert.equal(screen.querySelector("#dest").value, "飯能");
    assert.equal(harness.requests.length, 1, "明示的な検索の既存挙動は変更しない。");
}

(async () => {
    testCsvMasters();
    await testApiValuesReachGuidanceConfig();
    await testFallbackIsPerField();
    await testCodeMappingAndKeyCompatibility();
    await testCsvGuidanceTypeOverridesApiName();
    await testReferenceOnlyDestination();
    await testSameNameReferenceDestinationUsesStationId();
    await testUnregisteredOrMissingValuesCannotReusePreviousInputs();
    await testFilteringDedupeSortingAndLimitStayUnchanged();
    await testManualSearchRemainsTableBased();
    console.log("reference departures tests passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
