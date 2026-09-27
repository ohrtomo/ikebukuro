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

function configurePlatformData(context) {
    vm.runInContext(
        `
            state.config.dayType = "平日";
            state.datasets.platforms = {
                "平日": {
                    "駅A": { "1": [1001], "2": [2001] },
                    "駅B": { "2": ["1001"], "3": [2001] },
                    "駅C": { "10": [], "2": [] },
                },
                "土休日": {
                    "駅A": { "3": [] },
                },
            };
            state.datasets.stations = {
                "駅A": { stopPatterns: { "各停": true } },
                "駅B": { stopPatterns: { "各停": true } },
                "駅C": { stopPatterns: { "各停": true } },
            };
        `,
        context,
    );
}

function testSetupIsRequiredOnlyWhenNoRegistrationExists() {
    const context = createHarness();
    configurePlatformData(context);

    assert.deepEqual(
        readJson(context, 'getRegisteredPlatformMapForTrain("1001")'),
        { "駅A": "1", "駅B": "2" },
        "1駅でも登録があれば開始時番線設定は表示しない。",
    );
    assert.equal(
        vm.runInContext('needsInitialPlatformSetup("1001")', context),
        false,
    );
    assert.equal(
        vm.runInContext('needsInitialPlatformSetup("9999")', context),
        true,
        "全駅で登録が0件の列番だけ開始時番線設定の対象にする。",
    );
}

function testInitialSelectionBecomesNormalPlatformBaseline() {
    const context = createHarness();
    configurePlatformData(context);

    vm.runInContext(
        `
            state.config.trainNo = "9999";
            state.runtime.manualPlatforms = {};
            setInitialPlatformPlan("9999", {
                "駅A": "2",
                "駅B": "3",
                "駅C": "10",
            });
        `,
        context,
    );

    assert.equal(
        vm.runInContext('getPlatformForStation("駅A")', context),
        "2",
    );
    assert.equal(
        vm.runInContext('getEffectivePlatformForStation("駅A")', context),
        "2",
    );
    assert.equal(
        vm.runInContext('isPlatformChanged("駅A")', context),
        false,
        "開始時に選んだ番線そのものは着発線変更にしない。",
    );

    vm.runInContext(
        'state.runtime.manualPlatforms = { "駅A": "2" };',
        context,
    );
    assert.equal(
        vm.runInContext('isPlatformChanged("駅A")', context),
        false,
        "基準と同じ手動値も着発線変更にはしない。",
    );

    vm.runInContext(
        'state.runtime.manualPlatforms = { "駅A": "1" };',
        context,
    );
    assert.equal(
        vm.runInContext('isPlatformChanged("駅A")', context),
        true,
        "運転整理等で基準と異なる番線にした場合だけ変更扱いにする。",
    );
}

function testInitialBaselineIsScopedToTrainAndDayType() {
    const context = createHarness();
    configurePlatformData(context);

    vm.runInContext(
        `
            setInitialPlatformPlan("9999", { "駅A": "2" });
        `,
        context,
    );

    assert.equal(
        vm.runInContext(
            'getPlatformForStationForTrain("駅A", "9999")',
            context,
        ),
        "2",
        "運転整理で同じ列番を扱う場合も開始時基準を参照する。",
    );
    assert.equal(
        vm.runInContext(
            'getPlatformForStationForTrain("駅A", "8888")',
            context,
        ),
        null,
        "別列番へ開始時基準を流用しない。",
    );

    vm.runInContext('state.config.dayType = "土休日";', context);
    assert.equal(
        vm.runInContext(
            'getPlatformForStationForTrain("駅A", "9999")',
            context,
        ),
        null,
        "別運転日の基準として流用しない。",
    );
}

function testSetupUsesEveryPlatformStationAndNumericOptionOrder() {
    const context = createHarness();
    configurePlatformData(context);

    assert.deepEqual(
        readJson(context, "getInitialPlatformSetupStations()"),
        [
            { stationName: "駅A", platformNumbers: ["1", "2"] },
            { stationName: "駅B", platformNumbers: ["2", "3"] },
            { stationName: "駅C", platformNumbers: ["2", "10"] },
        ],
        "当日のplatform.jsonにある全駅と全番線候補を表示する。",
    );
}

function testGuidanceAnnouncesOnlyDifferencesFromInitialBaseline() {
    const context = createHarness();
    configurePlatformData(context);

    vm.runInContext(
        `
            state.config.trainNo = "9999";
            state.config.type = "各停";
            state.config.cars = 10;
            state.config.direction = "下り";
            state.runtime.started = true;
            state.runtime.speedKmh = 0;
            state.runtime.passStations = new Set();
            state.runtime.prevStationName = "駅A";
            state.runtime.prevStationDistance = 401;
            setInitialPlatformPlan("9999", { "駅A": "2" });

            spoken = [];
            speakOnce = (key, text) => { spoken.push(text); };
            updateRouteLock = () => {};
            maybeHandleMidChangeArrival = () => false;
            maybeShowDepartureForNearbyStopStation = () => {};
            otherSpeaks = () => {};

            state.runtime.manualPlatforms = {};
            maybeSpeak({ name: "駅A", distance: 400 });
            baselineSpoken = [...spoken];

            spoken = [];
            state.runtime.prevStationName = "駅A";
            state.runtime.prevStationDistance = 401;
            state.runtime.manualPlatforms = { "駅A": "1" };
            maybeSpeak({ name: "駅A", distance: 400 });
            changedSpoken = [...spoken];
        `,
        context,
    );

    const baselineSpoken = readJson(context, "baselineSpoken");
    const changedSpoken = readJson(context, "changedSpoken");

    assert.ok(baselineSpoken.includes("駅A、停車、10両"));
    assert.equal(
        baselineSpoken.some((text) => text.includes("着発線変更")),
        false,
        "開始時基準番線は通常案内とし、着発線変更を付けない。",
    );
    assert.ok(
        changedSpoken.includes("駅A、停車、10両、着発線変更"),
        "基準と異なる運転整理番線には着発線変更を付ける。",
    );
}

function testScreenRequiresAllRowsAndProvidesBackAction() {
    assert.match(appSource, /id:\s*"screen-initial-platforms"/);
    assert.match(appSource, /"この番線で開始"/);
    assert.match(appSource, /"戻る"/);
    assert.match(
        appSource,
        /const missingRow = rows\.find\([\s\S]*input\[type="radio"\]:checked/,
        "未選択駅がある場合は開始を拒否する。",
    );
    assert.match(
        appSource,
        /requestGuidanceStart\("normal"\)/,
        "通常開始で未登録番線判定を通す。",
    );
    assert.match(
        appSource,
        /requestGuidanceStart\("underground"\)/,
        "地下起動でも未登録番線判定を通す。",
    );
    assert.match(
        stylesSource,
        /\.initial-platform-list\s*\{[^}]*overflow-y:\s*auto/s,
        "iPadで全駅をスクロールして選択できる。",
    );
}

testSetupIsRequiredOnlyWhenNoRegistrationExists();
testInitialSelectionBecomesNormalPlatformBaseline();
testInitialBaselineIsScopedToTrainAndDayType();
testSetupUsesEveryPlatformStationAndNumericOptionOrder();
testGuidanceAnnouncesOnlyDifferencesFromInitialBaseline();
testScreenRequiresAllRowsAndProvidesBackAction();
console.log("initial platform setup tests passed");
